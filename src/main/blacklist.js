'use strict';
const { readJson, writeJson } = require('./store');

/**
 * 浏览页「黑名单」—— 用户点了「不喜欢」的 mod。
 *
 * 为什么存本地而不是同步到 Nexus：Nexus 没有「屏蔽某个 mod」的接口，
 * 而且用户要的是**立刻生效**（点完卡片马上消失），走网络往返体验反而差。
 *
 * ⚠️ 关联键**只有 Nexus modId**（与 `localState.js` 同一口径）。
 *    手动丢进 `~Mods` 的 pak 没有 modId，关联不上，也就谈不上拉黑。
 *
 * ⚠️ `add()` 会把 name / author / thumbnail **一起记下来** ——
 *    「只看黑名单」视图据此**离线渲染卡片**（零网络请求，秒开）。
 *    否则要翻遍 3000+ 个 mod 才能凑出黑名单里那几条，慢到没法用。
 */
function createBlacklist(file) {
  let db = readJson(file, { version: 1, mods: [] });
  if (!Array.isArray(db.mods)) db.mods = [];

  const save = () => writeJson(file, db);
  const norm = (id) => Number(id) || 0;

  return {
    /** 全部记录（按加入时间倒序 —— 最近拉黑的排前面） */
    all: () => db.mods
      .map(m => ({ ...m }))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),

    /** 只有 modId 的数组（渲染层拿去建 Set） */
    ids: () => db.mods.map(m => Number(m.modId)).filter(Boolean),

    has: (id) => db.mods.some(m => Number(m.modId) === norm(id)),

    count: () => db.mods.length,

    /**
     * 加入黑名单。**幂等** —— 重复点「不喜欢」只更新时间戳，不产生第二条。
     * 已有记录时保留原 `at`（「什么时候拉黑的」不该被重复点击刷新）。
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

    /** 移出黑名单（不在名单里返回 null，不抛） */
    remove(id) {
      const mid = norm(id);
      const i = db.mods.findIndex(m => Number(m.modId) === mid);
      if (i < 0) return null;
      const [r] = db.mods.splice(i, 1);
      save();
      return r;
    },

    /** 清空（设置页「清空黑名单」用） */
    clear() {
      const n = db.mods.length;
      db.mods = [];
      save();
      return n;
    }
  };
}

module.exports = { createBlacklist };
