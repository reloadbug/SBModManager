'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * 数据目录。
 *
 * 开发时放在项目里的 `data/`（方便直接看文件）；
 * **打包成 exe 之后必须换到 `userData`** —— 因为 `__dirname` 那时在 `app.asar` 里，
 * 往里面写文件是写不进去的（asar 是只读归档）。
 *
 * ⚠️ `require('electron')` 在纯 Node 进程里返回的是「electron 可执行文件路径」这个
 *    字符串，解构出来的 `app` 是 undefined —— 正好走 fallback 分支，
 *    所以纯 Node 的断言测试（_probe/*.js）不会被打包逻辑影响。
 */
function resolveDataDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function' && app.isPackaged) {
      return path.join(app.getPath('userData'), 'data');
    }
  } catch { /* 纯 Node 环境，用项目内的 data/ */ }
  return path.join(ROOT, 'data');
}

const DATA = resolveDataDir();
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
  configFile: path.join(DATA, 'config.json'),
  registryFile: path.join(DATA, 'mods.json'),
  downloadQueueFile: path.join(DATA, 'downloads.json'),
  watchSeenFile: path.join(DATA, 'watch-seen.json'),
  blacklistFile: path.join(DATA, 'blacklist.json'),
  translateCache: path.join(CACHE, 'translate.json'),
  nexusCache: path.join(CACHE, 'nexus.json')
};
