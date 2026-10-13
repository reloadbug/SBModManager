/* ---------------- 语言包体检 ----------------
 *
 * 用法：
 *   node _probe/i18n-check-pack.js src/renderer/locales/de-DE.js
 *   node _probe/i18n-check-pack.js --all
 *
 * 查什么：
 *   · 语法能不能过（require 进来就验证）
 *   · 注册的 code 与文件名是否一致
 *   · 键集合与 _probe/i18n-keys.json **逐条对齐**（缺 / 多 都算失败）
 *   · 值不能是空串
 *   · 转义是否把原文改坏了（反斜杠、首尾空白）
 *   · 有没有原样照抄中文的条目（漏翻）
 *
 * 退出码 0 = 全过，1 = 有问题。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const KEYS_FILE = path.join(__dirname, 'i18n-keys.json');
const RC = process.argv.includes('--all') ? 'all' : null;

const KEYS = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
const KEY_SET = new Set(KEYS);

/** 语言 code → 语言包文件名里有几条 */
const LANGS = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU',
  'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];

/** 在隔离的 vm 里跑语言包，拿到它注册的字典 */
function loadPack(file) {
  const src = fs.readFileSync(file, 'utf8');
  const captured = [];
  const sandbox = {
    window: {
      I18N: {
        register(code, dict) { captured.push({ code, dict }); }
      }
    },
    module: { exports: {} },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file, timeout: 10000 });
  if (!captured.length) throw new Error('语言包没有调用 I18N.register()');
  return captured[0];
}

/** 中文兜底：值里还有 CJK 字符 → 大概漏翻了（少数专有名词豁免） */
const CJK = /[\u4e00-\u9fff]/;
/** 允许保留中文的例外（游戏名、某些固定搭配） */
const CJK_OK = [
  /剑星\s*Mod\s*管理器/   // 应用名可能被保留 + 后缀
];

/**
 * 本身就以汉字书写系统的语言 —— 对它们「译文含中文」不是问题。
 * 繁体中文本来就是汉字；日文汉字与简体字形大量重叠；
 * 韩文里也有少量汉字词（한자），但日常界面一般纯谚文，所以不豁免。
 */
const HAN_NATIVE = new Set(['zh-TW', 'ja-JP']);

function hasChinese(val) { return CJK.test(val); }

function checkOne(file) {
  const name = path.basename(file, '.js');
  const problems = [];
  const warns = [];

  let pack;
  try {
    pack = loadPack(file);
  } catch (e) {
    return { file, name, fatal: String(e && e.message || e), problems, warns };
  }

  const { code, dict } = pack;
  if (code !== name) problems.push(`注册的 code 是 "${code}"，但文件名是 "${name}.js"`);

  const kk = Object.keys(dict);
  const missing = KEYS.filter(k => !(k in dict));
  const extra = kk.filter(k => !KEY_SET.has(k));

  if (missing.length) problems.push(`缺 ${missing.length} 条：` + missing.slice(0, 8).map(s => JSON.stringify(s)).join(', '));
  if (extra.length) problems.push(`多 ${extra.length} 条：` + extra.slice(0, 8).map(s => JSON.stringify(s)).join(', '));

  // 值质量
  let empty = 0, sameAsKey = 0, brokenBackslash = 0, brokenSpace = 0;
  const chineseLeft = [];
  for (const k of kk) {
    const v = dict[k];
    if (typeof v !== 'string') { problems.push(`"${k}" 的值不是字符串`); continue; }
    if (!v) { empty++; continue; }
    if (v === k && hasChinese(k)) sameAsKey++;
    // 原文里的反斜杠（路径）在译文里必须还在
    const kb = (k.match(/\\/g) || []).length;
    const vb = (v.match(/\\/g) || []).length;
    if (vb < kb) brokenBackslash++;
    // 首尾空白必须原样保留（拼接用）
    const lead = /^\s/.test(k), trail = /\s$/.test(k);
    if ((lead && !/^\s/.test(v)) || (trail && !/\s$/.test(v))) brokenSpace++;
    // 漏翻：值里还有中文，且不是豁免项（汉字语言除外）
    if (!HAN_NATIVE.has(code) && hasChinese(v) && !CJK_OK.some(re => re.test(v))) chineseLeft.push(k);
  }

  if (empty) problems.push(`有 ${empty} 条的译文是空串`);
  if (brokenBackslash) problems.push(`有 ${brokenBackslash} 条丢了反斜杠（路径会被写坏）`);
  if (brokenSpace) problems.push(`有 ${brokenSpace} 条丢了首尾空格（拼接会粘连）`);
  if (sameAsKey && !HAN_NATIVE.has(code) && !/^zh/.test(code)) {
    warns.push(`有 ${sameAsKey} 条译文与原文完全相同（可能是漏翻）`);
  } else if (sameAsKey) {
    const list = kk.filter(k => dict[k] === k && hasChinese(k));
    warns.push(`有 ${sameAsKey} 条与简体原文同形（繁体/日文下可能是漏翻）：` +
      list.slice(0, 10).map(s => JSON.stringify(s)).join(', '));
  }
  if (chineseLeft.length) {
    warns.push(`有 ${chineseLeft.length} 条译文里还含中文，前几条：` +
      chineseLeft.slice(0, 6).map(s => JSON.stringify(s)).join(', '));
  }

  return { file, name, code, count: kk.length, problems, warns };
}

/* ---------------- 主流程 ---------------- */

const targets = RC === 'all'
  ? LANGS.map(c => path.join(ROOT, 'src/renderer/locales', c + '.js')).filter(f => fs.existsSync(f))
  : process.argv.slice(2).filter(a => !a.startsWith('--')).map(a => path.resolve(a));

if (!targets.length) {
  console.error('用法: node _probe/i18n-check-pack.js <语言包.js> | --all');
  process.exit(2);
}

let bad = 0;
for (const f of targets) {
  const r = checkOne(f);
  const tag = r.fatal || r.problems.length ? 'FAIL' : (r.warns.length ? 'WARN' : ' OK ');
  if (r.fatal || r.problems.length) bad++;
  console.log(`[${tag}] ${r.name}${r.count != null ? `  (${r.count}/${KEYS.length})` : ''}`);
  if (r.fatal) console.log('       致命: ' + r.fatal);
  for (const p of r.problems) console.log('       ✗ ' + p);
  for (const w of r.warns) console.log('       ! ' + w);
}

console.log(`\n共 ${targets.length} 个语言包，${bad} 个不合格。`);
process.exit(bad ? 1 : 0);
