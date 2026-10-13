// 截图前驱动：切到浏览页 → 依次点「全部内容」「只显示成人内容」→ 停在仅成人态
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const txt = (el) => el ? el.textContent.trim() : null;
window.switchPage && window.switchPage('p-browse');
await sleep(4500);

const snap = {};
snap.tabs = [...document.querySelectorAll('#adultTabs button')].map(b => b.textContent.trim() + (b.classList.contains('on') ? '*' : ''));
snap.defaultStats = txt(q('#browseStats'));

// 全部内容
q('#adultTabs button[data-adult="all"]').click();
await sleep(4000);
snap.allStats = txt(q('#browseStats'));

// 只显示成人内容
q('#adultTabs button[data-adult="only"]').click();
await sleep(5000);
snap.onlyStats = txt(q('#browseStats'));
snap.onNow = [...document.querySelectorAll('#adultTabs button.on')].map(b => b.textContent.trim());
snap.cards = document.querySelectorAll('#browseArea .card').length;
snap.adultBadges = document.querySelectorAll('#browseArea .card .tag').length;

// 再切回隐藏成人，确认能回来
q('#adultTabs button[data-adult="hide"]').click();
await sleep(4000);
snap.backToHide = txt(q('#browseStats'));

// 停在仅成人态供截图
q('#adultTabs button[data-adult="only"]').click();
await sleep(5000);
snap.finalStats = txt(q('#browseStats'));
return snap;
