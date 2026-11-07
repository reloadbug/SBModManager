'use strict';
const path = require('path');

/**
 * 「装进游戏的文件名带 Nexus 标识」。
 *
 * 动机（用户 2026-11-07）：
 * > 通过本管理器安装的 mod，mod 目录内的文件名要有统一规律，要能与 nexus 系统中的
 * > 标识匹配上，这样从新加载游戏目录后，已经安装的 mod 就能容易关联上了。
 *
 * 背景：`~Mods\` 里的 pak 名千奇百怪（`ff7_cns_657.dekcns`、`41B Speeder's High
 * Edit-4128_P.pak`…），只有注册表 `mods.json` 记得住「这是哪个 Nexus Mod」。
 * 一旦换游戏目录 / 注册表丢了 / 用户把文件手动搬走，就只剩一个名字可猜 ——
 * 批量解析那套名字打分本质是**猜**，高置信也只有 80%。
 *
 * 所以：管理器自己装的东西，装的时候就把标识写进文件名里 ——
 *
 *     HD-ATOOL_P.pak   →   HD-ATOOL_P [nx4471].pak
 *
 * 三个关键取舍：
 *
 * 1) **放在结尾，不放在开头**。
 *    UE 从 `~Mods` 挂载 pak 是按**文件名排序**决定先后（先挂的先被后挂的盖住），
 *    前缀会整体打乱加载顺序；后缀只在「原本就同名的两个文件」之间改变次序，
 *    对已经装好的其它 mod 完全无影响。
 *
 * 2) **只带 modId，不带 fileId**。
 *    同一个 Mod 的不同文件（不同版本 / 可选包）往往落成同一个文件名，靠「同名覆盖」
 *    完成换装。fileId 进文件名会让两个变体**同时**留在 `~Mods` 里，游戏把两份都挂上，
 *    谁赢取决于排序 —— 那才是真的会出画面 bug。fileId 照旧记在 `mods.json` 里。
 *
 * 3) **只改 pak / ucas / utoc**。
 *    这三者是同一个「包」的三件套，必须同名（我们按 basename 逐个加同样的后缀，
 *    天然保持同进同出）。CNS 的 `.dekcns` 数据文件、脚本目录一律不动：
 *    前者被 pak 内部按名字引用，改了可能直接失效；后者要跟 `mods.txt` 的键对齐，
 *    改了得连 `mods.txt` 一起改，收益却很小（目录名本来就是人可读的）。
 *
 * 标识形态：`[nx<modId>]`，例如 `HD-ATOOL_P [nx4471].pak`。
 *   · 方括号 + 小写 nx 前缀，肉眼一眼能认出「这是管理器写的」
 *   · 纯 ASCII，正则 `/\[nx(\d+)\]/i` 判定，不会被别的东西误伤
 */

/** 文件名里的标识：`[nx123]`（大小写不敏感，允许出现在名字任意位置） */
const TAG_RE = /\[nx(\d{1,8})\]/gi;

/** 只给这三类文件加标识（见上面第 3 条） */
const TAGGABLE = /\.(pak|ucas|utoc)$/i;

/**
 * 生成标识文本（含前导空格，习惯上写成 `名字 [nx123]`）。
 * @param {{modId?:number|string}|number|string} meta
 * @returns {string} 没有有效 modId 时返回空串
 */
function tagOf(meta) {
  const raw = (meta && typeof meta === 'object') ? meta.modId : meta;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return '';
  return ' [nx' + Math.trunc(id) + ']';
}

/**
 * 解析名字里的标识。
 * @param {string} text 文件名 / 目录名 / 完整路径都行
 * @returns {{modId:number}|null}
 */
function parse(text) {
  if (!text) return null;
  const s = String(text);
  // 只看最后一段 —— 路径中间本来也不该出现，但真出现了也不该误判
  const base = s.split(/[\\/]/).pop() || s;
  TAG_RE.lastIndex = 0;
  const m = TAG_RE.exec(base);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? { modId: Math.trunc(id) } : null;
}

/** 去掉名字里已有的标识（幂等的基础：先剥再加，绝不叠成 `[nx1] [nx1]`） */
function stripTag(name) {
  if (!name) return name || '';
  const s = String(name);
  const ext = path.extname(s);
  const stem = ext ? s.slice(0, s.length - ext.length) : s;
  TAG_RE.lastIndex = 0;
  const cleaned = stem.replace(TAG_RE, '').replace(/\s+/g, ' ').trim();
  return cleaned + ext;
}

/**
 * 给文件名加上标识（幂等）。
 *
 * @param {string} name 文件名（不要传路径，只传最后一段）
 * @param {object|number|string} meta `{modId}` 或直接给 modId
 * @returns {string}
 */
function applyTag(name, meta) {
  const tag = tagOf(meta);
  const s = String(name || '');
  if (!tag || !TAGGABLE.test(s)) return s;
  const clean = stripTag(s);
  // 剥完只剩扩展名（本来就叫 `[nx12].pak`）：不动它，否则会产出 `.pak [nx9]` 这种怪名
  if (!clean || clean === path.extname(s)) return s;
  const ext = path.extname(clean);
  const stem = ext ? clean.slice(0, clean.length - ext.length) : clean;
  if (!stem.trim()) return s;
  return stem + tag + ext;
}

/** 这个名字是否需要打标识（类型对、而且真的会变） */
function needsTag(name, meta) {
  const s = String(name || '');
  if (!tagOf(meta) || !TAGGABLE.test(s)) return false;
  return applyTag(s, meta) !== s;
}

module.exports = { TAG_RE, TAGGABLE, tagOf, parse, stripTag, applyTag, needsTag };
