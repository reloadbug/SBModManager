// 截图用：切到「已安装」页，在搜索框里填 Blossom，让 4184 那套单独显示，
// 顺便把卡片数量报出来（确认它只有一张卡、文件 7 个）。
if (window.switchPage) window.switchPage('p-installed');
await new Promise(r => setTimeout(r, 900));
const box = document.getElementById('instSearch');
if (box) {
  box.value = 'Blossom';
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
await new Promise(r => setTimeout(r, 900));
const cards = [...document.querySelectorAll('#p-installed .card')]
  .filter(c => !c.hidden && /Blossom|Kamenlaideng/i.test(c.textContent || ''));
return {
  cards: cards.length,
  texts: cards.map(c => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90))
};
