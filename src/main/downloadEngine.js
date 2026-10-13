'use strict';
const fs = require('fs');
const path = require('path');

const { createDownloadQueue } = require('./downloadQueue');
const { createImageCache } = require('./imageCache');
const { runInstall, ownedPathsFor, explainConflicts } = require('./installFlow');
const { sniffExtension, buildArchiveName, buildLegacyArchiveName, extOf } = require('./archiveName');
const fsPromises = require('fs').promises;

/**
 * 下载管理器。
 *
 * 解决的问题：以前点「下载」是卡在抽屉里干等，切页就断，失败也没处看。
 * 现在改成「任务队列」：
 *
 *   加入队列 → 等授权 → 排队 → 取直链 → 下载 → 分析结构 → 安装 → 完成
 *
 * 设计边界（必须守住的）：
 *   · `key` / `expires` 只存在内存（`auth` 表），**绝不落盘** —— 它们是一次性授权凭据。
 *   · 授权来源有两条，都在「合法」范围内：
 *       1. 老路：用户在 Nexus 页面点一次「Mod Manager Download」→ 系统把 `nxm://` 交给本程序
 *       2. 新路（2026-10-13）：用已登录会话直接请求 Nexus **站内**下载弹层端点
 *          （网站自己的 JS 点那个按钮时调的就是它），见 `nexusAutoAuth.js`。
 *          不绕 Cloudflare（命中挑战页就退回老路）、不伪造 key（key 始终由 Nexus 签发）。
 *   · 同时进行的下载数有上限（见 `acquireSlot`），批量授权不会一次开几十个连接。
 *   · 下载好的压缩包保留在 `data/library/`，可重复安装。
 */

const TERMINAL = new Set(['installed', 'failed', 'cancelled', 'interrupted']);
const ACTIVE = new Set([
  'awaiting_authorization', 'queued', 'resolving', 'downloading',
  'downloaded', 'analyzing', 'needs_review', 'installing'
]);

