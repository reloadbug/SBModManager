'use strict';
/**
 * 变体预览图：从压缩包里挑出「每套内容对应的那张图」，供选择框显示。
 *
 * ## 为什么需要
 *
 * 2026-10-13 用户报 mod 1430「BP Cooling suit」时说：
 * 「这种结构的 mod，提示结构无法识别，你确认一下应该怎么处理，
 *   **找到 mod 的安装说明看看，压缩包里面有**」。
 *
 * 包里除了 7 个目录（`Cooling suit_A` … `_G`）和一份
 * `Normal version Installation instructions.txt`，还有 **7 张同名 jpg**
 * （`Cooling Suit_A.jpg` … `_G.jpg`）—— 那才是真正的「安装说明」：
 * 不看图根本不知道 A~G 哪套是什么颜色，只能瞎点一个。
 *
 * 所以这里把「目录 ↔ 图片」配起来，选择框直接显示缩略图。
 *
 * ## 匹配规则（`pickCover`，纯函数，可离线断言）
 *
 * 1. 目录**里面**的图（`Cooling suit_A/cover.jpg`）—— 优先级最高，取最大那张
 * 2. 归档里**名字与目录名对应**的图（`Cooling Suit_A.jpg` ↔ `Cooling suit_A/`）
 * 3. 退一步：名字以目录名开头的图（`Cooling Suit_A_preview.jpg`）
 *
 * 名字比较前先归一：小写、`_`/`-`/多余空格都折算成单空格。
 * 于是 `Cooling suit_A` == `Cooling Suit_A` == `cooling-suit-a`。
 *
 * ## 边界
 *
 * - 包里没图（实测 mod 1378 / 2595 就没有）→ 返回空对象，界面不显示缩略图
 * - **永不抛**：拿不到图不该让「选择要装哪些」这个对话框打不开
 * - 解压只挑那几张图（`archive.extract(..., names)`）——
 *   47MB 的包全解要 142MB，只为 7 张 jpg 不值得
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const archive = require('./archive');
const paths = require('./paths');

const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

/** 归一化用于比较的名字：小写 + `_`/`-`/多空格 → 单空格 */
function normalizeStem(s) {
  return String(s || '')
    .replace(IMG_EXT, '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从归档条目里给每个候选目录挑一张图。
 *
 * @param {Array<{path:string,dir:boolean,size:number}>} entries
 * @param {string[]} dirs 候选目录（归档内相对路径，`/` 分隔）
 * @returns {Map<string,string>} 目录 → 图片条目路径
 */
function pickCover(entries, dirs) {
  const out = new Map();
  const files = (entries || []).filter(e => !e.dir && IMG_EXT.test(e.path));

  for (const dir of (dirs || [])) {
    const d = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
    const leaf = d.split('/').pop();
    const leafKey = normalizeStem(leaf);

    // 1) 目录**里面**的图 —— 取最大的那张（作者常放 cover + 多张截图）
    const inside = files
      .filter(f => f.path.startsWith(d + '/'))
      .sort((a, b) => (b.size || 0) - (a.size || 0));
    if (inside.length) { out.set(dir, inside[0].path); continue; }

    // 2) 与目录名**同名**的图（真实形态：`Cooling Suit_A.jpg` ↔ `Cooling suit_A/`）
    const exact = files.find(f => normalizeStem(path.posix.basename(f.path)) === leafKey);
    if (exact) { out.set(dir, exact.path); continue; }

    // 3) 以目录名开头的图（`Cooling Suit_A_preview.jpg`）
    const prefixed = files
      .filter(f => {
        const k = normalizeStem(path.posix.basename(f.path));
        return leafKey && k.startsWith(leafKey + ' ');
      })
      .sort((a, b) => (b.size || 0) - (a.size || 0));
    if (prefixed.length) { out.set(dir, prefixed[0].path); }
  }
  return out;
}

/** 缓存目录：按压缩包文件名 + 大小分桶，避免同名不同包互相覆盖 */
function cacheDirFor(archivePath) {
  let size = 0;
  try { size = fs.statSync(archivePath).size; } catch { /* 忽略 */ }
  const base = path.basename(archivePath).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_');
  return path.join(paths.CACHE, 'variants', base + '_' + size.toString(36));
}

/**
 * 取候选目录的预览图，返回 `{ [dir]: 'file:///...' }`。
 *
 * @param {string} archivePath
 * @param {string[]} dirs
 * @param {{cacheDir?:string}} [opts] `cacheDir` 覆盖缓存位置（**测试必须传**，
 *   否则会往真实 `data/cache/variants` 里堆假图 —— 与 `opts.backupDir` 同一个坑）。
 *
 * **永不抛** —— 拿不到就返回空对象，界面照旧能用（只是没缩略图）。
 */
async function coversFor(archivePath, dirs, opts = {}) {
  const list = (Array.isArray(dirs) ? dirs : []).filter(Boolean);
  if (!archivePath || !list.length) return {};

  let picked = new Map();
  try {
    const { entries } = await archive.listEntries(archivePath);
    picked = pickCover(entries, list);
  } catch { return {}; }
  if (!picked.size) return {};

  const dir = opts.cacheDir || cacheDirFor(archivePath);
  const wanted = [];
  for (const rel of picked.values()) {
    const dest = path.join(dir, rel.split('/').join(path.sep));
    // 已缓存且非空 → 直接用，不再解压
    let ok = false;
    try { ok = fs.existsSync(dest) && fs.statSync(dest).size > 0; } catch { ok = false; }
    if (!ok) wanted.push(rel);
  }

  if (wanted.length) {
    try { await archive.extract(archivePath, dir, wanted); }
    catch { /* 解压失败 → 下面按「文件是否存在」逐个判 */ }
  }

  const out = {};
  for (const [k, rel] of picked) {
    const dest = path.join(dir, rel.split('/').join(path.sep));
    try {
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) out[k] = pathToFileURL(dest).href;
    } catch { /* 单个失败不影响其它 */ }
  }
  return out;
}

/** 清掉预览图缓存（设置页/测试用） */
function clearCache() {
  const dir = path.join(paths.CACHE, 'variants');
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  catch { return false; }
}

module.exports = { normalizeStem, pickCover, coversFor, clearCache, cacheDirFor };
