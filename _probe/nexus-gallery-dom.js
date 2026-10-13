'use strict';
/** 探针：mod 页图集区块的 DOM 结构 —— 拿「大图 URL」而不是缩略图。 */
const { app, session, BrowserWindow } = require('electron');
const path = require('path');
const APP_NAME = '剑星 Mod 管理器';
const PARTITION = 'persist:nexus';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
function cleanUA() {
  const raw = app.userAgentFallback || '';
  const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
}
app.userAgentFallback = cleanUA();

const MOD_ID = process.argv.find(a => /^--mod=/.test(a)) ? Number(process.argv.find(a => /^--mod=/.test(a)).split('=')[1]) : 1252;
const URL_MOD = 'https://www.nexusmods.com/stellarblade/mods/' + MOD_ID + '?tab=images';

const SCRIPT = `(() => {
  const t = document.title || '';
  const body = (document.body && document.body.innerText || '').slice(0, 400);
  if (/just a moment|checking your browser|正在进行安全验证|请稍候/i.test(t + ' ' + body)) return { __retry: true };
  if (document.readyState !== 'complete') return { __retry: true };

  const G = /staticdelivery\\.nexusmods\\.com\\/mods\\/7804\\/images\\//;
  const norm = (u) => {
    const i = u.indexOf('?'); const s = i < 0 ? u : u.slice(0, i);
    return s.replace('/images/thumbnails/', '/images/').replace('/images/large/', '/images/');
  };

  // 找出所有 <a> 指向图集的（图集项通常是大图链接），以及所有 <img> 的图集 URL
  const fromA = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || '';
    if (G.test(h)) fromA.push({ href: h, text: (a.textContent || '').trim().slice(0, 40), cls: a.className.slice(0, 60) });
  }
  const fromImg = [];
  for (const img of document.querySelectorAll('img')) {
    const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (G.test(s)) fromImg.push({ src: s, cls: img.className.slice(0, 60), parentCls: (img.parentElement && img.parentElement.className || '').slice(0, 60) });
  }

  // 图集容器里的一项，拿完整 outerHTML 看看
  let sample = '';
  const firstGalleryImg = document.querySelector('img[src*="/images/thumbnails/"]');
  if (firstGalleryImg) {
    let el = firstGalleryImg;
    for (let i = 0; i < 4 && el.parentElement; i++) el = el.parentElement;
    sample = (el.outerHTML || '').slice(0, 1200);
  }

  const uniqA = [...new Set(fromA.map(x => x.href))];
  const uniqImg = [...new Set(fromImg.map(x => x.src))];
  const fullFromA = [...new Set(uniqA.map(norm).filter(u => !/\\/thumbnails\\//.test(u) && !/\\/headers\\//.test(u)))];
  const fullFromImg = [...new Set(uniqImg.map(norm).filter(u => !/\\/thumbnails\\//.test(u) && !/\\/headers\\//.test(u)))];

  return {
    title: t.slice(0, 80),
    aGalleryCount: uniqA.length, imgGalleryCount: uniqImg.length,
    fullFromA: fullFromA.length, fullFromImg: fullFromImg.length,
    aSample: uniqA.slice(0, 3),
    fullSample: (fullFromA.length ? fullFromA : fullFromImg).slice(0, 6),
    sampleHtml: sample
  };
})()`;

function read(url, script, { delayMs = 3000, timeoutMs = 45000, maxRetry = 8 } = {}) {
  return new Promise((resolve) => {
    let done = false; let tries = 0; let settle = null;
    const w = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false } });
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(settle); try { if (!w.isDestroyed()) w.destroy(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, reason: '超时' }), timeoutMs);
    const schedule = () => {
      clearTimeout(settle);
      settle = setTimeout(async () => {
        if (done) return;
        try {
          const res = await w.webContents.executeJavaScript(script);
          if (res && res.__retry) { tries++; if (tries > maxRetry) return finish({ ok: false, reason: '未就绪/被拦' }); if (tries % 3 === 0) { try { w.webContents.reload(); } catch {} } return schedule(); }
          finish({ ok: true, data: res });
        } catch (e) { finish({ ok: false, reason: e.message }); }
      }, delayMs);
    };
    w.webContents.on('did-stop-loading', schedule);
    w.webContents.on('did-navigate', schedule);
    w.loadURL(url).catch(e => finish({ ok: false, reason: e.message }));
  });
}

app.whenReady().then(async () => {
  try { session.fromPartition(PARTITION).setUserAgent(cleanUA()); } catch {}
  const r = await read(URL_MOD, SCRIPT);
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  app.quit();
}).catch(e => { console.error('崩溃：' + e.message); app.exit(1); });
