// 第 4 条：详情抽屉打开后，点空白处（遮罩）自动关闭。
// 用法：node _probe/launch.js --shot=_shots/ui26-mask.png --shot-eval-file=_shots/eval-ui26-mask.js --shot-delay=11000
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 等已安装列表渲染出来
for (let i = 0; i < 40; i++) {
  if (document.querySelectorAll('#installedArea .grid .card').length) break;
  await sleep(250);
}
await sleep(600);

const out = {};
out.cards = document.querySelectorAll('#installedArea .grid .card').length;

const card = document.querySelector('#installedArea .grid .card');
card.click();
await sleep(900);

const drawer = document.getElementById('drawer');
const mask = document.getElementById('drawerMask');
out.afterOpen = {
  drawerOn: drawer.classList.contains('on'),
  maskOn: mask.classList.contains('on'),
  maskVisible: getComputedStyle(mask).display !== 'none',
  maskCovers: (() => { const r = mask.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  title: (document.getElementById('dTitle') || {}).textContent || ''
};
out.maskZ = getComputedStyle(mask).zIndex;
out.drawerZ = getComputedStyle(drawer).zIndex;

// 点遮罩（= 点抽屉外的空白处）
mask.click();
await sleep(500);
out.afterMaskClick = {
  drawerOn: drawer.classList.contains('on'),
  maskOn: mask.classList.contains('on'),
  maskVisible: getComputedStyle(mask).display !== 'none'
};

// 再开一次，确认不是「一次性」的。
// ⚠️ 必须**重新查**卡片：列表会被 `scheduleCardStateRefresh()` 重绘成新节点，
//    攥着旧节点 click() 点的是已脱离文档的副本，什么都不会发生（实测踩过）。
document.querySelector('#installedArea .grid .card').click();
await sleep(800);
out.reopened = drawer.classList.contains('on') && mask.classList.contains('on');

// 顺手验一下 ✕ 也还关着
document.getElementById('dClose').click();
await sleep(400);
out.afterXClick = { drawerOn: drawer.classList.contains('on'), maskOn: mask.classList.contains('on') };

// 截图前把抽屉再打开，让截图里有「抽屉 + 遮罩」的样子
document.querySelector('#installedArea .grid .card').click();
await sleep(800);
out.final = { drawerOn: drawer.classList.contains('on'), maskOn: mask.classList.contains('on') };

return out;
