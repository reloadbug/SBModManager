// 插桩探针：查清「装完 692 之后为什么又弹出 Nv_pu_CNS 的选择框」。
// 全程指向假游戏根，跑完 shell 会还原 data/*.json。
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FAKE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\sb-ui-e2e';
const log = [];
const t0 = Date.now();
const mark = (s) => log.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + s);

// 插桩：谁开了模态框、谁调了 dlConfirm
const origOpen = window.openModal;
window.openModal = function (...a) { mark('openModal("' + a[0] + '")'); return origOpen.apply(this, a); };
const origConfirm = window.dlConfirm;
window.dlConfirm = function (id) {
  const t = (state.downloads || []).find(x => x.id === id);
  mark('dlConfirm(' + String(id).slice(0, 8) + ' mod=' + (t && t.meta && t.meta.modId) + ' status=' + (t && t.status) + ')');
  return origConfirm.apply(this, arguments);
};

await window.api.game.setRoot(FAKE);
window.switchPage('p-installed');
await window.__dlActions.refreshDownloads();
await wait(1200);

let rows = [...document.querySelectorAll('.live .li.rev')];
mark('待处理行=' + rows.map(r => (r.querySelector('b') || {}).textContent).join('/'));
const target = rows.find(r => /Eve BP Nude/i.test(r.textContent));
target.querySelector('[data-dl-confirm]').click();

let opts = [];
for (let i = 0; i < 40; i++) {
  await wait(400);
  opts = [...document.querySelectorAll('.vopt')];
  if (opts.length) break;
}
mark('候选=' + opts.map(o => o.querySelector('b').textContent).join('|'));
const chosen = opts.find(o => /Skin Suit_A$/.test(o.querySelector('b').textContent)) || opts[0];
mark('点击=' + chosen.querySelector('b').textContent);
chosen.click();
mark('click 返回');

for (let i = 0; i < 120; i++) {
  await wait(500);
  if (!document.querySelector('.live .li:not(.rev)')) break;
}
mark('安装循环结束');

await window.__dlActions.refreshDownloads();
await refreshAll();
await wait(1500);

const t692 = (state.downloads || []).find(x => x.meta && Number(x.meta.modId) === 692);
mark('692 状态=' + (t692 && t692.status));
mark('模态框可见=' + document.querySelector('#modal').classList.contains('on') +
  ' 标题=' + document.querySelector('#mTitle').textContent);
mark('实时条=' + [...document.querySelectorAll('.live .li')].map(r => r.querySelector('b').textContent).join('/'));

const card = [...document.querySelectorAll('#installedArea .card')]
  .find(c => /Eve BP Nude/i.test((c.querySelector('h3') || {}).textContent || ''));
if (card) card.scrollIntoView({ block: 'center' });
await wait(500);

return log.join('\n');
