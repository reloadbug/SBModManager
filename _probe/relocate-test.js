'use strict';
/**
 * 游戏目录搬移（`src/main/relocate.js`）：让已安装账本跟着游戏走。
 *
 * 用户诉求（2026-11-07）：
 *   「我其实是把游戏整个挪过去了，所以注册表的信息也应该一起变，
 *     这部分数据应该存储在 mod 管理器内或者是 mod 目录里跟随游戏一起，
 *     这样就能保证无论怎么搬移游戏都不影响已安装的 mod 无法识别到」
 *
 * 覆盖：
 *   1. 落点还原 —— `target` 拆成「游戏根 + 固定尾巴」，两种形态都要认；
 *   2. 试算 —— 只改文件真在那儿的条目，坏条跳过并计数，幂等；
 *   3. 便携账本 —— 只存相对路径，换根能重建，往返无损；
 *   4. 合并 —— 只补注册表没有的 id，从不覆盖；
 *   5. 真跑一遍 —— 造目录 + 真 registry，搬完再对齐；
 *   6. 接线 —— ipc / preload / 渲染层该有的钩子都在。
 *
 * 纯 Node：不联网、不打真实 data/，全部用临时文件。
 * 运行：`npm run test:relocate`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const R = require('../src/main/relocate');
const { createRegistry } = require('../src/main/registry');

const TMP = path.join(os.tmpdir(), 'sb-relocate-test');

const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const DOCS = path.join(__dirname, '..', 'docs', '架构设计.md');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

function reset() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 沙箱守卫 */ }
  fs.mkdirSync(TMP, { recursive: true });
}
const read = (f) => fs.readFileSync(f, 'utf8');

const OLD = 'D:\\games\\Star Blade';
const NEW = 'c:\\Star Blade';
const OLD_MODS = OLD + '\\SB\\Content\\Paks\\~Mods';
const NEW_MODS = NEW + '\\SB\\Content\\Paks\\~Mods';
const UE4SS = '\\SB\\Binaries\\Win64\\ue4ss\\Mods';

/** 一条常规 pak 记录 */
function pakEntry(id, files) {
  const rels = files || ['A_P.pak', 'A_P.ucas', 'A_P.utoc'];
  return {
    id,
    name: id,
    kind: 'pak',
    enabled: true,
    source: { modId: 2038, name: 'X' },
    target: OLD_MODS,
    manifest: rels.map(rel => ({ path: OLD_MODS + '\\' + rel, rel, size: 10 })),
    fileCount: rels.length
  };
}
/** 一条「铺满游戏目录」的记录（CNS 前置那种，rel 从 SB\ 起头） */
function rootEntry(id) {
  const rel = 'SB\\Content\\Paks\\CNS\\a.dekcns';
  return {
    id,
    name: id,
    kind: 'cns',
    enabled: true,
    source: null,
    target: OLD,
    manifest: [{ path: OLD + '\\' + rel, rel, size: 5 }],
    fileCount: 1
  };
}

// ================================================================ 1. splitTarget

console.log('\n[1] splitTarget：target 拆成「游戏根 + 尾巴」');
{
  const a = R.splitTarget(OLD_MODS);
  eq(a.root, OLD, '~Mods 落点还原出游戏根');
  eq(a.tail, 'SB\\Content\\Paks\\~Mods', '尾巴是 ~Mods 那段');

  const b = R.splitTarget(OLD + '\\SB\\Content\\Paks\\LogicMods');
  eq(b.root, OLD, 'LogicMods 落点同样还原');
  eq(b.tail, 'SB\\Content\\Paks\\LogicMods', '尾巴是 LogicMods');

  const c = R.splitTarget(OLD + UE4SS + '\\SomeScriptMod');
  eq(c.root, OLD, 'ue4ss\\Mods\\<目录名> 也能还原（尾巴取最深那次）');
  eq(c.tail, 'SB\\Binaries\\Win64\\ue4ss\\Mods\\SomeScriptMod', '尾巴一直带到目录名');

  eq(R.splitTarget(OLD_MODS.replace(/\\/g, '/')).root, OLD, '正斜杠输入也认');

  eq(R.splitTarget(OLD_MODS + '\\\\').root, OLD, '结尾多余反斜杠被吃掉');

  const mixed = R.splitTarget('c:\\star blade\\SB\\content\\paks\\~mods');
  eq(mixed.root, 'c:\\star blade', '大小写混着写也能认（比较时两侧都小写）');
  eq(mixed.tail, 'SB\\content\\paks\\~mods', '尾巴保留原样大小写');

  const no = R.splitTarget(OLD);
  t('认不出尾巴时 root 为空', () => (no.root === '' && no.tail === '') || JSON.stringify(no));
  t('空值不炸', () => (R.splitTarget('').root === '' && R.splitTarget(null).root === ''));
}

