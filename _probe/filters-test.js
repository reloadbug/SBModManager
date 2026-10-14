'use strict';
/**
 * 第三十三轮：「记住上次的筛选条件」（`src/renderer/app.js` ＋ `src/main/store.js`）。
 *
 * 用户 2026-10-14：「设置里面增加一个选项，保存最后一次的筛选条件，不用每次都重新筛选；
 * 已安装的 mod 也是同样道理」。
 *
 * 口径（与本轮实现一一对应）：
 *   · 存的只有**筛选条件** —— 浏览页 7 项（排序 / 成人内容 / 只看未安装 / 黑名单 /
 *     只看喜欢 / 分类 / 标签）+ 已安装页 2 项（排序、内置脚本开关）；
 *     **搜索词不入快照**（那是临时查询，下次打开还留着上次的词只会让人以为列表坏了）。
 *   · 恢复只认**合法值** —— 配置被手工改坏、或某个取值以后改了名，一律退回默认；
 *     宁可比用户少恢复一项，也不能把界面搞成一个空列表（用户会以为 mod 没了）。
 *   · 落盘有**闸门** —— 启动恢复完成之前不许写，否则首屏用默认筛选拉的那一轮
 *     会把上次存的值覆盖掉，功能整个失效。
 *   · 恢复**只做一次** —— refreshAll 会被反复调用，每次都重套会把用户刚改的顶回去。
 *
 * 渲染层那四个函数从 `app.js` 源码里**原样抽出**在 vm 里跑真身，不与实现漂移。
 *
 * 运行：`npm run test:filters`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const STORE = path.join(__dirname, '..', 'src', 'main', 'store.js');
const KEYS = path.join(__dirname, 'i18n-keys.json');

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

// ⚠️ 工作区 app.js / store.js 是 CRLF，必须归一成 LF ——
// 否则下面写死的 `\n` 永远匹配不上，静态断言会整片静默变红。
const code = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
const store = fs.readFileSync(STORE, 'utf8').replace(/\r\n/g, '\n');

// —— 从 app.js 抽出「记住筛选」那一整段真身（两个标志 + 常量 + 四个函数）——
const S0 = code.indexOf('let filtersReady = false;');
const S1 = code.indexOf('/** 就地摘掉一张卡片');
if (S0 < 0 || S1 <= S0) { console.error('抽不出「记住筛选」源码段，app.js 结构变了？'); process.exit(1); }
// `applyLastFilters` 要用到已安装排序的白名单与默认方向，这三段定义在 app.js 前部，
// 不在上面那段里 —— 一起抽真身注入沙箱，别在套件里手抄一份（会漂移）。
const pick = (re, what) => {
  const m = code.match(re);
  if (!m) throw new Error('抽不到 ' + what + ' 的源码，正则要跟着改');
  return m[0];
};
const SRC_SORTS = pick(/const INSTALLED_SORTS = \[[\s\S]*?\n\];/, 'INSTALLED_SORTS');
const SRC_DIRS = pick(/const SORT_DIRS = \[[^\]]*\];/, 'SORT_DIRS');
const SRC_DEFDIR = pick(/function sortDefaultDir\([\s\S]*?\n}/, 'sortDefaultDir');
const SRC = code.slice(S0, S1);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 造一个只够这段代码跑的 vm 沙箱；返回真身函数与「落盘记录」 */
function makeHarness(cfg) {
  const calls = [];
  const sb = {
    state: {
      browse: {
        sort: 'downloads', search: '', offset: 0, items: [], total: 0, loading: false, done: false,
        adultMode: 'all', category: '', tags: [], facets: null, gen: 0, onlyUninstalled: false,
        blocked: new Set(), blockMode: 'hide', liked: new Set(), onlyLiked: false
      },
      installedSort: 'time',
      installedSortDir: 'desc',   // 0.2.8：已安装页排序方向
      showBuiltin: false,
      config: Object.assign({ rememberFilters: true, lastFilters: null }, cfg || {})
    },
    // INSTALLED_SORTS / SORT_DIRS / sortDefaultDir 由下面 runInContext 的真身源码提供
    window: { api: { config: { set: (patch) => ['set', patch] } } },
    call: (p) => { calls.push(p); return Promise.resolve(p); },
    $: () => null,
    $$: () => [],
    updateBlockTabs: () => {},
    updateLikeTabs: () => {},
    setTimeout, clearTimeout, console
  };
  const ctx = vm.createContext(sb);
  const api = vm.runInContext(
    [SRC_SORTS, SRC_DIRS, SRC_DEFDIR, SRC].join('\n')
      + '\n;({browseFilterSnapshot, applyLastFilters, saveFilters, syncBrowseFilterUI,'
      + '_ready:(v) => { filtersReady = v; }, _readyVal:() => filtersReady});',
    ctx
  );
  return { api, state: sb.state, calls };
}

