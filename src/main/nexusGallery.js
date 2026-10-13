'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { imageKey } = require('./imageCache');

/**
 * mod「图集」抓取器。
 *
 * ## 为什么必须走页面
 *
 * 官方接口拿不到 mod 的图集，这一点已用两次 introspection 确认（2026-10-12）：
 *
 * - `Mod` 类型**只有** `pictureUrl` / `thumbnailUrl` / `thumbnailLargeUrl`
 *   —— 是**同一张图的 3 个尺寸**，不是 3 张图
 * - `Query.media` 返回的是**站点图库**（`/images/7804/...`），
 *   而且 `MediaSearchFilter` 只有 `gameId` / `type` / `owner` / `generalSearch` 等，
 *   **没有 modId**，没法收敛到某个 mod
 * - `Query.uploads` 需要登录，且那是「上传的文件」不是图集
 * - v1 REST 也没有 images 端点（实测 `.../mods/1252/images` → 404）
 *
 * 唯一来源是 mod 页的图集区（`?tab=images`），服务端 HTML 里**没有**图集
 * （`net.fetch` 拉回来 174KB 但一个图集 URL 都没有 —— 是前端 JS 渲染的），
 * 所以只能用隐藏窗口真跑一遍 JS。
 *
 * ## 拿什么
 *
 * ```html
 * <ul class="thumbgallery gallery clearfix">
 *   <li class="thumb" data-src="<大图 URL>" data-sub-html="<说明>"
 *       data-exthumbimage="<缩略图 URL>" id="top-thumb-15867"> … </li>
 * ```
 *
 * 用 `data-src`（大图）而不是 `data-exthumbimage`（缩略图）——
 * 抽屉里当展示图用，缩略图太小。
 *
 * ## 边界
 *
 * - 只读**公开的 mod 页**，不绕 Cloudflare：命中挑战页就放弃（返回空）
 * - 结果落 `data/cache/gallery/<modId>.json`，默认 7 天，避免反复打页面
 * - **永不抛**：抓不到就返回 `[]`，图片不该拖垮别的功能
 * - 一次只开一个隐藏窗口（串行化），避免同时开一堆
 */

const PARTITION = 'persist:nexus';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 25000;
const POLL_MS = 1200;
const MAX_POLLS = 10;
/** 抓失败后的冷却时间 —— 别在用户连点几次时反复打页面 */
const FAIL_COOLDOWN_MS = 5 * 60 * 1000;

const CHALLENGE_RE = 'just a moment|checking your browser|verifying you are human|enable javascript and cookies|正在进行安全验证|请稍候|安全服务防护恶意自动程序|Ray ID';

/** 在页面里跑的脚本：把图集容器的 HTML 原样交回来（解析放在 Node 侧，便于离线断言） */
const GRAB_GALLERY_JS = `(() => {
  const title = document.title || '';
  const body = (document.body && document.body.innerText || '').slice(0, 400);
  if (new RegExp(${JSON.stringify(CHALLENGE_RE)}, 'i').test(title + ' ' + body)) return { challenge: true };
  if (document.readyState !== 'complete') return { retry: true };
  const IMG_RE = /staticdelivery\\.nexusmods\\.com\\/mods\\/7804\\/images\\//;

  // 主路：图集容器里的缩略图项，data-src 就是大图地址
  const ul = document.querySelector('ul.thumbgallery') || document.querySelector('.thumbgallery');
  if (ul) {
    const lis = ul.querySelectorAll('li.thumb');
    if (lis.length) return { html: ul.outerHTML, count: lis.length };
  }

  // 兜底：不同 mod 的图集 DOM 不一定一致，直接扫页面上所有指向该 mod 图集的地址。
  // 交给 Node 侧的 imageKey 按「图片身份」去重，缩略图和大图不会被当成两张。
  const seen = new Set();
  const items = [];
  for (const el of document.querySelectorAll('[data-src], [data-exthumbimage], a[href]')) {
    const src = el.getAttribute('data-src') || el.getAttribute('data-exthumbimage') || el.getAttribute('href') || '';
    if (!IMG_RE.test(src)) continue;
    if (/\\/headers\\//.test(src)) continue;      // 页面顶部横幅，不是图集
    if (seen.has(src)) continue;
    seen.add(src);
    items.push(src);
    if (items.length >= 80) break;
  }
  if (items.length) {
    return {
      html: '<ul class="thumbgallery">' + items.map(u => '<li class="thumb" data-src="' + u + '"></li>').join('') + '</ul>',
      count: items.length,
      fallback: true
    };
  }
  return { retry: true };
})()`;

