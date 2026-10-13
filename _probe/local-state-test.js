'use strict';

/**
 * 浏览页「本地状态」判定自检（纯 Node，不联网）
 *
 * 覆盖 src/main/localState.js 的全部纯函数，以及「用真实数据跑一遍」的集成校验。
 * 关联键只有 Nexus modId 一个 —— 这组断言就是钉死这件事的边界。
 */

const fs = require('fs');
const path = require('path');

const {
  buildLocalIndex, localFor, decorateMods, stateMap,
  TASK_STATE, STATE_RANK, STATES, STATE_LABEL
} = require('../src/main/localState');

let pass = 0, fail = 0;
const fails = [];

function t(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + name); }
    else { fail++; fails.push(name + ' → ' + r); console.log('  ✗ ' + name + ' → ' + r); }
  } catch (e) {
    fail++; fails.push(name + ' → 抛异常 ' + e.message);
    console.log('  ✗ ' + name + ' → 抛异常 ' + e.message);
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  return a === b ? true : `${label || ''} 期望 ${b}，实际 ${a}`;
}

/** 造一条 scanner 结果 */
function scanned(modId, extra = {}) {
  return {
    id: 'nexus:' + modId + ':1',
    name: 'Mod ' + modId,
    kind: 'cns',
    location: 'D:/games/Star Blade/SB',
    meta: { source: { modId, fileId: 1, version: '1.0' } },
    ...extra
  };
}

/** 造一条下载任务 */
function task(id, modId, status, extra = {}) {
  return { id, status, meta: { modId, fileId: 1, name: 'Mod ' + modId }, ...extra };
}

console.log('\n=== A. buildLocalIndex：注册表 → 已安装 ===');

t('空输入 → 两个空 Map', () => {
  const idx = buildLocalIndex({});
  if (!(idx.installed instanceof Map)) return 'installed 不是 Map';
  if (!(idx.pending instanceof Map)) return 'pending 不是 Map';
  return idx.installed.size === 0 && idx.pending.size === 0 ? true : '不是空的';
});

t('无参数调用不炸', () => {
  const idx = buildLocalIndex();
  return idx.installed.size === 0 ? true : '不是空的';
});

t('注册表条目带 source.modId → installed', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const e = idx.installed.get(1252);
  if (!e) return '没命中 1252';
  return eq(e.state, 'installed', 'state') === true ? true : eq(e.state, 'installed', 'state');
});

t('installed 条目带上 registryId / version / target', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const e = idx.installed.get(1252);
  if (e.registryId !== 'nexus:1252:1') return 'registryId=' + e.registryId;
  if (e.version !== '1.0') return 'version=' + e.version;
  if (!e.target) return 'target 为空';
  return true;
});

t('没有 source 的条目 → 忽略（磁盘扫描到的手装 mod 关联不上）', () => {
  const idx = buildLocalIndex({ scanned: [{ id: 'disk:paks:foo', name: 'foo', kind: 'pak' }] });
  return idx.installed.size === 0 ? true : '被算进 installed 了';
});

t('source.modId 为 0 / 空 → 忽略', () => {
  const idx = buildLocalIndex({
    scanned: [
      { id: 'a', meta: { source: { modId: 0 } } },
      { id: 'b', meta: { source: { modId: null } } },
      { id: 'c', meta: { source: {} } }
    ]
  });
  return idx.installed.size === 0 ? true : '混进了 ' + idx.installed.size + ' 条';
});

t('非数组入参不炸', () => {
  const idx = buildLocalIndex({ scanned: 'x', tasks: 123 });
  return idx.installed.size === 0 && idx.pending.size === 0 ? true : '不是空的';
});

console.log('\n=== B. buildLocalIndex：下载队列 → 已下载 / 下载中 ===');

t('needs_review → pending', () => {
  const idx = buildLocalIndex({ tasks: [task('t1', 1507, 'needs_review')] });
  const e = idx.pending.get(1507);
  return e && e.state === 'pending' ? true : JSON.stringify(e);
});

t('downloaded → pending', () => {
  const idx = buildLocalIndex({ tasks: [task('t1', 1, 'downloaded')] });
  return idx.pending.get(1).state === 'pending' ? true : '不是 pending';
});

t('downloading / queued / resolving → downloading', () => {
  for (const s of ['downloading', 'queued', 'resolving', 'awaiting_authorization']) {
    const idx = buildLocalIndex({ tasks: [task('t', 9, s)] });
    const e = idx.pending.get(9);
    if (!e || e.state !== 'downloading') return s + ' → ' + JSON.stringify(e);
  }
  return true;
});

