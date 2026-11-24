/* 详情页三件事的现场取证（用户 2026-11-24 报的三个问题）
 * 1. 详情页点「子 Mod 安装」后，页面状态没刷新 —— 复现并记录刷新前后 DOM
 * 2. 包内文件列表里「已安装」标签显示不全 —— 量各列宽度与是否被裁
 * 3. 详情页按钮尺码不统一 —— 量每个按钮的高/宽/字号
 */
const modId = 4184;
const dir = 'Breast and Hip_Physics';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const rows = () => Array.from(document.querySelectorAll('.sf-row')).map(r => (r.textContent || '').replace(/\s+/g, ' ').trim());
const states = () => Array.from(document.querySelectorAll('.pf-row')).map(r => {
  const st = r.querySelector('.pf-st');
  return { st: st ? st.textContent.trim() : '', clipped: st ? (st.scrollWidth > st.clientWidth + 1) : false };
});

// 先把「物理特效」那一套卸掉，让抽屉里出现「安装」按钮
await window.api.mods.uninstallSub({ modId, dir });
if (window.refreshAfterModsChanged) await window.refreshAfterModsChanged();
await wait(1200);

if (window.switchPage) window.switchPage('p-installed');
await wait(600);
const box = document.getElementById('instSearch');
if (box) { box.value = 'Blossom'; box.dispatchEvent(new Event('input', { bubbles: true })); }
let cards = [];
for (let i = 0; i < 40; i++) {
  cards = Array.from(document.querySelectorAll('#p-installed .card'));
  if (cards.length) break;
  await wait(300);
}
const card = cards.find(c => /Blossom|Kamenlaideng/i.test(c.textContent || ''));
if (!card) return { ok: false, why: '没找到卡片' };
card.click();
await wait(2500);

const before = { rows: rows(), states: states() };

// ① 点「安装」按钮（真实点击，走渲染层的点击委托）
const installBtn = document.querySelector('[data-sub-install]');
if (!installBtn) return { ok: false, why: '没有「安装」按钮', before, rowsNow: rows() };
installBtn.click();
await wait(4500);
const afterClick = { rows: rows(), states: states() };

// ② 量表格各列是否被裁
const widthProbe = (() => {
  const row = document.querySelector('.pf-row');
  if (!row) return null;
  const wrap = document.querySelector('.pf-rows');
  const cols = Array.from(row.children).map(el => ({
    cls: el.className,
    w: Math.round(el.getBoundingClientRect().width),
    need: el.scrollWidth,
    clipped: el.scrollWidth > el.clientWidth + 1
  }));
  return {
    wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : 0,
    rowW: Math.round(row.getBoundingClientRect().width),
    rowScroll: row.scrollWidth,
    cols
  };
})();

// ③ 量按钮尺码
const buttons = Array.from(document.querySelectorAll('#drawerMarks .btn, #drawerPrimary .btn, #dFoot .btn, .sf-row .btn'))
  .map(b => {
    const cs = getComputedStyle(b);
    return {
      txt: (b.textContent || '').trim().slice(0, 10),
      where: b.closest('#drawerMarks') ? 'marks' : (b.closest('#drawerPrimary') ? 'primary' : (b.closest('#dFoot') ? 'foot' : 'sub')),
      h: Math.round(b.getBoundingClientRect().height),
      w: Math.round(b.getBoundingClientRect().width),
      fs: cs.fontSize,
      pad: cs.padding,
      radius: cs.borderRadius
    };
  });

return { ok: true, before, afterClick, widthProbe, buttons };
