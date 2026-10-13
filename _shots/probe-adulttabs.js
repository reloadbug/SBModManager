const sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.switchPage && window.switchPage('p-browse');
await sleep(4500);
const box = document.querySelector('#adultTabs');
const cs = getComputedStyle(box);
const r = box.getBoundingClientRect();
const sortBox = document.querySelector('#sortTabs');
const rs = sortBox.getBoundingClientRect();
const b0 = box.querySelector('button');
const b0r = b0.getBoundingClientRect();
return {
  adultTabs: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  sortTabs: { x: Math.round(rs.x), y: Math.round(rs.y), w: Math.round(rs.width), h: Math.round(rs.height) },
  sameRow: Math.abs(r.y - rs.y) < 4,
  bg: cs.backgroundColor,
  border: cs.borderTopWidth + ' ' + cs.borderTopColor,
  radius: cs.borderRadius,
  display: cs.display,
  firstBtn: { text: b0.textContent.trim(), w: Math.round(b0r.width), bg: getComputedStyle(b0).backgroundColor },
  onBtnBg: getComputedStyle(box.querySelector('button.on')).backgroundColor
};
