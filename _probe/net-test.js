'use strict';
/**
 * 调试探针：用 Electron 的网络栈（走系统代理）测试关键域名连通性。
 * 用法：env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe _probe/net-test.js
 */
const { app, net, session } = require('electron');
const path = require('path');

const APP_NAME = '剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const URLS = [
  'https://challenges.cloudflare.com/turnstile/v0/api.js',
  'https://www.nexusmods.com/',
  'https://users.nexusmods.com/auth/sign_in',
  'https://api.nexusmods.com/v2/graphql'
];

app.whenReady().then(async () => {
  console.log('--- proxy ---');
  try {
    const s = session.defaultSession;
    const proxy = await s.resolveProxy('https://challenges.cloudflare.com');
    console.log('resolveProxy(challenges.cloudflare.com) = ' + proxy);
    const proxy2 = await s.resolveProxy('https://www.nexusmods.com');
    console.log('resolveProxy(www.nexusmods.com) = ' + proxy2);
  } catch (e) { console.log('proxy err ' + e.message); }

  console.log('--- net.fetch ---');
  for (const u of URLS) {
    const t0 = Date.now();
    try {
      const r = await net.fetch(u, { method: 'GET' });
      console.log((Date.now() - t0) + 'ms  ' + r.status + '  ' + u);
    } catch (e) {
      console.log((Date.now() - t0) + 'ms  ERR ' + (e && e.message) + '  ' + u);
    }
  }
  setTimeout(() => app.exit(0), 500);
});
