'use strict';
/**
 * 探针：mod 页面的「图集」到底从哪儿来。
 *
 * 背景：GraphQL 已确认**没有**按 mod 取图集的字段（Mod 类型只有 pictureUrl + 3 个 thumbnail，
 * Query.media 只能按 gameId 过滤，且返回的是站点图库而非 mod 图集）。
 * 用户要「5 张不同的 mod 图片」，所以先看看 mod 页 `?tab=images` 是怎么拿到 44 张图的。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/nexus-modpage-images.js
 */
const { app, session, BrowserWindow, net } = require('electron');
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

const URL_MOD = 'https://www.nexusmods.com/stellarblade/mods/1252?tab=images';

const SCRIPT = `(() => {
  const t = document.title || '';
  const body = (document.body && document.body.innerText || '').slice(0, 400);
  if (/just a moment|checking your browser|正在进行安全验证|请稍候/i.test(t + ' ' + body)) return { __retry: true };
  if (document.readyState !== 'complete') return { __retry: true };

  // 1) DOM 里所有指向 mod 图集的 URL
  const all = [...document.querySelectorAll('img, a, source')];
  const urls = new Set();
  for (const el of all) {
    for (const a of ['src', 'href', 'data-src', 'data-url', 'srcset']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      for (const part of String(v).split(/[,\\s]+/)) {
        const u = part.trim().split(' ')[0];
        if (/staticdelivery\\.nexusmods\\.com\\/mods\\/7804\\/images\\//.test(u)) urls.add(u);
      }
    }
  }

  // 2) 页面里的内嵌 JSON
  const jsonBlobs = {};
  for (const id of ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__']) {
    const el = document.getElementById(id);
    if (el) jsonBlobs[id] = (el.textContent || '').length;
  }
  const scripts = [...document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')]
    .map(s => (s.textContent || '').length);

  // 3) 任何 script 文本里出现图集 URL 的（说明是内嵌 JSON 里带的）
  let inlineHits = 0;
  for (const s of document.querySelectorAll('script')) {
    const txt = s.textContent || '';
    if (/staticdelivery\\.nexusmods\\.com\\/mods\\/7804\\/images\\//.test(txt)) inlineHits++;
  }

  return {
    title: t,
    htmlLen: document.documentElement.outerHTML.length,
    galleryUrls: [...urls].slice(0, 20),
    galleryCount: urls.size,
    jsonBlobs,
    jsonScriptCount: scripts.length,
    inlineScriptsWithGalleryUrls: inlineHits,
    imgCount: document.querySelectorAll('img').length,
    firstImgs: [...document.querySelectorAll('img')].slice(0, 8).map(i => (i.src || '').slice(0, 110))
  };
})()`;

function openHiddenAndRead(url, script, { delayMs = 3000, timeoutMs = 45000, maxRetry = 8 } = {}) {
  return new Promise((resolve) => {
    let done = false; let tries = 0; let settle = null;
    const w = new BrowserWindow({
      show: false, width: 1400, height: 1000,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
    });
    const finish = (r) => {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(settle);
      try { if (!w.isDestroyed()) w.destroy(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: '超时' }), timeoutMs);
    const schedule = () => {
      clearTimeout(settle);
      settle = setTimeout(async () => {
        if (done) return;
        try {
          const res = await w.webContents.executeJavaScript(script);
          if (res && res.__retry) {
            tries++;
            if (tries > maxRetry) return finish({ ok: false, reason: '页面长时间未就绪（可能被 Cloudflare 拦住）' });
            if (tries % 3 === 0) { try { w.webContents.reload(); } catch {} }
            return schedule();
          }
          finish({ ok: true, data: res });
        } catch (e) { finish({ ok: false, reason: e.message }); }
      }, delayMs);
    };
    w.webContents.on('did-stop-loading', schedule);
    w.webContents.on('did-navigate', schedule);
    w.webContents.on('did-fail-load', (_e, code, desc) => { if (code !== -3) finish({ ok: false, reason: code + ' ' + desc }); });
    w.loadURL(url).catch(e => finish({ ok: false, reason: e.message }));
  });
}

app.whenReady().then(async () => {
  try { session.fromPartition(PARTITION).setUserAgent(cleanUA()); } catch {}

  console.log('=== 1) 打开 mod 页 ?tab=images ===');
  const r = await openHiddenAndRead(URL_MOD, SCRIPT);
  console.log(JSON.stringify(r, null, 1).slice(0, 2500));

  console.log('\n=== 2) 用 net.fetch 直接拉 HTML（看是否被 Cloudflare 拦）===');
  try {
    const res = await net.fetch(URL_MOD, { headers: { Accept: 'text/html' } });
    const html = await res.text();
    console.log('  status=' + res.status + '  len=' + html.length);
    const m = html.match(/staticdelivery\.nexusmods\.com\/mods\/7804\/images\/[^"'\\\s]+/g) || [];
    console.log('  HTML 里的 mod 图集 URL 数 = ' + new Set(m).size);
    console.log('  样例 = ' + [...new Set(m)].slice(0, 5).join('\n         '));
    const nextData = html.match(/__NEXT_DATA__[^>]*>([\s\S]{0,200})/);
    console.log('  __NEXT_DATA__ = ' + (nextData ? nextData[1].slice(0, 160) : '(无)'));
  } catch (e) { console.log('  ✗ ' + e.message); }

  app.quit();
}).catch(e => { console.error('探针崩溃：' + e.message + '\n' + e.stack); app.exit(1); });
