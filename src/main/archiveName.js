'use strict';

/**
 * 下载归档的命名规范。
 *
 * ## 为什么要有这个模块
 *
 * Nexus 的下载直链是 CDN 地址，`Content-Disposition` 里给的「文件名」是
 * **`Nexus Global Content Delivery Network`**，而且**没有扩展名**。
 * 直接用它当文件名，`data/library/` 下 8 个 mod 全都长一个样：
 *
 *     data/library/533/Nexus Global Content Delivery Network
 *     data/library/692/Nexus Global Content Delivery Network
 *
 * 用户在资源管理器里根本分不清哪个是哪个，也没法用系统默认程序打开。
 *
 * ## 规范
 *
 *     单个目录：data/library/（不再每个 mod 一层子目录）
 *     文件名：<modId>_<模组名称>_<版本>.<ext>
 *
 * - 版本优先取**模组内文件版本**（`fileVersion`），回落 mod 版本（`version`）——
 *   同一个 mod 的多个文件（MAIN / OPTIONAL / 多选一变体）靠它区分
 * - `ext` 从**文件头嗅探**得到（zip / 7z / rar），不信任 CDN 给的名字
 * - 名字重复（同 mod 同版本不同 fileId）时追加 `_f<fileId>`，绝不静默覆盖
 */

const path = require('path');

/** 文件头指纹 → 扩展名 */
const MAGIC = [
  { re: /^PK(\x03\x04|\x05\x06|\x07\x08)/, ext: 'zip' },
  { re: /^7z\xBC\xAF\x27\x1C/, ext: '7z' },
  { re: /^Rar!\x1A\x07[\x00\x01]/, ext: 'rar' }
];

/** 已知的压缩包扩展名（按优先级，用于本地导入时保留原扩展名） */
const KNOWN_EXTS = ['7z', 'zip', 'rar'];

/**
 * 从文件头嗅探压缩包格式。读不出返回 ''（调用方应拒绝或走 7z 兜底）。
 * @param {Buffer|Uint8Array} buf 至少 8 字节
 * @returns {'zip'|'7z'|'rar'|''}
 */
function sniffExtension(buf) {
  if (!buf || !buf.length) return '';
  // 🔴 必须按 **latin1** 解码。Buffer 默认 utf8，而 7z 的魔数是
  //    `37 7A BC AF 27 1C` —— `0xBC` / `0xAF` 是无效 UTF-8 序列，
  //    `toString()` 会换成 U+FFFD，正则里的 `\xBC` 永远匹配不上，
  //    于是所有 7z 包都识别不出来（实测：文件名没扩展名、7z 打不开）。
  //    zip 的 `PK\x03\x04` 和 rar 的 `Rar!\x1A\x07\x00` 全是 ASCII 才没暴露。
  const head = Buffer.from(buf.slice(0, 8)).toString('latin1');
  for (const m of MAGIC) if (m.re.test(head)) return m.ext;
  return '';
}

/**
 * 把任意字符串洗成能当 Windows 文件名的片段。
 * 去掉路径分隔符与保留字符、压缩连续空白、掐掉首尾的点/空格。
 */
function safeSlug(value) {
  let s = String(value == null ? '' : value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Windows 不允许以点结尾（会被当扩展名处理），也不允许纯点
  s = s.replace(/^\.+/, '').replace(/\.+$/, '').trim();
  if (!s) return '';
  // 留足余量：文件名上限 255，截断时别把扩展名挤掉
  return s.slice(0, 120);
}

/**
 * 构造规范文件名。
 *
 * @param {{modId?:string|number, name?:string, version?:string,
 *          fileVersion?:string, fileName?:string, fileId?:string|number,
 *          ext?:string, fallback?:string, suffix?:string}} info
 * @returns {string} 例如 `533_Silver Kunoich transparent CNS_1.0.zip`
 */
function buildArchiveName(info = {}) {
  const modId = String(info.modId == null ? '' : info.modId).trim();
  const name = safeSlug(info.name) || safeSlug(info.fileName) || safeSlug(info.fallback) || 'mod';
  const version = safeSlug(info.fileVersion) || safeSlug(info.version) || '';
  let ext = String(info.ext || '').replace(/^\./, '').toLowerCase();

  const parts = [];
  if (modId && /^\d+$/.test(modId)) parts.push(modId);
  else if (modId) parts.push(safeSlug(modId));
  parts.push(name);
  if (version) parts.push(version);
  if (info.suffix) parts.push(String(info.suffix).replace(/^_/, ''));

  let base = parts.join('_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'mod';
  if (ext && KNOWN_EXTS.includes(ext)) base += '.' + ext;
  else if (ext) base += '.' + ext;      // 未知也带上，至少能看出原格式
  return base;
}

/**
 * 老目录迁移用的名字：不知道 mod 名时至少保留 modId + fileId（可读、可追）。
 */
function buildLegacyArchiveName({ modId, fileId, ext }) {
  const e = String(ext || '').replace(/^\./, '').toLowerCase();
  const base = ['mod', modId == null ? 'unknown' : String(modId)];
  if (fileId != null && Number(fileId) > 0) base.push('f' + fileId);
  return base.join('_') + (e ? '.' + e : '');
}

/** 从已有路径取扩展名（不信任内容，仅作兜底） */
function extOf(p) {
  const e = path.extname(String(p || '')).replace(/^\./, '').toLowerCase();
  return KNOWN_EXTS.includes(e) ? e : '';
}

module.exports = { sniffExtension, safeSlug, buildArchiveName, buildLegacyArchiveName, extOf, KNOWN_EXTS };
