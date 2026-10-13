'use strict';
/**
 * 探针：试出「按 mod 取图集」的可用查询。
 *
 * 候选：
 *   A. media(filter:{gameId:[{value:"7804"}]})            —— 站点级图集，看能否按 mod 收敛
 *   B. uploads(modId: 1252, uploadType: "image")          —— UploadList 里有没有图
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/nexus-media-try.js
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
  console.log('=== UploadList / Upload 结构 ===');
  for (const name of ['UploadList', 'Upload']) {
    const { json } = await gql(`{ __type(name:"${name}"){ kind fields { name type { kind name ofType { kind name ofType { kind name } } } } } }`);
    const t = json && json.data && json.data.__type;
    console.log('\n--- ' + name + ' ---');
    if (!t) { console.log('  （不存在）'); continue; }
    for (const f of (t.fields || [])) console.log('  .' + f.name + ' : ' + typeName(f.type));
  }

  console.log('\n=== A) media(gameId=7804, type=image) ===');
  {
    const q = `query($filter: MediaSearchFilter, $sort: [MediaSearchSort!], $offset: Int, $count: Int) {
      media(filter: $filter, sort: $sort, offset: $offset, count: $count) {
        totalCount nodesCount
        nodes { __typename ... on Image { id title name url thumbnailUrl adult } }
      }
    }`;
    const v = { filter: { gameId: [{ value: '7804' }], type: [{ value: 'image' }] }, sort: [{ createdAt: { direction: 'DESC' } }], offset: 0, count: 3 };
    const { json } = await gql(q, v);
    const err = json && json.errors && json.errors[0] && json.errors[0].message;
    if (err) console.log('  ✗ ' + err.slice(0, 300));
    else console.log('  ✓ ' + JSON.stringify(json.data.media, null, 1).slice(0, 1200));
  }

  console.log('\n=== B) uploads(modId=1252) ===');
  {
    const q = `{ uploads(modId: 1252, start: 0, perPage: 5) { __typename } }`;
    const { json } = await gql(q);
    const err = json && json.errors && json.errors[0] && json.errors[0].message;
    if (err) console.log('  ✗ ' + err.slice(0, 300));
    else console.log('  ✓ ' + JSON.stringify(json.data).slice(0, 600));
  }

  app.quit();
}).catch(e => { console.error('探针崩溃：' + e.message + '\n' + e.stack); app.exit(1); });
