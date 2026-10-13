'use strict';
/** 测一批实际在用的 legacy tag 的过滤效果 + tagCategories */
const https = require('https');
const HOST = 'api.nexusmods.com', PATH = '/v2/graphql', DOMAIN = 'stellarblade';
function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({ hostname: HOST, path: PATH, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': 'application/json', 'User-Agent': 'SBMM/0.1' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('非 JSON')); } });
    });
    req.on('error', reject); req.setTimeout(25000, () => req.destroy(new Error('超时'))); req.write(body); req.end();
  });
}
(async () => {
  console.log('=== tagCategories() ===');
  const rc = await gql(`{ tagCategories { id name } }`);
  if (rc.errors) console.log('  ✗ ' + rc.errors.map(e => e.message).join('; '));
  else for (const c of rc.data.tagCategories || []) console.log('  id=' + String(c.id).padStart(4) + '  ' + c.name);

  console.log('\n=== tags(gameId:7804, includeGlobal:false) ===');
  const rn = await gql(`{ tags(gameId:7804, includeGlobal:false) { id name global } }`);
  if (rn.errors) console.log('  ✗ ' + rn.errors.map(e => e.message).join('; '));
  else { const l = rn.data.tags || []; console.log('  共 ' + l.length + ' 个：'); for (const t of l) console.log('    id=' + String(t.id).padStart(5) + '  ' + (t.name || '').padEnd(30) + ' global=' + t.global); }

  console.log('\n=== 实测各 legacy tag 的 mod 数 ===');
  const CANDS = ['Sexualised', 'Pornographic', 'Textures', 'Modder\'s Resource', 'Character Preset', 'Models/Meshes', 'Animation - Modified', 'Utilities for Modders', 'Utilities for Players', 'Body stigma', 'English', 'User Interface', 'Replacer', 'Gameplay', 'Quality of Life', 'Bug Fixes', 'Cheating', 'Visual', 'Audio', 'Items', 'Environment', 'All-In-One', 'Lore-friendly', 'DLC Required'];
  const rows = [];
  for (const t of CANDS) {
    const safe = t.replace(/"/g, '');
    const rr = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"${safe}"}}, count:1){ totalCount } }`);
    rows.push([t, rr.errors ? '✗ ' + rr.errors[0].message.slice(0, 40) : rr.data.mods.totalCount]);
  }
  rows.sort((a, b) => (typeof b[1] === 'number' ? b[1] : -1) - (typeof a[1] === 'number' ? a[1] : -1));
  for (const [t, n] of rows) console.log('  ' + String(n).padStart(6) + '  ' + t);

  console.log('\n=== tag + category 组合 ===');
  for (const [cat, tag] of [['Outfits', 'Sexualised'], ['Outfits', 'Textures'], ['Visuals', 'Textures']]) {
    const rr = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"${cat}"}, tag:{value:"${tag}"}}, count:1){ totalCount } }`);
    console.log('  ' + (cat + ' + ' + tag).padEnd(32) + (rr.errors ? '✗' : rr.data.mods.totalCount));
  }
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
