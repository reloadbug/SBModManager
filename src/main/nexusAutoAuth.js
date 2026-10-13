'use strict';

const { parseNxm } = require('./nxm');

/**
 * ⚠️ 不在顶层 require electron / nexusAuth —— 两者的顶层都会拉 electron，
 *    那样本模块在普通 Node 里就 require 不动，纯函数（`parsePopup` / `popupUrl`）
 *    也就没法离线断言。只有真正发请求时才用时再取。
 */
function auth() { return require('./nexusAuth'); }

/**
 * 「免点击授权」—— 用**已登录会话**直接向 Nexus 站内下载弹层端点要 nxm 链接。
 *
 * ## 为什么需要它
 *
 * 免费账号**没有**会话级下载授权：每次下载都要网站在「用户点一下」的瞬间现签一个
 * 带 `key` + `expires` 的一次性链接（Premium 的长期 API Key 才有那种待遇）。
 * 老流程因此要求用户对**每一个** mod 都去点一次「Mod Manager Download」——
 * 40 个包就是 40 次点击 + 40 个窗口，用户直接问「已经登录了为什么还要逐条授权」。
 *
 * ## 这条路为什么成立（2026-10-13 实测）
 *
 * 网站上那个按钮点下去，前端 JS 调的就是本站端点：
 *
 *     GET /Core/Libs/Common/Widgets/DownloadPopUp?id=<fileId>&game_id=<gameId>&nmm=1
 *
 * 响应是一段弹层 HTML，里面直接埋着签好的链接：
 *
 *     <input type="hidden" id="dl_link" value="nxm://stellarblade/mods/1461/files/8509?key=…&expires=…&user_id=…">
 *
 * 也就是说：**带会话 cookie 请求它 ≡ 用户点了那一下**，只是不经过渲染和鼠标。
 * 实测请求矩阵 3/3、3/3、3/3 全部命中，每次返回的 key 都不同（一次性）。
 *
 * ## 边界（刻意保留）
 *
 * - **不绕 Cloudflare**：命中挑战页就返回 `challenge`，由上层退回到「打开窗口让用户点」
 * - **不伪造 key**：key 始终由 Nexus 为本账号签发
 * - **不并发轰炸**：批量调用由上层串行 + 节流（见 ipc.js 的 autoAuthorizeAll）
 * - **永不抛**：拿不到就返回 `{ok:false, code, reason}`，调用方据此决定降级
 */

const SITE = 'https://www.nexusmods.com';
const POPUP_PATH = '/Core/Libs/Common/Widgets/DownloadPopUp';

/** Nexus 的数字 gameId。目前只服务剑星；换游戏时在这里补 */
const GAME_IDS = { stellarblade: 7804 };

const DEFAULT_TIMEOUT_MS = 20000;
/** 挑战页 / 网络抖动的重试间隔（毫秒）。刻意很短 —— 它是「重试」不是「硬撞」 */
const RETRY_DELAYS = [1200, 3000];

/** Cloudflare 挑战页的特征（与 nexusAuth.CHALLENGE_RE 同源，这里只做兜底） */
const CHALLENGE_RE = /just a moment|checking your browser|cf-browser-verification|正在进行安全验证|请稍候|安全服务防护恶意自动程序|Ray ID/i;
/** 弹层里未登录时的原话 */
const NEED_LOGIN_RE = /please\s+log\s*in\s+or\s*sign\s*up/i;

/* ---------------- 纯函数（可离线断言） ---------------- */

function gameIdOf(game) {
  const g = String(game || 'stellarblade').toLowerCase();
  return GAME_IDS[g] || null;
}

function popupUrl({ game = 'stellarblade', fileId, gameId = null }) {
  const gid = gameId || gameIdOf(game);
  if (!gid) throw new Error('不认识的游戏域：' + game);
  const fid = Number(fileId);
  if (!Number.isFinite(fid) || fid <= 0) throw new Error('缺少有效的 fileId');
  return SITE + POPUP_PATH + '?id=' + fid + '&game_id=' + gid + '&nmm=1';
}

/**
 * 解析弹层 HTML。
 *
 * 主路是 `<input id="dl_link" value="nxm://…">`（实测就是这个）；
 * 兜底再全文搜一次 `nxm://` —— 万一 Nexus 改版把 id 换掉，只要链接还在页里就还能救。
 *
 * @returns {{ok:boolean, info?:object, nxm?:string, fileName?:string, code?:string, reason?:string}}
 */
