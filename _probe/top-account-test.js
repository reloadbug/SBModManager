'use strict';
/**
 * 顶栏「已登录 → 显示账号 + 头像」。
 *
 * 用户诉求（2026-10-13）：顶栏如果已经登录了，显示账号和头像。
 *
 * 纯 Node，两条路：
 *   1. **判定脚本**（`nexusAuth.SCRIPT_VERIFY_ANY`）—— 从源码抽出模板字符串，
 *      喂一套假 DOM 真跑，钉死「用户名 + 头像」的提取逻辑；
 *   2. **渲染层** `renderTopAccount()` —— 从 app.js 抽出真身，喂假按钮跑三态。
 *
 * ⚠️ `nexusAuth.js` 顶层 `require('electron')`，纯 Node 不能 require —— 只能抽源码。
 *
 * 运行：`npm run test:top-account`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NEXUSAUTH = path.join(__dirname, '..', 'src', 'main', 'nexusAuth.js');
const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const CSS = path.join(__dirname, '..', 'src', 'renderer', 'style.css');
const HTML = path.join(__dirname, '..', 'src', 'renderer', 'index.html');

const authCode = fs.readFileSync(NEXUSAUTH, 'utf8');
const appCode = fs.readFileSync(APP, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

// ================================================================ 1. 判定脚本（跑真身）

console.log('\n[1] SCRIPT_VERIFY_ANY：用户名 + 头像提取');

const creM = authCode.match(/const CHALLENGE_RE = '([^']*)';/);
const scriptM = authCode.match(/const SCRIPT_VERIFY_ANY = `([\s\S]*?)`;/);
t('源码里能找到 CHALLENGE_RE', () => !!creM || '找不到');
t('源码里能找到 SCRIPT_VERIFY_ANY', () => !!scriptM || '找不到');

let SCRIPT = null;
{
  const ctx = { CHALLENGE_RE: creM[1] };
  vm.createContext(ctx);
  vm.runInContext('this.S = `' + scriptM[1] + '`;', ctx);
  SCRIPT = ctx.S;
}
t('脚本能重新拼出来（模板转义没坏）', () => typeof SCRIPT === 'string' && SCRIPT.includes('Welcome back') || '拼接失败');

/** 假 DOM。`avatarSrc` 给值 → 有头像；`userHref`/`userText` 给值 → 有用户链接 */
function mkDoc({ title = 'Nexus Mods', text = '', avatarSrc = null, userHref = null, userText = '' } = {}) {
  return {
    title,
    body: { innerText: text },
    querySelector(sel) {
      if (/img/.test(sel)) return avatarSrc ? { currentSrc: '', src: avatarSrc } : null;
      if (/a\[href\^="\/users\/"\]/.test(sel)) {
        if (!userHref && !userText) return null;
        return { textContent: userText, getAttribute: () => userHref };
      }
      if (/#mainContent/.test(sel)) return { innerText: text };
      return null;
    }
  };
}
// ⚠️ `SCRIPT_VERIFY_ANY` 本身已经是 `(() => {...})()` 自执行 IIFE —— 直接 `return` 它，
//    再包一层 `(...)()` 会变成 `(() => {})()()` → 「(intermediate value)(...) is not a function」。
const runScript = (doc, url = 'https://www.nexusmods.com/stellarblade') => {
  const f = new Function('location', 'document', 'return ' + SCRIPT);
  return f({ href: url }, doc);
};

{
  const r1 = runScript(mkDoc({ text: 'Welcome back, TestUser\nSome other text' }));
  eq(r1.loggedIn, true, '「Welcome back, X」→ 已登录');
  eq(r1.user, 'TestUser', '拿到用户名');
  eq(r1.avatar, null, '没头像时 avatar = null（不编造）');
  eq(r1.via, 'welcome-back', 'via 标注来源');

  const r2 = runScript(mkDoc({ text: 'Welcome back, Bob', avatarSrc: 'https://x/a.png' }));
  eq(r2.avatar, 'https://x/a.png', 'Welcome back 分支也带上头像');

  const r3 = runScript(mkDoc({ text: 'some page', avatarSrc: 'https://x/b.png', userText: 'Carol' }));
  eq(r3.loggedIn, true, '头像 + 用户链接 → 已登录');
  eq(r3.user, 'Carol', '从链接文字取用户名');
  eq(r3.avatar, 'https://x/b.png', '拿到头像 URL');
  eq(r3.via, 'avatar', 'via = avatar');

  const r4 = runScript(mkDoc({ text: 'some page', avatarSrc: 'https://x/c.png', userHref: '/users/Jane%20Doe' }));
  eq(r4.user, 'Jane Doe', '链接没文字时从 href 的 /users/<name> 取，并解码');

  const r5 = runScript(mkDoc({ text: 'Access Denied\nFull authentication is required to access this resource' }));
  eq(r5.loggedIn, false, '主体含 Access Denied → 未登录');
  eq(r5.via, 'access-denied', 'via = access-denied');

  const r6 = runScript(mkDoc({ text: 'sign in page' }), 'https://users.nexusmods.com/auth/sign_in');
  eq(r6.loggedIn, false, 'URL 在登录页 → 未登录');

  const r7 = runScript(mkDoc({ title: 'Just a moment...', text: 'Just a moment... checking your browser' }));
  eq(r7.__retry, true, 'Cloudflare 挑战页 → 重试（不误判）');
}

console.log('\n[2] 缓存：头像只在有值时覆盖');
{
  t('getStatus 返回 avatar', () => /avatar: c\.avatar \|\| null/.test(authCode) || '缺失');
  t('inWin 分支：头像有值才写缓存', () => /if \(inWin\.avatar\) patch\.avatar = inWin\.avatar;/.test(authCode) || '缺失');
  t('页面分支：头像有值才写缓存', () => /if \(d\.avatar\) patch\.avatar = d\.avatar;/.test(authCode) || '缺失');
  t('verifyByPage 返回带 avatar', () => /avatar: d\.avatar \|\| null/.test(authCode) || '缺失');
  t('logout 清掉 avatar', () => /writeAuthCache\(\{ loggedIn: false, user: null, avatar: null \}\)/.test(authCode) || '缺失');
  t('缓存默认值含 avatar', () => /loggedIn: false, user: null, avatar: null, at: null/.test(authCode) || '缺失');
}

// ================================================================ 3. 渲染层（跑真身）

console.log('\n[3] renderTopAccount()：三态（抽真身跑）');

function extract(name) {
  const start = appCode.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到 ' + name);
  let i = appCode.indexOf('{', start), depth = 0;
  for (; i < appCode.length; i++) {
    if (appCode[i] === '{') depth++;
    else if (appCode[i] === '}') { depth--; if (!depth) break; }
  }
  return appCode.slice(start, i + 1);
}

function mkBtn() {
  const cls = new Set();
  return {
    _html: '', _text: '', title: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; }
  };
}

