'use strict';
/**
 * 预加载补丁：给 fs 插桩，跟踪 `data/tmp/extract-*` 的「创建 / 删除」，
 * 用来定位 e2e 里偶发的临时目录泄漏。
 *
 * 用法：node -r ./_probe/rmrf-patch.js _probe/e2e-ue4ss-install.js
 */
const fs = require('fs');
const path = require('path');

const TMP = path.join(__dirname, '..', 'data', 'tmp');
const isTmpExtract = (p) => typeof p === 'string' && p.toLowerCase().startsWith(TMP.toLowerCase() + path.sep + 'extract-');

const origMkdir = fs.mkdirSync.bind(fs);
const origRm = fs.rmSync.bind(fs);
const origRmdir = fs.rmdirSync.bind(fs);

const alive = new Map();   // lower(path) → { created: Date.now(), deleted: false }

fs.mkdirSync = function (p, opts) {
  if (isTmpExtract(p) && !alive.has(String(p).toLowerCase())) {
    alive.set(String(p).toLowerCase(), { created: Date.now(), deleted: false });
    console.log('[patch] + mkdir ' + path.basename(String(p)) + '  t=' + Date.now());
  }
  return origMkdir(p, opts);
};

fs.rmSync = function (p, opts) {
  const hit = isTmpExtract(p);
  try {
    const r = origRm(p, opts);
    if (hit) {
      const still = fs.existsSync(p);
      console.log('[patch] - rmSync ' + path.basename(String(p)) + '  ok  仍存在=' + still + '  t=' + Date.now());
    }
    return r;
  } catch (e) {
    if (hit) console.log('[patch] - rmSync ' + path.basename(String(p)) + '  失败 ' + e.code + ' ' + e.message + '  t=' + Date.now());
    throw e;
  }
};

fs.rmdirSync = function (p, opts) {
  const hit = isTmpExtract(p);
  try {
    const r = origRmdir(p, opts);
    if (hit) console.log('[patch] - rmdir ' + path.basename(String(p)) + '  t=' + Date.now());
    return r;
  } catch (e) {
    if (hit) console.log('[patch] - rmdir ' + path.basename(String(p)) + '  失败 ' + e.code + '  t=' + Date.now());
    throw e;
  }
};

process.on('exit', () => {
  const leftovers = [];
  try {
    for (const n of fs.readdirSync(TMP)) {
      if (!n.startsWith('extract-')) continue;
      const st = fs.statSync(path.join(TMP, n));
      leftovers.push(n + ' (mtime ' + st.mtime.toISOString() + ', ' + st.mtimeMs + ')');
    }
  } catch { /* 忽略 */ }
  console.log('\n[patch] === 进程退出时残留的 extract-* ===');
  console.log(leftovers.length ? leftovers.map(s => '  · ' + s).join('\n') : '  无');
  console.log('[patch] === 本次进程内见过的 extract-* 生命周期 ===');
  for (const [k, v] of alive) {
    console.log('  · ' + path.basename(k) + '  created t=' + v.created);
  }
});
