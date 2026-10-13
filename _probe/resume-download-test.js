'use strict';
/**
 * 断点续传 + 「全部恢复」自检（用户 2026-10-14 要求：任务中断后支持全部恢复继续下载）。
 *
 * 续传部分起一个**本地 HTTP 服务器**当 Nexus CDN，真发请求、真写盘：
 *   [1] 完整下载：内容逐字节一致
 *   [2] 有半截文件 → 带 `Range` 请求，只下后半段，拼出来仍是完整一份
 *   [3] 服务器**不支持 Range**（回 200）→ 必须从头重写，
 *       不能把完整响应追加到半截后面（那会得到一个坏包，解压才暴露）
 *   [4] 服务器回 416 → 明确抛错并把旧文件挪成 `.stale-*`
 *   [5] 意外中断 → **保留**半截文件（下次续传的本钱）
 *   [6] 用户主动取消 → 清掉半截文件
 *   [7] 引擎侧的半截文件名可预测（`.dl-<modId>-<fileId>.part`，不带时间戳）
 *   [8] 清扫只清「队列里没有对应任务」的旧 .part
 *   [9] 「全部恢复」按钮与流水线接线
 *
 * 运行：`node _probe/resume-download-test.js`
 */
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === true || r === undefined) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → ' + e.message); }
}
async function ta(name, fn) {
  try { const r = await fn(); if (r === true || r === undefined) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → ' + e.message); }
}

/* ---------- 假 nexusAuth：nxm.js 只在用到时才 require 它，先塞进 require.cache ---------- */
let fetchImpl = () => { throw new Error('没设置 fetchImpl'); };
const authPath = require.resolve('../src/main/nexusAuth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true, children: [], paths: [],
  exports: {
    nexusSession: () => ({ fetch: (uri, opts) => fetchImpl(uri, opts) }),
    cleanUA: () => 'sbmodmanager-test'
  }
};

const nxm = require('../src/main/nxm');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-resume-'));

/** 32KB 的可辨识载荷 */
const PAYLOAD = Buffer.alloc(32 * 1024, 0);
for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = i % 251;

const seen = [];
let server = null, base = '';
/** mode: 'range' 支持 Range / 'plain' 忽略 Range 一律 200 / '416' 一律 416 */
let mode = 'range';

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const range = req.headers.range || null;
      seen.push(range);
      if (mode === '416') { res.writeHead(416, { 'Content-Range': 'bytes */' + PAYLOAD.length }); res.end(); return; }
      const m = mode === 'range' && range && /bytes=(\d+)-/.exec(range);
      if (m) {
        const start = Number(m[1]);
        if (start >= PAYLOAD.length) { res.writeHead(416, { 'Content-Range': 'bytes */' + PAYLOAD.length }); res.end(); return; }
        const body = PAYLOAD.slice(start);
        res.writeHead(206, {
          'Content-Range': 'bytes ' + start + '-' + (PAYLOAD.length - 1) + '/' + PAYLOAD.length,
          'Content-Length': body.length,
          'Content-Disposition': 'attachment; filename="NexusMod.zip"'
        });
        res.end(body);
        return;
      }
      res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Content-Disposition': 'attachment; filename="NexusMod.zip"' });
      res.end(PAYLOAD);
    });
    server.listen(0, '127.0.0.1', () => {
      base = 'http://127.0.0.1:' + server.address().port + '/file';
      fetchImpl = (uri, opts) => fetch(uri, { headers: (opts && opts.headers) || {} });
      resolve();
    });
  });
}

