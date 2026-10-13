/* 解析 `_shot-i18n-scan.js` 的返回结果：按页面分组打印仍含中文的文本。
 *
 *   node _probe/_parse-scan.js <扫描日志>
 *
 * 日志里那一行长这样：`SHOT_EVAL "I18N_LEFTOVER [{…}]"`
 * （executeJavaScript 的返回值被 JSON.stringify 过一道，所以外面还套了层引号）
 */
'use strict';

const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');

// 先把外层 JSON.stringify 的引号与转义解掉
const line = raw.split(/\r?\n/).find(l => l.includes('I18N_LEFTOVER'));
if (!line) {
  console.log('日志里没有 I18N_LEFTOVER —— 扫描脚本大概率被 app.exit() 掐掉了。');
  console.log('把 --shot-delay 加大（脚本从 3s 开始跑，约需 7s）再试。');
  process.exit(1);
}

const payload = line.slice(line.indexOf('SHOT_EVAL') + 'SHOT_EVAL'.length).trim();
let inner;
try { inner = JSON.parse(payload); } catch { inner = payload.replace(/^"|"$/g, '').replace(/\\"/g, '"'); }

const json = String(inner).replace(/^I18N_LEFTOVER\s*/, '');
const list = JSON.parse(json);

console.log(`\n仍含中文的文本节点 / 属性：${list.length} 处\n`);

const byHost = new Map();
for (const x of list) {
  const top = x.at.split('>')[0] || '?';
  if (!byHost.has(top)) byHost.set(top, []);
  byHost.get(top).push(x);
}
for (const [host, rows] of byHost) {
  console.log(`--- ${host} (${rows.length}) ---`);
  for (const r of rows) console.log('   ' + r.text);
}
