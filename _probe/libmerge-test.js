/**
 * 「Mod 库」统一页面（浏览 + 已下载 + 已安装 合成一套界面）的静态与纯函数探针。
 *
 * 用户 2026-11-10 的要求：
 *   已下载和浏览的界面合并；一套界面既能管本地 Mod 又能浏在线 Mod；
 *   状态要分清（在线 / 已下载 / 已安装 / 已启用 / 已禁用…）；点赞等完全复用；
 *   用户打分与 bug 标记跟 Nexus modId 绑定，删掉 Mod 文件也不能丢用户数据。
 *
 * 这个探针不启动窗口：把 app.js 里「记录拼装 + 状态派生 + 过滤 + 计数」那一段抠进 vm 跑真函数，
 * 剩下的接线（HTML 结构、按钮绑定、点击委托）用源码断言兜住。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');

let pass = 0;
let fail = 0;
const fails = [];
function t(name, fn) {
  let ok = false;
  let why = '';
  try {
    const r = fn();
    if (r === false) why = 'false';
    else if (typeof r === 'string') why = r;
    else ok = true;
  } catch (e) {
    why = '抛出 ' + e.message;
  }
  if (ok) { pass++; console.log('✓ ' + name); }
  else { fail++; fails.push(name + ' → ' + why); console.log('✗ ' + name + ' → ' + why); }
}


﻿  /* ---------- G. 「已验证」标记 + 三态标记（用户 2026-11-10 / 2026-11-11） ---------- */
  t('标记 chip 有四颗：喜欢 / 不感兴趣 / 有 bug / 已验证，并标了正负', () =>
    app.includes("{ k: 'liked', label: '👍 喜欢'") &&
    app.includes("{ k: 'blocked', label: '👎 不感兴趣'") &&
    app.includes("{ k: 'bug', label: '⚠ 有 bug'") &&
    app.includes("{ k: 'verified', label: '✓ 已验证'") &&
    app.includes('neg: true') && app.includes('neg: false') ||
    '四颗标记不全');
  t('反义词那两颗（不含 bug / 未验证）已经撤掉，改由三态表达', () =>
    (!app.includes("k: 'nobug'") && !app.includes("k: 'unverified'")) || '反义词 chip 还在');
  t('libMarkSet 认 verified', () => app.includes("if (k === 'verified') return state.verifiedIds;"));
  t('筛选按「只看 / 排除」两个方向循环判断', () =>
    (app.includes("for (const k of ['liked', 'blocked', 'bug', 'verified'])")
      && app.includes("if (mode === 'in' && !has) return false;")
      && app.includes("if (mode === 'ex' && has) return false;")) || '标记筛选没做成三态');
  t('负面标记默认是「排除」而不是「只看」', () =>
    app.includes("marks.blocked !== 'in'") || '负面标记默认没按排除走');
  t('点一下切三态：任意 → 排除 → 只看 → 任意（正面标记反过来）', () => {
    const i = app.indexOf('function toggleLibMark(');
    const body = app.slice(i, i + 900);
    return (body.includes('neg') && body.includes("'ex'") && body.includes("'in'")) || 'toggleLibMark 没做三态循环';
  });
  t('卡片上有「标记已验证」按钮（data-libver）', () =>
    app.includes('data-libver=') && app.includes('已验证') || '缺 data-libver 按钮');
  t('index.html：吸顶区 #browseHead 的 div 是配平的（多删一行就会把 #browseArea 挤出 .main）', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8').split(/\r?\n/);
  const start = html.findIndex(l => l.includes('class="bhead"'));
  if (start < 0) return '#browseHead 不见了';
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    depth += (html[i].match(/<div\b/g) || []).length - (html[i].match(/<\/div>/g) || []).length;
    if (depth === 0) {
      const areaLine = html.findIndex(l => l.includes('id="browseArea"'));
      return areaLine > i || 'browseArea 落在了 #browseHead 里面';
    }
  }
  return '#browseHead 没有闭合';
});
t('index.html：#browseArea 在 #p-browse 里面', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const a = html.indexOf('id="p-browse"'), b = html.indexOf('id="p-download"');
  const area = html.indexOf('id="browseArea"');
  return (a > -1 && area > a && area < b) || '#browseArea 不在 p-browse 区间里';
});
t('卡片封面上有蓝色「✓ 已验证」标签（合并卡 libCard 里也要有，不只是在线卡）', () => {
  const i = app.indexOf('function libCard(');
  if (i < 0) return 'libCard 不见了';
  const body = app.slice(i, i + 4200);
  return body.includes('class="tag ver"') || 'libCard 封面缺 tag ver';
});
  t('已安装抽屉底部有「标为已验证」', () => app.includes('data-gver="${esc(g.key)}"'));
  t('Nexus 抽屉动作里有「标为已验证」', () => app.includes('data-vername='));
  t('已验证用蓝色，不和绿的「不含 bug」撞色', () =>
    css.includes('.cover .tag.ver') && css.includes('.btn.ver.on') && css.includes('tone-ver'));
  t('toggleVerified 走 verified:add / verified:remove', () =>
    app.includes('window.api.verified.remove(id)') && app.includes('window.api.verified.add(id'));
  t('启动时 loadVerified 紧跟 loadBugs 调用', () => {
    const i0 = app.lastIndexOf('await loadBugs();');
    return i0 >= 0 && app.slice(i0, i0 + 220).includes('await loadVerified();');
  });
  t('verifyToggle 会刷新列表并提示', () => app.includes('已标记为已验证') && app.includes('已取消「已验证」标记'));

  /* ---------- H. 多选 Shift / Ctrl（用户 2026-11-10） ---------- */
  t('libRangeTo 按屏幕顺序取区间', () => app.includes('function libRangeTo(key, additive)') && app.includes('const order = libOrderKeys();'));
  t('libOrderKeys 用 libShownRecords（含本地记录的 key）', () => {
    const i = app.indexOf('function libOrderKeys()');
    return i >= 0 && app.slice(i, i + 260).includes('libShownRecords');
  });
  t('Shift 走连选、Ctrl 走追加', () => app.includes('if (e && e.shiftKey) { libRangeTo(k, !!(e.ctrlKey || e.metaKey)); return; }'));
  t('Shift 连选后统一同步卡片外观', () => app.includes('function libSyncCards()'));
  t('锚点记在 state.libAnchor', () => app.includes('state.libAnchor = k;'));
  t('共享导入 已验证 存到 state.verifiedIds', () => app.includes('verifiedIds: new Set(),'));
