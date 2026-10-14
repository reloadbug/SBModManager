'use strict';
/**
 * 用本机 Electron 会话里的 Nexus 登录态，把 ATOOL 主文件真身拉下来，
 * 好确认它的**真实归档结构**（决定安装落点）。
 * 只读 cookie 库副本，不外传。
 */
const fs = require('fs');
const path = require('path');
const sqliteMod = null; // 用 python 读 sqlite 更省事

const UA = 'SBModManager/0.2.2 (Nexus mod manager; +https://github.com/reloadbug/SBModManager)';

async function main() {
  // 1) 取会话 cookie（由 python 事先导出到临时文件，避免在这里引入 sqlite 依赖）
  const cookieFile = process.argv[2];
  const cookie = fs.readFileSync(cookieFile, 'utf8').trim();
  if (!cookie) throw new Error('没有读到 nexusmods_session');

  const fileId = Number(process.argv[3] || 12834);
  const modId = Number(process.argv[4] || 1662);

  // 2) 站内下载弹层 → 拿 nxm 链接
  const popup = `https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=${fileId}&game_id=7804&nmm=1`;
  const r1 = await fetch(popup, { redirect: 'follow', headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'text/html' } });
  const html = await r1.text();
  console.log('弹层 HTTP', r1.status, ' 长度', html.length);
  const nxm = /nxm:\/\/[^\s"'<>]+/.exec(html);
  if (!nxm) {
    console.log('未在弹层里找到 nxm 链接。片段：');
    console.log(html.slice(0, 800));
    return;
  }
  const nxmUrl = nxm[0].replace(/&amp;/g, '&');
  console.log('nxm:', nxmUrl.replace(/key=[^&]+/, 'key=***'));

  const m = /^nxm:\/\/([^/]+)\/mods\/(\d+)\/files\/(\d+)\?(.*)$/.exec(nxmUrl);
  const q = new URLSearchParams(m[4]);
  const key = q.get('key'), expires = q.get('expires');

  // 3) 换直链
  const api = `https://api.nexusmods.com/v1/games/${m[1]}/mods/${m[2]}/files/${m[3]}/download_link.json?key=${key}&expires=${expires}`;
  const r2 = await fetch(api, { headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json' } });
  const t2 = await r2.text();
  console.log('直链 API HTTP', r2.status);
  let links;
  try { links = JSON.parse(t2); } catch { console.log(t2.slice(0, 500)); return; }
  if (!Array.isArray(links) || !links.length) { console.log('无直链:', JSON.stringify(links).slice(0, 400)); return; }
  console.log('可用直链:', links.map(l => l.short_name || l.name));
  const uri = links[0].URI;

  // 4) 下载
  const out = path.join('D:/AI game/StarBladeModManager/.workbuddy/tmp', `atool-${fileId}.zip`);
  const r3 = await fetch(uri, { headers: { 'User-Agent': UA } });
  console.log('下载 HTTP', r3.status, r3.headers.get('content-length'));
  const buf = Buffer.from(await r3.arrayBuffer());
  fs.writeFileSync(out, buf);
  console.log('已保存:', out, (buf.length / 1048576).toFixed(2) + ' MB');
}
main().catch(e => console.log('FATAL', e.message));
