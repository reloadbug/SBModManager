// 「只显示未安装」筛选的端到端实测。
// 步骤：等浏览页出卡片 → 记录已安装/已下载标记数 → 打开开关 →
//       校验列表里不再有「✓ 已安装」、统计行带「只看未安装」、开关高亮 →
//       续命循环保帧 → 截图（保持开启态，退出即焚，不写盘）。
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const qa = s => [...document.querySelectorAll(s)];
const out = {};
const T0 = Date.now();
const lap = (k) => { out[k] = ((Date.now() - T0) / 1000).toFixed(1) + 's'; };
const st = () => window.__state.browse;
const okBadges = () => qa('#browseArea .lb.ok').length;
const dlBadges = () => qa('#browseArea .lb.dl').length;

// 浏览页是懒加载的（refreshAll 不拉它）—— 先显式切过去，否则等到天荒地老也没卡片
out.初始页 = (q('.page.on') || {}).id || null;
if (window.switchPage) window.switchPage('p-browse');
for (let i = 0; i < 40 && !qa('#browseArea .card').length; i++) await wait(500);
lap('等卡片');
await wait(2500);   // 本地状态是异步装饰的（切到浏览页才发 IPC）
lap('等本地状态');

out.筛选前 = {
  卡片数: qa('#browseArea .card').length,
  已安装标记: okBadges(),
  已下载标记: dlBadges()
};
out.筛选前统计行 = (q('#browseStats') || {}).textContent.trim();

// 第一屏没有已安装标记就再翻一屏（按下载量排序，前 24 个可能刚好都没装）
if (!out.筛选前.已安装标记) {
  const body = q('#body');
  if (body) { body.scrollTop = 1400; }
  await wait(3500);
  out.滚动一屏后 = { 已安装标记: okBadges(), 已下载标记: dlBadges() };
}

const sw = q('#newOnlyTabs button[data-onlynew]');
out.开关存在 = !!sw;
out.开关默认文案 = sw ? sw.textContent.trim() : null;
if (sw) sw.click();

// 等这次加载彻底结束（开了筛选可能会连翻好几页，loading 会一直挂着）
const genBefore = st().gen;
for (let i = 0; i < 60; i++) {
  await wait(250);
  if (!st().loading && st().gen !== genBefore) break;
}
await wait(1000);
lap('筛选加载完成');

out.筛选后 = {
  卡片数: qa('#browseArea .card').length,
  已安装标记: okBadges(),          // 必须是 0：装过的全被剔掉
  已下载标记: dlBadges(),          // 只筛「已安装」，已下载/安装中仍显示
  服务端偏移: st().offset,
  总数: st().total,
  请求代数: st().gen
};
out.筛选后统计行 = (q('#browseStats') || {}).textContent.trim();
out.开关高亮 = !!q('#newOnlyTabs button.on');
out.加载更多按钮 = (q('#btnLoadMore') || {}).textContent.trim() || '(隐藏)';

// 续命：软渲染 + 无焦点时 capturePage 会拿到旧帧。每 500ms 轻推一次滚动，
// 把重绘续到截图前一刻（配合 --shot-delay=32000）。
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  await wait(500);
  const body = q('#body');
  if (body) { const top = body.scrollTop; body.scrollTop = top + 1; body.scrollTop = top; }
}
lap('脚本结束');
return out;