// ================================================================ 2. rootOfEntry / detectRoot

console.log('\n[2] rootOfEntry / detectRoot：这条记录当年装在哪');
{
  eq(R.rootOfEntry(pakEntry('a')), OLD, '常规 pak 记录 → 剥尾巴得根');
  eq(R.rootOfEntry(rootEntry('b')), OLD, '前置记录（target 就是根、rel 以 SB\\ 起头）→ 直接是根');

  const legacy = {
    id: 'legacy',
    target: '',
    manifest: [{ path: OLD_MODS + '\\A_P.pak', rel: 'A_P.pak', size: 1 }]
  };
  eq(R.rootOfEntry(legacy), OLD_MODS, '尾巴都认不出时按第一条文件反推（path 去掉 rel）');

  t('啥信息都没有 → 空串', () => (R.rootOfEntry({ id: 'x', target: '', manifest: [] }) === ''));

  eq(R.detectRoot([pakEntry('1'), pakEntry('2'), pakEntry('3'), { id: '4', target: 'E:\\other\\SB\\Content\\Paks\\~Mods', manifest: [] }]),
    OLD, '多数表决：3 票对 1 票');
  eq(R.detectRoot([]), '', '空列表 → 空串');
}

// ================================================================ 3. planMigration

console.log('\n[3] planMigration：试算（只算不写）');
{
  const all = () => true;

  const p1 = R.planMigration([pakEntry('a'), rootEntry('b')], NEW, all);
  eq(p1.oldRoot, OLD, '旧根识别正确');
  eq(p1.newRoot, NEW, '新根是当前游戏根');
  eq(p1.total, 2, '总数');
  eq(p1.fixable, 2, '两条都能修');
  eq(p1.missing, 0, '没有缺失');
  eq(p1.files, 4, '文件计数 = 3 + 1');
  eq(p1.patches.length, 2, '两条 patch');
  eq(p1.patches[0].patch.target, NEW_MODS, '~Mods 落点被换成新根下的同名落点');
  eq(p1.patches[0].patch.manifest[0].path, NEW_MODS + '\\A_P.pak', '文件名清单里的绝对路径也跟着换');
  eq(p1.patches[1].patch.target, NEW, '前置记录（target 就是根）→ 新根');
  eq(p1.patches[0].patch.root, NEW, 'patch 里带上新根，供后续定位');

  const p2 = R.planMigration([pakEntry('a'), rootEntry('b')], NEW, (p) => p.indexOf('a.dekcns') < 0);
  eq(p2.fixable, 1, '文件不在的那条不修（宁可少改）');
  eq(p2.missing, 1, '缺文件的条目计入 missing');
  eq(p2.entries.find(e => e.id === 'b').state, 'missing', '状态标成 missing');

  const sameEntry = pakEntry('s');
  sameEntry.target = NEW_MODS;
  sameEntry.manifest = sameEntry.manifest.map(f => ({ ...f, path: NEW_MODS + '\\' + f.rel }));
  const p3 = R.planMigration([sameEntry], NEW, all);
  eq(p3.unchanged, 1, '已经在当前目录的算 unchanged');
  eq(p3.fixable, 0, '不产生 patch');
  eq(p3.patches.length, 0, 'patches 为空');
  eq(p3.entries[0].state, 'same', '状态 same');

  const p4 = R.planMigration([{ id: 'u', target: 'nonsense', manifest: [] }], NEW, all);
  eq(p4.unchanged, 1, '认不出的记录算 unchanged');
  eq(p4.entries[0].state, 'unknown', '状态 unknown');

  const p5 = R.planMigration([pakEntry('a')], '', all);
  t('新根为空 → 什么都不改', () => (p5.fixable === 0 && p5.patches.length === 0));
  t('入参 passthrough：entries 为空也不炸', () => (R.planMigration(null, NEW, all).total === 0));

  const before = JSON.stringify([pakEntry('a')]);
  R.planMigration([pakEntry('a')], NEW, all);
  eq(JSON.stringify([pakEntry('a')]), before, '试算不修改入参');

  const idem = R.planMigration(JSON.parse(before).map(e => ({ ...e, ...p1.patches[0].patch })), NEW, all);
  eq(idem.fixable, 0, '把 patch 套回去再试算 → 无事可做（幂等）');
}

