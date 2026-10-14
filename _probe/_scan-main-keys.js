'use strict';
/* 一次性侦察：主进程（src/main/*.js）里的中文字面量 vs keys.json。
 * 抽取器只扫渲染层，主进程文案全靠 EXTRA 手工维护 —— 容易漏。
 *   node _probe/_scan-main-keys.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let src = fs.readFileSync(path.join(__dirname, 'i18n-extract.js'), 'utf8');
src = src.replace(/\nmain\(\);\s*$/, '\n');

const sandbox = {
  require, console, process, Buffer, __dirname: __dirname,
  module: { exports: {} }, exports: {}
};
sandbox.global = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'i18n-extract.js' });

const extractFromJs = sandbox.extractFromJs;
if (typeof extractFromJs !== 'function') {
  console.error('拿不到 extractFromJs —— 检查 i18n-extract.js 尾部是否还有裸的 main()');
  process.exit(1);
}

const KEYS = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8')));

const dir = path.join(ROOT, 'src', 'main');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const missing = new Map();
let total = 0;

for (const f of files) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  const r = extractFromJs(code);
  total += r.keys.length;
  for (const k of r.keys) if (!KEYS.has(k)) {
    if (!missing.has(k)) missing.set(k, []);
    missing.get(k).push(f);
  }
}

console.log(`主进程 ${files.length} 个文件，抽出 ${total} 条文案，其中 ${missing.size} 条不在 keys.json：\n`);
const list = [...missing.entries()].sort((a, b) => b[0].length - a[0].length);
for (const [k, where] of list) {
  console.log(`  ${JSON.stringify(k)}\n      ← ${[...new Set(where)].join(', ')}`);
}
