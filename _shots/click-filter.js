// 截图前驱动界面：切到浏览页 → 点「服装」分类 → 再点一个标签 → 等结果回来
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.switchPage && window.switchPage('p-browse');
await sleep(4500);

const cat = document.querySelector('button[data-cat="Outfits"]');
if (!cat) return { error: '找不到「服装」分类按钮', chips: document.querySelectorAll('#browseFilters button').length };
cat.click();
await sleep(5000);

const tag = document.querySelector('button[data-tag="Textures"]');
if (tag) { tag.click(); await sleep(5000); }

return {
  category: document.querySelector('.fc.on') ? document.querySelector('.fc.on').textContent.trim() : null,
  stats: document.querySelector('#browseStats').textContent.trim(),
  cards: document.querySelectorAll('#browseArea .card').length
};
