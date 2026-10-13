'use strict';
/**
 * 结构识别新增规则的自检：
 *   · UE4SS 本体包（根级 dwmapi.dll + ue4ss\）→ 必须落到 SB\Binaries\Win64\
 *   · 服装 Mod 识别（CustomNanosuitSystem\ / .dekcns / .dekani）→ requiresCns
 *
 * 全部在临时目录里跑，**不碰真实游戏目录**。
 *
 * 用法：
 *   node _probe/installer-deps-test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../src/main/installer');
const installFlow = require('../src/main/installFlow');
const game = require('../src/main/game');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-installer-deps-test');
const SRC = path.join(BASE, 'src');
const PKG = path.join(BASE, 'pkg');
const ROOT = path.join(BASE, 'fakeroot');

/**
 * 清理辅助。
 * ⚠️ 受限沙箱的「批量删除守卫」会在同一轮对话删除次数超阈值时**直接抛错**，
 *    清理失败不该让整个断言套件崩掉（断言早就跑完了），所以统一包一层。
 */
function safeRm(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* 清不掉就算了 */ }
}

let pass = 0, fail = 0;

function t(label, fn) {
  try {
    const r = fn();
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
  const stage = path.join(SRC, name);
  fs.rmSync(stage, { recursive: true, force: true });
  mk(stage, files);
  const out = path.join(PKG, name + '.zip');
  fs.mkdirSync(PKG, { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx1', out, '.'], { cwd: stage, stdio: 'ignore' });
  return out;
}

const L = game.layout(ROOT);

(async function main() {
  fs.rmSync(BASE, { recursive: true, force: true });
  // 假游戏根：只需要 exe 存在，game.isGameRoot 才会认
  mk(ROOT, {
    'SB/Binaries/Win64/SB-Win64-Shipping.exe': 'MZ',
    'SB/Content/Paks/~Mods/.keep': ''
  });

  console.log('\n=== 1) UE4SS 本体包 → 落到 SB\\Binaries\\Win64\\ ===');
  // 真实发布包结构：外面套一层 UE4SS_vX.Y.Z-N\，里面是 dwmapi.dll + ue4ss\
  const ue4ss = zip('UE4SS_v3.1.0-6', {
    'UE4SS_v3.1.0-6/dwmapi.dll': 'DLL',
    'UE4SS_v3.1.0-6/ue4ss/UE4SS.dll': 'CORE',
    'UE4SS_v3.1.0-6/ue4ss/UE4SS-settings.ini': 'INI',
    'UE4SS_v3.1.0-6/ue4ss/Mods/mods.txt': 'mods'
  });
  let p1 = null;
  await installer.analyze(ROOT, ue4ss, { name: 'UE4SS' }, {}).then(p => { p1 = p; });
  t('识别成功', () => p1.ok === true || JSON.stringify(p1));
  t('kind = prereq', () => p1.kind === 'prereq' || p1.kind);
  t('prereqKey = ue4ss', () => p1.prereqKey === 'ue4ss' || String(p1.prereqKey));
  t('落点是 Win64（不是 Win64\\ue4ss）', () =>
    path.resolve(p1.target).toLowerCase() === path.resolve(L.win64).toLowerCase() || p1.target);
  t('剥掉了外层包装目录', () => p1.strippedPrefix === 'UE4SS_v3.1.0-6' || String(p1.strippedPrefix));
  t('dwmapi.dll 落在 Win64 根（不被塞进 ue4ss\\）', () => {
    const m = p1.mapping.find(x => x.rel === 'dwmapi.dll');
    if (!m) return '没找到 dwmapi.dll 的映射';
    const want = path.resolve(path.join(L.win64, 'dwmapi.dll')).toLowerCase();
    return path.resolve(m.to).toLowerCase() === want || m.to;
  });
  t('ue4ss\\ 目录保持原结构', () => {
    const m = p1.mapping.find(x => x.rel === 'ue4ss/UE4SS.dll');
    if (!m) return '没找到 ue4ss/UE4SS.dll 的映射';
    const want = path.resolve(path.join(L.win64, 'ue4ss', 'UE4SS.dll')).toLowerCase();
    return path.resolve(m.to).toLowerCase() === want || m.to;
  });
  t('UE4SS 包不算服装 Mod', () => p1.requiresCns === false || String(p1.requiresCns));

  console.log('\n=== 2) 只有 ue4ss\\ 的包仍走通用规则（防回归） ===');
  const onlyUe4ss = zip('OnlyUe4ss', {
    'ue4ss/UE4SS.dll': 'CORE',
    'ue4ss/Mods/mods.txt': 'mods'
  });
  let p2 = null;
  await installer.analyze(ROOT, onlyUe4ss, { name: 'OnlyUe4ss' }, {}).then(p => { p2 = p; });
  t('识别成功', () => p2.ok === true || JSON.stringify(p2));
  t('落点是 Win64\\ue4ss（剥掉 ue4ss 这一层）', () =>
    path.resolve(p2.target).toLowerCase() === path.resolve(L.ue4ssDir).toLowerCase() || p2.target);
  t('prereqKey 为空（不是 UE4SS 本体包）', () => !p2.prereqKey || String(p2.prereqKey));

  console.log('\n=== 3) 服装 Mod（CustomNanosuitSystem\\ 数据目录）→ requiresCns ===');
  const cloth = zip('CoolOutfit', {
    'CoolOutfit/Content/Paks/~Mods/CustomNanosuitSystem/Cosmetics/MyOutfit.dekcns': '{}',
    'CoolOutfit/readme.txt': 'requires CNS'
  });
  let p3 = null;
  await installer.analyze(ROOT, cloth, { name: 'CoolOutfit' }, {}).then(p => { p3 = p; });
  t('识别成功', () => p3.ok === true || JSON.stringify(p3));
  t('requiresCns = true', () => p3.requiresCns === true || String(p3.requiresCns));
  t('给出了可读的识别依据', () => !!p3.requiresCnsReason || String(p3.requiresCnsReason));
  // ⚠️ 不能断言 plan.target === ~Mods：包内自带 `Content\` 前缀时，
  //    走的是「包含 Content\，按 Paks 结构落盘」那条规则，落点是 SB\，
  //    真正的最终位置由 mapping 的 rel 决定。所以这里断言**最终落点**。
  t('最终落点在 ~Mods\\CustomNanosuitSystem\\ 下', () => {
    const m = p3.mapping.find(x => /MyOutfit\.dekcns$/i.test(x.rel));
    if (!m) return '没找到 MyOutfit.dekcns 的映射';
    const want = path.resolve(path.join(L.modsDir, 'CustomNanosuitSystem', 'Cosmetics')).toLowerCase();
    const got = path.resolve(path.dirname(m.to)).toLowerCase();
    return got === want || m.to;
  });

  console.log('\n=== 4) 只有 .dekani 动画文件的服装 Mod → requiresCns ===');
  const anim = zip('AnimOutfit', {
    'Content/Paks/~Mods/CustomNanosuitSystem/Animations/DekCNS-AnimationsEVE.dekani': '{}'
  });
  let p4 = null;
  await installer.analyze(ROOT, anim, { name: 'AnimOutfit' }, {}).then(p => { p4 = p; });
  t('识别成功', () => p4.ok === true || JSON.stringify(p4));
  t('requiresCns = true', () => p4.requiresCns === true || String(p4.requiresCns));

  console.log('\n=== 5) 普通 pak mod 不该被误判成服装 Mod ===');
  const plain = zip('PlainPak', { 'xxx_P.pak': 'PAK', 'xxx_P.ucas': 'UCAS', 'xxx_P.utoc': 'UTOC' });
  let p5 = null;
  await installer.analyze(ROOT, plain, { name: 'PlainPak' }, {}).then(p => { p5 = p; });
  t('识别成功', () => p5.ok === true || JSON.stringify(p5));
  t('requiresCns = false', () => p5.requiresCns === false || String(p5.requiresCns));
  t('prereqKey 为空', () => !p5.prereqKey || String(p5.prereqKey));

  console.log('\n=== 6) 目录名只是「碰巧带 nanosuit」不该误报 ===');
  const fake = zip('NanosuitUiTweaks', {
    'Content/Paks/~Mods/NanosuitUiTweaks_P.pak': 'PAK'
  });
  let p6 = null;
  await installer.analyze(ROOT, fake, { name: 'NanosuitUiTweaks' }, {}).then(p => { p6 = p; });
  t('识别成功', () => p6.ok === true || JSON.stringify(p6));
  t('requiresCns = false（只有精确的 CustomNanosuitSystem 目录才算）', () =>
    p6.requiresCns === false || String(p6.requiresCns));

  console.log('\n=== 7) registryIdFor 尊重 meta.registryId ===');
  t('显式 registryId 优先', () =>
    installFlow.registryIdFor(L, { kind: 'prereq' }, [], { registryId: 'builtin:ue4ss', modId: 1496 }) === 'builtin:ue4ss' ||
    installFlow.registryIdFor(L, { kind: 'prereq' }, [], { registryId: 'builtin:ue4ss', modId: 1496 }));
  t('没有 registryId 时仍按 modId 生成', () =>
    installFlow.registryIdFor(L, { kind: 'cns' }, [], { modId: 1496, fileId: 13020 }) === 'nexus:1496:13020' ||
    installFlow.registryIdFor(L, { kind: 'cns' }, [], { modId: 1496, fileId: 13020 }));

  console.log('\n=== 8) 真实 UE4SS 发布包（若已缓存） ===');
  const realZip = path.join(__dirname, '..', 'data', 'tmp', 'ue4ss-probe', 'UE4SS_v3.1.0-6.zip');
  if (fs.existsSync(realZip)) {
    let p8 = null;
    await installer.analyze(ROOT, realZip, { name: 'UE4SS' }, {}).then(p => { p8 = p; });
    t('真实包识别成功', () => p8.ok === true || JSON.stringify(p8));
    t('真实包 kind = prereq', () => p8.kind === 'prereq' || p8.kind);
    t('真实包落点 = Win64', () =>
      path.resolve(p8.target).toLowerCase() === path.resolve(L.win64).toLowerCase() || p8.target);
    t('真实包含 dwmapi.dll 且落在 Win64 根', () => {
      const m = p8.mapping.find(x => x.rel === 'dwmapi.dll');
      if (!m) return '缺 dwmapi.dll 映射';
      return path.resolve(m.to).toLowerCase() === path.resolve(path.join(L.win64, 'dwmapi.dll')).toLowerCase() || m.to;
    });
    t('真实包含 ue4ss\\UE4SS.dll', () => {
      const m = p8.mapping.find(x => x.rel === 'ue4ss/UE4SS.dll');
      if (!m) return '缺 ue4ss/UE4SS.dll 映射';
      return path.resolve(m.to).toLowerCase() === path.resolve(path.join(L.win64, 'ue4ss', 'UE4SS.dll')).toLowerCase() || m.to;
    });
  } else {
    console.log('  · 跳过（未缓存真实包，可先跑一次 UE4SS 一键安装）');
  }

  console.log('\n=== 9) 陈旧临时目录清扫（rmrf 兜底） ===');
  const pathsMod = require('../src/main/paths');
  // 先清掉**本套件自己**可能留下的残渣（只认测试专用的名字，不碰真实运行的目录）。
  // 为什么必须清：`sweepStaleTmp()` 删不掉时会**改名**成 `extract-STALE-TEST.trash-<ts>`，
  // 而 Windows 上 `renameSync` **保留目录 mtime** —— 于是这个「刚改名」的垃圾桶
  // 带着 2 小时前的 mtime，会被同一次运行里的 `sweepTrash()` 立刻收走，
  // 混进 swept 结果里，让后面的断言看起来莫名其妙（实测偶发红一条）。
  const sweepTestLeftovers = () => {
    let names = [];
    try { names = fs.readdirSync(pathsMod.TMP); } catch { return; }
    for (const n of names) {
      if (!/^extract-(STALE|FRESH|FAIL|GHOST|TRASH-[A-Z]+)-TEST(\.trash-\d+)?$/.test(n)) continue;
      try { fs.rmSync(path.join(pathsMod.TMP, n), { recursive: true, force: true, maxRetries: 3 }); } catch { /* 留给 sweepTrash */ }
    }
  };
  sweepTestLeftovers();
  const stale = path.join(pathsMod.TMP, 'extract-STALE-TEST');
  const fresh = path.join(pathsMod.TMP, 'extract-FRESH-TEST');
  const unrelated = path.join(pathsMod.TMP, 'keep-me');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'x.txt'), 'x');
  fs.mkdirSync(fresh, { recursive: true });
  fs.mkdirSync(unrelated, { recursive: true });
  // 把 stale 的 mtime 拨回 2 小时前
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  const swept = installer.sweepStaleTmp();
  t('清掉了陈旧的 extract-* 目录', () => !fs.existsSync(stale) || '还在');
  t('没动刚建的（可能正在用）', () => fs.existsSync(fresh) || '被误删了');
  t('没动不认识的目录', () => fs.existsSync(unrelated) || '被误删了');
  t('返回了被清掉的目录名', () => swept.some(n => n === 'extract-STALE-TEST') || JSON.stringify(swept));
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.rmSync(unrelated, { recursive: true, force: true });

  console.log('\n=== 10) 删不掉时改名兜底 + sweepTrash 收尾 ===');
  //
  // 真实场景：刚写完 24 MB 的 DLL，杀软/句柄还占着 → fs.rmSync 反复 EBUSY。
  // 与其原地失败让目录永久泄漏，不如**改名**（改名只需要父目录句柄，不受目录内容影响），
  // 再由 sweepTrash() 过一会儿收掉。
  //
  // 这个失败很难在测试里稳定复现（Node 打开文件时带 FILE_SHARE_DELETE），
  // 所以这里**临时把 fs.rmSync 换成必定抛 EBUSY 的桩**，把兜底分支钉死。
  {
    const failDir = path.join(pathsMod.TMP, 'extract-FAIL-TEST');
    fs.rmSync(failDir, { recursive: true, force: true });
    fs.mkdirSync(failDir, { recursive: true });
    fs.writeFileSync(path.join(failDir, 'a.txt'), 'a');

    const origRm = fs.rmSync;
    let calls = 0;
    fs.rmSync = () => { calls++; const e = new Error('EBUSY: fake lock'); e.code = 'EBUSY'; throw e; };
    let ok;
    try { ok = installer.rmrf(failDir); } finally { fs.rmSync = origRm; }

    t('rmSync 一直失败时 rmrf 仍返回 true（没有原地失败）', () => ok === true || String(ok));
    t('确实重试了多次', () => calls >= 5 || String(calls));
    t('原目录名已经不存在', () => !fs.existsSync(failDir) || '还在');

    // Windows 上 `fs.rmSync` 递归删目录会**先删干净再抛**（顶层 rmdir 与子项删除
    // 竞态，Node 已知行为）。这时目录其实已经没了 —— rmrf 必须返回 true，
    // 否则调用方以为目录还在、`sweepTrash()` 也收不到名字（实测让本套件偶发红一条）。
    {
      const ghost = path.join(pathsMod.TMP, 'extract-GHOST-TEST');
      fs.rmSync(ghost, { recursive: true, force: true });
      fs.mkdirSync(ghost, { recursive: true });
      const origRm2 = fs.rmSync;
      fs.rmSync = (d, o) => { origRm2(d, o); const e = new Error('EBUSY: after delete'); e.code = 'EBUSY'; throw e; };
      let okGhost;
      try { okGhost = installer.rmrf(ghost); } finally { fs.rmSync = origRm2; }
      t('rmSync「删完才抛」时 rmrf 仍返回 true（不误报失败）', () => okGhost === true || String(okGhost));
      t('GHOST 目录确实没了', () => !fs.existsSync(ghost) || '还在');
    }

    const trashName = fs.readdirSync(pathsMod.TMP)
      .find(n => /^extract-FAIL-TEST\.trash-\d+$/.test(n));
    t('留下了 .trash-<时间戳> 目录', () => !!trashName || fs.readdirSync(pathsMod.TMP).join(','));

    // 垃圾桶目录要能被清扫收掉。
    //
    // ⚠️ 这里**不能**用 `sweepTrash(0)` 去清刚建的那个：文件 mtime 带亚毫秒精度，
    //    刚创建的目录 mtime 可能比 `Date.now()` 大零点几毫秒，于是
    //    `now - mtime < 0` 成立，被当成「太新」跳过（生产用的 10 分钟阈值不受影响）。
    //    所以另造一个「已经放了 20 分钟」的垃圾桶目录来断言清扫逻辑。
    const oldName = 'extract-TRASH-OLD.trash-' + Date.now();
    const oldTrash = path.join(pathsMod.TMP, oldName);
    fs.mkdirSync(path.join(oldTrash, 'inner'), { recursive: true });
    const back = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(oldTrash, back, back);

    const freshName = 'extract-TRASH-NEW.trash-' + Date.now();
    const freshTrash = path.join(pathsMod.TMP, freshName);
    fs.mkdirSync(freshTrash, { recursive: true });

    const swept2 = installer.sweepTrash(10 * 60 * 1000);
    t('sweepTrash 能收掉到时的垃圾桶目录', () => !fs.existsSync(oldTrash) || '还在');
    t('sweepTrash 返回了被收掉的目录名', () => swept2.includes(oldName) || JSON.stringify(swept2));
    t('没到时限的垃圾桶目录不会被误清', () => fs.existsSync(freshTrash) || '被误删了');
    t('垃圾桶目录不会被套娃成 .trash-x.trash-y', () =>
      !fs.readdirSync(pathsMod.TMP).some(n => /\.trash-\d+\.trash-\d+$/.test(n)) || '套娃了');

    // 收尾：把本组造的东西清干净（用原始 fs，避免再触发改名分支）。
    // ⚠️ 受限沙箱的「批量删除守卫」（同一轮对话删除次数超阈值）会在这里抛错 ——
    //    清理失败**不该让整个套件崩掉**（断言部分早就跑完了），所以包一层。
    safeRm(freshTrash);
    if (trashName) safeRm(path.join(pathsMod.TMP, trashName));
    // STALE-TEST 若被 rmrf 改名（删不掉时）也要收掉，别留给下一轮
    sweepTestLeftovers();
  }

  console.log('\n=== 清理 ===');
  safeRm(BASE);
  console.log('  ✓ 已清理临时目录');

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})();
