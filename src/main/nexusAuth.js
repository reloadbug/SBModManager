'use strict';
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const paths = require('./paths');
const { readJson, writeJson } = require('./store');

/**
 * Nexus 账号登录。
 *
 * 为什么必须用真实浏览器窗口登录：
 *   1. Nexus 有 Cloudflare 人机验证，只有真实 Chromium 内核能过（且需要用户手点一次）
 *   2. 下载走 nxm:// 协议时，Nexus 需要浏览器里存在有效登录会话
 *   3. 用固定的 persist: 分区保存 Cookie，重启后依然是登录状态
 *
 * 这个分区（PARTITION）后续会被「内置浏览」和「nxm:// 下载」共用，
 * 所以登录一次，全流程通用。
 *
 * ⚠️ 关于「怎么判断已登录」：
 *   不能只看 Cookie 是否存在 —— 未登录的访客同样会拿到 nexusmods_session 之类的 Cookie，
 *   直接判断会误报（实测访客有 8 个 nexusmods 域 Cookie）。所以这里采用
 *   「实际访问账号页，看页面内容」的方式，并把结论缓存到本地，
 *   避免每次启动都开隐藏窗口。
 */

const PARTITION = 'persist:nexus';

const URL_SIGN_IN = 'https://users.nexusmods.com/auth/sign_in';
const URL_ACCOUNT = 'https://www.nexusmods.com/users/myaccount';
// ⚠️ Nexus 已改版：旧的 ?tab=api 会 302 到这里。
// 新页面按第三方应用列出，个人 Key 在最底部，且**必须点「Request Api Key」才生成**。
const URL_API = 'https://www.nexusmods.com/settings/api-keys';
const URL_HOME = 'https://www.nexusmods.com/';

const AUTH_CACHE = path.join(paths.CACHE, 'nexus-auth.json');

/**
 * Cloudflare 挑战页特征（不含斜杠，方便拼进注入脚本）。
 * 必须覆盖中文版——实测国内网络下 Nexus 会返回中文挑战页（"请稍候… / 正在进行安全验证"）。
 */
const CHALLENGE_RE = 'just a moment|checking your browser|verifying you are human|enable javascript and cookies|正在进行安全验证|请稍候|安全服务防护恶意自动程序|Ray ID';

let loginWin = null;
let onAuthChanged = null;

/**
 * 构造一个「纯正」的 Chrome User-Agent。
 *
 * Electron 默认 UA 形如：
 *   Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) 剑星Mod管理器/0.1.0 Chrome/152.x Electron/44.7.0 Safari/537.36
 * 其中 `应用名/版本` 和 `Electron/版本` 两个 token 都会让 Cloudflare Turnstile
 * 判定为「非标准浏览器」并拒绝验证 —— 表现就是点「验证您是真人」后直接报错。
 * 这里只保留 Chrome 版本号，其余全部剥掉。
 */
