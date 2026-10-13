// 收尾：把队列里剩下的任务全部推完（重试中断的 → 免点击授权 → 下载 → 安装）。
const unwrap = (r) => (r && r.ok ? r.data : r);
const tasksOf = (r) => { const d = unwrap(r) || {}; return Array.isArray(d) ? d : (d.tasks || []); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const brief = (t) => ({ modId: t.meta && t.meta.modId, fileId: t.meta && t.meta.fileId, name: (t.meta && t.meta.name || '').slice(0, 40) });

// 1) 启动时主进程已把中间态统一改成 interrupted；这里逐条推一把
const before = tasksOf(await window.api.download.list());
const byBefore = {};
for (const t of before) byBefore[t.status] = (byBefore[t.status] || 0) + 1;

const kicked = [];
for (const t of before) {
  if (t.status === 'interrupted' || t.status === 'failed') {
    await window.api.download.start(t.id);
    kicked.push(t.meta && t.meta.modId);
    await sleep(100);
  }
}

// 2) retry 后没归档的会退回「等待授权」→ 批量免点击授权（这一步同时验证新策略）
const auth = await window.__dlActions.dlAutoAuthorizeAll();

// 3) 等流水线静默
const ACTIVE = new Set(['queued', 'resolving', 'downloading', 'analyzing', 'installing']);
const t0 = Date.now();
let idle = 0;
while (Date.now() - t0 < 215000) {
  await sleep(2500);
  const busy = tasksOf(await window.api.download.list()).filter(t => ACTIVE.has(t.status));
  if (!busy.length) { idle++; if (idle >= 2) break; } else idle = 0;
}

const arr = tasksOf(await window.api.download.list());
const by = {};
for (const t of arr) by[t.status] = (by[t.status] || 0) + 1;

return {
  byBefore,
  kickedCount: kicked.length,
  auth: auth || null,
  elapsedMs: Date.now() - t0,
  counts: by,
  failed: arr.filter(t => t.status === 'failed').map(t => ({ ...brief(t), error: t.error })),
  stillWaiting: arr.filter(t => t.status === 'awaiting_authorization').map(t => ({ ...brief(t), error: t.error })),
  needsReview: arr.filter(t => t.status === 'needs_review').map(brief),
  installedCount: arr.filter(t => t.status === 'installed').length
};
