'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session, shell } = require('electron');

const nexusAuth = require('./nexusAuth');
const paths = require('./paths');

/**
 * 内嵌 Nexus「安装助手」窗口。
 *
 * ## 它要解决的问题
 *
 * 免费账号要拿到一个 mod 文件，只有两条路，**都必须由用户在 Nexus 网页上点一下**：
 *
 *   A. `Mod Manager Download` —— Nexus 当场签发带 `key` / `expires` 的一次性
 *      `nxm://` 链接。好处是全程自动；坏处是**不是每个文件都有这个按钮**
 *      （作者可以选择不提供），而且必须登录。
 *   B. `Manual download` → 下一页的 `Slow download` —— 免费账号的通用通路，
 *      任何文件都能走。用户明确指定要走这条。
 *
 * 早先的版本只认 A：找不到「Mod Manager Download」就报「请先登录 Nexus」，
 * 于是遇到只有手动下载的文件就卡死（用户看到的「自动安装 CNS 报错」）。
 * 现在两条路都支持，并且**按页面上实际存在的按钮自动切换引导步骤**。
 *
 * ## 设计要点
 *
 * 1. **注入脚本是「步骤感知」的** —— 每 1.8 秒扫一次 DOM，按优先级判断当前在
 *    哪一步，只高亮那一步该点的按钮，顶部横幅给出人话指引：
 *      · 有 `Slow download`   → 第 2 步，高亮它（倒计时期间给出剩余秒数）
 *      · 有 `Manual download` → 第 1 步，高亮目标文件那一行的按钮
 *      · 有 `Mod Manager Download` → 备选通路，也高亮（走 nxm）
 *      · 都没有 → 区分「未登录」和「还在加载」，给对应提示
 * 2. **下载由主进程接管** —— 监听 `will-download`，把文件落到 `data/tmp/`，
 *    完成后回调出去自动进入安装流程。用户不用去翻系统的下载文件夹。
 * 3. **注入脚本会把看到的 DOM 打进主进程日志**（`[SBMM]` 前缀）——
 *    Nexus 一改版，日志里就有真实按钮文案，不用再靠猜。
 *
 * ## 未登录怎么办
 *
 * 不用特判 —— 窗口本身就是真实 Nexus 页面。未登录时页面只给「Manual」按钮，
 * 注入脚本检测到这种状态就把顶部提示条换成「请先登录」。用户在这个窗口里点
 * 右上角 Log in 登录即可，登录后页面刷新，下一轮 tick 就会高亮下载按钮。
 */

const PARTITION = nexusAuth.PARTITION;

const SITE = 'https://www.nexusmods.com';
const GAME = 'stellarblade';

/** 注入脚本版本号。改了脚本就 +1 —— 老页面里残留的定时器会因此被换掉 */
const SCRIPT_VERSION = 'v3';

let win = null;
/**
 * 当前这次安装助手的上下文。
 * `win` 也挂在上面，因为 `will-download` 的监听是**挂在 session 上**的
 * （session 是全局的），需要一个「现在有没有助手窗口、归谁管」的判据。
 */
let current = null; // { modId, fileId, hint, onNxm, onFile, onProgress, onClosed, win }

/* ---------------- 小工具 ---------------- */

function safeFileName(s) {
  const t = String(s == null ? '' : s)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return t || 'download.bin';
}

function isNxm(url) { return /^nxm:/i.test(String(url || '')); }