function cleanUA() {
  const raw = app.userAgentFallback || '';
  const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
  const plat = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : (process.platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64');
  return 'Mozilla/5.0 (' + plat + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
}

// 全局抹掉 Electron 标记（在 ready 之前设置即可生效）
try {
  const ua = cleanUA();
  if (ua) app.userAgentFallback = ua;
} catch { /* 忽略 */ }

let uaApplied = false;
function nexusSession() {
  const s = session.fromPartition(PARTITION);
  if (!uaApplied) {
    uaApplied = true;
    try {
      const ua = cleanUA();
      if (ua) s.setUserAgent(ua);
      console.log('[Nexus登录] User-Agent 已调整为：' + (ua || '(默认)'));
    } catch { /* 忽略 */ }
  }
  return s;
}

/* ---------------- 登录状态缓存 ---------------- */

function readAuthCache() {
  return readJson(AUTH_CACHE, { loggedIn: false, user: null, avatar: null, at: null });
}
function writeAuthCache(patch) {
  const next = { ...readAuthCache(), ...patch, at: new Date().toISOString() };
  try { writeJson(AUTH_CACHE, next); } catch { /* 忽略 */ }
  return next;
}

/* ---------------- 通用：隐藏窗口读页面 ---------------- */

/**
 * 打开一个隐藏窗口加载 url，反复执行 script 直到拿到「确定的结果」。
 *
 * script 返回 `{ __retry: true }` 表示「页面还没准备好」（挑战页 / about:blank / 内容未渲染），
 * 会等待 delayMs 后重试，最多 maxRetry 次。
 *
 * 返回 `{ ok:true, data }` 或 `{ ok:false, reason }`。
 */
function openHiddenAndRead(url, script, opts = {}) {
  const { delayMs = 2500, timeoutMs = 30000, maxRetry = 6 } = opts;
  return new Promise((resolve) => {
    let done = false;
    let tries = 0;

    const w = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    let settle = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(settle);
      try { if (!w.isDestroyed()) w.destroy(); } catch { /* 忽略 */ }
      resolve(r);
    };

    const timer = setTimeout(
      () => finish({ ok: false, reason: '超时（网络太慢，或被 Cloudflare 拦住）' }),
      timeoutMs
    );

    const schedule = () => {
      clearTimeout(settle);
      settle = setTimeout(async () => {
        if (done) return;
        try {
          const res = await w.webContents.executeJavaScript(script);
          if (res && res.__retry) {
            tries++;
            if (tries > maxRetry) {
              return finish({
                ok: false,
                reason: '页面长时间未就绪（可能被 Cloudflare 拦住，请在登录窗口完成人机验证后重试）'
              });
            }
            // 偶发的 Cloudflare 挑战：重新加载往往能拿到真实页面
            if (tries % 3 === 0) {
              try { w.webContents.reload(); } catch { /* 忽略 */ }
            }
            return schedule();
          }
          finish({ ok: true, data: res });
        } catch (e) {
          finish({ ok: false, reason: e.message });
        }
      }, delayMs);
    };

    w.webContents.on('did-stop-loading', schedule);
    w.webContents.on('did-navigate', schedule);
    w.webContents.on('did-navigate-in-page', schedule);
    w.webContents.on('did-fail-load', (_e, code, desc, failUrl, isMainFrame) => {
      if (code === -3) return;           // ERR_ABORTED：重定向/内部导航打断，不是真失败
      if (isMainFrame === false) return; // 子资源失败，忽略
      finish({ ok: false, reason: desc || ('load ' + code), url: failUrl });
    });

    w.loadURL(url).catch(e => finish({ ok: false, reason: e.message }));
  });
}

/* ---------------- 状态查询 ---------------- */

async function readCookies() {
  try {
    const all = await nexusSession().cookies.get({});
    return all.filter(c => String(c.domain || '').includes('nexusmods'));
  } catch {
    return [];
  }
}

/** 返回缓存的登录结论（不发起网络请求，快） */
async function getStatus() {
  const cookies = await readCookies();
  const c = readAuthCache();
  return {
    partition: PARTITION,
    loggedIn: !!c.loggedIn,
    user: c.user || null,
    // 头像 URL（顶栏「账号 + 头像」用）。可能为 null —— 某条判定路径拿不到，
    // 渲染层要能退化成首字母方块。
    avatar: c.avatar || null,
    verifiedAt: c.at || null,
    cookieCount: cookies.length,
    cookieNames: cookies.map(x => x.name)
  };
}

/**
 * 判定脚本（在 Nexus 页面里执行）。
 *
 * ⚠️ 为什么不匹配整页文本：
 *   Nexus 的页面模板**始终**渲染用户菜单（含 "Sign out" / "Account settings"），
 *   即使当前是 "Access Denied" 页面也一样。用整页文本判断必然误报。
 *   正确做法是只看主体区域 #mainContent：
 *     · 未登录 → 主体只有 "Access Denied / Full authentication is required..."
 *     · 已登录 → 主体是账号设置内容
 */
