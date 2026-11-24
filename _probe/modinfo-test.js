#!/usr/bin/env node
/*
 * 「Mod 基本信息本地档案」自检（2026-11-10）。
 *
 * 用户要求（原话）：
 *   「已下载的文件一旦关联上mod的信息，全部缓存到本地，包括图片和基本信息，
 *     不要每次都去在线查询优先使用本地数据」
 *
 * 分四段：
 *   A. **档案模块真跑** —— `createModInfo()` 用临时目录测增删查、合并写、
 *      坏文件兜底、封面 URL（文件在 / 不在）；
 *   B. **目录条目转换** —— `fromCatalog()` 把 Nexus 目录缓存那条裁成展示字段，
 *      空/垃圾条目返回 null；
 *   C. **接线静态断言** —— ipc 的两条通道、`infoLocal` 只读本地（读档案 + 目录倒排）、
 *      `infoFill` 限量 6 条并把封面落盘、`library:list` 挂 `it.info`、
 *      封面预热、`applyLinks` 落档案；preload 暴露 `info.local/fill`；
 *      渲染层 `libCardHtml` 用 `it.info` / `coverLocal`、`ensureLibMeta` 先本地后补。
 *   D. **不许在线查询的硬约束** —— `infoLocal()` 函数体里不能出现 `nexus.` / `getMod(`。
 *
 * 跑法：node _probe/modinfo-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const IPC = path.join(ROOT, 'src/main/ipc.js');
const APP = path.join(ROOT, 'src/renderer/app.js');
const PRELOAD = path.join(ROOT, 'src/preload/index.js');

const { createModInfo, fromCatalog } = require('../src/main/modInfo');

const TMP = path.join(os.tmpdir(), 'sb-modinfo-test');
const DIR = path.join(TMP, 'mod-info');

let pass = 0;
let fail = 0;
const fails = [];
function ok(label, cond, extra) {
  if (cond) { pass++; return true; }
  fail++;
  fails.push(label + (extra ? '  → ' + extra : ''));
  return false;
}
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return ok(label, g === w, '得到 ' + g + '，期望 ' + w);
}
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

/** 从源码里抠一个函数（大括号配平） */
function grabFunction(src, name) {
  const start = src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

async function main() {
  /* ---------------- A. 档案模块 ---------------- */
  fs.rmSync(TMP, { recursive: true, force: true });
  const store = createModInfo({ dir: DIR });

  eq('A1 没有档案时 get 返回 null', store.get(1496), null);
  const r1 = store.put({ modId: 1496, name: 'CNS', author: 'DekitaRPG', version: '2.2', summary: 's', pictureUrl: 'http://x/1.jpg' });
  ok('A2 put 返回写进去的记录', r1 && r1.modId === 1496 && r1.name === 'CNS');
  ok('A3 写了 at 时间戳', r1 && Number(r1.at) > 0);
  const g1 = store.get(1496);
  ok('A4 get 能读回来', g1 && g1.name === 'CNS' && g1.author === 'DekitaRPG');
  ok('A5 一条一个文件', fs.existsSync(path.join(DIR, '1496.json')));

  // 合并写：只给要改的字段，别的不能被抹掉
  store.put({ modId: 1496, coverFile: 'D:\\fake\\cover.jpg' });
  const g2 = store.get(1496);
  ok('A6 合并写保留老字段', g2 && g2.name === 'CNS' && g2.author === 'DekitaRPG' && g2.coverFile === 'D:\\fake\\cover.jpg');

  ok('A7 非法 modId 不写', store.put({ modId: 0, name: 'x' }) === null && store.put({ name: 'x' }) === null);

  // 坏文件不能让 get 崩
  fs.writeFileSync(path.join(DIR, '7.json'), '{ 这不是 json', 'utf8');
  eq('A8 坏 JSON 当没有', store.get(7), null);

  // modId 对不上也算没有（防止文件被改名/拷错）
  fs.writeFileSync(path.join(DIR, '8.json'), JSON.stringify({ modId: 9999, name: 'x' }), 'utf8');
  eq('A9 modId 对不上当没有', store.get(8), null);

  store.putMany([
    { modId: 550, name: 'YoRHa', author: 'Njaecha', version: '1.1.0' },
    { modId: 2514, name: 'Eve x Bayonetta', author: 'SrPoolStrange', version: '1.0' }
  ]);
  const all = store.all().map(x => x.modId).sort((a, b) => a - b);
  eq('A10 all 列出全部档案', all, [550, 1496, 2514]);

  store.put({ modId: 550, coverFile: path.join(DIR, 'not-there.jpg') });
  eq('A11 封面文件不存在时给空串', store.coverUrlOf(store.get(550)), '');

  const realCover = path.join(TMP, 'cover.jpg');
  fs.writeFileSync(realCover, 'x');
  store.put({ modId: 550, coverFile: realCover });
  eq('A12 封面文件在就给 file:// 地址', store.coverUrlOf(store.get(550)), pathToFileURL(realCover).href);

  ok('A13 isFresh 对刚写的为真', store.isFresh(store.get(550)) === true);
  ok('A14 isFresh 对空为假', store.isFresh(null) === false);

  ok('A15 remove 能删掉', store.remove(2514) === true && store.get(2514) === null);
  ok('A16 remove 删不存在的返回 false', store.remove(2514) === false);

  /* ---------------- B. 目录条目转换 ---------------- */
  const cat1 = fromCatalog({
    modId: 1496,
    name: 'CNS - Custom Nanosuit System',
    author: 'DekitaRPG',
    version: '2.2',
    summary: 'CNS - Allows custom nanosuits…',
    pictureUrl: 'https://static/1496.jpg',
    url: 'https://www.nexusmods.com/stellarblade/mods/1496',
    downloads: 816510
  });
  ok('B1 裁出展示字段', cat1 && cat1.modId === 1496 && cat1.name.includes('CNS') && cat1.author === 'DekitaRPG');
  ok('B2 带上封面地址与出处', cat1 && cat1.pictureUrl === 'https://static/1496.jpg' && cat1.url.includes('/mods/1496'));
  ok('B3 记下来源是目录', cat1.source === 'catalog');
  eq('B4 空条目返回 null', fromCatalog(null), null);
  eq('B5 没有 modId 返回 null', fromCatalog({ name: 'x' }), null);
  const cat2 = fromCatalog({ modId: 5, name: 'n', image: 'https://static/5.jpg' });
  ok('B6 只有 image 字段时也能取封面', cat2.pictureUrl === 'https://static/5.jpg');

  /* ---------------- C. 接线静态断言 ---------------- */
  const ipc = read(IPC);
  const app = read(APP);
  const pre = read(PRELOAD);

  ok('C1 ipc 引了 modInfo', ipc.includes("require('./modInfo')"));
  ok('C2 有两条通道', ipc.includes("handle('info:local'") && ipc.includes("handle('info:fill'"));
  ok('C3 档案单例', ipc.includes('function modInfoStore()'));
  ok('C4 目录倒排按 fetchedAt 缓存', ipc.includes('function catalogById()') && ipc.includes('catalogByIdCache.key === fetchedAt'));

  const infoLocal = grabFunction(ipc, 'infoLocal');
  ok('C5 infoLocal 存在', !!infoLocal);
  ok('C6 infoLocal 先读档案再读目录', infoLocal.includes('store.get(id)') && infoLocal.includes('cat.get(id)'));
  // 0.9.6：落成档案时先合并，保住已有的 description / descriptionZh
  ok('C7 infoLocal 把目录条目落成档案', infoLocal.includes('fromCatalog(entry)') && infoLocal.includes('store.put(merged)'));
  ok('C8 infoLocal 返回 file:// 封面', infoLocal.includes('coverLocal: store.coverUrlOf(rec)'));
  ok('C9 infoLocal 会预热封面', infoLocal.includes('warmCovers('));

  const infoFill = grabFunction(ipc, 'infoFill');
  ok('C10 infoFill 存在', !!infoFill);
  ok('C11 infoFill 一次最多 6 条', infoFill.includes('.slice(0, 6)'));
  ok('C12 infoFill 已经齐了就不发请求', infoFill.includes("old && old.name && old.pictureUrl"));
  ok('C13 infoFill 把封面存进图片缓存', infoFill.includes('cacheModImages(id, [pictureUrl]'));
  ok('C14 infoFill 落盘 coverFile', infoFill.includes('coverFile'));

  ok('C15 封面预热工具存在且限量 3 张', ipc.includes('function warmCovers(') && ipc.includes('.slice(0, 3)'));
  ok('C16 预热完把路径记进档案', ipc.includes("modInfoStore().put({ modId: id, coverFile: hit.path })"));

  const libList = ipc.slice(ipc.indexOf("handle('library:list'"), ipc.indexOf("handle('library:install'"));
  ok('C17 library:list 挂 it.info', libList.includes('it.info = {'));
  ok('C18 挂的信息带封面本地地址', libList.includes('coverLocal: store.coverUrlOf(rec)'));
  ok('C19 library:list 后台补缺信息的包', libList.includes('infoFill(lacking)'));
  ok('C20 library:list 预热封面', libList.includes('warmCovers('));

  const applyLinks = grabFunction(ipc, 'applyLinks');
  ok('C21 applyLinks 落档案', applyLinks.includes('modInfoStore().put({'));
  ok('C22 applyLinks 记下封面路径', applyLinks.includes('coverFile = hit.path'));

  ok('C23 preload 暴露 info.local', pre.includes("local: (modIds) => invoke('info:local', modIds)"));
  ok('C24 preload 暴露 info.fill', pre.includes("fill: (modIds) => invoke('info:fill', modIds)"));

  ok('C25 卡片用 it.info 兜底', app.includes('libMetaFor(it.modId) || it.info || {}'));
  ok('C26 卡片优先本地封面', app.includes('meta.coverLocal || meta.image || coverForMod'));

  const ensure = grabFunction(app, 'ensureLibMeta');
  ok('C27 ensureLibMeta 先问本地', ensure.includes('api.local(miss)'));
  ok('C28 只补本地缺的、一次 6 条', ensure.includes('api.fill(still)') && ensure.includes('.slice(0, 6)'));
  ok('C29 不再直接用 nexus detail 拉信息', !ensure.includes('nx.detail'));

  /* ---------------- D. 硬约束：infoLocal 不许联网 ---------------- */
  ok('D1 infoLocal 里没有 nexus.getMod', !infoLocal.includes('getMod('));
  ok('D2 infoLocal 里没有 nexus.', !infoLocal.includes('nexus.'));
  ok('D3 infoLocal 不碰图集抓取器', !infoLocal.includes('gallery.'));

  fs.rmSync(TMP, { recursive: true, force: true });

  if (fail) {
    console.log('❌ modinfo: ' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('\n失败项：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ modinfo: ' + pass + ' 通过 / 0 失败');
}

main().catch(e => {
  console.error('套件本身崩了：', e);
  process.exit(1);
});
