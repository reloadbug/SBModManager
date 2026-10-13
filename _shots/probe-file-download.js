// 多文件 mod：文件列表每行都带下载按钮 → 点其中一个 → 队列里生成对应 fileId 的任务
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const qa = s => [...document.querySelectorAll(s)];
const out = {};
try {

window.switchPage('p-browse');
for (let i = 0; i < 40; i++) { await wait(250); if (qa('#browseArea .card').length) break; }
out.初始卡片 = qa('#browseArea .card').length;

// 搜一个确定有多个文件的 mod（截图里那个 Eve Nude Natural）
const input = q('#searchInput');
input.value = 'Eve Nude Natural';
input.dispatchEvent(new Event('input', { bubbles: true }));
for (let i = 0; i < 40; i++) {
  await wait(300);
  const stats = (q('#browseStats') || {}).textContent || '';
  if (/Eve Nude Natural/.test(stats) && qa('#browseArea .card').length) break;
}
out.搜索统计 = (q('#browseStats') || {}).textContent || '';
out.搜索后卡片 = qa('#browseArea .card').length;

const card = qa('#browseArea .card')[0];
if (!card) return Object.assign(out, { 错误: '没搜到卡片' });
const modId = Number(card.dataset.modid);
out.modId = modId;

window.openNexusDrawer(modId);
for (let i = 0; i < 60; i++) { await wait(300); if (qa('#filesBox [data-dl-file]').length) break; }

const btns = qa('#filesBox [data-dl-file]');
out.抽屉标题 = (q('#dTitle') || {}).textContent || '';
out.文件按钮数 = btns.length;
out.按钮一览 = btns.map(b => ({ fileId: Number(b.dataset.dlFile), 文案: b.textContent.trim() }));
out.底部按钮们 = qa('#dFoot button').map(b => b.textContent.trim());
out.本地状态行 = (q('#drawerLocalRow') || {}).textContent || '';

if (!btns.length) return Object.assign(out, { 错误: '文件列表里没有下载按钮' });

// 点**最后一个**（几乎一定不是主文件）→ 队列里必须是对应 fileId 的任务
const target = btns[btns.length - 1];
const wantFileId = Number(target.dataset.dlFile);
const st = window.__state || {};
const before = (st.downloads || []).length;
target.click();
let newTask = null;
for (let i = 0; i < 40; i++) {
  await wait(200);
  const list = (window.__state && window.__state.downloads) || [];
  newTask = list.find(t => t.meta && Number(t.meta.fileId) === wantFileId && Number(t.meta.modId) === modId) || null;
  if (newTask) break;
}
out.点击的fileId = wantFileId;
out.队列数变化 = { 前: before, 后: ((window.__state && window.__state.downloads) || []).length };
out.新任务 = newTask
  ? { id: newTask.id, status: newTask.status, modId: newTask.meta.modId, fileId: newTask.meta.fileId,
      fileName: newTask.meta.fileName, fileVersion: newTask.meta.fileVersion, fileSize: newTask.meta.fileSize }
  : null;
out.队列卡片有文件名 = !!(q('.dl-item[data-dlid="' + (newTask ? newTask.id : '') + '"] .chip[title]'));

// 收尾：清掉探针造出来的任务，别留在用户队列里
if (newTask) {
  try { await window.api.download.remove(newTask.id); out.已清理任务 = true; } catch (e) { out.已清理任务 = e.message; }
}
// 收尾后把抽屉滚到「文件」区，截图要看那排下载按钮
const body = q('#dBody');
if (body) { body.scrollTop = body.scrollHeight; }
out.抽屉滚动 = body ? Math.round(body.scrollTop) + '/' + Math.round(body.scrollHeight) : null;
await wait(1200);
return out;
} catch (e) { return Object.assign(out, { 报错: e && (e.stack || e.message) || String(e) }); }
