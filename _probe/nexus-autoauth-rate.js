'use strict';
/**
 * 诊断：连续请求 Nexus 站内下载弹层端点，看**第几次开始失败**、失败长什么样。
 *
 * 背景：批量自动授权实测只成功 6 条，第 7 条起就没了（35 条停在「等待授权」）。
 * 前 6 条能成，说明 cookie 是好的 —— 所以怀疑是**限速 / 频控**，
 * 而不是登录态问题。这里用真实会话按 900ms 间隔连打 12 次，逐次记录。
 *
 * 跑法：env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe _probe/nexus-autoauth-rate.js
 */

require('./_appctx');

const { app } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');

const GID = 7804;
const SITE = 'https://www.nexusmods.com';
const FILES = [8509, 7355, 3112, 7672, 6862, 13886, 7443, 7957, 4670, 5836, 11160, 7429];
const GAP = Number(process.env.GAP_MS || 900);

app.whenReady().then(async () => {
  const nexusAuth = require('../src/main/nexusAuth');
  const nexusAutoAuth = require('../src/main/nexusAutoAuth');
  const ses = nexusAuth.nexusSession();

  console.log('间隔 =', GAP, 'ms；共', FILES.length, '次');
  const ck = await ses.cookies.get({ name: 'nexusmods_session' });
  console.log('nexusmods_session cookie =', ck.length ? '在（' + String(ck[0].value || '').slice(0, 8) + '…）' : '无');

  let firstFail = -1;
  for (let i = 0; i < FILES.length; i++) {
    const fid = FILES[i];
    const url = SITE + '/Core/Libs/Common/Widgets/DownloadPopUp?id=' + fid + '&game_id=' + GID + '&nmm=1';
    const t0 = Date.now();
    try {
      const res = await ses.fetch(url, {
        headers: {
          'User-Agent': nexusAuth.cleanUA(),
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*; q=0.01',
          Referer: SITE + '/'
        }
      });
      const txt = await res.text();
      const p = nexusAutoAuth.parsePopup(txt);
      const flags = [
        /nxm:\/\//i.test(txt) ? 'HAS_NXM' : '',
        /please\s+log\s*in\s*or\s*sign\s*up/i.test(txt) ? 'NEED_LOGIN' : '',
        /just a moment|checking your browser|正在进行安全验证|请稍候|Ray ID/i.test(txt.slice(0, 4000)) ? 'CHALLENGE' : '',
        /too many|rate.?limit|slow down/i.test(txt) ? 'RATELIMIT' : ''
      ].filter(Boolean).join(',') || '-';
      console.log('#' + String(i + 1).padStart(2), 'file=' + fid,
        'status=' + res.status, 'len=' + txt.length, '[' + flags + ']',
        'parse=' + (p.ok ? 'ok' : p.code), (Date.now() - t0) + 'ms');
      if (!p.ok && firstFail < 0) firstFail = i + 1;
    } catch (e) {
      console.log('#' + String(i + 1).padStart(2), 'file=' + fid, 'ERR', e.message);
      if (firstFail < 0) firstFail = i + 1;
    }
    await new Promise(r => setTimeout(r, GAP));
  }

  console.log('===== 首次失败在第 ' + (firstFail < 0 ? '（无）' : firstFail) + ' 次 =====');
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