// ---------------------------------------------------------------------------
// 把「记录拼装 + 状态派生 + 过滤」整段切出来（从 LIB_STATUS_CHIPS 到 paintLibHead 之前）
// ---------------------------------------------------------------------------
const start = app.indexOf('const LIB_STATUS_CHIPS');
const end = app.indexOf('/** 画顶部状态行');
assert.ok(start > 0 && end > start, '找不到 Mod 库的核心代码块');
const core = app.slice(start, end);

const state = {
  installedGroups: [],
  library: null,
  browse: { items: [], blockMode: 'hide', search: '', liked: new Set(), blocked: new Set() },
  instFilters: { q: '', state: '', kind: '', bug: '' },
  lib: { status: 'all', marks: { liked: false, blocked: false, bug: false }, kind: '' },
  bugIds: new Set(),
  likes: new Set(),
  blocked: new Set(),
  downloads: []
};

const ctx = {
  state,
  console: { warn() {}, log() {} },
  Math, Number, String, Set, Map, Array, Object, Date, isNaN,
  fmtNum: (n) => (typeof n === 'number' ? String(n) : '—'),
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  verText: (v) => 'v' + String(v || '').replace(/^v/, ''),
  // 元信息/封面这两个是别的模块提供的，探针里给空实现就够（核心逻辑只做 typeof 判断）
  libMetaFor: () => null,
  coverForMod: () => ''
};
vm.createContext(ctx);
vm.runInContext(
  core + '\nthis.buildLibRecords=buildLibRecords; this.libFilterRecords=libFilterRecords;' +
  'this.libStatusCounts=libStatusCounts; this.libStateOf=libStateOf; this.libTypeOf=libTypeOf;' +
  'this.libHasMark=libHasMark;' +
  'this.LIB_STATUS_CHIPS=LIB_STATUS_CHIPS; this.LIB_MARK_CHIPS=LIB_MARK_CHIPS; this.LIB_BADGE=LIB_BADGE;',
  ctx
);

function resetState() {
  state.installedGroups = [];
  state.library = null;
  state.browse = { items: [], blockMode: 'hide', search: '', liked: new Set(), blocked: new Set() };
  state.instFilters = { q: '', state: '', kind: '', bug: '' };
  state.lib = { status: 'all', marks: { liked: false, blocked: false, bug: false }, kind: '' };
  state.bugIds = new Set();
  state.downloads = [];
}

// ---------------------------------------------------------------------------
console.log('\n=== A. 记录拼装：三种状态合成一张表，同一个 modId 只留一条 ===');
t('已安装 + 已下载 + 在线 各来一条 → 三条记录、键各不相同', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:100', modId: 100, name: '已装的那个', enabled: true, items: [], kind: 'pak' }];
  state.library = { items: [{ modId: 200, name: '下了没装', filename: '200_x.zip', archivePath: 'D:\\lib\\200_x.zip', size: 1024 }] };
  state.browse.items = [{ modId: 300, name: '只在线的', author: 'a', version: '1.0' }];
  const recs = ctx.buildLibRecords();
  return recs.length === 3 && recs[0].key === 'mod:100' && recs[1].key === 'lib:200' && recs[2].key === '300';
});
t('同一个 modId 装了又下过 → 只留「已安装」那一条（本地状态优先）', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:100', modId: 100, name: '装着的', enabled: true, items: [], kind: 'pak' }];
  state.library = { items: [{ modId: 100, name: '同一个的包', filename: '100.zip', size: 10 }] };
  state.browse.items = [{ modId: 100, name: '在线同名' }];
  const recs = ctx.buildLibRecords();
  return recs.length === 1 && recs[0].kind === 'installed';
});
t('在线那条只补信息、不改本地状态（rec.online 挂上）', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:100', modId: 100, name: '装着的', enabled: true, items: [], kind: 'pak' }];
  state.browse.items = [{ modId: 100, name: '在线同名', downloads: 99 }];
  const recs = ctx.buildLibRecords();
  return recs[0].kind === 'installed' && !!recs[0].online && recs[0].online.downloads === 99;
});
t('没有 modId 的本地分组也能成记录（用磁盘键，不报错）', () => {
  resetState();
  state.installedGroups = [{ key: 'one:disk-a', modId: 0, name: '没对上号的文件', enabled: false, items: [{ rel: 'x.pak' }], kind: 'pak' }];
  const recs = ctx.buildLibRecords();
  return recs.length === 1 && recs[0].key === 'one:disk-a' && recs[0].modId === 0;
});
t('library 里的包挂上体积与压缩包路径（删包要拿它）', () => {
  resetState();
  state.library = { items: [{ modId: 200, name: 'n', filename: '200_n.zip', archivePath: 'D:\\lib\\200_n.zip', size: 2048 }] };
  const recs = ctx.buildLibRecords();
  return recs[0].size === 2048 && recs[0].archivePath === 'D:\\lib\\200_n.zip' && recs[0].filename === '200_n.zip';
});
t('state.library 为空时不炸（返回只有已安装与在线的表）', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:1', modId: 1, name: 'a', enabled: true, items: [], kind: 'pak' }];
  state.browse.items = [{ modId: 2, name: 'b' }];
  return ctx.buildLibRecords().length === 2;
});

