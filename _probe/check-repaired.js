'use strict';
const fs = require('fs');
const path = require('path');
const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const registryMod = M('registry.js');
const scanner = M('scanner.js');
const linker = M('linker.js');
const root = 'C:\\games\\Star Blade';
const reg = registryMod.createRegistry(path.join(root, '.sbmod', 'mods.json'));
const items = scanner.scan(root, reg, linker.linkReader(path.join(root, '.sbmod', 'mod-links.json')));
console.log('总条目 ' + items.length + '，注册表 ' + reg.all().length + ' 条');
for (const it of items) {
  const mId = (it.meta && (it.meta.modId || (it.meta.source && it.meta.source.modId))) || 0;
  if (![2272, 3977, 4184].includes(Number(mId))) continue;
  console.log('  ' + it.id + '  ' + (it.enabled ? '开' : '关') + '  ' + (it.files || []).length + ' 文件  ' + (it.size / 1048576).toFixed(1) + ' MB');
  for (const f of it.files || []) console.log('      - ' + f.name + (f.disabled ? '  (关)' : '') + (f.companion ? '  [伴随]' : ''));
}
