'use strict';

/**
 * 从 Node 里启动 Electron（而不是直接从 Git Bash 里跑 electron.exe）。
 *
 * 为什么要这个包装：
 *   在本机沙箱下，**直接从 Git Bash 执行 electron.exe 会静默失败** ——
 *   进程根本不起来，退出码却是 0，`> log 2>&1` 得到空文件。
 *   症状和「单实例锁被占用」一模一样，极易误判。
 *   改成由 Node 拉起并接管管道，就能正常拿到 stdout/stderr 与退出码。
 *
 * 🔴 **必须用异步的 `execFile`，不能用 `spawnSync`**（2026-10-13 实测）：
 *   沙箱的进程代理会拦掉对 `electron.exe` 的**同步** spawn，
 *   一律返回 `EBUSY` —— 而且 `shell: true` / 经 `bash -c` / 绝对路径
 *   三种写法**全都被拦**（试过，都是 EBUSY）。
 *   同一个 exe 换成异步 `execFile` 就正常（`--version` 回 `v44.7.0`）。
 *
 *   于是 `npm run test:inject` 会以「SPAWN_ERROR … EBUSY」失败 ——
 *   看上去像代码坏了，其实只是启动方式不对。
 *   这里做成：**先异步 execFile，真起不来才退回 spawnSync**（双保险）。
 *
 * 用法：
 *   node _probe/launch.js --compat --shot=_shots/x.png --shot-eval-file=_probe/foo.js --shot-delay=7000
 *   node _probe/launch.js tests/selftest.js                 ← 第一个参数是 .js 时，把它当 app 入口
 *   node _probe/launch.js _probe/nexus-inject-test.js
 *   （其余参数原样透传给 Electron）
 */

const { execFile, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const env = { ...process.env };
// 沙箱会注入 ELECTRON_RUN_AS_NODE=1，不剥掉的话 Electron 会退化成普通 Node（不建窗口）
delete env.ELECTRON_RUN_AS_NODE;

const rest = process.argv.slice(2);
// 第一个参数是 .js → 当作 app 入口（等价于 `electron <脚本>`，探针/自检都这么用）；
// 否则把项目根当 app（等价于 `electron .`），后面的参数继续透传。
const appEntry = rest.length && /\.js$/i.test(rest[0]) ? path.resolve(ROOT, rest[0]) : ROOT;
const args = [appEntry, ...(appEntry === ROOT ? rest : rest.slice(1))];

const MAX_BUFFER = 64 * 1024 * 1024;

/** 兜底：同步 spawn（只在异步路径「根本起不来」时用） */
function viaSpawnSync(reason) {
  console.error('提示：异步启动失败（' + reason + '），退回同步 spawn…');
  const r = spawnSync(EXE, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) {
    console.error('SPAWN_ERROR ' + r.error.message);
    // 两种方式都起不来 → 让用户手动跑（本沙箱里 shell 直调是通的）
    if (/EBUSY|EPERM|EACCES/.test(r.error.message || '')) {
      console.error('提示：spawn 被环境拦截，改由 shell 直接执行试试：');
      console.error('  env -u ELECTRON_RUN_AS_NODE ' + EXE + ' ' + args.join(' '));
    }
    process.exit(1);
  }
  process.exit(r.status == null ? 1 : r.status);
}

execFile(EXE, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: MAX_BUFFER, windowsHide: true },
  (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    // `err.code` 是**字符串** = spawn 层面的失败（EBUSY/EPERM…）；
    // 是数字 = 进程正常退出但退出码非 0（那是被测脚本自己失败，别去兜底重跑）。
    if (err && typeof err.code === 'string') return viaSpawnSync(err.code);

    if (err && err.killed) process.exit(err.signal ? 1 : (err.code || 1));
    process.exit(err ? (typeof err.code === 'number' ? err.code : 1) : 0);
  });
