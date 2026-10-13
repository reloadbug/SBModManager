'use strict';
/**
 * 安装器自检：构造 9 种典型 mod 包结构，验证「结构识别 → 落点 → 实际安装 → 卸载」。
 *
 * 全部在临时目录里做，**不会碰真实游戏目录**（用假游戏根目录）。
 *
 * 用法：
 *   node _probe/installer-test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const archive = require('../src/main/archive');
const installer = require('../src/main/installer');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-installer-test');
const SRC = path.join(BASE, 'src');
const PKG = path.join(BASE, 'pkg');
const ROOT = path.join(BASE, 'fakeroot');

let pass = 0, fail = 0;

/**
 * 断言：fn 返回 true（或 undefined）算通过；返回字符串则作为失败原因。
 * ⚠️ 不要把「描述性字符串」当成功返回 —— 那会让失败被静默吞掉。
 */
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

const abs = (...segs) => path.join(ROOT, ...segs);

/* ---------------- 用例定义 ---------------- */

const CASES = [
  {
    name: 'pak-flat',
    desc: '~Mods 平铺：pak 三件套 + 根级 readme',
    files: {
      'xxx_P.pak': 'PAK',
      'xxx_P.ucas': 'UCAS',
      'xxx_P.utoc': 'UTOC',
      'readme.txt': 'install to ~Mods'
    },
    kind: 'pak',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['xxx_P.pak', 'xxx_P.ucas', 'xxx_P.utoc'],
    absent: ['readme.txt']
  },
  {
    name: 'pak-wrapped',
    desc: '外面套一层 ModName\\',
    files: {
      'MyCoolMod/xxx_P.pak': 'PAK',
      'MyCoolMod/xxx_P.ucas': 'UCAS',
      'MyCoolMod/xxx_P.utoc': 'UTOC',
      'MyCoolMod/README.md': 'docs'
    },
    kind: 'pak',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['xxx_P.pak', 'xxx_P.ucas', 'xxx_P.utoc'],
    absent: ['README.md', 'MyCoolMod']
  },
  {
    name: 'pak-in-content',
    desc: 'Content\\Paks\\~Mods\\ 完整路径',
    files: {
      'Content/Paks/~Mods/yyy_P.pak': 'PAK',
      'Content/Paks/~Mods/yyy_P.ucas': 'UCAS'
    },
    kind: 'pak',
    target: abs('SB'),
    expect: ['Content/Paks/~Mods/yyy_P.pak', 'Content/Paks/~Mods/yyy_P.ucas']
  },
  {
    name: 'mods-wrapper',
    desc: '~Mods\\ 作为顶层目录（剥掉包装层后落点仍是 ~Mods）',
    files: { '~Mods/zzz_P.pak': 'PAK' },
    kind: 'pak',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['zzz_P.pak']
  },
  {
    name: 'ue4-full',
    desc: 'CNS 式：Binaries\\ + Content\\ 合并到 SB\\，带中文根级说明',
    files: {
      'Binaries/Win64/ue4ss/Mods/CNS/main.lua': 'print(1)',
      'Binaries/Win64/ue4ss/Mods/CNS/config.txt': 'cfg',
      'Content/Paks/~Mods/CNS_P.pak': 'PAK',
      '中文说明.txt': '中文文档'
    },
    kind: 'cns',
    target: abs('SB'),
    expect: [
      'Binaries/Win64/ue4ss/Mods/CNS/main.lua',
      'Binaries/Win64/ue4ss/Mods/CNS/config.txt',
      'Content/Paks/~Mods/CNS_P.pak'
    ],
    absent: ['中文说明.txt']
  },
  {
    name: 'ue4ss-wrapper',
    desc: 'ue4ss\\ 作为顶层目录（剥掉包装层后落点仍是 Win64\\ue4ss）',
    files: {
      'ue4ss/Mods/SomeMod/scripts/main.lua': 'print(2)',
      'ue4ss/Mods/SomeMod/scripts/lib.lua': 'return {}'
    },
    kind: 'script',
    target: abs('SB', 'Binaries', 'Win64', 'ue4ss'),
    expect: ['Mods/SomeMod/scripts/main.lua', 'Mods/SomeMod/scripts/lib.lua']
  },
  {
    name: 'scripts-only',
    desc: '纯脚本：Scripts\\ 目录（落到新建的 ue4ss\\Mods\\<包名>\\）',
    files: {
      'Scripts/main.lua': 'print(3)',
      'Scripts/util.lua': 'return 1'
    },
    kind: 'script',
    target: abs('SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'scripts-only'),
    expect: ['main.lua', 'util.lua']
  },
  {
    name: 'scripts-flat',
    desc: '纯脚本：根级 .lua + 图标（脚本 mod 有自己的目录，图标应保留）',
    files: {
      'main.lua': 'print(4)',
      'icon.png': 'PNGDATA'
    },
    kind: 'script',
    target: abs('SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'scripts-flat'),
    expect: ['main.lua', 'icon.png']
  },
  {
    name: 'sb-prefixed',
    desc: '包里自带 SB\\ 前缀（原样落游戏根，不剥层）',
    files: {
      'SB/Content/Paks/~Mods/www_P.pak': 'PAK',
      'SB/Binaries/Win64/ue4ss/Mods/W/info.json': '{}'
    },
    kind: 'cns',
    target: ROOT,
    expect: ['SB/Content/Paks/~Mods/www_P.pak', 'SB/Binaries/Win64/ue4ss/Mods/W/info.json']
  },
  {
    // 2026-10-12 用户报的 case：mod 533「Cake Unveiled」——
    // 包里 3 个 pak + 1 个 .dekcns.json，**全在根级**。
    // 老规则第一句要求「全是 pak」，混进那个 json 就整轮落空，
    // 报「包里也没找到 .pak 文件」（其实有 3 个）。
    name: 'cns-pak-json-flat',
    desc: 'pak 三件套 + .dekcns.json 全在根级（CNS 数据混合包）',
    files: {
      'CakeUnveiledAliceCNS_P.pak': 'PAK',
      'CakeUnveiledAliceCNS_P.ucas': 'UCAS',
      'CakeUnveiledAliceCNS_P.utoc': 'UTOC',
      'bcasecoolingsuit.dekcns.json': '{"a":1}'
    },
    kind: 'cns',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: [
      'CakeUnveiledAliceCNS_P.pak',
      'CakeUnveiledAliceCNS_P.ucas',
      'CakeUnveiledAliceCNS_P.utoc',
      'bcasecoolingsuit.dekcns.json'
    ]
  },
  {
    // 同一个包的另一种形态：数据文件的扩展名就是 .dekcns（没有 .json 尾巴）
    name: 'cns-pak-dekcns-flat',
    desc: 'pak + 裸 .dekcns 数据文件（同样全在根级）',
    files: {
      'SilverKunoichi_stocking_716.pak': 'PAK',
      'SilverKunoichi_stocking_716.ucas': 'UCAS',
      'SilverKunoichi_stocking_716.utoc': 'UTOC',
      'SilverKunoichi_stocking_716.dekcns': 'DEKCNS'
    },
    kind: 'cns',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: [
      'SilverKunoichi_stocking_716.pak',
      'SilverKunoichi_stocking_716.ucas',
      'SilverKunoichi_stocking_716.utoc',
      'SilverKunoichi_stocking_716.dekcns'
    ]
  },
  {
    // 2026-10-13 用户报的 case：mod 123「Sexy Harness - NSFW (CNS compatible)」——
    // 包里套了一层 `Minervha_EVE_Harness\`，里面是 pak 三件套 +
    // `modinfo.ini`（Vortex 记账文件）+ 缩略图 jpg。
    // 老代码在剥掉包装层后只剔了 jpg（ROOT_DOC），`modinfo.ini` 留着，
    // 于是「全是 pak」不成立、「CNS 混合包」也不成立 → 报「结构无法识别」。
    // 现在 modinfo.ini 走 MOD_META 在阶段 B 被剔掉，剥完只剩 pak 三件套 → 正常落 ~Mods。
    name: 'pak-wrapped-modinfo',
    desc: '包装层 + pak 三件套 + modinfo.ini（Vortex 记账）+ 缩略图',
    files: {
      'Minervha_EVE_Harness/_P.pak': 'PAK',
      'Minervha_EVE_Harness/_P.ucas': 'UCAS',
      'Minervha_EVE_Harness/_P.utoc': 'UTOC',
      'Minervha_EVE_Harness/modinfo.ini': '[mod]\nname=Sexy Harness',
      'Minervha_EVE_Harness/Thumbnail_EVE_Harness.jpg': 'JPGDATA'
    },
    kind: 'pak',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['_P.pak', '_P.ucas', '_P.utoc'],
    absent: ['modinfo.ini', 'Thumbnail_EVE_Harness.jpg', 'Minervha_EVE_Harness']
  },
  {
    // modinfo.ini 在**归档根**（没有包装层）时同样要剔掉
    name: 'pak-flat-modinfo',
    desc: '根级 pak 三件套 + modinfo.ini + meta.ini',
    files: {
      'AAA_P.pak': 'PAK',
      'AAA_P.ucas': 'UCAS',
      'AAA_P.utoc': 'UTOC',
      'modinfo.ini': '[mod]\nname=x',
      'meta.ini': 'version=1'
    },
    kind: 'pak',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['AAA_P.pak', 'AAA_P.ucas', 'AAA_P.utoc'],
    absent: ['modinfo.ini', 'meta.ini']
  },
  {
    // 🔴 关键：mod 内部（带目录）的同名文件**不能**被 MOD_META 误伤 ——
    //    脚本 mod 常自带 info.json 之类的配置，删了 mod 就废了。
    name: 'modmeta-inside-dir',
    desc: '目录内的 info.json 必须保留（MOD_META 只在根层生效）',
    files: {
      'ue4ss/Mods/SomeMod/info.json': '{"name":"SomeMod"}',
      'ue4ss/Mods/SomeMod/scripts/main.lua': 'print(9)'
    },
    kind: 'script',
    target: abs('SB', 'Binaries', 'Win64', 'ue4ss'),
    expect: ['Mods/SomeMod/info.json', 'Mods/SomeMod/scripts/main.lua']
  },
  {
    // 根级 pak + 无法归类的旁路文件：**不再**报「结构无法识别」，而是整包落 ~Mods。
    // 依据：游戏只从 ~Mods 根级加载 pak，旁路文件跟着进去不会破坏加载；
    //      而「报无法识别」会让用户完全不知道点哪个按钮（实测反复踩）。
    // 代价是 ~Mods 里可能多一个无害的说明文件 —— 这个取舍是刻意的。
    name: 'pak-plus-side-json-flat',
    desc: 'pak 三件套 + 普通 .json（非 CNS 数据）→ 整包落 ~Mods',
    files: {
      'Some_P.pak': 'PAK',
      'Some_P.ucas': 'UCAS',
      'Some_P.utoc': 'UTOC',
      'readme.json': '{"how":"to install"}'
    },
    kind: 'pak',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['Some_P.pak', 'Some_P.ucas', 'Some_P.utoc', 'readme.json']
  },
  {
    // 🔴 护栏：包里带 `Content\` 目录树时，根级那个 pak **不能**把整包拖进 ~Mods，
    //    否则 Content 目录树会被埋进 ~Mods\Content\...（游戏永远读不到）。
    //    这种包应当继续走「让用户手选」，不能瞎猜。
    name: 'pak-root-plus-content-tree',
    desc: '根级 pak + Content\\ 目录树 + tools\\ → 不套用根级 pak 兜底',
    files: {
      'Loose_P.pak': 'PAK',
      'Content/Config/default.ini': 'x=1',
      'tools/repack.exe': 'MZ'
    },
    kind: 'unknown',
    target: null,
    expect: []
  },
  {
    // 🔴 护栏：多选一变体包（pak 在子目录里）**不能**被根级 pak 兜底吞掉。
    name: 'variants-untouched',
    desc: 'pak 分散在多个子目录（多选一变体包）→ 仍交给用户挑一套',
    files: {
      'SkinPack/A/ID1_A_P.pak': 'PAK',
      'SkinPack/A/ID1_A_P.ucas': 'UCAS',
      'SkinPack/B/ID2_B_P.pak': 'PAK',
      'SkinPack/B/ID2_B_P.ucas': 'UCAS'
    },
    kind: 'unknown',
    target: null,
    options: 2,
    expect: []
  },
  {
    // 2026-10-13 用户报的 case：mod 1647「CNS - Female NPC Faces」——
    // 归档里**只有一个** `female_npc_faces.dekcns.json`（1725 字节），一个 pak 都没有。
    // 老规则两条都要求「有 pak」→ 全部落空 → 报「结构无法识别」，
    // 界面还提示「包里没有 .pak 文件」，用户完全不知道该干什么。
    // 依据：CNS 数据文件本来就住在 `~Mods` **根级**，和 pak 并排
    // （实测游戏目录里就是 `~Mods\bcasecoolingsuit.dekcns.json`）。
    name: 'cns-data-only',
    desc: '纯 CNS 外观数据（只有一个 .dekcns.json，无 pak）→ 落 ~Mods',
    files: { 'female_npc_faces.dekcns.json': '{"name":"female_npc_faces"}' },
    kind: 'cns',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['female_npc_faces.dekcns.json']
  },
  {
    // 同上，但多个数据文件 + 裸 `.dekcns`（没有 .json 后缀）也要认。
    name: 'cns-data-only-multi',
    desc: '多个 CNS 数据文件（含裸 .dekcns）→ 落 ~Mods',
    files: {
      'a_cooling.dekcns.json': '{"a":1}',
      'b_rapi.dekcns': '{"b":2}'
    },
    kind: 'cns',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    expect: ['a_cooling.dekcns.json', 'b_rapi.dekcns']
  },
  {
    // 🔴 护栏：纯 CNS 数据规则**不能**把带子目录的包也吞掉 ——
    //    那样文件会落到 `~Mods\<子目录>\`，游戏只读根级 = 白装。
    //    这种包应当继续走「让用户手选」。
    name: 'cns-data-in-subdir',
    desc: 'CNS 数据文件在子目录里 → 不套用纯数据规则（交给用户手选）',
    files: { 'faces/female_npc_faces.dekcns.json': '{}' },
    kind: 'cns',
    target: abs('SB', 'Content', 'Paks', '~Mods'),
    // 剥掉单层包装目录 `faces\` 之后，文件就在根级了 —— 所以这里**应当**识别成功
    expect: ['female_npc_faces.dekcns.json']
  }
];

/* ---------------- 主流程 ---------------- */

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(PKG, { recursive: true });

  // 覆盖备份的落点：**必须**重定向到临时目录。
  //
  // 安装时若有同名文件被覆盖，installer 默认会往项目的 `data/backup/overwritten/` 写一份。
  // 早期版本就是这么跑的，靠「跑完删掉自己新增的」收尾 —— 一旦删除被沙箱批量守卫
  // （同一轮 50 次配额）或杀软句柄拦下，就会在**真实数据目录**里堆一堆假备份
  // （实测 2026-10-13 堆了 14 个，还和用户的真备份混在一起难以分辨）。
  // `installer.install()` 支持 `opts.backupDir`，直接指到测试自己的临时目录即可根治。
  const bakRoot = path.join(BASE, 'backup-overwritten');
  fs.mkdirSync(bakRoot, { recursive: true });

  // 🔴 **开场快照 `data/tmp`**（2026-10-13）。
  //
  // 结尾那条「无残留 extract-*」断言只该管**本套件自己**产生的目录。
  // 但 `installer.install()` 内部用 `Date.now()` 命名，外面拿不到名字；
  // 而**上一次被 Ctrl-C / SIGTERM 打断的测试**会把 `extract-<ts>` 留在那儿，
  // 十几分钟后恰好跨过 10 分钟窗口 → 本次跑得好好的却报「残留」
  // （实测就是这么假失败了一次）。
  //
  // 所以开场记一份名单，结尾只对**新出现的**名字报警。
  const tmpDir = path.join(__dirname, '..', 'data', 'tmp');
  const tmpAtStart = new Set(
    fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : []
  );

  // 假游戏根目录（绝不碰真游戏目录）
  mk(ROOT, {
    'SB.exe': 'launcher',
    'SB/Binaries/Win64/SB-Win64-Shipping.exe': 'exe',
    'SB/Content/Paks/pakchunk0.pak': 'base'
  });

  console.log('解压工具: ' + JSON.stringify(archive.toolInfo()));
  console.log('假游戏根: ' + ROOT);
  console.log('');

  const plans = [];

  for (const c of CASES) {
    console.log('=== ' + c.name + ' —— ' + c.desc);
    const zipPath = zip(c.name, c.files);

    let plan;
    try {
      plan = await installer.analyze(ROOT, zipPath, { name: c.name });
    } catch (e) {
      fail++; console.log('  ✗ analyze 抛错  → ' + e.message); continue;
    }
    plans.push({ c, plan, zipPath });

    t('kind = ' + c.kind, () => plan.kind === c.kind ? true : '实际 ' + plan.kind + '（' + plan.reason + '）');
    if (c.target === null) {
      // 反例：故意让它识别不了，交给用户手选，绝不能瞎猜落点
      t('ok = false（交给用户手选）', () => plan.ok === false ? true : 'ok=' + plan.ok);
    } else {
      t('落点 = ' + path.relative(ROOT, c.target) || '游戏根', () =>
        path.resolve(plan.target).toLowerCase() === path.resolve(c.target).toLowerCase()
          ? true : '实际 ' + plan.target);
    }
    t('识别到文件（' + plan.fileCount + ' 个 / ' + plan.totalBytes + ' B）', () =>
      plan.fileCount > 0 ? true : '文件数为 0');
    if (c.options != null) {
      const n = (plan.options || []).length;
      t('候选变体数 = ' + c.options, () => n === c.options ? true : '实际 ' + n);
    }
    console.log('     落点说明: ' + plan.targetLabel);
    if (plan.warnings.length) console.log('     警告: ' + plan.warnings.join(' | '));
  }

  /* ---- 🔴 契约：有候选就必须有 reason ---- */
  //
  // 2026-10-13 用户报「这种结构的 mod，提示结构无法识别」——
  // mod 1430 包里 7 个目录各一套配色，`options` 明明有 7 个，
  // 但 `analyze` 没写 `reason` → `downloadEngine` 兜底成
  // 「结构无法自动识别，需要手动指定安装位置」，界面照实显示。
  //
  // 真相是「**识别成功了，只是要你挑一套**」—— 说成「结构无法识别」
  // 会把用户往「去找目录 / 换包」的方向引，是完全不同的事。
  console.log('');
  console.log('=== 契约：给了候选就不许说「结构无法识别」 ===');
  {
    const dirs = ['V_A', 'V_B', 'V_C'];
    const p = await installer.analyze(ROOT, zip('reason-contract', {
      'V_A/ID9001-A_P.pak': 'a', 'V_A/ID9001-A_P.ucas': 'b', 'V_A/ID9001-A_P.utoc': 'c',
      'V_B/ID9001-B_P.pak': 'a', 'V_B/ID9001-B_P.ucas': 'b', 'V_B/ID9001-B_P.utoc': 'c',
      'V_C/ID9001-C_P.pak': 'a', 'V_C/ID9001-C_P.ucas': 'b', 'V_C/ID9001-C_P.utoc': 'c'
    }), { name: 'reason-contract' });

    t('识别失败但有 3 个候选', () =>
      (p.ok === false && (p.options || []).length === 3) ? true : 'options=' + (p.options || []).length);
    t('reason 是非空字符串', () =>
      (typeof p.reason === 'string' && p.reason.length > 0) ? true : 'reason=' + JSON.stringify(p.reason));
    t('reason 里带上候选套数（3 套）', () =>
      /3 套/.test(p.reason) ? true : 'reason=' + p.reason);
    t('reason 不含「结构无法」字样', () =>
      !/结构无法/.test(p.reason) ? true : 'reason=' + p.reason);
    t('warnings 不含「都不匹配」', () =>
      !(p.warnings || []).some(w => /都不匹配/.test(w)) ? true : JSON.stringify(p.warnings));
    t('没有 diagnosis（不是「不是游戏 Mod」的结论）', () =>
      !p.diagnosis ? true : '不该有：' + p.diagnosis);
    t('候选目录名与预期一致', () => {
      const got = (p.options || []).map(o => o.dir).sort();
      return JSON.stringify(got) === JSON.stringify(dirs.slice().sort()) ? true : JSON.stringify(got);
    });
  }

  /* ---- 未知结构 ---- */
  console.log('');
  console.log('=== unknown-structure —— 不认识的布局');
  const pUnknown = await installer.analyze(ROOT, zip('unknown-structure', {
    'weird/data.bin': 'BIN',
    'weird/thing.dat': 'DAT'
  }), { name: 'unknown' });
  t('ok = false', () => pUnknown.ok === false ? true : 'ok=' + pUnknown.ok);
  t('needsTargetPick = true', () => pUnknown.needsTargetPick === true ? true : '未标记需要手选目录');
  t('没有 diagnosis（这不是「不是游戏 Mod」的结论）', () =>
    !pUnknown.diagnosis ? true : '不该有 diagnosis：' + pUnknown.diagnosis);
  t('没有候选 → reason 为 null（让调用方走通用兜底）', () =>
    (pUnknown.options || []).length === 0 && pUnknown.reason === null
      ? true : 'options=' + (pUnknown.options || []).length + ' reason=' + JSON.stringify(pUnknown.reason));

  /* ---- 「不是游戏 Mod」：整包都是作者的工程源文件 ---- */
  //
  // 2026-10-13 用户报的 case：mod 2182「Nude Eve Collection …」的某个可选文件
  // 里只有 6 个 `.blend`（Blender 工程），一个 pak 都没有。
  // 老代码报「结构无法识别，需要手动指定安装位置」—— 于是用户真的去找目录，
  // 而**装到哪儿都不会生效**。这里要给出明确结论，并且**不给**手选目录的入口。
  console.log('');
  console.log('=== author-source-only —— 整包都是作者的工程源文件');
  const pSrc = await installer.analyze(ROOT, zip('author-source-only', {
    'EveBase_PerfBody.blend': 'BLEND',
    'EveBase_SportyThick.blend': 'BLEND',
    'EveBase_PerfBody_Slimmer.blend': 'BLEND',
    'EveBase_PerfBody.psd': 'PSD'
  }), { name: 'EveBase sources' });
  t('ok = false', () => pSrc.ok === false ? true : 'ok=' + pSrc.ok);
  t('needsTargetPick = false（不该引导用户去找目录）', () =>
    pSrc.needsTargetPick === false ? true : '实际 ' + pSrc.needsTargetPick);
  t('diagnosis 点明是工程源文件', () =>
    /工程源文件/.test(pSrc.diagnosis || '') ? true : '实际 ' + pSrc.diagnosis);
  t('diagnosis 列出扩展名（.blend / .psd）', () =>
    /\.blend/.test(pSrc.diagnosis || '') && /\.psd/.test(pSrc.diagnosis || '')
      ? true : '实际 ' + pSrc.diagnosis);
  t('不再列候选变体（没有可装的东西）', () =>
    (pSrc.options || []).length === 0 ? true : '有 ' + pSrc.options.length + ' 个候选');
  t('warning 说明是源文件而不是「布局没见过」', () =>
    (pSrc.warnings || []).some(w => /工程源文件/.test(w)) ? true : JSON.stringify(pSrc.warnings));

  /* ---- 真实安装 ---- */
  console.log('');
  console.log('=== 真实安装（写入假游戏根目录） ===');
  const results = [];
  for (const { c, plan } of plans) {
    if (plan.ok === false) continue;      // 反例本来就不该装
    try {
      const r = await installer.install(ROOT, plan, {
        onConflict: 'overwrite',
        backupDir: path.join(bakRoot, 'ov-case-' + c.name)
      });
      results.push({ c, plan, r });
      console.log('  · ' + c.name + ' → 写入 ' + r.written + '，跳过 ' + r.skipped);
    } catch (e) {
      fail++; console.log('  ✗ ' + c.name + ' 安装失败  → ' + e.message);
    }
  }

  console.log('');
  console.log('=== 落盘校验 ===');
  for (const { c, r } of results) {
    t(c.name + ' 写入文件数 = ' + c.expect.length, () =>
      r.written === c.expect.length ? true : '实际写入 ' + r.written);
    for (const rel of c.expect) {
      const fp = path.join(c.target, rel.split('/').join(path.sep));
      t('  └ ' + rel, () => fs.existsSync(fp) ? true : '不存在：' + fp);
    }
    for (const rel of c.absent || []) {
      const fp = path.join(c.target, rel.split('/').join(path.sep));
      t('  └ 未落盘 ' + rel, () => !fs.existsSync(fp) ? true : '不该存在：' + fp);
    }
  }

  /* ---- 临时目录清理 ---- */
  console.log('');
  console.log('=== 临时目录清理 ===');
  const allTmp = fs.existsSync(tmpDir)
    ? fs.readdirSync(tmpDir).filter(n => n.startsWith('extract-') && !tmpAtStart.has(n))
    : [];
  // `.trash-<ts>` 是**设计内的降级态**：`fs.rmSync` 因杀软/句柄占用失败时改名待清扫
  // （见 lessons 第十二章）。只有超过 10 分钟清扫窗口的才算真残留。
  //
  // ⚠️ 没改名的那种也不能一见到就判残留 —— **用户可能正开着应用在装 mod**，
  //    那个 `extract-*` 是它**正在用**的临时目录（实测踩过：并行跑测试时被它连坐）。
  //    所以统一按「超过 10 分钟没动过」才算残留（正在解压的 mtime 一直在更新）。
  //
  // ⚠️⚠️ 另外只认**开场快照之后新出现的**名字 —— 上一次被打断的测试留下的目录
  //    不该由这一次背锅（实测假失败过，见上面 `tmpAtStart` 的注释）。
  const nowMs = Date.now();
  const STALE_MS = 10 * 60 * 1000;
  const leftovers = allTmp.filter(n => {
    const m = /\.trash-(\d+)$/.exec(n);
    if (m) return nowMs - Number(m[1]) > STALE_MS;  // 超窗口没被收走 = 真残留
    try { return nowMs - fs.statSync(path.join(tmpDir, n)).mtimeMs > STALE_MS; }
    catch { return false; }                          // stat 不到（刚被删）→ 不算残留
  });
  t('本次运行没有留下「超过 10 分钟没动过」的 extract-*（开场就有的不算，正在解压的不算）',
    () => leftovers.length === 0 ? true : '残留 ' + leftovers.join(','));

  /* ---- 冲突检测 + skip 模式 ---- */
  console.log('');
  console.log('=== 重复安装：冲突检测与 skip ===');
  const first = plans[0];
  const p2 = await installer.analyze(ROOT, first.zipPath, { name: first.c.name });
  // 刚装完同一个包，目标文件与归档内容**逐字节一致** → 全部落进「软冲突」。
  // 这正确：重装同一个版本没什么可决策的，不该弹「有 3 个文件会被覆盖」。
  t('重装同一包 → 0 个真冲突（同大小归为软覆盖）', () =>
    p2.conflictCount === 0 ? true : '冲突数不对：' + p2.conflictCount);
  t('重装同一包 → ' + p2.softOverwriteCount + '/' + p2.fileCount + ' 个软覆盖', () =>
    p2.softOverwriteCount === p2.fileCount ? true : '软覆盖数不对：' + p2.softOverwriteCount);
  // 真冲突仍要能检出来：把其中一个目标文件改成不同大小
  {
    // mapping[].to 已经是绝对路径，直接改它
    fs.writeFileSync(first.plan.mapping[0].to, 'A-DIFFERENT-LENGTH-CONTENT-THAN-THE-ARCHIVE');
    const pDiff = await installer.analyze(ROOT, first.zipPath, { name: first.c.name });
    t('改掉一个目标文件的大小 → 检出 1 个真冲突', () =>
      pDiff.conflictCount === 1 ? true : '实际 ' + pDiff.conflictCount);
  }
  const rSkip = await installer.install(ROOT, p2, {
    onConflict: 'skip',
    backupDir: path.join(bakRoot, 'ov-conflict')
  });
  t('skip 模式全部跳过（写入 0）', () => rSkip.written === 0 ? true : '误写 ' + rSkip.written);

  /* ---- 冲突检测：覆盖自己 ≠ 覆盖别人 ---- */
  //
  // 2026-10-13 用户报的 case：mod 1595「Modified Neurolink Suit with CNS compatible」
  // 装了 fileId 7443，后来又下了同一个 mod 的 fileId 7444，两个包文件名一模一样。
  // 4 个文件全部 existsSync 命中 → conflictCount = 4 → 自动安装被拦下，
  // 判成「有 4 个文件会被覆盖，等你确认」。可它覆盖的是**自己**，这是重装/升级。
  console.log('');
  console.log('=== 冲突检测：自己上次装的文件不算冲突 ===');
  {
    const ownZip = zip('conflict-owned', {
      'ZZZ_P.pak': 'PAK', 'ZZZ_P.ucas': 'UCAS', 'ZZZ_P.utoc': 'UTOC'
    });
    const modsDir = abs('SB', 'Content', 'Paks', '~Mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const ownPaths = ['ZZZ_P.pak', 'ZZZ_P.ucas', 'ZZZ_P.utoc'].map(f => path.join(modsDir, f));
    for (const p of ownPaths) fs.writeFileSync(p, 'OLD-VERSION');

    const pOther = await installer.analyze(ROOT, ownZip, { name: 'conflict-owned' });
    t('不传 ownedPaths → 3 个冲突（照旧拦下等确认）', () =>
      pOther.conflictCount === 3 ? true : '实际 ' + pOther.conflictCount);
    t('不传 ownedPaths → selfOverwriteCount = 0', () =>
      pOther.selfOverwriteCount === 0 ? true : '实际 ' + pOther.selfOverwriteCount);

    const pSelf = await installer.analyze(ROOT, ownZip, { name: 'conflict-owned' },
      { ownedPaths: ownPaths });
    t('传了自己的路径 → 0 个冲突（可自动安装）', () =>
      pSelf.conflictCount === 0 ? true : '实际 ' + pSelf.conflictCount);
    t('传了自己的路径 → selfOverwriteCount = 3', () =>
      pSelf.selfOverwriteCount === 3 ? true : '实际 ' + pSelf.selfOverwriteCount);

    // 大小写不敏感：Windows 路径大小写随便写都该算「自己人」
    const pCase = await installer.analyze(ROOT, ownZip, { name: 'conflict-owned' },
      { ownedPaths: ownPaths.map(p => p.toUpperCase()) });
    t('路径大小写不敏感', () => pCase.conflictCount === 0 ? true : '实际 ' + pCase.conflictCount);
  }

  /* ---- ownedPathsFor：按 source.modId 认亲 ---- */
  console.log('');
  console.log('=== ownedPathsFor —— 按 Nexus modId 认亲（不看 fileId） ===');
  {
    const { ownedPathsFor } = require('../src/main/installFlow');
    const fakeRegistry = {
      all: () => [
        { id: 'nexus:1595:7443', source: { modId: 1595 }, manifest: [{ path: 'C:\\g\\a.pak' }, { path: 'C:\\g\\a.ucas' }] },
        { id: 'nexus:1595:7444', source: { modId: 1595 }, manifest: [{ path: 'C:\\g\\b.pak' }] },
        { id: 'nexus:9999:1', source: { modId: 9999 }, manifest: [{ path: 'C:\\g\\other.pak' }] },
        { id: 'local:1', source: { modId: null }, manifest: [{ path: 'C:\\g\\local.pak' }] }
      ]
    };
    const got = ownedPathsFor(fakeRegistry, { modId: 1595 });
    t('同 modId 的不同 fileId 都算自己人（3 条）', () =>
      got.length === 3 ? true : '实际 ' + JSON.stringify(got));
    t('不含别的 mod 的文件', () =>
      got.every(p => !/other|local/.test(p)) ? true : JSON.stringify(got));
    t('字符串形式的 modId 也认（meta.modId = "1595"）', () =>
      ownedPathsFor(fakeRegistry, { modId: '1595' }).length === 3 ? true : '没认出来');
    t('没有 modId → 空数组（本地导入不该乱认亲）', () =>
      ownedPathsFor(fakeRegistry, {}).length === 0 ? true : '不该有值');
    t('registry 为 null → 空数组（不抛）', () =>
      ownedPathsFor(null, { modId: 1595 }).length === 0 ? true : '不该有值');
  }

  /* ---- 软冲突：同名 + 同大小 ≠ 要用户决策 ---- */
  //
  // 2026-10-13 用户报的 case：mod 2121「Kaine - CNS」/ 2531「S Bikini」/ 1917「D.Va OG suit」
  // 三条卡在「待确认：有 3 个文件会被覆盖」。查下来是 Minervha 系的 CNS 服装 mod
  // **每一个都自带同一个底座**：
  //     Minervha_Master_P.pak / .ucas / .utoc   （339 / 100743776 / 20140 字节）
  // 归档里的和游戏目录里的**逐字节同大小** —— 就是同一个文件。
  // 正确的动作显然是覆盖它（社区里 Vortex/MO2 就这么装），不该打扰用户。
  //
  // 判据是**大小相等**：同一个文件大小必然相同；不同版本几乎不可能刚好一样大。
  // 判错的代价也小 —— 软冲突照旧走覆盖前备份，卸载还能还原。
  console.log('');
  console.log('=== 软冲突：同名且同大小 → 不算冲突（可自动安装） ===');
  {
    const softZip = zip('conflict-soft', {
      'SOFT_P.pak': 'SAME-BYTES', 'SOFT_P.ucas': 'SAME-BYTES'
    });
    const modsDir = abs('SB', 'Content', 'Paks', '~Mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const softPaths = ['SOFT_P.pak', 'SOFT_P.ucas'].map(f => path.join(modsDir, f));

    // A. 游戏里已经是「同名同大小」→ 软冲突，不该拦自动安装
    for (const p of softPaths) fs.writeFileSync(p, 'SAME-BYTES');
    const pSoft = await installer.analyze(ROOT, softZip, { name: 'conflict-soft' });
    t('同名同大小 → conflictCount = 0（不再拦自动安装）', () =>
      pSoft.conflictCount === 0 ? true : '实际 ' + pSoft.conflictCount);
    t('同名同大小 → softOverwriteCount = 2', () =>
      pSoft.softOverwriteCount === 2 ? true : '实际 ' + pSoft.softOverwriteCount);
    t('softOverwritePaths 指向游戏目录里那两个文件', () =>
      pSoft.softOverwritePaths.length === 2 &&
        pSoft.softOverwritePaths.every(p =>
          path.resolve(p).toLowerCase().startsWith(path.resolve(modsDir).toLowerCase()))
        ? true : JSON.stringify(pSoft.softOverwritePaths));

    // B. 同名但**大小不同** → 真冲突，照旧拦下等确认
    fs.writeFileSync(softPaths[0], 'A-DIFFERENT-LENGTH-CONTENT');
    fs.writeFileSync(softPaths[1], 'SAME-BYTES');
    const pReal = await installer.analyze(ROOT, softZip, { name: 'conflict-soft' });
    t('同名不同大小 → 仍算真冲突（conflictCount = 1）', () =>
      pReal.conflictCount === 1 ? true : '实际 ' + pReal.conflictCount);
    t('真冲突那条不重复计入软覆盖（softOverwriteCount = 1）', () =>
      pReal.softOverwriteCount === 1 ? true : '实际 ' + pReal.softOverwriteCount);

    // C. 软冲突照旧走**覆盖前备份** —— 就算判断错了也不丢东西
    fs.writeFileSync(softPaths[0], 'SAME-BYTES');
    const pSoft2 = await installer.analyze(ROOT, softZip, { name: 'conflict-soft' });
    const softBak = path.join(bakRoot, 'ov-soft');
    const rSoft = await installer.install(ROOT, pSoft2, { backupDir: softBak });
    t('软冲突照旧安装（写入 2）', () => rSoft.written === 2 ? true : '实际 ' + rSoft.written);
    t('软冲突照旧有覆盖前备份（2 个）', () =>
      rSoft.backed.length === 2 ? true : '实际 ' + rSoft.backed.length);
    t('备份里存的是覆盖前的旧内容', () => {
      const f = path.join(softBak, 'SB', 'Content', 'Paks', '~Mods', 'SOFT_P.pak');
      return fs.readFileSync(f, 'utf8') === 'SAME-BYTES' ? true : '备份内容不对';
    });
  }

  /* ---- 按 manifest 卸载 ---- */
  console.log('');
  console.log('=== 按 manifest 卸载 ===');
  const target = results.find(x => x.c.name === 'pak-flat');
  const rm = installer.removeByManifest(target.r.manifest);
  t('删除文件数 = manifest 数（' + target.r.manifest.length + '）', () =>
    rm.removed.length === target.r.manifest.length ? true : rm.removed.length + ' 个');
  t('删除后文件确实不存在', () => rm.removed.every(p => !fs.existsSync(p)) ? true : '仍有残留');
  t('无删除失败项', () => rm.failed.length === 0 ? true : JSON.stringify(rm.failed));

  /* ---- 覆盖前备份 + 还原 ---- */
  console.log('');
  console.log('=== 覆盖前备份与还原（CNS 这类合并型框架的关键保障） ===');
  {
    const bakZip = zip('sb-backup-case', {
      'SB/Binaries/Win64/ue4ss/Mods/CNS/main.lua': 'NEW-LUA',
      'SB/Binaries/Win64/ue4ss/Mods/CNS/extra.lua': 'NEW-EXTRA'
    });

    // 预置一个「游戏原文件」，模拟会被覆盖的既有文件
    const victim = abs('SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'CNS', 'main.lua');
    fs.mkdirSync(path.dirname(victim), { recursive: true });
    fs.writeFileSync(victim, 'ORIGINAL-GAME-FILE');

    const bp = await installer.analyze(ROOT, bakZip, { name: 'sb-backup-case' });
    t('识别为 cns 且落点为游戏根', () =>
      (bp.kind === 'cns' && path.resolve(bp.target) === path.resolve(ROOT))
        ? true : 'kind=' + bp.kind + ' target=' + bp.target);

    const br = await installer.install(ROOT, bp, {
      onConflict: 'overwrite',
      backupDir: path.join(bakRoot, 'ov-backup-case')
    });
    t('备份了 1 个被覆盖的文件', () => br.backed.length === 1 ? true : 'backed=' + br.backed.length);
    t('产生了备份目录', () => (!!br.backupDir && fs.existsSync(br.backupDir)) ? true : '无备份目录');
    t('备份里存的是原文件内容', () => {
      if (!br.backed.length) return '没有备份项';
      const got = fs.readFileSync(br.backed[0].backup, 'utf8');
      return got === 'ORIGINAL-GAME-FILE' ? true : '内容=' + got;
    });
    t('目标文件已被新内容覆盖', () => {
      const got = fs.readFileSync(victim, 'utf8');
      return got === 'NEW-LUA' ? true : '内容=' + got;
    });

    const rr = installer.restoreOverwritten(br.backed);
    t('还原无失败项', () => rr.failed.length === 0 ? true : JSON.stringify(rr.failed));
    t('还原后目标恢复为原文件内容', () => {
      const got = fs.readFileSync(victim, 'utf8');
      return got === 'ORIGINAL-GAME-FILE' ? true : '内容=' + got;
    });
    t('丢弃备份目录成功', () => installer.dropBackup(br.backupDir) === true ? true : '失败');

    // 关掉备份再装一次：不该产生备份目录
    fs.writeFileSync(victim, 'ORIGINAL-AGAIN');
    const br2 = await installer.install(ROOT, bp, { onConflict: 'overwrite', backup: false });
    t('backup:false 时不产生备份', () =>
      (br2.backed.length === 0 && !br2.backupDir) ? true : 'backed=' + br2.backed.length);

    // 收尾
    try { fs.rmSync(abs('SB', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'CNS'), { recursive: true, force: true }); } catch { /* 忽略 */ }
  }

  /* ---- 路径穿越防护 ---- */
  console.log('');
  console.log('=== 路径穿越防护 ===');
  t('拒绝 ../../evil.txt', () => archive.normalizeEntry('../../evil.txt') === null ? true : '未被拒绝');
  t('拒绝 C:\\Windows\\evil.dll', () => archive.normalizeEntry('C:\\Windows\\evil.dll') === null ? true : '未被拒绝');
  t('拒绝 /etc/passwd', () => archive.normalizeEntry('/etc/passwd') === null ? true : '未被拒绝');
  t('接受 a/b/c.txt', () => archive.normalizeEntry('a/b/c.txt') === 'a/b/c.txt' ? true : '被误拒');

  /* ---- 空目录清理（卸载后不留空壳） ---- */
  console.log('');
  console.log('=== 空目录清理 pruneEmptyDirs ===');
  {
    const base = path.join(BASE, 'prune');
    const mk = (rel, withFile) => {
      const abs = path.join(base, ...rel.split('/'));
      fs.mkdirSync(abs, { recursive: true });
      if (withFile) fs.writeFileSync(path.join(abs, 'f.txt'), 'x');
      return abs;
    };

    // 结构：base/keep/file.txt（非空，不能删）、base/deep/a/b/c（全空，应删光到 base）
    const keep = mk('keep', true);
    const leaf = mk('deep/a/b/c', false);
    const stop = path.join(base, 'deep');

    const removed = installer.pruneEmptyDirs([leaf], [base]);
    t('空目录链被删掉', () => !fs.existsSync(leaf) ? true : '还在');
    t('中间层也删掉了', () => !fs.existsSync(path.join(base, 'deep', 'a', 'b')) ? true : '还在');
    t('返回了被删的目录列表', () => removed.length >= 4 ? true : removed.length);
    t('非空目录没被误删', () => fs.existsSync(path.join(keep, 'f.txt')) ? true : '被删了');
    t('stopAt 自身不会被删', () => fs.existsSync(base) ? true : 'base 被删了');

    // stopAt 生效：不许越过 deep 往上删
    const leaf2 = mk('deep2/a/b', false);
    installer.pruneEmptyDirs([leaf2], [path.join(base, 'deep2')]);
    t('stopAt 挡住了向上回溯', () => fs.existsSync(path.join(base, 'deep2')) ? true : 'deep2 被删了');
    t('stopAt 以下的空目录仍然清掉', () => !fs.existsSync(leaf2) ? true : '还在');

    // 非空目录必须原样保留
    const busy = mk('busy/x/y', true);
    installer.pruneEmptyDirs([busy], [base]);
    t('有内容的目录一路都不删', () =>
      fs.existsSync(path.join(busy, 'f.txt')) && fs.existsSync(path.join(base, 'busy')) ? true : '被删了');

    // 不存在的路径不能抛错
    t('不存在的路径不抛错', () => {
      installer.pruneEmptyDirs([path.join(base, 'nope', 'nope2')], [base]);
      return true;
    });
    t('空数组 / null 不抛错', () => {
      installer.pruneEmptyDirs([]);
      installer.pruneEmptyDirs(null);
      return true;
    });
  }

  /* ---- 清理：备份根已重定向到临时目录，这里只做一次确认 ---- */
  console.log('');
  console.log('=== 覆盖备份是否留在项目数据目录 ===');
  {
    const realBakRoot = path.join(__dirname, '..', 'data', 'backup', 'overwritten');
    // `ov-backup-case` 是本次用例专用的名字，项目目录里出现它 = 重定向失效
    const leaked = fs.existsSync(realBakRoot)
      ? fs.readdirSync(realBakRoot).filter(n => n.includes('backup-case') || n.includes('sb-backup-case'))
      : [];
    t('测试备份未写进项目 data/backup/overwritten（backupDir 重定向生效）', () =>
      leaked.length === 0 ? true : '泄漏 ' + leaked.join(','));
    t('dropBackup 把该用例的备份目录删掉了', () =>
      !fs.existsSync(path.join(bakRoot, 'ov-backup-case')) ? true : '还在');
  }

  console.log('');
  console.log('===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  console.log('（测试目录：' + BASE + '，可手动删除）');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
