'use strict';

/**
 * downloadEngine 纯 Node 测试。
 *
 * 全程用假依赖（假的直链解析 / 假的下载 / 假的安装器），不碰网络、不碰游戏目录，
 * 但**真实**走 createDownloadQueue 的落盘逻辑 —— 要验的就是「队列 + 状态机 + 授权不落盘」。
 */

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDownloadEngine, safeFileName } = require('../src/main/downloadEngine');
const { writeJson } = require('../src/main/store');

// 任何「没人接的 Promise 异常」都算失败 —— 移除任务 / 取消下载时最容易漏出来
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === true || r === undefined) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → ' + e.message); }
}
async function ta(name, fn) {
  try { const r = await fn(); if (r === true || r === undefined) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → ' + e.message); }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, timeout = 2000, step = 10) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await wait(step);
  }
  return null;
}

function makeFakes({ analyzeResult, installResult, downloadImpl } = {}) {
  const calls = { resolve: 0, download: 0, install: 0, analyze: 0, cached: [] };
  return {
    calls,
    resolveDownloadLink: async () => { calls.resolve++; return [{ name: 'my mod 1.2.zip', uri: 'https://cdn.example/dl' }]; },
    downloadToFile: downloadImpl || (async (uri, dest, { onProgress }) => {
      calls.download++;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      onProgress({ received: 512, total: 1024, percent: 50 });
      // 写真 zip 头，模拟真实下载（重命名时要靠嗅探魔数拿扩展名）
      const head = Buffer.from('PK\x03\x04', 'latin1');
      fs.writeFileSync(dest, Buffer.concat([head, Buffer.alloc(1016, 7)]));
      onProgress({ received: 1024, total: 1024, percent: 100 });
      return { path: dest, size: 1024, total: 1024, filename: path.basename(dest) };
    }),
    analyze: async () => { calls.analyze++; return analyzeResult || { ok: true, conflictCount: 0, kind: 'pak', target: 'mods', targetLabel: '~Mods', fileCount: 3, reason: '按 pak 落点' }; },
    runInstall: async ({ meta }) => { calls.install++; return installResult || { id: 'nexus:777:1', kind: 'pak', kindLabel: 'Pak 模组', target: 'mods', targetLabel: '~Mods', written: 3, skipped: 0, backedCount: 0, backupFailed: 0, manifest: [] }; },
    getMod: async () => ({ modId: 777, name: '正式名称', author: '作者甲', version: '1.2', summary: '摘要', url: 'https://www.nexusmods.com/stellarblade/mods/777', pictureUrl: 'https://images.nexusmods.com/a.jpg', image: 'https://images.nexusmods.com/a.jpg', images: ['https://images.nexusmods.com/a.jpg', 'https://images.nexusmods.com/b.jpg'] }),
    cacheImages: async (modId, urls) => { calls.cached.push(urls.length); return urls.map((u, i) => ({ url: u, localUrl: 'file:///cache/' + modId + '/' + i + '.jpg', path: '/cache/' + modId + '/' + i + '.jpg', mime: 'image/jpeg', size: 100 })); },
    registry: { upsert: () => {} },
    layout: {}
  };
}

