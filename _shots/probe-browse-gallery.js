// 截图探针：浏览页 → 打开一个 mod 的详情抽屉 → 等图集网格渲染出来
// 验的是「一个 mod 展示 5 张不同图片」，而不是一张图的 3 个尺寸。
//
// ⚠️ 浏览卡片是 `.card[data-modid]`（点卡片本体开抽屉），
//    不是 `[data-nexus]`（那是内嵌浏览器注入用的，浏览页一个都没有）。
//
// 跑法：
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe . \
//     --shot=_shots/browse-gallery.png --shot-page=p-browse \
//     --shot-eval-file=_shots/probe-browse-gallery.js --shot-delay=20000
//
// ⚠️ 整个脚本的执行预算必须小于 (shot-delay - 3000ms)，
//    否则 app.exit(0) 先跑，Promise 永远不结算，SHOT_EVAL 一行都不打。

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 1) 等浏览页把卡片渲染出来（最多 8 秒）
let cards = [];
for (let i = 0; i < 20; i++) {
  await wait(400);
  cards = [...document.querySelectorAll('.card[data-modid]')];
  if (cards.length) break;
}
if (!cards.length) return '浏览页没有卡片（网络或登录问题）';

const MOD_ID = '1252';
const card = cards.find(c => c.dataset.modid === MOD_ID) || cards[0];
const used = card.dataset.modid;
card.click();

// 2) 等图集网格（图集要开隐藏窗口抓 Nexus 页面，可能要 10 秒左右）
let imgs = 0;
let label = '';
for (let i = 0; i < 16; i++) {
  await wait(500);
  imgs = document.querySelectorAll('#galleryBox .imgrid img').length;
  const lb = document.querySelector('#galleryBox .lbl');
  if (lb) label = lb.textContent.trim();
  if (imgs) break;
  if (lb && /没能取到图集/.test(lb.textContent)) break;
}

const srcs = [...document.querySelectorAll('#galleryBox .imgrid img')].map(x => x.getAttribute('src'));
const uniq = new Set(srcs);
const names = [...uniq].map(s => decodeURIComponent(s.split('/').pop() || '').slice(-20));

return {
  modId: used, label, imgs, uniqSrc: uniq.size, names,
  drawerOpen: !!document.querySelector('#drawer.on'),
  heroKept: !!document.querySelector('#galleryBox img.hero')
};
