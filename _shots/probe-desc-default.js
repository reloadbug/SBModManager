// 默认显示 Nexus 原文说明 + 翻译提示保留；语言页签切换行为
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const qa = s => [...document.querySelectorAll(s)];
const out = {};
try {
  window.switchPage('p-browse');
  for (let i = 0; i < 40; i++) { await wait(250); if (qa('#browseArea .card').length) break; }

  const card = qa('#browseArea .card')[0];
  if (!card) return { 错误: '没有卡片' };
  const modId = Number(card.dataset.modid);
  out.modId = modId;
  window.openNexusDrawer(modId);
  for (let i = 0; i < 40; i++) {
    await wait(300);
    const box = q('#descBox');
    if (box && box.textContent.trim().length > 80) break;
  }

  const desc = q('#descBox');
  out.说明文字长度 = desc ? desc.textContent.trim().length : 0;
  out.说明前120字 = desc ? desc.textContent.trim().slice(0, 120) : '';
  out.有翻译提示 = !!(desc && desc.textContent.includes('点下方按钮把说明翻译成中文'));
  out.有翻译按钮 = !!q('#descBox [data-translate]');
  out.中文页签高亮 = !!q('.langsw button[data-lang="zh"].on');
  out.说明区高度 = desc ? Math.round(desc.getBoundingClientRect().height) : 0;

  // 切 English → 仍是原文、不带提示
  q('.langsw button[data-lang="en"]').click();
  await wait(300);
  const en = q('#descBox');
  out.English页 = {
    文字长度: en ? en.textContent.trim().length : 0,
    带提示: !!(en && en.textContent.includes('点下方按钮把说明翻译成中文')),
    带按钮: !!q('#descBox [data-translate]')
  };
  // 切回中文 → 原文 + 提示
  q('.langsw button[data-lang="zh"]').click();
  await wait(300);
  const zh = q('#descBox');
  out.回中文页 = {
    文字长度: zh ? zh.textContent.trim().length : 0,
    带提示: !!(zh && zh.textContent.includes('点下方按钮把说明翻译成中文')),
    带按钮: !!q('#descBox [data-translate]')
  };
  out.页签文案 = qa('.langsw button').map(b => b.textContent.trim() + (b.className.includes('on') ? '(选中)' : ''));

  // 防「过期帧」：软渲染 + 窗口没焦点时合成器可能不出新帧，capturePage 会拍到
  // 还没打开抽屉的旧画面。每隔 500ms 轻推一次 DOM，把重绘续到截图前一刻。
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await wait(500);
    const body = q('#dBody');
    if (body) { const top = body.scrollTop; body.scrollTop = top + 1; body.scrollTop = top; }
  }
  await wait(300);
  return out;
} catch (e) { return Object.assign(out, { 报错: (e && (e.stack || e.message)) || String(e) }); }
