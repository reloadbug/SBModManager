'use strict';
/**
 * 文件系统错误的人话翻译。
 *
 * 起因（2026-11-07 真实事故）：
 *   往 `c:\Star Blade\SB\Content\Paks\~Mods` 复制文件时，用户只看到
 *
 *     EPERM: operation not permitted, copyfile 'D:\...\extract-1793\Bayoedt_P.pak'
 *       -> 'c:\Star Blade\SB\Content\Paks\~Mods\Bayoedt_P [nx4104].pak'
 *
 *   这种裸错误码除了程序员谁都读不懂 —— 真实原因其实是**本程序进程的完整性级别
 *   被系统限制**（程序目录带了 Low 标签，Windows 把进程降到低完整性，写普通目录
 *   一律被拒），跟「游戏目录权限」半毛钱关系没有。用户看着 EPERM 只能干瞪眼。
 *
 * 所以这里只做一件事：把 `err.code` 翻成「写哪个目录失败了 + 常见原因 + 怎么办」。
 *   · 不改变错误语义（该失败还是失败），只改善提示
 *   · 拿不到路径就退回泛化说法，绝不编造路径
 */

const fs = require('fs');
const path = require('path');

/** 权限类错误码：这几种的出现方式不一样，但对用户是同一类问题 */
const PERM_CODES = new Set(['EPERM', 'EACCES']);

/** 被占用 / 锁冲突 */
const BUSY_CODES = new Set(['EBUSY', 'ETXTBSY']);

/** 这些动作会把路径写进错误里，用来兜底提取目标目录 */
const COPY_MSG = /copyfile\s+'(.+?)'\s*->\s*'(.+?)'/i;

function codeOf(err) {
  return (err && (err.code || (err.errno && String(err.errno)))) || '';
}

/**
 * 找出「写失败的目标」。
 * 优先用调用方明确给的目标目录（最准），其次从错误对象/错误文案里挖。
 * @param {Error & {path?:string,dest?:string}} err
 * @param {string} [fallbackDir] 调用方知道的目标目录
 * @returns {string} 目标路径或空串
 */
function targetOf(err, fallbackDir) {
  if (fallbackDir) return String(fallbackDir);
  if (err && typeof err.dest === 'string' && err.dest) return path.dirname(err.dest);
  const msg = String((err && err.message) || '');
  const m = msg.match(COPY_MSG);
  if (m && m[2]) return path.dirname(m[2]);
  if (err && typeof err.path === 'string' && err.path) {
    // 单个文件的读写失败（非 copyfile）→ path 就是目标（或它的父目录）
    const p = err.path;
    return /[\\/]$/.test(p) ? p.replace(/[\\/]+$/, '') : path.dirname(p);
  }
  return '';
}

/** 引号包一下，路径里常有空格，裸着写容易读断 */
function q(p) {
  return p ? `「${p}」` : '目标目录';
}

/**
 * 把错误翻成一句（或两句）人话。永不抛异常。
 * @param {Error} err Node 的 fs 错误
 * @param {{target?:string, action?:string}} [opts] target=写入目标目录；action=正在做什么（如「复制文件」）
 * @returns {string}
 */
function describe(err, opts) {
  const o = opts || {};
  try {
    const code = codeOf(err);
    const dir = targetOf(err, o.target);
    const action = o.action || '写入文件';

    if (PERM_CODES.has(code)) {
      // 这里刻意把「完整性级别」也写进可能原因：本机就踩过这个坑，
      // 而且它跟普通的「没权限」表现一模一样，不提示的话根本查不出来。
      return `${action}被系统拒绝：${q(dir)}（${code}，权限不足）。`
        + '常见原因：① 游戏装在受保护位置，需要管理员权限；'
        + '② 本程序的运行权限被限制（例如被放进沙箱、或被标成低完整性级别）；'
        + '③ 目标文件正被游戏或杀毒软件占用。'
        + '可以先关掉游戏，用「以管理员身份运行」重新打开本程序再试。';
    }
    if (BUSY_CODES.has(code)) {
      return `${q(dir)} 里的文件正被其他程序占用（${code}）。关掉游戏（或占用它的程序）后重试即可。`;
    }
    if (code === 'ENOSPC') {
      return `${q(dir)} 所在磁盘空间不足（ENOSPC）。清理一些空间后重试。`;
    }
    if (code === 'EROFS') {
      return `${q(dir)} 是只读的（EROFS），无法写入。`;
    }
    if (code === 'ENOENT') {
      return `目标目录不存在：${q(dir)}（ENOENT）。游戏目录可能被移动或删除了，请到「设置」里重新指定游戏目录。`;
    }
    if (code === 'ENOTDIR' || code === 'EISDIR') {
      return `目标路径类型不对：${q(dir)}（${code}）—— 同名位置上有目录与文件冲突。`;
    }
    if (code === 'ENAMETOOLONG') {
      return `目标路径太长（ENAMETOOLONG）：${q(dir)}。把游戏装到层级浅一点的目录能避开这个问题。`;
    }
    // 认不出来的错误：原样把 code + message 带上，至少留证据
    const raw = String((err && err.message) || err || '未知错误');
    return code ? `${raw}（${code}）` : raw;
  } catch {
    return String((err && err.message) || err || '未知错误');
  }
}

/**
 * 试写一个临时文件，判断目录到底能不能写。
 * 用来「安装前先探路」，比失败后猜原因靠谱得多。
 * @param {string} dir
 * @returns {{ok:boolean, code?:string, message?:string}}
 */
function probeWritable(dir) {
  if (!dir) return { ok: false, code: 'ENOENT', message: '没有指定目录' };
  const probe = path.join(dir, `.sbmod-write-test-${process.pid}-${Date.now()}.tmp`);
  try {
    if (!fs.existsSync(dir)) {
      return { ok: false, code: 'ENOENT', message: describe({ code: 'ENOENT' }, { target: dir }) };
    }
    fs.writeFileSync(probe, 'ok');
    try { fs.unlinkSync(probe); } catch { /* 删不掉不影响「能写」这个结论 */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, code: codeOf(e), message: describe(e, { target: dir, action: '试写测试文件' }) };
  }
}

module.exports = { PERM_CODES, BUSY_CODES, codeOf, targetOf, describe, probeWritable };
