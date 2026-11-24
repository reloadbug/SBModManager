'use strict';
const fs = require('fs');
const path = require('path');
const toggleName = require('./toggleName');
const game = require('./game');
const prereqs = require('./prereqs');
const paths = require('./paths');
const linker = require('./linker');
const modTag = require('./modTag');

/** UE4SS 自带的脚本 mod（不算用户安装的） */
const UE4SS_BUILTIN = new Set([
  'ActorDumperMod', 'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod',
  'ConsoleCommandsMod', 'ConsoleEnablerMod', 'jsbLuaProfilerMod', 'Keybinds',
  'LineTraceMod', 'SplitScreenMod', 'shared'
]);

const PAK_EXT = /\.(pak|ucas|utoc)$/i;

/**
 * CNS 服装数据文件（`.dekcns.json` / `.dekani.json` / 关掉后的 `.dekcns.disabled.json`）。
 *
 * 它不是独立 mod，是某个 pak 的「外观定义」—— 两者属于同一套东西，
 * 只是名字常常不完全一样（见 `normStem` / `diceCoeff` 里的说明）。
 */
const CNS_DATA = /\.(dekcns|dekani)(\.json)?$/i;

/** 归一化名字主干：去掉 Nexus 标识 `[nx1234]`、扩展名、所有非字母数字，统一小写 */
function normStem(name) {
  return String(name)
    .replace(/\s*\[nx\d+\]/ig, '')
    .replace(CNS_DATA, '')
    .replace(PAK_EXT, '')
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9]+/ig, '')
    .toLowerCase();
}

/**
 * 字符双字组 Dice 系数：0 = 毫无关系，1 = 完全一样。
 *
 * 为什么不用「相等 / 前缀」这种硬规则（2026-11-24，mod 4184 实测）：
 * 同一套东西两边名字经常只差几个字符 ——
 *   pak  `Kamenlaideng_Sexy Jk_P`     ↔ 数据 `Kamenlaideng_SexyJK`      （差 `_P` 与一处下划线）
 *   pak  `AiK_NaiK_MaskAbstract_10004`↔ 数据 `AiK_NaiK_MaskAbstractSE_10004`（数据多了 `SE`）
 * 硬规则一条也匹配不上，相似度却能到 0.97 / 0.99。
 */
function diceCoeff(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = grams(a), B = grams(b);
  let inter = 0;
  for (const [g, n] of A) {
    const k = B.get(g);
    if (k) inter += Math.min(n, k);
  }
  const total = (a.length - 1) + (b.length - 1);
  return total > 0 ? (2 * inter) / total : 0;
}

/** 挂伴随文件的相似度门槛：实测 ≥0.80 都是同一套，≤0.79 全是另一个 mod（如 Bayonetta 0.47） */
const CNS_MATCH_MIN = 0.8;

/** 解析 ue4ss/Mods/mods.txt，得到 { 名称: 是否启用 } */
function parseModsTxt(file) {
  const map = {};
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return map; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith(';')) continue;
    const m = t.match(/^(.+?)\s*:\s*([01])\s*$/);
    if (m) map[m[1].trim()] = m[2] === '1';
  }
  return map;
}

/**
 * 扫描 ~Mods：按基名分组（一个 mod 可能由 .pak + .ucas + .utoc 多个文件组成）。
 *
 * 另外把 CNS 服装数据文件（`.dekcns.json` / `.dekani.json`）挂到同名 pak 组上 ——
 * 以前这里一句 `if (!PAK_EXT.test(base)) continue` 把它们全丢了，于是：
 *   · 界面上完全看不见（`Kamenlaideng_SexyJK.dekcns.json` 就是这样隐形的）；
 *   · 关掉 pak 不会关掉它的外观定义，卸载也不会带走它（半开半关 + 残留）。
 */
