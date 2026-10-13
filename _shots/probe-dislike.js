// 「不喜欢」+「只看黑名单」验证。
// ⚠️ IPC 返回值是 `{ok, data}` 包装（`call()` 会解包），探针里要自己 unwrap，
//    否则 `Array.isArray(ids)` 恒为 false —— 会得到「假通过」。
// 探针结尾会**自己撤销**，不留垃圾在用户的 data/blacklist.json 里。
const unwrap = (r) => (r && typeof r === 'object' && 'ok' in r ? r.data : r);

await new Promise(r => setTimeout(r, 5000));
const btn = document.querySelector('#browseArea [data-dislike]');
if (!btn) return { err: '页面上没有「不喜欢」按钮' };

const id = Number(btn.dataset.dislike);
const card = btn.closest('.card');
const name = card ? card.querySelector('h3').textContent : '';
const before = document.querySelectorAll('#browseArea .card').length;
const statsBefore = document.getElementById('browseStats').textContent;

// ---- 点「不喜欢」----
btn.click();
await new Promise(r => setTimeout(r, 1500));

const after = document.querySelectorAll('#browseArea .card').length;
const gone = !document.querySelector(`.card[data-modid="${id}"]`);
const statsAfter = document.getElementById('browseStats').textContent;
const toast = (document.getElementById('toast') || {}).textContent || '';
const ids = unwrap(await window.api.blacklist.ids());
const persisted = Array.isArray(ids) && ids.includes(id);

// ---- 切到「只看黑名单」----
const onlyBtn = document.querySelector('#blockTabs button[data-block="only"]');
onlyBtn.click();
await new Promise(r => setTimeout(r, 1600));
const onlyCards = [...document.querySelectorAll('#browseArea .card')].map(c => Number(c.dataset.modid));
const onlyHasIt = onlyCards.includes(id);
const onlyStats = document.getElementById('browseStats').textContent;
const undislikeBtns = document.querySelectorAll('#browseArea [data-undislike]').length;

// ---- 切回「隐藏黑名单」----
document.querySelector('#blockTabs button[data-block="hide"]').click();
await new Promise(r => setTimeout(r, 1200));

// ---- 撤销（不污染用户黑名单）----
await window.api.blacklist.remove(id);
const after2 = unwrap(await window.api.blacklist.ids());
const cleaned = Array.isArray(after2) && !after2.includes(id);

return { id, name, before, after, gone, persisted, cleaned,
  statsBefore, statsAfter, toast, onlyHasIt, onlyCards, onlyStats, undislikeBtns };
