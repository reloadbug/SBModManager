'use strict';
/**
 * 实测探针：验证 src/main/nxm.js 的下载引擎（流式写盘 / 进度 / 取消）。
 *
 * 不依赖 Nexus 授权 —— 直接拿一个公开可达的小文件跑真实 HTTP 下载。
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe _probe/nxm-download.js
 */
const { app } = require('electron');
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

const TEST_URL = process.env.PROBE_URL || 'https://challenges.cloudflare.com/turnstile/v0/api.js';

const out = [];
const log = (...a) => { out.push(a.join(' ')); console.log(a.join(' ')); };

app.whenReady().then(async () => {
  const nxm = require('../src/main/nxm');
  const paths = require('../src/main/paths');
  paths.ensure();

  /* ---- 1. 正常下载 ---- */
  const dest = path.join(paths.TMP, 'probe-nxm-ok.bin');
  try { fs.unlinkSync(dest); } catch { /* 不存在 */ }

  const samples = [];
  log('== 下载 ' + TEST_URL);
  const t0 = Date.now();
  const r = await nxm.downloadToFile(TEST_URL, dest, {
    onProgress: (p) => {
      // 只留 4 个采样点，避免刷屏
      if (samples.length < 4) samples.push(p.percent + '% (' + p.received + '/' + p.total + ')');
    }
  });
  log('   结果: size=' + r.size + ' total=' + r.total + ' filename=' + JSON.stringify(r.filename));
  log('   进度采样: ' + samples.join(' | '));
  log('   文件存在: ' + fs.existsSync(dest) + '，磁盘大小=' + (fs.existsSync(dest) ? fs.statSync(dest).size : -1));
  log('   耗时 ' + (Date.now() - t0) + 'ms');
  try { fs.unlinkSync(dest); } catch { /* 忽略 */ }

  /* ---- 2. 取消下载：文件必须被清理 ---- */
  const dest2 = path.join(paths.TMP, 'probe-nxm-cancel.bin');
  try { fs.unlinkSync(dest2); } catch { /* 不存在 */ }

  let n = 0;
  log('== 取消测试');
  try {
    await nxm.downloadToFile(TEST_URL, dest2, {
      shouldCancel: () => { n++; return n >= 1; }   // 收到第 1 块就取消
    });
    log('   ❌ 未抛出取消异常（文件可能没被中断）');
  } catch (e) {
    log('   ✓ 抛出: ' + e.message);
  }
  log('   取消后残留文件: ' + fs.existsSync(dest2) + '（应为 false）');

  /* ---- 3. 解析器自检 ---- */
  log('== parseNxm');
  const p = nxm.parseNxm('nxm://stellarblade/mods/1496/files/13020?key=ABC&expires=123&user_id=42');
  log('   ' + JSON.stringify(p));
  log('   非法链接 → ' + JSON.stringify(nxm.parseNxm('nxm://bad')));
  log('   从 argv 提取 → ' + JSON.stringify(nxm.extractNxmFromArgv(['x.exe', '--foo', 'nxm://stellarblade/mods/1/files/2'])));
  log('   协议已注册: ' + nxm.isProtocolRegistered());

  const text = out.join('\n');
  fs.writeFileSync(path.join(__dirname, 'nxm-download-out.txt'), text, 'utf8');
  setTimeout(() => app.exit(0), 800);
});
