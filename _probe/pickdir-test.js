'use strict';
/**
 * 「多选一变体包」自检 —— 验证 `analyze(..., { pickDir })` 这条兜底路径。
 *
 * 背景：有些包把同一件衣服的好几套变体各放一个子目录，装多套会互相覆盖。
 * 结构识别必然失败（顶层没有公共前缀、内容也不是「全是 pak」），
 * 于是返回 `needsTargetPick: true` + 候选目录清单，由用户挑一套。
 *
 * 全部在临时目录里做，**不碰真实游戏目录**。
 *
 * 用法：node _probe/pickdir-test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../src/main/installer');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-pickdir-test');
const SRC = path.join(BASE, 'src');
const PKG = path.join(BASE, 'pkg');
const ROOT = path.join(BASE, 'fakeroot');

let pass = 0, fail = 0;
const fails = [];

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
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

// 造一个假游戏根（只需要目录存在，analyze 只用到 layout 路径）
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods'), { recursive: true });

const MODS_DIR = path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods');

/* ---------------- 用例包 ---------------- */

// A. 典型「多选一变体包」：两层目录，每套含 pak 三件套 + 一张封面图
const VARIANT_PKG = zip('variant-pkg', {
  'README.txt': 'readme',
  'Suit (2 variants)/Suit_A/ID111-A_P.pak': 'pakA',
  'Suit (2 variants)/Suit_A/ID111-A_P.ucas': 'ucasA',
  'Suit (2 variants)/Suit_A/ID111-A_P.utoc': 'utocA',
  'Suit (2 variants)/Suit_A/cover_A.jpg': 'jpgA',
  'Suit (2 variants)/Suit_B/ID111-B_P.pak': 'pakB',
  'Suit (2 variants)/Suit_B/ID111-B_P.ucas': 'ucasB',
  'Suit (2 variants)/Suit_B/ID111-B_P.utoc': 'utocB',
  'Suit (2 variants)/Suit_B/cover_B.jpg': 'jpgB'
});

// B. 混合包：既有「pak 直接在顶层目录下」的单层变体，也有两层目录的变体
//    （真实 mod 692 就是这个形态：`EVE39_xxx (1variants)` 与 `Suit (2 variants)/Suit_A` 并存）
const FLAT_PKG = zip('flat-pkg', {
  'Solo Variant/ID222_P.pak': 'pak',
  'Solo Variant/ID222_P.ucas': 'ucas',
  'Solo Variant/ID222_P.utoc': 'utoc',
  'Nested Variant/Sub/ID333_P.pak': 'pak',
  'Nested Variant/Sub/ID333_P.ucas': 'ucas',
  'Nested Variant/Sub/ID333_P.utoc': 'utoc'
});

// B2. 只有一个顶层目录、里面全是 pak —— 这种**能自动识别**，不该要求用户选
const SOLO_PKG = zip('solo-pkg', {
  'Solo Variant/ID222_P.pak': 'pak',
  'Solo Variant/ID222_P.ucas': 'ucas',
  'Solo Variant/ID222_P.utoc': 'utoc'
});

// C. 包里没有 pak（纯脚本）—— 不该给出变体候选
const NOPAK_PKG = zip('nopak-pkg', {
  'SomeDir/readme.md': 'x',
  'SomeDir/data.bin': 'y'
});

// D. 正常 pak 包（用于回归：不该被 pickDir 逻辑影响）
const NORMAL_PKG = zip('normal-pkg', {
  'NormalMod_P.pak': 'pak',
  'NormalMod_P.ucas': 'ucas',
  'NormalMod_P.utoc': 'utoc'
});

// I1. 互斥分组：同一资产 ID 的两套（互斥）+ 一个独立目录（可一起装）
const MIXED_GROUP_PKG = zip('mixed-group-pkg', {
  'GroupA/Suit_A/ID555-A_P.pak': 'a1',
  'GroupA/Suit_A/ID555-A_P.ucas': 'a2',
  'GroupA/Suit_A/ID555-A_P.utoc': 'a3',
  'GroupA/Suit_B/ID555-B_P.pak': 'b1',
  'GroupA/Suit_B/ID555-B_P.ucas': 'b2',
  'GroupA/Suit_B/ID555-B_P.utoc': 'b3',
  'Extra/Font_P.pak': 'f1',
  'Extra/Font_P.ucas': 'f2',
  'Extra/Font_P.utoc': 'f3'
});

