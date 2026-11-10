'use strict';
const { readJson, writeJson } = require('./store');

/**
 * 「这个 Mod 我实测过，能用」标记 —— 用户 2026-11-10 要求：
 * 「增加一个标记 已验证，实际测试好用的 mod 用户可以标记为已验证；
 *   也就是说从标记 mod 的角度，用户可以点赞和不喜欢、有 bug / 通过验证 / 未验证」
 *
 * 和「有 bug」是同一类的**个人实测结论**，不是 Nexus 上的评分：
 *   · 有 bug  = 装进去会出事，批量安装前要拦一下；
 *   · 已验证 = 我确认真能跑，可以放心用 / 推荐给别人的那一批。
 * 两者可以并存（一个 Mod 既可能被标 bug、也可能某天修好被我改标成已验证），
 * 因此界面上的「已验证 / 未验证」两颗筛选 chip 互斥，但和 bug 标记互不影响。
 *
 * ⚠️ 关联键只有 Nexus modId（与 blacklist / bugFlag / localState 同一口径）：
 *    手动丢进 `~Mods`、没有来源信息的包没有 modId，标不了（它本来也没有
 *    「下载 → 安装」这条路可拦，不算缺口）。
 *
 * ⚠️ 文件是 `verified.json`，属于 `paths.STATE_NAMES`：会跟着游戏走
 *    （镜像进 `<游戏根>\.sbmod\`），换机器搬游戏时标记不会丢。
 */
function createVerified(file) {
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
     * 标记为「已验证」。**幂等** —— 重复标记只更新说明，不产生第二条，
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
      if (i >= 0) db.mods[i] = entry; else db.mods.push(entry);
      save();
      return { ...entry };
    },

    remove: (id) => {
      const mid = norm(id);
      const before = db.mods.length;
      db.mods = db.mods.filter(m => Number(m.modId) !== mid);
      if (db.mods.length !== before) save();
      return before - db.mods.length;
    },

    clear: () => { db.mods = []; save(); return true; }
  };
}

module.exports = { createVerified };
