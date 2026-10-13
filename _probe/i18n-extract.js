'use strict';
/**
 * 抽取界面上**用户真正看得到**的中文文案，产出待翻译清单。
 *
 * ## 为什么不用上一轮那套
 *
 * 上一轮的 `i18n-apply.js` 想把 `'中文'` 机械改写成 `t('中文')`，结果在
 * **正则字面量**上翻车：
 *
 *     .replace(/"/g, '&quot;')
 *                ^ 这个引号被当成了字符串的开头
 * 状态机一路吃到下一个引号，把整份 4357 行的 app.js 改成了 914 行的语法废料。
 *
 * 本轮改策略：**一个字都不回写 app.js**，改成「渲染后用字典翻译 DOM 文本」。
 * 本脚本只**读**源码、只产出清单。
 *
 * ## 扫描器
 *
 * 所有「跳过一段结构」的能力都是**共享**的（`readComment` / `readString` /
 * `readTemplate` / `readRegex`），模板串里的 `${...}` 表达式用同一套规则递归处理 ——
 * 上一版就是没做到这点，嵌套模板串一出现就整段跑偏，把后面的注释和代码都当成文案。
 *
 * 用法：
 *   node _probe/i18n-extract.js                    # 统计 + 抽样预览
 *   node _probe/i18n-extract.js --json=out.json    # 写 JSON（给翻译用）
 *   node _probe/i18n-extract.js --all              # 把全部条目都打出来（审词用）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/* ===================== 共享 token 扫描器 ===================== */

/** 行注释 / 块注释；不是注释返回 -1 */
function readComment(src, i) {
  if (src[i] !== '/') return -1;
  if (src[i + 1] === '/') { const j = src.indexOf('\n', i); return j < 0 ? src.length : j; }
  if (src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); return j < 0 ? src.length : j + 2; }
  return -1;
}

/** i 指向引号；返回 { raw, end }（end 已越过收尾引号） */
function readString(src, i) {
  const q = src[i];
  let j = i + 1, raw = '';
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { raw += c + (src[j + 1] || ''); j += 2; continue; }
    if (c === q || c === '\n') break;
    raw += c;
    j++;
  }
  return { raw, end: j < src.length ? j + 1 : j };
}

/** 从 i 往前找第一个非空白字符（判断 `/` 是正则还是除号） */
function prevSignificant(src, i) {
  for (let j = i - 1; j >= 0; j--) if (!/\s/.test(src[j])) return src[j];
  return '';
}

/** i 指向 `/`；是正则则返回结束位置，否则 -1 */
function readRegex(src, i) {
  const p = prevSignificant(src, i);
  if (/[A-Za-z0-9_$)\]}'"`]/.test(p)) return -1;   // 值后面 → 除号
  let j = i + 1, inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') return -1;                      // 正则不跨行 → 判错了
    if (inClass) { if (c === ']') inClass = false; j++; continue; }
    if (c === '[') { inClass = true; j++; continue; }
    if (c === '/') {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/** i 指向反引号；返回 { parts: [{type:'text'|'expr', value}], end } */
function readTemplate(src, i) {
  const parts = [];
  let j = i + 1, buf = '';
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { buf += c + (src[j + 1] || ''); j += 2; continue; }
    if (c === '`') break;
    if (c === '$' && src[j + 1] === '{') {
      parts.push({ type: 'text', value: buf }); buf = '';
      j += 2;
      const start = j;
      let depth = 1;
      while (j < src.length && depth > 0) {
        const cm = readComment(src, j);
        if (cm >= 0) { j = cm; continue; }
        const d = src[j];
        if (d === "'" || d === '"') { j = readString(src, j).end; continue; }
        if (d === '`') { j = readTemplate(src, j).end; continue; }
        if (d === '/') { const r = readRegex(src, j); if (r >= 0) { j = r; continue; } }
        if (d === '{') depth++;
        else if (d === '}') { depth--; if (!depth) break; }
        j++;
      }
      parts.push({ type: 'expr', value: src.slice(start, j) });
      j++;                                   // 跳过 `}`
      continue;
    }
    buf += c;
    j++;
  }
  parts.push({ type: 'text', value: buf });
  return { parts, end: j < src.length ? j + 1 : j };
}

/* ===================== 文案清洗 ===================== */

function unescapeJs(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out += s[i]; continue; }
    const n = s[i + 1];
    if (n === 'n') { out += '\n'; i++; }
    else if (n === 't') { out += '\t'; i++; }
    else if (n === 'r') { out += '\r'; i++; }
    else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 5; }
    else if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 2, i + 4))) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 3; }
    else if (n === '\n') { i++; }
    else if (n === undefined) { out += '\\'; }
    else { out += n; i++; }
  }
  return out;
}

