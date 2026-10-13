// 批量端到端：点「⚡ 全部自动授权」→ 全部走 授权→下载→分析→安装 → 轮询到流水线静默。
const unwrap = (r) => (r && r.ok ? r.data : r);
const tasksOf = (r) => { const d = unwrap(r) || {}; return Array.isArray(d) ? d : (d.tasks || []); };

const auth = await window.__dlActions.dlAutoAuthorizeAll();

// 只等「真的在干活」的状态；awaiting_authorization 不算 —— 那是授权阶段的事，
// 若被 Cloudflare 停下会留一批 awaiting，等它只会白等。
const ACTIVE = new Set(['queued', 'resolving', 'downloading', 'analyzing', 'installing']);
const t0 = Date.now();
let idleRounds = 0;
while (Date.now() - t0 < 235000) {
  await new Promise(r => setTimeout(r, 2000));
  const busy = tasksOf(await window.api.download.list()).filter(t => ACTIVE.has(t.status));
  if (!busy.length) { idleRounds++; if (idleRounds >= 2) break; } else idleRounds = 0;
}

const arr = tasksOf(await window.api.download.list());
const by = {};
for (const t of arr) by[t.status] = (by[t.status] || 0) + 1;
const brief = (t) => ({ modId: t.meta && t.meta.modId, fileId: t.meta && t.meta.fileId, name: (t.meta && t.meta.name || '').slice(0, 40) });

return {
  auth,
  elapsedMs: Date.now() - t0,
  counts: by,
  failed: arr.filter(t => t.status === 'failed').map(t => ({ ...brief(t), error: t.error })),
  needsReview: arr.filter(t => t.status === 'needs_review').map(t => ({ ...brief(t), reason: t.install && t.install.reason })),
  installed: arr.filter(t => t.status === 'installed').map(t => ({ ...brief(t), archive: t.filename })),
  stillWaiting: arr.filter(t => t.status === 'awaiting_authorization').map(brief)
};
