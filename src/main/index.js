'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const paths = require('./paths');
const logger = require('./logger');
const userData = require('./userData');
const { readJson, writeJson } = require('./store');
const nxm = require('./nxm');

paths.ensure();

/* ------------------------------------------------------------
 * userData 目录可写性兜底（必须在 app ready 与单实例锁之前）
 *
 * `%APPDATA%\<应用名>` 写不进去时，Chromium 只打两行 ERROR
 * （`Lock file can not be created: 拒绝访问 (0x5)`），
 * `requestSingleInstanceLock()` 于是返回 false，我们按「已有实例在跑」退出 0 ——
 * 用户看到的就是「双击没反应」。这里先探一次写入，不行就换到
 * <数据目录>/userdata 继续跑，并把原因写进日志。
 * ------------------------------------------------------------ */
const USER_DATA = userData.resolve(app.getPath('userData'), path.join(paths.DATA, 'userdata'));
if (USER_DATA.changed) {
  try {
    app.setPath('userData', USER_DATA.dir);
    try { app.setPath('sessionData', USER_DATA.dir); } catch { /* 老版本没有这个 path */ }
    console.error('[启动] 默认用户数据目录不可写（' + USER_DATA.reason + '），'
      + '已改用：' + USER_DATA.dir);
  } catch (e) {
    console.error('[启动] 切换用户数据目录失败：' + e.message);
  }
} else if (USER_DATA.failed) {
  console.error('[启动] 用户数据目录和备选目录都不可写（' + USER_DATA.reason + '），'
    + '接下来可能会出现「单实例锁被占用」并直接退出 —— 请检查安全软件是否拦了写盘。');
}

// 日志要**尽早**装上：后面的 GPU 崩溃重启、协议注册、ipc 注册都会往它里面写。
// 装在 paths.ensure() 之后、其它模块 require 之前，保证从第一条启动信息起就有记录。
logger.install({ version: app.getVersion() });

/* ============================================================
 * 渲染后端与兼容模式
 *
 * 背景：部分 Windows 环境（虚拟机 / 远程桌面 / 驱动异常 / 受限会话）
 * 无法建立 Chromium 的进程沙箱，表现为 GPU 进程反复崩溃，
 * 随后 Electron 直接 FATAL 退出 —— 用户只看到"闪一下就没了"。
 * 实测：加 --no-sandbox 可解决；单独加 --disable-gpu 无效。
 *
 * 策略：
 *   1. 默认正常启动（保留进程沙箱与硬件加速）
 *   2. 启动 20 秒内检测到 GPU 进程崩溃 → 记住兼容模式 → 自动重启一次
 *   3. 之后每次启动直接走兼容模式，不再闪退
 *   4. 加 --gpu 参数可强制回到正常模式
 * ============================================================ */

const ARGV = process.argv;
const FORCE_COMPAT = ARGV.includes('--compat');
const FORCE_GPU = ARGV.includes('--gpu');

function readFlag(key) {
  try { return !!readJson(paths.configFile, {})[key]; } catch { return false; }
}
function writeFlag(key, value) {
  try {
    const cfg = readJson(paths.configFile, {});
    cfg[key] = value;
    writeJson(paths.configFile, cfg);
  } catch { /* 写不进去就只在本次生效 */ }
}

const USE_COMPAT = FORCE_COMPAT || (readFlag('renderCompat') && !FORCE_GPU);

/**
 * 兼容模式要用的开关。
 *
 * ⚠️ 这些开关**必须**也在命令行上（启动器 / 重启时传），只靠
 *    `app.commandLine.appendSwitch()` 是救不回来的：
 *    浏览器进程的沙箱在 main JS 跑起来**之前**就建好了，arg 加太晚，
 *    只对之后拉起的 GPU / 渲染子进程有效。沙箱建不出来的环境里，
 *    进程会直接 `__debugbreak()` 退出（退出码 -2147483645 / 0x80000003），
 *    连一行日志都来不及写 —— 表现为「窗口闪都不闪，双击没反应」。
 *    实测：同名参数放到命令行上，同一个 exe 就能正常起来。
 */
