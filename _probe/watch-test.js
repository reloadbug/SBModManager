'use strict';
/**
 * 下载目录监听自检。
 *
 * 覆盖两件事：
 *   1. `parseNexusFileName` —— 从 Nexus 手动下载的文件名里解析 modId
 *      （这是「能不能自动安装」的唯一判据，误判会装错东西，必须严）
 *   2. `createDownloadWatcher` —— 发现新压缩包 / 等文件稳定 / 去重 / 忽略半截文件
 *
 * 用法：
 *   node _probe/watch-test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createDownloadWatcher, parseNexusFileName, prettyName } = require('../src/main/downloadWatcher');
const { readJson, writeJson } = require('../src/main/store');

const BASE = path.join(os.tmpdir(), 'sb-watch-test');
const DL = path.join(BASE, 'downloads');

let pass = 0, fail = 0;

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- 1) 文件名解析 ---------------- */

console.log('\n=== 1) parseNexusFileName：真实 Nexus 手动下载命名 ===');
t('CustomNanosuitSystem-1496-2-2-1791651882264.zip → modId 1496', () => {
  const r = parseNexusFileName('CustomNanosuitSystem-1496-2-2-1791651882264.zip');
  if (!r) return '返回 null';
  return (r.modId === 1496 && r.name === 'CustomNanosuitSystem' && r.version === '2-2') || JSON.stringify(r);
});
t('SomeMod-123-1.0-1791651882264.7z → modId 123 / version 1.0', () => {
  const r = parseNexusFileName('SomeMod-123-1.0-1791651882264.7z');
  if (!r) return '返回 null';
  return (r.modId === 123 && r.version === '1.0' && r.ext === '7z') || JSON.stringify(r);
});
t('下划线转空格：Some_Mod-42-1-1791651882264.zip → 名字 "Some Mod"', () => {
  const r = parseNexusFileName('Some_Mod-42-1-1791651882264.zip');
  if (!r) return '返回 null';
  return (r.name === 'Some Mod' && r.modId === 42) || JSON.stringify(r);
});
t('13 位毫秒时间戳才算（9 位不算）', () => {
  const r = parseNexusFileName('Mod-1-1-123456789.zip');
  return r === null || '不该识别：' + JSON.stringify(r);
});

console.log('\n=== 2) 误判防护：普通压缩包一律不认 ===');
for (const name of [
  'random.zip',
  'My-Mod-1-2-3.zip',            // 末段只有 1 位数字
  'backup-2026-10-11.zip',       // 末段不是纯数字
  'UE4SS_v3.1.0-6.zip',          // GitHub 发布包命名
  'archive.7z',
  'data.rar'
]) {
  t(name + ' → null', () => {
    const r = parseNexusFileName(name);
    return r === null || '不该识别：' + JSON.stringify(r);
  });
}

console.log('\n=== 3) prettyName 兜底显示名 ===');
t('去扩展名 + 下划线转空格', () => {
  const r = prettyName('My_Cool_Mod_v2.zip');
  return r === 'My Cool Mod v2' || r;
});

/* ---------------- 4) 监听器 ---------------- */

