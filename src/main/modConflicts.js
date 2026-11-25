/*
 * Mod 冲突检测（用户 2026-11-25）
 *
 * 用户的问题：
 *   1. 装新 Mod 前，能不能先看出它跟已装 Mod 撞车（两套衣服抢同一套模型 / 同一个 CNS 身份证）？
 *   2. 全局扫一遍已装 Mod，把所有冲突列出来，勾选后批量禁用或卸载。
 *
 * 判定依据（只读取证了磁盘上 140 个 .dekcns.json 得出的结论，别推翻）：
 *   - CNS 数据文件里 `UniqueFitID` 是衣服的「身份证」——两个 Mod 用同一个 ID 就是强冲突，
 *     必选留谁（游戏里两套衣服抢一个槽，必有其一不生效甚至崩）。
 *   - `OutfitPaths` 指向替换的游戏网格（如 CH_P_EVE_31_TypeB）——多个 Mod 替换同一个网格是
 *     提示级：磁盘实测有 3 组共享网格（CH_P_EVE_24×3 / CH_P_EVE_21×2 / CH_P_EVE_22×2），
 *     它们的 UniqueFitID 各不相同，本来就该共存，所以只提示、不拦截、不默认勾。
 *   - 文件名尾部的 `[nx<modId>]` 是**管理器**写进去的，游戏不认；这里只拿它认「这个文件属于谁」。
 *
 * 26 个 dekcns 文件带尾逗号（JSON5），必须宽松解析，不能因为一个文件坏掉就整轮失败。
 *
 * 本模块只做「读磁盘 → 给事实」，不改任何文件、不做禁用卸载（那是调用方的事）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const game = require('./game');
const installer = require('./installer');
const { isDisabledName } = require('./toggleName');

/** CNS 数据文件：双扩展名 .dekcns.json / .dekani.json，外加老包裸 .dekcns / .dekani（含关闭态） */
const DATA_FILE_RE = /\.(dekcns|dekani)(\.disabled\.json|\.json|\.disabled)?$/i;
const TAG_RE = /\[nx(\d{1,8})\]/i;

/**
 * 宽松解析 dekcns：先直接 JSON.parse，失败就去掉尾逗号再试。
 * 返回数组；认不出来返回 null（调用方跳过这一个文件，不中断整轮）。
 */
