'use strict';
/**
 * 「已安装 Mod」页：同 modId 合并成一张卡 + 排序（默认按安装时间倒序）。
 *
 * 用户诉求（2026-10-14）：
 *   「已安装的模组里面不再显示需要确认的列表，都统一在下载页面处理；
 *     已安装的 mod 支持排序，默认按照安装时间倒叙，最新的在最上面；
 *     支持组合排序，优先按时间，其次按摩的的，mod 名称；
 *     多个同 mod id 的不同模组文件合并显示，与浏览 mod 里面一致，
 *     点击单个 mod，可以看到不同模组文件」
 * 追问后敲定的口径：「**抽屉里逐文件可操作**」。
 *
 * 三块断言：
 *   · `groupInstalled()`  —— 合并粒度（有 modId 的合并、没 modId 的各一张卡）；
 *   · `compareInstalled()` —— 四种排序 + 每模式都带**兜底键**（全序、可复现）；
 *   · `installedFilesHtml()` / 组级开关 —— 抽屉里逐文件启用 / 禁用 / 卸载。
 *
 * 纯 Node：渲染层函数从 `app.js` 源码里**原样抽出**在 vm 里跑真身。
 *
 * 运行：`npm run test:installed-merge`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const CSS = path.join(__dirname, '..', 'src', 'renderer', 'style.css');

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

// ⚠️ 工作区 app.js 是 CRLF，必须归一成 LF（见 blacklist-test.js 的说明）。
const code = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');

// ---- 从源码里抽真身：KIND_RANK / groupMtime / compareInstalled / groupInstalled ----
function pick(re, what) {
  const m = code.match(re);
  if (!m) throw new Error('抽不到 ' + what + ' 的源码，正则要跟着改');
  return m[0];
}
const SRC_KIND = pick(/const KIND_RANK = \{[^}]*\};/, 'KIND_RANK');
// 排序方向相关（0.2.8 新增）：compareInstalled 的第四个参数靠这两个符号判默认方向
const SRC_SORTS = pick(/const INSTALLED_SORTS = \[[\s\S]*?\n\];/, 'INSTALLED_SORTS');
const SRC_DIRS = pick(/const SORT_DIRS = \[[^\]]*\];/, 'SORT_DIRS');
const SRC_DEFDIR = pick(/function sortDefaultDir\([\s\S]*?\n}/, 'sortDefaultDir');
const SRC_MTIME = pick(/function groupMtime\([\s\S]*?\n}/, 'groupMtime');
const SRC_CMP = pick(/function compareInstalled\([\s\S]*?\n}/, 'compareInstalled');
const SRC_GROUP = pick(/function groupInstalled\([\s\S]*?\n}/, 'groupInstalled');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  [SRC_KIND, SRC_SORTS, SRC_DIRS, SRC_DEFDIR, SRC_MTIME, SRC_CMP, SRC_GROUP].join('\n') +
  '\nthis.K = { KIND_RANK, INSTALLED_SORTS, SORT_DIRS, sortDefaultDir, groupMtime, compareInstalled, groupInstalled };',
  ctx);
const { groupMtime, compareInstalled, groupInstalled, INSTALLED_SORTS, sortDefaultDir } = ctx.K;

/** 造一条已安装项（只带被测逻辑关心的字段） */
const item = (o = {}) => Object.assign(
  { id: 'x', name: 'X', kind: 'pak', enabled: true, size: 0, fileCount: 0, files: [], meta: {}, mtime: '' },
  o);
/** 造一个已安装组（compareInstalled 只读 items/mtime/modId/name/kind） */
const grp = (modId, name, mtime, kind = 'pak', key = null) =>
  ({ key: key || ('mod:' + modId), modId, name, kind, items: [{ mtime }] });

// ================================================================ 1. 合并粒度

