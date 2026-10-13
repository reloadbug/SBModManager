// 截图探针：已安装页「待处理」条 → 点「去处理」→ 弹出「选一套」对话框。
// ⚠️ 只点到对话框为止，**不选任何一套** —— 真装会写进用户的游戏目录。
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 等下载队列加载完 + 实时条渲染出来
let rows = [];
for (let i = 0; i < 40; i++) {
  rows = [...document.querySelectorAll('.live .li.rev')];
  if (rows.length) break;
  await wait(400);
}
await wait(400);

if (!rows.length) return '没找到「待处理」行';

const before = rows.map(r => r.querySelector('b').textContent + ' / ' + r.querySelector('.dl-st').textContent
  + ' / ' + (r.querySelector('.why') || {}).textContent
  + ' / 按钮=' + r.querySelector('button').textContent).join('\n  ');

// 挑 mod 692（Eve BP Nude）那一行
const target = rows.find(r => /Eve BP Nude/i.test(r.textContent)) || rows[0];
const label = target.querySelector('b').textContent;
target.querySelector('[data-dl-confirm]').click();

// 等对话框（dlConfirm 会先重新分析一次结构）
let opts = [];
for (let i = 0; i < 40; i++) {
  await wait(400);
  opts = [...document.querySelectorAll('.vopt')];
  if (opts.length) break;
}

const title = document.querySelector('#mTitle');
return '待处理行 ' + rows.length + ' 条：\n  ' + before +
  '\n点击的行 = ' + label +
  '\n对话框标题 = ' + (title ? title.textContent : '(没弹出)') +
  '\n候选数 = ' + opts.length +
  '\n候选 = ' + opts.map(o => o.querySelector('b').textContent).join(' | ');
