'use strict';
const fs = require('fs');
const path = require('path');

const EXE_REL = path.join('SB', 'Binaries', 'Win64', 'SB-Win64-Shipping.exe');
const LAUNCHER_REL = 'SB.exe';

/** 相对游戏根目录的关键位置 */
function layout(root) {
  const sb = path.join(root, 'SB');
  const win64 = path.join(sb, 'Binaries', 'Win64');
  return {
    root,
    sb,
    win64,
    exe: path.join(root, EXE_REL),
    launcher: path.join(root, LAUNCHER_REL),
    paks: path.join(sb, 'Content', 'Paks'),
    modsDir: path.join(sb, 'Content', 'Paks', '~Mods'),
    // UE4SS 蓝图/逻辑模组（Logic Mod）的落点 —— CNS 主体、ATOOL 本体都住这里。
    // ⚠️ 与 ~Mods 是**两套互不相通的加载机制**：放错了游戏直接不加载（文件静静躺着）。
    logicModsDir: path.join(sb, 'Content', 'Paks', 'LogicMods'),
    ue4ssDir: path.join(win64, 'ue4ss'),
    ue4ssModsDir: path.join(win64, 'ue4ss', 'Mods'),
    ue4ssDll: path.join(win64, 'ue4ss', 'UE4SS.dll'),
    dwmapiDll: path.join(win64, 'dwmapi.dll'),
    modsTxt: path.join(win64, 'ue4ss', 'Mods', 'mods.txt')
  };
}

/** 判断某个目录是不是剑星根目录 */
function isGameRoot(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, EXE_REL));
  } catch {
    return false;
  }
}

/** 列出盘符，用于自动搜索 */
function listDrives() {
  const out = [];
  for (let i = 67; i <= 90; i++) { // C..Z
    const d = String.fromCharCode(i) + ':\\';
    try { if (fs.existsSync(d)) out.push(d); } catch { /* 忽略无权限盘符 */ }
  }
  return out;
}

/** 常见安装位置 + 简单广度搜索 */
function detectCandidates(extra = []) {
  const found = [];
  const push = (p) => { if (p && !found.includes(p) && isGameRoot(p)) found.push(p); };

  for (const p of extra) push(p);

  const names = ['Star Blade', 'StellarBlade', 'Stellar Blade', 'star blade'];
  // ⚠️ 顺序有讲究：**C 盘优先**。系统盘上的路径最稳定（用户换盘/清理 D、E 盘时它还在），
  //    而且历史上那次事故就是「D 盘排前面」把一份旧副本排到了真副本之前。
  //    注意：探测顺序只是候选的**排列**，真正的取舍看 rankCandidates 的 records。
  const parents = ['C:\\games', 'C:\\Games',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'C:\\Program Files\\Steam\\steamapps\\common',
    'D:\\games', 'D:\\Games', 'D:\\Game', 'E:\\games',
    'D:\\Steam\\steamapps\\common',
    'D:\\SteamLibrary\\steamapps\\common',
    'E:\\SteamLibrary\\steamapps\\common',
    'D:\\', 'E:\\'];

  for (const parent of parents) {
    for (const n of names) push(path.join(parent, n));
  }

  // 盘符根目录下的一层扫描
  if (found.length === 0) {
    for (const drive of listDrives()) {
      for (const sub of ['games', 'Games', 'Game', 'GameLibrary', 'SteamLibrary\\steamapps\\common']) {
        const base = path.join(drive, sub);
        for (const n of names) push(path.join(base, n));
      }
    }
  }
  return found;
}

function dirStat(p) {
  try {
    const st = fs.statSync(p);
    return { exists: true, mtime: st.mtime.toISOString(), size: st.size };
  } catch {
    return { exists: false };
  }
}

function countFiles(dir, filter) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && (!filter || filter(e.name))).length;
  } catch {
    return 0;
  }
}

