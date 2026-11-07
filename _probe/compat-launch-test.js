'use strict';

/**
 * 兼容模式「闪退」回归测试（0.3.0 修复的东西，别让它悄悄退化）
 *
 * 背景：沙箱建不出来的机器上，Chromium 浏览器进程会在主进程 JS 之前
 * `__debugbreak()` 退出（退出码 -2147483645 / 0x80000003），日志一条都没有。
 * 那时候 `app.commandLine.appendSwitch('no-sandbox')` 已经来不及了 ——
 * 开关必须在**命令行**上。所以启动器、自动重启、探针启动器三处都必须带参数。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

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

const index = read('src/main/index.js');
const batCompat = read('启动-兼容模式.bat');
const batMain = read('启动.bat');
const launch = read('_probe/launch.js');

console.log('[1] 主进程：兼容开关必须有命令行版本');
t('定义了 COMPAT_FLAGS 且包含 --no-sandbox', () => {
  const m = index.match(/const COMPAT_FLAGS = \[([\s\S]*?)\];/);
  if (!m) return '没找到 COMPAT_FLAGS';
  return m[1].includes("'--no-sandbox'") ? true : '缺 --no-sandbox';
});
t('COMPAT_FLAGS 含 --disable-gpu', () => {
  const m = index.match(/const COMPAT_FLAGS = \[([\s\S]*?)\];/);
  return m && m[1].includes("'--disable-gpu'") ? true : '缺 --disable-gpu';
});
t('appendSwitch 由 COMPAT_FLAGS 驱动（不各写一份）', () =>
  /for \(const f of COMPAT_FLAGS\) app\.commandLine\.appendSwitch\(f\.slice\(2\)\)/.test(index)
    ? true : '仍是手写 appendSwitch');
t('兼容模式判定后提示「命令行缺 --no-sandbox」', () =>
  /ARGV\.some\(a => a === '--no-sandbox'\)/.test(index) ? true : '没有做命令行检查');

console.log('[2] 自动重启：必须把开关带上命令行');
t('打包态 app.relaunch 传 COMPAT_FLAGS', () =>
  /app\.relaunch\(\{ args: COMPAT_FLAGS\.concat\(\['--compat'\]\) \}\)/.test(index)
    ? true : 'relaunch 只传了 --compat');
t('开发态 spawn 传 COMPAT_FLAGS', () =>
  /\[app\.getAppPath\(\), '--compat'\]\.concat\(COMPAT_FLAGS\)/.test(index)
    ? true : 'spawn 没带 COMPAT_FLAGS');
t('没有遗留「只传 --compat」的重启写法', () => {
  const bad = [
    /app\.relaunch\(\{ args: \['--compat'\] \}\)/,
    /\[app\.getAppPath\(\), '--compat'\]\s*(?!\.concat\()/
  ].filter(re => re.test(index));
  return bad.length === 0 ? true : '还有 ' + bad.length + ' 处旧写法';
});

console.log('[3] 启动器：开关在命令行上');
t('启动-兼容模式.bat 带 --no-sandbox', () =>
  /"%EXE%" "%~dp0\." %COMPAT%/.test(batCompat) && /set "COMPAT=.*--no-sandbox/.test(batCompat)
    ? true : '命令行没有开关');
t('启动-兼容模式.bat 仍有 ELECTRON_RUN_AS_NODE 清除', () =>
  /set "ELECTRON_RUN_AS_NODE="/.test(batCompat) ? true : '缺清理');
t('启动.bat 首次失败后用兼容参数重试一次', () =>
  /if "%CODE%"=="0" goto :report/.test(batMain) && /"%EXE%" "%~dp0\." %COMPAT%/.test(batMain)
    ? true : '没有重试逻辑');
t('启动.bat 的重试只做一次（没有循环跳回）', () => {
  const hits = (batMain.match(/goto :retry|:retry/gi) || []).length;
  return hits === 0 ? true : '出现了跳回重试的写法';
});
t('启动.bat 仍清 ELECTRON_RUN_AS_NODE', () =>
  /set "ELECTRON_RUN_AS_NODE="/.test(batMain) ? true : '缺清理');

console.log('[4] 启动器：把原生报错留档（闪退时唯一可查的线索）');
t('两个 bat 都定义了 LOG', () =>
  /set "LOG=%~dp0launch-log\.txt"/.test(batCompat) && /set "LOG=%~dp0launch-log\.txt"/.test(batMain)
    ? true : '缺 LOG 变量');
t('stderr 追加到日志（两个 bat 都用 2>>）', () => {
  const a = (batCompat.match(/2>>"%LOG%"/g) || []).length;
  const b = (batMain.match(/2>>"%LOG%"/g) || []).length;
  return a === 1 && b === 2 ? true : `兼容模式 ${a} 处 / 常规 ${b} 处（期望 1 / 2）`;
});
t('日志是追加不是覆盖（没有被单个 > 截断）', () => {
  const bad = [batMain, batCompat].filter(x => /2>(?!>)"/.test(x));
  return bad.length === 0 ? true : '出现了覆盖式重定向 2>';
});

console.log('[5] 探针启动器：带 --compat 时自动补开关');
t('launch.js 里补 --no-sandbox / --disable-gpu', () =>
  /args\.push\('--no-sandbox', '--disable-gpu'/.test(launch) ? true : '没补开关');
t('launch.js 只在没有 --no-sandbox 时才补', () =>
  /!args\.includes\('--no-sandbox'\)/.test(launch) ? true : '无条件补，会重复');
t('launch.js 仍然剥掉 ELECTRON_RUN_AS_NODE', () =>
  /delete env\.ELECTRON_RUN_AS_NODE/.test(launch) ? true : '缺清理');

console.log('');
if (fails.length) {
  console.log(`compat-launch：${pass} 通过 / ${fails.length} 失败`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`compat-launch：${pass} 通过 / 0 失败`);
