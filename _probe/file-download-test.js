'use strict';
/**
 * 「多文件 mod 每个文件后面都带下载按钮」的离线断言。
 *
 * 第一段从 app.js 里**原样抽出** renderFiles，在 vm 里喂一个假 DOM 跑真身，
 * 断言每个文件行都带 data-dl-file（可直接钉死 fileId）；
 * 第二段对点击接线做静态断言，防止实现与测试漂移。
 *
 * 跑法：node _probe/file-download-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer', 'app.js');
const IPC = path.join(ROOT, 'src', 'main', 'ipc.js');
const QUEUE = path.join(ROOT, 'src', 'main', 'downloadQueue.js');

const code = fs.readFileSync(SRC, 'utf8');
const ipcCode = fs.readFileSync(IPC, 'utf8');
const queueCode = fs.readFileSync(QUEUE, 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === true) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → 抛出 ' + e.message); }
}

// ---- 抽出 renderFiles 真身 ----
const start = code.indexOf('function renderFiles(');
assert.ok(start >= 0, 'app.js 里应能找到 renderFiles 函数定义');
const end = code.indexOf('\n}\n', start);
assert.ok(end > start, '应能找到 renderFiles 的结束花括号');
const renderSrc = code.slice(start, end + 3);

/** 搭一个够真的假 DOM：只有 #filesBox 和底部那颗 data-dl-add 按钮 */
function makeSandbox(files, mod, footBtn) {
  const box = { innerHTML: '', textContent: '' };
  const ctx = {
    $: (sel) => (sel === '#filesBox' ? box : null),
    esc: (s) => String(s == null ? '' : s),
    fmtSize: (n) => (Number(n) || 0) + 'B',
    state: { drawer: { files, mod } },
    document: { querySelector: (sel) => (sel === '#dFoot [data-dl-add]' ? footBtn : null) },
    box
  };
  vm.createContext(ctx);
  vm.runInContext(renderSrc + '\nthis.renderFiles = renderFiles;', ctx);
  return ctx;
}

const FILES = [
  // 主文件排最前（接口已排序，这里照抄一份）
  { fileId: 55501, name: 'Eve Nude Natural - Skin Suit', version: '1.6.0', sizeInBytes: 2150000, category: '主文件', categoryRaw: 'MAIN', primary: true, description: 'Replaces Skin Suit.' },
  { fileId: 55502, name: 'Eve Nude Natural - Big Areola - Pubs', version: '1.6.0', sizeInBytes: 4190000, category: '可选文件', categoryRaw: 'OPTIONAL', primary: false, description: 'Bigger areola.' },
  { fileId: 55503, name: 'Eve Nude Natural - Planet Diving Suit', version: '1.6.0', sizeInBytes: 2090000, category: '可选文件', categoryRaw: 'OPTIONAL', primary: false, description: '' },
  { fileId: 55504, name: 'Eve Nude Natural - Skin Suit - No Shoes', version: '1.6.0', sizeInBytes: 1750000, category: '可选文件', categoryRaw: 'OPTIONAL', primary: false, description: '' },
  { fileId: 55505, name: 'old build', version: '1.5.0', sizeInBytes: 1000, category: '旧版本', categoryRaw: 'OLD_VERSION', primary: false, description: '' }
];

console.log('=== 每个文件都带 data-dl-file 下载按钮 ===');

const foot = { innerHTML: '<button class="btn p" data-dl-add="692">⬇ 加入下载队列</button>', title: '' };
const sandbox = makeSandbox(FILES, { modId: 692, name: 'Eve Nude Natural' }, foot);
sandbox.renderFiles(false, 692);

