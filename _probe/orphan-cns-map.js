/*
 * 孤儿 CNS 数据文件 → 能否挂到已有卡片上（只读）
 * 读上一步 _shots/orphan-cns-audit.json 的结论，再扫一遍卡片，
 * 看「出处 modId」在卡片里有没有对应的 Mod（有 → 直接挂上去就能看见）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');

const paths = require(path.join(REPO, 'src', 'main', 'paths'));
const scanner = require(path.join(REPO, 'src', 'main', 'scanner'));
const { createRegistry } = require(path.join(REPO, 'src', 'main', 'registry'));
const { linkReader } = require(path.join(REPO, 'src', 'main', 'linker'));
const installer = require(path.join(REPO, 'src', 'main', 'installer'));

const ROOT = 'C:\\games\\Star Blade';
const auditFile = path.join(REPO, '_shots', 'orphan-cns-audit.json');
const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));

const L = require(path.join(REPO, 'src', 'main', 'game')).layout(ROOT);
const registry = createRegistry(path.join(ROOT, '.sbmod', 'mods.json'));
const items = scanner.scan(ROOT, registry, linkReader(paths.modLinksFile));

// modId → 卡片（可能多张）
const byMod = new Map();
for (const it of items) {
    const src = (it.meta && it.meta.source) || {};
    // 已登记的看 source.modId；未登记的卡片没有 meta，modId 只写在文件名标识 `[nx123]` 里
    const tagId = Number((it.tag && it.tag.modId) || 0) || 0;
    const modId = Number(src.modId || (it.meta && it.meta.modId) || tagId || 0) || 0;
  if (!modId) continue;
  if (!byMod.has(modId)) byMod.set(modId, []);
  byMod.get(modId).push(it);
}

const hasCard = [];
const noCard = [];
for (const r of audit.found) {
  const modId = r.src ? Number(r.src.modId) || 0 : 0;
  const cards = byMod.get(modId) || [];
  // 该 mod 的卡片上已经有同名文件了？
  const key = installer.fileKey(r.name);
  const already = cards.some(c => (c.files || []).some(f => installer.fileKey(f.name) === key));
  const row = { name: r.name, modId, cards: cards.map(c => `${c.id}(${(c.files || []).length}文件)`), already };
  (cards.length && !already ? hasCard : noCard).push(row);
}

console.log(`孤儿可追出处 ${audit.found.length} 个：`);
console.log(`  【A】出处 mod 在卡片里、文件还没挂上 → 可以直接补 ${hasCard.length} 个`);
for (const r of hasCard) console.log(`    ${r.name}  →  modId ${r.modId}  ${r.cards.join(' ')}`);
console.log(`  【B】出处 mod 在卡片里但文件已挂上（重复？）或没有对应卡片 → ${noCard.length} 个`);
for (const r of noCard) console.log(`    ${r.name}  →  modId ${r.modId}  ${r.cards.join(' ') || '（无卡片）'}${r.already ? '  [已挂]' : ''}`);

console.log(`\n完全无出处 ${audit.lost.length} 个：`);
for (const r of audit.lost) console.log(`  ${r.name}  (${r.size} B, ${r.btime.slice(0, 10)})`);
