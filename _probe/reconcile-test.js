'use strict';
/**
 * 「账本与磁盘一致性」离线断言套件（0.3.6）。
 *
 * 用户提的问题：手动删掉 Mod 文件之后，已安装列表还照样列着它（因为账本没变）。
 * 这块逻辑全在 `src/main/reconcile.js` 里，是**纯函数**：只算、不写盘，
 * 写盘由调用方（ipc 的 `reconcileRegistry()`）决定。所以这里能全离线断言。
 *
 * 覆盖六块：
 *   A. `plan()` —— 文件全丢 → 移除整条；只缺一部分 → 裁剪清单；开关按磁盘纠正
 *   B. `apply()` —— 先裁剪/纠开关（patchMany 一次写），再逐条 remove
 *   C. `planQueue()` —— 已安装但游戏里找不到 → 有安装包降「已下载」，没有降「失败」
 *   D. `noteworthy()` / `summarize()` —— 给界面用的一句话
 *   E. 真文件系统跑一遍 —— 用真 registry 验证「删文件 → 记录消失」
 *   F. 接线断言 —— ipc / downloadEngine / preload / app.js / i18n / 文档
 *
 * 用法：node _probe/reconcile-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const reconcile = require('../src/main/reconcile');
const { createRegistry } = require('../src/main/registry');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); return; }
    fail++; fails.push(label + ' → ' + r);
    console.log('  ✗ ' + label + '  → ' + r);
  } catch (e) {
    fail++; fails.push(label + ' → ' + e.message);
    console.log('  ✗ ' + label + '  → ' + e.message);
  }
}
function eq(a, b, label) {
  t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}
function ok(v, label) { t(label, () => (v ? true : '假值')); }

const SRC = path.join(__dirname, '..', 'src', 'main');
const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const readSrc = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/* ---------------- 夹具 ---------------- */

function entry(id, files, extra) {
  return {
    id,
    name: id,
    kind: 'pak',
    enabled: true,
    manifest: files.map(f => (typeof f === 'string'
      ? { path: f, rel: path.basename(f), size: 1 }
      : f)),
    ...extra
  };
}

// 假的存在性：给一组「存在」的路径，其余都不存在
function existsSet(list) {
  const set = new Set(list.map(p => String(p).toLowerCase()));
  return (p) => set.has(String(p).toLowerCase());
}

const A1 = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\A_P.pak';
const A2 = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\A_P.ucas';
const B1 = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\B_P.pak';
const C1 = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\C_P.pak';
const D1 = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\D_P.pak';
const D1OFF = D1 + '.disabled';
const E1 = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\E_P.pak';

/* ---------------- A. plan() ---------------- */

console.log('[A] plan() —— 按文件实况裁剪/移除/纠开关');

{
  // A 全在；B 只丢了一个；C 两个都不在；D 全在但被改成 .disabled；E 全在、开关本来就对
  const entries = [
    entry('A', [A1, A2]),
    entry('B', [B1, 'C:\\Game\\SB\\Content\\Paks\\~Mods\\B_P.ucas']),
    entry('C', ['C:\\Game\\SB\\Content\\Paks\\~Mods\\C_P.pak', 'C:\\Game\\SB\\Content\\Paks\\~Mods\\C_P.ucas']),
    entry('D', [D1OFF], { enabled: true }),
    entry('E', [E1], { enabled: true })
  ];
  // C1 不存在（C 两个都不在）
  const ex = existsSet([A1, A2, B1, D1OFF, E1]);
  const rep = reconcile.plan(entries, ex);

  eq(rep.total, 5, 'A 统计总条数 5');
  eq(rep.drop.length, 1, 'A 整条丢的只有 1 条');
  eq(rep.drop[0].id, 'C', 'A 整条丢的是 C（两个文件都不在）');
  eq(rep.trim.length, 1, 'A 裁剪的只有 1 条');
  eq(rep.trim[0].id, 'B', 'A 裁剪的是 B（只丢一个文件）');
  eq(rep.trim[0].manifest.length, 1, 'A B 的清单裁成 1 个文件');
  eq(rep.trim[0].removed, 1, 'A B 记录丢掉了 1 个文件');
  eq(rep.flag.length, 1, 'A 需要纠正开关的只有 1 条');
  eq(rep.flag[0].id, 'D', 'A 纠正开关的是 D');
  eq(rep.flag[0].to, false, 'A D 应改成「已关闭」（磁盘上是 .disabled）');
  eq(rep.flag[0].from, true, 'A D 原来账本里记的是「已启用」');
  eq(rep.trimmed, 1, 'A trimmed 计数 = 1');
  eq(rep.dropped, 1, 'A dropped 计数 = 1');
  eq(rep.flagged, 1, 'A flagged 计数 = 1');
  eq(rep.missingFiles, 3, 'A missingFiles 计数 = 3（C 的 2 个 + B 的 1 个）');
  eq(rep.kept, 4, 'A kept = 4（除 C 之外的都还在账本里，含被裁剪的 B）');
}

