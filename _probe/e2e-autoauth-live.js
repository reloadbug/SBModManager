'use strict';
/**
 * 端到端实测：在**正式应用的 userData**（已登录的 persist:nexus 会话）里，
 * 用 nexusAutoAuth.fetchNxm 真去要一次 nxm 授权链接。
 *
 * 这是「免点击授权」这条路唯一还没被真实环境验证过的环节 ——
 * 离线断言只证明了「给我一段弹层 HTML，我能把 key 抠出来」，
 * 证明不了「带着真实会话 cookie 去问，Nexus 真的会给」。
 *
 * 跑法：node _probe/launch.js _probe/e2e-autoauth-live.js
 */

require('./_appctx'); // ⚠️ 必须第一行：把 userData 指到正式应用那一份

const { app } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.whenReady().then(async () => {
  const nexusAuth = require('../src/main/nexusAuth');
  const nexusAutoAuth = require('../src/main/nexusAutoAuth');

  const out = [];
  const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

  try {
    say('userData =', app.getPath('userData'));

    const ses = nexusAuth.nexusSession();
    const cookies = await ses.cookies.get({ domain: 'nexusmods.com' });
    const names = cookies.map(c => c.name).sort();
    say('cookie 数 =', cookies.length);
    say('cookie 名 =', names.join(', ') || '(空)');

    // 首页探一下登录态（不看渲染，只看文本里的信号）
    try {
      const res = await ses.fetch('https://www.nexusmods.com/', {
        headers: { 'User-Agent': nexusAuth.cleanUA() }
      });
      const html = await res.text();
      const welcome = /Welcome back,\s*([^<]{1,40})/i.exec(html);
      const hasSignIn = /href\s*=\s*["'][^"']*sign_in/i.test(html);
      const challenge = new RegExp(nexusAuth.CHALLENGE_RE, 'i').test(html.slice(0, 4000));
      say('首页 HTTP =', res.status,
        '| Welcome back =', welcome ? JSON.stringify(welcome[1].trim()) : 'no',
        '| 有 sign_in 链接 =', hasSignIn,
        '| 挑战页 =', challenge);
    } catch (e) {
      say('首页请求失败：', e && e.message);
    }

    // 拿队列里真实存在的 3 个文件来问
    const samples = [
      { modId: 1461, fileId: 8509, name: 'Shadow Kunoichi body stocking CNS' },
      { modId: 1393, fileId: 7355, name: 'YoRHafy - Motivation and Resonance' },
      { modId: 347, fileId: 3112, name: 'Nikke Cooling Suit Plus' }
    ];

    let okCount = 0;
    for (const s of samples) {
      const t0 = Date.now();
      const r = await nexusAutoAuth.fetchNxm({ game: 'stellarblade', modId: s.modId, fileId: s.fileId });
      const ms = Date.now() - t0;
      if (r.ok) {
        okCount++;
        const info = r.info || {};
        say('  ✓', s.modId + '/' + s.fileId, ms + 'ms',
          '| key=' + String(info.key || '').slice(0, 12) + '…',
          '| expires=' + info.expires,
          '| fileName=' + JSON.stringify(r.fileName || ''));
      } else {
        say('  ✗', s.modId + '/' + s.fileId, ms + 'ms',
          '| code=' + r.code, '|', nexusAutoAuth.humanize(r.code, r.reason));
      }
      await sleep(1200); // 像人一样慢慢点
    }

    say('===== 结果：' + okCount + '/' + samples.length + ' 命中 =====');
  } catch (e) {
    console.error('探针异常：', e && e.stack || e);
    say('探针异常：' + (e && e.message));
  }

  app.exit(0);
}).catch(e => { console.error('whenReady 异常', e); app.exit(1); });
