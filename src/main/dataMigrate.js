'use strict';
/**
 * 数据目录搬运 —— 设置页「更改数据位置」用的那一套。
 *
 * 用户可以把数据目录换到别处（比如 C 盘紧张时换到 D 盘）。
 * 换完之后**旧数据得跟过去**，否则已安装的 Mod 清单、下载队列、
 * 覆盖备份指针全对不上 —— 尤其是注册表里存的是**绝对路径**，
 * 不重写就会指向一个已经不存在的位置，卸载时「还原被覆盖的原文件」会去找空。
 *
 * 三条设计约定：
 *
 *   1. **只搬有意义的**。`tmp/` 是解压临时目录，本来就会自动清理，不搬。
 *   2. **搬完必须重写 JSON 里的绝对路径**（`from` → `to`）。
 *      旧脚本 `_probe/migrate-data.js` 只重写了 `mods.json`，
 *      但 `downloads.json` 里的 `archivePath` 同样指向 `library/`，
 *      漏了它，下载页的元素在资源管理器里就定位不到。
 *   3. **move 与 copy 分开**：同一盘符下 move 走 `rename`（瞬时，几个 GB 也是瞬间完成），
 *      跨盘（`EXDEV`）自动退化成「先复制再删源」。
 *
 * 所有判定逻辑（`countTree` / `inspect` / `plan` / `rewritePathsIn`）都是纯函数，
 * 见 `_probe/datadir-test.js`。
 */
const fs = require('fs');
const path = require('path');

/** 顶层会搬的文件 */
const KEEP_FILES = [
  'config.json',        // 配置
  'mods.json',          // 已安装 Mod 注册表（含备份指针）
  'downloads.json',     // 下载队列（archivePath 指向 library/）
  'watch-seen.json',    // 下载目录监听已处理记录
  'blacklist.json',
  'favorites.json'
];

/** 顶层会搬的目录 */
const KEEP_DIRS = ['cache', 'library', 'backup', 'logs'];

/** 明确不搬的目录（可再生的临时产物） */
const SKIP_DIRS = ['tmp'];

/* ------------------------------------------------------------------ 纯函数 */

/** 递归数一个目录里有多少文件、共多少字节（数不动就跳过，不抛） */
function countTree(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) { walk(p); continue; }
      files++;
      try { bytes += fs.statSync(p).size; } catch { /* 文件刚被删掉之类 */ }
    }
  };
  walk(dir);
  return { files, bytes };
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch { return null; }
}

function countFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isFile()).length; }
  catch { return 0; }
}

function countDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory()).length; }
  catch { return 0; }
}

/**
 * 目标目录里有什么。
 *
 * `hasData` 才是「要不要问用户怎么处理」的依据 ——
 * 只看 `isEmpty` 不够：目录里可能只有一两个空目录或 `tmp/`，那不算有数据。
 */
function inspect(dir) {
  const out = {
    dir: String(dir || ''),
    exists: false,
    isEmpty: true,
    hasData: false,
    files: 0,
    bytes: 0,
    marks: { mods: 0, downloads: 0, hasConfig: false, library: 0, backup: 0, images: 0 }
  };
  if (!out.dir) return out;
  try { out.exists = fs.existsSync(out.dir); } catch { /* 路径非法 */ }
  if (!out.exists) return out;

  let entries = [];
  try { entries = fs.readdirSync(out.dir); } catch { return out; }
  out.isEmpty = entries.length === 0;

  const reg = readJson(path.join(out.dir, 'mods.json'));
  if (reg && Array.isArray(reg.mods)) out.marks.mods = reg.mods.length;

  const queue = readJson(path.join(out.dir, 'downloads.json'));
  if (queue && Array.isArray(queue.tasks)) out.marks.downloads = queue.tasks.length;
  else if (Array.isArray(queue)) out.marks.downloads = queue.length;

  out.marks.hasConfig = fs.existsSync(path.join(out.dir, 'config.json'));
  out.marks.library = countFiles(path.join(out.dir, 'library'));
  out.marks.backup = countFiles(path.join(out.dir, 'backup'));
  out.marks.images = countDirs(path.join(out.dir, 'cache', 'images'));

  const t = countTree(out.dir);
  out.files = t.files;
  out.bytes = t.bytes;

  const m = out.marks;
  out.hasData = !!(m.mods || m.downloads || m.hasConfig || m.library || m.backup || m.images);
  return out;
}