/** 递归统计文件数与总字节（用于「服装数据目录」这种要数一数的落点） */
function walkStat(dir, acc = { files: 0, bytes: 0 }) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const it of items) {
    const fp = path.join(dir, it.name);
    if (it.isDirectory()) walkStat(fp, acc);
    else { try { acc.bytes += fs.statSync(fp).size; acc.files++; } catch { /* 忽略 */ } }
  }
  return acc;
}

/** UE4SS 是否就位：dwmapi.dll + ue4ss/UE4SS.dll 都在 */
function ue4ssStatus(L) {
  const dll = dirStat(L.dwmapiDll);
  const core = dirStat(L.ue4ssDll);
  const installed = dll.exists && core.exists;
  let version = null;
  if (installed) {
    // UE4SS 把版本写在自己的目录名/日志里，这里退化为文件时间 + 大小指纹
    version = '已安装';
  }
  return {
    installed,
    path: L.win64,
    dll: L.dwmapiDll,
    core: L.ue4ssDll,
    coreSize: core.size || 0,
    mtime: core.mtime || dll.mtime || null,
    version
  };
}

/* ---------------- CNS（Custom Nanosuit System） ---------------- */

/**
 * CNS 落盘后的**特征文件**。
 *
 * ## 为什么要换成特征文件判定
 *
 * 早期版本是「猜名字」启发式 —— 在 `ue4ss\Mods` 和 `~Mods` 里找 `/nano|cns|suit/i`。
 * 问题是：
 *   · 猜到了也不能确证，界面上只能挂一条黄色警告（用户截图里的那条）
 *   · 猜不到不等于没装（比如用户把目录改了名）
 *   · 误报：一个叫 `CNS_UI_Tweaks` 的无关 mod 也会被算成「已装 CNS」
 *
 * 2026-10-11 拿到用户手动下载的官方包（`CustomNanosuitSystem-1496-2-2`，38 个归档条目
 * / 23 个文件），把它的真实结构摸清了，于是改成按**固定路径的文件是否存在**判定：
 *
 * | 特征 | 路径（相对游戏根） | 说明 |
 * |---|---|---|
 * | 核心 | `SB\Content\Paks\LogicMods\DekCNS_P.pak` | CNS 主体（IoStore 三件套之一） |
 * | 核心 | `SB\Binaries\Win64\ue4ss\Mods\DekCNS\Scripts\main.lua` | CNS 脚本入口 |
 * | 附带 | `SB\Content\Paks\~Mods\CustomNanosuitSystem\` | 服装 / 外观数据目录 |
 *
 * **两个核心特征都在**才算装好。只命中一个 = 装了一半（实测很常见：只解压了
 * `Binaries\` 没解压 `Content\`，或者反过来），这时给出明确的「缺什么」，
 * 而不是含糊的「可能装了」。
 *
 * ⚠️ `~Mods` 与包内的 `~mods` 大小写不同。Windows 文件系统不区分大小写，
 *    `fs.existsSync` 能正确命中，所以这里**不要**自己去做大小写归一化。
 */
const CNS_MARKERS = [
  {
    key: 'logicmod',
    core: true,
    rel: ['Content', 'Paks', 'LogicMods', 'DekCNS_P.pak'],
    label: 'SB\\Content\\Paks\\LogicMods\\DekCNS_P.pak',
    what: 'CNS 主体 pak'
  },
  {
    key: 'script',
    core: true,
    rel: ['Binaries', 'Win64', 'ue4ss', 'Mods', 'DekCNS', 'Scripts', 'main.lua'],
    label: 'SB\\Binaries\\Win64\\ue4ss\\Mods\\DekCNS\\Scripts\\main.lua',
    what: 'CNS 脚本入口'
  },
  {
    key: 'data',
    core: false,
    dir: true,
    rel: ['Content', 'Paks', '~mods', 'CustomNanosuitSystem'],
    label: 'SB\\Content\\Paks\\~Mods\\CustomNanosuitSystem\\',
    what: '服装 / 外观数据'
  }
];