// I2. 没有资产编号，但两套里的 pak **同名** → 仍是互斥（真实 mod 1378 就是这个形态：
//     `Default version Black full dress replace` vs `... Black rose replace`）
const SAME_NAME_PKG = zip('same-name-pkg', {
  'Black/Default_P.pak': '1', 'Black/Default_P.ucas': '2', 'Black/Default_P.utoc': '3',
  'Rose/Default_P.pak': '4', 'Rose/Default_P.ucas': '5', 'Rose/Default_P.utoc': '6'
});

// I3. 三套互不相关（资产 ID 各不相同）→ 不该被编进任何互斥组，三套都要能装
//     （真实 mod 3970：主 mod + Ahuang 皮肤 + 中文字体）
const UNRELATED_PKG = zip('unrelated-pkg', {
  'Main/ID701_P.pak': '1', 'Main/ID701_P.ucas': '2', 'Main/ID701_P.utoc': '3',
  'Skin/ID702_P.pak': '4', 'Skin/ID702_P.ucas': '5', 'Skin/ID702_P.utoc': '6',
  'Font/ID703_P.pak': '7', 'Font/ID703_P.ucas': '8', 'Font/ID703_P.utoc': '9'
});

const META = { name: 'Test Variant Mod', modId: 9999, fileId: 1 };

