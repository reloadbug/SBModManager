'use strict';
const { ipcMain, shell, app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const paths = require('./paths');
const logger = require('./logger');
const game = require('./game');
const gameLaunch = require('./gameLaunch');
const crashLog = require('./crashLog');
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
const linker = require('./linker');
const reconcile = require('./reconcile');
const toggleName = require('./toggleName');
const localLibrary = require('./localLibrary');
const fsMove = require('./fsMove');
const relocate = require('./relocate');
const fsError = require('./fsError');
const gameVersion = require('./gameVersion');
const { createBlacklist } = require('./blacklist');
const { createBugFlags } = require('./bugFlag');
const { createVerified } = require('./verified');
const { createFavorites } = require('./favorites');
const { createModHistory } = require('./modHistory');
const { createFileOwner, indexLibrary: indexOwnersFromLibrary, indexPlan: indexOwnerFromPlan } = require('./fileOwner');
const { attachOwners } = require('./attachOwners');
const archive = require('./archive');
const nexusBrowser = require('./nexusBrowser');
const nexusAutoAuth = require('./nexusAutoAuth');
const prereqs = require('./prereqs');
const github = require('./github');
const { createDownloadWatcher, parseNexusFileName } = require('./downloadWatcher');
const { createGalleryFetcher } = require('./nexusGallery');
const { createImageCache } = require('./imageCache');
const variantCover = require('./variantCover');
const dataMigrate = require('./dataMigrate');
const gameHome = require('./gameHome');
const { createModInfo, fromCatalog } = require('./modInfo');
const modConflicts = require('./modConflicts');
const libraryMigrate = require('./libraryMigrate');
const { readJson, writeJson, setMirror } = require('./store');

let config, registry, nexus, translator, engine, watcher, gallery, blacklist, favorites, bugFlags, verifiedFlags, modHistory, fileOwner;

/** UE4SS 最新 Release 的短时缓存（避免每次进前置组件页都打 GitHub API） */
let ue4ssReleaseCache = { at: 0, release: null };

/** 安装包目录搬家：当前正在跑的任务（含取消信号），同一时刻只允许一个 */
let migrateJob = null;

/** 图片缓存单例：图集归并与「多尺寸只留一张」的逻辑都在里面，别每次调用新建 */
let imageCacheSingleton = null;
function imageCache() {
  if (!imageCacheSingleton) imageCacheSingleton = createImageCache({ imagesDir: paths.IMAGES });
  return imageCacheSingleton;
}

/** Mod 基本信息档案的单例（一条一个 JSON，见 modInfo.js） */
let modInfoSingleton = null;
/** modId → { url, at }：本地封面地址的短缓存（见 images:covers） */
const coverCache = new Map();

function modInfoStore() {
  if (!modInfoSingleton) modInfoSingleton = createModInfo();
  return modInfoSingleton;
}

/**
 * 封面预热：档案里有图地址、但本地还没存过图的，慢慢存一份。
 *
 * 为什么要专做一件事：档案里的 pictureUrl 指向 Nexus 的 CDN，
 * 卡片拿去用就等于每次打开列表都从网上下一次 —— 用户的诉求是
 * 「关联过就全在本地」，所以这里把封面也搬下来，搬完档案里记下路径。
 * 一次最多 3 张、同一张不重复尝试，失败就下次再说（不打扰用户）。
 */
const coverWarmTried = new Set();
/** 本进程里已经排过队去补信息的包（避免每次列目录都重问同一批） */
const libraryWarmTried = new Set();
function warmCovers(recs) {
  const todo = (recs || [])
    .filter(r => r && r.modId && r.pictureUrl && !r.coverFile && !coverWarmTried.has(Number(r.modId)))
    .slice(0, 3);
  for (const rec of todo) {
    const id = Number(rec.modId);
    coverWarmTried.add(id);
    (async () => {
      try {
        const cached = await imageCache().cacheModImages(id, [rec.pictureUrl], { limit: 1 });
        const hit = (cached || []).find(x => x && x.path);
        if (hit) modInfoStore().put({ modId: id, coverFile: hit.path });
      } catch { /* 抓不到就下次 */ }
    })();
  }
}

/**
 * 目录缓存的 modId → 条目倒排表。
 * 「已下载 / 已安装」卡片要的名字、作者、版本、摘要、封面全在目录里，
 * 有了这张表就不用为了显示一张卡去问 Nexus（问一次要几百毫秒 + 一个配额）。
 */
let catalogByIdCache = { key: -1, map: null };
function catalogById() {
  let fetchedAt = 0;
  let mods = [];
  try {
    const c = linker.readCatalog(paths.nexusCatalog);
    if (c) {
      fetchedAt = Number(c.fetchedAt) || 0;
      mods = c.mods || [];
    }
  } catch { /* 目录没抓过就只能是空表 */ }
  if (catalogByIdCache.map && catalogByIdCache.key === fetchedAt) return catalogByIdCache.map;
  const map = new Map(mods.map(m => [Number(m.modId), m]));
  catalogByIdCache = { key: fetchedAt, map };
  return map;
}

/**
 * 取若干 Mod 的基本信息 —— **只读本地，一个网络请求都不发**。
 * 顺序：先看档案（cache/mod-info/<modId>.json）→ 再看 Nexus 目录缓存（3169 条，
 * 早就抓下来了）→ 顺手把目录里那条落成档案，下次连目录都不用翻。
 */
async function infoLocal(ids) {
  const want = (Array.isArray(ids) ? ids : []).map(Number).filter(n => n > 0);
  const out = {};
  if (!want.length) return out;
  const store = modInfoStore();
  const cat = catalogById();
  for (const id of want.slice(0, 500)) {
    let rec = store.get(id);
    const entry = cat.get(id);
    // 老档案只存过名字/作者/封面；分类、点赞数、更新时间、说明是后来加的字段，
    // 目录里有就顺手补齐并落盘 —— 下次纯本地也带得出来。
    if (entry && (!rec || !rec.category || !rec.categoryZh || !rec.updatedAt
      || !rec.endorsements || !rec.description)) {
      const merged = fromCatalog(entry);
      if (rec) merged.description = rec.description || merged.description;
      if (rec) merged.descriptionZh = rec.descriptionZh || '';
      // CNS 元数据（游戏内名称等）是纯本地解析出来的，目录里没有 —— 合并必须保住
      if (rec) {
        if (Array.isArray(rec.gameNames) && rec.gameNames.length) merged.gameNames = rec.gameNames;
        if (Array.isArray(rec.uniqueFitIds) && rec.uniqueFitIds.length) merged.uniqueFitIds = rec.uniqueFitIds;
        if (Array.isArray(rec.meshes) && rec.meshes.length) merged.meshes = rec.meshes;
      }
      rec = store.put(merged);
    }
    if (!rec) continue;
    out[id] = { ...rec, coverLocal: store.coverUrlOf(rec) };
  }
  // 顺手把「有图地址、本地还没存」的封面搬下来（只挑 3 张，不挡这一轮返回）
  try { warmCovers(Object.values(out)); } catch { /* 预热失败不影响返回 */ }
  return out;
}

/**
 * 补档案：只对「本地还没有」的 id 去问 Nexus，问到立刻落盘、封面存进图片缓存。
 * 一次最多 6 个（界面是滚到哪补到哪），避免一屏几百个包把接口打爆。
 * 已经齐了的 id 直接回档案，不发请求。
 */
async function infoFill(ids) {
  const want = (Array.isArray(ids) ? ids : []).map(Number).filter(n => n > 0).slice(0, 6);
  const out = {};
  const store = modInfoStore();
  for (const id of want) {
    const old = store.get(id);
    if (old && old.name && old.pictureUrl && old.description) {
      out[id] = { ...old, coverLocal: store.coverUrlOf(old) };
      continue;
    }
    let d = null;
    try { d = await nexus.getMod(id); } catch { d = null; }
    if (!d) continue;
    const pictureUrl = String(d.pictureUrl || d.image || '').trim();
    let coverFile = (old && old.coverFile) || '';
    if (pictureUrl) {
      try {
        const cached = await imageCache().cacheModImages(id, [pictureUrl], { limit: 1 });
        const hit = (cached || []).find(x => x && x.path);
        if (hit) coverFile = hit.path;
      } catch { /* 图挂了就只存文字信息，卡片回落 https 直连 */ }
    }
    const rec = store.put({
      modId: id,
      name: d.name || '',
      author: d.author || '',
      version: d.version || '',
      summary: d.summary || '',
      description: d.description || d.descriptionText || (old && old.description) || '',
      descriptionHtml: d.descriptionHtml || (old && old.descriptionHtml) || '',
      pictureUrl,
      url: d.url || '',
      adult: !!d.adult,
      coverFile,
      source: 'nexus'
    });
    if (rec) out[id] = { ...rec, coverLocal: store.coverUrlOf(rec) };
  }
  return out;
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

  const shape = list => (list || [])
    .filter(x => x && x.localUrl)
    .map(x => ({ localUrl: x.localUrl, url: x.url, path: x.path, mime: x.mime, size: x.size }));

  /*
   * 磁盘优先（0.4.9）。
   *
   * 用户 2026-11-09：「已经显示的图集要保存到本地……已经缓存了图片的就不要再下载一次了」。
   * 改动前这里一上来就问图集抓取器：它按 7 天 TTL 缓存**页面上的 URL 列表**，
   * 过期就开隐藏窗口重新抓 mod 页 —— 于是已安装 / 已下载的详情每次打开都可能
   * 先转一圈 spinner，还白跑一次网络，哪怕图片文件明明已经在 `data/cache/images` 里。
   *
   * 现在：磁盘上有几张就用几张；只有一张都没有（或用户点了「刷新图集」传 force）
   * 才去抓。`diskOnly` 是给渲染层「只读本地、绝不联网」用的。
   */
  let local = [];
  try { local = await imageCache().listCached(id); } catch { local = []; }
  if (local.length && !opts.force) return shape(local);
  if (opts.diskOnly) return shape(local);

  /*
   * 先问 Mod 记录，再问图集抓取器（2026-11-09 调整顺序）。
   *
   * `nexus.getMod()` 是一次 GraphQL 请求，几百毫秒，图片地址本来就在记录里；
   * 图集抓取器要开隐藏窗口翻 mod 页面，慢的时候十几秒。原来把它放在前面，
   * 于是「本地没缓存过」的 Mod 点开详情，图集区会一直转圈（用户反馈的
   * 「已经有图的 mod 点开详情还是在不停加载」）。现在先用记录里的图落盘，
   * 抓取器只在记录里一张图都没有时才兜底。
   */
  let urls = [];
  try { urls = ((await nexus.getMod(id)) || {}).images || []; } catch { urls = []; }
  if (!urls.length && gallery) {
    try {
      const list = await gallery.getImages(id, opts);
      urls = (list || []).map(x => (typeof x === 'string' ? x : x && x.url)).filter(Boolean);
    } catch { urls = []; }
  }
  if (!urls.length) return [];
  let cached = [];
  try { cached = await imageCache().cacheModImages(id, urls, opts); } catch { cached = []; }
  return shape(cached);
}

/**
 * 老注册表没有 enabledAt（0.5.2 之前的记录）——但「安装时就是启用的」，
 * 所以 installedAt 就是它的启用时刻。只补 enabled 且缺 enabledAt 的条目，
 * 并打上 enabledAtGuess，界面上据此说明「时间是按安装时间推的」。
 */
function backfillEnabledAt() {
  let pairs = [];
  try {
    for (const m of registry.all()) {
      if (!m || !m.enabled || m.enabledAt) continue;
      const at = m.installedAt || '';
      if (!at) continue;
      pairs.push({ id: m.id, patch: { enabledAt: at, enabledAtGuess: true } });
    }
  } catch { return 0; }
  if (!pairs.length) return 0;
  try { registry.patchMany(pairs); } catch { return 0; }
  try { logger.event('mods:backfillEnabledAt', { count: pairs.length }); } catch { /* 忽略 */ }
  return pairs.length;
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
  bugFlags = createBugFlags(paths.bugsFile);
  verifiedFlags = createVerified(paths.verifiedFile);
  modHistory = createModHistory(paths.modHistoryFile);
  fileOwner = createFileOwner(paths.modOwnerFile);
  backfillEnabledAt();
  // 归属表第一次是空的：拿本地安装包补一遍（后台跑，不挡启动）
  ensureFileOwners();

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

  // 数据跟着游戏走：记下游戏目录、第一次见到就把状态铺进 `<游戏根>\.sbmod`、
  // 之后每次写盘都镜像一份（下次启动就直接用游戏目录里那份）
  initGameHome();

  // 没有有效游戏目录就**什么都不做**：不 seed、不探测、不搬、不写指针。
  // 这里曾是「拿 candidates[0] 当默认值」的温床 —— 2026-11-22 静默换到 D 盘旧副本
  // 并 seed 出空 .sbmod 就是那条隐形回退干的。现在只记一条日志，等用户去设置里选。
  if (!currentRoot()) {
    try {
      const ptr = paths.readPointer();
      logger.event('game:noRoot', {
        configured: config.get('gameRoot') || '',
        pointer: typeof ptr.gameRoot === 'string' ? ptr.gameRoot.trim() : ''
      });
    } catch { /* 日志失败不影响启动 */ }
  }

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
      id, modId, fileId, code, rawCode: r.code, reason: r.reason, via: r.via || null, snippet: r.snippet || null
    });
    return { ok: false, code, reason, taskId: id };
  }

  // 弹层里那个 <h2> 就是文件名 —— 队列卡片能显示得更准
  const info = { ...r.info };
  if (r.fileName && !(t.meta && t.meta.fileName)) info.fileName = r.fileName;
  const task = await handleIncomingNxm(info);
  logger.event('download:autoauth', { id, modId, fileId, taskId: task && task.id, via: r.via || 'fetch' });
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
    try { scanned = scanAll(root); } catch (e) {
      console.error('[浏览] 扫描本地 Mod 失败：' + e.message);
    }
  }

  let tasks = [];
  try { tasks = engine.list(); } catch { /* 队列读不出来就只按已安装算 */ }

  // 安装包库也要算进来：下载记录能删，包不能凭空消失
  // （2026-11-09：用户清过「已完成记录」，浏览页又把本地已有的包显示成「⬇ 下载」）
  let library = [];
  try {
    library = localLibrary.scan({
      dir: paths.LIBRARY,
      root,
      entries: registry.all(),
      tasks
    }).items;
  } catch { /* 库目录读不出来就当没有 */ }

  const index = localState.buildLocalIndex({ scanned, tasks, library });
  localIdxCache = { at: now, index };
  return index;
}

