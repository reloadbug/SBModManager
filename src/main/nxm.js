'use strict';
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const paths = require('./paths');

/**
 * ⚠️ **不要**在顶层 `require('electron')` 或 `require('./nexusAuth')`（后者顶层就拉 electron）。
 *
 * `parseNxm` 是纯字符串函数，离线测试（`node _probe/xxx-test.js`）要能直接 require 本模块。
 * 顶层拉 electron 会让它在普通 Node 里直接炸掉（`Cannot find module 'electron'`）。
 * 只有真正要发请求 / 注册协议的地方才用时再取。
 */
function electronApp() { return require('electron').app; }
function auth() { return require('./nexusAuth'); }

/**
 * nxm:// 协议处理。
 *
 * 工作方式（实测确认）：
 *   用户在 Nexus 网站点「Mod Manager Download」→ 浏览器把 nxm:// 链接交给本程序
 *     nxm://stellarblade/mods/1496/files/13020?key=XXX&expires=YYY&user_id=ZZZ
 *   本程序拿 key/expires 去调官方 API 换取真实下载直链：
 *     GET /v1/games/{game}/mods/{modId}/files/{fileId}/download_link.json?key=&expires=
 *
 * 实测结论（2026-10-10，免费账号 + 已登录会话）：
 *   · 不带 key/expires 直接调该端点 → 403「this is for premium users only」
 *   · 带（错误的）key/expires     → 400「Provided key and expire time isn't correct for this user/file」
 *   说明端点确实接受 key/expires —— 这是免费账号**唯一合法**的自动下载通路。
 *
 * ⚠️ 不做任何验证码绕过、不伪造 key。key 由 Nexus 在用户点击时签发，一次性、有时效。
 */

const PROTOCOL = 'nxm';
const API_BASE = 'https://api.nexusmods.com/v1';

/* ---------------- 解析 ---------------- */

/**
 * 解析 nxm:// 链接。
 * 形态：nxm://<game>/mods/<modId>/files/<fileId>?key=&expires=&user_id=
 * 也容忍没有查询参数（Premium 账号的链接可能不带）。
 */
function parseNxm(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  const m = /^nxm:\/\/([^/?#]+)\/mods\/(\d+)\/files\/(\d+)(?:\?([^#\s]*))?/i.exec(s);
  if (!m) return null;

  const q = new URLSearchParams(m[4] || '');
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    raw: s,
    game: decodeURIComponent(m[1]),
    modId: Number(m[2]),
    fileId: Number(m[3]),
    key: q.get('key') || null,
    expires: num(q.get('expires')),
    userId: q.get('user_id') || null
  };
}

/** 从命令行参数里找出 nxm URL（冷启动与 second-instance 都用它） */
function extractNxmFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const a of argv) {
    if (typeof a === 'string' && /^nxm:\/\//i.test(a.trim())) return parseNxm(a);
  }
  return null;
}

/* ---------------- 协议注册 ---------------- */

/** 开发模式下需要显式传 exe + app 路径，打包后直接注册即可 */
function protocolArgs() {
  if (process.defaultApp && process.argv.length >= 2) {
    return { exe: process.execPath, args: [path.resolve(process.argv[1])] };
  }
  return { exe: null, args: [] };
}

function registerProtocol() {
  try {
    const { exe, args } = protocolArgs();
    return exe
      ? electronApp().setAsDefaultProtocolClient(PROTOCOL, exe, args)
      : electronApp().setAsDefaultProtocolClient(PROTOCOL);
  } catch (e) {
    console.error('[nxm] 注册协议失败：' + e.message);
    return false;
  }
}

function unregisterProtocol() {
  try {
    const { exe, args } = protocolArgs();
    return exe
      ? electronApp().removeAsDefaultProtocolClient(PROTOCOL, exe, args)
      : electronApp().removeAsDefaultProtocolClient(PROTOCOL);
  } catch {
    return false;
  }
}

function isProtocolRegistered() {
  try {
    const { exe, args } = protocolArgs();
    return exe
      ? electronApp().isDefaultProtocolClient(PROTOCOL, exe, args)
      : electronApp().isDefaultProtocolClient(PROTOCOL);
  } catch {
    return false;
  }
}

/* ---------------- 下载链接解析 ---------------- */

/**
 * 用 nxm 链接里的 key/expires 换取真实下载直链。
 * 返回 [{ name, shortName, uri }]
 */