// ================================================================ 4. applyPlan

console.log('\n[4] applyPlan：把试算结果套到条目上（纯函数）');
{
  const entries = [pakEntry('a'), { id: 'keep', target: OLD, manifest: [] }];
  const plan = R.planMigration(entries, NEW, () => true);
  const out = R.applyPlan(entries, plan);
  eq(out.length, 2, '长度不变');
  eq(out[0].target, NEW_MODS, '命中条目被改到新落点');
  t('原数组/原对象未被修改', () => (entries[0].target === OLD_MODS && out[0] !== entries[0]));
  t('未命中的条目原样返回（同一引用）', () => (out[1] === entries[1]));
  eq(R.applyPlan(entries, null).length, 2, 'plan 为空也不炸');
}

// ================================================================ 5. 便携账本

console.log('\n[5] 便携账本：只存相对，换根能重建');
{
  reset();
  const rootA = path.join(TMP, 'a', 'Star Blade');
  const entries = [pakEntry('a'), rootEntry('b')];
  const led = R.toLedger(entries, OLD, { app: '0.3.3' });
  eq(led.version, R.LEDGER_VERSION, '账本带版本号');
  eq(led.gameRoot, OLD, '账本记下写入时的游戏根');
  eq(led.app, '0.3.3', 'app 版本透传');
  eq(led.mods.length, 2, '条目数');

  const leA = led.mods[0];
  eq(leA.targetRel, 'SB\\Content\\Paks\\~Mods', 'target 存成相对游戏根');
  t('manifest 只存 rel（不带绝对路径）', () =>
    leA.manifest.every(f => f.rel && f.path === undefined) || JSON.stringify(leA.manifest[0]));
  eq(led.mods[1].targetRel, '', 'target 就是游戏根时存空串');

  const back = R.fromLedgerEntry(leA, NEW);
  eq(back.target, NEW_MODS, '换根后 target 精确重建');
  eq(back.manifest[0].path, NEW_MODS + '\\A_P.pak', '换根后文件路径精确重建');
  t('重建出来的记录打了 fromLedger 标记', () => back.fromLedger === true);

  eq(R.ledgerPath(NEW), path.join(NEW, '.sbmod', 'ledger.json'), '账本位置 = <游戏根>\\.sbmod\\ledger.json');
  t('账本不放进 ~Mods（免得被当成 mod 扫出来）', () => R.ledgerPath(NEW).indexOf('~Mods') < 0);

  const file = R.writeLedger(rootA, led);
  t('写入后文件存在', () => fs.existsSync(file));
  const got = R.readLedger(rootA);
  eq(got.mods.length, 2, '读回来的条目数一致');
  eq(got.file, file, 'readLedger 带回文件路径');

  eq(R.readLedger(path.join(TMP, 'nowhere')), null, '没有账本 → null');
  const bad = R.ledgerPath(rootA);
  fs.writeFileSync(bad, JSON.stringify({ version: 99, mods: [] }), 'utf8');
  eq(R.readLedger(rootA), null, '版本不符 → 当作没有（不冒险用旧格式）');
  fs.writeFileSync(bad, '{oops', 'utf8');
  eq(R.readLedger(rootA), null, '坏 JSON → null 而不是抛错');
}

