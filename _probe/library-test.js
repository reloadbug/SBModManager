'use strict';
/**
 * 「管理器自带安装包」盘点断言套件（0.3.7）。
 *
 * 用户 2026-11-07 反馈：「下好了没装的那套功能没看到」。
 * 查下来是：他点过「清理已完成记录」，下载队列变成 0 项，
 * 而下载页在「队列空」时直接早退画空态 —— 把「待安装」整块吞掉了。
 * 包其实一直躺在 `data/library` 里（0.3.4 起这个目录不跟着游戏走）。
 *
 * 所以新加了 `src/main/localLibrary.js`：直接看磁盘，把「现在能装进当前游戏目录」
 * 的包列出来。它是纯函数（只读、不写盘），这里能全离线断言。
 *
 * 覆盖五块：
 *   A. `parseArchiveName()` —— 文件名 → modId / 名字 / 版本（认不出就返回 null，不猜）
 *   B. `entryLivesIn()` —— 注册记录算不算「装在当前游戏目录里」
 *   C. `scan()` —— 真目录：过滤已装 / 已在队列 / 认不出的，同 modId 只留最新
 *   D. 接线断言 —— ipc / preload / app.js / style.css / i18n
 *   E. 「队列空时也要列出安装包」这条回归（渲染层那处早退）
 *
 * 用法：node _probe/library-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require('../src/main/localLibrary');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); return; }
    fail++; fails.push(label + ' → ' + r);
    console.log('  ✗ ' + label + '  → ' + r);
  } catch (e) {
    fail++; fails.push(label + ' → ' + e.message);
    console.log('  ✗ ' + label + '  → ' + e.message);
  }
}
function eq(a, b, label) {
  t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}
function ok(v, label) { t(label, () => (v ? true : '假值')); }
function notOk(v, label) { t(label, () => (!v ? true : '应该是假值')); }

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ============================ A. 文件名解析 ============================ */
console.log('\n=== A) parseArchiveName：只认下载器自己的命名，认不出就跳过 ===');

const a1 = lib.parseArchiveName('2038_Ultimate_Luna_CNS_1.0.2.zip');
eq(a1 && a1.modId, 2038, '拆出 modId');
eq(a1 && a1.name, 'Ultimate_Luna_CNS', '名字保留（下划线不切）');
eq(a1 && a1.version, '1.0.2', '版本取最后一段数字');

const a2 = lib.parseArchiveName('4471_HD-ATOOL_P_v2.1.zip');
eq(a2 && a2.version, 'v2.1', 'v 前缀版本也认');

const a3 = lib.parseArchiveName('1591_Eve_Pink_Bodysuit.zip');
eq(a3 && a3.version, '', '没有版本段时版本为空');
eq(a3 && a3.name, 'Eve_Pink_Bodysuit', '没版本段时整段都是名字');

const a4 = lib.parseArchiveName('3047_DOAXVV_Nocturne_Rapport_CNS_1.0.1b.7z');
eq(a4 && a4.modId, 3047, '7z 也认');
eq(a4 && a4.version, '1.0.1b', '带字母后缀的版本');

ok(lib.parseArchiveName('3008_ProjRabbit.rar'), 'rar 也认');
notOk(lib.parseArchiveName('readme.txt'), '非压缩包 → null');
notOk(lib.parseArchiveName('no-id-prefix.zip'), '没有 modId 前缀 → null');
notOk(lib.parseArchiveName('0_zero.zip'), 'modId 为 0 → null');
notOk(lib.parseArchiveName(''), '空串 → null');
notOk(lib.parseArchiveName(null), 'null → null');

/* ============================ B. 「装在当前目录里吗」 ============================ */
console.log('\n=== B) entryLivesIn：换过游戏目录的记录不算已装 ===');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lib-test-'));
const gameA = path.join(tmpRoot, 'gameA', 'Star Blade');
const gameB = path.join(tmpRoot, 'gameB', 'Star Blade');
const modsA = path.join(gameA, 'SB', 'Content', 'Paks', '~Mods');
fs.mkdirSync(modsA, { recursive: true });
const fileA = path.join(modsA, 'Eve_P [nx1591].pak');
fs.writeFileSync(fileA, 'x');

