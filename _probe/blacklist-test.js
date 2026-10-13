'use strict';
/**
 * 浏览页黑名单（`src/main/blacklist.js`）+ 头部吸顶 + 前端筛选口径。
 *
 * 用户诉求（2026-10-13）：
 *   「浏览 mod 的时候，顶部筛选和多选按钮一直显示到顶部，不会随滚动而消失；
 *     mod 支持不喜欢按钮，点击后被加入到黑名单，立刻加入，
 *     顶部筛选对应增加黑名单的过滤功能，默认不显示黑名单 mod」
 *
 * 纯 Node：主进程模块用**临时文件**测（不碰用户 `data/`）；
 * 渲染层函数从 `app.js` 源码里**原样抽出**在 vm 里跑真身（不会与实现漂移）。
 *
 * 运行：`npm run test:blacklist`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const { createBlacklist } = require('../src/main/blacklist');

const TMP = path.join(os.tmpdir(), 'sb-blacklist-test');
const FILE = path.join(TMP, 'blacklist.json');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const HTML = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const CSS = path.join(__dirname, '..', 'src', 'renderer', 'style.css');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

function reset() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 沙箱守卫 */ }
  fs.mkdirSync(TMP, { recursive: true });
}

// ================================================================ 1. 主进程模块

console.log('\n[1] createBlacklist：增删查 + 持久化');
reset();
{
  const bl = createBlacklist(FILE);
  eq(bl.count(), 0, '初始为空');
  eq(bl.has(3023), false, '空名单里 has() = false');
  eq(bl.ids().length, 0, 'ids() 空数组');

  const e1 = bl.add(3023, { name: 'Tiger Head Necklace', author: 'someone', thumbnail: 'https://x/t.jpg' });
  eq(e1.modId, 3023, 'add 返回记录，modId 正确');
  eq(typeof e1.at, 'string', 'add 记下时间戳 at');
  eq(bl.count(), 1, '加入后 count = 1');
  eq(bl.has(3023), true, 'has() = true');
  eq(bl.has('3023'), true, '字符串形式的 modId 也认得（渲染层传过来就是字符串）');
  eq(bl.ids()[0], 3023, 'ids() 里是**数字**（渲染层拿去建 Set 要 String 一下）');

  const got = bl.all()[0];
  eq(got.name, 'Tiger Head Necklace', '存下了 name（「只看黑名单」要离线渲染卡片）');
  eq(got.author, 'someone', '存下了 author');
  eq(got.thumbnail, 'https://x/t.jpg', '存下了 thumbnail');
}

console.log('\n[2] 幂等 + 字段合并 + 非法输入');
{
  const bl = createBlacklist(FILE);
  const at1 = bl.all()[0].at;
  const again = bl.add(3023, { name: '改了名字' });
  eq(bl.count(), 1, '重复 add 不产生第二条（幂等）');
  eq(again.at, at1, '重复 add 保留原时间戳（「什么时候拉黑的」不该被重复点击刷新）');
  eq(again.name, '改了名字', '但 name 用新的覆盖');
  eq(again.author, 'someone', '没传的字段沿用旧值（不丢信息）');

  eq(bl.add(0, {}), null, 'modId = 0 → 返回 null');
  eq(bl.add(null, {}), null, 'modId = null → 返回 null');
  eq(bl.add('abc', {}), null, 'modId 非数字 → 返回 null');
  eq(bl.count(), 1, '非法输入不污染名单');
}

console.log('\n[3] 持久化 + 移出 + 清空');
{
  const bl2 = createBlacklist(FILE);   // 重新打开同一个文件
  eq(bl2.count(), 1, '重新打开能读回来（真的落盘了）');
  eq(bl2.all()[0].name, '改了名字', '内容完整');

  bl2.add(1234, { name: 'Another' });
  const list = bl2.all();
  eq(list.length, 2, '现在 2 条');
  eq(list[0].modId, 1234, 'all() 按加入时间**倒序**（最近拉黑的排前面）');

  eq(bl2.remove(1234).modId, 1234, 'remove 返回被移除的记录');
  eq(bl2.count(), 1, '移除后 count = 1');
  eq(bl2.remove(1234), null, '重复移除返回 null（不抛）');
  eq(bl2.remove(99999), null, '移除不存在的返回 null');

  eq(bl2.clear(), 1, 'clear 返回清掉的条数');
  eq(bl2.count(), 0, 'clear 后为空');
}

