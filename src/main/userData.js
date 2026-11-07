'use strict';

/**
 * 用户数据目录的可写性检查与回退。
 *
 * 为什么需要这个模块：
 *   Chromium 把「单实例锁」「GPU 持久缓存」「Session Storage」等一大堆东西
 *   放在 `app.getPath('userData')`（Windows 上是 `%APPDATA%\<应用名>`）。
 *   一旦这个目录**建不出来或写不进去**，原生层只会打两行 ERROR 了事：
 *
 *     process_singleton_win.cc] Lock file can not be created: 拒绝访问 (0x5)
 *     viz/host/persistent_cache_sandboxed_file_factory.cc] Failed to open …
 *
 *   然后 `app.requestSingleInstanceLock()` 返回 false —— 我们把「拿不到锁」
 *   当成「已经有实例在跑」而 `app.quit()`，用户看到的就是**双击没反应、
 *   退出码 0、窗口一闪都没有**。整个报错链路里没有一处提到"权限"。
 *
 *   实测环境：`%APPDATA%\<应用名>` 的 DACL 看起来正常（SYSTEM / Administrators /
 *   当前用户都是完全控制），但写入仍然被拒绝访问 —— 这类拦截通常来自安全软件
 *   的受控文件夹防护或受限令牌。程序自己改不了对方的策略，能做的是**换个能写的
 *   地方继续跑**，别让用户对着一个退出码 0 发呆。
 *
 * 策略：先试 Electron 默认的 userData；写不进去就退到本程序数据目录下的
 *       `userdata/`（Windows 上这个目录从来不在受保护列表里）。
 *       两边都不行就照旧用默认目录（让 Electron 自己报错），但要留下原因。
 */

const fs = require('fs');
const path = require('path');

const PROBE_PREFIX = '.write-probe-';

/**
 * 目录能否创建并写入一个文件。
 * @param {string} dir
 * @returns {{ok: boolean, error?: string}}
 */
function isWritable(dir) {
  if (!dir) return { ok: false, error: 'EMPTY_PATH' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, PROBE_PREFIX + process.pid + '-' + Date.now());
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && (e.code || e.message)) || 'UNKNOWN' };
  }
}

/**
 * 选一个能写的 userData 目录。
 * @param {string} preferred Electron 默认的 userData
 * @param {string} fallback  备选目录（一般是 <数据目录>/userdata）
 * @returns {{dir: string, changed: boolean, reason: string|null, failed?: boolean}}
 *   changed = true 表示没有用默认目录，调用方需要 app.setPath('userData', dir)
 *   failed  = true 表示两边都写不进去，dir 仍是默认值，只能让 Electron 自己报错
 */
function resolve(preferred, fallback) {
  const first = isWritable(preferred);
  if (first.ok) return { dir: preferred, changed: false, reason: null };

  const second = isWritable(fallback);
  if (second.ok) return { dir: fallback, changed: true, reason: first.error || null };

  return { dir: preferred, changed: false, reason: first.error || null, failed: true };
}

module.exports = { isWritable, resolve, PROBE_PREFIX };
