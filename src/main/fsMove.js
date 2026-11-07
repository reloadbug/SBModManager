'use strict';

/**
 * 跨卷搬运（搬家）的唯一入口。
 *
 * 为什么需要它：
 *   卸载 Mod 时不是删文件，而是把文件「移」到 `data/backup/uninstalled/<id>/` 里方便回滚；
 *   下载完成后也要把压缩包从临时目录「移」到安装包目录。两处都用的是 `fs.renameSync`，
 *   而 Windows 的 `MoveFileEx` **不能跨盘**：游戏装在 `c:\Star Blade`、管理器数据在 `d:\...`
 *   时就直接炸出
 *     EXDEV: cross-device link not permitted, rename 'c:\…\x.pak' -> 'd:\…\x.pak'
 *   （2026-11-07 用户卸载 Mod 时踩到的就是这个）。
 *
 * 做法：
 *   先试 rename（同卷最快、原子、不留副本）；只有**确实跨卷**时才退化成
 *   「复制 + 删源」。判断跨卷既看错误码 `EXDEV`，也看两个路径的盘符是否不同
 *   （Windows 上目录跨卷搬家有时给的是 `EPERM`，光看错误码会漏）。
 *
 * 语义取舍：
 *   · 复制成功但删源失败 → 抛错，并说明「备份已经有了，原文件还没删掉」。
 *     宁可让用户看到一句人话，也不要出现「游戏里还加载着、备份里也有一份」的哑巴状态。
 *   · 目录用 `fs.cpSync(..., {recursive:true})`，会保留子目录结构。
 */

const fsNative = require('fs');
const path = require('path');

/** 两个路径是否在同一卷（盘符）上。 */
function sameVolume(a, b) {
  const ra = path.parse(path.resolve(String(a))).root.toLowerCase();
  const rb = path.parse(path.resolve(String(b))).root.toLowerCase();
  return ra === rb;
}

/** 这个错误算不算「得走复制路线」。 */
function isCrossDevice(err, from, to) {
  const code = err && err.code;
  if (code === 'EXDEV') return true;
  if (!sameVolume(from, to) && (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'ENOSYS')) return true;
  return false;
}

function statSafe(fs, p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

/** 复制（保留目录结构），失败原样抛出。 */
function copyPath(fs, from, to) {
  const st = statSafe(fs, from);
  if (st && st.isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/** 删源；失败时给一句能看懂的话。 */
function removeSource(fs, from, to, err) {
  try {
    const st = statSafe(fs, from);
    if (st && st.isDirectory()) fs.rmSync(from, { recursive: true, force: true });
    else fs.unlinkSync(from);
  } catch (e) {
    const err2 = new Error(
      `已经把「${path.basename(from)}」复制到 ${to}，但原文件删不掉（${e.code || e.message}）——` +
      `可能被游戏或杀毒软件占着；关掉游戏后再试一次。`
    );
    err2.code = e.code || 'ELOCKED';
    err2.cause = err || e;
    err2.copied = true;
    throw err2;
  }
}

/**
 * 同步搬运（文件或目录）。
 * @returns {'rename'|'copy'} 走的是哪条路线（测试与日志要用）
 */
function movePath(from, to, opts = {}) {
  const fs = opts.fs || fsNative;
  try {
    fs.renameSync(from, to);
    return 'rename';
  } catch (e) {
    if (!isCrossDevice(e, from, to)) throw e;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    copyPath(fs, from, to);
    removeSource(fs, from, to, e);
    return 'copy';
  }
}

/**
 * 异步版本（下载完成把包搬进安装包目录时用，别把主进程卡住）。
 * @returns {Promise<'rename'|'copy'>}
 */
async function movePathAsync(from, to, opts = {}) {
  const fs = opts.fs || fsNative;
  const fsp = fs.promises || fsNative.promises;
  try {
    await fsp.rename(from, to);
    return 'rename';
  } catch (e) {
    if (!isCrossDevice(e, from, to)) throw e;
    await fsp.mkdir(path.dirname(to), { recursive: true });
    const st = statSafe(fs, from);
    if (st && st.isDirectory()) {
      await fsp.cp(from, to, { recursive: true });
    } else {
      await fsp.copyFile(from, to);
    }
    try {
      if (st && st.isDirectory()) await fsp.rm(from, { recursive: true, force: true });
      else await fsp.unlink(from);
    } catch (e2) {
      const err2 = new Error(
        `已经把「${path.basename(from)}」复制到 ${to}，但原文件删不掉（${e2.code || e2.message}）——` +
        `可能被占用；稍后再试一次。`
      );
      err2.code = e2.code || 'ELOCKED';
      err2.cause = e2;
      err2.copied = true;
      throw err2;
    }
    return 'copy';
  }
}

module.exports = { sameVolume, isCrossDevice, movePath, movePathAsync };