t('installing → installing', () => {
  const idx = buildLocalIndex({ tasks: [task('t', 7, 'installing')] });
  return idx.pending.get(7).state === 'installing' ? true : '不是 installing';
});

t('installed 状态的任务 → 不标记（交给 scanner，卸载后才不会残留）', () => {
  const idx = buildLocalIndex({ tasks: [task('t', 1252, 'installed')] });
  return idx.pending.size === 0 ? true : '被标记了';
});

t('failed / cancelled / interrupted → 不标记', () => {
  const idx = buildLocalIndex({
    tasks: [task('a', 1, 'failed'), task('b', 2, 'cancelled'), task('c', 3, 'interrupted')]
  });
  return idx.pending.size === 0 ? true : '混进了 ' + idx.pending.size + ' 条';
});

t('任务缺 meta.modId → 忽略', () => {
  const idx = buildLocalIndex({ tasks: [{ id: 'x', status: 'needs_review', meta: {} }] });
  return idx.pending.size === 0 ? true : '被标记了';
});

t('pending 条目带上 taskId', () => {
  const idx = buildLocalIndex({ tasks: [task('task-abc', 1507, 'needs_review')] });
  return idx.pending.get(1507).taskId === 'task-abc' ? true : '没有 taskId';
});

console.log('\n=== C. 优先级 ===');

t('已安装优先于下载任务（同一个 modId）', () => {
  const idx = buildLocalIndex({
    scanned: [scanned(1252)],
    tasks: [task('t', 1252, 'needs_review')]
  });
  if (!idx.installed.has(1252)) return 'installed 里没有';
  if (idx.pending.has(1252)) return 'pending 里也有（重复标记）';
  return true;
});

t('同一 modId 多条任务 → 取优先级高的（installing > pending > downloading）', () => {
  const idx = buildLocalIndex({
    tasks: [task('a', 5, 'downloading'), task('b', 5, 'needs_review'), task('c', 5, 'installing')]
  });
  return idx.pending.get(5).state === 'installing' ? true : idx.pending.get(5).state;
});

t('顺序反过来也是取优先级高的', () => {
  const idx = buildLocalIndex({
    tasks: [task('c', 5, 'installing'), task('b', 5, 'needs_review'), task('a', 5, 'downloading')]
  });
  return idx.pending.get(5).state === 'installing' ? true : idx.pending.get(5).state;
});

t('低优先级不覆盖高优先级', () => {
  const idx = buildLocalIndex({
    tasks: [task('b', 5, 'needs_review'), task('a', 5, 'downloading')]
  });
  return idx.pending.get(5).state === 'pending' ? true : idx.pending.get(5).state;
});

console.log('\n=== D. localFor / stateMap / decorateMods ===');

t('localFor：命中已安装', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const e = localFor(1252, idx);
  return e && e.state === 'installed' ? true : JSON.stringify(e);
});

t('localFor：字符串 modId 也能命中（IPC 传来的是字符串键）', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  return localFor('1252', idx) ? true : '没命中';
});

t('localFor：找不到 → null', () => {
  const idx = buildLocalIndex({});
  return localFor(9999, idx) === null ? true : '不是 null';
});

t('localFor：index 为 null → null（不炸）', () => {
  return localFor(1, null) === null ? true : '不是 null';
});

t('stateMap：只返回命中的项', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)], tasks: [task('t', 1507, 'needs_review')] });
  const m = stateMap([1252, 1507, 9999], idx);
  const keys = Object.keys(m).sort();
  return eq(keys, ['1252', '1507'], '键') === true ? true : eq(keys, ['1252', '1507'], '键');
});

t('stateMap：键是字符串（对齐 JSON 序列化）', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const m = stateMap([1252], idx);
  return typeof m['1252'] === 'object' ? true : JSON.stringify(m);
});

t('stateMap：脏值不炸', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1)] });
  const m = stateMap(['', null, undefined, 0, NaN, {}, 'x'], idx);
  return Object.keys(m).length === 0 ? true : JSON.stringify(Object.keys(m));
});

t('decorateMods：挂上 local 字段', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const out = decorateMods([{ modId: 1252, name: 'A' }, { modId: 999, name: 'B' }], idx);
  if (!out[0].local || out[0].local.state !== 'installed') return '第一条没标记';
  if (out[1].local !== undefined) return '第二条不该有 local';
  return true;
});

t('decorateMods：不污染入参（缓存里的原始数据要保持干净）', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const src = [{ modId: 1252, name: 'A' }];
  decorateMods(src, idx);
  return src[0].local === undefined ? true : '入参被改了';
});

