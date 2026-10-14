'use strict';
/*
 * ATOOL（Animation Tool，Nexus mod 1662）支持自检。
 *
 * ## 为什么要单独一套断言
 *
 * ATOOL 是 **UE4SS 蓝图模组（Logic Mod）**，落点是 `SB\Content\Paks\LogicMods\`，
 * 而普通 mod 落 `~Mods\`。这两者是**两套互不相通的加载机制** —— 放错地方游戏
 * 一个字都不加载，文件静静躺着，用户完全不知道发生了什么。
 *
 * 实测（`_probe/atool-layout-probe.js`）：在补规则之前，ATOOL 本体的四种可能
 * 归档形态里**三种会装错**（落 ~Mods），一种要用户手挑。这套断言把修好之后的
 * 口径钉死，防止以后改规则时又滑回去。
 *
 * 覆盖五层：
 *   1) `game.layout()` 的 `logicModsDir` 字段 + `ensureLogicModsDir()`
 *   2) `game.atoolStatus()` —— 按特征文件判定（平铺 / 内层两种落点都要认）
 *   3) `prereqs` 的 atool 条目 + 依赖检查
 *   4) `installer.analyze()` 的落点与依赖标记（含**动画包不许被误判**的反例）
 *   5) `scanner.scan()` + `localState` —— 装好后必须出现在「已安装」里
 *
 * ⚠️ 第 5) 层是 0.2.10 补的：前四层全绿，用户却报「ATOOL 装好不显示已安装」——
 *    因为「已安装」判定的唯一来源是 `scanner.scan()`，而 ATOOL 的落点
 *    `LogicMods\` 不在它的任何一步主动扫描范围内。**没测到那一环，就等于没测。**
 *
 * 用临时目录造假游戏根 + 临时 zip，**不碰真实游戏目录**。
 *
 * 运行：node _probe/atool-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const game = require('../src/main/game');
const prereqs = require('../src/main/prereqs');
const installer = require('../src/main/installer');
const scanner = require('../src/main/scanner');
const localState = require('../src/main/localState');
const { createRegistry } = require('../src/main/registry');

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

const SEVEN_ZIP = process.env.SEVEN_ZIP || 'C:\\Program Files\\7-Zip\\7z.exe';
const TMP = path.join(os.tmpdir(), 'sb-atool-test');
const ROOT = path.join(TMP, 'fakeroot');
const SRC = path.join(TMP, 'src');
const PKG = path.join(TMP, 'pkg');

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); } catch { /* 忽略 */ }
}
function writeTo(base, rel, content = 'x') {
  const abs = path.join(base, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
/** 归档内路径 → 安装后的绝对路径 */
function installedPath(rel) {
  return path.join(ROOT, ...rel.split('/'));
}

function makeZip(name, files) {
  const stage = path.join(SRC, name);
  rmrf(stage);
  for (const [rel, content] of Object.entries(files)) writeTo(stage, rel, content);
  const out = path.join(PKG, name + '.zip');
  fs.mkdirSync(PKG, { recursive: true });
  rmrf(out);
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx1', out, '.'], { cwd: stage, stdio: 'ignore' });
  return out;
}

/* ============================================================
 * 0) 造一个假游戏根
 * ============================================================ */
rmrf(TMP);
fs.mkdirSync(ROOT, { recursive: true });
writeTo(ROOT, 'SB/Binaries/Win64/SB-Win64-Shipping.exe');
writeTo(ROOT, 'SB/Content/Paks/~Mods/.keep');       // ~Mods 已存在
writeTo(ROOT, 'SB/Binaries/Win64/dwmapi.dll');     // UE4SS 就位（ATOOL 依赖它）
writeTo(ROOT, 'SB/Binaries/Win64/ue4ss/UE4SS.dll');
// 注意：**不建** LogicMods，第一段断言要验证「目录不存在时也不炸」

const L = game.layout(ROOT);

console.log('\n=== 1) layout：logicModsDir 是一等字段 ===');
t('logicModsDir 存在', () => typeof L.logicModsDir === 'string' ? true : String(L.logicModsDir));
t('logicModsDir 指向 SB\\Content\\Paks\\LogicMods', () =>
  L.logicModsDir === path.join(ROOT, 'SB', 'Content', 'Paks', 'LogicMods') ? true : L.logicModsDir);
t('logicModsDir 与 modsDir 是**不同**目录（两套加载机制）', () =>
  L.logicModsDir !== L.modsDir ? true : '两个字段指向同一个目录');
t('logicModsDir 是 modsDir 的同级目录（都在 Paks 下）', () =>
  path.dirname(L.logicModsDir) === path.dirname(L.modsDir) ? true : '不在同一层');
t('game 导出了 ensureLogicModsDir', () => typeof game.ensureLogicModsDir === 'function' ? true : '没导出');

console.log('\n=== 2) atoolStatus：什么都没装 ===');
let a = game.inspect(ROOT).atool;
t('installed=false', () => a.installed === false ? true : 'true');
t('partial=false（连一半都没有）', () => a.partial === false ? true : 'true');
t('confident=true（按特征文件判定，不是猜名字）', () => a.confident === true ? true : String(a.confident));
t('coreFound=0/3（三件套都没到）', () => (a.coreFound === 0 && a.coreTotal === 3) ? true : a.coreFound + '/' + a.coreTotal);
t('layoutKind=null（没探测到落点）', () => a.layoutKind === null ? true : String(a.layoutKind));
t('audioCount=0', () => a.audioCount === 0 ? true : a.audioCount);
t('目录不存在也不抛错，markers 照样列全 4 个特征位', () =>
  a.markers.length === 4 ? true : a.markers.length);
t('markers 里 3 个核心 + 1 个可选（audio）', () => {
  const core = a.markers.filter(m => m.core).length;
  return (core === 3 && a.markers.length - core === 1) ? true : core + '/' + a.markers.length;
});

console.log('\n=== 3) ensureLogicModsDir：能创建（与 ~Mods 并列）===');
t('调用前不存在', () => fs.existsSync(L.logicModsDir) === false ? true : '竟然已存在');
t('ensureLogicModsDir 返回创建后的路径', () => game.ensureLogicModsDir(ROOT) === L.logicModsDir ? true : '返回值不对');
t('创建成功', () => fs.existsSync(L.logicModsDir) ? true : '目录没建出来');
t('inspect() 暴露 logicModsDir 状态块', () => {
  const d = game.inspect(ROOT).logicModsDir;
  return (d && d.exists === true && typeof d.fileCount === 'number') ? true : JSON.stringify(d);
});
t('~Mods 的状态块没被影响', () => {
  const d = game.inspect(ROOT).modsDir;
  return (d && d.exists === true) ? true : JSON.stringify(d);
});
rmrf(L.logicModsDir);   // 恢复「没装」状态给后面的用例

console.log('\n=== 4) atoolStatus：只解压了 .pak（常见的漏伴生文件）→ partial ===');
writeTo(ROOT, 'SB/Content/Paks/LogicMods/HD-ATOOL_P.pak');
a = game.inspect(ROOT).atool;
t('installed=false（IoStore 三件套没齐）', () => a.installed === false ? true : 'true');
t('partial=true', () => a.partial === true ? true : 'false');
t('coreFound=1/3', () => a.coreFound === 1 ? true : a.coreFound);
t('layoutKind=flat（平铺落点）', () => a.layoutKind === 'flat' ? true : String(a.layoutKind));
t('note 说清缺哪两个文件', () =>
  /安装不完整/.test(a.note || '') && /ucas/.test(a.note || '') && /utoc/.test(a.note || '') ? true : a.note);

console.log('\n=== 5) 补齐伴生文件 → installed ===');
writeTo(ROOT, 'SB/Content/Paks/LogicMods/HD-ATOOL_P.ucas');
writeTo(ROOT, 'SB/Content/Paks/LogicMods/HD-ATOOL_P.utoc');
a = game.inspect(ROOT).atool;
t('installed=true', () => a.installed === true ? true : 'false');
t('partial=false', () => a.partial === false ? true : 'true');
t('coreFound=3/3', () => a.coreFound === 3 ? true : a.coreFound);
t('没配外置音频时给出 note 提醒', () =>
  /外置音频/.test(a.note || '') ? true : a.note);

console.log('\n=== 6) 外置音频目录被数出来 ===');
writeTo(ROOT, 'SB/Content/Paks/LogicMods/HD-ATOOL_P/audio/33.wav');
writeTo(ROOT, 'SB/Content/Paks/LogicMods/HD-ATOOL_P/audio/34.wav');
writeTo(ROOT, 'SB/Content/Paks/LogicMods/HD-ATOOL_P/audio/readme.txt');   // 非 wav 不计
a = game.inspect(ROOT).atool;
t('audioCount=2（只数 .wav）', () => a.audioCount === 2 ? true : a.audioCount);
t('audio 特征位为 isDir', () => {
  const m = a.markers.find(x => x.key === 'audio');
  return m && m.isDir === true ? true : JSON.stringify(m && { isDir: m.isDir });
});
t('装了音频后不再提示「没有外置音频」', () =>
  !/没有外置音频/.test(a.note || '') ? true : a.note);
t('found 里包含 audio', () => a.found.some(m => m.key === 'audio') ? true : '没找到');

console.log('\n=== 7) 内层落点（V3 形态）也能认出来 ===');
{
  const R2 = path.join(TMP, 'fakeroot-inner');
  writeTo(R2, 'SB/Binaries/Win64/SB-Win64-Shipping.exe');
  writeTo(R2, 'SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.pak');
  writeTo(R2, 'SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.ucas');
  writeTo(R2, 'SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.utoc');
  const a2 = game.inspect(R2).atool;
  t('installed=true（内层落点）', () => a2.installed === true ? true : 'false');
  t('layoutKind=inner', () => a2.layoutKind === 'inner' ? true : String(a2.layoutKind));
  t('coreFound=3/3', () => a2.coreFound === 3 ? true : a2.coreFound);
  rmrf(R2);
}

console.log('\n=== 8) prereqs：atool 条目与依赖检查 ===');
const P = prereqs.get('atool');
t('条目存在', () => !!P ? true : '没有 atool 条目');
t('kind=nexus（走一键安装助手）', () => P && P.kind === 'nexus' ? true : P && P.kind);
t('modId=1662', () => P && P.modId === 1662 ? true : P && P.modId);
t('fileId=12834（默认键位版主文件）', () => P && P.fileId === 12834 ? true : P && P.fileId);
t('requires=ue4ss', () => P && (P.requires || []).join(',') === 'ue4ss' ? true : P && (P.requires || []).join(','));
t('落点写的是 LogicMods（不是 ~Mods）', () =>
  P && /LogicMods/i.test(P.target || '') ? true : P && P.target);
t('作者是 hbd', () => P && P.author === 'hbd' ? true : P && P.author);
t('all() 里有 3 个前置（ue4ss / cns / atool）', () => {
  const keys = prereqs.all().map(x => x.key).join(',');
  return keys === 'ue4ss,cns,atool' ? true : keys;
});
t('UE4SS 已装 → atool 依赖满足', () => {
  const r = prereqs.checkRequires(game.inspect(ROOT), 'atool');
  return r.ok === true ? true : JSON.stringify(r);
});
t('UE4SS 没装 → 依赖不满足且点名 ue4ss', () => {
  const bare = path.join(TMP, 'fakeroot-no-ue4ss');
  writeTo(bare, 'SB/Binaries/Win64/SB-Win64-Shipping.exe');
  const r = prereqs.checkRequires(game.inspect(bare), 'atool');
  return (r.ok === false && r.missing.join(',') === 'ue4ss') ? true : JSON.stringify(r);
});

/* ============================================================
 * 9) scanner：装好的 ATOOL 必须出现在扫描结果里（0.2.10 修复的回归防线）
 *
 *    为什么这一层非有不可：「已安装」判定的**唯一来源**是 scanner 的结果 ——
 *    `localState.buildLocalIndex()` 建 installed 表时只读
 *    `scanned[i].meta.source.modId`，**不看**原始注册表。
 *    而 ATOOL 的落点 `SB\Content\Paks\LogicMods\` 不在 scanner ①②③④ 任何一步的
 *    主动扫描范围内（②只认 CNS 的两个特征文件、③只扫 ~Mods、④只扫 ue4ss\Mods），
 *    第 5) 步「注册表兜底」是**唯一**通路。
 *
 *    0.2.10 之前的 bug：第 5) 步把所有 `prereqModIds` 一律 `continue`，
 *    而 ATOOL 的 modId 1662 恰好就登记在 `prereqs` 里 → 被两头排除：
 *    注册表有记录、LogicMods\ 里三件套齐全，scan() 却一条都不返回，
 *    于是浏览页的卡片永远显示「未安装」。
 *    （实测现场见 `docs/待处理修复-第三十六轮.md`）
 *
 *    ⚠️ 这一节用**独立的临时游戏根 + 临时注册表**，不复用上面的 ROOT：
 *       前面的用例已经往 ROOT 的 LogicMods\ 里塞了东西，状态不干净。
 * ============================================================ */
const absAt = (root, rel) => path.join(root, ...rel.split('/'));

/** 造一条 ATOOL 注册记录（fileId 不同 = 同一个 mod 的不同版本） */
function atoolRec(root, fileId, installedAt) {
  return {
    id: 'nexus:1662:' + fileId,
    name: 'Animation Tool (ATOOL)',
    kind: 'logicmod',
    enabled: true,
    source: { modId: 1662, fileId, version: '6.1', author: 'hbd' },
    installedAt,
    target: absAt(root, 'SB/Content/Paks/LogicMods'),
    archivePath: null,
    manifest: ['pak', 'ucas', 'utoc'].map(ext => {
      const rel = 'HD-ATOOL_P/HD-ATOOL_P.' + ext;
      return { path: absAt(root, 'SB/Content/Paks/LogicMods/' + rel), rel, size: 1 };
    })
  };
}

/** 写一份临时注册表 json，再用它跑一次 scan() */
function seededScan(root, mods, regDir) {
  const file = path.join(TMP, regDir, 'mods.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, mods }, null, 1));
  return scanner.scan(root, createRegistry(file));
}

const byModId = (list, modId) =>
  list.filter(m => m.meta && m.meta.source && Number(m.meta.source.modId) === modId);

{
  // 场景：管理器正常装好的 ATOOL（注册表 + LogicMods\HD-ATOOL_P\ 三件套）
  const SA = path.join(TMP, 'scan-atool');
  rmrf(SA);
  writeTo(SA, 'SB/Binaries/Win64/SB-Win64-Shipping.exe');
  writeTo(SA, 'SB/Content/Paks/~Mods/.keep');            // ~Mods 存在，但不参与本例
  for (const ext of ['pak', 'ucas', 'utoc']) writeTo(SA, `SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.${ext}`);

  const scanned = seededScan(SA, [atoolRec(SA, 12834, '2026-10-14T17:39:21.161Z')], 'reg-a');
  const mine = byModId(scanned, 1662);

  t('扫描结果里有 ATOOL（旧代码在这里返回 0 条）', () =>
    mine.length === 1 ? true : '出了 ' + mine.length + ' 条');
  // ⚠️ 一律先 `|| {}` 取默认对象再判字段。写成 `mine[0] && mine[0].id === x ? true : …`
  //    时数组为空会返回 `undefined`，而 `t()` 把 `undefined` 当通过 ——
  //    于是「ATOOL 一条都没扫出来」这个最该失败的场景反而全绿（第一版就踩到了：
  //    把旧逻辑放回去复验时，只有 6 条转红，这几条静默通过）。
  const A = mine[0] || {};
  t('条目 id 沿用注册表的 id', () => A.id === 'nexus:1662:12834' ? true : String(A.id));
  t('kind 保留注册表的 logicmod', () => A.kind === 'logicmod' ? true : String(A.kind));
  t('落点报的是 LogicMods\\（不是 ~Mods）', () =>
    /logicmods$/i.test(String(A.location || '')) ? true : String(A.location));
  t('三件套都算进 fileCount', () => A.fileCount === 3 ? true : String(A.fileCount));
  t('带上了注册表元数据（界面靠它显示版本 / 作者 / 封面）', () =>
    A.meta && A.meta.source && A.meta.source.version === '6.1' ? true : 'meta 丢了');

  // —— 下面这两条才直接对应「用户在浏览页看到什么」 ——
  const idx = localState.buildLocalIndex({ scanned, tasks: [] });
  t('localState 把 modId 1662 认成「已安装」', () =>
    idx.installed.has(1662) ? true : 'installed 表里没有 1662');
  t('registryId 指回注册表那条记录', () => {
    const e = idx.installed.get(1662) || {};
    return e.registryId === 'nexus:1662:12834' ? true : JSON.stringify(e);
  });
  t('浏览页卡片能挂上 local 状态', () => {
    const d = localState.decorateMods([{ modId: 1662, name: 'Animation Tool (ATOOL)' }], idx);
    return d[0] && d[0].local && d[0].local.state === 'installed' ? true : JSON.stringify(d[0]);
  });

  // —— 同一个 mod 装了两次（作者更新后 fileId 变了）：只该出一条，留最近装的那个 ——
  const both = seededScan(SA, [
    atoolRec(SA, 12836, '2026-10-14T13:39:37.305Z'),   // 先装
    atoolRec(SA, 12834, '2026-10-14T17:39:21.161Z')    // 后装（覆盖了前者）
  ], 'reg-b');
  const bMine = byModId(both, 1662);
  t('两条注册记录只出一条（旧代码会冒出两条同名条目）', () =>
    bMine.length === 1 ? true : '出了 ' + bMine.length + ' 条');
  t('留的是 installedAt 更晚的 12834', () => {
    const B = bMine[0] || {};
    return B.id === 'nexus:1662:12834' ? true : String(B.id);
  });

  // 顺序颠倒也要留最近的那条（不能只靠注册表里的出厂顺序）
  const rev = seededScan(SA, [
    atoolRec(SA, 12834, '2026-10-14T17:39:21.161Z'),
    atoolRec(SA, 12836, '2026-10-14T13:39:37.305Z')
  ], 'reg-c');
  const cMine = byModId(rev, 1662);
  t('注册表顺序颠倒 → 仍然只出一条', () => cMine.length === 1 ? true : '出了 ' + cMine.length + ' 条');
  t('仍然是 12834（按 installedAt 判新旧，不按顺序）', () => {
    const C = cMine[0] || {};
    return C.id === 'nexus:1662:12834' ? true : String(C.id);
  });

  // —— 文件被手动删光 → 不该继续挂在列表里（第 5) 步原有的 alive 门槛）——
  const gone = path.join(TMP, 'scan-gone');
  rmrf(gone);
  writeTo(gone, 'SB/Binaries/Win64/SB-Win64-Shipping.exe');
  const goneScan = seededScan(gone, [atoolRec(gone, 12834, '2026-10-14T17:39:21.161Z')], 'reg-d');
  t('LogicMods\\ 里文件被删光 → 不再出现该条目', () =>
    byModId(goneScan, 1662).length === 0 ? true : '仍然被列出来了');

  // —— 防误伤：不同 mod 共用同一组 pak 文件名（minervha 那种），必须各列一条 ——
  const shareA = atoolRec(SA, 12834, '2026-10-14T17:39:21.161Z');
  shareA.id = 'nexus:2675:9001';
  shareA.name = 'Mod A';
  shareA.source = { modId: 2675, fileId: 9001 };
  const shareB = JSON.parse(JSON.stringify(shareA));
  shareB.id = 'nexus:2359:9002';
  shareB.name = 'Mod B';
  shareB.source = { modId: 2359, fileId: 9002 };
  const sharedScan = seededScan(SA, [shareA, shareB], 'reg-e');
  const nShared = byModId(sharedScan, 2675).length + byModId(sharedScan, 2359).length;
  t('不同 modId 共用同一组文件 → 各列一条（去重不许误伤）', () =>
    nShared === 2 ? true : '只出了 ' + nShared + ' 条');

  // —— CNS 依旧只由第 2) 步代表，不许因为「不再一概跳过」而多出一条 ——
  const SC = path.join(TMP, 'scan-cns');
  rmrf(SC);
  writeTo(SC, 'SB/Binaries/Win64/SB-Win64-Shipping.exe');
  for (const ext of ['pak', 'ucas', 'utoc']) writeTo(SC, `SB/Content/Paks/LogicMods/DekCNS_P.${ext}`);
  writeTo(SC, 'SB/Binaries/Win64/ue4ss/Mods/DekCNS/Scripts/main.lua');
  const cnsScan = seededScan(SC, [{
    id: 'nexus:1496:13020',
    name: 'Custom Nanosuit System',
    kind: 'prereq',
    enabled: true,
    source: { modId: 1496, fileId: 13020, version: '2.2', author: 'Dekita' },
    installedAt: '2026-10-01T00:00:00.000Z',
    target: absAt(SC, 'SB/Content/Paks/LogicMods'),
    manifest: ['pak', 'ucas', 'utoc'].map(ext => {
      const rel = 'DekCNS_P.' + ext;
      return { path: absAt(SC, 'SB/Content/Paks/LogicMods/' + rel), rel, size: 1 };
    })
  }], 'reg-f');
  const nCns = byModId(cnsScan, 1496).length;
  t('CNS 仍然只出一条（放宽前置跳过之后也没重复）', () => nCns === 1 ? true : '出了 ' + nCns + ' 条');
}

/* ============================================================
 * 10) installer：归档 → 落点（核心）
 *     这一节才是「ATOOL 到底装到哪」的决定性证据。
 * ============================================================ */
async function installerCases() {
  const CASES = [
    {
      n: 'V1 自带 LogicMods 层（官方说明的字面结构）',
      f: {
        'LogicMods/HD-ATOOL_P.pak': 'PAK',
        'LogicMods/HD-ATOOL_P.ucas': 'UCAS',
        'LogicMods/HD-ATOOL_P.utoc': 'UTOC',
        'LogicMods/HD-ATOOL_P/audio/33.wav': 'WAV'
      },
      expect: { ok: true, target: 'logicMods', kind: 'logicmod', requiresAtool: true },
      // 内层结构必须保留：audio 要跟着 pak 一起走
      contains: 'HD-ATOOL_P/audio/33.wav'
    },
    {
      n: 'V2 平铺在归档根（无 LogicMods 层）',
      f: {
        'HD-ATOOL_P.pak': 'PAK',
        'HD-ATOOL_P.ucas': 'UCAS',
        'HD-ATOOL_P.utoc': 'UTOC'
      },
      expect: { ok: true, target: 'logicMods', kind: 'logicmod', requiresAtool: true },
      contains: 'HD-ATOOL_P.pak'
    },
    {
      n: 'V3 包一层 HD-ATOOL_P\\（保留内层）',
      f: {
        'HD-ATOOL_P/HD-ATOOL_P.pak': 'PAK',
        'HD-ATOOL_P/HD-ATOOL_P.ucas': 'UCAS',
        'HD-ATOOL_P/HD-ATOOL_P.utoc': 'UTOC',
        'HD-ATOOL_P/audio/33.wav': 'WAV'
      },
      expect: { ok: true, target: 'logicMods', kind: 'logicmod', requiresAtool: true },
      contains: 'HD-ATOOL_P/HD-ATOOL_P.pak'
    },
    {
      n: 'V4 带 SB\\ 前缀（现有 SB 规则天然覆盖）',
      f: {
        'SB/Content/Paks/LogicMods/HD-ATOOL_P.pak': 'PAK',
        'SB/Content/Paks/LogicMods/HD-ATOOL_P.ucas': 'UCAS',
        'SB/Content/Paks/LogicMods/HD-ATOOL_P.utoc': 'UTOC'
      },
      expect: { ok: true, target: 'root', requiresAtool: true },
      contains: 'SB/Content/Paks/LogicMods/HD-ATOOL_P.pak'
    },
    {
      n: '动画包·平铺 pak → 必须落 ~Mods（不许被 ATOOL 规则误抓）',
      f: {
        'InGame_Anim_pack_v1200_P.pak': 'PAK',
        'InGame_Anim_pack_v1200_P.ucas': 'UCAS',
        'InGame_Anim_pack_v1200_P.utoc': 'UTOC'
      },
      expect: { ok: true, target: 'modsDir', kind: 'pak' },
      contains: 'InGame_Anim_pack_v1200_P.pak'
    },
    {
      n: '动画包·名字里带 HD-ATOOL（animtest）→ 仍必须落 ~Mods',
      f: {
        'HD-ATOOL-animtest_P.pak': 'PAK',
        'HD-ATOOL-animtest_P.ucas': 'UCAS',
        'HD-ATOOL-animtest_P.utoc': 'UTOC'
      },
      expect: { ok: true, target: 'modsDir', kind: 'pak' },
      contains: 'HD-ATOOL-animtest_P.pak'
    },
    {
      n: '普通 pak Mod（无关名字）→ 落 ~Mods，没被新规则影响',
      f: {
        'SomeSuit_P.pak': 'PAK',
        'SomeSuit_P.ucas': 'UCAS',
        'SomeSuit_P.utoc': 'UTOC'
      },
      expect: { ok: true, target: 'modsDir', kind: 'pak', requiresAtool: false },
      contains: 'SomeSuit_P.pak'
    },
    {
      n: 'CNS 本体（同样落 LogicMods）→ 不许被误标成「需要 ATOOL」',
      f: {
        'SB/Content/Paks/LogicMods/DekCNS_P.pak': 'PAK',
        'SB/Content/Paks/LogicMods/DekCNS_P.ucas': 'UCAS',
        'SB/Content/Paks/LogicMods/DekCNS_P.utoc': 'UTOC',
        'SB/Binaries/Win64/ue4ss/Mods/DekCNS/Scripts/main.lua': 'LUA'
      },
      expect: { ok: true, requiresAtool: false },
      contains: 'SB/Content/Paks/LogicMods/DekCNS_P.pak'
    }
  ];

  for (const c of CASES) {
    const zip = makeZip('case' + CASES.indexOf(c), c.f);
    const plan = await installer.analyze(ROOT, zip, { name: c.n });
    const want = c.expect;

    await ta(c.n + ' → ok=' + want.ok, () => plan.ok === want.ok ? true : 'ok=' + plan.ok + ' reason=' + plan.reason);

    if (want.ok) {
      if (want.target) {
        const expectDir = want.target === 'logicMods' ? L.logicModsDir
          : want.target === 'modsDir' ? L.modsDir
            : want.target === 'root' ? L.root : null;
        await ta(c.n + ' → 落点=' + want.target, () =>
          plan.target && expectDir && path.resolve(plan.target).toLowerCase() === path.resolve(expectDir).toLowerCase()
            ? true
            : 'target=' + plan.target);
      }
      if (want.kind) {
        await ta(c.n + ' → kind=' + want.kind, () => plan.kind === want.kind ? true : 'kind=' + plan.kind);
      }
      if (want.requiresAtool !== undefined) {
        await ta(c.n + ' → requiresAtool=' + want.requiresAtool, () =>
          !!plan.requiresAtool === want.requiresAtool ? true : 'requiresAtool=' + plan.requiresAtool);
      }
      if (c.contains) {
        await ta(c.n + ' → 安装清单含 ' + c.contains, () =>
          plan.preview.includes(c.contains) ? true : plan.preview.slice(0, 4).join(' | '));
      }
    }
  }

  console.log('\n=== 11) describeTarget 能把 LogicMods 说成人话 ===');
  await ta('L.logicModsDir → LogicMods 文案', () => {
    const s = installer.describeTarget(L, L.logicModsDir);
    return /LogicMods/.test(s) ? true : s;
  });
  await ta('L.logicModsDir\\HD-ATOOL_P → 带子目录名的文案', () => {
    const s = installer.describeTarget(L, path.join(L.logicModsDir, 'HD-ATOOL_P'));
    return /LogicMods/.test(s) && /HD-ATOOL_P/.test(s) ? true : s;
  });
  await ta('~Mods 的文案没被改坏', () => {
    const s = installer.describeTarget(L, L.modsDir);
    return /~Mods/.test(s) ? true : s;
  });
  await ta('KIND_LABEL 有 logicmod 且不是 unknown', () =>
    installer.KIND_LABEL.logicmod && installer.KIND_LABEL.logicmod !== installer.KIND_LABEL.unknown
      ? true : String(installer.KIND_LABEL.logicmod));
}

installerCases().then(() => {
  rmrf(TMP);
  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.error('\n运行出错：', e && e.stack || e);
  process.exit(1);
});