/* ---------------- 纯函数（可离线断言） ---------------- */

function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 取某个属性值（单引号 / 双引号都认） */
function attrValue(attrs, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
  const m = String(attrs == null ? '' : attrs).match(re);
  if (!m) return '';
  return decodeEntities(m[1] != null ? m[1] : (m[2] || ''));
}

function isThumbLi(attrs) {
  return /\bclass\s*=\s*(?:"[^"]*\bthumb\b[^"]*"|'[^']*\bthumb\b[^']*')/i.test(String(attrs || ''));
}

/**
 * 从图集容器的 HTML 里抽出大图列表。
 *
 * ⚠️ 不能假定属性顺序（`data-src` 可能在 `class` 前面），所以逐个 `<li …>` 标签解析。
 * 同一张图出现多次（同一 URL / 同一文件名）只留一份。
 *
 * @returns {{url:string, caption:string}[]}
 */
function parseGalleryHtml(html) {
  const out = [];
  const seen = new Set();
  const tagRe = /<li\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(String(html || '')))) {
    const attrs = m[1];
    if (!isThumbLi(attrs)) continue;
    const url = attrValue(attrs, 'data-src').trim();
    if (!url) continue;
    const key = imageKey(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, caption: attrValue(attrs, 'data-sub-html').trim() });
  }
  return out;
}

function galleryPageUrl(modId) {
  return 'https://www.nexusmods.com/stellarblade/mods/' + Number(modId) + '?tab=images';
}

/* ---------------- 隐藏窗口读页面 ---------------- */

/**
 * 开一个隐藏窗口加载 mod 页，把图集容器的 HTML 拿回来。
 *
 * 与 `nexusAuth.openHiddenAndRead` 同源（同一个 `persist:nexus` 分区，
 * 共享登录态与 Cloudflare 放行记录），但这里**只在失败时**才重试，
 * 成功一次就走。
 */
function loadGalleryHtml(modId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { BrowserWindow, session, app } = require('electron');
  const url = galleryPageUrl(modId);

  // 🔴 保险：应用默认在 `window-all-closed` 时退出（见 src/main/index.js）。
  //    生产环境有主窗口挡着不会触发，但探针 / 冷启动前的极端时序里，
  //    这个隐藏窗口可能就是唯一窗口 —— 它一关会把整个应用带走
  //    （表现是「抓到图集后进程莫名消失」，实测踩过）。
  //    所以抓取期间挂一个 no-op 监听器占住默认行为；
  //    ⚠️ 必须在 destroy() 之后、且放到下一个 tick 再摘 —— 提前摘一样会被带走。
  const keepAlive = () => { /* 抓取期间不许退出 */ };
  app.on('window-all-closed', keepAlive);

  return new Promise(resolve => {
    let done = false;
    let polls = 0;
    let settle = null;
    let win = null;

    const finish = r => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(settle);
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* 忽略 */ }
      setImmediate(() => app.removeListener('window-all-closed', keepAlive));
      resolve(r);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: '图集页面超时' }), timeoutMs);

    const schedule = () => {
      clearTimeout(settle);
      settle = setTimeout(async () => {
        if (done) return;
        try {
          const res = await win.webContents.executeJavaScript(GRAB_GALLERY_JS);
          if (res && res.html) return finish({ ok: true, html: res.html, count: res.count });
          if (res && res.challenge) {
            // 挑战页：重新加载几次试试，仍然不行就放弃（不做绕过）
            polls++;
            if (polls > MAX_POLLS) return finish({ ok: false, reason: '被 Cloudflare 拦住' });
            if (polls % 3 === 0) { try { win.webContents.reload(); } catch { /* 忽略 */ } }
            return schedule();
          }
          polls++;
          if (polls > MAX_POLLS) return finish({ ok: false, reason: '图集没渲染出来' });
          return schedule();
        } catch (e) {
          finish({ ok: false, reason: e.message });
        }
      }, POLL_MS);
    };

    try {
      win = new BrowserWindow({
        show: false,
        width: 1400,
        height: 1000,
        webPreferences: {
          partition: PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false
        }
      });
      // 抹掉 Electron 标记（和登录窗口同一套做法）
      try {
        const s = session.fromPartition(PARTITION);
        const raw = require('electron').app.userAgentFallback || '';
        const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
        s.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36');
      } catch { /* 忽略 */ }

      win.webContents.on('did-stop-loading', schedule);
      win.webContents.on('did-navigate', schedule);
      win.webContents.on('did-fail-load', (_e, code, desc) => {
        if (code === -3) return;               // ERR_ABORTED：正常的中断，忽略
        finish({ ok: false, reason: '页面加载失败：' + code + ' ' + desc });
      });
      win.loadURL(url).catch(e => finish({ ok: false, reason: e.message }));
    } catch (e) {
      finish({ ok: false, reason: '无法打开图集页面：' + e.message });
    }
  });
}

