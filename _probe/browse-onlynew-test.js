'use strict';
/**
 * 浏览页「只显示未安装」筛选的离线断言。
 *
 * 从 app.js 抽出三个真身在 vm 里跑：`browseRest` / `filterSummary` / `installedIdsOf`
 * （前者纯函数、中者读 state、后者过一次假 IPC），再对接线做静态断言。
 *
 * 关键风险点（这轮真实踩过的设计）：
 *   · `b.offset` 必须按**服务端**推进 —— 用 items 长度当偏移会反复请求同一页
 *   · `b.items.length >= b.total` 在筛选开启时永不成立，终止只能靠 `b.done`
 *   · 本地状态取不到时**不能筛**（宁可比筛掉好，不能把没装的 mod 藏掉）
 *
 * 跑法：node _probe/browse-onlynew-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
// ⚠️ 归一 CRLF → LF：下面靠 indexOf('\n}\n') 抽函数真身，行尾不归一就会落空
const code = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === true) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → 抛出 ' + e.message); }
}

/** 按名字抽出函数源码（到下一个顶格 `}` 为止） */
function extract(name) {
  const re = new RegExp('(?:async )?function ' + name + '\\(');
  const m = re.exec(code);
  assert.ok(m, 'app.js 里应能找到 ' + name);
  const start = m.index;
  const end = code.indexOf('\n}\n', start);
  assert.ok(end > start, '应能找到 ' + name + ' 的结束花括号');
  return code.slice(start, end + 3);
}

const ctx = {
  state: { browse: { category: '', tags: [], onlyUninstalled: false, facets: null, blocked: new Set(), blockMode: 'hide' } },
  esc: (s) => String(s == null ? '' : s),
  call: null,
  // `installedIdsOf` 里要拼 `window.api.nexus.localState(ids)` 再交给 `call()`。
  // 少了这个桩，参数求值就在 try 里抛 ReferenceError 被 catch 吞掉 → 永远返回空集合，
  // 带数据的两条断言会莫名其妙地失败。桩的返回值无所谓（`call` 被换掉了）。
  window: { api: { nexus: { localState: () => Promise.resolve({}) } } }
};
vm.createContext(ctx);
vm.runInContext(
  // ⚠️ `browseRest` 依赖 `isLocalFiltering`（黑名单 + 只看未安装共用的前端筛选口径），
  //    必须**一起**喂进 vm，否则 ReferenceError，四条断言全废。
  extract('isLocalFiltering') + '\n' +
  extract('browseRest') + '\n' +
  extract('filterSummary') + '\n' +
  extract('installedIdsOf') + '\n' +
  'this.browseRest = browseRest; this.filterSummary = filterSummary; this.installedIdsOf = installedIdsOf;',
  ctx
);

console.log('=== browseRest：「还有 N 个」怎么算 ===');
t('关闭筛选：N = total - 已加载', () => ctx.browseRest({ items: [{}, {}], total: 100, onlyUninstalled: false, offset: 48 }) === 98);
t('开启筛选：N = total - 服务端偏移（剔掉的不算虚高）', () => ctx.browseRest({ items: [{}, {}], total: 100, onlyUninstalled: true, offset: 48 }) === 52);
t('偏移超过 total 时不为负', () => ctx.browseRest({ items: [], total: 24, onlyUninstalled: true, offset: 96 }) === 0);
t('total 缺失时不 NaN', () => ctx.browseRest({ items: [], total: undefined, onlyUninstalled: false, offset: 0 }) === 0);

console.log('\n=== filterSummary：统计行口径 ===');
ctx.state.browse = { category: '', tags: [], onlyUninstalled: false, facets: null, blocked: new Set(), blockMode: 'hide' };
t('没筛选时统计行干净', () => ctx.filterSummary() === '');
ctx.state.browse.onlyUninstalled = true;
t('开着就说「只看未安装」', () => ctx.filterSummary() === ' · 只看未安装');
ctx.state.browse.category = '服装';
ctx.state.browse.facets = { categories: [{ value: '服装', zh: '服装' }], tags: [] };
t('可与分类/标签并存', () => ctx.filterSummary().includes('分类「服装」') && ctx.filterSummary().includes('只看未安装'));
ctx.state.browse.onlyUninstalled = false;

