'use strict';
/** 拿剑星的完整 tag 清单（Tag 类型字段名修正版） */
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
  console.log('=== Tag 类型字段 ===');
  const r0 = await gql(`{ __type(name:"Tag") { fields { name type { name kind ofType { name kind ofType { name } } } } } }`);
  if (r0.data && r0.data.__type) for (const f of r0.data.__type.fields) console.log('  ' + f.name + ' : ' + JSON.stringify(f.type).slice(0, 90));
  else console.log('  ' + JSON.stringify(r0.errors));

  console.log('\n=== 剑星 tag 清单（含全局）===');
  const r = await gql(`{ tags(gameId:7804, includeGlobal:true) { id name global } }`);
  if (r.errors) console.log('  ✗ ' + r.errors.map(e => e.message).join('; '));
  else {
    const list = r.data.tags || [];
    console.log('  共 ' + list.length + ' 个：');
    for (const t of list) console.log('    id=' + String(t.id).padStart(5) + '  ' + (t.name || '').padEnd(30) + ' global=' + t.global);
  }

  console.log('\n=== 每个 tag 的实际 mod 数（用 tag 过滤验证）===');
  const list = (r.data && r.data.tags) || [];
  for (const t of list) {
    const rr = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"${(t.name || '').replace(/"/g, '')}"}}, count:1){ totalCount } }`);
    const n = rr.errors ? '✗' : rr.data.mods.totalCount;
    console.log('  ' + (t.name || '').padEnd(30) + n);
  }
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
