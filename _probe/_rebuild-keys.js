/* 重建 keys.json：**抽取结果 ∪ 手工补充词条**。
 *
 * 抽取器只扫 app.js / index.html，而有一批文案根本不在源码里
 * （Nexus 分类名、界面语言下拉……），它们由 `i18n-add-keys.js` 的 TABLE 手工维护。
 * 重建时必须把两边并起来，否则每次重跑抽取都会把手工词条洗掉。
 *
 *   node _probe/_rebuild-keys.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { TABLE, EXTRA } = require('./i18n-add-keys.js');
const manual = [...TABLE.map(([k]) => k), ...EXTRA];
const extracted = JSON.parse(fs.readFileSync(path.join(__dirname, '_new-keys.json'), 'utf8'));

const all = [...new Set([...extracted, ...manual])].sort();
fs.writeFileSync(path.join(__dirname, 'i18n-keys.json'), JSON.stringify(all, null, 1) + '\n', 'utf8');

const single = all.filter(k => k.length === 1);
console.log(`keys.json 重建：抽取 ${extracted.length} + 手工 ${manual.length} → 去重后 **${all.length}** 条`);
console.log(`其中单字词 ${single.length} 条：${single.join(' / ')}`);
console.log(`其中数字模板（%s）${all.filter(k => k.includes('%s')).length} 条`);
