'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * GitHub Release 直下通道（目前只服务于 UE4SS 一键安装）。
 *
 * ## 为什么单独一个模块
 *
 * UE4SS 不在 Nexus 上，只能从 GitHub Release 拿。而 GitHub 的下载链路有个坑：
 *
 *   · `github.com/.../releases/download/...` 是**展示域名**，在很多网络环境里连不上
 *     （实测本机 `github.com` 直接 ETIMEDOUT，但 `api.github.com` 是通的）。
 *   · 而 `api.github.com` 提供的**资产 API** 会 302 到真正的文件域名
 *     （`release-assets.githubusercontent.com`），这条通路是可用的。
 *
 * 所以下载策略是「多通路依次尝试」，而不是把 URL 写死：
 *
 *   1. 资产 API（`/repos/<repo>/releases/assets/<id>` + `Accept: application/octet-stream`）
 *      —— **全官方通路**，实测在 github.com 不可达的环境里仍能下到文件。
 *   2. `browser_download_url`（github.com 直链）—— 网络正常时最快。
 *   3. 用户自配的镜像前缀（设置页 `githubMirror`，默认空）。
 *
 * ⚠️ 默认**不**内置任何第三方加速镜像 —— 那等于把二进制交给中间人。
 *    镜像只能由用户显式配置，且失败时会明确告诉用户当前走的是哪条路。
 */

const UA = 'StarBladeModManager/0.1 (+https://github.com/)';
const MAX_REDIRECTS = 6;

/* ---------------- 基础 HTTP ---------------- */

/**
 * 发一个 GET（可选 HEAD），自动跟随重定向。
 * @returns {Promise<{status:number, headers:object, body:Buffer|null, stream:any|null}>}
 */
function request(url, { method = 'GET', headers = {}, timeout = 30000, stream = false, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('无效的 URL：' + url)); }
    if (u.protocol !== 'https:') return reject(new Error('只允许 https：' + url));

    const req = https.request(url, {
      method,
      timeout,
      headers: { 'User-Agent': UA, ...headers }
    }, (res) => {
      const code = res.statusCode || 0;
      const loc = res.headers.location;
      if (code >= 300 && code < 400 && loc) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('重定向次数过多'));
        return resolve(request(new URL(loc, url).toString(), { method, headers, timeout, stream, redirects: redirects + 1 }));
      }
      if (code !== 200) {
        res.resume();
        const err = new Error('HTTP ' + code);
        err.status = code;
        return reject(err);
      }
      if (stream) return resolve({ status: code, headers: res.headers, body: null, stream: res });

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: code, headers: res.headers, body: Buffer.concat(chunks), stream: null }));
    });

    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', reject);
    req.end();
  });
}

