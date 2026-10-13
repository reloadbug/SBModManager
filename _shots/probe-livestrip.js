// 验证「已安装 Mod」页顶部的待确认提示（不点按钮，只截图）
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 等 liveStrip 出现（downloads 数据加载完）
for (let i = 0; i < 30; i++) {
  if (document.querySelector('.live .li')) break;
  await wait(400);
}
await wait(600);

const strip = document.querySelector('.live');
const info = strip ? strip.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '没有 liveStrip';
const revRow = document.querySelector('.live .li.rev');
return 'liveStrip: ' + info +
  '\n有 rev 行: ' + (revRow ? '是' : '否') +
  '\n转圈元素: ' + (strip && strip.querySelector('.spin') ? '有(不该有)' : '无 ✓') +
  '\n去处理按钮: ' + (document.querySelector('.live .li.rev [data-dl-confirm]') ? '有 ✓' : '无');