console.log('\n[1] groupInstalled：同 modId 合并成一张卡');
{
  const list = [
    // 第一条故意**没有** meta.name / meta.source（模拟只有 modId、没拿到元数据的项）：
    //   · `meta.modId` 足够把它并进 101 组（知道是哪个 Mod）；
    //   · 但它不算「带来源信息」，所以卡片名会跳过它、取后面那条 Nexus 正式名。
    item({ id: 'a0', name: 'a-mod-from-disk', kind: 'pak', enabled: false, size: 10, fileCount: 1, files: ['f0'], meta: { modId: 101 }, mtime: '' }),
    item({ id: 'a1', name: 'Nexus A', kind: 'pak', enabled: true, size: 100, fileCount: 2, files: ['f1', 'f2'], meta: { name: 'Nexus A (正式名)', source: { modId: 101 } }, mtime: '2026-10-14T00:00:00Z' }),
    item({ id: 'a2', name: 'Mod A (Optional)', kind: 'pak', enabled: false, size: 50, fileCount: 1, files: ['f3'], meta: { source: { modId: 101 } }, mtime: '2026-10-01T00:00:00Z' }),
    item({ id: 'b1', name: 'Mod B', kind: 'script', enabled: true, size: 10, fileCount: 1, files: ['f4'], meta: { source: { modId: 202 } }, mtime: '2026-10-10T00:00:00Z' }),
    item({ id: 'c1', name: 'Mod C part 1', kind: 'pak', enabled: false, size: 3, fileCount: 1, meta: { source: { modId: 303 } }, mtime: '2026-10-05T00:00:00Z' }),
    item({ id: 'c2', name: 'Mod C part 2', kind: 'pak', enabled: false, size: 4, fileCount: 1, meta: { source: { modId: 303 } }, mtime: '2026-10-02T00:00:00Z' }),
    item({ id: 'm1', name: 'Manual One', size: 5, fileCount: 1, meta: {} }),
    item({ id: 'm2', name: 'Manual Two', size: 7, fileCount: 1, meta: {} })
  ];
  const gs = groupInstalled(list);
  eq(gs.length, 5, '3 个 Nexus Mod + 2 个无来源的手动包 → 5 张卡（不是 8 张）');

  const g101 = gs.find(g => g.modId === 101);
  eq(!!g101, true, '能找到 modId=101 的组');
  eq(g101.key, 'mod:101', '组键是 mod:<modId>');
  eq(g101.items.length, 3, '同一个 modId 的三个文件合成一组');
  eq(g101.name, 'Nexus A', '卡片名取**带来源信息**的那条（不是磁盘上的目录名）');
  eq(g101.enabled, true, '组内有一个启用的 → 整组算「已启用」');
  eq(g101.partial, true, '只启用了 3 个里的 1 个 → partial = 部分启用');
  eq(g101.size, 160, 'size 是组内求和（10 + 100 + 50）');
  eq(g101.fileCount, 4, 'fileCount 是组内求和（1 + 2 + 1）');
  eq(g101.files.length, 4, 'files 是组内合并（4 个文件）');
  eq(g101.id, 'a0', 'id 兜底取第一条（reveal 之类需要一个具体 id）');
  eq(g101.mtime, '2026-10-14T00:00:00Z', '组的 mtime 取组内最「新」的那条（空 mtime 不算）');
  eq(g101.meta && g101.meta.name, 'Nexus A (正式名)', 'meta 取 head 那条的 meta（卡片副标题用的是它）');

  const g202 = gs.find(g => g.modId === 202);
  eq(g202.items.length, 1, '只有一条的 modId 也是一组');
  eq(g202.partial, false, '全启用 → 不是 partial');
  eq(g202.enabled, true, '全启用 → enabled');

  const g303 = gs.find(g => g.modId === 303);
  eq(g303.items.length, 2, '303 也是两条一组');
  eq(g303.enabled, false, '全禁用 → enabled = false');
  eq(g303.partial, false, '全禁用不算 partial（partial 是「有的开有的关」）');

  const manuals = gs.filter(g => !g.modId);
  eq(manuals.length, 2, '没有 modId 的各自成组（没有任何依据能证明它们是同一个东西）');
  eq(manuals.every(g => g.key.startsWith('one:')), true, '无 modId 的组键是 one:<id>');
  eq(manuals.map(g => g.items.length).join(','), '1,1', '无 modId 的组里只有它自己');

  // 组对象要与单个 installed 项**同形**（installedCard / openInstalledDrawer 才不用大改）
  const shape = ['key', 'modId', 'items', 'id', 'name', 'kind', 'enabled', 'size', 'fileCount', 'files', 'mtime', 'meta'];
  t('组对象带有卡片渲染要用的全部字段', () => shape.every(k => k in g101) || '缺字段：' + shape.filter(k => !(k in g101)));

  // meta.modId（没有 source.modId 时的兜底）
  const g404 = groupInstalled([item({ id: 'd1', meta: { modId: 404 } })])[0];
  eq(g404.modId, 404, 'meta.modId 也能作为合并依据（不像 source.modId 那么优先）');
  eq(g404.key, 'mod:404', '合并键同样是 mod:404');

  // builtin 聚合
  const gb = groupInstalled([
    item({ id: 'e1', builtin: true, meta: { source: { modId: 505 } } }),
    item({ id: 'e2', meta: { source: { modId: 505 } } })
  ])[0];
  eq(gb.builtin, true, '组内任一条是内置 → 整组算内置（会被「显示内置脚本」过滤掉）');

  // 空输入
  eq(groupInstalled([]).length, 0, '空列表 → 空组');
  eq(groupInstalled(null).length, 0, 'null → 空组（不抛）');
  eq(groupInstalled(undefined).length, 0, 'undefined → 空组（不抛）');
}

