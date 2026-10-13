// 第 3 条 A：覆盖确认清单 —— 每行「定位」+「⇄ 对比」。
// 用法：node _probe/launch.js --shot=_shots/ui26-conflict.png --shot-eval-file=_shots/eval-ui26-conflict.js --shot-delay=11000
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < 40; i++) {
  if (document.querySelectorAll('#installedArea .grid .card').length) break;
  await sleep(250);
}
await sleep(600);

// 截住 window.api.revealPath：不让它真开资源管理器，只记下路径
const revealed = [];
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-reveal-path]');
  if (!el) return;
  revealed.push(el.dataset.revealPath);
  e.stopPropagation();
  e.preventDefault();
}, true);

const cards = [...document.querySelectorAll('#installedArea .grid .card')];
const withMid = cards.filter(c => c.querySelector('.chip.mid'));
const c = withMid[0] || cards[0];
const oldModId = Number(((c.querySelector('.chip.mid') || {}).textContent || '').replace(/[#\s]/g, ''));
const oldName = (c.querySelector('h3') || {}).textContent || '';

// 造一份「会被覆盖」的清单（形状和 installFlow.explainConflicts 的真实返回一致）
const PAK = 'X_P.pak';
const host = document.createElement('div');
host.id = 'probeConflictHost';
host.style.cssText = 'position:fixed;left:16px;top:16px;width:432px;z-index:30;background:var(--panel);'
  + 'border:1px solid var(--border2);border-radius:10px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.5)';
host.innerHTML = '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">目标位置已有 2 个同名文件，继续安装会覆盖它们</div>'
  + conflictListHtml({
    total: 2,
    items: [
      {
        path: 'D:\\games\\Star Blade\\SB\\Content\\Paks\\~Mods\\Minervha_Master_P.pak',
        rel: 'SB/Content/Paks/~Mods/Minervha_Master_P.pak',
        name: 'Minervha_Master_P.pak', currentSize: 339, incomingSize: 339, sameSize: true,
        owners: [{ modId: 3970, name: 'Cyber Suit Minervha', version: 'v1.2', author: 'Minervha', isSelf: false },
          { modId: 5118, name: 'Minervha Master', version: '2', author: 'Minervha', isSelf: false }]
      },
      {
        path: 'D:\\games\\Star Blade\\SB\\Content\\Paks\\~Mods\\Cyber_Suit_P.pak',
        rel: 'SB/Content/Paks/~Mods/Cyber_Suit_P.pak',
        name: 'Cyber_Suit_P.pak', currentSize: 189920512, incomingSize: 201234567, sameSize: false,
        owners: [{ modId: 5118, name: 'Minervha Master', version: '2', author: 'Minervha', isSelf: false }]
      }
    ]
  });
document.body.appendChild(host);

await sleep(400);

const rows = [...host.querySelectorAll('.cfl-row')];
const out = {
  oldModId, oldName,
  rows: rows.length,
  rowTexts: rows.map(r => r.querySelector('.cfl-top').textContent.replace(/\s+/g, ' ').trim()),
  owners: rows.map(r => r.querySelector('.cfl-o').textContent.replace(/\s+/g, ' ').trim()),
  actBtns: rows.map(r => [...r.querySelectorAll('.cfl-btn')].map(b => b.textContent.trim())),
  cmpTargets: [...host.querySelectorAll('[data-cmp]')].map(b => b.dataset.cmp),
  rowIsDiv: rows.every(r => r.tagName === 'DIV'),
  nestedButtons: rows.some(r => r.querySelector('button button'))
};

// 点第一行的「定位」—— 只该记路径，不该弹窗口
const locate = rows[0].querySelector('.cfl-btn:not(.cmp)');
if (locate) locate.click();
await sleep(300);
out.revealed = revealed;
out.revealOk = revealed.length === 1 && /Minervha_Master_P\.pak$/.test(revealed[0] || '');

// 点整行（data-reveal-path 挂在 .cfl-row 上）也该走定位
host.querySelector('.cfl-row .cfl-p').click();
await sleep(300);
out.rowClickRevealed = revealed.length === 2;

// 点「对比」应该**不会**触发定位（stopPropagation）
const before = revealed.length;
host.querySelector('[data-cmp]').click();
await sleep(250);
out.cmpDidNotReveal = revealed.length === before;
out.modalOpenAfterCmp = document.getElementById('modal').classList.contains('on');
out.cmpTitle = (document.getElementById('mTitle') || {}).textContent || '';

// 关掉弹窗，截图里只留覆盖清单
document.getElementById('modal').click();
await sleep(300);
out.modalClosed = !document.getElementById('modal').classList.contains('on');

return out;