function parsePopup(html) {
  const t = String(html == null ? '' : html);

  if (CHALLENGE_RE.test(t.slice(0, 4000))) {
    return { ok: false, code: 'challenge', reason: '被 Cloudflare 人机验证拦住了' };
  }
  if (NEED_LOGIN_RE.test(t)) {
    return { ok: false, code: 'not_logged_in', reason: 'Nexus 会话未登录或已失效' };
  }

  let nxm = '';
  const m = /<input[^>]*\bid\s*=\s*["']dl_link["'][^>]*\bvalue\s*=\s*["']([^"']+)["']/i.exec(t) ||
    /<input[^>]*\bvalue\s*=\s*["']([^"']*nxm:\/\/[^"']*)["'][^>]*\bid\s*=\s*["']dl_link["']/i.exec(t);
  if (m) nxm = m[1];
  if (!nxm) {
    const g = /nxm:\/\/[^"'\s<>\\]+/i.exec(t);
    if (g) nxm = g[0];
  }

  if (!nxm) {
    return {
      ok: false,
      code: 'no_nxm',
      reason: '这个文件没有给出「Mod Manager Download」链接（作者可能只开了手动下载）'
    };
  }

  const decoded = nxm.replace(/&amp;/g, '&');
  const info = parseNxm(decoded);
  if (!info || !info.key || !info.expires) {
    return { ok: false, code: 'bad_link', reason: '链接里没有可用的授权信息（key / expires）' };
  }

  // 弹层里那个 <h2> 就是文件名，顺手带回去给界面用
  let fileName = '';
  const h = /<div[^>]*class\s*=\s*["'][^"']*download-top-left-panel[^"']*["'][^>]*>[\s\S]{0,400}?<h2[^>]*>([\s\S]{0,200}?)<\/h2>/i.exec(t);
  if (h) fileName = h[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  return { ok: true, info, nxm: decoded, fileName };
}

/* ---------------- 网络 ---------------- */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOnce(url, timeoutMs) {
  const ses = auth().nexusSession();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await ses.fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': auth().cleanUA(),
        // 站内 JS 就是这么调的：不带这个头，端点会把整页站点返回回来（实测 216KB）
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, */*; q=0.01',
        Referer: SITE + '/'
      }
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取一个文件的 nxm 授权链接。
 *
 * @param {{game?:string, modId?:number, fileId:number, timeoutMs?:number, retries?:number}} o
 * @returns {Promise<{ok:boolean, info?:object, nxm?:string, fileName?:string, code?:string, reason?:string}>}
 *          永不抛。
 */
async function fetchNxm(o = {}) {
  const { game = 'stellarblade', modId = null, fileId, timeoutMs = DEFAULT_TIMEOUT_MS } = o;
  const retries = Number.isFinite(o.retries) ? o.retries : RETRY_DELAYS.length;

  let url;
  try { url = popupUrl({ game, fileId }); }
  catch (e) { return { ok: false, code: 'bad_args', reason: e.message }; }

  let last = { ok: false, code: 'network', reason: '未知错误' };
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchOnce(url, timeoutMs);

      if (r.status === 403 && CHALLENGE_RE.test(r.text.slice(0, 4000))) {
        last = { ok: false, code: 'challenge', reason: '被 Cloudflare 人机验证拦住了' };
      } else if (r.status >= 400) {
        last = { ok: false, code: 'http', reason: 'Nexus 返回 HTTP ' + r.status };
      } else {
        const p = parsePopup(r.text);
        if (p.ok) {
          // modId 以**调用方给的**为准：端点返回的链接里也有，但调用方可能拿到的是重定向后的
          if (modId) p.info.modId = Number(modId);
          return p;
        }
        last = p;
        // 未登录 / 作者没给 MM 链接 —— 这两种重试也没用，直接返回
        if (p.code === 'not_logged_in' || p.code === 'no_nxm' || p.code === 'bad_link') return p;
      }
    } catch (e) {
      const msg = (e && e.name === 'AbortError') ? '请求超时' : ((e && e.message) || String(e));
      last = { ok: false, code: 'network', reason: msg };
    }

    if (i < retries) await sleep(RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)]);
  }

  return last;
}

/** 把失败码翻译成给用户看的一句话 */
function humanize(code, reason) {
  switch (code) {
    case 'not_logged_in':
      return 'Nexus 未登录（或登录已失效）。到「Nexus 账号」里登录一次即可。';
    case 'challenge':
      return '被 Cloudflare 人机验证拦住了，请稍后再试；也可以对该 mod 点「手动授权」在窗口里点一下。';
    case 'no_nxm':
      return '这个文件没有「Mod Manager Download」链接（作者只开了手动下载），请点「手动授权」。';
    case 'http':
    case 'network':
      return '连不上 Nexus（' + reason + '），稍后再试或点「手动授权」。';
    case 'bad_args':
      return '这条任务缺少 Mod ID / 文件 ID，无法自动授权。';
    default:
      return reason || '自动授权失败';
  }
}

module.exports = {
  popupUrl,
  parsePopup,
  fetchNxm,
  humanize,
  gameIdOf,
  GAME_IDS,
  POPUP_PATH,
  RETRY_DELAYS,
  DEFAULT_TIMEOUT_MS,
  CHALLENGE_RE,
  NEED_LOGIN_RE
};
