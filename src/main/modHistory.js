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

    /**
     * 按 Nexus modId 聚合出的「当前状态」（详情 / 排序 / 时间段筛选按它认人）。
     *
     * 同一个 Mod 的记录可能同时存在于两条 id 上（未登记的 `disk:paks:...` +
     * 补登记后的 `nexus:<id>:0`），各自记着一半的开关流水。这里按 modId 把
     * **所有事件的最后一次** fold 成一份当前状态：enabled 取最新一条开关事件的
     * 结论，enabledAt / disabledAt 取各自最新时刻，所以「disk 上禁用、nexus 上启用」
     * 也能正确显示成「已启用 · 开启时间=nexus 那次」。
     * @returns {Record<string, {modId,name,enabled,enabledAt,disabledAt,enabledAtGuess,downloadedAt,installedAt,uninstalledAt,at}>}
     */
    statesByModId() {
      const out = {};
      for (const e of db.events) {
        const mid = Number(e.modId) || 0;
        if (!mid) continue;
        const k = String(mid);
        const rec = out[k] || { modId: mid, name: '', enabled: false, enabledAt: '', disabledAt: '', enabledAtGuess: false, at: '' };
        if (e.name) rec.name = e.name;
        if (e.at > rec.at) rec.at = e.at;
        if (e.action === 'enable') { rec.enabled = true; rec.enabledAt = e.at; rec.enabledAtGuess = false; }
        else if (e.action === 'backfill') { rec.enabled = true; if (!rec.enabledAt || e.at > rec.enabledAt) { rec.enabledAt = e.at; rec.enabledAtGuess = true; } }
        else if (e.action === 'disable') { rec.enabled = false; rec.disabledAt = e.at; }
        else if (e.action === 'download') rec.downloadedAt = e.at;
        else if (e.action === 'install') rec.installedAt = e.at;
        else if (e.action === 'uninstall') { rec.enabled = false; rec.uninstalledAt = e.at; }
        out[k] = rec;
      }
      return out;
    },

    /** 单个 mod 的当前状态 */
    mod: (id) => { const m = db.mods[keyOf(id)]; return m ? { ...m } : null; },

    /** 某 mod 的事件流水（新→旧）—— 按扫描条目稳定 id 精确匹配 */
    forMod: (id, limit) => {
      const k = keyOf(id);
      return db.events.filter(e => e.id === k).slice(-(Math.max(1, Number(limit) || 200)))
        .reverse().map(e => ({ ...e }));
    },

    /**
     * 按 Nexus modId 取事件流水（新→旧）—— 详情「状态变更记录」用。
     *
     * 为什么不能只用 forMod(id)：同一个 Mod 的事件会散落在两套 id 上 ——
     *   未登记时开关记在 `disk:paks:xxx [nx<id>]`（稳定 id），
     *   补登记/关联之后开关又记在 `nexus:<id>:0`（虚拟 id）。
     * 按 modId 聚合才能把「禁用（disk）+ 启用（nexus）」串成一条完整时间线。
     */
    forModId: (modId, limit) => {
      const mid = Number(modId) || 0;
      if (!mid) return [];
      return db.events.filter(e => Number(e.modId) === mid)
        .slice(-(Math.max(1, Number(limit) || 200)))
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
      // 每条回填时间逐个错开 1ms —— 整批共用同一时间戳时排序会全部撞车
      // （用户 2026-11-25：「所有的时间记录都要精确到毫秒，否则排序时都是一样的秒数」）。
      let stampMs = Date.now();
      let n = 0;
      for (const it of (Array.isArray(items) ? items : [])) {
        const id = keyOf(it && it.id);
        if (!id) continue;
        const rec = db.mods[id];
        if (rec && rec.enabledAt) continue;              // 已有时间（真实或回填过）都不动
        if (it.enabled === false) continue;              // 关着的不补"开启时间"
        const stamp = new Date(stampMs++).toISOString(); // 每条独立、递增 1ms
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
