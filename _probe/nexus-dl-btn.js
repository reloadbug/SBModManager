'use strict';
/*
 * 探针：Files 页上的下载按钮到底长什么样？**能不能不点鼠标就拿到 nxm 链接？**
 *
 * 要回答的问题（决定了「全自动授权」是否可行）：
 *   1. 登录态下，`Mod Manager Download` 是个 `<a href="nxm://...">` 吗？
 *      还是靠 JS 点击后现算？→ 如果 href 里已经带 key/expires，读属性即可，**不用模拟点击**
 *   2. 如果没有 MM 按钮（作者没开），`Manual download` 是链接还是按钮？
 *   3. 页面里有没有 Cloudflare 挑战
 *
 * 运行：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron _probe/nexus-dl-btn.js 1461 8509
 */
require('./_appctx');   // 🔴 必须最先 require：把 userData 指到正式应用那一份
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
for (const s of ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu']) {
  try { app.commandLine.appendSwitch(s.replace(/^--/, ''), ''); } catch { /* 忽略 */ }
}

const nexusAuth = require('../src/main/nexusAuth');

const MOD = Number(process.argv[2] || 1461);
const FILE = Number(process.argv[3] || 8509);
const URL = `https://www.nexusmods.com/stellarblade/mods/${MOD}?tab=files&file_id=${FILE}`;

const PROBE = `(() => {
  const out = { url: location.href, title: document.title };
  const bodyText = (document.body && document.body.innerText) || '';
  out.challenge = /just a moment|checking your browser|正在进行安全验证|请稍候|Ray ID/i.test(out.title + ' ' + bodyText.slice(0, 1500));
  out.bodyLen = bodyText.length;
  out.bodyHead = bodyText.slice(0, 900);
  out.readyState = document.readyState;
  out.domNodes = document.querySelectorAll('*').length;

  // 登录态
  out.signInLinks = document.querySelectorAll('a[href*="sign_in"], a[href*="auth/"]').length;
  const clickable = [...document.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"]')];
  out.exactLogIn = clickable.filter(e => /^log\\s*in$/i.test(String(e.innerText || e.value || '').trim())).length;

  const label = el => String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
  const desc = el => ({
    tag: el.tagName,
    txt: label(el).slice(0, 60),
    href: (el.getAttribute('href') || '').slice(0, 200) || null,
    onclick: (el.getAttribute('onclick') || '').slice(0, 160) || null,
    cls: String(el.className || '').slice(0, 80),
    fid: el.getAttribute('data-fileid') || el.getAttribute('data-file-id') || null,
    outer: String(el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 300)
  });

  out.byLabel = {
    mm: clickable.filter(e => /mod\\s*manager\\s*download/i.test(label(e))).slice(0, 8).map(desc),
    manual: clickable.filter(e => /manual\\s*download/i.test(label(e))).slice(0, 8).map(desc),
    slow: clickable.filter(e => /slow\\s*download/i.test(label(e))).slice(0, 8).map(desc)
  };

  // 全页 nxm:// 出现次数（含 href / data-* / 内联脚本里的字符串）
  const html = document.documentElement.outerHTML;
  out.nxmInHtml = (html.match(/nxm:\\/\\//g) || []).length;
  out.keyInHtml = (html.match(/[?&]key=/g) || []).length;
  out.expiresInHtml = (html.match(/[?&]expires=/g) || []).length;

  const nxmEls = [...document.querySelectorAll('[href^="nxm:"], [data-nxm], [data-url^="nxm:"]')].slice(0, 8);
  out.nxmEls = nxmEls.map(desc);

  // nxm 字符串在 HTML 里的上下文（看它是渲染进 DOM 还是只在 JS 变量里）
  const idx = html.indexOf('nxm://');
  out.nxmContext = idx >= 0 ? html.slice(Math.max(0, idx - 220), idx + 320).replace(/\\s+/g, ' ') : null;

  // 目标文件那一行
  const hit = document.querySelector('[data-fileid="${FILE}"],[data-file-id="${FILE}"]');
  out.targetFound = !!hit;
  if (hit) {
    const row = hit.closest('li,tr,article,section,div');
    out.targetRow = row ? String(row.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 1200) : null;
    out.targetRowBtns = row ? [...row.querySelectorAll('a,button,[role="button"]')].slice(0, 10).map(desc) : [];
  }
  return out;
})()`;

app.whenReady().then(async () => {
  nexusAuth.nexusSession();
  const st = await nexusAuth.getStatus().catch(() => ({}));
  console.log('authCache: loggedIn=' + st.loggedIn + ' user=' + (st.user || '-'));
  const s = session.fromPartition(nexusAuth.PARTITION);
  const cks = await s.cookies.get({ domain: '.nexusmods.com' }).catch(() => []);
  console.log('nexusmods cookie 数=' + cks.length);

  const w = new BrowserWindow({
    show: false, width: 1400, height: 1100,
    webPreferences: {
      partition: nexusAuth.PARTITION, contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false
    }
  });
  try {
    const raw = app.userAgentFallback || '';
    const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
    s.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36');
  } catch { /* 忽略 */ }

  console.log('加载 ' + URL);
  try { await w.loadURL(URL); } catch (e) { console.log('loadURL 异常: ' + e.message); }
  await new Promise(r => setTimeout(r, 14000));

  let res = null;
  for (let i = 0; i < 5; i++) {
    try { res = await w.webContents.executeJavaScript(PROBE); } catch (e) { res = { err: e.message }; }
    const gotBtn = res && res.byLabel && (res.byLabel.mm.length + res.byLabel.manual.length + res.byLabel.slow.length) > 0;
    console.log('第 ' + (i + 1) + ' 轮：challenge=' + (res && res.challenge) +
      ' domNodes=' + (res && res.domNodes) + ' bodyLen=' + (res && res.bodyLen) +
      ' 按钮=' + (gotBtn ? '有' : '无'));
    if (gotBtn) break;
    if (i >= 2) break;                       // 前 3 轮拿到就是拿到，拿不到后面只会更差
    try { w.webContents.reload(); } catch { /* 忽略 */ }
    await new Promise(r => setTimeout(r, 14000));
  }

  console.log('\n===== 结果 =====');
  console.log(JSON.stringify(res, null, 2));
  app.exit(0);
}).catch(e => { console.error('探针失败:', e); app.exit(1); });
