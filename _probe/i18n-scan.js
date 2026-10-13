'use strict';
/**
 * 从 renderer 源码里**抽取用户可见的中文文案**（去掉注释），统计去重后的清单。
 * 只读不写，用来决定 i18n 的 key 规模与分域。
 *
 * 用法：node _probe/i18n-scan.js [file...]
 */
const fs = require('fs');

/** 去掉 // 注释与 /* *\/ 块注释（ naive，但足以统计；字符串里的 // 会被误砍，
 *  所以要求被砍的行里不含引号 —— 不满足就跳过该行不统计） */
function stripComments(src) {
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  return out;
}

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['src/renderer/app.js', 'src/renderer/index.html', 'src/renderer/style.css'];

const seen = new Map();
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[2];
    if (!/[\u4e00-\u9fa5]/.test(raw)) continue;
    // 模板串里的 ${...} 保留原样当占位符
    const key = raw.replace(/\\(\\.|[nt'"\\])/g, (s, g) => g === 'n' ? '\n' : g === 't' ? '\t' : g);
    if (!seen.has(key)) seen.set(key, { n: 0, files: new Set() });
    seen.get(key).n++;
    seen.get(key).files.add(f);
  }
}

const list = [...seen.entries()].sort((a, b) => b[1].n - a[1].n);
console.log('去重后可翻译文案：' + list.length + ' 条（共 ' + [...seen.values()].reduce((s, v) => s + v.n, 0) + ' 次出现）\n');
let chars = 0;
for (const [k, v] of list) {
  chars += k.length;
  const short = k.length > 90 ? k.slice(0, 87) + '…' : k;
  console.log(String(v.n).padStart(3) + '×  ' + short.replace(/\n/g, '\\n'));
}
console.log('\n合计字符：' + chars);
