'use strict';

const assert = require('assert').strict;
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createImageCache, isAllowedImageUrl } = require('../src/main/imageCache');
const { collectModImages } = require('../src/main/nexus');

async function getLocalResponse(port, url) {
  const pathname = new URL(url).pathname;
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${pathname}`, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`local server returned ${response.statusCode}`));
          return;
        }
        resolve({ body: Buffer.concat(chunks), mime: response.headers['content-type'] || '' });
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'starblade-image-cache-'));
  const counts = new Map();
  const server = http.createServer((request, response) => {
    counts.set(request.url, (counts.get(request.url) || 0) + 1);
    if (request.url === '/ok') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    } else if (request.url === '/second') {
      response.writeHead(200, { 'Content-Type': 'image/webp' });
      response.end(Buffer.from('webp-image'));
    } else if (request.url === '/text') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('not an image');
    } else {
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('unavailable');
    }
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    const requestImage = url => getLocalResponse(port, url);
    const cache = createImageCache({ imagesDir: path.join(temporaryDirectory, 'images'), requestImage });

    const blockedUrls = [
      'not-a-url',
      'http://images.nexusmods.com/ok',
      'https://evilnexusmods.com/ok',
      'https://nexusmods.com.evil.test/ok',
      'https://example.com/ok'
    ];
    for (const url of blockedUrls) assert.equal(isAllowedImageUrl(url), false, url);
    assert.equal(isAllowedImageUrl('https://images.nexusmods.com/ok'), true);
    const blocked = await cache.cacheModImages(10, blockedUrls);
    assert.equal(blocked.length, blockedUrls.length);
    assert(blocked.every(result => result.error && result.url));
    assert.equal(counts.size, 0);

    const rejectedType = await cache.cacheModImages(10, ['https://images.nexusmods.com/text']);
    assert.match(rejectedType[0].error, /图片类型/);

    const firstUrl = 'https://images.nexusmods.com/ok';
    const secondUrl = 'https://cdn.nexus-cdn.com/second';
    const results = await cache.cacheModImages(123, [firstUrl, secondUrl, firstUrl]);
    assert.equal(results.length, 2);
    assert.equal(results[0].url, firstUrl);
    assert.equal(results[0].mime, 'image/png');
    assert.equal(results[0].size, 7);
    assert.equal(path.dirname(results[0].path), path.join(temporaryDirectory, 'images', '123'));
    assert(results[0].localUrl.startsWith('file://'));
    assert.deepEqual(await fs.promises.readFile(results[0].path), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    assert.equal(results[1].mime, 'image/webp');

    const repeated = await cache.cacheModImages(123, [firstUrl, secondUrl]);
    assert.equal(repeated[0].path, results[0].path);
    assert.equal(counts.get('/ok'), 1);
    assert.equal(counts.get('/second'), 1);

    const mixed = await cache.cacheModImages(123, [firstUrl, 'https://images.nexusmods.com/fail']);
    assert.equal(mixed.length, 2);
    assert.equal(mixed[0].path, results[0].path);
    assert(mixed[1].error);

    const images = collectModImages({
      pictureUrl: 'https://images.nexusmods.com/picture.jpg',
      thumbnailLargeUrl: 'https://images.nexusmods.com/large.jpg',
      thumbnailUrl: 'https://images.nexusmods.com/thumb.jpg'
    }, [
      '[img]https://images.nexusmods.com/description.jpg[/img]',
      '[img]https://images.nexusmods.com/picture.jpg[/img]',
      '[img]http://images.nexusmods.com/insecure.jpg[/img]',
      '[img]javascript:alert(1)[/img]',
      '[img]https://images.nexusmods.com/other.png[/img]'
    ].join('\n'));
    assert.deepEqual(images, [
      'https://images.nexusmods.com/picture.jpg',
      'https://images.nexusmods.com/large.jpg',
      'https://images.nexusmods.com/thumb.jpg',
      'https://images.nexusmods.com/description.jpg',
      'https://images.nexusmods.com/other.png'
    ]);

    // ---- 0.4.9：已经落盘的图能直接从磁盘列出来（listCached），且不带任何网络请求 ----
    // 用户 2026-11-09：「已经显示的图集要保存到本地……已经缓存了图片的就不要再下载一次了」
    const callsBeforeList = counts.get('/ok') || 0;
    const onDisk = await cache.listCached(123);
    assert.equal(onDisk.length, 2, 'mod 123 应该列出两张已缓存的图');
    assert.deepEqual(onDisk.map(x => x.path).sort(), [results[0].path, results[1].path].sort());
    assert(onDisk.every(x => x.localUrl.startsWith('file://') && x.size > 0), '都带 file:// 地址与大小');
    assert(onDisk.every(x => typeof x.at === 'number' && x.at > 0), '都带文件时间（用于稳定排序）');
    assert.deepEqual(onDisk.map(x => x.url).sort(), [firstUrl, secondUrl].sort(), '元数据里记下了原始网址');
    assert.equal(counts.get('/ok') || 0, callsBeforeList, 'listCached 不许发网络请求');

    // 元数据文件里确实写了 url（别的脚本也能靠它还原「这个 mod 存过哪几张图」）
    const metadataFile = results[0].path.replace(/\.png$/, '.json');
    assert.equal(JSON.parse(await fs.promises.readFile(metadataFile, 'utf8')).url, firstUrl);

    assert.deepEqual(await cache.listCached(999), [], '没缓存过的 mod 返回空数组');
    assert.deepEqual(await cache.listCached('abc'), [], '非法 Mod ID 返回空数组');
    assert.deepEqual(await cache.listCached(), [], '不传参数也不炸');

    // ---- 接线：主进程磁盘优先 + 新通道 + preload + 渲染层两段式 ----
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const ipcSource = read('src/main/ipc.js');
    assert.match(ipcSource, /local = await imageCache\(\)\.listCached\(id\)/, 'imagesForMod 先问磁盘');
    assert.match(ipcSource, /if \(local\.length && !opts\.force\) return shape\(local\);/, '磁盘上有就不再联网');
    assert.match(ipcSource, /handle\('mod:imagesDisk'/, '新增 mod:imagesDisk 通道');
    const preloadSource = read('src/preload/index.js');
    assert.match(preloadSource, /modImagesDisk: modId => invoke\('mod:imagesDisk', modId\)/, 'preload 暴露 modImagesDisk');
    const rendererSource = read('src/renderer/app.js');
    assert.match(rendererSource, /window\.api\.modImagesDisk\(modId\)/, 'fillGallery 先读本地');
    assert.match(rendererSource, /if \(local && local\.length\) \{/, '本地有图就直接画，不转 spinner');

    console.log('image cache tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
