'use strict';
/* 1) dump ATOOL 描述（找安装说明）  2) 搜 Nexus 上 ATOOL 相关动画包 */
const GAME_ID = 7804;

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
  const mode = process.argv[2];

  if (mode === 'desc') {
    const d = await gql(`{ mod(modId:${process.argv[3]}, gameId:${GAME_ID}) { name version description } }`);
    console.log('### ' + d.mod.name + ' v' + d.mod.version);
    console.log(d.mod.description);
    return;
  }

  if (mode === 'search') {
    const term = process.argv[3];
    const d = await gql(`{
      mods(filter: { name: { value: "${term}", op: WILDCARD } }, gameId: ${GAME_ID}, count: 30, sort: { endorsements: { direction: DESC } }) {
        nodes { modId name summary version endorsements downloads }
      }
    }`);
    for (const m of (d.mods.nodes || [])) {
      console.log('#' + m.modId + '  ' + m.name + '  v' + m.version + '  👍' + m.endorsements + '  ⬇' + m.downloads);
      console.log('     ' + String(m.summary || '').replace(/\s+/g, ' ').slice(0, 160));
    }
    return;
  }
}
main().catch(e => console.log('FATAL', e.message));
