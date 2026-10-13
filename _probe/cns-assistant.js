'use strict';
/*
 * 探针：打开内嵌「安装助手」窗口并截图，验证注入脚本的实际效果。
 *
 * 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron _probe/cns-assistant.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
for (const s of ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu']) {
  try { app.commandLine.appendSwitch(s.replace(/^--/, ''), ''); } catch { /* 忽略 */ }
}

const nexusBrowser = require('../src/main/nexusBrowser');

const SHOT = path.resolve(__dirname, '..', '_shots', 'cns-assistant.png');
const WAIT = Number(process.env.WAIT_MS) || 16000;

const READ = `(() => {
  const b = document.getElementById('sbmm-banner');
  const hl = document.querySelectorAll('.sbmm-hl');
  const rows = document.querySelectorAll('.sbmm-row');
  const clickable = [...document.querySelectorAll('a,button,[role="button"],input')];
  const txt = (el) => String(el.innerText || el.value || '').replace(/\\s+/g, ' ').trim();
  const main = document.querySelector('#mainContent') || document.querySelector('.main-content') || document.querySelector('main');
  return {
    url: location.href,
    banner: b ? txt(b) : null,
    highlighted: hl.length,
    hlText: [...hl].slice(0, 5).map(txt),
    rows: rows.length,
    manualBtns: clickable.filter(e => /manual\\s*download/i.test(txt(e))).length,
    mmBtns: clickable.filter(e => /mod\\s*manager\\s*download/i.test(txt(e))).length,
    slowBtns: clickable.filter(e => /slow\\s*download/i.test(txt(e))).length,
    // 页面里所有含 download 字样的可点元素文案 —— Nexus 改版时靠这个还原真实 DOM
    downloadish: [...new Set(clickable.map(txt).filter(s => /download/i.test(s)).map(s => s.slice(0, 40)))].slice(0, 12),
    title: document.title,

    /* ---- 登录信号候选 ---- */
    signInLinks: document.querySelectorAll('a[href*="sign_in"],a[href*="auth/"]').length,
    exactLogIn: clickable.filter(e => /^log\\s*in$/i.test(txt(e))).length,
    userLinks: document.querySelectorAll('a[href^="/users/"]:not([href*="myaccount"]):not([href*="sign_in"])').length,
    avatarImgs: document.querySelectorAll('img[class*="avatar"],img[alt*="avatar" i]').length,
    welcomeBack: /Welcome back,/i.test(document.body.innerText || ''),
    accessDenied: /Access Denied|Full authentication is required/i.test(main ? String(main.innerText || '') : ''),
    mainHead: (main ? String(main.innerText || '') : '').replace(/\\s+/g, ' ').slice(0, 220)
  };
})()`;

app.whenReady().then(async () => {
  nexusBrowser.nexusSessionInit && nexusBrowser.nexusSessionInit();

  const r = nexusBrowser.open({ modId: 1496, fileId: 13020, hint: 'CustomNanosuitSystem v2.2' });
  console.log('助手窗口已打开：' + JSON.stringify(r));

  await new Promise(res => setTimeout(res, WAIT));

  const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  const w = wins[wins.length - 1];
  if (!w) { console.log('没有可用窗口'); app.exit(1); return; }

  let info = null;
  try { info = await w.webContents.executeJavaScript(READ); }
  catch (e) { info = { err: e.message }; }

  console.log('\n===== 注入结果 =====');
  console.log(JSON.stringify(info, null, 2));

  try {
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    const img = await w.webContents.capturePage();
    fs.writeFileSync(SHOT, img.toPNG());
    console.log('\n截图已保存：' + SHOT);
  } catch (e) { console.log('截图失败：' + e.message); }

  app.exit(0);
}).catch(e => { console.error('探针失败:', e); app.exit(1); });
