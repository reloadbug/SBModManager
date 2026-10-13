'use strict';
/** 探针：不用浏览器，直接 net.fetch 拉 mod 页 HTML，看能不能正则出全部图集 URL。 */
const { app, net, session } = require('electron');
const path = require('path');
const APP_NAME = '剑星 Mod 管理器';
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

const MOD_ID = 1252;
const URLS = [
  'https://www.nexusmods.com/stellarblade/mods/' + MOD_ID + '?tab=images',
  'https://www.nexusmods.com/stellarblade/mods/' + MOD_ID
];

app.whenReady().then(async () => {
  try { session.fromDefaultSession && session.defaultSession.setUserAgent(cleanUA()); } catch {}
  for (const u of URLS) {
    console.log('\n=== ' + u + ' ===');
    const t0 = Date.now();
    try {
      const res = await net.fetch(u, { headers: { Accept: 'text/html,application/xhtml+xml' } });
      const html = await res.text();
      console.log('  status=' + res.status + '  len=' + html.length + '  ' + (Date.now() - t0) + 'ms');
      const challenge = /just a moment|checking your browser|正在进行安全验证|请稍候/i.test(html);
      console.log('  Cloudflare 挑战页 = ' + challenge);
      // 关键：li.thumb 的 data-src
      const liRe = /<li[^>]*class="[^"]*\bthumb\b[^"]*"[^>]*data-src="([^"]+)"/g;
      const found = new Set();
      let m;
      while ((m = liRe.exec(html))) found.add(m[1]);
      console.log('  li.thumb[data-src] 命中 = ' + found.size);
      const any = new Set((html.match(/staticdelivery\.nexusmods\.com\/mods\/7804\/images\/[^"'\s\\]+/g) || []));
      const full = [...any].filter(x => !/\/thumbnails\//.test(x) && !/\/headers\//.test(x));
      console.log('  HTML 里图集大图 URL = ' + full.length);
      console.log('  样例: ' + full.slice(0, 3).join('\n        '));
      const first = [...found].slice(0, 3);
      if (first.length) console.log('  data-src 样例: ' + first.join('\n        '));
    } catch (e) { console.log('  ✗ ' + e.message); }
  }
  app.quit();
}).catch(e => { console.error('崩溃：' + e.message); app.exit(1); });