function scanPaks(L, registry) {
  let entries = [];
  try {
    entries = fs.readdirSync(L.modsDir, { withFileTypes: true }).filter(e => e.isFile());
  } catch {
    return [];
  }

  const statOf = (name) => {
    try { return fs.statSync(path.join(L.modsDir, name)); } catch { return null; }
  };

  const groups = new Map();
  const cnsFiles = [];
  for (const e of entries) {
    const name = e.name;
    const disabled = toggleName.isDisabledName(name);
    const base = toggleName.stripDisabled(name);

    if (!PAK_EXT.test(base)) {
      if (CNS_DATA.test(base)) cnsFiles.push({ name, base, disabled });
      continue;
    }
    const key = base.replace(PAK_EXT, '');

    if (!groups.has(key)) {
      groups.set(key, { key, name: key, kind: 'pak', enabled: true, files: [], size: 0, mtime: null });
    }
    const g = groups.get(key);
    const st = statOf(name);
    g.files.push({ name, disabled, size: st ? st.size : 0, mtime: st ? st.mtime.toISOString() : null });
    g.size += st ? st.size : 0;
    if (!g.mtime || (st && st.mtime.toISOString() > g.mtime)) g.mtime = st ? st.mtime.toISOString() : g.mtime;
    if (disabled) g.enabled = false;
  }

  // 每组对应哪条注册表记录（先算好，挂伴随文件时要看它登记没登记）
  for (const g of groups.values()) {
    g.target = path.join(L.modsDir, g.files[0].name);
    g.reg = registry.byTarget(g.target) || registry.get('disk:paks:' + g.key);
  }

  // ---- 把 CNS 服装数据文件挂到同名的 pak 组上 ----
  //
  // 已登记的组也挂：磁盘上「一套 Mod 的文件」是连在一起用的，界面既然合并成一张卡，
  // 关它 / 删它时数据文件就该跟着走。注册表 manifest 里本来就有这个文件的（比如
  // 补登记回来的 4184），按 manifest 卸载同样会带走它，不会留残。
  const all = [...groups.values()];
  for (const c of cnsFiles) {
    const stem = normStem(c.base);
    let best = null;
    let bestScore = 0;
    for (const g of all) {
      const d = diceCoeff(stem, normStem(g.key));
      if (d > bestScore) { bestScore = d; best = g; }
    }
    if (!best || bestScore < CNS_MATCH_MIN) continue;   // 名字差太远 = 另一个 mod 的数据，别硬凑

    const st = statOf(c.name);
    best.files.push({
      name: c.name,
      disabled: c.disabled,
      size: st ? st.size : 0,
      mtime: st ? st.mtime.toISOString() : null,
      companion: true,
      cnsData: true
    });
    best.size += st ? st.size : 0;
    if (st && (!best.mtime || st.mtime.toISOString() > best.mtime)) best.mtime = st.mtime.toISOString();
    // 伴随件被单独关掉时不翻转 pak 组的开关态（那由 pak 自己决定），只留个标记
    if (c.disabled) best.partialDisabled = true;
    if (!best.cnsData) best.cnsData = [];
    best.cnsData.push(c.name);
  }

  return [...groups.values()].map(g => ({
    id: g.reg ? g.reg.id : 'disk:paks:' + g.key,
    name: g.reg && g.reg.name ? g.reg.name : g.name,
    kind: 'pak',
    enabled: g.enabled,
    files: g.files,
    fileCount: g.files.length,
    size: g.size,
    mtime: g.mtime,
    location: L.modsDir,
    registered: !!g.reg,
    // 文件名里带的 Nexus 标识（`名字 [nx123].pak`）—— 管理器装的东西自己带着身份，
    // 注册表丢了也能认出来。见 src/main/modTag.js。
    tag: modTag.parse(g.files[0].name),
    meta: g.reg || null,
    // 挂在 pak 组上的 CNS 服装数据文件（开关 / 卸载会跟着一起走）
    cnsData: g.cnsData || [],
    partialDisabled: !!g.partialDisabled
  }));
}

/** 扫描 ue4ss/Mods 下的脚本 mod 目录 */
function scanScriptMods(L, registry) {
  let entries = [];
  try {
    entries = fs.readdirSync(L.ue4ssModsDir, { withFileTypes: true }).filter(e => e.isDirectory());
  } catch {
    return [];
  }
  const toggles = parseModsTxt(L.modsTxt);

  return entries.map(e => {
    const dir = path.join(L.ue4ssModsDir, e.name);
    let size = 0, mtime = null, fileCount = 0;
    const walk = (p) => {
      let items = [];
      try { items = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const it of items) {
        const fp = path.join(p, it.name);
        if (it.isDirectory()) walk(fp);
        else {
          try {
            const st = fs.statSync(fp);
            size += st.size; fileCount++;
            const t = st.mtime.toISOString();
            if (!mtime || t > mtime) mtime = t;
          } catch { /* 忽略 */ }
        }
      }
    };
    walk(dir);

    const builtin = UE4SS_BUILTIN.has(e.name);
    const reg = registry.get('disk:script:' + e.name);
    return {
      id: reg ? reg.id : 'disk:script:' + e.name,
      name: reg && reg.name ? reg.name : e.name,
      // 目录名单独留一份 —— 「被别的 mod 认领」的过滤要按目录名判断，
      // 不能按 name（name 可能被注册表里的显示名覆盖）
      dir: e.name,
      kind: 'script',
      enabled: toggles[e.name] !== undefined ? toggles[e.name] : true,
      files: [{ name: e.name + '/', dir: true }],
      fileCount,
      size,
      mtime,
      location: L.ue4ssModsDir,
      registered: !!reg,
      builtin,
      tag: modTag.parse(e.name),
      meta: reg || null
    };
  }).filter(m => m.name !== 'shared');
}