console.log('\n[2] groupMtime：取组内最「新」的安装时间');
{
  eq(groupMtime([{ mtime: '2026-10-01T00:00:00Z' }, { mtime: '2026-10-14T00:00:00Z' }]),
    '2026-10-14T00:00:00Z', '取最大值（最近装的那个文件代表这个 Mod）');
  eq(groupMtime([{ mtime: '' }, { mtime: '2026-10-14T00:00:00Z' }]),
    '2026-10-14T00:00:00Z', '空的 mtime 不算数');
  eq(groupMtime([]), '', '空数组 → 空串');
  eq(groupMtime([{}]), '', '没有 mtime 字段 → 空串');
}

// ================================================================ 2. 排序

console.log('\n[3] compareInstalled：默认时间倒序 + 每模式带兜底键');
{
  const cmp = compareInstalled;
  const T = '2026-10-10T00:00:00Z';

  // ---- time（默认）：安装时间倒序 ----
  const old1 = grp(1, 'A', '2026-10-01T00:00:00Z');
  const new2 = grp(2, 'B', '2026-10-14T00:00:00Z');
  t('time：旧的在后面（时间倒序 —— 最新装的排最上面）', () => cmp(old1, new2, 'time') > 0 || '顺序错了');
  t('time：新的在前面', () => cmp(new2, old1, 'time') < 0 || '顺序错了');

  // 兜底键 1：时间相同 → Mod ID 升序
  t('time 兜底：时间相同 → 按 Mod ID 升序', () => cmp(grp(1, 'Z', T), grp(2, 'A', T), 'time') < 0 || '兜底键没生效');

  // 兜底键 2：Mod ID 也相同 → 名称升序
  t('time 兜底：Mod ID 相同 → 按名称升序', () => cmp(grp(7, 'A', T), grp(7, 'B', T), 'time') < 0 || '兜底键没生效');

  // 没有 modId（0）的排最后
  t('没有 modId 的（手动丢进 ~Mods 的）排在 Nexus 来源的后面',
    () => cmp(grp(0, 'AAA', T), grp(5, 'ZZZ', T), 'time') > 0 || '手动包跑到前面去了');

  // ---- name ----
  t('name：按名称升序', () => cmp(grp(1, 'B', T), grp(2, 'A', T), 'name') > 0 || '顺序错了');
  t('name 兜底：同名 → 按 Mod ID 升序', () => cmp(grp(9, 'Same', T), grp(3, 'Same', T), 'name') > 0 || '兜底键没生效');

  // ---- modid ----
  t('modid：按 Mod ID 升序', () => cmp(grp(9, 'A', T), grp(3, 'Z', T), 'modid') > 0 || '顺序错了');
  t('modid 兜底：Mod ID 相同 → 按名称升序', () => cmp(grp(4, 'A', T), grp(4, 'B', T), 'modid') < 0 || '兜底键没生效');

  // ---- kind ----
  t('kind：前置组件排最前', () => cmp(grp(1, 'A', T, 'prereq'), grp(2, 'B', T, 'pak'), 'kind') < 0 || '顺序错了');
  t('kind：脚本排在 pak 后面', () => cmp(grp(1, 'A', T, 'script'), grp(2, 'B', T, 'pak'), 'kind') > 0 || '顺序错了');
  t('kind：逻辑模组与 pak 同级（都算「实体模组」）',
    () => cmp(grp(1, 'A', T, 'logicmod'), grp(2, 'B', T, 'pak'), 'kind') < 0 || '逻辑模组本该与 pak 同级，再按名称比');
  t('kind：未知类型排最后', () => cmp(grp(1, 'A', T, 'weird'), grp(2, 'B', T, 'script'), 'kind') > 0 || '未知类型没有排最后');
  t('kind 兜底：同类型 → 先名称后 Mod ID',
    () => cmp(grp(2, 'B', T, 'pak'), grp(1, 'A', T, 'pak'), 'kind') > 0 || '兜底键没生效');

  // ---- 全序：所有键都相同 → 0，sort 才会稳定 ----
  eq(cmp(grp(7, 'A', T, 'pak'), grp(7, 'A', T, 'pak'), 'time'), 0, '全部键相同 → 返回 0（交给 sort 保持稳定）');

  // ---- 可复现：同一输入两次排序结果一致 ----
  const pool = [
    grp(3, 'C', '2026-10-03T00:00:00Z'), grp(1, 'A', '2026-10-01T00:00:00Z'),
    grp(2, 'B', '2026-10-02T00:00:00Z'), grp(4, 'D', '2026-10-04T00:00:00Z')
  ];
  const run = (mode) => pool.slice().sort((a, b) => cmp(a, b, mode)).map(g => g.key).join(',');
  eq(run('time') === run('time'), true, '同样输入两次排序结果完全一致（可复现）');

  // ---- 0.2.8：正序 / 倒序 ----
  // 用户 2026-10-14：「已安装的 mod 排序要支持正序，倒叙」。
  // 方向**只作用于主键**；不传 dir = 用该模式的默认方向（故上面那批老断言一字未改仍全绿）。
  t('★ 不传 dir = 该模式的默认方向（time 默认倒序）',
    () => cmp(old1, new2, 'time') === cmp(old1, new2, 'time', 'desc') || '默认方向不是 desc');
  t('★ time：显式 asc = 旧的在前（与默认倒序相反）',
    () => cmp(old1, new2, 'time', 'asc') < 0 || '正序没生效');
  t('time：asc / desc 两个方向互为反号（主键）',
    () => cmp(old1, new2, 'time', 'asc') === -cmp(old1, new2, 'time', 'desc') || '两个方向不成对');
  t('name：asc 升序、desc 降序',
    () => cmp(grp(1, 'B', T), grp(2, 'A', T), 'name', 'asc') > 0
      && cmp(grp(1, 'B', T), grp(2, 'A', T), 'name', 'desc') < 0 || '顺序错了');
  t('modid：asc 升序、desc 降序',
    () => cmp(grp(9, 'A', T), grp(3, 'Z', T), 'modid', 'asc') > 0
      && cmp(grp(9, 'A', T), grp(3, 'Z', T), 'modid', 'desc') < 0 || '顺序错了');
  t('kind：asc 前置在前、desc 前置在后',
    () => cmp(grp(1, 'A', T, 'prereq'), grp(2, 'B', T, 'pak'), 'kind', 'asc') < 0
      && cmp(grp(1, 'A', T, 'prereq'), grp(2, 'B', T, 'pak'), 'kind', 'desc') > 0 || '顺序错了');

  // ⚠️ 次键（Mod ID / 名称）不跟着方向翻转：时间相同 → 一律 Mod ID 升序
  t('★ 次键不翻转：时间相同 → 两个方向下都是 Mod ID 升序',
    () => cmp(grp(1, 'Z', T), grp(2, 'A', T), 'time', 'asc') < 0
      && cmp(grp(1, 'Z', T), grp(2, 'A', T), 'time', 'desc') < 0 || '次键跟着翻转了');
  // ⚠️ 「没有 modId 恒排最后」是「来源不明」的约定，不是大小关系 → 两个方向都在最后
  t('★ 未知 kind 在两个方向下都排最后',
    () => cmp(grp(1, 'A', T, 'weird'), grp(2, 'B', T, 'script'), 'kind', 'asc') > 0
      && cmp(grp(1, 'A', T, 'weird'), grp(2, 'B', T, 'script'), 'kind', 'desc') > 0 || '未知类型方向一翻就跑前面去了');
  t('非法 dir（乱塞字符串）退回该模式默认方向',
    () => cmp(old1, new2, 'time', 'sideways') === cmp(old1, new2, 'time', 'desc') || '没有兜底');

  // ---- sortDefaultDir：每模式的默认方向 ----
  eq(sortDefaultDir('time'), 'desc', 'sortDefaultDir(time) = desc（最新装的最上面）');
  eq(sortDefaultDir('name'), 'asc', 'sortDefaultDir(name) = asc');
  eq(sortDefaultDir('modid'), 'asc', 'sortDefaultDir(modid) = asc');
  eq(sortDefaultDir('kind'), 'asc', 'sortDefaultDir(kind) = asc');
  eq(sortDefaultDir('不存在'), 'asc', '未知 mode 一律 asc（不抛异常）');
  eq(INSTALLED_SORTS.every(s => s.defDir === 'asc' || s.defDir === 'desc'), true,
    '每种排序都显式声明了 defDir（不靠隐式兜底）');
  eq(INSTALLED_SORTS.filter(s => s.defDir === 'desc').map(s => s.value).join(','), 'time',
    '只有「安装时间」默认倒序，其余默认正序');
}

