/* 机械派生 3 条形状键的译文（不用重新翻译）。
 *
 * 三条都能从**已有词条**算出来：
 *   1. `· 保留最近 %s 天`            ← 旧形状 `· %s · 保留最近 %s 天` 剥掉前导 `· %s · `
 *   2. `共 %s 项 · %s 个已启用`       ← `共` + ` %s ` + `项 ·` + ` %s ` + `个已启用` 拼接
 *   3. `CNS 服装数据（…）全部原样放…`  ← 直接沿用**未截断**那条的译文
 *                                      （界面把 >40 字的说明截成 38 字 + `…`，
 *                                        截断形态自成一条键，语义与全文一致）
 *
 * 输出到 `_probe/_trans/<code>.json`，交给 `_sync-packs.js --apply` 合并。
 *
 *   node _probe/_derive-shapes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = path.join(ROOT, 'src/renderer/locales');
const TRANS = path.join(__dirname, '_trans');

const TODO = JSON.parse(fs.readFileSync(path.join(__dirname, '_todo.json'), 'utf8'));

const OLD_SHAPE = '· %s · 保留最近 %s 天';
const FULL_REASON = 'CNS 服装数据（pak + .dekcns / .dekani）全部原样放进 ~Mods';

/** 读一个语言包 → dict */
function loadPack(code) {
  let dict = null;
  const sandbox = { window: { I18N: { register: (c, d) => { dict = d; } } } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(LOCALES, code + '.js'), 'utf8'), sandbox, { filename: code + '.js' });
  return dict || {};
}

let bad = 0;
for (const code of Object.keys(TODO)) {
  const want = TODO[code];
  const d = loadPack(code);
  const out = {};

  for (const k of want) {
    if (k === '· 保留最近 %s 天') {
      const old = d[OLD_SHAPE];
      // 只剥「分隔符 + %s + 分隔符 + 空白」这一小段。
      // ⚠️ 不能用 `[^\w%]*` 那种宽松写法 —— JS 的 `\w` 只认 `[A-Za-z0-9_]`，
      //    汉字 / 韩文 / 西里尔 / 泰文统统算「非 \w」，会被一并吃掉
      //    （zh-TW 的「保留最近」、ru 的「хранить последние」就是这么丢的）。
      out[k] = old ? old.replace(/^[·・.]\s*%s\s*[·・.]\s*/, '· ') : '· 保留最近 %s 天';
    } else if (k === '共 %s 项 · %s 个已启用') {
      const a = d['共'], b = d['项 ·'], c = d['个已启用'];
      out[k] = (a && b && c) ? `${a} %s ${b} %s ${c}` : '共 %s 项 · %s 个已启用';
    } else if (k === 'CNS 服装数据（pak + .dekcns / .dekani）全部原样放…') {
      out[k] = d[FULL_REASON] || 'CNS 服装数据（pak + .dekcns / .dekani）全部原样放进 ~Mods';
    } else {
      bad++;
      console.log(`  ✗ ${code}: 不认识的新键 ${JSON.stringify(k)}`);
      out[k] = k;
    }
  }

  fs.writeFileSync(path.join(TRANS, code + '.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');
  console.log(`${code.padEnd(6)} 派生 ${Object.keys(out).length} 条 · ` +
    Object.entries(out).map(([k, v]) => `${JSON.stringify(k.slice(0, 14))}→${JSON.stringify(v)}`).join('  '));
}

console.log(bad ? `\n有 ${bad} 条不认识，请检查 _todo.json` : '\n全部派生完成');