// ================================================================ 2. 前端筛选口径（跑真身）

console.log('\n[4] isLocalFiltering：前端筛选口径（从 app.js 抽真身跑）');
const code = fs.readFileSync(APP, 'utf8');
{
  const m = code.match(/function isLocalFiltering\([\s\S]*?\n}/);
  t('app.js 里能找到 isLocalFiltering 定义', () => !!m || '找不到');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nthis.f = isLocalFiltering;', ctx);
  const f = ctx.f;
  const b = (over = {}) => Object.assign({ onlyUninstalled: false, blockMode: 'hide', blocked: new Set() }, over);

  eq(f(b()), false, '默认（hide + 空黑名单）不做前端筛选');
  eq(f(b({ blockMode: 'hide', blocked: new Set(['1']) })), true, 'hide + 有黑名单 → 要前端筛');
  eq(f(b({ blockMode: 'all', blocked: new Set(['1']) })), false, '显示全部 → 不筛（黑名单也显示出来）');
  eq(f(b({ blockMode: 'only', blocked: new Set(['1']) })), false, '只看黑名单 → 不算分页筛选（走本地列表）');
  eq(f(b({ onlyUninstalled: true })), true, '只看未安装 → 要前端筛');
  eq(f(b({ onlyUninstalled: true, blockMode: 'only' })), false, '只看黑名单优先（不翻页）');
  eq(f(b({ onlyUninstalled: true, blockMode: 'all' })), true, '只看未安装 + 显示全部 → 仍要筛');
}

console.log('\n[5] shouldLoadMore：黑名单场景下的续加载（跑真身）');
{
  const m = code.match(/function shouldLoadMore\([\s\S]*?\n}/);
  t('app.js 里能找到 shouldLoadMore 定义', () => !!m || '找不到');
  // shouldLoadMore 依赖 isLocalFiltering，两个一起喂进 vm
  const fi = code.match(/function isLocalFiltering\([\s\S]*?\n}/)[0];
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fi + '\n' + m[0] + '\nthis.f = shouldLoadMore;', ctx);
  const g = ctx.f;
  const b = (over = {}) => Object.assign(
    { loading: false, items: [{ modId: 1 }], total: 999, done: false, offset: 24, onlyUninstalled: false, blockMode: 'hide', blocked: new Set() },
    over);

  eq(g(1200, 700, 2300, b()), true, '无筛选 + items < total → 正常续加载');
  eq(g(1200, 700, 2300, b({ items: [{ modId: 1 }, { modId: 2 }], total: 2 })), false, '无筛选 + 已加载完 → 停');
  eq(g(1200, 700, 2300, b({ blockMode: 'hide', blocked: new Set(['9']), items: [{ modId: 1 }], total: 999 })), true,
    '隐藏黑名单（items 是子集）→ 即使 items < total 也靠 b.done 判定，仍可续加载');
  eq(g(1200, 700, 2300, b({ blockMode: 'all', blocked: new Set(['9']), items: [{ modId: 1 }, { modId: 2 }], total: 2 })), false,
    '显示全部 → 按 items.length >= total 停');
}

// ================================================================ 3. 接线（源码级）