/** 看起来像「一个文件下载」的地址（用于把新窗口/跳转拉回本会话接管） */
const DOWNLOAD_EXT = /\.(zip|7z|rar|pak|tar|gz)(\?|#|$)/i;
const CDN_HOST = /(^|\.)nexus-cdn\.com$|(^|\.)cdn\.nexusmods\.com$/i;

function looksLikeDownload(url) {
  const s = String(url || '');
  if (DOWNLOAD_EXT.test(s)) return true;
  try { if (CDN_HOST.test(new URL(s).hostname)) return true; } catch { /* 非法 URL，忽略 */ }
  return false;
}

/** 兼容 Electron 新旧两版 console-message 签名 */
function consolePayload(args) {
  const first = args[0];
  if (first && typeof first === 'object' && typeof first.message === 'string') {
    return { level: first.level, message: first.message };
  }
  const lvl = args[1];
  return { level: (lvl === 3 || lvl === 'error') ? 'error' : String(lvl), message: String(args[2] || '') };
}

/* ---------------- 注入脚本 ---------------- */

/**
 * 生成注入脚本。
 *
 * 定位策略（逐级降级，因为 Nexus 的 DOM 结构会改版）：
 *   1. 有 `Slow download` → 高亮它（多文件时优先选 `file_id=<FILE_ID>` 那一行的）
 *   2. 有 `Manual download` → 高亮目标行的按钮
 *   3. 有 `Mod Manager Download` → 高亮（nxm 备选通路）
 *   4. 都没有 → 未登录 / 还在加载 / 需要切到 Files 标签，分别给提示
 *
 * 高亮是**幂等**的：每轮只对「不该高亮的」摘掉 class、对「该高亮的」补上，
 * 不整体清空重加，避免动画反复重启造成闪烁。
 */
function buildInjectScript({ fileId, hint }) {
  return `(() => {
  const FILE_ID = ${JSON.stringify(fileId ? String(fileId) : '')};
  const HINT = ${JSON.stringify(hint || '目标文件')};
  const VER = ${JSON.stringify(SCRIPT_VERSION)};
  // Cloudflare 人机验证页的识别正则 —— 从 nexusAuth 传进来，保持单一来源
  const CHALLENGE = new RegExp(${JSON.stringify(nexusAuth.CHALLENGE_RE)}, 'i');

  // 页面重新注入时先清掉上一版的定时器，避免多份 tick 叠加
  if (window.__sbmmTimer) { try { clearInterval(window.__sbmmTimer); } catch (e) { /* 忽略 */ } window.__sbmmTimer = null; }
  if (window.__sbmmAssistant && window.__sbmmAssistant.version === VER) { window.__sbmmAssistant.tick(); return; }

  const RE_MM     = /mod\\s*manager\\s*download/i;
  const RE_MANUAL = /manual\\s*download/i;
  const RE_SLOW   = /slow\\s*download/i;

  const CSS = [
    '@keyframes sbmmPulse{0%,100%{box-shadow:0 0 0 0 rgba(29,158,117,.85)}50%{box-shadow:0 0 0 9px rgba(29,158,117,0)}}',
    '.sbmm-hl{outline:3px solid #1D9E75 !important;outline-offset:2px !important;border-radius:6px !important;animation:sbmmPulse 1.6s ease-out infinite !important;position:relative !important;z-index:5 !important}',
    '.sbmm-row{background:rgba(29,158,117,.16) !important}',
    '#sbmm-banner b{font-weight:700}'
  ].join('');

  function injectCss() {
    if (document.getElementById('sbmm-css')) return;
    const s = document.createElement('style');
    s.id = 'sbmm-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function banner(html, tone) {
    let b = document.getElementById('sbmm-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'sbmm-banner';
      b.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'color:#fff',
        'font:500 13px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif',
        'padding:9px 18px', 'box-shadow:0 2px 12px rgba(0,0,0,.45)', 'text-align:center'
      ].join(';');
      (document.body || document.documentElement).appendChild(b);
      document.documentElement.style.paddingTop = '60px';
      // 横幅里可能有按钮（比如「重新加载」），用事件委托接一次就够了
      b.addEventListener('click', function (e) {
        const t = e.target;
        if (!t) return;
        if (t.id === 'sbmm-reload') { try { location.reload(); } catch (err) { /* 忽略 */ } }
      });
    }
    const t = tone || 'ok';
    const bg = t === 'wait' ? '#8A6D1F' : (t === 'err' ? '#A33030' : '#1D9E75');
    if (b.dataset.tone !== t) { b.style.background = bg; b.dataset.tone = t; }
    if (b.dataset.msg !== html) { b.dataset.msg = html; b.innerHTML = html; }
  }

  const RELOAD_BTN = ' <button id="sbmm-reload" style="margin-left:8px;padding:2px 10px;border:1px solid rgba(255,255,255,.55);border-radius:5px;background:transparent;color:#fff;font:inherit;cursor:pointer">重新加载</button>';

  function clickables() {
    return Array.prototype.slice.call(document.querySelectorAll(
      'a,button,[role="button"],[role="link"],input[type="button"],input[type="submit"]'
    ));
  }
  function labelOf(el) {
    return String(el.innerText || el.value || (el.getAttribute && el.getAttribute('aria-label')) || '');
  }
  function isMM(el) { return RE_MM.test(labelOf(el)); }
  function isManual(el) { return RE_MANUAL.test(labelOf(el)); }
  function isSlow(el) {
    if (RE_SLOW.test(labelOf(el))) return true;
    const idc = String(el.id || '') + ' ' + String(el.className || '');
    if (/slow/i.test(idc)) return true;
    const href = (el.getAttribute && el.getAttribute('href')) || '';
    if (/nexus-cdn\\.com|cdn\\.nexusmods\\.com/i.test(href)) return true;
    return false;
  }

  function rowOf(el) {
    const out = [];
    let p = el;
    for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (p) out.push(p); }
    return out;
  }

  // 这个元素是否属于 FILE_ID 那个文件所在的行（多文件时用来精确定位）
  function inTargetRow(el) {
    if (!FILE_ID) return false;

    // 1) 自己或祖先带 fileId 标记
    let p = el;
    for (let i = 0; i < 6 && p; i++) {
      if (p.getAttribute) {
        if (p.getAttribute('data-fileid') === FILE_ID || p.getAttribute('data-file-id') === FILE_ID) return true;
        const h = p.getAttribute('href') || '';
        if (h.indexOf('file_id=' + FILE_ID) >= 0) return true;
      }
      p = p.parentElement;
    }

    // 2) 所属「行」里有没有指向该文件的链接。
    //    ⚠️ 必须限定在行容器内查 —— 从 body 上查的话，页面上任何一处
    //       指向该文件的链接都会把**所有**按钮判成目标行。
    const row = el.closest ? el.closest('li,tr,article,section') : null;
    if (row && row.querySelector) {
      const hit = row.querySelector(
        '[data-fileid="' + FILE_ID + '"], [data-file-id="' + FILE_ID + '"], a[href*="file_id=' + FILE_ID + '"]'
      );
      if (hit) return true;
    }
    return false;
  }

  function pickTarget(list) {
    // 精确命中：元素在 FILE_ID 那一行里
    if (FILE_ID) {
      for (let i = 0; i < list.length; i++) { if (inTargetRow(list[i])) return { exact: true, target: list[i] }; }
    }
    // 只有一个候选 → 等价于精确（Slow download 页通常就一个）
    if (list.length === 1) return { exact: true, target: list[0] };
    // 多个候选又对不上号：**不能**随便挑一个高亮 —— 用户会点错文件。
    // 全部高亮，让他自己挑。
    return { exact: false, target: null };
  }

  // 免费账号点 Slow download 前有倒计时，期间按钮点不动
  function countdown() {
    const t = (document.body && document.body.innerText) || '';
    const m = t.match(/download will begin in\\s*(\\d{1,3})/i) || t.match(/in\\s*(\\d{1,3})\\s*(?:s\\b|sec|seconds)/i);
    return m ? Number(m[1]) : 0;
  }

  function applyHighlight(want) {
    const set = new Set(want);
    Array.prototype.slice.call(document.querySelectorAll('.sbmm-hl')).forEach(function (e) {
      if (!set.has(e)) e.classList.remove('sbmm-hl');
    });
    set.forEach(function (e) { e.classList.add('sbmm-hl'); });
  }
  function applyRow(want) {
    const set = new Set(want);
    Array.prototype.slice.call(document.querySelectorAll('.sbmm-row')).forEach(function (e) {
      if (!set.has(e)) e.classList.remove('sbmm-row');
    });
    set.forEach(function (e) { e.classList.add('sbmm-row'); });
  }

  // 只在「步骤变了」时打一条日志，避免每 1.8 秒刷屏
  let lastReport = '';
  function report(step, extra) {
    const key = step + '|' + (extra || '');
    if (key === lastReport) return;
    lastReport = key;
    try { console.log('[SBMM] step=' + step + ' url=' + location.href + (extra ? ' ' + extra : '')); } catch (e) { /* 忽略 */ }
  }

  // 首轮把页面上所有可点元素的文案 dump 一次 —— Nexus 一改版，
  // 主进程日志里就有真实 DOM 可查，不用再靠猜。
  let dumped = false;
  function dumpOnce(all) {
    if (dumped) return;
    dumped = true;
    try {
      const labels = [];
      const seen = new Set();
      for (const el of all) {
        const s = labelOf(el).replace(/\\s+/g, ' ').trim();
        if (!s || s.length > 60 || seen.has(s)) continue;
        seen.add(s);
        labels.push(s);
        if (labels.length >= 40) break;
      }
      console.log('[SBMM] DOM 候选=' + JSON.stringify(labels));
    } catch (e) { /* 忽略 */ }
  }

  function tick() {
    if (!document.body) return;
    injectCss();

    const all = clickables();
    dumpOnce(all);

    const slow = all.filter(isSlow);
    const manual = all.filter(isManual);
    const mm = all.filter(isMM);
    const counts = '{mm:' + mm.length + ',manual:' + manual.length + ',slow:' + slow.length + '}';

    // ---- 第 2 步：Slow download（点完 Manual download 之后出现的页面/弹层） ----
    if (slow.length) {
      const R = pickTarget(slow);
      applyHighlight(R.exact ? [R.target] : slow);
      applyRow(R.exact ? rowOf(R.target) : []);
      const cd = countdown();
      report('slow', counts + (cd ? ' countdown=' + cd : ''));
      if (!R.exact) {
        banner('<b>点绿色高亮的 Slow download</b> · 页面上有 ' + slow.length + ' 个，选你刚点的那个文件', 'wait');
      } else if (cd > 0) {
        banner('<b>等倒计时</b> · 还剩 <b>' + cd + '</b> 秒，结束后点绿色高亮的 <b>Slow download</b>（免费账号走这一步）');
      } else {
        banner('<b>最后一步</b> · 点绿色高亮的 <b>Slow download</b>，下载由本程序自动接管，完成后自动开始安装');
      }
      return;
    }

    // ---- 第 1 步：Manual download（Files 页里目标文件那一行） ----
    if (manual.length) {
      const R = pickTarget(manual);
      applyHighlight(R.exact ? [R.target] : manual);
      applyRow(R.exact ? rowOf(R.target) : []);
      report('manual', counts + ' fileId=' + (FILE_ID || '-') + ' exact=' + R.exact);
      banner(R.exact
        ? '<b>第 1 步</b> · 点绿色高亮的 <b>Manual download</b>（' + HINT + '），下一页会提示你点 Slow download'
        : '<b>第 1 步</b> · 没能在页面上定位到「' + HINT + '」那一行，请自己找对文件，点它的 <b>Manual download</b>（绿色高亮，共 ' + manual.length + ' 个）');
      return;
    }

    // ---- 备选通路：Mod Manager Download（登录后 Nexus 才会给出 nxm 按钮） ----
    if (mm.length) {
      const R = pickTarget(mm);
      applyHighlight(R.exact ? [R.target] : mm);
      applyRow(R.exact ? rowOf(R.target) : []);
      report('mm', counts + ' exact=' + R.exact);
      banner(R.exact
        ? '<b>也可以</b> · 点绿色高亮的 <b>Mod Manager Download</b>（' + HINT + '），本程序会直接接管下载'
        : '<b>也可以</b> · 点绿色高亮的 <b>Mod Manager Download</b> · 选 <b>' + HINT + '</b> 那一行（共 ' + mm.length + ' 个）');
      return;
    }

    // ---- 什么都没有：区分「Cloudflare 人机验证」「未登录」「需要切 Files 标签」「还在加载」 ----
    applyHighlight([]);
    applyRow([]);

    // Cloudflare 人机验证页（实测踩到 —— 内置浏览器跑 Turnstile 容易被拦，
    // 这正是「自动安装报错」的头号嫌疑）。表现为标题「请稍候…」、正文
    // 「正在验证您是否是真人 / 正在进行安全验证」。
    // ⚠️ 必须在「未登录」判断**之前**：挑战页是 Cloudflare 的拦截页，不会带
    //    Nexus 自己的按钮，但整页文本里可能残留被误判的信号；先认挑战页，
    //    才不会把"被拦住"误导成"正在加载 / 未登录"。
    if (CHALLENGE.test((document.body && document.body.innerText) || '')) {
      report('challenge', counts);
      banner('⚠️ <b>被 Cloudflare 人机验证拦住了</b> · 内置浏览器跑 Turnstile 容易被拦。'
        + '点右侧「重新加载」多试几次；仍不行就用系统浏览器登录 Nexus 后回来，'
        + '或改用「从本地压缩包安装」按钮直接选你下好的 CNS 包' + RELOAD_BTN, 'err');
      return;
    }

    // 「未登录」怎么判定（2026-10-11 实测）：
    //   · 页头有指向 sign_in 的链接、文本恰为「Log in」的按钮 → 可靠信号
    //   ⚠️ 不要用「整页文本里有没有 Log in / Sign out」—— Nexus 的模板**始终**
    //      渲染用户菜单（含 Sign out），整页文本判断必然误报。
    //   ⚠️ 也不要用「有没有 /users/ 链接 / 头像」—— 未登录时实测仍能匹配到。
    const signInLinks = document.querySelectorAll('a[href*="sign_in"], a[href*="auth/"]').length;
    const exactLogIn = all.filter(function (e) { return /^log\\s*in$/i.test(labelOf(e).trim()); }).length;

    if (signInLinks > 0 || exactLogIn > 0) {
      report('login', counts + ' signIn=' + signInLinks + ' logIn=' + exactLogIn);
      banner('<b>请先登录 Nexus</b> · 点页面右上角 <b>Log in</b>（登录一次长期有效）。登录后回到本窗口，这里会自动高亮该点的按钮', 'err');
      return;
    }

    // 兜底：Nexus 偶尔不认 ?tab=files，落回描述页。自动切一次 Files 标签。
    if (!window.__sbmmTabClicked && !/tab=files/i.test(location.search)) {
      const filesTab = all.filter(function (e) { return /^files$/i.test(labelOf(e).trim()); })[0];
      if (filesTab) {
        window.__sbmmTabClicked = true;
        report('switch-tab', counts);
        banner('<b>正在切到 Files 标签…</b> · 稍等片刻');
        try { filesTab.click(); } catch (e) { /* 忽略 */ }
        return;
      }
    }

    report('wait', counts + ' signIn=' + signInLinks + ' logIn=' + exactLogIn);
    banner('<b>正在等待页面加载…</b> · 稍等片刻，加载完成后这里会告诉你该点哪个按钮', 'wait');
  }

  window.__sbmmAssistant = { tick: tick, version: VER };
  tick();
  window.__sbmmTimer = setInterval(tick, 1800);
})()`;
}

/* ---------------- 下载接管 ---------------- */

/**
 * `will-download` 是挂在 **session** 上的（同一 partition 的所有窗口共享），
 * 所以只能全局注册一次，再靠 `current` 判断「现在归不归助手管」。
 * 没有助手窗口在跑时直接放行 —— 走系统默认的下载目录，不干扰用户正常下载。
 */
let downloadHooked = false;

function ensureDownloadHook() {
  if (downloadHooked) return;
  downloadHooked = true;

  const ses = session.fromPartition(PARTITION);
  ses.on('will-download', (_event, item, wc) => {
    const ctx = current;
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return; // 没开助手 → 不接管

    const name = safeFileName(item.getFilename() || 'download.bin');
    const dest = path.join(paths.TMP, 'dl-' + Date.now() + '-' + name);
    item.setSavePath(dest);

    const total = item.getTotalBytes();
    const from = wc === ctx.win.webContents ? '助手窗口' : '同会话其它窗口';
    console.log('[安装助手] 接管下载：' + name + ' · ' + total + ' 字节 → ' + dest + '（来源：' + from + '）');

    let lastPct = -1;
    item.on('updated', (_e, state) => {
      if (state !== 'progressing') return;
      const received = item.getReceivedBytes();
      const percent = total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0;
      if (percent === lastPct) return;
      lastPct = percent;
      if (typeof ctx.onProgress === 'function') {
        try { ctx.onProgress({ filename: name, percent, received, total }); } catch { /* 忽略 */ }
      }
    });

    item.on('done', (_e, state) => {
      if (state === 'completed') {
        let size = total;
        try { size = fs.statSync(dest).size; } catch { /* 退回 total */ }
        console.log('[安装助手] 下载完成：' + name + ' · ' + size + ' 字节');
        const cb = ctx.onFile;
        close();                                   // 关掉助手窗口，把注意力交回主界面
        if (typeof cb === 'function') {
          try { cb({ path: dest, filename: name, size }); }
          catch (e) { console.error('[安装助手] onFile 回调异常：' + (e && e.message ? e.message : e)); }
        }
      } else {
        console.error('[安装助手] 下载未完成（state=' + state + '）：' + name + ' → ' + dest);
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch { /* 忽略 */ }
        if (typeof ctx.onProgress === 'function') {
          try { ctx.onProgress({ filename: name, percent: 0, received: 0, total, failed: true, state }); } catch { /* 忽略 */ }
        }
      }
    });
  });
}

/* ---------------- 窗口管理 ---------------- */

function forwardNxm(url) {
  const cb = current && current.onNxm;
  console.log('[安装助手] 捕获 nxm 链接：' + String(url).slice(0, 120));
  close();
  if (typeof cb === 'function') { try { cb(url); } catch (e) { console.error('[安装助手] onNxm 回调异常：' + e.message); } }
  return true;
}

/**
 * 打开安装助手。
 * @param {{
 *   modId:number, fileId?:number, hint?:string, parent?:BrowserWindow,
 *   onNxm?:Function, onFile?:Function, onProgress?:Function, onClosed?:Function
 * }} o
 */
function open(o = {}) {
  const {
    modId, fileId = null, hint = '', parent = null,
    onNxm = null, onFile = null, onProgress = null, onClosed = null
  } = o;
  if (!modId) throw new Error('缺少 modId，无法打开安装助手');
  if (!app.isReady()) throw new Error('应用还没就绪，稍后再试');

  ensureDownloadHook();

  const url = `${SITE}/${GAME}/mods/${modId}?tab=files`;
  current = { modId, fileId, hint, onNxm, onFile, onProgress, onClosed, win: null };
  console.log('[安装助手] 打开 mod=' + modId + ' file=' + (fileId || '-') + ' → ' + url);

  // 已开着 → 复用窗口，换到新目标
  if (win && !win.isDestroyed()) {
    current.win = win;
    win.loadURL(url).catch((e) => console.error('[安装助手] loadURL 异常：' + e.message));
    win.show();
    win.focus();
    return { reused: true, url };
  }

  win = new BrowserWindow({
    width: 1180,
    height: 880,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    title: '安装助手 — 剑星 Mod 管理器',
    autoHideMenuBar: true,
    backgroundColor: '#14161A',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  current.win = win;

  const inject = () => {
    if (!win || win.isDestroyed()) return;
    const ctx = current || {};
    const script = buildInjectScript({ fileId: ctx.fileId, hint: ctx.hint });
    // 页面可能还没 body（about:blank / 骨架屏），失败就等下一轮事件
    win.webContents.executeJavaScript(script).catch(() => { /* 忽略 */ });
  };

  ['dom-ready', 'did-finish-load', 'did-navigate-in-page', 'did-stop-loading']
    .forEach(ev => win.webContents.on(ev, inject));

  // 兜底：Nexus 是重型页面，有时上面几个事件都过了才渲染出下载按钮。
  // 注入脚本自己会起定时器，但那是**注入成功之后**的事；这里保证「第一次注入」不会漏。
  [1500, 4000, 8000].forEach(ms => setTimeout(inject, ms));

  // 把页面里的 console 接进主进程日志 —— `[SBMM]` 开头的诊断信息必须留痕
  win.webContents.on('console-message', (...a) => {
    const p = consolePayload(a);
    if (!p || !p.message) return;
    if (p.message.indexOf('[SBMM]') === 0) console.log('[助手/页面] ' + p.message);
    else if (p.level === 'error') console.error('[助手/页面] ' + p.message);
  });

  win.webContents.on('did-fail-load', (_e, code, desc, failUrl, isMainFrame) => {
    if (code === -3) return;              // ERR_ABORTED：重定向打断，不是真失败
    if (isMainFrame === false) return;    // 子资源失败忽略
    console.error('[安装助手] 加载失败 ' + code + ' ' + desc + ' → ' + failUrl);
  });

  // 页面里的 nxm:// 跳转直接接回主进程（系统协议仍作兜底）
  win.webContents.on('will-navigate', (e, target) => {
    if (isNxm(target)) { e.preventDefault(); forwardNxm(target); return; }
    // 有些 mod 的下载地址是直接指向 CDN 的，点下去会让页面「跳走」。
    // 拦下来改成主动下载，这样才能落进 data/tmp 被安装流程接住。
    if (looksLikeDownload(target)) {
      e.preventDefault();
      console.log('[安装助手] 拦截到文件地址，改为主动下载：' + String(target).slice(0, 140));
      try { win.webContents.downloadURL(target); }
      catch (err) { console.error('[安装助手] downloadURL 失败：' + err.message); }
    }
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isNxm(target)) { forwardNxm(target); return { action: 'deny' }; }
    if (/^https?:/i.test(target)) {
      // 手动下载可能以新窗口/新标签发起。那种请求**不能**丢给外部浏览器 ——
      // 必须留在本会话里，才会被 will-download 接管。
      if (current && looksLikeDownload(target) && win && !win.isDestroyed()) {
        console.log('[安装助手] 把新窗口下载请求拉回本会话：' + String(target).slice(0, 140));
        const u = target;
        setImmediate(() => {
          try { if (win && !win.isDestroyed()) win.webContents.downloadURL(u); }
          catch (e) { console.error('[安装助手] downloadURL 失败：' + e.message); }
        });
        return { action: 'deny' };
      }
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.on('closed', () => {
    const ctx = current;
    win = null;
    current = null;
    if (ctx && typeof ctx.onClosed === 'function') {
      try { ctx.onClosed(); } catch (e) { console.error('[安装助手] onClosed 回调异常：' + e.message); }
    }
  });

  win.loadURL(url).catch((e) => console.error('[安装助手] loadURL 异常：' + e.message));

  return { reused: false, url };
}

function close() {
  const w = win;
  win = null;
  current = null;
  if (w && !w.isDestroyed()) { try { w.close(); } catch { /* 忽略 */ } }
}

function isOpen() { return !!(win && !win.isDestroyed()); }

module.exports = {
  open, close, isOpen, PARTITION, buildInjectScript,
  SCRIPT_VERSION, looksLikeDownload, safeFileName
};