t('每个文件都有下载按钮（含主文件）', () => {
  const hits = [...sandbox.box.innerHTML.matchAll(/data-dl-file="(\d+)"/g)].map(m => m[1]);
  const want = FILES.filter(f => f.categoryRaw !== 'ARCHIVED' && f.categoryRaw !== 'OLD_VERSION').map(f => String(f.fileId));
  return JSON.stringify(hits) === JSON.stringify(want) ? true : '得到 ' + JSON.stringify(hits);
});
t('按钮的 fileId 就是该文件自己的 id', () => /data-dl-file="55502"/.test(sandbox.box.innerHTML));
t('按钮带 title 点明是哪个文件', () => /title="只下载这个文件：Eve Nude Natural - Big Areola - Pubs（v1\.6\.0）"/.test(sandbox.box.innerHTML));
t('按钮排在文件信息之后（同一行末尾）', () => {
  const html = sandbox.box.innerHTML;
  return html.indexOf('data-dl-file="55503"') > html.indexOf('Eve Nude Natural - Planet Diving Suit') ? true : '按钮位置不对';
});
t('默认不显示旧版本文件', () => !/old build/.test(sandbox.box.innerHTML));
t('旧版本仍可用「显示归档」按钮展开', () => /data-showarchived="1"\s*>\s*显示 1 个已归档\/旧版本文件/.test(sandbox.box.innerHTML.replace(/\n/g, ' ')));
t('底部按钮改口径为「下载主文件」', () => foot.innerHTML === '⬇ 下载主文件');
t('底部按钮 title 点名主文件', () => /Eve Nude Natural - Skin Suit（v1\.6\.0）/.test(foot.title));

console.log('\n=== 展开归档 / 抽屉已切走的边界 ===');
const foot2 = { innerHTML: 'x', title: '' };
const sb2 = makeSandbox(FILES, { modId: 692, name: 'Eve Nude Natural' }, foot2);
sb2.renderFiles(true, 692);
t('展开后旧版本也有按钮', () => /data-dl-file="55505"/.test(sb2.box.innerHTML));
t('展开后按钮总数 = 全部文件数', () => [...sb2.box.innerHTML.matchAll(/data-dl-file="/g)].length === FILES.length);

const foot3 = { innerHTML: 'keep', title: 'keep' };
const sb3 = makeSandbox(FILES, { modId: 999, name: '别的 mod' }, foot3);
sb3.renderFiles(false, 692);
t('抽屉已经切到别的 mod → 不动底部按钮', () => foot3.innerHTML === 'keep' && foot3.title === 'keep');

const sb4 = makeSandbox([], null, null);
sb4.renderFiles(false, 692);
t('没有文件信息时给一句提示', () => sb4.box.textContent === '没有文件信息');

console.log('\n=== 静态接线断言（防回归） ===');
t('点击处理里认 [data-dl-file]', () => /const dlFile = t\.closest\('\[data-dl-file\]'\);/.test(code));
t('点文件按钮时把 fileId 塞进下载任务 meta', () => /const fileId = Number\(dlFile\.dataset\.dlFile\);[\s\S]{0,320}fileId,/.test(code));
t('同时带上 fileName / fileVersion / fileSize（命名与队列展示都要用）',
  () => /fileId,\s*\n\s*name: m\.name[\s\S]{0,180}fileVersion: f\.version \|\| ''/.test(code));
t('「加入下载队列」在抽屉里已加载文件时也钉上主文件',
  () => /if \(inDrawer && \(d\.files \|\| \[\]\)\.length\) \{[\s\S]{0,240}meta\.fileId = Number\(f\.fileId\);/.test(code));
t('抽屉里找不到对应浏览卡片时退回抽屉自己的 mod 信息', () => /\(state\.browse\.items \|\| \[\]\)\.find\(x => Number\(x\.modId\) === modId\) \|\| \(inDrawer \? d\.mod : \{\}\)/.test(code));
t('下载队列卡片显示文件名，好区分同一 mod 的多个文件', () => /\$\{meta\.fileName \? `<span class="chip" title="\$\{esc\(meta\.fileName\)\}">/.test(code));
t('队列卡片文件名会截断（长名字不撑爆布局）', () => /\$\{esc\(clip\(meta\.fileName, 26\)\)\}/.test(code) && /function clip\(s, n\) \{/.test(code));
t('download:authorize 把文件名交给安装助手当提示', () => /hint: \(t\.meta && t\.meta\.fileName\)\s*\n\s*\? \('文件「' \+ t\.meta\.fileName \+ '」'\)/.test(ipcCode));
t('队列白名单保留 fileVersion（否则规范命名拿不到文件版本）', () => /'version', 'fileVersion', 'fileName'/.test(queueCode));

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) process.exit(1);
