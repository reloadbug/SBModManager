'use strict';
/**
 * 多变体包「不冲突的直接全装」+ 暂停 / 继续 / 全部停止 / 彻底删除。
 *
 * 用户 2026-10-14 提了 7 条，其中 5 条落在这一组逻辑上：
 *   ① 多套文件不冲突的直接全部安装，冲突的才要选
 *   ③ 下载/确认按钮更全面，支持批量确认
 *   ④ 每组冲突默认选中第一个文件
 *   ⑤ 不要手工一个一个确认
 *   ⑥ 增加「全部停止」按钮
 *   ⑦ 每个 mod 可以暂停 / 取消 / 继续下载 / 彻底删除
 *
 * 本用例分四段：
 *   A. installer：`defaultPick` / `hasConflicts` 算得对不对（**真 zip**，走完整 analyze）
 *   B. downloadEngine：端到端 —— 自动全装 / 停在待确认 / 暂停留档 / 取消清档 / 全部停止 / 彻底删除
 *   C. 接线：IPC 通道、preload、渲染层按钮与吸顶 CSS
 *   D. 口径一致性：主进程的「默认选择」与界面预选必须逐条一样
 *
 * 运行：`npm run test:variant-auto`
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const installer = require('../src/main/installer');
const { createDownloadEngine } = require('../src/main/downloadEngine');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
async function ta(label, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

const SRC = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout = 3000, step = 15) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(step); }
  return null;
}

/* ---------------- 最小 zip 写入（store，测试专用） ---------------- */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0 ^ (-1);
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

function writeZip(zipPath, files) {
  const out = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const dataBuf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0x4D21, 10); local.writeUInt16LE(0x5734, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    out.push(local, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + dataBuf.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const b of central) cdSize += b.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...out, ...central, end]));
  return zipPath;
}

const paks = (dir, base) => [
  { name: dir + '/' + base + '_P.pak', data: 'p-' + dir },
  { name: dir + '/' + base + '_P.ucas', data: 'u-' + dir },
  { name: dir + '/' + base + '_P.utoc', data: 'o-' + dir }
];

/* =========================================================================
   A. installer：defaultPick / hasConflicts（真 zip）
   ========================================================================= */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-variant-auto-'));
const ROOT = path.join(tmp, 'game');
const LIB = path.join(tmp, 'library');
const IMAGES = path.join(tmp, 'images');
fs.mkdirSync(path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods'), { recursive: true });
fs.mkdirSync(LIB, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });

/** 三套**互不相关**的内容（资产名各不相同）→ 应当被判定为「可以一起装」 */
const NO_CONFLICT = [
  ...paks('MainMod', 'MainStuff'),
  ...paks('SkinPack', 'AhuangSkin'),
  ...paks('FontPack', 'CNSFont')
];
/** 三套**同一件东西**的不同版本（同一个资产 ID）→ 只能选一套 */
const ALL_CONFLICT = [
  ...paks('Outfit_A', 'ID99001-Outfit_A'),
  ...paks('Outfit_B', 'ID99001-Outfit_B'),
  ...paks('Outfit_C', 'ID99001-Outfit_C')
];
/** 一组冲突（A/B）+ 一套独立（Extra）→ 默认应当选 A + Extra */
const MIXED = [
  ...paks('Var_A', 'ID99001-Pack_A'),
  ...paks('Var_B', 'ID99001-Pack_B'),
  ...paks('Extra', 'ID99002-Extra')
];

