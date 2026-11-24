'use strict';
/**
 * 列出「磁盘上有文件、但没有安装包可对账」的那些 Mod，逐个把文件摊开。
 * 另外把注册表里对不上的几条（前置组件之类）单独说清楚。
 */
const path = require('path');
const fs = require('fs');
const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const scanner = M('scanner.js');
const game = M('game.js');
const prereqs = M('prereqs.js');
const { createRegistry } = M('registry.js');

const root = process.argv[2] || 'C:\\games\\Star Blade';
const reg = createRegistry(path.join(root, '.sbmod', 'mods.json'));

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

function archives() {
  const map = new Map();
  const files = [path.join(root, '.sbmod', 'downloads.json'),
    path.join(__dirname, '..', 'data', 'downloads.json')];
  for (const f of files) {
    if (!exists(f)) continue;
    let db = null; try { db = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const t of (db.tasks || [])) {
      const id = t && t.meta && t.meta.modId;
      if (!id) continue;
      const ap = t.archivePath || '';
      if (!ap || !exists(ap)) continue;
      const k = String(id);
      const prev = map.get(k);
      const score = (t.status === 'installed' ? 2 : 1);
      if (!prev || score > prev.score) map.set(k, { ap, score, name: t.meta.name || '', taskId: t.id });
    }
  }
  const dir = path.join(__dirname, '..', 'data', 'library');
  if (exists(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(\d+)_.*\.(zip|7z|rar)$/i);
      if (m && !map.has(m[1])) map.set(m[1], { ap: path.join(dir, f), score: 0, name: '', taskId: null });
    }
  }
  return map;
}

const items = scanner.scan(root, reg, null);
const qa = archives();

const byMod = new Map();
for (const it of items) {
  const modId = String((it.meta && it.meta.source && it.meta.source.modId) || (it.tag && it.tag.modId) || '');
  const key = modId || ('disk:' + it.id);
  if (!byMod.has(key)) byMod.set(key, { modId, name: it.name, kind: it.kind, files: [], ids: [], registered: false, location: it.location, meta: it.meta });
  const g = byMod.get(key);
  for (const f of (it.files || [])) if (f && f.name) g.files.push(f.name);
  g.ids.push(it.id);
  if (it.registered) g.registered = true;
}

console.log('CNS 前置的 modId:', (prereqs.PREREQS && prereqs.PREREQS.cns && prereqs.PREREQS.cns.modId) || '(未配置)');
console.log('');

let n = 0;
const rows = [];
for (const [key, g] of byMod) {
  if (g.modId && qa.has(g.modId)) continue;      // 有包，不在这份清单里
  n++;
  rows.push(g);
}
console.log('=== 没有安装包可对账的 ' + n + ' 个 ===');
for (const g of rows) {
  console.log('');
  console.log(n + '. ' + g.name + '   id=' + (g.modId || '(无 modId)') + '   类型=' + g.kind
    + (g.registered ? '   [注册表有记录]' : '   [未登记]')
    + (String(g.modId) === String(prereqs.PREREQS && prereqs.PREREQS.cns && prereqs.PREREQS.cns.modId) ? '   ← CNS 前置' : ''));
  console.log('   落点：' + (g.location || '?'));
  console.log('   文件（' + g.files.length + ' 个）：' + g.files.join('、'));
  const rec = reg.get(g.ids[0]);
  if (rec && rec.archivePath) console.log('   注册表里记的包：' + rec.archivePath + (exists(rec.archivePath) ? '' : '（已不在磁盘上）'));
}
