'use strict';
const fs = require('fs');
const path = require('path');

/**
 * 报错日志 / 崩溃分析 —— 主进程侧。
 *
 * ## 这个模块解决什么事
 *
 * 用户装完 Mod 启动就崩，界面上除了「游戏闪退」什么都不知道：
 *   · 游戏本体是 Shipping 版，**默认不写 `SB.log`**（`%LOCALAPPDATA%\SB\Saved\Logs` 经常是空的）
 *   · 唯一的现场是 UE4SS 的 `UE4SS.log`（加载器自己的流水账）和
 *     `%LOCALAPPDATA%\SB\Saved\Crashes\UE4CC-*\CrashContext.runtime-xml`（引擎崩之前拍的快照）
 *
 * 所以这里做三件事：
 *   1. **收集**：把上面两处 + 管理器自己的日志整理成统一的数据结构（`gather()`）
 *   2. **解析**：崩溃 XML、UE4SS 日志各自拆成好读的字段（`parseCrashXml()` / `parseUe4ssLog()`，纯函数）
 *   3. **推断**：用「时序 + 加载阶段 + 文件完整性」这些**可复现的证据**排出嫌疑 Mod（`buildReport()`，纯函数）
 *
 * ## 有意不做的两件事
 *
 * · **不解析 pak 内容**。判断「两个 Mod 改了同一个资源」要读 IoStore 索引，代价和风险都不值得；
 *   能确定的是「文件在不在、齐不齐、什么时候写进来的、日志停在哪」—— 这也正是排除法需要的。
 * · **不替用户搬文件**。分析只给结论和建议步骤，真正的停用/卸载还是走已有的安装/卸载通道。
 *
 * ## 测试
 *
 * `parseCrashXml` / `parseUe4ssLog` / `buildReport` 都是**纯函数**（不碰文件系统），
 * 见 `_probe/crashlog-test.js`。只有 `gather()` / `analyze()` / `readSource()` 才读盘。
 */

/** 最近多少个崩溃包参与分析（再多也没人看，纯拖慢） */
const MAX_CRASHES = 20;
/** 崩溃目录里最多检查多少个包（含解析失败的） */
const MAX_CRASH_DIRS = 80;
/** 单份日志最多读尾部多少字节 */
const TAIL_BYTES = 512 * 1024;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * 「不算外挂」的模块名。
 * 崩溃栈里除游戏本体以外出现的东西才是值得怀疑的 —— UE4SS.dll / 输入法 / 显卡驱动之类。
 */
const SYSTEM_MODULES = new Set([
  'SB-WIN64-SHIPPING', 'NTDLL', 'KERNELBASE', 'KERNEL32', 'USER32', 'WIN32U', 'GDI32',
  'ADVAPI32', 'WS2_32', 'COMBASE', 'RPCRT4', 'SECHOST', 'BCRYPTPRIMITIVES', 'MSVCRT',
  'VCRUNTIME140', 'VCRUNTIME140_1', 'MSVCP140', 'UCRTBASE', 'SETUPAPI', 'OLE32', 'SHELL32',
  'APPHELP', 'NTASN1', 'CRYPT32', 'DNSAPI', 'IPHLPAPI', 'NETAPI32', 'PSAPI', 'VERSION',
  'DXGI', 'D3D11', 'D3D12', 'D3D10WARP', 'DCOMP', 'DWMAPI', 'IMGUTIL', 'WINDOWS.STORAGE',
  'NVIDIA', 'NVWGF2UMX', 'NVOGLV64', 'NVAPI64', 'AMDXCPL', 'AMDFENDVR', 'ATIUXP64',
  'IGO32', 'IGD10IUMD64', 'XINPUT1_4', 'XINPUT9_1_0', 'GAMEBAR', 'AUDIOSES', 'MMDEVAPI'
]);

/**
 * UE4SS 自带的 Mod（不是玩家装的）—— 提「停用哪个注入型 Mod」时要跳过它们，
 * 否则会让人去关掉加载器本身的组件，白白浪费一轮测试。
 */
const UE4SS_BUILTIN_NAMES = new Set([
  'actordumpmod', 'bpml_genericfunctions', 'bpmodloadermod',
  'cheatmanagerenablermod', 'consolecommandsmod', 'consoleenablermod',
  'jsbluaprofiler', 'jsbluaprofilermod', 'keybinds', 'linetracemod', 'splitscreenmod', 'shared'
]);

/* ---------------- 文件小工具 ---------------- */

function statOf(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function isDir(p) {
  const s = statOf(p);
  return !!(s && s.isDirectory());
}

/**
 * 读文件**尾部**若干字节。
 * 日志动辄几十上百 MB，整份读进来再塞给界面没有意义 —— 现场永远在末尾。
 */
function readTail(file, maxBytes = TAIL_BYTES) {
  let fd = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('不是文件');
    const len = Math.min(st.size, maxBytes);
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
    let text = buf.toString('utf8');
    // 从中间截断时，头一个字符很可能是半个 UTF-8 序列 —— 去掉，免得界面开头出现乱码
    if (st.size > len) text = text.replace(/^\uFFFD/, '');
    return {
      text, size: st.size, truncated: st.size > len,
      mtime: st.mtime.toISOString(), mtimeMs: st.mtimeMs, error: ''
    };
  } catch (e) {
    return { text: '', size: 0, truncated: false, mtime: null, mtimeMs: 0, error: e.message };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
  }
}

/** 目录下一层的普通文件（不进子目录） */
function listFiles(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isFile()) continue;
    const p = path.join(dir, e.name);
    const st = statOf(p);
    out.push({
      name: e.name,
      size: st ? st.size : 0,
      mtime: st ? st.mtime.toISOString() : null,
      mtimeMs: st ? st.mtimeMs : 0,
      path: p
    });
  }
  return out;
}

/* ---------------- 位置 ---------------- */

/**
 * 定位所有和「崩溃现场」有关的位置。
 *
 * `%LOCALAPPDATA%\SB\Saved` 是 UE 给 Shipping 版游戏写的存档/日志/崩溃目录 ——
 * 它**跟着项目名走**，和游戏装在哪块盘无关（所以不能从游戏根目录推）。
 * 但便携版 / 改过 Saved 重定向的会把 `Saved` 落在游戏目录里，**这时游戏目录那份才是对的**
 * （同一台机器可能装了两份游戏，LOCALAPPDATA 只有一份），所以先看游戏目录。
 */
