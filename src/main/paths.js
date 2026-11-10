'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Electron 的 userData 目录（= `%APPDATA%\<productName>`）。
 *
 * 纯 Node 进程（`_probe/*.js` 的断言测试）里 `require('electron')` 返回的是
 * 「electron 可执行文件路径」这个**字符串**，解构出来的 `app` 是 undefined ——
 * 正好走 fallback，所以这里的判断不会影响断言。
 */
function userDataDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('userData');
  } catch { /* 纯 Node 环境 */ }
  return path.join(ROOT, '.userdata');
}

/**
 * 「指针文件」：记住用户把数据目录改到哪了（设置页可改）。
 *
 * ⚠️ 它**必须放在固定位置**，不能放在数据目录里面 —— 否则一旦改了数据目录，
 *    就再也找不到「用户改过」这件事，下次启动又会回到默认目录。
 *    所以放在 userData 下，和数据目录本身无关。
 */
const BOOTSTRAP = path.join(userDataDir(), 'data-location.json');

/**
 * 默认数据目录。
 *
 * 开发时放在项目里的 `data/`（方便直接看文件）；
 * **打包成 exe 之后必须换到 `userData`** —— 因为 `__dirname` 那时在 `app.asar` 里，
 * 往里面写文件是写不进去的（asar 是只读归档）。
 */
function defaultDataDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function' && app.isPackaged) {
      return path.join(app.getPath('userData'), 'data');
    }
  } catch { /* 纯 Node 环境，用项目内的 data/ */ }
  return path.join(ROOT, 'data');
}

const DEFAULT_DATA = defaultDataDir();

/**
 * 从「指针文件」的内容里挑出真正要用的数据目录。
 *
 * **纯函数**（不碰文件系统）—— 所有判定分支都可以直接断言，见 `_probe/datadir-test.js`。
 *
 * 任何一条不满足都**回落到默认目录**，并把原因写进 `reason`：
 *   · 文件不存在 / 空            → `''`
 *   · 内容不是合法 JSON          → `bad-json`
 *   · `dataDir` 是空串 / 非字符串 → `empty`
 *   · 不是绝对路径（用户手改成了相对路径）→ `not-absolute`
 *   · 指向的就是默认目录本身     → `same-as-default`
 *
 * ⚠️ 故意**不检查目录是否存在**：数据放在移动硬盘 / 网络盘上时，
 *    盘没插不该把设置丢掉（插上重启即可）。可用性在 `canUseDir()` 里单独判。
 *
 * @param {string} content 指针文件的原始文本（空串 = 没有）
 * @param {string} def     默认数据目录（绝对路径）
 * @returns {{ dir: string, source: 'default'|'custom', reason: string }}
 */
function pickDataDir(content, def) {
  if (!content) return { dir: def, source: 'default', reason: '' };

  let json;
  try { json = JSON.parse(content); }
  catch { return { dir: def, source: 'default', reason: 'bad-json' }; }

  const raw = json && typeof json.dataDir === 'string' ? json.dataDir.trim() : '';
  if (!raw) return { dir: def, source: 'default', reason: 'empty' };
  if (!path.isAbsolute(raw)) return { dir: def, source: 'default', reason: 'not-absolute' };

  const norm = path.resolve(raw);
  if (norm.toLowerCase() === path.resolve(def).toLowerCase()) {
    return { dir: def, source: 'default', reason: 'same-as-default' };
  }
  return { dir: norm, source: 'custom', reason: '' };
}

/** 读指针文件（读不到就是空串） */
function readBootstrap() {
  try { return fs.readFileSync(BOOTSTRAP, 'utf8'); } catch { return ''; }
}

/**
 * 指针文件的完整内容（不只是 dataDir —— 现在还记 `gameRoot`）。
 * 读不到 / 坏了都当空对象，绝不抛。
 */
function readPointer() {
  const raw = readBootstrap();
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    return (j && typeof j === 'object') ? j : {};
  } catch { return {}; }
}

