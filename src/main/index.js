'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const paths = require('./paths');
const logger = require('./logger');
const { readJson, writeJson } = require('./store');
const nxm = require('./nxm');

paths.ensure();

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

if (USE_COMPAT) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

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
  try {
    if (app.isPackaged) {
      app.relaunch({ args: ['--compat'] });
    } else {
      spawn(process.execPath, [app.getAppPath(), '--compat'], {
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已经有一个实例在跑。它会在自己的 second-instance 里收到我们带的 nxm:// 参数，
  // 所以这里直接退出即可。
  //
  // ⚠️ 这条分支退出码是 **0**。自动化截图（--shot）静默失效的头号原因就是
  //    残留实例占着锁 —— 表现为「脚本说成功了，但 png 没生成、日志空、退出码 0」。
  console.error('[启动] 单实例锁被占用，本次启动直接退出（如果你在跑自动化截图，先清掉残留 electron 进程）');
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    console.log('[启动] 收到第二实例调起，argv=' + JSON.stringify(argv));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const info = nxm.extractNxmFromArgv(argv);
    if (info) {
      console.log('[nxm] 从第二实例收到链接：' + info.game + ' mod=' + info.modId + ' file=' + info.fileId);
      nxm.setPending(info);
      flushNxm();
    }
  });

  app.whenReady().then(() => {
    console.log('[启动] app ready · 兼容模式=' + USE_COMPAT
      + ' · 打包=' + app.isPackaged
      + ' · 数据目录=' + paths.DATA
      + ' · 用户数据目录=' + app.getPath('userData'));

    // 启动时顺手扫一遍陈旧的临时目录（上次异常退出留下的 extract-* / dl-*）。
    // 只清 1 小时以上的，绝不碰正在跑的安装。再收一遍「改名待删」的垃圾桶目录。
    try {
      const inst = require('./installer');
      const swept = inst.sweepStaleTmp();
      if (swept.length) console.log('[启动] 清理陈旧临时目录 ' + swept.length + ' 个：' + swept.join(', '));
      const trash = inst.sweepTrash();
      if (trash.length) console.log('[启动] 清理待删目录 ' + trash.length + ' 个：' + trash.join(', '));
    } catch (e) {
      console.error('[启动] 清理临时目录失败：' + e.message);
    }

    require('./ipc').register();
    createWindow();

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
