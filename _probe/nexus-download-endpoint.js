'use strict';
/*
 * 探针：绕开「渲染页面再点击」这条路，直接问 Nexus 自己的下载弹层端点。
 *
 * 网站上的「Mod Manager Download」按钮点下去时，前端 JS 调的就是这个端点：
 *   GET /Core/Libs/Common/Widgets/DownloadPopUp?id=<fileId>&game_id=<gameId>
 *   加 &nmm=1 时返回给 mod manager 用的 nxm 链接
 * 本探针用**已登录会话的 cookie** 直接请求它，看能不能拿到带 key/expires 的 nxm。
 *
 * 顺带：
 *   · 截图 Files 页，确认隐藏窗口里到底渲染成了什么样
 *   · 对照跑一次图集页，看「隐藏窗口读页面」这条路现在是否还通
 *
 * 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron _probe/nexus-download-endpoint.js 1461 8509
 */
require('./_appctx');   // 🔴 必须最先 require：把 userData 指到正式应用那一份
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
for (const s of ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu']) {
  try { app.commandLine.appendSwitch(s.replace(/^--/, ''), ''); } catch { /* 忽略 */ }
}

const nexusAuth = require('../src/main/nexusAuth');

const MOD = Number(process.argv[2] || 1461);
const FILE = Number(process.argv[3] || 8509);
const GAME_ID = 7804;                       // stellarblade
const SHOTS = path.resolve(__dirname, '..', '_shots');

const CLEAN_UA = (() => {
  const raw = app.userAgentFallback || '';
  const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
})();

async function tryFetch(label, url, opts = {}) {
  const ses = session.fromPartition(nexusAuth.PARTITION);
  try {
    const res = await ses.fetch(url, { headers: { 'User-Agent': CLEAN_UA, ...(opts.headers || {}) }, ...opts });
    const text = await res.text();
    const nxm = (text.match(/nxm:\/\/[^"'\s<>]+/i) || [])[0] || null;
    console.log('--- ' + label);
    console.log('    HTTP ' + res.status + '  len=' + text.length + '  ct=' + (res.headers.get('content-type') || '-'));
    console.log('    nxm: ' + (nxm ? nxm.slice(0, 160) : '（无）'));
    console.log('    片段: ' + JSON.stringify(text.slice(0, 320)));
    return { status: res.status, text, nxm };
  } catch (e) {
    console.log('--- ' + label + '  ✗ ' + e.message);
    return { status: 0, text: '', nxm: null, err: e.message };
  }
}

app.whenReady().then(async () => {
  nexusAuth.nexusSession();
  const st = await nexusAuth.getStatus().catch(() => ({}));
  console.log('userData = ' + app.getPath('userData'));
  console.log('loggedIn=' + st.loggedIn + ' user=' + (st.user || '-') + '\n');

  console.log('===== A. 站内下载弹层端点 =====');
  await tryFetch('DownloadPopUp（无 nmm）',
    `https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}`);
  await tryFetch('DownloadPopUp（nmm=1）',
    `https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}&nmm=1`);
  await tryFetch('DownloadPopUp（带 referer + X-Requested-With）',
    `https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}&nmm=1`,
    { headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `https://www.nexusmods.com/stellarblade/mods/${MOD}?tab=files` } });

  console.log('\n===== B. 隐藏窗口渲染 Files 页（截图） =====');
  const w = new BrowserWindow({
    show: false, width: 1400, height: 1100,
    webPreferences: {
      partition: nexusAuth.PARTITION, contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false
    }
  });
  try { session.fromPartition(nexusAuth.PARTITION).setUserAgent(CLEAN_UA); } catch { /* 忽略 */ }

  try { await w.loadURL(`https://www.nexusmods.com/stellarblade/mods/${MOD}?tab=files`); }
  catch (e) { console.log('loadURL 异常: ' + e.message); }
  await new Promise(r => setTimeout(r, 16000));

  const info = await w.webContents.executeJavaScript(`(() => {
    const t = (document.body && document.body.innerText) || '';
    return {
      title: document.title, bodyLen: t.length,
      mainContent: !!document.querySelector('#mainContent, main, .mod-page, [data-e2eid]'),
      downloadish: [...document.querySelectorAll('a,button')].filter(e => /download/i.test(String(e.innerText||''))).length,
      nxm: (document.documentElement.outerHTML.match(/nxm:\\/\\//g) || []).length,
      head: t.slice(0, 300)
    };
  })()`).catch(e => ({ err: e.message }));
  console.log(JSON.stringify(info, null, 1));
  try {
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, 'probe-files-hidden.png'), img.toPNG());
    console.log('截图：_shots/probe-files-hidden.png');
  } catch (e) { console.log('截图失败：' + e.message); }

  console.log('\n===== C. 对照：图集页（这条路之前是通的） =====');
  try { await w.loadURL(`https://www.nexusmods.com/stellarblade/mods/${MOD}?tab=images`); }
  catch (e) { console.log('loadURL 异常: ' + e.message); }
  await new Promise(r => setTimeout(r, 16000));
  const g = await w.webContents.executeJavaScript(`(() => {
    const ul = document.querySelector('ul.thumbgallery');
    return {
      title: document.title,
      bodyLen: ((document.body && document.body.innerText) || '').length,
      thumbs: ul ? ul.querySelectorAll('li.thumb').length : 0,
      dataSrc: [...document.querySelectorAll('[data-src]')].length
    };
  })()`).catch(e => ({ err: e.message }));
  console.log(JSON.stringify(g, null, 1));

  app.exit(0);
}).catch(e => { console.error('探针失败:', e); app.exit(1); });