/**
 * 找出「已经被别的 mod 认领」的脚本目录名（小写）。
 *
 * 为什么需要：CNS 这类框架包会把脚本落到 `ue4ss\Mods\DekCNS\`，而通用脚本扫描
 * 只认目录，于是同一个 mod 会在列表里出现两条 ——「Custom Nanosuit System」
 * 和「DekCNS」。用户还可能单独去禁用/卸载 DekCNS，直接把 CNS 弄坏。
 *
 * 判据是注册表里的 manifest：某个已登记的 mod（且不是脚本 mod 自己）的文件
 * 落在 `ue4ss\Mods\<X>\` 下，就把 `<X>` 视为被认领。
 */
function claimedScriptDirs(L, registry) {
  const base = path.resolve(L.ue4ssModsDir).toLowerCase() + path.sep;
  const claimed = new Set();
  for (const reg of registry.all()) {
    if (/^disk:script:/.test(reg.id)) continue;   // 脚本 mod 自己不算「认领」
    for (const f of reg.manifest || []) {
      if (!f || !f.path) continue;
      const abs = path.resolve(f.path).toLowerCase();
      if (!abs.startsWith(base)) continue;
      const seg = abs.slice(base.length).split(path.sep)[0];
      if (seg) claimed.add(seg);
    }
  }
  return claimed;
}

/**
 * 原始安装包（`data/library/` 里那个压缩包）的可展示信息。
 *
 * 用户要求（2026-10-13）：已安装的 mod 要能一键在资源管理器里定位到原压缩包。
 *
 * 注册表里的 `archivePath` 是**安装当时**的路径，之后可能：
 *   · 被 `archiveName` 规范命名搬走了（旧记录还指着老路径）；
 *   · 被用户手动删了 / 移到了别的盘；
 *   · 本来就是「本地压缩包导入」，压根不在 `library/` 里。
 * 所以这里**每次扫描都重新 stat 一遍**，把「在不在 / 在不在 library」如实报给界面 ——
 * 不能让界面拿一个不存在的路径去 `showItemInFolder`（那样只会静默什么都不发生）。
 *
 * 永不抛：注册表脏数据（空串、非法字符）也要能安全返回 null。
 */
function archiveInfo(archivePath) {
  const p = String(archivePath || '').trim();
  if (!p) return null;
  let inLibrary = false;
  try {
    const lib = path.resolve(paths.LIBRARY).toLowerCase() + path.sep;
    inLibrary = path.resolve(p).toLowerCase().startsWith(lib);
  } catch { /* 非法路径就当不在 library */ }
  let st = null;
  try { st = fs.statSync(p); } catch { /* 不存在 */ }
  return {
    path: p,
    name: path.basename(p),
    dir: path.dirname(p),
    inLibrary,
    exists: !!(st && st.isFile()),
    size: st && st.isFile() ? st.size : 0,
    mtime: st && st.isFile() ? st.mtime.toISOString() : null
  };
}

/**
 * 汇总：磁盘扫描 + 注册表元数据
 *
 * @param {string} root 游戏根目录
 * @param {object} registry 注册表实例
 * @param {object|null} [links] 「批量解析」得到的本地↔Nexus 关联（`linker.linkReader()`）。
 *        传 null / 不传 = 完全不改变现有行为（测试与老调用点不受影响）。
 */
