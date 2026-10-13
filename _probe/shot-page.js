'use strict';
/**
 * 调试探针：以登录窗口尺寸打开 Nexus 登录页，检查 UA / Turnstile 状态 / 控制台报错，并截图。
 * 用法：
 *   PROBE_URL="https://..." PROBE_WAIT=14000 PROBE_OUT="_shots/x.png" \
 *     env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe _probe/shot-page.js
 */
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = '剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

// 与 nexusAuth.js 保持一致：抹掉 Electron / 应用名 token
function cleanUA() {
  const raw = app.userAgentFallback || '';
  const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
  const plat = 'Windows NT 10.0; Win64; x64';
  return 'Mozilla/5.0 (' + plat + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
}
const UA = cleanUA();
app.userAgentFallback = UA;

const url = process.env.PROBE_URL || 'https://users.nexusmods.com/sign_in';
const waitMs = Number(process.env.PROBE_WAIT) || 14000;
const out = process.env.PROBE_OUT || path.join(__dirname, 'page.png');
const W = Number(process.env.PROBE_W) || 580;
const H = Number(process.env.PROBE_H) || 800;

app.whenReady().then(async () => {
  const s = session.fromPartition('persist:nexus');
  s.setUserAgent(UA);

  const w = new BrowserWindow({
    show: false, width: W, height: H,
    webPreferences: { partition: 'persist:nexus', contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });

  const logs = [];
  w.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && ev.message) ? ev.message : String(a[2] || '');
    if (msg) logs.push(msg.slice(0, 220));
  });

  await w.loadURL(url).catch(e => logs.push('LOADERR ' + e.message));
  await new Promise(r => setTimeout(r, waitMs));

  let info;
  try {
    info = await w.webContents.executeJavaScript(`(() => {
      const ifr = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      const ts = document.querySelector('.cf-turnstile, [data-sitekey]');
      const bodyText = (document.body && document.body.innerText) || '';
      return {
        ua: navigator.userAgent,
        url: location.href,
        title: document.title,
        webdriver: String(navigator.webdriver),
        tsIframe: !!ifr,
        tsIframeSrc: ifr ? ifr.src.slice(0, 120) : '',
        tsHost: !!ts,
        turnstileApi: typeof window.turnstile,
        errText: (bodyText.match(/(错误|失败|Error|error|请重试|重试)[^\\n]{0,120}/) || [''])[0],
        head: bodyText.replace(/\\s+/g, ' ').slice(0, 300)
      };
    })()`);
  } catch (e) { info = { err: e.message }; }

  const img = await w.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());

  console.log('OUT      : ' + out);
  console.log('UA       : ' + (info.ua || ''));
  console.log('URL      : ' + (info.url || ''));
  console.log('TITLE    : ' + (info.title || ''));
  console.log('WEBDRIVER: ' + (info.webdriver || ''));
  console.log('TS-IFRAME: ' + info.tsIframe + '  ' + (info.tsIframeSrc || ''));
  console.log('TS-API   : ' + (info.turnstileApi || ''));
  console.log('ERRTEXT  : ' + (info.errText || '(无)'));
  console.log('HEAD     : ' + (info.head || info.err || ''));
  console.log('CONSOLE  : ' + (logs.slice(0, 12).join(' | ') || '(无)'));

  w.destroy();
  setTimeout(() => app.exit(0), 800);
});
