/* 子 Mod：一个安装包里好几套，各自单独装 / 单独卸
 *
 * 用户 2026-11-24：
 *   ·「一个安装包有多个 mod 的如果只选择了其中部分安装，则其余的子 mod 要显示安装按钮」
 *   ·「安装 mod 的时候要记录好 mod 和子 mod 的关系，安装时不按文件显示按 mod 来显示，
 *      每个子 mod 都可以单独选择安装或卸载」
 *   ·「卸载后的文件名字依然正常显示，只是状态变成了未安装，操作按钮变成了安装；不减少显示内容」
 *
 * 这份探针只读，不联网、不动真实游戏目录。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const installer = require('../src/main/installer');
const scanner = require('../src/main/scanner');
const { createRegistry } = require('../src/main/registry');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  ← ' + extra : '')); }
};

/* ---------- A 逐文件身份证 ---------- */
ok('fileKey 忽略 [nx] 标识（`X [nx4184].pak` = `X.pak`）',
  installer.fileKey('Breast_Hip_phy_P [nx4184].pak') === installer.fileKey('Breast_Hip_phy_P.pak'));
ok('fileKey 保留扩展名：三件套各是各的',
  new Set([
    installer.fileKey('A.pak'), installer.fileKey('A.ucas'), installer.fileKey('A.utoc')
  ]).size === 3);
ok('fileKey 去掉 .disabled',
  installer.fileKey('A_P [nx1].pak.disabled') === installer.fileKey('A_P.pak'));
ok('stemOf 仍会把三件套压成一个主干（只用于粗判断）',
  new Set([installer.stemOf('A.pak'), installer.stemOf('A.ucas')]).size === 1);

/* ---------- B 账本：包内清单 → 子 Mod 关系 ---------- */
const plan = {
  entries: [
    { rel: 'Body/Body.pak', size: 100 },
    { rel: 'Body/Body.ucas', size: 200 },
    { rel: 'Body/Body.utoc', size: 300 },
    { rel: 'Outfit/Outfit.pak', size: 400 },
    { rel: 'Outfit/Outfit.ucas', size: 500 },
    { rel: 'readme.txt', size: 10 }
  ],
  mapping: [
    { rel: 'Body [nx9].pak', to: 'x\\Body [nx9].pak', size: 100 },
    { rel: 'Body [nx9].ucas', to: 'x\\Body [nx9].ucas', size: 200 },
    { rel: 'Body [nx9].utoc', to: 'x\\Body [nx9].utoc', size: 300 }
  ]
};
const led = installer.packageLedger(plan);
ok('包内 6 个文件 / 应装 3 个 / 没装 3 个',
  led.entryCount === 6 && led.installedCount === 3 && led.notInstalledCount === 3,
  `实际 ${led.entryCount}/${led.installedCount}/${led.notInstalledCount}`);
const bodySub = led.subs.find(s => s.dir === 'Body');
const outfitSub = led.subs.find(s => s.dir === 'Outfit');
ok('子 Mod「Body」装齐 3/3 且记下 3 个 rel',
  !!bodySub && bodySub.entryCount === 3 && bodySub.installedCount === 3 && bodySub.installedRels.length === 3,
  bodySub ? `${bodySub.installedCount}/${bodySub.entryCount} rels=${bodySub.installedRels.length}` : '没有 Body 这一套');
ok('子 Mod「Outfit」一个都没装（2 个文件等着装）',
  !!outfitSub && outfitSub.entryCount === 2 && outfitSub.installedCount === 0 && outfitSub.installedRels.length === 0,
  outfitSub ? `${outfitSub.installedCount}/${outfitSub.entryCount}` : '没有 Outfit 这一套');
ok('根级散文件归到 dir 为空的那一套',
  led.subs.some(s => s.dir === '' && s.entryCount === 1));

/* ---------- C 主体源码接线 ---------- */
const ipc = read('src/main/ipc.js');
const pre = read('src/preload/index.js');
const appSrc = read('src/renderer/app.js');
const css = read('src/renderer/style.css');

