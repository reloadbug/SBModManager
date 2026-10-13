'use strict';
const { readJson, writeJson } = require('./store');

/**
 * 已安装 Mod 注册表 —— 记录"由管理器安装"的 mod 的完整信息（含来源网址、说明、图片、文件清单）。
 * 磁盘上扫描到的、但不在注册表里的 mod 会以"未登记"状态展示，仍可管理。
 */
function createRegistry(file) {
  let db = readJson(file, { version: 1, mods: [] });
  if (!Array.isArray(db.mods)) db.mods = [];

  const save = () => writeJson(file, db);

  return {
    all: () => db.mods.map(m => ({ ...m })),
    get: (id) => db.mods.find(m => m.id === id) || null,
    /** 按落点文件反查：哪些磁盘条目属于已登记的 mod */
    byTarget: (targetPath) => db.mods.find(m =>
      (m.manifest || []).some(f => f.path.toLowerCase() === String(targetPath).toLowerCase())) || null,
    /**
     * 按落点文件反查**全部**登记者（不是只取第一个）。
     *
     * 为什么需要（实测，2026-10-13）：`minervha_master_P.pak/ucas/utoc` 这一组路径
     * 被 **4 个** mod（2675 / 2359 / 2705 / 2241）同时登记 —— 它们共用同一个 pak 文件名，
     * 后装的把先装的覆盖掉了，但注册表里 4 条记录都还在、都声称占着这个文件。
     * `byTarget` 用 `find` 只返回安装顺序上的第一个，界面就会错报「属于 A」，
     * 而实际上 B/C/D 也登记了它。用户要求「列出属于哪个 mod」，那就得列全。
     */
    byTargetAll: (targetPath) => {
      const key = String(targetPath).toLowerCase();
      return db.mods.filter(m => (m.manifest || []).some(f => f.path.toLowerCase() === key));
    },
    upsert(entry) {
      const i = db.mods.findIndex(m => m.id === entry.id);
      if (i >= 0) db.mods[i] = { ...db.mods[i], ...entry };
      else db.mods.push(entry);
      save();
      return entry;
    },
    remove(id) {
      const i = db.mods.findIndex(m => m.id === id);
      if (i >= 0) { const [r] = db.mods.splice(i, 1); save(); return r; }
      return null;
    },
    /** 合并磁盘扫描结果，仅补充元数据，不新增条目 */
    patch(id, patch) {
      const m = db.mods.find(x => x.id === id);
      if (!m) return null;
      Object.assign(m, patch);
      save();
      return m;
    },
    setEnabled(id, enabled) {
      const m = db.mods.find(x => x.id === id);
      if (!m) return null;
      m.enabled = !!enabled;
      save();
      return m;
    }
  };
}

module.exports = { createRegistry };