const SCRIPT_VERIFY = `(() => {
  try {
    const url = location.href;
    if (!/^https?:/i.test(url)) return { __retry: true };
    const title = document.title || '';
    const bodyText = (document.body && document.body.innerText) || '';
    if (/${CHALLENGE_RE}/i.test(title + ' ' + bodyText.slice(0, 1500))) return { __retry: true };

    const authPage = /sign_in|auth\\//i.test(url);
    const main = document.querySelector('#mainContent') || document.querySelector('.main-content') || document.querySelector('main');
    const mainText = main ? String(main.innerText || '').trim() : '';
    const denied = /Access Denied|Full authentication is required/i.test(mainText);

    // 主体还没渲染出来 → 再等等
    if (!mainText && bodyText.length < 600) return { __retry: true };

    const m = bodyText.match(/Signed in as\\s*([^\\n]{1,40})/i);
    const avEl = document.querySelector('img[class*="avatar"], a[href*="/users/"] img, img[src*="/avatars/"]');
    return {
      url: url,
      title: title,
      loggedIn: !authPage && !denied,
      denied: denied,
      authPage: authPage,
      mainLen: mainText.length,
      mainHead: mainText.slice(0, 160),
      user: m ? m[1].trim() : null,
      avatar: avEl ? (avEl.currentSrc || avEl.src || null) : null
    };
  } catch (e) {
    return { scriptError: String((e && e.stack) || e) };
  }
})()`;

/**
 * 通用判定脚本：可在**任意** nexusmods.com 页面执行（首页 / 账号页 / 其它页）。
 *
 * 用在哪：用户在内置登录窗口里登录成功后，直接在**那个窗口**上判定，
 * 而不是另开隐藏窗口去访问账号页——账号页经常撞 Cloudflare 挑战，
 * 另开窗口会让判定失败，表现为「明明登录了，管理器却显示未登录」。
 *
 * 信号优先级：
 *   1. `Welcome back, <用户名>` —— 首页最强信号，能顺带拿到用户名
 *   2. 头像 + 指向 /users/<name> 的链接
 *   3. 主体 #mainContent 含 "Access Denied" → 明确未登录
 *   4. URL 在登录页 → 明确未登录
 */
const SCRIPT_VERIFY_ANY = `(() => {
  try {
    const url = location.href;
    if (!/^https?:/i.test(url)) return { __retry: true };
    const title = document.title || '';
    const bodyText = (document.body && document.body.innerText) || '';
    if (/${CHALLENGE_RE}/i.test(title + ' ' + bodyText.slice(0, 1500))) return { __retry: true };

    // 头像 + 用户名 —— 顶栏要显示「头像 + 账号名」，两个都抓
    const avatarEl = document.querySelector('img[class*="avatar"], a[href*="/users/"] img, img[src*="/avatars/"]');
    const userLink = document.querySelector('a[href^="/users/"]:not([href*="myaccount"]):not([href*="sign_in"])');
    const avatarUrl = avatarEl ? (avatarEl.currentSrc || avatarEl.src || null) : null;
    let linkUser = null;
    if (userLink) {
      const t = String(userLink.textContent || '').trim();
      if (t && t.length <= 40) linkUser = t;
      else {
        // 链接里没文字（纯头像链接）→ 从 href 的 /users/<name> 里取
        const mm = String(userLink.getAttribute('href') || '').match(/\\/users\\/([^\\/?#]+)/);
        if (mm) { try { linkUser = decodeURIComponent(mm[1]); } catch (e) { linkUser = mm[1]; } }
      }
    }

    const wb = bodyText.match(/Welcome back,\\s*([^\\n]{1,40})/i);
    if (wb) return { loggedIn: true, user: wb[1].trim(), avatar: avatarUrl, url: url, via: 'welcome-back' };

    const main = document.querySelector('#mainContent') || document.querySelector('.main-content') || document.querySelector('main');
    const mainText = main ? String(main.innerText || '').trim() : '';
    if (/Access Denied|Full authentication is required/i.test(mainText)) {
      return { loggedIn: false, url: url, via: 'access-denied' };
    }
    if (/sign_in|auth\\//i.test(url)) return { loggedIn: false, url: url, via: 'auth-page' };

    if (avatarEl && userLink) {
      return { loggedIn: true, user: linkUser, avatar: avatarUrl, url: url, via: 'avatar' };
    }

    if (!mainText && bodyText.length < 600) return { __retry: true };
    return { loggedIn: false, url: url, via: 'unknown' };
  } catch (e) {
    return { scriptError: String((e && e.stack) || e) };
  }
})()`;

/** 在已有窗口上执行判定（不新开窗口） */
async function verifyInWindow(w) {
  if (!w || w.isDestroyed()) return null;
  try {
    return await w.webContents.executeJavaScript(SCRIPT_VERIFY_ANY);
  } catch (e) {
    return { scriptError: e.message };
  }
}

