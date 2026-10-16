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
/** 用户是改过位置，还是用的默认 */
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
 * 把数据目录改到别处（传空 = 恢复默认）。
 *
 * ⚠️ **重启后生效** —— `DATA` 与下面那一串路径常量都是模块加载时算好的，
 *    各模块（store / logger / imageCache / downloadQueue…）也都在加载时取过一遍，
 *    热切换意味着要重建整条链路。搬运完提示重启是最稳的。
 */
function setDataDir(dir) {
  if (!dir) {
    try { fs.unlinkSync(BOOTSTRAP); } catch { /* 本来就没有 */ }
    return { dir: DEFAULT_DATA, source: 'default' };
  }
  const norm = path.resolve(dir);
  fs.mkdirSync(path.dirname(BOOTSTRAP), { recursive: true });
  fs.writeFileSync(BOOTSTRAP, JSON.stringify({ dataDir: norm }, null, 2) + '\n', 'utf8');
  return { dir: norm, source: 'custom' };
}

const CACHE = path.join(DATA, 'cache');
const IMAGES = path.join(CACHE, 'images');
const GALLERY = path.join(CACHE, 'gallery');
const META = path.join(CACHE, 'meta');
const LIBRARY = path.join(DATA, 'library');
const TMP = path.join(DATA, 'tmp');
const BACKUP = path.join(DATA, 'backup');
const LOGS = path.join(DATA, 'logs');

function ensure() {
  for (const d of [DATA, CACHE, IMAGES, GALLERY, META, LIBRARY, TMP, BACKUP, LOGS]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

module.exports = {
  ROOT, DATA, CACHE, IMAGES, GALLERY, META, LIBRARY, TMP, BACKUP, LOGS,
  ensure,

  // —— 数据目录可配置相关 ——
  DEFAULT_DATA,          // 默认位置（界面上「恢复默认」的落脚点）
  DATA_SOURCE,           // 'default' | 'custom'
  DATA_REASON,           // 指针文件被忽略的原因（'' = 正常）
  DATA_CONFIGURED,       // 配置的自定义目录（不可用时也保留原值，供界面提示）
  BOOTSTRAP_FILE: BOOTSTRAP,
  userDataDir, defaultDataDir, pickDataDir, readBootstrap, canUseDir, setDataDir,

  configFile: path.join(DATA, 'config.json'),
  registryFile: path.join(DATA, 'mods.json'),
  downloadQueueFile: path.join(DATA, 'downloads.json'),
  watchSeenFile: path.join(DATA, 'watch-seen.json'),
  blacklistFile: path.join(DATA, 'blacklist.json'),
  favoritesFile: path.join(DATA, 'favorites.json'),
  translateCache: path.join(CACHE, 'translate.json'),
  nexusCache: path.join(CACHE, 'nexus.json')
};
