// 下载管理页：确认待确认任务的新文案 + 重新识别按钮
const wait = (ms) => new Promise(r => setTimeout(r, ms));
window.switchPage('p-download');
for (let i = 0; i < 20; i++) { await wait(300); if (document.querySelector('.dl-bar')) break; }
const rows = [...document.querySelectorAll('.dl-item')].map(r => ({
  name: (r.querySelector('h4') || {}).textContent || '',
  why: (r.querySelector('.live .li.rev .why, .dl-item .rev .why') || {}).textContent || '',
  btn: [...r.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)
}));
return {
  page: (document.querySelector('.nav-i.on') || {}).textContent.trim(),
  refreshBtn: document.querySelectorAll('[data-dl-refreshplans]').length,
  reviewRows: document.querySelectorAll('.live .li.rev').length,
  rows
};