/**
 * 真正打开账号页确认登录状态（慢，约 5–30 秒）。
 * 结果写入缓存，之后 getStatus 直接读缓存。
 *
 * 账号页读不到时（多半是 Cloudflare 挑战）退一步看首页——
 * 首页的 "Welcome back, X" 同样是可靠的登录信号。
 */
async function verifyByPage(timeoutMs = 40000) {
  // ① 登录窗口还开着 → 直接在里面判定（最快、最可靠，且不触发新挑战）
  const inWin = await verifyInWindow(loginWin);
  if (inWin && inWin.loggedIn) {
    const patch = { loggedIn: true, user: inWin.user || null };
    // ⚠️ 头像**只在抓到时才覆盖** —— 某条判定路径拿不到头像（比如只有 `Welcome back`），
    //    无条件写 null 会把上一次缓存的好头像冲掉，顶栏就退化成首字母了。
    if (inWin.avatar) patch.avatar = inWin.avatar;
    writeAuthCache(patch);
    return { ok: true, url: inWin.url, user: inWin.user || null, avatar: inWin.avatar || null, via: inWin.via };
  }

  // ② 打开账号页（最权威）
  let r = await openHiddenAndRead(URL_ACCOUNT, SCRIPT_VERIFY, { delayMs: 2500, timeoutMs, maxRetry: 6 });
  let d = r.ok ? (r.data || {}) : null;

  // ③ 账号页没读到（挑战/超时）→ 换首页再试
  if (!d || d.scriptError) {
    const r2 = await openHiddenAndRead(URL_HOME, SCRIPT_VERIFY_ANY, {
      delayMs: 3000,
      timeoutMs: Math.round(timeoutMs * 0.75),
      maxRetry: 6
    });
    if (r2.ok && r2.data && !r2.data.scriptError) {
      d = r2.data;
      r = r2;
    }
  }

  if (!d) return { ok: false, reason: r.reason, url: r.url };
  if (d.scriptError) return { ok: false, reason: '页面脚本错误：' + d.scriptError };

  const loggedIn = !!d.loggedIn;
  // 只有在拿到明确结论时才写缓存，避免把已知状态冲掉
  if (d.via !== 'unknown') {
    const patch = { loggedIn: loggedIn, user: d.user || null };
    // 头像只在抓到时覆盖（同 inWin 分支的理由）
    if (d.avatar) patch.avatar = d.avatar;
    writeAuthCache(patch);
  }

  return {
    ok: loggedIn,
    url: d.url,
    user: d.user || null,
    avatar: d.avatar || null,
    mainLen: d.mainLen,
    via: d.via || null,
    reason: loggedIn ? null : (d.via === 'unknown' ? '账号页未显示登录信息' : '尚未登录')
  };
}

/* ---------------- 登录窗口 ---------------- */