async function partA() {
  console.log('\n[A] installer：默认选择集与「有没有真冲突」');

  {
    const zip = writeZip(path.join(LIB, 'no-conflict.zip'), NO_CONFLICT);
    const plan = await installer.analyze(ROOT, zip, { modId: 3970 }, {});
    eq(plan.needsTargetPick, true, 'A1 认不出结构 → 需要挑内容');
    eq(plan.options.length, 3, 'A1 列出 3 套候选');
    eq(plan.exclusiveGroups.length, 0, 'A1 互不相关 → 没有互斥组');
    eq(plan.hasConflicts, false, 'A1 hasConflicts = false（关键：据此自动全装）');
    eq(plan.defaultPick.length, 3, 'A1 默认选择集 = 全部 3 套');
  }

  {
    const zip = writeZip(path.join(LIB, 'all-conflict.zip'), ALL_CONFLICT);
    const plan = await installer.analyze(ROOT, zip, { modId: 1430 }, {});
    eq(plan.hasConflicts, true, 'A2 同一资产的三套 → hasConflicts = true');
    eq(plan.exclusiveGroups.length, 1, 'A2 合成 1 个互斥组');
    eq(plan.exclusiveGroups[0].length, 3, 'A2 组里有 3 个候选');
    eq(plan.defaultPick.length, 1, 'A2 默认只选 1 套（每组第一套）');
    eq(plan.defaultPick[0], plan.exclusiveGroups[0][0], 'A2 选中的就是组里第一个（需求④）');
  }

  {
    const zip = writeZip(path.join(LIB, 'mixed.zip'), MIXED);
    const plan = await installer.analyze(ROOT, zip, { modId: 437 }, {});
    eq(plan.hasConflicts, true, 'A3 一组冲突 + 一套独立 → 仍有冲突');
    eq(plan.exclusiveGroups.length, 1, 'A3 只有 1 个互斥组');
    const picked = [...plan.defaultPick].sort();
    eq(picked.length, 2, 'A3 默认选 2 套（组里第一套 + 独立那套）');
    eq(picked.includes('Extra'), true, 'A3 独立的那套默认被选上（不冲突就该装）');
    eq(plan.defaultPick[0], plan.exclusiveGroups[0][0], 'A3 冲突组默认取第一个');
  }

  {
    // 关键回归：**老 plan 没有 hasConflicts 字段**时，上层绝不能当成「无冲突」自动装。
    // 引擎那边用的是严格等号 `=== false`，这里从源码层面钉住这个写法。
    const src = SRC('src/main/downloadEngine.js');
    t('A4 自动全装要求 hasConflicts **严格等于** false（老 plan 的 undefined 不触发）', () =>
      /plan\.hasConflicts === false/.test(src) || '没找到严格判定');
    t('A4 没有写成宽松的 !plan.hasConflicts（那会把老 plan 也自动装掉）', () =>
      !/!\s*plan\.hasConflicts/.test(src) || '发现了宽松判定');
  }
}

/* =========================================================================
   B. downloadEngine：端到端
   ========================================================================= */

const VARIANT_DIRS = ['MainMod', 'SkinPack', 'FontPack'];

/**
 * 造一个「假依赖」引擎。
 * `variantPlan` 决定第一次 analyze 返回什么；带 pickDirs 时一律返回能装。
 */
function makeEngine({ variantPlan, downloadImpl, idPrefix = 'v' } = {}) {
  let idc = 0;
  const calls = { analyze: 0, install: 0, installPick: null, installCount: 0 };
  const file = path.join(tmp, 'q-' + idPrefix + '.json');
  const engine = createDownloadEngine({
    file,
    libraryDir: LIB,
    imagesDir: IMAGES,
    now: () => '2026-10-14T00:00:00.000Z',
    makeId: () => idPrefix + (++idc),
    getRoot: () => ROOT,
    getLayout: () => ({ modsDir: path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods') }),
    getRegistry: () => ({ upsert: () => {} }),
    resolveDownloadLink: async () => [{ name: 'mod.zip', uri: 'https://cdn.example/dl' }],
    downloadToFile: downloadImpl || (async (uri, dest) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(2000, 3)]));
      return { path: dest, size: 2004, total: 2004, filename: path.basename(dest) };
    }),
    analyze: async (_root, _archive, _meta, opts = {}) => {
      calls.analyze++;
      const picked = Array.isArray(opts.pickDirs) ? opts.pickDirs : (opts.pickDir ? [opts.pickDir] : []);
      if (picked.length) {
        calls.installPick = picked.slice();
        return {
          ok: true, kind: 'pak', target: 'mods', targetLabel: '~Mods',
          conflictCount: 0, fileCount: picked.length * 3, reason: '按 pak 落点'
        };
      }
      return variantPlan;
    },
    runInstall: async ({ pickDirs, pickDir }) => {
      calls.install++;
      calls.installCount++;
      calls.installPick = (Array.isArray(pickDirs) ? pickDirs.slice() : (pickDir ? [pickDir] : []));
      return {
        id: 'nexus:900:1', kind: 'pak', kindLabel: 'Pak 模组', target: 'mods',
        targetLabel: '~Mods', written: 3, skipped: 0, backedCount: 0, backupFailed: 0, manifest: []
      };
    },
    getMod: async () => null,
    cacheImages: async () => [],
    logger: { event: () => {} }
  });
  return { engine, calls, file };
}

