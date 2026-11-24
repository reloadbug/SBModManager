/*
 * 文件归属表：`哪个文件属于哪个 Mod`
 *
 * 为什么需要它（用户 2026-11-24）：
 *   `~Mods` 根目录里的 `.dekcns.json` / `.dekani.json` 是 CNS 的服装数据文件，跟它那套 pak 是**一起用**的。
 *   正常流程在安装时就把「装了哪些文件」写进登记记录（`pkg` 账本 + `manifest`），可早期那批装的时候没有这份账，
 *   于是磁盘上有数据文件、界面上却没有哪张卡片认领它 —— 用户的话：「既然已经丢失了这部分数据就想办法补回来」。
 *
 * 补的办法就是用户说的：**拿库里的压缩包比对**。压缩包名字里带 Nexus 编号（`4184_xxx.zip`），
 * 包里有哪些文件是确定的，于是「文件 → Mod」这层关系可以从安装包反推出来，不需要靠文件名瞎猜。
 *
 * 存储：`<数据目录>/mod-file-owner.json`（跟着游戏走、会镜像，见 paths.STATE_NAMES）
 *   {
 *     version: 1,
 *     owners: {
 *       "<fileKey>": { modId, name?, entry, archive, at }
 *     }
 *   }
 *   `fileKey` = installer.fileKey(文件名)：去掉 `[nx123]` 标识、去掉 `.disabled`、保留扩展名、小写。
 *
 * 这里只放**归属事实**，不做任何落盘以外的动作 —— 挂到卡片上是 attachOwners.js 的事。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const installer = require('./installer');
const { readJson, writeJson } = require('./store');

const VERSION = 1;
/** 只给这些扩展名建索引：CNS 数据文件才是「看不见/挂不上」的重灾区，pak 三件套靠文件名标识就能认出来 */
const INDEXABLE = /\.(dekcns|dekani)(\.json)?$/i;
const ARCHIVE_EXT = /\.(zip|7z|rar)$/i;

function emptyDb() {
  return { version: VERSION, owners: {} };
}

/**
 * @param {string} file `mod-file-owner.json` 的绝对路径
 */
function createFileOwner(file) {
  let db = emptyDb();

  function load() {
    try {
      const raw = readJson(file, null);
      if (raw && typeof raw === 'object' && raw.owners && typeof raw.owners === 'object') {
        db = { version: raw.version || VERSION, owners: raw.owners };
      } else {
        db = emptyDb();
      }
    } catch {
      db = emptyDb();
    }
    return db;
  }

  function save() {
    try {
      writeJson(file, db);
      return true;
    } catch {
      return false;
    }
  }

  load();

  return {
    file: () => file,
    /** 全部归属：{ fileKey: {...} } */
    all: () => db.owners,
    /** 查一个文件属于谁（没有就 null）。`.disabled` 的两种写法都认 */
    get(nameOrKey) {
      const raw = String(nameOrKey || '');
      // `X.dekcns.disabled.json` / `X.dekcns.json.disabled` 都是「关着」的写法，先还原成原名再算键
      const plain = raw.replace(/\.disabled\.json$/i, '.json').replace(/\.disabled$/i, '');
      const key = INDEXABLE.test(plain) ? installer.fileKey(plain) : raw;
      return db.owners[key] || null;
    },
    /**
     * 批量写入归属。`map` 形如 `{ "<fileKey>": { modId, entry, archive } }`。
     * 同一条只覆盖 modId 变化过的，其余保持（`at` 记第一次认出的时间）。
     */
    setMany(map, at) {
      const when = at || new Date().toISOString();
      let added = 0;
      let changed = 0;
      for (const [key, v] of Object.entries(map || {})) {
        if (!key || !v || !v.modId) continue;
        const prev = db.owners[key];
        if (!prev) {
          db.owners[key] = { modId: Number(v.modId) || 0, entry: v.entry || '', archive: v.archive || '', at: when };
          added++;
        } else if (Number(prev.modId) !== Number(v.modId)) {
          db.owners[key] = { ...prev, modId: Number(v.modId) || 0, entry: v.entry || prev.entry, archive: v.archive || prev.archive };
          changed++;
        }
      }
      if (added || changed) save();
      return { added, changed, total: Object.keys(db.owners).length };
    },
    /** 某个 Mod 名下的全部文件（key 列表） */
    keysOfMod(modId) {
      const id = Number(modId) || 0;
      if (!id) return [];
      return Object.keys(db.owners).filter(k => Number(db.owners[k].modId) === id);
    },
    /** 某个 Mod 名下的文件有多少个 */
    countOfMod(modId) {
      return this.keysOfMod(modId).length;
    },
    /** 已经收录了哪些 Mod（用于「别重复扫库」） */
    indexedModIds() {
      const set = new Set();
      for (const v of Object.values(db.owners)) {
        const id = Number(v.modId) || 0;
        if (id) set.add(id);
      }
      return set;
    },
    stats() {
      const keys = Object.keys(db.owners);
      const mods = new Set(keys.map(k => Number(db.owners[k].modId) || 0).filter(Boolean));
      return { files: keys.length, mods: mods.size, file: file };
    },
    clear() {
      db = emptyDb();
      save();
      return true;
    },
    reload: load,
    /** 直接写一份（探针/迁移用） */
    replace(next) {
      db = {
        version: VERSION,
        owners: (next && next.owners) || {}
      };
      save();
      return db;
    }
  };
}

