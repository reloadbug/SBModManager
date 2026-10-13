'use strict';
/**
 * 「会被覆盖的文件」明细（`src/main/installFlow.js` 的 `explainConflicts`）
 * + 渲染层接线（`app.js` / `style.css` 的源码级断言）。
 *
 * 纯 Node：只用临时目录里的真文件 + 假 registry，**不碰真实游戏目录、不碰用户 data/**。
 *
 * 背景（2026-10-13 用户报）：安装确认框只说「目标位置已有 2 个同名文件，继续安装会覆盖它们」，
 * 用户要求 ——
 *   ① 把被覆盖的文件**逐条列出来**
 *   ② 每行**点击后能在资源管理器里定位**
 *   ③ 标明被替换的文件**属于哪个 mod**、**是否同一个 mod**
 *
 * 所以本套件重点验：归属三态、大小对比、软/硬冲突合并、排序、limit 截断、异常兜底。
 *
 * 运行：`npm run test:conflicts`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { explainConflicts } = require('../src/main/installFlow');

const BASE = path.join(os.tmpdir(), 'sb-conflict-detail-test');
const ROOT = path.join(BASE, 'game');
const MODS = path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods');

let pass = 0, fail = 0;
const fails = [];

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
function eq(a, b, label) {
  t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}

// ---------------------------------------------------------------- 造现场

function reset() {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* 沙箱守卫 */ }
  fs.mkdirSync(MODS, { recursive: true });
}
/** 在游戏里放一个真文件，返回绝对路径 */
function put(rel, bytes) {
  const fp = path.join(ROOT, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, Buffer.alloc(bytes, 0x41));
  return fp;
}
/** 假注册表：按小写绝对路径查。**一条路径可以有多个登记者**（真实数据里就有）。 */
function fakeRegistry(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = String(e.path).toLowerCase();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return {
    _map: map,
    byTarget(p) { const l = map.get(String(p).toLowerCase()); return (l && l[0]) || null; },
    byTargetAll(p) { return map.get(String(p).toLowerCase()) || []; },
    all() { return [...map.values()].flat(); }
  };
}

const P_OTHER = path.join(MODS, 'other_P.pak');   // 别的 mod 装的
const P_SELF = path.join(MODS, 'self_P.pak');    // 自己上次装的
const P_GAME = path.join(MODS, 'game_P.pak');    // 谁都没登记

const META = { modId: 3023, name: 'Tiger Head Necklace - CNS' };

let REG = null;
function build() {
  reset();
  put('SB/Content/Paks/~Mods/other_P.pak', 1000);
  put('SB/Content/Paks/~Mods/self_P.pak', 2000);
  put('SB/Content/Paks/~Mods/game_P.pak', 3000);
  REG = fakeRegistry([
    { id: 'nexus:9999:1', name: 'Some Other Mod', source: { modId: 9999, version: '1.2' }, path: P_OTHER },
    { id: 'nexus:3023:13020', name: 'Tiger Head Necklace - CNS', source: { modId: 3023, version: '2.2' }, path: P_SELF }
  ]);
}
/** 一个「3 个文件全撞车」的计划：2 硬冲突 + 1 软冲突 */
function plan3() {
  return {
    ok: true,
    conflicts: [P_OTHER, P_GAME],
    softOverwritePaths: [P_SELF],
    mapping: [
      { to: P_OTHER, size: 1111 },
      { to: P_SELF, size: 2000 },
      { to: P_GAME, size: 3333 }
    ]
  };
}

// ---------------------------------------------------------------- 归属三态