// ================================================================ 3. 端到端

console.log('\n[4] 端到端：乱序磁盘条目 → 分组 → 排序');
{
  const list = [
    item({ id: 'm2', name: 'Manual Two', size: 7, meta: {}, mtime: '2026-10-07T00:00:00Z' }),
    item({ id: 'c2', name: 'Mod C part 2', meta: { source: { modId: 303 } }, mtime: '2026-10-02T00:00:00Z' }),
    item({ id: 'a1', name: 'Mod A (Main)', meta: { name: 'Nexus A', source: { modId: 101 } }, mtime: '2026-10-01T00:00:00Z' }),
    item({ id: 'b1', name: 'Mod B', meta: { source: { modId: 202 } }, mtime: '2026-10-10T00:00:00Z' }),
    item({ id: 'm1', name: 'Manual One', size: 5, meta: {}, mtime: '2026-10-12T00:00:00Z' }),
    item({ id: 'c1', name: 'Mod C part 1', meta: { source: { modId: 303 } }, mtime: '2026-10-05T00:00:00Z' }),
    item({ id: 'a2', name: 'Mod A (Optional)', meta: { source: { modId: 101 } }, mtime: '2026-10-14T00:00:00Z' })
  ];
  const sorted = groupInstalled(list)
    .slice()
    .sort((a, b) => compareInstalled(a, b, 'time'));

  eq(sorted.map(g => g.key).join(','),
    'mod:101,one:m1,mod:202,one:m2,mod:303',
    '默认视图：101 组(10-14) → m1(10-12) → 202(10-10) → m2(10-07) → 303 组(10-05)');
  eq(sorted.length, 5, '7 条磁盘条目 → 5 张卡');

  // 时间完全相同的时候，没有 modId 的排最后（`modId || Infinity` 兜底）——
  // 别跟 Nexus 来源的混排，否则手动包会插在中间、位置随扫描顺序乱跳。
  const tie = groupInstalled([
    item({ id: 'n1', meta: { source: { modId: 9 } }, mtime: '2026-10-10T00:00:00Z' }),
    item({ id: 'u1', name: 'Manual', meta: {}, mtime: '2026-10-10T00:00:00Z' })
  ]).sort((a, b) => compareInstalled(a, b, 'time'));
  eq(tie.map(g => g.key).join(','), 'mod:9,one:u1', '时间相同时：有 modId 的在前，手动的在后');

  const byName = groupInstalled(list).slice().sort((a, b) => compareInstalled(a, b, 'name'));
  eq(byName[0].name, 'Manual One', '「名称」模式首张是名字最小的（Manual One）');
}