function openLoginWindow(parent) {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.show();
    loginWin.focus();
    return loginWin;
  }

  loginWin = new BrowserWindow({
    width: 580,
    height: 800,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    title: 'Nexus 账号登录 — 剑星 Mod 管理器',
    autoHideMenuBar: true,
    backgroundColor: '#14161A',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  loginWin.loadURL(URL_SIGN_IN);

  let uaLogged = false;
  loginWin.webContents.on('did-finish-load', () => {
    console.log('[Nexus登录] 页面加载完成：' + loginWin.webContents.getURL());
    if (!uaLogged) {
      uaLogged = true;
      loginWin.webContents.executeJavaScript('navigator.userAgent')
        .then(ua => console.log('[Nexus登录] 窗口实际 UA：' + ua))
        .catch(() => {});
    }
  });
  loginWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // -3 是重定向/内部导航打断（about:srcdoc 等），不算错误
    if (code === -3) return;
    console.error('[Nexus登录] 加载失败 ' + code + ' ' + desc + ' → ' + url);
  });

  // 抓页面里的报错，尤其是 Cloudflare Turnstile 的失败信息
  loginWin.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && ev.message) ? ev.message : String(a[2] || '');
    const level = (ev && typeof ev === 'object' && ev.level) ? ev.level : a[1];
    if (/turnstile|challenge|cloudflare|error|denied|failed/i.test(msg)) {
      console.log('[Nexus登录][页面/' + level + '] ' + msg.slice(0, 300));
    }
  });

  // Turnstile 失败时会在页面上弹出提示，这里把可见的错误文本抓出来
  loginWin.webContents.on('did-navigate-in-page', () => {
    setTimeout(async () => {
      if (!loginWin || loginWin.isDestroyed()) return;
      try {
        const err = await loginWin.webContents.executeJavaScript(`(() => {
          const t = (document.body && document.body.innerText) || '';
          const m = t.match(/(错误|失败|Error|error)[^\\n]{0,120}/);
          return m ? m[0] : '';
        })()`);
        if (err) console.log('[Nexus登录][页面提示] ' + err.slice(0, 200));
      } catch { /* 忽略 */ }
    }, 2500);
  });

  console.log('[Nexus登录] 已打开登录窗口');

  /* ---- 登录检测 ----
   * 直接在登录窗口上轮询判定，**不另开隐藏窗口**。
   * 原因：账号页经常撞 Cloudflare 挑战，另开窗口会让判定失败，
   * 表现就是「用户明明登录了，管理器却一直显示未登录」。
   */
  let notified = false;
  let tries = 0;
  let pollTimer = null;

  const pollLogin = async () => {
    if (notified || !loginWin || loginWin.isDestroyed()) return;
    tries++;

    const r = await verifyInWindow(loginWin);

    if (r && r.loggedIn) {
      notified = true;
      clearTimeout(pollTimer);
      writeAuthCache({ loggedIn: true, user: r.user || null });
      console.log('[Nexus登录] 确认已登录' + (r.user ? '：' + r.user : '') + '（信号：' + r.via + '）');
      if (typeof onAuthChanged === 'function') onAuthChanged({ loggedIn: true, user: r.user || null });
      return;
    }

    // 还没登录 / 页面未就绪 → 继续轮询（最多约 40 秒）
    if (tries < 20) {
      pollTimer = setTimeout(pollLogin, 2000);
    } else {
      console.log('[Nexus登录] 轮询结束，仍未确认登录（最后一次信号：' + ((r && r.via) || 'n/a') + '）');
    }
  };

  const scheduleVerify = () => {
    if (notified) return;
    const url = loginWin && !loginWin.isDestroyed() ? loginWin.webContents.getURL() : '';
    if (!url || /sign_in|auth\/|login|accounts\./i.test(url)) return;
    // 离开登录页 → 开始轮询判定
    clearTimeout(pollTimer);
    tries = 0;
    pollTimer = setTimeout(pollLogin, 1500);
  };

  loginWin.webContents.on('did-navigate', scheduleVerify);
  loginWin.webContents.on('did-navigate-in-page', scheduleVerify);
  loginWin.webContents.on('did-stop-loading', scheduleVerify);

  loginWin.on('closed', () => {
    clearTimeout(pollTimer);
    loginWin = null;
  });
  return loginWin;
}

function closeLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) loginWin.close();
  loginWin = null;
}

/* ---------------- API Key ---------------- */

const SCRIPT_APIKEY = `(() => {
  try {
    const url = location.href;
    if (!/^https?:/i.test(url)) return { __retry: true };
    const title = document.title || '';
    const bodyText = (document.body && document.body.innerText) || '';
    if (/${CHALLENGE_RE}/i.test(title + ' ' + bodyText.slice(0, 1500))) return { __retry: true };

    const main = document.querySelector('#mainContent') || document.querySelector('.main-content') || document.querySelector('main');
    const mainText = main ? String(main.innerText || '').trim() : '';

    if (/Access Denied|Full authentication is required/i.test(mainText) || /sign_in|auth\\//i.test(url)) {
      return { loggedOut: true, url: url };
    }
    if (!mainText && bodyText.length < 600) return { __retry: true };

    const KEY = /^[A-Za-z0-9+/=_-]{30,80}$/;
    const found = [];
    (main || document).querySelectorAll('input, textarea, code, pre, p, span, div, b, strong').forEach(el => {
      const raw = (el.value != null && el.value !== '' ? el.value : el.textContent) || '';
      const t = String(raw).trim();
      if (!KEY.test(t)) return;
      let ctx = '';
      let p = el;
      for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (p) ctx += ' ' + (p.textContent || '').slice(0, 200); }
      found.push({ key: t, near: /api\\s*key|personal api/i.test(ctx), len: t.length });
    });
    const seen = new Set();
    const uniq = found.filter(f => !seen.has(f.key) && seen.add(f.key));
    uniq.sort((a, b) => (b.near - a.near) || (b.len - a.len));

    const hasApiSection = /api\\s*key|personal api/i.test(mainText);
    // 页面还在渲染，既没 Key 也没 API 区块 → 再等等
    if (!hasApiSection && uniq.length === 0) return { __retry: true };

    return { url: url, hasApiSection: hasApiSection, candidates: uniq.slice(0, 5) };
  } catch (e) {
    return { scriptError: String((e && e.stack) || e) };
  }
})()`;

