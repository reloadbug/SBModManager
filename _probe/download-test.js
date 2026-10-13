'use strict';
/**
 * 实测探针：Nexus 下载链接端点对「免费账号 + 已登录会话」是否可用。
 * 用法：
 *   PROBE_MOD=1496 env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe _probe/download-test.js
 */
const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = '剑星 Mod 管理器';
app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

const GAME = 'stellarblade';
const GAME_ID = 7804;
const MOD_ID = Number(process.env.PROBE_MOD) || 1496;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';

function log(...a) { console.log(a.join(' ')); }

async function gql(f, query, variables) {
  const res = await f('https://api.nexusmods.com/v2/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query, variables })
  });
  const txt = await res.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { /* 忽略 */ }
  return { status: res.status, json: j, text: txt.slice(0, 400) };
}

app.whenReady().then(async () => {
  const s = session.fromPartition('persist:nexus');
  s.setUserAgent(UA);
  const f = (u, o) => s.fetch(u, o);

  const out = [];

  // ---- 1. 取 mod 的文件列表 ----
  const q = `{ modFiles(modId:${MOD_ID}, gameId:${GAME_ID}){ name fileId version category size primary } }`;
  const r1 = await gql(f, q, null);
  out.push('== modFiles status=' + r1.status);
  if (!r1.json || !r1.json.data) out.push('== 原始响应: ' + r1.text);
  const files = (r1.json && r1.json.data && r1.json.data.modFiles) || [];
  out.push('== 文件数=' + files.length);
  const main = files.find(x => x.category === 'MAIN') || files[0];
  if (main) out.push('== 主文件: ' + JSON.stringify(main));
  files.slice(0, 8).forEach(x => out.push('   - ' + x.fileId + ' [' + x.category + '] ' + x.name));

  if (!main) {
    log(out.join('\n'));
    require('fs').writeFileSync(path.join(__dirname, 'dl-out.txt'), out.join('\n'), 'utf8');
    setTimeout(() => app.exit(0), 600);
    return;
  }

  const fileId = main.fileId;

  // ---- 2. 读配置里的 API Key ----
  let apiKey = '';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
    apiKey = cfg.nexusApiKey || '';
  } catch { /* 忽略 */ }
  out.push('== 配置里的 API Key: ' + (apiKey ? '(有, ' + apiKey.length + ' 字符)' : '(无)'));

  // ---- 3. 逐个策略测试 ----
  const strategies = [
    {
      name: 'A. API download_link + 会话Cookie(无 apikey)',
      url: `https://api.nexusmods.com/v1/games/${GAME}/mods/${MOD_ID}/files/${fileId}/download_link.json`,
      headers: {}
    },
    {
      name: 'B. API download_link + apikey 头',
      url: `https://api.nexusmods.com/v1/games/${GAME}/mods/${MOD_ID}/files/${fileId}/download_link.json`,
      headers: apiKey ? { apikey: apiKey } : null
    },
    {
      name: 'C. API download_link + key/expires 查询参数(占位)',
      url: `https://api.nexusmods.com/v1/games/${GAME}/mods/${MOD_ID}/files/${fileId}/download_link.json?key=TESTKEY&expires=9999999999`,
      headers: {}
    },
    {
      name: 'D. 网站 files 页(nmm=1)',
      url: `https://www.nexusmods.com/${GAME}/mods/${MOD_ID}?tab=files&file_id=${fileId}&nmm=1`,
      headers: {}
    }
  ];

  for (const st of strategies) {
    if (st.headers === null) { out.push('--- ' + st.name + ' → 跳过（无 API Key）'); continue; }
    out.push('--- ' + st.name);
    try {
      const res = await f(st.url, { headers: { 'User-Agent': UA, ...st.headers } });
      const txt = (await res.text()).replace(/\s+/g, ' ');
      out.push('    status=' + res.status + ' ct=' + (res.headers.get('content-type') || ''));
      out.push('    body: ' + txt.slice(0, 320));
    } catch (e) {
      out.push('    ERR ' + e.message);
    }
  }

  const text = out.join('\n');
  log(text);
  fs.writeFileSync(path.join(__dirname, 'dl-out.txt'), text, 'utf8');
  setTimeout(() => app.exit(0), 800);
});
