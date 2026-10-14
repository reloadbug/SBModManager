'use strict';
const { ipcMain, shell, app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const paths = require('./paths');
const logger = require('./logger');
const game = require('./game');
const scanner = require('./scanner');
const { createConfigStore } = require('./store');
const { createRegistry } = require('./registry');
const { createNexus } = require('./nexus');
const { createTranslator } = require('./translate');
const nexusAuth = require('./nexusAuth');
const nxm = require('./nxm');
const installer = require('./installer');
const installFlow = require('./installFlow');
const { createDownloadEngine } = require('./downloadEngine');
const localState = require('./localState');
const { createBlacklist } = require('./blacklist');
const { createFavorites } = require('./favorites');
const archive = require('./archive');
const nexusBrowser = require('./nexusBrowser');
const nexusAutoAuth = require('./nexusAutoAuth');
const prereqs = require('./prereqs');
const github = require('./github');
const { createDownloadWatcher, parseNexusFileName } = require('./downloadWatcher');
const { createGalleryFetcher } = require('./nexusGallery');
const { createImageCache } = require('./imageCache');
const variantCover = require('./variantCover');
const { readJson, writeJson } = require('./store');

let config, registry, nexus, translator, engine, watcher, gallery, blacklist, favorites;

/** UE4SS 最新 Release 的短时缓存（避免每次进前置组件页都打 GitHub API） */
let ue4ssReleaseCache = { at: 0, release: null };

/** 图片缓存单例：图集归并与「多尺寸只留一张」的逻辑都在里面，别每次调用新建 */
let imageCacheSingleton = null;
function imageCache() {
  if (!imageCacheSingleton) imageCacheSingleton = createImageCache({ imagesDir: paths.IMAGES });
  return imageCacheSingleton;
}

/**
 * 取某个 Mod 的展示图（最多 5 张不同图片）。
 *
 * 顺序：先问图集抓取器（`nexusGallery`，能拿到网页上的完整图集），
 * 图集为空再回落到官方 GraphQL 的 `images`（通常只有 1 张封面 + 3 个尺寸）。
 * 结果统一交给 `imageCache` 去重 + 限 5 张 + 落盘。
 */
async function imagesForMod(modId, opts = {}) {
  const id = Number(modId);
  if (!Number.isFinite(id) || id <= 0) return [];
  let urls = [];
  if (gallery) {
    try {
      const list = await gallery.getImages(id, opts);
      urls = (list || []).map(x => (typeof x === 'string' ? x : x && x.url)).filter(Boolean);
    } catch { urls = []; }
  }
  if (!urls.length) {
    try { urls = ((await nexus.getMod(id)) || {}).images || []; } catch { urls = []; }
  }
  if (!urls.length) return [];
  let cached = [];
  try { cached = await imageCache().cacheModImages(id, urls, opts); } catch { cached = []; }
  return (cached || []).filter(x => x && x.localUrl).map(x => ({
    localUrl: x.localUrl, url: x.url, path: x.path, mime: x.mime, size: x.size
  }));
}

function init() {
  paths.ensure();
  config = createConfigStore(paths.configFile);
  registry = createRegistry(paths.registryFile);
  nexus = createNexus({ getApiKey: () => config.get('nexusApiKey') });
  translator = createTranslator({ cacheFile: paths.translateCache, targetLang: config.get('targetLang') });
  gallery = createGalleryFetcher({ cacheDir: paths.GALLERY, logger });
  blacklist = createBlacklist(paths.blacklistFile);
  favorites = createFavorites(paths.favoritesFile);

  engine = createDownloadEngine({
    file: paths.downloadQueueFile,
    libraryDir: paths.LIBRARY,
    imagesDir: paths.IMAGES,
    resolveDownloadLink: (a) => nxm.resolveDownloadLink(a),
    downloadToFile: (uri, dest, o) => nxm.downloadToFile(uri, dest, o),
    // ⚠️ 第 4 个参数（opts）必须透传 —— 变体包靠 `pickDir` 走兜底分支，
    //    吞掉它会让「手动选一套」永远失败
    analyze: (root, archivePath, meta, opts) => installer.analyze(root, archivePath, meta, opts || {}),
    getRoot: () => currentRoot(),
    getLayout: (root) => game.layout(root),
    getRegistry: () => registry,
    getMod: (modId) => nexus.getMod(modId),
    // 图集抓取（隐藏窗口读 Nexus mod 页的 ul.thumbgallery）：拿不到就返回 []，
    // downloadEngine 会自动回落到官方 GraphQL 的 images
    getGallery: (modId) => (gallery ? gallery.getImages(modId) : Promise.resolve([])),
    // 服装 Mod 的依赖门禁：CNS 没装就不自动装（否则装了也不生效，用户白等）
    isCnsInstalled: () => {
      const r = currentRoot();
      if (!r) return false;
      try { return !!game.inspect(r).cns.installed; } catch { return false; }
    },
    logger,
    onChange: (task) => broadcastDownloads(task),
    onProgress: (id, x) => sendDownloadProgress(id, x)
  });

  // 安装规则升级后，让「待确认」的老任务重新算一次方案（只改 plan，不自动装）。
  // 延迟到界面就绪之后再跑：analyze 要真解压压缩包，别跟启动抢 CPU。
  setTimeout(() => { engine.refreshUnknownPlans().catch(() => {}); }, 6000);

  initWatcher();
}

/* ---------------- 下载目录监听 ---------------- */

/** 监听目录默认值：系统「下载」文件夹（用户手动下载 mod 的默认落点） */
function defaultWatchDirs() {
  const out = [];
  try { out.push(require('electron').app.getPath('downloads')); } catch { /* 忽略 */ }
  return out;
}

function watchDirs() {
  const saved = config.get('watchDirs');
  const list = Array.isArray(saved) && saved.length ? saved : defaultWatchDirs();
  return list.filter(Boolean);
}

function initWatcher() {
  watcher = createDownloadWatcher({
    dirs: watchDirs(),
    seenFile: paths.watchSeenFile,
    readJson, writeJson,
    logger,
    onArchive: (f) => { onWatchedArchive(f).catch(e => console.error('[watch] 导入失败：' + e.message)); }
  });
  if (config.get('watchDownloads') !== false) {
    try { watcher.start(); } catch (e) { console.error('[watch] 启动失败：' + e.message); }
  }
}

/**
 * 下载目录里出现了一个新的 mod 压缩包 → 自动导入下载队列。
 *
 * 两级处理：
 *   · 文件名能解析出 Nexus 的 modId → 回 Nexus 补全名称/作者/封面 → **自动安装**
 *   · 解析不出来 → 进队列的「待确认」，界面弹一条提示，用户点一下再装
 *
 * 为什么不无脑自动装：下载目录里可能有游戏自己的分卷包、别人的 mod 包、
 * 甚至只是碰巧叫 `xxx.zip` 的东西。`parseNexusFileName` 要求文件名里有
 * 「-<modId>-<version>-<13 位时间戳>」这种 Nexus 专有格式，才敢自动动手。
 */
async function onWatchedArchive(f) {
  let meta = {
    name: f.displayName,
    fileName: f.name,
    modId: f.modId || null,
    version: f.version || null,
    fileSize: f.size
  };

  if (f.modId) {
    try {
      const m = await nexus.getMod(f.modId);
      if (m) {
        meta = {
          ...meta,
          name: m.name || meta.name,
          author: m.author,
          version: m.version || meta.version,
          summary: m.summary,
          sourceUrl: m.url,
          pictureUrl: m.pictureUrl || m.image || '',
          image: m.image || '',
          images: m.images || []
        };
      }
    } catch { /* 离线也要能导入 */ }
  }

  const autoInstall = !!f.modId && config.get('watchAutoInstall') !== false;
  const r = engine.enqueueLocal(f.path, meta, {
    auto: autoInstall,
    reason: autoInstall
      ? null
      : (f.modId ? '自动安装已关闭，等你确认' : '文件名里没有 Nexus 来源信息，等你确认后再装')
  });
  broadcastDownloads(r.task);
  // 通知界面弹一条提示（用户可能正在别的页面）
  sendToMain('watch:found', {
    file: f.name,
    name: meta.name,
    modId: f.modId || null,
    size: f.size,
    auto: autoInstall,
    taskId: r.task && r.task.id
  });
  logger.event('watch:imported', { file: f.name, modId: f.modId || null, auto: autoInstall, taskId: r.task && r.task.id });
  return r;
}

/** 主窗口（所有主动推送都以它为终点） */
function mainWin() {
  return BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.mainApp === true) || null;
}