/**
 * 尝试从「账号设置 → API」页面自动读取个人 API Key。
 * 读不到不算错——页面上也可能需要用户手动复制。
 */
async function fetchApiKey(timeoutMs = 35000) {
  const r = await openHiddenAndRead(URL_API, SCRIPT_APIKEY, { delayMs: 3000, timeoutMs, maxRetry: 6 });
  if (!r.ok) return { ok: false, reason: r.reason };

  const d = r.data || {};
  if (d.scriptError) return { ok: false, reason: '页面脚本错误：' + d.scriptError };
  if (d.loggedOut) return { ok: false, reason: '尚未登录，请先登录 Nexus', url: d.url };

  const strong = (d.candidates || []).filter(c => c.near);
  if (strong.length >= 1) return { ok: true, key: strong[0].key, url: d.url };
  if ((d.candidates || []).length === 1) return { ok: true, key: d.candidates[0].key, url: d.url };

  // 页面结构正常但没有 Key —— 多半是还没点「Request Api Key」生成
  return {
    ok: false,
    reason: d.hasApiSection
      ? '页面上还没有 API Key。请在该页面底部「Personal API Key」处点「Request Api Key」生成，然后再点本按钮'
      : '账号页结构可能已变化，请手动复制',
    url: d.url
  };
}

/* ---------------- 退出 ---------------- */

async function logout() {
  closeLoginWindow();
  try {
    await nexusSession().clearStorageData();
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  writeAuthCache({ loggedIn: false, user: null, avatar: null });
  return { ok: true };
}

/* ---------------- 后台静默复核 ---------------- */

let rechecking = false;

/**
 * 缓存太旧时在后台静默复核一次登录状态。
 * 结果有变化才推送事件，避免打扰用户。
 * 由 app:bootstrap 触发，不阻塞界面。
 */
async function recheckIfStale(maxAgeMs = 30 * 60 * 1000) {
  if (rechecking) return null;
  const before = readAuthCache();
  const age = before.at ? (Date.now() - new Date(before.at).getTime()) : Infinity;
  if (age < maxAgeMs) return null;

  rechecking = true;
  try {
    const r = await verifyByPage(30000);
    if (r && (!!r.ok !== !!before.loggedIn || (r.user || null) !== (before.user || null))) {
      console.log('[Nexus登录] 后台复核发现状态变化：' + (before.loggedIn ? '已登录' : '未登录') +
        ' → ' + (r.ok ? '已登录' : '未登录'));
      if (typeof onAuthChanged === 'function') onAuthChanged({ loggedIn: !!r.ok, user: r.user || null });
    }
    return r;
  } catch {
    return null;
  } finally {
    rechecking = false;
  }
}

function setAuthListener(fn) { onAuthChanged = fn; }

module.exports = {
  PARTITION,
  URL_SIGN_IN, URL_ACCOUNT, URL_API, URL_HOME,
  cleanUA,
  // Cloudflare 人机验证页的识别正则（字符串形式）。
  // 安装助手窗口也要用它 —— 卡在验证页时不能只显示「正在等待页面加载」，
  // 那会让用户以为程序坏了。单一来源，避免两边各写一份慢慢跑偏。
  CHALLENGE_RE,
  getStatus, verifyByPage, verifyInWindow, openLoginWindow, closeLoginWindow,
  fetchApiKey, logout, recheckIfStale, setAuthListener, nexusSession
};