/** CNS 主体 pak 的 IoStore 伴生文件（.pak / .ucas / .utoc 三件套） */
const CNS_LOGICMOD_FILES = /^DekCNS_P\.(pak|ucas|utoc)$/i;

/**
 * CNS 探测 —— 按特征文件确定性判定，不再靠猜名字。
 * @param {object} L game.layout(root) 的结果
 */
function cnsStatus(L) {
  const markers = CNS_MARKERS.map(m => {
    const abs = path.join(L.sb, ...m.rel);
    const st = dirStat(abs);
    let fileCount = 0, bytes = 0;
    if (st.exists && m.dir) {
      const s = walkStat(abs);
      fileCount = s.files;
      bytes = s.bytes;
    }
    return {
      key: m.key,
      core: !!m.core,
      isDir: !!m.dir,
      what: m.what,
      label: m.label,
      path: abs,
      exists: st.exists,
      size: st.exists ? (m.dir ? bytes : (st.size || 0)) : 0,
      mtime: st.mtime || null,
      fileCount
    };
  });

  // 主体 pak 的伴生文件：CNS 用的是 IoStore，正常应该是 .pak + .ucas + .utoc 三个
  let companions = [];
  try {
    companions = fs.readdirSync(L.logicModsDir, { withFileTypes: true })
      .filter(e => e.isFile() && CNS_LOGICMOD_FILES.test(e.name))
      .map(e => e.name)
      .sort();
  } catch { /* LogicMods 目录不存在 → 没装 */ }

  const core = markers.filter(m => m.core);
  const coreFound = core.filter(m => m.exists);
  const found = markers.filter(m => m.exists);
  const missingCore = core.filter(m => !m.exists);

  const installed = coreFound.length === core.length && core.length > 0;
  const partial = !installed && found.length > 0;

  const notes = [];
  if (partial) {
    notes.push('CNS 安装不完整：缺少 ' + missingCore.map(m => m.label).join('、') +
      '。把包里的 SB\\ 目录整个合并进游戏根目录即可补全。');
  }

  return {
    installed,
    partial,
    // 判定依据是特征文件而非命名猜测 —— 从此不再需要「启发式，仅供参考」的免责声明
    confident: true,
    markers,
    found,
    coreFound: coreFound.length,
    coreTotal: core.length,
    missingCore,
    companions,
    logicModsDir: L.logicModsDir,
    note: notes.length ? notes.join('；') : null
  };
}

/* ---------------- ATOOL（Animation Tool，mod 1662） ---------------- */

/**
 * ATOOL 本体的特征文件。
 *
 * ## 为什么按文件判定而不是猜目录
 *
 * ATOOL 是 UE4SS **Logic Mod**（不是普通 pak 替换），落地有三种兼容形态
 * （详见 `docs/ATOOL-调研与支持方案.md` §5.2）：
 *   · 平铺  `LogicMods\HD-ATOOL_P.pak`
 *   · 内层  `LogicMods\HD-ATOOL_P\HD-ATOOL_P.pak`
 * 两者都由安装器正确识别，所以探测必须**两种都认**，否则用户装完界面说「没装」。
 *
 * | 特征 | 路径（相对游戏根） | 说明 |
 * |---|---|---|
 * | 核心 | `SB\Content\Paks\LogicMods\HD-ATOOL_P.pak` | ATOOL 主体 |
 * | 核心 | 同目录 `HD-ATOOL_P.ucas` + `.utoc` | IoStore 三件套，齐了才算完整 |
 * | 可选 | `...\LogicMods\HD-ATOOL_P\audio\*.wav` | 外置音频（**手工放置**，作者说明里要求） |
 *
 * ⚠️ 与 CNS 的关键区别：CNS 的 `.dekcns` 数据住在 `~Mods`，ATOOL 的一切都在
 *    `LogicMods`。两者落点不同，可以共存（本机现状就是 CNS 已在 LogicMods）。
 */