(async function main() {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });

  const found = [];
  const w = createDownloadWatcher({
    dirs: [DL],
    seenFile: path.join(BASE, 'watch-seen.json'),
    readJson, writeJson,
    stableMs: 250,
    pollMs: 120,
    onArchive: (f) => found.push(f)
  });

  // 启动前先放一个「旧文件」—— 启动时的首次扫描必须**静默**（只记账，不弹提示）
  fs.writeFileSync(path.join(DL, 'OldMod-111-1-1791651882264.zip'), 'old');

  w.start();

  console.log('\n=== 4) 启动时的存量文件不打扰用户 ===');
  await sleep(500);
  t('启动扫描不触发 onArchive', () => found.length === 0 || '触发了 ' + found.length + ' 次');
  t('存量文件已被记账（seen > 0）', () => w.seenCount() >= 1 || String(w.seenCount()));

  console.log('\n=== 5) 新压缩包 → 等稳定后触发 ===');
  fs.writeFileSync(path.join(DL, 'NewMod-222-1-1791651882264.zip'), 'x'.repeat(500));
  await sleep(900);
  t('触发了一次', () => found.length === 1 || '触发了 ' + found.length + ' 次');
  t('解析出了 modId 222', () => found[0] && found[0].modId === 222 || JSON.stringify(found[0]));
  t('带上了文件大小', () => found[0] && found[0].size === 500 || String(found[0] && found[0].size));
  t('nexus 标记为 true', () => found[0] && found[0].nexus === true || String(found[0] && found[0].nexus));

  console.log('\n=== 6) 去重：同一个文件不再触发第二次 ===');
  const before = found.length;
  const r1 = w.scanNow();
  t('scanNow 不重复报同一个文件', () => r1.length === 0 || '又报了 ' + r1.length + ' 个');
  t('总数没变', () => found.length === before || String(found.length));

  console.log('\n=== 7) 半截文件被忽略 ===');
  fs.writeFileSync(path.join(DL, 'HalfMod-333-1-1791651882264.zip.part'), 'partial');
  fs.writeFileSync(path.join(DL, 'HalfMod2-444-1-1791651882264.zip.crdownload'), 'partial');
  await sleep(700);
  t('没有因为 .part / .crdownload 触发', () => found.length === before || '触发了：' + JSON.stringify(found.map(f => f.name)));
  t('也没有被记进 seen', () => {
    const j = readJson(path.join(BASE, 'watch-seen.json'), {});
    const keys = Object.keys(j.seen || {});
    return !keys.some(k => /\.part$|\.crdownload$/.test(k)) || keys.join(',');
  });

  console.log('\n=== 8) 覆盖重下（内容变了）→ 再次触发 ===');
  fs.writeFileSync(path.join(DL, 'NewMod-222-1-1791651882264.zip'), 'y'.repeat(900));
  await sleep(900);
  t('文件变了会重新触发', () => found.length === before + 1 || '总数 ' + found.length);
  t('第二次报的大小是新的', () => {
    const last = found[found.length - 1];
    return last && last.size === 900 || String(last && last.size);
  });

  console.log('\n=== 9) 识别不出来源的包也照样导入（只是 nexus=false） ===');
  const before9 = found.length;
  fs.writeFileSync(path.join(DL, 'SomeRandomPack.zip'), 'z'.repeat(300));
  await sleep(900);
  t('触发了', () => found.length === before9 + 1 || '总数 ' + found.length);
  t('modId 为 null', () => {
    const last = found[found.length - 1];
    return last && last.modId === null || JSON.stringify(last);
  });
  t('显示名去掉了扩展名', () => {
    const last = found[found.length - 1];
    return last && last.displayName === 'SomeRandomPack' || String(last && last.displayName);
  });

  console.log('\n=== 10) forget / markAllSeen ===');
  t('forget 已记过的文件返回 true', () => w.forget(path.join(DL, 'SomeRandomPack.zip')) === true || 'false');
  const r2 = w.scanNow();
  t('forget 之后能被重新发现', () => r2.length === 1 || '报了 ' + r2.length + ' 个');
  const n = w.markAllSeen();
  t('markAllSeen 记下了现有文件', () => n >= 3 || String(n));
  const r3 = w.scanNow();
  t('markAllSeen 之后不再报', () => r3.length === 0 || '报了 ' + r3.length + ' 个');

  console.log('\n=== 11) setDirs 会忽略不存在的目录 ===');
  const dirs = w.setDirs([DL, path.join(BASE, 'no-such-dir')]);
  t('只保留存在的目录', () => dirs.length === 1 && path.resolve(dirs[0]).toLowerCase() === path.resolve(DL).toLowerCase() || JSON.stringify(dirs));

  console.log('\n=== 12) stop 之后不再触发 ===');
  w.stop();
  const beforeStop = found.length;
  fs.writeFileSync(path.join(DL, 'AfterStop-555-1-1791651882264.zip'), 'q'.repeat(100));
  await sleep(600);
  t('停掉后不触发', () => found.length === beforeStop || '又触发了 ' + (found.length - beforeStop));

  console.log('\n=== 清理 ===');
  fs.rmSync(BASE, { recursive: true, force: true });
  console.log('  ✓ 已清理临时目录');

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})();