console.log('\n[6] 渲染层 / 主进程接线（源码级断言）');
{
  const html = fs.readFileSync(HTML, 'utf8');
  const css = fs.readFileSync(CSS, 'utf8');
  const pre = fs.readFileSync(PRELOAD, 'utf8');
  const ipc = fs.readFileSync(IPC, 'utf8');

  // ---- 吸顶 ----
  t('index.html 把头部包进 .bhead', () => /<div class="bhead"[\s\S]{0,200}id="sortTabs"/.test(html) || '缺失');
  t('.bhead 里同时含筛选器与统计行', () =>
    /class="bhead"[\s\S]*?id="browseFilters"[\s\S]*?id="browseStats"[\s\S]*?<\/div>\s*<div id="browseArea">/.test(html) || '缺失');
  t('CSS：.bhead 用 position:sticky', () => /\.bhead\{position:sticky/.test(css) || '缺失');
  t('CSS：.bhead 有不透明背景（否则卡片会透出来）', () => /\.bhead\{[^}]*background:var\(--bg\)/.test(css) || '缺失');
  t('CSS：.bhead 用负 margin 抵消 .body 的 padding', () => /\.bhead\{[^}]*margin:-16px -16px 0/.test(css) || '缺失');
  t('CSS：.bhead 有 z-index（盖住卡片）', () => /\.bhead\{[^}]*z-index:\d/.test(css) || '缺失');
  // sticky 约束的是 **margin box**：margin-top:-16px 会把 border box 又推下去 16px，
  // 所以 top 必须是同一个 -16px 才真的贴顶（实测只写 top:0 会停在距顶 16px 处）
  t('CSS：.bhead 的 top 与 margin-top 负值配套（否则贴不住顶）', () => {
    const m = css.match(/\.bhead\{position:sticky;top:(-?\d+)px[^}]*margin:(-?\d+)px/);
    if (!m) return '解析不到 .bhead 的 top / margin-top';
    return Number(m[1]) === Number(m[2]) || `top=${m[1]}px 与 margin-top=${m[2]}px 不相等`;
  });
  t('CSS：.bhead 底部间距做成 padding（margin 会在吸顶区下方留缝）', () =>
    /\.bhead\{[^}]*padding:16px 16px 12px/.test(css) || '缺失');

  // ---- 黑名单 tabs ----
  t('index.html 有 #blockTabs 三态', () =>
    /id="blockTabs"[\s\S]*?data-block="hide"[\s\S]*?data-block="all"[\s\S]*?data-block="only"/.test(html) || '缺失');
  t('默认选中「隐藏黑名单」', () => /data-block="hide" class="on"/.test(html) || '默认不是 hide');
  t('CSS 有 .tabs.blocked 选中态', () => /\.tabs\.blocked button\.on\{/.test(css) || '缺失');

  // ---- 卡片按钮 ----
  t('browseCard 有「不喜欢」按钮（data-dislike）', () => /data-dislike="\$\{n\.modId\}"/.test(code) || '缺失');
  t('browseCard 有「移出黑名单」按钮（data-undislike）', () => /data-undislike="\$\{n\.modId\}"/.test(code) || '缺失');
  t('卡片按 state.browse.blocked 决定显示哪个按钮', () => /isBlocked[\s\S]{0,80}state\.browse\.blocked\.has/.test(code) || '缺失');
  t('CSS 有 .btn.no（低调的次要按钮）', () => /\.btn\.no\{/.test(css) || '缺失');

  // ---- 点击委托：必须排在 .card 之前 ----
  t('dislike 的点击处理在 .card 之前', () => {
    const iDis = code.indexOf("t.closest('[data-dislike]')");
    const iCard = code.indexOf("const card = t.closest('.card');");
    return (iDis > 0 && iCard > 0 && iDis < iCard) || `dislike@${iDis} card@${iCard}`;
  });
  t('undislike 的点击处理在 .card 之前', () => {
    const iUnd = code.indexOf("t.closest('[data-undislike]')");
    const iCard = code.indexOf("const card = t.closest('.card');");
    return (iUnd > 0 && iCard > 0 && iUnd < iCard) || `undislike@${iUnd} card@${iCard}`;
  });

  // ---- 筛选口径三处一致 ----
  t('shouldLoadMore 用 isLocalFiltering', () => /function shouldLoadMore[\s\S]{0,400}isLocalFiltering\(b\)/.test(code) || '缺失');
  t('updateBrowseChrome 用 isLocalFiltering', () => /const more = !b\.done && \(isLocalFiltering\(b\)/.test(code) || '缺失');
  t('browseRest 用 isLocalFiltering', () => /const seen = isLocalFiltering\(b\)/.test(code) || '缺失');
  t('applyLocalFilter 同时处理黑名单与只看未安装', () =>
    /async function applyLocalFilter[\s\S]{0,500}onlyUninstalled[\s\S]{0,400}blockMode === 'hide'/.test(code) || '缺失');
  t('loadBrowse 的过滤走 applyLocalFilter', () => /const kept = await applyLocalFilter\(page\.items\)/.test(code) || '缺失');

  // ---- 「只看黑名单」走本地记录 ----
  t('loadBrowse 开头分支到 loadBlockedList', () => /if \(b\.blockMode === 'only'\) return loadBlockedList\(reset\)/.test(code) || '缺失');
  t('loadBlockedList 直接读本地黑名单（零网络请求）', () =>
    /async function loadBlockedList[\s\S]{0,900}window\.api\.blacklist\.list\(\)/.test(code) || '缺失');
  t('loadBlockedList 里没有翻页（一次给全，done=true）', () =>
    /async function loadBlockedList[\s\S]{0,1600}b\.done = true/.test(code) || '缺失');
  t('「只看黑名单」空态有专门文案', () => /黑名单是空的/.test(code) || '缺失');

  // ---- 立刻生效 ----
  t('dislikeMod 先改内存集合再落盘（立刻生效）', () =>
    /async function dislikeMod[\s\S]{0,600}b\.blocked\.add\(id\)[\s\S]{0,900}window\.api\.blacklist\.add/.test(code) || '缺失');
  t('dislikeMod 在隐藏模式下把卡片从 items 里剔掉', () =>
    /async function dislikeMod[\s\S]{0,1200}b\.items = b\.items\.filter/.test(code) || '缺失');
  t('undislikeMod 先删集合再落盘', () =>
    /async function undislikeMod[\s\S]{0,400}b\.blocked\.delete\(id\)[\s\S]{0,900}window\.api\.blacklist\.remove/.test(code) || '缺失');
  t('黑名单状态同步到 tabs（updateBlockTabs）', () => /function updateBlockTabs\(\)/.test(code) || '缺失');
  t('#blockTabs 点击切换模式并重载', () =>
    /#blockTabs'\)\.addEventListener\('click'[\s\S]{0,400}loadBrowse\(true\)/.test(code) || '缺失');
  t('启动时先拉黑名单再刷新（否则首屏会把拉黑的又显示一遍）', () =>
    /await loadBlacklist\(\);\s*\n\s*await refreshAll\(\)/.test(code) || '缺失');

  // ---- 主进程接线 ----
  t('preload 暴露 blacklist.list/ids/add/remove', () =>
    /blacklist:\s*\{[\s\S]{0,300}list:[\s\S]{0,200}ids:[\s\S]{0,200}add:[\s\S]{0,200}remove:/.test(pre) || '缺失');
  t('ipc 注册 blacklist:list / add / remove', () =>
    /handle\('blacklist:list'/.test(ipc) && /handle\('blacklist:add'/.test(ipc) && /handle\('blacklist:remove'/.test(ipc) || '缺失');
  t('ipc 在 init 里创建 blacklist 单例', () => /blacklist = createBlacklist\(paths\.blacklistFile\)/.test(ipc) || '缺失');
  t('paths 里有 blacklistFile', () =>
    /blacklistFile: path\.join\(DATA, 'blacklist\.json'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'paths.js'), 'utf8')) || '缺失');
}

console.log('\n[7] 测试没污染真实数据目录');
{
  const real = path.join(__dirname, '..', 'data', 'blacklist.json');
  t('本套件用的是临时目录（不写 data/blacklist.json）', () => FILE.startsWith(os.tmpdir()) || '不是临时目录');
  // 只断言「本次没新建」—— 用户自己拉黑过的记录本来就该存在
  t('data/blacklist.json 没被本套件写入测试数据', () => {
    if (!fs.existsSync(real)) return true;
    const raw = fs.readFileSync(real, 'utf8');
    return !raw.includes('Tiger Head Necklace') || '发现测试数据';
  });
}

// ---------------------------------------------------------------- 收尾
reset();
console.log(`\n${fail === 0 ? '✅' : '❌'} blacklist: ${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项：'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
