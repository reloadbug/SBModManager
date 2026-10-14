'use strict';
/* 查 ATOOL（mod 1662）与相关动画包的 Nexus 文件清单 + 描述。
   GraphQL 不带 apikey 也能查（本项目已实测）。字段名以 src/main/nexus.js 为准。 */
const GAME_ID = 7804;

async function gql(q) {
  const res = await fetch('https://api.nexusmods.com/v2/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

function modQuery(id, withDesc) {
  return `{
    mod(modId:${id}, gameId:${GAME_ID}) { modId name version author summary${withDesc ? ' description' : ''} }
    modFiles(modId:${id}, gameId:${GAME_ID}) { fileId name version size description categoryId category primary }
  }`;
}

async function main() {
  const ids = process.argv.slice(2).map(Number);
  for (const id of ids) {
    try {
      const d = await gql(modQuery(id, false));
      const m = d.mod;
      if (!m) { console.log('#' + id, '(不存在)'); continue; }
      console.log('\n================ mod ' + id + ' : ' + m.name + '  v' + m.version + '  by ' + m.author);
      console.log('  摘要: ' + String(m.summary || '').replace(/\s+/g, ' ').slice(0, 220));
      const files = (d.modFiles || []).slice().sort((a, b) => (a.primary ? -1 : 1));
      for (const f of files) {
        console.log('  [' + (f.category || f.categoryId) + ']' + (f.primary ? '*' : ' ') +
          ' fileId=' + f.fileId + '  ' + f.name + '  v' + f.version + '  ' + f.size);
      }
    } catch (e) { console.log('#' + id, 'ERR', e.message); }
  }
}
main().catch(e => console.log('FATAL', e.message));
