'use strict';
/**
 * 安装并发 / 零写入保护 / 账本口径自检（2026-11-25）。
 *
 * 用户报「库里压缩包安装后没解压、却记成已启用」。根因三重叠加：
 *   ① installer.install 临时目录用 Date.now()（毫秒），并发安装撞车 → 先完成者删掉对方的解压文件；
 *   ② written===0 仍返回成功 → 注册表记成「已装、已启用」；
 *   ③ packageLedger 只看 plan.mapping，不校验实际写入 → 账本记「7/7 全装」却与空 manifest 矛盾。
 * 本探针验证三处修复，全部在临时目录进行，不碰真实游戏目录。
 *
 * 用法：node _probe/install-concurrency-test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../src/main/installer');
const paths = require('../src/main/paths');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-install-concurrency-test');
const PKG = path.join(BASE, 'pkg');
const ROOT = path.join(BASE, 'fakeroot');

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}
async function ta(label, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

function mk(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(base, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
}
function zip(name, files) {
  const stage = path.join(BASE, 'src', name);
  fs.rmSync(stage, { recursive: true, force: true });
  mk(stage, files);
  const out = path.join(PKG, name + '.zip');
  fs.mkdirSync(PKG, { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx1', out, '.'], { cwd: stage, stdio: 'ignore' });
  return out;
}
const abs = (...segs) => path.join(ROOT, ...segs);

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(PKG, { recursive: true });
  mk(ROOT, {
    'SB.exe': 'launcher',
    'SB/Binaries/Win64/SB-Win64-Shipping.exe': 'exe',
    'SB/Content/Paks/pakchunk0.pak': 'base'
  });
  const bakRoot = path.join(BASE, 'backup');
  fs.mkdirSync(bakRoot, { recursive: true });

  console.log('=== A. 临时目录唯一性 ===');
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'installer.js'), 'utf8');
  t('临时目录含进程内自增序号 extractSeq', () =>
    /let\s+extractSeq\s*=\s*0/.test(code) && /extract-\'\s*\+\s*stamp\s*\+\s*\'\-\'\s*\+\s*\(\+\+extractSeq\)/.test(code) ? true : '未找到唯一化代码');
  t('临时目录还拼了随机串', () =>
    /Math\.random\(\)\.toString\(36\)/.test(code) ? true : '没有随机串');

  console.log('');
  console.log('=== B. 零写入保护 ===');
  t('install 内有 srcMissing 零写入刹车', () =>
    /total\s*>\s*0\s*&&\s*written\s*===\s*0\s*&&\s*srcMissing\s*>\s*0/.test(code) && /全部找不到/.test(code) ? true : '没有零写入刹车');

  // 真跑：篡改 mapping.from 让全部 src 不存在 → 应抛错，不能返回成功
  const badZip = zip('zerowrite', { 'ZeroWrite_P.pak': 'a', 'ZeroWrite_P.ucas': 'b', 'ZeroWrite_P.utoc': 'c' });
  const badPlan = await installer.analyze(ROOT, badZip, { name: 'ZeroWrite' });
  badPlan.mapping = badPlan.mapping.map(m => ({ ...m, from: 'NO_SUCH_DIR/' + m.from }));
  await ta('全部 src 不存在时 install 抛错（不假成功）', async () => {
    try {
      await installer.install(ROOT, badPlan, { backup: false });
      return 'install 竟然返回成功（假成功未拦住）';
    } catch (e) {
      return /一个都没写进游戏目录/.test(e.message) ? true : '抛了别的错：' + e.message;
    }
  });

  console.log('');
  console.log('=== C. 账本基于实际写入 manifest ===');
  const goodZip = zip('ledger', { 'Ledger_P.pak': 'a', 'Ledger_P.ucas': 'b', 'Ledger_P.utoc': 'c' });
  const goodPlan = await installer.analyze(ROOT, goodZip, { name: 'Ledger' });
  t('packageLedger 源码接受 installedManifest 参数', () =>
    /function\s+packageLedger\(plan,\s*installedManifest/.test(code) ? true : '签名不匹配');
  t('传空 manifest → installedCount=0', () => {
    const led = installer.packageLedger(goodPlan, []);
    return led.installedCount === 0 ? true : 'installedCount=' + led.installedCount;
  });
  t('传实际 manifest → installedCount=manifest 长度', () => {
    const manifest = goodPlan.mapping.slice(0, 2).map(m => ({ path: m.to, rel: m.rel, size: m.size }));
    const led = installer.packageLedger(goodPlan, manifest);
    return led.installedCount === 2 ? true : 'installedCount=' + led.installedCount;
  });
  t('不传 manifest → 退回 plan.mapping（兼容旧调用）', () => {
    const led = installer.packageLedger(goodPlan);
    return led.installedCount === goodPlan.mapping.length ? true : 'installedCount=' + led.installedCount;
  });

  console.log('');
  console.log('=== D. installFlow 把实际 manifest 传给账本 ===');
  const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'installFlow.js'), 'utf8');
  t('packageLedger(plan, r.manifest)', () =>
    /packageLedger\(plan,\s*r\.manifest\)/.test(flow) ? true : '未传 r.manifest');

  console.log('');
  console.log('=== E. 并发安装两个包都写成功（端到端）===');
  const zA = zip('concurrentA', {
    'Kamenlaideng_Nun_CNS/A_P.pak': 'a', 'Kamenlaideng_Nun_CNS/A_P.ucas': 'b', 'Kamenlaideng_Nun_CNS/A_P.utoc': 'c',
    'Kamenlaideng_Nun_CNS/A.dekcns.json': '{}'
  });
  const zB = zip('concurrentB', {
    'Yor_cns_636/B_P.pak': 'a', 'Yor_cns_636/B_P.ucas': 'b', 'Yor_cns_636/B_P.utoc': 'c',
    'Yor_cns_636/B.dekcns.json': '{}'
  });
  const pA = await installer.analyze(ROOT, zA, { name: 'ConcurrentA', modId: 900001 });
  const pB = await installer.analyze(ROOT, zB, { name: 'ConcurrentB', modId: 900002 });
  await ta('两个安装并发跑完，各自 manifest 都非空', async () => {
    const [rA, rB] = await Promise.all([
      installer.install(ROOT, pA, { backup: false }),
      installer.install(ROOT, pB, { backup: false })
    ]);
    if (!rA.written || !rB.written) return 'written A=' + rA.written + ' B=' + rB.written;
    if (!rA.manifest.length || !rB.manifest.length) return 'manifest A=' + rA.manifest.length + ' B=' + rB.manifest.length;
    return true;
  });
  await ta('并发安装后 A 的文件确实在磁盘上', async () => {
    const anyA = pA.mapping.find(m => /\.pak$/i.test(m.rel));
    return anyA && fs.existsSync(anyA.to) ? true : 'A 的 pak 不在磁盘上';
  });
  await ta('并发安装后 B 的文件确实在磁盘上', async () => {
    const anyB = pB.mapping.find(m => /\.pak$/i.test(m.rel));
    return anyB && fs.existsSync(anyB.to) ? true : 'B 的 pak 不在磁盘上';
  });

  console.log('');
  console.log('===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