function sendToMain(channel, payload) {
  const w = mainWin();
  if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

/** 下载队列有任何变化 → 推给界面（任务卡片实时刷新） */
function broadcastDownloads(task) {
  if (!engine) return;
  // 下载 / 安装状态变了，浏览页的「已安装 / 已下载」标记也得跟着变
  invalidateLocalIndex();
  sendToMain('download:changed', { task: task || null, tasks: engine.list(), stats: engine.stats() });
}

function sendDownloadProgress(id, x) {
  sendToMain('download:progress', { id, ...(x || {}) });
}

/**
 * nxm:// 链接到达 → 全自动起点。
 *
 * 不再弹「确认安装」抽屉等用户点第二次：链接一到就补全元数据、塞进下载队列、
 * 立刻下载，下载完按策略自动安装。界面只负责显示进度。
 *
 * ⚠️ 授权 key/expires 只进内存（downloadEngine 的 auth 表），**绝不落盘**。
 *
 * 由 index.js（second-instance / 冷启动）与 ipc 内部（助手窗口 onNxm）共同调用。
 */
async function handleIncomingNxm(info) {
  if (!info || !info.modId) return null;

  // 先把 mod 元数据补齐（名字 / 作者 / 版本 / 封面），队列里显示得才像样
  let meta = {};
  try {
    const m = await nexus.getMod(info.modId);
    if (m) {
      meta = {
        name: m.name,
        author: m.author,
        version: m.version,
        summary: m.summary,
        sourceUrl: m.url,
        pictureUrl: m.pictureUrl || m.image || '',
        image: m.image || '',
        images: m.images || []
      };
    }
  } catch { /* 拿不到元数据也要能下载 */ }

  // 自动授权那条路能从弹层里读到文件名 —— 比接口给的更贴近这次实际下载的文件
  if (info.fileName && !meta.fileName) meta.fileName = info.fileName;

  const task = engine.attachNxm(info, meta);
  broadcastDownloads(task);
  logger.event('download:incoming', { modId: info.modId, fileId: info.fileId, taskId: task && task.id });
  return task;
}

/* ---------------- 自动授权（免点击） ---------------- */

/**
 * 批量自动授权的并发保护：**全进程只有一条串行流水线**。
 *
 * 为什么必须是「一条」而不是「一批」：
 *   · 同一个文件被授权两次 → 第二次会让第一次刚签发的 key 作废（key 一次性），
 *     表现就是任务莫名失败；
 *   · 批量下载 24 个 mod 时，`download:enqueue` 会被连调 24 次，
 *     如果每次各自起一个请求，就是 24 个并发打向 Nexus —— 既失礼也更容易被 Cloudflare 盯上。
 *
 * 所以入队自动授权、单条点按钮、一键全部授权，**三条入口都汇到这条队列**。
 */
const AUTO_AUTH_GAP_MS = 900;
let autoAuthQueue = [];          // 待授权任务 id
let autoAuthDrain = null;        // 正在跑的流水线 Promise
let autoAuthGapMs = AUTO_AUTH_GAP_MS;

/**
 * Cloudflare 挑战页的容忍度。
 *
 * 2026-10-13 实测（38 条真实任务）：批量跑到第 4 条时撞上一次挑战页，
 * 老策略**立刻清空队列**，剩 34 条全被放弃 —— 用户看到的是「跑了一下就停」。
 * 而 97 秒后对**同一个文件**再试就成功了，说明那只是**短时频控**，不是被封。
 *
 * 所以改成「冷却 + 续跑」：单条撞挑战就把它放回队尾、多等一会儿再试一次；
 * 只有**连续** `MAX_CHALLENGE_STREAK` 条都撞上，才认定「真被拦了」并停下。
 * （`not_logged_in` 不受此限 —— 会话失效时继续跑毫无意义，立刻停。）
 */
const MAX_CHALLENGE_STREAK = 3;
/** 撞挑战后的额外冷却（叠在正常 gap 之上） */
const CHALLENGE_COOLDOWN_MS = 2600;

function sendAutoAuth(x) { sendToMain('download:autoauth', x || {}); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 哪些失败码意味着「**是文件本身不行**」，而不是「会话 / 网络不行」。
 *
 * 最典型的场景：作者更新了 mod，把旧文件归档或删掉 —— 任务里存的 fileId 就成了死号，
 * 弹层端点拿不到 nxm 链接（`no_nxm` / `http` 404）。这种情况下**重查一次主文件就能救回来**，
 * 不该把「作者只开了手动下载」这种话甩给用户。
 *
 * 刻意**不含** `not_logged_in`（换文件也没用）与 `challenge` / `network`（是频控或网络，重试要等）。
 */
const STALE_FILE_CODES = new Set(['no_nxm', 'bad_link', 'http']);

/**
 * 这个文件上传至今多久（毫秒）。**查不到返回 null**。
 *
 * ⚠️ 不能用 0 兜底：那样任何查不到时间的文件都会被当成「刚上传」，
 *    把「作者确实关了管理器下载」也一并说成「稍后再试」。
 *
 * 判定与等待时长见 `nexusAutoAuth.settleDecision()`（纯函数，可离线断言）。
 */
async function fileAgeMs(modId, fileId) {
  try {
    const files = await nexus.getModFiles(Number(modId));
    const f = (files || []).find(x => Number(x.fileId) === Number(fileId));
    const d = f && Number(f.date);
    if (!d) return null;
    return Date.now() - d * 1000;
  } catch { return null; }
}

/**
 * 查一个 Mod 的主文件（供「自动授权前补 fileId」使用）。
 *
 * 永不抛：**查不到** 与 **连不上** 是两回事，交给调用方去说不同的话。
 * @returns {Promise<{ok:true, file:object|null}|{ok:false, error:string}>}
 */
async function resolvePrimaryFile(modId) {
  try {
    const files = await nexus.getModFiles(Number(modId));
    return { ok: true, file: nexus.pickPrimaryFile(files) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * 给**一条**任务自动授权：用已登录会话直接向 Nexus 站内下载弹层端点要 nxm 链接，
 * 拿到后走与「用户点了一下」**完全相同**的后续链路（handleIncomingNxm）。
 *
 * @returns {Promise<{ok:boolean, code?:string, reason?:string, taskId:string}>} 永不抛
 */
async function autoAuthorizeTask(id) {
  const t = engine.get(id);
  if (!t) return { ok: false, code: 'no_task', reason: '任务不存在', taskId: id };

  const modId = Number(t.meta && t.meta.modId);
  let fileId = Number(t.meta && t.meta.fileId) || null;

  if (!modId) {
    const reason = '这条任务没有来源 Mod ID，无法自动授权（可点「手动」）。';
    engine.markAuthFailed(id, reason);
    broadcastDownloads(null);
    return { ok: false, code: 'bad_args', reason, taskId: id };
  }

  // 入队时没钉上 fileId 是常事 —— 浏览页卡片直接点「下载」时抽屉还没加载文件列表，
  // 批量下载时那次 `nexus.files()` 也可能失败。但 Nexus 的站内下载弹层端点**必须按 fileId 走**，
  // 所以这里现场补一次：只要 modId 在，多半能查出来，不该把用户推去点「手动」。
  let fileIdResolved = false;
  if (!fileId) {
    const r = await resolvePrimaryFile(modId);
    const f = r.ok ? r.file : null;
    if (f && Number(f.fileId) > 0) {
      fileId = Number(f.fileId);
      fileIdResolved = true;
      engine.patchMeta(id, {
        fileId,
        fileName: f.name || (t.meta && t.meta.fileName) || '',
        fileVersion: f.version || (t.meta && t.meta.fileVersion) || '',
        fileSize: f.sizeInBytes || (t.meta && t.meta.fileSize) || 0
      });
      broadcastDownloads(null);
      logger.event('download:resolvedFile', { id, modId, fileId, how: 'autoauth' });
    } else {
      const reason = r.ok
        ? '这个 Mod 在 Nexus 上没有可下载的文件，无法自动授权（可点「手动」）。'
        : '取不到这个 Mod 的文件列表（网络或接口问题），稍后再试或点「手动」。';
      engine.markAuthFailed(id, reason);
      broadcastDownloads(null);
      logger.event('download:resolveFileFailed', { id, modId, ok: r.ok, error: r.error || null });
      return { ok: false, code: 'bad_args', reason, taskId: id };
    }
  }

  let r = await nexusAutoAuth.fetchNxm({ game: 'stellarblade', modId, fileId });

  // —— fileId 失效自愈 ——
  // 任务自带的 fileId 可能是**死号**：作者更新 mod 后把旧文件归档 / 删掉是常事，
  // 此时弹层端点给不出 nxm（`no_nxm` / `http`），老逻辑会直接失败并说「作者只开了手动下载」——
  // 把锅甩给作者，而任务永远卡住。既然手里有 modId，就重查一次主文件、换新 fileId 再试一次。
  // 只在「这次是自己查出来的」以外的情形才做，且新旧 fileId 必须真的不同，避免空转。
  if (!r.ok && !fileIdResolved && STALE_FILE_CODES.has(r.code)) {
    const rr = await resolvePrimaryFile(modId);
    const nf = rr.ok && rr.file ? Number(rr.file.fileId) || 0 : 0;
    if (nf && nf !== fileId) {
      logger.event('download:fileIdStale', { id, modId, oldFileId: fileId, newFileId: nf, cause: r.code });
      fileId = nf;
      engine.patchMeta(id, {
        fileId,
        fileName: rr.file.name || '',
        fileVersion: rr.file.version || '',
        fileSize: rr.file.sizeInBytes || 0
      });
      broadcastDownloads(null);
      r = await nexusAutoAuth.fetchNxm({ game: 'stellarblade', modId, fileId });
    }
  }

  // —— 「文件刚上传，Nexus 还没同步好」 ——
  // 作者传完新文件后，站内要过一会儿才签发 nxm 链接。这期间弹层里没有 dl_link，
  // 表现为 `no_nxm`（老逻辑）或 `file_not_ready`（认得出页面措辞时）。
  // 老逻辑会直接报「作者只开了手动下载」——把锅甩给作者，而且用户点「手动授权」
  // 同样拿不到链接（文件确实还没就绪，不是作者关了什么）。
  let notReady = r.code === 'file_not_ready';
  if (!r.ok && (notReady || r.code === 'no_nxm')) {
    const age = await fileAgeMs(modId, fileId);
    const d = nexusAutoAuth.settleDecision({ code: r.code, ageMs: age });
    notReady = d.notReady;
    if (d.wait > 0) {
      logger.event('download:fileNotReady', {
        id, modId, fileId, ageMs: age, waitMs: d.wait, rawCode: r.code
      });
      await sleep(d.wait);
      r = await nexusAutoAuth.fetchNxm({ game: 'stellarblade', modId, fileId });
    }
  }

  if (!r.ok) {
    // 已经确认过是「刚上传」的，即使重试后拿到的还是 `no_nxm`，也要按「稍后再试」说
    const code = notReady ? 'file_not_ready' : r.code;
    const reason = nexusAutoAuth.humanize(code, r.reason);
    engine.markAuthFailed(id, reason);
    broadcastDownloads(null);
    logger.event('download:autoauthFailed', {
      id, modId, fileId, code, rawCode: r.code, reason: r.reason, snippet: r.snippet || null
    });
    return { ok: false, code, reason, taskId: id };
  }

  // 弹层里那个 <h2> 就是文件名 —— 队列卡片能显示得更准
  const info = { ...r.info };
  if (r.fileName && !(t.meta && t.meta.fileName)) info.fileName = r.fileName;
  const task = await handleIncomingNxm(info);
  logger.event('download:autoauth', { id, modId, fileId, taskId: task && task.id });
  return { ok: true, taskId: (task && task.id) || id };
}

/** 跑一次串行流水线（已在跑就直接复用那一条） */
function drainAutoAuth() {
  if (autoAuthDrain) return autoAuthDrain;

  const stats = { total: 0, ok: 0, failed: 0, skipped: 0, retried: 0, stopped: false, reasons: {} };
  // 挑战页的「连续」计数与「已重试过」名单 —— 每跑一轮流水线重置
  let challengeStreak = 0;
  const challengeRetried = new Set();

  autoAuthDrain = (async () => {
    while (autoAuthQueue.length) {
      // 每轮重算总数：批量下载会在流水线跑着的时候继续往里塞任务，
      // 写死一个初值会让进度条停在 3/24 之类的地方（自己把自己锁死）
      stats.total = stats.ok + stats.failed + stats.skipped + autoAuthQueue.length;
      const id = autoAuthQueue.shift();
      const cur = engine.get(id);
      // 用户可能在排队期间取消 / 移除 / 已手动授权成功
      if (!cur || cur.status !== 'awaiting_authorization') { stats.skipped++; continue; }

      const r = await autoAuthorizeTask(id);

      if (r.ok) {
        stats.ok++;
        challengeStreak = 0;
      } else {
        stats.reasons[r.code] = (stats.reasons[r.code] || 0) + 1;
        challengeStreak = (r.code === 'challenge') ? challengeStreak + 1 : 0;

        // 会话失效 → 继续跑毫无意义；连续撞挑战 → 认定真被拦了。两种都停下。
        if (r.code === 'not_logged_in' || challengeStreak >= MAX_CHALLENGE_STREAK) {
          stats.failed++;
          stats.stopped = true;
          stats.stopCode = r.code;
          stats.remaining = autoAuthQueue.length;
          autoAuthQueue = [];
          sendAutoAuth({ done: stats.ok + stats.failed, total: stats.total, ok: stats.ok, failed: stats.failed, taskId: id });
          break;
        }

        // 单条撞挑战：放回队尾、多冷却一会儿再试一次。
        // 实测（38 条真实任务）这种拦截几十秒就自解，为它放弃整批太亏。
        if (r.code === 'challenge' && !challengeRetried.has(id)) {
          challengeRetried.add(id);
          autoAuthQueue.push(id);
          stats.retried++;
          sendAutoAuth({ done: stats.ok + stats.failed, total: stats.total, ok: stats.ok, failed: stats.failed, taskId: id });
          await sleep(CHALLENGE_COOLDOWN_MS);
          continue;
        }

        stats.failed++;
      }

      sendAutoAuth({ done: stats.ok + stats.failed, total: stats.total, ok: stats.ok, failed: stats.failed, taskId: id });
      if (autoAuthQueue.length) await sleep(autoAuthGapMs);
    }
    return stats;
  })().finally(() => { autoAuthDrain = null; });

  return autoAuthDrain;
}

/** 往流水线里塞任务并等它跑完（新塞的会被正在跑的那一轮接着处理） */
async function enqueueAutoAuth(ids) {
  for (const id of ids) {
    if (!id) continue;
    if (!autoAuthQueue.includes(id)) autoAuthQueue.push(id);
  }
  let stats = null;
  // while 是为了兜住竞态：流水线刚判空退出、这一瞬间又塞进来
  do { stats = await drainAutoAuth(); } while (autoAuthQueue.length);
  return stats;
}

/**
 * 批量自动授权：把队列里所有「等待授权」的任务挨个授权。
 *
 * 三条刻意的约束：
 *   1. **串行** —— 一次只问 Nexus 一个文件（见上面 autoAuthQueue 的注释）。
 *   2. **节流** —— 每条之间留 `delayMs`（默认 900ms），像人一样慢慢点。
 *   3. **撞上挑战页不轻易放弃** —— 单条撞挑战就放回队尾冷却重试一次，
 *      只有**连续** 3 条都撞上才停下（`not_logged_in` 仍然立刻停）。
 *
 * @param {{delayMs?:number, limit?:number}} o
 */
async function autoAuthorizeAll(o = {}) {
  autoAuthGapMs = Number.isFinite(o.delayMs) ? Math.max(0, o.delayMs) : AUTO_AUTH_GAP_MS;
  const limit = Number.isFinite(o.limit) ? Math.max(1, o.limit) : Infinity;

  const ids = engine.list()
    .filter(t => t.status === 'awaiting_authorization')
    .map(t => t.id)
    .slice(0, limit);

  if (!ids.length) {
    autoAuthGapMs = AUTO_AUTH_GAP_MS;
    return { total: 0, ok: 0, failed: 0, skipped: 0, stopped: false, reasons: {} };
  }

  const stats = await enqueueAutoAuth(ids);
  autoAuthGapMs = AUTO_AUTH_GAP_MS;
  broadcastDownloads(null);
  return stats || { total: ids.length, ok: 0, failed: 0, skipped: 0, stopped: false, reasons: {} };
}

/**
 * 新任务入队后按开关自动授权（配置项 `autoAuthorize`）。
 * 失败**不抛**、只把原因写回任务 —— 入队本身不该因为授权失败而报错。
 *
 * ⚠️ 延迟 60ms 再入队：`download:enqueue` 是逐条调的（批量下载会连调几十次），
 *    攒一下能让它们**共用同一条流水线**，而不是每条各自起一个请求。
 */
function maybeAutoAuthorize(id) {
  try {
    if (!config.get('autoAuthorize')) return;
    setTimeout(() => { enqueueAutoAuth([id]).catch(() => {}); }, 60);
  } catch { /* 配置读不到就当关着 */ }
}

/* ---------------- 一键确认安装（默认选择） ---------------- */

/** 批量「一键安装」的实时进度 → 界面按钮文案 */
function sendConfirmProgress(x) { sendToMain('download:confirmprogress', x || {}); }

/**
 * 把队列里所有卡在「待确认」的任务，按**默认选择**一次性装掉。
 *
 * ## 为什么需要（用户 2026-10-14 原话）
 *
 * 「支持批量确认，有多个文件时每组冲突的 mod 都默认选中第一个文件；
 *   不要手工一个一个确认」。
 *
 * 变体包（一个归档里 N 套内容）以前一律要用户点开选择框、再点一次安装；
 * 队列里二十多条待确认时，用户得点四十多下，而其中绝大多数包
 * 「每组选第一套」本来就是对的。这里一次按默认集装掉。
 *
 * ## 口径
 *
 *   · **只动 `needs_review`**
 *   · 排除 `plan.diagnosis` 的（作者的工程源文件 —— 那不是「要你选」，
 *     是「装了也没用」，界面给的是「移除」按钮，不该被这里顺手装掉）
 *   · 顺序执行 + 每条之间留 `gapMs`（默认 120ms）：每条都要解压分析，
 *     一口气并发会把磁盘打满
 *   · 正在等用户的其他状态（待授权）不碰
 *
 * 返回 `{ total, ok, failed, skipped }`；`ok` 表示「处理完没抛错」，
 * 具体结果是「已安装」还是「仍待确认（真冲突需用户选）」可从任务状态看出。
 */
async function confirmAllDefault(o = {}) {
  const gapMs = Number.isFinite(o.gapMs) ? Math.max(0, o.gapMs) : 120;

  const targets = engine.list().filter(t => {
    if (t.status !== 'needs_review') return false;
    const plan = t.install && t.install.plan;
    if (plan && plan.diagnosis) return false;
    return true;
  });

  if (!targets.length) {
    sendConfirmProgress({ done: 0, total: 0, name: '' });
    return { total: 0, ok: 0, failed: 0, skipped: 0 };
  }

  let ok = 0, failed = 0, skipped = 0;
  sendConfirmProgress({ done: 0, total: targets.length, name: '' });
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    sendConfirmProgress({ done: i, total: targets.length, name: (t.meta && t.meta.name) || '' });
    try {
      const r = await engine.confirmInstallDefault(t.id);
      if (r) ok++; else skipped++;
    } catch (e) {
      failed++;
      logger.event('download:confirmDefaultFailed', { id: t.id, error: e && e.message });
    }
    if (gapMs) await sleep(gapMs);
  }
  sendConfirmProgress({ done: targets.length, total: targets.length, name: '' });
  logger.event('download:confirmAllDefault', { total: targets.length, ok, failed, skipped });
  broadcastDownloads(null);
  return { total: targets.length, ok, failed, skipped };
}

/** 统一的返回包装：{ ok, data } / { ok:false, error } */
function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return ok(await fn(...args)); }
    catch (e) { console.error('[' + channel + ']', e); return fail(e); }
  });
}

