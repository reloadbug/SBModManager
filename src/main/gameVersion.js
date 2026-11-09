/**
 * 读游戏版本号：从 `SB-Win64-Shipping.exe` 的 PE 版本资源里取。
 *
 * 走过的弯路（留着给以后的人看）：
 * ① 一开始想「把文件读进内存，找 VS_FIXEDFILEINFO 的签名 0xFEEF04BD」——
 *    本作主程序 317MB，整读一次要几十秒（杀毒软件挨个扇区扫），还找不到：
 *    资源段不在文件前 24MB 里。→ 改成按 PE 结构定位，只读几个 KB。
 * ② 也想过跑 PowerShell / wmic 读 FileVersion：那是同步起进程，慢，还要依赖系统组件。
 *
 * 现在的做法：DOS 头 → PE 头 → 可选头里的数据目录[2]（资源表）→ 逐层走三个目录
 * （RT_VERSION(16) → 资源名(1) → 语言(取第一个)）→ 读 VS_VERSIONINFO：
 * 数值取 VS_FIXEDFILEINFO（dwFileVersionMS/LS），字符串取 StringFileInfo 里的
 * `FileVersion` / `ProductVersion`（厂商写法不统一，展示优先用字符串）。
 *
 * 只读、不写盘；探针可以用合成 PE 文件断言（见 _probe/gameversion-test.js）。
 */
const fs = require('fs');
const path = require('path');
const game = require('./game');

const SIG = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);   // 0xFEEF04BD，小端
const RT_VERSION = 16;
const MAX_RES_DIR = 256 * 1024;                       // 资源目录本身很小，读这么多足够

/* ---------- PE 结构 ---------- */

/** 读一个小结构（直接同步读，调用点都是几 KB） */
function readAt(fd, off, len) {
  const buf = Buffer.allocUnsafe(len);
  const n = fs.readSync(fd, buf, 0, len, off);
  return n === len ? buf : buf.slice(0, n);
}

/** 解析 PE 头，返回 { sections, resRva, resSize } 或 null */
function peHeader(fd, fileSize) {
  if (fileSize < 0x40) return null;
  const dos = readAt(fd, 0, 0x40);
  if (dos.length < 0x40 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
  const peOff = dos.readUInt32LE(0x3c);
  if (peOff + 24 > fileSize) return null;
  const head = readAt(fd, peOff, 24);
  if (head.toString('latin1', 0, 4) !== 'PE\0\0') return null;
  const nSections = head.readUInt16LE(6);
  const optSize = head.readUInt16LE(20);
  const optOff = peOff + 24;
  if (optOff + optSize > fileSize || optSize < 96) return null;
  const opt = readAt(fd, optOff, Math.min(optSize, 240));
  const magic = opt.readUInt16LE(0);
  const isPe32Plus = magic === 0x20b;
  if (!isPe32Plus && magic !== 0x10b) return null;
  const dirOff = isPe32Plus ? 112 : 96;
  if (opt.length < dirOff + 8) return null;
  const resRva = opt.readUInt32LE(dirOff + 2 * 8);
  const resSize = opt.readUInt32LE(dirOff + 2 * 8 + 4);

  const secOff = optOff + optSize;
  if (secOff + nSections * 40 > fileSize) return null;
  const secBuf = readAt(fd, secOff, nSections * 40);
  const sections = [];
  for (let i = 0; i < nSections; i++) {
    const b = i * 40;
    sections.push({
      name: secBuf.toString('latin1', b, b + 8).replace(/\0+$/, ''),
      vsize: secBuf.readUInt32LE(b + 8),
      va: secBuf.readUInt32LE(b + 12),
      rawSize: secBuf.readUInt32LE(b + 16),
      rawPtr: secBuf.readUInt32LE(b + 20),
    });
  }
  return { sections, resRva, resSize };
}

/** RVA → 文件偏移 */
function rvaToOff(sections, rva) {
  for (const s of sections) {
    const size = Math.max(s.vsize, s.rawSize);
    if (rva >= s.va && rva < s.va + size) return s.rawPtr + (rva - s.va);
  }
  return -1;
}

/** 资源目录里的一个条目 */
function dirEntries(buf, at) {
  if (at + 16 > buf.length) return [];
  const named = buf.readUInt16LE(at + 12);
  const ids = buf.readUInt16LE(at + 14);
  const n = named + ids;
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = at + 16 + i * 8;
    if (b + 8 > buf.length) break;
    const name = buf.readUInt32LE(b);
    const off = buf.readUInt32LE(b + 4);
    out.push({ named: !!(name & 0x80000000), id: name & 0x7fffffff, sub: !!(off & 0x80000000), off: off & 0x7fffffff });
  }
  return out;
}

/** 找 RT_VERSION → 资源名(1) → 语言(第一个) 的数据项 */
function findVersionData(fd, sections, resRva) {
  const base = rvaToOff(sections, resRva);
  if (base < 0) return null;
  const buf = readAt(fd, base, MAX_RES_DIR);
  const lvl1 = dirEntries(buf, 0).find(e => !e.named && e.id === RT_VERSION && e.sub);
  if (!lvl1) return null;
  const lvl2 = dirEntries(buf, lvl1.off).find(e => e.sub);
  if (!lvl2) return null;
  const lvl3 = dirEntries(buf, lvl2.off).find(e => !e.sub);
  if (!lvl3) return null;
  const at = lvl3.off;
  if (at + 16 > buf.length) return null;
  const dataRva = buf.readUInt32LE(at);
  const size = buf.readUInt32LE(at + 4);
  if (!size || size > 1024 * 1024) return null;
  const off = rvaToOff(sections, dataRva);
  if (off < 0) return null;
  return { off, size };
}