function parseLoose(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch { /* 落到尾逗号兜底 */ }
  // 去掉 `,]` `,}` 前的尾逗号（含空白）；用函数替换，避开 `$1` 被工具吞
  const fixed = s.replace(/,\s*([\]}])/g, (_all, close) => close);
  try {
    const v = JSON.parse(fixed);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 一条 OutfitPath → 网格名。
 * `/Game/OutfitMods/xxx/Models/CH_P_EVE_31_TypeB.CH_P_EVE_31_TypeB` → `CH_P_EVE_31_TypeB`
 */
function meshOf(outfitPath) {
  const s = String(outfitPath || '').trim();
  if (!s) return '';
  const leaf = s.slice(s.lastIndexOf('/') + 1);
  return leaf.split('.')[0].trim();
}

/**
 * 判断一个 CNS 数据文件属于哪个 Mod。三处来源，命中即止：
 *   ① 归属表（fileOwner.get，老包靠库比对补出来的）
 *   ② 文件名里的 [nx<id>]
 *   ③ 同主干 pak/ucas/utoc 的 [nx<id>]（dekcns 自己常不带标识，但同套 pak 带）
 * 认不出来返回 0（宁可跳过，也不瞎猜 modId）。
 */
function modIdOf(baseName, fileOwner, allNames) {
  const base = String(baseName || '');
  if (fileOwner && typeof fileOwner.get === 'function') {
    try {
      const owner = fileOwner.get(base);
      if (owner && Number(owner.modId)) return Number(owner.modId);
    } catch { /* 归属表坏了一条不影响 */ }
  }
  const direct = base.match(TAG_RE);
  if (direct) return Number(direct[1]);
  const stem = installer.stemOf(base);
  const list = Array.isArray(allNames) ? allNames : [];
  for (const other of list) {
    if (!/\.(pak|ucas|utoc)(\.disabled)?$/i.test(other)) continue;
    if (installer.stemOf(other) !== stem) continue;
    const m = String(other).match(TAG_RE);
    if (m) return Number(m[1]);
  }
  return 0;
}

/**
 * 扫一个目录下所有已装的 CNS 数据文件，按 modId 聚合成 Mod 记录。
 * @param {string} root 游戏根
 * @param {object} opts { modsDir, fileOwner }
 * @returns {Array<{modId,name,enabled,file,fits,meshes}>}
 */
function scanInstalled(root, opts = {}) {
  const modsDir = opts.modsDir || game.layout(root).modsDir;
  let names = [];
  try { names = fs.readdirSync(modsDir); } catch { return []; }
  const dataFiles = names.filter(n => DATA_FILE_RE.test(n));
  const byMod = new Map();

  for (const file of dataFiles) {
    let text;
    try { text = fs.readFileSync(path.join(modsDir, file), 'utf8'); } catch { continue; }
    const arr = parseLoose(text);
    if (!arr) continue;
    const modId = modIdOf(file, opts.fileOwner || null, names);
    if (!modId) continue;
    const enabled = !isDisabledName(file);

    if (!byMod.has(modId)) {
      byMod.set(modId, { modId, name: file, file, enabled, fits: [], meshes: [] });
    }
    const rec = byMod.get(modId);
    if (enabled) rec.enabled = true; // 同一 Mod 多个数据文件，任一开着就算启用

    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const fid = String(item.UniqueFitID || '').trim();
      const disp = String(item.DisplayName || item.Name || '').trim();
      const paths = Array.isArray(item.OutfitPaths)
        ? item.OutfitPaths.map(p => String(p || '').trim()).filter(Boolean)
        : [];
      const meshes = [];
      for (const p of paths) {
        const mesh = meshOf(p);
        if (mesh && meshes.indexOf(mesh) < 0) meshes.push(mesh);
      }
      rec.fits.push({ uniqueFitId: fid, displayName: disp, meshes });
      for (const mesh of meshes) {
        if (rec.meshes.indexOf(mesh) < 0) rec.meshes.push(mesh);
      }
    }
  }
  return Array.from(byMod.values());
}

/**
 * 从一组 Mod 记录里找冲突。
 * @param {Array} records scanInstalled() 的结果（也可以掺入「新包」记录做预检）
 * @returns {Array<{kind,level,key,label,mods}>} strong 在前，tip 在后
 */
function findConflicts(records) {
  const recs = Array.isArray(records) ? records : [];
  const groups = [];

  // ① UniqueFitID 撞车 —— 强冲突
  const fitMap = new Map();
  for (const r of recs) {
    for (const f of (r && r.fits) || []) {
      const fid = String((f && f.uniqueFitId) || '').trim();
      if (!fid) continue;
      if (!fitMap.has(fid)) fitMap.set(fid, new Set());
      fitMap.get(fid).add(r.modId);
    }
  }
  for (const [fid, ids] of fitMap) {
    if (ids.size < 2) continue;
    const involved = Array.from(ids).map(id => recs.find(r => r.modId === id)).filter(Boolean);
    groups.push({
      kind: 'uniqueFit',
      level: 'strong',
      key: fid,
      label: fid,
      mods: involved.map(r => {
        const fit = ((r.fits || []).find(f => f.uniqueFitId === fid)) || {};
        return {
          modId: r.modId,
          name: r.name || '',
          displayName: fit.displayName || '',
          enabled: !!r.enabled,
          meshes: fit.meshes || [],
          uniqueFitId: fid
        };
      })
    });
  }

  // ② 共享网格 —— 提示级（不拦截、不默认勾）
  const meshMap = new Map();
  for (const r of recs) {
    for (const mesh of (r && r.meshes) || []) {
      if (!mesh) continue;
      if (!meshMap.has(mesh)) meshMap.set(mesh, new Set());
      meshMap.get(mesh).add(r.modId);
    }
  }
  for (const [mesh, ids] of meshMap) {
    if (ids.size < 2) continue;
    const involved = Array.from(ids).map(id => recs.find(r => r.modId === id)).filter(Boolean);
    groups.push({
      kind: 'mesh',
      level: 'tip',
      key: mesh,
      label: mesh,
      mods: involved.map(r => ({
        modId: r.modId,
        name: r.name || '',
        enabled: !!r.enabled,
        uniqueFits: (r.fits || []).map(f => f.uniqueFitId).filter(Boolean)
      }))
    });
  }

  groups.sort((a, b) => (a.level === 'strong' ? 0 : 1) - (b.level === 'strong' ? 0 : 1));
  return groups;
}