const NO_CONFLICT_PLAN = {
  ok: false, kind: 'unknown', kindLabel: '未知', needsTargetPick: true,
  options: VARIANT_DIRS.map(d => ({ dir: d, label: d, group: '', key: '', files: 3, size: 30 })),
  exclusiveGroups: [],
  defaultPick: VARIANT_DIRS.slice(),
  hasConflicts: false,
  reason: '包里有 3 套内容，需要你选要装哪些（互不相关的可以一起装）'
};

/** 慢速下载：边写边报进度，能被中止；中止时按 keepPartialOnCancel 决定删不删（与 nxm.js 同口径） */
function slowDownload() {
  const state = { aborted: false, keptPartial: false, dest: null };
  const impl = (uri, dest, { onProgress, shouldCancel, keepPartialOnCancel }) => new Promise((resolve, reject) => {
    state.dest = dest;
    let n = 0;
    const tick = () => {
      if (shouldCancel && shouldCancel()) {
        state.aborted = true;
        let keep = false;
        try { keep = !!(keepPartialOnCancel && keepPartialOnCancel()); } catch { keep = false; }
        state.keptPartial = keep;
        if (!keep) { try { fs.rmSync(dest, { force: true }); } catch { /* 忽略 */ } }
        reject(new Error('已取消'));
        return;
      }
      n += 1000;
      try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.appendFileSync(dest, Buffer.alloc(1000, 7)); } catch { /* 忽略 */ }
      onProgress({ received: n, total: 100000, percent: Math.round(n / 1000) });
      if (n >= 100000) { resolve({ path: dest, size: n, total: n, filename: path.basename(dest) }); return; }
      setTimeout(tick, 4);
    };
    setTimeout(tick, 4);
  });
  return { impl, state };
}

