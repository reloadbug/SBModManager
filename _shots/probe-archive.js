// 「已安装 Mod：显示 Mod ID + 一键定位原压缩包」验证（用户 2026-10-13 要求）。
//
// 一次跑三件事：
//   ① 卡片上有没有 `#<modId>` 徽标、版本号有没有拼成 `vv2.3`；
//   ② 打开抽屉后「信息」里有没有 Mod ID 行、「原压缩包」区块长什么样；
//   ③ 点「在资源管理器中定位」时，点击有没有带着正确的路径走到委托层。
await new Promise(r => setTimeout(r, 5000));

const out = {};

// ⚠️ 必须在**任何点击之前**挂上捕获阶段拦截器：
//    不能改 `window.api.revealPath` 做记账 —— contextBridge 暴露的对象是**冻结**的，
//    赋值静默失败 → 拿到空数组「假失败」，而真实调用已经把资源管理器弹出来了。
//    改成捕获阶段记下 data-reveal-path 后 stopPropagation，
//    后面 document 上的委托 handler 就不会执行（不真开窗口）。
const revealed = [];
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('[data-reveal-path]');
  if (!el) return;
  revealed.push(el.dataset.revealPath);
  e.stopPropagation();
  e.preventDefault();
}, true);

// 已安装页是第一页，正常就在显示
const cards = [...document.querySelectorAll('#installedArea .grid .card')];
out.cardCount = cards.length;

// ---- ① 卡片徽标 ----
out.cardChips = cards.slice(0, 4).map(c => {
  const meta = c.querySelector('.meta');
  return {
    title: (c.querySelector('h3') || {}).textContent || '',
    text: meta ? meta.textContent.replace(/\s+/g, ' ').trim() : '',
    mid: (c.querySelector('.chip.mid') || {}).textContent || null
  };
});
out.cardsWithMid = cards.filter(c => c.querySelector('.chip.mid')).length;
out.hasDoubleV = cards.some(c => /(^|\s)vv/i.test(c.querySelector('.meta') ? c.querySelector('.meta').textContent : ''));

// ---- ② 抽屉 ----
const first = cards.find(c => c.querySelector('.chip.mid')) || cards[0];
if (!first) return { ...out, err: '已安装列表是空的' };

first.click();
await new Promise(r => setTimeout(r, 900));

const dBody = document.getElementById('dBody');
const dFoot = document.getElementById('dFoot');
const kvs = [...dBody.querySelectorAll('.kv')].map(kv => {
  const sp = kv.querySelectorAll('span');
  return { k: (sp[0] || {}).textContent || '', v: (sp[1] || {}).textContent || '' };
});
const labels = [...dBody.querySelectorAll('.lbl')].map(x => x.textContent.trim());

out.drawer = {
  title: (document.getElementById('dTitle') || {}).textContent || '',
  sub: (document.getElementById('dSub') || {}).textContent || '',
  kvKeys: kvs.map(x => x.k),
  modIdRow: (kvs.find(x => x.k === 'Mod ID') || {}).v || null,
  hasArchiveLabel: labels.includes('原压缩包'),
  archiveBox: (() => {
    const box = dBody.querySelector('.urlbox');
    if (!box) return null;
    const btn = box.querySelector('button');
    const note = box.nextElementSibling;
    return {
      file: (box.querySelector('span') || {}).textContent || '',
      btn: btn ? btn.textContent.trim() : null,
      btnDisabled: btn ? btn.disabled : null,
      revealPath: btn ? (btn.dataset.revealPath || null) : null,
      note: note ? note.textContent.replace(/\s+/g, ' ').trim() : null
    };
  })(),
  footBtns: [...dFoot.querySelectorAll('button')].map(b => b.textContent.trim()),
  archiveFootBtn: !!dFoot.querySelector('[data-reveal-path]')
};

// ---- ③ 点「在资源管理器中定位」（抽屉正文 + 抽屉底栏各一次）----
const arcBtn = dBody.querySelector('.urlbox button[data-reveal-path]');
if (arcBtn) { arcBtn.click(); await new Promise(r => setTimeout(r, 250)); }
const footArc = dFoot.querySelector('[data-reveal-path]');
if (footArc) { footArc.click(); await new Promise(r => setTimeout(r, 250)); }
out.clicked = {
  revealed,
  count: revealed.length,
  sameAsBox: revealed[0] === (out.drawer.archiveBox || {}).revealPath
};

// ---- ④ 再看一个「安装包确实在 data/library 里」的 mod（CNS 那条是手动导入的）----
//    用户要的就是「library 里的原压缩包」，得确认这条路径的文案与按钮也对。
const libCard = cards.find(c => {
  const t = (c.querySelector('.meta') || {}).textContent || '';
  return /#\d+/.test(t) && !/前置/.test((c.querySelector('.tag') || {}).textContent || '');
});
if (libCard && libCard !== first) {
  document.getElementById('dClose')?.click?.();
  await new Promise(r => setTimeout(r, 350));
  libCard.click();
  await new Promise(r => setTimeout(r, 900));
  const box2 = document.getElementById('dBody').querySelector('.urlbox');
  const btn2 = box2 && box2.querySelector('button');
  out.libraryMod = {
    title: (document.getElementById('dTitle') || {}).textContent || '',
    file: box2 ? (box2.querySelector('span') || {}).textContent || '' : null,
    note: box2 && box2.nextElementSibling ? box2.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : null,
    revealPath: btn2 ? (btn2.dataset.revealPath || null) : null
  };
  if (btn2) { btn2.click(); await new Promise(r => setTimeout(r, 250)); }
  out.clicked.revealed = revealed;
  out.clicked.count = revealed.length;
}

// 截图前把「原压缩包」滚进视野 —— 不然它落在抽屉可视区下方，截图里看不见。
// ⚠️ 用 `#dBody.scrollTop` 精确滚动，不要用 `scrollIntoView()` ——
//    后者会连**外层** `.body` 一起滚，把主列表也推走，画面看着像「抽屉没开」。
{
  const body = document.getElementById('dBody');
  const labels = [...body.querySelectorAll('.lbl')];
  const arcLbl = labels.find(x => x.textContent.trim() === '原压缩包');
  if (arcLbl) {
    body.scrollTop = Math.max(0, arcLbl.offsetTop - 24);
    await new Promise(r => setTimeout(r, 400));
  }
}

// 截图停在抽屉打开的状态
out.finalDrawerOpen = document.getElementById('drawer').classList.contains('on');
out.finalTitle = (document.getElementById('dTitle') || {}).textContent || '';
out.scrollTop = document.getElementById('dBody').scrollTop;
return out;