/**
 * 把「一个安装包」里能建索引的文件记到归属表里。
 *
 * @param {object} owner createFileOwner() 的实例
 * @param {object} plan  installer.analyze() 的计划（要有 `entries`）
 * @param {number} modId Nexus Mod 编号
 * @param {string} archivePath 安装包路径（只用来记录来源，方便回查）
 */
function indexPlan(owner, plan, modId, archivePath) {
  const id = Number(modId) || 0;
  if (!owner || !id || !plan) return { added: 0, changed: 0, total: 0 };
  const list = Array.isArray(plan.entries) ? plan.entries : [];
  const map = {};
  for (const e of list) {
    const rel = String((e && e.rel) || '').replace(/\\/g, '/');
    const base = rel.split('/').pop();
    if (!base || !INDEXABLE.test(base)) continue;
    map[installer.fileKey(base)] = { modId: id, entry: rel, archive: path.basename(String(archivePath || '')) };
  }
  return owner.setMany(map);
}

/**
 * 扫一遍本地安装包目录，把里面所有 CNS 数据文件的归属建起来。
 *
 * @param {object} owner   createFileOwner() 的实例
 * @param {string} libDir  安装包目录（paths.LIBRARY）
 * @param {object} opts    `{ archive (archive 模块), parseName (localLibrary.parseArchiveName), modIds (Set，只扫这些 Mod) }`
 */
async function indexLibrary(owner, libDir, opts = {}) {
  const archiveMod = opts.archive || require('./archive');
  const parseName = opts.parseName || require('./localLibrary').parseArchiveName;
  const only = opts.modIds instanceof Set ? opts.modIds : null;

  const result = { archives: 0, read: 0, failed: [], entries: 0, added: 0, changed: 0, total: 0, skipped: 0 };
  let names = [];
  try {
    names = fs.readdirSync(libDir);
  } catch (e) {
    result.failed.push({ archive: libDir, error: e.message });
    return result;
  }

  const map = {};
  for (const name of names) {
    if (!ARCHIVE_EXT.test(name)) continue;
    result.archives++;
    let parsed = null;
    try { parsed = parseName(name); } catch { parsed = null; }
    const modId = parsed ? Number(parsed.modId) || 0 : 0;
    if (!modId) { result.skipped++; continue; }
    if (only && !only.has(modId)) { result.skipped++; continue; }

    let entries = [];
    try {
      const r = await archiveMod.listEntries(path.join(libDir, name));
      entries = (r && r.entries) || [];
    } catch (e) {
      result.failed.push({ archive: name, error: e.message });
      continue;
    }
    result.read++;
    for (const e of entries) {
      const rel = String((e && e.path) || '').replace(/\\/g, '/');
      const base = rel.split('/').pop();
      if (!base || !INDEXABLE.test(base)) continue;
      result.entries++;
      map[installer.fileKey(base)] = { modId, entry: rel, archive: name };
    }
  }

  const w = owner.setMany(map);
  result.added = w.added;
  result.changed = w.changed;
  result.total = w.total;
  return result;
}

module.exports = { createFileOwner, indexPlan, indexLibrary, INDEXABLE, VERSION };
