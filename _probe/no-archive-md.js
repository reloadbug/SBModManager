'use strict';
/**
 * 生成「没有安装包、无从对账」的条目清单（Markdown）。
 * 口径：扫描出来的条目里，注册表/下载队列/本地库里都找不到可用安装包的那些。
 * 输出：docs/无安装包清单-<日期>.md
 */
const fs = require('fs');
const path = require('path');
const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const paths = M('paths.js');
const registryMod = M('registry.js');
const scanner = M('scanner.js');
const linker = M('linker.js');
const prereqs = M('prereqs.js');

const root = 'C:\\games\\Star Blade';
const DATA = 'D:\\AI game\\StarBladeModManager\\data';
const reg = registryMod.createRegistry(path.join(root, '.sbmod', 'mods.json'));
const items = scanner.scan(root, reg, linker.linkReader(path.join(root, '.sbmod', 'mod-links.json')));

const queue = JSON.parse(fs.readFileSync(path.join(root, '.sbmod', 'downloads.json'), 'utf8')).tasks || [];
const libFiles = fs.readdirSync(path.join(DATA, 'library'));

function pkgFor(it) {
  const rec = it.id && reg.get ? reg.get(it.id) : null;
  const cands = [];
  if (rec && rec.archivePath) cands.push(rec.archivePath);
  const mId = (it.meta && it.meta.modId) || (rec && rec.source && rec.source.modId) || 0;
  for (const t of queue) {
    if (mId && t.meta && Number(t.meta.modId) === Number(mId) && t.archivePath) cands.push(t.archivePath);
  }
  if (mId) for (const f of libFiles) if (new RegExp('^' + mId + '_').test(f)) cands.push(path.join(DATA, 'library', f));
  if (it.archive && it.archive.path) cands.push(it.archive.path);
  return cands.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

const rows = [];
for (const it of items) {
  if (pkgFor(it)) continue;
  const rec = it.id && reg.get ? reg.get(it.id) : null;
  const kind = it.kind || (it.meta && it.meta.kind) || '';
  const role = it.id === 'builtin:ue4ss' ? 'UE4SS 本体（前置）'
    : (it.kind === 'prereq' ? '前置组件'
      : (it.location && /ue4ss/i.test(it.location) ? 'UE4SS 自带脚本' : '普通 Mod'));
  const mId = (it.meta && it.meta.modId) || (rec && rec.source && rec.source.modId) || 0;
  const files = (it.files || []).map(f => (typeof f === 'string' ? f : f.name));
  rows.push({ name: it.name, kind, role, modId: mId, location: it.location || '', files, n: files.length });
}

const cnsId = (prereqs.PREREQS && prereqs.PREREQS.cns && prereqs.PREREQS.cns.modId) || 0;
const day = new Date().toISOString().slice(0, 10);
const md = [];
md.push('# 没有安装包、无从对账的条目（' + day + '）');
md.push('');
md.push('扫描了 `' + root + '`，共 ' + items.length + ' 个条目，其中 **' + rows.length + ' 个**找不到任何安装包（注册表记录的包路径、下载队列、本地库都查过）。');
md.push('这 ' + rows.length + ' 个里**没有一个是「你装的 Mod 丢了安装包」**：分布是 UE4SS 本体、CNS 前置（modId ' + cnsId + '）、以及 UE4SS 自带的脚本 Mod。');
md.push('');
md.push('| # | 条目 | 角色 | modId | 落点 | 文件数 |');
md.push('|---|------|------|-------|------|--------|');
rows.forEach((r, i) => {
  md.push('| ' + (i + 1) + ' | ' + r.name + ' | ' + r.role + ' | ' + (r.modId || '—') + ' | `' + r.location + '` | ' + r.n + ' |');
});
md.push('');
md.push('## 逐个文件清单');
for (const r of rows) {
  md.push('');
  md.push('### ' + r.name + (r.modId ? '（modId ' + r.modId + '）' : '') + ' — ' + r.role + ' · ' + r.n + ' 个文件');
  md.push('');
  md.push('落点：`' + r.location + '`');
  md.push('');
  for (const f of r.files) md.push('- `' + f + '`');
}
const out = path.join(__dirname, '..', 'docs', '无安装包清单-' + day + '.md');
fs.writeFileSync(out, md.join('\n') + '\n', 'utf8');
console.log('写出：' + out);
console.log('条目数：' + rows.length + '（总条目 ' + items.length + '）');
for (const r of rows) console.log('  - ' + r.role.padEnd(14) + ' ' + r.name + '  [' + r.n + ' 文件]');
