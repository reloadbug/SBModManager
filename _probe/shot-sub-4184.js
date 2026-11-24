/* 打开 4184 的详情抽屉，看「子 Mod」那一块的样子（只读，不动文件） */
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  if (window.switchPage) window.switchPage('p-installed');
  await wait(500);
  const box = document.getElementById('instSearch');
  if (box) {
    box.value = 'Blossom';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // 等列表渲染出来（扫描有快有慢，不能靠固定等待）
  let cards = [];
  for (let i = 0; i < 40; i++) {
    cards = Array.from(document.querySelectorAll('#p-installed .card'));
    if (cards.length) break;
    await wait(300);
  }
  await wait(400);
  const card = cards.find(c => /Blossom|Kamenlaideng/i.test(c.textContent || ''));
  if (!card) return { ok: false, why: '没找到卡片', cards: cards.length };
  card.click();
  await wait(1200);
  const pkg = document.getElementById('drawerPkg');
  if (pkg) pkg.scrollIntoView({ block: 'center' });
  await wait(400);
  const rows = Array.from(document.querySelectorAll('.sf-row')).map(r => ({
    text: (r.textContent || '').replace(/\s+/g, ' ').trim(),
    hasInstall: !!r.querySelector('[data-sub-install]'),
    hasUninstall: !!r.querySelector('[data-sub-uninstall]')
  }));
  const pf = Array.from(document.querySelectorAll('.pf-row')).map(r => (r.textContent || '').replace(/\s+/g, ' ').trim());
  return { ok: true, rows, pfCount: pf.length, pf: pf.slice(0, 8), sum: (document.querySelector('.pf-sum') || {}).textContent || '' };
