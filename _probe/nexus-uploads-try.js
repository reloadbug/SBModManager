'use strict';
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
  const r = await net.fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
function typeName(t) { if (!t) return '?'; if (t.name) return t.name; if (t.ofType) return typeName(t.ofType) + (t.kind === 'LIST' ? '[]' : ''); return t.kind || '?'; }
app.whenReady().then(async () => {
  const { json: j1 } = await gql(`{ __type(name:"ModUpload"){ fields { name type { kind name ofType { kind name ofType { kind name } } } } } }`);
  console.log('=== ModUpload ===');
  const t = j1 && j1.data && j1.data.__type;
  if (t) for (const f of (t.fields || [])) console.log('  .' + f.name + ' : ' + typeName(f.type));
  else console.log('  （不存在）');

  console.log('\n=== uploads(modId:1252) ===');
  for (const extra of [
    'orderDir: "DESC", orderColumn: "createdAt"',
    'orderDir: "DESC", orderColumn: "id"',
    'orderDir: "desc", orderColumn: "created_at"'
  ]) {
    const q = `{ uploads(modId: 1252, start: 0, perPage: 3, ${extra}) { filteredCount totalCount uploads { __typename } } }`;
    const { json } = await gql(q);
    const err = json && json.errors && json.errors[0] && json.errors[0].message;
    if (err) console.log('  ✗ ' + extra + ' → ' + err.slice(0, 160));
    else console.log('  ✓ ' + extra + ' → ' + JSON.stringify(json.data).slice(0, 500));
  }
  app.quit();
}).catch(e => { console.error('崩溃：' + e.message); app.exit(1); });
