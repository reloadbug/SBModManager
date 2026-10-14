'use strict';

const crypto = require('crypto');
const { readJson, writeJson } = require('./store');

const STATUSES = new Set([
  'awaiting_authorization', 'queued', 'resolving', 'downloading',
  'downloaded', 'analyzing', 'needs_review', 'installing', 'installed',
  'failed', 'cancelled', 'interrupted',
  // 用户主动暂停（2026-10-14 新增）。与 `interrupted` 的区别：
  //   · `paused`      —— 用户点的，**半截文件必须留着**，随时能接着下
  //   · `interrupted` —— 进程被强杀 / 崩溃留下的，用户没表过态
  // 两者恢复路径一样（都走「继续」），分开是为了界面文案与按钮不一样。
  'paused'
]);

const ACTIVE_DUPLICATE_STATUSES = new Set([
  'awaiting_authorization', 'queued', 'resolving', 'downloading',
  'downloaded', 'analyzing', 'needs_review', 'installing', 'installed'
]);

const META_KEYS = new Set([
  'game', 'modId', 'fileId', 'name', 'author', 'version', 'fileVersion', 'fileName',
  'sourceUrl', 'url', 'pictureUrl', 'image', 'images', 'summary',
  'category', 'fileSize', 'fileCategory', 'isPrereq', 'createdAt'
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function safeMeta(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of META_KEYS) {
    if (source[key] === undefined) continue;
    if (key === 'images') {
      out.images = (Array.isArray(source.images) ? source.images : []).slice(0, 80).map(x => {
        if (typeof x === 'string') return x.slice(0, 2048);
        if (!x || typeof x !== 'object') return null;
        const image = {};
        for (const k of ['localUrl', 'path', 'mime', 'size', 'url']) {
          if (x[k] !== undefined) image[k] = typeof x[k] === 'string' ? x[k].slice(0, 2048) : Number(x[k]) || 0;
        }
        return image;
      }).filter(Boolean);
    } else if (typeof source[key] === 'string') {
      out[key] = source[key].slice(0, key === 'summary' ? 2000 : 2048);
    } else if (typeof source[key] === 'number' || typeof source[key] === 'boolean' || source[key] === null) {
      out[key] = source[key];
    }
  }
  if (out.url && !out.sourceUrl) out.sourceUrl = out.url;
  delete out.url;
  return out;
}

function identity(meta) {
  return [String(meta.game || 'stellarblade').toLowerCase(), Number(meta.modId) || 0, Number(meta.fileId) || 0].join(':');
}

function createDownloadQueue({ file, onChange = null, now = () => new Date().toISOString(), makeId = () => crypto.randomUUID() } = {}) {
  if (!file) throw new Error('downloadQueue 需要数据文件路径');
  const db = readJson(file, { version: 1, tasks: [] });
  if (!Array.isArray(db.tasks)) db.tasks = [];

  let recovered = false;
  for (const task of db.tasks) {
    if (task.status === 'queued' || task.status === 'resolving' || task.status === 'downloading' || task.status === 'analyzing' || task.status === 'installing') {
      task.status = 'interrupted';
      task.error = '管理器上次退出时任务未完成；请重新授权或重试。';
      task.updatedAt = now();
      recovered = true;
    }
    if (!STATUSES.has(task.status)) {
      task.status = 'failed';
      task.error = '未知的任务状态，已标记失败。';
      task.updatedAt = now();
      recovered = true;
    }
  }
  if (recovered) writeJson(file, db);

  function persist(task) {
    writeJson(file, db);
    if (typeof onChange === 'function') {
      try { onChange(task ? clone(task) : null, list()); } catch { /* 通知失败不影响持久化 */ }
    }
  }

  function list() {
    return db.tasks.map(clone).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function get(id) {
    const task = db.tasks.find(x => x.id === String(id));
    return task ? clone(task) : null;
  }

  function getMutable(id) { return db.tasks.find(x => x.id === String(id)) || null; }

  function findByFile(meta) {
    const key = identity(meta || {});
    return db.tasks.find(task => identity(task.meta || {}) === key && ACTIVE_DUPLICATE_STATUSES.has(task.status)) || null;
  }

  function add(meta, { status = 'awaiting_authorization', archivePath = null, filename = null, size = 0, force = false } = {}) {
    const clean = safeMeta(meta);
    if (!Number.isInteger(Number(clean.modId)) || Number(clean.modId) <= 0) throw new Error('缺少有效的 Nexus Mod ID');
    if (clean.fileId != null && (!Number.isInteger(Number(clean.fileId)) || Number(clean.fileId) <= 0)) throw new Error('文件 ID 无效');
    if (!STATUSES.has(status)) throw new Error('无效的下载任务状态：' + status);

    // force：允许同一个 mod 再建一条（例如已装完想重下、或想换一个文件版本）
    const prior = findByFile(clean);
    if (prior && !force) return { task: clone(prior), duplicate: true };

    const stamp = now();
    const task = {
      id: String(makeId()),
      status,
      meta: clean,
      createdAt: stamp,
      updatedAt: stamp,
      progress: { received: 0, total: Number(clean.fileSize) || 0, percent: 0 },
      archivePath: archivePath || null,
      filename: filename || null,
      size: Number(size) || 0,
      error: null,
      install: null
    };
    db.tasks.push(task);
    persist(task);
    return { task: clone(task), duplicate: false };
  }

  function update(id, patch = {}) {
    const task = getMutable(id);
    if (!task) throw new Error('未找到下载任务：' + id);
    const next = { ...patch };
    if (next.status !== undefined && !STATUSES.has(next.status)) throw new Error('无效的下载任务状态：' + next.status);
    if (next.meta !== undefined) next.meta = { ...task.meta, ...safeMeta(next.meta) };
    if (next.progress !== undefined) next.progress = { ...task.progress, ...next.progress };
    if (next.install !== undefined && next.install && typeof next.install === 'object') next.install = { ...task.install, ...next.install };
    Object.assign(task, next, { updatedAt: now() });
    persist(task);
    return clone(task);
  }

  function updateProgress(id, progress) {
    const task = getMutable(id);
    if (!task) return null;
    task.progress = { ...task.progress, ...(progress || {}) };
    task.updatedAt = now();
    writeJson(file, db);
    if (typeof onChange === 'function') {
      try { onChange(clone(task), list()); } catch { /* 忽略 */ }
    }
    return clone(task);
  }

  function findByIdentity(game, modId, fileId) {
    return findByFile({ game, modId, fileId });
  }

  function remove(id) {
    const i = db.tasks.findIndex(x => x.id === String(id));
    if (i < 0) return false;
    db.tasks.splice(i, 1);
    persist(null);
    return true;
  }

  function findMatchingMod(modId) {
    const id = Number(modId);
    return list().find(task => Number(task.meta && task.meta.modId) === id && task.status === 'installed') || null;
  }

  return { list, get, add, update, updateProgress, findByIdentity, findMatchingMod, remove };
}

module.exports = { createDownloadQueue, STATUSES, safeMeta };
