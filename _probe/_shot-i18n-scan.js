/* 注入脚本：切到英文，把所有页面 walk 一遍，收集**仍然含中文的文本节点与属性**。
 *
 * 目的：DOM 方案有个已知短板 —— 模板串拼出来的句子（`${n} 项待处理`）在 DOM 里
 * 是一个整体文本节点 `23 项待处理`，而字典里只有静态片段 `项待处理`，
 * 整串查表必然落空。这份清单就是要量化「到底漏多少、漏在哪」。
 *
 * ⚠️ 不要在这里自己包 `(async () => {})()`：
 *    --shot-eval-file 已经自动包了一层，再包一层会导致外层 return 丢失 → 拿不到结果。
 *
 * 返回：'I18N_LEFTOVER ' + JSON
 */
const CJK = /[\u4e00-\u9fff]/;
const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE)$/;
const ATTRS = ['title', 'placeholder', 'alt', 'aria-label'];

if (window.I18N) { window.I18N.setLang('en-US'); window.I18N.refresh(); }

const found = [];
const seen = new Set();

function pathOf(el) {
  let s = '', n = el;
  for (let i = 0; i < 3 && n && n.nodeType === 1; i++) {
    const cls = typeof n.className === 'string' && n.className
      ? '.' + n.className.trim().split(/\s+/)[0] : '';
    s = '>' + n.tagName + (n.id ? '#' + n.id : cls) + s;
    n = n.parentElement;
  }
  return s.replace(/^>/, '');
}

function scan() {
  const walk = (node) => {
    if (node.nodeType === 3) {
      const v = node.nodeValue;
      if (CJK.test(v)) {
        const host = node.parentElement ? pathOf(node.parentElement) : '?';
        const k = host + '|' + v.trim();
        if (!seen.has(k)) { seen.add(k); found.push({ at: host, text: v.trim().slice(0, 100) }); }
      }
      return;
    }
    if (node.nodeType !== 1) return;
    if (SKIP_TAGS.test(node.tagName)) return;
    if (node.hasAttribute && node.hasAttribute('data-i18n-skip')) return;
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  };
  for (let c = document.body.firstChild; c; c = c.nextSibling) walk(c);

  for (const el of document.querySelectorAll('[title],[placeholder],[alt],[aria-label]')) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && CJK.test(v)) {
        const k = 'attr|' + a + '|' + v;
        if (!seen.has(k)) { seen.add(k); found.push({ at: pathOf(el) + '@' + a, text: v.slice(0, 100) }); }
      }
    }
  }
}

const pages = ['p-installed', 'p-browse', 'p-download', 'p-prereq', 'p-settings'];
for (const p of pages) {
  try { window.switchPage(p); } catch (e) { /* 忽略 */ }
  await new Promise(r => setTimeout(r, 1000));
  try { window.I18N.refresh(); } catch (e) { /* 忽略 */ }
  await new Promise(r => setTimeout(r, 250));
  scan();
}

// 抽屉也翻一遍
try { const d = document.getElementById('drawer'); if (d) d.classList.add('on'); } catch (e) {}
try { window.I18N.refresh(); } catch (e) {}
await new Promise(r => setTimeout(r, 300));
scan();

// 停在设置页方便顺手截图
try { window.switchPage('p-settings'); } catch (e) {}
await new Promise(r => setTimeout(r, 500));

return 'I18N_LEFTOVER ' + JSON.stringify(found);
