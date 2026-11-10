'use strict';
/**
 * 「启动黑屏、过一会儿自己退出」回归自检（0.4.21）。
 *
 * 根因：启动时在 createWindow() **之前**同步清扫 data/tmp；里面只要有一个目录带
 * ReadOnly 属性（解压残留常见），fs.rmSync 就会一直 EPERM，重试退避合计十几秒 ——
 * 窗口迟迟不建、ready-to-show 也不来，用户看到黑屏，第二个实例还会撞上单实例锁。
 *
 * 这里盯两件事：
 *   A. rmrf 真能把「带只读属性的目录树」删掉（先清只读位再删）；
 *   B. index.js 里清扫必须排在 createWindow() 之后，并且是异步的。
 *
 * 用法：node _probe/blackstart-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LF = String.fromCharCode(10);

let pass = 0;
let fail = 0;
const fails = [];
function t(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) {
      pass++;
      console.log('  ✓ ' + name);
    } else {
      fail++;
      fails.push(name + ' → ' + r);
      console.log('  ✗ ' + name + ' → ' + r);
    }
  } catch (e) {
    fail++;
    fails.push(name + ' → ' + e.message);
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}

const installerSrc = fs.readFileSync(path.join(ROOT, 'src/main/installer.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'src/main/index.js'), 'utf8');
const installer = require(path.join(ROOT, 'src/main/installer.js'));

console.log('\n=== A. rmrf 要能删掉带只读属性的目录树 ===');

t('installer 导出了 rmrf', () => (typeof installer.rmrf === 'function' ? true : '没有 rmrf'));

t('带只读属性的目录树能删干净（真实建目录跑一遍）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-blackstart-'));
  const sub = path.join(base, 'extract-1.trash-2', 'ModDir');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'x.pak');
  fs.writeFileSync(f, 'x');
  // Windows 上「只读」在 Node 里体现为去掉写位
  fs.chmodSync(f, 0o444);
  fs.chmodSync(sub, 0o444);
  const okDel = installer.rmrf(path.join(base, 'extract-1.trash-2'));
  const gone = !fs.existsSync(path.join(base, 'extract-1.trash-2'));
  try { fs.chmodSync(sub, 0o777); } catch { /* 已经删了 */ }
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* 收尾失败不影响断言 */ }
  if (!okDel) return 'rmrf 返回 false';
  return gone || '目录还在';
});

t('源码里有「先清只读位再删」这一步', () => {
  if (!indexSrc && !installerSrc) return '读不到源码';
  if (!installerSrc.includes('function clearReadonlyTree(')) return '没有 clearReadonlyTree';
  if (!installerSrc.includes('fs.chmodSync(q, st.isDirectory() ? 0o777 : 0o666)')) return '没去掉只读位';
  return installerSrc.includes('clearReadonlyTree(dir);') || '失败分支里没调用';
});

t('重试次数可配（清扫用小的 attempts，别卡主进程）', () => {
  if (!installerSrc.includes('const maxAttempt = Math.max(1, Number(opts.attempts) || 5);')) return '没有 maxAttempt';
  if (!installerSrc.includes('for (let attempt = 0; attempt < maxAttempt; attempt++) {')) return '循环没用 maxAttempt';
  if (!installerSrc.includes('attempt === maxAttempt - 1')) return '最后一次判断还是写死的 4';
  return true;
});

t('两个清扫函数都用 attempts: 2（后台慢慢来，宁可不删也别卡）', () => {
  if (!installerSrc.includes('if (rmrf(p, { attempts: 2 })) swept.push(it.name);')) return 'sweepStaleTmp 没限制重试';
  return installerSrc.includes('{ noRename: true, attempts: 2 }') || 'sweepTrash 没限制重试';
});

console.log('\n=== B. 启动顺序：窗口优先，清扫在后 ===');

const norm = indexSrc.replace(new RegExp(String.fromCharCode(13) + LF, 'g'), LF);

t('createWindow() 在 whenReady 里出现', () => {
  return norm.indexOf('createWindow();') > 0 || '没找到 createWindow()';
});

t('清扫排在 createWindow() 之后（否则黑屏会重演）', () => {
  const winAt = norm.indexOf('    createWindow();');
  const sweepAt = norm.indexOf('inst.sweepStaleTmp()');
  if (winAt < 0) return '没找到 createWindow()';
  if (sweepAt < 0) return '没找到 sweepStaleTmp()';
  return winAt < sweepAt || '清扫还在 createWindow() 之前';
});

t('清扫是异步的（包在 setTimeout 里）', () => {
  const at = norm.indexOf('inst.sweepStaleTmp()');
  const before = norm.slice(Math.max(0, at - 900), at);
  if (!before.includes('setTimeout(() => {')) return '没有包在 setTimeout 里';
  return /},\s*\d+\)\.unref\?\.\(\);/.test(before + norm.slice(at, at + 400))
    ? true
    : '没有看到 setTimeout 的毫秒数';
});

t('源码里写明了为什么不能同步清扫（黑屏/单实例锁的因果）', () => {
  if (!norm.includes('启动黑屏')) return '没注释来由';
  return norm.includes('单实例锁') || '没提第二实例会撞锁';
});

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) {
  console.log('\n失败项：');
  for (const f of fails) console.log('  - ' + f);
  process.exitCode = 1;
}
