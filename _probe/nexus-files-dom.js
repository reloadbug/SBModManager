'use strict';
/*
 * 探针 v2：摸清 Nexus Mod Files 页在 Electron 里的真实渲染情况。
 * v1 结论：cookieCount=0（会话失效）、页面主体没渲染（bodyLen 2257）。
 * v2 增加：全量 cookie dump、更长等待、滚动触发懒加载、截图落盘。
 *
 * 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron _probe/nexus-files-dom.js
 */
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
for (const s of ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu']) {
  try { app.commandLine.appendSwitch(s.replace(/^--/, ''), ''); } catch { /* 忽略 */ }
}

const nexusAuth = require('../src/main/nexusAuth');

const TARGET_MOD = 1496;
const TARGET_FILE = 13020;
const URL = `https://www.nexusmods.com/stellarblade/mods/${TARGET_MOD}?tab=files`;
const SHOT = path.resolve(__dirname, '..', '_shots', 'probe-files.png');

const PROBE = `(() => {
  const out = { url: location.href, title: document.title, ok: true };
  const bodyText = (document.body && document.body.innerText) || '';
  out.challenge = /just a moment|checking your browser|正在进行安全验证|请稍候/i.test(out.title + ' ' + bodyText.slice(0, 1200));
  out.bodyLen = bodyText.length;
  out.bodyHead = bodyText.slice(0, 700);
  out.domNodes = document.querySelectorAll('*').length;
  out.hasMain = !!document.querySelector('#mainContent, .main-content, main');
  out.loggedInHint = /Welcome back|Log out|Sign out|Notifications/i.test(bodyText) && !/\\bLog in\\b/.test(bodyText.slice(0, 600));

  out.attrHits = [...document.querySelectorAll('[data-fileid],[data-file-id]')].slice(0, 40).map(el => ({
    tag: el.tagName,
    fileid: el.getAttribute('data-fileid') || el.getAttribute('data-file-id'),
    txt: String(el.innerText || '').replace(/\\s+/g, ' ').slice(0, 100)
  }));

  const clickable = [...document.querySelectorAll('a,button,[role="button"],input')];
  out.dlButtons = clickable
    .filter(el => /download/i.test(String(el.innerText || el.value || '')))
    .slice(0, 30)
    .map(el => ({
      tag: el.tagName,
      href: (el.getAttribute('href') || '').slice(0, 120) || null,
      cls: String(el.className || '').slice(0, 90),
      txt: String(el.innerText || el.value || '').replace(/\\s+/g, ' ').slice(0, 70),
      fid: el.getAttribute('data-fileid') || el.getAttribute('data-file-id') || null,
      outer: String(el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 220)
    }));

  const hit = document.querySelector('[data-fileid="${TARGET_FILE}"],[data-file-id="${TARGET_FILE}"]');
  out.targetFound = !!hit;
  if (hit) {
    let row = hit;
    for (let i = 0; i < 6 && row.parentElement; i++) row = row.parentElement;
    out.targetRowHtml = String(row.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 2000);
  }

  out.fileLinks = [...document.querySelectorAll('a[href*="file_id="]')].slice(0, 12).map(a => a.getAttribute('href'));
  out.allLinksSample = [...document.querySelectorAll('a[href]')].slice(0, 25).map(a => (a.getAttribute('href') || '').slice(0, 70));
  return out;
})()`;

async function dumpCookies() {
  const s = session.fromPartition(nexusAuth.PARTITION);
  const all = await s.cookies.get({});
  console.log('分区 ' + nexusAuth.PARTITION + ' 共 ' + all.length + ' 个 cookie：');
  for (const c of all.slice(0, 40)) {
    console.log('   - ' + c.domain + '  ' + c.name + '  (session=' + c.session + ', expires=' + (c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : '-') + ')');
  }
  return all.length;
}

app.whenReady().then(async () => {
  nexusAuth.nexusSession();
  console.log('userData = ' + app.getPath('userData'));
  await dumpCookies();
  const st = await nexusAuth.getStatus();
  console.log('authCache: loggedIn=' + st.loggedIn + ' user=' + (st.user || '-'));

  const w = new BrowserWindow({
    show: false, width: 1400, height: 1100,
    webPreferences: { partition: nexusAuth.PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });

  try { await w.loadURL(URL); } catch (e) { console.log('loadURL 异常: ' + e.message); }

  await new Promise(r => setTimeout(r, 15000));

  // 滚动触发懒加载
  try {
    await w.webContents.executeJavaScript(`(async () => {
      for (let y = 0; y < 6; y++) { window.scrollBy(0, 900); await new Promise(r => setTimeout(r, 700)); }
      window.scrollTo(0, 0);
    })()`);
  } catch { /* 忽略 */ }
  await new Promise(r => setTimeout(r, 4000));

  let res = null;
  for (let i = 0; i < 3; i++) {
    try { res = await w.webContents.executeJavaScript(PROBE); } catch (e) { res = { err: e.message }; }
    if (res && res.ok && !res.challenge && res.domNodes > 400) break;
    console.log('尝试 ' + (i + 1) + '：challenge=' + (res && res.challenge) + ' domNodes=' + (res && res.domNodes) + '，重载…');
    try { w.webContents.reload(); } catch { /* 忽略 */ }
    await new Promise(r => setTimeout(r, 12000));
  }

  console.log('\n===== 探针结果 =====');
  console.log(JSON.stringify(res, null, 2));

  try {
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    const img = await w.webContents.capturePage();
    fs.writeFileSync(SHOT, img.toPNG());
    console.log('\n截图已保存：' + SHOT);
  } catch (e) { console.log('截图失败：' + e.message); }

  app.exit(0);
}).catch(e => { console.error('探针失败:', e); app.exit(1); });
