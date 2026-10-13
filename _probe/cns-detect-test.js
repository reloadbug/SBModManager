'use strict';
/*
 * CNS 安装状态检测自检。
 *
 * 背景：早期版本靠「在 ue4ss\Mods / ~Mods 里找 nano|cns|suit 命名」猜，既不能确证
 * 又会误报。现在按**特征文件**判定，这个文件把判定规则钉死。
 *
 * 判定规则（game.js 的 CNS_MARKERS）：
 *   核心  SB\Content\Paks\LogicMods\DekCNS_P.pak
 *   核心  SB\Binaries\Win64\ue4ss\Mods\DekCNS\Scripts\main.lua
 *   附带  SB\Content\Paks\~Mods\CustomNanosuitSystem\
 *   两个核心都在 → installed；只命中一部分 → partial + 明确说缺什么。
 *
 * 用临时目录造一个假游戏根，**不碰真实游戏目录**。
 *
 * 运行：node _probe/cns-detect-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const game = require('../src/main/game');
const { createRegistry } = require('../src/main/registry');
const scanner = require('../src/main/scanner');

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

const ROOT = path.join(os.tmpdir(), 'sb-cns-detect-test');

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); } catch { /* 忽略 */ }
}
function write(rel, content = 'x') {
  const abs = path.join(ROOT, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const M = {
  exe: 'SB/Binaries/Win64/SB-Win64-Shipping.exe',
  pak: 'SB/Content/Paks/LogicMods/DekCNS_P.pak',
  ucas: 'SB/Content/Paks/LogicMods/DekCNS_P.ucas',
  utoc: 'SB/Content/Paks/LogicMods/DekCNS_P.utoc',
  lua: 'SB/Binaries/Win64/ue4ss/Mods/DekCNS/Scripts/main.lua',
  cosmetic: 'SB/Content/Paks/~Mods/CustomNanosuitSystem/Cosmetics/DekCNS-DefaultEve.dekcns.json'
};

rmrf(ROOT);
fs.mkdirSync(ROOT, { recursive: true });

console.log('\n=== 0) 假游戏根可被识别 ===');
write(M.exe);
t('isGameRoot 为真', () => game.isGameRoot(ROOT) === true);

console.log('\n=== 1) 什么都没装 → installed=false，且不是 partial ===');
let cns = game.inspect(ROOT).cns;
t('installed=false', () => cns.installed === false ? true : 'true');
t('partial=false', () => cns.partial === false ? true : 'true');
t('confident=true（判定依据是特征文件，不是猜测）', () => cns.confident === true ? true : String(cns.confident));
t('coreFound=0/2', () => (cns.coreFound === 0 && cns.coreTotal === 2) ? true : cns.coreFound + '/' + cns.coreTotal);
t('列全了 3 个特征位', () => cns.markers.length === 3 ? true : cns.markers.length);
t('没有 note（没装就不用解释）', () => cns.note === null ? true : cns.note);

console.log('\n=== 2) 只装了 Content 侧（常见的手动解压漏一半）→ partial ===');
write(M.pak); write(M.ucas); write(M.utoc);
cns = game.inspect(ROOT).cns;
t('installed 仍为 false（核心特征没齐）', () => cns.installed === false ? true : 'true');
t('partial=true', () => cns.partial === true ? true : 'false');
t('coreFound=1/2', () => cns.coreFound === 1 ? true : cns.coreFound);
t('note 明确指出缺 Scripts 侧', () =>
  /安装不完整/.test(cns.note || '') && /main\.lua/.test(cns.note || '') ? true : cns.note);
t('IoStore 伴生文件被列出', () =>
  cns.companions.join(',') === 'DekCNS_P.pak,DekCNS_P.ucas,DekCNS_P.utoc' ? true : cns.companions.join(','));

console.log('\n=== 3) 补上 Binaries 侧 → installed=true ===');
write(M.lua);
cns = game.inspect(ROOT).cns;
t('installed=true', () => cns.installed === true ? true : 'false');
t('partial=false', () => cns.partial === false ? true : 'true');
t('coreFound=2/2', () => cns.coreFound === 2 ? true : cns.coreFound);
t('note 清空', () => cns.note === null ? true : cns.note);
t('只命中 2 个特征（服装数据还没装）', () => cns.found.length === 2 ? true : cns.found.length);

console.log('\n=== 4) 补上服装数据目录 → 附带特征也认出来 ===');
write(M.cosmetic);
cns = game.inspect(ROOT).cns;
t('found=3/3', () => cns.found.length === 3 ? true : cns.found.length);
t('服装数据目录被识别为目录', () => {
  const d = cns.markers.find(m => m.key === 'data');
  return d && d.exists && d.isDir === true ? true : JSON.stringify(d && { exists: d.exists, isDir: d.isDir });
});
t('服装数据目录统计到 1 个文件', () => {
  const d = cns.markers.find(m => m.key === 'data');
  return d && d.fileCount === 1 ? true : d && d.fileCount;
});
t('服装数据目录有字节数', () => {
  const d = cns.markers.find(m => m.key === 'data');
  return d && d.size > 0 ? true : d && d.size;
});

console.log('\n=== 5) 大小写不敏感：包内是 ~mods，游戏里是 ~Mods ===');
// 上面的夹具用的就是小写 ~Mods；再确认路径常量本身走的是小写 rel
t('markers 里的 rel 用的是 ~mods（Windows 不区分大小写，existsSync 能命中）', () => {
  const d = game.CNS_MARKERS.find(m => m.key === 'data');
  return d && d.rel.join('/').includes('~mods') ? true : d && d.rel.join('/');
});
t('小写 ~Mods 目录下确实能读到', () => {
  const p = path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods', 'CustomNanosuitSystem');
  return fs.existsSync(p) ? true : '不存在';
});

console.log('\n=== 6) scanner 把 CNS 标成 confirmed（不再需要免责声明） ===');
// 顺手把 UE4SS 的特征文件也补上，这样能验证「UE4SS 与 CNS 是两个独立条目」
write('SB/Binaries/Win64/dwmapi.dll');
write('SB/Binaries/Win64/ue4ss/UE4SS.dll');
const regFile = path.join(ROOT, '_test-registry.json');
try { fs.unlinkSync(regFile); } catch { /* 忽略 */ }
const registry = createRegistry(regFile);
const list = scanner.scan(ROOT, registry);
const cnsEntry = list.find(m => m.id === 'builtin:cns');
t('扫描结果里有 CNS 条目', () => !!cnsEntry);
t('confirmed=true', () => cnsEntry && cnsEntry.confirmed === true ? true : cnsEntry && cnsEntry.confirmed);
t('kind=prereq', () => cnsEntry && cnsEntry.kind === 'prereq' ? true : cnsEntry && cnsEntry.kind);
t('files 列出的是特征文件而不是猜出来的名字', () => {
  if (!cnsEntry) return '没有条目';
  const names = cnsEntry.files.map(f => f.name).join(' | ');
  return /DekCNS_P\.pak/.test(names) && /main\.lua/.test(names) ? true : names;
});
t('CNS 不会在列表里重复出现', () =>
  list.filter(m => m.kind === 'prereq' && /Nanosuit/i.test(m.name)).length === 1 ? true : '出现多次');
t('UE4SS 与 CNS 是两个独立条目', () =>
  list.filter(m => m.kind === 'prereq').length === 2 ? true : list.filter(m => m.kind === 'prereq').length);

console.log('\n=== 7) 去重：CNS 的脚本目录不该再被当成一条独立的脚本 mod ===');
{
  const ROOT3 = path.join(os.tmpdir(), 'sb-cns-dedupe-test');
  rmrf(ROOT3);
  const w3 = (rel) => {
    const abs = path.join(ROOT3, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  };
  w3(M.exe);
  w3(M.pak);
  w3(M.lua);
  // 另一个独立的脚本 mod，应当照常列出
  w3('SB/Binaries/Win64/ue4ss/Mods/SomeOtherMod/Scripts/main.lua');

  const regFile3 = path.join(ROOT3, '_r.json');
  const reg3 = createRegistry(regFile3);
  const scriptDir = path.join(ROOT3, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'DekCNS');
  reg3.upsert({
    id: 'nexus:1496:13020',
    name: 'Custom Nanosuit System',
    kind: 'cns',
    source: { modId: 1496, fileId: 13020 },
    manifest: [
      { path: path.join(scriptDir, 'Scripts', 'main.lua'), rel: 'SB/Binaries/Win64/ue4ss/Mods/DekCNS/Scripts/main.lua', size: 1 },
      { path: path.join(ROOT3, M.pak.split('/').join(path.sep)), rel: 'SB/Content/Paks/LogicMods/DekCNS_P.pak', size: 1 }
    ]
  });

  const l3 = scanner.scan(ROOT3, reg3);
  t('DekCNS 目录被认领，不再单列', () =>
    l3.find(m => m.id === 'disk:script:DekCNS') === undefined ? true : '仍然单列了一条');
  t('无关的脚本 mod 照常列出', () =>
    l3.find(m => m.id === 'disk:script:SomeOtherMod') ? true : '被误伤了');
  t('认领列表里只有 DekCNS', () => {
    const c = scanner.claimedScriptDirs(game.layout(ROOT3), reg3);
    return [...c].join(',') === 'dekcns' ? true : [...c].join(',');
  });
  t('CNS 本体仍然在列表里', () =>
    l3.find(m => m.id === 'nexus:1496:13020') ? true : '本体丢了');
  rmrf(ROOT3);
}

console.log('\n=== 8) 误报防护：名字里带 CNS 的无关 mod 不该被当成 CNS ===');
const ROOT2 = path.join(os.tmpdir(), 'sb-cns-falsepos-test');
rmrf(ROOT2);
fs.mkdirSync(path.join(ROOT2, 'SB', 'Binaries', 'Win64'), { recursive: true });
fs.writeFileSync(path.join(ROOT2, M.exe.split('/').join(path.sep)), 'x');
// 一个叫 CNS_UI_Tweaks 的脚本 mod —— 旧启发式会把它当成「已装 CNS」
fs.mkdirSync(path.join(ROOT2, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'CNS_UI_Tweaks', 'Scripts'), { recursive: true });
fs.writeFileSync(path.join(ROOT2, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'CNS_UI_Tweaks', 'Scripts', 'main.lua'), 'x');
const cns2 = game.inspect(ROOT2).cns;
t('installed=false（旧启发式会在这里误报）', () => cns2.installed === false ? true : 'true');
t('partial=false', () => cns2.partial === false ? true : 'true');
t('扫描结果里没有 CNS 条目', () => {
  const l = scanner.scan(ROOT2, createRegistry(path.join(ROOT2, '_r.json')));
  return l.find(m => m.id === 'builtin:cns') === undefined ? true : '仍然被当成 CNS';
});

/* ---------------- 清理 ---------------- */
rmrf(ROOT);
rmrf(ROOT2);

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
