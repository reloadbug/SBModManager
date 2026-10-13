'use strict';
const fs = require('fs');
const path = require('path');

/**
 * 下载目录监听 —— 「手动下载」这条路的兜底。
 *
 * ## 它解决什么
 *
 * Nexus 免费账号只有两条下载通路：
 *   · `Mod Manager Download` → `nxm://` → 本程序全自动接管（主通路）
 *   · `Manual download` → 浏览器下载到本地（兜底通路，也是**最稳**的一条）
 *
 * 兜底通路以前是「用户自己去设置页点『选择压缩包…』」，等于把活儿又还给了用户。
 * 这个模块把最后一步也自动化：盯着下载目录，一出现新的 mod 压缩包就自动导入队列。
 *
 * ## 关键设计
 *
 * · **只认压缩包**：`.zip` / `.7z` / `.rar`；`.part` / `.crdownload` 这些
 *   「还没下完」的临时文件一律忽略（否则会导入半截文件，解压必失败）。
 * · **等文件稳定再导入**：浏览器下载时文件会先创建、再慢慢变大。只看「存在」
 *   会在文件还在写的时候就动手。所以要求**连续两次轮询大小不变**，或者
 *   mtime 已经超过 `stableMs`（覆盖「程序启动时文件早就下好了」这种情况）。
 * · **去重靠指纹**：`路径 + 大小 + mtime`。用户删了重下 → mtime 变 → 会再次提示。
 * · **双通道触发**：`fs.watch` 事件（快）+ 定时轮询（稳）。Windows 上 `fs.watch`
 *   偶发丢事件，只有事件通道会漏文件；只有轮询通道又会让导入慢好几秒。
 * · **不自动安装不认识的包**：文件名能解析出 Nexus 的 `modId` 才敢自动装
 *   （见 `parseNexusFileName`）；解析不出来就进队列的「待确认」，等用户点一下。
 */

const ARCHIVE_RE = /\.(zip|7z|rar)$/i;
/** 「还没下完」的临时后缀 —— 命中就跳过，等它变成正式文件 */
const PARTIAL_RE = /\.(part|crdownload|tmp|partial|download|!qb|aria2|opdownload)$/i;
/** 明显不是 mod 的压缩包（游戏自己的分卷之类） */
const SKIP_RE = /^(?:\.|~)/;

const SEEN_LIMIT = 1500;

/**
 * 解析 Nexus「手动下载」的文件名，取出 modId。
 *
 * Nexus 手动下载的命名规则是：
 *   `<ModName>-<modId>-<version>-<时间戳>.zip`
 * 例如 `CustomNanosuitSystem-1496-2-2-1791651882264.zip`。
 *
 * ⚠️ 时间戳那段必须是 10~13 位数字才认 —— 这是整个正则里唯一能防误判的锚点。
 *    没有它，`My-Mod-1-2-3.zip` 这种普通压缩包会被误认成 Nexus 包并触发自动安装。
 */
function parseNexusFileName(name) {
  const m = String(name || '').match(/^(.+?)-(\d{2,7})-([\w.\-]*?)-(\d{10,13})\.(zip|7z|rar)$/i);
  if (!m) return null;
  const modName = m[1].replace(/_/g, ' ').trim();
  if (!modName) return null;
  return {
    name: modName,
    modId: Number(m[2]),
    version: m[3] || null,
    timestamp: Number(m[4]),
    ext: m[5].toLowerCase()
  };
}

/** 文件名兜底显示名：去掉扩展名、把下划线换成空格 */
function prettyName(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
}

