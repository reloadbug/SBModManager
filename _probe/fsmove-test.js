'use strict';

/**
 * fsMove 探针：跨卷搬运（卸载时把文件移到备份目录、下载完把包搬进安装包目录）
 *
 * 起因（2026-11-07 用户报障）：
 *   游戏在 `c:\Star Blade`、管理器数据在 `d:\AI game\StarBladeModManager\data`，
 *   卸载 Mod 时 `fs.renameSync` 直接报
 *     EXDEV: cross-device link not permitted, rename 'c:\…\x.pak' -> 'd:\…\x.pak'
 *   于是「卸载」整个失败。
 *
 * 这里用「真文件 + 把 renameSync 换成必抛 EXDEV」的方式跑真实代码路径，
 * 不靠记忆，也不依赖测试机真的有两个盘。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const fsMove = require('../src/main/fsMove');

let pass = 0;
let fail = 0;
const fails = [];

function ok(label, cond) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label + ' → 实际 ' + a + '，期望 ' + e); console.log('  ✗ ' + label + '（实际 ' + a + '，期望 ' + e + '）'); }
}

function exdev() {
  const e = new Error('EXDEV: cross-device link not permitted');
  e.code = 'EXDEV';
  return e;
}

/** 造一个「rename 必抛 EXDEV、其余照旧」的 fs 视图 */
function crossDeviceFs(real = fs) {
  return Object.assign(Object.create(null), real, {
    renameSync: () => { throw exdev(); },
    promises: Object.assign(Object.create(null), real.promises, {
      rename: async () => { throw exdev(); }
    })
  });
}

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fsmove-'));

/* ============================ A. 卷判定 ============================ */
console.log('\n=== A) sameVolume / isCrossDevice ===');
ok('同盘 → true', fsMove.sameVolume('c:\\a\\b', 'C:\\x\\y'));
ok('异盘 → false', fsMove.sameVolume('c:\\a', 'd:\\a') === false);
ok('相对路径按 cwd 解析后比较（同盘）', fsMove.sameVolume('a/b', 'c/d'));
eq(fsMove.isCrossDevice(exdev(), 'c:\\a', 'd:\\b'), true, 'EXDEV → 走复制');
ok('EPERM + 异盘 → 走复制（Windows 目录跨卷有时给 EPERM）',
  fsMove.isCrossDevice(Object.assign(new Error('EPERM'), { code: 'EPERM' }), 'c:\\a', 'd:\\b') === true);
ok('EPERM + 同盘 → 不兜底（真权限问题就该报出来）',
  fsMove.isCrossDevice(Object.assign(new Error('EPERM'), { code: 'EPERM' }), 'c:\\a', 'c:\\b') === false);
ok('普通错误 → 不兜底', fsMove.isCrossDevice(new Error('boom'), 'c:\\a', 'd:\\b') === false);
ok('空错误 → 不兜底', fsMove.isCrossDevice(null, 'c:\\a', 'd:\\b') === false);

/* ============================ B. 单文件：EXDEV 退化成复制 ============================ */
console.log('\n=== B) movePath（文件）===');
const srcFile = path.join(tmp, 'src', 'Eve_XRX_Copsuit2026_P.pak');
const dstFile = path.join(tmp, 'backup', 'uninstalled', 'nexus_3895_16874', 'Eve_XRX_Copsuit2026_P.pak');
fs.mkdirSync(path.dirname(srcFile), { recursive: true });
fs.writeFileSync(srcFile, 'PAK-CONTENT-3895', 'utf8');

const via = fsMove.movePath(srcFile, dstFile, { fs: crossDeviceFs() });
eq(via, 'copy', '跨卷时返回 copy（说明真退化了）');
ok('目标文件存在', fs.existsSync(dstFile));
eq(fs.readFileSync(dstFile, 'utf8'), 'PAK-CONTENT-3895', '内容一致');
ok('源文件已删掉（否则游戏还会加载它）', !fs.existsSync(srcFile));

const srcFile2 = path.join(tmp, 'src', 'B.pak');
const dstFile2 = path.join(tmp, 'backup', 'B.pak');
fs.writeFileSync(srcFile2, 'BBBB', 'utf8');
eq(fsMove.movePath(srcFile2, dstFile2), 'rename', '同卷时走 rename（不复制）');
ok('同卷 rename 后源没了、目标在', !fs.existsSync(srcFile2) && fs.existsSync(dstFile2));

const srcFile3 = path.join(tmp, 'src', 'C.pak');
fs.writeFileSync(srcFile3, 'CCCC', 'utf8');
let thrown = null;
try {
  fsMove.movePath(srcFile3, path.join(tmp, 'backup', 'C.pak'), { fs: Object.assign(crossDeviceFs(), {
    copyFileSync: () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
  }) });
} catch (e) { thrown = e; }
ok('复制本身失败 → 原错误往上抛（不吞）', thrown && thrown.code === 'EACCES');

