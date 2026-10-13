'use strict';
/**
 * 已安装 Mod：显示 Mod ID + 一键在资源管理器里定位原压缩包。
 *
 * 用户诉求（2026-10-13）：
 * > 已安装的 mod 要显示 mod id，提供 library 中的原压缩包的链接，
 * > 点击后直接在资源管理器中定位压缩包。
 *
 * 纯 Node，四组：
 *   1. `scanner.archiveInfo()` —— 主进程那个纯函数跑真身（在不在 / 在不在 library）
 *   2. `archiveBlockHtml()`   —— 从 app.js 抽真身进 vm，三种情况各断言一次
 *   3. `verText()` / `installedCard()` —— 版本号不拼成 `vv2.3`、卡片带 `#id` 徽标
 *   4. 接线（scanner 挂 archive / 点击委托顺序 / preload / CSS / 按钮）
 *
 * 运行：`npm run test:archive`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src', 'renderer', 'app.js');
const SCANNER = path.join(ROOT, 'src', 'main', 'scanner.js');
const CSS = path.join(ROOT, 'src', 'renderer', 'style.css');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'index.js');

const appCode = fs.readFileSync(APP, 'utf8');
const scannerCode = fs.readFileSync(SCANNER, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');
const preload = fs.readFileSync(PRELOAD, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

// ================================================================ 1. archiveInfo（跑真身）

console.log('\n[1] scanner.archiveInfo()：原始安装包信息');

// scanner.js 顶层 require 了 game / prereqs / paths —— 都是纯 Node 安全的
// （paths 里对 `require('electron')` 有 try/catch，纯 Node 会走项目内 data/）
const scanner = require(SCANNER);
const paths = require(path.join(ROOT, 'src', 'main', 'paths.js'));

t('导出了 archiveInfo', () => typeof scanner.archiveInfo === 'function' || '没导出');

{
  const a = scanner.archiveInfo(path.join(paths.LIBRARY, 'no-such-file-xyz.zip'));
  t('不存在的文件 → exists=false 但路径信息照给', () =>
    a && a.exists === false && a.name === 'no-such-file-xyz.zip' && a.path.endsWith('no-such-file-xyz.zip')
    || JSON.stringify(a));
  eq(a.inLibrary, true, 'library 下的路径 → inLibrary=true');
  eq(a.size, 0, '不存在时 size=0（不编造）');
  eq(a.mtime, null, '不存在时 mtime=null');
}

{
  const tmp = path.join(paths.TMP, 'archive-info-probe.zip');
  fs.mkdirSync(paths.TMP, { recursive: true });
  fs.writeFileSync(tmp, 'x'.repeat(1234));
  const a = scanner.archiveInfo(tmp);
  t('真实存在的文件 → exists=true', () => a.exists === true || JSON.stringify(a));
  eq(a.size, 1234, '带上真实大小');
  eq(a.inLibrary, false, 'tmp 下的路径 → inLibrary=false');
  t('带上 mtime（ISO 字符串）', () => typeof a.mtime === 'string' && !isNaN(Date.parse(a.mtime)) || String(a.mtime));
  try { fs.rmSync(tmp, { force: true }); } catch { /* 忽略 */ }
}

eq(scanner.archiveInfo(''), null, '空串 → null（不炸）');
eq(scanner.archiveInfo(null), null, 'null → null（不炸）');
eq(scanner.archiveInfo(undefined), null, 'undefined → null（不炸）');
t('大小写/相对路径也能判 inLibrary', () =>
  scanner.archiveInfo(path.join(paths.LIBRARY, '..', 'library', 'a.zip')).inLibrary === true || '判定失败');

// ================================================================ 2. 渲染层（跑真身）

console.log('\n[2] archiveBlockHtml()：三种情况');

function extract(name) {
  const start = appCode.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到 ' + name);
  let i = appCode.indexOf('{', start), depth = 0;
  for (; i < appCode.length; i++) {
    if (appCode[i] === '{') depth++;
    else if (appCode[i] === '}') { depth--; if (!depth) break; }
  }
  return appCode.slice(start, i + 1);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  extract('esc') + '\n' + extract('fmtSize') + '\n' + extract('verText') + '\n'
  + extract('archiveBlockHtml') + '\n'
  + 'this.f = { esc, fmtSize, verText, archiveBlockHtml };',
  ctx
);
const { verText, archiveBlockHtml } = ctx.f;

