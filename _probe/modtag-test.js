'use strict';
/**
 * 文件名标识（`src/main/modTag.js`）：管理器装进去的 Mod 自带 Nexus 身份。
 *
 * 用户诉求（2026-11-07）：
 *   「通过本管理器安装的 mod，mod 目录内的文件名要有统一规律，要能与 nexus 系统中的
 *     标识匹配上，这样从新加载游戏目录后，已经安装的 mod 就能容易关联上了。」
 *
 * 覆盖五块：
 *   1. 命名规则本身 —— `[nx<modId>]` 的后缀形态、幂等、只动 pak/ucas/utoc；
 *   2. 安装时真的改名 —— 拿真压缩包跑 `installer.analyze()`，看 mapping 里的文件名；
 *      CNS 的 `.dekcns`、带同名伴随目录的 LogicMods 包都必须**不动**；
 *   3. 扫描时能读回来 —— `scanner.scanPaks()` 的条目要带 `tag`；
 *   4. 解析时优先用标识 —— `linker.suggestFor()` 见到 tag 就直配（高分、高置信），
 *      目录里没有这个 modId 时退回名字打分；
 *   5. 接线 —— 渲染层提示、i18n 词条、重装残留清理都在。
 *
 * 纯 Node：不联网、不打真实 `data/`，临时目录全部落在系统 temp。
 * 运行：`npm run test:modtag`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const modTag = require('../src/main/modTag');
const linker = require('../src/main/linker');

const TMP = path.join(os.tmpdir(), 'sb-modtag-test');
const ROOT = path.join(TMP, 'work');
const GAME = 'c:\\Star Blade';

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');
const SCANNER = path.join(__dirname, '..', 'src', 'main', 'scanner.js');
const INSTALLER = path.join(__dirname, '..', 'src', 'main', 'installer.js');
const FLOW = path.join(__dirname, '..', 'src', 'main', 'installFlow.js');
const KEYS = path.join(__dirname, 'i18n-keys.json');

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

/** 把一批文件打成 zip（用系统自带 bsdtar，不引第三方依赖） */
function makeZip(name, files) {
  const dir = path.join(TMP, 'src-' + name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  const zip = path.join(TMP, name + '.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('C:\\Windows\\System32\\tar.exe', ['-a', '-c', '-f', zip, '-C', dir, '.'], { stdio: 'ignore' });
  return zip;
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });

  /* ---------------- 1. 命名规则 ---------------- */
  console.log('\n[1] 命名规则');
  eq(modTag.tagOf({ modId: 4471 }), ' [nx4471]', 'tagOf 带前导空格');
  eq(modTag.tagOf({}), '', '没有 modId → 空串');
  eq(modTag.tagOf({ modId: 'abc' }), '', 'modId 不是数字 → 空串');
  eq(modTag.applyTag('HD-ATOOL_P.pak', { modId: 4471 }), 'HD-ATOOL_P [nx4471].pak', 'pak 加后缀标识');
  eq(modTag.applyTag('Eve.ucas', { modId: 391 }), 'Eve [nx391].ucas', 'ucas 同样加');
  eq(modTag.applyTag('Eve.utoc', { modId: 391 }), 'Eve [nx391].utoc', 'utoc 同样加');
  eq(modTag.applyTag('some.dekcns', { modId: 391 }), 'some.dekcns', 'dekcns 不动（pak 内部按名引用）');
  eq(modTag.applyTag('readme.txt', { modId: 391 }), 'readme.txt', '非 pak 三件套不动');
  eq(modTag.applyTag('HD-ATOOL_P.pak', {}), 'HD-ATOOL_P.pak', '没有 modId 时原样返回');
  eq(modTag.applyTag(modTag.applyTag('a.pak', { modId: 7 }), { modId: 7 }), 'a [nx7].pak', '幂等（不会叠两个标识）');
  eq(modTag.applyTag('a [nx1].pak', { modId: 9 }), 'a [nx9].pak', '改号时替换旧标识');
  eq(modTag.applyTag('[nx1].pak', { modId: 9 }), '[nx1].pak', '剥完只剩扩展名时不动它');
  eq(JSON.stringify(modTag.parse('HD-ATOOL_P [nx4471].pak')), '{"modId":4471}', 'parse 读得回来');
  eq(JSON.stringify(modTag.parse('C:\\x\\y\\a [nx12].pak')), '{"modId":12}', 'parse 支持整条路径');
  eq(JSON.stringify(modTag.parse('HD-ATOOL_P.pak')), 'null', '没有标识 → null');
  eq(modTag.parse('a [nx999999999].pak'), null, '位数超限（>8 位）不认');
  eq(modTag.stripTag('HD-ATOOL_P [nx4471].pak'), 'HD-ATOOL_P.pak', 'stripTag 还原原文件名');
  eq(modTag.stripTag('没有标识.pak'), '没有标识.pak', 'stripTag 对没有标识的名字无副作用');
  eq(modTag.needsTag('a.pak', { modId: 1 }), true, 'needsTag：能加');
  eq(modTag.needsTag('a [nx1].pak', { modId: 1 }), false, 'needsTag：已经是目标形态');
  eq(modTag.needsTag('a.dekcns', { modId: 1 }), false, 'needsTag：类型不对');

  /* ---------------- 2. 安装时改名（真压缩包） ---------------- */
  console.log('\n[2] 安装时改名（installer.analyze）');
  const installer = require('../src/main/installer');
  const layout = require('../src/main/game').layout(GAME);

  const one = makeZip('one', { 'HD-ATOOL_P.pak': 'x'.repeat(64) });
  const plan1 = await installer.analyze(GAME, one, { modId: 4471, name: 'HD ATOOL' }, {});
  t('单个 pak：analysis 成功', () => (plan1 && plan1.ok ? true : (plan1 && (plan1.reason || plan1.diagnosis)) || '失败'));
  eq(plan1.mapping[0].rel, 'HD-ATOOL_P [nx4471].pak', 'mapping 里的文件名带标识');
  eq(path.basename(plan1.mapping[0].to), 'HD-ATOOL_P [nx4471].pak', '落点的文件名也带标识');
  t('落点目录就是计划的目标目录（没有把文件挪到别处）',
    () => (path.dirname(plan1.mapping[0].to) === plan1.target ? true : plan1.mapping[0].to + ' vs ' + plan1.target));
  eq(plan1.nameTag, '[nx4471]', 'plan 回报 nameTag');
  eq(plan1.taggedFiles.length, 1, 'taggedFiles 记了 1 个');

  const triple = makeZip('triple', {
    'SomeMod_P.pak': 'a', 'SomeMod_P.ucas': 'b', 'SomeMod_P.utoc': 'c'
  });
  const plan2 = await installer.analyze(GAME, triple, { modId: 2038, name: 'Some' }, {});
  eq(plan2.mapping.map(m => m.rel).sort().join('|'),
    'SomeMod_P [nx2038].pak|SomeMod_P [nx2038].ucas|SomeMod_P [nx2038].utoc',
    '三件套同名同步加标识');
  t('三件套落在 ~Mods / LogicMods 之内（没被挪出 mod 目录）',
    () => (plan2.mapping.every(m => m.to.toLowerCase().startsWith(layout.modsDir.toLowerCase())
      || m.to.toLowerCase().startsWith(layout.logicModsDir.toLowerCase())) ? true : '落点跑到别处'));

  const noId = await installer.analyze(GAME, triple, { name: 'Some' }, {});
  eq(noId.mapping.map(m => m.rel).sort().join('|'), 'SomeMod_P.pak|SomeMod_P.ucas|SomeMod_P.utoc',
    '没有 modId（本地导入）一个都不改名');
  eq(noId.nameTag, null, '没有 modId 时 nameTag 为 null');

  // pak + 同名伴随目录（LogicMods 的配套关系）→ 都不动
  const companion = makeZip('companion', {
    'HD-ATOOL_P/audio/x.txt': 'a', 'HD-ATOOL_P.pak': 'b'
  });
  const plan3 = await installer.analyze(GAME, companion, { modId: 4471, name: 'HD ATOOL' }, {});
  t('有同名伴随目录时：pak 不改名（配套数据目录按名字找）',
    () => (plan3.mapping.every(m => !/\[nx/.test(m.rel)) ? true : '改动了：' + plan3.mapping.map(m => m.rel).join(', ')));

  /* ---------------- 2b. 真正装一遍：磁盘上到底叫什么 ---------------- */
  console.log('\n[2b] 真正装一遍（合成游戏目录 + installFlow.runInstall）');
  const gameMod = require('../src/main/game');
  const flow = require('../src/main/installFlow');
  const fakeRoot = path.join(TMP, 'Star Blade');
  fs.mkdirSync(path.join(fakeRoot, 'SB', 'Content', 'Paks', '~Mods'), { recursive: true });
  fs.mkdirSync(path.join(fakeRoot, 'SB', 'Binaries', 'Win64'), { recursive: true });
  const fakeLayout = gameMod.layout(fakeRoot);
  const reg = (() => {
    const db = new Map();
    return {
      all: () => [...db.values()],
      get: (id) => db.get(id) || null,
      upsert: (e) => { db.set(e.id, e); return e; },
      remove: (id) => db.delete(id),
      byTarget: () => null,
      byTargetAll: () => [],
      patch: () => null,
      setEnabled: () => null
    };
  })();

  const r1 = await flow.runInstall({
    root: fakeRoot, archivePath: triple, meta: { modId: 2038, name: 'Some Mod', version: '1.0' },
    registry: reg, layout: fakeLayout
  });
  const disk1 = fs.readdirSync(fakeLayout.modsDir).sort();
  eq(disk1.join('|'), 'SomeMod_P [nx2038].pak|SomeMod_P [nx2038].ucas|SomeMod_P [nx2038].utoc',
    '装完磁盘上就是带标识的文件名');
  eq(r1.nameTag, '[nx2038]', '安装结果回报 nameTag');
  t('注册表清单里也是带标识的路径',
    () => (r1.manifest.every(f => /\[nx2038\]/.test(path.basename(f.path))) ? true : r1.manifest.map(f => f.path).join(', ')));

  // 模拟「升级前装的是无标识的老版本」：手动放一份旧文件并记进注册表清单
  const oldFile = path.join(fakeLayout.modsDir, 'SomeMod_P.pak');
  fs.writeFileSync(oldFile, 'old');
  const entry = reg.get(r1.id);
  entry.manifest = entry.manifest.concat([{ path: oldFile, rel: 'SomeMod_P.pak', size: 3 }]);
  reg.upsert(entry);

  const r2 = await flow.runInstall({
    root: fakeRoot, archivePath: triple, meta: { modId: 2038, name: 'Some Mod', version: '1.0' },
    registry: reg, layout: fakeLayout
  });
  const disk2 = fs.readdirSync(fakeLayout.modsDir).sort();
  eq(r2.staleRemoved.length, 1, '升级时清掉了改名残留（1 个）');
  t('残留的无标识旧文件已从磁盘消失',
    () => (disk2.includes('SomeMod_P.pak') ? '旧文件还在：' + disk2.join(', ') : true));
  eq(disk2.length, 3, '磁盘上只剩三件套（不会两份都挂着）');


  console.log('\n[3] 扫描时读回来（scanner.scanPaks）');
  const scanner = require('../src/main/scanner');
  const modsDir = path.join(TMP, '~Mods');
  fs.mkdirSync(modsDir, { recursive: true });
  for (const n of ['A_P [nx11].pak', 'A_P [nx11].ucas', 'B_P.pak', 'C.dekcns']) {
    fs.writeFileSync(path.join(modsDir, n), 'x');
  }
  const fakeRegistry = { byTarget: () => null, get: () => null };
  const scanned = scanner.scanPaks({ modsDir }, fakeRegistry);
  const byName = new Map(scanned.map(m => [m.name, m]));
  eq(JSON.stringify((byName.get('A_P [nx11]') || {}).tag), '{"modId":11}', 'pak 条目带 tag');
  eq((byName.get('B_P') || {}).tag, null, '没有标识的条目 tag 为 null');

  // 禁用态（`.pak.disabled`）：分组键要跟启用态一致（否则开关一按 ID 就变），标签也要读得出来
  const disDir = path.join(TMP, '~Mods-disabled');
  fs.mkdirSync(disDir, { recursive: true });
  fs.writeFileSync(path.join(disDir, 'C_P [nx12].pak.disabled'), 'x');
  const dis = scanner.scanPaks({ modsDir: disDir }, fakeRegistry);
  eq(dis.length, 1, '禁用态仍然是一个条目');
  eq(dis[0].name, 'C_P [nx12]', '禁用态的分组键与启用态一致');
  eq(dis[0].enabled, false, '禁用态标记为未启用');
  eq(JSON.stringify(dis[0].tag), '{"modId":12}', '禁用态也能读出标识');
  t('标识不影响分组（三件套仍归一个条目）',
    () => ((byName.get('A_P [nx11]') || {}).fileCount === 2 ? true : '文件数不是 2'));

  /* ---------------- 4. 解析时优先用标识 ---------------- */
  console.log('\n[4] 解析时优先用标识（linker.suggestFor）');
  const catalog = [
    { modId: 11, name: 'Completely Different Title', downloads: 5 },
    { modId: 99, name: 'Eve Pink Bodysuit', downloads: 900 }
  ];
  const index = linker.buildIndex(catalog);
  t('buildIndex 带 byId 表', () => (index.byId instanceof Map && index.byId.get(11) === 0 ? true : '缺 byId'));

  const hit = linker.suggestFor({ id: 'disk:paks:Eve_Pink_P [nx11]', name: 'Eve_Pink_P [nx11]', tag: { modId: 11 } }, index);
  eq(hit.best && hit.best.modId, 11, '标识命中：选的是 #11（名字完全不像也对）');
  eq(hit.best && hit.best.confidence, 'high', '标识命中：直接高置信');
  eq(hit.best && hit.best.score, 1, '标识命中：分数 1');
  eq(hit.tagged, true, '结果标了 tagged');
  eq(hit.candidates.length, 1, '只给这一个候选（不给用户瞎选）');

  const missTag = linker.suggestFor({ id: 'disk:paks:Eve_Pink_P [nx404]', name: 'Eve_Pink_P [nx404]', tag: { modId: 404 } }, index);
  eq(missTag.tagged, false, '目录里没有这个 modId → 不算标识命中');
  eq(missTag.best && missTag.best.modId, 99, '退回名字打分（Eve_Pink_P → #99）');

  const nameOnly = linker.suggestFor({ id: 'disk:paks:Eve_Pink_P', name: 'Eve_Pink_P' }, index);
  eq(nameOnly.best && nameOnly.best.modId, 99, '没有标识时行为不变');

  /* ---------------- 5. 接线 ---------------- */
  console.log('\n[5] 接线');
  const ipcSrc = fs.readFileSync(IPC, 'utf8');
  const instSrc = fs.readFileSync(INSTALLER, 'utf8');
  const flowSrc = fs.readFileSync(FLOW, 'utf8');
  const scanSrc = fs.readFileSync(SCANNER, 'utf8');
  const appSrc = fs.readFileSync(APP, 'utf8');
  const keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
  const keyText = JSON.stringify(keys);

  t('installer 引了 modTag', () => (instSrc.includes("require('./modTag')") ? true : '没引用'));
  t('installer 的改名在冲突检测之前', () => {
    const a = instSrc.indexOf('modTag.applyTag(base, meta)');
    const b = instSrc.indexOf('ownedSet');
    return a > 0 && b > 0 && a < b ? true : '顺序不对';
  });
  t('installer 只处理 pak 三件套', () => (instSrc.includes('modTag.needsTag(base, meta)') && instSrc.includes('modTag.TAGGABLE') ? true : '缺类型过滤'));
  t('installer 有「同名伴随目录不动」的刹车', () => (instSrc.includes('relDirs.has(stem)') ? true : '缺刹车'));
  t('scanner 条目带 tag', () => (scanSrc.includes('modTag.parse(') ? true : '没解析标识'));
  t('ipc 把 tag 传进 suggestFor', () => (ipcSrc.includes('tag: m.tag') ? true : '没传 tag'));
  t('ipc 结果带 tagged 字段', () => (ipcSrc.includes('tagged: !!r.tagged') ? true : '缺字段'));
  t('installFlow 会清理改名残留', () => (flowSrc.includes('staleRemoved') && flowSrc.includes('modTag.stripTag(') ? true : '没清理'));
  t('installFlow 返回 nameTag', () => (flowSrc.includes('nameTag: plan.nameTag') ? true : '缺'));
  t('渲染层显示「文件名带标识」', () => (appSrc.includes('文件名带标识') ? true : '没显示'));
  t('渲染层按 matchedBy 区分来源说明', () => (appSrc.includes("matchedBy === 'tag'") ? true : '没区分'));
  t('i18n 词条已补', () => (keyText.includes('文件名带标识') ? true : 'keys.json 里没有'));

  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exitCode = 1;
  }
}

main();