{
  const btn = mkBtn();
  const ctx = { state: { auth: null }, $: () => btn };
  vm.createContext(ctx);
  vm.runInContext(extract('esc') + '\n' + extract('renderTopAccount') + '\nthis.f = renderTopAccount;', ctx);
  const render = ctx.f;

  // ① 未登录
  ctx.state.auth = { loggedIn: false, user: null, avatar: null };
  render();
  eq(btn.textContent, 'Nexus 账号', '未登录 → 文案「Nexus 账号」');
  eq(btn.classList.has('acct'), false, '未登录 → 不加 .acct');
  eq(btn.innerHTML, '', '未登录 → 不渲染头像');

  // ② 已登录 + 有头像
  ctx.state.auth = { loggedIn: true, user: 'NexusTester', avatar: 'https://x/av.png' };
  render();
  eq(btn.classList.has('acct'), true, '已登录 → 加 .acct');
  t('已登录 → 渲染 <img class="acct-av">', () => /<img class="acct-av" src="https:\/\/x\/av\.png"/.test(btn.innerHTML) || btn.innerHTML);
  t('已登录 → 显示用户名', () => btn.innerHTML.includes('NexusTester') || btn.innerHTML);
  t('图片 onerror 退化成首字母（经 data-ini 传值，避免嵌套引号被解析器吃掉）', () =>
    /data-ini="N"/.test(btn.innerHTML) && /this\.dataset\.ini/.test(btn.innerHTML) || btn.innerHTML);
  t('title 说明「已登录」', () => /已登录 Nexus：NexusTester/.test(btn.title) || btn.title);

  // ③ 已登录但拿不到头像 → 首字母方块
  ctx.state.auth = { loggedIn: true, user: 'NexusTester', avatar: null };
  render();
  t('没头像 → 首字母方块 .acct-av.ph', () => /<span class="acct-av ph">N<\/span>/.test(btn.innerHTML) || btn.innerHTML);
  t('没头像 → 不出现 <img>（不留破图）', () => !btn.innerHTML.includes('<img') || btn.innerHTML);

  // ④ 用户名为空 → 不显示空白
  ctx.state.auth = { loggedIn: true, user: '', avatar: null };
  render();
  t('用户名为空 → 退回「Nexus 账号」且方块是 N', () =>
    btn.innerHTML.includes('Nexus 账号') && /<span class="acct-av ph">N<\/span>/.test(btn.innerHTML) || btn.innerHTML);

  // ⑤ 状态还没到（bootstrap 前）
  ctx.state.auth = null;
  render();
  eq(btn.textContent, 'Nexus 账号', 'state.auth 为 null 不炸，显示占位文案');
}

console.log('\n[4] 接线与样式');
{
  t('renderAuthLine 里先调 renderTopAccount（放在 #authLine 的 return 之前）', () =>
    /function renderAuthLine\(\) \{\s*\n\s*renderTopAccount\(\);/.test(appCode) || '缺失/位置不对');
  t('index.html 顶栏有 #btnNexusAccount', () => /id="btnNexusAccount"/.test(html) || '缺失');
  t('CSS 有 .btn.acct（flex 布局）', () => /\.btn\.acct\{display:flex/.test(css) || '缺失');
  t('CSS 有 .btn.acct .acct-av（圆形头像）', () => /\.btn\.acct \.acct-av\{[^}]*border-radius:50%/.test(css) || '缺失');
  t('CSS 有 .acct-av.ph（首字母方块）', () => /\.btn\.acct \.acct-av\.ph\{/.test(css) || '缺失');
  t('CSS 有 .acct-nm（名字过长省略号）', () => /\.btn\.acct \.acct-nm\{[^}]*text-overflow:ellipsis/.test(css) || '缺失');
  t('按钮有 max-width（长用户名不会把顶栏撑爆）', () => /\.btn\.acct\{[^}]*max-width:\d+px/.test(css) || '缺失');
  t('CSP 允许 https 图片（头像来自 Nexus 图床）', () =>
    /img-src[^;]*https:/.test(html) || 'CSP 不含 https:');
}

// ---------------------------------------------------------------- 收尾
console.log(`\n${fail === 0 ? '✅' : '❌'} top-account: ${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项：'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
