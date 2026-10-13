'use strict';

/**
 * 端到端探针：真实抓一次 Nexus mod 页图集 → 归并 → 缓存到本地 → 报告磁盘结果。
 *
 * 验的是用户报的那件事：
 *   「截图里 44 张图，系统里却只留下 1 张图的 3 个不同尺寸」
 *
 * 跑法（必须 env -u ELECTRON_RUN_AS_NODE）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/gallery-e2e.js --mod=692
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe/gallery-e2e.js --mod=692,1252
 */

const { app, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = '剑星 Mod 管理器';
const PARTITION = 'persist:nexus';      // 与登录窗口共用同一个分区（共享登录态 / Cloudflare 放行记录）

app.setName(APP_NAME);
app.setPath('userData', path.join(process.env.APPDATA || '', APP_NAME));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// 抹掉 Electron 标记，否则 Cloudflare Turnstile 会拒绝
(function cleanUA() {
  const raw = app.userAgentFallback || '';
  const chrome = (raw.match(/Chrome\/([\d.]+)/) || [])[1] || '131.0.0.0';
  app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
  try {
    session.fromPartition(PARTITION).setUserAgent(app.userAgentFallback);
  } catch { /* 首次可能还没有分区，忽略 */ }
})();

process.on('uncaughtException', e => console.error('UNCAUGHT: ' + (e && e.stack || e)));
process.on('unhandledRejection', e => console.error('UNHANDLED: ' + (e && e.stack || e)));

const { createGalleryFetcher } = require('../src/main/nexusGallery');
const { createImageCache, imageKey, DEFAULT_IMAGE_LIMIT } = require('../src/main/imageCache');

const modsArg = (process.argv.find(a => /^--mods?=/.test(a)) || '--mod=692').split('=')[1];
const MOD_IDS = String(modsArg).split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gallery-e2e-'));
const galleryDir = path.join(tmpRoot, 'gallery');
const imagesDir = path.join(tmpRoot, 'images');

function listImageFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|ico)$/i.test(f)); }
  catch { return []; }
}

(async () => {
  // 必须等 app ready —— loadGalleryHtml 里要 new BrowserWindow
  if (!app.isReady()) await app.whenReady();
  const gallery = createGalleryFetcher({ cacheDir: galleryDir, logger: console });
  const cache = createImageCache({ imagesDir });

  const report = [];
  for (const modId of MOD_IDS) {
    console.log('\n===== mod ' + modId + ' =====');
    const t0 = Date.now();
    const items = await gallery.getImages(modId, { force: true });
    console.log('图集 URL（归一去重后）: ' + items.length + ' 张，耗时 ' + (Date.now() - t0) + 'ms');
    if (!items.length) {
      report.push({ modId, gallery: 0, cached: 0, note: '没抓到（可能被 Cloudflare 拦住或该 mod 没有图集）' });
      continue;
    }
    for (const it of items) console.log('   · ' + it.url);

    const urls = items.map(x => x.url);
    const identities = new Set(urls.map(u => imageKey(u)));
    console.log('其中不同图片: ' + identities.size + '（' + urls.length + ' 个 URL）');

    console.log('开始缓存 ' + urls.length + ' 张…');
    const cached = await cache.cacheModImages(modId, urls);
    console.log('缓存调用返回');
    const ok = cached.filter(x => x && x.localUrl);
    const bad = cached.filter(x => !x || !x.localUrl);
    console.log('缓存成功: ' + ok.length + ' / 失败: ' + bad.length);
    if (bad.length) console.log('   ✗ ' + bad.map(x => (x && x.url || '?') + ' → ' + (x && x.error)).join('\n   ✗ '));

    const files = listImageFiles(path.join(imagesDir, String(modId)));
    console.log('磁盘文件: ' + files.length + ' 个 → ' + files.map(f => f.split('.')[0].slice(0, 10) + '….' + path.extname(f)).join(', '));

    // 反查：磁盘上的字节是否两两不同（同一张图不同尺寸会被 imageKey 归并，不应出现 3 份）
    const sizes = ok.map(x => x.size);
    const sameSize = sizes.length - new Set(sizes).size;
    console.log('同样大小的文件数（>0 说明有重复下载）: ' + sameSize);

    report.push({
      modId,
      gallery: items.length,
      unique: identities.size,
      cached: ok.length,
      onDisk: files.length,
      overLimit: identities.size > DEFAULT_IMAGE_LIMIT
    });
  }

  console.log('\n===== 结论 =====');
  for (const r of report) console.log(JSON.stringify(r));
  const good = report.filter(r => r.cached === r.unique && r.onDisk === r.cached && !r.overLimit);
  console.log(good.length === report.length ? '\nGALLERY E2E PASS' : '\nGALLERY E2E CHECK ABOVE');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  app.exit(0);
})().catch(e => {
  console.error('GALLERY E2E ERROR: ' + (e && e.stack || e));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  app.exit(1);
});
