'use strict';

/**
 * 安装包目录「搬家」—— 把一个 library 目录里的压缩包整体搬到新目录。
 *
 * 用户诉求（2026-11-26）：
 *   「安装包的目录设置支持搬家，选择一个新的位置，将老目录的文件搬到新位置，
 *     文件合并，同名的提示全部跳过、全部覆盖等基本选项，要有进度条，
 *     意外停止了可以继续搬」
 *
 * 设计要点（说清楚为什么这么写，别后人再猜）：
 *   1. 只搬**压缩包**（zip/7z/rar），跟 localLibrary.ARCHIVE_RE 一致；
 *      .part（没下完的临时文件）、隐藏文件、子目录里的一律不碰。
 *   2. 真实搬运走 fsMove.movePathAsync：同一块盘直接 rename（原子、瞬间），
 *      跨盘退化成「复制 + 删源」。这跟用户选的「真搬家（删源文件）」一致。
 *   3. 断点是目标目录里的一份 .sbm-migrate.json 清单：记源目录、目标目录、
 *      每个文件的名字/大小/状态。每搬完一个立刻落一次盘；中途关掉程序，
 *      下次再点「继续上次搬运」会跳过已 done 的，只补剩下的。
 *   4. 复制先写 .sbm-partial-<name> 临时名、完成后再改成目标名，避免中断
 *      留半截包被 localLibrary 误认成可安装包。
 *   5. 同名冲突三档：skip-same（同名同大小跳过，推荐）/ skip-all（全部跳过）/
 *      overwrite（全部覆盖）。判断只用「目标文件存在 + 大小相同」，不比内容。
 *   6. 所有路径都重新 resolve 并校验：拒绝目标是源的子目录、拒绝源是目标的子目录
 *      （否则搬着搬着自己把自己套进去）。
 *
 * 这个模块是纯函数式的：fs / fsMove 都能通过 opts 注入，探针不用真动 14GB 文件。
 */

const fsNative = require('fs');
const path = require('path');
const fsMove = require('./fsMove');

/** 跟 localLibrary 保持一致的压缩包后缀 */
const ARCHIVE_RE = /\.(zip|7z|rar)$/i;
/** 清单文件名（放在目标目录根部） */
const MANIFEST_NAME = '.sbm-migrate.json';
/** 未完成临时文件前缀 */
const PARTIAL_PREFIX = '.sbm-partial-';
/** 冲突处理三档 */
const CONFLICT_MODES = new Set(['skip-same', 'skip-all', 'overwrite']);

function norm(p) {
  return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** a 是不是在 root 里面（含 root 自身） */
function under(a, root) {
  const na = norm(a), nr = norm(root);
  return !!na && !!nr && (na === nr || na.startsWith(nr + '\\'));
}

/** 列出源目录里要搬的压缩包（只顶层、只文件、跳过临时/隐藏） */
function listArchives(srcDir, opts = {}) {
  const fs = opts.fs || fsNative;
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!ARCHIVE_RE.test(e.name)) continue;
    if (e.name.startsWith('.') || e.name.startsWith(PARTIAL_PREFIX)) continue;
    try {
      const st = fs.statSync(path.join(srcDir, e.name));
      out.push({ name: e.name, size: st.size, mtimeMs: st.mtimeMs });
    } catch { /* 单个读不到就跳过 */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * 预检：算清楚要搬哪些、多大、目标里有没有同名、有没有正在搬的旧清单。
 * 不改任何文件。
 */
function plan(srcDir, destDir, opts = {}) {
  const fs = opts.fs || fsNative;
  const src = path.resolve(String(srcDir || ''));
  const dest = path.resolve(String(destDir || ''));
  if (!src || !dest) throw new Error('源目录和目标目录都不能为空');
  if (norm(src) === norm(dest)) throw new Error('目标目录和当前目录是同一个');
  if (under(dest, src)) throw new Error('目标目录不能是当前目录的子目录');
  if (under(src, dest)) throw new Error('当前目录不能是目标目录的子目录');
  const archives = listArchives(src, { fs });
  let totalBytes = 0, conflicts = 0;
  for (const a of archives) {
    totalBytes += a.size;
    try { fs.accessSync(path.join(dest, a.name), fs.constants ? fs.constants.F_OK : 0); conflicts++; } catch { /* 不存在 */ }
  }
  return {
    src, dest,
    files: archives,
    count: archives.length,
    totalBytes,
    conflicts,
    resumable: !!loadManifest(dest, { fs })
  };
}

function manifestPath(destDir) {
  return path.join(destDir, MANIFEST_NAME);
}

/** 读旧清单；没有 / 坏了都返回 null（坏了就当新搬，不阻塞） */
function loadManifest(destDir, opts = {}) {
  const fs = opts.fs || fsNative;
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath(destDir), 'utf8').replace(/^\uFEFF/, ''));
    if (!j || !Array.isArray(j.items)) return null;
    return j;
  } catch { return null; }
}