console.log('\n[1] 归属三态 + 排序（最该看清楚的排前面）');
build();
{
  const d = explainConflicts(REG, ROOT, plan3(), META);
  eq(d.total, 3, 'total = 3（硬 2 + 软 1 合并）');
  eq(d.items.length, 3, 'items 长度 3');
  eq(d.sameSizeCount, 1, 'sameSizeCount = 1（只有软冲突那个）');

  // 排序：不是 mod 装的 → 别的 mod → 自己
  eq(d.items[0].name, 'game_P.pak', '第 1 条 = 游戏原文件（不是 mod 装的，最危险）');
  eq(d.items[1].name, 'other_P.pak', '第 2 条 = 别的 mod');
  eq(d.items[2].name, 'self_P.pak', '第 3 条 = 自己上次装的（升级，最不用担心）');

  const g = d.items[0], o = d.items[1], s = d.items[2];
  eq(g.owner, null, '游戏原文件 owner = null');
  t('别的 mod → owner 有名字且 isSelf=false', () =>
    (o.owner && o.owner.name === 'Some Other Mod' && o.owner.isSelf === false) || JSON.stringify(o.owner));
  t('自己的 mod → isSelf=true', () => (s.owner && s.owner.isSelf === true) || JSON.stringify(s.owner));
  eq(s.owner.modId, 3023, '自己那条的 modId = 3023');
  eq(o.owner.modId, 9999, '别的 mod 那条的 modId = 9999');
  eq(o.owner.version, '1.2', '别的 mod 带版本号');
}

// ---------------------------------------------------------------- 路径与大小

console.log('\n[2] 路径 / 大小 / 同名同大小判据');
{
  const d = explainConflicts(REG, ROOT, plan3(), META);
  const g = d.items.find(x => x.name === 'game_P.pak');
  const o = d.items.find(x => x.name === 'other_P.pak');
  const s = d.items.find(x => x.name === 'self_P.pak');

  eq(g.rel, 'SB/Content/Paks/~Mods/game_P.pak', 'rel 是相对游戏根的 posix 路径');
  eq(g.path, P_GAME, 'path 是绝对路径（供 revealPath 用）');
  eq(g.currentSize, 3000, 'currentSize 从磁盘真实读出');
  eq(g.incomingSize, 3333, 'incomingSize 取自 plan.mapping');
  eq(g.exists, true, 'exists = true');
  eq(g.sameSize, false, '不在 softOverwritePaths → sameSize=false');

  eq(s.sameSize, true, '在 softOverwritePaths → sameSize=true（同名同大小）');
  eq(s.incomingSize, 2000, '软冲突那条 incomingSize 也对上');
  eq(o.currentSize, 1000, '别的 mod 那条 currentSize 正确');
}

console.log('\n[3] 文件读不到 / 不在 mapping 里');
{
  // 计划里有个已经消失的文件（用户手动删了 / 杀软隔离）
  const ghost = path.join(MODS, 'ghost_P.pak');
  const p = { ok: true, conflicts: [ghost], softOverwritePaths: [], mapping: [{ to: ghost, size: 77 }] };
  const d = explainConflicts(REG, ROOT, p, META);
  eq(d.items.length, 1, '仍然列出该条（不吞掉）');
  eq(d.items[0].exists, false, 'exists = false');
  eq(d.items[0].currentSize, null, 'currentSize = null（读不到）');
  eq(d.items[0].incomingSize, 77, 'incomingSize 仍有值（来自计划）');
}

console.log('\n[4] 路径落在游戏根之外');
{
  const outside = path.join(BASE, 'elsewhere', 'x.pak');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, Buffer.alloc(9, 0x42));
  const p = { ok: true, conflicts: [outside], softOverwritePaths: [], mapping: [] };
  const d = explainConflicts(REG, ROOT, p, META);
  eq(d.items[0].rel, outside, '根外路径 rel 退化成绝对路径');
  eq(d.items[0].name, 'x.pak', 'name 仍只取文件名（basename，不是整条路径）');
  eq(d.items[0].incomingSize, null, 'mapping 里没有 → incomingSize = null');
}

// ---------------------------------------------------------------- 边界与兜底

