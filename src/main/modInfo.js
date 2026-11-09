'use strict';
/**
 * Mod 基本信息的本地档案（一条一个 JSON 文件）。
 *
 * 为什么要有这个：
 *   「已下载 / 已安装」列表里的名字、作者、版本、摘要、封面，Nexus 只在**第一次**
 *   关联的时候值得问一次。问完之后这些东西就该躺在硬盘上 —— 断网、Cloudflare
 *   抽风、API Key 过期、甚至换台机器（把 `.sbmod` / 数据目录一起带走），
 *   列表都还得能正常显示，不该每次刷新都去线上再问一遍。
 *
 * 三条取舍：
 *   ① 一条一个文件（`cache/mod-info/<modId>.json`），不塞进一个大 JSON：
 *      3169 条 mod 的信息一起读写太笨重，单条坏掉也不该连累别人。
 *   ② 只存「展示要用的字段」，不存 Nexus 的整份响应：接口字段常变，
 *      存薄一点，将来解析崩了也不至于把老档案一起作废。
 *   ③ 记录里存的是 `coverFile`（绝对路径）而不是 `file://` 地址：
 *      数据目录可能被搬走/换盘，URL 会失效，路径还能重新拼。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const paths = require('./paths');
const { readJson, writeJson } = require('./store');

/** 子目录名（在 `paths.CACHE` 下） */
const DIR_NAME = 'mod-info';

/**
 * 多久算「旧」：只用来给界面显示「这条信息是什么时候拿的」，
 * 不做过期删除 —— 老信息总比「没有信息」好，真要更新时用户可以点刷新。
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 把 Nexus 目录缓存的条目（`nexus-catalog.json` 里那一条）
 * 裁成我们展示要用的形状。目录里的字段已经够了，不用联网。
 */
function fromCatalog(entry) {
  if (!entry || !Number(entry.modId)) return null;
  const pic = entry.pictureUrl || entry.image || '';
  return {
    modId: Number(entry.modId),
    name: entry.name || '',
    author: entry.author || '',
    version: entry.version || '',
    summary: entry.summary || '',
    pictureUrl: pic,
    url: entry.url || '',
    downloads: Number(entry.downloads) || 0,
    adult: !!entry.adult,
    source: 'catalog'
  };
}

/**
 * @param {{dir?: string}} [opts]
 */
function createModInfo(opts = {}) {
  const dir = opts.dir || path.join(paths.CACHE, DIR_NAME);

  const fileOf = (modId) => path.join(dir, String(Number(modId)) + '.json');

  /** 读一条；没有 / 坏了 / modId 对不上都算没有 */
  function get(modId) {
    const id = Number(modId);
    if (!id || id < 1) return null;
    const rec = readJson(fileOf(id), null);
    if (!rec || typeof rec !== 'object') return null;
    if (Number(rec.modId) !== id) return null;
    return rec;
  }

  /**
   * 写一条。合并写：调用方只给要更新的字段，
   * 老档案里的别的字段（比如别人补的摘要）不会被这次写入抹掉。
   */
  function put(rec) {
    const id = Number(rec && rec.modId);
    if (!id || id < 1) return null;
    const old = get(id) || {};
    const next = {
      ...old,
      ...rec,
      modId: id,
      at: Date.now()
    };
    writeJson(fileOf(id), next);
    return next;
  }

  function putMany(list) {
    const out = [];
    for (const rec of Array.isArray(list) ? list : []) {
      const r = put(rec);
      if (r) out.push(r);
    }
    return out;
  }

  /** 全部档案（设置页/统计用；数量上千时别在渲染路径里调） */
  function all() {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const n of names) {
      if (!/^\d+\.json$/.test(n)) continue;
      const rec = get(Number(n.replace(/\.json$/, '')));
      if (rec) out.push(rec);
    }
    return out;
  }

  function remove(modId) {
    const id = Number(modId);
    if (!id) return false;
    try {
      fs.unlinkSync(fileOf(id));
      return true;
    } catch {
      return false;
    }
  }

  /** 档案里的封面文件还在不在（返回 `file://` 地址；不在就给空串） */
  function coverUrlOf(rec) {
    const f = rec && rec.coverFile;
    if (!f) return '';
    try {
      if (!fs.statSync(f).isFile()) return '';
      return pathToFileURL(f).href;
    } catch {
      return '';
    }
  }

  function isFresh(rec) {
    return !!rec && Number(rec.at) > 0 && Date.now() - Number(rec.at) < TTL_MS;
  }

  return { dir, fileOf, get, put, putMany, all, remove, coverUrlOf, isFresh };
}

module.exports = { createModInfo, fromCatalog, DIR_NAME, TTL_MS };
