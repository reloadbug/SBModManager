'use strict';
const { readJson, writeJson } = require('./store');

/**
 * 「这个 Mod 有 bug」标记 —— 用户装完发现把游戏搞坏了，卸载时顺手打一个记号。
 *
 * 和 `blacklist.js`（浏览页的「不喜欢」）是**两件事**，不要合并：
 *   · 黑名单 = 「不想再看见它」，浏览页直接不显示；
 *   · bug 标记 = 「它还值得看（也许哪天作者修了）」，但要**防着别再装进去**。
 *     所以浏览页照常显示，只在安装路径上拦一道。
 *
 * ⚠️ 关联键只有 Nexus modId（与 blacklist / localState 同一口径）。
 *    手动丢进 `~Mods`、没有来源信息的包没有 modId，标记不了 —— 也没有第二次
 *    「安装」的机会可拦（它本来就是手放的），所以不算缺口。
 *
 * ⚠️ 文件是 `bugs.json`，属于 `paths.STATE_NAMES`：会跟着游戏走（镜像进
 *    `<游戏根>\.sbmod\`），换机器搬游戏时标记不会丢。
 */
function createBugFlags(file) {
  let db = readJson(file, { version: 1, mods: [] });
  if (!Array.isArray(db.mods)) db.mods = [];

  const save = () => writeJson(file, db);
  const norm = (id) => Number(id) || 0;

  return {
    /** 全部记录（最近标记的排前面） */
    all: () => db.mods
      .map(m => ({ ...m }))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),

    /** 只有 modId 的数组（渲染层拿去建 Set） */
    ids: () => db.mods.map(m => Number(m.modId)).filter(Boolean),

    has: (id) => db.mods.some(m => Number(m.modId) === norm(id)),

    get: (id) => db.mods.find(m => Number(m.modId) === norm(id)) || null,

    count: () => db.mods.length,

    /**
     * 标记为有 bug。**幂等** —— 重复标只更新说明，不产生第二条，
     * 也不刷新 `at`（「什么时候标的」不该被重复点击改掉）。
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
        note: (meta.note || (prev && prev.note) || '').toString(),
        at: (prev && prev.at) || new Date().toISOString()
      };
      if (i >= 0) db.mods[i] = entry;
      else db.mods.push(entry);
      save();
      return entry;
    },

    /** 取消标记（不在名单里返回 null，不抛） */
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

module.exports = { createBugFlags };