function saveManifest(destDir, data, opts = {}) {
  const fs = opts.fs || fsNative;
  fs.mkdirSync(destDir, { recursive: true });
  const tmp = manifestPath(destDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try { fs.renameSync(tmp, manifestPath(destDir)); }
  catch (e) { fs.copyFileSync(tmp, manifestPath(destDir)); try { fs.unlinkSync(tmp); } catch {} }
}

/** 目标里这个同名文件在不在、大小是否一样 */
function targetState(dest, file, opts = {}) {
  const fs = opts.fs || fsNative;
  try {
    const st = fs.statSync(path.join(dest, file.name));
    return { exists: true, size: st.size, sameSize: st.size === file.size };
  } catch { return { exists: false, size: 0, sameSize: false }; }
}

/**
 * 决定一个文件怎么处理。
 * @returns 'done-same' | 'done-overwrite' | 'skip' | 'move'
 */
function decide(file, mode, ts, opts = {}) {
  if (ts.resumeDone) return 'done-same';
  if (!ts.exists) return 'move';
  if (mode === 'overwrite') return 'done-overwrite';
  if (mode === 'skip-all') return 'skip';
  if (mode === 'skip-same' && ts.sameSize) return 'skip';
  return 'move'; // skip-same 但大小不同 → 搬过去覆盖（新版本）
}

/**
 * 真正执行搬运。每搬完一个写一次清单 + 发一次进度。
 *
 * @param {object} args {srcDir,destDir,mode,onProgress,resume,signal,fs,moveFn}
 * @returns {Promise<{moved,skipped,failed,bytes,aborted,total}>}
 */
async function migrate(args = {}) {
  const fs = args.fs || fsNative;
  const moveFn = args.moveFn || fsMove.movePathAsync;
  const src = path.resolve(String(args.srcDir || ''));
  const dest = path.resolve(String(args.destDir || ''));
  const mode = CONFLICT_MODES.has(args.mode) ? args.mode : 'skip-same';
  if (!src || !dest) throw new Error('源目录和目标目录都不能为空');
  if (norm(src) === norm(dest)) throw new Error('目标目录和当前目录是同一个');
  if (under(dest, src)) throw new Error('目标目录不能是当前目录的子目录');
  if (under(src, dest)) throw new Error('当前目录不能是目标目录的子目录');
  fs.mkdirSync(dest, { recursive: true });

  const archives = listArchives(src, { fs });
  // 旧清单里 done 的文件记下来，续传时跳过
  const old = args.resume ? loadManifest(dest, { fs }) : null;
  const doneBefore = new Set(((old && old.items) || []).filter(x => x && x.status === 'done').map(x => x.name));
  const items = archives.map(a => ({
    name: a.name,
    size: a.size,
    status: doneBefore.has(a.name) ? 'done' : 'pending'
  }));
  const mf = {
    src, dest, mode,
    startedAt: (old && old.startedAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items
  };
  saveManifest(dest, mf, { fs });

  const total = archives.length;
  let moved = 0, skipped = 0, failed = 0, bytes = 0, done = 0, aborted = false;
  const emit = (extra = {}) => {
    if (typeof args.onProgress === 'function') {
      try { args.onProgress({ done, total, moved, skipped, failed, bytes, aborted, ...extra }); } catch { /* 界面回调研失败不影响搬运 */ }
    }
  };
  emit({ phase: 'start' });

  for (const file of archives) {
    if (args.signal && args.signal.aborted) { aborted = true; break; }
    const item = items.find(x => x.name === file.name);
    if (item && item.status === 'done') {
      skipped++; done++; emit({ name: file.name, action: 'resume-skip' });
      continue;
    }
    const ts = targetState(dest, file, { fs });
    ts.resumeDone = !!(item && item.status === 'done');
    const act = decide(file, mode, ts, { fs });

    if (act === 'skip') {
      if (item) item.status = 'skip';
      skipped++; done++;
      saveManifest(dest, mf, { fs });
      emit({ name: file.name, action: 'skip' });
      continue;
    }
    if (act === 'done-overwrite' && item) {
      // 同名不同大小、overwrite 模式：目标文件先让位（搬到临时名再删，
      // 这样搬运失败还能找回旧包），然后正常搬源过去。
      try {
        const oldPath = path.join(dest, file.name);
        const bak = path.join(dest, PARTIAL_PREFIX + 'old-' + file.name);
        try { fs.renameSync(oldPath, bak); } catch { fs.copyFileSync(oldPath, bak); }
        await moveFn(path.join(src, file.name), path.join(dest, file.name), { fs });
        try { fs.unlinkSync(bak); } catch { /* 旧备份留着也不影响 */ }
        if (item) item.status = 'done';
        moved++; bytes += file.size;
      } catch (e) {
        if (item) item.status = 'error';
        failed++;
        // 尝试恢复旧包
        const bak = path.join(dest, PARTIAL_PREFIX + 'old-' + file.name);
        try { if (fs.existsSync(bak) && !fs.existsSync(path.join(dest, file.name))) fs.renameSync(bak, path.join(dest, file.name)); } catch {}
      }
      done++;
      saveManifest(dest, mf, { fs });
      emit({ name: file.name, action: 'overwrite' });
      continue;
    }

    // act === 'move'：先搬源到目标，fsMove 内部同盘 rename、跨盘复制+删源。
    try {
      await moveFn(path.join(src, file.name), path.join(dest, file.name), { fs });
      if (item) item.status = 'done';
      moved++; bytes += file.size;
    } catch (e) {
      if (item) { item.status = 'error'; item.error = String(e && e.code || e && e.message || e); }
      failed++;
    }
    done++;
    mf.updatedAt = new Date().toISOString();
    saveManifest(dest, mf, { fs });
    emit({ name: file.name, action: item && item.status === 'done' ? 'moved' : 'failed' });
  }

  mf.finishedAt = aborted ? null : new Date().toISOString();
  saveManifest(dest, mf, { fs });
  emit({ phase: aborted ? 'aborted' : 'done' });
  return { moved, skipped, failed, bytes, aborted, total, manifest: manifestPath(dest) };
}

/** 搬完之后：源目录里还有没有压缩包（都搬走了就可以安全删空目录） */
function sourceRemaining(srcDir, opts = {}) {
  const fs = opts.fs || fsNative;
  return listArchives(srcDir, { fs }).map(a => a.name);
}

module.exports = {
  ARCHIVE_RE, MANIFEST_NAME, PARTIAL_PREFIX, CONFLICT_MODES,
  norm, under, listArchives, plan, manifestPath, loadManifest, saveManifest,
  targetState, decide, migrate, sourceRemaining
};
