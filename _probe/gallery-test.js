'use strict';

/**
 * nexusGallery 测试（纯 Node，不碰网络、不开真窗口）。
 *
 * 覆盖三块：
 *   1. HTML 解析纯函数 —— 属性顺序无关、实体解码、按「图片身份」去重
 *   2. createGalleryFetcher 的缓存 / TTL / 失败冷却 / 永不抛
 *   3. 串行化 —— 隐藏窗口一次只开一个
 */

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createGalleryFetcher,
  parseGalleryHtml,
  galleryPageUrl,
  attrValue,
  decodeEntities,
  DEFAULT_LIMIT,
  DEFAULT_TTL_MS,
  FAIL_COOLDOWN_MS
} = require('../src/main/nexusGallery');

const BASE = 'https://staticdelivery.nexusmods.com/mods/7804/images';

/** 按 Nexus 实测形态构造的图集 HTML（同一张图同时给大图和缩略图两份节点） */
function galleryHtml(items) {
  const lis = items.map(it => `<li class="thumb" data-src="${it.src}" data-exthumbimage="${it.thumb || it.src}" data-sub-html="${it.caption || ''}" id="top-thumb-${it.id}"><a><img src="${it.thumb || it.src}"></a></li>`);
  return `<ul class="thumbgallery gallery clearfix">${lis.join('')}</ul>`;
}

