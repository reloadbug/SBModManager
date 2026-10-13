'use strict';
const fs = require('fs');
const path = require('path');
const game = require('./game');
const prereqs = require('./prereqs');
const paths = require('./paths');

/** UE4SS 自带的脚本 mod（不算用户安装的） */
const UE4SS_BUILTIN = new Set([
  'ActorDumperMod', 'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod',
  'ConsoleCommandsMod', 'ConsoleEnablerMod', 'jsbLuaProfilerMod', 'Keybinds',
  'LineTraceMod', 'SplitScreenMod', 'shared'
]);

const PAK_EXT = /\.(pak|ucas|utoc)$/i;

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

/** 扫描 ~Mods：按基名分组（一个 mod 可能由 .pak + .ucas + .utoc 多个文件组成） */
function scanPaks(L, registry) {
  let entries = [];
  try {
    entries = fs.readdirSync(L.modsDir, { withFileTypes: true }).filter(e => e.isFile());
  } catch {
    return [];
  }

  const groups = new Map();
  for (const e of entries) {
    const name = e.name;
    const disabled = /\.disabled$/i.test(name);
    const base = name.replace(/\.disabled$/i, '');
    if (!PAK_EXT.test(base)) continue;
    const key = base.replace(PAK_EXT, '');

    if (!groups.has(key)) {
      groups.set(key, { key, name: key, kind: 'pak', enabled: true, files: [], size: 0, mtime: null });
    }
    const g = groups.get(key);
    let st = null;
    try { st = fs.statSync(path.join(L.modsDir, name)); } catch { /* 忽略 */ }
    g.files.push({ name, disabled, size: st ? st.size : 0, mtime: st ? st.mtime.toISOString() : null });
    g.size += st ? st.size : 0;
    if (!g.mtime || (st && st.mtime.toISOString() > g.mtime)) g.mtime = st ? st.mtime.toISOString() : g.mtime;
    if (disabled) g.enabled = false;
  }

  return [...groups.values()].map(g => {
    const target = path.join(L.modsDir, g.files[0].name);
    const reg = registry.byTarget(target) || registry.get('disk:paks:' + g.key);
    return {
      id: reg ? reg.id : 'disk:paks:' + g.key,
      name: reg && reg.name ? reg.name : g.name,
      kind: 'pak',
      enabled: g.enabled,
      files: g.files,
      fileCount: g.files.length,
      size: g.size,
      mtime: g.mtime,
      location: L.modsDir,
      registered: !!reg,
      meta: reg || null
    };
  });
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

/** 汇总：磁盘扫描 + 注册表元数据 */
function scan(root, registry) {
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
  out.push(...scanPaks(L, registry));

  // 4) UE4SS 脚本 mod
  //    跳过已被别的 mod（如 CNS）认领的目录，避免同一个 mod 出现两条
  const claimed = claimedScriptDirs(L, registry);
  out.push(...scanScriptMods(L, registry)
    .filter(m => !claimed.has(String(m.dir || '').toLowerCase())));

  // 5) 注册表登记、但磁盘扫描覆盖不到的（例如按框架包合并到 SB\ 的 mod）
  //
  //    ~Mods 与 ue4ss\Mods 之外的落点没有可靠的磁盘特征，只能靠注册表里的 manifest 认领。
  //    要求 manifest 里至少还有一个文件真实存在，避免把已被手动删掉的 mod 一直挂在列表里。
  const seen = new Set(out.map(m => m.id));
  const prereqModIds = new Set(prereqs.all().filter(p => p.modId).map(p => Number(p.modId)));
  for (const reg of registry.all()) {
    if (seen.has(reg.id)) continue;
    if (/^builtin:/.test(reg.id)) continue;              // 前置组件已单独处理
    // 前置组件（如 CNS）已由第 2) 步代表，不再重复列一条
    if (reg.source && prereqModIds.has(Number(reg.source.modId))) continue;

    const alive = (reg.manifest || []).filter(f => {
      try { return fs.existsSync(f.path); } catch { return false; }
    });
    if (!alive.length) continue;

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

  return out;
}

module.exports = { scan, parseModsTxt, claimedScriptDirs, UE4SS_BUILTIN, archiveInfo };