// ================================================================ 6. mergeLedger

console.log('\n[6] mergeLedger：只补缺，不覆盖');
{
  reset();
  const rootB = path.join(TMP, 'b', 'Star Blade');
  const modsDir = path.join(rootB, 'SB', 'Content', 'Paks', '~Mods');
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'A_P.pak'), 'x');

  const le = (id, rels) => ({
    id,
    name: id,
    kind: 'pak',
    enabled: true,
    source: null,
    targetRel: 'SB\\Content\\Paks\\~Mods',
    manifest: (rels || ['A_P.pak']).map(rel => ({ rel, size: 1 }))
  });

  const ledger = { version: 1, gameRoot: NEW, mods: [le('dup'), le('new'), le('gone', ['nope.pak']), le('partial', ['A_P.pak', 'nope.pak'])] };
  const existing = [pakEntry('dup')];
  const out = R.mergeLedger(existing, ledger, rootB);

  eq(out.add.length, 2, '两条可补（new + partial）');
  t('已存在的 id 被跳过', () => out.skipped.some(s => s.id === 'dup' && s.reason === 'exists'));
  t('文件全丢的条目被跳过', () => out.skipped.some(s => s.id === 'gone' && s.reason === 'files-missing'));
  const partial = out.add.find(e => e.id === 'partial');
  t('部分文件在 → 进来的清单只留活的，并打 partial', () =>
    partial && partial.manifest.length === 1 && partial.partial === true);
  eq(out.add.find(e => e.id === 'new').target, modsDir, '补进来的记录指向本次游戏根下的落点');

  const none = R.mergeLedger([], null, rootB);
  t('账本为空 → 什么都不加', () => none.add.length === 0);
}

// ================================================================ 7. 真跑一遍

console.log('\n[7] 真跑一遍：造目录 + 真 registry，搬完再对齐');
{
  reset();
  const oldRoot = path.join(TMP, 'old', 'Star Blade');
  const oldMods = path.join(oldRoot, 'SB', 'Content', 'Paks', '~Mods');
  fs.mkdirSync(oldMods, { recursive: true });
  for (const n of ['Bayoedt_P.pak', 'Bayoedt_P.ucas', 'Bayoedt_P.utoc']) {
    fs.writeFileSync(path.join(oldMods, n), 'x');
  }

  const regFile = path.join(TMP, 'mods.json');
  const reg = createRegistry(regFile);
  reg.upsert({
    id: 'nexus:4104:18052',
    name: 'Bayonetta 04 Outfit replacer',
    kind: 'pak',
    enabled: true,
    source: { modId: 4104, fileId: 18052 },
    target: oldMods,
    manifest: ['Bayoedt_P.pak', 'Bayoedt_P.ucas', 'Bayoedt_P.utoc']
      .map(rel => ({ path: path.join(oldMods, rel), rel, size: 1 })),
    fileCount: 3,
    size: 3,
    installedAt: '2026-11-06T10:00:00.000Z'
  });

  // 「整个游戏文件夹」挪到新位置
  const newRoot = path.join(TMP, 'new', 'Star Blade');
  fs.mkdirSync(path.dirname(newRoot), { recursive: true });
  fs.cpSync(oldRoot, newRoot, { recursive: true });
  const newMods = path.join(newRoot, 'SB', 'Content', 'Paks', '~Mods');

  const plan = R.planMigration(reg.all(), newRoot);
  eq(plan.oldRoot, oldRoot, '旧根 = 搬走前的位置');
  eq(plan.fixable, 1, '一条可修');
  eq(plan.missing, 0, '没有缺文件（整目录都在）');

  reg.patchMany(plan.patches);
  const after = reg.get('nexus:4104:18052');
  eq(after.target, newMods, '注册表落点已跟随新目录');
  eq(after.manifest[0].path, path.join(newMods, 'Bayoedt_P.pak'), '文件路径已跟随新目录');
  t('byTarget 能用新路径反查到这条记录', () => {
    const hit = reg.byTarget(path.join(newMods, 'Bayoedt_P.utoc'));
    return hit && hit.id === 'nexus:4104:18052';
  });
  t('旧路径再也查不到（说明真改了）', () => reg.byTarget(path.join(oldMods, 'Bayoedt_P.pak')) === null);

  const again = R.planMigration(reg.all(), newRoot);
  eq(again.fixable, 0, '再跑一次无事可做（幂等）');
  eq(again.unchanged, 1, '那条算 unchanged');

  // 账本跟着新目录落地，删掉 mods.json 也能靠它恢复
  R.writeLedger(newRoot, R.toLedger(reg.all(), newRoot, { app: 'test' }));
  const led = R.readLedger(newRoot);
  fs.rmSync(regFile, { force: true });
  const reg2 = createRegistry(regFile);
  const merged = R.mergeLedger(reg2.all(), led, newRoot);
  eq(merged.add.length, 1, '空注册表 + 账本 → 恢复出 1 条');
  reg2.addMany(merged.add);
  const restored = reg2.get('nexus:4104:18052');
  eq(restored.target, newMods, '恢复出来的落点指向当前游戏根');
  eq(restored.manifest.length, 3, '文件清单完整');
  eq(restored.source.modId, 4104, '来源 modId 也一起恢复（关联/封面才不会丢）');
}