{
  const html = archiveBlockHtml({ archive: null });
  t('没有 archive → 说明「不是本程序装的」，不给假链接', () =>
    html.includes('原压缩包') && html.includes('不是本程序装') && !html.includes('data-reveal-path') || html);

  const inLib = archiveBlockHtml({
    archive: { path: 'D:\\x\\data\\library\\42_Foo_v1.0.zip', name: '42_Foo_v1.0.zip', inLibrary: true, exists: true, size: 2048, mtime: null }
  });
  t('在 library 里 → 文件名 + 定位按钮', () =>
    inLib.includes('42_Foo_v1.0.zip') && inLib.includes('data-reveal-path="D:\\x\\data\\library\\42_Foo_v1.0.zip"') || inLib);
  t('在 library 里 → 注明「来自内置库」', () => inLib.includes('来自内置库') || inLib);
  t('在 library 里 → 按钮可点（不带 disabled）', () => !inLib.includes('disabled') || inLib);
  t('在 library 里 → 带大小', () => inLib.includes('2.0 KB') || inLib);

  const outside = archiveBlockHtml({
    archive: { path: 'D:\\Downloads\\a.zip', name: 'a.zip', inLibrary: false, exists: true, size: 100, mtime: null }
  });
  t('不在 library 但存在 → 仍给定位按钮', () => outside.includes('data-reveal-path="D:\\Downloads\\a.zip"') || outside);
  t('不在 library → 如实注明「不在内置库」', () => outside.includes('不在内置库') || outside);

  const gone = archiveBlockHtml({
    archive: { path: 'D:\\gone\\b.zip', name: 'b.zip', inLibrary: true, exists: false, size: 0, mtime: null }
  });
  t('文件已不在 → 按钮置灰', () => /<button class="btn sm" disabled/.test(gone) || gone);
  t('文件已不在 → 不产生可点的 data-reveal-path', () => !gone.includes('data-reveal-path') || gone);
  t('文件已不在 → 把原路径写出来（方便自己去找）', () => gone.includes('D:\\gone\\b.zip') || gone);
  t('文件已不在 → 说明「可能被删除或移动」', () => gone.includes('删除或移动') || gone);
}

console.log('\n[3] verText() / installedCard()：版本号不拼成 vv2.3、卡片带 #id');

{
  eq(verText('2.2'), 'v2.2', '不带 v 的补上 v');
  eq(verText('v2.2'), 'v2.2', '自带 v 的不重复拼');
  eq(verText('V2.2'), 'V2.2', '大写 V 也不重复拼');
  eq(verText(''), '', '空串 → 空串');
  eq(verText(null), '', 'null → 空串');
  eq(verText('  '), '', '空白 → 空串');
}

{
  // installedCard 跑真身：把它的依赖一起喂进 vm（coverForMod / KIND_LABEL 用桩）
  const c2 = {
    console,
    coverForMod: () => '',
    KIND_LABEL: { pak: 'Pak 模组', prereq: '前置组件', script: '脚本模组' },
    fmtDate: () => '—'
  };
  vm.createContext(c2);
  vm.runInContext(
    extract('esc') + '\n' + extract('fmtSize') + '\n' + extract('verText') + '\n'
    + extract('installedCard') + '\n' + 'this.f = installedCard;',
    c2
  );
  const installedCard = c2.f;

  const html = installedCard({
    id: 'nexus:1312:5836', name: 'A2 Midriff', kind: 'pak', enabled: true,
    files: [], fileCount: 3, size: 15_600_000, mtime: null, location: 'X', registered: true,
    meta: { source: { modId: 1312, fileId: 5836, version: 'v2.3', author: 'xNumber7x' } }
  });
  t('卡片上有 #<modId> 徽标', () => html.includes('<span class="chip mid"') && html.includes('#1312') || html);
  t('版本号显示成 v2.3（不是 vv2.3）', () => html.includes('>v2.3<') && !html.includes('vv2.3') || html);
  t('徽标带 title 说明这是 Nexus Mod ID', () => /chip mid" title="Nexus Mod ID/.test(html) || html);

  const noId = installedCard({
    id: 'disk:paks:xyz', name: 'Unknown', kind: 'pak', enabled: true,
    files: [], fileCount: 1, size: 10, mtime: null, location: 'X', registered: false, meta: null
  });
  t('未登记（没有 modId）→ 不显示空的 # 徽标', () => !noId.includes('chip mid') || noId);

  const vless = installedCard({
    id: 'nexus:1:2', name: 'N', kind: 'pak', enabled: true, files: [], fileCount: 1, size: 1,
    mtime: null, location: 'X', registered: true, meta: { source: { modId: 1, version: '3.0' } }
  });
  t('版本号不带 v 时补上（v3.0）', () => vless.includes('>v3.0<') || vless);
}