function locate(root) {
  const localApp = process.env.LOCALAPPDATA || process.env.APPDATA || '';
  const rootSaved = root ? path.join(root, 'SB', 'Saved') : '';
  const appSaved = localApp ? path.join(localApp, 'SB', 'Saved') : '';
  const saved = [rootSaved, appSaved].filter(Boolean).find(p => isDir(p)) || appSaved || rootSaved;

  const win64 = root ? path.join(root, 'SB', 'Binaries', 'Win64') : '';
  const ue4ssDir = win64 ? path.join(win64, 'ue4ss') : '';

  return {
    saved,
    crashes: saved ? path.join(saved, 'Crashes') : '',
    logs: saved ? path.join(saved, 'Logs') : '',
    win64,
    ue4ssDir,
    ue4ssLog: ue4ssDir ? path.join(ue4ssDir, 'UE4SS.log') : '',
    ue4ssModsDir: ue4ssDir ? path.join(ue4ssDir, 'Mods') : '',
    ue4ssSettings: ue4ssDir ? path.join(ue4ssDir, 'UE4SS-settings.ini') : '',
    modsDir: root ? path.join(root, 'SB', 'Content', 'Paks', '~Mods') : '',
    logicModsDir: root ? path.join(root, 'SB', 'Content', 'Paks', 'LogicMods') : ''
  };
}

/* ---------------- 崩溃快照解析（纯函数） ---------------- */

function tagOf(xml, tag) {
  const m = String(xml || '').match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return m ? m[1].trim() : '';
}

/** `SB-Win64-Shipping  0x0000000140000000 + 293f0ad` → { module, offset } */
function frameInfo(line) {
  const s = String(line || '').trim();
  const m = s.match(/^(\S+)\s+0x[0-9a-fA-F]+\s*\+\s*([0-9a-fA-F]+)/);
  if (m) return { module: m[1], offset: m[2].toLowerCase(), raw: s };
  return { module: (s.split(/\s+/)[0] || ''), offset: '', raw: s };
}

function splitFrames(block) {
  return String(block || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 解析一份 `CrashContext.runtime-xml`。
 *
 * @param {string} xml  XML 原文
 * @param {{guid?:string, at?:string, dmpSize?:number}} [meta] 目录名 / 文件时间 / 转储大小
 * @returns {object} 崩溃对象（字段见代码，全部是「读不到就空」的宽容解析）
 */
function parseCrashXml(xml, meta = {}) {
  const text = String(xml || '');

  // 每个 <Thread> 一个块：ThreadName / IsCrashed / CallStack 都在这块里
  const threads = [];
  for (const block of (text.match(/<Thread>[\s\S]*?<\/Thread>/g) || [])) {
    const frames = splitFrames(tagOf(block, 'CallStack'));
    threads.push({
      name: tagOf(block, 'ThreadName'),
      threadId: tagOf(block, 'ThreadID'),
      isCrashed: tagOf(block, 'IsCrashed') === 'true',
      frames
    });
  }
  const crashedThread = threads.find(t => t.isCrashed) || threads[0] || { name: '', frames: [] };

  const errorMessage = tagOf(text, 'ErrorMessage');
  const excMatch = errorMessage.match(/(EXCEPTION_[A-Z0-9_]+)/);
  const exception = excMatch ? excMatch[1]
    : (/Assertion failed/i.test(errorMessage) ? 'ASSERT' : '');
  const addrMatch = errorMessage.match(/address\s+(0x[0-9A-Fa-f]+)/);

  const frames = crashedThread.frames.map(frameInfo);
  const modules = [];
  for (const f of frames) if (f.module && !modules.includes(f.module)) modules.push(f.module);
  const foreign = modules.filter(m => !SYSTEM_MODULES.has(String(m).toUpperCase()));

  return {
    guid: meta.guid || tagOf(text, 'CrashGUID'),
    at: meta.at || null,
    dmpSize: Number(meta.dmpSize) || 0,
    crashType: tagOf(text, 'CrashType'),
    isEnsure: tagOf(text, 'IsEnsure') === 'true',
    isAssert: tagOf(text, 'IsAssert') === 'true',
    errorMessage,
    exception,
    address: addrMatch ? addrMatch[1] : '',
    secondsSinceStart: Number(tagOf(text, 'SecondsSinceStart')) || 0,
    engineVersion: tagOf(text, 'EngineVersion'),
    baseDir: tagOf(text, 'BaseDir'),
    commandLine: tagOf(text, 'CommandLine').trim(),
    processId: tagOf(text, 'ProcessId'),
    threads: threads.length,
    crashedThread: { name: crashedThread.name, frames: crashedThread.frames },
    frameOffsets: frames.map(f => f.module + '+0x' + f.offset).filter(s => !s.endsWith('+0x')),
    modules,
    foreign
  };
}

/**
 * 崩溃发生在哪个阶段。
 *
 * `SecondsSinceStart` 是引擎**自己数**的启动秒数：0 意味着连第一帧都没跑到，
 * 这类崩几乎必然是「启动期加载的东西」出的问题（蓝图 Mod / pak / 加载器注入）。
 */
function crashPhase(crash) {
  const s = Number(crash && crash.secondsSinceStart) || 0;
  const thread = (crash && crash.crashedThread && crash.crashedThread.name) || '';
  let phase;
  if ((crash && (crash.isEnsure || crash.isAssert)) || (crash && crash.exception === 'ASSERT')) phase = 'assert';
  else if (s <= 2) phase = 'startup';
  else if (s <= 60) phase = 'loading';
  else phase = 'runtime';
  return { phase, seconds: s, thread };
}

/* ---------------- UE4SS 日志解析（纯函数） ---------------- */

const UE_LINE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\]\s?(.*)$/;

/**
 * UE4SS 的时间戳是 **UTC**（实测：本地 00:16 的启动，日志里写 16:16 前一天）。
 * 所以这里自己算 ms，不能用 `new Date('2026-11-09 16:16:39')`（那会被当本地时间）。
 */
function ue4ssTimeMs(m) {
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +((m[7] + '000').slice(0, 3)) : 0);
}