async function partB() {
  console.log('\n[B] downloadEngine：自动全装 / 停待确认 / 暂停 / 取消 / 全部停止 / 彻底删除');

  // ---- B1 无冲突 → 自动全装，不停在「待确认」 ----
  await ta('B1 无冲突的多变体包：下载后**自动装完**，不需要用户点确认', async () => {
    const { engine, calls } = makeEngine({ variantPlan: NO_CONFLICT_PLAN, idPrefix: 'b1' });
    const r = engine.enqueueNexus({ game: 'stellarblade', modId: 900, fileId: 1, name: '多变体包' });
    engine.attachNxm({ game: 'stellarblade', modId: 900, fileId: 1, key: 'k', expires: Date.now() + 60000 });
    const done = await waitFor(() => engine.get(r.task.id) && engine.get(r.task.id).status === 'installed');
    if (!done) return '状态没走到 installed：' + JSON.stringify(engine.get(r.task.id).status);
    if (calls.installPick.length !== 3) return '装的时候没带上全部 3 套：' + JSON.stringify(calls.installPick);
    return true;
  });

  await ta('B1b 分析了两轮（先认不出 → 带全选再来一次）', async () => {
    const { engine, calls } = makeEngine({ variantPlan: NO_CONFLICT_PLAN, idPrefix: 'b1b' });
    const r = engine.enqueueNexus({ game: 'stellarblade', modId: 901, fileId: 1, name: 'x' });
    engine.attachNxm({ game: 'stellarblade', modId: 901, fileId: 1, key: 'k', expires: Date.now() + 60000 });
    await waitFor(() => engine.get(r.task.id).status === 'installed');
    return calls.analyze >= 2 ? true : 'analyze 只调了 ' + calls.analyze + ' 次';
  });

  // ---- B2 有冲突 → 停在「待确认」，默认集每组一套 ----
  {
    const CLASH_PLAN = {
      ok: false, kind: 'unknown', kindLabel: '未知', needsTargetPick: true,
      options: [
        { dir: 'Outfit_A', label: 'Outfit_A', group: '', key: 'ID99001', files: 3, size: 30 },
        { dir: 'Outfit_B', label: 'Outfit_B', group: '', key: 'ID99001', files: 3, size: 30 },
        { dir: 'Extra', label: 'Extra', group: '', key: 'ID99002', files: 3, size: 30 }
      ],
      exclusiveGroups: [['Outfit_A', 'Outfit_B']],
      defaultPick: ['Outfit_A', 'Extra'],
      hasConflicts: true,
      reason: '包里有 3 套内容'
    };
    const { engine, calls } = makeEngine({ variantPlan: CLASH_PLAN, idPrefix: 'b2' });
    const r = engine.enqueueNexus({ game: 'stellarblade', modId: 902, fileId: 1, name: '有冲突的包' });
    engine.attachNxm({ game: 'stellarblade', modId: 902, fileId: 1, key: 'k', expires: Date.now() + 60000 });
    await waitFor(() => engine.get(r.task.id).status === 'needs_review');

    await ta('B2 真有冲突 → 停下来等用户（不擅自装）', async () =>
      engine.get(r.task.id).status === 'needs_review' || '状态是 ' + engine.get(r.task.id).status);

    await ta('B2b plan 里带 defaultPick（每组第一套 + 独立那套）', async () => {
      const plan = engine.get(r.task.id).install.plan;
      return (Array.isArray(plan.defaultPick) && plan.defaultPick.length === 2)
        || 'defaultPick = ' + JSON.stringify(plan && plan.defaultPick);
    });

    await ta('B2c 一键安装（confirmInstallDefault）按默认集装掉', async () => {
      await engine.confirmInstallDefault(r.task.id);
      const st = engine.get(r.task.id).status;
      if (st !== 'installed') return '状态是 ' + st;
      const picked = [...calls.installPick].sort().join(',');
      return picked === 'Extra,Outfit_A' ? true : '实际装的是 ' + picked;
    });
  }

  // ---- B3 暂停：状态 paused + 半截文件保留 ----
  {
    const slow = slowDownload();
    const { engine } = makeEngine({ variantPlan: NO_CONFLICT_PLAN, downloadImpl: slow.impl, idPrefix: 'b3' });
    const r = engine.enqueueNexus({ game: 'stellarblade', modId: 903, fileId: 7, name: '大文件' });
    engine.attachNxm({ game: 'stellarblade', modId: 903, fileId: 7, key: 'k', expires: Date.now() + 60000 });
    await waitFor(() => engine.get(r.task.id).status === 'downloading');

    const part = path.join(LIB, '.dl-903-7.part');
    await ta('B3 下载中确实有半截文件', async () => fs.existsSync(part) || '没有 ' + part);

    engine.pause(r.task.id);
    eq(engine.get(r.task.id).status, 'paused', 'B3b 暂停后状态是 paused（不是 cancelled）');
    await wait(80);
    eq(engine.get(r.task.id).status, 'paused', 'B3c 下载层中止后状态**没有**被回写成 cancelled');
    await ta('B3d 暂停保留了半截文件（续传的本钱）', async () =>
      fs.existsSync(part) || '半截文件被删了');
    eq(slow.state.keptPartial, true, 'B3e 下载层收到「这次别删」的信号');
  }

  // ---- B4 取消：状态 cancelled + 半截文件清掉 ----
  {
    const slow = slowDownload();
    const { engine } = makeEngine({ variantPlan: NO_CONFLICT_PLAN, downloadImpl: slow.impl, idPrefix: 'b4' });
    const r = engine.enqueueNexus({ game: 'stellarblade', modId: 904, fileId: 8, name: '大文件2' });
    engine.attachNxm({ game: 'stellarblade', modId: 904, fileId: 8, key: 'k', expires: Date.now() + 60000 });
    await waitFor(() => engine.get(r.task.id).status === 'downloading');
    const part = path.join(LIB, '.dl-904-8.part');
    engine.cancel(r.task.id);
    eq(engine.get(r.task.id).status, 'cancelled', 'B4 取消后状态是 cancelled');
    eq(slow.state.keptPartial, false, 'B4b 下载层收到「这次要删」的信号');
    await wait(80);
    await ta('B4c 取消后半截文件被清掉（与暂停相反）', async () =>
      !fs.existsSync(part) || '半截文件还在');
  }

  // ---- B5 全部停止 ----
  {
    const slow = slowDownload();
    const { engine } = makeEngine({ variantPlan: NO_CONFLICT_PLAN, downloadImpl: slow.impl, idPrefix: 'b5' });
    const ids = [];
    for (const [m, f] of [[905, 1], [906, 2], [907, 3]]) {
      const r = engine.enqueueNexus({ game: 'stellarblade', modId: m, fileId: f, name: '批量 ' + m });
      engine.attachNxm({ game: 'stellarblade', modId: m, fileId: f, key: 'k', expires: Date.now() + 60000 });
      ids.push(r.task.id);
    }
    await waitFor(() => engine.list().filter(x => x.status === 'downloading').length >= 1);
    const res = engine.pauseAll();
    await ta('B5 全部停止：返回停掉的数量', async () => res.total >= 1 || 'total=' + res.total);
    await ta('B5b 被停的都是 paused', async () =>
      engine.list().filter(x => x.status === 'paused').length >= 1 || '一条都没停');
    await wait(80);
    await ta('B5c 停止后不会自己变回 cancelled', async () =>
      engine.list().every(x => x.status !== 'cancelled') || '有任务变成了 cancelled');
  }

  // ---- B6 彻底删除 ----
  {
    const { engine } = makeEngine({ variantPlan: NO_CONFLICT_PLAN, idPrefix: 'b6' });
    const r = engine.enqueueNexus({ game: 'stellarblade', modId: 908, fileId: 1, name: '要删掉的' });
    engine.attachNxm({ game: 'stellarblade', modId: 908, fileId: 1, key: 'k', expires: Date.now() + 60000 });
    await waitFor(() => engine.get(r.task.id).status === 'installed');
    const t0 = engine.get(r.task.id);
    const archive = t0.archivePath;
    // 造一份「缓存的封面图」和一个「没下完的半截文件」
    const imgDir = path.join(IMAGES, '908');
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(path.join(imgDir, '0.jpg'), 'jpg');
    const part = path.join(LIB, '.dl-908-1.part');
    fs.writeFileSync(part, 'half');

    const res = engine.purge(r.task.id);
    eq(res.ok, true, 'B6 彻底删除返回成功');
    eq(engine.get(r.task.id), null, 'B6b 队列记录没了');
    await ta('B6c 安装包被删', async () => !fs.existsSync(archive) || '安装包还在');
    await ta('B6d 半截文件被删', async () => !fs.existsSync(part) || '半截文件还在');
    await ta('B6e 缓存图被删', async () => !fs.existsSync(imgDir) || '缓存图目录还在');
    await ta('B6f **不动游戏目录**（卸载归「已安装 Mod」页管）', async () =>
      fs.existsSync(path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods')) || '游戏目录被动了');
  }
}

/* =========================================================================
   C. 接线 + 口径一致性
   ========================================================================= */

function partC() {
  console.log('\n[C] 接线：状态机 / IPC / preload / 界面');

  const queueSrc = SRC('src/main/downloadQueue.js');
  const engineSrc = SRC('src/main/downloadEngine.js');
  const ipcSrc = SRC('src/main/ipc.js');
  const preloadSrc = SRC('src/preload/index.js');
  const appSrc = SRC('src/renderer/app.js');
  const cssSrc = SRC('src/renderer/style.css');
  const nxmSrc = SRC('src/main/nxm.js');

  t('C1 `paused` 是合法任务状态', () => /'paused'/.test(queueSrc.split('const STATUSES')[1].split(']')[0]) || 'STATUSES 里没有');
  t('C1b paused 不算「活跃重复」——重新入队时会复用而不是被当成重复挡住', () => {
    const seg = queueSrc.split('ACTIVE_DUPLICATE_STATUSES = new Set([')[1].split(']')[0];
    return !/paused/.test(seg) || 'paused 混进了 ACTIVE_DUPLICATE_STATUSES';
  });
  t('C1c `paused` 进了 TERMINAL（终态），不会被当成还在跑', () =>
    /const TERMINAL = new Set\(\[[^\]]*'paused'/.test(engineSrc) || '没加进 TERMINAL');
  t('C1d PAUSABLE 只含排队/取链/下载三种', () => {
    const seg = engineSrc.split('const PAUSABLE = new Set([')[1].split(']')[0];
    return (/queued/.test(seg) && /resolving/.test(seg) && /downloading/.test(seg)
      && !/analyzing/.test(seg) && !/installing/.test(seg)) || seg;
  });

  t('C2 nxm 下载层支持 keepPartialOnCancel（暂停不删半截文件）', () =>
    /keepPartialOnCancel/.test(nxmSrc) || '没有这个选项');
  t('C2b 引擎把 keepPartial 传给了下载层', () =>
    /keepPartialOnCancel:\s*keepPartial/.test(engineSrc) || '没有透传');
  t('C2c 暂停会置 keepPartial = true', () =>
    /c\.cancelled = true;\s*c\.keepPartial = true;/.test(engineSrc) || '没有置位');

  t('C3 settleAbort 保护 paused 状态不被回写成 cancelled', () => {
    const seg = engineSrc.split('function settleAbort')[1] || '';
    return /cur\.status === 'paused'/.test(seg.slice(0, 400)) || 'settleAbort 没保护 paused';
  });
  t('C3b run() 的两处中止分支都走 settleAbort', () => {
    const n = (engineSrc.match(/settleAbort\(id\)/g) || []).length;
    return n >= 3 ? true : '只出现 ' + n + ' 次（定义 1 次 + 调用 ≥2 次）';
  });

  t('C4 取消会清掉半截文件（与暂停相反）', () =>
    /const gone = removePartsOf\(t\)/.test(engineSrc) || 'cancel 里没有 removePartsOf');

  t('C5 purge 清掉缓存图', () => /if \(modId && imagesDir\)/.test(engineSrc) || '没清缓存图');
  t('C5b purge 明确不动游戏目录', () =>
    /不删\*\*已经装进游戏目录的文件/.test(engineSrc) || '没写清口径');

  t('C6 IPC 通道齐全', () => {
    const need = ['download:pause', 'download:pauseAll', 'download:confirmDefault',
      'download:confirmAllDefault', 'download:purge', 'download:confirmprogress'];
    const miss = need.filter(c => !ipcSrc.includes(c));
    return miss.length === 0 || '缺 ' + miss.join(', ');
  });
  t('C6b preload 暴露了对应方法', () => {
    const need = ['pause:', 'pauseAll:', 'confirmDefault:', 'confirmAllDefault:', 'purge:', 'onConfirmProgress'];
    const miss = need.filter(c => !preloadSrc.includes(c));
    return miss.length === 0 || '缺 ' + miss.join(', ');
  });

  t('C7 界面顶部工具条吸顶（position:sticky）', () =>
    /\.dl-bar\{[^}]*position:sticky/.test(cssSrc) || '.dl-bar 没有 sticky');
  t('C7b 吸顶用了与 .bhead 同一套负 margin 手法（否则贴不住顶）', () =>
    /\.dl-bar\{[^}]*top:-16px/.test(cssSrc) && /\.dl-bar\{[^}]*margin:-16px -16px/.test(cssSrc)
    || '负 margin 写法不对');
  t('C7c 吸顶背景不透明（否则卡片会透出来）', () =>
    /\.dl-bar\{[^}]*background:var\(--bg\)/.test(cssSrc) || '背景不是不透明底色');

  t('C8 界面有「全部停止」按钮', () => /data-dl-pauseall="1"/.test(appSrc) || '没有');
  t('C8b 界面有「一键安装全部」按钮', () => /data-dl-confirmall="1"/.test(appSrc) || '没有');
  t('C8c 单条有「暂停」按钮', () => /data-dl-pause=/.test(appSrc) || '没有');
  t('C8d 单条有「一键安装」按钮', () => /data-dl-confirmdefault=/.test(appSrc) || '没有');
  t('C8e 有「彻底删除」按钮（每个状态都有）', () => /data-dl-purge=/.test(appSrc) || '没有');
  t('C8f 彻底删除有二次确认弹框', () => /id: 'pPurge'/.test(appSrc) && /pPurge/.test(appSrc) || '没有确认框');
  t('C8g 暂停状态显示「继续」按钮', () =>
    /t\.status === 'paused'[\s\S]{0,400}data-dl-start/.test(appSrc) || '暂停态没给继续按钮');

  t('C9 界面「还能接着下」的口径含 paused', () =>
    /const DL_RESUMABLE = new Set\(\['interrupted', 'failed', 'paused'\]\)/.test(appSrc) || '没含 paused');
  t('C9b 全部恢复用的是 DL_RESUMABLE（不再手写两个状态）', () =>
    /filter\(t => DL_RESUMABLE\.has\(t\.status\)/.test(appSrc) || '没统一口径');
  t('C9c DL_STATUS 里有 paused 的中文名', () => /paused: \{ t: '已暂停'/.test(appSrc) || '没有');

  t('C10 主进程与界面的「默认选择」口径一致（都取每组第一套）', () => {
    const main = /pick\.push\(g\[0\]\)/.test(SRC('src/main/installer.js'));
    const ui = /state\.pick\.add\(g\[0\]\)/.test(appSrc);
    return (main && ui) || `主进程=${main} 界面=${ui}`;
  });
  t('C10b 界面对无冲突的包会直接提示「全部装上」而不是让用户挑', () =>
    /互不相关 —— 点「一键安装」全部装上/.test(appSrc) || '文案没跟上');
}

/* =========================================================================
   收尾
   ========================================================================= */

(async () => {
  try {
    await partA();
    await partB();
    partC();
  } catch (e) {
    console.error('\n💥 用例本身出错：' + e.stack);
    fail++;
  }

  console.log('\n=== 清理 ===');
  try { fs.rmSync(tmp, { recursive: true, force: true }); console.log('  已清理 ' + tmp); } catch { /* 忽略 */ }

  console.log(`\n${fail === 0 ? '✅' : '❌'} variant-auto: ${pass} 通过 / ${fail} 失败`);
  if (fails.length) { console.log('\n失败项：'); for (const f of fails) console.log('  - ' + f); }
  process.exit(fail === 0 ? 0 : 1);
})();
