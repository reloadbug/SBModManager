/* 校验 `_probe/_trans/<code>.json` 的翻译产出。
 *
 *   node _probe/_check-trans.js en-US de-DE     # 指定语言
 *   node _probe/_check-trans.js --all           # 全部
 *
 * 查：文件存在 / JSON 合法 / 键集合与 _todo.json 逐条一致 / 无空串 / 无漏翻中文。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TODO = JSON.parse(fs.readFileSync(path.join(__dirname, '_todo.json'), 'utf8'));

/** 本身就用汉字的语言，译文里出现汉字不算漏翻 */
const HAN_NATIVE = new Set(['zh-TW', 'ja-JP']);
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);

const picked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const codes = process.argv.includes('--all') ? Object.keys(TODO) : picked;
if (!codes.length) { console.log('用法: node _probe/_check-trans.js <code>… | --all'); process.exit(1); }

let bad = 0;
for (const code of codes) {
  const want = TODO[code] || [];
  const file = path.join(__dirname, '_trans', code + '.json');
  if (!fs.existsSync(file)) { console.log(`[缺文件] ${code} → ${file}`); bad++; continue; }

  let got;
  try { got = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log(`[JSON 非法] ${code}: ${e.message}`); bad++; continue; }

  const miss = want.filter(k => typeof got[k] !== 'string' || !got[k]);
  const extra = Object.keys(got).filter(k => !want.includes(k));
  const left = want.filter(k => typeof got[k] === 'string' && got[k] && !HAN_NATIVE.has(code) && hasCJK(got[k]));

  // `%s` 是数字占位符：原文有几个，译文就必须有几个（多一个会被填成空串，
  // 少一个会吞掉一个数字 —— 都是静默错误，必须在翻译阶段挡住）
  const shape = want.filter(k => k.includes('%s')
    && typeof got[k] === 'string'
    && (k.split('%s').length !== got[k].split('%s').length));

  const ok = !miss.length && !extra.length && !left.length && !shape.length;
  console.log(`${ok ? '[ OK ]' : '[WARN]'} ${code}  ${Object.keys(got).length}/${want.length}` +
    (miss.length ? `  缺 ${miss.length}` : '') +
    (extra.length ? `  多 ${extra.length}` : '') +
    (left.length ? `  残留中文 ${left.length}` : '') +
    (shape.length ? `  %s 数量不符 ${shape.length}` : ''));

  if (miss.length) { bad++; console.log('   缺: ' + miss.slice(0, 6).map(s => JSON.stringify(s)).join(' / ')); }
  if (extra.length) { bad++; console.log('   多: ' + extra.slice(0, 6).map(s => JSON.stringify(s)).join(' / ')); }
  if (left.length) { bad++; console.log('   残留: ' + left.slice(0, 6).map(s => JSON.stringify(s + ' → ' + got[s])).join(' / ')); }
  if (shape.length) {
    bad++;
    for (const k of shape.slice(0, 6)) {
      const n = (s) => s.split('%s').length - 1;
      console.log(`   %s: 原文 ${n(k)} 个 / 译文 ${n(got[k])} 个 → ${JSON.stringify(got[k])}`);
    }
  }
}

console.log(bad ? `\n${bad} 个语言包有问题` : '\n全部通过');
process.exit(bad ? 1 : 0);