/** 把任意来源的文件名洗成安全的本地文件名（不越界、不破坏扩展名） */
function safeFileName(name, fallback) {
  let base = String(name || '').replace(/[\\/]+/g, '_').replace(/[:*?"<>|\u0000-\u001f]+/g, '_').trim();
  base = base.replace(/^\.+/, '');
  if (!base) base = fallback || 'download.bin';
  return base.slice(0, 160);
}

function collectUrls(images) {
  const out = [];
  for (const x of Array.isArray(images) ? images : []) {
    if (typeof x === 'string') { if (x) out.push(x); }
    else if (x && x.url) out.push(x.url);
  }
  return out;
}

function fileSizeOf(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function createDownloadEngine(opts = {}) {
  const {
    file,
    libraryDir,
    resolveDownloadLink,
    downloadToFile,
    runInstall: runInstallFn = runInstall,
    analyze,
    getRoot = () => null,
    getLayout = () => null,
    getRegistry = () => null,
    getMod = null,
    /**
     * 取某个 Mod 的图集（返回 [{url}] 或 [url]）。拿得到就优先用它，
     * 因为它能给出 mod 页上的多张不同图片；拿不到再回落 `getMod().images`。
     */
    getGallery = null,
    /** 判断 CNS 是否已安装（服装 Mod 的依赖门禁用）。返回 true 才允许自动安装 */
    isCnsInstalled = null,
    cacheImages = null,
    imagesDir,
    onChange = null,
    onProgress = null,
    logger = null,
    now = () => new Date().toISOString(),
    makeId
  } = opts;

  if (!file) throw new Error('downloadEngine 需要任务数据文件路径');
  if (!libraryDir) throw new Error('downloadEngine 需要下载归档目录');

  fs.mkdirSync(libraryDir, { recursive: true });

  const imageCache = cacheImages ? null : (imagesDir ? createImageCache({ imagesDir }) : null);
  const cacheImagesFn = cacheImages || (imageCache ? imageCache.cacheModImages : null);

  const queue = createDownloadQueue({
    file,
    now,
    makeId,
    onChange: (task, list) => { if (onChange) { try { onChange(task, list); } catch { /* 通知失败不影响持久化 */ } } }
  });

  /* ---------------- 下载归档的命名与落点 ---------------- */

  /**
   * 规范的归档文件名与路径：`data/library/<modId>_<模组名>_<版本>.<ext>`
   *
   * 🔴 为什么不用下载直链给的名字：Nexus CDN 的 `Content-Disposition` 是
   *    「Nexus Global Content Delivery Network」且**没有扩展名**，
   *    所有 mod 存下来都长一个样，用户在资源管理器里完全分不清（实测 8 个全同名）。
   *
   * @param {object} meta 任务的 meta（name / modId / version / fileVersion / fileId）
   * @param {string} ext 嗅探出来的扩展名；'' 时用原文件名的扩展名兜底
   */
  function archiveDest(meta, ext) {
    const name = buildArchiveName({
      modId: meta.modId,
      name: meta.name,
      version: meta.version,
      fileVersion: meta.fileVersion,
      fileName: meta.fileName,
      fileId: meta.fileId,
      ext: ext || extOf(meta.fileName) || ''
    });
    return path.join(libraryDir, name);
  }

  /** 嗅探文件真实格式（读前 8 字节，读不到返回 ''） */
  async function sniffFile(p) {
    try {
      const fh = await fsPromises.open(p, 'r');
      try {
        const buf = Buffer.alloc(8);
        const { bytesRead } = await fh.read(buf, 0, 8, 0);
        return sniffExtension(bytesRead ? buf : null);
      } finally { await fh.close(); }
    } catch { return ''; }
  }

  /** 目标已存在且不是同一个文件时加后缀，绝不静默覆盖别人的包 */
  function uniqueDest(dest, taken) {
    if (taken.has(path.resolve(dest).toLowerCase())) {
      const e = path.extname(dest);
      const b = dest.slice(0, dest.length - e.length);
      for (let i = 2; i < 100; i++) {
        const cand = b + '_' + i + e;
        if (!taken.has(path.resolve(cand).toLowerCase())) { taken.add(path.resolve(cand).toLowerCase()); return cand; }
      }
    }
    taken.add(path.resolve(dest).toLowerCase());
    return dest;
  }

  /**
   * 下载完成后把文件安放到规范位置。
   *
   * 下载途中写在 `libraryDir/.dl-<modId>-<fileId>-<ts>.part`（临时名，取消即删），
   * 这里嗅探真实格式再 rename 成规范名 —— 名字要靠文件内容而不是 CDN 的头。
   *
   * @returns {Promise<string|null>} 新的 archivePath；失败返回 null（沿用原路径）
   */
  async function finalizeArchive(id, downloadedPath) {
    const t = queue.get(id);
    if (!t) return null;
    const meta = t.meta || {};
    const ext = await sniffFile(downloadedPath);
    const dest = archiveDest(meta, ext);
    if (path.resolve(dest).toLowerCase() === path.resolve(downloadedPath).toLowerCase()) return downloadedPath;
    try {
      await fsPromises.mkdir(libraryDir, { recursive: true });
      await fsPromises.rename(downloadedPath, dest);
      return dest;
    } catch (e) {
      // rename 失败（跨卷 / 目标被占）就留在原处，至少包还在
      logEvent('download:archiveRenameFailed', { id, error: e.message, from: downloadedPath, to: dest });
      return null;
    }
  }

  /**
   * 老数据迁移：`data/library/<modId>/<Nexus Global ...>` → `data/library/<modId>_<名>_<版本>.<ext>`
   *
   * 2026-10-12 之前的版本每个 mod 一层子目录、文件名直接用 CDN 给的
   * 「Nexus Global Content Delivery Network」（无扩展名）。启动时扫一遍搬过来，
   * 同时把队列里指向旧路径的 `archivePath` / `filename` 一起改掉，否则「打开文件夹」
   * 和「重新安装」都会指向不存在的文件。
   */
  function migrateLegacyLibrary() {
    let moved = 0;
    const taken = new Set();          // 已经被占用的目标名（本轮的旧文件也可能互相撞）
    let entries = [];
    try { entries = fs.readdirSync(libraryDir, { withFileTypes: true }); }
    catch { return { moved: 0 }; }

    const tasks = queue.list();
    const byDir = new Map();          // '<modId>' -> task
    for (const t of tasks) {
      const m = t && t.meta || {};
      if (m.modId) byDir.set(String(m.modId), t);
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const modId = ent.name;
      const dir = path.join(libraryDir, modId);
      // 只搬「纯 modId 数字目录」（新格式是扁平文件，不会是目录）
      if (!/^\d+$/.test(modId)) continue;
      let inside = [];
      try { inside = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      const t = byDir.get(modId);
      const meta = (t && t.meta) || {};

      for (const f of inside) {
        if (!f.isFile()) continue;
        const src = path.join(dir, f.name);
        const legacy = buildLegacyArchiveName({ modId, fileId: meta.fileId, ext: sniffFileSync(src) });
        // 有任务元数据就用规范名，否则至少给个能读懂的 legacy 名
        const base = meta.name ? buildArchiveName({
          modId, name: meta.name, version: meta.version,
          fileVersion: meta.fileVersion, fileName: meta.fileName,
          fileId: meta.fileId, ext: sniffFileSync(src)
        }) : legacy;
        let dest = path.join(libraryDir, base);
        dest = uniqueDest(dest, taken);
        try {
          fs.renameSync(src, dest);
          moved++;
          if (t) queue.update(t.id, { archivePath: dest, filename: path.basename(dest) });
        } catch { /* 搬不动的留给用户自己看，不阻断启动 */ }
      }
      // 空目录清掉（留着会让人以为还有东西）
      try {
        const left = fs.readdirSync(dir);
        if (!left.length) fs.rmdirSync(dir);
      } catch { /* 忽略 */ }
    }
    if (moved) logEvent('library:migrated', { moved, dir: libraryDir });
    return { moved };
  }

  /** 同步版嗅探（迁移走同步 API，只在启动跑一次） */
  function sniffFileSync(p) {
    try {
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(8);
        const n = fs.readSync(fd, buf, 0, 8, 0);
        return sniffExtension(n ? buf : null);
      } finally { fs.closeSync(fd); }
    } catch { return ''; }
  }

  /** 运行期授权凭据（一次性 key/expires），绝不写盘 */
  const auth = new Map();
  /** 取消标志 */
  const cancels = new Map();
  /** 正在跑的下载 */
  const running = new Set();
  /** 已提交 run()、正在排队等下载名额的任务（防重复排队） */
  const pendingSlot = new Set();

  /* ---------------- 下载并发闸门 ---------------- */

  /**
   * 同时进行的下载数上限。
   *
   * ## 为什么需要
   *
   * `run(id)` 原来没有任何全局闸门 —— 谁调谁就开始下。单条下载时没问题，
   * 但 2026-10-13 加了「一键全部自动授权」之后，一次会给几十条任务塞授权，
   * `attachNxm` 挨个 `run()` 就会**同时**开几十个连接：对 Nexus 不礼貌，
   * 本机带宽也会被撕碎，进度条全在跳但哪个都跑不完。
   *
   * 这里做一个最朴素的信号量：名额空了直接过，满了排队；
   * 释放时**把名额直接交给队首**（不是先还再抢），避免插队导致饿死。
   */
  const MAX_PARALLEL_DOWNLOADS = Math.max(1, Number(opts.maxParallelDownloads) || 3);
  let slots = MAX_PARALLEL_DOWNLOADS;
  const slotWaiters = [];

  function acquireSlot() {
    if (slots > 0) { slots--; return Promise.resolve(); }
    return new Promise(resolve => slotWaiters.push(resolve));
  }
  function releaseSlot() {
    const next = slotWaiters.shift();
    if (next) next();          // 名额转交，slots 不变
    else slots++;
  }

  function logEvent(name, data) {
    if (logger && typeof logger.event === 'function') { try { logger.event(name, data); } catch { /* 忽略 */ } }
  }

  /**
   * 更新任务，但**任务已被移除就安静跳过**。
   *
   * 为什么需要：用户在下载/安装途中点「移除」，异步流程还会继续跑几步；
   * 直接 queue.update 会抛「未找到下载任务」，变成没人接的 Promise 异常。
   */
  function patch(id, next) {
    const key = id;
    if (!queue.get(key)) return null;
    try { return queue.update(key, next); } catch { return null; }
  }

  function list() { return queue.list(); }
  function get(id) { return queue.get(id); }
  function activeCount() { return queue.list().filter(t => ACTIVE.has(t.status)).length; }
  function stats() {
    const tasks = queue.list();
    return {
      total: tasks.length,
      active: tasks.filter(t => ACTIVE.has(t.status)).length,
      installed: tasks.filter(t => t.status === 'installed').length,
      failed: tasks.filter(t => t.status === 'failed').length
    };
  }

  /** 同 modId+fileId 的任务（任何状态都算）—— 用来「复用记录」而不是每次新加一条 */
  function findTaskByFile(modId, fileId) {
    const m = Number(modId);
    if (!m) return null;
    const f = Number(fileId || 0);
    return queue.list().find(t =>
      Number(t.meta && t.meta.modId) === m &&
      Number((t.meta && t.meta.fileId) || 0) === f) || null;
  }

  /** 新增任务；同 modId+fileId 的活动任务默认去重（force 可强制新建） */
  function addTask(meta, status, extra = {}) {
    const clean = meta || {};
    const prior = queue.list().find(t =>
      Number(t.meta && t.meta.modId) === Number(clean.modId) &&
      Number(t.meta && t.meta.fileId || 0) === Number(clean.fileId || 0) &&
      ACTIVE.has(t.status));
    if (prior && !extra.force) return { task: prior, duplicate: true };
    const r = queue.add(clean, {
      status,
      force: !!prior || !!extra.force,
      archivePath: extra.archivePath || null,
      filename: extra.filename || null,
      size: extra.size || 0
    });
    return r;
  }

  /* ---------------- 图片 ---------------- */

  let imageChain = Promise.resolve();

  function ensureImages(id) {
    if (!cacheImagesFn || !getMod) return imageChain;
    imageChain = imageChain.then(() => doEnsureImages(id)).catch(() => {});
    return imageChain;
  }

  async function doEnsureImages(id) {
    const t = queue.get(id);
    if (!t) return;
    const modId = Number(t.meta && t.meta.modId);
    if (!modId) return;

    // 1) 图集优先：能拿到 mod 页上的多张「不同」图片（官方 API 只有 1 张封面的 3 个尺寸）
    let urls = [];
    if (getGallery) {
      try {
        const list = await getGallery(modId);
        urls = (list || []).map(x => (typeof x === 'string' ? x : x && x.url)).filter(Boolean);
      } catch { /* 图集拿不到不影响下载，下面还有回落 */ }
    }
    if (!urls.length) urls = collectUrls(t.meta.images);

    const metaPatch = {};
    // 2) 图片仍不足 2 张时回落官方 GraphQL（顺便补齐元数据）
    if (urls.length < 2) {
      try {
        const m = await getMod(modId);
        if (m) {
          if (m.name) metaPatch.name = m.name;
          if (m.author) metaPatch.author = m.author;
          if (m.version) metaPatch.version = m.version;
          if (m.summary) metaPatch.summary = m.summary;
          if (m.url) metaPatch.sourceUrl = m.url;
          if (m.pictureUrl) metaPatch.pictureUrl = m.pictureUrl;
          const list = collectUrls(m.images);
          if (list.length > urls.length) urls = list;
        }
      } catch { /* 离线也要能跑，不因图片失败影响任务 */ }
    }

    if (urls.length) {
      let cached = [];
      try { cached = await cacheImagesFn(modId, urls); } catch { cached = []; }
      const images = (cached || []).filter(x => x && x.localUrl).map(x => ({
        localUrl: x.localUrl, url: x.url, path: x.path, mime: x.mime, size: x.size
      }));
      if (images.length) { metaPatch.images = images; metaPatch.image = images[0].localUrl; }
    }
    if (Object.keys(metaPatch).length) patch(id, { meta: metaPatch });
  }

  /* ---------------- 下载 ---------------- */

  async function run(id) {
    if (running.has(id) || pendingSlot.has(id)) return;
    const t0 = queue.get(id);
    if (!t0) return;

    const a = auth.get(id);
    if (!a || !a.key || !a.expires) {
      patch(id, {
        status: 'awaiting_authorization',
        error: '还没有下载授权。请点「自动授权」，或点「手动授权」在 Nexus 页面上点一次下载按钮。'
      });
      return;
    }

    // 排队等一个下载名额（见 acquireSlot 的注释）。
    // ⚠️ 排队期间用户可能已经取消 —— 拿到名额后要再确认一次，别把取消的任务又拉起来。
    pendingSlot.add(id);
    await acquireSlot();
    pendingSlot.delete(id);

    const tNow = queue.get(id);
    if (!tNow || tNow.status === 'cancelled' || !auth.has(id)) { releaseSlot(); return; }

    running.add(id);
    cancels.set(id, { cancelled: false });
    const cancelled = () => !!(cancels.get(id) && cancels.get(id).cancelled);

    try {
      patch(id, { status: 'resolving', error: null });
      logEvent('download:resolve', { id, modId: a.modId, fileId: a.fileId });

      let links;
      try { links = await resolveDownloadLink(a); }
      catch (e) {
        patch(id, { status: 'failed', error: e.message });
        // 授权类失败（过期 / 不属于本账号）说明这条 key 已经废了。
        // 丢掉它，这样「重试」会回到「等待授权」而不是拿死 key 再撞一次墙。
        if (/过期|无效|授权|expired|incorrect/i.test(e.message)) auth.delete(id);
        logEvent('download:failed', { id, stage: 'resolve', error: e.message });
        return;
      }
      if (cancelled()) { patch(id, { status: 'cancelled' }); return; }

      const chosen = (links || [])[0];
      if (!chosen) { patch(id, { status: 'failed', error: '没有可用的下载地址' }); return; }

      const meta = queue.get(id).meta || {};
      const modId = a.modId || meta.modId;
      // 下载途中用临时名（.part）。Nexus 直链给的文件名是
      // 「Nexus Global Content Delivery Network」且没扩展名，直接拿来当文件名，
      // 8 个 mod 会长得一模一样。下载完再由 finalizeArchive() 嗅探真实格式、
      // 按 <modId>_<模组名>_<版本>.<ext> 规范命名。
      // ⚠️ 名字**不带时间戳**（原来是 `.dl-<modId>-<fileId>-<ts>.part`）。
      //
      // 用户 2026-10-14 要求「任务中断后支持全部恢复继续下载」——
      // 要续传就得能在重新排队时**找回上一次那半截文件**，而带时间戳的名字
      // 每次算出来都不一样，等于每恢复一次就从 0 重下。
      // 同一 (modId, fileId) 在队列里天然唯一（入队会按 mod+file 去重），
      // 所以不需要时间戳防撞名。
      const partName = '.dl-' + (modId || 'unknown') + '-' + (a.fileId || 'x') + '.part';
      const dest = path.join(libraryDir, partName);

      // 续传时先把**已有字节数**报上去，界面不会又从 0% 爬一遍
      let partBytes = 0;
      try { const st = fs.statSync(dest); if (st.isFile() && st.size > 0) partBytes = st.size; } catch { /* 没有半截文件 */ }
      const knownTotal = Number(meta.fileSize) || 0;
      if (partBytes) logEvent('download:resume', { id, modId, fileId: a.fileId, from: partBytes });
      patch(id, {
        status: 'downloading',
        filename: safeFileName(meta.fileName || meta.name || chosen.name, 'mod-' + modId + '-' + (a.fileId || 'x') + '.zip'),
        progress: {
          received: partBytes,
          total: knownTotal,
          percent: knownTotal && partBytes ? Math.min(100, Math.round((partBytes / knownTotal) * 100)) : 0,
          resumed: partBytes > 0
        }
      });

      let r;
      try {
        r = await downloadToFile(chosen.uri, dest, {
          onProgress: (p) => queue.updateProgress(id, p),
          shouldCancel: cancelled
        });
      } catch (e) {
        if (/已取消/.test(e.message)) { patch(id, { status: 'cancelled' }); return; }
        patch(id, { status: 'failed', error: e.message });
        logEvent('download:failed', { id, stage: 'download', error: e.message });
        return;
      }

      // 落到规范名（嗅探真实扩展名）；失败就沿用 .part 路径，至少包还在
      const finalPath = (await finalizeArchive(id, r.path)) || r.path;
      const finalName = path.basename(finalPath);

      patch(id, {
        status: 'downloaded',
        archivePath: finalPath,
        filename: finalName,
        size: r.size,
        error: null,
        progress: { received: r.size, total: r.total || r.size, percent: 100 }
      });
      logEvent('download:downloaded', { id, modId, size: r.size, path: finalPath });

      ensureImages(id);
      await installPhase(id, { auto: true });
    } finally {
      releaseSlot();
      running.delete(id);
    }
  }

  /* ---------------- 分析 + 安装 ---------------- */

  // ⚠️ 这里**没有** `manualTarget`：手动指定落点是「安装助手」那条独立链路
  //    （ipc.js → installFlow.runInstall → installer.analyze 的 opts.manualTarget），
  //    队列驱动这条路径拿不到也不该拿它 —— 之前留过一个同名的死形参，已删。
  async function installPhase(id, { auto = false, onConflict = 'overwrite', pickDir = '', pickDirs = null } = {}) {
    const t = queue.get(id);
    if (!t) return;

    if (!t.archivePath || !fs.existsSync(t.archivePath)) {
      // 顺手把失效的 archivePath 清掉：界面按「有没有安装包」决定按钮是
      // 「重试下载」还是「去处理」，留着旧路径会让按钮一直是「去处理」，
      // 点下去只会重复报同一句错（实测踩过）。
      patch(id, { status: 'failed', archivePath: null, error: '安装包已不存在，请重新下载' });
      return;
    }

    const root = getRoot();
    if (!root) {
      patch(id, {
        status: 'downloaded',
        error: '已下载完成，但还没配置游戏目录，无法自动安装。到「设置」里指定后点「安装」即可。'
      });
      return;
    }

    const meta = { ...(t.meta || {}), taskId: id };
    patch(id, { status: 'analyzing', error: null });

    let plan;
    // `ownedPaths` —— 本 mod 自己已装的文件不算冲突（升级/重装覆盖自己不是撞别人）。
    // 必须在这里也传：这里算出的 `conflictCount` 决定「自动装 or 停下来等确认」，
    // 与 runInstall 里那次重新分析必须口径一致，否则会出现
    // 「这里判成可自动装、runInstall 里又分析成冲突」的错位。
    const ownedPaths = ownedPathsFor(getRegistry(), meta);
    try { plan = await analyze(root, t.archivePath, meta, { pickDir, pickDirs, ownedPaths }); }
    catch (e) {
      // `archive.js` 已经给过「说人话」的消息（压缩包不完整 / 损坏 / 不是压缩包…），
      // 别再套一层「结构识别失败：」—— 用户截图里那句
      // 「结构识别失败：7-Zip 26.03 (x64) : Copyright … 一整段横幅」就是这么来的。
      const msg = String(e && e.message || '');
      const friendly = /^(读取压缩包失败|压缩包不存在|压缩包是空的)/.test(msg) ? msg : '结构识别失败：' + msg;
      patch(id, { status: 'failed', error: friendly });
      logEvent('download:failed', { id, stage: 'analyze', error: msg });
      return;
    }
    // 「会被覆盖的文件」清单（谁装的 / 是不是同一个 mod / 大小对比）。
    // 界面据此列出可点击定位的明细，而不是只说一句「有 3 个文件会被覆盖」。
    try { if (plan) plan.conflictDetails = explainConflicts(getRegistry(), root, plan, meta); }
    catch { /* 拿不到清单不影响安装 */ }

    if (!plan || !plan.ok) {
      patch(id, {
        status: 'needs_review',
        install: {
          plan: plan || null,
          // `diagnosis` 是「这包不是游戏 Mod」这类**结论**，优先于泛泛的「结构无法识别」
          reason: (plan && (plan.diagnosis || plan.reason)) || '结构无法自动识别，需要手动指定安装位置'
        }
      });
      return;
    }

    const conflicts = Number(plan.conflictCount) || 0;
    // 用户确认的策略：结构明确且**无覆盖冲突**才自动装；有冲突就停下等确认
    if (auto && conflicts > 0) {
      patch(id, {
        status: 'needs_review',
        install: { plan, reason: `有 ${conflicts} 个文件会被覆盖，等你确认后再装` }
      });
      return;
    }

    // 服装 Mod 的依赖门禁：装了 CNS 才生效。
    // 没装 CNS 就自动装服装 Mod，结果是文件安安静静躺进 ~Mods\CustomNanosuitSystem\，
    // 游戏里什么都不显示 —— 用户完全不知道还差一个前置。所以停下来提示。
    if (auto && plan.requiresCns && typeof isCnsInstalled === 'function') {
      let ok = false;
      try { ok = !!isCnsInstalled(); } catch { ok = false; }
      if (!ok) {
        patch(id, {
          status: 'needs_review',
          install: {
            plan,
            requiresCns: true,
            reason: '这是服装 Mod，需要先安装 CNS 才会生效。到「前置组件」页一键安装 CNS，再回来点「确认安装」。'
          }
        });
        logEvent('download:needsCns', { id, modId: meta.modId });
        return;
      }
    }

    // 用户可能在「识别结构」这段时间里把任务移除了 —— 那就不该再往游戏目录里写文件
    if (!queue.get(id)) return;

    patch(id, { status: 'installing', install: { plan, reason: plan.reason || null } });
    logEvent('download:install', {
      id, kind: plan.kind, target: plan.target, files: plan.fileCount, conflicts,
      // 软覆盖（同名同大小）与自覆盖（装自己上一版）都不拦自动安装，但记下来便于排查
      softOverwrite: plan.softOverwriteCount || 0,
      selfOverwrite: plan.selfOverwriteCount || 0
    });

    try {
      const r = await runInstallFn({
        root,
        archivePath: t.archivePath,
        meta,
        // ⚠️ 必须透传：runInstall 内部会**重新分析**一次结构，
        //    漏了 pickDir 变体包就会在这一步失败（分析成功但装不上）
        pickDir,
        // 🔴 `pickDirs` 也必须透传（2026-10-13 实测 mod 2595 / 1378 / 437 三个包全挂在这）：
        //    「选哪几套」界面提交的是**数组**。installPhase 这一次分析拿到了 pickDirs 所以能过，
        //    但 runInstall 里重新分析时它被丢掉 → 三个任务全部掉到 failed，
        //    用户看到「安装失败：无法识别这个压缩包的结构」—— 明明已经选过了。
        pickDirs,
        onConflict,
        onProgress: (x) => { if (typeof onProgress === 'function') { try { onProgress(id, x); } catch { /* 忽略 */ } } },
        registry: getRegistry(),
        layout: getLayout(root)
      });
      patch(id, {
        status: 'installed',
        error: null,
        install: {
          kind: r.kind,
          kindLabel: r.kindLabel,
          target: r.target,
          targetLabel: r.targetLabel,
          registryId: r.id,
          written: r.written,
          backed: r.backedCount,
          at: now()
        }
      });
      logEvent('download:installed', { id, modId: meta.modId, registryId: r.id, kind: r.kind, written: r.written });
    } catch (e) {
      patch(id, { status: 'failed', error: '安装失败：' + e.message });
      logEvent('download:failed', { id, stage: 'install', error: e.message });
    }
  }

  /* ---------------- 对外动作 ---------------- */

  /** 从 Nexus 浏览页加入队列（还没有授权，等用户点一次 Mod Manager Download） */
  function enqueueNexus(meta) {
    const prior = findTaskByFile(meta && meta.modId, meta && meta.fileId);
    // 已经在队列里跑着的 → 直接返回，别重复加
    if (prior && ACTIVE.has(prior.status)) return { task: prior, duplicate: true };

    // 已装完 / 失败 / 取消过 → **复用同一条记录**重来，避免列表里堆一串同名任务
    if (prior) {
      const task = queue.update(prior.id, {
        status: 'awaiting_authorization',
        error: null,
        install: null,
        progress: { received: 0, total: Number(meta.fileSize) || 0, percent: 0 },
        archivePath: prior.archivePath,
        meta
      });
      ensureImages(task.id);
      logEvent('download:enqueue', { id: task.id, modId: meta && meta.modId, reused: true });
      return { task, duplicate: false };
    }

    const r = addTask(meta, 'awaiting_authorization');
    if (!r.duplicate) { ensureImages(r.task.id); logEvent('download:enqueue', { id: r.task.id, modId: meta && meta.modId }); }
    return r;
  }

  /**
   * 本地压缩包导入：归档进 library（自包含，原文件删了也能重装），随即分析 + 安装。
   *
   * @param {string} archivePath
   * @param {object} meta
   * @param {object} [opts]
   * @param {boolean} [opts.auto=true]      true = 分析通过就自动装（仍受「冲突 / 缺 CNS」门禁约束）
   * @param {boolean} [opts.confirmed=false] true = **用户已经点过了**，跳过门禁直接装
   *                                         （「一键安装 UE4SS」这种显式动作走这条）
   * @param {string}  [opts.reason]         停在待确认时给用户看的理由
   * @param {string}  [opts.from]           来源标记（'ui' / 'watcher' / 'prereq'），写进 meta
   */
  function enqueueLocal(archivePath, meta = {}, { auto = true, confirmed = false, reason = null, from = 'ui' } = {}) {
    if (!archivePath || !fs.existsSync(archivePath)) throw new Error('安装包不存在：' + archivePath);
    const modId = Number(meta.modId) || 0;
    const snapped = extOf(archivePath) || sniffFileSync(archivePath);
    const wantName = buildArchiveName({
      modId, name: meta.name, version: meta.version,
      fileVersion: meta.fileVersion, fileName: meta.fileName || path.basename(archivePath),
      fileId: meta.fileId, ext: snapped
    });
    const metaWithFrom = { ...meta, from };

    // 复制进 data/library/ 并改成规范名，让队列自包含 —— 用户清空下载文件夹后仍能重装
    let storedPath = archivePath;
    try {
      const dest = uniqueDest(path.join(libraryDir, wantName), new Set());
      if (path.resolve(dest).toLowerCase() !== path.resolve(archivePath).toLowerCase()) {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.copyFileSync(archivePath, dest);
        storedPath = dest;
      }
    } catch (e) {
      // 复制失败不致命：退回用原路径（至少这次能装）
      logEvent('download:archiveCopyFailed', { error: e.message });
      storedPath = archivePath;
    }

    const size = fileSizeOf(storedPath);
    const willInstall = auto || confirmed;
    const fields = {
      status: willInstall ? 'downloaded' : 'needs_review',
      archivePath: storedPath,
      filename: path.basename(storedPath) || wantName,
      size,
      error: null,
      install: willInstall ? null : { plan: null, reason: reason || '等你确认后安装' },
      progress: { received: size, total: size, percent: 100 }
    };

    const prior = findTaskByFile(modId, meta.fileId);
    let task;
    if (prior) {
      task = queue.update(prior.id, { ...fields, meta: metaWithFrom });
      logEvent('download:enqueueLocal', { id: task.id, archivePath: storedPath, from: archivePath, reused: true, auto, confirmed });
    } else {
      const r = addTask(metaWithFrom, fields.status, {
        archivePath: storedPath, filename: fields.filename, size, force: true
      });
      task = r.task;
      // addTask 只写 meta 与档案信息，状态细节（install / progress）再补一次
      queue.update(task.id, fields);
      logEvent('download:enqueueLocal', { id: task.id, archivePath: storedPath, from: archivePath, auto, confirmed });
    }

    ensureImages(task.id);
    // confirmed = 用户已经点过按钮，跳过「冲突 / 缺 CNS」门禁直接装
    if (willInstall) installPhase(task.id, { auto: !confirmed });
    return { task: queue.get(task.id), duplicate: false };
  }

  /**
   * 收到 nxm:// 链接 —— 这就是「用户点了一次」之后的全自动起点。
   * 找到对应的任务（或新建），塞入授权，立刻开始下载。
   */
  function attachNxm(info, meta = {}) {
    if (!info || !info.modId) return null;
    const sameMod = t => Number(t.meta && t.meta.modId) === Number(info.modId);
    const sameFile = t => !info.fileId || !(t.meta && t.meta.fileId) || Number(t.meta.fileId) === Number(info.fileId);

    let task = queue.list().find(t => sameMod(t) && sameFile(t) && ACTIVE.has(t.status));
    if (!task) {
      // 复用同名记录（已装完 / 失败过的），而不是新加一条
      const prior = queue.list().find(t => sameMod(t) && sameFile(t));
      if (prior) {
        task = queue.update(prior.id, {
          status: 'queued', error: null, install: null,
          progress: { received: 0, total: 0, percent: 0 },
          meta: { ...meta, fileId: info.fileId }
        });
      } else {
        const r = queue.add(
          { ...meta, game: info.game || 'stellarblade', modId: info.modId, fileId: info.fileId },
          { status: 'queued', force: true }
        );
        task = r.task;
      }
    } else {
      queue.update(task.id, { status: 'queued', error: null, meta: { ...meta, fileId: info.fileId } });
    }

    auth.set(task.id, {
      game: info.game || 'stellarblade',
      modId: info.modId,
      fileId: info.fileId,
      key: info.key,
      expires: info.expires
    });
    ensureImages(task.id);
    logEvent('download:authorized', { id: task.id, modId: info.modId, fileId: info.fileId });
    run(task.id).catch(() => {});
    return queue.get(task.id);
  }

  /**
   * 自动授权失败时把原因写回任务。
   *
   * 刻意**不改状态** —— 任务本来就停在 `awaiting_authorization`，
   * 这里只补一句人话原因，卡片上就能直接看到「为什么没授权成功」，
   * 用户仍可以点「手动授权」走老路。
   */
  function markAuthFailed(id, message) {
    const t = queue.get(id);
    if (!t) return null;
    if (t.status !== 'awaiting_authorization') return queue.get(id);
    patch(id, { error: message || '自动授权失败' });
    return queue.get(id);
  }

  /** 重试 / 手动开始 */
  function retry(id) {
    const t = queue.get(id);
    if (!t) return null;
    if (t.archivePath && fs.existsSync(t.archivePath)) {
      patch(id, { status: 'downloaded', error: null });
      installPhase(id, { auto: false });
      return queue.get(id);
    }
    if (auth.has(id)) {
      patch(id, { status: 'queued', error: null });
      run(id).catch(() => {});
      return queue.get(id);
    }
    patch(id, {
      status: 'awaiting_authorization',
      error: '需要重新授权：点卡片上的「⚡ 自动授权」即可（或在「下载」页顶部点「全部自动授权」）；也可以点「手动」去 Nexus 网页点一次。'
    });
    return queue.get(id);
  }

  function cancel(id) {
    const t = queue.get(id);
    if (!t) return null;
    if (running.has(id)) {
      const c = cancels.get(id);
      if (c) c.cancelled = true;
      patch(id, { status: 'cancelled', error: null });
    } else {
      patch(id, { status: 'cancelled', error: null });
    }
    return queue.get(id);
  }

  /** needs_review 之后用户点了「确认安装」 */
  /**
   * 用户在「待确认」界面上确认安装。
   *
   * `pickDir` 是**多选一变体包**用的：结构识别不出来时，界面会列出压缩包里
   * 各个候选变体目录，用户挑一个传进来 —— 详见 `installer.analyze` 的 pickDir 分支。
   * 不传就会再跑一遍必然失败的分析，任务永远停在 needs_review（实测踩过）。
   */
  function confirmInstall(id, { onConflict = 'overwrite', pickDir = '', pickDirs = null } = {}) {
    const t = queue.get(id);
    if (!t) return null;
    installPhase(id, { auto: false, onConflict, pickDir, pickDirs });
    return queue.get(id);
  }

  /**
   * 重新分析某个任务的结构，返回最新 plan（并写回任务）。
   *
   * 用途：**老任务**的 `install.plan` 是历史版本分析出来的，字段可能不全
   * （例如多选一变体包的 `options` 候选清单是后加的）——
   * 界面在弹「选哪一套」之前先调这个刷新一次，否则会弹出一个没有候选项的空框。
   */
  async function planOf(id) {
    const t = queue.get(id);
    if (!t || !t.archivePath || !fs.existsSync(t.archivePath)) return null;
    const root = getRoot();
    if (!root) return null;

    const meta = { ...(t.meta || {}), taskId: id };
    let plan = null;
    try { plan = await analyze(root, t.archivePath, meta, { ownedPaths: ownedPathsFor(getRegistry(), meta) }); }
    catch { return null; }
    try { if (plan) plan.conflictDetails = explainConflicts(getRegistry(), root, plan, meta); }
    catch { /* 拿不到清单不影响安装 */ }

    patch(id, {
      install: {
        ...(t.install || {}),
        plan,
        reason: (plan && plan.reason) || (t.install && t.install.reason) || null
      }
    });
    return plan;
  }

  function remove(id, { deleteArchive = false } = {}) {
    const t = queue.get(id);
    if (!t) return false;
    if (running.has(id)) { const c = cancels.get(id); if (c) c.cancelled = true; }
    auth.delete(id);
    cancels.delete(id);
    if (deleteArchive && t.archivePath) { try { fs.rmSync(t.archivePath, { force: true }); } catch { /* 忽略 */ } }
    const ok = queue.remove(id);
    if (ok) logEvent('download:removed', { id, deleteArchive: !!deleteArchive });
    return ok;
  }

  /** 把「注册表里确实装着」的下载任务对齐成已安装（避免装完显示成失败） */
  function syncFromInstalled(mods) {
    const ids = new Set();
    const byMod = new Map();
    for (const m of Array.isArray(mods) ? mods : []) {
      ids.add(m.id);
      const src = (m.meta && m.meta.source) || {};
      const modId = Number(src.modId || (m.meta && m.meta.modId) || 0);
      if (modId) byMod.set(modId, m);
    }
    for (const t of queue.list()) {
      if (t.status === 'installed') continue;
      const regId = t.install && t.install.registryId;
      if (regId && ids.has(regId)) {
        queue.update(t.id, { status: 'installed', error: null });
        continue;
      }
      const modId = Number(t.meta && t.meta.modId);
      if (modId && byMod.has(modId) && TERMINAL.has(t.status)) {
        const m = byMod.get(modId);
        queue.update(t.id, {
          status: 'installed',
          error: null,
          install: { ...(t.install || {}), registryId: m.id, target: m.location, verified: true }
        });
      }
    }
  }

  /**
   * 重新分析所有卡在「待确认」的任务。
   *
   * ## 为什么需要
   *
   * 安装规则是**持续改进**的。2026-10-12 就为「pak + CNS 数据文件」混合包补了规则
   * （mod 533/1303/1507/1933 四个包当时全都因为这条缺失停在待确认）。
   * 规则升级后，这些任务不该一直挂着让用户反复点「确认安装 → 还是识别不了」。
   *
   * 这里就按序重跑一遍 analyze：只更新 `install.plan` 与失败原因，
   * **不改状态、不自动装** —— 装不装始终由用户点那一下决定。
   */
  async function refreshUnknownPlans() {
    const targets = queue.list().filter(t => t.status === 'needs_review');
    let revived = 0;
    for (const t of targets) {
      try {
        const before = (t.install && t.install.plan) || null;
        const plan = await planOf(t.id);
        // 新规则能认出来了 → 活着了；否则维持原样（planOf 已把最新 plan/reason 写回）
        if (plan && plan.ok && !(before && before.ok)) revived++;
      } catch { /* 单个失败不影响其它任务 */ }
    }
    if (revived) logEvent('download:plansRefreshed', { total: targets.length, revived });
    return { total: targets.length, revived };
  }

  /**
   * 清扫 `data/library/` 里**残留的半截下载**（`.dl-<modId>-<fileId>.part`）。
   *
   * 正常路径下**用户主动取消**会自己删掉半截文件；但**进程被强杀**时（关窗口、
   * 任务管理器结束、崩溃）没人收尾 —— 实测残留了两个：一个 147MB、一个 3.9MB。
   *
   * 🔴 口径变了（2026-10-14）：**这些半截文件现在是续传的本钱，不能随手删**。
   *    用户要求「任务中断后支持全部恢复继续下载」，而那批文件正是接着下的起点。
   *
   * 所以只清「**队列里已经没有对应任务**」且**足够旧**的：
   *   · 队列里还有 downloading / interrupted / failed / awaiting_authorization 的任务
   *     → 对应 `.part` 一个都不动 —— 用户可能过好几天才回来点「全部恢复」
   *   · 任务已被移除（记录删了），或压根没有对应任务 → 过 24 小时再清
   *
   * ⚠️ 正在下载的那个 `.part` 一直在被写入，mtime 始终是新的，本来也不会被误删。
   */
  function sweepStaleParts(maxAgeMs = 24 * 60 * 60 * 1000) {
    const swept = [];
    let items = [];
    try { items = fs.readdirSync(libraryDir); } catch { return swept; }
    const now = Date.now();

    // 队列里「还可能续传」的任务 → 保住它们的 .part
    const keep = new Set();
    try {
      for (const t of queue.list()) {
        const m = (t && t.meta) || {};
        if (!m.modId) continue;
        if (t.status === 'downloading' || t.status === 'interrupted' ||
            t.status === 'failed' || t.status === 'awaiting_authorization' ||
            t.status === 'resolving' || t.status === 'queued') {
          keep.add('.dl-' + m.modId + '-' + (m.fileId || 'x') + '.part');
        }
      }
    } catch { /* 队列读不到就别清，宁可留着 */ return swept; }

    for (const name of items) {
      if (!/^\.dl-.*\.part$/.test(name)) continue;
      if (keep.has(name)) continue;
      const p = path.join(libraryDir, name);
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
      if (now - mtime < maxAgeMs) continue;
      try { fs.rmSync(p, { force: true }); swept.push(name); } catch { /* 下次启动再说 */ }
    }
    if (swept.length) logEvent('library:staleParts', { count: swept.length });
    return swept;
  }

  /**
   * 救回被「pickDirs 半链路」bug 打死的那批任务。
   *
   * ## 背景（2026-10-13 用户截图：4 个 mod 报「无法识别这个压缩包的结构」）
   *
   * 变体包（一个归档里 N 套互相替换的内容）要用户先选装哪几套。
   * 用户在界面里选完提交，`installPhase` 这一跳带着 `pickDirs` 是**能过**的，
   * 但 `runInstall` 内部会**重新分析**一遍，而那次调用把 `pickDirs` 丢了
   * → 分析失败 → 任务落到 `failed`，错误还是那句泛泛的
   * 「无法识别这个压缩包的结构，请指定安装目录」。
   *
   * bug 已修（全链路透传），但**已经躺下的任务不会自己爬起来**：
   * 用户每次打开都看到一句说不通的报错。所以启动时把这类任务重新分析一遍：
   *   · 认出来了（`plan.ok`）→ 置 `needs_review`，让用户点一下就能装
   *   · 是变体包（有 `options`）→ 置 `needs_review`，理由换成「有 N 套内容需要选」
   *   · 包真的读不了（多半是下载被截断，mod 1763 就是）→ 保持 `failed`，
   *     但把错误换成一句人话（「压缩包不完整，请重新下载」），别留 7z 横幅
   *
   * ⚠️ 只碰 `failed` 且错误里带**旧文案/7z 横幅**的，绝不复活下载失败
   *    （HTTP 错误、被用户取消）那类。
   */
  async function reviveBrokenInstalls() {
    const targets = queue.list().filter(t =>
      t.status === 'failed'
      && (/无法识别这个压缩包的结构/.test(String(t.error || ''))
        || /7-Zip \d|Copyright \(c\)/.test(String(t.error || '')))
      && t.archivePath
    );
    let revived = 0, repaired = 0;
    for (const t of targets) {
      try {
        if (!fs.existsSync(t.archivePath)) continue;
        const root = getRoot();
        if (!root) continue;
        const meta = { ...(t.meta || {}), taskId: t.id };
        let plan = null, errMsg = '';
        try {
          plan = await analyze(root, t.archivePath, meta, { ownedPaths: ownedPathsFor(getRegistry(), meta) });
          try { if (plan) plan.conflictDetails = explainConflicts(getRegistry(), root, plan, meta); } catch { /* 忽略 */ }
        } catch (e) { errMsg = String((e && e.message) || ''); }

        if (plan && (plan.ok || (Array.isArray(plan.options) && plan.options.length))) {
          // 认出来了（或本来就是变体包等人选）→ 交给用户点确认。
          // `install.reason` 也要一起写：界面（liveStrip / 去处理）读的是它，
          // 只写 plan 的话用户看到的是兜底文案「需要你确认后才能安装」。
          queue.update(t.id, {
            status: 'needs_review',
            error: null,
            install: { ...(t.install || {}), plan, reason: plan.reason || (t.install && t.install.reason) || null }
          });
          revived++;
        } else if (errMsg) {
          // 包真的读不了（多半是下载被截断）→ 说清楚，别留一段 7z 横幅
          const msg = /^(读取压缩包失败|压缩包不存在|压缩包是空的)/.test(errMsg)
            ? errMsg : '结构识别失败：' + errMsg;
          queue.update(t.id, { error: msg });
          repaired++;
        }
      } catch { /* 单个任务不影响其它 */ }
    }
    if (targets.length) logEvent('download:revivedBroken', { total: targets.length, revived, repaired });
    return { total: targets.length, revived, repaired };
  }

  // 老数据搬家：2026-10-12 之前每个 mod 一层子目录、文件名全是
  // 「Nexus Global Content Delivery Network」（无扩展名）。启动时统一搬到
  // 规范名单目录，并修掉队列里指向旧路径的 archivePath。
  try { migrateLegacyLibrary(); } catch (e) { logEvent('library:migrateFailed', { error: e.message }); }
  // 半截下载的残留（进程被强杀留下的）—— 顺手清掉，别一直占着几百 MB
  try { sweepStaleParts(); } catch { /* 清理失败不影响启动 */ }
  // 被旧版 pickDirs bug 打死的那批「无法识别结构」—— 重新分析一遍，能认的救回来。
  // 异步跑，不阻塞 app 启动；失败静默（下次启动还会再试）。
  reviveBrokenInstalls().catch(() => {});

  return {
    list, get, stats, activeCount,
    enqueueNexus, enqueueLocal, attachNxm,
    retry, cancel, confirmInstall, remove, planOf,
    markAuthFailed,
    ensureImages, syncFromInstalled,
    refreshUnknownPlans,
    reviveBrokenInstalls,
    /** 手动跑一次老归档搬家（设置页/测试用） */
    migrateLegacyLibrary,
    /** 手动清一次残留的半截下载（测试用） */
    sweepStaleParts,
    hasAuth: (id) => auth.has(id),
    /** 当前下载闸门占用情况（诊断/测试用） */
    slotsInfo: () => ({ max: MAX_PARALLEL_DOWNLOADS, free: slots, waiting: slotWaiters.length }),
    _queue: queue
  };
}

module.exports = { createDownloadEngine, safeFileName, ACTIVE, TERMINAL };
