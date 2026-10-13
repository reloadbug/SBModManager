// 验证「卡住的 4 条」是否被新规则救活。
//
// 背景（2026-10-13 用户报「有部分 mod 依然无法处理」）：
//   1647 纯 CNS 数据包（只有 .dekcns.json）→ 新规则应能落 ~Mods
//   2182 作者的 .blend 工程源文件        → 新规则应给「不是游戏 Mod」的结论
//   1595 覆盖自己旧版本被误判成冲突      → 新规则应放行自动装
//   347  6 选 1 变体包                    → 仍应停在「待选一套」（这是设计）
//
// 走 `download:start`（= engine.retry）：有归档的直接重跑 installPhase，
// 而 installPhase 现在会带 `ownedPaths` 重新分析。
const unwrap = (r) => (r && r.ok ? r.data : r);
const tasksOf = (r) => { const d = unwrap(r) || {}; return Array.isArray(d) ? d : (d.tasks || []); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const brief = (t) => ({
  modId: t.meta && t.meta.modId,
  name: String((t.meta && t.meta.name) || '').slice(0, 44),
  status: t.status,
  plan: t.install && t.install.plan
    ? { ok: !!t.install.plan.ok, kind: t.install.plan.kind, options: (t.install.plan.options || []).length,
        conflictCount: t.install.plan.conflictCount || 0, diagnosis: t.install.plan.diagnosis || null }
    : null,
  reason: (t.install && t.install.reason) || null
});

const before = tasksOf(await window.api.download.list());
const targets = before.filter(t => t.status === 'needs_review');
const beforeBrief = targets.map(brief);

// 逐条推一把
const kicked = [];
for (const t of targets) {
  try { await window.api.download.start(t.id); kicked.push(t.meta && t.meta.modId); }
  catch (e) { kicked.push('ERR:' + (t.meta && t.meta.modId) + ':' + e.message); }
  await sleep(150);
}

// 等静默
const ACTIVE = new Set(['queued', 'resolving', 'downloading', 'analyzing', 'installing']);
const t0 = Date.now();
let idle = 0;
while (Date.now() - t0 < 240000) {
  await sleep(2500);
  const busy = tasksOf(await window.api.download.list()).filter(t => ACTIVE.has(t.status));
  if (!busy.length) { idle++; if (idle >= 2) break; } else idle = 0;
}

const arr = tasksOf(await window.api.download.list());
const by = {};
for (const t of arr) by[t.status] = (by[t.status] || 0) + 1;

return {
  beforeBrief,
  kicked,
  elapsedMs: Date.now() - t0,
  counts: by,
  installed: arr.filter(t => t.status === 'installed').map(brief),
  needsReview: arr.filter(t => t.status === 'needs_review').map(brief),
  failed: arr.filter(t => t.status === 'failed').map(t => ({ ...brief(t), error: t.error }))
};
