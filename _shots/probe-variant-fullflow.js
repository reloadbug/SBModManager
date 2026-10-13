// 截图探针（**会改配置**，跑完由 shell 还原）：
//   待处理 → 点「去处理」→ 选一套变体 → 真的装上 → 已安装列表出现
//
// ⚠️ 全程指向**假游戏根** `%TEMP%\sb-ui-e2e`，绝不碰用户的真实游戏目录。
//    跑完 shell 会把 data/config.json、data/mods.json、data/downloads.json 还原。
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FAKE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\sb-ui-e2e';
const log = [];

// 1) 切到假游戏根
try {
  await window.api.game.setRoot(FAKE);
  log.push('setRoot=ok');
} catch (e) {
  return 'setRoot 失败：' + e.message;
}

window.switchPage('p-installed');
await window.__dlActions.refreshDownloads();
await wait(1200);

// 2) 找到 692 的「待处理」行，点「去处理」
let rows = [...document.querySelectorAll('.live .li.rev')];
const target = rows.find(r => /Eve BP Nude/i.test(r.textContent));
if (!target) return '没找到 692 的待处理行（rows=' + rows.length + '，log=' + log.join(',') + '）';
target.querySelector('[data-dl-confirm]').click();

// 3) 等变体对话框（dlConfirm 会先重新分析一次）
let opts = [];
for (let i = 0; i < 40; i++) {
  await wait(400);
  opts = [...document.querySelectorAll('.vopt')];
  if (opts.length) break;
}
if (!opts.length) return '变体对话框没弹出';

const chosen = opts.find(o => /Skin Suit_A$/.test(o.querySelector('b').textContent)) || opts[0];
const pick = chosen.dataset.pick;
log.push('选了=' + chosen.querySelector('b').textContent);
chosen.click();

// 4) 等安装结束：实时条里不再有「正在跑」的行
let ended = false;
for (let i = 0; i < 120; i++) {
  await wait(500);
  if (!document.querySelector('.live .li:not(.rev)')) { ended = true; break; }
}
await wait(1500);

// 5) 刷新到最新状态
await window.__dlActions.refreshDownloads();
await refreshAll();
await wait(1200);

const t = (state.downloads || []).find(x => x.meta && Number(x.meta.modId) === 692);
const names = (state.installed || []).map(m => m.name);
const hit = names.find(n => /Eve BP Nude/i.test(n));

// 把新装的卡片滚进视野，截图里才看得到
const card = [...document.querySelectorAll('#installedArea .card')]
  .find(c => /Eve BP Nude/i.test((c.querySelector('h3') || {}).textContent || ''));
if (card) card.scrollIntoView({ block: 'center' });
await wait(600);

const err = document.querySelector('.toast.err');
return log.join(' | ') +
  '\n安装结束=' + ended +
  '\n任务状态=' + (t ? t.status : '(没找到)') +
  (t && t.error ? '\n任务错误=' + t.error : '') +
  '\n已安装列表含 Eve BP Nude=' + (hit ? '是 ✓ ' + hit : '否') +
  '\n列表条数=' + names.length +
  '\n错误提示=' + (err ? err.textContent : '无');
