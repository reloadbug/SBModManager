'use strict';
/**
 * 探针：验证 scanPaks 把 CNS 服装数据文件挂到同名 pak 组上了。
 * 重点看 4184 的两组（以及 .dekcns.json 是否还隐形）。
 */
const path = require('path');
const root = 'C:\\games\\Star Blade';
const paths = require(path.join(__dirname, '..', 'src', 'main', 'paths.js'));
const scanner = require(path.join(__dirname, '..', 'src', 'main', 'scanner.js'));
const { createRegistry } = require(path.join(__dirname, '..', 'src', 'main', 'registry.js'));
const linker = require(path.join(__dirname, '..', 'src', 'main', 'linker.js'));

const reg = createRegistry(paths.modsFile);
const links = linker.linkReader(paths.modLinksFile);
const out = scanner.scan(root, reg, links);

const paks = out.filter(m => m.kind === 'pak');
console.log('总条目:', out.length, ' pak 组:', paks.length);
console.log('带 CNS 伴随件的组:', paks.filter(m => (m.cnsData || []).length).length);
console.log('伴随件总数:', paks.reduce((s, m) => s + (m.cnsData || []).length, 0));

console.log('\n=== 4184 / 4114 相关组 ===');
for (const m of paks.filter(m => (m.name || '').match(/Kamenlaideng|Breast_Hip/i))) {
  console.log('-', m.id, '| 启用:', m.enabled, '| 文件:', m.fileCount, '| 大小:', m.size);
  m.files.forEach(f => console.log('    ', f.name, f.size, f.companion ? '[伴随]' : ''));
  if (m.cnsData && m.cnsData.length) console.log('     cnsData:', m.cnsData.join(', '));
}

console.log('\n=== 一眼检查：还有哪些 dekcns 没被任何组带上 ===');
const allFiles = new Set();
for (const m of paks) for (const f of m.files || []) allFiles.add(String(f.name).toLowerCase());
const fs = require('fs');
const modsDir = require(path.join(__dirname, '..', 'src', 'main', 'game.js')).layout(root).modsDir;
const cnsAll = fs.readdirSync(modsDir).filter(n => scanner.CNS_DATA.test(n));
const missed = cnsAll.filter(n => !allFiles.has(n.toLowerCase()));
console.log('~Mods 里 CNS 数据文件:', cnsAll.length, ' 未挂上的:', missed.length);
missed.slice(0, 8).forEach(n => console.log('   漏:', n));
