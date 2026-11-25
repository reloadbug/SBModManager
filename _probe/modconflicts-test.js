'use strict';
/**
 * Mod 冲突检测探针（用户 2026-11-25 m16638/m17145）：
 *   - 核心：宽松解析 dekcns（尾逗号）、UniqueFitID 撞车=强、共享网格=提示
 *   - 全局扫描 scanAll + 安装前预检 checkInstall
 *   - IPC / preload / 渲染层接线
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const P = p => path.join(ROOT, p);
let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + ' → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + ' → EX: ' + e.message); }
}

const mc = require('../src/main/modConflicts');

console.log('\n===== A. 宽松解析 + 网格提取 =====');
t('A1 直接 JSON.parse 数组', () => {
  const v = mc.parseLoose('[{"UniqueFitID":"A"}]');
  return Array.isArray(v) && v[0].UniqueFitID === 'A';
});
t('A2 尾逗号 JSON5 也能解析（26 个真实文件是这种）', () => {
  const v = mc.parseLoose('[{"UniqueFitID":"A","OutfitPaths":["x",],},]');
  return Array.isArray(v) && v[0].UniqueFitID === 'A' && v[0].OutfitPaths.length === 1;
});
t('A3 坏文本返回 null 不抛', () => mc.parseLoose('{not json,,,}') === null);
t('A4 meshOf 取游戏网格名（去掉 .XXX 重复段）', () =>
  mc.meshOf('/Game/OutfitMods/X/Models/CH_P_EVE_31_TypeB.CH_P_EVE_31_TypeB') === 'CH_P_EVE_31_TypeB');
t('A5 meshOf 空值返回空串', () => mc.meshOf('') === '');

console.log('\n===== B. findConflicts 强/提示分级 =====');
function rec(id, fits, meshes, enabled = true) {
  return { modId: id, name: 'M' + id, enabled, fits, meshes };
}
const F = (fid, meshes) => ({ uniqueFitId: fid, displayName: 'D' + fid, meshes: meshes || [] });
t('B1 UniqueFitID 撞车 = strong', () => {
  const g = mc.findConflicts([rec(1, [F('SAME')], []), rec(2, [F('SAME')], [])]);
  const s = g.find(x => x.kind === 'uniqueFit');
  return !!s && s.level === 'strong' && s.mods.length === 2;
});
t('B2 共享网格 = tip（UniqueFitID 不同也可共存）', () => {
  const g = mc.findConflicts([rec(1, [F('A', ['CH_P_EVE_24']), ], ['CH_P_EVE_24']), rec(2, [F('B', ['CH_P_EVE_24'])], ['CH_P_EVE_24'])]);
  const tip = g.find(x => x.kind === 'mesh');
  return !!tip && tip.level === 'tip' && tip.mods.length === 2;
});
t('B3 无冲突返回空数组', () => {
  const g = mc.findConflicts([rec(1, [F('A', ['m1'])], ['m1']), rec(2, [F('B', ['m2'])], ['m2'])]);
  return g.length === 0;
});
t('B4 强冲突排在提示前面', () => {
  const g = mc.findConflicts([
    rec(1, [F('SAME', ['m1'])], ['m1']), rec(2, [F('SAME', ['m1'])], ['m1']), rec(3, [F('B', ['m1'])], ['m1'])
  ]);
  return g[0].level === 'strong' && g[g.length - 1].level === 'tip';
});

console.log('\n===== C. scanInstalled 真数据 =====');
const game = require('../src/main/game');
const { createFileOwner } = require('../src/main/fileOwner');
const root = 'C:\\games\\Star Blade';
let scanned = [];
t('C1 扫真游戏目录有结果', () => {
  if (!fs.existsSync(root)) return true; // 别的机器没有真数据也算跳过
  const layout = game.layout(root);
  const owner = createFileOwner(path.join(root, '.sbmod', 'mod-file-owner.json'));
  scanned = mc.scanInstalled(root, { modsDir: layout.modsDir, fileOwner: owner });
  return scanned.length > 0 || '扫到 0 个 Mod';
});
t('C2 每条至少有 fits 或 meshes', () => {
  if (!scanned.length) return true;
  return scanned.every(r => r.fits.length || r.meshes.length) || '有空记录';
});
t('C3 目录不存在返回空数组不抛', () => {
  const r = mc.scanInstalled(path.join(os.tmpdir(), 'sb-no-such-game-' + process.pid));
  return Array.isArray(r) && r.length === 0;
});

console.log('\n===== D. checkInstall 安装前预检（注入假 archive/fs，不联网不解压真包） =====');
t('D1 注入 archive：新包 dekcns 与已装 fit 撞车 → 报 strong', () => {
  const tmp = path.join(os.tmpdir(), 'sb-conflict-probe-' + process.pid);
  const rel = '105EVEPinkBodysuit.dekcns.json';
  const fakeArchive = {
    listEntries: () => ({ entries: [{ path: rel }] }),
    extract: (_arc, dest) => {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, rel), JSON.stringify([
        { UniqueFitID: 'EVE_PinkBodysuit', DisplayName: 'Pink', OutfitPaths: ['/Game/X/CH_P_EVE_31_TypeB.CH_P_EVE_31_TypeB'] }
      ]), 'utf8');
    }
  };
  const installed = [rec(1591, [F('EVE_PinkBodysuit')], ['CH_P_EVE_31_TypeB'])];
  const r = mc.checkInstall('fake.zip', { modId: 9999, name: 'New' }, installed, { archive: fakeArchive });
  const strong = r.conflicts.find(g => g.kind === 'uniqueFit' && g.level === 'strong');
  return (r.dekcns === 1 && !!strong && strong.mods.some(m => m.modId === 9999)) || JSON.stringify(r.conflicts);
});
t('D2 重装自己（同 modId）不算冲突', () => {
  const tmp = path.join(os.tmpdir(), 'sb-conflict-probe2-' + process.pid);
  const rel = 'X.dekcns.json';
  const fakeArchive = {
    listEntries: () => ({ entries: [{ path: rel }] }),
    extract: (_arc, dest) => {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, rel), JSON.stringify([{ UniqueFitID: 'SELF', OutfitPaths: [] }]), 'utf8');
    }
  };
  const installed = [rec(8888, [F('SELF')], [])];
  const r = mc.checkInstall('self.zip', { modId: 8888, name: 'Self' }, installed, { archive: fakeArchive });
  return r.conflicts.filter(g => g.level === 'strong').length === 0;
});

console.log('\n===== E. 主进程 / preload / 渲染层接线（静态断言） =====');
const IPC = fs.readFileSync(P('src/main/ipc.js'), 'utf8');
const PRE = fs.readFileSync(P('src/preload/index.js'), 'utf8');
const APP = fs.readFileSync(P('src/renderer/app.js'), 'utf8');
const HTML = fs.readFileSync(P('src/renderer/index.html'), 'utf8');
t('E1 ipc require modConflicts', () => /require\('\.\/modConflicts'\)/.test(IPC));
t('E2 ipc 有 conflictsScan 与 checkConflicts 通道', () =>
  /handle\('mods:conflictsScan'/.test(IPC) && /handle\('install:checkConflicts'/.test(IPC));
t('E3 preload 暴露 conflictsScan + checkConflicts', () =>
  /conflictsScan:\s*\(\)\s*=>\s*invoke\('mods:conflictsScan'\)/.test(PRE) &&
  /checkConflicts:\s*\(archivePath,\s*meta\)/.test(PRE));
t('E4 设置页有冲突扫描栏（三个按钮）', () =>
  /id="btnConflictScan"/.test(APP) && /id="btnConflictDisable"/.test(APP) && /id="btnConflictUninstall"/.test(APP));
t('E5 渲染层有扫描/批量/安装预检函数', () =>
  /async function runConflictScan/.test(APP) && /async function runConflictBatch/.test(APP) &&
  /async function confirmInstallConflicts/.test(APP));
t('E6 安装预检挂在 libInstall 里', () => {
  const start = APP.indexOf('async function libInstall(modId)');
  const end = APP.indexOf('async function libBatchInstall', start);
  const seg = APP.slice(start, end);
  return /confirmInstallConflicts\(it\)/.test(seg) && /disableConflictLoser/.test(seg);
});
t('E7 批量禁用走 setEnabledMany / 批量卸载走 gselBatchUninstall', () =>
  /setEnabledMany\(idsToDisable,\s*false\)/.test(APP) && /gselBatchUninstall\(groups\)/.test(APP));
t('E8 按钮委托三分支接好', () =>
  /id === 'btnConflictScan'/.test(APP) && /id === 'btnConflictDisable'/.test(APP) && /id === 'btnConflictUninstall'/.test(APP));
t('E9 安装冲突模态三按钮 resolve', () =>
  /id === 'icKeepOld'/.test(APP) && /id === 'icKeepNew'/.test(APP) && /id === 'icSkip'/.test(APP));

console.log('\n===== F. 游戏内名称 / CNS 元数据进档案 + 详情 + 搜索（m17942/m17527） =====');
const FLOW = fs.readFileSync(P('src/main/installFlow.js'), 'utf8');

t('F1 cnsMetaFromText 解析 DisplayName / UniqueFitID / 替换网格', () => {
  const m = mc.cnsMetaFromText(JSON.stringify([
    { DisplayName: 'Cute Pink Kitty Bodysuit', UniqueFitID: 'EVE_PinkBodysuit',
      OutfitPaths: ['/Game/OutfitMods/X/CH_P_EVE_31_TypeB.CH_P_EVE_31_TypeB'] }
  ]));
  return m.gameNames[0] === 'Cute Pink Kitty Bodysuit' &&
    m.uniqueFitIds[0] === 'EVE_PinkBodysuit' && m.meshes[0] === 'CH_P_EVE_31_TypeB';
});
t('F2 cnsMetaFromText 容忍尾逗号 + OutfitNames 不当游戏内名', () => {
  const m = mc.cnsMetaFromText('[{"DisplayName":"皮衣","OutfitNames":["Outfit 01",],},]');
  return m.gameNames.length === 1 && m.gameNames[0] === '皮衣' &&
    m.gameNames.indexOf('Outfit 01') < 0;
});
t('F3 mergeCnsMeta 多文件去重且顺序稳定', () => {
  const m = mc.mergeCnsMeta([
    { gameNames: ['A', 'B'], uniqueFitIds: ['X'], meshes: ['M1'] },
    { gameNames: ['B', 'C'], uniqueFitIds: ['X', 'Y'], meshes: ['M1', 'M2'] }
  ]);
  return m.gameNames.join(',') === 'A,B,C' && m.uniqueFitIds.join(',') === 'X,Y' &&
    m.meshes.join(',') === 'M1,M2';
});
t('F4 modConflicts 导出三个新纯函数', () =>
  typeof mc.cnsMetaFromText === 'function' && typeof mc.mergeCnsMeta === 'function' &&
  typeof mc.scanCnsMeta === 'function');
t('F5 installFlow 装完解析 CNS 元数据写档案', () =>
  /function recordCnsMeta\(/.test(FLOW) && /recordCnsMeta\(meta && meta\.modId, r\.manifest, meta\)/.test(FLOW) &&
  /cnsMetaFromText/.test(FLOW));
t('F6 ipc 有 backfillGameNames 通道 + 保住本地 CNS 字段', () =>
  /handle\('mods:backfillGameNames'/.test(IPC) && /function backfillGameNames\(/.test(IPC) &&
  /merged\.gameNames = rec\.gameNames/.test(IPC));
t('F7 preload 暴露 backfillGameNames', () =>
  /backfillGameNames:\s*\(\)\s*=>\s*invoke\('mods:backfillGameNames'\)/.test(PRE));
t('F8 详情表在类型后加三行（游戏内名称 / UniqueFitID / 替换网格）', () => {
  const seg = APP.slice(APP.indexOf("row('type'"), APP.indexOf("row('version'", APP.indexOf("row('type'")));
  return /row\('gameNames',\s*'游戏内名称'/.test(seg) &&
    /row\('uniqueFitIds',\s*'UniqueFitID'/.test(seg) &&
    /row\('meshes',\s*'替换网格'/.test(seg);
});
t('F9 搜索匹配串并入游戏内名称 / UniqueFitID', () => {
  const seg = APP.slice(APP.indexOf('function libRecordMatches'), APP.indexOf('function libFilterRecords'));
  return /finfo\.gameNames/.test(seg) && /finfo\.uniqueFitIds/.test(seg) && /cnsBits/.test(seg);
});
t('F10 启动一次性回填游戏内名称', () =>
  /state\.gameNamesBackfilled/.test(APP) && /window\.api\.mods\.backfillGameNames\(\)/.test(APP));
t('F11 共享网格诊断已隐藏（扫描只渲染 strong）', () => {
  const seg = APP.slice(APP.indexOf('async function runConflictScan'), APP.indexOf('async function runConflictBatch'));
  return /\.filter\(g => g && g\.level === 'strong'\)/.test(seg) &&
    /没有发现 UniqueFitID 撞车/.test(seg);
});

console.log('\n===== 结果 =====');
console.log(`${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
