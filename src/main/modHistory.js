'use strict';
const { readJson, writeJson } = require('./store');

/**
 * Mod 生命周期事件档案 —— 用户 2026-11-24 要求：
 *   「要完整记录全部过程，mod下载、安装、开启、禁用，都要保留可以查的日志……
 *     提供回退到某个时间点mod状态的能力……之前数据不完整就算了，之后的数据都要补充完整」
 *
 * 和 registry（只记"由管理器安装的 mod"的最终状态）不一样：
 *   · registry 只有已登记条目，用户大量手动丢进 ~Mods 的未登记 mod 都没有时间记录；
 *   · 本档案按**扫描条目的稳定 id** 记键（未登记 pak = `disk:paks:<key>`，
 *     开关改名不改变 key），所以未登记 mod 也有完整的开关流水。
 *
 * 两份数据并存：
 *   · `events`：追加式事件流水（下载/安装/开启/禁用/卸载/回填），只留最近 MAX_EVENTS 条；
 *   · `mods` ：每个 mod 的当前状态与关键时刻（首次/最近启用、最近禁用…），
 *     给排序、详情、时间段筛选直接读，不用每次扫事件数组。
 *
 * ⚠️ 文件是 `mod-history.json`，属于 `paths.STATE_NAMES`：跟着游戏走
 *    （镜像进 `<游戏根>\.sbmod\`），删 Mod 文件**不删**这里的记录 ——
 *    用户明确要求「删文件不等于删用户数据」。
 */
const MAX_EVENTS = 5000;
const ACTIONS = new Set(['download', 'install', 'enable', 'disable', 'uninstall', 'backfill']);