async function main() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'starblade-engine-'));
  const file = path.join(root, 'downloads.json');
  const libraryDir = path.join(root, 'library');
  let idc = 0;
  const fakes = makeFakes();

  const engine = createDownloadEngine({
    file,
    libraryDir,
    now: () => '2026-10-11T00:00:00.000Z',
    makeId: () => 't' + (++idc),
    getRoot: () => 'D:/fake/game',
    getLayout: () => ({}),
    getRegistry: () => fakes.registry,
    ...fakes
  });

  try {
    console.log('\n=== 1) 加入队列（等待授权） ===');
    t('初始为空', () => engine.list().length === 0 ? true : 'len=' + engine.list().length);

    const r1 = engine.enqueueNexus({ game: 'stellarblade', modId: 777, fileId: 1, name: '我的 Mod', version: '1.2' });
    t('返回任务且非重复', () => r1.duplicate === false);
    t('状态为 awaiting_authorization', () => r1.task.status === 'awaiting_authorization' ? true : r1.task.status);
    t('activeCount = 1', () => engine.activeCount() === 1 ? true : engine.activeCount());

    const dup = engine.enqueueNexus({ game: 'stellarblade', modId: 777, fileId: 1, name: '改名' });
    t('同 modId+fileId 去重', () => dup.duplicate === true && dup.task.id === r1.task.id);

    console.log('\n=== 2) 没授权就 start → 回到等待授权 ===');
    await ta('start 无授权不崩，落 awaiting', async () => {
      engine.retry(r1.task.id);
      await wait(30);
      const x = engine.get(r1.task.id);
      return x.status === 'awaiting_authorization' && /授权/.test(x.error || '') ? true : x.status + ' / ' + x.error;
    });

    console.log('\n=== 3) 收到 nxm → 全自动跑完（下载 + 安装） ===');
    await ta('attachNxm 后最终 installed', async () => {
      engine.attachNxm({ game: 'stellarblade', modId: 777, fileId: 1, key: 'K', expires: 123 });
      const done = await waitFor(() => engine.get(r1.task.id).status === 'installed');
      const x = engine.get(r1.task.id);
      return done ? true : x.status + ' / ' + x.error;
    });
    t('调用了解析 + 下载 + 分析 + 安装', () => (fakes.calls.resolve >= 1 && fakes.calls.download === 1 && fakes.calls.analyze === 1 && fakes.calls.install === 1)
      ? true : JSON.stringify(fakes.calls));
    t('进度到 100%', () => engine.get(r1.task.id).progress.percent === 100 ? true : engine.get(r1.task.id).progress.percent);
    t('归档落在 data/library/<modId>/ 下', () => {
      const x = engine.get(r1.task.id);
      return x.archivePath && x.archivePath.startsWith(libraryDir) && fs.existsSync(x.archivePath) ? true : x.archivePath;
    });
    t('install 结果记进任务', () => engine.get(r1.task.id).install.registryId === 'nexus:777:1');
    t('文件名按「id_名称_版本」规范化（含空格，无路径分隔符）', () => {
      const n = engine.get(r1.task.id).filename;
      return (n === '777_正式名称_1.2.zip' && !/[\\/]/.test(n)) ? true : n;
    });
    t('下载用的 .part 临时文件已清掉（library 下不留 .part）', () => {
      const leftovers = [];
      const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.part')) leftovers.push(p);
        }
      };
      walk(libraryDir);
      return leftovers.length ? leftovers.join(' | ') : true;
    });

    console.log('\n=== 4) 封面与预览图被缓存进任务 ===');
    await ta('meta.images 有本地地址', async () => {
      await engine.ensureImages(r1.task.id);
      const m = engine.get(r1.task.id).meta;
      return (Array.isArray(m.images) && m.images.length === 2 && /^file:/.test(m.images[0].localUrl)) ? true : JSON.stringify(m.images);
    });
    t('meta 回填了 Nexus 正式名称 / 作者 / 版本', () => {
      const m = engine.get(r1.task.id).meta;
      return (m.name === '正式名称' && m.author === '作者甲' && m.version === '1.2') ? true : JSON.stringify({ n: m.name, a: m.author, v: m.version });
    });

    console.log('\n=== 5) key/expires 绝不落盘 ===');
    t('磁盘上没有 key / expires / 直链', () => {
      const raw = fs.readFileSync(file, 'utf8');
      return (!raw.includes('"K"') && !raw.includes('expires') && !raw.includes('cdn.example')) ? true : raw.slice(0, 300);
    });

    console.log('\n=== 6) 下载中取消 ===');
    const slowEngine = createDownloadEngine({
      file: path.join(root, 'downloads2.json'),
      libraryDir,
      now: () => '2026-10-11T00:00:00.000Z',
      makeId: () => 's' + (++idc),
      getRoot: () => 'D:/fake/game',
      getLayout: () => ({}),
      getRegistry: () => fakes.registry,
      ...makeFakes({
        downloadImpl: (uri, dest, { onProgress, shouldCancel }) => new Promise((resolve, reject) => {
          let n = 0;
          const tick = () => {
            if (shouldCancel && shouldCancel()) { try { fs.rmSync(dest, { force: true }); } catch { /* 忽略 */ } reject(new Error('已取消')); return; }
            n += 2000;
            onProgress({ received: n, total: 10000, percent: n / 100 });
            if (n >= 10000) { fs.writeFileSync(dest, 'x'); resolve({ path: dest, size: 1, total: 10000, filename: path.basename(dest) }); return; }
            setTimeout(tick, 8);
          };
          setTimeout(tick, 8);
        })
      })
    });
    const s1 = slowEngine.enqueueNexus({ game: 'stellarblade', modId: 888, fileId: 2, name: '慢 Mod' });
    await ta('取消后状态为 cancelled，且没装', async () => {
      slowEngine.attachNxm({ game: 'stellarblade', modId: 888, fileId: 2, key: 'K2', expires: 1 });
      await waitFor(() => ['downloading', 'queued', 'resolving'].includes(slowEngine.get(s1.task.id).status));
      slowEngine.cancel(s1.task.id);
      const done = await waitFor(() => slowEngine.get(s1.task.id).status === 'cancelled');
      const x = slowEngine.get(s1.task.id);
      return done && x.status === 'cancelled' ? true : x.status + ' / ' + x.error;
    });
    await ta('取消不留半截文件', async () => {
      const x = slowEngine.get(s1.task.id);
      const exists = x.archivePath && fs.existsSync(x.archivePath);
      return !exists ? true : '仍存在 ' + x.archivePath;
    });

    console.log('\n=== 7) 覆盖冲突 → 待确认 → 确认后安装 ===');
    const conflictEngine = createDownloadEngine({
      file: path.join(root, 'downloads3.json'),
      libraryDir,
      now: () => '2026-10-11T00:00:00.000Z',
      makeId: () => 'c' + (++idc),
      getRoot: () => 'D:/fake/game',
      getLayout: () => ({}),
      getRegistry: () => fakes.registry,
      ...makeFakes({ analyzeResult: { ok: true, conflictCount: 2, kind: 'cns', target: 'sb', targetLabel: 'SB\\', fileCount: 5, reason: '合并到 SB' } })
    });
    const c1 = conflictEngine.enqueueNexus({ game: 'stellarblade', modId: 999, fileId: 3, name: '冲突 Mod' });
    await ta('有冲突时不自动装，落 needs_review', async () => {
      conflictEngine.attachNxm({ game: 'stellarblade', modId: 999, fileId: 3, key: 'K3', expires: 1 });
      const done = await waitFor(() => conflictEngine.get(c1.task.id).status === 'needs_review');
      const x = conflictEngine.get(c1.task.id);
      return done && /覆盖/.test(x.install.reason || '') ? true : x.status + ' / ' + JSON.stringify(x.install);
    });
    await ta('确认后装成 installed', async () => {
      conflictEngine.confirmInstall(c1.task.id);
      const done = await waitFor(() => conflictEngine.get(c1.task.id).status === 'installed');
      return done ? true : conflictEngine.get(c1.task.id).status;
    });

    console.log('\n=== 8) 直链解析失败 → failed 且带人话 ===');
    const failEngine = createDownloadEngine({
      file: path.join(root, 'downloads4.json'),
      libraryDir,
      now: () => '2026-10-11T00:00:00.000Z',
      makeId: () => 'f' + (++idc),
      getRoot: () => 'D:/fake/game',
      getLayout: () => ({}),
      getRegistry: () => fakes.registry,
      ...makeFakes(),
      resolveDownloadLink: async () => { throw new Error('下载授权已过期。请回 Nexus 网页重新点一次「Mod Manager Download」。'); }
    });
    const f1 = failEngine.enqueueNexus({ game: 'stellarblade', modId: 1000, fileId: 4, name: '过期 Mod' });
    await ta('解析失败 → failed + 过期提示', async () => {
      failEngine.attachNxm({ game: 'stellarblade', modId: 1000, fileId: 4, key: 'K4', expires: 1 });
      const done = await waitFor(() => failEngine.get(f1.task.id).status === 'failed');
      const x = failEngine.get(f1.task.id);
      return done && /过期/.test(x.error || '') ? true : x.status + ' / ' + x.error;
    });
    await ta('失败任务可从归档重试（无归档则回等待授权）', async () => {
      failEngine.retry(f1.task.id);
      await wait(30);
      const x = failEngine.get(f1.task.id);
      return x.status === 'awaiting_authorization' ? true : x.status;
    });

    console.log('\n=== 9) 本地压缩包导入 ===');
    const zip = path.join(root, 'CNS.zip');
    fs.writeFileSync(zip, Buffer.alloc(2048, 3));
    const localEngine = createDownloadEngine({
      file: path.join(root, 'downloads5.json'),
      libraryDir,
      now: () => '2026-10-11T00:00:00.000Z',
      makeId: () => 'l' + (++idc),
      getRoot: () => 'D:/fake/game',
      getLayout: () => ({}),
      getRegistry: () => fakes.registry,
      ...makeFakes()
    });
    await ta('导入后直接 installed', async () => {
      const r = localEngine.enqueueLocal(zip, { game: 'stellarblade', modId: 1496, fileId: 13020, name: 'CNS' });
      const done = await waitFor(() => localEngine.get(r.task.id).status === 'installed');
      return done ? true : localEngine.get(r.task.id).status;
    });
    t('size 从真实文件读出来', () => localEngine.list()[0].size === 2048 ? true : localEngine.list()[0].size);
    t('导入的包也按「id_名称」规范命名', () => {
      const x = localEngine.list()[0];
      return x.filename === '1496_CNS.zip' ? true : x.filename;
    });
    t('导入的包被复制进 library（自包含，原文件删了也能重装）', () => {
      const x = localEngine.list()[0];
      const inside = x.archivePath.startsWith(libraryDir);
      return (inside && fs.existsSync(x.archivePath) && x.archivePath !== zip) ? true : x.archivePath;
    });

    console.log('\n=== 10) 移除任务 ===');
    await ta('deleteArchive=true 连包一起删', async () => {
      const x = localEngine.list()[0];
      const p = x.archivePath;
      localEngine.remove(x.id, { deleteArchive: true });
      return (!localEngine.get(x.id) && !fs.existsSync(p)) ? true : '仍有残留';
    });

    console.log('\n=== 11) syncFromInstalled 对齐 ===');
    await ta('注册表里装着 → 任务标为 installed', async () => {
      const e2 = createDownloadEngine({
        file: path.join(root, 'downloads6.json'),
        libraryDir,
        now: () => '2026-10-11T00:00:00.000Z',
        makeId: () => 'y' + (++idc),
        getRoot: () => null, getLayout: () => ({}), getRegistry: () => fakes.registry,
        ...makeFakes()
      });
      const r = e2.enqueueNexus({ game: 'stellarblade', modId: 4242, fileId: 5, name: '已装 Mod' });
      e2.cancel(r.task.id);
      e2.syncFromInstalled([{ id: 'nexus:4242:5', location: 'D:/game/SB', meta: { source: { modId: 4242 } } }]);
      const x = e2.get(r.task.id);
      return x.status === 'installed' && x.install.registryId === 'nexus:4242:5' ? true : x.status + ' / ' + JSON.stringify(x.install);
    });

    console.log('\n=== 12) 无游戏目录时下载完不硬装 ===');
    await ta('落 downloaded + 提示去设置目录', async () => {
      const e3 = createDownloadEngine({
        file: path.join(root, 'downloads7.json'),
        libraryDir,
        now: () => '2026-10-11T00:00:00.000Z',
        makeId: () => 'n' + (++idc),
        getRoot: () => null, getLayout: () => ({}), getRegistry: () => fakes.registry,
        ...makeFakes()
      });
      const r = e3.enqueueNexus({ game: 'stellarblade', modId: 555, fileId: 6, name: '无目录 Mod' });
      e3.attachNxm({ game: 'stellarblade', modId: 555, fileId: 6, key: 'K6', expires: 1 });
      const done = await waitFor(() => e3.get(r.task.id).status === 'downloaded');
      const x = e3.get(r.task.id);
      return done && /游戏目录/.test(x.error || '') ? true : x.status + ' / ' + x.error;
    });

    console.log('\n=== 13) 文件名净化 ===');
    t('抹掉路径分隔符', () => { const s = safeFileName('..\\..\\evil.zip'); return (!/[\\/]/.test(s) && s.endsWith('evil.zip')) ? true : s; });
    t('空值有兜底', () => safeFileName('') === 'download.bin' ? true : safeFileName(''));
    t('去掉开头的点', () => { const s = safeFileName('.hidden.7z'); return s[0] !== '.' ? true : s; });

    console.log('\n=== 14) 同一 Mod 重复加入 → 复用记录，不堆重复项 ===');
    await ta('enqueueNexus 对已装完的任务复用同一条', async () => {
      const before = engine.list().length;
      const again = engine.enqueueNexus({ game: 'stellarblade', modId: 777, fileId: 1, name: '再来一次' });
      const same = again.task.id === r1.task.id;
      return (again.duplicate === false && same && engine.list().length === before)
        ? true : JSON.stringify({ dup: again.duplicate, same, before, after: engine.list().length });
    });

    await ta('enqueueLocal 二次导入复用同一条', async () => {
      const e4 = createDownloadEngine({
        file: path.join(root, 'downloads8.json'), libraryDir,
        now: () => '2026-10-11T00:00:00.000Z', makeId: () => 'r' + (++idc),
        getRoot: () => 'D:/fake/game', getLayout: () => ({}), getRegistry: () => fakes.registry,
        ...makeFakes()
      });
      const a = e4.enqueueLocal(zip, { game: 'stellarblade', modId: 7000, fileId: 1, name: '导入' });
      await waitFor(() => e4.get(a.task.id).status === 'installed');
      const b = e4.enqueueLocal(zip, { game: 'stellarblade', modId: 7000, fileId: 1, name: '导入' });
      await waitFor(() => e4.get(b.task.id).status === 'installed');
      return (b.task.id === a.task.id && e4.list().length === 1)
        ? true : JSON.stringify({ same: b.task.id === a.task.id, len: e4.list().length });
    });

    console.log('\n=== 15) 安装途中移除任务 → 不再写盘、不抛未处理异常 ===');
    const removeEngine = createDownloadEngine({
      file: path.join(root, 'downloads9.json'), libraryDir,
      now: () => '2026-10-11T00:00:00.000Z', makeId: () => 'z' + (++idc),
      getRoot: () => 'D:/fake/game', getLayout: () => ({}), getRegistry: () => fakes.registry,
      ...makeFakes()
    });
    const z1 = removeEngine.enqueueLocal(zip, { game: 'stellarblade', modId: 8000, fileId: 1, name: '移除测试' });
    removeEngine.remove(z1.task.id, { deleteArchive: true });
    await wait(250);
    t('任务已移除且列表为空', () => removeEngine.list().length === 0 ? true : removeEngine.list().length);
    t('移除后没有未处理的 Promise 异常', () => unhandled === 0 ? true : 'unhandled=' + unhandled);

    console.log('\n=== 16) 图片优先走图集（getGallery），拿不到才回落官方 API ===');
    // 图集能给出 mod 页上的多张「不同」图片；官方 API 只有封面那 1 张的 3 个尺寸
    const gCalls = { gallery: 0, mod: 0, urls: [] };
    const gEngine = createDownloadEngine({
      file: path.join(root, 'downloads10.json'), libraryDir,
      now: () => '2026-10-11T00:00:00.000Z', makeId: () => 'g' + (++idc),
      getRoot: () => 'D:/fake/game', getLayout: () => ({}), getRegistry: () => fakes.registry,
      ...makeFakes(),
      getGallery: async () => {
        gCalls.gallery++;
        return [
          { url: 'https://staticdelivery.nexusmods.com/mods/7804/images/9000/a.png' },
          { url: 'https://staticdelivery.nexusmods.com/mods/7804/images/9000/b.png' },
          { url: 'https://staticdelivery.nexusmods.com/mods/7804/images/9000/c.png' }
        ];
      },
      getMod: async () => { gCalls.mod++; return { modId: 9000, name: '图集优先', images: ['https://images.nexusmods.com/only-one.jpg'] }; },
      cacheImages: async (modId, urls) => {
        gCalls.urls = urls;
        return urls.map((u, i) => ({ url: u, localUrl: 'file:///g/' + modId + '/' + i + '.jpg', path: '/g/' + modId + '/' + i + '.jpg', mime: 'image/jpeg', size: 10 }));
      }
    });
    const g1 = gEngine.enqueueLocal(zip, { game: 'stellarblade', modId: 9000, fileId: 1, name: '图集' });
    await waitFor(() => gEngine.get(g1.task.id).status === 'installed');
    await gEngine.ensureImages(g1.task.id);

    t('装完任务会自动走一次图集（手动再确认一次也无妨，图集有磁盘缓存）', () => gCalls.gallery >= 1 ? true : gCalls.gallery);
    t('图集够 3 张时不再打官方 API', () => gCalls.mod === 0 ? true : gCalls.mod);
    t('缓存的是图集里的 3 张不同图片', () => {
      const m = gEngine.get(g1.task.id).meta;
      return (m.images && m.images.length === 3 && /\/9000\/a\.png$/.test(gCalls.urls[0] || '')) ? true : JSON.stringify({ n: (m.images || []).length, u: gCalls.urls });
    });
    t('meta.image 用第一张本地地址', () => /^file:\/\/\/g\/9000\/0\.jpg$/.test(gEngine.get(g1.task.id).meta.image) ? true : gEngine.get(g1.task.id).meta.image);

    // 图集抓不到（返回空）→ 必须回落官方 API，不能把任务卡成没图
    const fCalls = { gallery: 0, mod: 0 };
    const fEngine = createDownloadEngine({
      file: path.join(root, 'downloads11.json'), libraryDir,
      now: () => '2026-10-11T00:00:00.000Z', makeId: () => 'f' + (++idc),
      getRoot: () => 'D:/fake/game', getLayout: () => ({}), getRegistry: () => fakes.registry,
      ...makeFakes(),
      getGallery: async () => { fCalls.gallery++; return []; },
      getMod: async () => { fCalls.mod++; return { modId: 9001, name: '回落', images: ['https://images.nexusmods.com/x.jpg', 'https://images.nexusmods.com/y.jpg'] }; }
    });
    const fb1 = fEngine.enqueueLocal(zip, { game: 'stellarblade', modId: 9001, fileId: 1, name: '回落' });
    await waitFor(() => fEngine.get(fb1.task.id).status === 'installed');
    await fEngine.ensureImages(f1.task.id);
    t('图集为空时回落官方 API', () => (fCalls.gallery === 1 && fCalls.mod === 1) ? true : JSON.stringify(fCalls));
    t('回落也拿到了图', () => {
      const m = fEngine.get(fb1.task.id).meta;
      return (Array.isArray(m.images) && m.images.length === 2) ? true : JSON.stringify(m.images);
    });

    console.log('\n=== 17) reviveBrokenInstalls：救回被 pickDirs bug 打死的那批任务 ===');
    // 背景：用户截图里 4 个 mod 报「无法识别这个压缩包的结构」。bug 修好之后，
    // **已经躺下的任务不会自己爬起来**，所以启动时重新分析一遍。
    {
      const reviveFile = path.join(root, 'downloads12.json');
      const noPick = path.join(root, 'noPick.zip'); fs.writeFileSync(noPick, Buffer.alloc(1024, 1));
      const variant = path.join(root, 'variant.zip'); fs.writeFileSync(variant, Buffer.alloc(1024, 2));
      const broken = path.join(root, 'broken.zip'); fs.writeFileSync(broken, Buffer.alloc(1024, 3));
      const httpFail = path.join(root, 'http.zip'); fs.writeFileSync(httpFail, Buffer.alloc(1024, 4));
      writeJson(reviveFile, {
        version: 1,
        tasks: [
          { id: 'rv1', status: 'failed', archivePath: noPick, error: '安装失败：无法识别这个压缩包的结构，请指定安装目录',
            meta: { game: 'stellarblade', modId: 1378, fileId: 1, name: 'Eve Iberis Dress CNS' } },
          { id: 'rv2', status: 'failed', archivePath: variant, error: '安装失败：无法识别这个压缩包的结构，请指定安装目录',
            meta: { game: 'stellarblade', modId: 437, fileId: 1, name: 'BP Planet Diving Suit' } },
          { id: 'rv3', status: 'failed', archivePath: broken, error: '结构识别失败：7-Zip 26.03 (x64) : Copyright (c) 1999-2026 Igor Pavlov : 2026-09-03',
            meta: { game: 'stellarblade', modId: 1763, fileId: 1, name: 'Punk top retexture' } },
          // HTTP 错误那类**绝不允许**被洗成待确认（没有可选的安装内容，只会误导）
          { id: 'rv4', status: 'failed', archivePath: httpFail, error: 'net::ERR_HTTP2_PROTOCOL_ERROR',
            meta: { game: 'stellarblade', modId: 2253, fileId: 1, name: 'bellyband' } }
        ]
      });
      const rvEngine = createDownloadEngine({
        file: reviveFile, libraryDir,
        now: () => '2026-10-13T00:00:00.000Z', makeId: () => 'rv' + (++idc),
        getRoot: () => 'D:/fake/game', getLayout: () => ({}), getRegistry: () => fakes.registry,
        ...makeFakes(),
        analyze: async (root, archivePath) => {
          const buf = fs.readFileSync(archivePath)[0];
          if (buf === 1) return { ok: true, kind: 'pak', files: [], mapping: [] };
          if (buf === 2) return { ok: false, needsTargetPick: true, reason: '包里有 3 套内容，需要你选要装哪些',
            options: [{ dir: 'A', files: [] }, { dir: 'B', files: [] }, { dir: 'C', files: [] }] };
          throw new Error('读取压缩包失败（退出码 2）：压缩包不完整（下载被中断，或文件被截断）—— 请重新下载这个文件');
        }
      });
      const rv = await rvEngine.reviveBrokenInstalls();
      const by = (id) => rvEngine.get(id);
      t('只挑「结构识别失败 + HTTP 失败」这两类（共 3 条）', () => rv.total === 3 ? true : JSON.stringify(rv));
      t('认得出来的 → needs_review', () => by('rv1').status === 'needs_review' ? true : by('rv1').status);
      t('变体包 → needs_review 且 reason 是「有 N 套内容」', () =>
        by('rv2').status === 'needs_review' && /3 套内容/.test(by('rv2').install.reason || '') ? true : JSON.stringify(by('rv2').install));
      t('包真的坏了 → 保持 failed，但错误换成一句人话', () =>
        by('rv3').status === 'failed' && /重新下载/.test(by('rv3').error || '') && !/Copyright/.test(by('rv3').error || '')
          ? true : by('rv3').status + ' / ' + by('rv3').error);
      t('HTTP 失败的任务**不动**（不洗成待确认误导用户）', () =>
        by('rv4').status === 'failed' && /ERR_HTTP2/.test(by('rv4').error || '') ? true : by('rv4').status + ' / ' + by('rv4').error);
      t('复活的任务 error 被清掉（needs_review 不该带红字报错）', () => !by('rv1').error ? true : by('rv1').error);
    }

    console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }

  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