/** 安装 / 卸载 / 下载状态变化后主动失效，别让界面显示上一个状态 */
function invalidateLocalIndex() { localIdxCache = { at: 0, index: null }; }

/* ---------------- 游戏目录搬移：账本跟着游戏走 ----------------
 *
 * 场景（用户实测 2026-11-07）：整个游戏文件夹从 `D:\games\Star Blade` 挪到
 * `c:\Star Blade`，注册表里 324 条记录的绝对路径全部失效 → 扫描时按落点反查
 * 全部落空 → 已安装页 429 项退化成「未登记」，来源/版本/封面全丢。
 *
 * 应对分两层：
 *   ① 路径能精确重建（target 尾巴 + manifest.rel 都是相对路径），对得上就静默改回来；
 *   ② 账本额外存一份到 `<游戏根>\.sbmod\ledger.json`，跟着游戏文件夹一起被搬走，
 *      换机器/重装管理器都能从它恢复。
 */

/* ---------------- 数据跟着游戏走 ----------------
 *
 * `<游戏根>\.sbmod\` 里存的是「状态」（config / mods / mod-links / blacklist /
 * favorites / downloads / watch-seen / ledger），缓存与日志仍留在管理器目录。
 * 详见 `gameHome.js` 的文件头；启动时若那儿已经有 config.json，`paths` 会直接用它。
 */

/**
 * 记下游戏目录 + 第一次见到它时把当前状态铺进去 + 挂上「每次写盘都镜像一份」的钩子。
 * 幂等，可以反复调用（启动一次、换游戏目录再一次）。
 */
function initGameHome(root) {
  const r = root || currentRoot();
  try {
    if (!r) return { ok: false, reason: 'no-game-root' };
    const seeded = gameHome.seed(r, paths.DATA);
    paths.setGameRootHint(r);
    setMirror((file, data) => gameHome.mirror(r, file, data));
    if (seeded.copied.length) {
      logger.event('data:gameHomeSeeded', { dir: seeded.dir, copied: seeded.copied, failed: seeded.failed.length });
    }
    return {
      ok: true,
      dir: seeded.dir,
      copied: seeded.copied,
      failed: seeded.failed,
      dataSource: paths.DATA_SOURCE,
      isGameHome: seeded.dir.toLowerCase() === String(paths.DATA).toLowerCase()
    };
  } catch (e) {
    logger.warn('[数据] 初始化游戏目录数据失败：' + e.message);
    return { ok: false, reason: e.message };
  }
}

/** 把账本同步一份到游戏目录。失败不抛 —— 附加保险不能拖累安装主流程 */
function syncLedger(root) {
  const r = root || currentRoot();
  if (!r) return null;
  try {
    const led = relocate.toLedger(registry.all(), r, { app: app.getVersion() });
    const file = relocate.writeLedger(r, led);
    return { file, count: led.mods.length, writtenAt: led.writtenAt };
  } catch (e) {
    console.error('[搬移] 写游戏目录账本失败：' + e.message);
    logger.event('game:ledgerFailed', { error: e.message });
    return null;
  }
}

/** 试算：注册表整体对齐到当前游戏目录（只算，不动文件也不动注册表） */
function relocationPlan(root) {
  const plan = relocate.planMigration(registry.all(), root);
  return {
    oldRoot: plan.oldRoot,
    newRoot: plan.newRoot,
    total: plan.total,
    fixable: plan.fixable,
    missing: plan.missing,
    unchanged: plan.unchanged,
    files: plan.files,
    entries: plan.entries.filter(e => e.state !== 'same'),
    patches: plan.patches
  };
}

/** 落实试算结果，并把账本重写到游戏目录 */
function applyRelocation(root) {
  const plan = relocationPlan(root);
  if (!plan.patches.length) { syncLedger(root); return { ...plan, applied: 0 }; }
  const applied = registry.patchMany(plan.patches);
  invalidateLocalIndex();
  logger.event('game:relocated', { from: plan.oldRoot, to: plan.newRoot, applied, files: plan.files });
  syncLedger(root);
  return { ...plan, applied };
}

/**
 * 启动时自动对齐 —— 用户要的「游戏怎么搬都不影响已安装识别」。
 *
 * 顺序讲究：
 *   1) 注册表空、游戏目录里有账本 → 先把账本导进来（换机器 / 重装管理器）；
 *   2) 还有可对齐的条目 → 静默改路径（**只改新位置文件确实存在的那些**）；
 *   3) 最后把账本重写一份，让两份保持一致。
 */
function autoRelocate(root) {
  const out = { imported: 0, applied: 0, fixable: 0, missing: 0, oldRoot: '', ledger: null };
  if (!root) return out;
  try {
    if (!registry.all().length) {
      const led = relocate.readLedger(root);
      if (led) {
        const merged = relocate.mergeLedger(registry.all(), led, root);
        out.imported = registry.addMany(merged.add);
        if (out.imported) logger.event('game:ledgerImported', { count: out.imported, file: led.file });
      }
    }
    const plan = applyRelocation(root);
    out.applied = plan.applied;
    out.fixable = plan.fixable;
    out.missing = plan.missing;
    out.oldRoot = plan.oldRoot || '';
    out.ledger = syncLedger(root);
  } catch (e) {
    console.error('[搬移] 自动对齐失败：' + e.message);
    logger.event('game:relocateFailed', { error: e.message });
  }
  return out;
}


/* ---------------- 批量解析：本地 Mod ↔ Nexus 关联 ---------------- */

/**
 * 读一份关联记录（只读视图）。
 *
 * 每次扫描都重新读文件：一份记录只有几百字节/条，换来「改完立刻生效」，
 * 比在内存里维护副本、再想办法保证两处一致要省心得多。
 * 读不出来（文件损坏 / 权限）就当没有关联，绝不让整个扫描挂掉。
 */
function linkReaderSafe() {
  try {
    return linker.linkReader(paths.modLinksFile);
  } catch (e) {
    console.error('[批量解析] 读取关联记录失败：' + e.message);
    return null;
  }
}

/**
 * 一次完整扫描：磁盘扫描 + 按「文件归属表」补挂。
 *
 * 为什么要多这一步：`scanner.scanPaks()` 只按「名字像不像」把 CNS 数据文件挂到 pak 组上
 * （Dice ≥ 0.8）。像 `Bayonetta.dekcns.json` ↔ `Bayonetta_P [nx2439]` 这种能凑上，
 * 但 `AuRaSphere-UndressableBlueMonsoon.dekcns.json` ↔ `43_UndressableMonsoon_P` 就凑不上，
 * 于是那几十个数据文件变成「盘上有、界面上看不见」—— 开关不跟、卸载不清。
 * 现在拿安装包反推出的归属（`fileOwner.js`）补挂，依据是「这个文件出自哪个安装包」，
 * 不是猜名字，所以可靠得多。补挂失败绝不能让整次扫描挂掉。
 */
function scanAll(root) {
  const list = scanner.scan(root, registry, linkReaderSafe());
  try {
    if (fileOwner) attachOwners(list, fileOwner, game.layout(root).modsDir);
  } catch (e) {
    console.error('[归属表] 补挂失败：' + e.message);
  }
  return list;
}