/**
 * 解析 `UE4SS.log`。一次启动一份（每次启动重写），所以「最后一行」就是崩溃那一刻的现场。
 *
 * @param {string} text
 * @returns {object} 见下方字段
 */
function parseUe4ssLog(text) {
  const out = {
    version: '', gitSha: '', build: '',
    firstAtText: '', firstAtMs: 0, lastAtText: '', lastAtMs: 0,
    lastLine: '', lineCount: 0,
    startedCpp: [], startedLua: [], disabled: [],
    bpMods: [], bpAssetPaths: [],
    lastLoadingMod: '', loadOrderMissing: false,
    eventLoopStarted: false, hooks: 0,
    errors: []
  };

  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    out.lineCount++;

    const m = t.match(UE_LINE);
    let body = t;
    if (m) {
      const ms = ue4ssTimeMs(m);
      if (!out.firstAtMs) { out.firstAtMs = ms; out.firstAtText = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6]; }
      out.lastAtMs = ms;
      out.lastAtText = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
      body = m[8];
    } else if (/^#+(\s|$)/.test(t) || /^Support development/.test(t)) {
      continue; // Dekitarpg 那种 ASCII 横幅（整行 # 号或 # 号打头），不算「最后一行」
    }

    out.lastLine = body.slice(0, 400);

    let mm;
    // 例：`UE4SS - v3.0.1 Beta #0 - Git SHA #47477f8`
    if ((mm = body.match(/^UE4SS - (v[\d.]+[^-]*)-\s*Git SHA #([0-9a-fA-F]+)/))) {
      out.version = mm[1].trim();
      out.gitSha = mm[2];
    }
    if ((mm = body.match(/^UE4SS Build Configuration:\s*(.+)$/))) out.build = mm[1].trim();
    if ((mm = body.match(/^Starting C\+\+ mod '(.+?)'/))) out.startedCpp.push(mm[1]);
    if ((mm = body.match(/^Starting Lua mod '(.+?)'/))) out.startedLua.push(mm[1]);
    if ((mm = body.match(/^Mod '(.+?)' disabled in mods\.txt/))) out.disabled.push(mm[1]);
    if ((mm = body.match(/\[BPModLoaderMod\]\s+(.+?)\s+==\s+table:/))) {
      if (!out.bpMods.includes(mm[1])) out.bpMods.push(mm[1]);
    }
    if ((mm = body.match(/\[BPModLoaderMod\]\s+AssetPath == (.+)$/))) out.bpAssetPaths.push(mm[1].trim());
    if ((mm = body.match(/\[BPModLoaderMod\] Loading mod:\s*(.+)$/))) out.lastLoadingMod = mm[1].trim();
    if (/load_order\.txt not present or no matching mods/.test(body)) out.loadOrderMissing = true;
    if (/Event loop start/.test(body)) out.eventLoopStarted = true;
    if (/Registered native hook/.test(body)) out.hooks++;
    if (/\b(?:error|failed|failure|exception|cannot|not found|denied|attempt to)\b/i.test(body) &&
        !/^UObject/.test(body) && out.errors.length < 40) {
      out.errors.push(body.slice(0, 300));
    }
  }

  // 去重但保留首次出现的顺序
  out.startedCpp = [...new Set(out.startedCpp)];
  out.startedLua = [...new Set(out.startedLua)];
  out.disabled = [...new Set(out.disabled)];
  out.bpAssetPaths = [...new Set(out.bpAssetPaths)];
  return out;
}

/* ---------------- 目录盘点（读盘） ---------------- */

/** 容器基名：`Foo_P [nx12].ucas` → `Foo_P [nx12]` */
const CONTAINER_EXT = /\.(pak|ucas|utoc)$/i;
const CNS_EXT = /\.dekcns\.json$/i;
const DISABLED_EXT = /\.disabled$/i;

/**
 * 盘点一套加载目录：把 .pak/.ucas/.utoc 按基名归组，顺带把 `.dekcns.json` 收进来。
 * `~Mods`、`LogicMods`、`~Mods` 下的子目录都走这一份。
 */
function inventory(dir, { depth = 0 } = {}) {
  const out = { dir, groups: [], jsons: [], others: [], exists: isDir(dir) };
  if (!out.exists) return out;

  const walk = (d, level) => {
    const files = listFiles(d);
    for (const f of files) {
      const disabled = DISABLED_EXT.test(f.name);
      const base = f.name.replace(DISABLED_EXT, '');
      if (CONTAINER_EXT.test(base)) {
        const key = base.replace(CONTAINER_EXT, '');
        let g = out.groups.find(x => x.key.toLowerCase() === key.toLowerCase());
        if (!g) {
          g = { key, ext: {}, files: [], size: 0, newestMs: 0, newest: null, disabled: false, subdir: level > 0 ? d : '' };
          out.groups.push(g);
        }
        const ext = (base.match(CONTAINER_EXT) || [, ''])[1].toLowerCase();
        g.ext[ext] = true;
        g.files.push({ name: f.name, size: f.size, mtime: f.mtime, disabled, path: f.path });
        g.size += f.size;
        if (f.mtimeMs > g.newestMs) { g.newestMs = f.mtimeMs; g.newest = f.mtime; }
        if (disabled) g.disabled = true;
      } else if (CNS_EXT.test(base)) {
        out.jsons.push({ name: base, size: f.size, mtime: f.mtime, mtimeMs: f.mtimeMs, path: f.path });
      } else {
        out.others.push({ name: f.name, size: f.size, mtime: f.mtime, mtimeMs: f.mtimeMs, path: f.path });
      }
    }
    if (level >= depth) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory()) walk(path.join(d, e.name), level + 1);
  };

  walk(dir, 0);
  return out;
}

/* ---------------- 报告（纯函数） ---------------- */