t('decorateMods：数量与顺序不变', () => {
  const idx = buildLocalIndex({ scanned: [scanned(1252)] });
  const src = [{ modId: 1 }, { modId: 1252 }, { modId: 3 }];
  const out = decorateMods(src, idx);
  if (out.length !== 3) return '数量变了';
  if (out[1].modId !== 1252) return '顺序变了';
  return true;
});

t('decorateMods：非数组 → 空数组', () => {
  const idx = buildLocalIndex({});
  return eq(decorateMods(null, idx), [], 'null') === true &&
    eq(decorateMods(undefined, idx), [], 'undefined') === true ? true : '不是空数组';
});

console.log('\n=== E. 常量自洽 ===');

t('TASK_STATE 的值都在 STATES 里', () => {
  const bad = Object.entries(TASK_STATE).filter(([, v]) => !STATES.includes(v));
  return bad.length ? JSON.stringify(bad) : true;
});

t('STATE_RANK 覆盖 STATES 全部', () => {
  const miss = STATES.filter(s => typeof STATE_RANK[s] !== 'number');
  return miss.length ? '缺 ' + miss.join(',') : true;
});

t('STATE_LABEL 覆盖 STATES 全部', () => {
  const miss = STATES.filter(s => typeof STATE_LABEL[s] !== 'string' || !STATE_LABEL[s]);
  return miss.length ? '缺 ' + miss.join(',') : true;
});

t('STATE_RANK 顺序：installed > installing > pending > downloading', () => {
  const order = ['downloading', 'pending', 'installing', 'installed'];
  for (let i = 1; i < order.length; i++) {
    if (STATE_RANK[order[i]] <= STATE_RANK[order[i - 1]]) {
      return order[i - 1] + '(' + STATE_RANK[order[i - 1]] + ') 不小于 ' + order[i] + '(' + STATE_RANK[order[i]] + ')';
    }
  }
  return true;
});

console.log('\n=== F. 真实数据集成（读 data/mods.json + data/downloads.json）===');

const MODS = path.join(__dirname, '..', 'data', 'mods.json');
const DLS = path.join(__dirname, '..', 'data', 'downloads.json');

if (fs.existsSync(MODS) && fs.existsSync(DLS)) {
  const modsDb = JSON.parse(fs.readFileSync(MODS, 'utf8'));
  const dlDb = JSON.parse(fs.readFileSync(DLS, 'utf8'));

  // 把注册表条目伪装成 scanner 的输出（scanner 就是把 source 挂在 meta 上）
  const scannedReal = modsDb.mods.map(m => ({
    id: m.id, name: m.name, kind: m.kind || 'cns',
    location: m.target || '', meta: m
  }));

  t('真实数据：注册表里的 modId 都被识别为已安装', () => {
    const idx = buildLocalIndex({ scanned: scannedReal, tasks: dlDb.tasks });
    const want = modsDb.mods.map(m => Number(m.source && m.source.modId)).filter(Boolean);
    const miss = want.filter(id => !idx.installed.has(id));
    return miss.length ? '漏了 ' + miss.join(',') : true;
  });

  t('真实数据：下载队列里「待安装」的任务都被识别为已下载', () => {
    const idx = buildLocalIndex({ scanned: scannedReal, tasks: dlDb.tasks });
    // 不写死 modId —— 队列内容随时会变（用户下载 / 清理），只断言语义
    const want = dlDb.tasks
      .filter(x => x.status === 'downloaded' || x.status === 'needs_review')
      .map(x => Number(x.meta && x.meta.modId))
      .filter(Boolean);
    if (!want.length) return true;   // 队列空也算通过
    const miss = want.filter(id => !idx.pending.has(id) && !idx.installed.has(id));
    return miss.length ? '漏了 ' + miss.join(',') : true;
  });

  t('真实数据：已安装的 modId 不再出现在 pending（不重复标记）', () => {
    const idx = buildLocalIndex({ scanned: scannedReal, tasks: dlDb.tasks });
    const dup = [...idx.installed.keys()].filter(k => idx.pending.has(k));
    return dup.length ? '重复：' + dup.join(',') : true;
  });

  t('真实数据：installed 与 pending 的 modId 不重叠', () => {
    const idx = buildLocalIndex({ scanned: scannedReal, tasks: dlDb.tasks });
    const both = [...idx.installed.keys()].filter(k => idx.pending.has(k));
    return both.length ? '重叠：' + both.join(',') : true;
  });
} else {
  console.log('  （跳过：找不到 data/mods.json 或 data/downloads.json）');
}

console.log('\n' + '='.repeat(52));
console.log(`  通过 ${pass} / 失败 ${fail}`);
if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    · ' + f)); }
console.log('='.repeat(52) + '\n');

process.exit(fail ? 1 : 0);