/**
 * 列出「从 from 搬到 to」会动哪些东西。
 * `clash` = 目标已有同名项（搬运时要按覆盖策略处理）。
 */
function plan(from, to) {
  const src = String(from || '');
  const dst = String(to || '');
  const items = [];
  if (!src || !dst) return { from: src, to: dst, items, files: 0, bytes: 0, clash: 0, samePath: false };
  if (path.resolve(src).toLowerCase() === path.resolve(dst).toLowerCase()) {
    return { from: src, to: dst, items, files: 0, bytes: 0, clash: 0, samePath: true };
  }

  for (const name of KEEP_FILES) {
    const p = path.join(src, name);
    let st = null;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    const exists = fs.existsSync(path.join(dst, name));
    items.push({ name, kind: 'file', files: 1, bytes: st.size, clash: exists });
  }
  for (const name of KEEP_DIRS) {
    const p = path.join(src, name);
    let st = null;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isDirectory()) continue;
    const t = countTree(p);
    if (!t.files) continue;               // 空目录不值得搬
    const exists = fs.existsSync(path.join(dst, name));
    items.push({ name: name + '/', kind: 'dir', files: t.files, bytes: t.bytes, clash: exists });
  }

  const files = items.reduce((n, it) => n + it.files, 0);
  const bytes = items.reduce((n, it) => n + it.bytes, 0);
  const clash = items.filter(it => it.clash).length;
  return { from: src, to: dst, items, files, bytes, clash, samePath: false };
}

/**
 * 把对象里所有「指向 from 之下」的字符串路径改写成 to 之下。
 * **纯函数**，返回新对象，并往 `counter.n` 里累计改写次数。
 *
 * ⚠️ 不能只写 `startsWith(f)`：`C:\data` 与 `C:\data-old` 前 7 个字符一样，
 *    但后者不在前者之下 —— 所以必须比到**分隔符边界**才认。
 */
