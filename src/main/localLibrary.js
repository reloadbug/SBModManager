'use strict';

/**
 * 管理器自带安装包盘点（`data/library/*`）。
 *
 * 背景（用户 2026-11-07 反馈：「下好了没装的 Mod」那一套他看不到）：
 *   下载队列是**任务账本**，一旦用户点了「清理已完成记录」，或者换了游戏目录、
 *   或者换了台机器，队列里就什么都不剩了 —— 可安装包其实一直躺在
 *   `data/library` 里（0.3.4 之后这个目录不跟着游戏走，换目录也不会丢）。
 *
 * 所以这一层直接看磁盘：把 library 里的包按 `<modId>_<名字>_<版本>.<ext>` 归到
 * modId 上，再拿「当前游戏目录里到底装没装」来筛。筛出来的是**可以直接装的**，
 * 界面上一键就能装进当前游戏目录 —— 这正是用户要的「换游戏目录后能重新装」。
 *
 * 三条取舍（写在这里，免得以后被当成 bug 改掉）：
 *   1. 只认文件名里的 modId 前缀（下载器自己命名的规则）。认不出的包**不猜**，
 *      直接跳过 —— 猜错会把 A mod 装成 B mod。
 *   2. 「装没装」看的是**当前游戏目录**：注册表里记着、但文件不在当前游戏目录里的
 *      不算装了（换目录后的正常状态）。判定用 manifest 的绝对路径 + 前缀比对。
 *   3. 同一个 modId 有多个包时只亮**最新的那个**（按 mtime，其次按大小）：
 *      同 mod 的多份包是不同版本，让用户逐个版本乱点没意义。
 */

const fs = require('fs');
const path = require('path');

/** 认得的压缩包类型（与下载器的 archive 嗅探保持同一批） */
const ARCHIVE_RE = /\.(zip|7z|rar)$/i;

/** 归一化路径：统一反斜杠、小写、去尾部分隔符 */
function norm(p) {
  return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** `a` 是否在 `root` 里面（同一盘符 + 前缀匹配） */
function under(a, root) {
  if (!a || !root) return false;
  return norm(a) === norm(root) || norm(a).startsWith(norm(root) + '\\');
}

/**
 * 从下载器命名的文件名里拆出 `{ modId, name, version }`。
 *
 * 规则来自 `downloadEngine.buildArchiveName()`：`<modId>_<名>_<版本>.<ext>`。
 * 名字里本身可能带下划线，所以版本取**最后一个**看起来像版本号的片段，
 * 剩下的全算名字 —— 宁可名字长一点，也不要把名字截断。
 */
function parseArchiveName(file) {
  const base = String(file || '');
  if (!ARCHIVE_RE.test(base)) return null;
  const m = base.match(/^(\d{1,9})_(.+)$/);
  if (!m) return null;
  const modId = Number(m[1]);
  if (!modId) return null;
  const stem = m[2].replace(ARCHIVE_RE, '');
  const parts = stem.split('_').filter(Boolean);
  let version = '';
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    // v1 / v1.0 / 1.0 / 1.0.2 / 1.0.2b 这类都算版本
    if (/^v?\d+(?:\.\d+)*[a-z]?$/i.test(last) && last.length <= 16) {
      version = last;
      parts.pop();
    }
  }
  const name = parts.join('_') || stem;
  return { modId, name, version };
}

/**
 * 当前游戏目录里「这一条注册记录还算装着吗」。
 *
 * - manifest 里一个文件都没有 → 不算（空记录没意义）；
 * - 有文件不在磁盘上 → 不算（被手动删了，等 `reconcile` 那边收拾）；
 * - 文件在、但**不在当前游戏目录下** → 不算（换过游戏目录，得重装到这来）。
 */
function entryLivesIn(entry, root) {
  const files = (entry && entry.manifest) || [];
  if (!files.length || !root) return false;
  for (const f of files) {
    const p = f && f.path;
    if (!p || !fs.existsSync(p)) return false;
    if (!under(p, root)) return false;
  }
  return true;
}

/**
 * 盘点 library 里「现在能装进当前游戏目录」的包。
 *
 * @param {object} o
 * @param {string} o.dir        安装包目录（`paths.LIBRARY`）
 * @param {string} o.root       当前游戏根目录（没有就给 null / ''）
 * @param {Array}  o.entries    注册表条目（`registry.all()`）
 * @param {Array}  o.tasks      下载队列任务（`engine.list()`；这些已经在页面上露过脸了）
 * @param {number} [o.limit]    最多返回多少组（按 mtime 倒序），默认 300
 * @returns {{dir:string, exists:boolean, total:number, installable:number, skipped:{installed:number, inQueue:number, unparsed:number}, items:Array}}
 */
function scan({ dir, root, entries = [], tasks = [], limit = 300 } = {}) {
  const out = { dir: dir || '', exists: false, total: 0, installable: 0, skipped: { installed: 0, inQueue: 0, unparsed: 0 }, items: [] };
  if (!dir || !fs.existsSync(dir)) return out;
  out.exists = true;

  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => ARCHIVE_RE.test(f));
  } catch (e) {
    return out;
  }
  out.total = files.length;

  // 当前游戏目录里还活着的 modId
  const live = new Set();
  for (const e of entries) {
    const modId = Number(e && e.source && e.source.modId) || 0;
    if (!modId) continue;
    if (entryLivesIn(e, root)) live.add(String(modId));
  }
  // 队列里已经显示过的 modId（避免同一件事在页面上出现两遍）
  const queued = new Set();
  for (const t of tasks) {
    const modId = Number(t && t.meta && t.meta.modId) || 0;
    if (!modId) continue;
    if (t.status === 'failed' || t.status === 'cancelled') continue; // 这两类用户还要看，不算「已露脸」
    queued.add(String(modId));
  }

  /** modId -> 最新的一份包 */
  const best = new Map();
  for (const f of files) {
    const info = parseArchiveName(f);
    if (!info) { out.skipped.unparsed += 1; continue; }
    const id = String(info.modId);
    if (live.has(id)) { out.skipped.installed += 1; continue; }
    if (queued.has(id)) { out.skipped.inQueue += 1; continue; }
    let st = null;
    try { st = fs.statSync(path.join(dir, f)); } catch { st = null; }
    const item = {
      modId: info.modId,
      name: info.name,
      version: info.version,
      filename: f,
      archivePath: path.join(dir, f),
      size: st ? st.size : 0,
      mtime: st ? st.mtime.toISOString() : ''
    };
    const prev = best.get(id);
    if (!prev) { best.set(id, item); continue; }
    const newer = item.mtime > prev.mtime || (item.mtime === prev.mtime && item.size > prev.size);
    if (newer) best.set(id, item);
  }

  out.items = Array.from(best.values())
    .sort((a, b) => (b.mtime > a.mtime ? 1 : b.mtime < a.mtime ? -1 : b.size - a.size))
    .slice(0, Math.max(0, limit));
  out.installable = out.items.length;
  return out;
}

module.exports = { ARCHIVE_RE, parseArchiveName, entryLivesIn, under, norm, scan };
