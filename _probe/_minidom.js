/* ---------------- 迷你 DOM（只喂给 i18n.js 用） ----------------
 *
 * 本机没有 jsdom，而 i18n 的核心恰恰是「遍历 DOM 换文本」——
 * 只做源码断言等于没测。所以这里手写一份**刚好够用**的 DOM：
 * 元素 / 文本节点 / 属性 / firstChild / nextSibling / closest([attr])。
 *
 * 不实现的东西（也不需要）：querySelector、class、事件、样式。
 * 唯一「作弊」的地方是 MutationObserver：它只记录 observe() 的配置，
 * 由测试手动调 `mo.fire()` 触发回调 —— 浏览器原生行为不是我们的代码，
 * 我们真正要验的是「回调里有没有正确 apply」。
 */
'use strict';

const ATTR_SEL = /^\[\s*([\w-]+)\s*\]$/;

function matches(el, sel) {
  const m = ATTR_SEL.exec(String(sel).trim());
  return m ? el.hasAttribute(m[1]) : false;
}

class DomNode {
  constructor() { this.childNodes = []; this.parentNode = null; }

  get firstChild() { return this.childNodes[0] || null; }

  get nextSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return i >= 0 ? (p.childNodes[i + 1] || null) : null;
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }

  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; }
    return c;
  }

  /** 把所有后代文本拼起来（测试里断言用） */
  get text() {
    let s = '';
    const walk = n => {
      if (n.nodeType === 3) s += n.nodeValue;
      else n.childNodes.forEach(walk);
    };
    this.childNodes.forEach(walk);
    return s;
  }
}

class TextNode extends DomNode {
  constructor(v) { super(); this.nodeType = 3; this.nodeValue = v == null ? '' : String(v); }
}

class Element extends DomNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = Object.create(null);
  }
  hasAttribute(n) { return n in this.attributes; }
  getAttribute(n) { return this.hasAttribute(n) ? this.attributes[n] : null; }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  closest(sel) {
    let el = this;
    while (el && el.nodeType === 1) { if (matches(el, sel)) return el; el = el.parentNode; }
    return null;
  }
}

/** 手动点火用的 MutationObserver */
class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this.target = null; this.options = null; this.disconnected = false; }
  observe(t, o) { this.target = t; this.options = o; }
  disconnect() { this.disconnected = true; this.target = null; }
  fire() { if (!this.disconnected) this.cb([{ type: 'childList' }], this); }
}

/**
 * 造一个 window + document。
 * `html` 是可选的 HTML 字符串，支持 <tag attr="v">文本</tag> 这种简单嵌套。
 */
function createWindow(opts) {
  const o = opts || {};

  const doc = {
    title: o.title || '剑星 Mod 管理器',
    documentElement: new Element('html'),
    body: new Element('body'),
    createElement: tag => new Element(tag),
    createTextNode: v => new TextNode(v)
  };
  doc.documentElement.lang = o.lang || 'zh-CN';

  const store = new Map(Object.entries(o.storage || {}));
  const win = {
    document: doc,
    navigator: { language: o.systemLang || 'zh-CN' },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    MutationObserver: FakeMutationObserver,
    __store: store,
    __observers: []
  };
  win.window = win;
  win.globalThis = win;
  // 把每次 new MutationObserver 记下来，测试好拿到实例去点火
  win.MutationObserver = class extends FakeMutationObserver {
    constructor(cb) { super(cb); win.__observers.push(this); }
  };
  return win;
}

/* ---------------- 极简 HTML 解析（测试用足够） ---------------- */

/**
 * 把 `<div class="a">甲<i>乙</i>丙</div>` 解析成节点树。
 * 只认标签名与属性，不处理自闭合与注释之外的怪东西。
 *
 * ⚠️ 属性值**可省略** —— `data-i18n-skip` 就是无值属性，
 *    早期版本只认 `k="v"`，结果整棵 skip 子树都没解析出来。
 */
function parseHtml(html) {
  const root = new Element('div');
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g;
  let last = 0, m;

  const pushText = (s) => {
    if (s) stack[stack.length - 1].appendChild(new TextNode(s));
  };

  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[1];
    const closing = m[0][1] === '/';

    if (closing) {
      // 退栈到匹配的标签
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }

    const el = new Element(tag);
    for (const a of (m[2] || '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      // 无值属性记成空串：hasAttribute 仍然为 true，和浏览器一致
      el.setAttribute(a[1], a[2] === undefined ? '' : a[2]);
    }
    stack[stack.length - 1].appendChild(el);
    // 这些标签没有内容
    if (!/^(BR|HR|IMG|INPUT|META|LINK)$/.test(tag.toUpperCase())) stack.push(el);
  }
  pushText(html.slice(last));
  return root;
}

module.exports = { createWindow, parseHtml, Element, TextNode, DomNode, FakeMutationObserver };
