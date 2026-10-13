'use strict';
const fs = require('fs');
const path = require('path');
const util = require('util');

const paths = require('./paths');

/**
 * 主进程文件日志。
 *
 * ## 为什么必须自己写一个
 *
 * 这个应用**没有终端**（用户双击 exe 启动，stdout 直接进黑洞）。之前所有
 * `console.error` 写出去就没了 —— 实测 `data/logs/` 一直是空的，
 * 用户报「自动安装 CNS 报错」时完全无从追溯（连错误文本都拿不到）。
 *
 * 所以这里做三件事：
 *   1. 劫持主进程 `console.*`，**同时**写文件与保留原终端输出
 *   2. 记 `uncaughtException` / `unhandledRejection` —— 这类错误最容易
 *      表现为「点了没反应 / 闪一下」，不记就永远查不到
 *   3. 按天分文件 + 自动清理 7 天前的旧日志
 *
 * ## 用法
 *
 * ```js
 * const logger = require('./logger');
 * logger.install({ version: app.getVersion() });   // 越早越好，在 app ready 之前
 * logger.event('install:run', { modId: 1496 });    // 关键事件单独打点
 * ```
 *
 * ## 坑
 *
 * · **不要让 write 里再调用 console** —— 会无限递归。
 *   日志文件写失败时（磁盘满 / 权限）必须静默降级，绝不能反过来把应用搞崩。
 * · 日志目录本身由 `paths.ensure()` 保证存在，但 `install()` 里还会再 mkdir 一次，
 *   因为 `install()` 可能在 `paths.ensure()` 之前被调用。
 */

const KEEP_DAYS = 7;                 // 保留天数
const MAX_LINE = 4000;               // 单行上限，超长截断（防止 util.inspect 大对象刷爆磁盘）
const PREFIX = 'app-';

let stream = null;
let openedFor = null;                // 当前打开的日志文件路径
let installed = false;
let logFile = null;
const native = {};                   // 原始 console 方法

/* ---------------- 时间 ---------------- */

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function dayStamp(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function clock(d = new Date()) {
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
}

/* ---------------- 序列化 ---------------- */

/**
 * 把 console 的参数拼成一行可读文本。
 * ⚠️ Error 必须打 stack —— 只打 message 的话调用栈就丢了，
 *    而调用栈恰恰是排查「点了没反应」类问题的唯一线索。
 */
function formatArgs(args) {
  const parts = [];
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.stack || (a.name + ': ' + a.message));
    } else if (typeof a === 'string') {
      parts.push(a);
    } else if (a === null || a === undefined) {
      parts.push(String(a));
    } else {
      try {
        parts.push(util.inspect(a, { depth: 4, breakLength: 140, maxArrayLength: 40 }));
      } catch {
        parts.push(String(a));
      }
    }
  }
  return parts.join(' ');
}

/* ---------------- 文件 ---------------- */

function currentFile() { return path.join(paths.LOGS, PREFIX + dayStamp() + '.log'); }

/** 打开（或跨天时切换）日志文件；失败则静默降级为「只走终端」 */
function openIfNeeded() {
  const want = currentFile();
  if (stream && openedFor === want) return;
  try { if (stream) stream.end(); } catch { /* 忽略 */ }
  stream = null;
  openedFor = null;
  try {
    fs.mkdirSync(paths.LOGS, { recursive: true });
    // ⚠️ `createWriteStream` 是**异步**打开文件的 —— 不先同步建一次的话，
    //    日志文件要等到下一轮事件循环才存在。界面上「查看日志」如果紧接着
    //    启动就读，会读到「文件不存在」。先同步 append 一个空串把文件建出来。
    fs.writeFileSync(want, '', { flag: 'a' });
    const s = fs.createWriteStream(want, { flags: 'a', encoding: 'utf8' });
    // 必须有 error 监听，否则磁盘满/权限问题会变成 uncaughtException
    s.on('error', () => { if (stream === s) { stream = null; openedFor = null; } });
    stream = s;
    openedFor = want;
    logFile = want;
  } catch {
    stream = null;
    openedFor = null;
  }
}

/** 核心写入：拼行 → 截断 → 落盘。返回写入的那一行（便于自检断言） */
function write(level, args) {
  let line;
  try { line = '[' + clock() + '] [' + level + '] ' + formatArgs(args); }
  catch { line = '[' + clock() + '] [' + level + '] <日志序列化失败>'; }
  if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE) + ' …(已截断)';

  openIfNeeded();
  if (stream) { try { stream.write(line + '\n'); } catch { /* 忽略 */ } }
  return line;
}

/** 删除超过保留期的日志文件，返回被删掉的文件名 */
function rotate() {
  let names = [];
  try {
    names = fs.readdirSync(paths.LOGS).filter(n => n.startsWith(PREFIX) && n.endsWith('.log'));
  } catch { return []; }

  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const removed = [];
  for (const n of names) {
    const d = n.slice(PREFIX.length, -4);
    const t = Date.parse(d + 'T00:00:00');
    if (!Number.isFinite(t) || t >= cutoff) continue;
    try { fs.unlinkSync(path.join(paths.LOGS, n)); removed.push(n); } catch { /* 忽略 */ }
  }
  return removed;
}

