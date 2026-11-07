'use strict';

/**
 * userData 目录可写性兜底的测试。
 *
 * 对应真实故障：`%APPDATA%\<应用名>` 写不进去 →
 * Chromium 报 `Lock file can not be created: 拒绝访问 (0x5)` →
 * `requestSingleInstanceLock()` 返回 false → 我们按「已有实例在跑」退出 0 →
 * 用户看到「双击没反应、退出码 0」。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const userData = require(path.join(ROOT, 'src/main/userData.js'));

let pass = 0;
const fails = [];
function t(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + name); }
    else { fails.push(name + ' → ' + r); console.log('  ✗ ' + name + ' → ' + r); }
  } catch (e) {
    fails.push(name + ' → ' + e.message);
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-userdata-'));
const clean = p => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } };

console.log('[1] isWritable');
t('可写目录 → ok', () => {
  const d = path.join(tmpRoot, 'ok');
  const r = userData.isWritable(d);
  return r.ok === true && fs.existsSync(d) ? true : JSON.stringify(r);
});
t('多层不存在的目录会被建出来', () => {
  const d = path.join(tmpRoot, 'a', 'b', 'c');
  const r = userData.isWritable(d);
  return r.ok === true && fs.statSync(d).isDirectory() ? true : JSON.stringify(r);
});
t('探针文件用完会删掉（不留垃圾）', () => {
  const d = path.join(tmpRoot, 'clean');
  userData.isWritable(d);
  const left = fs.readdirSync(d).filter(n => n.startsWith(userData.PROBE_PREFIX));
  return left.length === 0 ? true : '残留 ' + left.join(',');
});
t('路径被同名文件占住 → 不可写且给出错误码', () => {
  const f = path.join(tmpRoot, 'occupied');
  fs.writeFileSync(f, 'x');
  const r = userData.isWritable(f);
  return r.ok === false && typeof r.error === 'string' ? true : JSON.stringify(r);
});
t('空路径 → EMPTY_PATH', () => {
  const r = userData.isWritable('');
  return r.ok === false && r.error === 'EMPTY_PATH' ? true : JSON.stringify(r);
});

console.log('[2] resolve（先默认、后回退）');
t('默认目录能写 → 不改动', () => {
  const a = path.join(tmpRoot, 'p1');
  const b = path.join(tmpRoot, 'f1');
  const r = userData.resolve(a, b);
  return r.changed === false && r.dir === a && r.reason === null ? true : JSON.stringify(r);
});
t('默认不可写、备选可写 → 切换并给出原因', () => {
  const a = path.join(tmpRoot, 'occupied2');
  const b = path.join(tmpRoot, 'fallback2');
  fs.writeFileSync(a, 'x');
  const r = userData.resolve(a, b);
  return r.changed === true && r.dir === b && typeof r.reason === 'string' ? true : JSON.stringify(r);
});
t('两边都不可写 → failed 且仍返回默认目录', () => {
  const a = path.join(tmpRoot, 'occupied3');
  const b = path.join(tmpRoot, 'occupied4');
  fs.writeFileSync(a, 'x');
  fs.writeFileSync(b, 'x');
  const r = userData.resolve(a, b);
  return r.failed === true && r.changed === false && r.dir === a ? true : JSON.stringify(r);
});
t('默认目录不可写时不会误报 failed', () => {
  const a = path.join(tmpRoot, 'occupied5');
  const b = path.join(tmpRoot, 'fallback5');
  fs.writeFileSync(a, 'x');
  const r = userData.resolve(a, b);
  return r.failed === undefined ? true : '不该有 failed';
});

console.log('[3] 真实权限现场（本机 %APPDATA% 是否可写只做记录）');
t('对本机 AppData\\Roaming 下的新目录能给出明确结论', () => {
  const d = path.join(os.homedir(), 'AppData', 'Roaming', '__sb-userdata-probe-' + process.pid);
  const r = userData.isWritable(d);
  clean(d);
  if (r.ok) { console.log('    · 本机可写（沙箱外运行时正常）'); return true; }
  console.log('    · 本机被拒绝：' + r.error + '（与真实故障同形，回退逻辑会生效）');
  return typeof r.error === 'string' ? true : '没给出错误码';
});

console.log('[4] 接线（index.js）');
const indexSrc = fs.readFileSync(path.join(ROOT, 'src/main/index.js'), 'utf8');
t('引用了 src/main/userData', () => /require\('\.\/userData'\)/.test(indexSrc) ? true : '没 require');
t('用 app.getPath(\'userData\') 做首选路径', () =>
  /userData\.resolve\(app\.getPath\('userData'\)/.test(indexSrc) ? true : '没传首选路径');
t('回退目录是 <数据目录>/userdata', () =>
  /path\.join\(paths\.DATA, 'userdata'\)/.test(indexSrc) ? true : '回退目录不对');
t('切换时调用 app.setPath', () =>
  /app\.setPath\('userData', USER_DATA\.dir\)/.test(indexSrc) ? true : '没 setPath');
t('兜底发生在 requestSingleInstanceLock 之前', () => {
  const a = indexSrc.indexOf("userData.resolve(app.getPath('userData')");
  const b = indexSrc.indexOf('app.requestSingleInstanceLock()');
  return a > 0 && b > 0 && a < b ? true : `顺序不对（${a} / ${b}）`;
});
t('锁失败的分支会打出 userData 路径（便于判断是权限还是残留实例）', () =>
  /单实例锁被占用[\s\S]{0,200}userData=/.test(indexSrc) ? true : '没打出路径');

clean(tmpRoot);

console.log('');
if (fails.length) {
  console.log(`userdata：${pass} 通过 / ${fails.length} 失败`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`userdata：${pass} 通过 / 0 失败`);