/**
 * 把「游戏目录」记进指针文件（只改这一个字段，别的字段原样保留）。
 *
 * 为什么要有它：数据现在优先放在 `<游戏根>\.sbmod\`（跟着游戏走），
 * 但**启动那一刻得先知道游戏在哪**才能去读那里的 config.json —— 这就是那个死结。
 * 指针文件放在固定位置（userData，纯文件，不碰注册表）只负责回答「上次游戏在哪儿」，
 * 真正的数据（配置、安装账本、关联、账本）全在游戏目录里。
 */
function setGameRootHint(root) {
  const cur = readPointer();
  const next = { ...cur };
  const clean = typeof root === 'string' ? root.trim() : '';
  if (clean) next.gameRoot = path.resolve(clean); else delete next.gameRoot;
  next.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(BOOTSTRAP), { recursive: true });
    fs.writeFileSync(BOOTSTRAP, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  } catch { return cur; }
}

/** 游戏目录里那份「跟着走」的数据目录名 */
const GAME_HOME_DIR = '.sbmod';

/** `<游戏根>\.sbmod` */
function gameHomeOf(root) {
  return root ? path.join(root, GAME_HOME_DIR) : '';
}

/** 游戏目录里那份数据算「存在」的标志文件 */
function gameHomeConfigOf(root) {
  return root ? path.join(gameHomeOf(root), 'config.json') : '';
}

/** 游戏目录里是否已经有一套数据（有 config.json 就算） */
function gameHomeReady(root) {
  if (!root || !path.isAbsolute(root)) return false;
  try { return fs.statSync(gameHomeConfigOf(root)).isFile(); } catch { return false; }
}


/**
 * 目录能不能真的用：建得出来、并且写得进去。
 * 自定义目录指向一个不存在的盘符（比如拔掉的移动硬盘）时这里会失败。
 */
function canUseDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.sbmm-write-test');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

const picked = pickDataDir(readBootstrap(), DEFAULT_DATA);

/** 用户**配置**的数据目录（= 指针文件里写的），即使它当前不可用 */
const DATA_CONFIGURED = picked.source === 'custom' ? picked.dir : '';
/** 数据从哪来：'default'（管理器目录）| 'custom'（用户指定）| 'game'（游戏目录里跟着走的那份） */
let DATA_SOURCE = picked.source;
/** 最终**实际**使用的数据目录 */
let DATA = picked.dir;
/** 指针文件被忽略的原因（'' = 正常采纳） */
let DATA_REASON = picked.reason;

// 自定义目录建不出来（盘符不在 / 没权限 / 只读）→ 回落默认，
// 至少让程序能启动；设置页会看到「配置的目录不可用，已临时用默认」。
if (DATA_SOURCE === 'custom' && !canUseDir(DATA)) {
  DATA = DEFAULT_DATA;
  DATA_SOURCE = 'default';
  DATA_REASON = 'unusable';
}

/**
 * 缓存 / 日志 / 下载好的压缩包这些「体积大、丢了还能再生」的东西**永远跟着管理器走**。
 * 只有配置与账本跟着游戏走 —— 免得往游戏目录里塞几百 MB 图片缓存。
 */
const APP_DATA = DATA;

/** 指针里记的游戏目录（启动时靠它找到 `<游戏根>\.sbmod`） */
const POINTER = readPointer();
let GAME_ROOT = typeof POINTER.gameRoot === 'string' ? POINTER.gameRoot.trim() : '';
if (!GAME_ROOT || !path.isAbsolute(GAME_ROOT)) GAME_ROOT = '';
/** `<游戏根>\.sbmod`（没有游戏目录时是空串） */
let GAME_HOME = GAME_ROOT ? gameHomeOf(GAME_ROOT) : '';
/** 游戏目录里是否已经有一套数据 */
let GAME_HOME_READY = GAME_ROOT ? gameHomeReady(GAME_ROOT) : false;

// **优先游戏目录**：只要那儿有 config.json 就用它 —— 这是「配置跟着游戏走」的落点。
// 例外：用户显式把数据目录指到了别处（custom），以用户为准。
if (DATA_SOURCE !== 'custom' && GAME_HOME_READY && canUseDir(GAME_HOME)) {
  DATA = GAME_HOME;
  DATA_SOURCE = 'game';
  DATA_REASON = '';
}

/**
 * 哪些文件属于「跟着游戏走」的那份状态。
 * 其余（cache / library / tmp / backup / logs）都留在 APP_DATA。
 */
