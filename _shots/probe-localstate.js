// 验证「本地状态」按钮的 DOM 契约：taskId / 跳页属性是否齐全
// 时序：--shot-eval 在 3000ms 执行；总耗时必须 < delay - 3000

const rep = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const setSearch = async (kw) => {
  const inp = document.querySelector('#searchInput');
  inp.value = kw;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(6000);
};

// 等首批卡片
for (let i = 0; i < 20; i++) {
  if (document.querySelectorAll('#browseArea .card').length > 0) break;
  await wait(400);
}

// 报告初始成人三态（默认应为「隐藏成人内容」）
rep.push('初始成人模式=' + ([...document.querySelectorAll('#adultTabs button.on')].map(b => b.textContent.trim())[0] || '无'));

// 待验证的 mod 是成人内容 —— 先切到「只显示成人内容」，否则搜不到
const onlyBtn = [...document.querySelectorAll('#adultTabs button')].find(b => b.textContent.includes('只显示'));
if (onlyBtn) onlyBtn.click();
await wait(6000);

// 1) 已下载 → 按钮应带 data-local-install=<taskId>
await setSearch('Eve BP Nude');
const dlBtn = document.querySelector('#browseArea [data-local-install]');
const dlBadge = document.querySelector('#browseArea .lb.dl');
rep.push('【已下载】徽章=' + (dlBadge ? dlBadge.textContent : '无') +
  ' | 按钮=' + (dlBtn ? dlBtn.textContent.trim() : '无') +
  ' | taskId=' + (dlBtn ? dlBtn.dataset.localInstall : '无'));

// 2) 已安装 → 徽章 + 跳页按钮
await setSearch('Custom Nanosuit System');
const okBadge = document.querySelector('#browseArea .lb.ok');
const okBtn = document.querySelector('#browseArea [data-goto-page="p-installed"]');
rep.push('【已安装】徽章=' + (okBadge ? okBadge.textContent : '无') +
  ' | 按钮=' + (okBtn ? okBtn.textContent.trim() : '无') +
  ' | 跳页=' + (okBtn ? okBtn.dataset.gotoPage : '无'));

// 3) 未装过的 → 应保持原来的「⬇ 下载」
await setSearch('Improved Perfect Defense');
const plainBtn = document.querySelector('#browseArea [data-dl-add]');
rep.push('【未装】按钮=' + (plainBtn ? plainBtn.textContent.trim() : '无') +
  ' | 徽章=' + (document.querySelector('#browseArea .lb') ? '有(不该有)' : '无 ✓'));

switchPage('p-browse');
await wait(1200);
return rep.join('\n') + '\n当前页=' + (document.querySelector('.page.on') || {}).id;
