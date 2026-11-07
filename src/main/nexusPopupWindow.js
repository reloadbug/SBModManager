'use strict';

/**
 * 用**渲染进程**去取 Nexus 的下载弹层（DownloadPopUp）。
 *
 * 为什么要这个模块：
 *   自动授权原来是在主进程用 `session.fetch()` 直接请求弹层端点。2026-11 之后
 *   Cloudflare 开始对「不是浏览器发出来的」请求下挑战页：同样的 cookie、同一时刻，
 *   用户点「手动授权」在窗口里一导航就能过，而 net 栈的 fetch 一律 403 + challenge。
 *   差别只在请求指纹。
 *
 * 两条渲染进程路线（按保真度排序，先试 ①）：
 *   ① **页面内 XHR**：先开 mod 文件页（真实导航，挑战页自然会被浏览器过掉），再在
 *      那个页面的上下文里 fetch 同一个弹层端点 —— 这正是站内 JS 自己的调用方式
 *      （同源、带 cookie、带 sec-fetch-mode: cors、Referer 就是文件页）。
 *   ② **直接导航弹层**：把弹层 URL 当顶层导航打开再读 DOM。少一层页面，但
 *      sec-fetch-mode 是 navigate，Cloudflare 更容易起疑，只当兜底。
 *
 * 约定：
 *   · 只在主进程用（需要 electron）；require 失败时调用方自己兜住。
 *   · 窗口用 `persist:nexus` 分区 —— 和登录窗、安装助手共用同一套 cookie，登录态现成。
 *   · 永远销毁窗口（finally），不留后台进程。
 *   · 返回值形状与 `nexusAutoAuth.fetchNxm()` 一致（多一个 `via: 'page' | 'popup'`）。
 */

const { BrowserWindow } = require('electron');
const nexusAuth = require('./nexusAuth');

const DEFAULT_TIMEOUT_MS = 25000;
const CHALLENGE_WAIT_MS = 12000;   // 挑战页通常几秒后自己跳走，给它一点时间
const SETTLE_MS = 250;             // 导航结束后等 DOM 稳一下
const SITE = 'https://www.nexusmods.com';
const GAME_IDS = { stellarblade: 7804 };
const POPUP_PATH = '/Core/Libs/Common/Widgets/DownloadPopUp';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function popupUrlOf(fileId, gameId) {
  return SITE + POPUP_PATH + '?id=' + fileId + '&game_id=' + gameId + '&nmm=1';
}

function filesPageUrl(game, modId, fileId) {
  let u = SITE + '/' + game + '/mods/' + modId + '?tab=files';
  if (fileId) u += '&file_id=' + fileId;
  return u;
}

/** 页面是不是挑战页 / 有没有登录（用于诊断日志） */
function inspectPage(win) {
  return win.webContents.executeJavaScript(`(() => {
    const t = (document.body && document.body.innerText) || '';
    return JSON.stringify({
      title: document.title || '',
      url: location.href,
      challenge: new RegExp(${JSON.stringify(nexusAuth.CHALLENGE_RE)}, 'i').test(t),
      loggedIn: /sign out|my account|logout/i.test(t),
      len: t.length,
      head: t.replace(/\\s+/g, ' ').slice(0, 160)
    });
  })()`, true).then(s => { try { return JSON.parse(s); } catch (_e) { return null; } })
    .catch(() => null);
}

/** 等页面不再是挑战页（或超时） */
async function waitChallengeGone(win, maxMs) {
  const deadline = Date.now() + maxMs;
  let info = await inspectPage(win);
  while (info && info.challenge && Date.now() < deadline) {
    await sleep(800);
    info = await inspectPage(win);
  }
  return info;
}

/** 导航并等停稳 */
function navigate(win, url, timeoutMs, extraHeaders) {
  return new Promise(resolve => {
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { win.webContents.removeListener('did-stop-loading', onStop); } catch (_e) {}
      try { win.webContents.removeListener('did-fail-load', onFail); } catch (_e) {}
      resolve(payload);
    };
    const onStop = () => setTimeout(() => finish({ ok: true }), SETTLE_MS);
    const onFail = (_e, code, desc) => {
      // -3 = ERR_ABORTED，站内重定向/挑战页跳转会触发，当作「停稳了」继续读
      if (code === -3) { setTimeout(() => finish({ ok: true }), SETTLE_MS); return; }
      finish({ ok: false, reason: `${desc || 'load failed'} (${code})` });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: '页面加载超时' }), timeoutMs);
    win.webContents.once('did-stop-loading', onStop);
    win.webContents.once('did-fail-load', onFail);
    const opts = extraHeaders ? { extraHeaders: extraHeaders } : undefined;
    win.loadURL(url, opts).catch(() => { /* did-fail-load 兜住 */ });
  });
}

function makeWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: nexusAuth.PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  try { win.webContents.setUserAgent(nexusAuth.cleanUA()); } catch (_e) {}
  try { win.webContents.setAudioMuted(true); } catch (_e) {}
  return win;
}

