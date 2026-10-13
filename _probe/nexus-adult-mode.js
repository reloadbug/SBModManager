'use strict';
/** 验证 adultContent 三态过滤（hide / all / only） */
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
  console.log('  ' + label.padEnd(46) + (r.errors ? '✗ ' + r.errors.map(e => e.message).join('; ').slice(0, 80) : '✓ ' + r.data.mods.totalCount));
};
(async () => {
  console.log('=== adultContent 三态 ===');
  await T('无过滤（全部）', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, count:1){ totalCount }`);
  await T('adultContent:{value:false}（隐藏成人）', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:false}}, count:1){ totalCount }`);
  await T('adultContent:{value:true}（仅成人）', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}}, count:1){ totalCount }`);

  console.log('\n=== 自洽性：非成人 + 成人 应等于 全部 ===');
  const all = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, count:1){ totalCount } }`);
  const no = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:false}}, count:1){ totalCount } }`);
  const yes = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}}, count:1){ totalCount } }`);
  const A = all.data.mods.totalCount, N = no.data.mods.totalCount, Y = yes.data.mods.totalCount;
  console.log('  全部 ' + A + ' = 非成人 ' + N + ' + 成人 ' + Y + ' = ' + (N + Y) + (A === N + Y ? '  ✓' : '  ✗'));

  console.log('\n=== 仅成人 + 分类 / 标签 组合 ===');
  await T('仅成人 + Outfits', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}, categoryName:{value:"Outfits"}}, count:1){ totalCount }`);
  await T('仅成人 + tag:Sexualised', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}, tag:{value:"Sexualised"}}, count:1){ totalCount }`);
  await T('仅成人 + 分类 + 标签OR', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}, categoryName:{value:"Outfits"}, filter:[{op:OR, filter:[{tag:{value:"Textures"}},{tag:{value:"Replacer"}}]}]}, count:1){ totalCount }`);

  console.log('\n=== 校验：仅成人模式下返回的条目确实都是成人 ===');
  const r = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}}, sort:[{downloads:{direction:DESC}}], count:20){ nodes { modId name adultContent } } }`);
  const bad = (r.data.mods.nodes || []).filter(n => !n.adultContent);
  console.log('  前 20 个里非成人条目：' + bad.length + (bad.length ? '  ✗ ' + JSON.stringify(bad.slice(0, 3)) : '  ✓'));

  console.log('\n=== 别名批量：一次请求拿三态计数 ===');
  const q = `{
    all: mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, count:1){ totalCount }
    no: mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:false}}, count:1){ totalCount }
    yes: mods(filter:{gameDomainName:{value:"${DOMAIN}"}, adultContent:{value:true}}, count:1){ totalCount }
  }`;
  const rr = await gql(q);
  console.log('  ' + (rr.errors ? '✗ ' + rr.errors.map(e => e.message).join('; ') : '✓ ' + JSON.stringify(Object.fromEntries(Object.entries(rr.data).map(([k, v]) => [k, v.totalCount])))));
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
