'use strict';
/**
 * 探测 Nexus 分类能力（第二轮）—— 目标是拿到「可用的分类枚举值清单」。
 *
 * 第一轮已知：
 *   - 过滤唯一入口是 ModsFilter.categoryName（BaseFilterValue）
 *   - categoryName:{value:"Armour"} 语法对但 totalCount=0（精确匹配，值要真实）
 *   - Category 类型没有 categoryId / parentCategory / modsCount
 *
 * 本轮要解决：
 *   1. Category 类型到底有哪些字段（用 __type 直查）
 *   2. categories(gameId:7804) 的完整清单
 *   3. 用真实 category 值逐个验证 categoryName 过滤是否生效
 *   4. 拉前 500 个 mod 统计 category 全量分布
 *   5. 顺便看 tags 长什么样（「角色」可能要靠 tag 细分）
 *
 * 用法：node _probe/nexus-categories2.js
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

function typeRef(t) {
  if (!t) return '?';
  if (t.name) return t.name + (t.kind === 'NON_NULL' ? '!' : '');
  return typeRef(t.ofType) + (t.kind === 'NON_NULL' ? '!' : '') + (t.kind === 'LIST' ? '[]' : '');
}

async function main() {
  // ---------- 1. Category 类型的真实字段 ----------
  console.log('=== 1) __type(name:"Category") 的真实字段 ===');
  const q1 = await gql(`{ __type(name:"Category") { name kind description fields { name description type { name kind ofType { name kind ofType { name } } } } } }`);
  const ct = q1.data && q1.data.__type;
  if (!ct) console.log('  ✗ ' + JSON.stringify(q1.errors));
  else {
    console.log('  描述：' + (ct.description || '(无)'));
    for (const f of ct.fields || []) {
      console.log('  ' + f.name.padEnd(22) + typeRef(f.type).padEnd(20) + (f.description || '').slice(0, 60));
    }
  }

  // ---------- 2. 完整分类清单 ----------
  console.log('\n=== 2) 剑星分类清单（categories(gameId:7804)）===');
  const catFields = (ct && ct.fields || []).map(f => f.name).filter(n => !/^__/.test(n));
  const q2 = await gql(`{ categories(gameId:${GAME_ID}) { ${catFields.join(' ') || 'id name'} } }`);
  if (q2.errors) console.log('  ✗ ' + q2.errors.map(e => e.message).join('; '));
  else {
    const list = q2.data.categories || [];
    console.log('  共 ' + list.length + ' 个：');
    for (const c of list) console.log('    ' + JSON.stringify(c));
  }

  // ---------- 3. 用真实 category 值验证 categoryName 过滤 ----------
  console.log('\n=== 3) 用真实 category 值验证 categoryName 过滤 ===');
  // 先拿一批真实值
  const r3 = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, sort:[{downloads:{direction:DESC}}], count:300){ nodes { category } } }`);
  const vals = [...new Set((r3.data.mods.nodes || []).map(n => n.category).filter(Boolean))];
  console.log('  前 300 个里出现的 category 值：' + JSON.stringify(vals));
  for (const v of vals) {
    const r = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"${v}"}}, count:1){ totalCount } }`);
    const got = r.errors ? '✗ ' + r.errors.map(e => e.message).join('; ') : JSON.stringify(r.data.mods);
    console.log('    categoryName="' + v + '" → ' + got);
  }

  // ---------- 4. 前 500 个的 category 全量分布 ----------
  console.log('\n=== 4) 下载量前 500 个的 category 全量分布 ===');
  const tally = {};
  let scanned = 0;
  for (let off = 0; off < 500; off += 100) {
    const r = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, sort:[{downloads:{direction:DESC}}], offset:${off}, count:100){ nodes { category } } }`);
    if (r.errors) { console.log('  ✗ ' + r.errors.map(e => e.message).join('; ')); break; }
    const nodes = (r.data.mods && r.data.mods.nodes) || [];
    if (!nodes.length) break;
    scanned += nodes.length;
    for (const n of nodes) tally[n.category || '(空)'] = (tally[n.category || '(空)'] || 0) + 1;
  }
  console.log('  实扫 ' + scanned + ' 个：');
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));

  // ---------- 5. tags 长什么样 ----------
  console.log('\n=== 5) tags 采样（看「角色」能否靠 tag 细分）===');
  const r5 = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, sort:[{downloads:{direction:DESC}}], count:40){ nodes { name category tags } } }`);
  if (r5.errors) console.log('  ✗ ' + r5.errors.map(e => e.message).join('; '));
  else {
    const tagTally = {};
    for (const n of r5.data.mods.nodes) {
      const ts = n.tags || [];
      for (const t of ts) tagTally[t] = (tagTally[t] || 0) + 1;
      console.log('  [' + (n.category || '-') + '] ' + n.name.slice(0, 40) + '  tags=' + JSON.stringify(ts));
    }
    console.log('\n  tag 词频：');
    Object.entries(tagTally).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));
  }

  // ---------- 6. 确认 categoryName 与 totalCount 的对应（各分类真实总数） ----------
  console.log('\n=== 6) 每个分类的真实总数（categoryName 过滤）===');
  for (const v of Object.keys(tally).filter(k => k !== '(空)')) {
    const r = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}, categoryName:{value:"${v}"}}, count:1){ totalCount } }`);
    console.log('  ' + v.padEnd(20) + (r.errors ? '✗ ' + r.errors.map(e => e.message).join('; ') : (r.data.mods.totalCount + ' 个')));
  }
  // 顺带：不带 categoryName 的总数
  const rall = await gql(`{ mods(filter:{gameDomainName:{value:"${DOMAIN}"}}, count:1){ totalCount } }`);
  console.log('  (全部)'.padEnd(20) + (rall.data && rall.data.mods ? rall.data.mods.totalCount + ' 个' : '?'));
}

main().catch(e => { console.error('探测失败：' + e.message); process.exit(1); });
