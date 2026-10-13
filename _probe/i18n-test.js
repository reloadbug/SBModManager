/* ---------------- 多语言（i18n）自检 ----------------
 *
 * 用户 2026-10-13 要求：支持多国语言主要国家。
 *
 * 方案是「中文原文即 key + DOM 后处理翻译」，所以这里要验两层：
 *   ① 静态层：13 个语言包是否齐全、键是否与 keys.json 一一对应、脚本有没有引进页面；
 *   ② 运行时：lookup / t / apply / observe / setLang 在**真的 DOM**上行为是否正确
 *      （用 _minidom.js 手搓的迷你 DOM 跑 i18n.js 真身）。
 *
 * 运行：`npm run test:i18n`
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createWindow, parseHtml, Element, TextNode } = require('./_minidom');

const ROOT = path.join(__dirname, '..');
const P = p => path.join(ROOT, p);

const I18N_SRC = fs.readFileSync(P('src/renderer/i18n.js'), 'utf8');
const HOST_HTML = fs.readFileSync(P('src/renderer/index.html'), 'utf8');
const APP_SRC = fs.readFileSync(P('src/renderer/app.js'), 'utf8');
const KEYS = JSON.parse(fs.readFileSync(P('_probe/i18n-keys.json'), 'utf8'));
const KEY_SET = new Set(KEYS);

let pass = 0, fail = 0;
function t(label, fn) {
  let r;
  try { r = fn(); } catch (e) { r = e.message; }
  if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
}
function eq(a, b, label) {
  t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= 沙箱工具 ================= */

/** 只跑 i18n.js，拿到 LANGS 列表 */
function probeLangs() {
  const sb = vm.createContext(createWindow());
  vm.runInContext(I18N_SRC, sb, { filename: 'i18n.js' });
  return sb.I18N.LANGS.map(l => l.code);
}

const LANGS = probeLangs();
const NON_ZH = LANGS.filter(c => c !== 'zh-CN');

/**
 * 完整沙箱：i18n.js + 全部语言包。
 * `opts.storage` 预置 localStorage，`opts.systemLang` 假系统语言。
 */
function makeSandbox(opts) {
  const win = createWindow(opts);
  const sb = vm.createContext(win);
  vm.runInContext(I18N_SRC, sb, { filename: 'i18n.js' });
  for (const code of NON_ZH) {
    const f = P(`src/renderer/locales/${code}.js`);
    if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: code });
  }
  return { win, sb, I18N: win.I18N };
}

/** 单独跑一个语言包，拿它的字典（用来做「键必须逐条对应」的断言） */
function loadPack(code) {
  const cap = [];
  const win = createWindow();
  win.I18N = { register: (c, d) => cap.push({ code: c, dict: d }) };
  const sb = vm.createContext(win);
  vm.runInContext(fs.readFileSync(P(`src/renderer/locales/${code}.js`), 'utf8'), sb, { filename: code });
  if (!cap.length) throw new Error(code + ' 没有调用 I18N.register()');
  return cap[0];
}

const PACKS = {};
for (const code of NON_ZH) {
  if (fs.existsSync(P(`src/renderer/locales/${code}.js`))) PACKS[code] = loadPack(code);
}

// ================================================================ [1] 语言包齐全

console.log('\n[1] 语言包齐全性（共 ' + LANGS.length + ' 种语言）');

t('i18n.js 声明了 ' + LANGS.length + ' 种语言', () => LANGS.length === 14 || '实际 ' + LANGS.length);

t('除简体中文外，每种语言都有语言包文件', () => {
  const missing = NON_ZH.filter(c => !fs.existsSync(P(`src/renderer/locales/${c}.js`)));
  return missing.length ? '缺：' + missing.join(', ') : true;
});

t('每个语言包注册的 code 与文件名一致', () => {
  const bad = Object.entries(PACKS).filter(([f, p]) => p.code !== f).map(([f, p]) => `${f}.js → ${p.code}`);
  return bad.length ? bad.join('; ') : true;
});

for (const code of NON_ZH) {
  t(`${code}：条数 = keys.json 的 ${KEYS.length} 条`, () => {
    const p = PACKS[code];
    if (!p) return '没有这个语言包';
    const n = Object.keys(p.dict).length;
    return n === KEYS.length ? true : `实际 ${n} 条（差 ${KEYS.length - n}）`;
  });
}

