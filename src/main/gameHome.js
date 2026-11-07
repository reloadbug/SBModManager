'use strict';

/**
 * 「数据跟着游戏走」——把管理器状态铺进 `<游戏根>\.sbmod\`，并在之后持续镜像。
 *
 * 起因：用户把整个游戏文件夹搬走了（D:\games\Star Blade → c:\Star Blade），
 * 管理器里的安装账本还指着老路径，于是「已安装」全变成「未登记」。
 * `relocate.js` 解决的是**同一次搬迁后对齐路径**；这个模块解决的是
 * **把数据放在游戏目录里，从根上不再需要对齐**。
 *
 * 分工（为什么不把所有东西都塞进游戏目录）：
 *   · 状态（config / mods / mod-links / blacklist / favorites / downloads /
 *     watch-seen / ledger）→ 跟着游戏走，丢了就没有了，必须便携；
 *   · 缓存（图片、Nexus 目录、翻译缓存、日志、下载好的压缩包）→ 体积大、可再生，
 *     留在管理器自己的数据目录里，别把游戏目录撑肿。
 *
 * 时序（为什么不是启动时就切过去）：
 *   `paths.js` 里那些路径常量是**模块加载时定死**的，`store`/`registry`/`logger`
 *   都已经各取过一遍，会话中途换目录等于重建整条链路。所以：
 *   ① 启动时 `paths` 若发现 `<游戏根>\.sbmod\config.json` 存在，**直接用它**；
 *   ② 不存在（第一次见到这个游戏目录）→ 立刻把当前状态**写进去**（`seed()`） +
 *      记下指针，然后**本会话继续用原目录，同时把每次写入镜像过去**（`mirror()`）；
 *   ③ 下次启动就自然读到游戏目录里那份，从此数据在游戏目录里。
 *   这样既不打断用户，也不会出现「两份都不一样」——镜像写的就是同一份内容。
 */

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

/** 原子复制（写 .tmp 再 rename，避免出现半截文件被读到） */
function copyAtomic(src, dst) {
  const tmp = dst + '.tmp';
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}

/** 原子写 JSON（不经过 store，避免和镜像钩子递归） */
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function homeOf(root) { return paths.gameHomeOf(root); }
function ready(root) { return paths.gameHomeReady(root); }

/**
 * 第一次识别到某个游戏目录：把当前状态文件铺进 `<游戏根>\.sbmod`。
 *
 * **已存在的文件一律不覆盖** —— 游戏目录里那份是权威（可能比管理器里的新，
 * 比如用户刚在另一台机器上玩过）。只补缺的。
 *
 * @param {string} root 游戏根目录
 * @param {string} [fromDir] 从哪份数据复制（默认当前数据目录 `paths.DATA`）
 * @returns {{dir:string, copied:string[], skipped:string[], failed:{name:string,error:string}[]}}
 */
function seed(root, fromDir) {
  const dir = homeOf(root);
  const src = fromDir || paths.DATA;
  const out = { dir, copied: [], skipped: [], failed: [] };
  if (!dir) return out;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    out.failed.push({ name: '(mkdir)', error: e.message });
    return out;
  }

  for (const name of paths.STATE_NAMES) {
    const from = path.join(src, name);
    const to = path.join(dir, name);
    if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) { out.skipped.push(name); continue; }
    try {
      if (!fs.statSync(from).isFile()) { out.skipped.push(name); continue; }
    } catch { out.skipped.push(name); continue; }
    try {
      if (fs.statSync(to).isFile()) { out.skipped.push(name); continue; }
    } catch { /* 目标不存在，正是要写的 */ }
    try {
      copyAtomic(from, to);
      out.copied.push(name);
    } catch (e) {
      out.failed.push({ name, error: e.message });
    }
  }
  return out;
}

/**
 * 镜像一份状态文件到游戏目录（`store.writeJson` 每次写盘后调用）。
 *
 * @returns {string} 实际写入的路径（没写就是空串）
 */
function mirror(root, file, data) {
  if (!root) return '';
  const name = path.basename(file);
  if (!paths.STATE_NAMES.includes(name)) return '';
  const dir = homeOf(root);
  if (!dir) return '';
  const to = path.join(dir, name);
  if (path.resolve(file).toLowerCase() === path.resolve(to).toLowerCase()) return '';
  writeJsonAtomic(to, data);
  return to;
}

/** 给界面用的一句话状态 */
function info() {
  return {
    dataDir: paths.DATA,
    appData: paths.APP_DATA,
    source: paths.DATA_SOURCE,          // 'game' | 'custom' | 'default'
    gameRoot: paths.GAME_ROOT || '',
    gameHome: paths.GAME_HOME || '',
    gameHomeReady: !!paths.GAME_HOME_READY,
    isGameHome: paths.DATA_SOURCE === 'game'
  };
}

module.exports = {
  homeOf, ready, seed, mirror, info, copyAtomic, writeJsonAtomic
};