async function resolveDownloadLink(info) {
  if (!info) throw new Error('无效的 nxm 链接');
  if (!info.key || !info.expires) {
    throw new Error('该链接没有携带授权信息（key / expires）。请在 Nexus 网站点「Mod Manager Download」获取，不要手动拼链接。');
  }

  const url = API_BASE + '/games/' + encodeURIComponent(info.game) +
    '/mods/' + info.modId + '/files/' + info.fileId + '/download_link.json' +
    '?key=' + encodeURIComponent(info.key) + '&expires=' + info.expires;

  const ses = auth().nexusSession();
  const res = await ses.fetch(url, { headers: { 'User-Agent': auth().cleanUA() } });
  const text = await res.text();

  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch { /* 保留原文 */ }
    // 授权失效是最常见的情况，给一句人话。
    // 实测（2026-10-10）：Nexus 对失效授权返回 HTTP 410 +
    //   "This link has expired - please visit the mod page again to get a new link"；
    // 对签名不匹配的 key 则返回 400 + "Provided key and expire time isn't correct for this user/file"。
    if (res.status === 410 || /has expired|expired/i.test(msg)) {
      throw new Error('下载授权已过期。请回 Nexus 网页重新点一次「Mod Manager Download」，让本程序重新接收链接。');
    }
    if (/key and expire time isn't correct/i.test(msg)) {
      throw new Error('下载授权无效（key 不属于当前账号，或已被使用）。请回 Nexus 网站重新点一次「Mod Manager Download」。');
    }
    throw new Error('获取下载链接失败（HTTP ' + res.status + '）：' + String(msg).slice(0, 200));
  }

  let arr;
  try { arr = JSON.parse(text); } catch { throw new Error('下载链接响应无法解析'); }
  if (!Array.isArray(arr) || !arr.length) throw new Error('没有可用的下载链接');

  return arr.map(x => ({
    name: x.name || '',
    shortName: x.short_name || '',
    uri: x.URI || x.uri || ''
  })).filter(x => x.uri);
}

/* ---------------- 下载 ---------------- */

/**
 * 下载到本地文件，带进度回调、取消支持与**断点续传**。
 *
 * 续传（用户 2026-10-14 要求「任务中断后支持全部恢复继续下载」）：
 *   · `destPath` 已存在且非空 → 带 `Range: bytes=<已有字节>-` 发请求
 *   · 服务器回 **206** → 以追加方式写，进度从已有字节起算
 *   · 服务器回 **200**（不支持 Range）→ 丢掉旧字节从头写。
 *     ⚠️ 这一步不能省：把 200 的完整响应追加到旧字节后面，会得到一个
 *        「前半截 + 完整一份」的坏包 —— 比从零下还糟，且解压时才暴露。
 *   · 服务器回 **416**（Range 越界）→ 本地那份多半已经完整，把它挪开再让上层重试
 *
 * ⚠️ **失败时不再删半截文件** —— 那是下次续传的本钱。
 *    只有用户主动「取消」才清掉（那时是真要丢弃）。
 *
 * 🔴 但「暂停」走的是**同一个中止通道**，语义却相反：暂停必须**保留**半截文件，
 *    否则「继续」就只能从头重下（用户 2026-10-14 明确要求暂停要能续传）。
 *    所以调用方可以用 `keepPartialOnCancel()` 单独告诉这里「这次中止别删」。
 *
 * @param {string} uri
 * @param {string} destPath
 * @param {{onProgress?:Function, shouldCancel?:Function, resume?:boolean, keepPartialOnCancel?:Function}} opts
 */