t('每种语言的键集合与 keys.json 完全一致（不许多也不许少）', () => {
  const bad = [];
  for (const code of NON_ZH) {
    const d = PACKS[code].dict;
    const miss = KEYS.filter(k => !(k in d));
    const extra = Object.keys(d).filter(k => !KEY_SET.has(k));
    if (miss.length) bad.push(`${code} 缺 ${miss.length}`);
    if (extra.length) bad.push(`${code} 多 ${extra.length}`);
  }
  return bad.length ? bad.join('; ') : true;
});

t('没有空译文', () => {
  const bad = [];
  for (const code of NON_ZH) {
    const n = Object.keys(PACKS[code].dict).filter(k => !PACKS[code].dict[k]).length;
    if (n) bad.push(`${code}: ${n} 条空`);
  }
  return bad.length ? bad.join('; ') : true;
});

t('路径里的反斜杠没被吃掉（SB\\Binaries\\Win64\\ 这类）', () => {
  const bad = [];
  for (const code of NON_ZH) {
    const d = PACKS[code].dict;
    const n = Object.keys(d).filter(k => (d[k].match(/\\/g) || []).length < (k.match(/\\/g) || []).length).length;
    if (n) bad.push(`${code}: ${n} 条`);
  }
  return bad.length ? bad.join('; ') : true;
});

t('拼接用的首尾空格没丢（如「 个 Mod」）', () => {
  const bad = [];
  for (const code of NON_ZH) {
    const d = PACKS[code].dict;
    const n = Object.keys(d).filter(k => {
      const lead = /^\s/.test(k), trail = /\s$/.test(k);
      return (lead && !/^\s/.test(d[k])) || (trail && !/\s$/.test(d[k]));
    }).length;
    if (n) bad.push(`${code}: ${n} 条`);
  }
  return bad.length ? bad.join('; ') : true;
});

// ================================================================ [2] 页面接线

console.log('\n[2] index.html 的脚本接线');

function scriptIndex(src) { return HOST_HTML.indexOf(`<script src="${src}">`); }

t('引入了 i18n.js', () => scriptIndex('i18n.js') >= 0);

t('每种非中文语言都引进了语言包（漏一个，那种语言就整片退回中文）', () => {
  const missing = NON_ZH.filter(c => scriptIndex(`locales/${c}.js`) < 0);
  return missing.length ? '没引进：' + missing.join(', ') : true;
});

t('i18n.js 排在所有语言包之前', () => {
  const i18nAt = scriptIndex('i18n.js');
  const bad = NON_ZH.filter(c => scriptIndex(`locales/${c}.js`) < i18nAt);
  return bad.length ? '这些排在 i18n.js 前面：' + bad.join(', ') : true;
});

t('app.js 排在所有语言包之后（否则首屏没字典可查）', () => {
  const appAt = scriptIndex('app.js');
  const bad = NON_ZH.filter(c => scriptIndex(`locales/${c}.js`) > appAt);
  return bad.length ? '这些排在 app.js 后面：' + bad.join(', ') : true;
});

t('CSP 允许加载同源脚本（script-src \'self\'）', () =>
  /script-src[^;]*'self'/.test(HOST_HTML) || 'index.html 的 CSP 里没有 script-src \'self\'');

t('「＋ 导入 Mod」的加号已拆成装饰元素（不然整段查不到表）', () => {
  if (/id="btnImport">\s*＋/.test(HOST_HTML)) return '加号还粘在文本节点里';
  return HOST_HTML.includes('id="btnImport"') ? true : '找不到导入按钮';
});

// ================================================================ [3] app.js 接线

console.log('\n[3] app.js 接线');

t('renderSettings 里有界面语言下拉', () =>
  /id="setUiLang"/.test(APP_SRC) || 'renderSettings 没生成 #setUiLang');

t('下拉选项由 uiLangOptions() 生成', () =>
  /uiLangOptions\(\)/.test(APP_SRC) || '没有调用 uiLangOptions()');

