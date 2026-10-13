// 吸顶验证：滚下去之后，浏览页头部是否还贴在滚动容器顶部。
// 用法（配合 --shot-eval-file）：
//   node _probe/launch.js --compat --shot=_shots/bhead.png --shot-page=p-browse \
//     --shot-eval-file=_shots/probe-bhead.js --shot-delay=11000
await new Promise(r => setTimeout(r, 5000));   // 等列表从 Nexus 拉回来
const el = document.getElementById('body');
el.scrollTop = 1500;
await new Promise(r => setTimeout(r, 800));

const head = document.querySelector('#p-browse .bhead');
const hr = head ? head.getBoundingClientRect() : null;
const br = el.getBoundingClientRect();
const bar = document.querySelector('#p-browse .toolbar');
const barR = bar ? bar.getBoundingClientRect() : null;
return {
  scrollTop: el.scrollTop,
  cards: document.querySelectorAll('#browseArea .card').length,
  bodyTop: Math.round(br.top),
  headTop: hr ? Math.round(hr.top) : null,
  // 贴住 = head 顶边与滚动容器顶边重合（允许 2px 误差）
  sticky: hr ? Math.abs(hr.top - br.top) < 2 : false,
  toolbarVisible: barR ? barR.bottom > br.top : false,
  blockTabs: !!document.getElementById('blockTabs'),
  dislikeBtns: document.querySelectorAll('[data-dislike]').length,
  blockMode: window.__state ? undefined : undefined
};