/* ---------------- 带缓存的对外接口 ---------------- */

function createGalleryFetcher({
  cacheDir = paths.GALLERY,
  ttlMs = DEFAULT_TTL_MS,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  loadHtml = loadGalleryHtml,
  now = () => Date.now(),
  logger = null
} = {}) {
  const cap = Math.max(1, Math.floor(Number(limit) || DEFAULT_LIMIT));
  const failedAt = new Map();          // modId -> 时间戳（失败冷却）
  let chain = Promise.resolve();       // 串行化：一次只开一个隐藏窗口

  function cacheFile(modId) {
    return path.join(cacheDir, String(modId) + '.json');
  }

  function readCache(modId) {
    try {
      const raw = JSON.parse(fs.readFileSync(cacheFile(modId), 'utf8'));
      const items = Array.isArray(raw && raw.items) ? raw.items : [];
      const at = Date.parse((raw && raw.at) || '');
      return { items: items.filter(x => x && typeof x.url === 'string' && x.url), at: Number.isFinite(at) ? at : 0 };
    } catch {
      return { items: [], at: 0 };
    }
  }

  function writeCache(modId, items) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const file = cacheFile(modId);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ at: new Date(now()).toISOString(), items }, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch { /* 缓存写不进去不影响本次返回 */ }
  }

  function log(msg, extra) {
    if (!logger) return;
    try { logger.info ? logger.info(msg, extra) : logger(msg); } catch { /* 忽略 */ }
  }

  /**
   * 取某个 mod 的图集（最多 `limit` 张不同图片）。
   *
   * @returns {Promise<{url:string, caption:string}[]>} 抓不到就返回 `[]`
   */
  function getImages(modId, { force = false } = {}) {
    const id = Number(modId);
    if (!Number.isFinite(id) || id <= 0) return Promise.resolve([]);

    const cached = readCache(id);
    const fresh = cached.at && (now() - cached.at) < ttlMs;
    if (!force && fresh && cached.items.length) return Promise.resolve(cached.items.slice(0, cap));

    const lastFail = failedAt.get(id) || 0;
    if (!force && (now() - lastFail) < FAIL_COOLDOWN_MS) {
      return Promise.resolve(cached.items.slice(0, cap));
    }

    const job = () => (async () => {
      const r = await loadHtml(id, { timeoutMs }).catch(e => ({ ok: false, reason: e && e.message }));
      if (!r || !r.ok) {
        failedAt.set(id, now());
        log('[图集] 抓取失败 mod=' + id + '：' + ((r && r.reason) || '未知原因'));
        return cached.items.slice(0, cap);       // 有旧的就先用旧的
      }
      const items = parseGalleryHtml(r.html).slice(0, cap);
      if (!items.length) {
        failedAt.set(id, now());
        return cached.items.slice(0, cap);
      }
      failedAt.delete(id);
      writeCache(id, items);
      log('[图集] mod=' + id + ' 抓到 ' + items.length + ' 张（页面共 ' + (r.count || '?') + ' 张' + (r.fallback ? '，走了兜底扫描' : '') + '）');
      return items;
    })();

    // 串行：上一个抓完再抓下一个
    const p = chain.then(job, job);
    chain = p.catch(() => {});
    return p;
  }

  return { getImages, parseGalleryHtml, cacheFile };
}

module.exports = {
  createGalleryFetcher,
  parseGalleryHtml,
  galleryPageUrl,
  attrValue,
  decodeEntities,
  GRAB_GALLERY_JS,
  PARTITION,
  DEFAULT_TTL_MS,
  DEFAULT_LIMIT,
  FAIL_COOLDOWN_MS
};
