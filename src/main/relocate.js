'use strict';
const fs = require('fs');
const path = require('path');

/**
 * 游戏目录搬移（换盘 / 换路径）—— 让已安装账本跟着游戏走。
 *
 * 为什么需要这个模块（用户实测，2026-11-07）：
 *   用户把整个 `D:\games\Star Blade` 挪到 `c:\Star Blade`，注册表里 324 条记录
 *   的文件清单还写着 `D:\games\Star Blade\...`，于是扫描时按落点反查全部落空 ——
 *   已安装页 429 项全部退化成「未登记」，来源、版本、封面、Nexus 链接一夜全丢。
 *   注册表本身没问题，问题只在「绝对路径被钉死在某个盘上」。
 *
 * 三条设计取舍：
 *
 *   1) **路径能不能还原，靠的是相对路径，不是猜名字。**
 *      注册表里每条 manifest 都有 `rel`（相对落点目录），落点 `target` 又总能
 *      还原成「游戏根 + 一段固定尾巴」。所以搬移后新路径 = 新根 + 原尾巴 + rel，
 *      这是**精确重建**，不需要模糊匹配，也不会把 A mod 认成 B mod。
 *
 *   2) **只改文件真在那儿的条目。**
 *      重建出来的路径必须 `exists()` 通过才写回；否则这一条原样不动、记进 missing，
 *      留给用户看。宁可少改，不能把记录改成指向空处 —— 那才是真的把账本弄坏。
 *
 *   3) **账本额外存一份到游戏目录里（`<游戏根>\.sbmod\ledger.json`）。**
 *      这样「整个游戏文件夹拷到别的机器/别的盘」时，账本跟着走；
 *      管理器自己的 `data/mods.json` 丢了也能从这份恢复。两份都只存相对路径，
 *      所以复制到哪都能重建。
 */

/** 落点尾巴：`target` 去掉这几段之后剩下的就是游戏根 */
const TAIL_SEGS = [
  ['SB', 'Content', 'Paks', '~Mods'],
  ['SB', 'Content', 'Paks', 'LogicMods'],
  ['SB', 'Binaries', 'Win64', 'ue4ss', 'Mods'],
  // ATOOL 的动画包会落在 ~Mods，但它的本体目录是 ue4ss\Mods\<名>，上面那条已覆盖。
];

/** 账本在游戏目录里的位置（刻意放在游戏根，不在 ~Mods —— 免得被当成 mod 扫进来） */
const LEDGER_DIR = '.sbmod';
const LEDGER_NAME = 'ledger.json';
const LEDGER_VERSION = 1;

