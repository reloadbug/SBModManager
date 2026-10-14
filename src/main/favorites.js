'use strict';
const { readJson, writeJson } = require('./store');

/**
 * 浏览页「喜欢」—— 用户点了 👍 的 mod。
 *
 * 与 `blacklist.js`（👎）**完全对称**，刻意保持同一个形状：
 *   · 关联键只有 Nexus modId（与 `localState.js` / `blacklist.js` 同一口径）；
 *   · `add()` 幂等，重复点只更新时间戳、保留原 `at`；
 *   · 记下 name / author / thumbnail，好让「只看喜欢」视图**离线渲染**（零网络请求）。
 *
 * 为什么不合并成一个文件、加个 `kind: 'liked' | 'blocked'` 字段：
 * 两者语义相反（一个是隐藏、一个是收藏），将来的行为会分叉
 * （比如「喜欢」可能要同步到 Nexus 收藏夹，「黑名单」永远不会）。
 * 现在共用一个文件反而会在分叉时被迫做数据迁移。
 */
function createFavorites(file) {
  let db = readJson(file, { version: 1, mods: [] });
  if (!Array.isArray(db.mods)) db.mods = [];

  const save = () => writeJson(file, db);
  const norm = (id) => Number(id) || 0;

  return {
    /** 全部记录（按加入时间倒序 —— 最近喜欢的排前面） */
    all: () => db.mods
      .map(m => ({ ...m }))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),

    /** 只有 modId 的数组（渲染层拿去建 Set） */
    ids: () => db.mods.map(m => Number(m.modId)).filter(Boolean),

    has: (id) => db.mods.some(m => Number(m.modId) === norm(id)),

    count: () => db.mods.length,

    /**
     * 加入喜欢。**幂等** —— 重复点只更新时间戳，不产生第二条；
     * 已有记录时保留原 `at`（「什么时候喜欢的」不该被重复点击刷新）。
     * @returns {object|null} 记录；modId 非法时返回 null
     */
    add(id, meta = {}) {
      const mid = norm(id);
      if (!mid) return null;
      const i = db.mods.findIndex(m => Number(m.modId) === mid);
      const prev = i >= 0 ? db.mods[i] : null;
      const entry = {
        modId: mid,
        name: (meta.name || (prev && prev.name) || '').toString(),
        author: (meta.author || (prev && prev.author) || null) || null,
        thumbnail: (meta.thumbnail || (prev && prev.thumbnail) || null) || null,
        at: (prev && prev.at) || new Date().toISOString()
      };
      if (i >= 0) db.mods[i] = entry;
      else db.mods.push(entry);
      save();
      return entry;
    },

    /** 取消喜欢（不在名单里返回 null，不抛） */
    remove(id) {
      const mid = norm(id);
      const i = db.mods.findIndex(m => Number(m.modId) === mid);
      if (i < 0) return null;
      const [r] = db.mods.splice(i, 1);
      save();
      return r;
    },

    /** 清空（设置页用） */
    clear() {
      const n = db.mods.length;
      db.mods = [];
      save();
      return n;
    }
  };
}

module.exports = { createFavorites };
