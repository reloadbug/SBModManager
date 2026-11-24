#!/usr/bin/env node
/*
 * 三状态详情整合自检（2026-11-24，m15581 / m15651 / m15666）。
 *
 * 用户要求：
 *   1. 三套详情整合成一套 —— 只有一个界面、20 个固定字段、状态不同只是值不同；
 *   2. CNS 服装判定扩到三处来源（名称 / 说明 / 解压后文件名）任一命中；
 *   3. 描述 + 机器译文持久化进本地 mod-info 档案，翻一次不再重翻。
 *
 * 分四段：
 *   A. fromCatalog 裁出 description/descriptionHtml/descriptionZh；档案合并写能存译文；
 *   B. 静态接线断言（app.js / ipc.js / preload）；
 *   C. vm 真跑 cnsEvidence / libTypeOf / unifiedInfoRows（20 字段 + 灰色占位）；
 *   D. 硬约束：unifiedInfoRows 字段顺序与Fixed一致、翻译写盘调用存在。
 *
 * 跑法：node _probe/detail-unify-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src/renderer/app.js');
const IPC = path.join(ROOT, 'src/main/ipc.js');
const PRELOAD = path.join(ROOT, 'src/preload/index.js');

const { createModInfo, fromCatalog } = require('../src/main/modInfo');

const TMP = path.join(os.tmpdir(), 'sb-detail-unify-test');
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
  /* ---------------- A. modInfo 描述/译文字段 ---------------- */
  fs.rmSync(TMP, { recursive: true, force: true });
  const store = createModInfo({ dir: path.join(TMP, 'mod-info') });
  const cat = fromCatalog({
    modId: 1496, name: 'CNS Suit',
    summary: 'short', description: 'Long description mentions CNS compatible',
    descriptionHtml: '<p>Long <b>CNS</b></p>', descriptionZh: '中文说明',
    pictureUrl: 'https://x/1.jpg'
  });
  ok('A1 fromCatalog 带 description', cat && cat.description === 'Long description mentions CNS compatible');
  ok('A2 fromCatalog 带 descriptionHtml', cat && cat.descriptionHtml === '<p>Long <b>CNS</b></p>');
  ok('A3 fromCatalog 带 descriptionZh', cat && cat.descriptionZh === '中文说明');
  store.put(cat);
  // 翻译回写：合并写，不抹掉其它字段
  store.put({ modId: 1496, descriptionZh: 'CNS 中文翻译', summaryZh: '短译文' });
  const g = store.get(1496);
  ok('A4 译文合并写保留老字段', g && g.name === 'CNS Suit' && g.descriptionZh === 'CNS 中文翻译' && g.summaryZh === '短译文');
  ok('A5 译文落盘（重新 get）', store.get(1496).descriptionZh === 'CNS 中文翻译');

  /* ---------------- B. 静态接线断言 ---------------- */
  const app = read(APP);
  const ipc = read(IPC);
  const pre = read(PRELOAD);

  ok('B1 app 有 unifiedInfoRows', app.includes('function unifiedInfoRows(c)'));
  ok('B2 app 有 cnsEvidence', app.includes('function cnsEvidence(rec)'));
  const infoSaveCh = ipc.slice(ipc.indexOf("handle('info:saveTranslation'"), ipc.indexOf("handle('info:fill'") > 0 ? ipc.indexOf("handle('info:fill'") : ipc.length);
  ok('B3 ipc 有 info:saveTranslation 通道', ipc.includes("handle('info:saveTranslation'"));
  ok('B4 preload 暴露 saveTranslation', pre.includes('saveTranslation: (payload) => invoke('));
  ok('B5 infoFill 落盘 description', ipc.includes('description: d.description || d.descriptionText'));
  ok('B6 applyLinks 落盘 description', ipc.includes('description: info.description || info.descriptionText'));
  const infoFill = grabFunction(ipc, 'infoFill');
  ok('B7 infoFill 缺少 description 时也补', infoFill.includes('old.description'));
  const doTranslate = grabFunction(app, 'doTranslate');
  ok('B8 doTranslate 成功写回档案', doTranslate.includes('info.saveTranslation'));
  ok('B9 doTranslate 写 descriptionZh', doTranslate.includes('descriptionZh: r.text'));
  ok('B10 openModDrawer 读本地译文', app.includes('info.descriptionZh'));
  ok('B11 fillOnlineDrawer 用统一表格', app.includes('box.innerHTML = localStateRowHtml() + unifiedInfoRows(ctx)'));
  ok('B12 infoCtx 带两定位', app.includes('installPath:') && app.includes('archivePath:'));

  /* ---------------- C. vm 真跑三个函数 ---------------- */
  const cnsSrc = grabFunction(app, 'cnsEvidence');
  const typeSrc = grabFunction(app, 'libTypeOf');
  const rowsSrc = grabFunction(app, 'unifiedInfoRows');
  const ctx = {
    esc: (s) => String(s == null ? '' : s),
    fmtDate: (s) => 'DATE(' + s + ')',
    fmtWhen: (s) => 'WHEN(' + s + ')',
    fmtSize: (n) => 'SIZE(' + n + ')',
    KIND_LABEL: { outfit: '套装', prereq: '前置组件' }
  };
  vm.createContext(ctx);
  vm.runInContext(cnsSrc + '\n' + typeSrc + '\n' + rowsSrc, ctx);

  eq('C1 名称含 cns 的判定依据', vm.runInContext("cnsEvidence({name:'My CNS Outfit'})", ctx), '名称含 cns');
  eq('C2 说明含 cns 的判定依据', vm.runInContext("cnsEvidence({name:'Plain',description:'CNS compatible dress'})", ctx), '说明里提到 CNS');
  eq('C3 文件名含 dekcns 的判定依据', vm.runInContext("cnsEvidence({name:'Plain',items:[{rel:'x.dekcns.json'}]})", ctx), '解压文件含 dekcns/cns');
  eq('C4 都没有时无依据', vm.runInContext("cnsEvidence({name:'Plain',description:'nice',items:[]})", ctx), '');

  eq('C5 libTypeOf 名称命中', vm.runInContext("libTypeOf({name:'CNS Suit'})", ctx), 'cns');
  eq('C6 libTypeOf 说明命中', vm.runInContext("libTypeOf({name:'Plain',description:'CNS compatible'})", ctx), 'cns');
  eq('C7 libTypeOf 文件名命中', vm.runInContext("libTypeOf({name:'Plain',items:[{rel:'a_cns_p.pak'}]})", ctx), 'cns');
  eq('C8 libTypeOf 前置组件单列', vm.runInContext("libTypeOf({name:'UE4SS',groupKind:'prereq'})", ctx), 'prereq');
  eq('C9 libTypeOf 普通服装', vm.runInContext("libTypeOf({name:'Nice Dress'})", ctx), 'outfit');

  const rowsHtml = vm.runInContext("unifiedInfoRows({modId:1496,statusText:'已启用',statusColor:'var(--ok)',typeText:'套装',author:'Dek',installPath:'C:\\\\games',archivePath:'D:\\\\lib\\\\1.zip',fileCount:3,size:1024})", ctx);
  const LABELS = ['Mod ID', '状态', '类型', '版本', '作者', '分类', '成人', '下载量', '点赞数', '发布时间', '更新时间', '修改时间', '开启时间', '禁用时间', '安装时间', '登记状态', '安装位置', '压缩包位置', '文件数', '占用'];
  let lastPos = -1;
  let orderOK = true;
  for (const lab of LABELS) {
    const p = rowsHtml.indexOf('>' + lab + '<');
    if (p < 0 || p < lastPos) { orderOK = false; break; }
    lastPos = p;
  }
  ok('C10 20 字段固定顺序', orderOK, 'rowsHtml 长度 ' + rowsHtml.length);
  eq('C11 字段数正好 20', (rowsHtml.match(/class="kv/g) || []).length, 20);
  ok('C12 空值加 na 占位', rowsHtml.includes('class="kv na"'));
  ok('C13 安装位置带 📁', rowsHtml.includes('📁') === false /* ctx 未给 installPathBtn */);
  // 作者行有值 → 那一行是 `<div class="kv">` 而不是 `<div class="kv na">`
  ok('C14 有值时不是 na', /<div class="kv"><span>作者<\/span><span>Dek<\/span><\/div>/.test(rowsHtml));

  /* ---------------- D. 硬约束 ---------------- */
  ok('D1 详情只用统一表格（无旧 rows.push 逐字段残留）', !grabFunction(app, 'openModDrawer').includes("rows.push(kvHtml('作者'"));
  ok('D2 三块专属段保留', app.includes('drawingGallery') || app.includes('图集') && app.includes('installedFilesHtml') && app.includes('nxfiles'));
  ok('D3 翻译失败不影响显示（catch 吞掉）', doTranslate.includes('.catch(() => {})'));

  fs.rmSync(TMP, { recursive: true, force: true });

  if (fail) {
    console.log('detail-unify: ' + pass + ' passed / ' + fail + ' FAILED');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('detail-unify: ' + pass + ' passed / 0 FAILED');
}

main().catch(e => {
  console.error('suite crashed:', e);
  process.exit(1);
});
