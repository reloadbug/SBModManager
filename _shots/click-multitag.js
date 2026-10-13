// 验证多标签（并集）+ 清除筛选
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const txt = (el) => el ? el.textContent.trim() : null;
const q = (s) => document.querySelector(s);
window.switchPage && window.switchPage('p-browse');
await sleep(4000);

const snapshot = {};
q('button[data-cat="Outfits"]').click();
await sleep(3000);

q('button[data-tag="Textures"]').click();
await sleep(3000);
snapshot.oneTag = txt(q('#browseStats'));

q('button[data-tag="Replacer"]').click();
await sleep(3000);
snapshot.twoTags = txt(q('#browseStats'));
snapshot.onChips = [...document.querySelectorAll('#browseFilters .fc.on')].map(x => x.textContent.trim());

q('button[data-tag="Textures"]').click();
await sleep(3000);
snapshot.afterToggleOff = txt(q('#browseStats'));

const clear = q('#btnClearFilter');
snapshot.clearBtnExists = !!clear;
if (clear) {
  clear.click();
  await sleep(3000);
  snapshot.afterClear = txt(q('#browseStats'));
  snapshot.chipsAfterClear = [...document.querySelectorAll('#browseFilters .fc.on')].map(x => x.textContent.trim());
}

// 收尾：选回「服装 + 材质 + 替换」，让截图停在双标签并集状态
q('button[data-cat="Outfits"]').click();
await sleep(2500);
q('button[data-tag="Textures"]').click();
await sleep(2500);
q('button[data-tag="Replacer"]').click();
await sleep(3000);
return snapshot;