// ================================================================ 4. 接线

console.log('\n[5] 渲染层接线（源码级断言）');
{
  const css = fs.readFileSync(CSS, 'utf8');

  // ---- 已安装页不再列「待确认」（统一到下载页） ----
  t('liveStrip 只取 DL_BUSY（不再列「待确认 / 安装失败但包还在」）',
    () => /function liveStrip\(\)[\s\S]{0,400}DL_BUSY\.has\(t\.status\)/.test(code) || '缺失');
  t('liveStrip 的注释写明「等用户操作的统一到下载页」',
    () => /待确认 \/ 安装失败但包还在[\s\S]{0,120}不再列在已安装页/.test(code) || '缺失');
  t('原因解释逻辑搬到了下载页（taskWhy 仍然存在）',
    () => /function taskWhy\(t\)/.test(code) || '缺失');

  // ---- 排序栏 ----
  t('INSTALLED_SORTS 有 time / name / modid / kind 四种',
    () => /const INSTALLED_SORTS = \[[\s\S]{0,600}'time'[\s\S]{0,300}'name'[\s\S]{0,300}'modid'[\s\S]{0,300}'kind'/.test(code) || '缺失');
  t('默认排序是 time（安装时间倒序）', () => /installedSort: 'time',/.test(code) || '缺失');
  t('排序栏是 data-isort 按钮组', () => /data-isort="\$\{esc\(s\.value\)\}"/.test(code) || '缺失');
  t('点排序按钮会改 state 并重渲染（0.2.8：换排序时方向回到该模式默认值）', () =>
    /state\.installedSort = v;[\s\S]{0,60}state\.installedSortDir = sortDefaultDir\(v\);[\s\S]{0,80}renderInstalled\(\);[\s\S]{0,40}saveFilters\(\);/.test(code) || '缺失');
  t('渲染走「分组 → 排序 → 画卡」三步（排序带上方向）', () =>
    /state\.installedGroups = groupInstalled\(visible\);[\s\S]{0,300}\.sort\(\(a, b\) => compareInstalled\(a, b, state\.installedSort, state\.installedSortDir\)\)/.test(code) || '缺失');
  t('侧栏计数也用分组后的数量（= Mod 数，不是磁盘条目数）',
    () => /function syncInstalledNav\(\)[\s\S]{0,300}groupInstalled\(state\.installed\)[\s\S]{0,120}gs\.length/.test(code) || '缺失');

  // ---- 排序方向 UI（0.2.8） ----
  t('state 默认方向是 desc（安装时间倒序）', () => /installedSortDir: 'desc',/.test(code) || '缺失');
  t('排序条包在 .sortgrp 里（右侧方向按钮才不会被 .ibar > .btn 的 margin-left:auto 推到最右）',
    () => /const sortBar = `<div class="sortgrp">/.test(code) || '缺失');
  t('选中的排序名后面跟一枚方向箭头，且箭头在**独立元素**里（i18n 按文本节点整串查表）',
    () => /<span class="dir">\$\{arrow\}<\/span>/.test(code) || '缺失');
  t('有独立的方向按钮 data-isortdir', () => /data-isortdir="1"/.test(code) || '缺失');
  t('再点一次当前排序名 = 翻转方向', () =>
    /if \(v === state\.installedSort\) \{\s*\n\s*toggleInstalledSortDir\(\);/.test(code) || '缺失');
  t('toggleInstalledSortDir 翻转 + 重画 + 落盘', () =>
    /function toggleInstalledSortDir\(\)[\s\S]{0,200}renderInstalled\(\);[\s\S]{0,40}saveFilters\(\);/.test(code) || '缺失');
  t('CSS 有 .sortgrp（排序名 + 方向按钮一行）', () => /\.sortgrp\{/.test(css) || '缺失');
  t('CSS 里 .ibar > .btn 是**子选择器**（方向按钮不会被误推到最右）',
    () => /\.ibar > \.btn\{/.test(css) || '缺失');

  // ---- 卡片 ----
  t('卡片带 data-gid（点击打开的是「这个 Mod」而不是某个文件）',
    () => /data-gid="\$\{esc\(g\.key\)\}"/.test(code) || '缺失');
  t('组开关带 data-gtoggle', () => /data-gtoggle="\$\{esc\(g\.key\)\}"/.test(code) || '缺失');
  t('前置组件没有开关（不给单独禁用）',
    () => /g\.kind === 'prereq' \? '' : `<button class="sw/.test(code) || '缺失');
  t('多文件时显示「N 个已装文件」角标', () => /个已装文件<\/span>/.test(code) || '缺失');
  t('CSS 有 .cover .sw.part（部分启用的开关）', () => /\.cover \.sw\.part\{/.test(css) || '缺失');
  t('CSS 有 .cover .tag.nfile（角标挪到左下角避让投票按钮）', () => /\.cover \.tag\.nfile\{/.test(css) || '缺失');

  // ---- 抽屉：逐文件 ----
  t('installedFilesHtml 逐条渲染已安装的文件', () => /function installedFilesHtml\(g\)/.test(code) || '缺失');
  t('每个文件行带 data-iid（单条 installed 项 id）', () => /data-iid="\$\{esc\(it\.id\)\}"/.test(code) || '缺失');
  t('每个文件行有 toggle / uninstall 两个动作',
    () => /data-iact="toggle"/.test(code) && /data-iact="uninstall"/.test(code) || '缺失');
  t('前置组件不给单独禁用/卸载（只留一行说明）',
    () => /前置组件，不可单独禁用或卸载/.test(code) || '缺失');
  t('CSS 有 .flist / .fli（逐文件列表）', () => /\.flist\{/.test(css) && /\.fli\{/.test(css) || '缺失');
  t('CSS 有 .fli.off（已禁用的文件）', () => /\.fli\.off\{/.test(css) || '缺失');
  t('CSS 有 .fli-note（前置组件那行说明）', () => /\.fli-note\{/.test(css) || '缺失');

  // ---- 组级操作 ----
  t('抽屉底部有组级开关 data-gtoggle', () =>
    /data-gtoggle="\$\{esc\(g\.key\)\}" title="\$\{multi/.test(code) || '缺失');
  t('抽屉底部有组级卸载 data-guninstall', () => /data-guninstall="\$\{esc\(g\.key\)\}"/.test(code) || '缺失');
  t('doToggleGroup 是**三态**（partial 也要能「全部启用」）',
    () => /function doToggleGroup\(key\)[\s\S]{0,400}const target = g\.partial \|\| !g\.enabled;/.test(code) || '缺失');
  t('doUninstallGroup 逐条卸载（失败不中断）',
    () => /async function doUninstallGroup\(key\)[\s\S]{0,1200}mods\.uninstall/.test(code) || '缺失');
  t('reopenInstalledDrawer 会在卸载后重建抽屉', () => /function reopenInstalledDrawer\(key\)/.test(code) || '缺失');
  t('最后一个文件卸掉就关抽屉', () => /reopenInstalledDrawer\(key\)[\s\S]{0,600}closeDrawer\(\)/.test(code) || '缺失');

  // ---- 逐文件操作用的是单条 id（不需要改主进程） ----
  t('逐文件操作复用 mods:setEnabled（按单条 id 定位）', () =>
    /window\.api\.mods\.setEnabled\(iid, !it\.enabled\)/.test(code) || '缺失');
  t('doUninstall 支持 keepDrawer（逐文件卸载时不关抽屉）',
    () => /function doUninstall\(id, \{ keepDrawer = false \} = \{\}\)/.test(code) || '缺失');
  t('data-iid 的点击处理排在 .card 之前（否则会误开抽屉）', () => {
    const iIid = code.indexOf("t.closest('[data-iid]')");
    const iGun = code.indexOf("t.closest('[data-guninstall]')");
    return (iIid > 0 && iGun > 0 && iGun < iIid) || `iid@${iIid} guninstall@${iGun}`;
  });

  // ---- 状态类 ----
  t('CSS 有 .dl-st.dim（已禁用比「等待」更淡）', () => /\.dl-st\.dim\{/.test(css) || '缺失');
  t('CSS 有 .ibar（排序栏 + 右侧按钮一行）', () => /\.ibar\{/.test(css) || '缺失');
}

// ================================================================ 6. 文件行显示**实际磁盘文件名**

console.log('\n[6] 抽屉文件行：显示磁盘实际文件名（不是被 Nexus 名覆盖的显示名）');

// 用户 2026-10-14 截图：同一个 Mod 装了两次，抽屉里两行都叫
// 「Captain EVE (CNS compatible)」、都是 v1.01、都写「文件 10808」—— 只有磁盘文件名不同。
// 根因：`scanner.js` 里 pak 组 `name: reg && reg.name ? reg.name : g.name`，
// 注册表在就把 Nexus 名盖在了文件名上（见 src/main/scanner.js:65）。
{
  const SRC_AUX = pick(/const FILE_AUX_EXT = [^\n]*;/, 'FILE_AUX_EXT');
  const SRC_NAMEFN = pick(/function installedFileName\([\s\S]*?\n}/, 'installedFileName');
  const c6 = {};
  vm.createContext(c6);
  vm.runInContext(SRC_AUX + '\n' + SRC_NAMEFN + '\nthis.fn = installedFileName;', c6);
  const fn = c6.fn;

  // ---- 用户截图现场 ----
  const two = [
    item({ id: 'k1', name: 'Captain EVE (CNS compatible)', kind: 'pak', enabled: true,
           files: [{ name: 'Captain EVE (CNS compatible).pak', size: 125_400_000 }] }),
    item({ id: 'k2', name: 'Captain EVE (CNS compatible)', kind: 'pak', enabled: true,
           files: [{ name: 'Captain EVE (CNS compatible) CNS.pak', size: 126_400_000 }] })
  ];
  eq(fn(two[0]), 'Captain EVE (CNS compatible).pak', 'pak 组取 .pak 的实际文件名');
  t('★ 同一个 Nexus 名下的两个文件，渲染出来的名字**不再相同**（用户诉求本体）',
    () => (fn(two[0]) !== fn(two[1])) || `两条仍相同：${fn(two[0])}`);

  // ---- 挑主文件：.pak 优先于 .ucas / .utoc ----
  eq(fn(item({ files: [{ name: 'A.ucas' }, { name: 'A.pak' }, { name: 'A.utoc' }] })),
     'A.pak', '.pak 排在后面也能被挑出来（不看目录里的排列顺序）');
  eq(fn(item({ files: [{ name: 'A.utoc' }, { name: 'A.ucas' }] })),
     'A.utoc', '只有附属文件时退回第一个（不返回空）');

  // ---- 禁用状态：磁盘上真的叫 `X.pak.disabled` ----
  eq(fn(item({ files: [{ name: 'A.pak.disabled' }] })), 'A.pak',
     '剥掉 .disabled 再判扩展名（且不把 .ucas.disabled 当主文件）');
  eq(fn(item({ files: [{ name: 'A.ucas.disabled' }, { name: 'A.pak.disabled' }] })), 'A.pak',
     '全是 .disabled 时仍挑出 .pak');

  // ---- 其它 kind ----
  eq(fn(item({ kind: 'prereq', name: 'UE4SS', files: [{ name: 'dwmapi.dll' }, { name: 'ue4ss/' }] })),
     'UE4SS', '前置组件保留可读名（files 里是零件名，显示 dwmapi.dll 没意义）');
  eq(fn(item({ kind: 'script', name: 'Nexus 上的名字', files: [{ name: 'BPModLoader/', dir: true }] })),
     'BPModLoader', 'script mod 用目录名，且去掉结尾斜杠');
  eq(fn(item({ kind: 'cns', name: 'CNS', files: [{ name: 'DekCNS_P.pak' }] })),
     'DekCNS_P.pak', '注册表 / CNS 组用 manifest 里的相对文件名');

  // ---- 兜底 ----
  eq(fn(item({ name: 'X', files: [] })), 'X', '没有 files 时回退到 name（不返回空串）');
  eq(fn(null), '', 'null 不抛异常');

  // ---- 接线：installedFilesHtml 必须用这个函数 ----
  t('installedFilesHtml 用 installedFileName(it) 取显示名',
    () => /const shown = installedFileName\(it\);/.test(code) || '缺失');
  t('fli-name 里显示的是 shown，不是 it.name',
    () => /<div class="fli-name" data-i18n-skip title="\$\{esc\(shown\)\}">\$\{esc\(shown\)\}/.test(code)
      || '仍在使用 it.name');
  t('文件行仍带 data-i18n-skip（文件名是运行时数据，不该进词表）',
    () => /class="fli-name" data-i18n-skip/.test(code) || '缺失');
}

// ================================================================

console.log('');
if (fail) {
  console.log('❌ installed-merge: ' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('\n失败项：');
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('✅ installed-merge: ' + pass + ' 通过 / 0 失败');
