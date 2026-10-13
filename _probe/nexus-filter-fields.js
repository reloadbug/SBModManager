'use strict';
/** 列出 ModsFilter 全部字段 + 验证 tag 过滤是否可行 */
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
  console.log('=== ModsFilter 全部字段 ===');
  const r = await gql(`{ __type(name:"ModsFilter") { inputFields { name type { name kind ofType { name } } } } }`);
  for (const f of r.data.__type.inputFields) console.log('  ' + f.name.padEnd(26) + (f.type.name || (f.type.ofType && f.type.ofType.name) || f.type.kind));
  console.log('\n=== 试 tag 过滤写法 ===');
  for (const [label, body] of [
    ['tagName', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tagName:{value:"Textures"}}, count:1){ totalCount }`],
    ['tag', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"Textures"}}, count:1){ totalCount }`],
    ['tagNames', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tagNames:{value:"Textures"}}, count:1){ totalCount }`]
  ]) {
    const rr = await gql('{ ' + body + ' }');
    console.log('  ' + label.padEnd(12) + (rr.errors ? '✗ ' + rr.errors.map(e => e.message).join('; ') : '✓ ' + JSON.stringify(rr.data.mods)));
  }
  console.log('\n=== tags(gameId) 清单 ===');
  const rt = await gql(`{ tags(gameId:7804, includeGlobal:true) { id name global searchable retired } }`);
  if (rt.errors) console.log('  ✗ ' + rt.errors.map(e => e.message).join('; '));
  else {
    const list = rt.data.tags || [];
    console.log('  共 ' + list.length + ' 个：');
    for (const t of list) console.log('    id=' + String(t.id).padStart(5) + '  ' + (t.name || '').padEnd(28) + ' global=' + t.global + ' retired=' + t.retired);
  }
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