// ================================================================ 8. 接线

console.log('\n[8] 接线：ipc / preload / 渲染层 / 文档');
{
  const ipc = read(IPC);
  const preload = read(PRELOAD);
  const app = read(APP);

  t('ipc 有 syncLedger', () => ipc.indexOf('function syncLedger(') >= 0 || '没有');
  t('ipc 有 relocationPlan / applyRelocation / autoRelocate', () =>
    ['function relocationPlan(', 'function applyRelocation(', 'function autoRelocate(']
      .every(s => ipc.indexOf(s) >= 0) || '缺函数');
  t('bootstrap 里跑一次自动对齐', () => ipc.indexOf('autoRelocate(currentRoot())') >= 0 || '没接');
  t('改游戏目录时也自动对齐', () => ipc.indexOf('const relocation = autoRelocate(root)') >= 0 || '没接');
  t('安装/卸载后刷新账本', () =>
    (ipc.indexOf('syncLedger(root);') >= 0 && ipc.indexOf('syncLedger();') >= 0) || '没接');
  t('五个 game:* 通道都在', () =>
    ['game:relocate\'', 'game:relocateApply\'', 'game:ledger\'', 'game:ledgerExport\'', 'game:ledgerImport\'']
      .every(s => ipc.indexOf(s) >= 0) || '缺通道');

  t('preload 暴露五个方法', () =>
    ['relocate: () =>', 'relocateApply: () =>', 'ledger: () =>', 'ledgerExport: () =>', 'ledgerImport: () =>']
      .every(s => preload.indexOf(s) >= 0) || '缺方法');

  t('渲染层三个入口函数', () =>
    ['function refreshLedgerBox(', 'function checkRelocation(', 'function applyRelocationNow(']
      .every(s => app.indexOf(s) >= 0) || '缺函数');
  t('设置页三个按钮 id', () =>
    ['btnLedgerCheck', 'btnLedgerExport', 'btnLedgerImport', 'ledgerLine']
      .every(s => app.indexOf(s) >= 0) || '缺 id');
  t('复核弹窗按钮 rlGo 接上', () =>
    (app.indexOf('rlGo') >= 0 && app.indexOf('applyRelocationNow()') >= 0) || '没接');
  t('启动时把 relocation 结果留下来并提示', () =>
    (app.indexOf('state.relocation') >= 0 && app.indexOf('检测到游戏目录搬移') >= 0) || '没接');
  t('文档模块树里写了 relocate.js', () => read(DOCS).indexOf('relocate.js') >= 0 || '没写');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  for (const f of fails) console.log('  · ' + f);
  process.exitCode = 1;
}