console.log('\n=== installedIdsOf：本地状态 IPC ===');
(async () => {
  // 拿到状态 → 只收「已安装」
  // （注意：这里的假 `call` 要返回**解包后**的 map —— 真 `call()` 会把 `{ok,data}` 拆开只给 data）
  ctx.call = async () => ({ '740': { state: 'installed' }, '741': { state: 'downloading' }, '742': { state: 'pending' }, '743': { state: 'installing' } });
  let s = await ctx.installedIdsOf([{ modId: 740 }, { modId: 741 }, { modId: 742 }, { modId: 743 }]);
  t('只有 installed 进集合', () => s.size === 1 && s.has(740));
  t('下载中/已下载/安装中都不算「已安装」', () => !s.has(741) && !s.has(742) && !s.has(743));

  // IPC 挂掉 → 空集合（宁可少筛，不能藏掉没装的）
  ctx.call = async () => { throw new Error('ipc down'); };
  s = await ctx.installedIdsOf([{ modId: 740 }]);
  t('取不到状态就返回空集合（不筛）', () => s.size === 0);

  ctx.call = async () => null;
  s = await ctx.installedIdsOf([{ modId: 740 }]);
  t('返回 null 也不炸', () => s.size === 0);

  let called = 0;
  ctx.call = async () => { called++; return {}; };
  s = await ctx.installedIdsOf([]);
  t('空列表不发 IPC', () => s.size === 0 && called === 0);

  ctx.call = async () => ({ '740': { state: 'installed' } });
  s = await ctx.installedIdsOf([{ modId: 740 }, {}, { modId: 'abc' }]);
  t('坏 modId 被过滤掉，不污染集合', () => s.size === 1 && s.has(740));

  console.log('\n=== 静态接线断言（防回归） ===');
  t('工具栏有「只显示未安装」开关', () => /id="newOnlyTabs"[\s\S]{0,200}data-onlynew="1">只显示未安装/.test(html));
  t('开关有解释性 title', () => /id="newOnlyTabs" title="[^"]*本地判定[^"]*"/.test(html));
  t('CSS 给了选中态（和成人内容同一套淡底）', () => /\.tabs\.newonly button\.on\{background:rgba\(232,163,61,\.18\)/.test(css));
  t('state 里有 onlyUninstalled 且默认 false', () =>
    /onlyUninstalled: false, blocked: new Set\(\), blockMode: 'hide' \}/.test(code));
  t('点击开关切换状态并重新拉列表', () => /\$\('#newOnlyTabs'\)\.addEventListener\('click'[\s\S]{0,260}state\.browse\.onlyUninstalled = !state\.browse\.onlyUninstalled;[\s\S]{0,180}loadBrowse\(true\);/.test(code));
  t('开关按钮的高亮跟着状态走', () => /classList\.toggle\('on', state\.browse\.onlyUninstalled\)/.test(code));
  t('reset 时清空 items/offset/done', () => /b\.items = \[\]; b\.offset = 0; b\.done = false;/.test(code));
  // ⚠️ 口径已收敛到 `applyLocalFilter`（黑名单 + 只看未安装共用），别再盯着 `if (b.onlyUninstalled)`
  t('筛选开启时整页拉回来再剔（走 applyLocalFilter）', () =>
    /const kept = await applyLocalFilter\(page\.items\)/.test(code) &&
    /async function applyLocalFilter[\s\S]{0,500}installed\.has\(Number\(m\.modId\)\)/.test(code));
  t('facets 计数请求只发一次（循环复用 promise）', () => {
    // 循环里每轮都 await 同一个 facetsP，而不是每轮重开一次请求
    const creates = (code.match(/nexus\.facets\(/g) || []).length;
    return creates === 1 && /const facetsP = needFacets/.test(code) && /,\n\s*facetsP\n/.test(code);
  });
  t('装完后「只看未安装」列表里直接移除该卡片', () => /if \(b\.onlyUninstalled && m\.local && m\.local\.state === 'installed'\) \{[\s\S]{0,260}card\.remove\(\);/.test(code));
  t('空态文案把 this 筛选算进去', () => /b\.category \|\| b\.tags\.length \|\| b\.onlyUninstalled/.test(code));

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  if (fail) process.exit(1);
})().catch(e => { console.error('异步断言崩了：' + (e && e.stack || e)); process.exit(1); });