t('A 开关本来就对的不进 flag', () => {
  const rep = reconcile.plan([entry('E', [E1], { enabled: true })], existsSet([E1]));
  return rep.flag.length === 0 || '被误判为需要纠正';
});

t('A 磁盘上是 .pak 但账本记着关闭 → 改成开启', () => {
  const rep = reconcile.plan([entry('E', [E1], { enabled: false })], existsSet([E1]));
  return (rep.flag.length === 1 && rep.flag[0].to === true) || '没有纠正回开启';
});

t('A 三个文件全带 .disabled、账本记着开启 → 改成关闭', () => {
  const base = 'C:\\Game\\SB\\Content\\Paks\\~Mods\\F_P';
  const files = [base + '.pak.disabled', base + '.ucas.disabled', base + '.utoc.disabled'];
  const rep = reconcile.plan([entry('F', files, { enabled: true })], existsSet(files));
  return (rep.flag.length === 1 && rep.flag[0].to === false) || '没有纠正';
});

t('A 没有清单的条目一律不动（不知道文件在哪，就别乱判）', () => {
  const rep = reconcile.plan([entry('G', [])], () => false);
  return (rep.drop.length === 0 && rep.trim.length === 0 && rep.flag.length === 0)
    || '空清单被当成「文件全丢」';
});

t('A 清单缺 rel 也能工作（只按 path 判）', () => {
  const rep = reconcile.plan([{ id: 'H', manifest: [{ path: A1 }] }], existsSet([A1]));
  return rep.drop.length === 0 || '被误删';
});

eq(reconcile.plan([], () => false).total, 0, 'A 空账本 → total 0');
eq(reconcile.plan(null, () => false).total, 0, 'A 传 null 也不炸');

t('A 默认的存在性判定用 defaultExists（读不到算「在」，不误删记录）', () => {
  const src = fs.readFileSync(path.join(SRC, 'reconcile.js'), 'utf8');
  return /function plan\(entries, exists = defaultExists\)/.test(src)
    || 'plan 的默认参数不是 defaultExists';
});

t('A defaultExists 对怪路径不抛且返回布尔', () => {
  const v = reconcile.defaultExists('\\\\?\\Z:\\definitely\\not\\here.pak');
  return (typeof v === 'boolean') || '返回了 ' + typeof v;
});

/* ---------------- B. apply() ---------------- */

console.log('[B] apply() —— 先批量改再逐条删');

t('B 裁剪与纠开关走 patchMany（一次落盘），删除走 remove', () => {
  const calls = { patchMany: [], remove: [] };
  const fake = {
    patchMany: (pairs) => { calls.patchMany.push(pairs); return pairs.length; },
    remove: (id) => { calls.remove.push(id); return { id }; }
  };
  const rep = {
    drop: [{ id: 'C', name: 'C' }],
    trim: [{ id: 'B', name: 'B', manifest: [{ path: B1 }], removed: 1 }],
    flag: [{ id: 'D', name: 'D', from: true, to: false }]
  };
  const out = reconcile.apply(fake, rep);
  eq(calls.patchMany.length, 1, 'B patchMany 只调用一次');
  eq(calls.patchMany[0].length, 2, 'B patchMany 一次带 2 组（裁剪 + 纠开关）');
  const pairs = new Map(calls.patchMany[0].map(p => [p.id, p.patch]));
  eq(pairs.get('B').manifest.length, 1, 'B 裁剪组的 manifest 已裁短');
  eq(pairs.get('D').enabled, false, 'B 纠开关组写的是 enabled:false');
  eq(calls.remove.length, 1, 'B remove 调用一次');
  eq(calls.remove[0], 'C', 'B remove 的是整条丢掉的 C');
  eq(out.dropped, 1, 'B 返回 dropped 1');
  eq(out.trimmed, 1, 'B 返回 trimmed 1');
  eq(out.flagged, 1, 'B 返回 flagged 1');
});