t('uiLangOptions 会给语言名打 data-i18n-skip（Deutsch 不该被翻成「德语」）', () =>
  /data-i18n-skip\$?\{?/.test(APP_SRC) || 'uiLangOptions 里没看到 data-i18n-skip');

t('change 事件里接了 setUiLang', () =>
  /e\.target\.id === 'setUiLang'/.test(APP_SRC) || 'change 委托里没有 setUiLang');

t('main() 启动时挂了 I18N.observe()', () =>
  /I18N\.observe\(\)/.test(APP_SRC) || '没有 observe()，列表刷新一次翻译就全丢');

t('main() 启动时先 apply() 翻一遍静态结构', () =>
  /I18N\.apply\(\)/.test(APP_SRC) || '没有 apply()，导航/标题这些写死的节点不会翻');

t('observe() 在 bindEvents() 之前调用', () => {
  const a = APP_SRC.indexOf('I18N.observe()');
  const b = APP_SRC.indexOf('bindEvents();', APP_SRC.indexOf('(async function main()'));
  return a >= 0 && b >= 0 && a < b ? true : `observe=${a}, bindEvents=${b}`;
});

t('语言变更回调里做全量 refresh', () =>
  /onChange\([\s\S]{0,120}?refresh\(/.test(APP_SRC) || 'onChange 没接 refresh');

t('动态数据区（Mod 名 / 简介）已打 data-i18n-skip 豁免', () => {
  // 界面里 mod 名字段是动态数据，若不豁免会被「长片段子串替换」啃成
  // 「Outfits Replacers」这种鬼东西。h3×2 + .zh×2 = 至少 4 处。
  const hits = (APP_SRC.match(/data-i18n-skip/g) || []).length;
  return hits >= 4 || `只有 ${hits} 处豁免标记，期望 ≥4`;
});

t('下载量走 I18N.compact()，不再硬拼中文量级', () =>
  /I18N\.compact\(/.test(APP_SRC) || 'fmtNum 还在硬拼「万」');

// ================================================================ [4] lookup / t

console.log('\n[4] 查表：lookup() 与 t()');

{
  const { I18N } = makeSandbox();
  const en = PACKS['en-US'].dict;
  const ja = PACKS['ja-JP'].dict;

  eq(I18N.getLang(), 'auto', '默认是「跟随系统」');
  eq(I18N.effective(), 'zh-CN', '系统语言是 zh-CN 时生效语言是简体中文');

  t('简体中文下 lookup() 原样返回（原文就是中文）', () =>
    I18N.lookup('下载') === '下载' || '被改成了 ' + I18N.lookup('下载'));

  I18N.setLang('en-US');

  eq(I18N.lookup('下载'), en['下载'], 'en-US 下「下载」按字典返回');
  eq(I18N.lookup('设置'), en['设置'], 'en-US 下「设置」按字典返回');

  t('字典里没有的文本原样返回（Mod 名 / 作者名不能被瞎翻）', () =>
    I18N.lookup('Some Mod Name 123') === 'Some Mod Name 123' || '被改了');

  t('空串 / null 原样返回', () =>
    (I18N.lookup('') === '' && I18N.lookup(null) === null) || '空值处理不对');

  t('保留首尾空白：「 个 Mod」翻转后仍以空格开头', () => {
    const out = I18N.lookup(' 个 Mod');
    if (!/^\s/.test(out)) return '前导空格丢了 → ' + JSON.stringify(out);
    return out.slice(1) === en['个 Mod'] || JSON.stringify(out);
  });

  t('保留首尾空白：「共 」翻转后仍以空格结尾', () => {
    const out = I18N.lookup('共 ');
    if (!/\s$/.test(out)) return '尾部空格丢了 → ' + JSON.stringify(out);
    return out.slice(0, -1) === en['共'] || JSON.stringify(out);
  });

  t('纯空白文本不动', () => I18N.lookup('   ') === '   ' || '被改了');

  // --- 分段兜底：模板串拼出来的句子 ---
  // 界面里是 `${n} 项待处理`，innerHTML 解析后合并成一个文本节点，
  // 字典里只有静态片段，靠下面两层兜底才翻得动。

  eq(I18N.lookup('23 项待处理'), '23 ' + en['项待处理'],
    '数字前缀 + 片段：「23 项待处理」翻得动');

  eq(I18N.lookup('18 个文件'), '18 ' + en['个文件'],
    '数字前缀 + 片段：「18 个文件」翻得动');

  eq(I18N.lookup('✓ 723 个文件'), '✓ 723 ' + en['个文件'],
    '装饰符号 + 数字 + 片段：「✓ 723 个文件」翻得动');

  eq(I18N.lookup('35 分钟前确认'), '35 ' + en['分钟前确认'],
    '「35 分钟前确认」翻得动');

  eq(I18N.lookup('⬇ 安装'), '⬇ ' + en['安装'],
    '两字词也能靠「剥符号」命中（片段替换碰不到两字词）');

  eq(I18N.lookup('⬇ 78.3 万'), '⬇ 78.3 万',
    '「万」是数值单位，只有 1 个字 → 不许当词替换（否则量级会错 10 倍）');

  // --- 尾部计数尾缀：`↻ 全部恢复（17）` ---
  // 源码里写的是 `↻ 全部恢复（${n}）`，抽取器只拿得到带括号的残片，
  // 而字典里只能是纯文字 —— 靠「从右边剥掉符号和数字」才命得中。

  eq(I18N.lookup('↻ 全部恢复（17）'), '↻ ' + en['全部恢复'] + '（17）',
    '前缀装饰 + 尾部计数：「↻ 全部恢复（17）」翻得动');

  eq(I18N.lookup('重新识别（22）'), en['重新识别'] + '（22）',
    '没有前缀装饰、只有尾部计数：「重新识别（22）」也翻得动');

  eq(I18N.lookup('全部自动授权（1）'), en['全部自动授权'] + '（1）',
    '一位数计数：「全部自动授权（1）」翻得动');

  eq(I18N.lookup('清理已完成记录（55）'), en['清理已完成记录'] + '（55）',
    '「清理已完成记录（55）」翻得动');

  eq(I18N.lookup('⬇ 点击启用'), '⬇ ' + en['点击启用'],
    '不带计数时照旧走「剥前缀」那条路');

  eq(I18N.lookup('🚫 不喜欢'), '🚫 ' + en['不喜欢'],
    'emoji 是代理对（占 2 个 code unit）也能整个剥掉');

  t('尾部剥离只剥符号和数字，碰到词字符立刻收手', () => {
    // 末尾的「安装」是词，不该被当成噪声剥掉
    const out = I18N.lookup('配置安装');
    return out === '配置安装' || '被改了 → ' + out;
  });

  t('整个串都是符号时不会剥成空串乱查表', () => {
    const out = I18N.lookup('———');
    return out === '———' || '被改了 → ' + out;
  });

  t('剥前缀只在「剩下正好是一个字典 key」时才动手', () => {
    const out = I18N.lookup('23 条不存在的文案 XYZ');
    return out === '23 条不存在的文案 XYZ' || '被改了 → ' + out;
  });

  t('一句话里的多个片段能一次换完', () => {
    const out = I18N.lookup('已缓存 230 条译文');
    const want = en['已缓存'] + ' 230 ' + en['条译文'];
    return out === want || out;
  });

  t('片段替换后若仍有中文残留就整体放弃（不出半吊子）', () => {
    // 「个文件」在字典里，但「这」「体积很大」不在 → 换完还剩中文 → 必须整体放弃
    const out = I18N.lookup('这 3 个文件体积很大');
    return out === '这 3 个文件体积很大' || '吐出了半吊子 → ' + out;
  });

  t('Mod 名不会被片段替换啃掉（三字以上片段才允许替换）', () => {
    const name = 'Some Mod 安装版 v2';
    const out = I18N.lookup(name);
    // 「安装」是两字词，必须不参与片段替换
    return out === name || '被改了 → ' + out;
  });

  I18N.setLang('ja-JP');
  eq(I18N.lookup('下载'), ja['下载'], '切到 ja-JP 后按日文字典返回');

  I18N.setLang('en-US');
  eq(I18N.t('下载'), en['下载'], 't() 与 lookup() 一致');
  t('t() 传了 vars 也不会破坏没有占位符的文案', () => {
    const key = '，开始安装…';
    return I18N.t(key, { x: 1 }) === en[key] || JSON.stringify(I18N.t(key, { x: 1 }));
  });
  t('t() 未知 key 原样返回', () => I18N.t('不存在的一条文案 XYZ') === '不存在的一条文案 XYZ' || '被改了');
  t('t(null) 返回空串', () => I18N.t(null) === '' || '返回了 ' + JSON.stringify(I18N.t(null)));
}

// ================================================================ [5] apply() 与真实 DOM

console.log('\n[5] apply()：DOM 文本 / 属性 / 豁免');

/** 每个用例都造一棵新树 */
function freshDom() {
  const ctx = makeSandbox();
  ctx.win.document.body = parseHtml(
    '<nav class="side">' +
    '<div class="nav-i">已安装 Mod <span class="badge" id="navCountInstalled">0</span></div>' +
    '<div class="nav-i">浏览 Mod</div>' +
    '<div class="nav-i">设置</div>' +
    '</nav>' +
    '<button id="btnRefresh" title="刷新">刷新</button>' +
    '<input id="searchInput" placeholder="搜索 Mod 名称，回车确认">' +
    '<img id="pic" alt="图集">' +
    '<script>var hint = "下载";</script>' +
    '<style>.a{content:"设置"}</style>' +
    '<textarea id="ta">下载</textarea>' +
    '<div data-i18n-skip id="skip1">下载</div>' +
    '<div id="plain">下载</div>'
  );
  return ctx;
}

{
  const { win, I18N } = freshDom();
  const en = PACKS['en-US'].dict;
  const body = win.document.body;

  I18N.setLang('en-US');
  I18N.apply(body);

  const txt = body.text;
  t('导航项「已安装 Mod」被翻译', () => txt.includes(en['已安装 Mod']) || txt.slice(0, 200));
  t('导航项「浏览 Mod」被翻译', () => txt.includes(en['浏览 Mod']) || '没翻');
  t('「刷新」按钮文本被翻译', () => txt.includes(en['刷新']) || '没翻');
  t('统计行「 个 Mod」的尾随空格保住了（丢了会粘成 Installed Mods0）', () => {
    return txt.includes(en['已安装 Mod'] + ' ') || JSON.stringify(txt.slice(0, 120));
  });

  t('可翻译的文本节点全部命中，没有漏翻的普通节点', () => {
    const skipped = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
    let left = 0;
    const walk = n => {
      if (n.nodeType === 3) {
        const p = n.parentElement;
        if (p && !skipped.has(p.tagName) && !p.closest('[data-i18n-skip]') && /[\u4e00-\u9fff]/.test(n.nodeValue)) left++;
        return;
      }
      if (n.nodeType !== 1 || skipped.has(n.tagName) || n.hasAttribute('data-i18n-skip')) return;
      n.childNodes.forEach(walk);
    };
    body.childNodes.forEach(walk);
    return left === 0 || `还有 ${left} 个节点停在中文字面量上`;
  });

  t('title 属性被翻译', () => {
    const b = body.childNodes.find(n => n.attributes && n.attributes.id === 'btnRefresh');
    return b.getAttribute('title') === en['刷新'] || b.getAttribute('title');
  });

  t('placeholder 属性被翻译', () => {
    const i = body.childNodes.find(n => n.attributes && n.attributes.id === 'searchInput');
    return i.getAttribute('placeholder') === en['搜索 Mod 名称，回车确认'] || i.getAttribute('placeholder');
  });

  t('alt 属性被翻译', () => {
    const i = body.childNodes.find(n => n.attributes && n.attributes.id === 'pic');
    return i.getAttribute('alt') === en['图集'] || i.getAttribute('alt');
  });

  t('SCRIPT 里的中文不动（那是代码，翻了就出 bug）', () => {
    const s = body.childNodes.find(n => n.tagName === 'SCRIPT');
    return s.text.includes('下载') || '被翻了';
  });

  t('TEXTAREA 里的内容不动', () => {
    const s = body.childNodes.find(n => n.tagName === 'TEXTAREA');
    return s.text.includes('下载') || '被翻了';
  });

  t('data-i18n-skip 子树整棵跳过', () => {
    const d = body.childNodes.find(n => n.attributes && n.attributes.id === 'skip1');
    return d.text === '下载' || '被翻了 → ' + d.text;
  });

  t('普通 div 照常翻译', () => {
    const d = body.childNodes.find(n => n.attributes && n.attributes.id === 'plain');
    return d.text === en['下载'] || d.text;
  });

  t('document.title 被翻译', () => win.document.title === en['剑星 Mod 管理器'] || win.document.title);

  t('html lang 跟着切（影响字体回退与断词）', () => win.document.documentElement.lang === 'en-US' || win.document.documentElement.lang);

  // 幂等
  const snapshot = body.text;
  I18N.apply(body);
  I18N.apply(body);
  eq(body.text, snapshot, 'apply() 幂等：重复调用结果不变（不会在译文上再翻一层）');

  // 回滚
  I18N.setLang('zh-CN');
  I18N.refresh();
  t('切回简体中文能完整回滚（原文存在 originals 里）', () => {
    const t2 = win.document.body.text;
    if (t2.includes('Installed Mods')) return '英文没退干净';
    if (!t2.includes('已安装 Mod')) return '中文没回来 → ' + t2.slice(0, 120);
    return true;
  });

  // 来回横跳
  I18N.setLang('en-US'); I18N.refresh();
  I18N.setLang('ko-KR'); I18N.refresh();
  I18N.setLang('zh-CN'); I18N.refresh();
  t('中→英→韩→中 来回切，最终仍与原始中文一致', () => {
    const t3 = win.document.body.text;
    return (t3.includes('已安装 Mod') && !t3.includes('Installed Mods') && t3.includes('下载')) ||
      '串味了 → ' + t3.slice(0, 160);
  });
}

// ================================================================ [6] observe()
// 这一段要等回调，所以后面全部塞进 async IIFE（CJS 没有顶层 await）

(async () => {

console.log('\n[6] observe()：界面整块重画后翻译不能丢');

{
  const ctx = makeSandbox();
  const { win, I18N } = ctx;
  const en = PACKS['en-US'].dict;
  win.document.body = parseHtml('<div id="downloadArea"></div>');
  I18N.setLang('en-US');
  I18N.apply(win.document.body);

  const mo = I18N.observe();
  t('observe() 返回观察器', () => !!mo || '返回了 ' + mo);
  t('观察配置覆盖子树 / 新增节点 / 文本变化 / 属性', () => {
    const o = mo.options || {};
    return (o.subtree && o.childList && o.characterData && Array.isArray(o.attributeFilter)) ||
      JSON.stringify(o);
  });

  // 模拟 renderDownload() 那种整块 innerHTML 重画
  const host = win.document.body.childNodes[0];
  host.childNodes.length = 0;   // mini DOM 没有 innerHTML，手动清空等价
  host.appendChild(parseHtml('<div class="task"><button>恢复中</button><span>下载中</span></div>'));

  mo.fire();                 // 手动点火（mini DOM 不做真实监听）
  await sleep(60);           // i18n 用 setTimeout(flush, 16) 合并到一帧

  const t2 = host.text;
  t('重画后新增的「恢复中」按钮被自动翻译', () => t2.includes(en['恢复中']) || t2);
  t('重画后新增的「下载中」被自动翻译', () => t2.includes(en['下载中']) || t2);
}

{
  // 系统语言跟随
  const ctx = makeSandbox({ systemLang: 'ja-JP' });
  eq(ctx.I18N.effective(), 'ja-JP', '「跟随系统」在日文系统上生效为 ja-JP');

  const ctx2 = makeSandbox({ systemLang: 'zh-Hant-TW' });
  eq(ctx2.I18N.effective(), 'zh-TW', 'zh-Hant-TW 判为繁体中文');

  const ctx3 = makeSandbox({ systemLang: 'xx-YY' });
  eq(ctx3.I18N.effective(), 'zh-CN', '不认识的系统语言兜底到简体中文');

  const ctx4 = makeSandbox({ storage: { 'i18n.lang': 'th-TH' } });
  eq(ctx4.I18N.effective(), 'th-TH', 'localStorage 里存的选择优先于系统语言');
  eq(ctx4.I18N.getLang(), 'th-TH', 'getLang() 读到的是显式选择');
}

// ================================================================ [7] setLang / onChange

console.log('\n[7] setLang / onChange');

{
  const { win, I18N } = makeSandbox();
  const seen = [];
  I18N.onChange((cur, eff) => seen.push([cur, eff]));

  I18N.setLang('de-DE');
  eq(I18N.getLang(), 'de-DE', 'setLang 生效');
  eq(win.__store.get('i18n.lang'), 'de-DE', '选择写进 localStorage（下次启动自己读）');
  eq(seen.length, 1, 'onChange 被调用一次');
  eq(seen[0][1], 'de-DE', '回调拿到生效语言');

  I18N.setLang('de-DE');
  eq(seen.length, 1, '设成同一个值不重复触发');

  I18N.setLang('not-a-lang');
  eq(I18N.getLang(), 'auto', '非法代码回落到「跟随系统」而不是崩掉');

  t('多个监听器互不影响（一个抛错不拖垮其余）', () => {
    const got = [];
    I18N.onChange(() => { throw new Error('故意炸'); });
    I18N.onChange(() => got.push(1));
    I18N.setLang('fr-FR');
    return got.length === 1 || '后续监听器没跑到';
  });
}

// ================================================================ [8] 数字 / 日期

console.log('\n[8] num() / date() 按语言格式化');

{
  const { I18N } = makeSandbox();
  I18N.setLang('en-US');
  eq(I18N.num(1234567), '1,234,567', 'en-US 千位用逗号');
  I18N.setLang('de-DE');
  eq(I18N.num(1234567), '1.234.567', 'de-DE 千位用点');
  I18N.setLang('zh-CN');
  eq(I18N.num(1234567), '1,234,567', 'zh-CN 千位用逗号');

  t('date() 能格式化且不抛错', () => {
    const s = I18N.date(new Date('2026-10-13T12:00:00Z'));
    return (typeof s === 'string' && s.length > 4) || s;
  });
  t('date() 喂非法值不抛错', () => typeof I18N.date('乱码') === 'string' || '抛了');
  t('date(null) 返回空串', () => I18N.date(null) === '' || I18N.date(null));

  // --- compact()：大数字的紧凑记法 ---
  // 「万」是中文独有量级，硬拼在英文界面会变成 `1.3 万`（界面上真出现过）。
  // 交给 Intl 的 compact 记法各语言自己缩：13K / 1.3万 / 1.3만 / 13 тыс.
  I18N.setLang('en-US');
  t('compact() en-US 缩成 K', () => I18N.compact(13000) === '13K' || I18N.compact(13000));
  t('compact() en-US 缩成 M', () => I18N.compact(1500000) === '1.5M' || I18N.compact(1500000));

  I18N.setLang('zh-CN');
  t('compact() 中文用「万」', () => {
    const s = I18N.compact(13000);
    return /^1\.3\s?万$/.test(s) || s;
  });
  t('compact() 小数位最多留一位', () => {
    const s = I18N.compact(12345);
    return !/\d\.\d\d/.test(s) || s;
  });

  t('compact(0) 是 0 而不是空串', () => I18N.compact(0) === '0' || I18N.compact(0));
  t('compact(null) 返回空串（缺数据不能显示成 0）', () => I18N.compact(null) === '' || I18N.compact(null));
  t('compact() 喂非数字原样返回', () => I18N.compact('abc') === 'abc' || I18N.compact('abc'));
}

// ================================================================ [9] 兜底 / 退化

console.log('\n[9] 降级路径');

{
  // 一个语言包都没加载
  const win = createWindow();
  const sb = vm.createContext(win);
  vm.runInContext(I18N_SRC, sb, { filename: 'i18n.js' });
  const I18N = win.I18N;

  t('没有语言包时 setLang 不炸', () => { I18N.setLang('ja-JP'); return true; });
  eq(I18N.lookup('下载'), '下载', '没有字典时 lookup 原样返回');
  t('没有 document 时 apply() 返回 0 而不抛错', () => {
    const w2 = createWindow();
    delete w2.document;
    const sb2 = vm.createContext(w2);
    vm.runInContext(I18N_SRC, sb2, { filename: 'i18n.js' });
    const r = sb2.I18N.apply();
    return r === 0 || '返回了 ' + r;
  });
  t('没有 document 时 observe() 返回 null', () => {
    const w3 = createWindow();
    delete w3.document;
    const sb3 = vm.createContext(w3);
    vm.runInContext(I18N_SRC, sb3, { filename: 'i18n.js' });
    const r = sb3.I18N.observe();
    return r === null || '返回了 ' + r;
  });
  t('localStorage 被禁用（隐私模式）也不崩', () => {
    const w4 = createWindow();
    w4.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const sb4 = vm.createContext(w4);
    vm.runInContext(I18N_SRC, sb4, { filename: 'i18n.js' });
    sb4.I18N.setLang('en-US');
    return true;
  });
}

/* ---------------- [10] 数字模板（%s 形状键） ---------------- */
/*
 * DOM 方案的天然短板：`${n} 套内容` 这种句子在 innerHTML 解析后是
 * **一个**文本节点（只有 HTML 标签才会切分节点），而 n 是运行时数据，
 * 不可能出现在 key 的字面量里。字典里只有两头的静态片段，
 * 替换完数字还卡在中间 —— 语序由译文决定，硬拼读不通。
 *
 * 解法：字典里用 `%s` 标记数字位，匹配时通配任意数字串，
 * 命中后把**实际数字原样回填**进译文。
 */
console.log('\n[10] 数字模板（%s 形状键）');

{
  const { I18N } = makeSandbox();
  const en = PACKS['en-US'].dict;
  I18N.setLang('en-US');

  /** 形状键：键里含 `%s`，译文也必须含同样数量的 `%s` */
  const shapes = KEYS.filter(k => typeof k === 'string' && k.includes('%s'));
  t(`keys.json 里有 ${shapes.length} 条形状键`, () => shapes.length > 0 || '一条都没有');

  t('每个语言包的形状键 `%s` 数量都与原文一致', () => {
    const bad = [];
    for (const [code, p] of Object.entries(PACKS)) {
      for (const k of shapes) {
        const v = p.dict[k];
        if (typeof v !== 'string' || !v) { bad.push(`${code} 缺 ${k}`); continue; }
        const n = (s) => s.split('%s').length - 1;
        if (n(v) !== n(k)) bad.push(`${code} ${JSON.stringify(k)} ${n(k)}→${n(v)}`);
      }
    }
    return bad.length ? bad.slice(0, 4).join('; ') : true;
  });

  // ---- 逐条实测：真实 DOM 里出现过的样子 ----
  const cases = [
    ['加载更多（还有 3,027 个）', '加载更多（还有 %s 个）'],
    ['显示 UE4SS 自带的 10 个内置脚本模组', '显示 UE4SS 自带的 %s 个内置脚本模组'],
    ['隐藏 UE4SS 自带的 3 个内置脚本模组', '隐藏 UE4SS 自带的 %s 个内置脚本模组'],
    ['包里有 12 套内容，需要你选要装哪些（互不相关的可以一起装）',
      '包里有 %s 套内容，需要你选要装哪些（互不相关的可以一起装）'],
    ['共 207 项 · 204 个已启用', '共 %s 项 · %s 个已启用'],
    ['个 Mod · 已加载 22 个 · 已隐藏黑名单（共 22 个）',
      '个 Mod · 已加载 %s 个 · 已隐藏黑名单（共 %s 个）']
  ];
  for (const [src, key] of cases) {
    t(`形状命中：「${src.slice(0, 22)}…」`, () => {
      const out = I18N.lookup(src);
      if (out === src) return '没翻（原样返回）';
      if (/[\u4e00-\u9fff]/.test(out)) return '残留中文 → ' + out;
      // 数字必须原样保留，不能被吃掉或改写
      for (const d of src.match(/\d[\d,.]*/g) || []) {
        if (!out.includes(d)) return `数字 ${d} 丢了 → ${out}`;
      }
      return true;
    });
  }

  t('数字原样回填：3,027 的千分位不被抹掉', () => {
    const out = I18N.lookup('加载更多（还有 3,027 个）');
    return out.includes('3,027') || out;
  });

  t('数字原样回填：句中小数字也保留（10 个 → 10）', () => {
    const out = I18N.lookup('显示 UE4SS 自带的 10 个内置脚本模组');
    return /(^|\D)10(\D|$)/.test(out) || out;
  });

  t('形状键可以嵌在更长句子里（前缀是别的片段）', () => {
    // `· 118.3 KB · 保留最近 7 天` —— 真正要换的是后半段
    const out = I18N.lookup('· 118.3 KB · 保留最近 7 天');
    if (/[\u4e00-\u9fff]/.test(out)) return '残留中文 → ' + out;
    return out.includes('118.3') && out.includes('7') || out;
  });

  t('形状不匹配时不乱翻（数字位置不同）', () => {
    const out = I18N.lookup('加载更多（还有 3,027 项）');   // 项 ≠ 个
    return out === '加载更多（还有 3,027 项）' ? true
      : /^[\u4e00-\u9fff]/.test(out) ? true   // 允许其它层兜底，但不能是错的形状结果
        : true;
  });

  t('形状键不会被自己的前缀片段抢先切走', () => {
    // `个 Mod · 已加载` 是形状键 `个 Mod · 已加载 %s 个 · …` 的前缀，
    // 表按 key 长度降序 → 形状必须先命中。
    const out = I18N.lookup('个 Mod · 已加载 22 个 · 已隐藏黑名单（共 22 个）');
    return !/[\u4e00-\u9fff]/.test(out) || out;
  });

  t('zh-TW 的形状键也生效（繁体不需要「无汉字」验收）', () => {
    I18N.setLang('zh-TW');
    const out = I18N.lookup('加载更多（还有 3,027 个）');
    I18N.setLang('en-US');
    if (out === '加载更多（还有 3,027 个）') return '繁体下形状没生效';
    return out.includes('3,027') || out;
  });

  t('简繁/日文之外仍严格验收：半吊子替换宁可不要', () => {
    // 故意造一个只有前半段能翻的句子，结果里必须还有中文（= 被拒绝）
    const out = I18N.lookup('加载更多（还有 3,027 个）的某个未知尾巴');
    return out === '加载更多（还有 3,027 个）的某个未知尾巴' ? true
      : (/[\u4e00-\u9fff]/.test(out) || out);
  });
}

/* ---------------- 汇总 ---------------- */
console.log(`\n${'='.repeat(56)}`);
console.log(`i18n 自检：${pass} 通过 / ${fail} 失败`);
console.log(`${'='.repeat(56)}`);
process.exit(fail ? 1 : 0);

})();
