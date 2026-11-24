'use strict';
/**
 * 探针 v2：用 Dice 字符双字组相似度给每个 CNS 数据文件找最像的 pak 组，
 * 看覆盖率、边缘情况（第二名差距太小 = 不可信）。
 */
const fs = require('fs');
const path = require('path');
const root = 'C:\\games\\Star Blade';
const paths = require(path.join(__dirname, '..', 'src', 'main', 'paths.js'));
const game = require(path.join(__dirname, '..', 'src', 'main', 'game.js'));
const toggleName = require(path.join(__dirname, '..', 'src', 'main', 'toggleName.js'));
const { createRegistry } = require(path.join(__dirname, '..', 'src', 'main', 'registry.js'));

const PAK_EXT = /\.(pak|ucas|utoc)$/i;
const CNS_DATA = /\.(dekcns|dekani)(\.json)?$/i;

const norm = (s) => String(s)
  .replace(/\s*\[nx\d+\]/ig, '')
  .replace(CNS_DATA, '').replace(PAK_EXT, '').replace(/\.json$/i, '')
  .replace(/[^a-z0-9]+/ig, '').toLowerCase();

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  const total = (a.length - 1) + (b.length - 1);
  return total > 0 ? (2 * inter) / total : 0;
}

const L = game.layout(root);
const reg = createRegistry(paths.modsFile);
const files = fs.readdirSync(L.modsDir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);

const groups = [], cns = [];
for (const name of files) {
  const base = toggleName.stripDisabled(name);
  if (PAK_EXT.test(base)) { groups.push(base.replace(PAK_EXT, '')); continue; }
  if (CNS_DATA.test(base)) cns.push({ name, base, disabled: toggleName.isDisabledName(name) });
}

const owned = new Set();
for (const r of reg.all()) for (const f of r.manifest || []) if (f && f.path) owned.add(String(f.path).toLowerCase());

let attached = 0, ownedN = 0;
const orphans = [], weak = [], rows = [];
for (const c of cns) {
  if (owned.has(path.join(L.modsDir, c.name).toLowerCase())) { ownedN++; continue; }
  const s = norm(c.base);
  let best = null, second = 0;
  for (const k of groups) {
    const d = dice(s, norm(k));
    if (!best || d > best.d) { second = best ? best.d : second; best = { k, d }; }
    else if (d > second) second = d;
  }
  if (best && best.d >= 0.8) {
    attached++;
    if (best.d - second < 0.03) weak.push({ cns: c.name, pak: best.k, d: best.d.toFixed(3), second: second.toFixed(3) });
    rows.push({ cns: c.name, pak: best.k, d: best.d.toFixed(3) });
  } else {
    orphans.push({ cns: c.name, best: best ? best.k : '-', d: best ? best.d.toFixed(3) : '0' });
  }
}

console.log('pak 组:', groups.length, ' CNS 数据文件:', cns.length, ' 已登记认领:', ownedN);
console.log('Dice>=0.8 挂上:', attached, ' 孤儿:', orphans.length, ' 差距过小(存疑):', weak.length);
console.log('\n--- 存疑匹配 ---'); weak.slice(0, 15).forEach(r => console.log(' ', r.cns, '<->', r.pak, r.d, 'vs', r.second));
console.log('\n--- 孤儿（前 25）---'); orphans.slice(0, 25).forEach(r => console.log(' ', r.cns, '  最像:', r.best, r.d));
console.log('\n--- 正常匹配样例（前 12）---'); rows.slice(0, 12).forEach(r => console.log(' ', r.cns, '<->', r.pak, r.d));