/** 归属表建过没有：一次扫库要读几百个压缩包，只在空表时自动跑一次，之后手动触发 */
let ownersIndexing = null;
async function ensureFileOwners(opts = {}) {
  if (!fileOwner) return { ok: false, why: '归属表没初始化' };
  try {
    if (!opts.force && fileOwner.stats().mods > 0) return { ok: true, skipped: true, ...fileOwner.stats() };
    if (ownersIndexing) return ownersIndexing;
    ownersIndexing = (async () => {
      try {
        const r = await indexOwnersFromLibrary(fileOwner, paths.LIBRARY, {
          archive,
          parseName: localLibrary.parseArchiveName,
          modIds: Array.isArray(opts.modIds) ? new Set(opts.modIds) : null
        });
        const st = fileOwner.stats();
        logger.event('mods:ownersIndexed', {
          archives: r.archives, read: r.read, entries: r.entries,
          added: r.added, changed: r.changed, failed: r.failed.length,
          files: st.files, mods: st.mods
        });
        return { ok: true, ...r, files: st.files, mods: st.mods };
      } catch (e) {
        console.error('[归属表] 扫库失败：' + e.message);
        return { ok: false, error: e.message };
      } finally {
        ownersIndexing = null;
      }
    })();
    return await ownersIndexing;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 目录缓存的倒排索引（3164 条建一次要几十毫秒，不能每条 mod 重建一次） */
let catalogIdxCache = { key: '', index: null };
function catalogIndex(mods) {
  const key = mods.length + ':' + ((mods[0] && mods[0].modId) || 0);
  if (catalogIdxCache.index && catalogIdxCache.key === key) return catalogIdxCache.index;
  const index = linker.buildIndex(mods);
  catalogIdxCache = { key, index };
  return index;
}

/** 关联状态：目录缓存有没有、什么时候抓的、已经关联了多少条 */
function linkState() {
  let catalog = null;
  try {
    const c = linker.readCatalog(paths.nexusCatalog);
    if (c) catalog = { count: c.mods.length, fetchedAt: c.fetchedAt, stale: !!c.stale };
  } catch (e) {
    console.error('[批量解析] 读取 Nexus 目录缓存失败：' + e.message);
  }
  const reader = linkReaderSafe();
  const links = reader ? reader.all() : [];
  return { catalog, links, count: links.length };
}

/** 同时只允许跑一个解析任务（抓 3164 条目录要几十秒，点了两次会很惨） */
let linkingJob = null;

/**
 * 挑出「值得解析」的条目：
 * 磁盘上发现的（`registered === false`）、不是前置组件、还没关联过的。
 * 内置 UE4SS / CNS 这类框架条目跳过 —— 它们不在 Nexus 上，问了也是浪费。
 */
function linkTargets(list) {
  return list.filter(m => {
    if (m.registered || m.linked || m.builtin) return false;
    if (m.kind === 'prereq' || String(m.id).startsWith('builtin:')) return false;
    return true;
  });
}

/**
 * 解析主体：抓目录 → 逐条打分 → 返回复核列表（**不落盘**）。
 *
 * 之所以不直接写关联：330 条里必然有错的，用户必须能先看一遍再决定。
 * 落盘是 `linker:apply` 的事，前端只把用户确认过的条目交回来。
 */
async function resolveLinks(event, opts = {}) {
  const root = currentRoot();
  if (!root) throw new Error('尚未配置有效的游戏目录');
  if (linkingJob) throw new Error('已经有一个解析任务在跑，等它结束再来');

  const send = (p) => {
    if (event && event.sender && !event.sender.isDestroyed()) event.sender.send('linker:progress', p);
  };

  linkingJob = { cancelled: false };
  const job = linkingJob;
  const startedAt = Date.now();

  try {
    // 1) Nexus 目录：7 天内复用缓存，过期才重新抓（40 页 ≈ 50 秒）
    send({ phase: 'catalog', loaded: 0, total: 0, page: 0 });
    let cat;
    try {
      cat = await linker.loadCatalog({
        file: paths.nexusCatalog,
        nexus,
        force: !!opts.force,
        shouldStop: () => job.cancelled,
        onProgress: (p) => send({ phase: 'catalog', ...p })
      });
    } catch (e) {
      throw new Error('获取 Nexus Mod 目录失败：' + e.message);
    }
    if (job.cancelled) return { cancelled: true, results: [], total: 0 };

    const mods = (cat && cat.mods) || [];
    if (!mods.length) throw new Error('Nexus 目录是空的，检查网络或 API Key');

    // 2) 本地待解析条目
    const list = scanAll(root);
    const targets = linkTargets(list);
    const index = catalogIndex(mods);

    // 3) 逐条打分（纯本地计算，不花请求）
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      if (job.cancelled) break;
      const m = targets[i];
      // `tag` 是文件名里管理器写下的 `[nx<modId>]`（见 modTag.js）：
      // 有它就走直配，不再猜名字 —— 这是唯一 100% 准的信号。
      const r = linker.suggestFor({ id: m.id, name: m.name, kind: m.kind, tag: m.tag }, index);
      results.push({
        localId: m.id,
        localName: m.name,
        kind: m.kind,
        location: m.location,
        size: m.size,
        fileCount: m.fileCount,
        normalized: r.normalized,
        best: r.best || null,
        candidates: r.candidates || [],
        ambiguous: !!r.ambiguous,
        thin: !!r.thin,
        tagged: !!r.tagged
      });
      if (i % 10 === 0 || i === targets.length - 1) {
        send({ phase: 'match', done: i + 1, total: targets.length });
      }
    }

    // 4) 分级统计（前端要拿这个决定「一键接受」能接受几条）
    const stats = { high: 0, medium: 0, low: 0, none: 0 };
    for (const r of results) {
      if (!r.best) stats.none++;
      else if (stats[r.best.confidence] !== undefined) stats[r.best.confidence]++;
      else stats.low++;
    }

    logger.event('linker:resolve', {
      targets: targets.length, ...stats, ms: Date.now() - startedAt
    });

    return {
      cancelled: !!job.cancelled,
      total: targets.length,
      results,
      stats,
      catalog: { count: mods.length, fetchedAt: cat.fetchedAt, fromCache: !!cat.fromCache },
      ms: Date.now() - startedAt
    };
  } finally {
    linkingJob = null;
  }
}

/** 把用户确认过的条目写成关联（顺带把封面抓到本地，卡片马上就有图） */
async function applyLinks(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { applied: 0, links: [] };

  const file = paths.modLinksFile;
  let cat = null;
  try { cat = linker.readCatalog(paths.nexusCatalog); } catch { cat = null; }
  const byId = new Map(((cat && cat.mods) || []).map(m => [Number(m.modId), m]));

  const applied = [];
  for (const e of list) {
    const localId = String((e && e.localId) || '').trim();
    const modId = Number(e && e.modId);
    if (!localId || !Number.isFinite(modId) || modId <= 0) continue;

    // 详情优先用本地目录（离线、不耗配额）；目录里没有才去问 API
    let info = byId.get(modId) || null;
    if (!info) {
      try { info = await nexus.getMod(modId); } catch { info = null; }
    }
    if (!info) continue;

    const pictureUrl = String(e.pictureUrl || info.pictureUrl || info.image || '').trim();

    // 封面存一份到本地图片缓存：失败不影响关联本身
    let image = '';
    let coverFile = '';
    if (pictureUrl) {
      try {
        const cached = await imageCache().cacheModImages(modId, [pictureUrl], { limit: 1 });
        const hit = (cached || []).find(x => x && x.localUrl);
        if (hit) { image = hit.localUrl; coverFile = hit.path || ''; }
      } catch { /* 图挂了就挂着，卡片会回落到 https 直连 */ }
    }

    /*
     * 关联成功就把这条信息落成档案：以后列表、详情、离线时全用本地的，
     * 不必为了「显示一下名字和封面」再问一遍 Nexus。
     */
    try {
      const rec = modInfoStore().put({
        modId,
        name: String(e.name || info.name || '').trim(),
        author: info.author || '',
        version: info.version || '',
        summary: info.summary || '',
        description: info.description || info.descriptionText || '',
        pictureUrl,
        url: info.url || ('https://www.nexusmods.com/stellarblade/mods/' + modId),
        adult: !!info.adult,
        coverFile,
        source: byId.has(modId) ? 'catalog' : 'nexus'
      });
      if (rec && !image) image = modInfoStore().coverUrlOf(rec);
    } catch { /* 档案写不进去不影响关联本身 */ }

    const link = {
      modId,
      name: String(e.name || info.name || '').trim(),
      author: info.author || '',
      version: info.version || '',
      summary: info.summary || '',
      pictureUrl,
      image,
      url: info.url || ('https://www.nexusmods.com/stellarblade/mods/' + modId),
      updatedAt: info.updatedAt || null,
      confidence: (e.confidence || 'manual'),
      score: Number.isFinite(Number(e.score)) ? Number(e.score) : null,
      matchedBy: e.matchedBy || 'manual',
      at: Date.now(),
      localId
    };
    linker.putLink(file, localId, link);
    applied.push(link);
  }

  invalidateLocalIndex();
  logger.event('linker:apply', { count: applied.length });
  return { applied: applied.length, links: applied };
}

/** 解除一条关联（本地文件一个都不动，只是忘掉「它是哪个 Nexus mod」） */
function unlinkLocal(localId) {
  const id = String(localId || '').trim();
  if (!id) throw new Error('缺少要解除关联的条目');
  const removed = linker.removeLink(paths.modLinksFile, id);
  invalidateLocalIndex();
  return { removed: removed ? 1 : 0, localId: id };
}

/**
 * 手动搜索候选。
 *
 * 先用本地目录（免费、即时）；目录还没抓过就退回官方搜索接口
 * （代价是一次请求，但只有用户主动搜的时候才发生）。
 */
async function searchCatalog(query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return [];
  const max = Math.max(1, Math.min(50, Number(limit) || 20));

  let mods = [];
  try {
    const c = linker.readCatalog(paths.nexusCatalog);
    if (c) mods = c.mods || [];
  } catch { mods = []; }

  const shape = (m) => ({
    modId: m.modId, name: m.name, author: m.author, version: m.version || '',
    image: m.image, pictureUrl: m.pictureUrl, summary: m.summary, url: m.url,
    downloads: m.downloads, endorsements: m.endorsements, adult: !!m.adult
  });

  if (!mods.length) {
    const page = await nexus.listMods({ search: q, count: Math.min(80, max), adultMode: 'all' });
    return (page.items || []).slice(0, max).map(shape);
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const m of mods) {
    const hay = String(m.name || '').toLowerCase();
    if (!terms.every(t => hay.includes(t))) continue;
    hits.push({ m, pos: hay.indexOf(terms[0]), len: hay.length });
  }
  // 名字开头就命中的排前面，其次名字短的（更「精确」），最后按下载量兜底
  hits.sort((a, b) => (a.pos - b.pos) || (a.len - b.len) ||
    ((b.m.downloads || 0) - (a.m.downloads || 0)));
  return hits.slice(0, max).map(h => shape(h.m));
}

/**
 * 当前游戏目录的实况。
 *
 * ⚠️ 没配好（`currentRoot()` 为 null）时这里**只回报事实**：配置原值、一句人话原因、
 *    以及带记录数的候选清单（供用户挑）。**绝不**把 `candidates[0]` 当默认值 ——
 *    那正是 2026-11-22 那场事故的成因。
 */
function inspectGame() {
  const root = currentRoot();
  if (!root) {
    const configured = config.get('gameRoot') || '';
    return {
      found: false,
      configured,
      current: '',
      reason: configured
        ? '当前配置的游戏目录无效（找不到 SB\\Binaries\\Win64\\SB-Win64-Shipping.exe）：' + configured + '，请在设置里重新选择'
        : '还没有配置游戏目录，请在设置里选择剑星根目录',
      // 候选是**对象**（{root, mods, records, sbmodAt, mtime}），不再是字符串
      candidates: game.rankCandidates(game.detectCandidates([configured])),
      version: { ok: false, version: '' }
    };
  }
  const info = game.inspect(root);
  delete info.layout; // 路径细节通过 layoutOf 单独给
  const layout = game.layout(root);
  // 游戏版本：读主程序的 PE 版本资源（只认得出就说，认不出留空，别编）
  let version;
  try {
    version = gameVersion.detect(root);
  } catch (e) {
    version = { ok: false, version: '', reason: '读版本号失败：' + e.message };
  }
  // 装文件之前先探一下「这个目录到底能不能写」。
  // 本机踩过：程序目录带 Low 完整性标签 → 进程被降权 → 往游戏目录写全 EPERM，
  // 用户装到一半才失败还只看到裸错误码。这里提前探测，设置页/已安装页就能先说清楚。
  let writable;
  try {
    const probeDir = fs.existsSync(layout.modsDir) ? layout.modsDir : root;
    const r = fsError.probeWritable(probeDir);
    writable = { dir: probeDir, ok: r.ok, code: r.code || null, message: r.ok ? '' : '游戏目录不可写：' + (r.message || '') };
  } catch (e) {
    writable = { dir: root, ok: false, code: fsError.codeOf(e) || null, message: '游戏目录不可写：' + fsError.describe(e, { target: root }) };
  }
  return { found: true, ...info, layout, writable, version };
}

/* ---------------- 已安装 Mod ---------------- */

/* ---------------- 账本 ↔ 磁盘 一致性 ---------------- */

/**
 * 按磁盘裁决注册表：文件全丢的条目删掉、丢一半的裁剪清单、开关状态纠正。
 *
 * 用户手动删了 mod 文件之后，账本若还留着幽灵记录，「已安装」数量、账本条数、
 * 冲突检测都会说假话 —— 而这三样正是用户拿来判断「到底装了什么」的依据。
 */
function reconcileRegistry() {
  try {
    const report = reconcile.plan(registry.all());
    if (reconcile.noteworthy(report)) {
      const applied = reconcile.apply(registry, report);
      invalidateLocalIndex();
      try { syncLedger(currentRoot()); } catch { /* 账本同步失败不影响主流程 */ }
      logger.event('data:reconciled', {
        total: report.total, dropped: applied.dropped, trimmed: applied.trimmed,
        flagged: applied.flagged, missingFiles: report.missingFiles,
        drop: report.drop.slice(0, 10).map(d => d.name)
      });
    }
    return report;
  } catch (e) {
    logger.warn('[一致性] 核对注册表失败：' + e.message);
    return null;
  }
}

function listMods() {
  const root = currentRoot();
  if (!root) return { installed: [], root: null };
  const list = scanAll(root);
  // 顺手对齐下载任务：装过但现在游戏里找不到的，退回「已下载」好让人重装。
  // `reconcile: true` 只在扫描确实成功时传（没游戏目录时上面就返回了）。
  try { engine.syncFromInstalled(list, { reconcile: true }); } catch { /* 忽略 */ }
  return { installed: list, root };
}

/**
 * 从扫描条目里取 Nexus modId（与渲染层 groupInstalled 四级来源同口径）。
 * 时间档案按扫描条目的稳定 id 记键，但 modId 也要存（回退/详情/日志搜索按它认人）。
 */
function stableModIdOf(mod) {
  if (!mod) return 0;
  const meta = mod.meta || {};
  return Number(mod.modId || meta.modId || (meta.source && meta.source.modId) ||
    (mod.link && mod.link.modId) || (mod.tag && mod.tag.modId)) || 0;
}

/**
 * 记一条 Mod 生命周期事件到档案（下载/安装/开启/禁用/卸载都走这里）。
 * 档案写入失败绝不能挡住实际操作 —— 用 try/catch 包住。
 */
function recordMod(action, mod, extra = {}) {
  try {
    if (!modHistory || !mod || !mod.id) return null;
    return modHistory.add(action, {
      id: mod.id,
      modId: stableModIdOf(mod),
      name: mod.name || (mod.meta && mod.meta.name) || '',
      ...extra
    });
  } catch (e) {
    try { logger.warn('[生命周期] 记录失败：' + e.message); } catch { /* 忽略 */ }
    return null;
  }
}

/** 启用 / 禁用 */
function setEnabled(id, enabled, opts) {
  const root = currentRoot();
  if (!root) throw new Error('尚未配置有效的游戏目录');
  const L = game.layout(root);
  // 批量开关时由调用方把「扫过一次的结果」传进来 —— 每处理一个 Mod 就把整个
  // ~Mods（几百个文件）重扫一遍是 2026-11-11 那次「批量禁用点了没反应」的主因。
  const list = (opts && Array.isArray(opts.list)) ? opts.list : scanAll(root);
  const mod = list.find(m => m.id === id);
  // 批量时把要写的东西收集起来，最后 patchMany 落一次盘（逐条 patch = 写 N 次 mods.json）
  const collect = (opts && Array.isArray(opts.collect)) ? opts.collect : null;
  const commit = (patch) => { if (collect) collect.push({ id, patch }); else registry.patch(id, patch); };

  if (!mod) throw new Error('未找到该 Mod');
  if (mod.kind === 'prereq') throw new Error('前置组件不支持禁用');

  if (mod.kind === 'prereq') throw new Error('前置组件不支持禁用');

  // 需要改名的文件：优先用注册表里的绝对路径（manifest 是权威来源，既能覆盖
  // ~Mods，也能覆盖 LogicMods / 子目录），没有再退回磁盘扫描出来的名字。
  // ⚠️ 只用 L.modsDir + 名字 推导时，一旦注册项的文件其实不在 ~Mods，重命名会
  //    静默跳过，而注册表开关已经翻了 —— 界面显示「已关闭」，游戏却照旧加载。
  /** @type {{from: string, to: string}[]} */
  const renames = [];
  let found = 0;
  /** 记录的名字和磁盘差一个开关后缀、实际按另一种写法找到了：只算修正，不算改名 */
  const fixed = [];
  // 开启 / 关闭的时刻：排查「装完哪个 Mod 之后开始崩」全靠它，
  // 也用来在 Mod 库里按「开启时间」排序。只保留最近一次动作的时间，够用了。
  const nowIso = new Date().toISOString();
  const stamp = enabled ? { enabledAt: nowIso } : { disabledAt: nowIso };
  // 改名规则，以及「关着的名字长什么样」，集中在 src/main/toggleName.js：
  // 那里同时解释了两件事 —— ①CNS 换装索引（.dekcns.json）为什么必须把标记插在
  // .json 前面（DekCNS 主脚本是子串匹配 "dekcns.json"）；②reconcile（按磁盘核对）
  // 为什么必须用同一套判定。两处分头写正则时出过「关掉了又被改回启用」的 bug。
  const renameStep = toggleName.renameStep;
  const manifest = (mod.meta && Array.isArray(mod.meta.manifest)) ? mod.meta.manifest : null;
  if (mod.kind === 'pak' || mod.kind === 'logicmod' || mod.kind === 'cns') {
    const sources = manifest && manifest.length
      ? manifest.map(x => x && x.path).filter(Boolean)
      : (mod.files || []).map(f => path.join(L.modsDir, f.name));
    for (const raw of sources) {
      /* manifest 里记的名字可能和磁盘差一个「开关后缀」（以前 reconcile 会把
         enabled 改回 true 却没动 manifest，于是按记录去找就找不到文件）。先在
         同一个目录里找另一种写法（开着 ⇄ 关着），找到了照样能开关，顺手把
         记录改正 —— 用户不该因为记录跟不上就永远开不了 / 关不了。 */
      let from = raw;
      if (!fs.existsSync(from)) {
        const alt = toggleName.counterpartName(path.basename(from));
        const altPath = alt ? path.join(path.dirname(from), alt) : '';
        if (!altPath || !fs.existsSync(altPath)) continue;
        from = altPath;
        fixed.push({ from: raw, to: altPath });
      }
      const base = path.basename(from);
      const dir = path.dirname(from);
      const step = renameStep(base, enabled);
      if (!step.managed) continue;
      found++;
      if (!step.next) continue;          // 已经是目标状态，不用动
      renames.push({ from, to: path.join(dir, step.next) });
    }
  } else if (mod.kind === 'script') {
    // ⚠️ 用目录名（`mod.dir`），不能用 `mod.name` —— 关联/登记之后 name 是显示名，
    //    写进 mods.txt 的是一个 UE4SS 根本不认识的键，开关就静默失效了。
    toggleScriptMod(L, mod.dir || mod.name, enabled);
  }

  for (const r of renames) fs.renameSync(r.from, r.to);

  // 注册表里的 manifest 也要跟着改名，否则下次卸载会找不到文件。
  if (renames.length || fixed.length) {
    const map = new Map([...fixed, ...renames].map(r => [r.from.toLowerCase(), r.to]));
    const nextManifest = (manifest || []).map(x => {
      const to = map.get(String(x && x.path).toLowerCase());
      if (!to) return x;
      const base = path.basename(to);
      const prevRel = String(x.rel || '');
      const prevBase = path.basename(String(x.path || ''));
      const rel = prevBase && prevRel.endsWith(prevBase)
        ? prevRel.slice(0, prevRel.length - prevBase.length) + base
        : base;
      return { ...x, path: to, rel };
    });
    commit({ enabled, ...stamp, manifest: nextManifest });
  } else if (found === 0 && ((manifest && manifest.length) || (mod.files && mod.files.length))) {
    // 一个文件都没在磁盘上找到，就别装作成功 —— 否则注册表说「已关闭」，
    // 游戏还在照旧加载，用户看到的和实际不一样。
    throw new Error(enabled
      ? '找不到这个 Mod 的文件（可能已被移走或改名），没法启用'
      : '找不到这个 Mod 的文件（可能已被移走或改名），没法关闭');
  } else {
    commit({ enabled, ...stamp });
  }
  // 记生命周期事件：不管已登记还是未登记，开关都写进 mod-history.json
  recordMod(enabled ? 'enable' : 'disable', mod, { detail: stamp[enabled ? 'enabledAt' : 'disabledAt'] });
  return { id, enabled, renamed: renames.length, fixed: fixed.length };
}

/**
 * 批量开关：只扫描一次、只写一次注册表，并且每处理完一个就往前端推一次进度。
 *
 * 2026-11-11 用户报「多选后批量禁用没效果」，实际是太慢 —— 老实现每个 Mod 都
 * 走一遍 setEnabled()：全盘 scanner.scan() + 单独写一次 mods.json，39 个 Mod
 * 就是 39 次全盘扫描、几十次落盘，期间界面一动不动，看着就像没生效。
 * 这里把扫描与落盘各收成一次，并把进度（done/total）推给渲染层显示在按钮上。
 */
async function setEnabledMany(ids, enabled) {
  const wanted = Array.isArray(ids) ? ids.filter(Boolean) : [];
  const results = [];
  const total = wanted.length;
  if (!total) return { total: 0, ok: 0, failed: 0, results };

  const root = currentRoot();
  if (!root) throw new Error('尚未配置有效的游戏目录');
  const scanned = scanAll(root);   // ← 全批只扫这一次
  const pairs = [];
  let done = 0, ok = 0, failed = 0;
  for (const id of wanted) {
    try {
      const r = setEnabled(id, enabled, { list: scanned, collect: pairs });
      results.push({ id, ok: true, name: r && r.name, renamed: r && r.renamed, fixed: r && r.fixed });
      ok++;
    } catch (e) {
      results.push({ id, ok: false, error: (e && e.message) || String(e) });
      failed++;
    }
    done++;
    sendToMain('mods:batchProgress', { done, total, id, enabled: !!enabled });
  }
  if (pairs.length) registry.patchMany(pairs);   // ← 全批只落这一次盘

  logger.event('mods:setEnabledMany', { enabled: !!enabled, total, ok, failed });
  return { total, ok, failed, results };
}

/**
 * 冲突扫描（用户 2026-11-25）：读已装 Mod 的 CNS 数据文件，按 UniqueFitID / 共享网格找冲突。
 * 归属表用当前 fileOwner（已在 init 里建好），拿不到归属时退化到文件名 [nx] 标识。
 */
function scanModConflicts() {
  const root = currentRoot();
  if (!root) return { scannedMods: 0, strong: 0, tips: 0, groups: [], error: '尚未配置有效的游戏目录' };
  try { if (fileOwner && typeof fileOwner.reload === 'function') fileOwner.reload(); } catch { /* 忽略 */ }
  const result = modConflicts.scanAll(root, {
    modsDir: game.layout(root).modsDir,
    fileOwner
  });
  logger.event('mods:conflictsScan', { scanned: result.scannedMods, strong: result.strong, tips: result.tips });
  return result;
}

/**
 * 一次性回填已装 Mod 的游戏内名称（用户 m17942）：扫磁盘上所有 dekcns 的 DisplayName，
 * 按 modId 合并写进 mod-info 档案。只在档案还没有 gameNames 时写，不覆盖已有的
 * （安装时已解析过的、或用户改过的）。返回回填了几个 Mod。
 */
function backfillGameNames() {
  const root = currentRoot();
  if (!root) return { filled: 0, error: '尚未配置有效的游戏目录' };
  try { if (fileOwner && typeof fileOwner.reload === 'function') fileOwner.reload(); } catch { /* 忽略 */ }
  const map = modConflicts.scanCnsMeta(root, { modsDir: game.layout(root).modsDir, fileOwner });
  const store = modInfoStore();
  let filled = 0;
  for (const k of Object.keys(map)) {
    const id = Number(k);
    const meta = map[k];
    if (!id || !meta) continue;
    const old = store.get(id);
    if (old && Array.isArray(old.gameNames) && old.gameNames.length) continue; // 已有就不覆盖
    const patch = { modId: id };
    if (meta.gameNames.length) patch.gameNames = meta.gameNames;
    if (meta.uniqueFitIds.length) patch.uniqueFitIds = meta.uniqueFitIds;
    if (meta.meshes.length) patch.meshes = meta.meshes;
    store.put(patch);
    filled++;
  }
  logger.event('mods:backfillGameNames', { filled });
  return { filled, scanned: Object.keys(map).length };
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
  const list = scanAll(root);
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
      else { moved.push({ file: f.name, to: dest, via: fsMove.movePath(from, path.join(dest, f.name)) }); }
    }
  } else if (mod.kind === 'script') {
    // 同 setEnabled：路径必须用目录名，`name` 关联后是显示名
    const from = path.join(L.ue4ssModsDir, mod.dir || mod.name);
    if (fs.existsSync(from)) {
      if (purge) { fs.rmSync(from, { recursive: true, force: true }); moved.push({ file: mod.dir || mod.name, deleted: true }); }
      else { fs.mkdirSync(path.dirname(dest), { recursive: true }); moved.push({ file: mod.dir || mod.name, to: dest, via: fsMove.movePath(from, dest) }); }
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
        moved.push({ file: rel, to, via: fsMove.movePath(f.path, to) });
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
  // 关联记录跟着条目一起清掉：文件都没了，再留一条「它曾经是 12345 号 mod」
  // 只会在下次同名 pak 出现时张冠李戴。
  try { linker.removeLink(paths.modLinksFile, id); } catch { /* 记录清不掉不影响卸载 */ }
  invalidateLocalIndex();
  syncLedger();
  recordMod('uninstall', mod, { detail: purge ? '彻底删除' : '移到备份目录' });
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
/* ---------------- 补登记：记录丢了，但文件还在盘上 ---------------- */

/**
 * 「注册表说没装过，可文件明明在游戏目录里」—— 把记录按安装包补回来。
 *
 * 什么时候会这样（都是真事）：
 *   · 换过游戏目录，核对时按旧路径找不到文件，把整条记录当「文件全丢」删了
 *     （mod 4184「Blossom Butterfly Sexy JK Girl」就是这么从注册表里消失的）；
 *   · 用户自己把 mod 拷进 ~Mods，管理器从来没写过记录。
 *
 * ⚠️ 这里**一个文件都不写、也不解压**：只核对每个目标文件是不是已经在位且大小一致，
 *    然后把注册表条目照正常安装的形状补上。文件不全就让用户走正常安装，不硬补。
 */
async function registerExisting({ taskId = null, archivePath = null, meta = null } = {}) {
  const root = currentRoot();
  if (!root) throw new Error('尚未配置有效的游戏目录');
  const L = game.layout(root);

  let task = null;
  if (taskId) {
    try { task = engine.get(taskId); } catch { task = null; }
    if (!task) throw new Error('找不到这条下载记录（可能已被清理），没法补登记');
  }
  const ap = archivePath || (task && task.archivePath) || null;
  if (!ap) throw new Error('这个 Mod 的安装包已经不在管理器里了，没法补登记');
  if (!fs.existsSync(ap)) throw new Error('安装包文件已不存在：' + ap);

  const m = { ...(task && task.meta ? task.meta : {}), ...(meta || {}) };
  if (task) m.taskId = task.id;

  const ownedPaths = installFlow.ownedPathsFor(registry, m);
  let plan = await installer.analyze(root, ap, m, { ownedPaths });
  // 多变体包：跟正常安装同一口径 —— 互不冲突的就全装，别卡在「先选哪几套」
  if (plan && !plan.ok && plan.needsTargetPick && Array.isArray(plan.options) && plan.options.length
      && plan.hasConflicts === false) {
    const dirs = (Array.isArray(plan.defaultPick) && plan.defaultPick.length)
      ? plan.defaultPick : plan.options.map(o => o.dir).filter(Boolean);
    if (dirs.length) plan = await installer.analyze(root, ap, m, { ownedPaths, pickDirs: dirs });
  }
  if (!plan || !plan.ok) {
    throw new Error((plan && (plan.diagnosis || plan.reason)) || '这个安装包的结构认不出来，没法补登记');
  }

  const v = installer.verifyExisting(plan);
  if (!v.present.length) {
    throw new Error('游戏目录里找不到这个安装包里的任何文件 —— 文件确实不在了，请直接「安装」重装');
  }
  if (!v.ok) {
    const bad = v.missing.concat(v.mismatched).map(x => path.basename(x.path));
    const names = bad.slice(0, 3).join('、');
    throw new Error('还有 ' + bad.length + ' 个文件不在位或大小不对（' + names
      + (bad.length > 3 ? ' 等' : '') + '）—— 请直接「安装」重装，别补登记');
  }

  const manifest = v.present.map(f => ({ path: f.path, rel: f.rel, size: f.size }));
  const enabled = !v.present.some(f => f.disabled);
  const id = installFlow.registryIdFor(L, plan, manifest, m);
  const born = v.present.map(f => f.bornAt).filter(Boolean).sort();
  const nowIso = new Date().toISOString();
  // 安装时间优先用文件自己的创建时间（补登记时这是唯一可信的原始时间）
  const installedAt = born.length ? born[0] : nowIso;

  registry.upsert({
    id,
    name: m.name || path.basename(ap, path.extname(ap)),
    kind: plan.kind,
    enabled,
    ...(enabled ? { enabledAt: nowIso } : { disabledAt: nowIso }),
    source: {
      url: m.sourceUrl || m.url || null,
      modId: m.modId || null,
      fileId: m.fileId || null,
      author: m.author || null,
      version: m.version || null,
      pictureUrl: m.pictureUrl || null
    },
    installedAt,
    target: plan.target,
    archivePath: ap,
    manifest,
    // 补登记没有「覆盖前备份」这回事 —— 文件本来就在，谁也没被覆盖
    backupDir: null,
    overwritten: [],
    fileCount: manifest.length,
    size: manifest.reduce((s, f) => s + (f.size || 0), 0),
    taskId: m.taskId || null,
    requiresCns: !!plan.requiresCns,
    requiresAtool: !!plan.requiresAtool,
    prereqKey: plan.prereqKey || null,
    // 安装账本（同正常安装）：包里几个文件、装了几个、哪些没装
    pkg: (() => {
      const led = installer.packageLedger(plan);
      return {
        archivePath: ap,
        entryCount: led.entryCount,
        installedCount: manifest.length,
        notInstalled: led.notInstalled.slice(0, 300),
        notInstalledCount: led.notInstalledCount,
        at: installedAt
      };
    })()
  });

  invalidateLocalIndex();
  syncLedger();
  const rec = {
    id,
    name: m.name || path.basename(ap, path.extname(ap)),
    kind: plan.kind,
    meta: { modId: m.modId || null, source: { modId: m.modId || null } }
  };
  recordMod('install', rec, { detail: '按安装包补登记', at: installedAt });
  if (enabled) recordMod('enable', rec, { detail: '补登记时就是启用态', at: nowIso });
  // 补登记时顺手把「包内文件 → 这个 Mod」的归属记进归属表：
  // 之后再换目录 / 记录再丢，也能靠它把数据文件挂回卡片，不用重新扫库。
  try { indexOwnerFromPlan(fileOwner, plan, Number(m.modId) || 0, ap); } catch { /* 归属表坏了不影响补登记 */ }
  logger.event('mods:registered', {
    id, modId: m.modId || null, files: manifest.length, enabled,
    taskId: m.taskId || null, installedAt
  });

  // 顺手让下载队列也跟上：这条任务从「已下载」变回「已安装」
  //
  // ⚠️ 只靠 syncFromInstalled 不够：它只翻**终态**任务（installed/failed/cancelled/…），
  //    而补登记面对的正是 `downloaded`（安装包在、文件在、记录丢了）。
  try {
    if (task) engine.markRegistered(task.id, { registryId: id, target: plan.target, at: installedAt });
  } catch { /* 队列对不上不影响补登记本身 */ }
  try { engine.syncFromInstalled(scanAll(root), { reconcile: true }); }
  catch { /* 队列对不上不影响补登记本身 */ }

  return {
    id,
    name: rec.name,
    kind: plan.kind,
    kindLabel: plan.kindLabel,
    files: manifest.length,
    size: manifest.reduce((s, f) => s + (f.size || 0), 0),
    enabled,
    installedAt,
    target: plan.target
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
    // 先把账本与当前游戏目录对齐（搬移过就静默改回来；注册表空则从游戏目录里的账本恢复）
    const relocation = autoRelocate(currentRoot());
    // 再按磁盘裁决一次账本：用户手动删掉的文件，不该还挂在「已安装」里。
    const reconciled = reconcileRegistry();
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
      relocation,
      reconciled: reconciled
        ? {
          total: reconciled.total, kept: reconciled.kept,
          dropped: reconciled.dropped, trimmed: reconciled.trimmed,
          flagged: reconciled.flagged, missingFiles: reconciled.missingFiles,
          droppedItems: reconciled.drop.slice(0, 20),
          summary: reconcile.summarize(reconciled)
        }
        : null,
      dataHome: gameHome.info(),
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

  /* 打开游戏目录 / 打开 Mod 目录
   *
   * 为什么给专门两个通道，而不是让界面自己拼路径丢给 app:openPath：
   *   1) 「游戏根在哪」是三处信息合起来算的（用户设置 + 便携指针文件 + 自动探测），
   *      界面手里只有 inspect() 回来的那一份，容易和搬移/账本逻辑走成两套判断；
   *   2) Mod 目录有三种形态（~Mods / LogicMods / ue4ss\Mods），按哪个开得挑「真存在」的那个，
   *      挑错的后果是弹一个空窗口或者干脆打不开；
   *   3) 路径不在时要说人话，而不是静默什么都不发生 —— 所以这里宁可抛错。
   */
  handle('game:openRoot', () => {
    const root = currentRoot() || '';
    if (!root) throw new Error('还没识别到游戏目录，先在设置里指定一下。');
    if (!fs.existsSync(root)) throw new Error('游戏目录已经不在了：' + root);
    shell.openPath(root);
    return root;
  });

  handle('game:openModsDir', () => {
    const root = currentRoot() || '';
    if (!root) throw new Error('还没识别到游戏目录，先在设置里指定一下。');
    // 三个候选目录与优先级统一放在 paths.modDirsOf()，界面上别处也用它
    const dirs = paths.modDirsOf(root);
    const hit = dirs.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    if (!hit) throw new Error('游戏目录里还没有 Mod 目录（可能还没装过 Mod）：' + dirs[0]);
    shell.openPath(hit);
    return hit;
  });
  handle('app:dataDir', () => paths.DATA);

  /* ---------------- 数据目录（设置页里可改位置） ----------------
   *
   * 为什么要能改：C 盘紧张的用户得把 cache / library / backup 挪到别的盘
   * （这几个目录加起来能到几十 GB）。改法不是「热切换」，而是
   * 写一个**指针文件**（放在固定的 userData 下，不在数据目录里 ——
   * 放里面就成了「得先知道数据目录才能找到数据目录」的鸡生蛋），
   * 下次启动时 `paths.js` 读它决定 DATA。
   *
   * 所以整套流程是：选目录 → 看目标里有没有旧数据 → 决定要不要把现有数据搬过去
   * → 写指针 → 提示重启。**没有哪一步能在本进程里改掉已经加载的路径常量**
   * （DATA / CACHE / LIBRARY 在模块加载时就被各模块取走了）。
   */

  /**
   * 当前数据目录的全貌 —— 设置页显示「默认 / 自定义」标记与回落原因。
   *
   * ⚠️ `current` 与 `next` 会不一样：本进程的 `paths.DATA` 是**加载时定死**的，
   *    用户在设置页改完指针文件后当前进程还在用旧目录，只有重启才会换成 `next`。
   *    所以这里**重新读一遍指针文件**，把「重启后会用的位置」也算出来给界面。
   */
  handle('data:info', () => {
    const picked = paths.pickDataDir(paths.readBootstrap(), paths.DEFAULT_DATA);
    const custom = picked.source === 'custom';
    const usable = !custom || paths.canUseDir(picked.dir);
    // 「跟着游戏走」的那份优先：指针里的游戏目录下已有 `<游戏根>\.sbmod\config.json`
    // 就说明下次启动会读它，界面得照这个说，不能还说「会用默认目录」
    const ptr = paths.readPointer();
    const hintRoot = typeof ptr.gameRoot === 'string' ? ptr.gameRoot.trim() : '';
    const homeReady = hintRoot && !custom ? paths.gameHomeReady(hintRoot) : false;
    const homeDir = homeReady ? paths.gameHomeOf(hintRoot) : '';
    return {
      current: paths.DATA,                                   // 本进程正在用
      next: homeDir || (usable ? picked.dir : paths.DEFAULT_DATA),  // 重启后会用的
      configured: custom ? picked.dir : '',
      default: paths.DEFAULT_DATA,
      source: homeDir ? 'game' : (usable ? picked.source : 'default'),
      reason: usable ? picked.reason : 'unusable',
      bootstrap: paths.BOOTSTRAP_FILE,
      userData: paths.userDataDir(),
      packaged: !!app.isPackaged,
      exists: (() => { try { return fs.existsSync(paths.DATA); } catch { return false; } })(),
      active: engine ? engine.stats().active : 0,
      // 数据是不是已经在游戏目录里（`<游戏根>\.sbmod`）
      gameHome: gameHome.info(),
      // 安装包目录（下载好的压缩包放这儿；可以指到别的盘）
      library: { dir: paths.LIBRARY, default: paths.DEFAULT_LIBRARY, configured: paths.LIBRARY_CONFIGURED }
    };
  });

  /** 弹系统目录选择框（不挂主窗口 —— 免得把设置页所在窗口整个冻住） */
  handle('data:choose', async (opts) => {
    const o = opts || {};
    const r = await dialog.showOpenDialog({
      title: '选择数据目录',
      defaultPath: o.defaultPath || paths.DATA,
      buttonLabel: '选这个目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  /** 看一眼某个目录里是不是已经有数据了（决定要不要问「搬运还是留空用」） */
  handle('data:inspect', (dir) => dataMigrate.inspect(dir));

  /**
   * 把现有数据搬到新目录，然后把指针指过去。
   *
   * `mode`：'move' = 搬完删源；'copy' = 留一份在旧位置（更保守，用户自己决定何时删）。
   * 下载 / 安装进行中一律拒绝 —— 半截文件与 archivePath 正在被写，搬了必然错位。
   */
  handle('data:migrate', async (from, to, opts) => {
    const o = opts || {};
    const running = engine ? engine.stats().active : 0;
    if (running > 0) {
      throw new Error('还有 ' + running + ' 个下载 / 安装任务在跑，先暂停或等它跑完再搬数据');
    }
    const r = await dataMigrate.run(from, to, {
      mode: o.mode === 'move' ? 'move' : 'copy',
      overwrite: !!o.overwrite,
      onProgress: (p) => sendToMain('data:progress', p || {})
    });
    // 数据已在新位置 → 指针指过去（重启后生效）
    // 目标就是默认位置时直接删指针文件更干净（否则 pickDataDir 会走 same-as-default 分支）
    const isDefault = path.resolve(to).toLowerCase() === path.resolve(paths.DEFAULT_DATA).toLowerCase();
    const set = isDefault ? paths.setDataDir('') : paths.setDataDir(to);
    logger.event('data:migrated', { from: r.from, to: r.to, mode: r.mode, files: r.copied, skipped: r.skipped, rewritten: r.rewritten });
    return { ...r, dir: set.dir, source: set.source, relaunchRequired: true };
  });

  /** 只写指针文件（目标目录留空 / 用户已自行处理好数据时走这条）。传空 = 恢复默认。 */
  handle('data:setDir', (dir) => {
    const running = engine ? engine.stats().active : 0;
    if (running > 0) {
      throw new Error('还有 ' + running + ' 个下载 / 安装任务在跑，先处理完再改数据位置');
    }
    // 传的就是默认位置时按「恢复默认」处理
    const isDefault = !!dir && path.resolve(dir).toLowerCase() === path.resolve(paths.DEFAULT_DATA).toLowerCase();
    const r = paths.setDataDir(isDefault ? '' : (dir || ''));
    const same = path.resolve(r.dir).toLowerCase() === path.resolve(paths.DATA).toLowerCase();
    return { dir: r.dir, source: r.source, current: paths.DATA, changed: !same, relaunchRequired: !same };
  });

  /** 立即以同样的参数重启 —— 新数据目录只有重启后才生效 */
  handle('data:relaunch', () => {
    logger.event('data:relaunch', { from: paths.DATA });
    app.relaunch();
    app.exit(0);
    return true;
  });

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

  /* 崩溃 / 报错日志分析 —— 排查「装了 Mod 之后游戏一启动就崩」。
     游戏本体是 Shipping 版，默认不写 SB.log，现场只有两处：
     `ue4ss\UE4SS.log`（加载器日志，每次启动重写）+ `%LOCALAPPDATA%\SB\Saved\Crashes`
     （引擎崩溃快照）。这里把两边对撞出结论，界面上再让人点开原文核对。 */
  handle('crash:report', () => {
    const root = currentRoot();
    if (!root) {
      return { root: '', report: null, reason: '还没设置游戏目录，找不到日志和崩溃快照。' };
    }
    let mods = [];
    // ⚠️ `listMods()` 返回的是 `{ installed, root }`，不是数组 —— 直接丢给 analyze 会炸
    try {
      const lm = listMods();
      mods = Array.isArray(lm) ? lm : ((lm && lm.installed) || []);
    } catch (e) { logger.event('crash:report mods-fail', { error: String(e && e.message || e) }); }
    let version = null;
    try { version = gameVersion.detect(root); } catch { version = null; }
    const report = crashLog.analyze({ root, mods, gameVersion: version, now: Date.now() });
    logger.event('crash:report', {
      crashes: report.stats.total,
      suspects: report.analysis.suspects.length,
      verdict: report.analysis.verdict.level
    });
    return { root, report, reason: '' };
  });

  handle('crash:read', (kind, file, maxBytes) => crashLog.readSource({ root: currentRoot() || '', kind, file, maxBytes }));

  handle('crash:openDir', () => {
    const L = crashLog.locate(currentRoot() || '');
    const dir = L.crashes || L.saved || L.ue4ssDir;
    if (!dir) return false;
    shell.openPath(dir);
    return true;
  });

  handle('crash:openFile', (file) => {
    const p = String(file || '');
    if (!p) return false;
    const L = crashLog.locate(currentRoot() || '');
    const roots = [L.crashes, L.logs, L.ue4ssDir].filter(Boolean)
      .map(r => path.resolve(r).toLowerCase() + path.sep);
    const t = path.resolve(p).toLowerCase();
    if (!roots.some(r => t.startsWith(r))) return false; // 只允许打开已知目录里的文件
    shell.showItemInFolder(p);
    return true;
  });

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
  /**
   * 自动探测到的候选目录 —— **只给界面看，绝不当默认值用**。
   * `candidates` 是带记录数的对象（与 inspectGame 同一套字段）；
   * `roots` 另留一份纯字符串，给还没适配对象形状的老代码兜底。
   */
  handle('game:detect', () => {
    const roots = game.detectCandidates([config.get('gameRoot')]);
    return { candidates: game.rankCandidates(roots), roots };
  });
  /**
   * 顶栏「启动游戏」：直接拉起游戏主程序（不走 Steam，绿色版/Steam/Epic 都行）。
   * 起不来就抛带人话的错误（没设目录 / exe 不在 / 没权限），前端直接 toast 出来。
   */
  handle('game:launch', () => {
    const root = currentRoot();
    const info = gameLaunch.plan(root);
    if (!info.ok) throw new Error(info.reason);
    try {
      const r = gameLaunch.launch(root);
      logger.event('game:launch', { exe: r.exe, pid: r.pid });
      return r;
    } catch (e) {
      logger.warn('[启动游戏] ' + e.message);
      throw new Error('启动失败：' + e.message);
    }
  });
  /**
   * 弹目录选择框 —— **只选不生效**。
   *
   * 不写 config、不 seed 数据、不 relocate：先让用户在候选列表里看清「哪一份带着真实的
   * Mod 记录」，再由用户自己决定。真正生效走 `game:setRoot`。
   */
  handle('game:chooseRoot', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择剑星游戏目录',
      properties: ['openDirectory', 'dontAddToRecent']
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return { canceled: true };
    return { canceled: false, root: path.resolve(r.filePaths[0]) };
  });

  /**
   * 三个"可能是我的游戏目录"的来源（指针文件 / 配置 / 当前生效）+ 自动探测的候选，
   * 一起交给界面挑。元素是 `{ root, mods, records, sbmodAt, mtime }`，记录数多的排前面。
   */
  handle('game:rootCandidates', () => {
    const ptr = paths.readPointer();
    const pointer = typeof ptr.gameRoot === 'string' ? ptr.gameRoot.trim() : '';
    const configured = config.get('gameRoot') || '';
    const current = currentRoot() || '';
    return {
      pointer,
      configured,
      current,
      candidates: game.rankCandidates(game.detectCandidates([configured, current, pointer]))
    };
  });

  handle('game:setRoot', (root) => {
    if (!game.isGameRoot(root)) throw new Error('该目录不是有效的剑星根目录（未找到 SB\\Binaries\\Win64\\SB-Win64-Shipping.exe）');
    // 换目录之前先看一眼「新目录里本来登记着几条 Mod」。
    // 0 条 = 这很可能是个空副本（2026-11-22：用户搬到 C 盘，管理器却指到 D 盘旧副本，
    // 在那儿 seed 出只有 1 条记录的 .sbmod）。这里**不拒绝、也不自动搬数据** ——
    // 只把事实回报给界面，由用户确认「真的是这份吗」。
    const before = game.candidateInfo(root).records;
    let warn = null;
    if (before === 0) {
      const richer = game.rankCandidates(game.detectCandidates([root]))
        .find(c => c.records > 0 && path.resolve(c.root).toLowerCase() !== path.resolve(root).toLowerCase());
      warn = { emptyTarget: true, richer: richer ? { root: richer.root, records: richer.records } : null };
      logger.event('game:setRootEmptyTarget', {
        root,
        richer: richer ? richer.root : null,
        richerRecords: richer ? richer.records : 0
      });
    }
    config.set({ gameRoot: root });
    // 数据跟着新游戏目录走：先把状态铺进去（已有则不覆盖）、记指针、挂镜像
    const home = initGameHome(root);
    // 换目录往往就是「搬移」——顺手把账本对齐，别让用户自己点
    const relocation = autoRelocate(root);
    // 再按新目录的磁盘实况裁决一次：旧目录里那些没搬过来的记录该退场了
    const reconciled = reconcileRegistry();
    // 下载任务也跟着对齐：装在新目录里的算「已安装」，没搬过来的退回「已下载」
    try {
      const list = scanAll(root);
      engine.syncFromInstalled(list, { reconcile: true });
    } catch { /* 对齐失败不影响换目录本身 */ }
    return {
      ...inspectGame(), relocation, home, warn,
      reconciled: reconciled
        ? { dropped: reconciled.dropped, trimmed: reconciled.trimmed, flagged: reconciled.flagged, summary: reconcile.summarize(reconciled) }
        : null
    };
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

  /* 游戏目录搬移（账本跟着游戏走） */
  handle('game:relocate', () => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    return relocationPlan(root);
  });
  handle('game:relocateApply', () => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    return applyRelocation(root);
  });
  /** 账本状态：管理器里多少条、游戏目录里那份是否存在 */
  handle('game:ledger', () => {
    const root = currentRoot();
    const led = root ? relocate.readLedger(root) : null;
    return {
      root,
      file: root ? relocate.ledgerPath(root) : '',
      registryCount: registry.all().length,
      exists: !!led,
      count: led ? led.mods.length : 0,
      writtenAt: led ? led.writtenAt : null,
      gameRootInLedger: led ? led.gameRoot : '',
      sameRoot: !!(led && root && led.gameRoot && led.gameRoot.toLowerCase() === root.toLowerCase())
    };
  });
  handle('game:ledgerExport', () => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    const out = syncLedger(root);
    if (!out) throw new Error('写入失败，请检查游戏目录是否可写');
    return out;
  });
  handle('game:ledgerImport', () => {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    const led = relocate.readLedger(root);
    if (!led) throw new Error('游戏目录里没有账本文件（' + relocate.ledgerPath(root) + '）');
    const merged = relocate.mergeLedger(registry.all(), led, root);
    const added = registry.addMany(merged.add);
    if (added) { invalidateLocalIndex(); logger.event('game:ledgerImported', { count: added, manual: true }); }
    return { added, skipped: merged.skipped.length, ledgerCount: led.mods.length };
  });

  /* 已安装 Mod */
  handle('mods:list', () => {
    const r = listMods();
    // 磁盘上确实装着的 → 对齐下载队列状态
    try { engine.syncFromInstalled(r.installed); } catch { /* 忽略 */ }
    return r;
  });
  /**
   * 手动跑一次「账本 ↔ 磁盘」核对（设置页那颗「核对磁盘」按钮）。
   * 启动时其实已经自动跑过一轮，这里给一个能随时重跑、并且看得见结果的入口。
   */
  handle('mods:reconcile', () => {
    const report = reconcileRegistry();
    if (!report) throw new Error('核对失败，详情见日志');
    try { engine.syncFromInstalled(listMods().installed, { reconcile: true }); } catch { /* 忽略 */ }
    return {
      total: report.total, kept: report.kept,
      dropped: report.dropped, trimmed: report.trimmed, flagged: report.flagged,
      missingFiles: report.missingFiles,
      droppedItems: report.drop.slice(0, 20),
      summary: reconcile.summarize(report)
    };
  });
  handle('mods:setEnabled', (id, enabled) => setEnabled(id, enabled));
  handle('mods:setEnabledMany', (ids, enabled) => setEnabledMany(ids, enabled));
  handle('mods:uninstall', (id, opts) => uninstall(id, opts));
  /** 全局冲突扫描：把所有已装 Mod 对比一遍，列出 UniqueFitID 撞车 / 共享网格 */
  handle('mods:conflictsScan', () => scanModConflicts());
  /** 一次性回填已装 Mod 的游戏内名称（DisplayName）到本地档案 */
  handle('mods:backfillGameNames', () => backfillGameNames());
  /** 安装前冲突预检：读安装包里的 dekcns，跟已装 Mod 比，返回冲突组供界面选留谁 */
  handle('install:checkConflicts', async (archivePath, meta) => {
    const root = currentRoot();
    if (!root) return { incoming: null, dekcns: 0, conflicts: [], error: '尚未配置有效的游戏目录' };
    if (!archivePath || !fs.existsSync(archivePath)) return { incoming: null, dekcns: 0, conflicts: [], error: '安装包不存在' };
    let installedRecords = [];
    try {
      installedRecords = modConflicts.scanInstalled(root, {
        modsDir: game.layout(root).modsDir,
        fileOwner
      });
    } catch (e) {
      logger.warn('conflicts:scanInstalled 失败：' + e.message);
    }
    const result = modConflicts.checkInstall(archivePath, meta || {}, installedRecords);
    logger.event('install:checkConflicts', {
      name: (meta && meta.name) || '', modId: (meta && meta.modId) || 0,
      dekcns: result.dekcns, conflicts: result.conflicts.length
    });
    return result;
  });
  // 记录丢了但文件还在盘上：按安装包把注册表条目补回来（不解压、不写文件）
  handle('mods:registerExisting', (opts) => registerExisting(opts || {}));
  /**
   * 详情页里那些「其实查得到、只是没去查」的字段。
   *
   * 用户 2026-11-24：详情页面里很多空的数据要补完整。这里的来源分别是：
   *   ① 发布时间 —— 本地档案没有就问一次 Nexus 的 `createdAt`，问到就落盘（之后纯本地可得）；
   *   ② 压缩包位置 —— 注册表 → 本地安装包库 → 下载队列，按可信度依次找。
   *      注意**不能用** `localLibrary.scan()`：它按设计会跳过「已经装着的」modId，
   *      而详情页问的正好是已安装的那些，用它永远查不到。
   *   ③ 安装时间 —— 注册表记的 `installedAt`（本程序装的才有；磁盘扫描来的由渲染层
   *      用文件创建时间补记）。
   * 只读，任何一步失败都只返回空值 —— 详情页宁可显示「—」，也不能弹错误框。
   */
  async function modFacts({ modId = 0 } = {}) {
    const id = Number(modId) || 0;
    const out = { modId: id, publishedAt: '', archivePath: '', archiveFrom: '', installedAt: '', installedFrom: '' };
    if (!id) return out;
    const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };

    // ① 发布时间：本地档案 → 问一次 Nexus
    try {
      const store = modInfoStore();
      const rec = store.get(id);
      if (rec && rec.publishedAt) out.publishedAt = rec.publishedAt;
      else {
        const d = await nexus.getMod(id);
        if (d && d.createdAt) {
          out.publishedAt = d.createdAt;
          try { store.put({ modId: id, publishedAt: d.createdAt }); } catch { /* 存不下不影响这次 */ }
        }
      }
    } catch { /* 没网 / 没 key：空着 */ }

    // ② 压缩包位置：注册表 → 本地安装包库 → 下载队列
    try {
      for (const rec of registry.all()) {
        if (Number(rec.source && rec.source.modId) !== id) continue;
        if (exists(rec.archivePath)) { out.archivePath = rec.archivePath; out.archiveFrom = '注册表'; break; }
      }
    } catch { /* ignore */ }
    if (!out.archivePath) {
      try {
        let best = null;
        for (const f of fs.readdirSync(paths.LIBRARY)) {
          const info = localLibrary.parseArchiveName(f);
          if (!info || Number(info.modId) !== id) continue;
          const p = path.join(paths.LIBRARY, f);
          if (!exists(p)) continue;
          let mt = '';
          try { mt = fs.statSync(p).mtime.toISOString(); } catch { /* ignore */ }
          if (!best || mt > best.mt) best = { p, mt };
        }
        if (best) { out.archivePath = best.p; out.archiveFrom = '本地库'; }
      } catch { /* 本地库目录不存在就算了 */ }
    }
    if (!out.archivePath) {
      try {
        const t = engine.list().find(x => Number(x.meta && x.meta.modId) === id && exists(x.archivePath));
        if (t) { out.archivePath = t.archivePath; out.archiveFrom = '下载队列'; }
      } catch { /* ignore */ }
    }

    // ③ 安装时间：注册表里最早的一条（同一个 modId 可能有多次安装记录）
    try {
      let best = '';
      for (const rec of registry.all()) {
        if (Number(rec.source && rec.source.modId) !== id) continue;
        const at = String(rec.installedAt || '');
        if (at && (!best || at < best)) best = at;
      }
      if (best) { out.installedAt = best; out.installedFrom = '注册表'; }
    } catch { /* ignore */ }

    return out;
  }
  handle('mods:facts', (opts) => modFacts(opts || {}));

  /* ---------------- 文件归属表（哪个文件属于哪个 Mod） ---------------- */

  /**
   * 手动重建归属表：拿本地安装包里的条目反推「文件 → Mod」。
   *
   * 早期装的那批 Mod 没记逐文件账，`~Mods` 里就留下一堆谁都不认领的数据文件
   * （`.dekcns.json` / `.dekani.json`）。归属表建起来之后，扫描时会自动把它们挂回卡片。
   */
  handle('mods:indexOwners', (opts) => ensureFileOwners({ force: true, ...(opts || {}) }));
  handle('mods:ownerStats', () => (fileOwner ? fileOwner.stats() : { files: 0, mods: 0 }));

  /* ---------------- 子 Mod：一个安装包里好几套，各自单独装 / 单独卸 ---------------- */

  /**
   * 找这个 Mod 的安装包（队列 → 注册表 → 本地安装包库，与详情页同口径）。
   * 子 Mod 的装 / 卸都只认这一个入口，免得两处口径不一致。
   */
  function resolveArchive(modId, taskId = null) {
    const id = Number(modId) || 0;
    const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
    let ap = '', from = '', task = null;
    try {
      if (taskId) {
        const t = engine.get(taskId);
        if (t && exists(t.archivePath)) { ap = t.archivePath; from = '下载队列'; task = t; }
      }
      if (!ap) {
        const tk = engine.list().find(x => Number(x.meta && x.meta.modId) === id && exists(x.archivePath));
        if (tk) { ap = tk.archivePath; from = '下载队列'; task = tk; }
      }
    } catch { /* 队列读不到就往下走 */ }
    if (!ap) {
      try {
        for (const rec of registry.all()) {
          if (Number(rec.source && rec.source.modId) !== id) continue;
          if (exists(rec.archivePath)) { ap = rec.archivePath; from = '注册表'; break; }
        }
      } catch { /* ignore */ }
    }
    if (!ap) {
      try {
        let best = null;
        for (const f of fs.readdirSync(paths.LIBRARY)) {
          const info = localLibrary.parseArchiveName(f);
          if (!info || Number(info.modId) !== id) continue;
          const p = path.join(paths.LIBRARY, f);
          if (!exists(p)) continue;
          let mt = '';
          try { mt = fs.statSync(p).mtime.toISOString(); } catch { /* ignore */ }
          if (!best || mt > best.mt) best = { p, mt };
        }
        if (best) { ap = best.p; from = '本地库'; }
      } catch { /* 本地库不存在 */ }
    }
    return { ap, from, task };
  }

  /** 这个 modId 已经登记的那条记录（取安装时间最早的一条当主记录） */
  function findRecByModId(modId) {
    const id = Number(modId) || 0;
    if (!id) return null;
    let best = null;
    for (const rec of registry.all()) {
      if (Number(rec.source && rec.source.modId) !== id) continue;
      if (!best || String(rec.installedAt || '') < String(best.installedAt || '')) best = rec;
    }
    return best;
  }

  /** 合并两份 manifest（按绝对路径去重，新的覆盖旧的） */
  function mergeManifest(a, b) {
    const map = new Map();
    for (const f of (a || [])) if (f && f.path) map.set(String(f.path).toLowerCase(), f);
    for (const f of (b || [])) if (f && f.path) map.set(String(f.path).toLowerCase(), f);
    return Array.from(map.values());
  }

  /**
   * 装「这一套」（包内某个顶层目录）。
   *
   * 用户 2026-11-24：「一个安装包有多个 mod 的如果只选择了其中部分安装，则其余的子 mod
   * 要显示安装按钮」「每个子 mod 都可以单独选择安装或卸载」。
   *
   * 关键：**并入同一条记录**，不新建卡 —— 否则同一个 Mod 会变成两张卡、开关也分家。
   */
  async function installSub({ modId = 0, dir = '', taskId = null } = {}) {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    const L = game.layout(root);
    const { ap, task } = resolveArchive(modId, taskId);
    if (!ap) throw new Error('本地没有这个 Mod 的安装包了，没法单独装这一套');

    const m = { ...(task && task.meta ? task.meta : {}), modId: Number(modId) || null };
    if (task) m.taskId = task.id;
    const ownedPaths = installFlow.ownedPathsFor(registry, m);
    // 先按「整包」分析一次（**不带 pickDir**）：只有整包视角的账本才说得清
    // 「别的几套现在装没装」；带 pickDir 的话 mapping 只剩这一套，另外几套会被记成 0 装。
    let plan = await installer.analyze(root, ap, m, { ownedPaths });
    if (plan && !plan.ok && plan.needsTargetPick && plan.options && plan.options.length
      && plan.hasConflicts === false) {
      const dirs = (plan.defaultPick && plan.defaultPick.length)
        ? plan.defaultPick : plan.options.map(o => o.dir);
      plan = await installer.analyze(root, ap, m, { ownedPaths, pickDirs: dirs });
    }
    if (!plan || !plan.ok) {
      throw new Error((plan && (plan.diagnosis || plan.reason)) || '这一套的结构认不出来，装不了');
    }
    // 整包账本（**过滤前**算）：包内一共几套、每套几个文件、哪几套其实已经在盘上。
    // 老记录的子 Mod 表是后加的字段、可能不全，靠这份补。
    const ledFull = installer.packageLedger(plan);

    // analyze 的 `pickDir` 只管「多套变体挑哪套」；整合包里几个顶层目录各自是一套，
    // 不构成「变体」，于是 mapping 仍会带上所有目录的文件。
    // 单独装某一套时必须自己按「包内顶层目录」过滤，否则一按就把整套都写进去了。
    if (dir) {
      const want = new Set();
      for (const e of (plan.entries || [])) {
        const seg = String(e.rel || '').split('/').filter(Boolean);
        if ((seg.length > 1 ? seg[0] : '') !== dir) continue;
        want.add(installer.fileKey(path.basename(String(e.rel || ''))));
      }
      const only = (plan.mapping || []).filter(x =>
        want.has(installer.fileKey(path.basename(String(x.rel || x.to || '')))));
      if (!only.length) throw new Error(`这个安装包里没有「${dir}」这一套的文件`);
      plan.mapping = only;
      plan.fileCount = only.length;
    }
    const pre = installer.verifyExisting(plan);
    if (pre.present.length && pre.ok) throw new Error('这一套已经在游戏里了，不用再装');

    const r = await installer.install(root, plan, { onConflict: 'overwrite' });
    const nowIso = new Date().toISOString();
    const prev = findRecByModId(m.modId);

    const manifest = mergeManifest(prev && prev.manifest, r.manifest);
    const prevPkg = (prev && prev.pkg) || null;
    const subs = ((prevPkg && prevPkg.subs) || []).map(s => ({ ...s, installedRels: [...(s.installedRels || [])] }));
    // 按整包账本补齐：缺的几套补成空壳，已有的那几套若没记 rel 就把「已在盘上」的 rel 认回来
    for (const s of (ledFull.subs || [])) {
      const have = subs.find(x => String(x.dir) === String(s.dir));
      if (!have) { subs.push({ ...s, installedRels: [...s.installedRels] }); continue; }
      if (!have.entryCount) have.entryCount = s.entryCount;
      if (!have.bytes) have.bytes = s.bytes;
      if (!(have.installedRels || []).length && (s.installedRels || []).length) {
        have.installedRels = [...s.installedRels];
        have.installedCount = s.installedCount;
      }
    }
    let sub = subs.find(s => String(s.dir) === String(dir));
    if (!sub) {
      sub = { dir, entryCount: 0, installedCount: 0, installedRels: [], bytes: 0, installedBytes: 0 };
      subs.push(sub);
    }
    const newRels = r.manifest.map(f => String(f.rel));
    sub.installedRels = Array.from(new Set([...(sub.installedRels || []), ...newRels]));
    sub.installedCount = sub.installedRels.length;
    sub.installedBytes = sub.installedBytes || 0;

    const pkg = {
      ...(prevPkg || {}),
      archivePath: ap,
      entryCount: (prevPkg && prevPkg.entryCount) || (plan.entries || []).length,
      installedCount: manifest.length,
      notInstalled: (prevPkg && prevPkg.notInstalled) || [],
      notInstalledCount: (prevPkg && prevPkg.notInstalledCount) || 0,
      subs,
      at: nowIso
    };

    const patchBody = {
      manifest,
      fileCount: manifest.length,
      size: manifest.reduce((s, f) => s + (f.size || 0), 0),
      enabled: true,
      enabledAt: nowIso,
      backupDir: (prev && prev.backupDir) || r.backupDir || null,
      overwritten: [...((prev && prev.overwritten) || []), ...(r.backed || [])],
      archivePath: ap,
      pkg
    };
    let id = prev && prev.id;
    if (id) {
      registry.patch(id, patchBody);
    } else {
      id = installFlow.registryIdFor(L, plan, manifest, m);
      registry.upsert({
        id, name: m.name || path.basename(ap, path.extname(ap)), kind: plan.kind,
        source: {
          url: m.sourceUrl || m.url || null, modId: m.modId || null, fileId: m.fileId || null,
          author: m.author || null, version: m.version || null, pictureUrl: m.pictureUrl || null
        },
        installedAt: nowIso, target: plan.target, taskId: m.taskId || null,
        requiresCns: !!plan.requiresCns, requiresAtool: !!plan.requiresAtool, prereqKey: plan.prereqKey || null,
        ...patchBody
      });
    }
    invalidateLocalIndex();
    syncLedger();
    const rec = { id, name: m.name || path.basename(ap, path.extname(ap)), kind: plan.kind, meta: { modId: m.modId || null, source: { modId: m.modId || null } } };
    recordMod('install', rec, { detail: '补装子 Mod：' + (dir || '整套') });
    recordMod('enable', rec, { detail: '补装子 Mod：' + (dir || '整套') });
    logger.event('mods:subInstalled', { id, modId: m.modId || null, dir, written: r.written });
    return { id, dir, written: r.written, fileCount: manifest.length, enabled: true };
  }
  handle('mods:installSub', (opts) => installSub(opts || {}));

  /**
   * 现算「这一套在游戏里是哪几个文件」。
   *
   * 0.9.9 之前的记录没有 `pkg.subs`（账本字段是后加的），但它们照样能单独卸载 ——
   * 拿安装包重新分析一遍、逐个核对在位，就能得出这一套对应的 rel。
   */
  async function subRelsNow(modId, dir) {
    const root = currentRoot();
    if (!root) return [];
    const { ap, task } = resolveArchive(modId, null);
    if (!ap) return [];
    const m = { ...(task && task.meta ? task.meta : {}), modId: Number(modId) || null };
    if (task) m.taskId = task.id;
    let plan = await installer.analyze(root, ap, m, {});
    if (plan && !plan.ok && plan.needsTargetPick && plan.options && plan.options.length) {
      const dirs = (plan.defaultPick && plan.defaultPick.length)
        ? plan.defaultPick : plan.options.map(o => o.dir);
      plan = await installer.analyze(root, ap, m, { pickDirs: dirs });
    }
    if (!plan || !plan.ok) return [];
    const want = new Set();
    for (const e of (plan.entries || [])) {
      const seg = String(e.rel || '').split('/').filter(Boolean);
      if ((seg.length > 1 ? seg[0] : '') !== dir) continue;
      want.add(installer.fileKey(path.basename(String(e.rel || ''))));
    }
    const only = (plan.mapping || []).filter(x =>
      want.has(installer.fileKey(path.basename(String(x.rel || x.to || '')))));
    const v = installer.verifyExisting({ ...plan, mapping: only });
    return v.present.map(f => String(f.rel));
  }

  /**
   * 卸「这一套」：只把这一套的文件移进备份目录，其它子 Mod 一根头发都不动。
   *
   * 全卸光之后**记录不删**（用户 2026-11-24：卸载后文件名仍要正常显示、状态变「未安装」、
   * 按钮变「安装」），所以这里只把 manifest 清空、`pkg.subs` 记成 0 装。
   */
  async function uninstallSub({ modId = 0, dir = '' } = {}) {
    const root = currentRoot();
    if (!root) throw new Error('尚未配置有效的游戏目录');
    const rec = findRecByModId(modId);
    if (!rec) throw new Error('游戏里没有这个 Mod 的安装记录');
    const subs = ((rec.pkg && rec.pkg.subs) || []).map(s => ({ ...s, installedRels: [...(s.installedRels || [])] }));
    let sub = subs.find(s => String(s.dir) === String(dir));
    let rels = sub ? (sub.installedRels || []).map(String) : [];
    // 老记录（0.9.9 之前）没有子 Mod 账本：现算一遍，别让用户没法单独卸
    if (!rels.length) rels = await subRelsNow(modId, dir);
    if (!rels.length) throw new Error('这一套已经不在游戏里了');
    if (!sub) {
      sub = { dir, entryCount: rels.length, installedCount: rels.length, installedRels: rels, bytes: 0, installedBytes: 0 };
      subs.push(sub);
    }

    const relSet = new Set(rels);
    const hit = (rec.manifest || []).filter(f => f && relSet.has(String(f.rel)));
    if (!hit.length) throw new Error('没找到这一套对应的文件（记录可能已经过期，刷新一下再看）');

    const dest = path.join(paths.BACKUP, 'uninstalled',
      String(rec.id).replace(/[\\/:*?"<>|]/g, '-') + '-' + Date.now());
    const moved = [];
    for (const f of hit) {
      let src = f.path;
      if (!fs.existsSync(src)) {
        // 关着的 mod 在盘上是 `.disabled` 写法
        const alt = path.join(path.dirname(src), toggleName.counterpartName(path.basename(src)));
        if (fs.existsSync(alt)) src = alt; else continue;
      }
      const to = path.join(dest, path.basename(src));
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        // 备份目录可能在另一个盘（安装包库常年在 D:），必须走 fsMove 而不是 renameSync
        fsMove.movePath(src, to);
        moved.push(path.basename(src));
      } catch (e) {
        throw new Error('移走文件失败：' + path.basename(src) + '（' + e.message + '）');
      }
    }
    if (!moved.length) throw new Error('这一套的文件一个都没找到，可能已经被手动删掉了');

    const keep = (rec.manifest || []).filter(f => f && !relSet.has(String(f.rel)));
    sub.installedRels = [];
    sub.installedCount = 0;
    const pkg = {
      ...(rec.pkg || {}),
      installedCount: keep.length,
      subs,
      at: new Date().toISOString()
    };
    registry.patch(rec.id, {
      manifest: keep,
      fileCount: keep.length,
      size: keep.reduce((s, f) => s + (f.size || 0), 0),
      ...(keep.length ? {} : { enabled: false, disabledAt: new Date().toISOString() }),
      pkg
    });
    invalidateLocalIndex();
    syncLedger();
    recordMod('disable', { id: rec.id, name: rec.name, kind: rec.kind, meta: { modId, source: { modId } } },
      { detail: '卸载子 Mod：' + (dir || '整套') });
    logger.event('mods:subUninstalled', { id: rec.id, modId: Number(modId) || null, dir, moved: moved.length });
    return { id: rec.id, dir, moved: moved.length, remaining: keep.length, backupDir: dest };
  }
  handle('mods:uninstallSub', (opts) => uninstallSub(opts || {}));


  /**
   * 📒 详情页「包内文件」表 —— 把安装包里的每个文件摊开，逐个标「装进游戏了 / 没装」。
   *
   * 用户 2026-11-24：「详细信息里面要记录压缩包内的文件列表，并且记录每个文件是否安装，
   * 能够通过表格一眼看出压缩包里面哪些文件被安装了」「pak/ucas/utoc 三个一组用绿色框、
   * dekcns.json 用蓝色框、其它类型你看着分类、不需要关注的文件不加框」。
   *
   * 数据来源是**安装包本身**（`archive.listEntries`，只读不改、不解压），所以：
   *   · 老记录（没有装过的账本）也能看；
   *   · 包被用户删了就直接说「本地没有这个包」，不猜；
   *   · 「装没装」按**文件名主干**去 `~Mods` 等目录里找 —— 装的时候名字会被加上
   *     `[nx<modId>]` 标识、关掉还会加 `.disabled`，所以不能按原名比。
   */
  async function packageFiles({ modId = 0, taskId = null } = {}) {
    const id = Number(modId) || 0;
    const out = {
      modId: id, archivePath: '', archiveFrom: '', total: 0, shown: 0,
      truncated: false, entries: [], ledger: null, installedCount: 0
    };
    const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };

    // ① 找包：注册表 → 队列任务 → 本地安装包库（与 modFacts 同口径，顺序略调：队列优先，
    //    因为它记的就是「这个 mod 的哪个包」）
    let ap = '';
    try {
      const t = taskId ? engine.get(taskId) : null;
      if (t && exists(t.archivePath)) { ap = t.archivePath; out.archiveFrom = '下载队列'; }
      if (!ap) {
        const tk = engine.list().find(x => Number(x.meta && x.meta.modId) === id && exists(x.archivePath));
        if (tk) { ap = tk.archivePath; out.archiveFrom = '下载队列'; }
      }
    } catch { /* 队列读不到就往下走 */ }
    if (!ap) {
      try {
        for (const rec of registry.all()) {
          if (Number(rec.source && rec.source.modId) !== id) continue;
          if (exists(rec.archivePath)) { ap = rec.archivePath; out.archiveFrom = '注册表'; break; }
        }
      } catch { /* ignore */ }
    }
    if (!ap) {
      try {
        let best = null;
        for (const f of fs.readdirSync(paths.LIBRARY)) {
          const info = localLibrary.parseArchiveName(f);
          if (!info || Number(info.modId) !== id) continue;
          const p = path.join(paths.LIBRARY, f);
          if (!exists(p)) continue;
          let mt = '';
          try { mt = fs.statSync(p).mtime.toISOString(); } catch { /* ignore */ }
          if (!best || mt > best.mt) best = { p, mt };
        }
        if (best) { ap = best.p; out.archiveFrom = '本地库'; }
      } catch { /* 本地库不存在 */ }
    }
    if (!ap) return out;
    out.archivePath = ap;

    // ② 注册表里那份「安装账本」（装的时候写下的，不靠名字）
    try {
      for (const rec of registry.all()) {
        if (Number(rec.source && rec.source.modId) !== id) continue;
        if (rec.pkg) { out.ledger = rec.pkg; break; }
      }
    } catch { /* ignore */ }

    // ③ 盘上现存的文件（按主干索引），用来判断每个包内文件是否装了
    const disk = new Map();
    const addDisk = (dir, rel) => {
      let items = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of items) {
        if (!e.isFile()) continue;
        const stem = installer.fileKey(e.name);
        if (!stem) continue;
        const disabled = /\.disabled$/i.test(e.name);
        let size = 0;
        try { size = fs.statSync(path.join(dir, e.name)).size; } catch { /* ignore */ }
        // 同名两个（一开一关）时，先来的留着：状态以「哪个在生效」为准，界面另有 disabled 标记
        if (!disk.has(stem)) disk.set(stem, { name: e.name, disabled, size, rel: rel + '/' + e.name });
      }
    };
    let root = '';
    try { root = currentRoot() || ''; } catch { root = ''; }
    if (root) {
      const L = game.layout(root);
      addDisk(L.modsDir, '~Mods');
      if (L.logicModsDir) addDisk(L.logicModsDir, 'LogicMods');
      if (L.paks) addDisk(L.paks, 'Paks');
      if (L.win64) addDisk(L.win64, 'Win64');
    }

    // ④ 摊开包内文件
    const KIND_OF = (name) => {
      const b = String(name || '');
      if (/\.pak$/i.test(b)) return 'pak';
      if (/\.ucas$/i.test(b)) return 'ucas';
      if (/\.utoc$/i.test(b)) return 'utoc';
      if (/\.(dekcns|dekani)(\.json)?$/i.test(b)) return 'cns';
      if (/\.(txt|md|pdf|docx?|rtf|htm|html)$/i.test(b)) return 'doc';
      if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(b)) return 'img';
      return 'other';
    };
    const VERIFY = new Set(['pak', 'ucas', 'utoc', 'cns']);

    let list = [];
    try { list = await archive.listEntries(ap); } catch { list = { entries: [] }; }
    const files = ((list && list.entries) || []).filter(e => !e.dir);
    out.total = files.length;

    const MAX = 800;
    const shown = files.slice(0, MAX);
    out.truncated = files.length > MAX;
    out.shown = shown.length;
    for (const e of shown) {
      const rel = String(e.path || '');
      const base = path.basename(rel);
      const kind = KIND_OF(base);
      const seg = rel.split('/').filter(Boolean);
      const top = seg.length > 1 ? seg[0] : '';
      let state = 'na';       // na = 这类文件不判断（脚本 / dll 等分散在子目录里）
      let off = false;
      let onDisk = '';
      if (VERIFY.has(kind)) {
        const hit = disk.get(installer.fileKey(base));
        if (hit) { state = 'in'; off = hit.disabled; onDisk = hit.rel; }
        else state = 'no';
      } else if (kind === 'doc' || kind === 'img') {
        state = 'skip';       // 说明文档 / 预览图：本来就不装，不算「少装」
      }
      if (state === 'in') out.installedCount++;
      out.entries.push({ rel, name: base, size: Number(e.size) || 0, kind, state, disabled: off, top, onDisk });
    }
    return out;
  }
  handle('mods:packageFiles', (opts) => packageFiles(opts || {}));

  /**
   * 管理器自带安装包的盘点：`data/library` 里那些包，哪些现在能装进当前游戏目录。
   *
   * 下载队列只是「任务账本」，用户点了「清理已完成记录」之后就什么都不剩了，
   * 可安装包一直在 library 里（0.3.4 起这个目录不跟着游戏走）。这一条通道直接看磁盘，
   * 让「下好了没装」在清空队列、换游戏目录、甚至换机器之后都还看得见。
   */
  handle('library:list', () => {
    const r = localLibrary.scan({
      dir: paths.LIBRARY,
      root: currentRoot(),
      entries: registry.all(),
      tasks: engine.list()
    });
    /*
     * 顺手把本地已有的信息挂到每个包上：卡片一开就有名字/作者/封面，
     * 不用等 ensureLibMeta 去联网补（那一条只在真缺信息时才发请求）。
     */
    try {
      const store = modInfoStore();
      const cat = catalogById();
      for (const it of (r.items || [])) {
        const id = Number(it.modId);
        if (!id) continue;
        let rec = store.get(id);
        if (!rec) {
          const entry = cat.get(id);
          if (entry) rec = store.put(fromCatalog(entry));
        }
        if (!rec) continue;
        it.info = {
          name: rec.name || '',
          author: rec.author || '',
          version: rec.version || '',
          summary: rec.summary || '',
          image: rec.pictureUrl || '',
          coverLocal: store.coverUrlOf(rec) || '',
          url: rec.url || '',
          category: rec.category || '',
          categoryZh: rec.categoryZh || '',
          adult: !!rec.adult,
          downloads: Number(rec.downloads) || 0,
          endorsements: Number(rec.endorsements) || 0,
          updatedAt: rec.updatedAt || '',
          fromCache: true
        };
      }
    } catch { /* 挂不上就按老样子显示文件名 */ }

    /*
     * 两件「后台慢慢变本地」的事，都不挡这次返回：
     *   ① 有信息但封面还在 CDN 上的，把封面存下来；
     *   ② 连信息都没有的包，一次补 6 个（补到就落盘，下次纯本地）。
     * 队列被清过、换过目录也不会重复补：补到的那条已经有档案了。
     */
    try { warmCovers((r.items || [])
      .filter(it => it.info && it.info.image)
      .map(it => ({ modId: Number(it.modId), pictureUrl: it.info.image, coverFile: '' }))); } catch {}
    try {
      const lacking = (r.items || [])
        .filter(it => Number(it.modId) && !it.info && !libraryWarmTried.has(Number(it.modId)))
        .map(it => Number(it.modId))
        .slice(0, 6);
      if (lacking.length) {
        for (const id of lacking) libraryWarmTried.add(id);
        setTimeout(() => { infoFill(lacking).catch(() => {}); }, 60);
      }
    } catch { /* 补不到就按文件名显示 */ }
    return r;
  });
  /** 把 library 里的某个包装进当前游戏目录（复用「本地压缩包进队列」那条路） */
  handle('library:install', (archivePath, meta, opts) => {
    const r = engine.enqueueLocal(archivePath, meta || {}, { auto: true, from: 'library', ...(opts || {}) });
    broadcastDownloads(r.task);
    return r;
  });
  /**
   * 安装包目录本身：路径 + 里面有多少包 + 有多少还能装。
   *
   * 为什么要专门一条：默认的安装包目录在**管理器数据目录**下
   * （打包版是 `%APPDATA%\剑星 Mod 管理器\data\library`），
   * 而很多人把包攒在别的盘（开发时是仓库里的 `data\library`），
   * 两边不是同一个目录 —— 用户会以为「识别不到」。设置页把它显出来、可改。
   */
  handle('library:info', () => {
    const scan = localLibrary.scan({
      dir: paths.LIBRARY,
      root: currentRoot(),
      entries: registry.all(),
      tasks: engine.list()
    });
    let size = 0;
    try {
      for (const f of fs.readdirSync(paths.LIBRARY, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        try { size += fs.statSync(path.join(paths.LIBRARY, f.name)).size; } catch { /* 单个读不到就跳过 */ }
      }
    } catch { /* 目录不在就 0 */ }
    return {
      dir: paths.LIBRARY,
      default: paths.DEFAULT_LIBRARY,
      configured: paths.LIBRARY_CONFIGURED,
      exists: scan.exists,
      total: scan.total,
      installable: scan.installable,
      skipped: scan.skipped,
      size
    };
  });
  /** 弹框选一个安装包目录（不挂主窗口） */
  handle('library:choose', async (opts) => {
    const o = opts || {};
    const r = await dialog.showOpenDialog({
      title: '选择安装包目录',
      defaultPath: o.defaultPath || paths.LIBRARY,
      buttonLabel: '用这个目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
    return r.filePaths[0];
  });
  /** 把安装包目录指到别处（传空 = 恢复默认）；重启后生效 */
  handle('library:setDir', (dir) => {
    const r = paths.setLibraryDir(dir);
    logger.event('data:libraryDir', { dir: r.dir, custom: r.custom });
    return { ...r, restart: true };
  });

  // ===== 安装包目录搬家（m17590）=====
  // 只搬压缩包、真搬家（删源）、同名冲突三档、进度事件、断点续传。核心在 libraryMigrate.js。
  /** 预检：列要搬的包、算体积/冲突，看看目标目录有没有可续传的旧清单 */
  handle('library:migratePlan', (destDir) => {
    const p = libraryMigrate.plan(paths.LIBRARY, destDir);
    return p;
  });
  /** 开始/继续搬家。异步跑，进度用 library:migrateProgress 事件推给界面。 */
  handle('library:migrateStart', async (opts) => {
    const o = opts || {};
    if (migrateJob && migrateJob.running) throw new Error('已经有一个搬家任务在跑了');
    const controller = { aborted: false };
    const job = { running: true, controller };
    migrateJob = job;
    const onProgress = (p) => sendToMain('library:migrateProgress', p || {});
    try {
      const r = await libraryMigrate.migrate({
        srcDir: paths.LIBRARY,
        destDir: o.destDir,
        mode: o.mode || 'skip-same',
        resume: !!o.resume,
        signal: controller,
        onProgress
      });
      // 搬完：把安装包目录指针指向新位置（重启后生效），源目录的空壳留着不删（用户可自行清理）
      if (!r.aborted && r.failed === 0) {
        try {
          const set = paths.setLibraryDir(path.resolve(o.destDir));
          logger.event('data:libraryMigrated', { from: paths.LIBRARY, to: set.dir, ...r });
        } catch (e) { logger.write('[搬家] 写安装包目录指针失败：' + e.message); }
      } else {
        logger.event('data:libraryMigrateIncomplete', { aborted: r.aborted, failed: r.failed });
      }
      return r;
    } finally {
      job.running = false;
      if (migrateJob === job) migrateJob = null;
    }
  });
  /** 取消当前搬家（下一个文件边界停下，已搬的不回滚） */
  handle('library:migrateCancel', () => {
    if (!migrateJob || !migrateJob.running) return { ok: false, message: '当前没有在跑的搬家任务' };
    migrateJob.controller.aborted = true;
    return { ok: true };
  });

  /**
   * 删掉管理器里的一份安装包（「已下载」卡片上的「删除」）。
   * 只允许删安装包目录里的压缩包 —— 前端传来的路径一律不信，重新按目录判一次。
   * 已经装进游戏的文件一律不碰（那是 uninstall 的活）。
   */
  handle('library:remove', (archivePath) => {
    const raw = String(archivePath || '');
    if (!raw) throw new Error('没有指定安装包路径');
    const libRoot = path.resolve(paths.LIBRARY);
    const abs = path.resolve(raw);
    const lowAbs = abs.toLowerCase();
    const lowRoot = libRoot.toLowerCase();
    if (lowAbs !== lowRoot && !lowAbs.startsWith(lowRoot + path.sep)) {
      throw new Error('只能删安装包目录里的文件（当前目录：' + paths.LIBRARY + '）');
    }
    if (!/\.(zip|7z|rar)$/i.test(abs)) throw new Error('只能删压缩包（zip / 7z / rar）');
    if (!fs.existsSync(abs)) throw new Error('这个安装包已经不在了：' + path.basename(abs));
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error('不是文件，没法删：' + path.basename(abs));
    // 队列里还挂着指向它的任务（下载失败 / 取消那种）就一起清掉，别留悬空记录
    for (const t of engine.list()) {
      if (!t.archivePath) continue;
      if (path.resolve(t.archivePath).toLowerCase() !== lowAbs) continue;
      if (t.status === 'installed') continue;
      try { engine.remove(t.id, { deleteArchive: false }); } catch { /* 清不掉也不影响删包 */ }
    }
    fs.unlinkSync(abs);
    logger.event('library:removed', { file: path.basename(abs), size: st.size });
    return { removed: true, file: path.basename(abs), size: st.size };
  });
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
    // 生命周期：加入下载队列（下载事件按 modId 记，和后续安装/开关用 modId 关联）
    try {
      if (modHistory && meta.modId && !r.duplicate) {
        modHistory.add('download', {
          id: 'mod:' + Number(meta.modId),
          modId: Number(meta.modId),
          name: meta.name || '',
          detail: '加入下载队列' + (meta.fileId ? '（文件 ' + meta.fileId + '）' : '')
        });
      }
    } catch { /* 记录失败不影响下载 */ }
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
  /**
   * 只读本地的那份图集（0.4.9）：不发任何网络请求。
   * 渲染层先用它把「已经存下来的图」立刻画出来，没有才去 `mod:images` 抓。
   */
  /**
   * 批量问「这一批 Mod 有没有本地封面」（0.7.9）。
   *
   * 已安装 / 已下载的卡片只有 modId，手里没有图片地址；而图集早就存在
   * `data/cache/images/<modId>/` 里（详情抽屉能看到，卡片却是「无封面图」）。
   * 所以这里一次性把一批 modId 的本地第一张图换成 file:// 地址交出去 ——
   * 纯读磁盘，不联网；查过的 id 记在缓存里，避免每次重画都把目录扫一遍。
   */
  handle('images:covers', async (modIds) => {
    const ids = (Array.isArray(modIds) ? modIds : [])
      .map(x => Number(x)).filter(x => Number.isFinite(x) && x > 0).slice(0, 400);
    const out = {};
    for (const id of ids) {
      const hit = coverCache.get(id);
      if (hit !== undefined) {
        if (hit.url && Date.now() - hit.at < 10 * 60 * 1000) out[id] = hit.url;
        else if (hit.url) { coverCache.delete(id); }
        else if (Date.now() - hit.at < 60 * 1000) continue;   // 「没有图」这类结论只信一分钟
        else { coverCache.delete(id); }
        if (out[id]) continue;
      }
      let url = '';
      try {
        const list = await imageCache().listCached(id);
        const first = (list || []).find(x => x && x.localUrl);
        if (first) url = first.localUrl;
      } catch { /* 读不到就当没有 */ }
      if (!url) {
        try {
          const rec = modInfoStore().get(id);
          if (rec && rec.coverFile) url = require('url').pathToFileURL(rec.coverFile).href;
        } catch { /* 同上 */ }
      }
      coverCache.set(id, { url, at: Date.now() });
      if (url) out[id] = url;
    }
    return out;
  });

  handle('mod:imagesDisk', (modId) => {
    const id = Number(modId);
    if (!Number.isFinite(id) || id <= 0) return [];
    try {
      return imageCache().listCached(id).then(list => (list || [])
        .filter(x => x && x.localUrl)
        .map(x => ({ localUrl: x.localUrl, url: x.url, path: x.path, mime: x.mime, size: x.size })));
    } catch {
      return [];
    }
  });

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
    // 生命周期：安装完成（新建一条以安装 id 为键的记录；modId 来自本次安装的元数据）
    try {
      if (modHistory && r && r.id) {
        modHistory.add('install', {
          id: r.id,
          modId: Number(meta.modId) || 0,
          name: meta.name || '',
          detail: '安装到游戏目录'
        });
        // 装完即启用：安装流程里 installFlow 会写 enabledAt，这里补一条 enable 事件
        modHistory.add('enable', {
          id: r.id,
          modId: Number(meta.modId) || 0,
          name: meta.name || '',
          detail: '安装后默认启用'
        });
      }
    } catch { /* 记录失败不影响安装 */ }
    invalidateLocalIndex();
    // 装完立刻把账本同步到游戏目录（搬移/换机器时靠它恢复）
    syncLedger(root);

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

  // ---- 「这个 Mod 有 bug」标记（卸载时打记号，防止再装进去）----
  handle('bugs:list', () => bugFlags.all());
  handle('bugs:ids', () => bugFlags.ids());
  handle('bugs:add', (modId, meta) => bugFlags.add(modId, meta || {}));
  handle('bugs:remove', (modId) => bugFlags.remove(modId));
  handle('verified:list', () => verifiedFlags.all());
  handle('verified:ids', () => verifiedFlags.ids());
  handle('verified:add', (modId, meta) => verifiedFlags.add(modId, meta || {}));
  handle('verified:remove', (modId) => verifiedFlags.remove(modId));
  /* 浏览页「喜欢」（👍）—— 与黑名单同形、同为纯本地。
     用户 2026-10-14：「mod 图标上增加喜欢按钮，与不喜欢对应」。 */
  handle('favorites:list', () => favorites.all());
  handle('favorites:ids', () => favorites.ids());
  handle('favorites:add', (modId, meta) => favorites.add(modId, meta || {}));
  handle('favorites:remove', (modId) => favorites.remove(modId));

  /* Mod 生命周期事件档案（下载/安装/开启/禁用/卸载流水 + 每 Mod 关键时刻） */
  handle('history:events', (opts) => modHistory.events(opts || {}));
  handle('history:mod', (id) => modHistory.mod(id));
  handle('history:forMod', (id, limit) => modHistory.forMod(id, limit));
  handle('history:forModId', (modId, limit) => modHistory.forModId(modId, limit));
  handle('history:mods', () => modHistory.mods());
  handle('history:statesByModId', () => modHistory.statesByModId());
  handle('history:enabledBetween', (since, until) => modHistory.enabledBetween(since, until));
  handle('history:backfill', (items) => {
    const n = modHistory.backfill(items);
    try { logger.event('mods:backfillHistory', { count: n }); } catch { /* 忽略 */ }
    return n;
  });
  handle('history:clear', () => modHistory.clear());

  handle('nexus:detail', (modId) => nexus.getMod(modId));
  /**
   * Mod 基本信息的本地档案：
   *   info:local 永不联网（档案 → Nexus 目录缓存），用来喂列表和详情；
   *   info:fill  只补本地缺的那几条（≤6 条），补到就落盘，封面一并存进图片缓存。
   */
  handle('info:local', (modIds) => infoLocal(modIds));
  handle('info:fill', (modIds) => infoFill(modIds));
  /**
   * 翻译成功后把中文译文写进 mod-info 档案（m15651：翻一次永久保留，不再重翻）。
   * 只写 descriptionZh / summaryZh 两个字段，合并写，不抹掉别的信息。
   */
  handle('info:saveTranslation', ({ modId, descriptionZh, summaryZh } = {}) => {
    const id = Number(modId) || 0;
    if (!id) return null;
    const patch = { modId: id };
    if (typeof descriptionZh === 'string') patch.descriptionZh = descriptionZh;
    if (typeof summaryZh === 'string') patch.summaryZh = summaryZh;
    return modInfoStore().put(patch);
  });
  handle('nexus:files', (modId) => nexus.getModFiles(modId));
  handle('nexus:parseUrl', (url) => parseNexusUrl(url));
  handle('nexus:clearCache', () => { nexus.clearCache(); return true; });

  /* 批量解析：把手工丢进来的本地 Mod 与 Nexus 上的条目对上号
     —— 只补「基本信息」（名字/作者/版本/封面/简介/链接），不动文件、不碰注册表 */
  handle('linker:state', () => linkState());
  handleWithEvent('linker:resolve', (event, opts) => resolveLinks(event, opts || {}));
  handle('linker:cancel', () => {
    if (linkingJob) linkingJob.cancelled = true;
    return { cancelled: !!(linkingJob && linkingJob.cancelled) };
  });
  handle('linker:apply', (entries) => applyLinks(entries));
  handle('linker:unlink', (localId) => unlinkLocal(localId));
  handle('linker:search', (query, limit) => searchCatalog(query, limit));

  /* 翻译 */
  handleWithEvent('translate:text', (event, text, lang) =>
    translator.translate(text, lang, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('translate:progress', p);
    }));
  handle('translate:stats', () => translator.stats());
  handle('translate:clear', () => { translator.clear(); return true; });
}

module.exports = { register, handleIncomingNxm };