/** 需要向渲染层回推进度时使用 */
function handleWithEvent(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return ok(await fn(event, ...args)); }
    catch (e) { console.error('[' + channel + ']', e); return fail(e); }
  });
}

/* ---------------- 游戏 ---------------- */

function currentRoot() {
  const r = config.get('gameRoot');
  return r && game.isGameRoot(r) ? r : null;
}

/* ---------------- 浏览页「本地状态」（已安装 / 已下载） ---------------- */

/**
 * 本地状态索引：扫一遍磁盘 + 读下载队列，得出「哪些 Nexus modId 已经在本机」。
 *
 * ⚠️ **不能缓存太久**：用户装完一个 mod 立刻回浏览页，必须马上看到「已安装」。
 * 但也不能完全不缓存 —— 前端一次加载会并发打 list / facets，翻页又很快。
 * 120ms 的窗口足够合并同一次加载的重复调用，又短到用户感知不到延迟。
 */
let localIdxCache = { at: 0, index: null };
const LOCAL_IDX_TTL = 120;

function localIndex(force = false) {
  const now = Date.now();
  if (!force && localIdxCache.index && now - localIdxCache.at < LOCAL_IDX_TTL) {
    return localIdxCache.index;
  }

  const root = currentRoot();
  let scanned = [];
  if (root) {
    try { scanned = scanner.scan(root, registry); } catch (e) {
      console.error('[浏览] 扫描本地 Mod 失败：' + e.message);
    }
  }

  let tasks = [];
  try { tasks = engine.list(); } catch { /* 队列读不出来就只按已安装算 */ }

  const index = localState.buildLocalIndex({ scanned, tasks });
  localIdxCache = { at: now, index };
  return index;
}