/* ---------- VS_VERSIONINFO ---------- */

/** 取 UTF-16LE 以 0 结尾的字符串起点（返回 {str, end}） */
function utf16z(buf, at, end) {
  const chars = [];
  let p = at;
  while (p + 1 < end) {
    const c = buf.readUInt16LE(p);
    p += 2;
    if (c === 0) break;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), end: p };
}

const align4 = n => (n + 3) & ~3;

/** 解析一个 VS_VERSIONINFO 块（递归看子块），返回 {numeric, string, product} */
function parseVersionInfo(buf) {
  const out = { numeric: '', string: '', product: '' };
  walk(buf, 0, buf.length, out, 0);
  if (!out.numeric && !out.string && !out.product) return null;
  return out;
}

function walk(buf, at, end, out, depth) {
  if (depth > 4 || at + 6 > end) return;
  const len = buf.readUInt16LE(at);
  const valueLen = buf.readUInt16LE(at + 2);
  const type = buf.readUInt16LE(at + 4);
  if (len < 6 || at + len > end) return;
  const key = utf16z(buf, at + 6, at + len);
  const keyEnd = align4(key.end);

  // 固定信息：VS_FIXEDFILEINFO 里带四个 16 位版本号
  if (key.str === 'VS_VERSION_INFO' && valueLen >= 52) {
    const fi = keyEnd;
    if (fi + 52 <= at + len && buf.readUInt32LE(fi) === 0xfeef04bd) {
      const ms = buf.readUInt32LE(fi + 8);
      const ls = buf.readUInt32LE(fi + 12);
      const parts = [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff];
      while (parts.length > 2 && parts[parts.length - 1] === 0) parts.pop();
      out.numeric = parts.join('.');
    }
  }

  // 文本块（wType===1）：值就是那段字符串，键是 FileVersion / ProductVersion
  if (type === 1 && key.str && !out[key.str]) {
    if (key.str === 'FileVersion') out.string = utf16z(buf, keyEnd, at + len).str.trim();
    if (key.str === 'ProductVersion') out.product = utf16z(buf, keyEnd, at + len).str.trim();
  }

  // 子块
  let p = align4(keyEnd + (valueLen * (type === 1 ? 2 : 1)));
  while (p + 6 <= at + len) {
    const childLen = buf.readUInt16LE(p);
    if (!childLen) break;
    if (p + childLen > at + len) break;
    walk(buf, p, p + childLen, out, depth + 1);
    p = align4(p + childLen);
  }
}

/* ---------- 对外 ---------- */

/** 展示用：优先 FileVersion 字符串，其次 ProductVersion，最后数值 */
function pickDisplay(v) {
  const s = (v && (v.string || v.product)) || '';
  if (s) return s;
  return (v && v.numeric) || '';
}

/** 读一个 exe 的版本；失败返回 null（不抛） */
function readExeVersion(exe) {
  let fd = -1;
  try {
    const st = fs.statSync(exe);
    if (!st.isFile()) return null;
    fd = fs.openSync(exe, 'r');
    const head = peHeader(fd, st.size);
    if (!head) return null;              // 连 PE 都不是，就别假装「没有版本资源」
    let v = null;
    if (head.resRva) {
      const data = findVersionData(fd, head.sections, head.resRva);
      if (data) v = parseVersionInfo(readAt(fd, data.off, data.size));
    }
    if (!v) return { display: '', numeric: '', product: '', mtime: st.mtimeMs, size: st.size, noResource: true };
    return { ...v, display: pickDisplay(v), mtime: st.mtimeMs, size: st.size };
  } catch {
    return null;
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch { /* 关不掉就算了 */ } }
  }
}

/** 进程内缓存：同一个 exe（同 mtime/size）只读一次 */
const cache = new Map();

/**
 * 认当前游戏目录里的版本：返回 { ok, version, exe, source, reason? }
 * ok=false 时 version 为空串，`reason` 说明原因（目录没设 / exe 不在 / 读不出来）
 */
function detect(root, opts = {}) {
  if (!root) return { ok: false, version: '', exe: '', source: '', reason: '还没设置游戏目录' };
  const exe = path.join(root, game.EXE_REL);
  let st;
  try {
    st = fs.statSync(exe);
  } catch {
    return { ok: false, version: '', exe, source: '', reason: '找不到游戏主程序' };
  }
  const key = exe.toLowerCase() + '|' + st.size + '|' + st.mtimeMs;
  if (!opts.noCache && cache.has(key)) return cache.get(key);
  const v = readExeVersion(exe);
  const res = v && v.display
    ? { ok: true, version: v.display, numeric: v.numeric, product: v.product, exe, source: 'exe' }
    : { ok: false, version: '', exe, source: 'exe', reason: '这个 exe 里读不到版本号' };
  cache.set(key, res);
  return res;
}

module.exports = { detect, readExeVersion, peHeader, rvaToOff, findVersionData, parseVersionInfo, pickDisplay, SIG, RT_VERSION };