function fmtLocal(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function fmtLocalFull(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** 一个 Mod 的文件里最晚的修改时间 */
function modNewestMs(mod) {
  let t = 0;
  for (const f of (mod && mod.files) || []) {
    const v = f && f.mtime ? Date.parse(f.mtime) : 0;
    if (v > t) t = v;
  }
  return t;
}

/** 一个 Mod 的容器基名（小写，去掉扩展名），用来和 UE4SS 日志里的名字对号 */
function modBaseNames(mod) {
  const names = [];
  for (const f of (mod && mod.files) || []) {
    const base = String((f && f.name) || '').replace(DISABLED_EXT, '').replace(CONTAINER_EXT, '');
    if (base) names.push(base.toLowerCase());
  }
  if (mod && mod.name) names.push(String(mod.name).toLowerCase());
  return [...new Set(names)];
}

/**
 * 生成诊断报告。**纯函数**：所有输入都从参数进来，方便断言（见 `_probe/crashlog-test.js`）。
 *
 * @param {{
 *   now?: number,
 *   ue4ss?: object,                 parseUe4ssLog() 的结果
 *   crashes?: object[],             parseCrashXml() 的结果，新到旧
 *   mods?: object[],                扫描出来的已装 Mod
 *   files?: object,                 见 gather()
 *   env?: object,                   路径 / 版本这类展示用信息
 * }} input
 */
function buildReport(input = {}) {
  const {
    now = Date.now(),
    ue4ss = {},
    crashes = [],
    mods = [],
    files = {},
    env = {}
  } = input;

  const findings = [];
  const add = (level, title, detail, extra = {}) => findings.push({ level, title, detail, ...extra });

  /* ---- 崩溃统计 ---- */
  const withPhase = crashes.map(c => ({ ...c, ...crashPhase(c) }));
  const stats = {
    total: withPhase.length,
    startup: withPhase.filter(c => c.phase === 'startup').length,
    loading: withPhase.filter(c => c.phase === 'loading').length,
    runtime: withPhase.filter(c => c.phase === 'runtime').length,
    assert: withPhase.filter(c => c.phase === 'assert').length,
    lastAt: withPhase.length ? withPhase[0].at : null,
    exceptions: {},
    threads: {}
  };
  for (const c of withPhase) {
    const k = c.exception || '未知异常';
    stats.exceptions[k] = (stats.exceptions[k] || 0) + 1;
    const th = (c.crashedThread && c.crashedThread.name) || '未知线程';
    stats.threads[th] = (stats.threads[th] || 0) + 1;
  }

  /* ---- 嫌疑打分 ---- */
  const sus = new Map();
  const bump = (mod, pts, reason) => {
    if (!mod || !pts) return;
    const key = mod.id || mod.name;
    if (!sus.has(key)) sus.set(key, { id: mod.id || '', name: mod.name || key, kind: mod.kind || '', score: 0, reasons: [], files: [], location: mod.location || '' });
    const s = sus.get(key);
    s.score += pts;
    if (reason && !s.reasons.includes(reason)) s.reasons.push(reason);
    for (const f of (mod.files || [])) if (f && f.name) s.files.push(f.name);
  };

  const newest = withPhase[0] || null;
  const sessionStartMs = ue4ss.firstAtMs || (newest && newest.at ? Date.parse(newest.at) : 0) || 0;
  const startupish = withPhase.filter(c => c.phase === 'startup' || c.phase === 'loading');

  /** 容器基名 → Mod，方便按文件对号 */
  const byBase = new Map();
  for (const m of mods) {
    for (const n of modBaseNames(m)) if (!byBase.has(n)) byBase.set(n, m);
  }

  // 蓝图 Mod 兜底：上层传进来的扫描结果可能没包含 LogicMods 里的它们（或被过滤掉了），
  // 这里用目录清点结果自己造一个嫌疑对象，保证结论和步骤不会因为「没扫到」而消失
  const logicGroups = new Map();
  for (const g of ((files.logic && files.logic.groups) || [])) logicGroups.set(g.key.toLowerCase(), g);
  const logicGroupFor = (name) => {
    const n = String(name).toLowerCase();
    const exact = logicGroups.get(n);
    if (exact) return exact;
    for (const [k, g] of logicGroups) if (k.startsWith(n) || n.startsWith(k)) return g;
    return null;
  };
  const bpModOf = (name) => {
    const hit = byBase.get(String(name).toLowerCase());
    if (hit) return hit;
    const g = logicGroupFor(name);
    return {
      id: 'bp:' + name,
      name: String(name),
      kind: 'bp',
      location: 'LogicMods',
      files: g ? g.files.map(f => ({ name: f.name })) : []
    };
  };

  // ① BP（蓝图）Mod 载入阶段：UE4SS 日志停在 `Loading mod: X` 之后 —— 这是最硬的证据
  const bpLast = ue4ss.lastLoadingMod || '';
  const bpUnfinished = !!bpLast && !ue4ss.eventLoopStarted;
  const bpCount = (ue4ss.bpMods || []).length;
  // 日志最后一次输出与崩溃快照时间的距离：BP Mod 的 ModActor 就是在
  // `Event loop start` 之后挂进世界的，两者贴着就说明崩在这一步
  const lastLogMs = ue4ss.lastAtMs || 0;
  const crashMs = newest && newest.at ? Date.parse(newest.at) : 0;
  const logEndsAtCrash = !!(lastLogMs && crashMs && Math.abs(crashMs - lastLogMs) <= 60 * 1000);
  const startupishCount = startupish.length;

  for (const bpName of ue4ss.bpMods || []) {
    // 没有崩溃记录就不指认任何人 —— 日志停在 `Loading mod` 也可能只是游戏还在跑
    if (!withPhase.length) break;
    const mod = bpModOf(bpName);
    if (!mod) continue;
    if (bpLast && String(bpName).toLowerCase() === bpLast.toLowerCase()) {
      bump(mod, bpUnfinished ? 45 : 30,
        'UE4SS 最后一行是「Loading mod: ' + bpName + '」' + (bpUnfinished ? '，连 Event loop 都没走到' : ''));
    } else if (logEndsAtCrash && startupishCount) {
      bump(mod, 22, '启动期崩溃，而这次启动里 BP Mod 正在挂载（load_order 随机，先后不固定）');
    } else {
      bump(mod, 10, '同为 BP 蓝图 Mod，启动时会被一起挂载');
    }
  }
  if (logEndsAtCrash && bpCount && !bpLast) {
    add('warn', '日志停在启动完成的那一刻',
      'UE4SS 最后一次输出是 `' + (ue4ss.lastLine || '—') + '`（' + fmtLocalFull(lastLogMs) + '），崩溃快照写于 ' +
      fmtLocalFull(crashMs) + '，相差不到一分钟。这正是蓝图 Mod 的 ModActor 往世界里挂载的时间点，' +
      '而这次启动里被挂载的 BP Mod 有：' + (ue4ss.bpMods || []).join('、') + '。');
  }
  if (bpUnfinished) {
    add('error', '日志断在蓝图 Mod 载入中途',
      'UE4SS.log 最后一行是 `Loading mod: ' + bpLast + '`，之后没有任何输出，也没到 `Event loop start` —— ' +
      '崩溃就发生在把 BP Mod 的 ModActor 挂进世界的这一步。');
  }
  if (ue4ss.loadOrderMissing) {
    add('warn', 'BP Mod 没有固定加载顺序',
      '`Mods/BPModLoaderMod/load_order.txt` 没被采纳，加载器按**随机顺序**枚举蓝图 Mod，' +
      '所以「哪个 Mod 先挂上去」每次都可能不同 —— 排查时要用「移出去一个再试」的排除法，不能只看一次日志。');
  }

  // ② 时间相关：最近一次启动之前新装 / 刚改过的 Mod
  if (sessionStartMs) {
    for (const m of mods) {
      const t = modNewestMs(m);
      if (!t) continue;
      const hours = (sessionStartMs - t) / HOUR;
      if (hours < 0 || hours > 7 * 24) continue;
      if (hours <= 2) bump(m, 25, '文件写入时间 ' + fmtLocal(t) + '，就在最近一次启动前不到 2 小时');
      else if (hours <= 24) bump(m, 15, '文件写入时间 ' + fmtLocal(t) + '（最近一次启动前 ' + Math.round(hours) + ' 小时）');
      else if (startupish.length) bump(m, 6, '文件写入时间 ' + fmtLocal(t) + '（' + Math.round(hours / 24) + ' 天前，这期间一直崩）');
    }
  }

  // ③ 崩溃栈里出现了 UE4SS.dll → 崩在加载器注入的代码路径上，注入型 Mod（C++ / Lua）嫌疑上升
  const ue4ssInStack = withPhase.some(c => (c.modules || []).some(m => /UE4SS/i.test(m)));
  if (ue4ssInStack) {
    add('warn', '崩溃栈里出现了 UE4SS.dll',
      '说明崩溃时执行的是**加载器注入的代码**（原生 hook / Lua 回调 / BP 装载），不是纯游戏逻辑。' +
      '这类崩溃通常由某个 Mod 的注入点触发，退出游戏没用，得把 Mod 移出去。');
    for (const m of mods) {
      const injected = (m.files || []).some(f => /\.dll$/i.test(f.name || '')) ||
        (ue4ss.startedCpp || []).some(n => modBaseNames(m).includes(String(n).toLowerCase()));
      if (injected) bump(m, 12, 'C++ 注入型 Mod（带 main.dll），崩溃栈里有 UE4SS.dll');
    }
  }

  // ④ 文件完整性：容器三件套 / 零字节 / 孤儿 CNS 索引 / 同名冲突
  const inv = files.mods || null;
  const invLogic = files.logic || null;

  const checkInv = (inventoryData, label) => {
    if (!inventoryData || !inventoryData.exists) return;
    for (const g of inventoryData.groups) {
      const ext = g.ext || {};
      // ⚠️ ext 的键是**带点**的扩展名（`.pak` / `.ucas` / `.utoc`），别写成 ext.ucas
      if (ext['.ucas'] && !ext['.utoc']) {
        add('error', '容器文件不完整：' + g.key,
          label + ' 里 `' + g.key + '.ucas` 在，但缺 `.utoc` —— IoStore 容器缺索引文件，游戏加载到它时会直接崩。',
          { path: g.files[0] && g.files[0].path });
      }
      if (ext['.utoc'] && !ext['.ucas']) {
        add('error', '容器文件不完整：' + g.key,
          label + ' 里 `' + g.key + '.utoc` 在，但缺 `.ucas` —— 只有索引没有数据，同样会让加载线程崩。',
          { path: g.files[0] && g.files[0].path });
      }
      for (const f of g.files) {
        if (!f.size) add('error', '零字节文件：' + f.name, label + ' 里这个文件是 0 字节，多半是拷贝/下载中断留下的残骸。', { path: f.path });
      }
    }
    // CNS 换装索引：`.dekcns.json` 的名字和 pak 名**天生不同名**（索引名是换装列表里的显示名），
    // 所以不能按「同名配对」判断缺失，只能报个数量，让人自己核对换装列表
    const jsonCount = inventoryData.jsons.length;
    if (jsonCount) {
      add('info', label + ' 里有 ' + jsonCount + ' 个 CNS 换装索引（.dekcns.json）',
        '这些是换装框架的索引文件，名字和 pak 不一定相同，谁对应谁只有框架自己知道。' +
        '只有出现「换装列表里点了没反应 / 名字对不上」时才需要逐个核对这一批。');
    }
  };
  checkInv(inv, '~Mods');
  checkInv(invLogic, 'LogicMods');

  // 同一容器名同时出现在 ~Mods 与 LogicMods —— 两套加载机制互不相通，同名会互相抢
  if (inv && invLogic && inv.exists && invLogic.exists) {
    const logicKeys = new Map(invLogic.groups.map(g => [g.key.toLowerCase(), g]));
    for (const g of inv.groups) {
      if (!logicKeys.has(g.key.toLowerCase())) continue;
      add('warn', '同名容器出现在两套加载机制里：' + g.key,
        '`~Mods` 和 `LogicMods` 各有一份同名容器。两者走的是**不同的加载路径**（pak 挂载 vs 蓝图 Mod），' +
        '放混了经常出现「只有一个生效」或者「加载两次互相顶掉」。',
        { path: g.files[0] && g.files[0].path });
      const mod = byBase.get(g.key.toLowerCase());
      if (mod) bump(mod, 15, '同名容器同时存在于 ~Mods 与 LogicMods');
    }
  }

  // .dekcns.json 语法（尾逗号这类）—— CNS 自己大多能容忍，只当提示，不当致崩原因
  const badJson = (files.dekcnsBad || []);
  if (badJson.length) {
    add('info', '有 ' + badJson.length + ' 个 `.dekcns.json` 不是严格合法的 JSON',
      '涉及：' + badJson.slice(0, 6).join('、') + (badJson.length > 6 ? ' 等' : '') +
      '。多半是作者手改留下的尾逗号；CNS 一般能读，但如果换装完全不生效，先怀疑它们。');
  }

  // ⑤ mods.txt 与 ue4ss\Mods 对不上
  const modsTxt = files.modsTxt || null;
  if (modsTxt && modsTxt.map) {
    const dirs = new Set((files.ue4ssModDirs || []).map(n => n.toLowerCase()));
    const listed = Object.keys(modsTxt.map || {});
    for (const name of listed) {
      if (!dirs.has(name.toLowerCase())) {
        add('warn', 'mods.txt 里的 Mod 目录不存在：' + name,
          '`ue4ss\\Mods\\mods.txt` 写了 `' + name + ' : ' + (modsTxt.map[name] ? '1' : '0') +
          '`，但 `ue4ss\\Mods\\' + name + '` 这个目录没有 —— 加载器会跳过，一般无害，但说明 Mod 目录被删过而配置没同步。');
      }
    }
    const enabledCpp = listed.filter(n => modsTxt.map[n]);
    if (enabledCpp.length) {
      add('info', 'C++ / 脚本注入型 Mod 处于启用状态',
        'mods.txt 里开着的就是这些：' + enabledCpp.join('、') +
        '。它们和游戏本体一起在启动期执行代码，出问题时**最先怀疑它们**。');
    }
  }

  // ⑥ 环境提示：没有游戏日志 / 转储不含内存 / 内存上限设置
  if (files.gameLogFiles && files.gameLogFiles.length === 0) {
    add('info', '游戏本体没有留下日志',
      '`%LOCALAPPDATA%\\SB\\Saved\\Logs` 里没有 `SB.log` —— Shipping 版默认不写文件日志，所以崩溃现场只能靠 ' +
      'UE4SS.log 和引擎的崩溃快照。想看更细的加载过程，可以在游戏快捷方式里加启动参数 `-log` 开控制台。');
  }
  if (withPhase.some(c => c.dmpSize && c.dmpSize < 8 * 1024 * 1024)) {
    add('info', '崩溃转储不完整',
      '每份 `UE4Minidump.dmp` 只有 1 MB 上下，取不到具体是哪个资源/文件崩的。' +
      '把 `ue4ss\\UE4SS-settings.ini` 的 `FullMemoryDump` 改成 1 能拿到完整内存（体积很大，只在需要时开）。');
  }
  const memCap = files.assetLoadingMemCap;
  const asyncCount = withPhase.filter(c => /ASYNC/i.test((c.crashedThread && c.crashedThread.name) || '')).length;
  if (asyncCount && withPhase.length && asyncCount / withPhase.length >= 0.4) {
    add('info', '异步加载线程崩得多',
      '最近 ' + withPhase.length + ' 次崩溃里有 ' + asyncCount + ' 次死在 `FAsyncLoadingThread`（加载 pak / 资源时读野指针）。' +
      (memCap ? '`UE4SS-settings.ini` 里 `MaxMemoryUsageDuringAssetLoading=' + memCap + '`，' : '') +
      '如果 Mod 数量大、单个 pak 上百 MB，把这个值降到 50 左右往往能缓解。');
  }

  // ⑦ 排序 + 结论
  // 没有崩溃记录时不指认任何 Mod：这时唯一能说的是「没现场」，让人去看别的
  const suspects = stats.total ? [...sus.values()]
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
    .slice(0, 8) : [];

  let verdict;
  const top = suspects[0];
  const startupCount = stats.startup + stats.loading;
  if (!stats.total) {
    verdict = {
      level: 'none',
      headline: '还没抓到崩溃记录',
      detail: '游戏没崩过（或崩溃目录被清过）。可以正常玩；万一崩了，回这页点「重新分析」就有现场。'
    };
  } else if (top && top.score >= 40) {
    verdict = {
      level: 'high',
      headline: '最可能是「' + top.name + '」',
      detail: top.reasons[0] || ''
    };
  } else if (top && top.score >= 22) {
    verdict = {
      level: 'mid',
      headline: '比较可疑：' + top.name,
      detail: top.reasons[0] || ''
    };
  } else if (top) {
    verdict = {
      level: 'low',
      headline: '有 ' + suspects.length + ' 个 Mod 值得先试',
      detail: '证据还不够硬，建议按下面的顺序逐个排除。'
    };
  } else if (stats.total && startupCount && (ue4ss.bpMods || []).length) {
    // 启动期就崩、又有蓝图 Mod 在挂载 —— 没有单个 mod 的硬证据，但排除方向是明确的
    verdict = {
      level: 'low',
      headline: '启动期崩溃，先按蓝图 Mod 逐个排除',
      detail: '最近 ' + startupCount + ' 次崩溃都发生在引擎启动阶段（`SecondsSinceStart` ≈ 0），' +
        '而这几次启动里挂了 ' + ue4ss.bpMods.length + ' 个蓝图 Mod（' + ue4ss.bpMods.join('、') + '）。' +
        '此类崩溃的栈永远落在游戏本体里，日志也只能指到「正在挂载」，所以要靠移出文件对撞来定型。'
    };
  } else {
    verdict = {
      level: 'none',
      headline: '没有找到能指向具体 Mod 的证据',
      detail: '崩溃都发生在游戏本体内部，且近期没有新增/改动的 Mod。先排查游戏文件完整性与 UE4SS 版本。'
    };
  }

  // ⑧ 排除步骤：给一条能照着做的路，而不是「自己一个个试」
  const steps = [];
  const bpTop = (ue4ss.bpMods || []).map(n => bpModOf(n)).filter(Boolean);
  const bpHard = bpLast && bpTop.find(m => modBaseNames(m).includes(bpLast.toLowerCase()));
  if (bpTop.length === 1) {
    steps.push('先把「' + bpTop[0].name + '」的 .pak/.ucas/.utoc 移出 `LogicMods` 再启动一次' +
      '（移出目录就等于停用，不用卸载）。');
  } else if (bpTop.length > 1 && bpHard) {
    steps.push('先把「' + bpHard.name + '」移出 `LogicMods`（日志停在这一步，它是第一个要试的），启动一次看还崩不崩。');
  } else if (bpTop.length > 1) {
    steps.push('先把 `LogicMods` 里的蓝图 Mod **全部**移出去（' + bpTop.map(m => m.name).join('、') +
      '），启动一次确认不崩；再逐个放回 —— 谁放回去就崩，谁就是元凶。');
  }
  const cnsInLogic = logicGroups.has('dekcns_p') || logicGroups.has('dekcnsp') ||
    mods.some(m => /DekCNS/i.test(m.name || '') || modBaseNames(m).some(n => /dekcns_p/.test(n)));
  // BP Mod 名单里已经有 CNS 主体时不必再单列一步（它在第一步就被移出去了）
  const cnsInBp = bpTop.some(m => /dekcns/i.test(m.name || '') || modBaseNames(m).some(n => /dekcns_p/.test(n)));
  if (cnsInLogic && !cnsInBp) {
    steps.push('接着把 CNS 主体（`LogicMods\\DekCNS_P.*`）也移出去 —— 所有 CNS 换装包都靠它挂载，它一坏全都牵连。');
  } else if (cnsInLogic && cnsInBp) {
    steps.push('注意 `DekCNS_P` 就是 CNS 换装框架本体（`~Mods` 里那批换装包都靠它挂载）—— ' +
      '如果移出蓝图 Mod 后就不崩了，说明问题在换装框架这一层，先别急着把换装包逐个试。');
  }
  // 停用注入型 Mod：优先用「这次启动确实注入了的自写 C++ Mod」，而不是 UE4SS 自带的脚本 Mod
  const cppOn = ((files.modsTxt && files.modsTxt.map) ? Object.keys(files.modsTxt.map).filter(n => files.modsTxt.map[n]) : []);
  const cppPick = (ue4ss.startedCpp && ue4ss.startedCpp[0]) ||
    cppOn.find(n => !UE4SS_BUILTIN_NAMES.has(String(n).toLowerCase())) || '';
  if (cppPick) {
    steps.push('再把 `ue4ss\\Mods\\mods.txt` 里 `' + cppPick + ' : 1` 改成 `0`（等于停用这个注入型 Mod）再启动。');
  }
  steps.push('`~Mods` 整个改名（比如加个 `_off` 后缀）再启动：**还崩**就说明不是 Mod 的问题，' +
    '而是游戏本体或 UE4SS 版本 —— 那时去 Steam 校验文件完整性，或换一个 UE4SS 版本。');
  // 没有崩溃记录就没什么可排除的，别拿步骤去唬人
  if (!stats.total) steps.length = 0;

  return {
    generatedAt: new Date(now).toISOString(),
    env,
    ue4ss: {
      version: ue4ss.version || '',
      gitSha: ue4ss.gitSha || '',
      build: ue4ss.build || '',
      firstAtMs: ue4ss.firstAtMs || 0,
      firstAt: ue4ss.firstAtMs ? fmtLocalFull(ue4ss.firstAtMs) : '',
      lastAt: ue4ss.lastAtMs ? fmtLocalFull(ue4ss.lastAtMs) : '',
      lastLine: ue4ss.lastLine || '',
      lastLoadingMod: ue4ss.lastLoadingMod || '',
      eventLoopStarted: !!ue4ss.eventLoopStarted,
      loadOrderMissing: !!ue4ss.loadOrderMissing,
      startedCpp: ue4ss.startedCpp || [],
      startedLua: ue4ss.startedLua || [],
      disabled: ue4ss.disabled || [],
      bpMods: ue4ss.bpMods || [],
      bpAssetPaths: ue4ss.bpAssetPaths || [],
      hooks: ue4ss.hooks || 0,
      errors: ue4ss.errors || [],
      lineCount: ue4ss.lineCount || 0
    },
    crashes: withPhase,
    stats,
    analysis: { verdict, suspects, findings, steps }
  };
}

/* ---------------- 读盘汇总 ---------------- */

/** 解析 `mods.txt`（`Name : 0/1`，`;` 开头是注释） */
function parseModsTxt(text) {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith(';')) continue;
    const m = t.match(/^(.+?)\s*:\s*([01])\s*$/);
    if (m) map[m[1].trim()] = m[2] === '1';
  }
  return { map, count: Object.keys(map).length };
}