const entryA = { id: 'nexus:1591:1', source: { modId: 1591 }, manifest: [{ path: fileA, rel: 'Eve_P [nx1591].pak', size: 1 }] };
ok(lib.entryLivesIn(entryA, gameA), '文件在、且在当前游戏目录里 → 算已装');
notOk(lib.entryLivesIn(entryA, gameB), '同一份文件但换了游戏目录 → 不算已装（要重装到新目录）');
notOk(lib.entryLivesIn(entryA, ''), '没有游戏目录 → 不算');
notOk(lib.entryLivesIn({ manifest: [] }, gameA), '空清单 → 不算');
notOk(lib.entryLivesIn({ manifest: [{ path: path.join(modsA, 'gone.pak') }] }, gameA), '文件不在磁盘上 → 不算');
notOk(lib.entryLivesIn(entryA, gameA + '2'), '同名前缀的另一个目录（gameA2）不算 —— 前缀匹配不能是裸 startsWith');

/* ============================ C. scan：真目录 ============================ */
console.log('\n=== C) scan：过滤 + 同 modId 只留最新 ===');

const libDir = path.join(tmpRoot, 'library');
fs.mkdirSync(libDir, { recursive: true });
// 已装（1591）—— 应被跳过
fs.writeFileSync(path.join(libDir, '1591_Eve_Pink_1.0.zip'), 'x');
// 已在队列（3008）—— 应被跳过
fs.writeFileSync(path.join(libDir, '3008_ProjRabbit_1.0.zip'), 'x');
// 可装（2038），两份，新的那份应胜出
const oldOne = path.join(libDir, '2038_Luna_1.0.zip');
const newOne = path.join(libDir, '2038_Luna_1.1.zip');
fs.writeFileSync(oldOne, 'x');
fs.writeFileSync(newOne, 'x');
const now = Date.now() / 1000;
fs.utimesSync(oldOne, now - 5000, now - 5000);
fs.utimesSync(newOne, now - 100, now - 100);
// 可装（4104）
fs.writeFileSync(path.join(libDir, '4104_Bayonetta_04_1.0.zip'), 'x');
// 认不出的文件
fs.writeFileSync(path.join(libDir, 'notes.txt'), 'x');

const res = lib.scan({
  dir: libDir,
  root: gameA,
  entries: [entryA],
  tasks: [{ id: 't1', status: 'downloaded', meta: { modId: 3008 } }]
});
eq(res.exists, true, '目录存在');
eq(res.total, 5, '只数压缩包（notes.txt 不算；2038 的两份都算）');
eq(res.skipped.installed, 1, '已装的包被跳过');
eq(res.skipped.inQueue, 1, '已在队列的包被跳过（页面上已经露过脸）');
eq(res.skipped.unparsed, 0, 'notes.txt 在 total 之外，不污染 unparsed');
eq(res.installable, 2, '剩下 2 个可装（2038 / 4104）');
eq(res.items.length, 2, 'items 也是 2');
eq(res.items.map(x => x.modId).sort().join(','), '2038,4104', '可装的就是这两个');
const luna = res.items.find(x => x.modId === 2038);
eq(luna && luna.filename, '2038_Luna_1.1.zip', '同一个 modId 只留最新的那份');
eq(luna && luna.version, '1.1', '带上版本号给界面显示');
ok(res.items.every(x => fs.existsSync(x.archivePath)), 'archivePath 都是真实路径');

// 队列里那条是 failed 的 → 不算「已露过脸」，包还要露出来
const res2 = lib.scan({
  dir: libDir, root: gameA, entries: [entryA],
  tasks: [{ id: 't1', status: 'failed', meta: { modId: 3008 } }]
});
eq(res2.installable, 3, 'failed 的任务不挡住包（用户还要看到它）');
eq(res2.skipped.inQueue, 0, 'failed 不计入 inQueue');

