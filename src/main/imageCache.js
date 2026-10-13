'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { pathToFileURL } = require('url');
const paths = require('./paths');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const MAX_REDIRECTS = 3;
/** 一个 mod 最多留几张**不同**的图（少于这个数就全留） */
const DEFAULT_IMAGE_LIMIT = 5;
const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;
const MIME_EXTENSIONS = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tif',
  'image/vnd.microsoft.icon': 'ico',
  'image/webp': 'webp',
  'image/x-icon': 'ico'
};

function parseAllowedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('无效或不允许的图片 URL');
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('无效或不允许的图片 URL'); }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const allowedHost = ['nexusmods.com', 'nexus-cdn.com'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowedHost) {
    throw new Error('无效或不允许的图片 URL');
  }
  return parsed;
}

function requestHttpsImage(value, deadline, maxBytes, redirects = 0) {
  const parsed = parseAllowedUrl(value);
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('图片请求超时'));

  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const timer = setTimeout(() => {
      const error = new Error('图片请求超时');
      if (request) request.destroy(error);
      finish(error);
    }, remaining);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }

    try {
      request = https.get(parsed, { headers: { Accept: 'image/*' } }, response => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.resume();
          if (!location || redirects >= MAX_REDIRECTS) return finish(new Error('图片重定向次数超限'));
          let next;
          try { next = new URL(location, parsed); }
          catch { return finish(new Error('图片重定向地址无效')); }
          try { parseAllowedUrl(next.href); }
          catch (error) { return finish(error); }
          settled = true;
          clearTimeout(timer);
          requestHttpsImage(next.href, deadline, maxBytes, redirects + 1).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          return finish(new Error(`图片服务器返回 HTTP ${status}`));
        }

        const mime = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (!IMAGE_MIME.test(mime)) {
          response.resume();
          return finish(new Error('响应内容不是有效图片类型'));
        }

        const contentLength = Number(response.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          response.destroy();
          request.destroy();
          return finish(new Error('图片大小超过 12MB 限制'));
        }

        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            request.destroy();
            finish(new Error('图片大小超过 12MB 限制'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          if (!size) return finish(new Error('图片内容为空'));
          finish(null, { body: Buffer.concat(chunks, size), mime });
        });
        response.on('aborted', () => finish(new Error('图片响应中断')));
        response.on('error', () => finish(new Error('图片响应读取失败')));
      });
      request.on('error', error => {
        const code = error && error.code;
        finish(new Error(code ? `图片网络请求失败（${code}）` : '图片网络请求失败'));
      });
    } catch {
      finish(new Error('图片网络请求失败'));
    }
  });
}

function downloadImage(value, { timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES } = {}) {
  return requestHttpsImage(value, Date.now() + timeoutMs, maxBytes);
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  function drain() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).then(() => {
        active--;
        drain();
      }, () => {
        active--;
        drain();
      });
    }
  }
  return task => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}

function extensionForMime(mime) {
  return MIME_EXTENSIONS[mime] || 'img';
}

/**
 * 「同一张图」的判定键。
 *
 * 🔴 **不能按完整 URL 去重**：Nexus 同一张图会给出多个尺寸变体，
 * 路径只差一段前缀 —— 实测 mod 1252 的封面就有三份：
 *
 * ```
 * https://staticdelivery.nexusmods.com/mods/7804/images/1252/1252-1754156417-180528799.png
 * https://staticdelivery.nexusmods.com/mods/7804/images/thumbnails/1252/1252-1754156417-180528799.png
 * https://images.nexusmods.com/mod-images/7804/t/large/12/1252/1252-1754156417-180528799.png
 * ```
 *
 * 按 URL 去重会把它们当成 3 张图（用户报的「只保留了 1 张图的 3 个不同尺寸」就是这个）。
 * 三个的文件名完全相同，所以**按文件名归一**才是对的。
 *
 * ⚠️ 只对**通过白名单校验**的 URL 做归一：被拒绝的 URL（http / 别的域名 / 非法串）
 *    一律用完整 URL 当键，否则 `https://evil.com/ok` 会和 `https://images.nexusmods.com/ok`
 *    撞在一起被吃掉一条（测试里有断言钉死）。
 */
function imageKey(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    parseAllowedUrl(raw);
  } catch {
    return raw;
  }
  try {
    const u = new URL(raw);
    const name = u.pathname.split('/').filter(Boolean).pop() || '';
    return name ? name.toLowerCase() : u.href;
  } catch {
    return raw;
  }
}