// ---------------------------------------------------------------------------
console.log('\n=== B. 状态派生：启用 / 禁用 / 部分启用 / 三种本地状态 ===');
t('已安装且启用 → enabled', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:1', modId: 1, name: 'a', enabled: true, items: [], kind: 'pak' }];
  return ctx.libStateOf(ctx.buildLibRecords()[0]) === 'enabled';
});
t('已安装且关闭 → disabled', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:1', modId: 1, name: 'a', enabled: false, items: [], kind: 'pak' }];
  return ctx.libStateOf(ctx.buildLibRecords()[0]) === 'disabled';
});
t('部分文件启用 → partial', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:1', modId: 1, name: 'a', enabled: true, partial: true, items: [], kind: 'pak' }];
  return ctx.libStateOf(ctx.buildLibRecords()[0]) === 'partial';
});
t('库里没装的包 → downloaded', () => {
  resetState();
  state.library = { items: [{ modId: 2, name: 'b', size: 1 }] };
  return ctx.libStateOf(ctx.buildLibRecords()[0]) === 'downloaded';
});
t('只在 Nexus 上 → online', () => {
  resetState();
  state.browse.items = [{ modId: 3, name: 'c' }];
  return ctx.libStateOf(ctx.buildLibRecords()[0]) === 'online';
});
t('五种状态都有对应徽标文案（不会渲染成 undefined）', () => {
  return ['enabled', 'disabled', 'partial', 'downloaded', 'online', 'installed']
    .every((k) => ctx.LIB_BADGE[k] && typeof ctx.LIB_BADGE[k].t === 'string' && ctx.LIB_BADGE[k].t.length > 0);
});

// ---------------------------------------------------------------------------
console.log('\n=== C. 类型判定：本地按文件名/内容判，不联网 ===');
t('名字里带 cns → CNS 换装', () => {
  resetState();
  state.library = { items: [{ modId: 2, name: 'Nikke CNS Swimsuit', size: 1 }] };
  return ctx.libTypeOf(ctx.buildLibRecords()[0]) === 'cns';
});
t('装了 .dekcns.json 的也算 CNS', () => {
  resetState();
  state.installedGroups = [{ key: 'mod:1', modId: 1, name: '无名', enabled: true, kind: 'pak', items: [{ rel: 'SB\\Content\\Paks\\~Mods\\x.dekcns.json' }] }];
  return ctx.libTypeOf(ctx.buildLibRecords()[0]) === 'cns';
});
t('前置组件单独一类', () => {
  resetState();
  // 名字里别带 cns —— 那条规则排在前面，会把前置组件也判成换装包
  state.installedGroups = [{ key: 'mod:1', modId: 1, name: 'Dekita Framework', enabled: true, kind: 'prereq', items: [] }];
  return ctx.libTypeOf(ctx.buildLibRecords()[0]) === 'prereq';
});
t('「全部类型」下拉已经删掉（和分类行重复），分类靠 #browseFilters 的 chip', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  return !/id="libKind"/.test(html) && !/libKindOptions/.test(app) || 'libKind 还在：' + /id="libKind"/.test(html);
});

// ---------------------------------------------------------------------------
console.log('\n=== D. 过滤：状态 / 标记 / 关键词可以叠加 ===');
function three() {
  resetState();
  state.installedGroups = [{ key: 'mod:100', modId: 100, name: 'Bayonetta Suit', enabled: true, items: [], kind: 'pak' }];
  state.library = { items: [{ modId: 200, name: 'Jeanne Suit', size: 1 }] };
  state.browse.items = [{ modId: 300, name: 'Eve Suit' }];
  return ctx.buildLibRecords();
}
t('状态 = 已安装 → 只剩装着的那条', () => {
  const recs = three();
  state.lib.status = 'installed';
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 100;
});
t('状态 = 已下载 → 只剩包在本地没装的那条', () => {
  const recs = three();
  state.lib.status = 'downloaded';
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 200;
});
t('状态 = 在线 → 三条都算在线（本地那两条也有在线信息时会带上）', () => {
  const recs = three();
  state.lib.status = 'online';
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 300;
});
t('标记「有 bug」→ 只留标了的那个', () => {
  const recs = three();
  state.bugIds = new Set(['200']);
  state.lib.marks.bug = 'in';
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 200;
});
t('标记「不感兴趣」→ 只留黑名单里的', () => {
  const recs = three();
  state.browse.blocked = new Set(['100']);
  state.lib.marks.blocked = 'in';
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 100;
});
t('默认把黑名单藏起来（不点标记时也不显示）', () => {
  const recs = three();
  state.browse.blocked = new Set(['100']);
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 2 && !shown.some((r) => r.modId === 100);
});
t('关键词就地筛（名字命中）', () => {
  const recs = three();
  state.browse.search = 'jeanne';
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 200;
});
t('关键词 + 状态叠加（先筛状态再筛词）', () => {
  const recs = three();
  state.lib.status = 'installed';
  state.browse.search = 'jeanne';
  return ctx.libFilterRecords(recs).length === 0;
});
t('关键词也能命中 Mod ID 与文件名', () => {
  const recs = three();
  state.browse.search = '#300';
  const a = ctx.libFilterRecords(recs).length === 1;
  state.browse.search = '';
  state.instFilters.q = '200';
  const b = ctx.libFilterRecords(recs).length >= 1;
  return a && b;
});

