'use strict';
/**
 * libraryMigrate 搬家核心的探针。
 * 纯函数用内存假 fs；端到端/断点续传用 os.tmpdir 下的真实小文件（几个字节，不碰用户 14GB 库）。
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const LM = require('../src/main/libraryMigrate');

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === false) throw new Error('返回 false'); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}
function mkRoot(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmig-' + tag + '-'));
  return { base, src: path.join(base, 'src'), dest: path.join(base, 'dest') };
}
function put(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(String(content)));
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

(async () => {
  console.log('\n=== A 纯函数 / 常量 ===');
  t('A1 ARCHIVE_RE 只认 zip/7z/rar', () => LM.ARCHIVE_RE.test('a.zip') && LM.ARCHIVE_RE.test('b.7Z') && LM.ARCHIVE_RE.test('c.rar') && !LM.ARCHIVE_RE.test('d.part') && !LM.ARCHIVE_RE.test('e.exe'));
  t('A2 CONFLICT_MODES 三档', () => LM.CONFLICT_MODES.has('skip-same') && LM.CONFLICT_MODES.has('skip-all') && LM.CONFLICT_MODES.has('overwrite') && !LM.CONFLICT_MODES.has('bogus'));
  t('A3 under 路径包含判定', () => LM.under('C:\\a\\b\\c', 'C:\\a\\b') && LM.under('C:\\a\\b', 'C:\\a\\b') && !LM.under('C:\\a\\bc', 'C:\\a\\b'));
  t('A4 norm 统一斜杠/去尾', () => LM.norm('C:/a/b/') === 'c:\\a\\b');
  t('A5 decide skip-same 同名同大小跳过', () => LM.decide({ name: 'x.zip', size: 100 }, 'skip-same', { exists: true, sameSize: true }).startsWith('skip'));
  t('A6 decide skip-same 同名不同大小要搬', () => LM.decide({ name: 'x.zip', size: 100 }, 'skip-same', { exists: true, sameSize: false }) === 'move');
  t('A7 decide skip-all 一律跳过', () => LM.decide({ name: 'x.zip', size: 100 }, 'skip-all', { exists: true, sameSize: false }) === 'skip');
  t('A8 decide overwrite 覆盖', () => LM.decide({ name: 'x.zip', size: 100 }, 'overwrite', { exists: true, sameSize: true }) === 'done-overwrite');
  t('A9 目标不存在就搬', () => LM.decide({ name: 'x.zip', size: 100 }, 'skip-all', { exists: false }) === 'move');

  console.log('\n=== B plan 预检（真 fs） ===');
  const r1 = mkRoot('plan');
  put(r1.src, '111_a_v1.zip', 'A'.repeat(100));
  put(r1.src, '222_b_v2.7z', 'B'.repeat(200));
  put(r1.src, 'note.txt', 'skip me');
  put(r1.src, '.part', 'skip');
  put(r1.src, '.sbm-partial-x.rar', 'skip');
  t('B1 只列压缩包', () => { const a = LM.listArchives(r1.src); return a.length === 2 && a.every(x => LM.ARCHIVE_RE.test(x.name)); });
  t('B2 plan 计数正确', () => { const p = LM.plan(r1.src, r1.dest); return p.count === 2 && p.totalBytes === 300 && p.conflicts === 0; });
  t('B3 plan 拒绝同一个目录', () => { try { LM.plan(r1.src, r1.src); return false; } catch (e) { return /同一个/.test(e.message); } });
  t('B4 plan 拒绝目标是源的子目录', () => { try { LM.plan(r1.src, path.join(r1.src, 'sub')); return false; } catch (e) { return /子目录/.test(e.message); } });
  t('B5 plan 拒绝源是目标的子目录', () => { try { LM.plan(path.join(r1.dest, 'sub'), r1.dest); return false; } catch (e) { return /子目录/.test(e.message); } });
  t('B6 plan.resumable 初始 false', () => LM.plan(r1.src, r1.dest).resumable === false);
  rmrf(r1.base);

  console.log('\n=== C manifest 持久化（真 fs） ===');
  const r2 = mkRoot('mf');
  t('C1 写后读回', () => { LM.saveManifest(r2.dest, { src: r2.src, dest: r2.dest, items: [{ name: 'x.zip', status: 'done' }] }); const m = LM.loadManifest(r2.dest); return !!m && m.items.length === 1 && m.items[0].status === 'done'; });
  t('C2 resumable 变 true', () => LM.plan(r2.src, r2.dest).resumable === true);
  t('C3 坏清单返回 null', () => { fs.writeFileSync(LM.manifestPath(r2.dest), '{bad json'); return LM.loadManifest(r2.dest) === null; });
  rmrf(r2.base);

  console.log('\n=== D migrate 端到端（真 fs + 真 movePathAsync） ===');
  const r3 = mkRoot('mig');
  put(r3.src, '111_a_v1.zip', 'A'.repeat(100));
  put(r3.src, '222_b_v2.7z', 'B'.repeat(200));
  let progressEvents = [];
  await ta('D1 首次搬运全部成功', async () => {
    const r = await LM.migrate({ srcDir: r3.src, destDir: r3.dest, mode: 'skip-same', onProgress: x => progressEvents.push(x) });
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.moved, 2);
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(r.bytes, 300);
    assert.strictEqual(r.aborted, false);
  });
  t('D2 两个包都到了目标', () => fs.existsSync(path.join(r3.dest, '111_a_v1.zip')) && fs.existsSync(path.join(r3.dest, '222_b_v2.7z')));
  t('D3 源包都删了（真搬家）', () => !fs.existsSync(path.join(r3.src, '111_a_v1.zip')) && !fs.existsSync(path.join(r3.src, '222_b_v2.7z')));
  t('D4 进度事件含 start + 每件 + done', () => progressEvents.some(x => x.phase === 'start') && progressEvents.some(x => x.phase === 'done') && progressEvents.filter(x => x.name).length === 2);
  t('D5 清单里两件都 done', () => { const m = LM.loadManifest(r3.dest); return !!m && m.items.every(x => x.status === 'done'); });
  t('D6 sourceRemaining 空', () => LM.sourceRemaining(r3.src).length === 0);
  rmrf(r3.base);

  console.log('\n=== E 断点续传 / 冲突档位（真 fs） ===');
  const r4 = mkRoot('conflict');
  put(r4.src, '1.zip', 'X'.repeat(50));
  put(r4.src, '2.zip', 'Y'.repeat(60));
  put(r4.dest, '1.zip', 'X'.repeat(50)); // 同名同大小
  await ta('E1 skip-same 同名同大小跳过、另一个搬走', async () => {
    const r = await LM.migrate({ srcDir: r4.src, destDir: r4.dest, mode: 'skip-same' });
    assert.strictEqual(r.skipped, 1);
    assert.strictEqual(r.moved, 1);
  });
  t('E2 同名的源没被删（跳过档不删源）', () => fs.existsSync(path.join(r4.src, '1.zip')));
  rmrf(r4.base);

  const r5 = mkRoot('resume');
  put(r5.src, 'a.zip', 'a'.repeat(10));
  put(r5.src, 'b.zip', 'b'.repeat(20));
  put(r5.src, 'c.zip', 'c'.repeat(30));
  LM.saveManifest(r5.dest, { src: r5.src, dest: r5.dest, items: [
    { name: 'a.zip', size: 10, status: 'done' },
    { name: 'b.zip', size: 20, status: 'done' },
    { name: 'c.zip', size: 30, status: 'pending' }
  ] });
  let names = [];
  await ta('E3 中断后 resume 只补未 done', async () => {
    const r = await LM.migrate({ srcDir: r5.src, destDir: r5.dest, mode: 'skip-same', resume: true, onProgress: x => { if (x.name && x.action === 'moved') names.push(x.name); } });
    assert.strictEqual(r.skipped, 2);
    assert.strictEqual(r.moved, 1);
  });
  t('E4 只搬了 c.zip', () => names.length === 1 && names[0] === 'c.zip');
  t('E5 a/b 源还在（续传跳过不删源）', () => fs.existsSync(path.join(r5.src, 'a.zip')) && fs.existsSync(path.join(r5.src, 'b.zip')));
  rmrf(r5.base);

  const r6 = mkRoot('ovr');
  put(r6.src, 'x.zip', 'NEW'.repeat(30));
  put(r6.dest, 'x.zip', 'OLD'.repeat(10));
  await ta('E6 overwrite 覆盖同名', async () => {
    const r = await LM.migrate({ srcDir: r6.src, destDir: r6.dest, mode: 'overwrite' });
    assert.strictEqual(r.moved, 1);
  });
  t('E7 目标是新内容', () => fs.readFileSync(path.join(r6.dest, 'x.zip'), 'utf8') === 'NEW'.repeat(30));
  rmrf(r6.base);

  const r7 = mkRoot('abort');
  put(r7.src, '1.zip', '1');
  put(r7.src, '2.zip', '2');
  await ta('E8 abort 信号中止', async () => {
    const ctrl = { aborted: true };
    const r = await LM.migrate({ srcDir: r7.src, destDir: r7.dest, mode: 'skip-same', signal: ctrl });
    assert.strictEqual(r.aborted, true);
    assert.strictEqual(r.moved, 0);
  });
  rmrf(r7.base);

  console.log('\n=== F 常量/接线静态断言（接完 IPC/UI 后应全绿） ===');
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc.js'), 'utf8');
  t('F1 ipc require libraryMigrate', () => /require\('\.\/libraryMigrate'\)/.test(ipc));
  t('F2 ipc 有 library:migratePlan', () => /handle\('library:migratePlan'/.test(ipc));
  t('F3 ipc 有 library:migrateStart', () => /handle\('library:migrateStart'/.test(ipc));
  t('F4 ipc 有 library:migrateCancel', () => /handle\('library:migrateCancel'/.test(ipc));
  t('F5 ipc 推 library:migrateProgress', () => /sendToMain\('library:migrateProgress'/.test(ipc));
  const pre = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
  t('F6 preload 暴露三个方法 + 进度订阅', () => /migratePlan:/.test(pre) && /migrateStart:/.test(pre) && /migrateCancel:/.test(pre) && /onMigrateProgress:/.test(pre));
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  t('F7 渲染层有 btnLibMigrate', () => /btnLibMigrate/.test(app));
  t('F8 渲染层有搬家弹窗函数', () => /openLibMigrateModal/.test(app));

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
