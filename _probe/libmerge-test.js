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


﻿  /* ---------- G. 「已验证」标记（用户 2026-11-10） ---------- */
  t('标记 chip 里有「已验证」和「未验证」两颗', () =>
    app.includes("{ k: 'verified', label: '✓ 已验证', tone: 'ver' }") && app.includes("{ k: 'unverified', label: '未验证', tone: 'dim' }"));
  t('libMarkSet 认 verified', () => app.includes("if (k === 'verified') return state.verifiedIds;"));
  t('libHasMark 里「未验证」= 已否定的已验证', () => app.includes("if (k === 'unverified') return !libHasMark(rec, 'verified');"));
  t('筛选按已验证剔 / 留两个方向', () =>
    app.includes("if (marks.verified && !libHasMark(rec, 'verified')) return false;") &&
    app.includes("if (marks.unverified && libHasMark(rec, 'verified')) return false;"));
  t('已验证 / 未验证 两颗 chip 互斥', () =>
    app.includes("if (k === 'verified' && state.lib.marks.verified) state.lib.marks.unverified = false;") &&
    app.includes("if (k === 'unverified' && state.lib.marks.unverified) state.lib.marks.verified = false;"));
  t('卡片上有「标记已验证」按钮（data-libver）', () =>
    app.includes('data-libver="${rec.modId}"') && app.includes("${isVer ? '✓ 已验证' : '标记已验证'}"));
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
  'this.libHasMark=libHasMark; this.libKindOptions=libKindOptions;' +
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
t('类型下拉给全了档位（含「全部类型」）', () => {
  const opts = ctx.libKindOptions();
  return opts.length >= 6 && opts[0].v === '' && opts.some((o) => o.v === 'cns') && opts.some((o) => o.v === 'installed' || o.v === 'prereq');
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
  state.lib.marks.bug = true;
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 1 && shown[0].modId === 200;
});
t('标记「不感兴趣」→ 只留黑名单里的', () => {
  const recs = three();
  state.browse.blocked = new Set(['100']);
  state.lib.marks.blocked = true;
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
t('标记 chip 有四档（喜欢 / 不感兴趣 / 有 bug / 不含 bug）', () => {
  const ks = ctx.LIB_MARK_CHIPS.map((c) => c.k);
  return ks.includes('liked') && ks.includes('blocked') && ks.includes('bug') && ks.includes('nobug');
});

t('「有 bug」红、「不含 bug」绿（tone 标记 + CSS 都在）', () => {
  const bad = ctx.LIB_MARK_CHIPS.find((c) => c.k === 'bug');
  const good = ctx.LIB_MARK_CHIPS.find((c) => c.k === 'nobug');
  return bad.tone === 'bad' && good.tone === 'good' &&
    /\.tabs\.libmarks button\.tone-bad\.on/.test(css) && /\.tabs\.libmarks button\.tone-good\.on/.test(css);
});
t('「不含 bug」把标过的剔掉（不是只看标过的）', () => {
  const recs = three();
  state.bugIds = new Set(['200']);
  state.lib.marks.nobug = true;
  const shown = ctx.libFilterRecords(recs);
  return shown.length === 2 && !shown.some((r) => r.modId === 200);
});
t('「有 bug」与「不含 bug」互斥（点亮一个就关掉另一个）', () =>
  app.includes("if (k === 'bug' && state.lib.marks.bug) state.lib.marks.nobug = false;") &&
  app.includes("if (k === 'nobug' && state.lib.marks.nobug) state.lib.marks.bug = false;"));
t('没标过的记录「不含 bug」为真、标过的为假', () => {
  const recs = three();
  state.bugIds = new Set(['100']);
  const r100 = recs.find((r) => r.modId === 100);
  const r200 = recs.find((r) => r.modId === 200);
  return ctx.libHasMark(r100, 'nobug') === false && ctx.libHasMark(r200, 'nobug') === true;
});
// ---------------------------------------------------------------------------
console.log('\n=== F. 接线：一套界面、一套多选、一套批量 ===');
t('index.html 有状态行（#libStatus）、类型下拉（#libKind）、标记筛选（#libMarks）', () =>
  /id="libStatus"/.test(html) && /id="libKind"/.test(html) && /id="libMarks"/.test(html));
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

// ---------------------------------------------------------------------------
console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) {
  console.log('\n失败项：');
  fails.forEach((f) => console.log('- ' + f));
  process.exit(1);
}
