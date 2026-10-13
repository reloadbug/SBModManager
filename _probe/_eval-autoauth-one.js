// 单条端到端：自动授权 → 下载 → 分析 → 安装，并轮询到终态。
// 由 --shot-eval-file 加载，外层已被包成 (async () => { ... })()，可直接 await / return。
const unwrap = (resp) => (resp && resp.ok ? resp.data : resp);
const tasksOf = (resp) => {
  const d = unwrap(resp) || {};
  return Array.isArray(d) ? d : (d.tasks || []);
};

const all = tasksOf(await window.api.download.list());
const waiting = all.filter(t => t.status === 'awaiting_authorization' && t.meta && t.meta.fileId);
if (!waiting.length) return { error: '没有待授权任务' };

// 挑体积最小的那条，跑得最快
waiting.sort((a, b) => (a.meta.fileSize || 0) - (b.meta.fileSize || 0));
const pick = waiting[0];
const before = {
  id: pick.id, modId: pick.meta.modId, fileId: pick.meta.fileId,
  size: pick.meta.fileSize, status: pick.status, error: pick.error || null
};

const auth = await window.api.download.autoAuthorize(pick.id);

const trace = [];
const t0 = Date.now();
let last = '';
let final = null;
while (Date.now() - t0 < 92000) {
  await new Promise(r => setTimeout(r, 1000));
  const cur = tasksOf(await window.api.download.list()).find(t => t.id === pick.id);
  if (!cur) { trace.push('(任务消失)'); break; }
  const tag = cur.status + (cur.error ? '  ⚠ ' + cur.error : '');
  if (tag !== last) { trace.push(tag); last = tag; }
  if (['installed', 'failed', 'needs_review', 'cancelled', 'interrupted'].includes(cur.status)) {
    final = {
      status: cur.status, error: cur.error || null,
      archivePath: cur.archivePath || null, filename: cur.filename || null,
      install: cur.install || null
    };
    break;
  }
}

return { before, auth, trace, final, elapsedMs: Date.now() - t0 };
