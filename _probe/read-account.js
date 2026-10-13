'use strict';
/**
 * 调试探针：探测 Nexus 账号页 DOM 结构，寻找可靠的主体内容区域。
 * 用法：
 *   PROBE_URL="https://..." PROBE_WAIT=9000 \
 *     env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe _probe/read-account.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const APP_NAME = '剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

const url = process.env.PROBE_URL || 'https://www.nexusmods.com/users/myaccount';
const waitMs = Number(process.env.PROBE_WAIT) || 9000;

const SCRIPT = `(() => {
 try {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    return { sel: sel, len: t.length, head: t.slice(0, 400) };
  };
  const sels = ['main', '#mainContent', '#main-content', '.main-content', 'article',
                '[role=main]', '#content', '.content', '#react-root'];
  const regions = sels.map(pick).filter(Boolean);

  const forms = [];
  document.querySelectorAll('form').forEach(f => {
    forms.push({ action: f.getAttribute('action') || '', inputs: Array.from(f.querySelectorAll('input')).map(i => i.name || i.type) });
  });

  const bodyText = document.body ? (document.body.innerText || '') : '';
  const signals = {
    accessDenied: /Access Denied|Full authentication is required/i.test(bodyText),
    personalApiKey: /Personal API Key/i.test(bodyText),
    signOut: /Sign out/i.test(bodyText),
    logInLink: !!document.querySelector('a[href*="sign_in"], a[href*="login"]'),
    avatar: !!document.querySelector('img[class*="avatar"], [class*="avatar"] img')
  };

  return {
    url: location.href,
    title: document.title,
    bodyLen: bodyText.length,
    text: bodyText.slice(0, 20000),
    regions: regions,
    forms: forms,
    signals: signals
  };
 } catch (e) {
   return { scriptError: String((e && e.stack) || e) };
 }
})()`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { partition: 'persist:nexus', contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  await w.loadURL(url).catch(e => console.log('LOADERR ' + e.message));
  await new Promise(r => setTimeout(r, waitMs));

  let s;
  try {
    s = await w.webContents.executeJavaScript(SCRIPT);
  } catch (e) {
    s = { err: e.message };
  }
  require('fs').writeFileSync(path.join(__dirname, 'out.txt'), JSON.stringify(s, null, 2), 'utf8');
  console.log('WROTE len=' + (s.bodyLen || 0));
  w.destroy();
  setTimeout(() => app.exit(0), 600);
});