// ---------------------------------------------------------------------------
console.log('\n=== E. 计数：chip 上的数字与过滤结果一致 ===');
t('all / installed / downloaded / online 四个基础计数', () => {
  const recs = three();
  const c = ctx.libStatusCounts(recs);
  return c.all === 3 && c.installed === 1 && c.downloaded === 1 && c.online === 1;
});
t('enabled / disabled 只数已安装的', () => {
  resetState();
  state.installedGroups = [
    { key: 'mod:1', modId: 1, name: 'a', enabled: true, items: [], kind: 'pak' },
    { key: 'mod:2', modId: 2, name: 'b', enabled: false, items: [], kind: 'pak' },
    { key: 'mod:3', modId: 3, name: 'c', enabled: true, items: [], kind: 'pak' }
  ];
  state.library = { items: [{ modId: 9, name: 'd', size: 1 }] };
  const c = ctx.libStatusCounts(ctx.buildLibRecords());
  return c.enabled === 2 && c.disabled === 1 && c.installed === 3;
});
t('状态 chip 覆盖了用户点名的五种状态', () => {
  const vs = ctx.LIB_STATUS_CHIPS.map((c) => c.v);
  return ['all', 'online', 'downloaded', 'installed', 'enabled', 'disabled'].every((v) => vs.includes(v));
});
t('状态 chip 覆盖了用户点名的五种状态', () => {
  const vs = ctx.LIB_STATUS_CHIPS.map((c) => c.v);
  return ['all', 'online', 'downloaded', 'installed', 'enabled', 'disabled'].every((v) => vs.includes(v));
});
t('标记 chip 是四颗（喜欢 / 不感兴趣 / 有 bug / 已验证）', () => {
  const ks = ctx.LIB_MARK_CHIPS.map((c) => c.k);
  return ks.length === 4 && ['liked', 'blocked', 'bug', 'verified'].every((k) => ks.includes(k));
});
t('「有 bug」红、「已验证」蓝（tone 标记 + CSS 都在）', () => {
  const bad = ctx.LIB_MARK_CHIPS.find((c) => c.k === 'bug');
  const ver = ctx.LIB_MARK_CHIPS.find((c) => c.k === 'verified');
  return bad.tone === 'bad' && ver.tone === 'ver' &&
    /\.tabs\.libmarks button\.tone-bad\.on/.test(css) && /\.tabs\.libmarks button\.tone-ver\.on/.test(css);
});
t('「不感兴趣」选「排除」时剔掉、选「只看」时只剩它们', () => {
  const recs = three();
  state.browse.blocked = new Set(['100', '200']);
  state.lib.marks.blocked = 'ex';
  const ex = ctx.libFilterRecords(recs).map((r) => r.modId);
  state.lib.marks.blocked = 'in';
  const only = ctx.libFilterRecords(recs).map((r) => r.modId);
  state.browse.blocked = new Set();
  state.lib.marks.blocked = '';
  return (ex.length === 1 && ex[0] === 300 && only.length === 2) || ('ex=' + ex + ' only=' + only);
});
t('清空标记之后记录全回来（三态不残留）', () => {
  const recs = three();
  state.bugIds = new Set(['200']);
  state.lib.marks.bug = 'ex';
  ctx.libFilterRecords(recs);
  state.lib.marks.bug = '';
  const all = ctx.libFilterRecords(recs).map((r) => r.modId);
  state.bugIds = new Set();
  return all.length === 3;
});
// ---------------------------------------------------------------------------
console.log('\n=== F. 接线：一套界面、一套多选、一套批量 ===');
t('index.html 有状态行（#libStatus）与标记筛选（#libMarks），没有多余的「全部类型」下拉', () =>
  /id="libStatus"/.test(html) && /id="libMarks"/.test(html) && !/id="libKind"/.test(html));
t('老的三组筛选（只看未安装 / 只看喜欢 / 只看黑名单）已经撤掉', () =>
  !/id="newOnlyTabs"/.test(html) && !/id="likeTabs"/.test(html) && !/id="blockTabs"/.test(html));
t('导航里「已安装 Mod」只剩一个「Mod 库」入口', () =>
  /data-p="p-browse">/.test(html) && !/data-p="p-installed"/.test(html));