(async () => {
  console.log('\n=== A. 变体包：不指定 pickDir ===');

  const a0 = await installer.analyze(ROOT, VARIANT_PKG, META, {});

  t('识别失败且标记 needsTargetPick', () =>
    (a0.ok === false && a0.needsTargetPick === true) ? true : `ok=${a0.ok} needsTargetPick=${a0.needsTargetPick}`);

  t('返回 2 个候选变体', () => {
    const n = (a0.options || []).length;
    return n === 2 ? true : '候选 ' + n + ' 个';
  });

  t('候选带 label / group / files / size', () => {
    const o = (a0.options || [])[0];
    if (!o) return '没有候选';
    if (o.label !== 'Suit_A') return 'label=' + o.label;
    if (o.group !== 'Suit (2 variants)') return 'group=' + o.group;
    if (o.files !== 3) return 'files=' + o.files;   // pak/ucas/utoc，jpg 不算
    if (!(o.size > 0)) return 'size=' + o.size;
    return true;
  });

  t('候选的 dir 是归档内原始路径', () => {
    const o = (a0.options || [])[0];
    return o.dir === 'Suit (2 variants)/Suit_A' ? true : 'dir=' + o.dir;
  });

  t('候选按 dir 排序（界面顺序稳定）', () => {
    const dirs = (a0.options || []).map(o => o.dir);
    const sorted = [...dirs].sort((x, y) => x.localeCompare(y, 'en'));
    return JSON.stringify(dirs) === JSON.stringify(sorted) ? true : JSON.stringify(dirs);
  });

  console.log('\n=== B. 变体包：指定 pickDir ===');

  const a1 = await installer.analyze(ROOT, VARIANT_PKG, META, { pickDir: 'Suit (2 variants)/Suit_A' });

  t('识别成功', () => a1.ok === true ? true : 'ok=' + a1.ok);
  t('类型判为 pak', () => a1.kind === 'pak' ? true : 'kind=' + a1.kind);
  t('落点是 ~Mods', () => a1.target === MODS_DIR ? true : 'target=' + a1.target);

  t('只装选中的 3 个文件（不含另一套）', () => {
    const rels = (a1.mapping || []).map(m => m.rel).sort();
    const want = ['ID111-A_P.pak', 'ID111-A_P.ucas', 'ID111-A_P.utoc'];
    return JSON.stringify(rels) === JSON.stringify(want) ? true : JSON.stringify(rels);
  });

  t('落点路径不含变体目录前缀', () => {
    const bad = (a1.mapping || []).filter(m => /Suit|variants/.test(m.rel));
    return bad.length ? JSON.stringify(bad.map(m => m.rel)) : true;
  });

  t('封面 jpg 被忽略（不进 mapping）', () => {
    const bad = (a1.mapping || []).filter(m => /\.jpg$/i.test(m.rel));
    return bad.length ? JSON.stringify(bad.map(m => m.rel)) : true;
  });

  t('warnings 不把「其它变体」说成「忽略的说明文件」', () => {
    const wrong = (a1.warnings || []).filter(w => /忽略说明\/图片文件/.test(w) && /Suit_B/.test(w));
    return wrong.length ? JSON.stringify(wrong) : true;
  });

  // 换一套，验证装的是另一套
  const a2 = await installer.analyze(ROOT, VARIANT_PKG, META, { pickDir: 'Suit (2 variants)/Suit_B' });
  t('换选 B 套 → 装的是 B 的文件', () => {
    const rels = (a2.mapping || []).map(m => m.rel).sort();
    const want = ['ID111-B_P.pak', 'ID111-B_P.ucas', 'ID111-B_P.utoc'];
    return JSON.stringify(rels) === JSON.stringify(want) ? true : JSON.stringify(rels);
  });

  console.log('\n=== C. 单层变体 + 路径归一化 ===');

  const b0 = await installer.analyze(ROOT, FLAT_PKG, META, {});
  t('单层与两层变体并存 → 两个都列出来', () => {
    const n = (b0.options || []).length;
    return n === 2 ? true : '候选 ' + n + ' 个';
  });
  t('单层变体 group 为空（没有上级分组）', () => {
    const o = (b0.options || []).find(x => x.dir === 'Solo Variant');
    return o && o.group === '' ? true : 'group=' + (o && o.group);
  });
  t('两层变体的 group 是上级目录名', () => {
    const o = (b0.options || []).find(x => x.dir === 'Nested Variant/Sub');
    return o && o.group === 'Nested Variant' ? true : 'group=' + (o && o.group);
  });

  const solo = await installer.analyze(ROOT, SOLO_PKG, META, {});
  t('只有一个顶层目录且全是 pak → 自动识别，不要求用户选', () => {
    if (solo.ok !== true) return 'ok=' + solo.ok + ' needsTargetPick=' + solo.needsTargetPick;
    if (solo.target !== MODS_DIR) return 'target=' + solo.target;
    return (solo.options === undefined) ? true : '意外带了 options';
  });

  const b1 = await installer.analyze(ROOT, FLAT_PKG, META, { pickDir: 'Solo Variant' });
  t('单层变体指定后正确落 ~Mods', () =>
    (b1.ok && b1.target === MODS_DIR && (b1.mapping || []).length === 3) ? true
      : `ok=${b1.ok} target=${b1.target} files=${(b1.mapping || []).length}`);

  const b2 = await installer.analyze(ROOT, FLAT_PKG, META, { pickDir: 'Solo Variant/' });
  t('pickDir 末尾带斜杠也能识别', () => b2.ok === true ? true : 'ok=' + b2.ok);

  const b3 = await installer.analyze(ROOT, FLAT_PKG, META, { pickDir: 'Solo Variant\\' });
  t('pickDir 用反斜杠也能识别', () => b3.ok === true ? true : 'ok=' + b3.ok);

  const b4 = await installer.analyze(ROOT, FLAT_PKG, META, { pickDir: '/Solo Variant' });
  t('pickDir 开头带斜杠也能识别', () => b4.ok === true ? true : 'ok=' + b4.ok);

  console.log('\n=== D. 边界：坏的 pickDir 不能把包「装歪」 ===');

  const d1 = await installer.analyze(ROOT, VARIANT_PKG, META, { pickDir: '不存在的目录' });
  t('不存在的 pickDir → 回落成 needsTargetPick（不静默装错）', () =>
    (d1.ok === false && d1.needsTargetPick === true) ? true : `ok=${d1.ok}`);

  const d2 = await installer.analyze(ROOT, VARIANT_PKG, META, { pickDir: '' });
  t('pickDir 为空串 → 等同于没传', () =>
    (d2.ok === false && d2.needsTargetPick === true) ? true : `ok=${d2.ok}`);

  const d3 = await installer.analyze(ROOT, NOPAK_PKG, META, {});
  t('包里没有 pak → 候选为空数组（界面据此走「手动处理」分支）', () => {
    if (d3.ok !== false) return 'ok=' + d3.ok;
    return Array.isArray(d3.options) && d3.options.length === 0 ? true : JSON.stringify(d3.options);
  });

  console.log('\n=== E. 回归：正常包不受影响 ===');

  const e0 = await installer.analyze(ROOT, NORMAL_PKG, META, {});
  t('普通 pak 包（不传 pickDir）照常识别', () =>
    (e0.ok === true && e0.kind === 'pak' && e0.target === MODS_DIR) ? true
      : `ok=${e0.ok} kind=${e0.kind} target=${e0.target}`);

  const e1 = await installer.analyze(ROOT, NORMAL_PKG, META, { pickDir: '瞎指的目录' });
  t('正常包即使传了坏 pickDir 也不受影响（pickDir 只在识别失败时兜底）', () =>
    (e1.ok === true && e1.target === MODS_DIR) ? true : `ok=${e1.ok} target=${e1.target}`);

  const e2 = await installer.analyze(ROOT, NORMAL_PKG, META, {});
  t('普通包不带 options 字段（前端不会误弹变体框）', () =>
    e2.options === undefined ? true : '意外带了 options');

  /* ---- F. 多选：一个包里几套**互不相关**的内容 ----
   *
   * 实测 mod 3970「Nv_pu_CNS」：三个子目录分别是主 mod / Ahuang 皮肤 / 中文字体，
   * 互不覆盖，应该**一起装**。老界面按「3 选 1」处理，用户永远只能装到其中一个。
   */
  console.log('\n=== F. 多选：互不相关的几套一起装 ===');

  const MULTI_PKG = zip('multi-pkg', {
    'Nv_pu_CNS/Nv_pu_CNS/nvpu_P.pak': 'pak',
    'Nv_pu_CNS/Nv_pu_CNS/nvpu_P.ucas': 'ucas',
    'Nv_pu_CNS/Nv_pu_CNS/nvpu_P.utoc': 'utoc',
    'Nv_pu_CNS/Nv_pu_CNS/Nv_pu_CNS.dekcns.json': '{}',
    'Nv_pu_CNS/Nv_pu_CNS/Re me.txt': '说明',
    'Nv_pu_CNS/Ahuang_Skin3.0/Ahuang_Skin2161_P.pak': 'pak',
    'Nv_pu_CNS/Ahuang_Skin3.0/Ahuang_Skin2161_P.ucas': 'ucas',
    'Nv_pu_CNS/Ahuang_Skin3.0/Ahuang_Skin2161_P.utoc': 'utoc',
    'Nv_pu_CNS/中文楷体Mod/Kaiti_CH3155_P.pak': 'pak',
    'Nv_pu_CNS/中文楷体Mod/Kaiti_CH3155_P.ucas': 'ucas',
    'Nv_pu_CNS/中文楷体Mod/Kaiti_CH3155_P.utoc': 'utoc'
  });

  const f0 = await installer.analyze(ROOT, MULTI_PKG, META, {});
  t('不选时给出 3 个候选', () =>
    (f0.ok === false && (f0.options || []).length === 3) ? true
      : `ok=${f0.ok} options=${(f0.options || []).length}`);

  const f1 = await installer.analyze(ROOT, MULTI_PKG, META, {
    pickDirs: ['Nv_pu_CNS/Nv_pu_CNS', 'Nv_pu_CNS/Ahuang_Skin3.0', 'Nv_pu_CNS/中文楷体Mod']
  });
  t('选 3 套 → 识别成功（paks + CNS 数据一起落 ~Mods）', () =>
    (f1.ok === true && f1.kind === 'cns' && f1.target === MODS_DIR) ? true
      : `ok=${f1.ok} kind=${f1.kind} target=${f1.target}`);
  t('选 3 套 → 文件全部**拍平**到 ~Mods 根级（不再带子目录）', () => {
    if (!f1.ok) return 'ok=false';
    const rels = f1.mapping.map(m => m.rel);
    const nested = rels.filter(r => r.includes('/') || r.includes('\\'));
    return nested.length === 0 ? true : '还有嵌套：' + nested.join(',');
  });
  t('选 3 套 → 11 个文件里剔掉说明文档，落 10 个', () =>
    f1.ok && f1.fileCount === 10 ? true : `fileCount=${f1.ok ? f1.fileCount : 'ok=false'}`);
  t('选 3 套 → 三套的 pak 都在（各取一个代表）', () => {
    if (!f1.ok) return 'ok=false';
    const rels = f1.mapping.map(m => m.rel);
    return ['nvpu_P.pak', 'Ahuang_Skin2161_P.pak', 'Kaiti_CH3155_P.pak'].every(n => rels.includes(n))
      ? true : JSON.stringify(rels);
  });
  t('选 3 套 → 剔掉了子目录里的说明文件（Re me.txt）', () => {
    if (!f1.ok) return 'ok=false';
    return f1.mapping.some(m => /Re me\.txt/.test(m.rel)) ? '说明文件被装进去了' : true;
  });
  t('选 3 套 → CNS 依赖标记生效（requiresCns）', () =>
    f1.ok && f1.requiresCns === true ? true : 'requiresCns=' + (f1.ok ? f1.requiresCns : 'ok=false'));

  const f2 = await installer.analyze(ROOT, MULTI_PKG, META, {
    pickDirs: ['Nv_pu_CNS/Nv_pu_CNS']
  });
  t('只选 1 套仍然可用（等价于老的 pickDir）', () =>
    f2.ok === true && f2.fileCount === 4 ? true : `ok=${f2.ok} fileCount=${f2.fileCount}`);

  /* ---- G. 多选护栏：选了两套会互相覆盖的内容 → 明确报错，不静默装歪 ---- */
  console.log('\n=== G. 多选护栏：互相覆盖的内容不许一起装 ===');

  const g1 = await installer.analyze(ROOT, VARIANT_PKG, META, {
    pickDirs: ['Suit (2 variants)/Suit_A', 'Suit (2 variants)/Suit_B']
  });
  t('选 A+B → ok=false（不许静默装歪）', () => g1.ok === false ? true : 'ok=' + g1.ok);
  t('选 A+B → 仍然给候选清单，能重选', () =>
    (g1.options || []).length === 2 ? true : 'options=' + (g1.options || []).length);
  t('选 A+B → 原因里点名「互相覆盖」', () =>
    /互相覆盖/.test(g1.reason || '') ? true : 'reason=' + g1.reason);
  t('选 A+B → 原因里列出资产 ID（ID111）', () =>
    /ID111/.test(g1.reason || '') ? true : 'reason=' + g1.reason);

  // 真实 mod 692 的形态：两套变体**文件名不同**但资产 ID 相同
  const IDCLASH_PKG = zip('idclash-pkg', {
    'Suit (2 variants)/Suit_A/ID77117-BP_Suit_A_P.pak': 'pak',
    'Suit (2 variants)/Suit_A/ID77117-BP_Suit_A_P.ucas': 'ucas',
    'Suit (2 variants)/Suit_A/ID77117-BP_Suit_A_P.utoc': 'utoc',
    'Suit (2 variants)/Suit_B/ID77117-BP_Suit_B_P.pak': 'pak',
    'Suit (2 variants)/Suit_B/ID77117-BP_Suit_B_P.ucas': 'ucas',
    'Suit (2 variants)/Suit_B/ID77117-BP_Suit_B_P.utoc': 'utoc'
  });
  const g1b = await installer.analyze(ROOT, IDCLASH_PKG, META, {
    pickDirs: ['Suit (2 variants)/Suit_A', 'Suit (2 variants)/Suit_B']
  });
  t('文件名不同但 ID 相同 → 也拦下来（mod 692 的真实形态）', () =>
    g1b.ok === false && /ID77117/.test(g1b.reason || '') ? true
      : `ok=${g1b.ok} reason=${g1b.reason}`);

  const g1c = await installer.analyze(ROOT, IDCLASH_PKG, META, {
    pickDirs: ['Suit (2 variants)/Suit_A']
  });
  t('只选其中一套 → 正常识别', () =>
    g1c.ok === true && g1c.fileCount === 3 ? true : `ok=${g1c.ok}`);

  const g2 = await installer.analyze(ROOT, MULTI_PKG, META, {
    pickDirs: ['Nv_pu_CNS/Nv_pu_CNS', 'Nv_pu_CNS/Ahuang_Skin3.0']
  });
  t('文件名与 ID 都不同 → 允许一起装（不被护栏误伤）', () =>
    g2.ok === true ? true : 'ok=false reason=' + g2.reason);

  // 三套独立内容里挑两套（少了字体）—— 也该放行
  const g2b = await installer.analyze(ROOT, MULTI_PKG, META, {
    pickDirs: ['Nv_pu_CNS/Ahuang_Skin3.0', 'Nv_pu_CNS/中文楷体Mod']
  });
  t('三套里挑两套 → 放行', () => g2b.ok === true ? true : 'ok=false reason=' + g2b.reason);

  const g3 = await installer.analyze(ROOT, VARIANT_PKG, META, {
    pickDirs: ['Suit (2 variants)/Suit_A', '不存在的目录']
  });
  t('多选里混进坏目录 → 好的那套照装', () =>
    g3.ok === true ? true : 'ok=false reason=' + g3.reason);

  const g4 = await installer.analyze(ROOT, VARIANT_PKG, META, { pickDirs: [] });
  t('pickDirs 为空数组 → 等同于没传（回落 needsTargetPick）', () =>
    (g4.ok === false && g4.needsTargetPick === true) ? true : 'ok=' + g4.ok);

  /* ---- I. 互斥分组：界面据此「每组默认预选一套」 ---- */
  //
  // 用户报的问题（2026-10-13）：「有部分 mod 依然无法处理」。
  // 根因之一是**选择框进来一个都没选**，用户得自己判断「哪几套会互相覆盖」。
  // 现在主进程把互斥关系算好（`plan.exclusiveGroups`），界面按组预选。
  // 判据必须与「选完之后的撞车检测」完全一致，否则会出现
  // 「界面说可以一起装、主进程又打回来」的自相矛盾。
  console.log('\n=== I. 互斥分组（每组只能选一套） ===');
  {
    const i1 = await installer.analyze(ROOT, MIXED_GROUP_PKG, META, {});
    t('I1 识别失败且给出候选', () =>
      (i1.ok === false && (i1.options || []).length === 3) ? true
        : 'ok=' + i1.ok + ' options=' + (i1.options || []).length);
    t('I1 资产 ID 相同的两套被编进同一组', () => {
      const g = i1.exclusiveGroups || [];
      return (g.length === 1 && g[0].length === 2 &&
        g[0].some(d => /Suit_A$/.test(d)) && g[0].some(d => /Suit_B$/.test(d)))
        ? true : JSON.stringify(g);
    });
    t('I1 独立的 Extra 目录不在任何组里（可一起装）', () =>
      (i1.exclusiveGroups || []).every(g => !g.some(d => /^Extra/.test(d)))
        ? true : JSON.stringify(i1.exclusiveGroups));
    t('I1 每个候选都带 keys（互斥判据的原料）', () =>
      (i1.options || []).every(o => Array.isArray(o.keys) && o.keys.length)
        ? true : JSON.stringify((i1.options || []).map(o => o.keys)));

    const i2 = await installer.analyze(ROOT, SAME_NAME_PKG, META, {});
    t('I2 没有资产编号但 pak 同名 → 仍判互斥', () => {
      const g = i2.exclusiveGroups || [];
      return (g.length === 1 && g[0].length === 2) ? true : JSON.stringify(g);
    });

    const i3 = await installer.analyze(ROOT, UNRELATED_PKG, META, {});
    t('I3 三套互不相关 → 没有互斥组（三套都能装）', () =>
      (i3.exclusiveGroups || []).length === 0 ? true : JSON.stringify(i3.exclusiveGroups));
    t('I3 候选仍是 3 个', () =>
      (i3.options || []).length === 3 ? true : (i3.options || []).length);

    // 与「选完之后的撞车检测」口径一致：同组两套一起选必须被拦下
    const clash = await installer.analyze(ROOT, MIXED_GROUP_PKG, META,
      { pickDirs: ['GroupA/Suit_A', 'GroupA/Suit_B'] });
    t('I 同组两套一起选 → 主进程拦下并说明原因', () =>
      (clash.ok === false && !!clash.reason) ? true : 'ok=' + clash.ok);
    t('I 拦下时仍给出互斥分组（界面能重新预选）', () =>
      (clash.exclusiveGroups || []).length === 1 ? true : JSON.stringify(clash.exclusiveGroups));

    // 独立目录 + 组内一套 → 能正常装
    const okMix = await installer.analyze(ROOT, MIXED_GROUP_PKG, META,
      { pickDirs: ['GroupA/Suit_A', 'Extra'] });
    t('I 组内一套 + 独立目录 → 能识别', () => okMix.ok === true ? true : 'ok=' + okMix.ok);
  }

  /* ---- H. 渲染层接线（只做源码级断言，不需要 DOM） ---- */
  console.log('\n=== H. 渲染层接线 ===');
  {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');

    t('确认安装时传的是 pickDirs（数组）', () =>
      /confirmInstall\(taskId,\s*\{\s*onConflict:\s*'overwrite',\s*pickDirs:\s*dirs\s*\}\)/.test(appJs)
        ? true : '没传 pickDirs');
    t('点候选项是「勾选」而不是直接安装（多选的前提）', () => {
      const i = appJs.indexOf("t.closest('[data-pick]')");
      if (i < 0) return '找不到 data-pick 处理分支';
      const seg = appJs.slice(i, i + 700);
      if (!/state\.pick\.(add|delete)/.test(seg)) return '没有切换选中状态';
      if (/installWithPick\(/.test(seg)) return '还在直接安装（应该是勾选）';
      return true;
    });
    t('有「安装选中的（N）」按钮', () => /id:\s*'vInstall'/.test(appJs) ? true : '没有 vInstall 按钮');
    t('按钮文案带选中条数', () =>
      /安装选中的（\$\{n\}）|安装选中的（' \+ n/.test(appJs) ? true : '按钮文案没带条数');
    t('vInstall 分支会收集全部选中项', () =>
      /\[\.\.\.\(state\.pick \|\| \[\]\)\]/.test(appJs) ? true : '没收集选中项');
    t('没选中时按钮禁用', () => /btn\.disabled = !n/.test(appJs) ? true : '没有禁用逻辑');
    t('候选选中态有样式', () => /\.vopt\.on\{/.test(css) ? true : '缺少 .vopt.on 样式');
    t('对话框说明了「可以一起装」', () =>
      /可以一起装/.test(appJs) ? true : '对话框没说明多选');
    t('主进程报错时对话框会展示原因', () =>
      /plan\.reason \? `<div class="callout"/.test(appJs) ? true : '没展示 plan.reason');
    t('__dlActions 导出了 picker 相关函数（自动化用）', () =>
      /openVariantPicker,\s*syncPickBar,\s*installWithPick/.test(appJs) ? true : '没导出');

    /* ---- 默认预选（本轮新增）：进来就是「已选好」状态 ---- */
    t('按 plan.exclusiveGroups 预选第一套', () =>
      /for \(const g of groups\) \{\s*\n\s*if \(!Array\.isArray\(g\) \|\| !g\.length\) continue;\s*\n\s*state\.pick\.add\(g\[0\]\)/.test(appJs)
        ? true : '没按组预选');
    t('不在任何组里的候选全部预选', () =>
      /for \(const o of opts\) if \(!grouped\.has\(o\.dir\)\) state\.pick\.add\(o\.dir\)/.test(appJs)
        ? true : '独立候选没预选');
    t('组内是单选：点一个自动取消同组其它', () =>
      /const mates = state\.pickGroups && state\.pickGroups\.get\(dir\)/.test(appJs)
        ? true : '没有组内单选逻辑');
    t('界面标出「第 N 组 · 只能选一套」', () =>
      /第 \$\{gno\} 组 · 只能选一套/.test(appJs) ? true : '没有组标签');
    t('组标签有样式', () => /\.vopt \.vl em\.vg\{/.test(css) ? true : '缺少 .vg 样式');
    t('待处理原因会说明「几组互斥」', () =>
      /组是同一件东西的不同版本/.test(appJs) ? true : '原因文案没提互斥组');
  }

  // 收尾：清掉临时目录
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* 忽略 */ }

  console.log('\n' + '='.repeat(52));
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    · ' + f)); }
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：' + e.message + '\n' + e.stack); process.exit(1); });