/** 读 `UE4SS-settings.ini` 里几个和崩溃有关的键 */
function readUe4ssSettings(file) {
  const out = { assetLoadingMemCap: 0, fullMemoryDump: null, guiConsole: null };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  let m;
  if ((m = text.match(/^\s*MaxMemoryUsageDuringAssetLoading\s*=\s*(\d+)/m))) out.assetLoadingMemCap = Number(m[1]);
  if ((m = text.match(/^\s*FullMemoryDump\s*=\s*([01])/m))) out.fullMemoryDump = m[1] === '1';
  if ((m = text.match(/^\s*GuiConsoleEnabled\s*=\s*([01])/m))) out.guiConsole = m[1] === '1';
  return out;
}

/** 收集崩溃目录（目录名 + XML 时间 + dump 大小），新到旧 */
function listCrashDirs(crashesDir) {
  let ents = [];
  try { ents = fs.readdirSync(crashesDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const dir = path.join(crashesDir, e.name);
    const xml = path.join(dir, 'CrashContext.runtime-xml');
    const st = statOf(xml);
    if (!st || !st.isFile()) continue;
    const dmp = statOf(path.join(dir, 'UE4Minidump.dmp'));
    out.push({ dir, xml, guid: e.name, at: st.mtime.toISOString(), mtimeMs: st.mtimeMs, dmpSize: dmp ? dmp.size : 0 });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, MAX_CRASH_DIRS);
}

/**
 * 收集所有现场，产出给界面用的完整报告。
 *
 * @param {{root?:string, mods?:object[], gameVersion?:object, now?:number}} opts
 */
function analyze(opts = {}) {
  const { root = '', mods = [], gameVersion = null, now = Date.now() } = opts;
  const L = locate(root);

  /* UE4SS 日志 */
  const logRead = L.ue4ssLog ? readTail(L.ue4ssLog, TAIL_BYTES) : { text: '', size: 0, mtime: null, error: '没有游戏目录' };
  const ue4ss = parseUe4ssLog(logRead.text);
  if (logRead.truncated) {
    // 只读了尾巴：文件开头的版本号可能被切掉，从全文补一次（首行很小，代价可忽略）
    try {
      const head = fs.readFileSync(L.ue4ssLog, 'utf8').slice(0, 4000);
      const headParsed = parseUe4ssLog(head);
      if (!ue4ss.version && headParsed.version) {
        ue4ss.version = headParsed.version;
        ue4ss.gitSha = headParsed.gitSha;
        ue4ss.build = headParsed.build;
      }
      if (!ue4ss.firstAtMs && headParsed.firstAtMs) {
        ue4ss.firstAtMs = headParsed.firstAtMs;
        ue4ss.firstAtText = headParsed.firstAtText;
      }
    } catch { /* 读不到就算了 */ }
  }

  /* 崩溃包 */
  const dirs = L.crashes ? listCrashDirs(L.crashes) : [];
  const crashes = [];
  for (const d of dirs.slice(0, MAX_CRASHES)) {
    let xml = '';
    try { xml = fs.readFileSync(d.xml, 'utf8'); } catch { continue; }
    try {
      crashes.push({ ...parseCrashXml(xml, { guid: d.guid, at: d.at, dmpSize: d.dmpSize }), xml: d.xml, dir: d.dir });
    } catch { /* 单份坏了不影响其它 */ }
  }

  /* 目录盘点 */
  const files = {
    mods: inventory(L.modsDir, { depth: 1 }),
    logic: inventory(L.logicModsDir, { depth: 1 }),
    modsTxt: null,
    ue4ssModDirs: [],
    gameLogFiles: [],
    dekcnsBad: []
  };
  try {
    const txt = fs.readFileSync(path.join(L.ue4ssModsDir, 'mods.txt'), 'utf8');
    files.modsTxt = parseModsTxt(txt);
  } catch { /* 没装 UE4SS / 没有 mods.txt */ }
  try {
    files.ue4ssModDirs = fs.readdirSync(L.ue4ssModsDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
  } catch { /* 忽略 */ }

  const settings = readUe4ssSettings(L.ue4ssSettings);
  files.assetLoadingMemCap = settings.assetLoadingMemCap;

  // 游戏日志（Shipping 版一般一个都没有，有的话列出来让人能点开看）
  if (L.logs) {
    const st = statOf(L.logs);
    if (st && st.isDirectory()) {
      try {
        files.gameLogFiles = listFiles(L.logs)
          .filter(f => /\.log$/i.test(f.name))
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, 10);
      } catch { /* 忽略 */ }
    }
  }

  // .dekcns.json 的严格语法检查（只做提示，见 buildReport 的说明）
  for (const inv of [files.mods, files.logic]) {
    for (const j of (inv && inv.jsons) || []) {
      let text = '';
      try { text = fs.readFileSync(j.path, 'utf8'); } catch { continue; }
      try { JSON.parse(text); }
      catch { files.dekcnsBad.push(j.name); }
    }
  }

  const env = {
    root: root || '',
    ue4ssLog: L.ue4ssLog,
    ue4ssLogExists: !!statOf(L.ue4ssLog),
    ue4ssLogSize: logRead.size || 0,
    ue4ssLogAt: logRead.mtime || null,
    crashesDir: L.crashes,
    crashCount: dirs.length,
    logsDir: L.logs,
    savedDir: L.saved,
    modsDir: L.modsDir,
    logicModsDir: L.logicModsDir,
    gameVersion: (gameVersion && gameVersion.version) || '',
    ue4ssFullMemoryDump: settings.fullMemoryDump,
    ue4ssGuiConsole: settings.guiConsole,
    modsCount: mods.length
  };

  return buildReport({ now, ue4ss, crashes, mods, files, env });
}

/* ---------------- 给界面读原文 ---------------- */

/**
 * 按「来源」读一段原文给日志查看器。
 *
 * ⚠️ `file` 只允许是**已知根目录里**的文件（崩溃目录 / 游戏日志目录 / UE4SS 目录）——
 *    渲染层传来的路径不能被当成任意文件读取的入口。
 *
 * @param {{root?:string, kind:string, file?:string, maxBytes?:number}} opts
 */
function readSource(opts = {}) {
  const { root = '', kind = 'ue4ss', file = '', maxBytes = TAIL_BYTES } = opts;
  const L = locate(root);
  const norm = (p) => { try { return path.resolve(p); } catch { return ''; } };

  const allowRoots = [L.crashes, L.logs, L.ue4ssDir].filter(Boolean).map(norm);
  const inside = (p) => {
    const t = norm(p);
    if (!t) return false;
    return allowRoots.some(r => r && (t.toLowerCase() === r.toLowerCase() ||
      t.toLowerCase().startsWith(r.toLowerCase() + path.sep)));
  };

  if (kind === 'ue4ss') {
    if (!L.ue4ssLog) throw new Error('没有找到 UE4SS.log（没装 UE4SS 或游戏目录不对）');
    const r = readTail(L.ue4ssLog, maxBytes);
    return { kind, file: L.ue4ssLog, text: r.text, size: r.size, truncated: r.truncated, mtime: r.mtime };
  }

  if (kind === 'crash') {
    const target = file || (listCrashDirs(L.crashes)[0] || {}).xml || '';
    if (!target) throw new Error('崩溃目录里没有 CrashContext');
    if (!inside(target)) throw new Error('这个路径不在崩溃目录里');
    const r = readTail(target, maxBytes);
    return { kind, file: target, text: r.text, size: r.size, truncated: r.truncated, mtime: r.mtime };
  }

  if (kind === 'gamelog' || kind === 'file') {
    if (!file) throw new Error('没有指定文件');
    if (!inside(file)) throw new Error('这个路径不在游戏日志 / UE4SS / 崩溃目录里');
    const r = readTail(file, maxBytes);
    return { kind, file, text: r.text, size: r.size, truncated: r.truncated, mtime: r.mtime };
  }

  throw new Error('未知的日志来源：' + kind);
}

module.exports = {
  // 位置 / 读盘
  locate, analyze, readSource, inventory, listCrashDirs, parseModsTxt, readUe4ssSettings,
  // 纯函数（测试用）
  parseCrashXml, parseUe4ssLog, crashPhase, buildReport, frameInfo,
  // 常量
  MAX_CRASHES, MAX_CRASH_DIRS, TAIL_BYTES, SYSTEM_MODULES
};
