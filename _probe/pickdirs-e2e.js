'use strict';
/**
 * 🔴 变体包「选了却装不上」：`pickDirs` 必须一路透传到 `runInstall`。
 *
 * 实测故障（2026-10-13，用户在「下载管理」里连点「去处理」都失败）：
 * 三个 mod 全部停在 `failed`，报
 *   「安装失败：无法识别这个压缩包的结构，请指定安装目录」
 *
 * 根因：`installPhase` 这一步分析**拿到了** `pickDirs` 所以能过，
 * 但调 `runInstallFn` 时只传了 `pickDir`（单数）——
 * 而「选哪几套」界面提交的是**数组**（`pickDirs`）。
 * `runInstall` 内部会**重新分析**（不信任调用方传来的计划），
 * 重新分析时拿不到 pickDirs → `!plan.ok` → 整包安装失败。
 *
 * 表现极具误导性：用户明明刚在界面上选了一套，程序却说「结构无法识别」。
 *
 * 本用例在**假游戏根**里跑完整链路（analyze → runInstall），
 * 用真实的「多目录变体包」结构（两个子目录 + 同一组 pak 三件套）。
 *
 * 运行：`npm run test:pickdirs`
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const installer = require('../src/main/installer');
const installFlow = require('../src/main/installFlow');
const { createRegistry } = require('../src/main/registry');

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
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0, 6);               // flags
    local.writeUInt16LE(0, 8);               // method = stored
    local.writeUInt16LE(0x4D21, 10);         // time（2025-10-13 附近，固定值避免 TZ 噪声）
    local.writeUInt16LE(0x5734, 12);         // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    out.push(local, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
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

/* ---------------- 假游戏根 ---------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pickdirs-'));
const ROOT = path.join(tmp, 'game');
const LIB = path.join(tmp, 'library');
const MODS_DIR = path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods');
const WIN64 = path.join(ROOT, 'SB', 'Binaries', 'Win64');
fs.mkdirSync(MODS_DIR, { recursive: true });
fs.mkdirSync(WIN64, { recursive: true });
fs.mkdirSync(LIB, { recursive: true });

const L = {
  root: ROOT, sb: path.join(ROOT, 'SB'),
  win64: WIN64, modsDir: MODS_DIR,
  ue4ssDir: path.join(WIN64, 'ue4ss'),
  ue4ssModsDir: path.join(WIN64, 'ue4ss', 'Mods'),
  modsTxt: path.join(WIN64, 'ue4ss', 'Mods', 'mods.txt')
};
const registry = createRegistry(path.join(tmp, 'mods.json'));

const PAK_FILES = d => [
  { name: d + '/SameAsset_P.pak', data: 'p-' + d },
  { name: d + '/SameAsset_P.ucas', data: 'u-' + d },
  { name: d + '/SameAsset_P.utoc', data: 'o-' + d }
];
const TWO_VARIANTS = [...PAK_FILES('WithPanties'), ...PAK_FILES('Nopanties')];
/** 每组用例前清空 ~Mods（不然上一组写进去的文件会让下一组的断言假绿/假红） */
function cleanMods() {
  for (const n of fs.readdirSync(MODS_DIR)) {
    fs.rmSync(path.join(MODS_DIR, n), { recursive: true, force: true });
  }
}

