// 第 3 条 B：「⇄ 对比」弹窗 —— 左右并列已装的 / 要装的，尤其是图片。
// 用法：node _probe/launch.js --shot=_shots/ui26-cmp.png --shot-eval-file=_shots/eval-ui26-cmp.js --shot-delay=16000
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < 40; i++) {
  if (document.querySelectorAll('#installedArea .grid .card').length) break;
  await sleep(250);
}
await sleep(600);

const cards = [...document.querySelectorAll('#installedArea .grid .card')];
const withMid = cards.filter(c => c.querySelector('.chip.mid'));
const c = withMid[0] || cards[0];
const oldModId = Number(((c.querySelector('.chip.mid') || {}).textContent || '').replace(/[#\s]/g, ''));
const oldName = (c.querySelector('h3') || {}).textContent || '';

// 「要装进去的那一份」的元数据 —— 真实场景由下载任务带来
state.cmpIncoming = {
  modId: 3970,
  name: 'Cyber Suit - Minervha (NEW)',
  version: '1.4',
  author: 'Minervha',
  fileName: 'Cyber_Suit_Minervha_v1.4.7z',
  images: []
};

await openCmpModal(oldModId, oldName);

// 等旧 Mod 的文件清单 / 图集拉完
for (let i = 0; i < 60; i++) {
  const box = document.getElementById('cmpOldFiles');
  if (box && !/正在读取/.test(box.textContent || '')) break;
  await sleep(250);
}
await sleep(600);

const modal = document.getElementById('modal');
const out = {
  oldModId, oldName,
  modalOpen: modal.classList.contains('on'),
  title: (document.getElementById('mTitle') || {}).textContent || '',
  cols: [...modal.querySelectorAll('.cmpcol')].map(col => ({
    side: col.classList.contains('old') ? 'old' : 'new',
    head: (col.querySelector('h4') || {}).textContent || '',
    name: (col.querySelector('.cmp-name') || {}).textContent || '',
    kvs: [...col.querySelectorAll('.cmp-kv')].map(kv => kv.textContent.replace(/\s+/g, ' ').trim()),
    face: (() => {
      const f = col.querySelector('.cmp-face');
      if (!f) return null;
      return { tag: f.tagName, cls: f.className, src: f.getAttribute('src') || null,
        w: f.getBoundingClientRect().width | 0 };
    })(),
    files: (col.querySelector('.cmp-files') || {}).textContent || ''
  })),
  faceCount: modal.querySelectorAll('.cmp-face').length,
  imgCount: modal.querySelectorAll('.cmp-face img').length,
  galleryImgs: modal.querySelectorAll('.cmpcol.old img').length,
  btns: [...modal.querySelectorAll('#mFoot button')].map(b => b.textContent.trim()),
  modalH: modal.querySelector('.mbox') ? Math.round(modal.querySelector('.mbox').getBoundingClientRect().height) : null
};

// 截图前确保弹窗完整在视口内
const box = modal.querySelector('.mbox');
if (box && box.scrollHeight > box.clientHeight) box.scrollTop = 0;

return out;