function rewritePathsIn(value, from, to, counter) {
  const cnt = counter || { n: 0 };
  const f = String(from || '').replace(/[\\/]+$/, '').toLowerCase();
  const under = (s) => {
    const l = s.toLowerCase();
    return l === f || l.startsWith(f + '\\') || l.startsWith(f + '/');
  };
  const walk = (v) => {
    if (typeof v === 'string') {
      if (under(v)) { cnt.n++; return String(to) + v.slice(String(from).replace(/[\\/]+$/, '').length); }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  const out = walk(value);
  return { value: out, count: cnt.n };
}

/* ------------------------------------------------------------------ 搬运 */

/** 目录整体 rename；跨盘 / 目标已存在时返回 false，交给调用方退化成复制 */
function tryRenameDir(from, to) {
  if (fs.existsSync(to)) return false;
  try { fs.renameSync(from, to); return true; }
  catch (e) {
    if (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOTEMPTY') return false;
    throw e;
  }
}

/**
 * 复制一棵树。`overwrite` 决定同名文件怎么办。
 * @returns {{ copied:number, skipped:number, bytes:number }}
 */
function copyTree(from, to, overwrite) {
  const st = { copied: 0, skipped: 0, bytes: 0 };
  const walk = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    let items = [];
    try { items = fs.readdirSync(s, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const sp = path.join(s, it.name);
      const dp = path.join(d, it.name);
      if (it.isDirectory()) { walk(sp, dp); continue; }
      if (fs.existsSync(dp) && !overwrite) { st.skipped++; continue; }
      fs.copyFileSync(sp, dp);
      st.copied++;
      try { st.bytes += fs.statSync(sp).size; } catch { /* 忽略 */ }
    }
  };
  walk(from, to);
  return st;
}

function removeTree(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); }
  catch { /* 删不掉就算了，源目录留着不影响使用 */ }
}

/**
 * 执行搬运。
 *
 * @param {string} from 源数据目录
 * @param {string} to   目标数据目录
 * @param {{
 *   mode?: 'copy'|'move',       // 默认 copy
 *   overwrite?: boolean,        // 目标同名文件是否覆盖（默认 false = 保留目标那份）
 *   onProgress?: (p:object)=>void,
 *   now?: () => number          // 便于测试注入
 * }} [opts]
 */
function run(from, to, opts) {
  const o = opts || {};
  const mode = o.mode === 'move' ? 'move' : 'copy';
  const overwrite = !!o.overwrite;
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : () => {};
  const src = String(from || '');
  const dst = String(to || '');

  if (!src || !dst) throw new Error('源目录与目标目录都不能为空');
  if (path.resolve(src).toLowerCase() === path.resolve(dst).toLowerCase()) {
    throw new Error('源目录与目标目录是同一个');
  }
  if (!fs.existsSync(src)) throw new Error('源目录不存在：' + src);

  const p = plan(src, dst);
  fs.mkdirSync(dst, { recursive: true });

  const st = { files: p.files, bytes: p.bytes, copied: 0, moved: 0, skipped: 0,
    rewritten: 0, mode, from: src, to: dst, items: [] };

  let done = 0;
  const tick = (name) => {
    done++;
    // 每个顶层项报一次即可 —— 几千个文件逐个回调会把 IPC 打满
    onProgress({ phase: mode, name, done, total: p.items.length, files: st.moved + st.copied });
  };

  for (const it of p.items) {
    const s = path.join(src, it.name);
    const d = path.join(dst, it.name);
    let itemStat;

    if (it.kind === 'dir' && mode === 'move' && !it.clash) {
      // 同盘 rename（瞬时）；跨盘或目标已存在 → 退化成复制 + 删源
      if (tryRenameDir(s, d)) {
        itemStat = { copied: it.files, skipped: 0, moved: true };
      } else {
        const r = copyTree(s, d, overwrite);
        // ⚠️ 只有在**一个都没跳过**时才删源 —— 跳过的那些文件在目标里是旧版本，
        //    删了源就等于把新数据丢了。
        if (r.skipped === 0) removeTree(s);
        itemStat = { ...r, moved: true };
      }
    } else if (it.kind === 'dir') {
      const r = copyTree(s, d, overwrite);
      itemStat = r;
      if (mode === 'move' && r.skipped === 0) removeTree(s);
    } else {
      // 单个文件
      if (fs.existsSync(d) && !overwrite) {
        itemStat = { copied: 0, skipped: 1 };
      } else if (mode === 'move') {
        let okMove = false;
        try { fs.renameSync(s, d); okMove = true; } catch { okMove = false; }
        if (!okMove) { fs.copyFileSync(s, d); try { fs.unlinkSync(s); } catch { /* 忽略 */ } }
        itemStat = { copied: 1, skipped: 0, moved: true };
      } else {
        fs.copyFileSync(s, d);
        itemStat = { copied: 1, skipped: 0 };
      }
    }

    st.copied += itemStat.copied || 0;
    st.skipped += itemStat.skipped || 0;
    if (itemStat.moved) st.moved += itemStat.copied || 0;
    st.items.push({ name: it.name, ...itemStat });
    tick(it.name);
  }

  // —— 重写绝对路径：必须在文件已经在**新位置**之后做 ——
  onProgress({ phase: 'rewrite', name: '', done: p.items.length, total: p.items.length, files: st.moved + st.copied });
  for (const name of KEEP_FILES) {
    if (!name.endsWith('.json')) continue;
    const f = path.join(dst, name);
    const json = readJson(f);
    if (!json) continue;
    const r = rewritePathsIn(json, src, dst, { n: 0 });
    if (!r.count) continue;
    st.rewritten += r.count;
    try {
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(r.value, null, 2), 'utf8');
      fs.renameSync(tmp, f);
    } catch { /* 写不进去就保持原样，不动比写坏强 */ }
  }

  onProgress({ phase: 'done', name: '', done: p.items.length, total: p.items.length, files: st.moved + st.copied });
  return st;
}

module.exports = {
  KEEP_FILES, KEEP_DIRS, SKIP_DIRS,
  countTree, inspect, plan, rewritePathsIn, run, copyTree, removeTree, tryRenameDir
};
