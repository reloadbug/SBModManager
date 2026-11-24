'use strict';
/**
 * 时间档案 id 聚合 + 毫秒精度探针（用户 2026-11-25：
 *   「禁用/启用时间不更新、详情没有状态变更记录、所有时间精确到毫秒」）。
 *
 * 根因：同一 Mod 的开关事件散落在两套 id 上 —— 未登记时记在
 *   `disk:paks:xxx [nx<id>]`、关联后记在 `nexus:<id>:0`。读取端按精确 id
 *   匹配 / byModId 覆盖，导致只看半条流水、时间停在旧值、详情无记录。
 */
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + ' → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + ' → EX: ' + e.message); }
}

console.log('\n===== A. modHistory 按 modId 聚合（disk + nexus 两套 id） =====');
{
  const { createModHistory } = require('../src/main/modHistory');
  const file = path.join(require('os').tmpdir(), 'sb-timeline-' + process.pid + '.json');
  try { fs.unlinkSync(file); } catch {}
  const h = createModHistory(file);

  t('A1 同一 modId 的 disable(disk) + enable(nexus) 能被 forModId 串起来', () => {
    h.add('disable', { id: 'disk:paks:Foo_P [nx777]', modId: 777, name: 'Foo', detail: 't1' });
    h.add('enable', { id: 'nexus:777:0', modId: 777, name: 'Foo', detail: 't2' });
    const evs = h.forModId(777, 20);
    if (evs.length !== 2) return '期望 2 条，实际 ' + evs.length;
    if (evs[0].action !== 'enable') return '最新一条应是 enable，实际 ' + evs[0].action;
    return true;
  });

  t('A2 forMod(精确 id) 只能取到一半（证明旧口径确实漏）', () => {
    const evs = h.forMod('nexus:777:0', 20);
    return evs.length === 1 && evs[0].action === 'enable';
  });

  t('A3 statesByModId 把两套 id fold 成「已启用 + 最新开启时间」', () => {
    const st = h.statesByModId()['777'];
    if (!st) return '没有 777 的聚合状态';
    if (st.enabled !== true) return '应已启用';
    if (!st.enabledAt) return '缺 enabledAt';
    return true;
  });

  t('A4 statesByModId 再禁一次 → 变已禁用且 disabledAt=最新', () => {
    h.add('disable', { id: 'nexus:777:0', modId: 777, name: 'Foo', detail: 't3' });
    const st = h.statesByModId()['777'];
    return (st.enabled === false && !!st.disabledAt) || JSON.stringify(st);
  });

  try { fs.unlinkSync(file); } catch {}

  const file2 = path.join(require('os').tmpdir(), 'sb-backfill-' + process.pid + '.json');
  try { fs.unlinkSync(file2); } catch {}
  const h2 = createModHistory(file2);

  t('A5 backfill 每条时间戳逐个错开（不再整批共用同一毫秒）', () => {
    const items = [];
    for (let i = 0; i < 8; i++) items.push({ id: 'disk:paks:b' + i, modId: 1000 + i, name: 'B' + i, enabled: true });
    const n = h2.backfill(items);
    if (n !== 8) return '回填条数 ' + n;
    const evs = h2.events({ action: 'backfill', limit: 100 });
    const ats = evs.map(e => e.at);
    const uniq = new Set(ats);
    if (uniq.size !== 8) return '时间戳重复：' + ats.join(',');
    // 递增 1ms
    const sorted = ats.slice().sort();
    for (let i = 1; i < sorted.length; i++) {
      if (Date.parse(sorted[i]) - Date.parse(sorted[i - 1]) !== 1) return '不是递增 1ms：' + sorted.join(',');
    }
    return true;
  });

  t('A6 backfill 有 enabledAt 的项被跳过（回填过一次不刷新）', () => {
    const n = h2.backfill([{ id: 'disk:paks:b0', modId: 1000, name: 'B0', enabled: true }]);
    return n === 0 || ('重复回填了 ' + n);
  });

  try { fs.unlinkSync(file2); } catch {}
}

console.log('\n===== B. IPC + preload 新通道 =====');
{
  const ipc = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
  const pre = fs.readFileSync(path.join(__dirname, '../src/preload/index.js'), 'utf8');
  t('B1 ipc 有 history:forModId / history:statesByModId', () =>
    (/history:forModId/.test(ipc) && /history:statesByModId/.test(ipc)) || '没有');
  t('B2 preload 暴露 forModId / statesByModId', () =>
    (/forModId: \(modId, limit\)/.test(pre) && /statesByModId: \(\)/.test(pre)) || '没有');
}

console.log('\n===== C. 渲染层三处读取端 =====');
{
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  t('C1 loadModHistory 用 statesByModId 覆盖 byModId', () =>
    (/window\.api\.history\.statesByModId\(\)/.test(app) && /Object\.assign\(byModId, agg\)/.test(app)) || '没有');
  t('C2 fillDrawerHistory 用 forModId（按 modId 聚合）', () =>
    /window\.api\.history\.forModId\(modId, 20\)/.test(app) || '没有');
  t('C3 groupEnabledAt 同时看 stableId 与 byModId', () => {
    const m = app.match(/function groupEnabledAt\(items\)[\s\S]{0,1000}?\n\}/);
    return (m && m[0].indexOf('state.modHistoryByModId[String(mid)]') >= 0 && m[0].indexOf('byStableId') >= 0) || '没有';
  });
  t('C4 groupInstalled disabledAt 看 byModId 聚合', () => {
    const m = app.match(/disabledAt: \(\(\) => \{[\s\S]{0,700}?\}\)\(\),/);
    return (m && m[0].indexOf('state.modHistoryByModId') >= 0) || '没有';
  });
  t('C5 详情时间字段用 fmtWhenMs（毫秒）', () => {
    const seg = app.slice(app.indexOf("out.push(row('posted'"), app.indexOf("out.push(row('registry'"));
    const n = (seg.match(/fmtWhenMs/g) || []).length;
    return n >= 6 || ('只有 ' + n + ' 个字段用了 fmtWhenMs');
  });
  t('C6 有 fmtWhenMs 函数定义', () => /function fmtWhenMs\(iso\)/.test(app) || '没有');
  t('C7 状态变更记录用毫秒时间', () => {
    const m = app.match(/async function fillDrawerHistory[\s\S]{0,1400}?\n\}/);
    return (m && m[0].indexOf('fmtWhenMs(e.at)') >= 0) || '没有';
  });
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