const COMPAT_FLAGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-software-rasterizer'
];

if (USE_COMPAT) {
  app.disableHardwareAcceleration();
  for (const f of COMPAT_FLAGS) app.commandLine.appendSwitch(f.slice(2));
  if (!ARGV.some(a => a === '--no-sandbox')) {
    console.error('[启动] 兼容模式是由程序内判定的，但命令行上缺 --no-sandbox。'
      + '如果这台机器连窗口都没出现就退出（退出码 -2147483645），请用「启动-兼容模式.bat」。');
  }
}

/**
 * 高分屏。
 *
 * 打包出来的 exe 自带 `dpiAware=true/pm`（按显示器感知 DPI），Windows 不会把
 * 界面当成 96 DPI 位图拉伸，所以在 4K / 200% 缩放下文字和封面都是原生的清晰度。
 * 这里再显式打开 Chromium 的高 DPI 支持开关：个别机器（尤其是混合缩放的多屏、
 * 或者从 100% 屏拖到 150% 屏）不加这一条会出现「界面突然变糊」。
 *
 * 注意**不要**再设 `force-device-scale-factor` —— 那会强制忽略用户的系统缩放，
 * 在 150% 的屏幕上界面会小得没法看。用户想更大/更小，用系统缩放或 Ctrl+加减。
 */
app.commandLine.appendSwitch('high-dpi-support', '1');

const START_AT = Date.now();
let gpuCrashes = 0;
let relaunching = false;

app.on('child-process-gone', (_event, details) => {
  if (!details || details.type !== 'GPU') return;
  if (USE_COMPAT || relaunching) return;

  gpuCrashes++;
  // 只把"启动初期"的崩溃判定为环境不兼容，避免误伤运行中的偶发崩溃
  if (gpuCrashes > 1 || Date.now() - START_AT > 20000) return;

  relaunching = true;
  writeFlag('renderCompat', true);
  console.error('[启动] GPU 进程不可用，已记住兼容模式并自动重启…');

  // ⚠️ 开发态与打包态的重启方式不一样：
  //   · 开发态：`process.execPath` 是 electron.exe，必须把 app 目录当参数传进去
  //   · 打包态：`process.execPath` 就是本程序 exe，**再传 app.asar 路径反而多此一举**
  //     （打包后 Electron 只认自己 resources 里的 app，多传的参数只会原样进 argv）
  //   `app.relaunch()` 两种情况下都对，所以打包态优先用它。
  // 重启时**必须**把兼容开关带在命令行上（原因见 COMPAT_FLAGS 的注释）：
  // 只传 `--compat` 的话，那些 appendSwitch 又变成"加太晚"，沙箱建不出来的机器上
  // 重启后会直接 0x80000003 静默退出 —— 看起来就是"自动重启之后彻底没反应了"。
  try {
    if (app.isPackaged) {
      app.relaunch({ args: COMPAT_FLAGS.concat(['--compat']) });
    } else {
      spawn(process.execPath, [app.getAppPath(), '--compat'].concat(COMPAT_FLAGS), {
        detached: true,
        stdio: 'ignore'
      }).unref();
    }
  } catch (e) {
    console.error('[启动] 自动重启失败：' + e.message);
    relaunching = false;
    return;
  }
  app.exit(0);
});

/* ============================================================ */

let win = null;

