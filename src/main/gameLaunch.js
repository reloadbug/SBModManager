/**
 * 启动游戏：把 `SB\Binaries\Win64\SB-Win64-Shipping.exe` 直接拉起来。
 *
 * 三条取舍：
 * ① 直接起主程序，不走 Steam —— 管理器不假设游戏是怎么装的，Steam / Epic / 绿色版都能用；
 * ② 工作目录设成 exe 那一层（UE 的很多相对路径是按 exe 的位置算的，设错会白屏或崩溃）；
 * ③ detached + stdio:'ignore' —— 管理器关掉不该把游戏带走，游戏的日志也不该灌进我们的管道。
 *
 * 纯逻辑（找 exe、判能不能起）放在 `plan()` 里，探针不启动游戏也能断言。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const game = require('./game');

/** 主程序路径（root 为空时返回空串） */
function exeOf(root) {
  return root ? path.join(root, game.EXE_REL) : '';
}

/**
 * 能不能启动：返回 { ok, exe, cwd, code, reason }
 * code: ''（能起）/ 'no-root'（没设置游戏目录）/ 'missing'（exe 不在）
 */
function plan(root, exists) {
  const has = exists || ((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!root) return { ok: false, exe: '', cwd: '', code: 'no-root', reason: '还没设置游戏目录，先到设置里选一下' };
  const exe = exeOf(root);
  if (!has(exe)) return { ok: false, exe, cwd: '', code: 'missing', reason: '找不到游戏主程序：' + exe };
  return { ok: true, exe, cwd: path.dirname(exe), code: '', reason: '' };
}

/**
 * 真的启动：返回 { ok, exe, pid }；不能起就抛错（带可读文案）。
 * 不等待游戏退出 —— 管理器不该被游戏的生命周期绑住。
 * `opts.spawnImpl` 只给探针用（不真起游戏也能断言参数）。
 */
function launch(root, opts = {}) {
  const p = plan(root);
  if (!p.ok) {
    const e = new Error(p.reason);
    e.code = p.code;
    throw e;
  }
  if (opts.dryRun) return { ok: true, exe: p.exe, cwd: p.cwd, pid: 0, dryRun: true };
  // ELECTRON_RUN_AS_NODE 是给 electron 自己看的；传给游戏没有意义，顺手剔掉
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnFn = opts.spawnImpl || spawn;
  const child = spawnFn(p.exe, [], {
    cwd: p.cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env,
  });
  if (child && typeof child.unref === 'function') child.unref();
  return { ok: true, exe: p.exe, cwd: p.cwd, pid: (child && child.pid) || 0 };
}

module.exports = { exeOf, plan, launch };
