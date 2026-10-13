// 浏览页：滚到底续加载 + 切页保留位置
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const b = () => ({
  items: (window.state && window.state.browse && window.state.browse.items || []).length,
  total: (window.state && window.state.browse && window.state.browse.total) || 0,
  loading: !!(window.state && window.state.browse && window.state.browse.loading),
  stats: (document.querySelector('#browseStats') || {}).textContent || '',
  cards: document.querySelectorAll('#browseArea .card').length,
  bodyTop: Math.round(document.querySelector('#body').scrollTop),
  bodyH: Math.round(document.querySelector('#body').scrollHeight)
});
window.switchPage('p-browse');
for (let i = 0; i < 40; i++) { await wait(250); if (b().cards > 0) break; }
const t0 = b();
// 滚到底
const el = document.querySelector('#body');
el.scrollTop = el.scrollHeight;
await wait(2500);
const t1 = b();
// 切走再切回
window.switchPage('p-installed');
await wait(400);
window.switchPage('p-browse');
await wait(700);
const t2 = b();
return { 初始: t0, 滚到底后: t1, 切回后: t2 };
