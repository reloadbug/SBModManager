// 浏览页「多选 → 批量下载（默认第一个主文件）」的端到端实测。
// 步骤：切到浏览页 → 进多选 → 全选 → 校验计数 → 批量下载 → 校验每个任务都钉住了主文件
//       → 再跑一次验去重 → 清掉探针建的任务 → 回到多选态保帧截图。
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const qa = s => [...document.querySelectorAll(s)];
const out = {};
const T0 = Date.now();
const lap = (k) => { out[k] = ((Date.now() - T0) / 1000).toFixed(1) + 's'; };
const st = () => window.__state;
const selCards = () => qa('#browseArea .card.sel').length;
const tasks = () => (st().downloads || []);

// 浏览页懒加载 —— 先显式切过去
if (window.switchPage) window.switchPage('p-browse');
for (let i = 0; i < 40 && !qa('#browseArea .card').length; i++) await wait(500);
await wait(2500);   // 本地状态异步装饰
lap('等卡片');
out.卡片数 = qa('#browseArea .card').length;

// —— 进入多选 ——
out.初始工具栏 = {
  模式按钮: (q('#btnBatchMode') || {}).textContent,
  全选可见: (q('#btnSelectAll') || {}).style ? q('#btnSelectAll').style.display !== 'none' : null,
  批量可见: (q('#btnBatchDownload') || {}).style ? q('#btnBatchDownload').style.display !== 'none' : null,
  复选框显示: (q('#browseArea .cover .ck') || {}).offsetParent !== null
};
q('#btnBatchMode').click();
await wait(400);
out.进多选后 = {
  body有sel类: document.body.classList.contains('sel'),
  复选框显示: !!q('#browseArea .cover .ck') && q('#browseArea .cover .ck').offsetParent !== null,
  模式按钮: (q('#btnBatchMode') || {}).textContent,
  全选可见: q('#btnSelectAll').style.display !== 'none',
  批量可见: q('#btnBatchDownload').style.display !== 'none',
  批量文案: (q('#btnBatchDownload') || {}).textContent
};

// —— 全选 ——
q('#btnSelectAll').click();
await wait(500);
out.全选后 = {
  选中卡片: selCards(),
  选择集合: st().sel.ids.size,
  all标志: st().sel.all,
  全选按钮: (q('#btnSelectAll') || {}).textContent,
  批量文案: (q('#btnBatchDownload') || {}).textContent
};

// —— 手动取消一个（点卡片 = 勾选切换） ——
const firstCard = q('#browseArea .card');
if (firstCard) firstCard.click();
await wait(300);
out.手动取消一个后 = {
  选中卡片: selCards(),
  选择集合: st().sel.ids.size,
  all标志: st().sel.all
};
q('#btnSelectAll').click();   // 再全选回来（此时 allOn=false → 补齐）
await wait(400);
out.补齐后 = { 选择集合: st().sel.ids.size, all标志: st().sel.all };

// —— 记下要下的清单（含本地状态，便于算「已安装跳过」） ——
const picked = (st().browse.items || []).filter(m => st().sel.ids.has(String(m.modId)));
const ids = picked.map(m => Number(m.modId));
const beforeIds = new Set(tasks().map(x => x.id));
let localMap = {};
try { const r = await window.api.nexus.localState(ids); localMap = (r && r.data) || {}; } catch {}
const expectedTodo = picked.filter(m => !(localMap[String(m.modId)] && localMap[String(m.modId)].state === 'installed'));
out.选中数 = picked.length;
out.其中已安装 = picked.length - expectedTodo.length;

// —— 批量下载 ——
q('#btnBatchDownload').click();
for (let i = 0; i < 240; i++) {   // 等跑批结束（busy 落下）
  await wait(250);
  if (!st().sel.busy) break;
}
await wait(800);
lap('批量下载完成');

const fresh = tasks().filter(x => !beforeIds.has(x.id));
out.新增任务数 = fresh.length;
out.期望新增上限 = expectedTodo.length;
out.任务样例 = fresh.slice(0, 3).map(x => ({
  modId: x.meta && x.meta.modId, fileId: x.meta && x.meta.fileId,
  fileName: (x.meta && x.meta.fileName || '').slice(0, 34),
  fileVersion: x.meta && x.meta.fileVersion, status: x.status
}));
out.全部钉住主文件 = fresh.length > 0 && fresh.every(x => x.meta && x.meta.fileId && x.meta.fileName);
out.全部待授权 = fresh.every(x => x.status === 'awaiting_authorization');

// 抽查：任务里的 fileId 是否就是该 mod 文件列表的第一个（主文件）
let checked = 0, matched = 0;
for (const x of fresh.slice(0, 6)) {
  try {
    const r = await window.api.nexus.files(x.meta.modId);
    const files = (r && r.data) || [];
    if (files.length) { checked++; if (Number(files[0].fileId) === Number(x.meta.fileId)) matched++; }
  } catch {}
}
out.fileId与第一个主文件一致 = matched + '/' + checked;
out.当前页 = (q('.page.on') || {}).id;

// —— 去重：同样的选择再跑一次，不该新增 ——
if (window.switchPage) window.switchPage('p-browse');
await wait(600);
q('#btnBatchMode').click(); await wait(200);
q('#btnSelectAll').click(); await wait(300);
const beforeIds2 = new Set(tasks().map(x => x.id));
q('#btnBatchDownload').click();
for (let i = 0; i < 160; i++) { await wait(250); if (!st().sel.busy) break; }
await wait(600);
out.二次运行新增 = tasks().filter(x => !beforeIds2.has(x.id)).length;
lap('去重验证');

// —— 清掉探针建的任务，别污染用户队列 ——
let removed = 0;
for (const x of tasks()) {
  if (beforeIds.has(x.id)) continue;
  try { await window.api.download.remove(x.id); removed++; } catch {}
}
await window.__dlActions.refreshDownloads().catch(() => {});
out.已清理任务 = removed;
out.清理后队列 = tasks().length;

// —— 回到浏览页摆好截图状态：多选开、勾几个 ——
if (window.switchPage) window.switchPage('p-browse');
await wait(600);
if (!st().sel.on) { q('#btnBatchMode').click(); await wait(200); }
q('#btnSelectAll').click(); await wait(400);
const cards = qa('#browseArea .card');
if (cards.length > 3) { cards[2].click(); cards[5] && cards[5].click(); await wait(200); }
out.截图状态 = { 选中卡片: selCards(), 批量文案: (q('#btnBatchDownload') || {}).textContent };

// 续命：软渲染 + 无焦点时 capturePage 会拿到旧帧
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  await wait(500);
  const body = q('#body');
  if (body) { const top = body.scrollTop; body.scrollTop = top + 1; body.scrollTop = top; }
}
lap('脚本结束');
return out;