async function main() {
  /* ============================================ 1. 不传 pickDirs 必失败 */
  console.log('\n[1] 不带 pickDirs：多目录变体包应当被拒（且说清要选）');
  const zip1 = writeZip(path.join(LIB, 'variant-a.zip'), TWO_VARIANTS);

  {
    const plan = await installer.analyze(ROOT, zip1, { modId: 2595 }, {});
    eq(plan.ok, false, '不带 pickDirs → ok=false（结构不明，必须让用户选）');
    t('带 options 候选目录', () => Array.isArray(plan.options) && plan.options.length === 2 || JSON.stringify(plan.options));
    t('needsTargetPick 置位', () => plan.needsTargetPick === true || String(plan.needsTargetPick));

    // 🔴 这就是用户看到的那句误导性报错的前身
    let msg = null;
    try {
      await installFlow.runInstall({
        root: ROOT, archivePath: zip1, meta: { modId: 2595 }, registry, layout: L
      });
    } catch (e) { msg = e.message; }
    t('runInstall 直接装会抛错', () => typeof msg === 'string' || '竟然没抛错');
    t('报错不是泛泛的「结构无法识别」—— 要说有几套内容', () =>
      !!msg && !/结构无法识别/.test(msg) && /2 套内容|需要先选/.test(msg) || msg);
    t('报错提示去「下载管理 → 去处理」重新选', () => !!msg && msg.includes('去处理') || msg);
  }

  /* ============================================ 2. 带 pickDirs：完整装成功 */
  cleanMods();
  console.log('\n[2] 带 pickDirs（用户在界面上选完一套后）：应当完整装成');
  {
    const zip2 = writeZip(path.join(LIB, 'variant-b.zip'), TWO_VARIANTS);
    const r = await installFlow.runInstall({
      root: ROOT, archivePath: zip2, meta: { modId: 1378, name: 'Eve Iberis Dress CNS' },
      pickDirs: ['WithPanties'],
      registry, layout: L
    });
    eq(r.written, 3, '只写入选中的那一套（3 个文件）');
    t('pak 落在 ~Mods 根级（游戏只读根级）', () =>
      fs.existsSync(path.join(MODS_DIR, 'SameAsset_P.pak')) || '不在根级');
    const leftovers = fs.readdirSync(MODS_DIR).filter(n => /^With|^No/i.test(n));
    t('变体目录没有被一起埋进 ~Mods', () => leftovers.length === 0 || '埋进来了：' + leftovers.join(','));
    t('注册表登记了这一条', () => registry.get(r.id) !== null || '没登记');
  }

  /* ============================================ 3. 两套都选 → 明确拒绝 */
  cleanMods();
  console.log('\n[3] 两套都选（互相覆盖）：应当在装之前就拒绝');
  {
    const zip3 = writeZip(path.join(LIB, 'variant-c.zip'), TWO_VARIANTS);
    const r = await installFlow.runInstall({
      root: ROOT, archivePath: zip3, meta: { modId: 437 },
      pickDirs: ['WithPanties', 'Nopanties'],
      registry, layout: L
    }).then(() => null, e => ({ err: e.message }));
    t('明确拒绝而不是静默装歪', () => !!r && !!r.err || JSON.stringify(r));
    t('拒绝理由提到「互相覆盖」', () => !!r && /互相覆盖/.test(r.err) || (r && r.err));
    t('拒绝后没往 ~Mods 写半套文件', () =>
      !fs.existsSync(path.join(MODS_DIR, 'SameAsset_P.ucas')) || '写了一部分');
  }

  /* ============================================ 4. 单数 pickDir 不回归 */
  cleanMods();
  console.log('\n[4] 老接口 pickDir（单字符串）不能回归');
  {
    const zip4 = writeZip(path.join(LIB, 'variant-d.zip'), PAK_FILES('OnlyOne'));
    const r = await installFlow.runInstall({
      root: ROOT, archivePath: zip4, meta: { modId: 1430 },
      pickDir: 'OnlyOne',
      registry, layout: L
    });
    eq(r.written, 3, 'pickDir 单串仍然装得进来');
  }

  /* ============================================ 5. 接线：installPhase 必须把 pickDirs 传下去 */
  console.log('\n[5] 源码级接线（防止再退化）');
  {
    const engine = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'downloadEngine.js'), 'utf8');
    // 签名里必须同时有 `pickDirs`（用户选了哪几套）与 `_autoPicked`（自动全选的防套娃守卫）。
    // ⚠️ 用「包含」而不是整条精确匹配：签名后面还会加参数，精确匹配会让每次扩展都误报。
    t('installPhase 解构里就有 pickDirs', () =>
      /installPhase\(id, \{[^}]*pickDirs = null[^}]*\} = \{\}\)/.test(engine) || '签名里没有');
    t('installPhase 解构里有 _autoPicked（无冲突自动全装的防套娃守卫）', () =>
      /installPhase\(id, \{[^}]*_autoPicked[^}]*\} = \{\}\)/.test(engine) || '签名里没有');
    t('无冲突变体包会带默认选择集递归自装（不再停下来等用户点）', () =>
      /plan\.hasConflicts === false && !_autoPicked/.test(engine) || '没找到无冲突自动装的分支');
    t('installPhase 调 runInstallFn 时把 pickDirs 一起传了', () =>
      /pickDir,\s*\n\s*\/\*\*|pickDirs,\s*\n\s*onConflict/.test(engine)
      || /pickDirs,/.test(engine.split('runInstallFn({')[1].split('});')[0] || '') || 'runInstallFn 调用里没有 pickDirs');

    const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'installFlow.js'), 'utf8');
    t('runInstall 签名接受 pickDirs', () =>
      /runInstall\(\{\s*\n\s*root, archivePath, meta = \{\}, manualTarget = null, pickDir = '', pickDirs = null,/.test(flow) || '签名里没有');
    t('runInstall 把 pickDirs 喂给 analyze', () =>
      /analyze\(root, archivePath, meta, \{ manualTarget, pickDir, pickDirs, ownedPaths \}\)/.test(flow) || '没喂给 analyze');

    const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc.js'), 'utf8');
    t('install:run 也透传 pickDir / pickDirs', () =>
      /pickDir: p\.pickDir,\s*\n\s*pickDirs: p\.pickDirs,/.test(ipc) || '没透传');

    const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
    t('渲染层 install.run 带 pickDir / pickDirs', () =>
      /pickDir: st\.pickDir \|\| undefined,\s*\n\s*pickDirs: st\.pickDirs \|\| undefined,/.test(app) || '没带');
  }
}

main().then(() => {
  console.log('\n=== 清理 ===');
  try { fs.rmSync(tmp, { recursive: true, force: true }); console.log('  已清理 ' + tmp); }
  catch (e) { console.log('  清理失败（不影响结果）：' + e.message); }
  console.log(`\n${fail === 0 ? '✅' : '❌'} pickdirs: ${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('\n失败项：'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
}).catch(e => {
  console.error('FATAL ' + (e && e.stack || e));
  process.exit(1);
});
