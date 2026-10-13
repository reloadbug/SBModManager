'use strict';
/**
 * 探针（续）：MediaUnionPage / MediaSearchFilter / Image 的结构 —— 找出「按 mod 取图集」的正确查询。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/nexus-media-shape.js
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

const TYPES = [
  'MediaUnionPage', 'MediaUnion', 'Image', 'MediaFacet',
  'MediaSearchFilter', 'MediaGeneralSearchFilterValue', 'MediaSearchSort',
  'ModMedia', 'ModMediaImage', 'ImageTypes', 'ThumbnailSize', 'MediaStatus'
];

app.whenReady().then(async () => {
  for (const name of TYPES) {
    const q = `{ __type(name:"${name}"){
      kind name
      fields { name description type { kind name ofType { kind name ofType { kind name } } } }
      inputFields { name description type { kind name ofType { kind name ofType { kind name } } } }
      enumValues { name description }
      possibleTypes { name kind }
    } }`;
    const { json } = await gql(q);
    const t = json && json.data && json.data.__type;
    console.log('\n=== ' + name + ' ===');
    if (!t) { console.log('  （不存在）'); continue; }
    console.log('  kind=' + t.kind);
    for (const f of (t.fields || [])) console.log('  .' + f.name + ' : ' + typeName(f.type) + (f.description ? '   // ' + f.description.slice(0, 80) : ''));
    for (const f of (t.inputFields || [])) console.log('  (in) ' + f.name + ' : ' + typeName(f.type) + (f.description ? '   // ' + f.description.slice(0, 80) : ''));
    for (const v of (t.enumValues || [])) console.log('  enum ' + v.name + (v.description ? '   // ' + v.description.slice(0, 60) : ''));
    for (const p of (t.possibleTypes || [])) console.log('  union→ ' + p.kind + ' ' + p.name);
  }

  app.quit();
}).catch(e => { console.error('探针崩溃：' + e.message + '\n' + e.stack); app.exit(1); });