console.log('\n[5] 边界：无计划 / 计划失败 / 无 registry / limit');
{
  eq(explainConflicts(REG, ROOT, null, META).total, 0, 'plan = null → 空结果');
  eq(explainConflicts(REG, ROOT, { ok: false, diagnosis: '无法识别' }, META).total, 0, 'plan.ok=false → 空结果');
  eq(explainConflicts(REG, ROOT, { ok: true }, META).total, 0, '没有任何冲突 → 空结果');

  const noReg = explainConflicts(null, ROOT, plan3(), META);
  eq(noReg.total, 3, 'registry = null 仍然列出文件（不抛）');
  eq(noReg.items[0].owner, null, 'registry = null → owner 全为 null');
  eq(noReg.items[0].name, 'game_P.pak', 'registry = null 时排序退化成按路径');

  // registry.byTarget 抛异常 —— 不能把整条明细带崩
  const boom = { byTarget() { throw new Error('registry exploded'); }, all() { return []; } };
  const bd = explainConflicts(boom, ROOT, plan3(), META);
  eq(bd.total, 3, 'byTarget 抛异常时仍返回 3 条');
  eq(bd.items[0].owner, null, '抛异常那条的 owner 兜底为 null');

  // meta 没给 modId —— 谁都不是「自己」
  const noMeta = explainConflicts(REG, ROOT, plan3(), {});
  t('meta 无 modId → 没有任何一条被判成 isSelf', () =>
    noMeta.items.every(x => !x.owner || x.owner.isSelf === false) || '有 isSelf=true');

  // limit 截断
  const lim = explainConflicts(REG, ROOT, plan3(), META, 1);
  eq(lim.total, 3, 'limit=1 → total 仍是 3（总数不丢）');
  eq(lim.shown, 1, 'limit=1 → shown = 1');
  eq(lim.items.length, 1, 'limit=1 → items 只给 1 条');
}

// ---------------------------------------------------------------- 多主（一条路径多个 mod 登记）

console.log('\n[6] 同一路径被多个 mod 登记 —— 必须全列出来');
{
  reset();
  const shared = put('SB/Content/Paks/~Mods/minervha_master_P.pak', 500);
  // 真实数据（2026-10-13）：这组路径被 2675 / 2359 / 2705 / 2241 四个 mod 同时登记
  const four = fakeRegistry([
    { id: 'nexus:2675:1', name: 'Minervha A', source: { modId: 2675, version: '1.0' }, path: shared },
    { id: 'nexus:2359:1', name: 'Minervha B', source: { modId: 2359 }, path: shared },
    { id: 'nexus:2705:1', name: 'Minervha C', source: { modId: 2705 }, path: shared },
    { id: 'nexus:2241:1', name: 'Minervha D', source: { modId: 2241 }, path: shared }
  ]);
  const p = { ok: true, conflicts: [shared], softOverwritePaths: [], mapping: [{ to: shared, size: 600 }] };

  const d = explainConflicts(four, ROOT, p, META);
  const it = d.items[0];
  eq(it.owners.length, 4, 'owners 列出全部 4 个登记者（不是只报第一个）');
  eq(it.isSelf, false, 'meta.modId=3023，四个都不是自己 → isSelf=false');
  eq(it.hasOther, true, 'hasOther=true');
  eq(it.owner.name, 'Minervha A', '兼容字段 owner = 第一个登记者');

  // 自己也在其中 —— 但只要还有别人，就不算「同一个 mod」
  const mixed = explainConflicts(four, ROOT, p, { modId: 2675 });
  eq(mixed.items[0].owners.length, 4, '含自己时 owners 仍是 4 条');
  eq(mixed.items[0].isSelf, false, '既有自己又有别人 → isSelf 仍为 false（覆盖会破坏别人）');
  eq(mixed.items[0].owners.filter(o => o.isSelf).length, 1, '其中恰好 1 条被判成自己');

  // 全是自己（同一 mod 的不同文件）→ 那才是升级
  const self2 = fakeRegistry([
    { id: 'nexus:3023:1', name: 'Tiger Head', source: { modId: 3023 }, path: shared },
    { id: 'nexus:3023:2', name: 'Tiger Head', source: { modId: 3023 }, path: shared }
  ]);
  const sd = explainConflicts(self2, ROOT, p, META);
  eq(sd.items[0].owners.length, 2, '全是自己的情况：owners 2 条');
  eq(sd.items[0].isSelf, true, '登记者全是自己 → isSelf=true（就是升级/重装）');
  eq(sd.items[0].hasOther, false, 'hasOther=false');

  // 没有 byTargetAll 的旧注册表对象 → 退化成只取第一个，但不抛
  const legacy = { byTarget: (x) => (String(x).toLowerCase() === shared.toLowerCase() ? { id: 'nexus:1:1', name: 'Legacy', source: { modId: 1 } } : null), all: () => [] };
  const ld = explainConflicts(legacy, ROOT, p, META);
  eq(ld.items[0].owners.length, 1, '没有 byTargetAll 时退化成 1 条（不抛）');
  eq(ld.items[0].owner.name, 'Legacy', '退化路径也能拿到 owner');
}

