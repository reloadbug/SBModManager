/* 诊断：把界面扫描出的残留文案逐条过一遍**真实字典**，分清三类：
 *
 *   A 现在能翻      —— 扫描时是时序问题（元素在 refresh 之后才渲染出来）
 *   B 有 key 没命中  —— 算法问题：字典里有整串，但 lookup() 的兜底没走到
 *   C 压根没 key    —— 缺词条：抽取器没抓到，或本来就是运行时数据（不该翻）
 *
 * C 里再分一次：字符串在 app.js 源码里出现 → 静态文案，该补；
 *              源码里找不到             → 运行时数据（Mod 名 / 安装器输出），不补。
 *
 *   node _probe/i18n-diag.js _probe/_scan3.log
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- 1) 取残留清单 ---------- */
const log = R(process.argv[2] || '_probe/_scan3.log');
const line = log.split(/\r?\n/).find(l => l.includes('I18N_LEFTOVER'));
if (!line) { console.error('日志里没有 I18N_LEFTOVER'); process.exit(1); }
const payload = line.slice(line.indexOf('SHOT_EVAL') + 'SHOT_EVAL'.length).trim();
let inner;
try { inner = JSON.parse(payload); } catch { inner = payload.replace(/^"|"$/g, ''); }
const list = JSON.parse(String(inner).replace(/^I18N_LEFTOVER\s*/, ''));

/* ---------- 2) 起一个带真实语言包的沙箱 ---------- */
const win = { navigator: { language: 'zh-CN' }, console };
win.window = win;
win.globalThis = win;
const ctx = vm.createContext(win);
vm.runInContext(R('src/renderer/i18n.js'), ctx, { filename: 'i18n.js' });
vm.runInContext(R('src/renderer/locales/en-US.js'), ctx, { filename: 'en-US.js' });
const I18N = win.I18N;
I18N.setLang('en-US');

const APP = R('src/renderer/app.js');

/* ---------- 3) 分类 ---------- */
const A = [], B = [], C_static = [], C_dynamic = [];

for (const x of list) {
  const s = x.text.trim();
  if (!s) continue;
  if (I18N.lookup(s) !== s) { A.push(s); continue; }

  // t() 只做整串查表：能翻说明「整串就是一条 key」
  const hasKey = I18N.t(s) !== s;
  if (hasKey) { B.push(s); continue; }

  // 源码里找得到 → 静态文案；找不到 → 运行时数据
  if (APP.includes(s)) C_static.push(s);
  else C_dynamic.push(s);
}

const dump = (title, arr) => {
  console.log(`\n===== ${title}（${arr.length}） =====`);
  for (const s of arr) console.log('  ' + s.replace(/\n/g, '\\n'));
};

dump('A 现在能翻（扫描时序问题）', A);
dump('B 有 key 但 lookup 没命中（算法问题）', B);
dump('C1 没 key · 源码里有（该补词条）', C_static);
dump('C2 没 key · 源码里没有（运行时数据，不补）', C_dynamic);

console.log(`\n合计 ${list.length} 条 → A ${A.length} · B ${B.length} · C1 ${C_static.length} · C2 ${C_dynamic.length}`);