/** 全局扫描的便捷入口 */
function scanAll(root, opts = {}) {
  const records = scanInstalled(root, opts);
  const conflicts = findConflicts(records);
  return {
    scannedMods: records.length,
    strong: conflicts.filter(g => g.level === 'strong').length,
    tips: conflicts.filter(g => g.level === 'tip').length,
    groups: conflicts
  };
}

/**
 * 从一份 dekcns 文本数组里抽出「游戏内名称 / UniqueFitID / 替换网格」。
 * 游戏的 DisplayName 就是 CNS 服装在游戏里的显示名（实测 255 个 dekcns 全有）；
 * OutfitNames 是变体名（"Outfit 01"…），不是 mod 名，绝不能用。
 *
 * 返回 { gameNames:[], uniqueFitIds:[], meshes:[] }（都去重）；认不出返回空结构。
 * 供「安装后解析实际写入的文件」与「回填已装 Mod」两处共用。
 */
function cnsMetaFromText(text) {
  const out = { gameNames: [], uniqueFitIds: [], meshes: [] };
  const arr = parseLoose(text);
  for (const item of arr || []) {
    if (!item || typeof item !== 'object') continue;
    const disp = String(item.DisplayName || item.Name || '').trim();
    if (disp && out.gameNames.indexOf(disp) < 0) out.gameNames.push(disp);
    const fid = String(item.UniqueFitID || '').trim();
    if (fid && out.uniqueFitIds.indexOf(fid) < 0) out.uniqueFitIds.push(fid);
    for (const p of (Array.isArray(item.OutfitPaths) ? item.OutfitPaths : [])) {
      const mesh = meshOf(p);
      if (mesh && out.meshes.indexOf(mesh) < 0) out.meshes.push(mesh);
    }
  }
  return out;
}

/**
 * 合并多份 dekcns 元数据（一个 Mod 常有多个数据文件 / 多个 DisplayName）。
 * 三处数组都做去重，顺序稳定（先来的在前）。
 */
function mergeCnsMeta(list) {
  const out = { gameNames: [], uniqueFitIds: [], meshes: [] };
  for (const m of (Array.isArray(list) ? list : [])) {
    if (!m) continue;
    for (const key of ['gameNames', 'uniqueFitIds', 'meshes']) {
      for (const v of (Array.isArray(m[key]) ? m[key] : [])) {
        const s = String(v || '').trim();
        if (s && out[key].indexOf(s) < 0) out[key].push(s);
      }
    }
  }
  return out;
}

/**
 * 扫游戏目录里所有已装 Mod 的 CNS 元数据，按 modId 聚合。
 * 复用 scanInstalled 的归属判定（fileOwner / [nx] / 同主干 pak），产出档案形状：
 *   { modId: { gameNames, uniqueFitIds, meshes } }
 * 只读取证，不改任何文件。回填脚本与 IPC 都用它。
 */