t('B 注册表没有 patchMany 时退回逐条 patch()', () => {
  const patches = [];
  const fake = { patch: (id, p) => { patches.push([id, p]); }, remove: () => {} };
  reconcile.apply(fake, { drop: [], trim: [{ id: 'T', manifest: [] }], flag: [] });
  return patches.length === 1 || '没有退回 patch()';
});

t('B 没有任何变动时不碰注册表', () => {
  let touched = 0;
  const fake = { patchMany: () => { touched++; return 0; }, remove: () => { touched++; } };
  reconcile.apply(fake, { drop: [], trim: [], flag: [] });
  return touched === 0 || `空报告也写了盘（${touched} 次）`;
});

/* ---------------- C. planQueue() ---------------- */

console.log('[C] planQueue() —— 已安装但文件不见了 → 下载页要能重新装');

{
  const arch = 'D:\\AI game\\StarBladeModManager\\data\\library\\1234_x_1.0.zip';
  const tasks = [
    { id: 't1', status: 'installed', archivePath: arch, meta: { modId: 1234 }, install: { registryId: 'nexus:1234:1' } },
    { id: 't2', status: 'installed', archivePath: arch, meta: { modId: 5678 }, install: { registryId: 'nexus:5678:1' } },
    { id: 't3', status: 'installed', archivePath: 'D:\\nope\\gone.zip', meta: { modId: 9012 }, install: { registryId: 'nexus:9012:1' } },
    { id: 't4', status: 'downloaded', archivePath: arch, meta: { modId: 3456 }, install: {} }
  ];
  // t4 本来就不是 installed；t1 的 modId 还在已安装列表里；t2 / t3 都不在
  const installedIds = new Set(['nexus:9999:1']);
  const installedModIds = new Set([1234]);
  const ex = existsSet([arch]);
  const out = reconcile.planQueue(tasks, installedIds, installedModIds, ex);

  eq(out.downgrade.length, 2, 'C 只有 2 条要降级（t1 还在、t4 本来就不是 installed）');
  const byId = new Map(out.downgrade.map(d => [d.id, d]));
  eq(byId.get('t2').status, 'downloaded', 'C t2 有安装包 → 降成「已下载」（可以重装）');
  eq(byId.get('t3').status, 'failed', 'C t3 安装包也没了 → 降成「失败」');
  ok(!byId.has('t1'), 'C t1 还在已安装列表里，不动');
  ok(!byId.has('t4'), 'C t4 本来就不是 installed，不动');
  eq(out.keep, 2, 'C 保留 2 条');
  ok(typeof byId.get('t2').reason === 'string' && byId.get('t2').reason.length > 0, 'C 降级带原因文案');
}

t('C 只凭 modId 命中也算「还在」（注册表 id 变了但 mod 还在）', () => {
  const out = reconcile.planQueue(
    [{ id: 'x', status: 'installed', meta: { modId: 42 }, install: {} }],
    new Set(), new Set([42]), () => false);
  return out.downgrade.length === 0 || 'modId 命中却仍被降级';
});

t('C 只凭 registryId 命中也算「还在」', () => {
  const out = reconcile.planQueue(
    [{ id: 'x2', status: 'installed', meta: {}, install: { registryId: 'nexus:1:2' } }],
    new Set(['nexus:1:2']), new Set(), () => false);
  return out.downgrade.length === 0 || 'registryId 命中却仍被降级';
});

t('C installedModIds 传 null 也不炸', () => {
  const out = reconcile.planQueue([{ id: 'y', status: 'downloaded' }], new Set(), null, () => false);
  return out.keep === 1 || '异常';
});

