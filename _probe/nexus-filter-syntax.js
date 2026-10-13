'use strict';
/** 验证「游戏限定 AND (标签A OR 标签B)」的正确嵌套写法 */
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
  console.log('=== 基线 ===');
  await T('全部', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, count:1){ totalCount }`);
  await T('tag=Sexualised', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"Sexualised"}}, count:1){ totalCount }`);
  await T('tag=Textures', `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"Textures"}}, count:1){ totalCount }`);
  console.log('  预期 OR = 1254+114-35 = 1333 ；预期 AND = 35');

  console.log('\n=== 方案 A：游戏 AND (嵌套 OR) ===');
  await T('外层 AND，内层 {op:OR, filter:[..]}',
    `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, filter:[{op:OR, filter:[{tag:{value:"Sexualised"}},{tag:{value:"Textures"}}]}]}, count:1){ totalCount }`);

  console.log('\n=== 方案 B：外层显式 AND + 内层 OR ===');
  await T('op:AND 外层',
    `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, op:AND, filter:[{op:OR, filter:[{tag:{value:"Sexualised"}},{tag:{value:"Textures"}}]}]}, count:1){ totalCount }`);

  console.log('\n=== 方案 C：分类 + 游戏 AND (标签 OR) ===');
  await T('Outfits + (Textures OR Replacer)',
    `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"Outfits"}, filter:[{op:OR, filter:[{tag:{value:"Textures"}},{tag:{value:"Replacer"}}]}]}, count:1){ totalCount }`);

  console.log('\n=== 方案 D：分类 + 标签 AND 交集（最简单）===');
  await T('Outfits + Sexualised AND Textures',
    `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"Outfits"}, filter:[{tag:{value:"Sexualised"}},{tag:{value:"Textures"}}]}, count:1){ totalCount }`);

  console.log('\n=== 方案 E：多个分类 OR（全部/服装/玩法 多选场景）===');
  await T('(Outfits OR Gameplay)',
    `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, filter:[{op:OR, filter:[{categoryName:{value:"Outfits"}},{categoryName:{value:"Gameplay"}}]}]}, count:1){ totalCount }`);

  console.log('\n=== 顺带：NOT_EQUALS 可用性（排除某标签）===');
  await T('tag != Pornographic',
    `mods(filter:{gameDomainName:{value:"${DOMAIN}"}, tag:{value:"Pornographic", op:NOT_EQUALS}}, count:1){ totalCount }`);

  console.log('\n=== 顺带：一次请求批量取各分类计数（别名）===');
  const aliases = ['Outfits', 'Gameplay', 'Miscellaneous', 'User Interface', 'Visuals']
    .map((c, i) => `c${i}: mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"${c}"}}, count:1){ totalCount }`).join('\n');
  const r = await gql('{\n' + aliases + '\n}');
  if (r.errors) console.log('  ✗ ' + r.errors.map(e => e.message).join('; '));
  else console.log('  ✓ 一次请求拿到 5 个分类计数：' + JSON.stringify(Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, v.totalCount]))));
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