/** 安装 / 卸载 / 下载状态变化后主动失效，别让界面显示上一个状态 */
function invalidateLocalIndex() { localIdxCache = { at: 0, index: null }; }

function inspectGame() {
  const root = currentRoot();
  if (!root) {
    const candidates = game.detectCandidates([config.get('gameRoot')]);
    return { found: false, configured: config.get('gameRoot'), candidates };
  }
  const info = game.inspect(root);
  delete info.layout; // 路径细节通过 layoutOf 单独给
  return { found: true, ...info, layout: game.layout(root) };
}

/* ---------------- 已安装 Mod ---------------- */

function listMods() {
  const root = currentRoot();
  if (!root) return { installed: [], root: null };
  const list = scanner.scan(root, registry);
  return { installed: list, root };
}

/** 启用 / 禁用 */
function setEnabled(id, enabled) {
  const root = currentRoot();
  if (!root) throw new Error('尚未配置有效的游戏目录');
  const L = game.layout(root);
  const list = scanner.scan(root, registry);
  const mod = list.find(m => m.id === id);
  if (!mod) throw new Error('未找到该 Mod');

  if (mod.kind === 'prereq') throw new Error('前置组件不支持禁用');

  if (mod.kind === 'pak') {
    for (const f of mod.files) {
      const from = path.join(L.modsDir, f.name);
      const to = enabled ? path.join(L.modsDir, f.name.replace(/\.disabled$/i, ''))
        : path.join(L.modsDir, f.name + (f.name.endsWith('.disabled') ? '' : '.disabled'));
      if (from !== to && fs.existsSync(from)) fs.renameSync(from, to);
    }
  } else if (mod.kind === 'script') {
    toggleScriptMod(L, mod.name, enabled);
  }

  registry.setEnabled(id, enabled);
  return { id, enabled };
}

function toggleScriptMod(L, name, enabled) {
  let raw = '';
  try { raw = fs.readFileSync(L.modsTxt, 'utf8'); } catch { raw = ''; }
  const lines = raw.split(/\r?\n/);
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(.+?)\s*:\s*([01])(\s*)$/);
    if (m && m[2].trim() === name) {
      lines[i] = `${m[1]}${m[2]} : ${enabled ? 1 : 0}${m[4]}`;
      done = true;
    }
  }
  if (!done) lines.push(`${name} : ${enabled ? 1 : 0}`);
  fs.writeFileSync(L.modsTxt, lines.join('\r\n'), 'utf8');
}