ok('ipc 有 installSub', /async function installSub\(/.test(ipc));
ok('ipc 注册了 mods:installSub', ipc.includes("handle('mods:installSub'"));
ok('ipc 有 uninstallSub', /async function uninstallSub\(/.test(ipc));
ok('ipc 注册了 mods:uninstallSub', ipc.includes("handle('mods:uninstallSub'"));
ok('ipc 有「老记录现算」的 subRelsNow', /async function subRelsNow\(/.test(ipc));
ok('installSub 只装这一套（按 fileKey 过滤 mapping）',
  ipc.includes('want.add(installer.fileKey(') && ipc.includes('plan.mapping = only;'));
ok('installSub 并入原记录（patch 而不新建卡）', ipc.includes('registry.patch(id, patchBody)'));
ok('installSub 按整包分析（不带 pickDir），否则别的几套会被记成 0 装',
  ipc.includes('installer.analyze(root, ap, m, { ownedPaths })')
  && !ipc.includes('analyze(root, ap, m, { ownedPaths, pickDir: dir })'));
ok('installSub 用整包账本补齐子 Mod 表', ipc.includes('for (const s of (ledFull.subs'));
ok('子 Mod 行排在「包内文件」标签前面（标签在表格函数里）',
  appSrc.includes(`'<div class="lbl">包内文件</div>' + pkgTableHtml(null)`)
  && !appSrc.includes('<div class="lbl">包内文件</div>\r\n    <div id="drawerPkg">'));
ok('uninstallSub 把文件移进备份目录再删 manifest 对应项',
  ipc.includes("path.join(paths.BACKUP, 'uninstalled'") && ipc.includes('manifest: keep,'));
ok('preload 暴露 installSub / uninstallSub',
  pre.includes('installSub: (opts) => invoke(') && pre.includes('uninstallSub: (opts) => invoke('));

/* ---------- D 界面：子 Mod 那几行 ---------- */
ok('渲染层有 subsHtml', /function subsHtml\(/.test(appSrc));
ok('一套装齐给「卸载」按钮', appSrc.includes('data-sub-uninstall='));
ok('没装齐给「安装」按钮', appSrc.includes('data-sub-install='));
ok('点击分别派给 subModInstall / subModUninstall',
  /function subModInstall\(/.test(appSrc) && /function subModUninstall\(/.test(appSrc));
ok('包内文件表与子 Mod 小结一起画', appSrc.includes('subsHtml(') && appSrc.includes('pkgTableHtml('));
ok('只有两套以上才单独列（单套就是整包）', appSrc.includes('list.length > 1 ? list.sort'));
ok('子 Mod 行有样式 .sf-row', css.includes('.sf-row'));

/* ---------- E 全卸光之后：条目还在、只是「未安装」 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sub-'));
try {
  const modsDir = path.join(tmp, 'SB', 'Content', 'Paks', '~Mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const regFile = path.join(tmp, '.sbmod', 'mods.json');
  fs.mkdirSync(path.dirname(regFile), { recursive: true });
  const fakeArchive = path.join(tmp, 'pkg.zip');
  fs.writeFileSync(fakeArchive, 'zip');
  const reg = createRegistry(regFile);
  reg.upsert({
    id: 'nexus:8888:1', name: '两套整合包', kind: 'pak', enabled: false,
    source: { modId: 8888, fileId: 1 },
    installedAt: '2026-11-20T00:00:00Z',
    target: modsDir,
    archivePath: fakeArchive,
    manifest: [],
    pkg: { archivePath: fakeArchive, entryCount: 6, installedCount: 0, subs: [
      { dir: 'Body', entryCount: 3, installedCount: 0, installedRels: [] },
      { dir: 'Outfit', entryCount: 2, installedCount: 0, installedRels: [] }
    ] }
  });
  const items = scanner.scan(tmp, reg, null);
  const it = items.find(m => m.id === 'nexus:8888:1');
  ok('全部卸光后条目仍然出现（不会从列表里凭空消失）', !!it);
  ok('状态是「未安装」：files 为空、installed=false、reinstallable=true',
    !!it && it.files.length === 0 && it.installed === false && it.reinstallable === true,
    it ? `files=${it.files.length} installed=${it.installed}` : '');
  ok('安装包不在了就不再挂这条空壳', (() => {
    fs.unlinkSync(fakeArchive);
    const again = scanner.scan(tmp, reg, null).find(m => m.id === 'nexus:8888:1');
    return !again;
  })());
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
