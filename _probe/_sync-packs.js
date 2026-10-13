/* 语言包 ↔ keys.json 同步器。
 *
 * keys.json 是**唯一真源**：语言包里的键必须和它逐条一一对应。
 * 抽取器升级后 key 集合会变（旧的粘合长串被切开、新的片段冒出来），
 * 这个脚本负责把 13 个语言包重新对齐：
 *
 *   node _probe/_sync-packs.js --report   # 只报告：谁多了谁少了，并写出待翻译清单
 *   node _probe/_sync-packs.js --apply    # 应用 _probe/_trans/<code>.json 里的译文，
 *                                         # 删掉多余的键，重写语言包
 *
 * 用 vm 起个假 window 把 register() 的参数截下来，比正则可靠得多
 * （key 里带引号、反斜杠、括号都不会错）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'locales');
const TRANS_DIR = path.join(__dirname, '_trans');
const KEYS_FILE = path.join(__dirname, 'i18n-keys.json');
const TODO_FILE = path.join(__dirname, '_todo.json');

const CODES = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU', 'de-DE',
  'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];

const KEYS = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));

/** JS 单引号字符串转义（**不含**外层的引号，用的时候要自己加 —— 漏过一次，
 *  13 个语言包全变成 `GitHub 镜像: GitHub Mirror,`，直接语法错误） */
const jsq = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');

/** 读出某个语言包里的 {key: 译文} */
function readPack(code) {
  const file = path.join(LOCALES, code + '.js');
  const src = fs.readFileSync(file, 'utf8');
  let caught = null;
  const sandbox = { window: { I18N: { register(c, d) { if (c === code) caught = d; } } } };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(src, sandbox, { filename: code + '.js' });
  if (!caught) throw new Error(code + '.js 里没找到 register(' + code + ', …)');
  return { src, dict: caught };
}

/** 按 keys.json 的顺序重写语言包正文 */
function render(src, code, dict) {
  const mark = `window.I18N.register('${code}', {`;
  const i = src.indexOf(mark);
  if (i < 0) throw new Error(code + '.js 找不到 register 起始标记');
  const head = src.slice(0, i + mark.length);
  const tail = src.slice(src.lastIndexOf('\n  });'));
  const body = KEYS.map(k => `    '${jsq(k)}': '${jsq(dict[k])}',`).join('\n');
  return head + '\n' + body + '\n' + tail.replace(/^\n+/, '');
}

const mode = process.argv.includes('--apply') ? 'apply' : 'report';

let totalMissing = 0, totalExtra = 0;
const todo = {};

for (const code of CODES) {
  const { src, dict } = readPack(code);
  const have = new Set(Object.keys(dict));
  const want = new Set(KEYS);

  const missing = KEYS.filter(k => !have.has(k));
  const extra = Object.keys(dict).filter(k => !want.has(k));
  totalMissing += missing.length;
  totalExtra += extra.length;

  console.log(`${code}: 有 ${have.size} · 缺 ${missing.length} · 多 ${extra.length}`);

  if (mode === 'report') {
    if (missing.length) todo[code] = missing;
    continue;
  }

  // --- apply ---
  const transFile = path.join(TRANS_DIR, code + '.json');
  let trans = {};
  if (fs.existsSync(transFile)) trans = JSON.parse(fs.readFileSync(transFile, 'utf8'));

  const next = Object.create(null);
  const stillMissing = [];
  for (const k of KEYS) {
    if (dict[k] !== undefined) next[k] = dict[k];
    else if (typeof trans[k] === 'string' && trans[k]) next[k] = trans[k];
    else stillMissing.push(k);
  }
  if (stillMissing.length) {
    console.log(`  ✗ ${code} 还缺 ${stillMissing.length} 条译文，未改动（先去 _trans/${code}.json 补）`);
    continue;
  }
  fs.writeFileSync(path.join(LOCALES, code + '.js'), render(src, code, next), 'utf8');
  console.log(`  ✓ ${code} 已重写（补 ${missing.length} · 删 ${extra.length}）`);
}

if (mode === 'report') {
  fs.writeFileSync(TODO_FILE, JSON.stringify(todo, null, 1) + '\n', 'utf8');
  console.log(`\n合计缺 ${totalMissing} 条 · 多 ${totalExtra} 条。待翻译清单 → _probe/_todo.json`);
} else {
  console.log(`\n合计缺 ${totalMissing} 条 · 多 ${totalExtra} 条。`);
}