const srcFile4 = path.join(tmp, 'src', 'D.pak');
const dstFile4 = path.join(tmp, 'backup', 'D.pak');
fs.writeFileSync(srcFile4, 'DDDD', 'utf8');
let thrown2 = null;
try {
  fsMove.movePath(srcFile4, dstFile4, { fs: Object.assign(crossDeviceFs(), {
    unlinkSync: () => { const e = new Error('EBUSY: resource busy'); e.code = 'EBUSY'; throw e; }
  }) });
} catch (e) { thrown2 = e; }
ok('复制成功但删源失败 → 抛出带 copied 标记的人话错误', thrown2 && thrown2.copied === true && /删不掉/.test(thrown2.message));
ok('这种情况下备份里确实有副本', fs.existsSync(dstFile4));

/* ============================ C. 目录：保留结构 ============================ */
console.log('\n=== C) movePath（目录，如脚本 mod 的整个文件夹）===');
const srcDir = path.join(tmp, 'mods', 'DekCNS');
const dstDir = path.join(tmp, 'backup', 'DekCNS');
fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
fs.writeFileSync(path.join(srcDir, 'enabled.txt'), '1', 'utf8');
fs.writeFileSync(path.join(srcDir, 'sub', 'x.lua'), 'print(1)', 'utf8');

eq(fsMove.movePath(srcDir, dstDir, { fs: crossDeviceFs() }), 'copy', '目录跨卷也走复制');
ok('子目录结构保留', fs.existsSync(path.join(dstDir, 'sub', 'x.lua')));
ok('源目录已删除', !fs.existsSync(srcDir));

/* ============================ D. 异步版本（下载完搬包）============================ */
console.log('\n=== D) movePathAsync ===');
(async () => {
  const a = path.join(tmp, 'tmpdl', '3895_Eve_XRX_Copsuit.zip');
  const b = path.join(tmp, 'library', '3895_Eve_XRX_Copsuit_1.0.zip');
  fs.mkdirSync(path.dirname(a), { recursive: true });
  fs.writeFileSync(a, 'ZIPDATA', 'utf8');
  const v = await fsMove.movePathAsync(a, b, { fs: crossDeviceFs() });
  eq(v, 'copy', '异步跨卷 → copy');
  ok('包到了安装包目录', fs.existsSync(b) && fs.readFileSync(b, 'utf8') === 'ZIPDATA');
  ok('临时文件已清掉', !fs.existsSync(a));

  const c = path.join(tmp, 'tmpdl', '2.zip');
  const d = path.join(tmp, 'library', '2.zip');
  fs.writeFileSync(c, 'YYY', 'utf8');
  eq(await fsMove.movePathAsync(c, d), 'rename', '同卷仍是 rename');

  /* ============================ E. 接线断言 ============================ */
  console.log('\n=== E) 接线：卸载 / 下载搬包 ===');
  const ipc = read('src/main/ipc.js');
  ok('ipc 引入 fsMove', ipc.includes("require('./fsMove')"));
  ok('卸载不再直接 renameSync 到备份目录',
    !/uninstalled[\s\S]{0,1200}fs\.renameSync\(/.test(ipc));
  const uAt = ipc.indexOf('function uninstall(');
  const uninstallSeg = ipc.slice(uAt, uAt + 4600);
  ok('卸载段里三处搬运都走 fsMove.movePath',
    (uninstallSeg.match(/fsMove\.movePath\(/g) || []).length >= 3);

  const eng = read('src/main/downloadEngine.js');
  ok('downloadEngine 引入 fsMove', eng.includes("require('./fsMove')"));
  ok('finalizeArchive 用 movePathAsync（跨卷也能把包搬进安装包目录）',
    /fsMove\.movePathAsync\(downloadedPath, dest\)/.test(eng));
  ok('老库迁移也用 fsMove.movePath', /fsMove\.movePath\(src, dest\)/.test(eng));
  ok('finalizeArchive 不再直接 rename', !/fsPromises\.rename\(downloadedPath/.test(eng));

  const docs = read('docs/架构设计.md');
  ok('模块树里记了 fsMove.js', /fsMove\.js/.test(docs));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========================================================');
  if (fail) {
    console.log(`❌ fsmove: ${pass} 通过 / ${fail} 失败`);
    for (const f of fails) console.log('   · ' + f);
    process.exitCode = 1;
  } else {
    console.log(`✅ fsmove: ${pass} 通过 / 0 失败`);
  }
})();