// ---------------------------------------------------------------- 渲染层接线

console.log('\n[7] 渲染层接线（源码级断言）');
{
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc.js'), 'utf8');
  const eng = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'downloadEngine.js'), 'utf8');

  t('app.js 有 conflictListHtml()', () => appJs.includes('function conflictListHtml(') || '缺失');
  t('app.js 有 conflictDetailsOf()', () => appJs.includes('function conflictDetailsOf(') || '缺失');
  t('每行是按钮且带 data-reveal-path（点击在资源管理器定位）', () =>
    appJs.includes('class="cfl-row" data-reveal-path=') || '缺失');
  t('归属徽标：同一个 mod / 别的 mod / 不是 mod 装的', () =>
    appJs.includes('class="tag self"') && appJs.includes('class="tag other"') && appJs.includes('class="tag gray"')
    || '三种 tag 不齐');
  t('渲染层读 owners 数组（一条路径多个 mod 时全列出来）', () =>
    appJs.includes('const owners = x.owners || (x.owner ? [x.owner] : [])') || '仍只读单个 owner');
  t('多个别的 mod 名字可折叠（最多 3 个 + 等 N 个）', () =>
    appJs.includes('others.slice(0, 3)') && appJs.includes('等 ${others.length} 个') || '缺失');
  t('版本号自带 v 时不重复拼（"v1.0" 不显示成 "vv1.0"）', () =>
    appJs.includes('/^v/i.test(v)') || '缺失 v 前缀判断');
  t('registry.js 提供 byTargetAll()', () =>
    fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'registry.js'), 'utf8').includes('byTargetAll:')
    || '缺失');
  t('卡片入口 data-dl-conflicts', () => appJs.includes('data-dl-conflicts=') || '缺失');
  t('抽屉锚点 id="dlConflicts"', () => appJs.includes('id="dlConflicts"') || '缺失');
  t('点击 data-dl-conflicts → 开抽屉并滚到清单', () =>
    appJs.includes("closest('[data-dl-conflicts]')") && appJs.includes("$('#dlConflicts')") || '缺失');
  t('点击 data-reveal-path → revealPath()', () =>
    appJs.includes("closest('[data-reveal-path]')") && appJs.includes('revealPath(') || '缺失');
  t('手动安装确认抽屉也插入 conflictList', () => appJs.includes('conflictListHtml(p.conflictDetails)') || '缺失');

  t('ipc.js 的 install:analyze 挂上 conflictDetails', () =>
    ipc.includes('plan.conflictDetails = installFlow.explainConflicts(') || '缺失');
  t('downloadEngine 安装阶段挂上 conflictDetails', () =>
    eng.includes('plan.conflictDetails = explainConflicts(') || '缺失');

  t('style.css 有 .cfl-row / .cflist', () =>
    css.includes('.cfl-row{') && css.includes('.cflist{') || '缺失');
  t('style.css 有 .tag.self / .tag.other / .tag.gray', () =>
    css.includes('.tag.self{') && css.includes('.tag.other{') && css.includes('.tag.gray{') || '缺失');
  t('style.css 用项目自己的 --ok 变量（不引不存在的 --green）', () =>
    !css.includes('var(--green') || '仍有 var(--green)');
}

// ---------------------------------------------------------------- 收尾

reset();
console.log(`\n${fail === 0 ? '✅' : '❌'} conflict-detail: ${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项：'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