function scan(root, registry, links = null) {
  const L = game.layout(root);
  const out = [];

  // 1) 前置组件（UE4SS 本体）
  const ue = game.inspect(root).ue4ss;
  if (ue.installed) {
    const reg = registry.get('builtin:ue4ss');
    out.push({
      id: 'builtin:ue4ss',
      name: 'UE4SS',
      nameZh: 'Mod 加载器（脚本注入运行时）',
      kind: 'prereq',
      enabled: true,
      files: [{ name: 'dwmapi.dll' }, { name: 'ue4ss/' }],
      fileCount: 2,
      size: ue.coreSize,
      mtime: ue.mtime,
      location: L.win64,
      registered: !!reg,
      url: 'https://github.com/Chrisr0/RE-UE4SS',
      meta: reg || null,
      builtin: true
    });
  }

  // 2) CNS（按特征文件确定性判定 + 注册表确证）
  //
  //    判定依据：`SB\Content\Paks\LogicMods\DekCNS_P.pak` 与
  //              `SB\Binaries\Win64\ue4ss\Mods\DekCNS\Scripts\main.lua` 两个核心特征
  //              （见 game.js 的 CNS_MARKERS）。两个都在 → 确证已装，不再需要免责声明。
  //    注册表：如果本程序亲手装过（source.modId 命中 CNS），用注册表里的 id，
  //            这样它和「已安装」列表里的条目是同一个对象，不会重复出现。
  const insp = game.inspect(root);
  const cnsReg = registry.all().find(r => r.source && Number(r.source.modId) === Number(prereqs.PREREQS.cns.modId));
  if (insp.cns.installed || cnsReg) {
    const reg = cnsReg || registry.get('builtin:cns');
    const cns = insp.cns;
    out.push({
      id: cnsReg ? cnsReg.id : 'builtin:cns',
      name: 'Custom Nanosuit System',
      nameZh: '自定义纳米战衣系统（服装框架）',
      kind: 'prereq',
      enabled: true,
      files: cns.found.map(m => ({ name: m.label, path: m.path, size: m.size })),
      fileCount: cns.found.reduce((s, m) => s + (m.isDir ? m.fileCount : 1), 0) || (reg && reg.fileCount) || 0,
      size: cns.found.reduce((s, m) => s + (m.size || 0), 0) || (reg && reg.size) || 0,
      mtime: (reg && reg.installedAt) || (cns.found[0] && cns.found[0].mtime) || null,
      location: L.sb,
      registered: !!reg,
      // 特征文件齐了就是确证；只有注册表而没有特征文件的情况标 false（文件可能被手动删了）
      confirmed: cns.installed,
      partial: cns.partial,
      note: cns.note,
      markers: cns.markers,
      url: 'https://www.nexusmods.com/stellarblade/mods/1496',
      meta: reg || null
    });
  }

  // 3) ~Mods 里的 pak mod
  //
  //    同一条注册表记录可能横跨多个 pak 基名 —— mod 4184「Blossom Butterfly Sexy JK Girl」
  //    就是「Breast and Hip_Physics」+「Kamenlaideng_Blossom Butterfly JK」两组文件，
  //    scanPaks 按基名会各出一条，id 却是同一条记录 → 界面上同一个 mod 出现两张卡。
  //    这里按 id 合回一张（文件取并集），「一套 Mod 一张卡」。
  const pakItems = [];
  const pakById = new Map();
  for (const m of scanPaks(L, registry)) {
    const prev = pakById.get(m.id);
    if (!prev) { pakById.set(m.id, m); pakItems.push(m); continue; }
    const names = new Set(prev.files.map(f => f.name));
    for (const f of m.files) {
      if (names.has(f.name)) continue;
      names.add(f.name);
      prev.files.push(f);
      prev.size += f.size || 0;
    }
    prev.fileCount = prev.files.length;
    prev.enabled = prev.enabled && m.enabled;
    if (m.mtime && (!prev.mtime || m.mtime > prev.mtime)) prev.mtime = m.mtime;
    if (m.cnsData) prev.cnsData = (prev.cnsData || []).concat(m.cnsData);
    if (m.partialDisabled) prev.partialDisabled = true;
  }
  out.push(...pakItems);

  // 4) UE4SS 脚本 mod
  //    跳过已被别的 mod（如 CNS）认领的目录，避免同一个 mod 出现两条
  const claimed = claimedScriptDirs(L, registry);
  out.push(...scanScriptMods(L, registry)
    .filter(m => !claimed.has(String(m.dir || '').toLowerCase())));

  // 5) 注册表登记、但磁盘扫描覆盖不到的（例如按框架包合并到 SB\ 的 mod）
  //
  //    ~Mods 与 ue4ss\Mods 之外的落点没有可靠的磁盘特征，只能靠注册表里的 manifest 认领。
  //    要求 manifest 里至少还有一个文件真实存在，避免把已被手动删掉的 mod 一直挂在列表里。
  //
  //    ⚠️ 前置组件**不能一概跳过**（0.2.10 修复；实测 mod 1662「Animation Tool (ATOOL)」
  //       装好之后浏览页不显示「已安装」）：
  //       上面 1)/2) 步只代表「落点有可靠特征」的两个框架 —— UE4SS 与 CNS。
  //       ATOOL 这类 LogicMod 框架落在 `SB\Content\Paks\LogicMods\`，①②③④ 步**都不扫它**，
  //       第 5) 步是唯一通路。旧代码在这里对所有 `prereqModIds` 一律 `continue`，
  //       于是 ATOOL 被两头排除：注册表里明明有记录、三件套也躺在 LogicMods\ 里，
  //       scan() 却一条都不返回 → 它永远进不了「已安装」。
  //       判据改成**按事实**：只有「这一轮已经有条目代表它了」才跳过（CNS 就是这种情况）。
  const seen = new Set(out.map(m => m.id));
  const prereqModIds = new Set(prereqs.all().filter(p => p.modId).map(p => Number(p.modId)));
  // 已经出现在 out 里的前置组件 modId（例如第 2) 步的 CNS）—— 它们不必再列一条
  const representedPrereqs = new Set(
    out.filter(m => m.meta && m.meta.source)
      .map(m => Number(m.meta.source.modId))
      .filter(id => id > 0)
  );
  // 同一 modId 的多条注册记录（作者更新后 fileId 变了、或用户先后装了互斥版本）
  // 指向的是**同一组落点文件**，逐条 push 会让「已安装」里冒出好几个同名条目。
  // 按「modId + 落点签名」去重，只留最近装的那条。
  // ⚠️ 只对**同一 modId** 去重：不同 mod 共用同一个 pak 文件名是真实存在的
  //    （`minervha_master_P` 那组被 4 个 mod 同时登记，见 `registry.byTargetAll` 的注释），
  //    那些必须各列一条，否则界面上就分不清文件到底属于谁了。
  const claimedTarget = new Map();          // `${modId}|${落点签名}` → 已 push 的注册表记录

  for (const reg of registry.all()) {
    if (seen.has(reg.id)) continue;
    if (/^builtin:/.test(reg.id)) continue;              // 前置组件已单独处理
    // 前置组件（如 CNS）已由第 2) 步代表，不再重复列一条
    if (reg.source && prereqModIds.has(Number(reg.source.modId))
      && representedPrereqs.has(Number(reg.source.modId))) continue;

    const entries = (reg.manifest || []).filter(f => f && f.path);
    const alive = entries.filter(f => {
      try { return fs.existsSync(f.path); } catch { return false; }
    });
    if (!alive.length) continue;

    // —— 同一 modId 的重复登记：落点签名相同就只留 installedAt 更晚的那条 ——
    const modId = reg.source && reg.source.modId != null ? Number(reg.source.modId) : 0;
    if (modId > 0) {
      const sig = modId + '|' + entries.map(f => String(f.path).toLowerCase()).sort().join('|');
      const prev = claimedTarget.get(sig);
      if (prev) {
        if (String(reg.installedAt || '') <= String(prev.installedAt || '')) continue;
        const at = out.findIndex(m => m.id === prev.id);   // 新的一条更晚 → 摘掉旧的那条
        if (at >= 0) out.splice(at, 1);
      }
      claimedTarget.set(sig, reg);
    }

    out.push({
      id: reg.id,
      name: reg.name || reg.id,
      kind: reg.kind || 'cns',
      enabled: reg.enabled !== false,
      files: alive.map(f => ({
        name: f.rel || path.basename(f.path),
        path: f.path,
        size: f.size || 0
      })),
      fileCount: alive.length,
      size: alive.reduce((s, f) => s + (f.size || 0), 0),
      mtime: reg.installedAt || null,
      location: reg.target || '',
      registered: true,
      meta: reg
    });
  }

  // 6) 统一补上「原始安装包」信息（在 library 里 / 还在不在）
  //    放在最后一遍，所有分支（pak / script / CNS / 仅注册表）都覆盖到，只写一处。
  for (const m of out) {
    const ap = m.meta && m.meta.archivePath;
    if (ap) m.archive = archiveInfo(ap);
  }

  // 7) 合并「批量解析」的结果（本地 pak/脚本目录 ↔ Nexus mod 的关联）
  //
  //    放在最后：它只往**没有注册表记录**的条目上补来源信息（`meta.source.modId`
  //    等），`registered` 保持 false —— 这些 mod 依然是「磁盘上发现的、不是本程序装的」，
  //    卸载/开关行为一点不变，只是界面上多了名字、封面、版本和 Nexus 链接。
  if (links) linker.applyToScanned(out, links);

  return out;
}

// scanPaks / scanScriptMods 只给测试用：想单测「条目带不带 tag」时不该非得有整个游戏目录
module.exports = {
  scan, parseModsTxt, claimedScriptDirs, UE4SS_BUILTIN, archiveInfo, scanPaks, scanScriptMods,
  // 暴露给探针 / 测试：CNS 伴随文件的匹配规则
  CNS_DATA, normStem, diceCoeff, CNS_MATCH_MIN
};