/** 应用已在运行时，把 nxm 链接直接推给渲染层 */
function flushNxm() {
  const info = nxm.peekPending();
  if (!info) return;

  // 主进程**直接接管**：这是「用户点了一次」之后的全自动起点。
  // 不再等界面确认，链接一到就进下载队列（授权 key/expires 只在内存里，不落盘）。
  try {
    const r = require('./ipc').handleIncomingNxm(info);
    if (r && typeof r.catch === 'function') r.catch(e => console.error('[nxm] 接管失败：' + e.message));
  } catch (e) {
    console.error('[nxm] 接管失败：' + e.message);
  }

  if (!win || win.isDestroyed()) return;
  const send = () => {
    const v = nxm.takePending();
    if (!v || !win || win.isDestroyed()) return;
    win.webContents.send('nxm:incoming', v);
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#14161A',
    title: '剑星 Mod 管理器',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.mainApp = true; // 标记主窗口，便于其它模块定位（登录窗口等）

  win.once('ready-to-show', () => win.show());

  /* 兜底显示：正常情况下 `ready-to-show` 会来，但实测有机器（GPU 初始化失败、
   * 远程桌面、安全软件插手）这个事件永远不来 —— 窗口一直 `show:false` 藏着，
   * 主进程活着占住单实例锁，于是**双击图标毫无反应**（2026-11-10 用户报障：
   * 一个 01:26 起的进程 MainWindowHandle=0，之后每次启动都只写一行
   * 「单实例锁被占用」就退出）。这里 8 秒后强制显示一次，宁可白窗口也别当僵尸。 */
  setTimeout(() => {
    try {
      if (win && !win.isDestroyed() && !win.isVisible()) {
        console.error('[启动] ready-to-show 迟迟不来，强制显示主窗口');
        win.show();
      }
    } catch { /* 窗口已销毁就算了 */ }
  }, 8000).unref?.();

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 外部链接一律交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (ARGV.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  setupScreenshotMode();
  return win;
}

/** 开发辅助：--shot=<png> 渲染完成后截图并退出，用于自动化验证界面 */
function setupScreenshotMode() {
  const shotArg = ARGV.find(a => a.startsWith('--shot='));
  if (!shotArg) return;

  const out = shotArg.slice('--shot='.length);
  const delay = Number((ARGV.find(a => a.startsWith('--shot-delay=')) || '').split('=')[1]) || 3500;
  const shotPage = (ARGV.find(a => a.startsWith('--shot-page=')) || '').split('=')[1];
  // `--shot-eval=<表达式>` 直接内联；`--shot-eval-file=<路径>` 从文件读。
  // 后者是为了绕开 Git Bash 对引号/等号/反斜杠的改写 —— 稍长一点的脚本
  // 内联进来必然被 shell 揉烂（`https://` 被当路径、`=` 被截断）。
  const shotEvalFile = (ARGV.find(a => a.startsWith('--shot-eval-file=')) || '').slice('--shot-eval-file='.length);
  const shotEval = shotEvalFile
    ? (() => { try { return require('fs').readFileSync(shotEvalFile, 'utf8'); } catch (e) { console.error('SHOT_EVAL_FILE_ERR ' + e.message); return ''; } })()
    : (ARGV.find(a => a.startsWith('--shot-eval=')) || '').slice('--shot-eval='.length);

  win.webContents.once('did-finish-load', () => {
    if (shotPage) {
      setTimeout(() => {
        win.webContents.executeJavaScript(
          `window.switchPage && window.switchPage(${JSON.stringify(shotPage)})`
        ).catch(() => {});
      }, 1200);
    }
    if (shotEval) {
      setTimeout(() => {
        // 从文件读来的脚本包一层 async IIFE：里面可以直接写 `await` 与 `return`。
        // 内联的 `--shot-eval=` 保持「当表达式求值」的旧行为，不破坏已有探针。
        const code = shotEvalFile ? '(async () => { ' + shotEval + ' })()' : shotEval;
        win.webContents.executeJavaScript(code)
          .then(r => console.log('SHOT_EVAL ' + JSON.stringify(r)))
          .catch(e => console.error('SHOT_EVAL_ERR ' + e.message));
      }, 3000);
    }
    setTimeout(async () => {
      try {
        // ⚠️ `capturePage()` 拿的是**最后一次合成帧**。窗口如果不重绘
        //    （兼容模式下没有 GPU 合成，窗口又没焦点时很常见），会拍到旧画面 ——
        //    实测踩过：DOM 已经更新成「已安装」，截图里还是「未安装」。
        //    强制失效一次再截，能显著降低这种假象。
        if (typeof win.webContents.invalidate === 'function') win.webContents.invalidate();
        await new Promise(r => setTimeout(r, 400));
        const img = await win.webContents.capturePage();
        require('fs').writeFileSync(out, img.toPNG());
        console.log('SHOT_SAVED ' + out);
      } catch (e) {
        console.error('SHOT_FAILED ' + e.message);
      }
      app.exit(0);
    }, delay);
  });
}

/* ============================================================
 * 「后台还活着、窗口却不见了」的自救
 *
 * 2026-11-10 用户报障：「portable 双击没有任何效果」。查下来不是包的问题 ——
 * 一个 01:26 起的实例主进程仍在（MainWindowHandle=0、渲染进程也在），
 * 占着单实例锁；之后每次启动（安装版快捷方式、portable）都只写一行
 * 「单实例锁被占用，本次启动直接退出」就没了，用户看到的就是「双击没反应」。
 *
 * 所以这里做三件事：
 *   1. 主窗口 8 秒还没显示就强制 show（createWindow 里）
 *   2. 第二个实例进来时，除了 restore/focus，还要 show —— 光 focus 一个隐藏窗口是没用的
 *   3. 抢不到锁时不再静默退出：等对方心跳，迟迟不来就当僵尸，自动「杀掉 + 重启」
 *
 * ⚠️ 第 3 条**刻意不用弹窗**：万一对话框所在的环境根本显示不出来（远程桌面、别的
 *    桌面上、被安全软件拦），showMessageBoxSync 会把这个新进程也一起挂死 ——
 *    用户看到的就是「点了没反应，任务管理器里还越点越多」。宁可自动重启一次。
 * ============================================================ */
const ALIVE_FILE = path.join(app.getPath('userData'), 'instance-alive.txt');
const ZOMBIE_WAIT_MS = 12000; // 这么久都没有心跳，就当对方卡住了

function touchAlive(tag) {
  try { require('fs').writeFileSync(ALIVE_FILE, String(Date.now()) + ' ' + (tag || '') + '\n'); } catch { /* 写不进去不影响运行 */ }
}

function aliveMtime() {
  try { return require('fs').statSync(ALIVE_FILE).mtimeMs; } catch { return 0; }
}

/** 把主窗口弄到前面：隐藏的 show、最小化的 restore、已销毁的重新建。 */
function showMainWindow() {
  if (!win || win.isDestroyed()) {
    try { createWindow(); } catch (e) { console.error('[启动] 重建主窗口失败：' + e.message); }
    return;
  }
  try { if (win.isMinimized()) win.restore(); } catch { /* 忽略 */ }
  try { if (!win.isVisible()) win.show(); } catch { /* 忽略 */ }
  try { win.setSkipTaskbar(false); } catch { /* 忽略 */ }
  try { win.moveTop(); } catch { /* 忽略 */ }
  try { win.focus(); } catch { /* 忽略 */ }
}

/** 强制结束本应用的所有进程（除了自己）。装过 Mod 的文件一律不动，只杀进程。 */
function killOtherInstances() {
  const exeName = path.basename(process.execPath);
  const names = [...new Set([exeName, '剑星 Mod 管理器.exe', 'SBModManager.exe'])];
  const filter = names.map(n => "Name='" + n.replace(/'/g, "''") + "'").join(' or ');
  const ps = 'Get-CimInstance Win32_Process -Filter "' + filter + '"'
    + ' | Where-Object { $_.ProcessId -ne ' + process.pid + ' }'
    + ' | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }';
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 20000 });
    console.log('[启动] 已强制结束旧实例');
  } catch (e) {
    console.error('[启动] 强制结束旧实例失败：' + e.message);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 两条路：①正常 —— 另一个实例收到 second-instance 会把窗口顶到前面，我们退出；
  //        ②僵尸 —— 那个实例活着但没窗口（或主线程卡死），于是「双击毫无反应」。
  // 区分办法：对方在 second-instance 里会写一行心跳；迟迟没有心跳就是僵尸。
  //
  // ⚠️ 这条分支退出码是 **0**。自动化截图（--shot）静默失效的头号原因就是
  //    残留实例占着锁 —— 表现为「脚本说成功了，但 png 没生成、日志空、退出码 0」。
  //
  // ⚠️ 第二种原因和「残留实例」毫无关系：userData 目录写不进去时，Chromium
  //    建不出锁文件（native 层报 `Lock file can not be created: 拒绝访问 (0x5)`），
  //    这里同样会拿到 false。区分办法看上面有没有「默认用户数据目录不可写」，
  //    真正的锁被占用则会在日志里看到上一实例的启动块。
  console.error('[启动] 单实例锁被占用，先看对方是否响应'
    + ' · userData=' + app.getPath('userData'));
  const before = aliveMtime();
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (aliveMtime() > before) {
      clearInterval(timer);
      console.log('[启动] 另一个实例已响应（窗口应该已经顶到前面），本次退出');
      app.quit();
      return;
    }
    if (Date.now() - startedAt < ZOMBIE_WAIT_MS) return;
    clearInterval(timer);
    console.error('[启动] 对方 ' + Math.round(ZOMBIE_WAIT_MS / 1000) + ' 秒没有心跳 —— 判定为卡住的僵尸实例，自动强制重启');
    killOtherInstances();
    setTimeout(() => {
      // portable（NSIS 自解压）要走它自己的外层 exe，否则 relaunch 的是 %TEMP% 里那份临时副本
      const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      try { app.relaunch({ execPath: target }); } catch { try { app.relaunch(); } catch { /* 忽略 */ } }
      app.exit(0);
    }, 900);
  }, 500);
  if (timer.unref) timer.unref();
} else {
  app.on('second-instance', (_event, argv) => {
    console.log('[启动] 收到第二实例调起，argv=' + JSON.stringify(argv));
    touchAlive('second-instance');
    showMainWindow();
    const info = nxm.extractNxmFromArgv(argv);
    if (info) {
      console.log('[nxm] 从第二实例收到链接：' + info.game + ' mod=' + info.modId + ' file=' + info.fileId);
      nxm.setPending(info);
      flushNxm();
    }
  });

  app.whenReady().then(() => {
    touchAlive('ready'); // 心跳：让「抢不到锁的那个实例」知道我们活着（见上面 ALIVE_FILE 的说明）
    console.log('[启动] app ready · 兼容模式=' + USE_COMPAT
      + ' · 打包=' + app.isPackaged
      + ' · 数据目录=' + paths.DATA
      + ' · 用户数据目录=' + app.getPath('userData'));

    require('./ipc').register();
    createWindow();

    // 陈旧临时目录的清扫**必须放在窗口之后、异步做**（2026-11-10 修「启动黑屏」）。
    // 原来它在 createWindow() 之前同步跑：data/tmp 里只要有一个删不掉的目录
    // （只读属性 / 被杀软占着），fs.rmSync 的重试退避就能把主进程卡住十几秒 ——
    // 窗口迟迟不建、ready-to-show 也不来，用户看到的是「启动黑屏，过一会儿自己退出」，
    // 再点一次还会撞上单实例锁。窗口优先，清扫可以晚点慢慢做。
    setTimeout(() => {
      try {
        const inst = require('./installer');
        const swept = inst.sweepStaleTmp();
        if (swept.length) console.log('[启动] 清理陈旧临时目录 ' + swept.length + ' 个：' + swept.join(', '));
        const trash = inst.sweepTrash();
        if (trash.length) console.log('[启动] 清理待删目录 ' + trash.length + ' 个：' + trash.join(', '));
      } catch (e) {
        console.error('[启动] 清理临时目录失败：' + e.message);
      }
    }, 5000).unref?.();

    // 注册 nxm:// 协议处理器（用户点「Mod Manager Download」时由系统调起本程序）
    const okReg = nxm.registerProtocol();
    console.log('[nxm] 协议注册' + (okReg ? '成功' : '失败') + '，当前是否默认处理器：' + nxm.isProtocolRegistered());

    // 冷启动：从命令行参数里找 nxm 链接
    const cold = nxm.extractNxmFromArgv(ARGV);
    if (cold) {
      console.log('[nxm] 冷启动收到链接：' + cold.game + ' mod=' + cold.modId + ' file=' + cold.fileId);
      nxm.setPending(cold);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 退出前把日志缓冲区刷到磁盘，否则最后几条（往往正是崩溃原因）会丢
  app.on('will-quit', () => {
    console.log('[启动] 应用退出');
    logger.close();
  });
}
