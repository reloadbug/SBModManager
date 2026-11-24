// 截图脚本：打开「Blossom Butterfly Sexy JK Girl」（#4184）的详情抽屉，滚到「包内文件」那一段
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.switchPage('p-installed');
await sleep(900);
const inp = document.getElementById('instSearch');
if (inp) { inp.value = 'Blossom'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
await sleep(1200);
// 按卡片文字挑，别拿第一张（列表顺序会变）
const cards = Array.from(document.querySelectorAll('#p-installed .card'));
const card = cards.find(c => /Blossom Butterfly/i.test(c.textContent)) || cards[0];
if (!card) return { ok: false, why: '没找到卡片' };
card.click();
await sleep(3500);
const box = document.getElementById('drawerPkg');
const title = (document.querySelector('.drawer-title, #dTitle, .dtitle') || {}).textContent || '';
if (box) box.scrollIntoView({ block: 'center' });
await sleep(600);
return {
  ok: !!box,
  title: String(title).trim().slice(0, 40),
  rows: box ? box.querySelectorAll('.pf-row').length : 0,
  sum: box ? (box.querySelector('.pf-sum') || {}).textContent : '',
  chips: box ? Array.from(box.querySelectorAll('.pchip')).map(c => c.className + ':' + c.textContent).slice(0, 8) : [],
  missRows: box ? box.querySelectorAll('.pf-row.miss').length : 0,
  firstRows: box ? Array.from(box.querySelectorAll('.pf-row')).slice(0, 8).map(r => r.textContent.replace(/\s+/g, ' ').trim()) : []
};
