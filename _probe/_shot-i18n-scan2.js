/* 变体扫描：专治「刷新滞后」假残留。
 *
 * 与 `_shot-i18n-scan.js` 的区别：每个页面先**等它自己渲染稳定**（1.5s），
 * 再显式 `refresh()`，再等 0.6s 才扫描。下载队列那种每秒重画的面板
 * 用原版扫描会抓到"刚重画完、还没轮到翻译"的中间态。
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
  await new Promise(r => setTimeout(r, 1500));   // 先让它自己渲染稳
  try { window.I18N.refresh(); } catch (e) {}
  await new Promise(r => setTimeout(r, 600));    // 再让翻译落地
  scan();
}

try { const d = document.getElementById('drawer'); if (d) d.classList.add('on'); } catch (e) {}
await new Promise(r => setTimeout(r, 300));
try { window.I18N.refresh(); } catch (e) {}
await new Promise(r => setTimeout(r, 600));
scan();

try { window.switchPage('p-settings'); } catch (e) {}
await new Promise(r => setTimeout(r, 500));

return 'I18N_LEFTOVER ' + JSON.stringify(found);