/** 取 JSON（GitHub API 必须带 Accept 头，否则可能拿到旧版格式） */
async function getJson(url, { timeout = 20000 } = {}) {
  const r = await request(url, {
    timeout,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  try { return JSON.parse(r.body.toString('utf8')); }
  catch { throw new Error('GitHub 返回的不是合法 JSON'); }
}

/* ---------------- Release ---------------- */

/** 取最新正式 Release（排除 draft / prerelease 由调用方决定） */
async function getLatestRelease(repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('无效的仓库名：' + repo);
  const j = await getJson('https://api.github.com/repos/' + repo + '/releases/latest');
  return {
    repo,
    tag: j.tag_name,
    name: j.name || j.tag_name,
    htmlUrl: j.html_url,
    publishedAt: j.published_at || null,
    body: j.body || '',
    assets: (j.assets || []).map(a => ({
      id: a.id,
      name: a.name,
      size: a.size || 0,
      contentType: a.content_type || '',
      downloadCount: a.download_count || 0,
      url: a.browser_download_url,
      apiUrl: a.url
    }))
  };
}

/**
 * 从资产列表里挑一个。
 *
 * `prefer` 是「优先匹配」的正则数组，`avoid` 是排除正则。
 * ⚠️ UE4SS 的 dev 包叫 `zDEV-UE4SS_...zip` —— 前缀 `z` 是为了在列表里排最后，
 *    不是版本更新。必须排除，否则会把 52MB 的 dev 包当成正式包下下来。
 */
function pickAsset(assets, { prefer = [], avoid = [], ext = /\.zip$/i } = {}) {
  const list = (assets || []).filter(a => ext.test(a.name) && !avoid.some(re => re.test(a.name)));
  if (!list.length) return null;
  for (const re of prefer) {
    const hit = list.find(a => re.test(a.name));
    if (hit) return hit;
  }
  return list[0];
}

/* ---------------- 下载 ---------------- */

function fileSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

/**
 * 下载一个 release 资产到本地文件。
 *
 * @param {object} p
 * @param {string} p.repo
 * @param {object} p.asset        getLatestRelease() 里的一项
 * @param {string} p.dest         目标文件路径
 * @param {string} [p.mirror]     镜像前缀（如 https://ghfast.top/），默认空
 * @param {Function} [p.onProgress] ({received,total,percent,source})
 * @param {Function} [p.shouldCancel]
 * @param {Function} [p.log]
 * @returns {Promise<{path:string, size:number, source:string}>}
 */
async function downloadAsset({ repo, asset, dest, mirror = '', onProgress, shouldCancel, log }) {
  if (!asset || !asset.name) throw new Error('没有可下载的资产');
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const attempts = [];
  // 1) 资产 API：全官方，且不依赖 github.com 是否可达
  if (asset.id && repo) {
    attempts.push({
      name: 'asset-api',
      url: 'https://api.github.com/repos/' + repo + '/releases/assets/' + asset.id,
      headers: { Accept: 'application/octet-stream' }
    });
  }
  // 2) 展示域名直链
  if (asset.url) attempts.push({ name: 'direct', url: asset.url, headers: {} });
  // 3) 用户自配镜像
  const m = String(mirror || '').trim();
  if (m && asset.url) {
    attempts.push({ name: 'mirror', url: m.replace(/\/+$/, '') + '/' + asset.url, headers: {} });
  }

  const errors = [];
  for (const a of attempts) {
    try {
      if (typeof log === 'function') log('尝试下载通道：' + a.name);
      const r = await request(a.url, { headers: a.headers, timeout: 30000, stream: true });

      const total = Number(r.headers['content-length']) || asset.size || 0;
      const tmp = dest + '.part';
      let received = 0;

      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        let done = false;
        const abort = (e) => {
          if (done) return;
          done = true;
          try { out.destroy(); } catch { /* 忽略 */ }
          try { r.stream.destroy(); } catch { /* 忽略 */ }
          try { fs.rmSync(tmp, { force: true }); } catch { /* 忽略 */ }
          reject(e);
        };
        r.stream.on('data', (c) => {
          received += c.length;
          if (typeof onProgress === 'function') {
            try {
              onProgress({
                received, total, source: a.name,
                percent: total ? Math.min(99, Math.round((received / total) * 100)) : null
              });
            } catch { /* 忽略 */ }
          }
          if (typeof shouldCancel === 'function' && shouldCancel()) abort(new Error('已取消'));
        });
        r.stream.on('error', abort);
        out.on('error', abort);
        out.on('finish', () => {
          if (done) return;
          done = true;
          out.close(() => resolve());
        });
        r.stream.pipe(out);
      });

      const size = fileSize(tmp);
      if (!size) throw new Error('下载到的文件是空的');
      fs.renameSync(tmp, dest);
      if (typeof onProgress === 'function') {
        try { onProgress({ received: size, total: total || size, percent: 100, source: a.name }); } catch { /* 忽略 */ }
      }
      return { path: dest, size, source: a.name };
    } catch (e) {
      errors.push(a.name + ': ' + e.message);
      if (typeof log === 'function') log('下载通道 ' + a.name + ' 失败：' + e.message);
    }
  }

  throw new Error('所有下载通道都失败了（' + errors.join('；') + '）。' +
    '可以在「设置 → 下载」里配置一个 GitHub 镜像前缀，或到发布页手动下载（下载目录监听会自动导入）。');
}

module.exports = {
  request, getJson, getLatestRelease, pickAsset, downloadAsset,
  UA, MAX_REDIRECTS
};