/** 同一 URL 的三份做法沿用 imageCache 的实测形态：文件名完全相同 */
const SIZED = [
  BASE + '/1252/1252-1754156417-180528799.png',
  BASE + '/thumbnails/1252/1252-1754156417-180528799.png',
  'https://images.nexusmods.com/mod-images/7804/t/large/12/1252/1252-1754156417-180528799.png'
];

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starblade-gallery-'));

  /* ---------- 1. 纯函数 ---------- */

  assert.equal(galleryPageUrl(1252), 'https://www.nexusmods.com/stellarblade/mods/1252?tab=images');
  assert.equal(galleryPageUrl(0), 'https://www.nexusmods.com/stellarblade/mods/0?tab=images');

  assert.equal(decodeEntities('a&amp;b&lt;c&gt;d&quot;e&#39;f&apos;g&nbsp;h'), 'a&b<c>d"e\'f\'g h');
  assert.equal(decodeEntities(null), '');

  // 属性顺序无关：data-src 在 class 前面也要能取到
  assert.equal(attrValue('data-src="https://x/y.png" class="thumb"', 'data-src'), 'https://x/y.png');
  assert.equal(attrValue('data-src=\'https://x/y.png\' class="thumb"', 'data-src'), 'https://x/y.png');
  assert.equal(attrValue('class="thumb" data-src="https://x/y.png"', 'data-src'), 'https://x/y.png');
  assert.equal(attrValue('class="thumb"', 'data-src'), '');
  assert.equal(attrValue(null, 'data-src'), '');
  // \b 边界：不能把 data-exthumbimage 当成 data-src 的前缀
  assert.equal(attrValue('data-exthumbimage="https://a/t.png"', 'data-src'), '');

  // 空 / 无 thumb li
  assert.deepEqual(parseGalleryHtml(''), []);
  assert.deepEqual(parseGalleryHtml(null), []);
  assert.deepEqual(parseGalleryHtml('<ul class="thumbgallery"></ul>'), []);
  assert.deepEqual(parseGalleryHtml('<ul class="thumbgallery"><li class="ad">x</li></ul>'), []);

  // 正常解析：顺序、URL、caption
  const normal = parseGalleryHtml(galleryHtml([
    { id: 1, src: BASE + '/1/a.png', caption: '第一张&lt;b&gt;图&lt;/b&gt;' },
    { id: 2, src: BASE + '/2/b.png', caption: 'second' },
    { id: 3, src: BASE + '/3/c.png' }
  ]));
  assert.equal(normal.length, 3);
  assert.equal(normal[0].url, BASE + '/1/a.png');
  assert.equal(normal[0].caption, '第一张<b>图</b>');
  assert.equal(normal[2].url, BASE + '/3/c.png');

  // 🔴 关键回归：同一张图的多个尺寸只算一张（用户报的「只保留了 1 张图的 3 个尺寸」）
  const sized = parseGalleryHtml(galleryHtml([
    { id: 1, src: SIZED[0] },
    { id: 2, src: SIZED[1] },
    { id: 3, src: SIZED[2] }
  ]));
  assert.equal(sized.length, 1, '3 个尺寸应归并成 1 张');
  assert.equal(sized[0].url, SIZED[0], '保留出现顺序里的第一份');

  // 混排：4 张不同 + 1 张尺寸重复 → 4 张（第 3、4 项是同一张图的两个尺寸）
  const mixed = parseGalleryHtml(galleryHtml([
    { id: 1, src: BASE + '/1/a.png' },
    { id: 2, src: BASE + '/2/b.png' },
    { id: 3, src: SIZED[0] },
    { id: 4, src: SIZED[1] },
    { id: 5, src: BASE + '/3/c.png' }
  ]));
  assert.equal(mixed.length, 4);

  // 缺 data-src 的节点跳过
  const noSrc = parseGalleryHtml('<ul class="thumbgallery"><li class="thumb" data-exthumbimage="https://a/t.png"></li><li class="thumb" data-src="https://s/b.png"></li></ul>');
  assert.equal(noSrc.length, 1);
  assert.equal(noSrc[0].url, 'https://s/b.png');

  console.log('  ✓ galleryPageUrl / decodeEntities / attrValue / isThumbLi / parseGalleryHtml');

  /* ---------- 2. createGalleryFetcher ---------- */

  let clock = 1700000000000;
  const now = () => clock;
  const logs = [];
  const logger = { info: (m, e) => logs.push([m, e]) };

  function makeFetcher(loadHtml, extra = {}) {
    return createGalleryFetcher({
      cacheDir: path.join(root, 'cache-' + Math.random().toString(36).slice(2)),
      loadHtml,
      now,
      logger,
      ...extra
    });
  }

  // 2.1 抓得到 → 落盘 + 返回（超 limit 截断）
  (async () => {
    const items = [];
    for (let i = 1; i <= 9; i++) items.push({ id: i, src: BASE + '/9/' + i + '.png' });
    let calls = 0;
    const f = makeFetcher(async () => { calls++; return { ok: true, html: galleryHtml(items), count: 9 }; }, { limit: 5 });
    const got = await f.getImages(1252);
    assert.equal(calls, 1);
    assert.equal(got.length, 5, '默认 limit=5 应截断');
    assert.equal(got[0].url, BASE + '/9/1.png');
    // 缓存文件写进去了
    assert(fs.existsSync(f.cacheFile(1252)), '应写入 <modId>.json');

    // 2.2 TTL 内再取 → 不再抓
    const got2 = await f.getImages(1252);
    assert.equal(calls, 1, 'TTL 内应命中缓存');
    assert.equal(got2.length, 5);

    // 2.3 force = true → 绕过缓存重抓
    await f.getImages(1252, { force: true });
    assert.equal(calls, 2, 'force 应重抓');

    // 2.4 TTL 过期 → 重抓
    clock += DEFAULT_TTL_MS + 1;
    await f.getImages(1252);
    assert.equal(calls, 3, 'TTL 过期应重抓');

    // 2.5 失败 → 返回旧缓存，并进入冷却（冷却期不再抓）
    let loadCount = 0;
    const f2 = makeFetcher(async () => {
      loadCount++;
      // 第 2 次被抓失败（模拟 Cloudflare 拦截），其余正常
      return loadCount === 2
        ? { ok: false, reason: '被 Cloudflare 拦住' }
        : { ok: true, html: galleryHtml([{ id: 1, src: BASE + '/7/old.png' }]), count: 1 };
    }, { limit: 5 });
    // 第 1 次成功，把旧缓存写进去
    const ok1 = await f2.getImages(1);
    assert.equal(ok1.length, 1);
    assert.equal(loadCount, 1);
    // 强制重抓 → 失败 → 回落旧缓存
    const fail = await f2.getImages(1, { force: true });
    assert.equal(loadCount, 2);
    assert.equal(fail.length, 1, '抓失败应回落旧缓存');
    assert(logs.some(l => /抓取失败/.test(l[0])), '失败应记日志');
    // 冷却期内（不 force）不该再抓
    clock += 1000;
    const cooled = await f2.getImages(1);
    assert.equal(loadCount, 2, '失败冷却期内不应重抓');
    assert.equal(cooled.length, 1, '冷却期仍返回旧缓存');
    // 别的 mod 不受影响
    const other = await f2.getImages(2);
    assert.equal(other.length, 1);

    // 2.6 页面没有图集（items 为空）也算失败
    const emptyCount = { n: 0 };
    const f3 = makeFetcher(async () => { emptyCount.n++; return { ok: true, html: '<ul class="thumbgallery"><li class="thumb" data-exthumbimage="https://a/t.png"></li></ul>', count: 1 }; });
    assert.deepEqual(await f3.getImages(3), []);
    await f3.getImages(3);                     // 冷却中，不会重抓
    assert.equal(emptyCount.n, 1, '空图集应记失败并冷却');

    // 2.7 loadHtml 直接 throw → 绝不抛出来
    const f4 = makeFetcher(async () => { throw new Error('窗口炸了'); });
    assert.deepEqual(await f4.getImages(4), []);

    // 2.8 非法 modId
    assert.deepEqual(await f4.getImages(0), []);
    assert.deepEqual(await f4.getImages('abc'), []);
    assert.deepEqual(await f4.getImages(null), []);

    // 2.9 串行：并发两个不同 mod，窗口不能同时开
    let concurrent = 0, maxConcurrent = 0;
    const f5 = makeFetcher(async id => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 30));
      concurrent--;
      return { ok: true, html: galleryHtml([{ id, src: BASE + '/' + id + '/a.png' }]), count: 1 };
    });
    const [a, b, c] = await Promise.all([f5.getImages(10), f5.getImages(11), f5.getImages(12)]);
    assert.equal(maxConcurrent, 1, '隐藏窗口必须一次只开一个');
    assert.equal(a.length + b.length + c.length, 3);

    console.log('  ✓ createGalleryFetcher：缓存 / TTL / force / 失败冷却 / 空图集 / 永不抛 / 串行');

    fs.rmSync(root, { recursive: true, force: true });
    console.log('\ngallery tests passed');
  })().catch(e => {
    console.error('  ✗ ' + e.message);
    fs.rmSync(root, { recursive: true, force: true });
    process.exitCode = 1;
  });
}

main();