/** 同一张图的多个尺寸里，哪个更「大」—— 分高的留下 */
function variantScore(href) {
  let s;
  if (/\/thumbnails?\//i.test(href)) s = 0;
  else if (/\/(large|med|small)\//i.test(href)) s = 1;
  else s = 2;                                   // 无前缀 = 原图
  try {
    if (new URL(href).hostname.toLowerCase().endsWith('staticdelivery.nexusmods.com')) s += 1;
  } catch { /* 已校验过，理论上到不了这里 */ }
  return s;
}

function isSafeExtension(extension) {
  return SAFE_EXTENSION.test(extension) && (extension === 'img' || Object.values(MIME_EXTENSIONS).includes(extension));
}

function createImageCache({ imagesDir = paths.IMAGES, concurrency = 4, requestImage = downloadImage } = {}) {
  const limit = createLimiter(Math.max(1, Math.floor(Number(concurrency) || 1)));
  const inFlight = new Map();

  async function readCached(directory, hash) {
    try {
      const metadataPath = path.join(directory, `${hash}.json`);
      const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
      if (!IMAGE_MIME.test(metadata.mime) || !isSafeExtension(metadata.extension) || !Number.isSafeInteger(metadata.size) || metadata.size < 1) return null;
      const filePath = path.join(directory, `${hash}.${metadata.extension}`);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size !== metadata.size) return null;
      return { path: filePath, mime: metadata.mime, size: metadata.size, localUrl: pathToFileURL(filePath).href };
    } catch {
      return null;
    }
  }

  async function storeImage(directory, parsedUrl, hash) {
    await fs.promises.mkdir(directory, { recursive: true });
    const hit = await readCached(directory, hash);
    if (hit) return hit;

    const image = await requestImage(parsedUrl.href, { timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: MAX_IMAGE_BYTES });
    const mime = String(image && image.mime || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_MIME.test(mime)) throw new Error('响应内容不是有效图片类型');
    const body = Buffer.isBuffer(image.body) ? image.body : Buffer.from(image.body || []);
    if (!body.length) throw new Error('图片内容为空');
    if (body.length > MAX_IMAGE_BYTES) throw new Error('图片大小超过 12MB 限制');

    const extension = extensionForMime(mime);
    const filePath = path.join(directory, `${hash}.${extension}`);
    const metadataPath = path.join(directory, `${hash}.json`);
    const suffix = crypto.randomBytes(6).toString('hex');
    const tempImage = path.join(directory, `.${hash}.${suffix}.tmp`);
    const tempMetadata = path.join(directory, `.${hash}.${suffix}.json.tmp`);
    const metadata = JSON.stringify({ mime, size: body.length, extension });

    try {
      await fs.promises.writeFile(tempImage, body, { flag: 'wx' });
      await fs.promises.rename(tempImage, filePath);
      await fs.promises.writeFile(tempMetadata, metadata, { flag: 'wx' });
      await fs.promises.rename(tempMetadata, metadataPath);
    } finally {
      await Promise.all([
        fs.promises.rm(tempImage, { force: true }),
        fs.promises.rm(tempMetadata, { force: true })
      ]);
    }

    return { path: filePath, mime, size: body.length, localUrl: pathToFileURL(filePath).href };
  }

  async function cacheOne(modId, rawUrl) {
    let parsedUrl;
    try { parsedUrl = parseAllowedUrl(rawUrl); }
    catch (error) { return { url: rawUrl, error: error.message }; }

    const directory = path.join(imagesDir, String(modId));
    const hash = crypto.createHash('sha256').update(parsedUrl.href).digest('hex');
    const hit = await readCached(directory, hash);
    if (hit) return { url: rawUrl, ...hit };

    const flightKey = path.join(directory, hash);
    let pending = inFlight.get(flightKey);
    if (!pending) {
      pending = limit(() => storeImage(directory, parsedUrl, hash));
      inFlight.set(flightKey, pending);
      const clear = () => { if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey); };
      pending.then(clear, clear);
    }

    try { return { url: rawUrl, ...(await pending) }; }
    catch (error) { return { url: rawUrl, error: error && error.message ? error.message : '图片缓存失败' }; }
  }

  /**
   * 缓存一个 mod 的图片。
   *
   * @param {string|number} modId
   * @param {string[]} urls
   * @param {{limit?:number}} [options] `limit` 是**不同图片**的上限（默认 5）；
   *        同一张图的多个尺寸只算一张，且优先保留原图那一份。
   */
  async function cacheModImages(modId, urls, options = {}) {
    const id = String(modId);
    if (!/^\d+$/.test(id)) throw new Error('无效的 Mod ID');
    const limit = Math.max(1, Math.floor(Number(options.limit) || DEFAULT_IMAGE_LIMIT));

    // 按「图片身份」归并：同一张图的多个尺寸只留分最高的那个 URL
    const order = [];
    const best = new Map();
    for (const value of Array.isArray(urls) ? urls : []) {
      const rawUrl = typeof value === 'string' ? value : String(value == null ? '' : value);
      const key = imageKey(rawUrl) || rawUrl;
      if (!key) continue;
      const prev = best.get(key);
      if (!prev) {
        best.set(key, rawUrl);
        order.push(key);
      } else if (variantScore(rawUrl) > variantScore(prev)) {
        best.set(key, rawUrl);
      }
    }

    const unique = order.slice(0, limit).map(key => best.get(key));
    return Promise.all(unique.map(url => cacheOne(id, url)));
  }

  return { cacheModImages };
}

module.exports = {
  createImageCache,
  imageKey,
  variantScore,
  isAllowedImageUrl: value => {
    try { parseAllowedUrl(value); return true; }
    catch { return false; }
  },
  MAX_IMAGE_BYTES,
  REQUEST_TIMEOUT_MS,
  MAX_REDIRECTS,
  DEFAULT_IMAGE_LIMIT
};
