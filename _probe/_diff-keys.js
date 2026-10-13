/* 对比「现有字典 keys.json」与「重新抽取的候选清单」，看修复抽取器后多了哪些。
 *
 *   node _probe/_diff-keys.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const j = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const cur = j('_probe/i18n-keys.json');
const neu = j('_probe/_new-keys.json');

const A = new Set(cur), B = new Set(neu);
const added = neu.filter(k => !A.has(k));
const gone = cur.filter(k => !B.has(k));

console.log(`现有字典 ${cur.length} 条 · 重新抽取 ${neu.length} 条`);
console.log(`\n新增 ${added.length} 条：`);
for (const k of added) console.log('  + ' + k.replace(/\n/g, '\\n'));
console.log(`\n不再出现 ${gone.length} 条（文案被删/改，或抽取规则变严）：`);
for (const k of gone) console.log('  - ' + k.replace(/\n/g, '\\n'));