// 换了游戏目录：已装的那些会自动冒出来当「可装」
const res3 = lib.scan({ dir: libDir, root: gameB, entries: [entryA], tasks: [] });
eq(res3.installable, 4, '换到空游戏目录 → 原来已装的也变得可装（1591/3008/2038/4104，这就是「换目录后能重装」）');
ok(res3.items.some(x => x.modId === 1591), '1591 重新出现在可装列表里');

// 目录不存在 / 传空
const res4 = lib.scan({ dir: path.join(tmpRoot, 'nope'), root: gameA, entries: [], tasks: [] });
eq(res4.exists, false, '目录不存在 → exists:false');
eq(res4.installable, 0, '目录不存在 → 没有可装的');
const res5 = lib.scan({ dir: libDir, root: gameA, entries: [], tasks: [], limit: 1 });
eq(res5.items.length, 1, 'limit 生效');

/* ============================ D. 接线断言 ============================ */
console.log('\n=== D) 接线：ipc / preload / app.js / CSS / i18n ===');

const ipc = read('src/main/ipc.js');
ok(ipc.includes("require('./localLibrary')"), 'ipc 引入 localLibrary');
ok(ipc.includes("handle('library:list'"), 'ipc 有 library:list');
ok(ipc.includes("handle('library:install'"), 'ipc 有 library:install');
ok(/library:list'[\s\S]{0,220}dir: paths\.LIBRARY/.test(ipc), 'library:list 读的是 paths.LIBRARY');
ok(/library:list'[\s\S]{0,220}root: currentRoot\(\)/.test(ipc), 'library:list 用当前游戏根判定「装没装」');
ok(/library:list'[\s\S]{0,260}tasks: engine\.list\(\)/.test(ipc), 'library:list 带上队列，避免同一件事显示两遍');

const pre = read('src/preload/index.js');
ok(pre.includes("library: () => invoke('library:list')"), 'preload 暴露 download.library()');
ok(pre.includes("installFromLibrary: (archivePath, meta, opts) => invoke('library:install'"),
  'preload 暴露 download.installFromLibrary()');

const appSrc = read('src/renderer/app.js');
ok(appSrc.includes('async function refreshLibrary()'), 'app.js 有 refreshLibrary()');
ok(appSrc.includes('function libraryBoxHtml()'), 'app.js 有 libraryBoxHtml()');
ok(appSrc.includes('data-lib-goto="1"'), '下载页那条提示带「到已下载里批量安装」按钮');
ok(appSrc.includes('data-lib-install="${it.modId}"'), '每行有「装进游戏」按钮');
ok(appSrc.includes("t.closest('[data-lib-installall]')"), '全部装的点击分支（批量安装改到浏览页后仍保留）');
ok(appSrc.includes("t.closest('[data-lib-install]')"), '单个装的点击分支');
ok(appSrc.includes('await refreshLibrary();'), 'refreshAll / refreshDownloads 里会重新盘点');
ok(appSrc.includes('state.library = await call(window.api.download.library()'), '走的是 download.library() 通道');

// 回归：队列空时那一支也必须把安装包列出来（这次 bug 的正身）
const emptyBranch = appSrc.slice(appSrc.indexOf('if (!tasks.length) {'), appSrc.indexOf('const sorted = [...tasks]'));
ok(emptyBranch.includes('libraryBoxHtml()'), '队列空时的空态里也拼上了 libraryBoxHtml()（这次 bug 的回归断言）');
ok(emptyBranch.includes('$(\'#sub\').textContent'), '队列空时也更新副标题（不再是空着不写）');

const css = read('src/renderer/style.css');
ok(css.includes('.lib-box'), 'style.css 有 .lib-box');
ok(css.includes('.lib-item'), 'style.css 有 .lib-item');

/* ---- 0.4.3：清单从「一行文字」改成与浏览页同款卡片 ---- */
ok(appSrc.includes('function libCardHtml(it, opts)'), 'app.js 有 libCardHtml(it, opts)（卡片版，可按筛选打开勾选）');
ok(appSrc.includes('function libMetaFor('), 'app.js 有 libMetaFor()（先用队列 meta 兜底）');
ok(appSrc.includes('async function ensureLibMeta()'), 'app.js 有 ensureLibMeta()（回头问 Nexus 补封面/作者）');
ok(appSrc.includes('libShown: 12'), 'state 里有「一次列几张卡」的 libShown');
ok(appSrc.includes('libMetaTried'), 'state 里有 libMetaTried（问不到的也不再反复问）');
const cardSrc = appSrc.slice(appSrc.indexOf('function libCardHtml(it'), appSrc.indexOf('function libraryBoxHtml()'));
ok(cardSrc.includes('class="cover"') && cardSrc.includes('class="cbody"'),
  '卡片用的是浏览页那套 .cover / .cbody 版式');
ok(/<h3 data-i18n-skip/.test(cardSrc), '卡片里标题跳过 i18n（Mod 名不翻译）');
ok(cardSrc.includes("data-libdetail=\"${it.modId}\""), '卡片上有「详情」按钮');
ok(cardSrc.includes("data-lib-install=\"${it.modId}\""), '卡片上有「装进游戏」按钮');
ok(cardSrc.includes('fmtSize(it.size)'), '卡片里显示安装包大小');
ok(cardSrc.includes('meta.author'), '卡片里显示作者');
ok(appSrc.includes("t.closest('[data-lib-more]')"), '「显示更多」的点击分支');
ok(appSrc.includes("t.closest('[data-libdetail]')"), '「详情」的点击分支（开 Nexus 抽屉）');
ok(/ensureLibMeta\(\)/.test(appSrc.slice(appSrc.indexOf('function renderBrowseDownloaded()'), appSrc.indexOf('\nfunction renderBrowse()'))),
  '「已下载」列表渲染完会顺手触发一次补详情');
ok(css.includes('.lib-grid'), 'style.css 有 .lib-grid（卡片网格）');
ok(css.includes('.lib-hint'), 'style.css 有 .lib-hint（下载页那条细提示）');

const keys = JSON.parse(read('_probe/i18n-keys.json'));
const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
for (const k of ['装进游戏', '把这份安装包装进当前游戏目录', '已加入安装队列', '可本地装 %s',
  '全部装进去（%s）', '还有 %s 个没列出来（装完上面这些再看）', '正在安装中，稍等…',
  '已开始安装 %s 个包', '已开始安装 %s 个包，%s 个没能开始（在下载页看原因）',
  '管理器里还有 %s 个安装包没有装进当前游戏目录（包一直在管理器目录里，不会跟着游戏走）。']) {
  ok(keyList.includes(k), 'i18n 有键：' + k.slice(0, 22));
}
// 0.4.3 卡片版新增的文案
for (const k of ['安装包', '详情', '作者', '本地安装包', '显示更多（还有 %s 个）']) {
  ok(keyList.includes(k), 'i18n 有键：' + k);
}

/* ============================ D1b. 「已下载」筛选（0.4.4） ============================ */
console.log('\n=== D1b) 「已下载」筛选：并进浏览页 + 多选批量安装 ===');

const htmlSrc = read('src/renderer/index.html');
ok(htmlSrc.includes('data-onlydl="1"'), 'index.html 的「只看…」那一排里有「已下载」按钮');
ok(appSrc.includes('onlyDownloaded: false'), 'state.browse 里有 onlyDownloaded 开关');
ok(appSrc.includes('function browseVisibleItems()'), 'app.js 有 browseVisibleItems()（多选/全选按当前可见项算）');
ok(appSrc.includes('function syncOnlyTabs()'), 'app.js 有 syncOnlyTabs()（两个按钮高亮互斥）');
ok(appSrc.includes('function renderBrowseDownloaded()'), 'app.js 有 renderBrowseDownloaded()');
ok(appSrc.includes("if (b.onlyDownloaded) {\r\n    renderBrowseDownloaded();"), 'renderBrowse() 在「已下载」时走本地清单');
ok(appSrc.includes('libCardHtml(it, { selectable: true, hideDetail: true })'),
  '「已下载」里复用浏览页卡片，并打开勾选');
ok(appSrc.includes('async function libBatchInstall()'), 'app.js 有 libBatchInstall()');
ok(appSrc.includes('if (state.browse.onlyDownloaded) libBatchInstall()'),
  '工具栏那颗按钮在「已下载」下改调批量安装');
ok(appSrc.includes("const downloading = !!state.browse.onlyDownloaded;"), 'selUpdateBar 里按筛选切换文案');
ok(appSrc.includes('批量安装（${n}）'), '多选时按钮显示「批量安装（N）」');
ok(appSrc.includes("t.closest('[data-lib-goto]')"), '下载页那条提示能跳到「已下载」');
ok(appSrc.includes("if (state.browse.onlyDownloaded) renderBrowse(); else renderDownload();"),
  '装完一个包会按当前筛选决定重画哪一页');

const selStart = appSrc.indexOf('function selUpdateBar()');
const selEnd = appSrc.indexOf('function batchDownload(');
const selSrc = appSrc.slice(selStart, selEnd > selStart ? selEnd : selStart + 2000);
ok(selSrc.includes('browseVisibleItems()'), 'selUpdateBar 用 browseVisibleItems() 判「全选」状态');
ok(appSrc.slice(appSrc.indexOf('function selSelectAll()'), appSrc.indexOf('function selSyncCard(')).includes('browseVisibleItems()'),
  'selSelectAll 用 browseVisibleItems()（只全选当前看得见的）');

for (const k of ['正在盘点管理器里的安装包…', '没有已下载但没装的 Mod',
  '已下载但没装 %s 个', '已下载但没装 %s 个 · 已列出 %s 个 · 选中 %s 个',
  '批量安装（%s）', '批量安装', '先勾选要安装的包', '到「已下载」里批量安装']) {
  ok(keyList.includes(k), 'i18n 有键：' + k.slice(0, 20));
}

/* ============================ D1c. 「已下载」卡片的定位 / 删除（0.4.5） ============================ */
console.log('\n=== D1c) 「已下载」卡片的定位 / 删除 ===');

const ipcSrc2 = read('src/main/ipc.js');
const preSrc2 = read('src/preload/index.js');

ok(appSrc.includes('data-libreveal="${it.modId}"'), '卡片上有「定位」按钮');
ok(appSrc.includes('data-libdel="${it.modId}"'), '卡片上有「删除」按钮');
ok(appSrc.includes('function libItemOf(modId)'), 'app.js 有 libItemOf()（按 modId 取 archivePath）');
ok(appSrc.includes("t.closest('[data-libreveal]')"), '「定位」有委托分支');
ok(appSrc.includes('window.api.revealPath(it.archivePath)'), '「定位」把安装包路径交给资源管理器');
ok(appSrc.includes("t.closest('[data-libdel]')"), '「删除」有委托分支');
ok(appSrc.includes('window.api.download.removeArchive(it.archivePath)'), '「删除」走 removeArchive');
ok(appSrc.includes('已经装进游戏的文件不受影响'), '删除前有 confirm 说明不影响已装进游戏的文件');

ok(ipcSrc2.includes("handle('library:remove'"), 'ipc 有 library:remove 通道');
ok(ipcSrc2.includes('只能删安装包目录里的文件'), 'library:remove 会校验路径必须在安装包目录里');
ok(ipcSrc2.includes('只能删压缩包（zip / 7z / rar）'), 'library:remove 只认压缩包');
ok(ipcSrc2.includes('engine.remove(t.id, { deleteArchive: false })'), '删包时顺手清掉队列里指向它的任务');
ok(ipcSrc2.includes("logger.event('library:removed'"), '删包会写日志');

ok(preSrc2.includes("removeArchive: (archivePath) => invoke('library:remove', archivePath)"),
  'preload 有 removeArchive');

for (const k of ['删除', '在资源管理器里定位这份安装包',
  '从管理器里删掉这份安装包（不影响已经装进游戏的文件）',
  '这个安装包已经不在清单里了，刷新一下看看', '已删除安装包：%s']) {
  ok(keyList.includes(k), 'i18n 有键：' + k.slice(0, 20));
}

/* ============================ D2. 安装包目录可配置 ============================ */
console.log('\n=== D2) 安装包目录：可指到别的盘（0.4.0）===');

const pathsSrc = read('src/main/paths.js');
ok(pathsSrc.includes('LIBRARY_CONFIGURED'), 'paths.js 有 LIBRARY_CONFIGURED（指针里的 libraryDir）');
ok(pathsSrc.includes('DEFAULT_LIBRARY'), 'paths.js 有 DEFAULT_LIBRARY');
ok(/LIBRARY_CONFIGURED\s*&&\s*canUseDir\(LIBRARY_CONFIGURED\)\s*\?\s*LIBRARY_CONFIGURED\s*:\s*DEFAULT_LIBRARY/.test(pathsSrc),
  '指到建不出来的目录时回落默认（不能因为一个坏路径就打不开）');
ok(/function setLibraryDir\(dir\)/.test(pathsSrc), 'paths.js 有 setLibraryDir()');
ok(/libraryDir/.test(pathsSrc) && /readPointer\(\)/.test(pathsSrc), 'setLibraryDir 走指针文件（不碰注册表）');
ok(pathsSrc.includes('setLibraryDir,'), 'paths.js 导出了 setLibraryDir');
ok(pathsSrc.includes('LIBRARY_CONFIGURED,'), 'paths.js 导出了 LIBRARY_CONFIGURED');

ok(ipc.includes("handle('library:info'"), 'ipc 有 library:info');
ok(ipc.includes("handle('library:choose'"), 'ipc 有 library:choose');
ok(ipc.includes("handle('library:setDir'"), 'ipc 有 library:setDir');
ok(/library:info'[\s\S]{0,400}dir: paths\.LIBRARY/.test(ipc), 'library:info 报的是真正在用的目录');
ok(/library:setDir'[\s\S]{0,300}paths\.setLibraryDir/.test(ipc), 'library:setDir 落到 paths.setLibraryDir');
ok(/library:setDir'[\s\S]{0,400}restart:\s*true/.test(ipc), '改完告诉界面「重启后生效」');
ok(/data:info'[\s\S]{0,1400}library:\s*\{\s*dir: paths\.LIBRARY/.test(ipc), 'data:info 里也带上安装包目录');

ok(pre.includes("libraryInfo: () => invoke('library:info')"), 'preload 暴露 download.libraryInfo()');
ok(pre.includes("libraryChoose: (opts) => invoke('library:choose', opts)"), 'preload 暴露 download.libraryChoose()');
ok(pre.includes("librarySetDir: (dir) => invoke('library:setDir', dir)"), 'preload 暴露 download.librarySetDir()');

ok(appSrc.includes('async function refreshLibDirBox()'), 'app.js 有 refreshLibDirBox()');
ok(appSrc.includes('refreshLibDirBox();'), '设置页渲染时会刷新这一行');
ok(appSrc.includes('id="libDirLine"'), '设置页有目录行');
ok(appSrc.includes('id="btnLibChoose"'), '设置页有「更改目录…」');
ok(appSrc.includes('id="btnLibOpen"'), '设置页有「打开目录」');
ok(appSrc.includes('id="btnLibReset"'), '设置页有「恢复默认」');
ok(appSrc.includes("e.target.id === 'btnLibChoose'"), '改目录的点击分支');
ok(appSrc.includes("e.target.id === 'btnLibReset'"), '恢复默认的点击分支');

for (const k of ['安装包目录', '里面的包', '更改目录…', '打开目录', '恢复默认',
  '%s 个包 · %s · 其中 %s 个还没装进当前游戏目录', '安装包目录已改为：', '重启管理器后生效']) {
  ok(keyList.includes(k), 'i18n 有键：' + k.slice(0, 22));
}

/* ============================ 收尾 ============================ */
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }

console.log('\n' + '='.repeat(56));
if (fail) {
  console.log(`❌ library: ${pass} 通过 / ${fail} 失败`);
  console.log('失败项：');
  for (const f of fails) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log(`✅ library: ${pass} 通过 / 0 失败`);
}
console.log('='.repeat(56));