/** 卸载：不直接删除，移到 data/backup/uninstalled/ 便于回滚 */
function uninstall(id, { purge = false } = {}) {
  const root = currentRoot();
  if (!root) throw new Error('尚未配置有效的游戏目录');
  const L = game.layout(root);
  const list = scanner.scan(root, registry);
  const mod = list.find(m => m.id === id);
  if (!mod) throw new Error('未找到该 Mod');

  // 前置组件默认不给卸（删错文件游戏直接起不来）。
  // 例外：如果这个前置是**本程序装的**，注册表里有完整回滚清单 + 覆盖备份，
  // 那就是安全可逆的，允许卸载。
  if (mod.kind === 'prereq') {
    const r0 = registry.get(mod.id);
    const canRollback = !!(r0 && r0.manifest && r0.manifest.length);
    if (!canRollback) {
      throw new Error('这个前置组件不是本程序安装的，没有回滚清单；请手动处理（直接删文件可能让游戏无法启动）');
    }
  }

  const dest = path.join(paths.BACKUP, 'uninstalled', id.replace(/[\\/:*?"<>|]/g, '_') + '-' + Date.now());
  const moved = [];
  let restored = [];
  let pruned = [];

  if (mod.kind === 'pak') {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of mod.files) {
      const from = path.join(L.modsDir, f.name);
      if (!fs.existsSync(from)) continue;
      if (purge) { fs.unlinkSync(from); moved.push({ file: f.name, deleted: true }); }
      else { fs.renameSync(from, path.join(dest, f.name)); moved.push({ file: f.name, to: dest }); }
    }
  } else if (mod.kind === 'script') {
    const from = path.join(L.ue4ssModsDir, mod.name);
    if (fs.existsSync(from)) {
      if (purge) { fs.rmSync(from, { recursive: true, force: true }); moved.push({ file: mod.name, deleted: true }); }
      else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(from, dest); moved.push({ file: mod.name, to: dest }); }
    }
  } else {
    // 落到 SB\ 等非标准位置的 mod（框架包）：没有磁盘特征，只能按 manifest 精确回滚。
    // 保留 rel 的相对结构，便于人工找回。
    const reg = registry.get(id);
    const manifest = (reg && reg.manifest && reg.manifest.length)
      ? reg.manifest
      : (mod.files || []).filter(f => f.path).map(f => ({ path: f.path, rel: f.name, size: f.size }));

    if (!manifest.length) throw new Error('该 Mod 没有可回滚的文件清单，请手动处理');

    fs.mkdirSync(dest, { recursive: true });
    for (const f of manifest) {
      if (!fs.existsSync(f.path)) continue;
      const rel = f.rel || path.basename(f.path);
      if (purge) { fs.unlinkSync(f.path); moved.push({ file: rel, deleted: true }); }
      else {
        const to = path.join(dest, rel.split('/').join(path.sep));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(f.path, to);
        moved.push({ file: rel, to });
      }
    }

    // 文件移走后会留下空目录（CNS 在 ~Mods 与 ue4ss\Mods 下建了好几层）。
    // 不清掉的话：① 目录特征还在 → CNS 被误判成「已安装（不完整）」；
    //             ② 空的 ue4ss\Mods\DekCNS\ 会被脚本扫描重新列成一条 mod。
    pruned = installer.pruneEmptyDirs(
      manifest.map(f => (f.path ? path.dirname(f.path) : null)),
      [L.root, L.sb, L.paks, L.modsDir, L.win64, L.ue4ssDir, L.ue4ssModsDir]
    );
    if (pruned.length) console.log('[卸载] 清理空目录 ' + pruned.length + ' 个');

    // 还原安装时被覆盖的游戏原文件。
    // CNS 这类框架是把文件合并进 SB\Binaries\ + SB\Content\，装的时候盖掉了游戏自己的
    // 文件；如果卸载只删不还，游戏目录就会缺文件。所以这里必须把备份放回原位。
    const overwritten = (reg && reg.overwritten) || [];
    if (overwritten.length) {
      const rr = installer.restoreOverwritten(overwritten);
      restored = rr.restored;
      if (rr.failed.length) {
        console.error('[卸载] 原文件还原失败 ' + rr.failed.length + ' 个：' +
          JSON.stringify(rr.failed.slice(0, 3)));
      } else if (reg.backupDir) {
        // 全部还原成功 → 这份覆盖备份已经没有价值了，删掉，否则会一直堆在
        // data/backup/overwritten/ 里（注册表条目已删，再没人引用得到它）。
        // ⚠️ 有任何一个还原失败就**保留**，那是最后的救命稻草。
        if (installer.dropBackup(reg.backupDir)) {
          console.log('[卸载] 已还原全部原文件，覆盖备份已清理：' + reg.backupDir);
        }
      }
    }
  }

  registry.remove(id);
  invalidateLocalIndex();
  logger.event('mods:uninstall', {
    id, kind: mod.kind, moved: moved.length,
    restored: restored.length, pruned: pruned.length, purge: !!purge
  });
  return {
    id,
    moved,
    restored,
    pruned,
    backupDir: purge ? null : dest
  };
}
/* ---------------- Nexus ---------------- */

function parseNexusUrl(url) {
  const s = String(url || '');
  const m = s.match(/nexusmods\.com\/([^/?#]+)\/mods\/(\d+)/i);
  if (!m) throw new Error('无法识别的 Nexus 链接，格式应为 https://www.nexusmods.com/stellarblade/mods/<数字>');
  const fileId = (s.match(/[?&]file_id=(\d+)/i) || [])[1] || null;
  return {
    gameDomain: m[1].toLowerCase(),
    modId: Number(m[2]),
    fileId: fileId ? Number(fileId) : null,
    isStellarBlade: m[1].toLowerCase() === 'stellarblade'
  };
}

/* ---------------- 注册 ---------------- */

function register() {
  init();

  /* 应用级 */
  handle('app:bootstrap', async () => {
    const g = inspectGame();
    const mods = listMods();
    const auth = await nexusAuth.getStatus();

    // 后台静默复核登录状态（缓存超过 30 分钟才做）。
    // 不 await —— 不能让网络请求拖慢启动；有变化会通过事件推给界面。
    nexusAuth.recheckIfStale().catch(() => {});

    // 把「磁盘上确实装着」的下载任务对齐成已安装（避免装完显示成失败）
    try { engine.syncFromInstalled(mods.installed); } catch { /* 忽略 */ }

    return {
      version: app.getVersion(),
      packaged: !!app.isPackaged,
      config: config.all(),
      game: g,
      installed: mods.installed,
      translateStats: translator.stats(),
      auth: auth,
      dataDir: paths.DATA,
      downloads: engine.list(),
      downloadStats: engine.stats(),
      watch: {
        enabled: config.get('watchDownloads') !== false,
        autoInstall: config.get('watchAutoInstall') !== false,
        running: !!(watcher && watcher.isRunning()),
        dirs: watcher ? watcher.getDirs() : watchDirs(),
        seen: watcher ? watcher.seenCount() : 0
      }
    };
  });
  handle('app:openExternal', (url) => { shell.openExternal(url); return true; });
  handle('app:openPath', (p) => { shell.openPath(p); return true; });
  handle('app:revealPath', (p) => { shell.showItemInFolder(p); return true; });
  handle('app:dataDir', () => paths.DATA);

  /* 运行日志 —— 界面上「查看日志」用。
     用户报「点了没反应 / 报错」时，日志是唯一能回溯的东西（应用没有终端）。 */
  handle('log:info', () => ({
    file: logger.file(),
    dir: paths.LOGS,
    keepDays: logger.KEEP_DAYS,
    files: logger.list()
  }));
  handle('log:tail', (n, opts) => logger.tail(n, opts));
  handle('log:openDir', () => { shell.openPath(paths.LOGS); return true; });
  handle('log:open', (file) => { shell.openPath(file || logger.file()); return true; });

  /* 配置 */
  handle('config:get', () => config.all());
  handle('config:set', (patch) => {
    const next = config.set(patch || {});
    if (patch && patch.targetLang) {
      translator = createTranslator({ cacheFile: paths.translateCache, targetLang: next.targetLang });
    }
    return next;
  });
  handle('config:reset', () => config.reset());

  /* 游戏 */
  handle('game:inspect', () => inspectGame());
  handle('game:detect', () => ({ candidates: game.detectCandidates([config.get('gameRoot')]) }));
  handle('game:setRoot', (root) => {
    if (!game.isGameRoot(root)) throw new Error('该目录不是有效的剑星根目录（未找到 SB\\Binaries\\Win64\\SB-Win64-Shipping.exe）');
    config.set({ gameRoot: root });
    return inspectGame();
  });
  handle('game:ensureModsDir', () => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    return game.ensureModsDir(root);
  });
  // UE4SS 蓝图模组（Logic Mod）的落点 —— 与 ~Mods 是两套互不相通的加载机制
  handle('game:ensureLogicModsDir', () => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    return game.ensureLogicModsDir(root);
  });

  /* 已安装 Mod */
  handle('mods:list', () => {
    const r = listMods();
    // 磁盘上确实装着的 → 对齐下载队列状态
    try { engine.syncFromInstalled(r.installed); } catch { /* 忽略 */ }
    return r;
  });
  handle('mods:setEnabled', (id, enabled) => setEnabled(id, enabled));
  handle('mods:uninstall', (id, opts) => uninstall(id, opts));
  handle('mods:reveal', (id) => {
    const mods = listMods().installed;
    const m = mods.find(x => x.id === id);
    if (!m) throw new Error('未找到该 Mod');
    const target = m.kind === 'script' ? path.join(m.location, m.name) : path.join(m.location, m.files[0].name);
    shell.showItemInFolder(target);
    return true;
  });
  /**
   * 某个 Nexus modId **已装着**的文件清单（覆盖对比用）。
   *
   * 用户要求「并列显示对应的已安装模组的信息，尤其是图片」——
   * 图片走现成的 `mod:images`，文件清单得单独给一条。
   * 一个 modId 可能对应注册表里多条记录（不同 fileId 各一条），全部列出来。
   */
  handle('mods:filesForModId', (modId) => {
    const id = Number(modId);
    if (!id) return [];
    const out = [];
    const seen = new Set();
    for (const reg of registry.all()) {
      if (Number(reg.source && reg.source.modId) !== id) continue;
      for (const f of reg.manifest || []) {
        if (!f || !f.path) continue;
        const key = String(f.path).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        let rel = f.rel || path.basename(f.path);
        try {
          const root = currentRoot();
          if (root) {
            const r = path.relative(root, f.path);
            if (r && !r.startsWith('..')) rel = r.split(path.sep).join('/');
          }
        } catch { /* 用 basename */ }
        out.push({ rel, name: path.basename(f.path), size: f.size || 0 });
      }
    }
    return out;
  });

  /* Nexus 账号 */
  handle('nexus:authStatus', () => nexusAuth.getStatus());
  handle('nexus:authVerify', () => nexusAuth.verifyByPage());
  handleWithEvent('nexus:login', (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    nexusAuth.openLoginWindow(parent);
    return { opened: true };
  });
  handle('nexus:logout', () => nexusAuth.logout());
  handleWithEvent('nexus:fetchApiKey', async (event) => {
    const r = await nexusAuth.fetchApiKey();
    if (r.ok && r.key) {
      config.set({ nexusApiKey: r.key });
      if (!event.sender.isDestroyed()) event.sender.send('nexus:auth-changed', { loggedIn: true, apiKeySaved: true });
    }
    return r;
  });

  // 登录窗口里检测到已登录 → 推送给主界面
  nexusAuth.setAuthListener((info) => {
    const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && x.mainApp === true);
    if (w) w.webContents.send('nexus:auth-changed', info);
  });

  /* ---------------- nxm:// 协议 ---------------- */

  let activeDownload = null; // { cancelled: bool }

  handle('nxm:status', () => ({
    registered: nxm.isProtocolRegistered(),
    pending: nxm.hasPending()
  }));

  handle('nxm:register', () => ({ registered: nxm.registerProtocol() }));

  handle('nxm:unregister', () => {
    nxm.unregisterProtocol();
    return { registered: nxm.isProtocolRegistered() };
  });

  /** 渲染层启动时主动取一次（避免事件竞态）—— 取到就直接接管进下载队列 */
  handle('nxm:takePending', () => {
    const info = nxm.takePending();
    if (info) handleIncomingNxm(info).catch(() => {});
    return info;
  });

  /** 解析链接：既支持 nxm://，也支持粘贴的 Nexus 网页地址 */
  handle('nxm:parse', (url) => {
    const s = String(url || '').trim();
    const fromNxm = nxm.parseNxm(s);
    if (fromNxm) return fromNxm;
    const m = /nexusmods\.com\/([^/]+)\/mods\/(\d+)(?:[^#]*?[?&]file_id=(\d+))?/i.exec(s);
    if (!m) throw new Error('无法识别的链接，请粘贴 Nexus 的 Mod 页面地址或 nxm:// 链接');
    return {
      raw: s,
      game: m[1],
      modId: Number(m[2]),
      fileId: m[3] ? Number(m[3]) : null,
      key: null,
      expires: null,
      userId: null,
      needsKey: true
    };
  });

  /**
   * 准备安装：查 mod / 文件信息，并换取下载直链。
   * 返回给渲染层做「确认安装」展示。
   */
  handle('nxm:prepare', async (payload) => {
    const link = nxm.parseNxm(payload && payload.raw) || payload;
    if (!link || !link.modId) throw new Error('无效的链接');

    const [mod, files] = await Promise.all([
      nexus.getMod(link.modId).catch(() => null),
      nexus.getModFiles(link.modId).catch(() => [])
    ]);

    const file = (files || []).find(f => Number(f.fileId) === Number(link.fileId)) || null;

    // 只有带授权信息（nxm 链接）时才去换直链
    let links = [];
    let linkError = null;
    if (link.key && link.expires) {
      try {
        links = await nxm.resolveDownloadLink(link);
      } catch (e) {
        linkError = e.message;
      }
    } else {
      linkError = '这个链接没有携带下载授权（key / expires）。请到 Nexus 网页点「Mod Manager Download」按钮，让系统调起本程序。';
    }

    return {
      link: { game: link.game, modId: link.modId, fileId: link.fileId },
      mod: mod ? {
        modId: mod.modId,
        name: mod.name,
        author: mod.author,
        version: mod.version,
        pictureUrl: mod.pictureUrl,
        downloads: mod.downloads,
        endorsements: mod.endorsements,
        url: mod.url
      } : null,
      file: file ? {
        fileId: file.fileId,
        name: file.name,
        version: file.version,
        size: file.size,
        sizeInBytes: file.sizeInBytes,
        category: file.category
      } : null,
      links: links.map(l => ({ name: l.name, uri: l.uri })),
      linkError
    };
  });

  /** 开始下载（带进度回推） */
  handleWithEvent('nxm:start', async (event, payload) => {
    const link = nxm.parseNxm(payload && payload.raw) || payload;
    if (!link || !link.modId) throw new Error('无效的链接');

    const links = await nxm.resolveDownloadLink(link);
    const chosen = links[payload && payload.linkIndex ? payload.linkIndex : 0] || links[0];
    if (!chosen) throw new Error('没有可用的下载地址');

    const dest = nxm.tmpFileFor(link);
    const send = (p) => { if (!event.sender.isDestroyed()) event.sender.send('nxm:progress', p); };

    activeDownload = { cancelled: false };
    send({ stage: 'download', percent: 0, received: 0, total: 0 });

    const r = await nxm.downloadToFile(chosen.uri, dest, {
      onProgress: (p) => send({ stage: 'download', ...p }),
      shouldCancel: () => !!(activeDownload && activeDownload.cancelled)
    });

    send({ stage: 'downloaded', size: r.size });

    return {
      path: r.path,
      size: r.size,
      total: r.total,
      filename: r.filename || chosen.name || '',
      link: { game: link.game, modId: link.modId, fileId: link.fileId }
    };
  });

  handle('nxm:cancel', () => {
    if (activeDownload) activeDownload.cancelled = true;
    return true;
  });

  /* ---------------- 下载管理（队列 / 自动安装 / 封面缓存） ---------------- */

  handle('download:list', () => ({ tasks: engine.list(), stats: engine.stats() }));

  /** 从浏览页 / 已安装页加入下载队列（等一次授权） */
  handle('download:enqueue', (meta) => {
    if (!meta || !meta.modId) throw new Error('缺少 Mod ID');
    const r = engine.enqueueNexus(meta);
    logger.event('download:enqueue', { modId: meta.modId, fileId: meta.fileId || null, duplicate: !!r.duplicate });
    broadcastDownloads(r.task);
    // 开关打开时，入队即自动授权（用户要的就是「不用逐条点」）
    if (r.task && !r.duplicate) maybeAutoAuthorize(r.task.id);
    return r;
  });

  /**
   * 自动授权（免点击）：用已登录会话直接向 Nexus 站内弹层端点要 nxm 链接。
   * 详见 `nexusAutoAuth.js` 的模块注释。
   */
  handleWithEvent('download:autoAuthorize', async (_event, id) => autoAuthorizeTask(id));
  /** 一键把队列里所有「等待授权」的任务都授权掉（串行 + 节流） */
  handleWithEvent('download:autoAuthorizeAll', async (_event, opts) => {
    const r = await autoAuthorizeAll(opts || {});
    broadcastDownloads(null);
    return r;
  });

  /** 本地压缩包导入到队列（直接下载态 + 自动安装） */
  handle('download:importLocal', (archivePath, meta, opts) => {
    const r = engine.enqueueLocal(archivePath, meta || {}, opts || {});
    broadcastDownloads(r.task);
    return r;
  });

  /**
   * 为某个任务打开 Nexus 安装助手（高亮下载按钮），把「手工找按钮」这一步也省掉。
   * 用户只需要在那一个高亮按钮上点一次，剩下全自动。
   */
  handleWithEvent('download:authorize', async (event, id) => {
    const t = engine.get(id);
    if (!t) throw new Error('未找到该下载任务');
    const modId = Number(t.meta && t.meta.modId);
    if (!modId) throw new Error('该任务缺少 Mod ID');
    const parent = BrowserWindow.fromWebContents(event.sender);
    const r = nexusBrowser.open({
      modId,
      fileId: Number(t.meta.fileId) || null,
      // 多文件 mod：横幅里点名要哪个文件，用户不用自己对照
      hint: (t.meta && t.meta.fileName)
        ? ('文件「' + t.meta.fileName + '」')
        : '',
      parent,
      onNxm: (url) => {
        const parsed = nxm.parseNxm(url);
        if (!parsed) return;
        handleIncomingNxm(parsed).catch(() => {});
      },
      onFile: (f) => {
        // 走 Manual → Slow download 这条路时，直接进队列安装
        try {
          const rr = engine.enqueueLocal(f.path, {
            ...(t.meta || {}),
            name: (t.meta && t.meta.name) || f.filename,
            fileName: f.filename
          });
          broadcastDownloads(rr.task);
        } catch (e) { console.error('[download] 本地导入失败：' + e.message); }
      },
      onProgress: (x) => sendDownloadProgress(id, x),
      onClosed: () => broadcastDownloads(null)
    });
    return { id, url: r.url, reused: r.reused };
  });

  handle('download:start', (id) => { const t = engine.retry(id); broadcastDownloads(t); return t; });
  handle('download:cancel', (id) => { const t = engine.cancel(id); broadcastDownloads(t); return t; });
  handle('download:confirmInstall', (id, opts) => { const t = engine.confirmInstall(id, opts); broadcastDownloads(t); return t; });

  /* ---- 2026-10-14 新增：暂停 / 全部停止 / 一键安装（默认选择） / 彻底删除 ---- */

  /** ⏸ 暂停单条：中止下载、保留半截文件，之后点「继续」接着下 */
  handle('download:pause', (id) => { const t = engine.pause(id); broadcastDownloads(t); return t; });
  /** ⏸ 全部停止：把正在跑的任务一次性暂停（口径同样是「暂停」，不是「取消」） */
  handle('download:pauseAll', () => { const r = engine.pauseAll(); broadcastDownloads(null); return r; });

  /**
   * 一键安装（默认选择）：每个互斥组取第一套 + 互不相关的全选。
   * 用户要求「不要手工一个一个确认」—— 单条与批量都走这条。
   */
  handleWithEvent('download:confirmDefault', async (_event, id) => {
    const t = await engine.confirmInstallDefault(id);
    broadcastDownloads(t);
    return t;
  });
  /** 批量：把所有「待确认」任务按默认选择装掉（串行 + 节流，带进度回推） */
  handleWithEvent('download:confirmAllDefault', async (_event, opts) => {
    const r = await confirmAllDefault(opts || {});
    broadcastDownloads(null);
    return r;
  });

  /**
   * 🗑 彻底删除：队列记录 + 安装包 + 半截下载 + 缓存图 + 授权凭据。
   * ⚠️ **不动游戏目录**（口径已与用户确认）—— 卸载归「已安装 Mod」页管。
   */
  handle('download:purge', (id) => { const r = engine.purge(id); broadcastDownloads(null); return r; });

  // 重新分析任务结构（老任务的 install.plan 可能缺 options 之类的后加字段）
  handle('download:plan', (id) => engine.planOf(id));
  /**
   * 重算所有卡在「待确认」的任务（安装规则升级后让老任务活过来）。
   * 只更新 plan 与原因，不自动安装 —— 装不装始终由用户点那一下决定。
   */
  handle('download:refreshPlans', async () => {
    const r = await engine.refreshUnknownPlans();
    broadcastDownloads(null);
    return r;
  });
  handle('download:remove', (id, opts) => { const r = engine.remove(id, opts); broadcastDownloads(null); return r; });

  /** 打开该任务归档所在文件夹 */
  handle('download:reveal', (id) => {
    const t = engine.get(id);
    if (!t || !t.archivePath) throw new Error('该任务还没有本地安装包');
    shell.showItemInFolder(t.archivePath);
    return true;
  });

  /**
   * 缓存某个 Mod 的图片（已安装页 / 详情页需要多张展示图时用）。
   *
   * `urls` 可选：给了就用给定的；没给就走图集抓取 → 官方 images 回落。
   * 返回最多 5 张「不同图片」的本地地址（同一张图的不同尺寸会被归并成一张）。
   */
  handle('mod:images', async (modId, urls, opts) => {
    const given = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (given.length) {
      const cached = await imageCache().cacheModImages(modId, given, opts || {});
      return (cached || []).filter(x => x && x.localUrl).map(x => ({
        localUrl: x.localUrl, url: x.url, path: x.path, mime: x.mime, size: x.size
      }));
    }
    return imagesForMod(modId, opts || {});
  });

  /* ---------------- 下载目录监听（手动下载兜底） ---------------- */

  handle('watch:status', () => ({
    enabled: config.get('watchDownloads') !== false,
    autoInstall: config.get('watchAutoInstall') !== false,
    running: !!(watcher && watcher.isRunning()),
    dirs: watcher ? watcher.getDirs() : watchDirs(),
    defaultDirs: defaultWatchDirs(),
    seen: watcher ? watcher.seenCount() : 0,
    mirror: config.get('githubMirror') || ''
  }));

  /** 开关监听 / 自动安装 / 镜像前缀 */
  handle('watch:set', (patch) => {
    const p = patch || {};
    const next = {};
    if ('enabled' in p) next.watchDownloads = !!p.enabled;
    if ('autoInstall' in p) next.watchAutoInstall = !!p.autoInstall;
    if ('mirror' in p) next.githubMirror = String(p.mirror || '').trim();
    if (Object.keys(next).length) config.set(next);

    if (watcher) {
      if (config.get('watchDownloads') !== false) { try { watcher.start(); } catch { /* 忽略 */ } }
      else watcher.stop();
    }
    logger.event('watch:config', next);
    return {
      enabled: config.get('watchDownloads') !== false,
      autoInstall: config.get('watchAutoInstall') !== false,
      running: !!(watcher && watcher.isRunning()),
      mirror: config.get('githubMirror') || ''
    };
  });

  /**
   * 添加监听目录。
   * 传了路径就直接用（自动化 / 恢复用）；没传就弹目录选择框。
   */
  handle('watch:addDir', async (explicit) => {
    let dir = explicit ? String(explicit) : null;
    if (!dir) {
      const r = await dialog.showOpenDialog({
        title: '选择要监听的下载目录',
        buttonLabel: '监听这个目录',
        properties: ['openDirectory', 'createDirectory']
      });
      if (r.canceled || !r.filePaths.length) return null;
      dir = r.filePaths[0];
    }
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { isDir = false; }
    if (!isDir) throw new Error('目录不存在：' + dir);

    const cur = watchDirs();
    if (!cur.some(d => path.resolve(d).toLowerCase() === path.resolve(dir).toLowerCase())) cur.push(dir);
    config.set({ watchDirs: cur });
    if (watcher) { watcher.setDirs(cur); if (config.get('watchDownloads') !== false) watcher.start(); }
    logger.event('watch:addDir', { dir, total: cur.length });
    return { dirs: cur };
  });

  handle('watch:removeDir', (dir) => {
    const cur = watchDirs().filter(d => path.resolve(d).toLowerCase() !== path.resolve(String(dir)).toLowerCase());
    config.set({ watchDirs: cur });
    if (watcher) { watcher.setDirs(cur); if (config.get('watchDownloads') !== false) watcher.start(); }
    return { dirs: cur };
  });

  /** 立即扫一次（会把现有压缩包当作「新发现」，适合刚打开开关时手动触发） */
  handle('watch:scanNow', () => {
    if (!watcher) return { found: 0 };
    const found = watcher.scanNow();
    return { found: found.length, items: found.map(f => ({ name: f.name, modId: f.modId })) };
  });

  /** 把当前目录里的压缩包全部记成「已见」，不再提示（清理存量噪音） */
  handle('watch:ignoreExisting', () => {
    if (!watcher) return { ignored: 0 };
    return { ignored: watcher.markAllSeen() };
  });

  /** 忘掉某个文件的记录，让它下次能被重新发现 */
  handle('watch:forget', (p) => ({ ok: !!(watcher && watcher.forget(p)) }));

  /* ---------------- 安装 Mod（压缩包 → 游戏目录） ---------------- */

  // 落点判定与注册表登记都在 installFlow.js（下载队列也要用同一套，避免两边漂移）

  handle('install:tools', () => archive.toolInfo());

  /**
   * 变体预览图：给「选择要安装哪些内容」对话框显示每套的封面。
   *
   * 很多变体包把**每套的预览图**放在包根级，文件名与目录名一一对应
   * （实测 mod 1430：`Cooling suit_A/` ↔ `Cooling Suit_A.jpg`）。
   * 不看图根本不知道哪套是什么颜色 —— 这是用户挑得动的前提。
   *
   * **永不抛**：拿不到图就返回 `{}`，界面照旧能用（只是没缩略图）。
   */
  handle('install:variantCovers', async (archivePath, dirs) => {
    if (!archivePath || !fs.existsSync(archivePath)) return {};
    try { return await variantCover.coversFor(archivePath, dirs); }
    catch (e) {
      logger.event('install:variantCoversFailed', { archive: archivePath, error: e.message });
      return {};
    }
  });

  /** 分析压缩包结构，返回安装计划（供界面展示确认） */
  handle('install:analyze', async (archivePath, meta, opts) => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录，请先到「设置」里指定');
    if (!archivePath || !fs.existsSync(archivePath)) throw new Error('安装包不存在：' + archivePath);
    const o = { ...(opts || {}) };
    // 「覆盖自己上一版」不算冲突（见 installer.js 冲突检测那段长注释）。
    // 渲染层不该关心注册表，所以这里在主进程侧自己算好传下去 ——
    // 否则手动安装抽屉里重装同一个 mod 会莫名其妙弹出「有 4 个文件会被覆盖」。
    if (!o.ownedPaths) {
      try { o.ownedPaths = installFlow.ownedPathsFor(registry, meta || {}); } catch { /* 忽略 */ }
    }
    const plan = await installer.analyze(root, archivePath, meta || {}, o);
    // 「会被覆盖的文件」清单（谁装的 / 是不是同一个 mod / 大小对比）——
    // 界面据此列出来并可点击定位，而不是只说一句「有 3 个文件会被覆盖」
    try { plan.conflictDetails = installFlow.explainConflicts(registry, root, plan, meta || {}); }
    catch { /* 拿不到清单不影响安装 */ }
    return plan;
  });

  /** 执行安装：重新分析一遍（不信任渲染层传来的计划），再解压复制并登记 */
  handleWithEvent('install:run', async (event, payload) => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录，请先到「设置」里指定');

    const p = payload || {};
    const meta = p.meta || {};
    logger.event('install:run', { archive: p.archivePath, name: meta.name, modId: meta.modId, fileId: meta.fileId });

    const send = (x) => { if (!event.sender.isDestroyed()) event.sender.send('install:progress', x); };

    const r = await installFlow.runInstall({
      root,
      archivePath: p.archivePath,
      meta,
      manualTarget: p.manualTarget,
      // 🔴 `pickDir` / `pickDirs` 都要透传（否则变体包在「重新分析」这一步失败）
      pickDir: p.pickDir,
      pickDirs: p.pickDirs,
      onConflict: p.onConflict === 'skip' ? 'skip' : 'overwrite',
      onProgress: send,
      onPlan: (plan) => logger.event('install:plan', {
        kind: plan.kind, target: plan.target, files: plan.fileCount,
        conflicts: plan.conflictCount, stripped: plan.strippedPrefix,
        // 同名 + 同大小的「软覆盖」不算冲突，但日志里要能看见 —— 排查
        // 「装完没变化」时一眼就知道「包里带的是和游戏里一模一样的底座」
        softOverwrite: plan.softOverwriteCount || 0,
        selfOverwrite: plan.selfOverwriteCount || 0
      }),
      registry,
      layout: game.layout(root)
    });

    logger.event('install:done', {
      id: r.id, kind: r.kind, written: r.written, skipped: r.skipped,
      backed: r.backedCount, backupFailed: r.backupFailed || 0
    });
    invalidateLocalIndex();

    const { plan, ...rest } = r;
    return rest;
  });

  /** 选一个本地压缩包（本地导入入口） */
  handle('install:pickArchive', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择 Mod 安装包',
      filters: [{ name: 'Mod 压缩包', extensions: ['zip', '7z', 'rar'] }],
      buttonLabel: '选择',
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  /** 结构无法识别时，让用户手动选一个落点 */
  handle('install:pickTarget', async () => {
    const root = currentRoot();
    const r = await dialog.showOpenDialog({
      title: '选择安装目标目录',
      defaultPath: root || undefined,
      buttonLabel: '装到这里',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  /* ---------------- 前置组件（框架类 Mod） ---------------- */

  /**
   * 前置组件清单 + 依赖检查结果。
   * 一键安装按钮的可用性由这里决定（例如 CNS 需要 UE4SS 先装好）。
   */
  handle('prereq:list', () => {
    const info = inspectGame();
    return prereqs.all().map(p => {
      const st = (info && info[p.key]) || null;
      const req = prereqs.checkRequires(info, p.key);
      return {
        key: p.key,
        name: p.name,
        fullName: p.fullName,
        desc: p.desc,
        kind: p.kind,
        modId: p.modId || null,
        fileId: p.fileId || null,
        version: p.version || null,
        pageUrl: p.pageUrl || p.releasesUrl || null,
        repo: p.repo || null,
        installed: !!(st && st.installed),
        // CNS 的确定性判定明细（特征文件清单 / 是否装了一半 / 判定是否可信）
        markers: (st && st.markers) || [],
        partial: !!(st && st.partial),
        confident: st ? st.confident !== false : false,
        companions: (st && st.companions) || [],
        note: (st && st.note) || null,
        target: p.target,
        targetHint: p.targetHint,
        requires: p.requires || [],
        requiresOk: req.ok,
        missing: req.missing,
        missingNames: req.missing.map(k => (prereqs.get(k) || {}).name || k),
        // nexus 走「内嵌安装助手」，github 走「直下」（UE4SS）
        installKind: p.kind,
        canAutoInstall: p.kind === 'nexus' || p.kind === 'github'
      };
    });
  });

  /**
   * UE4SS 最新 Release 信息（前置组件页显示「最新版 / 已是最新」用）。
   * 结果缓存 10 分钟 —— GitHub API 有匿名限流，不该每进一次页面就打一次。
   */
  handle('prereq:ue4ssInfo', async (force) => {
    const p = prereqs.get('ue4ss');
    const now = Date.now();
    if (!force && ue4ssReleaseCache.release && now - ue4ssReleaseCache.at < 10 * 60 * 1000) {
      return { ...ue4ssReleaseCache.release, cached: true };
    }
    const rel = await github.getLatestRelease(p.repo);
    const asset = github.pickAsset(rel.assets, {
      prefer: [/^UE4SS_v?[\d.]/i],
      avoid: [/^z/i, /dev/i, /customgameconfigs/i, /mapgen/i]
    });
    const out = {
      tag: rel.tag,
      name: rel.name,
      htmlUrl: rel.htmlUrl,
      publishedAt: rel.publishedAt,
      asset: asset ? { name: asset.name, size: asset.size, downloads: asset.downloadCount } : null,
      repo: p.repo,
      cached: false
    };
    ue4ssReleaseCache = { at: now, release: out };
    return out;
  });

  /**
   * 一键安装 UE4SS —— **不走 Nexus，直接下 GitHub Release**。
   *
   * 这条路比 CNS 简单得多：不需要用户在网页上点任何东西，全自动。
   * 下载走 github.js 的多通路策略（资产 API 优先，兼容 github.com 不可达的环境）。
   */
  handleWithEvent('prereq:installUe4ss', async (event) => {
    const p = prereqs.get('ue4ss');
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录，请先到「设置」里指定');

    const send = (x) => { if (!event.sender.isDestroyed()) event.sender.send('prereq:ue4ss-progress', x); };

    send({ stage: 'release', percent: 0 });
    const rel = await github.getLatestRelease(p.repo);
    const asset = github.pickAsset(rel.assets, {
      prefer: [/^UE4SS_v?[\d.]/i],
      avoid: [/^z/i, /dev/i, /customgameconfigs/i, /mapgen/i]
    });
    if (!asset) throw new Error('这个 Release 里没找到 UE4SS 的 zip 包，请到发布页手动下载');

    logger.event('prereq:ue4ss-install', { tag: rel.tag, asset: asset.name, size: asset.size });

    const dest = path.join(paths.TMP, 'ue4ss-' + rel.tag + '-' + asset.name);
    const mirror = config.get('githubMirror') || '';
    const dl = await github.downloadAsset({
      repo: p.repo,
      asset,
      dest,
      mirror,
      onProgress: (x) => send({ stage: 'download', ...x }),
      log: (m) => logger.event('github', { msg: m })
    });
    logger.event('prereq:ue4ss-downloaded', { tag: rel.tag, size: dl.size, source: dl.source });

    // 用户是**显式点了「一键安装」**才走到这里 → confirmed:true，
    // 跳过「覆盖冲突」门禁（重装/更新 UE4SS 必然覆盖现有文件，这是预期行为）。
    const r = engine.enqueueLocal(dl.path, {
      name: p.fullName || p.name,
      version: rel.tag,
      author: 'Chrisr0 / RE-UE4SS',
      url: rel.htmlUrl,
      fileSize: dl.size,
      isPrereq: true,
      prereqKey: 'ue4ss',
      // 注册表 id 对齐 scanner 的第 1) 步，否则「已安装」列表会同时出现
      // 「UE4SS」（builtin）和另一条同名条目
      registryId: 'builtin:ue4ss'
    }, { confirmed: true, from: 'prereq' });

    broadcastDownloads(r.task);
    return {
      tag: rel.tag, asset: asset.name, size: dl.size, source: dl.source,
      taskId: r.task && r.task.id
    };
  });

  /** 打开 UE4SS 发布页（一键安装失败时的退路：手动下载 → 下载目录监听自动导入） */
  handle('prereq:openReleases', () => {
    const p = prereqs.get('ue4ss');
    shell.openExternal(p.releasesUrl || ('https://github.com/' + p.repo + '/releases'));
    return true;
  });

  /**
   * 一键安装前置组件 —— 打开内嵌「安装助手」窗口。
   *
   * 为什么不是「点一下就直接下载」：
   *   Nexus 的免费下载**必须由用户在网页上点一次按钮**。两条路都支持：
   *     · `Mod Manager Download` → 签发 nxm:// 一次性链接（全程自动，但不是每个文件都有）
   *     · `Manual download` → 下一页 `Slow download` → 浏览器下载（通用，任何文件都能走）
   *   助手窗口会把该点的按钮**高亮出来**，并接管下载，把操作压缩成「点一下」。
   */
  handleWithEvent('prereq:install', (event, key) => {
    const p = prereqs.get(key);
    if (!p) throw new Error('未知的前置组件：' + key);
    if (p.kind === 'github') {
      throw new Error(p.fullName + ' 走 GitHub 直下，请用「一键安装 ' + p.name + '」按钮（不需要在网页上点任何东西）');
    }
    if (p.kind !== 'nexus') throw new Error(p.fullName + ' 暂不支持一键安装，请到发布页手动下载');

    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录，请先到「设置」里指定');

    const info = inspectGame();
    const req = prereqs.checkRequires(info, key);
    if (!req.ok) {
      const names = req.missing.map(k => (prereqs.get(k) || {}).name || k).join('、');
      throw new Error(p.fullName + ' 依赖 ' + names + '，请先安装它再回来');
    }

    const parent = BrowserWindow.fromWebContents(event.sender);
    const mainWin = () => BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && x.mainApp === true);
    const send = (ch, payload) => {
      const w = mainWin();
      if (w && !w.webContents.isDestroyed()) w.webContents.send(ch, payload);
    };

    logger.event('prereq:install', { key, modId: p.modId, fileId: p.fileId });

    const r = nexusBrowser.open({
      modId: p.modId,
      fileId: p.fileId,
      hint: p.hint,
      parent,

      // 通路 A：助手窗口里点中「Mod Manager Download」→ 直接进下载队列（全自动）
      onNxm: (url) => {
        const parsed = nxm.parseNxm(url);
        if (!parsed) return;
        const w = mainWin();
        if (w) { w.show(); w.focus(); }
        send('nxm:incoming', parsed);
        handleIncomingNxm(parsed).catch(() => {});
      },

      // 通路 B：助手窗口里走 Manual → Slow download → 主进程接管下载
      onProgress: (x) => send('prereq:download-progress', { key, ...x }),
      onFile: (f) => {
        logger.event('prereq:downloaded', { key, filename: f.filename, size: f.size, path: f.path });
        send('prereq:downloaded', {
          key,
          ...f,
          meta: {
            name: p.fullName || p.name,
            modId: p.modId,
            fileId: p.fileId,
            version: p.version || null,
            url: p.pageUrl || null,
            // ⚠️ 原先是硬编码的 'Dekita / CNS'（当时只有 CNS 走这条路）。
            //    现在 ATOOL 也走同一条通道，作者必须跟着 PREREQS 走，否则会显示成 CNS 的作者。
            author: p.author || null,
            isPrereq: true
          }
        });
      },

      onClosed: () => send('prereq:assistant-closed', { key })
    });

    return { key, modId: p.modId, fileId: p.fileId, url: r.url, reused: r.reused };
  });

  handle('prereq:closeAssistant', () => { nexusBrowser.close(); return true; });

  /* Nexus 浏览 */
  // 列表结果挂上本地状态（已安装 / 已下载）—— 状态在**主进程事后装饰**，
  // 不进 nexus.js 的页面缓存，这样同一页数据仍可复用缓存，但状态永远是最新的。
  handle('nexus:list', async (opts) => {
    const page = await nexus.listMods(opts || {});
    return { ...page, items: localState.decorateMods(page.items, localIndex()) };
  });
  // 局部查状态：安装完成后只刷新受影响的那几张卡片，不用重载整页
  handle('nexus:localState', (modIds) => localState.stateMap(modIds, localIndex(true)));
  handle('nexus:facets', (opts) => nexus.getFacets(opts || {}));

  /* 浏览页黑名单（用户点了「不喜欢」的 mod）—— 纯本地，不走 Nexus。
     ⚠️ add 的 meta 里带上 name / author / thumbnail，是为了让「只看黑名单」
        能**离线渲染卡片**（否则要翻遍 3000+ 个 mod 才凑得出那几条）。 */
  handle('blacklist:list', () => blacklist.all());
  handle('blacklist:ids', () => blacklist.ids());
  handle('blacklist:add', (modId, meta) => blacklist.add(modId, meta || {}));
  handle('blacklist:remove', (modId) => blacklist.remove(modId));
  /* 浏览页「喜欢」（👍）—— 与黑名单同形、同为纯本地。
     用户 2026-10-14：「mod 图标上增加喜欢按钮，与不喜欢对应」。 */
  handle('favorites:list', () => favorites.all());
  handle('favorites:ids', () => favorites.ids());
  handle('favorites:add', (modId, meta) => favorites.add(modId, meta || {}));
  handle('favorites:remove', (modId) => favorites.remove(modId));
  handle('nexus:detail', (modId) => nexus.getMod(modId));
  handle('nexus:files', (modId) => nexus.getModFiles(modId));
  handle('nexus:parseUrl', (url) => parseNexusUrl(url));
  handle('nexus:clearCache', () => { nexus.clearCache(); return true; });

  /* 翻译 */
  handleWithEvent('translate:text', (event, text, lang) =>
    translator.translate(text, lang, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('translate:progress', p);
    }));
  handle('translate:stats', () => translator.stats());
  handle('translate:clear', () => { translator.clear(); return true; });
}

module.exports = { register, handleIncomingNxm };