/* ---------------- D. 文案 ---------------- */

console.log('[D] noteworthy() / summarize()');

eq(reconcile.noteworthy({ dropped: 0, trimmed: 0, flagged: 0 }), false, 'D 全 0 → 不需要提示');
eq(reconcile.noteworthy({ dropped: 1, trimmed: 0, flagged: 0 }), true, 'D 有移除 → 需要提示');
eq(reconcile.noteworthy(null), false, 'D null → 不需要提示');

t('D 有变化时的句子把三个数字都说清楚', () => {
  const s = reconcile.summarize({ total: 5, kept: 3, dropped: 1, trimmed: 1, flagged: 1 });
  return (/移除/.test(s) && /裁剪/.test(s) && /开关/.test(s)) || '句子缺要素：' + s;
});
t('D 没变化时说「一致」并带上条数', () => {
  const s = reconcile.summarize({ total: 7, kept: 7, dropped: 0, trimmed: 0, flagged: 0 });
  return (/一致/.test(s) && /7/.test(s)) || '句子不对：' + s;
});

/* ---------------- E. 真文件系统 + 真注册表 ---------------- */

console.log('[E] 真文件系统跑一遍（真 registry）');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-reconcile-'));
const MODS = path.join(TMP, 'Star Blade', 'SB', 'Content', 'Paks', '~Mods');
fs.mkdirSync(MODS, { recursive: true });
const REG = path.join(TMP, 'mods.json');

function writeFake(name, bytes) {
  const p = path.join(MODS, name);
  fs.writeFileSync(p, Buffer.alloc(bytes || 8, 1));
  return p;
}
function mkEntry(id, files, extra) {
  return {
    id, name: id, kind: 'pak', enabled: true,
    manifest: files.map(p => ({ path: p, rel: path.basename(p), size: 8 })),
    ...extra
  };
}

const kp1 = writeFake('Keep_P.pak');
const kp2 = writeFake('Keep_P.ucas');
const gp1 = writeFake('Gone_P.pak');
const pp1 = writeFake('Part_P.pak');
const pp2 = writeFake('Part_P.ucas');
const off1 = writeFake('Off_P.pak.disabled');

const reg = createRegistry(REG);
reg.upsert(mkEntry('keep', [kp1, kp2]));
reg.upsert(mkEntry('gone', [gp1]));
reg.upsert(mkEntry('part', [pp1, pp2]));
reg.upsert(mkEntry('off', [off1], { enabled: true }));

eq(reg.all().length, 4, 'E 账本里先有 4 条');

// 用户手动删掉两个文件
fs.unlinkSync(gp1);
fs.unlinkSync(pp2);

const report = reconcile.plan(reg.all());
eq(report.dropped, 1, 'E 删掉整个 mod 的文件 → 1 条移除');
eq(report.trimmed, 1, 'E 只删部分文件 → 1 条裁剪');
eq(report.flagged, 1, 'E 磁盘上是 .disabled → 1 条开关要纠正');

const applied = reconcile.apply(reg, report);
eq(applied.dropped, 1, 'E apply 返回 dropped 1');

const after = reg.all();
eq(after.length, 3, 'E 应用后剩 3 条');
ok(!after.some(m => m.id === 'gone'), 'E 「gone」已从账本消失');
eq(after.find(m => m.id === 'part').manifest.length, 1, 'E 「part」的清单裁成 1 个文件');
eq(after.find(m => m.id === 'off').enabled, false, 'E 「off」的开关改成关闭');
eq(after.find(m => m.id === 'keep').manifest.length, 2, 'E 「keep」没被动');
eq(after.find(m => m.id === 'keep').enabled, true, 'E 「keep」开关没被动');

t('E 再跑一次 plan 是幂等的（没有新变化）', () => {
  const rep2 = reconcile.plan(reg.all());
  return reconcile.noteworthy(rep2) === false || '二次核对仍有变化';
});

t('E 落盘后的 mods.json 真的是裁过的（不是只在内存里）', () => {
  const onDisk = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const part = onDisk.mods.find(m => m.id === 'part');
  return (part && part.manifest.length === 1) || '磁盘上的账本没变';
});

