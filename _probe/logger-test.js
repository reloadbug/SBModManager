'use strict';
/*
 * 运行日志模块自检。
 *
 * 这个模块是「用户报错 → 能查日志」的唯一依靠，所以必须钉死：
 *   · console.* 同时写文件 + 保留终端输出
 *   · Error 记的是 **stack**（只记 message 的话调用栈就丢了）
 *   · 关键事件有统一格式，能 grep
 *   · 超过保留期的日志会被清掉，当天的不会
 *   · 单行超长会截断（防止 util.inspect 大对象把磁盘写爆）
 *   · 日志写入失败不能反过来把应用搞崩
 *
 * 用临时目录当 LOGS，**不碰项目里的 data/logs**。
 *
 * ⚠️ 文件流是异步的 —— 写完要等一拍再读文件，否则会读到旧内容。
 *
 * 运行：node _probe/logger-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'sb-logger-test');
try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); } catch { /* 忽略 */ }
fs.mkdirSync(TMP, { recursive: true });

// 必须在 require logger 之前改掉 —— logger 每次都从 paths.LOGS 现读
const paths = require('../src/main/paths');
paths.LOGS = TMP;

const logger = require('../src/main/logger');

// 先把原始 console 存下来，断言输出用（install 之后 console 会被劫持）
const say = console.log.bind(console);

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; say('  ✓ ' + label); }
    else { fail++; say('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; say('  ✗ ' + label + '  → ' + e.message); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function readLog() {
  try { return fs.readFileSync(logger.file(), 'utf8'); } catch { return ''; }
}

(async () => {
  /* ---------------- formatArgs（不需要 install） ---------------- */

  say('\n=== 1) 参数序列化 ===');
  t('Error 取 stack 而不是 message', () => {
    const s = logger.formatArgs([new Error('boom-marker')]);
    return /boom-marker/.test(s) && /at /.test(s) ? true : s.slice(0, 120);
  });
  t('对象用 inspect 展开', () => {
    const s = logger.formatArgs([{ a: 1, b: 'x' }]);
    return /\{ a: 1, b: 'x' \}/.test(s) ? true : s;
  });
  t('null / undefined 不丢', () => logger.formatArgs([null, undefined]) === 'null undefined' ? true : logger.formatArgs([null, undefined]));
  t('多参数按空格拼接', () => logger.formatArgs(['a', 'b', 3]) === 'a b 3' ? true : logger.formatArgs(['a', 'b', 3]));
  t('循环引用不抛错', () => {
    const o = { name: 'cyc' }; o.self = o;
    return /cyc/.test(logger.formatArgs([o])) ? true : '抛错或丢内容';
  });

  /* ---------------- install ---------------- */

  say('\n=== 2) 安装与落盘 ===');
  const file = logger.install({ version: '0.1.0-test' });
  t('install 返回日志文件路径', () => typeof file === 'string' && file.startsWith(TMP) ? true : String(file));
  t('文件**同步**就存在（界面紧接着读也能读到）', () => fs.existsSync(logger.file()) ? true : logger.file());
  t('重复 install 幂等（不报错、路径不变）', () => logger.install() === logger.file() ? true : '路径变了');

  await wait(40);
  t('启动头写进了版本号', () => /0\.1\.0-test/.test(readLog()) ? true : '没找到');
  t('启动头带了日志路径', () => /日志 /.test(readLog()) ? true : '没找到');

  say('\n=== 3) console 劫持 ===');
  console.log('MARK-LOG-中文-OK');
  console.error(new Error('MARK-ERR-堆栈'));
  console.warn('MARK-WARN');
  await wait(40);
  t('console.log 内容进文件', () => /MARK-LOG-中文-OK/.test(readLog()) ? true : '没进');
  t('console.error 的 Error 记了 stack', () => {
    const s = readLog();
    return /MARK-ERR-堆栈/.test(s) && /\[ERROR\]/.test(s) && /at /.test(s) ? true : '缺少 stack 或级别标记';
  });
  t('console.warn 标成 [WARN]', () => /\[WARN\] MARK-WARN/.test(readLog()) ? true : '没找到');
  t('每行带时间戳', () => /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[/m.test(readLog()) ? true : '格式不对');

  say('\n=== 4) 关键事件打点 ===');
  logger.event('install:done', { id: 'nexus:1496:13020', written: 23 });
  logger.event('app:ping');
  const cyc = {}; cyc.self = cyc;
  logger.event('bad', cyc);
  await wait(40);
  t('事件格式可 grep', () => /\[EVENT\] install:done \{"id":"nexus:1496:13020","written":23\}/.test(readLog()) ? true : '格式不对');
  t('无 payload 的事件也能记', () => /\[EVENT\] app:ping/.test(readLog()) ? true : '没找到');
  t('无法序列化的 payload 不抛错且留痕', () => /\[EVENT\] bad <无法序列化>/.test(readLog()) ? true : '没找到');

  say('\n=== 5) tail 读取 ===');
  t('tail 默认返回数组', () => Array.isArray(logger.tail(10).lines) ? true : '不是数组');
  t('tail 只取末尾 N 行', () => {
    const r = logger.tail(3);
    return r.lines.length === 3 ? true : r.lines.length;
  });
  t('tail 标记 truncated', () => logger.tail(3).truncated === true ? true : 'false');
  t('tail 给出总行数', () => logger.tail(3).total > 3 ? true : logger.tail(3).total);
  t('tail 行数超过总数时全给', () => {
    const all = logger.tail(100000);
    return all.truncated === false && all.lines.length === all.total ? true : all.lines.length + '/' + all.total;
  });
  t('tail 指向的是当前日志文件', () => logger.tail(1).file === logger.file() ? true : logger.tail(1).file);
  t('tail 能读指定文件', () => {
    const other = path.join(TMP, 'app-1999-12-31.log');
    fs.writeFileSync(other, 'AAA\nBBB\n');
    const r = logger.tail(5, { file: other });
    return r.lines.join(',') === 'AAA,BBB' ? true : r.lines.join(',');
  });
  t('tail 读不存在的文件返回空、不抛错', () => {
    const r = logger.tail(5, { file: path.join(TMP, 'nope.log') });
    return Array.isArray(r.lines) && r.lines.length === 0 && r.total === 0 ? true : JSON.stringify(r.lines.slice(0, 2));
  });
  t('tail 显式指定文件时不偷换文件', () => {
    const r = logger.tail(5, { file: path.join(TMP, 'nope.log') });
    return r.file === path.join(TMP, 'nope.log') ? true : r.file;
  });

  say('\n=== 6) 单行超长截断 ===');
  // 直接调 write，避免把 20000 个字符喷到终端上
  const longLine = logger.write('INFO', ['X'.repeat(20000)]);
  await wait(40);
  t('write 返回值已被截断', () => longLine.length < 4200 ? true : longLine.length);
  t('截断处有标记', () => /已截断/.test(longLine) ? true : longLine.slice(-40));
  t('文件里也是截断后的长度', () => {
    const hit = readLog().split(/\r?\n/).find(l => l.indexOf('XXXX') >= 0);
    return hit && hit.length < 4200 ? true : (hit ? '长度 ' + hit.length : '没找到');
  });

  say('\n=== 7) 轮转清理 ===');
  t('7 天前的日志被删掉', () => {
    const old = path.join(TMP, 'app-2000-01-01.log');
    fs.writeFileSync(old, 'old');
    const removed = logger.rotate();
    return !fs.existsSync(old) && removed.includes('app-2000-01-01.log') ? true : JSON.stringify(removed);
  });
  t('当天的日志不会被删', () => fs.existsSync(logger.file()) ? true : '被删了');
  t('保留期是 7 天', () => logger.KEEP_DAYS === 7 ? true : logger.KEEP_DAYS);
  t('list 能列出日志文件', () => logger.list().some(f => f.name === path.basename(logger.file())) ? true : JSON.stringify(logger.list()));
  t('list 带大小与时间', () => {
    const cur = logger.list().find(f => f.name === path.basename(logger.file()));
    return cur && cur.size > 0 && !!cur.mtime ? true : JSON.stringify(cur);
  });

  say('\n=== 8) 降级：日志目录不可写时不能崩 ===');
  t('指向非法目录后写入不抛错', () => {
    const good = paths.LOGS;
    paths.LOGS = path.join(TMP, 'nul', '\u0000bad');
    try { console.log('这条应该写不进去，但不能抛错'); }
    finally { paths.LOGS = good; }
    return true;
  });
  t('恢复后还能继续写（下面这条断言覆盖）', () => true);
  console.log('MARK-RECOVER');
  await wait(40);
  t('恢复后内容确实写进去了', () => /MARK-RECOVER/.test(readLog()) ? true : '没进');

  /* ---------------- 清理 ---------------- */
  logger.close();
  await wait(30);
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); } catch { /* 忽略 */ }

  say('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