/**
 * 路线①：在 mod 文件页的上下文里 XHR 弹层端点。
 * @returns {Promise<{ok:boolean, html?:string, code?:string, reason?:string, diag?:object}>}
 */
async function readViaPage({ game = 'stellarblade', modId, fileId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const gid = GAME_IDS[game] || 7804;
  const win = makeWindow();
  try {
    const nav = await navigate(win, filesPageUrl(game, modId, fileId), timeoutMs);
    if (!nav.ok) return { ok: false, code: 'network', reason: nav.reason };

    const info = await waitChallengeGone(win, CHALLENGE_WAIT_MS);
    if (info && info.challenge) {
      return { ok: false, code: 'challenge', reason: '连文件页都在人机验证', diag: info };
    }

    // 页面内同源 XHR —— 和站内按钮点的那个请求一模一样
    const raw = await win.webContents.executeJavaScript(`(async () => {
      try {
        const r = await fetch(${JSON.stringify(popupUrlOf(fileId, gid))}, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*; q=0.01' }
        });
        const t = await r.text();
        return JSON.stringify({ status: r.status, text: t.slice(0, 400000) });
      } catch (e) {
        return JSON.stringify({ status: 0, text: '', error: String((e && e.message) || e) });
      }
    })()`, true);

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_e) { parsed = null; }
    if (!parsed || !parsed.text) {
      return { ok: false, code: 'network', reason: (parsed && parsed.error) || '页面内请求没有返回内容', diag: info };
    }
    if (parsed.status === 403 || parsed.status === 503) {
      return { ok: false, code: 'challenge', reason: '页面内请求被拦（HTTP ' + parsed.status + '）', html: parsed.text, diag: info };
    }
    if (parsed.status >= 400) {
      return { ok: false, code: 'http', reason: '弹层返回 HTTP ' + parsed.status, html: parsed.text, diag: info };
    }
    return { ok: true, html: parsed.text, diag: info };
  } catch (e) {
    return { ok: false, code: 'network', reason: (e && e.message) || String(e) };
  } finally {
    try { win.destroy(); } catch (_e) {}
  }
}

/**
 * 路线②：直接导航弹层端点再读 DOM（兜底）。
 */
async function readViaPopup({ game = 'stellarblade', fileId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const gid = GAME_IDS[game] || 7804;
  const win = makeWindow();
  try {
    const headers = [
      'X-Requested-With: XMLHttpRequest',
      'Accept: text/html, */*; q=0.01',
      'Referer: ' + SITE + '/',
      ''
    ].join('\r\n');
    const nav = await navigate(win, popupUrlOf(fileId, gid), timeoutMs, headers);
    if (!nav.ok) return { ok: false, code: 'network', reason: nav.reason };
    const html = await win.webContents.executeJavaScript(
      'document.documentElement ? document.documentElement.outerHTML : ""', true
    ).catch(() => '');
    if (!html) return { ok: false, code: 'network', reason: '弹层页面是空的' };
    return { ok: true, html };
  } catch (e) {
    return { ok: false, code: 'network', reason: (e && e.message) || String(e) };
  } finally {
    try { win.destroy(); } catch (_e) {}
  }
}

/**
 * 取 nxm 链接（渲染进程路线）。
 *
 * @param {{game?:string, modId:number, fileId:number, timeoutMs?:number}} o
 * @returns {Promise<object>} 与 `nexusAutoAuth.fetchNxm()` 同形，另加 `via`；永不抛。
 */
async function fetchNxm(o = {}) {
  const auto = require('./nexusAutoAuth');   // 解析器只有一份
  const { game = 'stellarblade', modId, fileId, timeoutMs = DEFAULT_TIMEOUT_MS } = o;

  if (!modId) return { ok: false, code: 'bad_args', reason: '缺少 modId，无法打开文件页', via: 'page' };

  const steps = [
    { via: 'page', run: () => readViaPage({ game, modId, fileId, timeoutMs }) },
    { via: 'popup', run: () => readViaPopup({ game, fileId, timeoutMs }) }
  ];

  let last = null;
  for (const step of steps) {
    const r = await step.run();
    if (r && r.ok) {
      const p = auto.parsePopup(r.html);
      if (p.ok) { p.info.modId = Number(modId); p.via = step.via; return p; }
      last = { ...p, via: step.via, diag: r.diag || null };
      if (p.code === 'no_nxm' || p.code === 'bad_link' || p.code === 'file_not_ready') return last;
    } else {
      last = {
        ok: false,
        code: (r && r.code) || 'network',
        reason: (r && r.reason) || '取弹层失败',
        via: step.via,
        diag: (r && r.diag) || null
      };
    }
  }
  return last || { ok: false, code: 'network', reason: '取弹层失败', via: 'page' };
}

module.exports = {
  fetchNxm,
  readViaPage,
  readViaPopup,
  popupUrlOf,
  filesPageUrl,
  DEFAULT_TIMEOUT_MS,
  CHALLENGE_WAIT_MS,
  GAME_IDS
};
