'use strict';
/* 搜 Nexus 上 ATOOL 相关动画包（用 gameDomainName，与 nexus.js 同口径） */
async function gql(q) {
  const res = await fetch('https://api.nexusmods.com/v2/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}
async function main() {
  const term = process.argv[2] || '*ATOOL*';
  const d = await gql(`{
    mods(filter: { gameDomainName: { value: "stellarblade" }, name: { value: "${term}", op: WILDCARD } },
         count: 40, sort: [{ endorsements: { direction: DESC } }]) {
      totalCount
      nodes { modId name summary version endorsements downloads }
    }
  }`);
  console.log('命中总数: ' + d.mods.totalCount);
  for (const m of (d.mods.nodes || [])) {
    console.log('#' + m.modId + '  ' + m.name + '  v' + m.version + '  👍' + m.endorsements + '  ⬇' + m.downloads);
    console.log('     ' + String(m.summary || '').replace(/\s+/g, ' ').slice(0, 170));
  }
}
main().catch(e => console.log('FATAL', e.message));