async function downloadToFile(uri, destPath, opts = {}) {
  const { onProgress, shouldCancel, resume = true, keepPartialOnCancel = null } = opts;
  const ses = auth().nexusSession();

  // 已有半截文件 → 从它的长度接着下
  let startAt = 0;
  if (resume) {
    try {
      const st = fs.statSync(destPath);
      if (st.isFile() && st.size > 0) startAt = st.size;
    } catch { /* 文件不在 → 从头下 */ }
  }

  const headers = { 'User-Agent': auth().cleanUA() };
  if (startAt) headers.Range = 'bytes=' + startAt + '-';

  const res = await ses.fetch(uri, { headers });

  if (res.status === 416) {
    // 本地那份已经 >= 服务端长度（多半上次其实下完了，只是没来得及改名）
    try { fs.renameSync(destPath, destPath + '.stale-' + Date.now()); } catch { /* 忽略 */ }
    throw new Error('本地半截文件与服务端不一致（HTTP 416），已重置，请重试');
  }
  if (!res.ok) throw new Error('下载失败（HTTP ' + res.status + '）');

  // 只有真拿到 206 才算续上（见函数头对 200 的说明）
  const canResume = startAt > 0 && res.status === 206;
  if (startAt > 0 && !canResume) startAt = 0;

  const bodyLen = Number(res.headers.get('content-length')) || 0;
  const total = canResume ? startAt + bodyLen : bodyLen;

  // 优先用 Content-Disposition 里的文件名
  let filename = null;
  const cd = res.headers.get('content-disposition') || '';
  const cdm = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (cdm) {
    try { filename = decodeURIComponent(cdm[1]); } catch { filename = cdm[1]; }
  }

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  const out = fs.createWriteStream(destPath, { flags: canResume ? 'a' : 'w' });
  const body = Readable.fromWeb(res.body);
  let received = canResume ? startAt : 0;
  let cancelled = false;
  let settled = false;

  // 一上来先报一次已有进度：续传时界面上不该又从 0% 爬
  if (canResume && typeof onProgress === 'function') {
    onProgress({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : null, resumed: true });
  }

  /** removeFile=true 只在**用户主动取消**时给 —— 意外中断要留半截文件给下次续传 */
  const cleanup = (removeFile) => {
    try { out.destroy(); } catch { /* 忽略 */ }
    if (removeFile) { try { fs.unlinkSync(destPath); } catch { /* 忽略 */ } }
  };

  await new Promise((resolve, reject) => {
    // 只让第一个结果生效，避免 cancel 之后 'finish' 又把它 resolve 掉
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    body.on('data', (chunk) => {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        cancelled = true;
        // 必须同时销毁两端：只 destroy 源流的话输出流不会触发 finish/error，
        // Promise 会永远挂着（实测踩过）。
        try { body.destroy(); } catch { /* 忽略 */ }
        try { out.destroy(); } catch { /* 忽略 */ }
        done(reject, new Error('已取消'));
        return;
      }
      received += chunk.length;
      if (typeof onProgress === 'function') {
        onProgress({
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : null
        });
      }
    });

    body.on('error', (e) => done(reject, e));
    out.on('error', (e) => done(reject, e));
    out.on('finish', () => done(resolve));

    body.pipe(out);
  }).catch((e) => {
    // 用户主动取消 → 半截文件没意义，清掉；
    // 其它失败（网络抖动 / 进程被杀）→ **留着**，之后「全部恢复」从这儿接着下。
    //
    // ⚠️ 「暂停」也走这条中止通道，但它必须**保留**半截文件 —— 由调用方通过
    //    `keepPartialOnCancel()` 表态。判定失败一律当「不保留」（宁可清掉也别留错文件）。
    let keepPartial = false;
    if (cancelled && typeof keepPartialOnCancel === 'function') {
      try { keepPartial = !!keepPartialOnCancel(); } catch { keepPartial = false; }
    }
    cleanup(cancelled && !keepPartial);
    if (cancelled) throw new Error('已取消');
    throw e;
  });

  return { path: destPath, size: received, total, filename, resumed: canResume };
}

/* ---------------- 待处理队列 ---------------- */

/**
 * 窗口还没就绪时收到的 nxm 链接先存这里，等渲染层主动来取。
 * 放在本模块（而不是 index.js）是为了让 ipc.js 也能访问，避免循环依赖。
 */
let pending = null;

function setPending(info) { pending = info; }
function takePending() { const v = pending; pending = null; return v; }
function peekPending() { return pending; }
function hasPending() { return !!pending; }

/* ---------------- 暂存目录 ---------------- */

function tmpFileFor(info) {
  const name = info.game + '_' + info.modId + '_' + info.fileId + '_' + Date.now() + '.tmp';
  return path.join(paths.TMP, name);
}

module.exports = {
  PROTOCOL,
  parseNxm,
  extractNxmFromArgv,
  registerProtocol,
  unregisterProtocol,
  isProtocolRegistered,
  resolveDownloadLink,
  downloadToFile,
  tmpFileFor,
  setPending, takePending, peekPending, hasPending
};
