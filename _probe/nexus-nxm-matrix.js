'use strict';
/*
 * 探针：**不渲染页面、不点鼠标**，用已登录会话直接拿到 nxm 链接的可行性与稳定性。
 *
 * 背景：免费账号每次下载都要网站现签一个带 key/expires 的 nxm 链接。
 * 网站自己的 JS 点「Mod Manager Download」时调的是站内弹层端点，
 * 所以理论上「带会话 cookie 直接请求它」等价于用户点那一下。
 *
 * 本探针跑一个请求矩阵 × 每项 3 次，统计命中率与 nxm 出现位置，
 * 用来判断能不能把它做成「一键全部授权」的主通路。
 *
 * 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron _probe/nexus-nxm-matrix.js 1461 8509
 */
require('./_appctx');
const { app, session } = require('electron');

// 🔴 本机 GPU 进程不可用：不加这些开关 Electron 直接
//    `FATAL: GPU process isn't usable. Goodbye.`（退出码 3，一行结果都没有）
app.disableHardwareAcceleration();
for (const s of ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu']) {
  try { app.commandLine.appendSwitch(s.replace(/^--/, ''), ''); } catch { /* 忽略 */ }
}

const nexusAuth = require('../src/main/nexusAuth');

const MOD = Number(process.argv[2] || 1461);
const FILE = Number(process.argv[3] || 8509);
const GAME_ID = 7804;
const REPEAT = 3;

const UA = (() => {
  const raw = app.userAgentFallback || '';
  const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
})();

const SITE = 'https://www.nexusmods.com';

const VARIANTS = [
  {
    name: 'DownloadPopUp 无参',
    url: `${SITE}/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}`,
    headers: {}
  },
  {
    name: 'DownloadPopUp nmm=1',
    url: `${SITE}/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}&nmm=1`,
    headers: {}
  },
  {
    name: 'DownloadPopUp nmm=1 + XHR',
    url: `${SITE}/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}&nmm=1`,
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, */*; q=0.01' }
  },
  {
    name: 'DownloadPopUp nmm=1 + XHR + Referer',
    url: `${SITE}/Core/Libs/Common/Widgets/DownloadPopUp?id=${FILE}&game_id=${GAME_ID}&nmm=1`,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, */*; q=0.01',
      Referer: `${SITE}/stellarblade/mods/${MOD}?tab=files`
    }
  },
  {
    name: 'mod 页（?tab=files&file_id=）',
    url: `${SITE}/stellarblade/mods/${MOD}?tab=files&file_id=${FILE}`,
    headers: {}
  }
];

function findNxm(text) {
  const m = text.match(/nxm:\/\/[^"'\s<>\\]+/i);
  if (!m) return null;
  return m[0].replace(/&amp;/g, '&');
}

async function one(v) {
  const ses = session.fromPartition(nexusAuth.PARTITION);
  try {
    const res = await ses.fetch(v.url, { headers: { 'User-Agent': UA, ...v.headers } });
    const text = await res.text();
    const nxm = findNxm(text);
    const cf = /Just a moment|cf-browser-verification|正在进行安全验证/i.test(text.slice(0, 3000));
    return { status: res.status, len: text.length, nxm, cf };
  } catch (e) {
    return { status: 0, len: 0, nxm: null, cf: false, err: e.message };
  }
}

app.whenReady().then(async () => {
  nexusAuth.nexusSession();
  const st = await nexusAuth.getStatus().catch(() => ({}));
  console.log('userData = ' + app.getPath('userData'));
  console.log('loggedIn=' + st.loggedIn + ' user=' + (st.user || '-'));
  console.log('目标 mod=' + MOD + ' file=' + FILE + ' · 每项 ' + REPEAT + ' 次\n');

  const summary = [];
  for (const v of VARIANTS) {
    const rows = [];
    for (let i = 0; i < REPEAT; i++) {
      const r = await one(v);
      rows.push(r);
      console.log('  ' + v.name.padEnd(34) + '#' + (i + 1) +
        '  HTTP ' + String(r.status).padEnd(4) +
        ' len=' + String(r.len).padEnd(7) +
        (r.cf ? ' [Cloudflare]' : '') +
        (r.nxm ? '  ✅ nxm' : '  —'));
      if (r.nxm && i === 0) console.log('        ' + r.nxm.slice(0, 150));
      await new Promise(r2 => setTimeout(r2, 1500));
    }
    const ok = rows.filter(r => r.nxm).length;
    summary.push({ 变体: v.name, 命中: ok + '/' + REPEAT, 状态: rows.map(r => r.status).join(','), CF: rows.filter(r => r.cf).length });
    console.log('');
  }

  console.log('===== 汇总 =====');
  console.table(summary);
  app.exit(0);
}).catch(e => { console.error('探针失败:', e); app.exit(1); });