/* ---------------- 安装（劫持 console） ---------------- */

/**
 * 开始记录。幂等 —— 重复调用只生效一次。
 * @param {{version?:string, mode?:string}} meta 启动信息，写进日志头
 * @returns {string} 当前日志文件路径
 */
function install(meta = {}) {
  if (installed) return logFile || currentFile();
  installed = true;

  paths.ensure();
  const removed = rotate();
  openIfNeeded();

  const head = [
    '================ 应用启动 ================',
    '时间 ' + new Date().toISOString(),
    meta.version ? ('版本 ' + meta.version) : '',
    meta.mode ? ('模式 ' + meta.mode) : '',
    '进程 ' + process.pid + ' · ' + process.platform + ' ' + process.arch,
    'Electron ' + (process.versions.electron || '?') + ' · Node ' + (process.versions.node || '?'),
    '日志 ' + (logFile || '(不可写)'),
    removed.length ? ('清理过期日志 ' + removed.length + ' 个：' + removed.join(', ')) : ''
  ].filter(Boolean);
  write('INFO', [head.join('\n')]);

  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const orig = console[level];
    if (typeof orig !== 'function') continue;
    native[level] = orig;
    console[level] = function (...args) {
      try { write(level.toUpperCase(), args); } catch { /* 绝不因为日志失败而抛错 */ }
      try { return orig.apply(console, args); } catch { return undefined; }
    };
  }

  // 这两类错误是「点了没反应」的头号嫌疑，必须留痕。
  // ⚠️ 注册了 uncaughtException 就等于接管默认行为（默认会崩），
  //    这里选择**记下来并继续运行** —— 桌面应用崩掉对用户来说信息量为零，
  //    留在日志里才有价值。
  process.on('uncaughtException', (err) => {
    try { write('FATAL', ['未捕获异常：', err]); } catch { /* 忽略 */ }
    try { if (native.error) native.error.call(console, '[未捕获异常]', err); } catch { /* 忽略 */ }
  });
  process.on('unhandledRejection', (reason) => {
    try { write('FATAL', ['未处理的 Promise 拒绝：', reason]); } catch { /* 忽略 */ }
    try { if (native.error) native.error.call(console, '[未处理拒绝]', reason); } catch { /* 忽略 */ }
  });

  return logFile;
}

/* ---------------- 读取（给界面「查看日志」用） ---------------- */

/** 当前日志文件路径 */
function file() { return currentFile(); }

/** 列出所有日志文件（新→旧） */
function list() {
  let names = [];
  try {
    names = fs.readdirSync(paths.LOGS).filter(n => n.startsWith(PREFIX) && n.endsWith('.log'));
  } catch { return []; }
  return names.map(n => {
    const abs = path.join(paths.LOGS, n);
    let size = 0, mtime = null;
    try { const st = fs.statSync(abs); size = st.size; mtime = st.mtime.toISOString(); } catch { /* 忽略 */ }
    return { name: n, path: abs, size, mtime };
  }).sort((a, b) => (b.name > a.name ? 1 : -1));
}

/**
 * 读最近 n 行（默认整个当前日志文件）。
 * 大文件只读尾部 —— 日志可能有几 MB，整份塞进 IPC 会卡界面。
 *
 * ⚠️ 显式给了 `opts.file` 就**只读那个文件**，不存在时返回空列表。
 *    不要偷偷退回当前日志文件 —— 那会让界面显示的文件名和内容对不上。
 */
function tail(n = 400, opts = {}) {
  const f = opts.file ? String(opts.file) : currentFile();
  try {
    if (!fs.existsSync(f)) return { file: f, lines: [], total: 0, truncated: false };
    const raw = fs.readFileSync(f, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.length > 0);
    const cut = Math.max(1, Number(n) || 400);
    return {
      file: f,
      lines: lines.slice(-cut),
      total: lines.length,
      truncated: lines.length > cut
    };
  } catch (e) {
    return { file: f, lines: ['(读取日志失败：' + e.message + ')'], total: 0, truncated: false };
  }
}

/** 关键事件打点：统一 `[EVENT] 名称 {json}` 格式，便于 grep */
function event(name, data) {
  let payload = '';
  if (data !== undefined) {
    try { payload = ' ' + JSON.stringify(data); }
    catch { payload = ' <无法序列化>'; }
  }
  return write('EVENT', [name + payload]);
}

/** 关闭文件句柄（退出前调用，确保缓冲区落盘） */
function close() {
  try { if (stream) stream.end(); } catch { /* 忽略 */ }
  stream = null;
  openedFor = null;
}

module.exports = {
  install, event, write, file, list, tail, close, rotate,
  formatArgs, KEEP_DAYS
};
