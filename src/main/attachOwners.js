/*
 * 按「文件归属表」把盘上的数据文件挂到对应的卡片上
 *
 * 背景：`~Mods` 根目录的 `.dekcns.json` / `.dekani.json` 是 CNS 服装数据文件，必须和它那套 pak 一起用。
 * `scanner.scanPaks()` 本来只按「名字像不像」硬凑（Dice ≥ 0.8），凑不上的就成了孤儿：盘上有、界面上看不见，
 * 既不会被开关带走，也不会被卸载清掉。
 *
 * 现在多一条更可靠的依据：`fileOwner.js` 从安装包里反推出的归属（文件 → Nexus Mod 编号）。
 * 只要这个 Mod 在列表里有卡片，就把文件挂到那张卡片上 —— 这样开关、卸载都会连它一起处理。
 *
 * 这是扫完之后的一道补充工序：不改 `scanner` 的算法，只在结果上补挂，
 * 所以对「已登记」「未登记」「已关联」三种卡片都一视同仁。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const scanner = require('./scanner');
const installer = require('./installer');

/** 一张卡片的 Nexus 编号：已登记看 source.modId，未登记的只能从文件名标识 `[nx123]` 取 */
function modIdOf(item) {
  const src = (item && item.meta && item.meta.source) || {};
  const direct = Number(src.modId
    || (item && item.meta && item.meta.modId)
    || (item && item.tag && item.tag.modId)
    || 0) || 0;
  if (direct) return direct;
  // 兜底：未登记的卡片没有 meta，名字里的标识 `[nx123]` 就是它唯一的编号线索
  const ids = [String((item && item.id) || ''), String((item && item.name) || ''), String((item && item.tag && item.tag.raw) || '')];
  for (const s of ids) {
    const m = s.match(/\[nx(\d+)\]/i);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

/** 卡片的「名字主干」：`disk:paks:43_UndressableMonsoon_P [nx1583]` → `43_UndressableMonsoon_P` */
function stemOfItem(item) {
  const id = String((item && item.id) || '');
  const base = id.replace(/^disk:(paks|script):/i, '') || String((item && item.name) || '');
  return scanner.normStem(base);
}

/**
 * @param {Array}  list      `scanner.scan()` 的结果（会被就地修改）
 * @param {object} owner     `createFileOwner()` 的实例
 * @param {string} modsDir   `~Mods` 目录
 * @returns {{attached:number, files:number, noCard:number, mods:number}}
 */
function attachOwners(list, owner, modsDir) {
  const out = { attached: 0, files: 0, noCard: 0, mods: 0 };
  if (!Array.isArray(list) || !owner || !modsDir) return out;

  // ① 卡片按 Mod 编号归组
  const byMod = new Map();
  for (const it of list) {
    const id = modIdOf(it);
    if (!id) continue;
    if (!byMod.has(id)) byMod.set(id, []);
    byMod.get(id).push(it);
  }
  if (!byMod.size) return out;

  // ② 已经被某张卡片认领的文件名
  const claimed = new Set();
  for (const it of list) {
    for (const f of (it.files || [])) claimed.add(String(f.name).toLowerCase());
  }

  // ③ 盘上的数据文件里，还没被认领的那些
  let names = [];
  try {
    names = fs.readdirSync(modsDir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
  } catch {
    return out;
  }
  const touched = new Set();
  for (const name of names) {
    // 关掉的 mod 名字里带 `.disabled`（`.dekcns.json.disabled` / `.dekcns.disabled.json` 两种写法都有），
    // 先剥掉再判断是不是 CNS 数据文件，否则关着的那批会漏掉。
    const plain = String(name).replace(/\.disabled\.json$/i, '.json').replace(/\.disabled$/i, '');
    if (!scanner.CNS_DATA.test(plain)) continue;
    if (claimed.has(name.toLowerCase())) continue;

    const hit = owner.get(name);
    const modId = hit ? Number(hit.modId) || 0 : 0;
    if (!modId) continue;

    const cards = byMod.get(modId) || [];
    if (!cards.length) { out.noCard++; continue; }

    // 同一个 Mod 可能有好几张卡片（一个包拆成几组 pak）：挑名字最像的那张，
    // 相同时取文件多的（更像主包），再相同时按 id 排序，保证每次结果一样。
    const stem = installer.fileKey(name).replace(/\.[^.]+$/, '');
    let best = cards[0];
    let bestScore = -1;
    for (const c of cards) {
      const score = scanner.diceCoeff(stem, stemOfItem(c));
      const better = score > bestScore + 1e-9
        || (Math.abs(score - bestScore) < 1e-9 && (c.files || []).length > (best.files || []).length)
        || (Math.abs(score - bestScore) < 1e-9 && (c.files || []).length === (best.files || []).length && String(c.id) < String(best.id));
      if (better) { best = c; bestScore = score; }
    }

    const disabled = scanner_isDisabled(name);
    const st = (() => { try { return fs.statSync(path.join(modsDir, name)); } catch { return null; } })();
    best.files = best.files || [];
    best.files.push({
      name,
      disabled,
      size: st ? st.size : 0,
      mtime: st ? st.mtime.toISOString() : '',
      btime: st ? st.birthtime.toISOString() : null,
      companion: true,
      cnsData: true,
      owner: modId
    });
    best.fileCount = best.files.length;
    best.size = (Number(best.size) || 0) + (st ? st.size : 0);
    if (st && (!best.mtime || st.mtime.toISOString() > best.mtime)) best.mtime = st.mtime.toISOString();
    best.cnsData = Array.isArray(best.cnsData) ? best.cnsData : [];
    best.cnsData.push(name);
    if (disabled) best.partialDisabled = true;
    claimed.add(name.toLowerCase());
    touched.add(modId);
    out.attached++;
  }

  out.files = out.attached;
  out.mods = touched.size;
  return out;
}

/** 和 toggleName.isDisabledName 同口径，但这里不想为一行判断再引一个模块 */
function scanner_isDisabled(name) {
  const s = String(name || '');
  if (/\.disabled$/i.test(s)) return true;
  if (/\.disabled\.json$/i.test(s)) return true;
  return false;
}

module.exports = { attachOwners, modIdOf, stemOfItem };
