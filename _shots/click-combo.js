// 三态 + 分类 + 标签 组合验证，并停在组合态供截图
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const txt = (el) => el ? el.textContent.trim() : null;
window.switchPage && window.switchPage('p-browse');
await sleep(4500);

const snap = {};
q('#adultTabs button[data-adult="all"]').click();
await sleep(4000);

q('button[data-cat="Outfits"]').click();
await sleep(4000);
snap.outfitsAll = txt(q('#browseStats'));

q('button[data-tag="Textures"]').click();
await sleep(4000);
snap.outfitsTexturesAll = txt(q('#browseStats'));

q('#adultTabs button[data-adult="only"]').click();
await sleep(5000);
snap.outfitsTexturesOnly = txt(q('#browseStats'));
snap.onChips = [...document.querySelectorAll('#browseFilters .fc.on')].map(x => x.textContent.trim());
snap.onAdult = [...document.querySelectorAll('#adultTabs button.on')].map(x => x.textContent.trim());
snap.cards = document.querySelectorAll('#browseArea .card').length;

// 校验卡片确实都带成人角标且分类是服装
snap.cardsWithAdultBadge = document.querySelectorAll('#browseArea .card .tag').length;
snap.cardsWithCatBadge = [...document.querySelectorAll('#browseArea .card .cat')].map(x => x.textContent.trim());
snap.uniqueCats = [...new Set(snap.cardsWithCatBadge)];
return snap;
