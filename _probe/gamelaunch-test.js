/**
 * 「启动游戏」自检：exe 定位、能不能起的判定、spawn 参数、接线是否齐全。
 * 不真的启动游戏 —— 用 opts.spawnImpl 抓参数。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0; let fail = 0; const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('断言为 false');
    pass++;
  } catch (e) {
    fail++;
    fails.push(label + ' → ' + e.message);
    console.log('  ✗ ' + label + ' → ' + e.message);
  }
}
function eq(a, b, label) {
  t(label, () => {
    if (a !== b) throw new Error(JSON.stringify(a) + ' !== ' + JSON.stringify(b));
  });
}
const ok = (v, label) => t(label, () => v);

const gameLaunch = require('../src/main/gameLaunch');
const game = require('../src/main/game');

console.log('\n=== A) exe 定位 ===');
{
  const root = 'C:\\Star Blade';
  eq(gameLaunch.exeOf(root), path.join(root, game.EXE_REL), 'exeOf 拼出 SB\\Binaries\\Win64\\SB-Win64-Shipping.exe');
  ok(gameLaunch.exeOf(root).toLowerCase().endsWith('sb-win64-shipping.exe'), '后缀是游戏主程序');
  eq(gameLaunch.exeOf(''), '', 'root 为空时 exe 为空串');
  eq(gameLaunch.exeOf(null), '', 'root 为 null 时 exe 为空串');
}

console.log('\n=== B) 能不能起的判定 ===');
{
  const noRoot = gameLaunch.plan('');
  eq(noRoot.ok, false, '没游戏目录 → 不能起');
  eq(noRoot.code, 'no-root', 'code=no-root');
  ok(noRoot.reason.includes('还没设置游戏目录'), '文案说清是没设置游戏目录');

  const missing = gameLaunch.plan('C:\\Star Blade', () => false);
  eq(missing.ok, false, 'exe 不在 → 不能起');
  eq(missing.code, 'missing', 'code=missing');
  ok(missing.reason.includes('找不到游戏主程序'), '文案里说找不到主程序');
  ok(missing.reason.toLowerCase().includes('sb-win64-shipping.exe'), '文案里给出具体文件名');

  const good = gameLaunch.plan('C:\\Star Blade', () => true);
  eq(good.ok, true, 'exe 在 → 能起');
  eq(good.cwd, path.join('C:\\Star Blade', 'SB', 'Binaries', 'Win64'), '工作目录是 exe 那一层');
  eq(good.code, '', '正常时 code 为空');
}

console.log('\n=== C) spawn 参数（不真起） ===');
{
  // 2026-11-22：游戏目录从 C:\\Star Blade 搬到了 C:\\games\\Star Blade，探针不能再写死旧路径 ——
  // 造一个临时「游戏根」，里面放个同名空文件当 exe，launch 的 existsSync 就过得去。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-gl-'));
  fs.mkdirSync(path.join(tmpRoot, 'SB', 'Binaries', 'Win64'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'SB', 'Binaries', 'Win64', 'SB-Win64-Shipping.exe'), '');
  const calls = [];
  const fakeSpawn = (exe, args, opts) => { calls.push({ exe, args, opts }); return { pid: 4321, unref() { } }; };
  const r = gameLaunch.launch(tmpRoot, { spawnImpl: fakeSpawn });
  eq(calls.length, 1, '只 spawn 一次');
  eq(calls[0].exe, gameLaunch.exeOf(tmpRoot), 'spawn 的是游戏主程序');
  eq(JSON.stringify(calls[0].args), '[]', '不传参数');
  eq(calls[0].opts.detached, true, 'detached（关掉管理器不带走游戏）');
  eq(calls[0].opts.stdio, 'ignore', 'stdio=ignore（不接管道）');
  eq(calls[0].opts.cwd, path.join(tmpRoot, 'SB', 'Binaries', 'Win64'), 'cwd 是 exe 那一层');
  eq(r.pid, 4321, '返回 pid');
  eq(r.ok, true, '返回 ok');

  let threw = '';
  try { gameLaunch.launch(''); } catch (e) { threw = e.message; }
  ok(threw.includes('还没设置游戏目录'), '没目录时直接抛错');

  const dry = gameLaunch.launch(tmpRoot, { dryRun: true });
  eq(dry.pid, 0, 'dryRun 不起进程');
  eq(dry.dryRun, true, 'dryRun 有标记');
  eq(dry.cwd, path.join(tmpRoot, 'SB', 'Binaries', 'Win64'), 'dryRun 也给 cwd');
}

console.log('\n=== D) 真文件系统：合成游戏根 ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-launch-'));
  const root = path.join(tmp, 'Star Blade');
  const win64 = path.join(root, 'SB', 'Binaries', 'Win64');
  fs.mkdirSync(win64, { recursive: true });
  fs.writeFileSync(path.join(win64, 'SB-Win64-Shipping.exe'), 'MZ');
  eq(gameLaunch.plan(root).ok, true, '合成根能起');
  const dry = gameLaunch.launch(root, { dryRun: true });
  ok(dry.exe.startsWith(root), 'exe 在合成根里');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n=== E) 接线 ===');
{
  const ipcSrc = read('src/main/ipc.js');
  const preSrc = read('src/preload/index.js');
  const htmlSrc = read('src/renderer/index.html');
  const appSrc = read('src/renderer/app.js');

  ok(/const gameLaunch = require\('\.\/gameLaunch'\);/.test(ipcSrc), 'ipc 引了 gameLaunch');
  ok(ipcSrc.includes("handle('game:launch'"), 'ipc 有 game:launch 通道');
  ok(ipcSrc.includes('gameLaunch.plan(root)') || ipcSrc.includes('gameLaunch.plan('), '先 plan 再起（缺 exe 时给人话）');
  ok(ipcSrc.includes("logger.event('game:launch'"), '启动会写日志');
  ok(preSrc.includes("launch: () => invoke('game:launch')"), 'preload 有 game.launch()');

  ok(htmlSrc.includes('id="btnLaunch"'), 'index.html 顶栏有「启动游戏」按钮');
  ok(htmlSrc.indexOf('id="btnLaunch"') < htmlSrc.indexOf('id="btnRefresh"'), '按钮在「刷新」左边');

  ok(appSrc.includes("$('#btnLaunch').addEventListener('click'"), '按钮有点击处理');
  ok(appSrc.includes('window.api.game.launch()'), '点击调 game.launch()');
  ok(appSrc.includes('function syncLaunchBtn()'), '有 syncLaunchBtn()（没游戏目录时置灰）');
  ok(appSrc.includes("btn.disabled = !ok"), '置灰逻辑存在');
  ok(appSrc.includes('正在启动游戏…'), '启动后有 toast');

  const keys = JSON.parse(read('_probe/i18n-keys.json'));
  const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
  for (const k of ['启动游戏', '直接启动游戏（不走 Steam，绿色版 / Steam / Epic 都行）',
    '还没设置游戏目录，先到设置里选一下', '正在启动游戏…']) {
    ok(keyList.includes(k), 'i18n 有键：' + k.slice(0, 16));
  }
  const pkg = JSON.parse(read('package.json'));
  ok(!!pkg.scripts['test:gameLaunch'] || !!pkg.scripts['test:gamelaunch'], 'package.json 有 test:gameLaunch 脚本');
}

console.log('\n========================================================');
console.log((fail === 0 ? '✅ ' : '❌ ') + 'gamelaunch: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log(fails.join('\n')); process.exitCode = 1; }
console.log('========================================================');
