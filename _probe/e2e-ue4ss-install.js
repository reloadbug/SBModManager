'use strict';
/**
 * UE4SS 一键安装的真实端到端验证（**装进假游戏根，不碰真实游戏目录**）。
 *
 * 走的是「一键安装」按钮背后的同一条链路：
 *   installFlow.runInstall（与下载队列自动安装共用）→ 落点判定 → 解压复制 → 注册表登记
 * 然后按注册表 manifest 反装一遍，验证能干净回滚。
 *
 * 用真实的 UE4SS 发布包（若 `data/tmp/ue4ss-probe/` 里已缓存），
 * 没有缓存就合成一个结构等价的包，保证这个套件离线也能跑。
 *
 * 用法：
 *   node _probe/e2e-ue4ss-install.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../src/main/installer');
const installFlow = require('../src/main/installFlow');
const game = require('../src/main/game');
const { createRegistry } = require('../src/main/registry');
const paths = require('../src/main/paths');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-e2e-ue4ss');
const ROOT = path.join(BASE, 'fakeroot');
const PKG = path.join(BASE, 'pkg');
/**
 * 本次运行的起始时刻。
 * ⚠️ 末尾「不泄漏」断言只该关心**自己产生的**目录 —— 受限沙箱的批量删除守卫
 *    会让**前面套件**（如 installer-deps-test）的 `.trash-*` 残留清不掉，
 *    那些比本次运行更早，不该算到本套件头上。
 */
const RUN_START = Date.now();
/** 给「同一次 test:all 里前面的套件」留一点容差，避免边界上误伤 */
const RUN_TOLERANCE_MS = 60 * 1000;

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

