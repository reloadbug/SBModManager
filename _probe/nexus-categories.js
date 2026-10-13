'use strict';
/**
 * 探测 Nexus v2 GraphQL 的「分类」能力 —— 给浏览页的分类筛选做设计依据。
 *
 * 想搞清楚四件事：
 *   1. Query 上有没有 categories / categoriesByName 这类字段
 *   2. Mod 类型上分类字段长什么样（category 是字符串？categories 是列表？有 id 吗？）
 *   3. ModsFilter 支不支持按分类过滤（category / categoryId / categoryName）
 *   4. 剑星（gameId=7804）真实的分类清单与各自的 mod 数量
 *
 * 用法：node _probe/nexus-categories.js
 */
const https = require('https');

const HOST = 'api.nexusmods.com';
const PATH = '/v2/graphql';
const GAME_ID = 7804;

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: HOST, path: PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
        'User-Agent': 'StarBladeModManager/0.1 (Windows; Node)'
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('非 JSON（HTTP ' + res.statusCode + '）：' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('超时')));
    req.write(body);
    req.end();
  });
}

async function main() {
  // ---------- 1. Query 上有哪些和分类相关的字段 ----------
  console.log('=== 1) Query 上与分类相关的字段 ===');
  const q1 = await gql(`{ __schema { queryType { fields { name args { name type { name kind ofType { name } } } } } } }`);
  const fields = q1.data && q1.data.__schema && q1.data.__schema.queryType.fields || [];
  for (const f of fields) {
    if (/categor|tag|game/i.test(f.name)) {
      const args = (f.args || []).map(a => a.name + ':' + (a.type.name || (a.type.ofType && a.type.ofType.name) || a.type.kind)).join(', ');
      console.log('  ' + f.name + '(' + args + ')');
    }
  }
  if (q1.errors) console.log('  （errors: ' + q1.errors.map(e => e.message).join('; ') + '）');

  // ---------- 2. Mod 类型上的分类字段 ----------
  console.log('\n=== 2) Mod 类型上的分类字段 ===');
  const q2 = await gql(`{ __type(name:"Mod") { fields { name type { name kind ofType { name kind ofType { name } } } } } }`);
  const mf = q2.data && q2.data.__type && q2.data.__type.fields || [];
  for (const f of mf) {
    if (/categor|tag/i.test(f.name)) {
      console.log('  ' + f.name + ' → ' + JSON.stringify(f.type));
    }
  }

  // ---------- 3. ModsFilter 支不支持按分类过滤 ----------
  console.log('\n=== 3) ModsFilter 的字段（找分类相关） ===');
  const q3 = await gql(`{ __type(name:"ModsFilter") { inputFields { name type { name kind ofType { name kind ofType { name } } } } } }`);
  const inf = q3.data && q3.data.__type && q3.data.__type.inputFields || [];
  for (const f of inf) {
    const t = f.type.name || (f.type.ofType && (f.type.ofType.name || (f.type.ofType.ofType && f.type.ofType.ofType.name)));
    console.log('  ' + f.name + ' : ' + (t || f.type.kind));
  }
  if (!inf.length) console.log('  （没查到 ModsFilter，errors: ' + JSON.stringify(q3.errors) + '）');

  // ---------- 4. 剑星的真实分类清单 ----------
  console.log('\n=== 4) 剑星的分类清单（categories(gameId)） ===');
  for (const q of [
    `{ categories(gameId:${GAME_ID}) { categoryId name parentCategory { categoryId name } modsCount } }`,
    `{ categories(gameId:${GAME_ID}) { id name modCount } }`
  ]) {
    const r = await gql(q);
    if (r.errors) { console.log('  ✗ ' + r.errors.map(e => e.message).join('; ')); continue; }
    const list = (r.data && r.data.categories) || [];
    console.log('  共 ' + list.length + ' 个：');
    for (const c of list) {
      const parent = c.parentCategory ? ('  ← 父：' + c.parentCategory.name) : '';
      console.log('    ' + JSON.stringify(c) + parent);
    }
    break;
  }

  // ---------- 5. 用 categoryName 过滤试试 ----------
  console.log('\n=== 5) 试几种按分类过滤的写法 ===');
  const tries = [
    ['categoryName', `mods(filter:{gameDomainName:{value:"stellarblade"}, categoryName:{value:"Armour"}}, count:1){ totalCount }`],
    ['category', `mods(filter:{gameDomainName:{value:"stellarblade"}, category:{value:"Armour"}}, count:1){ totalCount }`],
    ['categoryId', `mods(filter:{gameDomainName:{value:"stellarblade"}, categoryId:{value:2}}, count:1){ totalCount }`],
    ['categoryName WILDCARD', `mods(filter:{gameDomainName:{value:"Armour"}, categoryName:{value:"Armour", op:WILDCARD}}, count:1){ totalCount }`]
  ];
  for (const [label, body] of tries) {
    const r = await gql('{ ' + body + ' }');
    console.log('  ' + label.padEnd(22) + (r.errors ? '✗ ' + r.errors.map(e => e.message).join('; ') : '✓ ' + JSON.stringify(r.data.mods)));
  }

  // ---------- 6. 实际 mod 上 category 的取值分布（前 100 个） ----------
  console.log('\n=== 6) 下载量前 100 个 mod 的 category 分布 ===');
  const r6 = await gql(`{ mods(filter:{gameDomainName:{value:"stellarblade"}}, sort:[{downloads:{direction:DESC}}], count:100){ nodes { category } } }`);
  if (r6.errors) console.log('  ✗ ' + r6.errors.map(e => e.message).join('; '));
  else {
    const tally = {};
    for (const n of r6.data.mods.nodes) tally[n.category || '(空)'] = (tally[n.category || '(空)'] || 0) + 1;
    Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));
  }
}

main().catch(e => { console.error('探测失败：' + e.message); process.exit(1); });
