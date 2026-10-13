'use strict';
/**
 * 探针：把 GraphQL 的 Query 根字段全列出来，找「按 mod 取图集」的入口。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/nexus-query-roots.js
 */
const { app, net } = require('electron');
const path = require('path');

const APP_NAME = '剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const ENDPOINT = 'https://api.nexusmods.com/v2/graphql';

async function gql(query, variables) {
  const r = await net.fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
}

function typeName(t) {
  if (!t) return '?';
  if (t.name) return t.name;
  if (t.ofType) return typeName(t.ofType) + (t.kind === 'LIST' ? '[]' : '');
  return t.kind || '?';
}

app.whenReady().then(async () => {
  console.log('=== Query 根字段（全部） ===');
  {
    const q = `{ __schema { queryType { fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name } } } } } }`;
    const { json } = await gql(q);
    const fields = (json && json.data && json.data.__schema && json.data.__schema.queryType && json.data.__schema.queryType.fields) || [];
    for (const f of fields.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log('  ' + f.name + '(' + (f.args || []).map(a => a.name + ': ' + typeName(a.type)).join(', ') + ') → ' + typeName(f.type));
    }
  }

  console.log('\n=== 试：按 gameId 取 media（type=image），看总数 ===');
  {
    const q = `query($filter: MediaSearchFilter, $sort: [MediaSearchSort!], $offset: Int, $count: Int) {
      media(filter: $filter, sort: $sort, offset: $offset, count: $count) {
        totalCount nodesCount
        nodes { __typename ... on Image { id title url thumbnailUrl adult game { id name } } }
      }
    }`;
    const vars = {
      filter: { gameId: [{ value: '7804', op: EQUALS_OR_EMPTY }] },
      sort: [{ createdAt: { direction: DESC } }],
      offset: 0,
      count: 3
    };
    // 先试不带 op 的写法
    const v2 = { filter: { gameId: [{ value: '7804' }] }, sort: [{ createdAt: { direction: DESC } }], offset: 0, count: 3 };
    for (const [label, v] of [['无 op', v2], ['op=EQUALS', { filter: { gameId: [{ value: '7804', op: 'EQUALS' }] }, sort: [{ createdAt: { direction: 'DESC' } }], offset: 0, count: 3 }]]) {
      const { json } = await gql(q, v);
      const err = json && json.errors && json.errors[0] && json.errors[0].message;
      if (err) console.log('  ✗ ' + label + ' → ' + err.slice(0, 200));
      else console.log('  ✓ ' + label + ' → ' + JSON.stringify(json.data.media).slice(0, 600));
    }
  }

  app.quit();
}).catch(e => { console.error('探针崩溃：' + e.message + '\n' + e.stack); app.exit(1); });