function winOf(p) {
  return String(p == null ? '' : p).replace(/\//g, '\\');
}

function lowerOf(p) {
  return winOf(p).toLowerCase().replace(/\\+$/, '');
}

function samePath(a, b) {
  return lowerOf(a) === lowerOf(b);
}

/** 把 target 拆成「游戏根 + 尾巴」。认不出尾巴时 root 为空（调用方再决定怎么办） */
function splitTarget(target) {
  const p = winOf(target).replace(/\\+$/, '');
  const low = p.toLowerCase();
  let best = null;
  for (const segs of TAIL_SEGS) {
    // ⚠️ 两边都得小写再比：`low` 是小写的，needle 忘了转小写就永远找不到
    const needle = ('\\' + segs.join('\\')).toLowerCase();
    const at = low.lastIndexOf(needle);
    if (at > 0) {
      // `ue4ss\Mods\<目录名>` 这种尾巴后面还有一段，取最深的那次出现即可
      if (!best || at > best.at) best = { at, tail: p.slice(at + 1) };
    }
  }
  if (best) return { root: p.slice(0, best.at), tail: best.tail };
  return { root: '', tail: '' };
}

/**
 * 这一条记录当年装在哪个游戏根。
 *
 * 两种形态（实测都出现过）：
 *   · 常规：`target` 是 `...\SB\Content\Paks\~Mods`，`rel` 是裸文件名 → 剥尾巴得根；
 *   · 前置（CNS 那种铺满整个游戏目录的）：`target` 直接是游戏根，`rel` 从 `SB\` 起头。
 */
function rootOfEntry(entry) {
  const target = (entry && entry.target) || '';
  const rels = ((entry && entry.manifest) || []).map(f => winOf(f && f.rel)).filter(Boolean);
  const rootish = rels.length > 0 && rels.every(r => /^sb\\/i.test(r));
  if (rootish) return winOf(target).replace(/\\+$/, '');
  const split = splitTarget(target);
  if (split.root) return split.root;
  // 尾巴都认不出来的老记录：只能按第一条文件反推（path 去掉 rel）
  const f = ((entry && entry.manifest) || [])[0];
  if (!f || !f.path || !f.rel) return '';
  const p = winOf(f.path);
  const r = winOf(f.rel);
  if (!lowerOf(p).endsWith(lowerOf(r))) return '';
  return p.slice(0, p.length - r.length).replace(/\\+$/, '');
}

/** 多数表决：这批记录整体认为自己在哪个游戏根（少数派当脏数据） */
function detectRoot(entries) {
  const votes = new Map();
  for (const e of entries || []) {
    const root = rootOfEntry(e);
    if (!root) continue;
    const key = root.toLowerCase();
    const cur = votes.get(key);
    if (cur) cur.n += 1;
    else votes.set(key, { root, n: 1 });
  }
  let best = null;
  for (const v of votes.values()) if (!best || v.n > best.n) best = v;
  return best ? best.root : '';
}

/**
 * 试算：把 entries 从它们的旧根迁到 newRoot。
 *
 * @param {Array} entries 注册表条目
 * @param {string} newRoot 当前游戏根（绝对路径）
 * @param {(p:string)=>boolean} exists 可注入（测试用）
 * @returns {{oldRoot:string,newRoot:string,total:number,fixable:number,missing:number,
 *            unchanged:number,patches:Array,files:number,filesMissing:number,
 *            entries:Array<{id:string,from:string,to:string,state:string,files:number}>}}
 */
function planMigration(entries, newRoot, exists) {
  const has = typeof exists === 'function' ? exists : (p) => {
    try { return fs.existsSync(p); } catch { return false; }
  };
  const list = Array.isArray(entries) ? entries : [];
  const oldRoot = detectRoot(list);
  const out = {
    oldRoot,
    newRoot: winOf(newRoot).replace(/\\+$/, ''),
    total: list.length,
    fixable: 0,
    missing: 0,
    unchanged: 0,
    files: 0,
    filesMissing: 0,
    patches: [],
    entries: []
  };
  if (!out.newRoot) return out;

  for (const e of list) {
    const from = rootOfEntry(e);
    if (!from) { out.unchanged += 1; out.entries.push({ id: e.id, from: '', to: '', state: 'unknown', files: 0 }); continue; }
    const fromTarget = winOf(e.target).replace(/\\+$/, '');
    const toTarget = samePath(from, fromTarget)
      ? out.newRoot
      : path.join(out.newRoot, path.relative(from, fromTarget));
    const manifest = [];
    let ok = true;
    let moved = 0;
    for (const f of e.manifest || []) {
      const rel = winOf(f.rel);
      const oldPath = winOf(f.path);
      const next = rel ? path.join(toTarget, rel) : oldPath;
      const existsNow = has(next);
      if (!existsNow) ok = false;
      else out.files += 1;
      if (!samePath(oldPath, next)) moved += 1;
      manifest.push({ path: existsNow || !rel ? next : oldPath, rel: f.rel, size: f.size });
    }
    if (!ok) { out.filesMissing += 1; out.missing += 1; out.entries.push({ id: e.id, from, to: toTarget, state: 'missing', files: moved }); continue; }
    if (!moved && samePath(fromTarget, toTarget)) { out.unchanged += 1; out.entries.push({ id: e.id, from, to: toTarget, state: 'same', files: 0 }); continue; }
    out.fixable += 1;
    out.entries.push({ id: e.id, from, to: toTarget, state: 'move', files: moved });
    out.patches.push({
      id: e.id,
      patch: { target: toTarget, manifest, root: out.newRoot }
    });
  }
  return out;
}

/** 把试算结果套到条目上（纯函数，返回新数组；不碰文件） */
function applyPlan(entries, plan) {
  const map = new Map(((plan && plan.patches) || []).map(p => [p.id, p.patch]));
  return (entries || []).map(e => (map.has(e.id) ? { ...e, ...map.get(e.id) } : e));
}

// ---------------------------------------------------------------------------
// 便携账本：跟着游戏目录走的那一份
// ---------------------------------------------------------------------------

function ledgerPath(gameRoot) {
  return path.join(winOf(gameRoot), LEDGER_DIR, LEDGER_NAME);
}

/**
 * 账本条目只留相对信息：
 *   · `targetRel` = target 相对游戏根（'' 表示 target 就是游戏根）
 *   · `manifest[].rel` = 相对 target（沿用注册表既有口径）
 * 于是「游戏根 + targetRel + rel」就能还原任意一条文件路径。
 */
function toLedgerEntry(e, gameRoot) {
  const root = winOf(gameRoot).replace(/\\+$/, '');
  const target = winOf(e.target).replace(/\\+$/, '');
  const targetRel = root && lowerOf(target).startsWith(lowerOf(root))
    ? path.relative(root, target)
    : '';
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    enabled: e.enabled !== false,
    source: e.source || null,
    installedAt: e.installedAt || null,
    targetRel,
    manifest: (e.manifest || []).map(f => ({ rel: f.rel, size: f.size })),
    fileCount: e.fileCount,
    size: e.size,
    taskId: e.taskId || null,
    prereqKey: e.prereqKey || null,
    requiresCns: !!e.requiresCns,
    requiresAtool: !!e.requiresAtool
  };
}