(async function main() {
  // ============================================================ 1. browseFilterSnapshot

  console.log('\n[1] browseFilterSnapshot：快照里有什么、没什么');
  {
    const H = makeHarness();
    const snap = H.api.browseFilterSnapshot();
    eq(Object.keys(snap).sort().join(','),
      'adultMode,blockMode,category,onlyLiked,onlyUninstalled,sort,tags',
      '快照恰好是这 7 项浏览筛选');
    eq('search' in snap, false, '快照里没有 search —— 搜索词是临时查询，不记');
    eq('offset' in snap, false, '快照里没有分页位置（翻到一半的位置没有回忆价值）');
    eq('items' in snap, false, '快照里没有列表数据');
    eq(snap.sort, 'downloads', '默认排序是 downloads');
    eq(snap.adultMode, 'all', '默认成人内容是 all');

    t('tags 是副本，不是同一个数组引用（改快照不会污染 state）', () => {
      H.state.browse.tags = ['CNS'];
      const s = H.api.browseFilterSnapshot();
      s.tags.push('EXTRA');
      return (H.state.browse.tags.length === 1 && s.tags.length === 2) || '共享了同一个数组';
    });

    H.state.browse.sort = 'newest';
    H.state.browse.onlyUninstalled = true;
    eq(H.api.browseFilterSnapshot().sort, 'newest', '读的是当前 state，不是写死的默认值');

    // 显式传对象（纯函数，可离线钉死口径）
    const s2 = H.api.browseFilterSnapshot({
      sort: 'updated', adultMode: 'hide', onlyUninstalled: 1, blockMode: 'only',
      onlyLiked: 0, category: 'outfits', tags: ['a', 3, 'b']
    });
    eq(s2.onlyUninstalled, true, 'onlyUninstalled 规范化成布尔');
    eq(s2.onlyLiked, false, 'onlyLiked 规范化成布尔');
    eq(s2.category, 'outfits', 'category 原样带上');
    eq(JSON.stringify(s2.tags), '["a",3,"b"]', '快照阶段原样复制 tags（类型过滤在恢复端做）');

    const s3 = H.api.browseFilterSnapshot({});
    eq(s3.category, '', 'category 缺失 → 空串（不是 undefined）');
    eq(JSON.stringify(s3.tags), '[]', 'tags 缺失 → 空数组');
    eq(s3.onlyUninstalled, false, 'onlyUninstalled 缺失 → false');
    eq(s3.adultMode, undefined, 'adultMode 缺失 → undefined（交给恢复端判合法）');
  }

  // ============================================================ 2. applyLastFilters

  console.log('\n[2] applyLastFilters：只认合法值，宁可少恢复也不给空列表');
  {
    // 开关关掉
    let H = makeHarness({ rememberFilters: false, lastFilters: { browse: { sort: 'newest' } } });
    eq(H.api.applyLastFilters(), false, '开关关掉时返回 false');
    eq(H.state.browse.sort, 'downloads', '开关关掉时一个字都不改');

    // 没存过 / 存了垃圾
    H = makeHarness({ lastFilters: null });
    eq(H.api.applyLastFilters(), false, '没有快照时返回 false');
    eq(H.state.browse.sort, 'downloads', '没有快照时保持默认');

    H = makeHarness({ lastFilters: 'not-an-object' });
    eq(H.api.applyLastFilters(), false, '快照不是对象时返回 false');

    H = makeHarness({ lastFilters: 42 });
    eq(H.api.applyLastFilters(), false, '快照是数字时返回 false（不抛异常）');
  }

  {
    // 正常恢复
    const H = makeHarness({
      lastFilters: {
        browse: {
          sort: 'endorsements', adultMode: 'hide', blockMode: 'all',
          onlyUninstalled: true, onlyLiked: true, category: 'Outfits', tags: ['CNS', 'Bikini']
        },
        installedSort: 'modid',
        installedSortDir: 'desc',
        showBuiltin: true
      }
    });
    eq(H.api.applyLastFilters(), true, '有合法快照时返回 true');
    eq(H.state.browse.sort, 'endorsements', '浏览页排序恢复');
    eq(H.state.browse.adultMode, 'hide', '成人内容范围恢复');
    eq(H.state.browse.blockMode, 'all', '黑名单模式恢复');
    eq(H.state.browse.onlyUninstalled, true, '「只看未安装」恢复');
    eq(H.state.browse.onlyLiked, true, '「只看喜欢」恢复');
    eq(H.state.browse.category, 'Outfits', '分类恢复');
    eq(JSON.stringify(H.state.browse.tags), '["CNS","Bikini"]', '标签恢复');
    eq(H.state.installedSort, 'modid', '已安装页排序恢复');
    eq(H.state.installedSortDir, 'desc', '已安装页排序**方向**恢复（modid 默认 asc，这里是用户自己翻过的 desc）');
    eq(H.state.showBuiltin, true, '已安装页「显示内置脚本」恢复');
  }

  {
    // 方向：缺字段 / 非法值 一律退回「该排序方式的默认方向」
    const H = makeHarness({ lastFilters: { installedSort: 'name' } });
    H.api.applyLastFilters();
    eq(H.state.installedSort, 'name', '只存了排序也能恢复');
    eq(H.state.installedSortDir, 'asc', '快照里没提方向 → 用 name 的默认方向 asc');

    const H2 = makeHarness({ lastFilters: { installedSort: 'time' } });
    H2.api.applyLastFilters();
    eq(H2.state.installedSortDir, 'desc', 'time 的默认方向是 desc（最新装的最上面）');

    const H3 = makeHarness({ lastFilters: { installedSort: 'kind', installedSortDir: 'sideways' } });
    H3.api.applyLastFilters();
    eq(H3.state.installedSortDir, 'asc', '非法方向被拒 → 退回 kind 的默认方向');

    const H4 = makeHarness({ lastFilters: { installedSort: 'modid', installedSortDir: 'asc' } });
    H4.api.applyLastFilters();
    eq(H4.state.installedSortDir, 'asc', '合法方向原样采纳（不因为等于默认值就丢掉）');
  }

  {
    // 互斥归一：onlyLiked 与 blockMode='only' 不能同时成立
    const H = makeHarness({ lastFilters: { browse: { onlyLiked: true, blockMode: 'only' } } });
    H.api.applyLastFilters();
    eq(H.state.browse.onlyLiked, true, '互斥时保留「只看喜欢」');
    eq(H.state.browse.blockMode, 'hide', '互斥时黑名单退回 hide（不退回默认 all）');

    const H2 = makeHarness({ lastFilters: { browse: { onlyLiked: false, blockMode: 'only' } } });
    H2.api.applyLastFilters();
    eq(H2.state.browse.blockMode, 'only', '没开「只看喜欢」时 blockMode=only 合法保留');
    eq(H2.state.browse.onlyLiked, false, 'onlyLiked 保持 false');
  }

  {
    // 非法值一律退回默认
    const H = makeHarness({
      lastFilters: {
        browse: { sort: 'hacked', adultMode: 'weird', blockMode: 'bad' },
        installedSort: 'zzz', showBuiltin: 'yes'
      }
    });
    eq(H.api.applyLastFilters(), true, '整体仍返回 true（有快照就恢复，只是逐项过滤）');
    eq(H.state.browse.sort, 'downloads', '非法 sort 被拒 → 退回默认排序');
    eq(H.state.browse.adultMode, 'all', '非法 adultMode 被拒 → 退回默认');
    eq(H.state.browse.blockMode, 'hide', '非法 blockMode 被拒 → 退回默认');
    eq(H.state.installedSort, 'time', '非法 installedSort 被拒 → 退回默认');
    eq(H.state.installedSortDir, 'desc', '非法 installedSort 时方向也跟着退回 time 的默认 desc');
    eq(H.state.showBuiltin, false, 'showBuiltin 非布尔时不采纳');

    // 方向合法但排序方式非法：方向不能单独成立（否则会得到一个「说不清是什么排序」的方向）
    const H2 = makeHarness({ lastFilters: { installedSort: 'zzz', installedSortDir: 'asc' } });
    H2.api.applyLastFilters();
    eq(H2.state.installedSort, 'time', '非法 installedSort 仍退回默认 time');
    eq(H2.state.installedSortDir, 'desc', '方向随排序方式一起退回默认（不采纳孤立的 asc）');
  }

  {
    // 类型过滤
    const H = makeHarness({ lastFilters: { browse: { tags: ['a', 3, null, 'b', {}], category: 123 } } });
    H.api.applyLastFilters();
    eq(JSON.stringify(H.state.browse.tags), '["a","b"]', 'tags 只留字符串，其余剔掉');
    eq(H.state.browse.category, '', 'category 非字符串 → 空串');
  }

  {
    // 只有一半的快照
    const H = makeHarness({ lastFilters: { installedSort: 'kind' } });
    H.api.applyLastFilters();
    eq(H.state.installedSort, 'kind', '缺 browse 段时已安装排序照样恢复');
    eq(H.state.browse.sort, 'downloads', '缺 browse 段时浏览筛选保持默认');

    const H2 = makeHarness({ lastFilters: { browse: { sort: 'newest' } } });
    H2.api.applyLastFilters();
    eq(H2.state.browse.sort, 'newest', '只存了排序也能恢复');
    eq(H2.state.installedSort, 'time', '快照里没提已安装排序 → 保持默认');
  }

  // ============================================================ 3. saveFilters

  console.log('\n[3] saveFilters：启动闸门 + 防抖 + 开关');
  {
    const H = makeHarness();
    H.api.saveFilters();
    await sleep(420);
    eq(H.calls.length, 0, '启动恢复完成前不落盘（否则默认值会把上次的筛选覆盖掉）');
    eq(H.api._readyVal(), false, '闸门初始是「未就绪」');
  }

  {
    const H = makeHarness();
    H.api._ready(true);
    H.api.saveFilters(); H.api.saveFilters(); H.api.saveFilters();
    eq(H.calls.length, 0, '防抖期内不立刻写盘');
    await sleep(420);
    eq(H.calls.length, 1, '连点 3 次只落盘 1 次');

    const payload = H.calls[0];
    eq(Array.isArray(payload) && payload[0] === 'set', true, '落盘走 config.set');
    t('写入的是 { lastFilters: {...} }', () => !!(payload[1] && payload[1].lastFilters) || '没有 lastFilters');
    eq(payload[1].lastFilters.installedSort, 'time', 'payload 里带已安装页排序');
    eq(payload[1].lastFilters.installedSortDir, 'desc', 'payload 里带已安装页排序方向');
    eq(payload[1].lastFilters.showBuiltin, false, 'payload 里带内置脚本开关');
    eq(payload[1].lastFilters.browse.sort, 'downloads', 'payload 里带浏览页筛选');

    // 改完再存 → 落盘的是最后一次的值
    H.state.browse.sort = 'newest';
    H.state.installedSort = 'name';
    H.state.installedSortDir = 'asc';
    H.state.showBuiltin = true;
    H.api.saveFilters();
    await sleep(420);
    eq(H.calls.length, 2, '新的一轮改动重新落盘');
    eq(H.calls[1][1].lastFilters.browse.sort, 'newest', '落盘的是最新排序');
    eq(H.calls[1][1].lastFilters.installedSort, 'name', '落盘的是最新已安装排序');
    eq(H.calls[1][1].lastFilters.installedSortDir, 'asc', '落盘的是最新已安装排序方向');
    eq(H.calls[1][1].lastFilters.showBuiltin, true, '落盘的是最新内置脚本开关');
    eq(H.calls[1][1].lastFilters.browse.search, undefined, '落盘内容里没有搜索词');
  }

  {
    const H = makeHarness({ rememberFilters: false });
    H.api._ready(true);
    H.api.saveFilters();
    await sleep(420);
    eq(H.calls.length, 0, '开关关掉时不再保存');
  }

  {
    const H = makeHarness();
    H.state.config = null;      // bootstrap 还没回来
    H.api._ready(true);
    H.api.saveFilters();
    await sleep(420);
    eq(H.calls.length, 0, 'config 还没拿到时不保存，也不抛异常');
  }

  // ============================================================ 4. 接线（静态）

  console.log('\n[4] 接线：三处挂钩 + 设置页开关');
  {
    t('store：DEFAULT_CONFIG 有 rememberFilters（默认 true）', () =>
      /rememberFilters: true/.test(store) || '缺失');
    t('store：DEFAULT_CONFIG 有 lastFilters（默认 null）', () =>
      /lastFilters: null/.test(store) || '缺失');

    t('loadBrowse 的 reset 分支挂了 saveFilters()（8 个筛选入口的收口点）', () =>
      /if \(reset\) \{[\s\S]{0,500}saveFilters\(\);/.test(code) || '缺失');
    t('已安装页「内置脚本开关」后保存', () =>
      /state\.showBuiltin = !state\.showBuiltin;\s*\n\s*renderInstalled\(\);\s*\n\s*saveFilters\(\);/.test(code) || '缺失');
    t('已安装页「排序」后保存（0.2.8：换模式时方向回到该模式默认值）', () =>
      /state\.installedSort = v;\s*\n\s*state\.installedSortDir = sortDefaultDir\(v\);[\s\S]{0,80}renderInstalled\(\);\s*\n\s*saveFilters\(\);/.test(code) || '缺失');
    t('已安装页「方向按钮」后保存', () =>
      /const idir = t\.closest\('\[data-isortdir\]'\);[\s\S]{0,60}toggleInstalledSortDir\(\);/.test(code) || '缺失');
    t('toggleInstalledSortDir 里也 saveFilters()（方向也是要记住的筛选条件）', () =>
      /function toggleInstalledSortDir\(\) \{\s*\n\s*state\.installedSortDir = [^\n]*;\s*\n\s*renderInstalled\(\);\s*\n\s*saveFilters\(\);/.test(code) || '缺失');

    t('saveFilters 开头有「启动未完成不落盘」闸门', () =>
      /function saveFilters\(\) \{\s*\n\s*if \(!filtersReady\) return;/.test(code) || '缺失');
    t('refreshAll 里「只套用一次」的守卫', () =>
      /if \(!filtersApplied\) \{\s*\n\s*filtersApplied = true;/.test(code) || '缺失');
    t('恢复顺序：applyLastFilters → syncBrowseFilterUI → 打开闸门', () =>
      /applyLastFilters\(\);\s*\n\s*syncBrowseFilterUI\(\);\s*\n\s*filtersReady = true;/.test(code) || '缺失');
    t('恢复块在 renderInstalled() 之前（首屏就按恢复后的排序画）', () => {
      const i0 = code.indexOf('async function refreshAll');
      const iApply = code.indexOf('applyLastFilters();', i0);
      const iRender = code.indexOf('renderInstalled();', i0);
      return (iApply > 0 && iRender > 0 && iApply < iRender) || `apply@${iApply} render@${iRender}`;
    });
    t('恢复后筛选真的变了才重拉列表（没变就不白跑一趟）', () =>
      /if \(before !== JSON\.stringify\(browseFilterSnapshot\(\)\)\) loadBrowse\(true\);/.test(code) || '缺失');

    t('设置页有「记住筛选条件」下拉', () => /id="setRememberFilters"/.test(code) || '缺失');
    t('设置页分组标题是「浏览与筛选」', () => /<h3>浏览与筛选<\/h3>/.test(code) || '缺失');
    t('开关写回 config.rememberFilters', () =>
      /e\.target\.id === 'setRememberFilters'[\s\S]{0,400}config\.set\(\{ rememberFilters: on \}\)/.test(code) || '缺失');
    t('关掉开关时不删已存快照（语义是「不套用」，不是「清空」）', () =>
      /关掉 = 下次启动不再套用/.test(code) || '缺失');
  }

  // ============================================================ 5. 纯函数边界

  console.log('\n[5] 边界：这两个函数不碰网络、不碰 DOM');
  {
    t('browseFilterSnapshot 不发请求', () => {
      const i = code.indexOf('function browseFilterSnapshot');
      const body = code.slice(i, code.indexOf('\n}\n', i));
      return (!/window\.api|await |fetch\(/.test(body)) || '函数体里出现了请求';
    });
    t('applyLastFilters 只改内存状态（重拉交给调用方）', () => {
      const i = code.indexOf('function applyLastFilters');
      const body = code.slice(i, code.indexOf('\n}\n', i));
      return (!/loadBrowse|window\.api|localStorage/.test(body)) || '函数体里出现了副作用';
    });
    t('syncBrowseFilterUI 有四组按钮的同步（排序/成人/未安装/黑名单+喜欢）', () => {
      const i = code.indexOf('function syncBrowseFilterUI');
      const body = code.slice(i, code.indexOf('\n}\n', i));
      const hits = ['#sortTabs', '#adultTabs', '#newOnlyTabs', 'updateBlockTabs', 'updateLikeTabs']
        .filter(x => body.includes(x));
      return hits.length === 5 || `只同步了 ${hits.length}/5 组：${hits.join(',')}`;
    });
    t('本套件自己不写盘（纯内存 + vm）', () => {
      // ⚠️ 正则本身不能把要查的词面写出来 —— 否则 `readFileSync(__filename)`
      // 读到的源码里就包含那个词，断言自己把自己绊倒（踩过一次）。拼起来。
      const bad = new RegExp('write' + 'FileSync|mkdir' + 'Sync|append' + 'FileSync');
      const self = fs.readFileSync(__filename, 'utf8');
      return (!bad.test(self)) || '本文件里有写盘调用';
    });
  }

  // ============================================================ 6. i18n 登记

  console.log('\n[6] i18n：新增文案都已登记');
  {
    const keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
    const NEED = [
      '浏览与筛选', '记住筛选条件', '记住（下次启动自动套用）', '不记住（每次都用默认筛选）',
      '已开启：下次启动自动套用上次的筛选条件', '已关闭：每次启动都用默认筛选'
    ];
    for (const k of NEED) eq(keys.includes(k), true, `键表登记了「${k}」`);
    t('键表登记了设置页的两段说明', () =>
      (keys.some(k => k.startsWith('记住浏览页与「已安装」页的筛选条件'))
        && keys.some(k => k.startsWith('搜索关键词不记'))) || '缺失');
    t('设置页那段说明在 app.js 里是单行（多行会被 DOM 拆成多个文本节点，i18n 查不到）', () =>
      /<div class="hint">\s*\n\s*记住浏览页与「已安装」页的筛选条件[^\n]*\n\s*<\/div>/.test(code) || '缺失');
  }

  // ============================================================

  console.log('');
  if (fail) {
    console.log('❌ filters: ' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('\n失败项：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ filters: ' + pass + ' 通过 / 0 失败');
})().catch(e => {
  console.error('套件本身崩了：', e);
  process.exit(1);
});