const STATE_NAMES = [
  'config.json', 'mods.json', 'mod-links.json', 'blacklist.json',
  'favorites.json', 'downloads.json', 'watch-seen.json', 'ledger.json',
  'bugs.json', 'verified.json'
];

/**
 * 某个状态文件在游戏目录里的镜像路径；不需要镜像（或本来就是它自己）时返回空串。
 * 写文件时统一走这条判断，见 `store.writeJson()` 里挂的 mirror。
 */
function homeMirrorOf(file) {
  if (!GAME_HOME) return '';
  const name = path.basename(file);
  if (!STATE_NAMES.includes(name)) return '';
  if (path.dirname(path.resolve(file)).toLowerCase() === path.resolve(GAME_HOME).toLowerCase()) return '';
  return path.join(GAME_HOME, name);
}

/**
 * 把数据目录改到别处（传空 = 恢复默认）。
 *
 * ⚠️ **重启后生效** —— `DATA` 与下面那一串路径常量都是模块加载时算好的，
 *    各模块（store / logger / imageCache / downloadQueue…）也都在加载时取过一遍，
 *    热切换意味着要重建整条链路。搬运完提示重启是最稳的。
 */
function setDataDir(dir) {
  if (!dir) {
    // 恢复默认：把 dataDir 去掉。**但游戏目录的指针要留着** —— 不然下次启动
    // 就找不到 `<游戏根>\.sbmod` 了（数据跟着游戏走全靠它）。
    // 没有 gameRoot 要记的时候，仍旧把指针文件整个删掉（保持老行为）。
    const cur = readPointer();
    delete cur.dataDir;
    delete cur.updatedAt;
    if (!cur.gameRoot) {
      try { fs.unlinkSync(BOOTSTRAP); } catch { /* 本来就没有 */ }
      return { dir: DEFAULT_DATA, source: 'default' };
    }
    cur.updatedAt = new Date().toISOString();
    try {
      fs.mkdirSync(path.dirname(BOOTSTRAP), { recursive: true });
      fs.writeFileSync(BOOTSTRAP, JSON.stringify(cur, null, 2) + '\n', 'utf8');
    } catch { /* 写不进去就维持现状 */ }
    return { dir: DEFAULT_DATA, source: 'default' };
  }
  const norm = path.resolve(dir);
  const cur = readPointer();
  fs.mkdirSync(path.dirname(BOOTSTRAP), { recursive: true });
  fs.writeFileSync(BOOTSTRAP, JSON.stringify({ ...cur, dataDir: norm }, null, 2) + '\n', 'utf8');
  return { dir: norm, source: 'custom' };
}

/**
 * 「安装包目录」—— 下载好的 zip/7z/rar 都放这儿。
 *
 * 默认跟着管理器走（`<管理器数据目录>\library`），因为它是**缓存**级的体积大户
 * （用户那边已经 14 GB），不该塞进游戏目录、也不该跟着游戏搬。
 * 但很多人的包攒在别的盘上，所以允许在设置页指到任意目录：
 * 指针文件里存 `libraryDir`，启动时用；不是绝对路径或建不出来就回落默认。
 */
const LIBRARY_CONFIGURED = (() => {
  const raw = typeof POINTER.libraryDir === 'string' ? POINTER.libraryDir.trim() : '';
  if (!raw || !path.isAbsolute(raw)) return '';
  return path.resolve(raw);
})();
/** 默认安装包目录（= 管理器数据目录下的 library） */
const DEFAULT_LIBRARY = path.join(APP_DATA, 'library');
/** 实际使用的安装包目录 */
const LIBRARY = LIBRARY_CONFIGURED && canUseDir(LIBRARY_CONFIGURED) ? LIBRARY_CONFIGURED : DEFAULT_LIBRARY;

const CACHE = path.join(APP_DATA, 'cache');
const IMAGES = path.join(CACHE, 'images');
const GALLERY = path.join(CACHE, 'gallery');
const META = path.join(CACHE, 'meta');
const TMP = path.join(APP_DATA, 'tmp');
const BACKUP = path.join(APP_DATA, 'backup');
const LOGS = path.join(APP_DATA, 'logs');

