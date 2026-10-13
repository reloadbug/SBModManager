'use strict';
/**
 * 把 renderer 源码里的中文文案**机械地**包成 `t('…')`，并导出待翻译清单。
 *
 * ## 为什么用脚本而不是手改
 *
 * app.js 有 4300+ 行、400 多条界面文案，手改必然漏。机械改写的好处是
 * 「改写规则只有一套、可复现、可用 git diff 逐条审」。
 *
 * ## 规则（只包**会显示给用户**的字符串）
 *
 * 单/双引号字符串：包含中文才处理；以下情况**跳过**（它们是代码逻辑，不是文案）
 *   · 对象键（`{ '中文': … }` 或 `, '中文': …`）
 *   · `case '中文':`
 *   · 比较运算右侧（`x === '中文'` / `!=` ……）
 *
 * 模板串：按 `${…}` 切成「文字段 / 表达式段」。文字段含中文的，
 * 整条模板串改写成**拼接表达式**：
 *   `共 ${n} 个`  →  `t('共 ') + n + t(' 个')`
 * 不含中文的模板串**原样不动**（不留无意义的 t() 调用）。
 *
 * 纯空白/标点段（` · `、`\n`）不包 —— 翻译员不需要为它们操心。
 *
 * 用法：
 *   node _probe/i18n-apply.js                # 改写 src/renderer/app.js
 *   node _probe/i18n-apply.js --dry          # 只统计，不写盘
 *   node _probe/i18n-apply.js --keys-only    # 只输出待翻译清单（JSON）
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const OUT_KEYS = path.join(__dirname, '..', 'src', 'renderer', 'locales', '_keys.json');

const DRY = process.argv.includes('--dry');
const KEYS_ONLY = process.argv.includes('--keys-only');

const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** 单引号字面量（转义后） */
function quote(s) {
  return "'" + String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t') + "'";
}

/**
 * 逐字符扫一遍源码，产出新的源码。
 * 状态机：normal / lineComment / blockComment / sq / dq / tpl
 */
function transform(src) {
  const keys = new Set();
  let out = '';
  let i = 0;
  const n = src.length;
  // 「上一个非空白字符」用来判断比较/对象键/case 上下文
  let prevSig = '';

  function pushPrevSig(text) {
    for (const ch of text) if (!/\s/.test(ch)) prevSig = ch;
  }

  while (i < n) {
    const c = src[i];

    // ---- 注释 ----
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? n : j;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }

    // ---- 单/双引号 ----
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      let raw = '';
      while (j < n) {
        if (src[j] === '\\') { raw += src[j] + (src[j + 1] || ''); j += 2; continue; }
        if (src[j] === q) break;
        raw += src[j];
        j++;
      }
      const literalEnd = j; // 指向收尾引号
      const before = src.slice(Math.max(0, i - 24), i);
      const after = src.slice(literalEnd + 1, literalEnd + 8);
      // 跳过上下文（逻辑用法）
      const isCompare = /[=!]==?\s*$/.test(before) || /^[=!]==?/.test(after);
      const isKey = /[{,]\s*$/.test(before) && /^\s*:/.test(after);
      const isCase = /\bcase\s*$/.test(before) || /\bin\s*$/.test(before);
      const isImport = /\brequire\s*\(\s*$/.test(before);
      const skip = isCompare || isKey || isCase || isImport;

      if (!skip && CJK.test(raw)) {
        keys.add(raw);
        out += 't(' + quote(raw) + ')';
      } else {
        out += q + raw + q;
      }
      i = literalEnd + 1;
      pushPrevSig(raw.length ? raw[raw.length - 1] : '');
      continue;
    }

    // ---- 模板串 ----
    if (c === '`') {
      // 先扫完整条模板串（处理 ${} 嵌套）
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === '}') { depth--; j++; continue; }
        j++;
      }
      const literalEnd = j;
      const whole = src.slice(i + 1, literalEnd); // 不含反引号
      // 切成段
      const parts = [];
      let k = 0;
      let buf = '';
      let d2 = 0;
      while (k < whole.length) {
        if (whole[k] === '\\') { buf += whole[k] + (whole[k + 1] || ''); k += 2; continue; }
        if (d2 === 0 && whole[k] === '$' && whole[k + 1] === '{') {
          parts.push({ type: 'text', value: buf }); buf = '';
          let m = k + 2;
          let dd = 1;
          let expr = '';
          while (m < whole.length && dd > 0) {
            if (whole[m] === '{') dd++;
            else if (whole[m] === '}') { dd--; if (dd === 0) break; }
            expr += whole[m];
            m++;
          }
          parts.push({ type: 'expr', value: expr });
          k = m + 1;
          continue;
        }
        buf += whole[k];
        k++;
      }
      parts.push({ type: 'text', value: buf });

      const anyCjk = parts.some(p => p.type === 'text' && CJK.test(p.value));
      if (!anyCjk) {
        out += '`' + whole + '`';
      } else {
        const pieces = [];
        for (const p of parts) {
          if (p.type === 'expr') { pieces.push(p.value.trim()); continue; }
          if (!p.value) continue;
          const pureNoise = !CJK.test(p.value) && !/[A-Za-z0-9]/.test(p.value);
          if (pureNoise) {
            // · 、 换行 之类的纯符号，保留原样（不进字典）
            const unescaped = p.value
              .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
              .replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
            pieces.push(quote(unescaped));
            continue;
          }
          if (CJK.test(p.value)) {
            const unescaped = p.value
              .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
              .replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
            keys.add(unescaped);
            pieces.push('t(' + quote(unescaped) + ')');
          } else {
            const unescaped = p.value
              .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
              .replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
            pieces.push(quote(unescaped));
          }
        }
        // 只有一个 t(...) 且没有表达式 → 直接就是 t('…')，别套一层 +
        const exprCount = parts.filter(p => p.type === 'expr').length;
        if (exprCount === 0 && pieces.length === 1 && /^t\(/.test(pieces[0])) {
          out += pieces[0];
        } else {
          out += pieces.join(' + ');
        }
      }
      i = literalEnd + 1;
      pushPrevSig('`');
      continue;
    }

    out += c;
    pushPrevSig(c);
    i++;
  }
  return { code: out, keys: [...keys].sort() };
}

function main() {
  const src = fs.readFileSync(APP, 'utf8');
  const { code, keys } = transform(src);

  if (KEYS_ONLY) {
    fs.mkdirSync(path.dirname(OUT_KEYS), { recursive: true });
    fs.writeFileSync(OUT_KEYS, JSON.stringify(keys, null, 1), 'utf8');
    console.log('待翻译文案：' + keys.length + ' 条 → ' + path.relative(process.cwd(), OUT_KEYS));
    return;
  }
  if (DRY) {
    console.log('待翻译文案：' + keys.length + ' 条（dry run，不写盘）');
    return;
  }
  fs.writeFileSync(APP, code, 'utf8');
  fs.mkdirSync(path.dirname(OUT_KEYS), { recursive: true });
  fs.writeFileSync(OUT_KEYS, JSON.stringify(keys, null, 1), 'utf8');
  console.log('已改写 ' + APP + '：' + keys.length + ' 条文案 → t()');
}

main();
