'use strict';
/*
 * 注入脚本自检：用本地 DOM 夹具验证「安装助手」的分步高亮逻辑。
 *
 * 为什么需要它 —— 真实 Nexus 的下载按钮只有在**登录后**才会出现，自检环境没有
 * 登录会话。所以这里用假页面覆盖那几条分支：
 *
 *   1. Files 页有 `Manual download`     → 第 1 步，高亮它
 *   2. 只有 `Mod Manager Download`      → 备选通路，也高亮
 *   3. 下一页有 `Slow download`         → 第 2 步，高亮它（带倒计时提示）
 *   4. 多文件时按 fileId 精确命中目标行
 *   5. 一个按钮都没有 + 有 Log in 链接  → 提示先登录
 *   6. 什么都没有且不像未登录           → 提示等待加载
 *   7. 落在描述页（无按钮、无登录信号） → 自动切一次 Files 标签
 *   8. 幂等：反复 tick 不重复插入 banner、不抖动 class
 *
 * 运行：npm run test:inject
 *      （等价于 env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron _probe/nexus-inject-test.js）
 */
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
for (const s of ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu']) {
  try { app.commandLine.appendSwitch(s.replace(/^--/, ''), ''); } catch { /* 忽略 */ }
}

const { buildInjectScript, looksLikeDownload, safeFileName } = require('../src/main/nexusBrowser');

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

const TARGET_FILE = 13020;

/* ---------------- DOM 夹具 ---------------- */

/** Files 页：每个文件一行，带可选的 Mod Manager / Manual download 按钮 */
function filesPage(files, { loginLinks = false, mm = true, manual = true } = {}) {
  const rows = files.map(f => `
    <li data-fileid="${f.id}">
      <span class="fname">${f.name}</span>
      <span class="ver">${f.version}</span>
      ${mm ? '<a class="mm" href="#">Mod Manager Download</a>' : ''}
      ${manual ? '<a class="manual" href="#">Manual download</a>' : ''}
    </li>`).join('');

  const header = loginLinks
    ? `<a href="https://users.nexusmods.com/auth/sign_in">Log in</a><a href="/auth/sign_in">Log in</a>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Files</title></head>
  <body>
    <header id="hd">${header}<a href="/users/someone">Member</a></header>
    <main id="mainContent">
      <h1>CNS - Custom Nanosuit System</h1>
      <ul id="filelist">${rows}</ul>
    </main>
  </body></html>`;
}

/** 点完 Manual download 之后出现的那一页：一个 Slow download 按钮 */
function slowPage({ countdown = 0 } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Download</title></head>
  <body>
    <main id="mainContent">
      <h1>Download: CustomNanosuitSystem</h1>
      ${countdown ? `<p>Your download will begin in ${countdown} seconds</p>` : ''}
      <a class="slow" href="#">Slow download</a>
      <a class="fast" href="#">Fast download</a>
    </main>
  </body></html>`;
}

/** 完全没有下载按钮的页面 */
function noButtons({ loginLinks = false, filesTab = false } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head>
  <body>
    <header>${loginLinks ? '<a href="/auth/sign_in">Log in</a>' : ''}</header>
    <main id="mainContent">
      <h1>Loading…</h1>
      ${filesTab ? '<a class="tab" href="#">Files</a>' : ''}
    </main>
  </body></html>`;
}

const READ = `(() => {
  const b = document.getElementById('sbmm-banner');
  return {
    banners: document.querySelectorAll('#sbmm-banner').length,
    banner: b ? String(b.innerText || '').replace(/\\s+/g, ' ').trim() : null,
    hl: [...document.querySelectorAll('.sbmm-hl')].map(e => String(e.innerText || '').replace(/\\s+/g, ' ').trim()),
    hlCount: document.querySelectorAll('.sbmm-hl').length,
    rowCount: document.querySelectorAll('.sbmm-row').length,
    tabClicked: !!window.__sbmmTabClicked
  };
})()`;

