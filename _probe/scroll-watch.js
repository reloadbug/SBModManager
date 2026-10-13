// 把「下载目录监听」区块滚到视口中间，供 --shot-eval-file 截图用。
// 设置页的滚动发生在一个内层容器上，window.scrollTo 无效 —— 这里自己找滚动祖先。
const el = document.querySelector('#setWatchEnabled');
if (!el) return 'not found';

let node = el.parentElement;
let scroller = null;
while (node) {
  const st = getComputedStyle(node);
  if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 20) {
    scroller = node;
    break;
  }
  node = node.parentElement;
}
if (!scroller) return 'no scroller';

const target = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  + scroller.scrollTop - scroller.clientHeight / 2;
scroller.scrollTop = Math.max(0, target);
await new Promise(r => setTimeout(r, 800));
return 'scrolled ' + Math.round(scroller.scrollTop) + ' / ' + scroller.scrollHeight;