function createDownloadWatcher({
  dirs = [],
  seenFile = null,
  onArchive = null,
  onError = null,
  logger = null,
  readJson = null,
  writeJson = null,
  stableMs = 4000,
  pollMs = 5000,
  now = () => Date.now()
} = {}) {
  /** 已导入过的文件指纹：lower(path) → { size, mtimeMs, at } */
  const seen = new Map();
  /** 待确认稳定的文件：lower(path) → { size, since } */
  const pending = new Map();
  /**
   * 正在监听的目录。
   *
   * ⚠️ 必须用构造参数初始化 —— 早期版本只声明了空数组、忘了赋值，
   *    结果 `start()` 时一个目录都没监听，整个模块静默失效。
   */
  let watchDirs = [];
  /** fs.watch 句柄 */
  const watchers = [];
  let timer = null;
  let debounce = null;
  let running = false;
  /**
   * 启动静默窗口的截止时间。
   *
   * 「首次扫描只记账不提示」这条规则单独用一次 `scan({silent:true})` 是不够的 ——
   * 稳定性判定会让「刚创建的文件」落到后续轮询里，于是启动瞬间躺在下载目录的文件
   * 仍会弹提示。所以改成**按时间窗口**静默：启动后 `stableMs + 2*pollMs` 内发现的
   * 文件一律只记账。窗口很短，不会漏掉真正的「刚下好」。
   */
  let silentUntil = 0;

  // 用构造参数初始化监听目录（setDirs 是函数声明，会提升，这里调用是安全的）
  setDirs(dirs);

  function log(msg, data) {
    if (logger && typeof logger.event === 'function') { try { logger.event(msg, data); } catch { /* 忽略 */ } }
  }

  /* ---------------- 持久化（已导入指纹） ---------------- */

  function loadSeen() {
    if (!seenFile || typeof readJson !== 'function') return;
    const j = readJson(seenFile, {});
    for (const [k, v] of Object.entries(j && j.seen ? j.seen : {})) {
      if (v && typeof v === 'object') seen.set(k, v);
    }
  }

  let saveTimer = null;
  function saveSeen() {
    if (!seenFile || typeof writeJson !== 'function') return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        // 超出上限就按时间裁掉最旧的，避免这个文件无限膨胀
        const entries = [...seen.entries()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, SEEN_LIMIT);
        seen.clear();
        for (const [k, v] of entries) seen.set(k, v);
        writeJson(seenFile, { seen: Object.fromEntries(entries) });
      } catch (e) { log('watch:saveSeenFailed', { error: e.message }); }
    }, 800);
  }

  /* ---------------- 扫描 ---------------- */

  function fingerprint(st) {
    return { size: st.size, mtimeMs: Math.round(st.mtimeMs || 0) };
  }

  function isSeen(p, st) {
    const k = String(p).toLowerCase();
    const prev = seen.get(k);
    if (!prev) return false;
    const fp = fingerprint(st);
    return prev.size === fp.size && prev.mtimeMs === fp.mtimeMs;
  }

  function markSeen(p, st) {
    seen.set(String(p).toLowerCase(), { ...fingerprint(st), at: now() });
    saveSeen();
  }

  /**
   * 扫一遍所有监听目录，返回本次**新发现且已稳定**的压缩包。
   * @param {{silent?:boolean}} [opts] silent=true 时不计入「待确认」（用于首次全量扫描）
   */
  function scan({ silent = false } = {}) {
    const found = [];
    const t = now();
    // 启动窗口内一律静默（见 silentUntil 的说明）
    const quiet = silent || (silentUntil > 0 && t < silentUntil);

    for (const dir of watchDirs) {
      let items = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }

      for (const it of items) {
        if (!it.isFile()) continue;
        const name = it.name;
        if (!ARCHIVE_RE.test(name)) continue;
        if (PARTIAL_RE.test(name)) continue;
        if (SKIP_RE.test(name)) continue;

        const full = path.join(dir, name);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (!st.isFile() || !st.size) continue;
        if (isSeen(full, st)) continue;

        const k = full.toLowerCase();
        const fp = fingerprint(st);

        // 稳定性判定：① 文件早就写完了（mtime 够旧）② 连续两次轮询大小不变
        const p = pending.get(k);
        const oldEnough = t - fp.mtimeMs >= stableMs;
        const sizeStable = p && p.size === fp.size && t - p.since >= stableMs;

        if (!oldEnough && !sizeStable) {
          if (!p || p.size !== fp.size) pending.set(k, { size: fp.size, since: t });
          continue;
        }

        pending.delete(k);
        markSeen(full, st);
        if (quiet) continue;   // 启动窗口 / 静默扫描：只记账，不弹提示

        const nexus = parseNexusFileName(name);
        found.push({
          path: full,
          name,
          displayName: nexus ? nexus.name : prettyName(name),
          size: st.size,
          mtimeMs: fp.mtimeMs,
          dir,
          modId: nexus ? nexus.modId : null,
          version: nexus ? nexus.version : null,
          nexus: !!nexus
        });
      }
    }

    for (const f of found) {
      log('watch:found', { file: f.name, size: f.size, modId: f.modId });
      if (typeof onArchive === 'function') {
        try { onArchive(f); } catch (e) { log('watch:onArchiveFailed', { error: e.message }); }
      }
    }
    return found;
  }

  /* ---------------- 监听 ---------------- */

  function scheduleTick(delay = 250) {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!running) return;
      try { scan(); } catch (e) { log('watch:scanFailed', { error: e.message }); }
    }, delay);
  }

  function watchAll() {
    for (const w of watchers) { try { w.close(); } catch { /* 忽略 */ } }
    watchers.length = 0;
    for (const dir of watchDirs) {
      try {
        // 只监听一层：下载目录一般不会嵌套；recursive 在 Windows 上对某些盘符会抛错
        const w = fs.watch(dir, { persistent: false }, () => scheduleTick());
        w.on('error', (e) => { if (typeof onError === 'function') { try { onError(e); } catch { /* 忽略 */ } } });
        watchers.push(w);
      } catch (e) {
        log('watch:watchFailed', { dir, error: e.message });
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    loadSeen();
    silentUntil = now() + stableMs + pollMs * 2;
    // 首次扫描：把「已经躺在下载目录里的旧文件」记成已见，不打扰用户
    try { scan({ silent: true }); } catch { /* 忽略 */ }
    watchAll();
    timer = setInterval(() => { try { scan(); } catch { /* 忽略 */ } }, pollMs);
    if (timer.unref) timer.unref();
    log('watch:started', { dirs: watchDirs.length });
  }
  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (debounce) { clearTimeout(debounce); debounce = null; }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    for (const w of watchers) { try { w.close(); } catch { /* 忽略 */ } }
    watchers.length = 0;
  }

  /** 换一组监听目录（会自动重启监听） */
  function setDirs(list) {
    const next = [];
    for (const d of Array.isArray(list) ? list : []) {
      if (!d) continue;
      try { if (!fs.statSync(d).isDirectory()) continue; } catch { continue; }
      const abs = path.resolve(d);
      if (!next.includes(abs)) next.push(abs);
    }
    watchDirs = next;
    if (running) watchAll();
    return watchDirs;
  }

  function getDirs() { return [...watchDirs]; }

  /** 手动立即扫一次（设置页「立即扫描」按钮），**会**弹提示 */
  function scanNow() { return scan({ silent: false }); }

  /** 忘掉某个文件的「已见」记录，让它下次能被重新发现 */
  function forget(p) {
    const ok = seen.delete(String(p).toLowerCase());
    if (ok) saveSeen();
    return ok;
  }

  /** 把当前监听目录里的压缩包全部记成已见（「忽略现有文件」按钮） */
  function markAllSeen() {
    let n = 0;
    for (const dir of watchDirs) {
      let items = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const it of items) {
        if (!it.isFile() || !ARCHIVE_RE.test(it.name) || PARTIAL_RE.test(it.name)) continue;
        const full = path.join(dir, it.name);
        try { markSeen(full, fs.statSync(full)); n++; } catch { /* 忽略 */ }
      }
    }
    return n;
  }

  return {
    start, stop, scan, scanNow, setDirs, getDirs, forget, markAllSeen,
    isRunning: () => running,
    seenCount: () => seen.size,
    _pending: pending
  };
}

module.exports = {
  createDownloadWatcher,
  parseNexusFileName,
  prettyName,
  ARCHIVE_RE,
  PARTIAL_RE,
  SEEN_LIMIT
};