function scanCnsMeta(root, opts = {}) {
  const records = scanInstalled(root, opts);
  const out = {};
  for (const r of records) {
    if (!r || !Number(r.modId)) continue;
    const pieces = (r.fits || []).map(f => ({
      gameNames: [f.displayName].filter(Boolean),
      uniqueFitIds: [f.uniqueFitId].filter(Boolean),
      meshes: (f.meshes || []).slice()
    }));
    const merged = mergeCnsMeta(pieces);
    if (merged.gameNames.length || merged.uniqueFitIds.length || merged.meshes.length) {
      out[String(r.modId)] = merged;
    }
  }
  return out;
}

/**
 * 安装前预检：从安装包里只抽出 CNS 数据文件读它的 UniqueFitID / OutfitPaths，
 * 拼成一条「新包」记录，跟已装 Mod 一起比对。
 * @param {string} archivePath 安装包绝对路径
 * @param {object} meta {modId,name}
 * @param {object} installedRecords scanInstalled() 的结果
 * @param {object} opts {archive, os, path, fs} 便于探针注入
 * @returns {{incoming, conflicts}}
 */
function checkInstall(archivePath, meta, installedRecords, opts = {}) {
  const archiveMod = opts.archive || require('./archive');
  const fsMod = opts.fs || fs;
  const pathMod = opts.path || path;
  const osMod = opts.os || require('os');
  const modId = Number((meta && meta.modId) || 0);

  const result = { incoming: null, dekcns: 0, conflicts: [] };
  let entries = [];
  try { entries = ((archiveMod.listEntries(archivePath) || {}).entries) || []; } catch { return result; }
  const wanted = entries
    .map(e => String((e && e.path) || '').replace(/\\/g, '/'))
    .filter(p => DATA_FILE_RE.test(p));
  if (!wanted.length) return result;
  result.dekcns = wanted.length;

  const tmp = pathMod.join(osMod.tmpdir(), 'sb-conflict-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  try {
    fsMod.mkdirSync(tmp, { recursive: true });
    archiveMod.extract(archivePath, tmp, wanted);
    const fits = [];
    const meshes = [];
    for (const rel of wanted) {
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      let text;
      try { text = fsMod.readFileSync(pathMod.join(tmp, rel), 'utf8'); } catch { continue; }
      const arr = parseLoose(text);
      for (const item of arr || []) {
        if (!item || typeof item !== 'object') continue;
        const fid = String(item.UniqueFitID || '').trim();
        const disp = String(item.DisplayName || item.Name || '').trim();
        const ms = [];
        for (const p of (Array.isArray(item.OutfitPaths) ? item.OutfitPaths : [])) {
          const mesh = meshOf(p);
          if (mesh && ms.indexOf(mesh) < 0) ms.push(mesh);
        }
        fits.push({ uniqueFitId: fid, displayName: disp, meshes: ms });
        for (const mesh of ms) if (meshes.indexOf(mesh) < 0) meshes.push(mesh);
      }
    }
    const incoming = {
      modId: modId || -1,
      name: (meta && meta.name) || pathMod.basename(archivePath),
      file: '', enabled: true, fits, meshes, incoming: true
    };
    result.incoming = incoming;
    const all = (Array.isArray(installedRecords) ? installedRecords : []).slice();
    // 自己已装版本不算冲突（重装覆盖自己）
    const filtered = all.filter(r => r.modId !== modId);
    filtered.push(incoming);
    result.conflicts = findConflicts(filtered).filter(g => g.mods.some(m => m.modId === incoming.modId));
  } finally {
    try { fsMod.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录删不掉不影响 */ }
  }
  return result;
}

module.exports = {
  DATA_FILE_RE,
  TAG_RE,
  parseLoose,
  meshOf,
  modIdOf,
  scanInstalled,
  findConflicts,
  scanAll,
  checkInstall,
  cnsMetaFromText,
  mergeCnsMeta,
  scanCnsMeta
};