const ATOOL_PAK_STEM = /^hd-atool_p$/i;
const ATOOL_EXT = ['pak', 'ucas', 'utoc'];

/**
 * ATOOL 探测 —— 按特征文件确定性判定。
 *
 * 平铺与内层两种落点都查，取**先命中**的那个作为基准（两者互斥，同时存在说明
 * 用户装重复了，会在 note 里提示）。
 * @param {object} L game.layout(root) 的结果
 */
function atoolStatus(L) {
  const flatBase = L.logicModsDir;                                  // LogicMods\
  const innerBase = path.join(L.logicModsDir, 'HD-ATOOL_P');         // LogicMods\HD-ATOOL_P\

  // 主体三件套：平铺优先，找不到再找内层
  const layoutKind = fs.existsSync(path.join(flatBase, 'HD-ATOOL_P.pak')) ? 'flat'
    : (fs.existsSync(path.join(innerBase, 'HD-ATOOL_P.pak')) ? 'inner' : null);
  const base = layoutKind === 'inner' ? innerBase : flatBase;

  const markers = ATOOL_EXT.map((ext, i) => {
    const abs = path.join(base, 'HD-ATOOL_P.' + ext);
    const st = dirStat(abs);
    // 两种形态都找一遍，UI 上「期望路径」才不会误导（用户可能装在另一种形态下）
    const alt = path.join(base === flatBase ? innerBase : flatBase, 'HD-ATOOL_P.' + ext);
    return {
      key: ext,
      core: true,
      isDir: false,
      what: 'ATOOL 主体（' + ext + '）',
      label: 'SB\\Content\\Paks\\LogicMods\\HD-ATOOL_P.' + ext,
      path: abs,
      altPath: alt,
      exists: st.exists,
      size: st.size || 0,
      mtime: st.mtime || null,
      fileCount: 0
    };
  });

  // 可选：外置音频目录（作者要求手工把 .wav 放进来，文件名 = 动画编号）
  const audioAbs = path.join(base, 'audio');
  const audioSt = dirStat(audioAbs);
  let audioCount = 0;
  if (audioSt.exists) {
    audioCount = countFiles(audioAbs, n => /\.wav$/i.test(n));
  } else {
    // 另一种形态下可能放着 audio
    const alt = path.join(base === flatBase ? innerBase : flatBase, 'audio');
    if (dirStat(alt).exists) audioCount = countFiles(alt, n => /\.wav$/i.test(n));
  }
  markers.push({
    key: 'audio',
    core: false,
    isDir: true,
    what: '外置音频目录（可选）',
    label: 'SB\\Content\\Paks\\LogicMods\\HD-ATOOL_P\\audio\\',
    path: audioAbs,
    altPath: path.join(base === flatBase ? innerBase : flatBase, 'audio'),
    exists: audioSt.exists || audioCount > 0,
    size: 0,
    mtime: null,
    fileCount: audioCount
  });

  const core = markers.filter(m => m.core);
  const coreFound = core.filter(m => m.exists);
  const missingCore = core.filter(m => !m.exists);

  // 三件套齐 = 完整；只命中一部分 = 装了一半（只解压了 .pak 没解压伴生文件是常见事故，
  // 游戏加载 IoStore 资源时会直接失败或黑屏）
  const installed = coreFound.length === core.length;
  const partial = !installed && coreFound.length > 0;

  const notes = [];
  if (partial) {
    notes.push('ATOOL 安装不完整：缺少 ' + missingCore.map(m => m.label).join('、') +
      '。把包里的 HD-ATOOL_P\\ 文件夹与三件套一起解压进 LogicMods 即可补全。');
  }
  if (layoutKind) {
    notes.push('检测到 ' + (layoutKind === 'inner' ? '内层目录' : '平铺') + '落点（LogicMods\\' +
      (layoutKind === 'inner' ? 'HD-ATOOL_P\\' : '') + 'HD-ATOOL_P.pak）。');
  }
  if (installed && audioCount === 0) {
    notes.push('没有外置音频（audio\\ 里没有 .wav）—— ATOOL 自带的动画不需要它，' +
      '但用到外置音频的动画 Mod 会静音。');
  }

  return {
    installed,
    partial,
    // 判定依据是特征文件而非命名猜测
    confident: true,
    markers,
    found: markers.filter(m => m.exists),
    coreFound: coreFound.length,
    coreTotal: core.length,
    missingCore,
    layoutKind,                                    // 'flat' | 'inner' | null
    logicModsDir: L.logicModsDir,
    audioDir: audioAbs,
    audioCount,
    note: notes.length ? notes.join(' ') : null
  };
}