// ================================================================ 4. 接线

console.log('\n[4] 接线与样式');

{
  t('scanner 在 scan() 末尾统一挂 m.archive（一处覆盖所有分支）', () =>
    /for \(const m of out\) \{\s*\n\s*const ap = m\.meta && m\.meta\.archivePath;\s*\n\s*if \(ap\) m\.archive = archiveInfo\(ap\);/.test(scannerCode) || '缺失');
  t('scanner 用 paths.LIBRARY 判定「在不在内置库」', () => /paths\.LIBRARY/.test(scannerCode) || '缺失');
  t('archiveInfo 用 statSync 每次重新确认存在性', () => /fs\.statSync\(p\)/.test(scannerCode) || '缺失');
  t('archiveInfo 永不抛（statSync 包在 try 里）', () =>
    /let st = null;\s*\n\s*try \{ st = fs\.statSync\(p\); \} catch/.test(scannerCode) || '缺失');

  t('抽屉「信息」里有 Mod ID 行', () => /<span>Mod ID<\/span>/.test(appCode) || '缺失');
  t('Mod ID 行同时给出文件 ID', () => /· 文件 \$\{esc\(String\(src\.fileId\)\)\}/.test(appCode) || '缺失');
  t('抽屉正文插入了 archiveBlockHtml(m)', () => /\$\{archiveBlockHtml\(m\)\}/.test(appCode) || '缺失');
  t('抽屉底栏有「📦 定位原压缩包」（且只在安装包还在时出现）', () =>
    /m\.archive && m\.archive\.exists\s*\n?\s*\?\s*`<button class="btn" data-reveal-path=/.test(appCode) || '缺失');
  t('archiveBlockHtml 放在 openInstalledDrawer 之前（函数声明提升之外也要可读）', () =>
    appCode.indexOf('function archiveBlockHtml(') < appCode.indexOf('function openInstalledDrawer(') || '顺序不对');

  // 点击委托：data-reveal-path 必须排在 .card 之前，否则点按钮会顺手开抽屉
  const idxRevealPath = appCode.indexOf("t.closest('[data-reveal-path]')");
  const idxCard = appCode.indexOf("t.closest('.card')");
  t('点击委托里 data-reveal-path 排在 .card 之前', () =>
    idxRevealPath > 0 && idxCard > 0 && idxRevealPath < idxCard || `revealPath@${idxRevealPath} card@${idxCard}`);
  t('委托调用的是 window.api.revealPath', () =>
    /window\.api\.revealPath\(revealp\.dataset\.revealPath\)/.test(appCode) || '缺失');

  t('preload 暴露 revealPath → app:revealPath', () =>
    /revealPath: \(p\) => invoke\('app:revealPath', p\)/.test(preload) || '缺失');
  t('CSS 有 .chip.mid（Mod ID 徽标）', () => /\.chip\.mid\{/.test(css) || '缺失');
  t('CSS 里 .chip.mid 用等宽字体（和版本号一眼分得开）', () =>
    /\.chip\.mid\{[^}]*font-family:Consolas/.test(css) || '缺失');
  t('CSS 有 .arcnm（原压缩包文件名限两行 + 省略号）', () =>
    /\.urlbox \.arcnm\{[^}]*-webkit-line-clamp:2/.test(css) || '缺失');
  t('CSS 有 .arcnm.gone（文件已不在时加删除线）', () =>
    /\.urlbox \.arcnm\.gone\{[^}]*line-through/.test(css) || '缺失');
  t('archiveBlockHtml 用 .arcnm 而不是内联样式', () =>
    /<span class="arcnm/.test(appCode) || '缺失');
}

// ---------------------------------------------------------------- 收尾
console.log(`\n${fail === 0 ? '✅' : '❌'} archive: ${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项：'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