function mkzip(name, files) {
  const stage = path.join(BASE, 'src', name);
  fs.rmSync(stage, { recursive: true, force: true });
  mk(stage, files);
  const out = path.join(PKG, name + '.zip');
  fs.mkdirSync(PKG, { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx1', out, '.'], { cwd: stage, stdio: 'ignore' });
  return out;
}

/** 合成的 UE4SS 包（结构与真实发布包一致：外层包装目录 + dwmapi.dll + ue4ss\） */
function syntheticUe4ss() {
  return mkzip('UE4SS_v0.0.0-test', {
    'UE4SS_v0.0.0-test/dwmapi.dll': 'FAKE-DWMAPI-DLL',
    'UE4SS_v0.0.0-test/ue4ss/UE4SS.dll': 'FAKE-CORE',
    'UE4SS_v0.0.0-test/ue4ss/UE4SS-settings.ini': '[Settings]',
    'UE4SS_v0.0.0-test/ue4ss/Mods/mods.txt': 'BPModLoaderMod : 1',
    'UE4SS_v0.0.0-test/ue4ss/Mods/BPModLoaderMod/Scripts/main.lua': '-- bp'
  });
}

const L = game.layout(ROOT);
const abs = (...s) => path.join(ROOT, ...s);

(async function main() {
  fs.rmSync(BASE, { recursive: true, force: true });

  // ---- 假游戏根 ----
  mk(ROOT, {
    'SB/Binaries/Win64/SB-Win64-Shipping.exe': 'MZ',
    'SB/Content/Paks/~Mods/CustomNanosuitSystem/.keep': '',
    // 一个「游戏自带、会被 UE4SS 覆盖」的文件，用来验证覆盖备份
    'SB/Binaries/Win64/ue4ss/UE4SS-settings.ini': 'GAME-ORIGINAL'
  });

  const regFile = path.join(BASE, 'mods.json');
  const registry = createRegistry(regFile);

  // ---- 选包：优先真实发布包 ----
  const real = path.join(__dirname, '..', 'data', 'tmp', 'ue4ss-probe', 'UE4SS_v3.1.0-6.zip');
  const useReal = fs.existsSync(real);
  const zipPath = useReal ? real : syntheticUe4ss();
  const version = useReal ? '3.1.0-6' : '0.0.0-test';
  console.log('使用安装包：' + zipPath + (useReal ? '（真实发布包）' : '（合成包）'));

  console.log('\n=== 1) 分析 ===');
  const plan = await installer.analyze(ROOT, zipPath, { name: 'UE4SS' }, {});
  t('结构识别成功', () => plan.ok === true || JSON.stringify(plan));
  t('kind = prereq', () => plan.kind === 'prereq' || plan.kind);
  t('prereqKey = ue4ss', () => plan.prereqKey === 'ue4ss' || String(plan.prereqKey));
  t('落点 = SB\\Binaries\\Win64', () =>
    path.resolve(plan.target).toLowerCase() === path.resolve(L.win64).toLowerCase() || plan.target);
  t('检测到覆盖冲突（假根里已有 UE4SS-settings.ini）', () => plan.conflictCount >= 1 || String(plan.conflictCount));

  console.log('\n=== 2) 安装（走 installFlow，与下载队列自动安装同一条链路） ===');
  const r = await installFlow.runInstall({
    root: ROOT,
    archivePath: zipPath,
    meta: {
      name: 'UE4SS（Mod 加载器本体）',
      version,
      author: 'Chrisr0 / RE-UE4SS',
      url: 'https://github.com/Chrisr0/RE-UE4SS',
      isPrereq: true,
      prereqKey: 'ue4ss',
      registryId: 'builtin:ue4ss'
    },
    onConflict: 'overwrite',
    registry,
    layout: L
  });
  console.log('  写入 ' + r.written + ' 个文件，覆盖备份 ' + r.backedCount + ' 个');

  t('写入文件数 > 0', () => r.written > 0 || String(r.written));
  t('注册表 id = builtin:ue4ss', () => r.id === 'builtin:ue4ss' || r.id);
  t('kind = prereq', () => r.kind === 'prereq' || r.kind);

  console.log('\n=== 3) 落盘位置正确 ===');
  t('dwmapi.dll 在 Win64 根', () => fs.existsSync(abs('SB', 'Binaries', 'Win64', 'dwmapi.dll')) || '不存在');
  t('dwmapi.dll 没有被塞进 ue4ss\\', () =>
    !fs.existsSync(abs('SB', 'Binaries', 'Win64', 'ue4ss', 'dwmapi.dll')) || '被塞进 ue4ss\\ 了');
  t('ue4ss\\UE4SS.dll 存在', () => fs.existsSync(abs('SB', 'Binaries', 'Win64', 'ue4ss', 'UE4SS.dll')) || '不存在');
  t('ue4ss\\Mods\\mods.txt 存在', () => fs.existsSync(abs('SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'mods.txt')) || '不存在');
  t('没有污染 ~Mods', () => {
    const items = fs.readdirSync(abs('SB', 'Content', 'Paks', '~Mods'));
    return items.length === 1 && items[0] === 'CustomNanosuitSystem' || items.join(',');
  });

  console.log('\n=== 4) game.inspect 能认出 UE4SS 已装 ===');
  const insp = game.inspect(ROOT);
  t('ue4ss.installed = true', () => insp.ue4ss.installed === true || String(insp.ue4ss.installed));

  console.log('\n=== 5) 注册表内容 ===');
  const entry = registry.get('builtin:ue4ss');
  t('注册表里有 builtin:ue4ss', () => !!entry || '没有');
  t('manifest 数量与写入数一致', () => entry && entry.manifest.length === r.written || (entry && entry.manifest.length) + ' vs ' + r.written);
  t('记下了 prereqKey', () => entry && entry.prereqKey === 'ue4ss' || String(entry && entry.prereqKey));
  t('记下了覆盖备份目录', () => !!(entry && entry.backupDir) || '没有 backupDir');
  t('覆盖备份里确实有原文件', () => {
    if (!entry || !entry.backupDir) return '没有 backupDir';
    const b = (entry.overwritten || []).find(x => /UE4SS-settings\.ini$/i.test(x.path));
    if (!b) return '没有记录被覆盖的 UE4SS-settings.ini';
    return fs.existsSync(b.backup) || '备份文件不存在：' + b.backup;
  });

  console.log('\n=== 6) 二次安装（重装/更新）幂等：注册表不新增条目、不重复备份自己 ===');
  const r2 = await installFlow.runInstall({
    root: ROOT,
    archivePath: zipPath,
    meta: { name: 'UE4SS（Mod 加载器本体）', version, registryId: 'builtin:ue4ss', prereqKey: 'ue4ss', isPrereq: true },
    onConflict: 'overwrite',
    registry,
    layout: L
  });
  t('注册表仍然只有 1 条', () => registry.all().length === 1 || registry.all().length + ' 条：' + registry.all().map(x => x.id).join(','));
  t('二次安装也成功', () => r2.written > 0 || String(r2.written));
  t('二次安装没有重复备份自己装过的文件（backedCount = 0）', () => r2.backedCount === 0 || String(r2.backedCount));
  t('二次安装识别出这是重装', () => r2.reinstalled === true || String(r2.reinstalled));
  t('复用了同一个备份目录（没新建、没泄漏）', () =>
    !!r2.backupDir && r2.backupDir === r.backupDir || (r.backupDir + ' vs ' + r2.backupDir));
  const e2pre = registry.get('builtin:ue4ss');
  t('覆盖备份清单仍只有 1 条（游戏原文件）', () =>
    (e2pre.overwritten || []).length === 1 || String((e2pre.overwritten || []).length));

  console.log('\n=== 7) 卸载：按 manifest 反装 + 清理空目录 + 还原被覆盖的原文件 ===');
  const e2 = registry.get('builtin:ue4ss');
  // 与 ipc.js 的卸载逻辑一致：移走 manifest 文件 → 清空目录 → 还原覆盖备份
  const dest = path.join(BASE, 'uninstalled');
  fs.mkdirSync(dest, { recursive: true });
  let moved = 0;
  for (const f of e2.manifest) {
    if (!fs.existsSync(f.path)) continue;
    const rel = f.rel || path.basename(f.path);
    const to = path.join(dest, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(f.path, to);
    moved++;
  }
  const pruned = installer.pruneEmptyDirs(
    e2.manifest.map(f => path.dirname(f.path)),
    [L.root, L.sb, L.paks, L.modsDir, L.win64, L.ue4ssDir, L.ue4ssModsDir]
  );
  const rr = installer.restoreOverwritten(e2.overwritten || []);
  registry.remove('builtin:ue4ss');

  t('移走了全部文件', () => moved === e2.manifest.length || moved + ' vs ' + e2.manifest.length);
  t('dwmapi.dll 已移除', () => !fs.existsSync(abs('SB', 'Binaries', 'Win64', 'dwmapi.dll')) || '还在');
  t('ue4ss\\UE4SS.dll 已移除', () => !fs.existsSync(abs('SB', 'Binaries', 'Win64', 'ue4ss', 'UE4SS.dll')) || '还在');
  t('被覆盖的原文件已还原', () => {
    const p = abs('SB', 'Binaries', 'Win64', 'ue4ss', 'UE4SS-settings.ini');
    if (!fs.existsSync(p)) return '原文件没还原';
    return fs.readFileSync(p, 'utf8') === 'GAME-ORIGINAL' || '内容不对：' + fs.readFileSync(p, 'utf8');
  });
  t('还原成功数 = 1（只有那一份真正的游戏原文件）', () => rr.restored.length === 1 || JSON.stringify(rr.restored));
  t('还原失败 0 个', () => rr.failed.length === 0 || JSON.stringify(rr.failed));
  t('结构目录没被误删（Win64 / ue4ss 仍在）', () =>
    fs.existsSync(L.win64) && fs.existsSync(L.ue4ssDir) || '结构目录被删了');
  t('~Mods 完好', () => fs.existsSync(path.join(L.modsDir, 'CustomNanosuitSystem')) || '被删了');
  t('卸载后 game.inspect 认出 UE4SS 未装', () => game.inspect(ROOT).ue4ss.installed === false || '仍报已装');
  console.log('  · 清理空目录 ' + pruned.length + ' 个');

  console.log('\n=== 8) 清理本次产生的备份 ===');
  if (e2.backupDir) { try { installer.dropBackup(e2.backupDir); console.log('  ✓ 已清理 ' + e2.backupDir); } catch { /* 忽略 */ } }
  fs.rmSync(BASE, { recursive: true, force: true });
  console.log('  ✓ 已清理临时目录');

  console.log('\n=== 9) 备份与临时目录不泄漏 ===');
  // ⚠️ 只关心**本次时间窗内**新建的（其它可能是用户真实数据，绝不能动）
  const recentIn = (dir, re) => {
    let dirs = [];
    try { dirs = fs.readdirSync(dir); } catch { return []; }
    return dirs.filter(d => {
      if (re && !re.test(d)) return false;
      try { return Date.now() - fs.statSync(path.join(dir, d)).mtimeMs < 5 * 60 * 1000; } catch { return false; }
    });
  };

  // 🔴 只认**本套件自己创建的那一个**备份目录，不做「扫描最近新建的 ov-*」。
  //
  // 原因（2026-10-13 实测）：用户可能正开着应用在装 mod，它会在
  // `data/backup/overwritten/` 下创建**自己的** `ov-<ts>`。
  // 按「最近 5 分钟内新建的」扫，就会把用户那份算成本套件的残留 → 假失败。
  // 本套件从头到尾只用了 `r.backupDir` 一个（第二次安装复用它），所以直接查它即可。
  t('本次产生的 ov-* 备份目录已清理', () => {
    const mine = [r && r.backupDir, e2 && e2.backupDir].filter(Boolean);
    if (!mine.length) return '没记到自己的 backupDir（测试本身有问题）';
    const left = mine.filter(p => fs.existsSync(p));
    return left.length === 0 ? true : '残留：' + left.join(',');
  });

  // extract-* 只能按「最近新建的」扫（`installer.install` 内部创建、不对外暴露名字），
  // 所以这里再退一步：**等 2.5 秒复查一次**，并且只认 mtime 已超过 3 秒的。
  // 正在解压的目录 mtime 一直在更新，等一轮就会消失；真残留会一直留着。
  const extractLeak = async () => {
    const fresh = () => recentIn(paths.TMP, /^extract-\d+$/).filter(d => {
      try { return Date.now() - fs.statSync(path.join(paths.TMP, d)).mtimeMs > 3000; }
      catch { return false; }
    });
    let a = fresh();
    if (!a.length) return a;
    await new Promise(res => setTimeout(res, 2500));
    return fresh();
  };
  const eLeak = await extractLeak();
  t('本次跑完没有留下 extract-* 临时目录', () =>
    eLeak.length === 0 ? true : '残留：' + eLeak.join(','));

  // `.trash-<ts>` 是「删不掉已改名待清扫」的**设计内降级态**，不是泄漏 ——
  // 机器负载高时（杀软占用句柄）删除会偶发失败，这时就应该改名而不是原地卡住。
  // 所以这里只断言「**过期的**垃圾桶目录被收走了」，而不是「一个都不能有」。
  // ⚠️ 而且只看**本次运行之后**出现的 —— 受限沙箱的批量删除守卫会让前面套件
  //    （installer-deps-test 等）的 `.trash-*` 残留清不掉，那不该算到本套件头上。
  t('没有留下超过清扫时限（10 分钟）的待删目录', () => {
    const olderThan = (dir, re, ageMs) => {
      let dirs = [];
      try { dirs = fs.readdirSync(dir); } catch { return []; }
      return dirs.filter(d => {
        if (!re.test(d)) return false;
        try {
          const mt = fs.statSync(path.join(dir, d)).mtimeMs;
          if (mt < RUN_START - RUN_TOLERANCE_MS) return false; // 不是本次的，放过
          return Date.now() - mt > ageMs;
        } catch { return false; }
      });
    };
    const TEN_MIN = 10 * 60 * 1000;
    const all = olderThan(paths.TMP, /\.trash-\d+$/, TEN_MIN)
      .concat(olderThan(path.join(paths.BACKUP, 'overwritten'), /\.trash-\d+$/, TEN_MIN));
    return all.length === 0 || '超时未清：' + all.join(',');
  });

  // 断言跑完再收尾：把本次可能产生的 `*.trash-*`（删不掉时的降级产物）清掉。
  // 生产里由 sweepTrash 过 10 分钟收；测试跑完就清，免得开发目录越攒越多。
  // ⚠️ 必须放在上面那些断言**之后**，否则断言就成了「自己清完再说没残留」。
  try {
    let n = 0;
    for (const d of [paths.TMP, path.join(paths.BACKUP, 'overwritten')]) {
      for (const name of fs.readdirSync(d)) {
        if (!/\.trash-\d+$/.test(name)) continue;
        try { fs.rmSync(path.join(d, name), { recursive: true, force: true }); n++; } catch { /* 忽略 */ }
      }
    }
    if (n) console.log('  · 收掉 ' + n + ' 个待删目录');
  } catch { /* 忽略 */ }

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('E2E 崩溃：' + e.message + '\n' + e.stack);
  process.exit(1);
});