function createModHistory(file) {
  let db = readJson(file, { version: 1, events: [], mods: {} });
  if (!Array.isArray(db.events)) db.events = [];
  if (!db.mods || typeof db.mods !== 'object' || Array.isArray(db.mods)) db.mods = {};

  const save = () => writeJson(file, db);
  const now = () => new Date().toISOString();
  const keyOf = (id) => String(id == null ? '' : id).trim();
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

  function touch(id, patch) {
    const k = keyOf(id);
    if (!k) return null;
    const prev = db.mods[k] || { id: k };
    db.mods[k] = { ...prev, ...patch, at: patch.at || prev.at || now() };
    return { ...db.mods[k] };
  }

  /** 追加一条事件并更新该 mod 的当前状态（内部复用） */
  function add(action, info = {}) {
    const act = String(action || '').toLowerCase();
    if (!ACTIONS.has(act)) return null;
    const id = keyOf(info.id);
    if (!id) return null;
    const at = info.at || now();
    const event = {
      at,
      action: act,
      id,
      modId: Number(info.modId) || 0,
      name: clip(info.name, 300),
      detail: clip(info.detail, 500)
    };
    db.events.push(event);
    if (db.events.length > MAX_EVENTS) db.events.splice(0, db.events.length - MAX_EVENTS);

    const patch = { id };
    if (event.modId) patch.modId = event.modId;
    if (event.name) patch.name = event.name;
    if (act === 'download') patch.downloadedAt = at;
    if (act === 'install') patch.installedAt = at;
    if (act === 'enable') { patch.enabled = true; patch.enabledAt = at; patch.enabledAtGuess = false; }
    if (act === 'disable') { patch.enabled = false; patch.disabledAt = at; }
    if (act === 'uninstall') { patch.enabled = false; patch.uninstalledAt = at; }
    if (act === 'backfill') { patch.enabled = true; patch.enabledAt = at; patch.enabledAtGuess = true; }

    const rec = touch(id, { ...patch, at });
    save();
    return { ...event, record: rec };
  }

  return {
    /** 全部事件（新→旧） */
    all: (limit) => {
      const cut = Math.max(1, Number(limit) || MAX_EVENTS);
      return db.events.slice(-cut).reverse().map(e => ({ ...e }));
    },

    /**
     * 按条件筛事件（时间回退 / 日志搜索都走这里）。
     * @param opts {action,id,modId,since,until,keyword,limit}
     *   since/until 是 ISO 字符串（字典序即时间序）；
     *   keyword 在 name/detail/modId 上做大小写不敏感的子串匹配。
     */
    events(opts = {}) {
      const action = opts.action ? String(opts.action) : '';
      const id = keyOf(opts.id);
      const modId = Number(opts.modId) || 0;
      const since = opts.since ? String(opts.since) : '';
      const until = opts.until ? String(opts.until) : '';
      const kw = String(opts.keyword || '').trim().toLowerCase();
      let list = db.events;
      if (action || id || modId || since || until || kw) {
        list = list.filter(e => {
          if (action && e.action !== action) return false;
          if (id && e.id !== id) return false;
          if (modId && Number(e.modId) !== modId) return false;
          if (since && String(e.at) < since) return false;
          if (until && String(e.at) > until) return false;
          if (kw && !(String(e.name || '') + ' ' + String(e.detail || '') + ' ' + String(e.modId || ''))
            .toLowerCase().includes(kw)) return false;
          return true;
        });
      }
      const cut = Math.max(1, Number(opts.limit) || 500);
      return list.slice(-cut).reverse().map(e => ({ ...e }));
    },

    /** 所有 mod 的当前状态（数组） */
    mods: () => Object.values(db.mods).map(m => ({ ...m })),

    /** 单个 mod 的当前状态 */
    mod: (id) => { const m = db.mods[keyOf(id)]; return m ? { ...m } : null; },

    /** 某 mod 的事件流水（新→旧） */
    forMod: (id, limit) => {
      const k = keyOf(id);
      return db.events.filter(e => e.id === k).slice(-(Math.max(1, Number(limit) || 200)))
        .reverse().map(e => ({ ...e }));
    },

    add,

    /**
     * 时间回填：把「当前启用、但没有开启时间」的 mod 填上现在时刻，
     * 并标 `enabledAtGuess:true`（界面可据此注明「时间是补的」）。
     * 已有开启时间（不管真实还是回填过的）都不动 —— 用户说「之前不完整就算了」，
     * 而且回填过一次就该稳定下来，不能每次启动都刷新成新时间。
     * @param items [{id, modId, name, enabled}]
     * @returns 回填条数
     */
    backfill(items) {
      const stamp = now();
      let n = 0;
      for (const it of (Array.isArray(items) ? items : [])) {
        const id = keyOf(it && it.id);
        if (!id) continue;
        const rec = db.mods[id];
        if (rec && rec.enabledAt) continue;              // 已有时间（真实或回填过）都不动
        if (it.enabled === false) continue;              // 关着的不补"开启时间"
        // 直接改内存 + 记一条回填事件（不调用 add()，避免每条都整文件写盘）
        db.events.push({
          at: stamp, action: 'backfill', id,
          modId: Number(it.modId) || 0,
          name: clip(it.name, 300),
          detail: '开启时间回填（原本为空）'
        });
        db.mods[id] = {
          ...(rec || { id }),
          id,
          modId: Number(it.modId) || (rec && rec.modId) || 0,
          name: clip(it.name, 300) || (rec && rec.name) || '',
          enabled: true,
          enabledAt: stamp,
          enabledAtGuess: true,
          at: stamp
        };
        n++;
      }
      if (db.events.length > MAX_EVENTS) db.events.splice(0, db.events.length - MAX_EVENTS);
      if (n) save();                                     // 整批只写一次盘
      return n;
    },

    /** 时间段内新开启过的 mod（去重，取区间内最早一次 enable 的时刻） */
    enabledBetween(since, until) {
      const s = since ? String(since) : '';
      const u = until ? String(until) : '';
      const found = new Map();
      for (const e of db.events) {
        if (e.action !== 'enable' && e.action !== 'backfill') continue;
        if (s && String(e.at) < s) continue;
        if (u && String(e.at) > u) continue;
        const prev = found.get(e.id);
        if (!prev || String(e.at) < prev.at) found.set(e.id, { id: e.id, at: e.at, modId: e.modId, name: e.name });
      }
      return [...found.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },

    /** 清空（设置页「清除历史」用；不影响用户标记） */
    clear() { const n = db.events.length; db.events = []; db.mods = {}; save(); return n; },

    /** 档案文件路径（调试/日志用） */
    file: () => file
  };
}

module.exports = { createModHistory, MAX_EVENTS, ACTIONS };
