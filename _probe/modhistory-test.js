#!/usr/bin/env node
/*
 * Mod 生命周期事件档案自检（2026-11-24，用户 m15067 / m14998）。
 *
 * 用户要求：mod 下载/安装/开启/禁用/卸载都要留可查日志；开启时间为空的补当前时间；
 * 按开启/禁用时间正反排序；选时间段筛出「这段时间开启」的 mod 批量禁用来崩溃回退。
 *
 * 分四段：
 *   A. 主进程模块真跑 —— createModHistory 临时文件测 add/backfill/enabledBetween/events/forMod/clear；
 *   B. paths.js —— STATE_NAMES 含 mod-history.json、导出 modHistoryFile；
 *   C. 接线静态断言 —— ipc require/init/recordMod 调用点/history:* 通道、preload history 组；
 *   D. 渲染层 —— 加载档案、回填、详情历史段、时间段回退 UI、禁用时间排序维度、日志搜索。
 *
 * 跑法：node _probe/modhistory-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src/renderer/app.js');
const HTML = path.join(ROOT, 'src/renderer/index.html');
const IPC = path.join(ROOT, 'src/main/ipc.js');
const PRELOAD = path.join(ROOT, 'src/preload/index.js');
const PATHS = path.join(ROOT, 'src/main/paths.js');

const { createModHistory, MAX_EVENTS, ACTIONS } = require('../src/main/modHistory');
const paths = require('../src/main/paths');

const TMP = path.join(os.tmpdir(), 'sb-modhistory-test');
const FILE = path.join(TMP, 'mod-history.json');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  let r;
  try { r = fn(); } catch (e) { r = '抛异常：' + e.message; }
  if (r === true) pass++;
  else { fail++; fails.push(label + ' → ' + r); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)));
function reset() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(TMP, { recursive: true });
}

const app = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const ipc = fs.readFileSync(IPC, 'utf8').replace(/\r\n/g, '\n');
const preload = fs.readFileSync(PRELOAD, 'utf8').replace(/\r\n/g, '\n');
const pathsSrc = fs.readFileSync(PATHS, 'utf8').replace(/\r\n/g, '\n');

// ---------------- A. 主进程模块真跑 ----------------
reset();
let h = createModHistory(FILE);

t('A 新档案为空', () => (h.all().length === 0 && Object.keys(h.mods()).length === 0) || '非空');
eq(MAX_EVENTS, 5000, 'A MAX_EVENTS=5000');
t('A ACTIONS 六类齐全', () => ['download','install','enable','disable','uninstall','backfill'].every(a => ACTIONS.has(a)) || '缺动作');

// 非法输入
t('A add 拒绝未知动作', () => h.add('explode', { id: 'disk:paks:x' }) === null || '没拒绝');
t('A add 拒绝空 id', () => h.add('enable', {}) === null || '没拒绝');

// 一次正常的生命周期
h.add('download', { id: 'mod:1496', modId: 1496, name: 'CNS Suit', detail: '加入下载队列' });
h.add('install', { id: 'mod:1496', modId: 1496, name: 'CNS Suit', detail: '装到游戏目录' });
h.add('enable', { id: 'mod:1496', modId: 1496, name: 'CNS Suit' });
h.add('disable', { id: 'mod:1496', modId: 1496, name: 'CNS Suit' });
h.add('enable', { id: 'mod:1496', modId: 1496, name: 'CNS Suit' });

eq(h.all().length, 5, 'A 五条事件');
eq(h.all()[0].action, 'enable', 'A all() 新→旧');
eq(h.mod('mod:1496').enabled, true, 'A 当前状态=启用');
t('A enabledAt 是真实时间（非回填）', () => (h.mod('mod:1496').enabledAtGuess === false && !!h.mod('mod:1496').enabledAt) || '不对');
t('A disabledAt 有记', () => !!h.mod('mod:1496').disabledAt || '空');
t('A downloadedAt/installedAt 有记', () => (!!h.mod('mod:1496').downloadedAt && !!h.mod('mod:1496').installedAt) || '缺');

// forMod
eq(h.forMod('mod:1496').length, 5, 'A forMod 五条');
eq(h.forMod('nope').length, 0, 'A forMod 未知 id 空');

// events 过滤
t('A events 按 action 筛', () => h.events({ action: 'enable' }).length === 2 || '不是2');
t('A events 按 modId 筛', () => h.events({ modId: 1496 }).length === 5 || '不是5');
t('A events 按 keyword 筛', () => h.events({ keyword: '队列' }).length === 1 || '不是1');
t('A events keyword 大小写不敏感', () => h.events({ keyword: 'CNS' }).length === 5 || '不是5');
t('A events 按 limit 截断', () => h.events({ limit: 2 }).length === 2 || '不是2');

// 持久化（重新打开同一个文件）
h = createModHistory(FILE);
eq(h.all().length, 5, 'A 重新打开仍在');
eq(h.mod('mod:1496').name, 'CNS Suit', 'A 状态持久化');

// backfill：整批写一次，只补空的，已有真实时间的不动
const before = h.mod('mod:1496').enabledAt;
const n1 = h.backfill([
  { id: 'mod:1496', modId: 1496, name: 'CNS Suit', enabled: true },   // 已有真实时间 → 跳过
  { id: 'disk:paks:Addon_01', modId: 0, name: 'Addon', enabled: true },// 空 → 补
  { id: 'disk:paks:Off_02', modId: 0, name: 'Off', enabled: false },   // 关着 → 跳过
  { id: '', modId: 0, name: 'bad', enabled: true }                     // 空 id → 跳过
]);
eq(n1, 1, 'A backfill 只补 1 条');
eq(h.mod('mod:1496').enabledAt, before, 'A 已有真实时间不被回填覆盖');
t('A 回填标 enabledAtGuess=true', () => h.mod('disk:paks:Addon_01').enabledAtGuess === true || '没标');
t('A 回填事件记进流水', () => h.events({ action: 'backfill' }).length === 1 || '不是1');

// 幂等：再回填一次不重复
const n2 = h.backfill([{ id: 'disk:paks:Addon_01', modId: 0, name: 'Addon', enabled: true }]);
eq(n2, 0, 'A 回填幂等（第二次 0 条）');
t('A 回填不刷新成新时间', () => h.mod('disk:paks:Addon_01').enabledAt === h.events({ action: 'backfill' })[0].at || '时间变了');

// enabledBetween：区间内开启的（含回填），去重取最早一次
const T0 = '2020-01-01T00:00:00.000Z';
const T1 = '2099-01-01T00:00:00.000Z';
const between = h.enabledBetween(T0, T1);
t('A enabledBetween 含 enable + backfill', () => (between.length === 2 && between.some(x => x.id === 'mod:1496') && between.some(x => x.id === 'disk:paks:Addon_01')) || JSON.stringify(between));
t('A enabledBetween 区间外为空', () => h.enabledBetween('2019-01-01T00:00:00.000Z', '2019-12-31T00:00:00.000Z').length === 0 || '非空');

// uninstall 后状态
h.add('uninstall', { id: 'mod:1496', modId: 1496, name: 'CNS Suit', detail: '移到备份目录' });
eq(h.mod('mod:1496').enabled, false, 'A 卸载后 enabled=false');
t('A uninstalledAt 有记、记录仍在（删 Mod 不删数据）', () => (!!h.mod('mod:1496').uninstalledAt && !!h.forMod('mod:1496').length) || '丢了');

// clear
const cleared = h.clear();
eq(cleared, 7, 'A clear 返回事件数');
eq(h.all().length, 0, 'A clear 后为空');

// ---------------- B. paths.js 跟随游戏走 ----------------
t('B STATE_NAMES 含 mod-history.json', () => /'mod-history\.json'/.test(pathsSrc) || '没有');
t('B 导出 modHistoryFile', () => (typeof paths.modHistoryFile === 'string' && /mod-history\.json$/.test(paths.modHistoryFile)) || JSON.stringify(paths.modHistoryFile));

// ---------------- C. 主进程接线 ----------------
t('C ipc require createModHistory', () => /require\(['"]\.\/modHistory['"]\)/.test(ipc) || '没有');
t('C init 建档案', () => /modHistory\s*=\s*createModHistory\(paths\.modHistoryFile\)/.test(ipc) || '没有');
t('C stableModIdOf 四级来源', () => {
  const m = ipc.match(/function stableModIdOf\(mod\)\s*\{[\s\S]{0,700}?\n\}/);
  if (!m) return '没找到函数';
  const s = m[0];
  return (['mod.modId', 'meta.modId', 'source.modId', 'link.modId', 'tag.modId'].every(k => s.indexOf(k) >= 0)) || '来源不全: ' + s;
});
t('C recordMod 在 setEnabled 调用', () => /recordMod\(enabled\s*\?\s*'enable'\s*:\s*'disable'/.test(ipc) || '没有');
t('C recordMod 在 uninstall 调用', () => /recordMod\('uninstall'/.test(ipc) || '没有');
t('C 下载入队记 download', () => /modHistory\.add\('download'/.test(ipc) || '没有');
t('C 安装完成记 install + enable', () => (/modHistory\.add\('install'/.test(ipc) && /modHistory\.add\('enable'/.test(ipc)) || '没有');
['events','mod','forMod','mods','enabledBetween','backfill','clear'].forEach(ch =>
  t('C 通道 history:' + ch, () => new RegExp("handle\\('history:" + ch + "'").test(ipc) || '没有'));

t('C preload history 组七方法', () => {
  const m = preload.match(/history:\s*\{[\s\S]{0,700}?\n\s*\}/);
  if (!m) return '没找到';
  return ['events','mod','forMod','mods','enabledBetween','backfill','clear'].every(k => m[0].indexOf(k) >= 0) || '方法不全';
});

// ---------------- D. 渲染层 ----------------
t('D state 有 modHistory 两份', () => (/modHistory:\s*\{\}/.test(app) && /modHistoryByModId:\s*\{\}/.test(app)) || '没有');
t('D groupEnabledAt 读档案', () => {
  const m = app.match(/function groupEnabledAt\(items\)[\s\S]{0,900}?\n\}/);
  return (m && m[0].indexOf('state.modHistory') >= 0) || '没读档案';
});
t('D loadModHistory + backfillModHistory', () => (/async function loadModHistory\(/.test(app) && /async function backfillModHistory\(/.test(app)) || '没有');
t('D backfill 返回条数供重画', () => /return n;/.test(app) && /const refilled = await backfillModHistory\(\)/.test(app) || '没接重画');
t('D refreshAll 画卡片前加载档案', () => {
  const m = app.match(/await refreshLibrary\(\)[\s\S]{0,300}?await loadModHistory\(\)/);
  return !!m || '顺序不对';
});
t('D 详情抽屉有状态变更记录段', () => (/状态变更记录/.test(app) && /id="drawerHistory"/.test(app)) || '没有');
t('D fillDrawerHistory 走 history.forModId（按 modId 聚合）', () => /window\.api\.history\.forModId\(/.test(app) || '没有');
t('D 禁用时间排序维度 off', () => {
  const m = app.match(/const LIB_SORTS\s*=\s*\[[\s\S]{0,900}?\n\]/);
  return (m && m[0].indexOf("value: 'off'") >= 0) || '没有 off';
});
t('D applyLibSort 处理 off', () => /by === 'off'\s*\?/.test(app) || '没有');
t('D SORT_BY_KEYS 含 off', () => {
  const m = app.match(/const SORT_BY_KEYS\s*=\s*\[[^\]]*\]/);
  return (m && /'off'/.test(m[0])) || '没有';
});
t('D 存档白名单 BY 含 off', () => {
  const m = app.match(/const BY\s*=\s*\[[^\]]*\]/);
  return (m && /'off'/.test(m[0])) || '没有';
});
t('D 时间段回退三函数', () => (/async function runRollbackQuery\(/.test(app) && /async function runRollbackDisable\(/.test(app) && /function resolveLiveIds\(/.test(app)) || '缺函数');
t('D 回退只禁用、不重装', () => /setEnabledMany\(ids,\s*false\)/.test(app) || '没调禁用');
t('D 回退解析当前磁盘 id', () => /for \(const m of \(state\.installed \|\| \[\]\)\)/.test(app) || '没扫原始清单');
t('D 设置页三个回退按钮接线', () => (/btnRollQuery/.test(app) && /btnRollDisableSel/.test(app) && /btnRollDisableAll/.test(app)) || '没接线');
t('D 日志查看器关键字搜索', () => (/id="logSearch"/.test(app) && /id="logSearchCount"/.test(app)) || '没有');

t('D index.html libSortTabs 有禁用时间', () => {
  const m = html.match(/id="libSortTabs"[\s\S]{0,500}?<\/div>/);
  return (m && /data-libsort="off"/.test(m[0])) || '没有';
});
t('D 设置页两个时间输入（在 renderSettings 模板里）', () => (/id="rollSince"/.test(app.replace(/\\"/g, '"')) && /id="rollUntil"/.test(app.replace(/\\"/g, '"'))) || '没有');

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fails.length) { console.log(fails.join('\n')); process.exitCode = 1; }
