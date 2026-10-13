'use strict';
/** 验证多标签筛选的正确 GraphQL 写法（嵌套 filter + op） */
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
const T = async (label, body) => {
  const r = await gql('{ ' + body + ' }');
  console.log('  ' + label.padEnd(34) + (r.errors ? '✗ ' + r.errors.map(e => e.message).join('; ').slice(0, 90) : '✓ ' + JSON.stringify(r.data.mods && r.data.mods.totalCount !== undefined ? { totalCount: r.data.mods.totalCount } : r.data)));
};
(async () => {
  console.log('=== 单 tag 基线 ===');
  await T('tag=Sexualised', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"Sexualised"}}, count:1){ totalCount }`);
  await T('tag=Textures', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"Textures"}}, count:1){ totalCount }`);

  console.log('\n=== 嵌套 filter 数组 + op:AND ===');
  await T('filter:[tag S, tag T] op AND', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, op:AND, filter:[{tag:{value:"Sexualised"}},{tag:{value:"Textures"}}]}, count:1){ totalCount }`);
  await T('filter:[tag S, tag T] 无 op', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, filter:[{tag:{value:"Sexualised"}},{tag:{value:"Textures"}}]}, count:1){ totalCount }`);

  console.log('\n=== 嵌套 filter + op:OR ===');
  await T('filter:[tag S, tag T] op OR', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, op:OR, filter:[{tag:{value:"Sexualised"}},{tag:{value:"Textures"}}]}, count:1){ totalCount }`);

  console.log('\n=== 分类 + 多标签 ===');
  await T('Outfits + [Textures,Replacer] OR', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"Outfits"}, op:OR, filter:[{tag:{value:"Textures"}},{tag:{value:"Replacer"}}]}, count:1){ totalCount }`);

  console.log('\n=== FilterLogicalOperator 枚举值 ===');
  const r = await gql(`{ __type(name:"FilterLogicalOperator") { enumValues { name } } }`);
  console.log('  ' + JSON.stringify(r.data.__type.enumValues.map(v => v.name)));

  console.log('\n=== BaseFilterValue 结构（op 可选值）===');
  const r2 = await gql(`{ __type(name:"BaseFilterValue") { inputFields { name type { name kind ofType { name } } } } }`);
  for (const f of (r2.data && r2.data.__type && r2.data.__type.inputFields) || []) console.log('  ' + f.name + ' : ' + JSON.stringify(f.type).slice(0, 100));
  const r3 = await gql(`{ __type(name:"FilterComparisonOperator") { enumValues { name } } }`);
  if (r3.data && r3.data.__type) console.log('  比较运算符: ' + JSON.stringify(r3.data.__type.enumValues.map(v => v.name)));
  else console.log('  ' + JSON.stringify(r3.errors));
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
