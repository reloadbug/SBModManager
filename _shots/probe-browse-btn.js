const wait = (ms) => new Promise(r => setTimeout(r, ms));
window.switchPage('p-browse');
for (let i = 0; i < 40; i++) { await wait(250); if (document.querySelectorAll('#browseArea .card').length) break; }
const btn1 = { text: (document.querySelector('#btnLoadMore') || {}).textContent, shown: !!(document.querySelector('#btnLoadMore') || {}).offsetParent };
// 换排序（reset）→ 应置顶
const el = document.querySelector('#body');
el.scrollTop = 800;
await wait(200);
window.__setSort && 0;
document.querySelector('#sortTabs button[data-sort="newest"]').click();
await wait(3000);
const btn2 = { text: (document.querySelector('#btnLoadMore') || {}).textContent, shown: !!(document.querySelector('#btnLoadMore') || {}).offsetParent };
return {
  有数据时按钮: btn1,
  换排序后置顶: Math.round(document.querySelector('#body').scrollTop),
  换排序后按钮: btn2,
  换排序后卡片数: document.querySelectorAll('#browseArea .card').length
};