async function run(w, html, script) {
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await w.webContents.executeJavaScript(script);
  return w.webContents.executeJavaScript(READ);
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });

  const script = buildInjectScript({ fileId: TARGET_FILE, hint: 'CustomNanosuitSystem v2.2' });

  /* ---- 1) Files 页：Manual download 优先于 Mod Manager Download ---- */
  console.log('\n=== 1) Files 页 → 第 1 步高亮 Manual download ===');
  let r = await run(w, filesPage([
    { id: 13020, name: 'CustomNanosuitSystem', version: '2.2' },
    { id: 7499, name: 'SkinSuit Example', version: '1.6' }
  ]), script);
  t('恰好高亮 1 个按钮', () => r.hlCount === 1 ? true : '实际 ' + r.hlCount);
  t('高亮的是 Manual download（不是 Mod Manager）', () =>
    r.hl[0] === 'Manual download' ? true : JSON.stringify(r.hl));
  t('目标行被打上 sbmm-row', () => r.rowCount > 0 ? true : '没有 sbmm-row');
  t('banner 标出「第 1 步」', () => /第 1 步/.test(r.banner || '') ? true : r.banner);
  t('banner 提到 Manual download', () => /Manual download/.test(r.banner || '') ? true : r.banner);
  t('banner 带上文件名', () => /CustomNanosuitSystem v2.2/.test(r.banner || '') ? true : r.banner);
  t('banner 预告下一页点 Slow download', () => /Slow download/.test(r.banner || '') ? true : r.banner);
  t('只插入 1 个 banner', () => r.banners === 1 ? true : r.banners + ' 个');

  /* ---- 2) 只有 file_id 链接、没有 data-fileid 时仍能精确命中 ---- */
  console.log('\n=== 2) 退化成 file_id 链接定位 ===');
  const html2 = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="mainContent"><ul>
      <li><a href="/mods/1496?tab=files&file_id=13020">CustomNanosuitSystem</a>
          <a href="#">Manual download</a></li>
      <li><a href="/mods/1496?tab=files&file_id=7499">Example</a>
          <a href="#">Manual download</a></li>
    </ul></main></body></html>`;
  r = await run(w, html2, script);
  t('仍然只高亮 1 个', () => r.hlCount === 1 ? true : '实际 ' + r.hlCount);
  t('banner 标出「第 1 步」', () => /第 1 步/.test(r.banner || '') ? true : r.banner);

  /* ---- 3) 没有 Manual download 时退到 Mod Manager Download ---- */
  console.log('\n=== 3) 只有 Mod Manager Download → 备选通路 ===');
  r = await run(w, filesPage([{ id: 13020, name: 'CustomNanosuitSystem', version: '2.2' }], { manual: false }), script);
  t('高亮 Mod Manager Download', () => r.hl[0] === 'Mod Manager Download' ? true : JSON.stringify(r.hl));
  t('banner 说明这是备选通路', () => /也可以/.test(r.banner || '') ? true : r.banner);

  /* ---- 4) 第 2 步：Slow download ---- */
  console.log('\n=== 4) 下一页 → 第 2 步高亮 Slow download ===');
  r = await run(w, slowPage(), script);
  t('高亮 Slow download', () => r.hl[0] === 'Slow download' ? true : JSON.stringify(r.hl));
  t('banner 标出「最后一步」', () => /最后一步/.test(r.banner || '') ? true : r.banner);
  t('banner 说明下载会被接管', () => /自动接管/.test(r.banner || '') ? true : r.banner);

  console.log('\n=== 5) 倒计时期间给出剩余秒数 ===');
  r = await run(w, slowPage({ countdown: 5 }), script);
  t('高亮仍然是 Slow download', () => r.hl[0] === 'Slow download' ? true : JSON.stringify(r.hl));
  t('banner 提示等倒计时', () => /等倒计时/.test(r.banner || '') ? true : r.banner);
  t('banner 带上秒数 5', () => /\b5\b/.test(r.banner || '') ? true : r.banner);

  /* ---- 6) 多文件 + 找不到目标 → 高亮全部 Manual（不能瞎挑一个） ---- */
  console.log('\n=== 6) 找不到目标 fileId → 高亮全部 Manual download ===');
  r = await run(w, filesPage([
    { id: 9001, name: 'Other A', version: '1.0' },
    { id: 9002, name: 'Other B', version: '1.0' }
  ]), script);
  t('两个 Manual download 都被高亮', () => r.hlCount === 2 ? true : '实际 ' + r.hlCount);
  t('高亮的都是 Manual download', () =>
    r.hl.every(x => x === 'Manual download') ? true : JSON.stringify(r.hl));
  t('banner 提示自己找对文件', () => /没能定位到|自己找对文件/.test(r.banner || '') ? true : r.banner);
  t('banner 不带 sbmm-row 误标', () => r.rowCount === 0 ? true : '标了 ' + r.rowCount + ' 行');

  /* ---- 7) 未登录 ---- */
  console.log('\n=== 7) 未登录 → 提示先登录 ===');
  r = await run(w, noButtons({ loginLinks: true }), script);
  t('提示请先登录 Nexus', () => /请先登录 Nexus/.test(r.banner || '') ? true : r.banner);
  t('没有误加高亮', () => r.hlCount === 0 ? true : '误高亮 ' + r.hlCount);

  /* ---- 8) 已登录但按钮还没渲染 ---- */
  console.log('\n=== 8) 已登录、按钮未渲染 → 等待加载 ===');
  r = await run(w, noButtons({ loginLinks: false }), script);
  t('提示正在等待页面加载', () => /正在等待页面加载/.test(r.banner || '') ? true : r.banner);

  /* ---- 9) 落在描述页 → 自动切一次 Files 标签 ---- */
  console.log('\n=== 9) 落在描述页 → 自动切 Files 标签 ===');
  r = await run(w, noButtons({ filesTab: true }), script);
  t('点过 Files 标签', () => r.tabClicked === true ? true : '没有点');
  t('banner 说明正在切标签', () => /切到 Files/.test(r.banner || '') ? true : r.banner);

  /* ---- 10) 幂等性 ---- */
  console.log('\n=== 10) 幂等性（反复 tick 不抖动） ===');
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(filesPage([
    { id: 13020, name: 'CustomNanosuitSystem', version: '2.2' }
  ])));
  await w.webContents.executeJavaScript(script);
  const before = await w.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.sbmm-hl');
    el.dataset.probe = 'kept';
    return document.querySelectorAll('.sbmm-hl').length;
  })()`);
  // 再跑 5 次（模拟 setInterval 反复执行）
  for (let i = 0; i < 5; i++) {
    await w.webContents.executeJavaScript(script);
    await new Promise(res => setTimeout(res, 60));
  }
  const after = await w.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.sbmm-hl');
    return {
      hlCount: document.querySelectorAll('.sbmm-hl').length,
      banners: document.querySelectorAll('#sbmm-banner').length,
      kept: el ? el.dataset.probe === 'kept' : false
    };
  })()`);
  t('高亮数量不变', () => after.hlCount === before ? true : before + ' → ' + after.hlCount);
  t('banner 没有重复插入', () => after.banners === 1 ? true : after.banners + ' 个');
  t('高亮元素没有被替换（class 未抖动）', () => after.kept === true ? true : '元素被重建了');

  /* ---- 11) 下载地址识别（决定要不要拉回本会话接管） ---- */
  console.log('\n=== 11) 下载地址识别 ===');
  t('识别 .zip', () => looksLikeDownload('https://x/y/CustomNanosuitSystem-1496-2-2.zip') === true);
  t('识别 .7z（带 query）', () => looksLikeDownload('https://x/y/mod.7z?token=1') === true);
  t('识别 nexus-cdn 主机', () => looksLikeDownload('https://files.nexus-cdn.com/abc/def') === true);
  t('普通页面不算下载', () => looksLikeDownload('https://www.nexusmods.com/stellarblade/mods/1496?tab=files') === false);
  t('nxm:// 不算 http 下载', () => looksLikeDownload('nxm://stellarblade/mods/1496/files/13020') === false);

  console.log('\n=== 12) 下载文件名净化 ===');
  t('路径分隔符被抹掉、不越界', () => {
    const r = safeFileName('..\\..\\evil.zip');
    return (!/[\\/]/.test(r) && r.endsWith('evil.zip')) ? true : r;
  });
  t('空值有兜底', () => safeFileName('') === 'download.bin' ? true : safeFileName(''));

  /* ---- 13) Cloudflare 人机验证页：优先于「未登录」提示 ---- */
  console.log('\n=== 13) Cloudflare 挑战页 → 提示被拦住（含重新加载按钮） ===');
  // 模拟 Cloudflare 拦截页：正文「正在验证您是否是真人 / 请稍候」，
  // 但页面骨架里**也残留**一个 Log in 链接 —— 用来验证挑战判定先于登录判定，
  // 不会被误导成「请先登录」。
  const challengeHtml = `<!doctype html><html><head><meta charset="utf-8"><title>请稍候…</title></head>
  <body>
    <header><a href="/auth/sign_in">Log in</a></header>
    <main id="mainContent">
      <h1>正在验证您是否是真人</h1>
      <p>请稍候，正在检查您的浏览器…</p>
    </main>
  </body></html>`;
  // 13a) 挑战页（含登录链接）→ 必须报 Cloudflare，不能报登录
  r = await run(w, challengeHtml, script);
  const challengeTone = await w.webContents.executeJavaScript(
    '(() => { const b=document.getElementById("sbmm-banner"); return b?b.dataset.tone:null; })()');
  t('识别为被 Cloudflare 拦住', () =>
    /Cloudflare/.test(r.banner || '') ? true : 'banner=' + r.banner);
  t('横幅为错误色调（err）', () => challengeTone === 'err' ? true : 'tone=' + challengeTone);
  t('banner 带「重新加载」按钮', () =>
    /重新加载/.test(r.banner || '') ? true : 'banner=' + r.banner);
  t('没有误报「请先登录 Nexus」', () =>
    !/请先登录 Nexus/.test(r.banner || '') ? true : '误报登录=' + r.banner);
  t('挑战页不误加高亮', () => r.hlCount === 0 ? true : '误高亮 ' + r.hlCount);
  // 13b) 纯挑战页（无登录链接、无按钮）→ 同样报 Cloudflare
  r = await run(w, `<!doctype html><html><head><meta charset="utf-8"><title>请稍候…</title></head>
  <body><main id="mainContent"><h1>Just a moment…</h1><p>Checking your browser before accessing Nexus Mods.</p></main></body></html>`, script);
  t('英文挑战页也被识别', () =>
    /Cloudflare/.test(r.banner || '') ? true : 'banner=' + r.banner);

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  app.exit(fail ? 1 : 0);
}).catch(e => { console.error('FATAL', e); app.exit(1); });
