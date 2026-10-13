'use strict';
/** 探针：试几个可能的「mod 图集」HTTP 端点（不行就走页面渲染）。 */
const { app, net } = require('electron');
const path = require('path');
const APP_NAME = '剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const CANDIDATES = [
  'https://api.nexusmods.com/v1/games/stellarblade/mods/1252/images',
  'https://api.nexusmods.com/v1/games/stellarblade/mods/1252/media',
  'https://api.nexusmods.com/v2/games/stellarblade/mods/1252/images',
  'https://www.nexusmods.com/api/mods/1252/images',
  'https://www.nexusmods.com/stellarblade/mods/1252/images.json',
  'https://www.nexusmods.com/api/games/stellarblade/mods/1252/images',
  'https://staticdelivery.nexusmods.com/mods/7804/images/1252/',
  'https://api.nexusmods.com/v1/games/stellarblade/mods/1252'
];

app.whenReady().then(async () => {
  for (const u of CANDIDATES) {
    try {
      const r = await net.fetch(u, { headers: { Accept: 'application/json, text/html;q=0.9, */*;q=0.8' } });
      const txt = await r.text();
      let note = '';
      try {
        const j = JSON.parse(txt);
        note = 'JSON keys=' + (Array.isArray(j) ? ('array(' + j.length + ')') : Object.keys(j).slice(0, 12).join(','));
      } catch {
        note = 'text/' + txt.length + '  ' + (txt.slice(0, 90).replace(/\s+/g, ' '));
      }
      console.log(String(r.status).padEnd(4) + u + '\n      → ' + note);
    } catch (e) {
      console.log('ERR  ' + u + '\n      → ' + e.message);
    }
  }
  app.quit();
}).catch(e => { console.error('崩溃：' + e.message); app.exit(1); });