t('老入口（p-installed）会被 switchPage 导向 Mod 库', () =>
  /if \(id === 'p-installed'\) \{[\s\S]{0,200}setLibStatus\('installed'[\s\S]{0,120}id = 'p-browse';/.test(app));
t('renderBrowse 在非「在线」档位直接走合并渲染（零网络）', () =>
  /if \(\(state\.lib\.status \|\| 'all'\) !== 'online'\) \{ renderLibMerged\(\); return; \}/.test(app));
t('合并档位会自己备齐已安装分组与安装包库（否则只剩在线那一条来源）', () =>
  /if \(\(!state\.installedGroups \|\| !state\.installedGroups\.length\) && state\.game && state\.game\.found\)[\s\S]{0,200}renderInstalled\(\)/.test(app) &&
  /refreshLibrary\(\)\.then\(\(\) => \{ if \(\(state\.lib\.status \|\| 'all'\) !== 'online'\) renderBrowse\(\); \}\)/.test(app));
t('五颗批量按钮都在 HTML 里（下载 / 安装 / 启用 / 禁用 / 卸载）', () =>
  ['btnBatchDownload', 'btnBatchInstall', 'btnBatchOn', 'btnBatchOff', 'btnBatchUninstall'].every((id) => html.includes('id="' + id + '"')));
t('五颗按钮都有点击绑定，且接的是新的批量实现', () =>
  /#btnBatchInstall'\)\.addEventListener\('click', \(\) => \{ libBatchInstallSel\(\)/.test(app) &&
  /#btnBatchOn'\)\.addEventListener\('click', \(\) => \{ libBatchToggleSel\(true\)/.test(app) &&
  /#btnBatchOff'\)\.addEventListener\('click', \(\) => \{ libBatchToggleSel\(false\)/.test(app) &&
  /#btnBatchUninstall'\)\.addEventListener\('click', \(\) => \{ libBatchUninstallSel\(\)/.test(app));
t('状态 chip / 标记 chip 的点击委托就位', () =>
  app.includes("const libSt = t.closest('[data-libst]')") && app.includes("const libMk = t.closest('[data-libmk]')"));
t('点卡片按记录键打开详情（装着→已安装抽屉，有 modId→Nexus 抽屉）', () =>
  app.includes("if (lkey) { libOpenRecord(lkey); return; }") &&
  /function libOpenRecord\(key\)[\s\S]{0,400}openInstalledDrawer\(rec\.group\)[\s\S]{0,200}openNexusDrawer\(Number\(rec\.modId\)\)/.test(app));
t('多选态点卡片 = 勾选（不弹抽屉）', () =>
  app.includes('if (state.sel.on) {') && app.includes('if (lkey) { libClickSelect(lkey, e); return; }'));
t('卡片就绪三种状态的主按钮各不相同', () =>
  app.includes('data-lib-install="${rec.modId}"') && app.includes('data-libdel="${rec.modId}"') && app.includes('data-dl-add="${rec.modId}"'));
t('用户标记（喜欢 / 不感兴趣 / 有 bug）都挂在 modId 上，卡片上有投票按钮', () =>
  /const vote = rec\.modId \? voteHtml\(\{ modId: rec\.modId \}\) : ''/.test(app));
t('删包只删安装包，不动用户标记（提示文案里写明）', () =>
  app.includes('只删安装包，不动用户标记'));
t('「启用」「禁用」两颗按钮各自只数能被它改变的那些', () =>
  app.includes("pick: () => (sel.installed || []).filter(r => !r.enabled || r.partial)") &&
  app.includes("pick: () => (sel.installed || []).filter(r => r.enabled || r.partial)"));
t('CSS：状态行与在线档位的排序条并存（.librow / .libkind / .tabs.libst）', () =>
  /\.librow\{/.test(css) && /\.libkind\{/.test(css) && /\.tabs\.libst button/.test(css) && /\.lb\.off\{/.test(css) && /\.lb\.part\{/.test(css));
t('老筛选块撤掉后，三处 addEventListener 都做了「元素不在就跳过」的守卫', () =>
  /const elNewOnly = \$\('#newOnlyTabs'\);\r?\n\s*if \(elNewOnly\) elNewOnly\.addEventListener/.test(app) &&
  /const elBlockTabs = \$\('#blockTabs'\);\r?\n\s*if \(elBlockTabs\) elBlockTabs\.addEventListener/.test(app) &&
  /const elLikeTabs = \$\('#likeTabs'\);\r?\n\s*if \(elLikeTabs\) elLikeTabs\.addEventListener/.test(app));

// ---------------------------------------------------------------------------
// 批量标记（用户 2026-11-10：「全选后要支持批量标记 喜欢 / 不喜欢 / bug / 已验证 / 未验证」）
// ---------------------------------------------------------------------------
t('多选态多出「批量标记」一排，五颗按钮都在 HTML 里', () =>
  html.includes("id=\"batchMarks\"") &&
  ['btnBatchLike', 'btnBatchDislike', 'btnBatchBug', 'btnBatchVerify', 'btnBatchUnverify'].every((id) => html.includes('id="' + id + '"')));
t('这排按钮默认藏起来，只在多选态出现', () =>
  /<div class="tabs batch marks" id="batchMarks" style="display:none"/.test(html) &&
  app.includes("const wrap = $('#batchMarks');") &&
  app.includes("if (wrap) wrap.style.display = state.sel.on ? '' : 'none';"));
t('libBatchMark 支四类标记，各写各的记录、各刷各的状态', () =>
  /async function libBatchMark\(kind, force\)/.test(app) &&
  app.includes('add: (id) => window.api.favorites.add(Number(id), {})') &&
  app.includes('add: (id) => window.api.blacklist.add(Number(id), {})') &&
  app.includes('add: (id) => window.api.bugs.add(Number(id), {})') &&
  app.includes('add: (id) => window.api.verified.add(Number(id), {})') &&
  app.includes('reload: () => loadFavorites()') &&
  app.includes('reload: () => loadBlacklist()') &&
  app.includes('reload: () => loadBugs()') &&
  app.includes('reload: () => loadVerified()'));
t('默认是智能开关：全标过再点一下就是取消', () =>
  app.includes('const allMarked = usable.every(r => K.has(r));') &&
  app.includes('const remove = force === true ? true : (force === false ? false : allMarked);'));
t('只给有 Nexus Mod ID 的条目打标记，其余跳过并说明原因', () =>
  app.includes('const usable = all.filter(r => Number(r.modId) > 0);') &&
  app.includes('标记靠 Mod ID 认人'));
t('打完标记会重画列表并保留选择，同时提示标了几个 / 失败几个', () =>
  /try \{ await K\.reload\(\); \}[\s\S]{0,400}renderBrowse\(\);\r?\n\s*selUpdateBar\(\);/.test(app) &&
  app.includes("toast(bad ? msg + '（失败 ' + bad + ' 个）' : msg, bad ? 'warn' : 'ok');"));
t('五颗按钮都绑定了，且「未验证」是明确取消已验证（force=true）', () =>
  app.includes("bindMark('btnBatchLike', 'like');") &&
  app.includes("bindMark('btnBatchDislike', 'dislike');") &&
  app.includes("bindMark('btnBatchBug', 'bug');") &&
  app.includes("bindMark('btnBatchVerify', 'verified');") &&
  app.includes("bindMark('btnBatchUnverify', 'verified', true);"));
t('selUpdateBar 里同步这五颗：全标过时点亮并换成「取消…」文案', () =>
  app.includes('const allHas = usable.length > 0 && usable.every(m.has);') &&
  app.includes("m.el.classList.toggle('on', allHas);") &&
  app.includes("on: '取消喜欢', off: '👍 喜欢'") &&
  app.includes("on: '取消「已验证」', off: '✓ 已验证'"));
/* ---------- I. 恢复「Mod 库」缺的功能（用户 2026-11-11） ---------- */
t('顶部不再有「显示内置脚本」开关（0.7.2 按用户要求撤掉）', () =>
  !html.includes('libBuiltin') && !app.includes('data-libbuiltin'));
t('「开启时间 / 安装时间」做成与在线排序同排的 chip，不再用下拉', () =>
  html.includes('id="libSortTabs"') && html.includes('data-libsort="on-desc"')
  && !html.includes('id="libSort"') && app.includes("'button[data-libsort]'")
  && app.includes("state.lib.sort = (state.lib.sort === v) ? '' : v;"));
t('状态档补了「未登记」「已关联」', () =>
  app.includes("{ v: 'unreg', label: '未登记' }") && app.includes("{ v: 'linked', label: '已关联' }") &&
  app.includes("else if (st === 'unreg') { if (rec.modId) return false; }") &&
  app.includes("else if (st === 'linked') { if (!rec.link) return false; }"));
t('libStatusCounts 统计未登记 / 已关联', () =>
  /if \(!rec\.modId\) c\.unreg\+\+;\s*else if \(rec\.link\) c\.linked\+\+;/.test(app));
t('分类词表转译：英文 value 先翻成中文再比', () =>
  app.includes('const hit = f.categories.find(c => String(c.value) === catRaw);') &&
  app.includes('if (hit && hit.zh) return String(hit.zh);'));
t('分类筛选只在「在线」档位或用户主动选过时生效（catSet）', () =>
  app.includes("const catRaw = String((st === 'online' || state.lib.catSet) ? (state.browse.category || '') : '');") &&
  app.includes('state.lib.catSet = true;') && app.includes('state.lib.catSet = false;'));
t('分类一条都匹配不上时当作没选（不至于把列表筛空）', () =>
  app.includes('const catActive = !!catRaw && (recs || []).some(catOk);') &&
  app.includes('if (catActive && !catOk(rec)) return false;'));
t('成人内容三档生效', () =>
  app.includes("if (am === 'hide' && rec.adult) return false;") &&
  app.includes("if (am === 'only' && !rec.adult) return false;"));
t('内置脚本不再被过滤掉（开关撤了，内置脚本一直在列表里）', () =>
  !app.includes('if (!state.showBuiltin && rec.builtin) return false;'));
t('合并态也有分类筛选条（renderLibFilters）', () =>
  app.includes('function renderLibFilters(recs)') && app.includes('renderLibFilters(recs);') &&
  app.includes('本地记录的分类要等 Nexus 信息补全后才出现'));
t('本地记录的元信息靠 info.local 一次性补齐（不联网）', () =>
  app.includes('function libPrefetchInfo(recs)') && app.includes('window.api.info.local(') &&
  app.includes('const want = [];') && app.includes('state.libInfoAsked'));
t('在线四档排序已接进 applyLibSort', () =>
  app.includes("online === 'downloads' || online === 'endorsements'") &&
  app.includes("online === 'newest' || online === 'updated'") &&
  app.includes('if (!fa) return 1;'));
t('paintLibHead 用 $$ 选按钮（单个 $ 没有 forEach）', () => {
  const i = app.indexOf('function paintLibHead(');
  if (i < 0) return 'paintLibHead 不见了';
  const body = app.slice(i, i + 2400);
  const bad = /(^|[^$])\$\('#(sortTabs|adultTabs) button'\)\s*\.forEach/.test(body);
  return !bad || '还在用单元素选择器选按钮';
});
t('$$ 助手对空容器容错', () => app.includes('const $$ = (s, r = document) => (r ? [...r.querySelectorAll(s)] : []);'));
t('合并档位的排序 / 成人 / 分类 / 标签委托走就地重画', () =>
  app.includes('if (merged) { renderBrowse(); return; }') &&
  app.includes("(state.lib.status || 'all') !== 'online'"));
t('功能断言：用户选过分类后，英文 value 能命中中文档案的记录', () => {
  state.lib.catSet = true;
  state.browse.category = 'Outfits';
  state.browse.facets = { categories: [{ value: 'Outfits', zh: '服装' }] };
  state.showBuiltin = true;
  const recs = [
    { key: 'a', kind: 'downloaded', modId: 1, categoryZh: '服装' },
    { key: 'b', kind: 'downloaded', modId: 2, categoryZh: '杂项' },
    { key: 'c', kind: 'downloaded', modId: 3 }
  ];
  const got = ctx.libFilterRecords(recs).map(r => r.key);
  state.browse.category = '';
  state.lib.catSet = false;
  return JSON.stringify(got) === JSON.stringify(['a']) || '实际 ' + JSON.stringify(got);
});
t('功能断言：上次会话带回来的分类不作用于合并档位（只有在线档位认）', () => {
  state.lib.catSet = false;
  state.browse.category = 'Outfits';
  state.browse.facets = { categories: [{ value: 'Outfits', zh: '服装' }] };
  const recs = [
    { key: 'a', kind: 'downloaded', modId: 1, categoryZh: '服装' },
    { key: 'b', kind: 'downloaded', modId: 2, categoryZh: '杂项' }
  ];
  const local = ctx.libFilterRecords(recs).map(r => r.key);
  state.lib.status = 'online';
  const online = ctx.libFilterRecords(recs.map(r => Object.assign({}, r, { kind: 'online' }))).map(r => r.key);
  state.lib.status = 'all';
  state.browse.category = '';
  return (JSON.stringify(local) === JSON.stringify(['a', 'b']) && JSON.stringify(online) === JSON.stringify(['a']))
    || 'local=' + JSON.stringify(local) + ' online=' + JSON.stringify(online);
});
t('功能断言：分类词表对不上时不过滤（不至于整页空）', () => {
  state.lib.catSet = true;
  state.browse.category = 'Outfits';
  state.browse.facets = null;
  const recs = [{ key: 'a', kind: 'downloaded', modId: 1, categoryZh: '服装' }];
  const got = ctx.libFilterRecords(recs).map(r => r.key);
  state.browse.category = '';
  state.lib.catSet = false;
  return JSON.stringify(got) === JSON.stringify(['a']) || '实际 ' + JSON.stringify(got);
});
t('功能断言：成人「隐藏」剔掉成人条目、「只看成人」只留成人', () => {
  const recs = [
    { key: 'a', kind: 'online', modId: 1, adult: true },
    { key: 'b', kind: 'online', modId: 2, adult: false }
  ];
  state.browse.adultMode = 'hide';
  const hide = ctx.libFilterRecords(recs).map(r => r.key);
  state.browse.adultMode = 'only';
  const only = ctx.libFilterRecords(recs).map(r => r.key);
  state.browse.adultMode = 'all';
  return (JSON.stringify(hide) === JSON.stringify(['b']) && JSON.stringify(only) === JSON.stringify(['a']))
    || 'hide=' + JSON.stringify(hide) + ' only=' + JSON.stringify(only);
});
t('功能断言：内置脚本记录一直在（不再跟 showBuiltin 走）', () => {
  const recs = [
    { key: 'a', kind: 'installed', modId: 1, builtin: true },
    { key: 'b', kind: 'installed', modId: 2 }
  ];
  const off = ctx.libFilterRecords(recs).map(r => r.key);
  state.showBuiltin = true;
  const on = ctx.libFilterRecords(recs).map(r => r.key);
  return (JSON.stringify(off) === JSON.stringify(['a', 'b']) && JSON.stringify(on) === JSON.stringify(['a', 'b']))
    || 'off=' + JSON.stringify(off) + ' on=' + JSON.stringify(on);
});
t('功能断言：状态档 unreg / linked 各自只留对应记录', () => {
  const recs = [
    { key: 'a', kind: 'installed', modId: 0 },
    { key: 'b', kind: 'installed', modId: 5, link: { modId: 5 } },
    { key: 'c', kind: 'installed', modId: 6 }
  ];
  state.lib.status = 'unreg';
  const unreg = ctx.libFilterRecords(recs).map(r => r.key);
  state.lib.status = 'linked';
  const linked = ctx.libFilterRecords(recs).map(r => r.key);
  state.lib.status = 'all';
  return (JSON.stringify(unreg) === JSON.stringify(['a']) && JSON.stringify(linked) === JSON.stringify(['b']))
    || 'unreg=' + JSON.stringify(unreg) + ' linked=' + JSON.stringify(linked);
});

﻿
// ---------------------------------------------------------------------------
// J. 首屏必须是「Mod 库」（2026-11-11 用户报「默认进入是这样，点别的界面再回来才正常」）
//    #p-installed 只是 renderInstalled() 的数据容器，它若带 .on，冷启动就显示老页面。
// ---------------------------------------------------------------------------
t('index.html：#p-installed 不带 .on（它只是数据容器）', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  return !html.includes('<div class="page on" id="p-installed">') || '#p-installed 还带着 .on，首屏会显示老「已安装」页';
});
t('index.html：#p-browse 带 .on（首屏默认页）', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  return html.includes('<div class="page on" id="p-browse">') || '#p-browse 没有 .on';
});
t('app.js：main() 里 refreshAll() 之后显式 switchPage(p-browse)', () => {
  const re = /await refreshAll\(\);\s*\r?\n\s*\/\/[^\n]*\r?\n\s*\/\/[^\n]*\r?\n\s*switchPage\('p-browse'\);/;
  return re.test(app) || 'main() 结尾没有把首屏切到 Mod 库';
});
t('app.js：老入口 p-installed 会被导向 p-browse 并把状态切到「已安装」', () => {
  const i = app.indexOf('function switchPage(');
  if (i < 0) return 'switchPage 不见了';
  const body = app.slice(i, i + 900);
  return (body.includes("if (id === 'p-installed')") && body.includes("setLibStatus('installed'") && body.includes("id = 'p-browse';"))
    || 'switchPage 里缺老入口重定向';
});

﻿
// ---------------------------------------------------------------------------
// K. 顶栏按「筛选 / 排序 / 操作」三段重排（2026-11-11 用户要求）
//    上一版是把节点在 JS 里搬来搬去（compactLibHead），现在直接写死在 HTML 里，
//    顺序固定、不依赖运行时搬迁。
// ---------------------------------------------------------------------------
t('index.html：#browseHead 按「状态 / 信息 / 排序 / 操作」分行，状态与标记共用一行', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const i = html.indexOf('id="browseHead"');
  const j = html.indexOf('id="browseArea"');
  if (i < 0 || j <= i) return '找不到 #browseHead / #browseArea';
  const seg = html.slice(i, j);
  const secs = (seg.match(/class="sect"/g) || []).length;
  const need = (t) => seg.includes('>' + t + '<');
  return (secs === 4 && need('状态') && need('标记') && need('信息') && need('排序') && need('操作'))
    || '顶栏段数不对：' + secs;
});
t('index.html：控件归属正确（状态+标记 / 信息 / 排序 / 操作）', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const i = html.indexOf('id="browseHead"');
  const j = html.indexOf('id="browseArea"');
  const seg = html.slice(i, j);
  const parts = seg.split('class="sect"');
  const need = (s, id) => s.indexOf('id="' + id + '"') >= 0;
  const s0 = parts[1] || '', s1 = parts[2] || '', s2 = parts[3] || '', s3 = parts[4] || '';
  return (need(s0, 'libStatus') && need(s0, 'libMarks')
    && need(s1, 'browseFilters') && need(s1, 'adultTabs')
    && need(s2, 'sortTabs') && need(s2, 'libSortTabs')
    && need(s3, 'batchBar') && need(s3, 'batchMarks')) || '控件没落在对应的段里';
});
t('顶部控件外观统一：.tabs 按钮 / 分类 chip / 小按钮同高同圆角（用户 2026-11-11）', () => {
  const css = fs.readFileSync('src/renderer/style.css', 'utf8');
  const i = css.indexOf('顶部控件外观统一');
  if (i < 0) return '缺统一样式段';
  const seg = css.slice(i);
  return (seg.includes('.bhead .tabs button,') && seg.includes('.bhead .filters .fc,')
    && seg.includes('.bhead .btn.sm{') && seg.includes('height:24px')
    && seg.includes('border-radius:7px') && seg.includes('font-size:11.5px'))
    || '统一样式没覆盖到三类控件';
});
t('app.js：不再用 compactLibHead 搬节点（写死在 HTML 里了）', () =>
  !app.includes('function compactLibHead(') || '还在运行时搬节点');
t('style.css：分段样式 .sect / .slabel / .sline 齐全', () => {
  const css = fs.readFileSync('src/renderer/style.css', 'utf8');
  return (/\.sect\{/.test(css) && /\.slabel\{/.test(css) && /\.sline\{/.test(css))
    || '缺三段样式';
});
t('成人三档的文档委托必须用 $$（用 $ 会在单元素上调 forEach 抛错 —— 2026-11-11 踩过「模式改了界面不重画」）', () => {
  const i = app.indexOf("closest('button[data-adult]')");
  if (i < 0) return "找不到成人档委托";
  const seg = app.slice(i, i + 900);
  if (!seg.includes("$$('#adultTabs button, #browseFilters button[data-adult]')")) return "委托里没用 " + D;
  return !seg.includes('    $(\'#adultTabs') || "还在用单元素 $";
});
t('启动恢复筛选后：合并档位就地重画，只有在线档位才回 Nexus', () =>
  /applyLastFilters\(\)[\s\S]{0,600}renderBrowse\(\); else loadBrowse\(true\)/.test(app)
    || 'applyLastFilters 之后没有按档位分流重画');
// ---------------------------------------------------------------------------
// L. 布局收拾（2026-11-11 用户点出两处重复/错位）
//    ① 「全部类型」下拉与下面的分类 chip 重复 → 删掉下拉；
//    ② 「在浏览器中打开 Nexus」挪到顶栏，和「启动游戏」并列。
// ---------------------------------------------------------------------------
t('index.html：顶栏有 #btnOpenSite，且它就排在 #btnLaunch 后面', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const a = html.indexOf('id="btnLaunch"');
  const b = html.indexOf('id="btnOpenSite"');
  if (a < 0 || b < 0) return '顶栏缺 btnLaunch 或 btnOpenSite';
  if (b < a) return 'btnOpenSite 跑到 btnLaunch 前面了';
  const between = html.slice(a, b);
  return between.indexOf('</button>') >= 0 || 'btnOpenSite 挤在 btnLaunch 标签内部';
});
t('index.html：排序条里不再有 #btnOpenSite（已搬去顶栏）', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const i = html.indexOf('id="sortTabs"');
  if (i < 0) return 'sortTabs 不见了';
  const seg = html.slice(i, i + 900);
  return !/id="btnOpenSite"/.test(seg) || '排序条里还留着一颗 btnOpenSite';
});
t('app.js：顶栏那颗只在 Mod 库显示（switchPage 里按 p-browse 显隐）', () => {
  const i = app.indexOf('function switchPage(');
  const body = app.slice(i, i + 2200);
  return body.includes("$('#btnOpenSite')") && body.includes("(id === 'p-browse')") || 'switchPage 没管 btnOpenSite';
});
t('app.js：类型筛选的代码已清干净（没有 libKind / state.lib.kind 的残留判断）', () => {
  if (app.includes('libKindOptions')) return 'libKindOptions 还在';
  if (app.includes("state.lib.kind")) return 'state.lib.kind 还在';
  const i = app.indexOf('function libFilterRecords(');
  const body = app.slice(i, i + 2600);
  return !body.includes('libTypeOf(rec) !== kind') || '筛选里还在按 kind 过滤';
});

// ---------------------------------------------------------------------------
// M. 卡片重排 + 全站尺寸统一（2026-11-11 用户要求：信息别重复、别互相遮挡）
// ---------------------------------------------------------------------------
t('卡片：封面是纯图片，状态/标记/类型/文件数全部集中在顶端 .ctags（m10437 硬规则）', () => {
  const i2 = app.indexOf('function libCard(');
  const body = app.slice(i2, i2 + 5200);
  const tpl = body.indexOf('<div class="cover">');
  const cbody = body.indexOf('class="cbody"');
  if (tpl < 0 || cbody < 0) return '找不到封面模板';
  const cover = body.slice(tpl, cbody);
  if (cover.indexOf('class="lb ') >= 0) return '封面还压着状态徽标（盖住封面图）';
  if (/class="(tag|cat) /.test(cover)) return '封面里还有标签（应全部移到顶端标签行）';
  const tagPos = body.indexOf('class="ctags"');
  const h3Pos = body.indexOf('<h3 ');
  if (tagPos < 0 || h3Pos < 0) return '缺 .ctags 或标题';
  if (tagPos > h3Pos) return '标签行不在卡片顶端（应在标题之前）';
  if (body.indexOf('class="tag st ') < 0) return '标签行里缺状态那一颗';
  if (body.indexOf('本地已安装') >= 0) return '副标题还在兜底成「本地已安装」（和状态标签重复）';
  return true;
});
t('卡片：在线卡（browseCard）与 Mod 库卡（libCard）同一套排版', () => {
  const i2 = app.indexOf('function browseCard(');
  const body = app.slice(i2, i2 + 3200);
  const tpl = body.indexOf('<div class="cover">');
  const cbody = body.indexOf('class="cbody"');
  if (tpl < 0 || cbody < 0) return '在线卡找不到封面模板';
  if (/class="(lb|tag|cat) /.test(body.slice(tpl, cbody))) return '在线卡封面里还有标签';
  const tagPos = body.indexOf('class="ctags"');
  const h3Pos = body.indexOf('<h3 ');
  if (tagPos < 0 || h3Pos < 0 || tagPos > h3Pos) return '在线卡标签行不在顶端';
  return true;
});
t('style.css：标签行 / 操作行一律允许换行，不裁切不重叠；按钮压到卡片底部', () => {
  const s = fs.readFileSync('src/renderer/style.css', 'utf8');
  const ctags = (s.match(/\.card \.ctags\{[^}]*\}/g) || []).pop() || '';
  const acts = (s.match(/\.card \.acts\{[^}]*\}/g) || []).pop() || '';
  if (!/flex-wrap:wrap/.test(ctags)) return '.ctags 没有允许换行';
  if (!/flex-wrap:wrap/.test(acts) || !/margin-top:auto/.test(acts)) return '.acts 没换行或没压到底部';
  if (!/\.sline\{flex-wrap:wrap/.test(s)) return '顶部筛选条还在横向裁切';
  if (!/\.grp\{display:inline-flex/.test(s)) return '标签和它的 chips 没有绑定成组';
  return true;
});
t('卡片：元信息只用「·」分隔的一行文字（不再套 chip）', () => {
  const i = app.indexOf('function libCard(');
  const body = app.slice(i, i + 4600);
  return (body.indexOf('<span class="sep">·</span>') >= 0 && body.indexOf('class="meta"') >= 0)
    || '元信息没改成「·」分隔';
});
t('style.css：.ctags / .meta 单行 / .acts 单独一行 + 统一按钮高度 24', () => {
  const s = fs.readFileSync('src/renderer/style.css', 'utf8');
  const ok = /\.card \.ctags\{/.test(s) && /\.card \.meta\{/.test(s)
    && /\.card \.acts\{/.test(s) && /\.card \.acts \.btn\{height:24px/.test(s);
  return ok || '卡片样式不全';
});
t('style.css：筛选区 chip 与按钮统一 22px、段标签固定 40px', () => {
  const s = fs.readFileSync('src/renderer/style.css', 'utf8');
  return (/\.sline \.tabs button[^{]*\{[^}]*height:22px/.test(s) && /\.slabel\{flex:0 0 40px/.test(s))
    || '筛选区尺寸没统一';
});
  t('「排除」后面的数字是「排掉几个」，不是剩下的数量', () => {
    if (!app.includes('const cnt = hit;')) return '排除态数字口径不对';
    if (/length\s*-\s*hit/.test(app)) return '还残留「总数 − 命中」的反向算法';
    return true;
  });

t('样式里有「排除态」的视觉区分（.ex）', () => {
  const s = fs.readFileSync('src/renderer/style.css', 'utf8');
  return /\.tabs\.libmarks button\.ex\{/.test(s) || '排除态没有样式';
});

// ---------------------------------------------------------------------------
console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) {
  console.log('\n失败项：');
  fails.forEach((f) => console.log('- ' + f));
  process.exit(1);
}
