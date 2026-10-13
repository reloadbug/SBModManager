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