function toLedger(entries, gameRoot, extra) {
  const root = winOf(gameRoot).replace(/\\+$/, '');
  const x = extra || {};
  return {
    version: LEDGER_VERSION,
    writtenAt: new Date().toISOString(),
    gameRoot: root,
    app: x.app || null,
    mods: (entries || []).map(e => toLedgerEntry(e, root))
  };
}

/** 账本条目 → 注册表条目（绝对路径按新根重建） */
function fromLedgerEntry(le, gameRoot) {
  const root = winOf(gameRoot).replace(/\\+$/, '');
  const target = le.targetRel ? path.join(root, le.targetRel) : root;
  return {
    id: le.id,
    name: le.name,
    kind: le.kind || 'pak',
    enabled: le.enabled !== false,
    source: le.source || null,
    installedAt: le.installedAt || new Date().toISOString(),
    target,
    archivePath: null,
    manifest: (le.manifest || []).map(f => ({ path: path.join(target, winOf(f.rel)), rel: f.rel, size: f.size })),
    backupDir: null,
    overwritten: [],
    fileCount: le.fileCount || (le.manifest || []).length,
    size: le.size || 0,
    taskId: le.taskId || null,
    prereqKey: le.prereqKey || null,
    requiresCns: !!le.requiresCns,
    requiresAtool: !!le.requiresAtool,
    root,
    fromLedger: true
  };
}

function readLedger(gameRoot) {
  try {
    const file = ledgerPath(gameRoot);
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    if (!json || json.version !== LEDGER_VERSION || !Array.isArray(json.mods)) return null;
    return { ...json, file };
  } catch { return null; }
}

function writeLedger(gameRoot, ledger) {
  const file = ledgerPath(gameRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/**
 * 合并账本进注册表：只补注册表里没有的 id，绝不覆盖现有记录
 * （现有记录可能更新，账本可能旧）。
 */
function mergeLedger(existingEntries, ledger, gameRoot, exists) {
  const has = typeof exists === 'function' ? exists : (p) => {
    try { return fs.existsSync(p); } catch { return false; }
  };
  const known = new Set((existingEntries || []).map(e => e.id));
  const add = [];
  const skipped = [];
  for (const le of (ledger && ledger.mods) || []) {
    if (!le || !le.id) continue;
    if (known.has(le.id)) { skipped.push({ id: le.id, reason: 'exists' }); continue; }
    const entry = fromLedgerEntry(le, gameRoot);
    const alive = entry.manifest.filter(f => has(f.path));
    if (!alive.length) { skipped.push({ id: le.id, reason: 'files-missing' }); continue; }
    entry.manifest = alive;
    if (entry.manifest.length !== (le.manifest || []).length) entry.partial = true;
    add.push(entry);
  }
  return { add, skipped };
}

module.exports = {
  LEDGER_DIR,
  LEDGER_NAME,
  LEDGER_VERSION,
  TAIL_SEGS,
  splitTarget,
  rootOfEntry,
  detectRoot,
  planMigration,
  applyPlan,
  ledgerPath,
  toLedger,
  toLedgerEntry,
  fromLedgerEntry,
  readLedger,
  writeLedger,
  mergeLedger
};