/* ---------------- F. 接线 ---------------- */

console.log('[F] 接线断言');

const ipcSrc = readSrc('ipc.js');
const engSrc = readSrc('downloadEngine.js');
const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(RENDERER, 'app.js'), 'utf8');
const keysSrc = fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const archDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', '架构设计.md'), 'utf8');

ok(ipcSrc.includes("require('./reconcile')"), 'F ipc 引了 reconcile');
ok(/function reconcileRegistry\s*\(/.test(ipcSrc), 'F ipc 有 reconcileRegistry()');
ok(ipcSrc.includes("reconcile.plan(registry.all())"), 'F reconcileRegistry 用 plan(registry.all())');
ok(ipcSrc.includes("logger.event('data:reconciled'"), 'F 核对结果进日志');
ok(/syncLedger\(currentRoot\(\)\)/.test(ipcSrc), 'F 核对后同步便携账本');
ok(ipcSrc.includes("handle('mods:reconcile'"), 'F 有 mods:reconcile 通道');
ok(ipcSrc.includes('engine.syncFromInstalled(list, { reconcile: true })'), 'F listMods 里带 reconcile:true 同步下载队列');
ok(/engine\.syncFromInstalled\(listMods\(\)\.installed, \{ reconcile: true \}\)/.test(ipcSrc), 'F mods:reconcile 里也同步队列');
ok(/const reconciled = reconcileRegistry\(\)/.test(ipcSrc), 'F bootstrap / setRoot 里调用了 reconcileRegistry');
ok(/reconciled:/.test(ipcSrc), 'F 返回值里带 reconciled');

ok(/function syncFromInstalled\(mods, opts = \{\}\)/.test(engSrc), 'F engine 的 syncFromInstalled 收 opts');
ok(engSrc.includes('opts.reconcile'), 'F engine 读 reconcile 开关');
ok(engSrc.includes("status: archived ? 'downloaded' : 'failed'"), 'F engine 按有没有安装包决定降级目标');
ok(engSrc.includes("logEvent('download:missing'"), 'F 降级时记 download:missing 日志');
ok(engSrc.includes('missingReason'), 'F 降级时写上人话原因（missingReason）');

ok(preloadSrc.includes('reconcile: () => invoke(\'mods:reconcile\')'), 'F preload 暴露 mods.reconcile()');

ok(appSrc.includes('data-dl-installall'), 'F 下载页有「全部安装」按钮');
ok(/async function dlInstallAll\(/.test(appSrc), 'F app.js 有 dlInstallAll()');
ok(appSrc.includes('installAllRunning'), 'F 全部安装有并发守卫');
ok(/有 \$\{fmtNum\(downloadedCount\)\} 个 Mod 已经下载好了/.test(appSrc), 'F 没设游戏目录时会提示「下载好了但装不进去」');
ok(appSrc.includes('btnReconcile'), 'F 设置页有「核对磁盘」按钮');
ok(appSrc.includes('reconcileLine'), 'F 设置页有核对结果行');
ok(appSrc.includes('missingReason'), 'F 列表里会显示降级原因');
ok(appSrc.includes("data.reconciled"), 'F 启动时会消费 bootstrap 的 reconciled');

ok(keysSrc.includes('按磁盘核对'), 'F i18n 有「按磁盘核对」形状键');
ok(keysSrc.includes('待安装'), 'F i18n 有「待安装」');
ok(keysSrc.includes('核对磁盘'), 'F i18n 有「核对磁盘」');

ok(!!pkg.scripts['test:reconcile'], 'F package.json 有 test:reconcile');
ok(pkg.scripts['test:all'].includes('test:reconcile'), 'F test:all 挂上了 test:reconcile');
ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'F 版本号是语义化的');
ok(/\[0\.3\.6\]/.test(changelog), 'F CHANGELOG 有 0.3.6');
ok(/reconcile\.js/.test(archDoc), 'F 架构文档模块树写了 reconcile.js');

/* ---------------- 收尾 ---------------- */

fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) {
  console.log('失败项：');
  for (const f of fails) console.log('  - ' + f);
  process.exitCode = 1;
}