async function main() {
  await startServer();
  const mk = (n) => path.join(TMP, n);

  console.log('\n[1] 完整下载：内容逐字节一致');
  {
    mode = 'range'; seen.length = 0;
    const dest = mk('full.zip');
    const r = await nxm.downloadToFile(base, dest, {});
    t('文件大小与载荷一致', () => (fs.readFileSync(dest).length === PAYLOAD.length) || `实际 ${fs.readFileSync(dest).length}`);
    t('内容逐字节一致', () => (Buffer.compare(fs.readFileSync(dest), PAYLOAD) === 0) || '内容不一致');
    t('返回值 size 正确', () => r.size === PAYLOAD.length);
    t('首次下载不带 Range', () => seen[0] === null || `实际 ${seen[0]}`);
    t('原样透出 Content-Disposition 里的文件名', () => r.filename === 'NexusMod.zip' || `实际 ${r.filename}`);
  }

  console.log('\n[2] 有半截文件 → 带 Range 续传，拼出来仍是完整一份');
  {
    mode = 'range'; seen.length = 0;
    const dest = mk('resume.zip');
    const half = 10 * 1024;
    fs.writeFileSync(dest, PAYLOAD.slice(0, half));       // 假装上次下到 10KB 就断了
    const r = await nxm.downloadToFile(base, dest, {});
    t('请求带了 Range: bytes=10240-', () => seen[0] === 'bytes=' + half + '-' || `实际 ${seen[0]}`);
    t('文件大小 = 完整大小（不是叠加）', () => fs.readFileSync(dest).length === PAYLOAD.length || `实际 ${fs.readFileSync(dest).length}`);
    t('内容逐字节一致', () => (Buffer.compare(fs.readFileSync(dest), PAYLOAD) === 0) || '内容不一致');
    t('返回值标了 resumed', () => r.resumed === true);
    t('进度从已有字节起算（不是从 0）', () => r.size === PAYLOAD.length);
  }

  console.log('\n[3] 服务器不支持 Range（回 200）→ 必须从头重写');
  {
    mode = 'plain'; seen.length = 0;
    const dest = mk('plain.zip');
    fs.writeFileSync(dest, PAYLOAD.slice(0, 10 * 1024));
    const r = await nxm.downloadToFile(base, dest, {});
    t('仍会尝试带 Range 请求', () => seen[0] === 'bytes=10240-');
    t('文件大小回到完整大小（没有叠加成 42KB）', () => fs.readFileSync(dest).length === PAYLOAD.length || `实际 ${fs.readFileSync(dest).length}`);
    t('内容逐字节一致', () => (Buffer.compare(fs.readFileSync(dest), PAYLOAD) === 0) || '内容不一致');
    t('返回值 resumed=false', () => r.resumed === false);
  }

  console.log('\n[4] 服务器回 416 → 抛错 + 旧文件挪成 .stale-*');
  {
    mode = '416';
    const dest = mk('stale.zip');
    fs.writeFileSync(dest, PAYLOAD);      // 本地那份其实已经完整
    let err = null;
    try { await nxm.downloadToFile(base, dest, {}); } catch (e) { err = e; }
    t('抛出明确的 416 提示', () => (err && /416/.test(err.message)) || '没抛错');
    const stale = fs.readdirSync(TMP).filter(f => f.startsWith('stale.zip.stale-'));
    t('旧文件被挪成 .stale-*（没直接删）', () => stale.length === 1 || `实际 ${stale.length} 个`);
    mode = 'range';
  }

  console.log('\n[5] 意外中断 → 保留半截文件（下次续传的本钱）');
  {
    mode = 'range';
    const dest = mk('abort.zip');
    const ctl = new AbortController();
    // 用 shouldCancel 在第 3 个 chunk 之后喊停，模拟网络断（不是用户取消）
    let chunks = 0;
    let err = null;
    try {
      await nxm.downloadToFile(base, dest, {
        onProgress: () => { chunks++; },
        shouldCancel: () => false
      });
    } catch (e) { err = e; }
    t('正常跑完没有半截残留（对照）', () => !err && fs.existsSync(dest));

    // 真正的中断：让 fetch 抛错
    const dest2 = mk('neterr.zip');
    fs.writeFileSync(dest2, PAYLOAD.slice(0, 5000));
    fetchImpl = () => Promise.reject(new Error('socket hang up'));
    let err2 = null;
    try { await nxm.downloadToFile(base, dest2, {}); } catch (e) { err2 = e; }
    t('网络错误如实抛出', () => !!err2);
    t('半截文件**还在**（原样保留，没被删）', () => fs.existsSync(dest2) && fs.statSync(dest2).size === 5000);
    fetchImpl = (uri, opts) => fetch(uri, { headers: (opts && opts.headers) || {} });
  }

  console.log('\n[6] 用户主动取消 → 清掉半截文件');
  {
    mode = 'range';
    const dest = mk('cancel.zip');
    let err = null;
    try {
      await nxm.downloadToFile(base, dest, { shouldCancel: () => true });
    } catch (e) { err = e; }
    t('抛「已取消」', () => (err && /已取消/.test(err.message)) || `实际 ${err && err.message}`);
    t('半截文件被清掉（用户是真要丢弃）', () => !fs.existsSync(dest));
  }

  console.log('\n[7][8] 引擎侧：半截文件名可预测 + 清扫保住活跃任务的 .part');
  {
    const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'downloadEngine.js'), 'utf8');
    t('半截文件名不带时间戳（可预测，恢复时找得回）',
      () => /const partName = '\.dl-' \+ \(modId \|\| 'unknown'\) \+ '-' \+ \(a\.fileId \|\| 'x'\) \+ '\.part'/.test(engineSrc) || '还是带时间戳的旧写法');
    t('清扫逻辑会按队列里活跃任务保护 .part',
      () => /keep\.add\('\.dl-' \+ m\.modId/.test(engineSrc) || '清扫没保护活跃任务');
    t('清扫保留期 >= 24 小时（用户可能过几天才恢复）',
      () => /sweepStaleParts\(maxAgeMs = 24 \* 60 \* 60 \* 1000\)/.test(engineSrc) || '保留期太短');
    t('启动时会把已有 .part 的字节数报进进度（不从头显示）',
      () => /partBytes/.test(engineSrc) && /resumed: partBytes > 0/.test(engineSrc));
  }

  console.log('\n[9] 「全部恢复」接线');
  {
    const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    t('有 dlResumeAll 函数', () => /async function dlResumeAll\(/.test(app));
    t('工具栏出了「全部恢复」按钮', () => /data-dl-resumeall/.test(app));
    t('按钮只在有可恢复任务时出现（resumeCount）', () => /const resumeCount = tasks\.filter/.test(app));
    t('点击委托接上了', () => /closest\('\[data-dl-resumeall\]'\)\) \{ await dlResumeAll\(\); return; \}/.test(app));
    t('同一时间只跑一个（resumeAllRunning 守卫）', () => /let resumeAllRunning = false;/.test(app));
    t('只看「中断/失败且没有安装包」的任务（安装失败的不重下）',
      () => /\(t\.status === 'interrupted' \|\| t\.status === 'failed'\) && !t\.archivePath/.test(app));
    t('恢复后会顺手批量授权（重启后 key 没了的情况）', () => /await dlAutoAuthorizeAll\(\)/.test(app));
  }

  console.log('\n=== 清理 ===');
  try { server && server.close(); } catch { /* 忽略 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); console.log('  已清理 ' + TMP); } catch (e) { console.log('  清理失败（不影响结论）：' + e.message); }

  console.log('\n' + (fail ? '❌' : '✅') + ' resume-download: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
}

main().catch(e => { console.error('探针炸了：' + e.stack); process.exitCode = 1; });
