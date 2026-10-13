'use strict';
/**
 * 探针：查 Nexus GraphQL 到底有没有「mod 图集」字段。
 *
 * 背景：现在只缓存 pictureUrl / thumbnailLargeUrl / thumbnailUrl —— 是**同一张图的 3 个尺寸**。
 * 用户要的是「mod 的 5 张不同图片」。所以先确认接口层能不能拿到多图。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/nexus-images-introspect.js
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

/** 把 type 递归展开成可读字符串 */
function typeName(t) {
  if (!t) return '?';
  if (t.name) return t.name;
  if (t.ofType) return typeName(t.ofType) + (t.kind === 'LIST' ? '[]' : '');
  return t.kind || '?';
}

app.whenReady().then(async () => {
  console.log('=== 1) Mod 类型的全部字段 ===');
  {
    const q = `{ __type(name:"Mod"){ name fields { name description type { kind name ofType { kind name ofType { kind name } } } } } }`;
    const { status, json } = await gql(q);
    if (status !== 200 || !json || !json.data || !json.data.__type) {
      console.log('  ✗ 拿不到 Mod 类型  status=' + status + '  body=' + JSON.stringify(json).slice(0, 400));
    } else {
      for (const f of json.data.__type.fields) {
        const n = f.name.toLowerCase();
        const mark = /image|media|gallery|photo|screen|thumb|pic/.test(n) ? '  ★' : '';
        console.log('  ' + f.name.padEnd(28) + typeName(f.type) + mark);
      }
    }
  }

  console.log('\n=== 2) 名字里带 image/media/gallery 的类型 ===');
  {
    const q = `{ __schema { types { name kind } } }`;
    const { json } = await gql(q);
    const types = (json && json.data && json.data.__schema && json.data.__schema.types) || [];
    const hit = types.filter(t => /image|media|gallery|photo|screen|thumb|pic/i.test(t.name));
    if (!hit.length) console.log('  （没有这类类型）');
    for (const t of hit) console.log('  ' + t.kind.padEnd(10) + t.name);
    console.log('  全部类型数 = ' + types.length);
  }

  console.log('\n=== 3) Query 根上的 image/media 相关字段 ===');
  {
    const q = `{ __schema { queryType { fields { name args { name type { kind name ofType { kind name } } } type { kind name ofType { kind name } } } } } }`;
    const { json } = await gql(q);
    const fields = (json && json.data && json.data.__schema && json.data.__schema.queryType && json.data.__schema.queryType.fields) || [];
    const hit = fields.filter(f => /image|media|gallery|photo|screen|thumb|pic/i.test(f.name));
    if (!hit.length) console.log('  （Query 根上没有这类字段）');
    for (const f of hit) {
      console.log('  ' + f.name + '(' + (f.args || []).map(a => a.name + ': ' + typeName(a.type)).join(', ') + ') → ' + typeName(f.type));
    }
    console.log('  Query 根字段数 = ' + fields.length);
  }

  console.log('\n=== 4) 拿真实 mod 试几个可能的字段 ===');
  {
    // 一个一个试，成功就打印，失败就记下 GraphQL 的报错
    const candidates = [
      'media { id url thumbnailUrl type }',
      'images { id url thumbnailUrl }',
      'galleryImages { id url thumbnailUrl }',
      'screenshots { id url thumbnailUrl }',
      'pictureUrls',
      'imagesUrl'
    ];
    for (const frag of candidates) {
      const q = `{ mod(modId:1252, gameId:7804) { modId ${frag} } }`;
      const { json } = await gql(q);
      const err = json && json.errors && json.errors[0] && json.errors[0].message;
      if (err) console.log('  ✗ ' + frag.padEnd(46) + ' → ' + err.slice(0, 90));
      else console.log('  ✓ ' + frag.padEnd(46) + ' → ' + JSON.stringify(json.data && json.data.mod).slice(0, 500));
    }
  }

  app.quit();
}).catch(e => { console.error('探针崩溃：' + e.message + '\n' + e.stack); app.exit(1); });