/** 汇总游戏与前置组件状态 */
function inspect(root) {
  const L = layout(root);
  const exe = dirStat(L.exe);
  const launcher = dirStat(L.launcher);
  const paks = dirStat(L.paks);
  const modsDirExists = fs.existsSync(L.modsDir);
  const logicModsDirExists = fs.existsSync(L.logicModsDir);

  const paksFiles = (() => {
    try {
      return fs.readdirSync(L.paks, { withFileTypes: true })
        .filter(e => e.isFile() && /\.(pak|ucas|utoc)$/i.test(e.name)).map(e => e.name);
    } catch { return []; }
  })();

  return {
    root,
    valid: exe.exists,
    layout: L,
    exe: { ...exe, path: L.exe },
    launcher: { ...launcher, path: L.launcher },
    engine: {
      // 有 .ucas/.utoc 说明启用了 IoStore
      iostore: paksFiles.some(f => /\.ucas$/i.test(f)) && paksFiles.some(f => /\.utoc$/i.test(f)),
      paksCount: paksFiles.length
    },
    paks: { ...paks, path: L.paks },
    modsDir: {
      path: L.modsDir,
      exists: modsDirExists,
      fileCount: modsDirExists ? countFiles(L.modsDir) : 0
    },
    // Logic Mods 与 ~Mods 是两套互不相通的加载机制，各自独立报状态，
    // 界面据此提示「你的 mod 到底该放哪」。
    logicModsDir: {
      path: L.logicModsDir,
      exists: logicModsDirExists,
      fileCount: logicModsDirExists ? countFiles(L.logicModsDir) : 0
    },
    ue4ss: ue4ssStatus(L),
    cns: cnsStatus(L),
    atool: atoolStatus(L)
  };
}

/** 确保 ~Mods 目录存在 */
function ensureModsDir(root) {
  const L = layout(root);
  if (!fs.existsSync(L.modsDir)) fs.mkdirSync(L.modsDir, { recursive: true });
  return L.modsDir;
}

/** 确保 LogicMods 目录存在（UE4SS 蓝图模组落点） */
function ensureLogicModsDir(root) {
  const L = layout(root);
  if (!fs.existsSync(L.logicModsDir)) fs.mkdirSync(L.logicModsDir, { recursive: true });
  return L.logicModsDir;
}

/**
 * 一个候选游戏目录的「画像」—— 用来判断**哪一份才是活的**。
 *
 * 2026-11-22 的事故背景：用户把游戏从 `c:\Star Blade` 搬到 `C:\games\Star Blade`
 * （.sbmod 里 313 条 Mod 记录），但机器上 `D:\games\Star Blade` 还留着一份旧副本。
 * 管理器只比路径、不看内容，于是"认"了 D 盘那份，还在那儿 seed 了一个只有 1 条记录的
 * 空 .sbmod —— 用户看到的是「Mod 全没了」「游戏路径变成 D 盘」。
 *
 * 所以候选不能只是字符串，得带上内容指纹：
 *   · `records` 是判断"哪份是活的"唯一硬指标（`mtime` 只能参考 —— 自动 seed 出来的
 *     空 .sbmod 反而可能是最新的，这场事故里 D 盘那份的 mods.json 就比 C 盘的新）；
 *   · `mods` 是 `~Mods` 里的文件数，作最后兜底。
 *
 * @param {string} root 候选游戏根目录
 * @returns {{root:string, mods:number, records:number, sbmodAt:string, mtime:string}}
 */
