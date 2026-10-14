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
const NEED_LOGIN_RE = /please\s+log\s*in\s*or\s*sign\s*up/i;

/**
 * 「文件刚上传、还没同步到文件服务器」的原话（多写法兜底）。
 *
 * 作者传完新文件后，Nexus 要过一会儿才把文件推到各文件服务器、并开始签发 nxm 链接
 * （站方原话：*The file is currently being uploaded to our file servers and it will be
 * ready to be downloaded soon.*）。这段时间里弹层里**没有** `dl_link`，老逻辑一律报
 * `no_nxm`，还会把它解释成「作者只开了手动下载」——把锅甩给作者，用户照着提示点
 * 「手动授权」也照样拿不到链接。
 *
 * ⚠️ 这里只是**措辞**兜底；主判据在 ipc.js 里用文件的上传时间（GraphQL 的 `date`），
 *    不依赖 Nexus 的页面文案，两边互为补充。
 */
const NOT_READY_RE = /currently\s+being\s+uploaded\s+to\s+our\s+file\s+servers|will\s+be\s+ready\s+to\s+be\s+downloaded\s+soon|not\s+yet\s+available\s+for\s+download|file\s+(?:is\s+)?not\s+ready/i;

/** 失败时留给排查用的响应片段长度（只进日志，见 ipc.js） */
const SNIPPET_MAX = 400;

/**
 * 文件上传后这段时间内，Nexus **不给**「管理器下载」链接是正常的。
 *
 * 实测（2026-10-14）：作者 13:41:28 传完文件，13:44:00 去要链接就只拿到 `no_nxm`
 * （文件才 2.5 分钟大），而同作者 3.7 小时前上传的另一个文件一次就拿到了。
 * 站方对外的说法是文件要先同步到各文件服务器、扫完毒才会出现「Mod Manager Download」。
 */
const FILE_SETTLE_MS = 3 * 60 * 1000;
/** 为了等文件「满上」最多阻塞多久 —— 别让「授权中…」的按钮一直转 */
const FILE_SETTLE_WAIT_MAX_MS = 60 * 1000;

/**
 * 这个失败该不该按「文件刚上传、还没同步好」处理？要等多久再问一次？
 *
 * 纯函数，**不碰网络**，放在这里是为了能离线断言（ipc.js 顶层拉 electron，require 不动）。
 *
 * 判定规则：
 *   · 代码是 `file_not_ready`（页面上写着「还没就绪」）→ 一定是
 *   · 代码是 `no_nxm` 且**文件上传至今 < FILE_SETTLE_MS** → 按未就绪处理
 *   · 其余（含 `no_nxm` 但文件已经很旧）→ 不按未就绪，交给 humanize 说「作者关了管理器下载」
 *
 * ⚠️ `ageMs` 为 null（查不到上传时间）时**不能**当成「刚上传」——
 *    那会把「作者确实关了」的情况也说成「稍后再试」，用户白等。
 *
 * @param {{code?:string, ageMs?:number|null}} o
 * @returns {{notReady:boolean, wait:number}} wait 为 0 表示不必等
 */
function settleDecision(o) {
  const code = o && o.code;
  const age = (o && Number.isFinite(o.ageMs)) ? o.ageMs : null;
  const fresh = age != null && age >= 0 && age < FILE_SETTLE_MS;
  const notReady = code === 'file_not_ready' || (code === 'no_nxm' && fresh);
  const wait = (notReady && fresh) ? Math.min(FILE_SETTLE_MS - age, FILE_SETTLE_WAIT_MAX_MS) : 0;
  return { notReady, wait };
}

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
 * 把响应压成一小段纯文本，只用于**排查日志**（不含 key —— 这里本就没有 nxm 链接）。
 */
function snippetOf(html) {
  return String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SNIPPET_MAX);
}

/**
 * 解析弹层 HTML。
 *
 * 主路是 `<input id="dl_link" value="nxm://…">`（实测就是这个）；
 * 兜底再全文搜一次 `nxm://` —— 万一 Nexus 改版把 id 换掉，只要链接还在页里就还能救。
 *
 * @returns {{ok:boolean, info?:object, nxm?:string, fileName?:string, code?:string, reason?:string, snippet?:string}}
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
    // 「刚上传、还没同步完」先判 —— 这两种情况在页面上长得几乎一样（都没有 dl_link），
    // 但给用户看的话和后续动作完全不同：一个是「等几分钟」，一个是「点手动授权」。
    if (NOT_READY_RE.test(t)) {
      return {
        ok: false,
        code: 'file_not_ready',
        reason: '文件刚上传，Nexus 还在同步到文件服务器',
        snippet: snippetOf(t)
      };
    }
    return {
      ok: false,
      code: 'no_nxm',
      reason: '这个文件没有给出「Mod Manager Download」链接（作者可能只开了手动下载）',
      snippet: snippetOf(t)
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
        // 未登录 / 作者没给 MM 链接 / 文件还没同步好 —— 这几种重试也没用，直接返回
        if (p.code === 'not_logged_in' || p.code === 'no_nxm' || p.code === 'bad_link'
          || p.code === 'file_not_ready') return p;
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
    case 'file_not_ready':
      return '这个文件刚上传，Nexus 还在把它同步到文件服务器，暂时给不出管理器下载链接。过几分钟再点「自动授权」即可。';
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
  snippetOf,
  fetchNxm,
  humanize,
  settleDecision,
  gameIdOf,
  GAME_IDS,
  POPUP_PATH,
  RETRY_DELAYS,
  DEFAULT_TIMEOUT_MS,
  CHALLENGE_RE,
  NEED_LOGIN_RE,
  NOT_READY_RE,
  SNIPPET_MAX,
  FILE_SETTLE_MS,
  FILE_SETTLE_WAIT_MAX_MS
};
