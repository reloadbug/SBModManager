// 搜索一个「已下载待安装」的 mod（modId 692），验证卡片上的「↓ 已下载」标记
// 时序：--shot-eval 在 3000ms 执行；总耗时必须 < delay - 3000
// 结尾要**切回浏览页再截图** —— 期间可能有 nxm:// 事件把界面切到下载页（实测踩过）

// 1) 等浏览页首批卡片渲染出来（避免初始 loadBrowse 还在跑时把搜索吞掉）
for (let i = 0; i < 20; i++) {
  if (document.querySelectorAll('#browseArea .card').length > 0) break;
  await new Promise(r => setTimeout(r, 400));
}

// 2) 往搜索框输入并触发 input（走真实的防抖路径）
const inp = document.querySelector('#searchInput');
inp.value = 'Eve BP Nude';
inp.dispatchEvent(new Event('input', { bubbles: true }));

// 3) 等搜索结果出来
await new Promise(r => setTimeout(r, 6000));

// 4) 报告卡片数与状态徽章，便于日志核对
const cards = [...document.querySelectorAll('#browseArea .card')];
const marks = cards.map(c => {
  const lb = c.querySelector('.lb');
  const btn = c.querySelector('.btn.sm');
  const h3 = c.querySelector('h3');
  return (h3 ? h3.textContent.slice(0, 34) : '?') + ' | ' + (lb ? lb.textContent : '无徽章') + ' | ' + (btn ? btn.textContent : '无按钮');
});
const report = '卡片=' + cards.length + '\n' + marks.join('\n');

// 5) 确保停在浏览页（可能被实时 nxm:// 事件切走了）
switchPage('p-browse');
await new Promise(r => setTimeout(r, 1500));

return report + '\n当前页=' + (document.querySelector('.page.on') || {}).id;
