'use strict';
/**
 * 探测 Nexus 分类能力（第三轮）—— 补齐两个缺口：
 *   1. categories(gameId:7804) 完整清单（Category 有 parentId，看是否层级）
 *   2. LegacyTag 的结构 —— 「角色」能否靠 tag 细分
 *   3. 剑星角色关键词在 mod 名里的分布（EVE / Lily / Adam …）
 *
 * 用法：node _probe/nexus-categories3.js
 */
const https = require('https');
const HOST = 'api.nexusmods.com';
const PATH = '/v2/graphql';
const GAME_ID = 7804;
const DOMAIN = 'stellarblade';

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: HOST, path: PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': 'application/json', 'User-Agent': 'StarBladeModManager/0.1 (Windows; Node)' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('非 JSON HTTP ' + res.statusCode)); } });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('超时')));
    req.write(body);
    req.end();
  });
}

function typeRef(t) {
  if (!t) return '?';
  if (t.name) return t.name + (t.kind === 'NON_NULL' ? '!' : '');
  return typeRef(t.ofType) + (t.kind === 'NON_NULL' ? '!' : '') + (t.kind === 'LIST' ? '[]' : '');
}

async function main() {
  // ---------- 1. 完整分类清单（含 parentId） ----------
  console.log('=== 1) categories(gameId:7804) 完整清单 ===');
  const q1 = await gql(`{ categories(gameId:${GAME_ID}) { id name parentId approved description categoryGames { id name domainName } } }`);
  if (q1.errors) console.log('  ✗ ' + q1.errors.map(e => e.message).join('; '));
  else {
    const list = q1.data.categories || [];
    console.log('  共 ' + list.length + ' 个：');
    for (const c of list) {
      const games = (c.categoryGames || []).map(g => g.domainName || g.name).join(',');
      console.log('    id=' + String(c.id).padStart(5) + '  parentId=' + String(c.parentId).padStart(5) + '  ' + c.name.padEnd(20) + '  approved=' + c.approved + '  游戏=' + games);
    }
  }

  // ---------- 2. LegacyTag 结构 ----------
  console.log('\n=== 2) __type(name:"LegacyTag") 的结构 ===');
  const q2 = await gql(`{ __type(name:"LegacyTag") { name fields { name type { name kind ofType { name kind ofType { name } } } } } }`);
  const lt = q2.data && q2.data.__type;
  if (!lt) console.log('  ✗ ' + JSON.stringify(q2.errors));
  else for (const f of lt.fields || []) console.log('  ' + f.name.padEnd(20) + typeRef(f.type));

  // ---------- 3. tags 采样 ----------
  console.log('\n=== 3) tags 采样（前 30 个 mod）===');
  const r3 = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, sort:[{downloads:{direction:DESC}}], count:30){ nodes { name category tags { name } } } }`);
  if (r3.errors) console.log('  ✗ ' + r3.errors.map(e => e.message).join('; '));
  else {
    const tagTally = {};
    for (const n of r3.data.mods.nodes) {
      const ts = (n.tags || []).map(t => t.name);
      for (const t of ts) tagTally[t] = (tagTally[t] || 0) + 1;
      console.log('  [' + (n.category || '-').padEnd(15) + '] ' + (n.name || '').slice(0, 45).padEnd(46) + ' tags=' + JSON.stringify(ts));
    }
    console.log('\n  tag 词频：');
    Object.entries(tagTally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));
  }

  // ---------- 4. 角色关键词在 mod 名里的分布 ----------
  console.log('\n=== 4) 剑星角色关键词在 mod 名中的出现（前 500 个）===');
  const KEYWORDS = ['Eve', 'EVE', 'Lily', 'Adam', 'Tachy', 'Raven', 'Kaya', 'Eve\'s', 'Bikini', 'Swimsuit'];
  const tally = {};
  let names = [];
  for (let off = 0; off < 500; off += 100) {
    const r = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, sort:[{downloads:{direction:DESC}}], offset:${off}, count:100){ nodes { name } } }`);
    const nodes = (r.data && r.data.mods && r.data.mods.nodes) || [];
    if (!nodes.length) break;
    names = names.concat(nodes.map(n => n.name || ''));
  }
  console.log('  共 ' + names.length + ' 个 mod 名');
  for (const kw of KEYWORDS) {
    const n = names.filter(s => s.toLowerCase().includes(kw.toLowerCase())).length;
    tally[kw] = n;
  }
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));

  // ---------- 5. 分类 + 搜索 组合是否可行 ----------
  console.log('\n=== 5) 分类 + 关键词 组合筛选验证 ===');
  for (const [cat, kw] of [['Outfits', 'bikini'], ['Outfits', 'swimsuit'], ['User Interface', 'hud']]) {
    const r = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"${cat}"}, name:{value:"${kw}", op:WILDCARD}}, count:1){ totalCount } }`);
    console.log('  ' + (cat + ' + "' + kw + '"').padEnd(30) + (r.errors ? '✗ ' + r.errors.map(e => e.message).join('; ') : r.data.mods.totalCount + ' 个'));
  }

  // ---------- 6. 分类 + 排序 组合验证 ----------
  console.log('\n=== 6) 分类 + 排序 组合验证（Outfits 按最新）===');
  const r6 = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"Outfits"}}, sort:[{createdAt:{direction:DESC}}], count:5){ totalCount nodes { name category createdAt } } }`);
  if (r6.errors) console.log('  ✗ ' + r6.errors.map(e => e.message).join('; '));
  else {
    console.log('  totalCount=' + r6.data.mods.totalCount);
    for (const n of r6.data.mods.nodes) console.log('    ' + n.name.slice(0, 45).padEnd(46) + ' ' + n.createdAt);
  }
}

main().catch(e => { console.error('探测失败：' + e.message); process.exit(1); });