/**
 * 把「模板串里的文字段」洗成人真正看到的文字。
 *
 * ⚠️ 文字段常常是**半个 HTML**：模板串按 `${}` 切开后，
 *    `<button class="x" data-id="${id}" title="加入队列">下载</button>`
 *    的第二段长这样 —— `" title="加入队列">下载</button>`。
 *
 * 两条铁律（2026-10-14 修，之前都踩了）：
 *
 *  1. **属性值要留下，不能跟着标签一起扔。**
 *     原实现把 `attr="…"` 整段替换成空格，于是模板串里
 *     `title="刷新"`、`placeholder="搜索 Mod 名称"` 的文案全丢了 ——
 *     这些恰恰是 DOM 翻译器要翻的 title / placeholder。
 *     所以先把值摘出来，再处理标签。
 *
 *  2. **标签要变成硬分隔符，不能变成空格。**
 *     `窗口：<b>第 1 步</b>点高亮的` 在 DOM 里是三个**独立文本节点**，
 *     而按空格洗会粘成一条 `窗口： 第 1 步 点高亮的` —— 这条 key 永远不会
 *     在 DOM 里出现，等于白翻。用 `\u0000` 标记边界，`pushText` 照着切。
 */
function cleanHtmlArtifacts(s) {
  return String(s)
    // ① 标签**整体**处理：把标签里的属性值拎到外面，其余丢掉。
    //    必须一步做完 —— 上一版「先摘属性、再删标签」，摘出来的值还留在 `<…>` 内部，
    //    紧接着就被标签正则一起吃掉，于是 `title="Nexus Mod ID（…）"` 整条文案消失。
    .replace(/<[^>]*>/g, (tag) => {
      const vals = [];
      for (const m of String(tag).matchAll(/[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*"([^"]*)"/g)) vals.push(m[1]);
      for (const m of String(tag).matchAll(/[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*'([^']*)'/g)) vals.push(m[1]);
      // ⚠️ 属性值之间必须用**硬分隔符**，不能用空格 ——
      //    否则 `class="chip mid" title="Nexus Mod ID（…）"` 会粘成
      //    `chip mid Nexus Mod ID（…）` 这一条脏 key。
      return '\u0000' + vals.join('\u0000') + '\u0000';
    })
    // ② 模板串被 `${}` 切开后可能只剩半个标签，属性残片在这里收尾
    .replace(/[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*"([^"]*)"/g, ' $1 ')
    .replace(/[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*'([^']*)'/g, ' $1 ')
    // ③ 残留的标签符号 = 边界。
    //    ⚠️ **不含 `=`** —— 文案里正常会出现等号（`留空 = 只用官方通路（推荐）`），
    //    带上 `=` 就被切成两半，DOM 里永远拼不回来。
    .replace(/[<>"']/g, '\u0000')
    // ④ 实体还原放最后，免得还原出来的 `&lt;` 又被 ③ 切掉
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, '  ');
}

/**
 * 这串东西**像不像**给人看的文案。
 *
 * 抽取器只认「含中日韩字符的字符串」，但代码里也有一堆含中文的注释残留、
 * 报错模板、正则片段。它们即便混进字典也永远不会被 DOM 命中（DOM 里没有这些），
 * 但会污染清单、让翻译量翻倍 —— 所以在这里挡掉。
 */
function looksLikeUiText(s) {
  if (!s) return false;
  const t = s.trim();
  if (!t || !CJK.test(t)) return false;
  if (t.length > 120) return false;                    // 单条 UI 文案不可能这么长
  if (/[\r\n]/.test(t)) return false;                  // 多行 → 是代码或大段注释
  if (/^\s*(?:\/\/|\/\*|\*)/.test(t)) return false;    // 注释行
  if (/[；{}]/.test(t) && /[=;]/.test(t)) return false;
  if (/(?:=>|\bfunction\b|\bconst\b|\blet\b|\bvar\b|\breturn\b|\brequire\s*\()/.test(t)) return false;
  if (/\$\s*\(|\.innerHTML|\.textContent|\.value\b|classList/.test(t)) return false;
  if (/^[（(][^）)]*[）)]$/.test(t) && t.length < 4) return false;   // `(空)` 这种
  // 必须以「人话字符」开头：**允许装饰符号打头**（⚡ ● ✓ ↻ ⬇ 🚫…），
  // 只看剥掉前导装饰后剩下的第一个字符。
  // 白名单式的判断漏过一大堆 —— `⚡ 自动授权`、`● 已注册`、`）会自动跳过。` 都是这么丢的。
  const head = t.replace(/^[^\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]+/, '');
  if (!head) return false;
  if (!/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af A-Za-z0-9'"「『（(【·…！？、，。：；~～+\-—#*]/.test(head[0])) return false;
  return true;
}

/**
 * 把一段「含 HTML 的文字」拆成人真正看到的片段。
 * 这些片段在 DOM 里会各自成为独立的文本节点，所以它们就是翻译要用的 key。
 */
function pushText(out, raw) {
  if (!raw) return;
  const cleaned = cleanHtmlArtifacts(unescapeJs(raw));
  if (!CJK.test(cleaned)) return;
  // 清洗后可能还剩 `甲  乙` 这种两段独立文本（原来是两个文本节点）→ 各自入字典。
  // `\u0000` 是标签边界，`\n` 是源码里换行排版造成的两段（DOM 里连着，
  // 但拆成两条更容易命中 —— lookup() 也会按行逐段翻）。
  for (const piece of cleaned.split(/[\u0000\n]|\s{2,}/)) {
    const s = piece.trim();
    if (looksLikeUiText(s)) out.add(s);
  }
}

/* ===================== 主扫描 ===================== */

function extractFromJs(src) {
  const keys = new Set();
  const stats = { strings: 0, tpl: 0, expr: 0 };
  let i = 0;
  while (i < src.length) {
    const cm = readComment(src, i);
    if (cm >= 0) { i = cm; continue; }

    const c = src[i];

    if (c === '/' ) { const r = readRegex(src, i); if (r >= 0) { i = r; continue; } }

    if (c === "'" || c === '"') {
      const { raw, end } = readString(src, i);
      const before = src.slice(Math.max(0, i - 30), i);
      const after = src.slice(end, end + 10);
      const skip = /[=!]==?\s*$/.test(before) || /^[=!]==?/.test(after) ||
        (/[{,]\s*$/.test(before) && /^\s*:/.test(after)) ||
        /\bcase\s*$/.test(before) || /\brequire\s*\(\s*$/.test(before) ||
        /new\s+RegExp\s*\(\s*$/.test(before);
      if (!skip && CJK.test(raw)) { pushText(keys, raw); stats.strings++; }
      i = end;
      continue;
    }

    if (c === '`') {
      const { parts, end } = readTemplate(src, i);
      for (const p of parts) {
        if (p.type === 'expr') {
          // `${cond ? '中文甲' : '中文乙'}`、`${arr.map(x => `<b>${x}</b>`)}` ——
          // 面向用户的文案大量藏在表达式里。上一版把 expr 整段跳过，
          // 于是「重装 / 更新 UE4SS」「Mod 运行依赖」这类条件文案一条都没抽到。
          const sub = extractFromJs(p.value);
          for (const k of sub.keys) keys.add(k);
          stats.expr++;
          continue;
        }
        if (!p.value || !CJK.test(p.value)) continue;
        pushText(keys, p.value);
        stats.tpl++;
      }
      i = end;
      continue;
    }

    i++;
  }
  return { keys: [...keys].sort(), stats };
}

function extractFromHtml(src) {
  const out = new Set();
  const body = src.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  for (const m of body.matchAll(/\b(?:title|placeholder|alt)\s*=\s*"([^"]*)"/gi)) {
    const v = m[1].trim();
    if (looksLikeUiText(v)) out.add(v);
  }
  const noTags = cleanHtmlArtifacts(body);
  for (const piece of noTags.split(/[\u0000\n]|\s{2,}/)) {
    const s = piece.trim();
    if (looksLikeUiText(s)) out.add(s);
  }
  return [...out].sort();
}

function main() {
  const js = extractFromJs(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8'));
  const html = extractFromHtml(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8'));
  const all = [...new Set([...js.keys, ...html])].sort();

  const jsonArg = process.argv.find(a => a.startsWith('--json'));
  if (jsonArg) {
    const out = JSON.stringify(all, null, 1);
    if (jsonArg.includes('=')) {
      const p = jsonArg.slice(jsonArg.indexOf('=') + 1);
      fs.writeFileSync(p, out, 'utf8');
      console.log('已写入 ' + p);
    } else console.log(out);
    return;
  }

  console.log('app.js  字符串 ' + js.stats.strings + ' · 模板文字段 ' + js.stats.tpl +
    ' · 模板表达式 ' + js.stats.expr);
  console.log('index.html  ' + html.length + ' 条');
  console.log('去重后 **' + all.length + '** 条待翻译文案，合计 ' + all.reduce((s, k) => s + k.length, 0) + ' 字符\n');
  const show = process.argv.includes('--all') ? all : all.slice(0, 80);
  for (const k of show) console.log('  ' + (k.length > 90 ? k.slice(0, 87) + '…' : k).replace(/\n/g, '\\n'));
  if (!process.argv.includes('--all') && all.length > show.length) console.log('  …（还有 ' + (all.length - show.length) + ' 条，加 --all 看全）');
}

main();
