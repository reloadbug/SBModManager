'use strict';
/**
 * 探针：详情抽屉里的「包内文件」表 + 安装账本。
 *
 * 背景（2026-11-24 用户原话）：
 *   「界面上看不出来的问题是因为在安装时没有记录 mod 安装了哪些文件，不是用名称进行关联，
 *     而是安装时就记录好，哪些文件安装了哪些没装；详细信息里面要记录压缩包内的文件列表，
 *     并且记录每个文件是否安装，能够通过表格一眼看出来压缩包里面哪些文件被安装了，
 *     对于不同文件类型要显示不同颜色，比如常见的 3 个文件一组的 pak/ucas/utoc 都用绿色
 *     背景框住，dekcns.json 用蓝色框住，其他类型你看着分类，不需要关注的文件不加框」
 *
 * 做法的两条腿：
 *   ① **安装账本**：`installer.packageLedger(plan)` 把「包内完整清单」与「真正写进去的文件」
 *      对一遍（按文件名主干，避开 `[nx<modId>]` 标识与 `.disabled` 尾巴），结果落进注册表
 *      记录的 `pkg` 字段 —— 装的时候就记好，不靠事后按名字猜。
 *   ② **包内文件表**：`mods:packageFiles` 读安装包本身（只读不解压），逐个文件标
 *      `in / no / skip / na`，界面按类型上框（pak/ucas/utoc 绿、cns 蓝、其它灰、说明图片不框）。
 *
 * 这里只测口径与接线，不解压、不联网、不动真实游戏目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const installer = M('installer.js');

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [ OK ] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); }
};

// ────────────────────────────────────────────────────────────
console.log('\n【A】文件名主干：加不加 [nx] 标识、开还是关，都归一成同一个主干');
{
  const s = installer.stemOf;
  ok('A1 带标识的 pak 与包内原名主干相同',
    s('Kamenlaideng_Sexy Jk_P [nx4184].pak') === s('Kamenlaideng_Sexy Jk_P.pak'),
    s('Kamenlaideng_Sexy Jk_P [nx4184].pak'));
  ok('A2 关掉的文件（.disabled）主干相同',
    s('UltimateBunny_P [nx3977].pak.disabled') === s('UltimateBunny_P.pak'));
  ok('A3 ucas / utoc 与 pak 主干相同（三件套能对齐）',
    s('Foo_P [nx1].ucas') === s('Foo_P.pak') && s('Foo_P [nx1].utoc') === s('Foo_P.pak'));
  ok('A4 CNS 数据文件主干认得出',
    s('Kamenlaideng_SexyJK.dekcns.json') === 'kamenlaidengsexyjk',
    s('Kamenlaideng_SexyJK.dekcns.json'));
  ok('A5 大小写与空格不影响', s('  Captain EVE (CNS_P [nx9].pak'.replace('(CNS', 'CNS')) === s('captainevecnsp'));
}

// ────────────────────────────────────────────────────────────
console.log('\n【B】安装账本：包里有几个、装了哪几个、哪些没装');
{
  const plan = {
    entries: [
      { rel: 'Breast and Hip_Physics/Breast_Hip_phy_P.pak', size: 339 },
      { rel: 'Kamenlaideng_Blossom Butterfly JK/Kamenlaideng_Sexy Jk_P.pak', size: 339 },
      { rel: 'Kamenlaideng_Blossom Butterfly JK/Kamenlaideng_SexyJK.dekcns.json', size: 1975 },
      { rel: 'README.txt', size: 120 },
      { rel: 'Kamenlaideng_Blossom Butterfly JK/preview.png', size: 900 }
    ],
    mapping: [
      { rel: 'Breast_Hip_phy_P [nx4184].pak', to: 'X', size: 339 },
      { rel: 'Kamenlaideng_Sexy Jk_P [nx4184].pak', to: 'X', size: 339 },
      { rel: 'Kamenlaideng_SexyJK.dekcns.json', to: 'X', size: 1975 }
    ]
  };
  const led = installer.packageLedger(plan);
  ok('B1 包内文件数 = 5', led.entryCount === 5, String(led.entryCount));
  ok('B2 装进去的 = 3', led.installedCount === 3, String(led.installedCount));
  ok('B3 没装的是说明文档与预览图（2 个）', led.notInstalledCount === 2, JSON.stringify(led.notInstalled));
  ok('B4 没装清单里不含已装的那三个',
    !led.notInstalled.some(r => /Kamenlaideng_Sexy Jk_P\.pak$/.test(r)));
  ok('B5 空的计划不炸', installer.packageLedger({}).entryCount === 0
    && installer.packageLedger(null).installedCount === 0);
}

// ────────────────────────────────────────────────────────────
console.log('\n【C】安装时就把账本写进注册表记录（不靠事后按名字关联）');
{
  const src = readSrc('src/main/installFlow.js');
  ok('C1 installFlow 调了 packageLedger', src.includes('installer.packageLedger(plan)'));
  ok('C2 注册表记录里写了 pkg.entryCount / pkg.notInstalled',
    src.includes('entryCount: ledger.entryCount') && src.includes('notInstalled: ledger.notInstalled'));
  ok('C3 pkg 里记了安装包路径与时间', src.includes('archivePath: plan.archivePath') && src.includes('at: new Date().toISOString()'));
  const ipc = readSrc('src/main/ipc.js');
  ok('C4 补登记也写同样的账本',
    ipc.includes('installer.packageLedger(plan)') && ipc.includes('notInstalled: led.notInstalled'));
}

// ────────────────────────────────────────────────────────────
console.log('\n【D】`mods:packageFiles`：读安装包摊开清单，逐个标装没装');
{
  const src = readSrc('src/main/ipc.js');
  ok('D1 注册了通道', src.includes("handle('mods:packageFiles'"));
  ok('D2 只用 listEntries 读，不解压', src.includes('await archive.listEntries(ap)'));
  ok('D3 有类型分类', src.includes("'pak'") && src.includes("'ucas'") && src.includes("'utoc'")
    && src.includes("'cns'") && src.includes("'doc'") && src.includes("'img'"));
  ok('D4 四个状态都在', src.includes("state = 'in'") && src.includes("state = 'no'")
    && src.includes("state = 'skip'") && src.includes("'na'"));
  // 逐文件身份证：去 `[nx]` 标识 / 去 `.disabled` 之后再去盘上找，不是按原名硬比。
// （0.9.9 起从「主干」换成「逐文件键」：主干会把 pak/ucas/utoc 压成一个，三件套就没法逐个判断了）
ok('D5 按逐文件键去盘上找（不按原名，且三件套各算各的）',
  src.includes('disk.get(installer.fileKey(base))') && src.includes('const stem = installer.fileKey(e.name)'));
  ok('D6 找包三处来源：队列 / 注册表 / 本地库',
    src.includes("out.archiveFrom = '下载队列'") && src.includes("out.archiveFrom = '注册表'")
    && src.includes("out.archiveFrom = '本地库'"));
  ok('D7 盘上索引包含 ~Mods 与 LogicMods', src.includes("addDisk(L.modsDir") && src.includes("addDisk(L.logicModsDir"));
  ok('D8 没装的不算错（状态区分 in/no/skip）', src.includes("if (state === 'in') out.installedCount++"));
}

// ────────────────────────────────────────────────────────────
console.log('\n【E】IPC 通道贯通到渲染层');
{
  const pre = readSrc('src/preload/index.js');
  ok('E1 preload 暴露 packageFiles', pre.includes("packageFiles: (opts) => invoke('mods:packageFiles'"));
  const app = readSrc('src/renderer/app.js');
  ok('E2 抽屉里有投放点 id="drawerPkg"', app.includes('id="drawerPkg"'));
  ok('E3 有填充函数', app.includes('function fillDrawerPkg('));
  ok('E4 打开抽屉就去读', app.includes('fillDrawerPkg(infoCtx.factId, null)'));
  ok('E5 已安装 / 已下载两种状态都读',
    app.includes("kind === 'installed' || kind === 'downloaded'"));
  ok('E6 状态文案四种', app.includes("'已安装'") && app.includes("'未安装'")
    && app.includes("'已关闭'") && app.includes("'无需安装'"));
  ok('E7 表格有 文件 / 子 Mod / 大小 / 状态 四列',
    app.includes('<span>文件</span><span>子 Mod</span><span>大小</span><span>状态</span>'));
  ok('E8 读到就缓存，第二次打开不再读盘', app.includes('state.modPkg[key]'));
}

// ────────────────────────────────────────────────────────────
console.log('\n【F】类型着色：pak/ucas/utoc 绿、cns 蓝、其它灰、说明图片不框');
{
  const css = readSrc('src/renderer/style.css');
  ok('F1 三件套共用绿框', css.includes('.pchip.pak,.pchip.ucas,.pchip.utoc{'));
  ok('F2 cns 蓝框', css.includes('.pchip.cns{'));
  ok('F3 其它灰框', css.includes('.pchip.other{'));
  const app = readSrc('src/renderer/app.js');
  ok('F4 说明 / 图片不加框（pkgChip 直接返回空）',
    app.includes("if (kind === 'doc' || kind === 'img') return '';"));
  ok('F5 表格行高与字号跟其它区域一致', css.includes('min-height:24px') && css.includes('font-size:11.5px'));
  ok('F6 缺文件的行有独立配色', css.includes('.pf-row.miss'));
}

// ────────────────────────────────────────────────────────────
console.log('\n【G】analyze 交出包内完整清单（账本与表格都靠它）');
{
  const src = readSrc('src/main/installer.js');
  ok('G1 返回值里有 entries', src.includes('entries: rel.map(r => ({ rel: r.path, size: r.size }))'));
  ok('G2 导出 packageLedger', src.includes('packageLedger,'));
}

// ────────────────────────────────────────────────────────────
console.log('\n【H】i18n 词条');
{
  const keys = JSON.parse(readSrc('_probe/i18n-keys.json'));
  ok('H1 键表 1323 条', keys.length === 1323, String(keys.length));
  for (const k of ['包内文件', '无需安装', '子 Mod', '其它']) {
    ok('H2 有词条「' + k + '」', keys.includes(k));
  }
  // 语言包是浏览器 IIFE（不能 require），只在源码里找那一行
  const en = readSrc('src/renderer/locales/en-US.js');
  ok('H3 en-US 有 In package', en.includes("'包内文件': 'In package'"));
}

// ────────────────────────────────────────────────────────────
console.log('\n────────────────────────────');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