/**
 * 把「安装包目录」改到别处（传空 = 恢复默认）。
 *
 * 和 `setDataDir()` 一样：路径常量在模块加载时就算好了，所以**重启后生效**。
 * 只动指针文件里的 `libraryDir` 一个字段，别的字段（dataDir / gameRoot）原样留着。
 */
function setLibraryDir(dir) {
  const cur = readPointer();
  const clean = typeof dir === 'string' ? dir.trim() : '';
  if (!clean) delete cur.libraryDir;
  else cur.libraryDir = path.resolve(clean);
  cur.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(BOOTSTRAP), { recursive: true });
    fs.writeFileSync(BOOTSTRAP, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  } catch (e) {
    throw new Error('写不进配置文件（' + BOOTSTRAP + '）：' + e.message);
  }
  return { dir: clean ? path.resolve(clean) : DEFAULT_LIBRARY, custom: !!clean };
}

function ensure() {
  for (const d of [APP_DATA, DATA, CACHE, IMAGES, GALLERY, META, LIBRARY, TMP, BACKUP, LOGS]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* 游戏目录不可写时别拦启动 */ }
  }
}

/**
 * 游戏里可能放 Mod 的三个位置，**顺序即优先级**。
 *
 * 抽出来是因为两个地方要用同一份判断：打开 Mod 目录（界面按钮），
 * 以及将来任何「先看 ~Mods、没有再退到 LogicMods」的动作 —— 各写一遍迟早走岔。
 */
function modDirsOf(root) {
  const r = String(root || '');
  if (!r) return [];
  return [
    path.join(r, 'SB', 'Content', 'Paks', '~Mods'),
    path.join(r, 'SB', 'Content', 'Paks', 'LogicMods'),
    path.join(r, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods')
  ];
}

module.exports = {
  modDirsOf,
  ROOT, DATA, CACHE, IMAGES, GALLERY, META, LIBRARY, TMP, BACKUP, LOGS,
  ensure,

  // —— 数据目录可配置相关 ——
  DEFAULT_DATA,          // 默认位置（界面上「恢复默认」的落脚点）
  APP_DATA,              // 缓存/日志/下载包所在（永远跟着管理器）
  DATA_SOURCE,           // 'default' | 'custom' | 'game'
  DATA_REASON,           // 指针文件被忽略的原因（'' = 正常）
  DATA_CONFIGURED,       // 配置的自定义目录（不可用时也保留原值，供界面提示）
  BOOTSTRAP_FILE: BOOTSTRAP,
  userDataDir, defaultDataDir, pickDataDir, readBootstrap, canUseDir, setDataDir,

  // —— 安装包目录可配置相关 ——
  DEFAULT_LIBRARY,       // 默认安装包目录（= APP_DATA/library）
  LIBRARY_CONFIGURED,    // 用户指定的安装包目录（'' = 用默认）
  setLibraryDir,

  // —— 跟着游戏走的那份数据 ——
  GAME_HOME_DIR, STATE_NAMES,
  GAME_ROOT, GAME_HOME, GAME_HOME_READY,
  gameHomeOf, gameHomeConfigOf, gameHomeReady, homeMirrorOf,
  readPointer, setGameRootHint,

  configFile: path.join(DATA, 'config.json'),
  registryFile: path.join(DATA, 'mods.json'),
  modLinksFile: path.join(DATA, 'mod-links.json'),
  downloadQueueFile: path.join(DATA, 'downloads.json'),
  watchSeenFile: path.join(DATA, 'watch-seen.json'),
  blacklistFile: path.join(DATA, 'blacklist.json'),
  favoritesFile: path.join(DATA, 'favorites.json'),
  /** 「这个 Mod 有 bug」标记（跟着游戏走的 `bugs.json`，见 bugFlag.js） */
  bugsFile: path.join(DATA, 'bugs.json'),
  /** 「我实测过能用」标记（跟着游戏走的 `verified.json`，见 verified.js） */
  verifiedFile: path.join(DATA, 'verified.json'),
  translateCache: path.join(CACHE, 'translate.json'),
  nexusCache: path.join(CACHE, 'nexus.json'),
  nexusCatalog: path.join(CACHE, 'nexus-catalog.json')
};