function candidateInfo(root) {
  const out = { root: root || '', mods: 0, records: 0, sbmodAt: '', mtime: '' };
  if (!root) return out;
  const L = layout(root);

  // ~Mods 里的文件数（便宜的 readdir 计数，不递归、不 stat）
  out.mods = countFiles(L.modsDir);

  // `<根>\.sbmod\mods.json` 里登记了多少条；读不到 / 坏了都算 0，绝不抛
  const modsJson = path.join(root, '.sbmod', 'mods.json');
  try {
    const j = JSON.parse(fs.readFileSync(modsJson, 'utf8'));
    out.records = Array.isArray(j && j.mods) ? j.mods.length : 0;
  } catch { out.records = 0; }
  try { out.sbmodAt = fs.statSync(modsJson).mtime.toISOString(); } catch { out.sbmodAt = ''; }

  const st = dirStat(L.modsDir);
  out.mtime = st.exists ? (st.mtime || '') : '';
  return out;
}

/**
 * 路径归一化键（只用来判"两个写法是不是同一个目录"）：
 * 小写 + 正斜杠统一成反斜杠 + 去掉尾部反斜杠。NTFS 不区分大小写，所以这么比是安全的。
 *
 * ⚠️ 不要拿它当"路径"去用（大小写信息丢了）—— 只做去重键。
 */
function pathKeyOf(p) {
  return String(p || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * 候选排序：**records 多的优先** → 其次 `mtime` 新的优先 → 其次 `~Mods` 文件多的优先。
 * 完全相同的两项按传入顺序（稳定）。
 *
 * ⚠️ 这份排序是给**用户挑「哪个才是我的游戏目录」**用的。
 *    **不许**被当成默认值直接采用（`candidates[0]` 不是答案，只是"最像的那一份"）——
 *    自动替用户做决定正是那场事故的成因。
 *
 * @param {Array<string|{root:string}>} list 候选（字符串，或已带 root 的对象）
 * @returns {Array<{root:string, mods:number, records:number, sbmodAt:string, mtime:string}>}
 */
function rankCandidates(list) {
  const rows = (Array.isArray(list) ? list : [])
    .map(x => (x && typeof x === 'object' ? x.root : x))
    .filter(r => typeof r === 'string' && r.trim())
    .map((r, i) => ({ info: candidateInfo(r.trim()), i }));
  const ms = (s) => { const n = Date.parse(s || ''); return Number.isFinite(n) ? n : 0; };
  rows.sort((a, b) =>
    (b.info.records - a.info.records) ||
    (ms(b.info.mtime) - ms(a.info.mtime)) ||
    (b.info.mods - a.info.mods) ||
    (a.i - b.i));
  // 同一个目录的不同写法（C:\games\Star Blade / C:\Games\star blade / 带尾斜杠）在 Windows 上
  // 指的是同一个地方。不去重的话下拉里会出现 8 条重复项（用户 2026-11-22 实测到过）。
  // NTFS 大小写不敏感 → 按「小写 + 统一成反斜杠 + 去掉尾部反斜杠」归一后去重；
  // 排序在前的那条（records 最多的）自然留下，显示名沿用第一次遇到时的写法。
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const k = pathKeyOf(r.info.root);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r.info);
  }
  return out;
}

module.exports = {
  EXE_REL, layout, isGameRoot, detectCandidates, inspect,
  candidateInfo, rankCandidates, pathKeyOf,
  ensureModsDir, ensureLogicModsDir, listDrives,
  CNS_MARKERS, atoolStatus
};
