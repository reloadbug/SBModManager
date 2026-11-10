#!/usr/bin/env node
/*
 * 已安装页「多选 / 全选 / 筛选 / 批量启停删除」自检（2026-11-07，用户要求
 * 「已安装的mod也要支持全选多选筛选等功能，与查看在线mod一致，方便批量删除，关闭mod」）。
 *
 * 分两类：
 *   A. **能真跑的**：把 app.js 里那个纯函数 `installedGroupMatches()` 抠出来，
 *      配一份假 state 直接调用 —— 筛选口径（启用/关闭/部分/未登记/已关联/类型/关键词）
 *      是这套功能里唯一有判断逻辑的地方，钉死它比看代码可靠。
 *   B. **静态断言**：勾选标记、多选函数、批量动作用的是哪几个 IPC、点击委托的**顺序**
 *      （拦截必须排在 `data-gtoggle` 之前，否则多选模式里点开关会真把 Mod 关掉）、
 *      CSS 复用、i18n 词条齐不齐。
 *
 * 跑法：node _probe/instbatch-test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src/renderer/app.js');
const CSS = path.join(ROOT, 'src/renderer/style.css');
const KEYS = path.join(__dirname, 'i18n-keys.json');
const LOCALES = path.join(ROOT, 'src/renderer/locales');

let pass = 0;
let fail = 0;
const fails = [];
function t(label, fn) {
  let r;
  try { r = fn(); } catch (e) { r = '抛异常：' + e.message; }
  if (r === true) { pass++; }
  else { fail++; fails.push(label + ' → ' + r); }
}
function eq(a, b, label) { t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)); }

const app = fs.readFileSync(APP, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');
const keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));

/* ============ A. 筛选口径（真跑纯函数） ============ */
function matcherFactory() {
  const m = app.match(/function installedGroupMatches\(g\) \{[\s\S]*?\n\}/);
  if (!m) return null;
  // 造一个闭包：函数体里只引用 state.instFilters
  const make = new Function('state', m[0] + '\nreturn installedGroupMatches;');
  // 2026-11-10：state 里多了 bugIds（「有 bug」标记），筛选要能用上
  return (filters, bugIds) => make({ instFilters: filters, bugIds: new Set(bugIds || []) });
}
const mkMatch = matcherFactory();
t('installedGroupMatches 能从 app.js 抠出来', () => (mkMatch ? true : '没找到函数体'));

// 一个「已安装、已启用、Nexus 登记过」的分组
const gReg = {
  key: 'mod:4104', modId: 4104, name: 'Bayonetta 04 Outfit replacer', kind: 'pak',
  enabled: true, partial: false, registered: true, builtin: false, linked: false,
  items: [], meta: { name: 'Bayonetta 04 Outfit replacer', author: 'SealionTTV', source: { modId: 4104 } }
};
// 关闭的、未登记、靠批量解析认出来的分组
const gLinked = {
  key: 'one:disk:paks:xxx', modId: 0, name: 'Devil_cns_651', kind: 'cns',
  enabled: false, partial: false, registered: false, builtin: false, linked: true,
  items: [], meta: { source: { modId: 3047, author: 'terasossa5013', summary: 'x' } }
};
// 内置脚本（UE4SS 自带）
const gBuiltin = {
  key: 'one:disk:script:Keybinds', modId: 0, name: 'Keybinds', kind: 'script',
  enabled: true, partial: false, registered: false, builtin: true, linked: false,
  items: [], meta: {}
};
// 部分启用
const gPartial = {
  key: 'mod:3008', modId: 3008, name: 'Project Snow Rabbit', kind: 'cns',
  enabled: true, partial: true, registered: true, builtin: false, linked: false,
  items: [], meta: { source: { modId: 3008 } }
};

if (mkMatch) {
  const none = { q: '', state: '', kind: '' };
  t('无筛选时全部通过', () => (mkMatch(none)(gReg) && mkMatch(none)(gBuiltin) && mkMatch(none)(gPartial) ? true : '被错误过滤'));
  t('关键词匹配名字（大小写不敏感）', () => (mkMatch({ q: 'bayonetta', state: '', kind: '' })(gReg) ? true : '没匹配到'));
  t('关键词匹配 Mod ID（带不带 # 都行）', () => (
    mkMatch({ q: '4104', state: '', kind: '' })(gReg) && mkMatch({ q: '#4104', state: '', kind: '' })(gReg) ? true : 'Mod ID 没匹配'));
  t('关键词匹配作者（meta.source.author 也算）', () => (mkMatch({ q: 'terasossa', state: '', kind: '' })(gLinked) ? true : '作者没匹配'));
  t('关键词不匹配时被过滤', () => (mkMatch({ q: 'zzz', state: '', kind: '' })(gReg) ? '不该留下' : true));
  t('已启用：部分启用的不算「已启用」', () => (
    mkMatch({ q: '', state: 'on', kind: '' })(gReg) === true && mkMatch({ q: '', state: 'on', kind: '' })(gPartial) === false ? true : '判定不对'));
  t('已关闭：只留全关的', () => (
    mkMatch({ q: '', state: 'off', kind: '' })(gLinked) === true && mkMatch({ q: '', state: 'off', kind: '' })(gReg) === false ? true : '判定不对'));
  t('部分启用：只留 partial', () => (
    mkMatch({ q: '', state: 'partial', kind: '' })(gPartial) === true && mkMatch({ q: '', state: 'partial', kind: '' })(gReg) === false ? true : '判定不对'));
  t('未登记：排除已登记与内置', () => (
    mkMatch({ q: '', state: 'unreg', kind: '' })(gLinked) === true
    && mkMatch({ q: '', state: 'unreg', kind: '' })(gReg) === false
    && mkMatch({ q: '', state: 'unreg', kind: '' })(gBuiltin) === false ? true : '判定不对'));
  t('已关联：只留「靠解析认出来的」，已登记的也算不到这档', () => (
    mkMatch({ q: '', state: 'linked', kind: '' })(gLinked) === true
    && mkMatch({ q: '', state: 'linked', kind: '' })(gReg) === false ? true : '判定不对'));
  t('类型筛选命中 / 不命中', () => (
    mkMatch({ q: '', state: '', kind: 'pak' })(gReg) === true
    && mkMatch({ q: '', state: '', kind: 'script' })(gReg) === false ? true : '判定不对'));
  t('条件可叠加（关键词 + 状态 + 类型）', () => (
    mkMatch({ q: 'bayonetta', state: 'on', kind: 'pak' })(gReg) === true
    && mkMatch({ q: 'bayonetta', state: 'off', kind: 'pak' })(gReg) === false ? true : '叠加不对'));
  t('关键词首尾空格不影响匹配', () => (mkMatch({ q: '  bayonetta  ', state: '', kind: '' })(gReg) ? true : '没修剪'));

  // —— 「有 bug」筛选（2026-11-10 用户要求：顶部要能筛出有 bug 的，也要能不含）——
  const gBug = { key: 'mod:4110', modId: 4110, name: 'Bayonetta Bayonetta', kind: 'pak', enabled: true,
    partial: false, registered: true, builtin: false, linked: false, items: [], meta: { source: { modId: 4110 } } };
  t('bug=only 只留标记过有 bug 的', () => (
    mkMatch({ q: '', state: '', kind: '', bug: 'only' }, ['4110'])(gBug) === true
    && mkMatch({ q: '', state: '', kind: '', bug: 'only' }, ['4110'])(gReg) === false ? true : '判定不对'));
  t('bug=none 把标记过的藏起来', () => (
    mkMatch({ q: '', state: '', kind: '', bug: 'none' }, ['4110'])(gBug) === false
    && mkMatch({ q: '', state: '', kind: '', bug: 'none' }, ['4110'])(gReg) === true ? true : '判定不对'));
  t('bug 留空时不影响任何分组', () => (
    mkMatch({ q: '', state: '', kind: '', bug: '' }, ['4110'])(gBug) === true
    && mkMatch({ q: '', state: '', kind: '' }, ['4110'])(gReg) === true ? true : '空值反而筛掉了'));
  t('bug 筛选能跟关键词 / 状态叠加', () => (
    mkMatch({ q: 'bayonetta', state: 'on', kind: '', bug: 'none' }, ['4110'])(gBug) === false
    && mkMatch({ q: 'bayonetta', state: 'on', kind: '', bug: 'none' }, ['4110'])(gReg) === true ? true : '叠加不对'));
  t('bugIds 缺失时不炸（只筛「有 bug」会筛空）', () => (
    mkMatch({ q: '', state: '', kind: '', bug: 'only' })(gBug) === false
    && mkMatch({ q: '', state: '', kind: '', bug: 'none' })(gBug) === true ? true : '缺 bugIds 时行为异常'));
  t('没有 modId 的本地分组永远不算有 bug', () => (
    mkMatch({ q: '', state: '', kind: '', bug: 'none' }, ['0', ''])(gBuiltin) === true ? true : '本地文件被误判'));
}

/* ============ B. 静态接线 ============ */
// —— 状态 ——
t('state 里有独立的 gsel（与浏览页 sel 分开）', () =>
  (/gsel: \{ on: false, busy: false, ids: new Set\(\), anchor: null \}/.test(app) ? true : '缺 gsel'));
t('state 里有 instFilters（q / state / kind / bug）', () =>
  (app.includes("instFilters: { q: '', state: '', kind: '', bug: '' }") ? true : '缺 instFilters'));
t('state 里有 installedShown（全选只看当前显示的）', () =>
  (/installedShown: \[\]/.test(app) ? true : '缺 installedShown'));

// —— 卡片勾选 ——
t('installedCard 里有勾选标记（data-gck + gsel.ids.has(g.key)）', () => (
  /class="ck\$\{state\.gsel\.ids\.has\(g\.key\) \? ' on' : ''\}" data-gck="\$\{esc\(g\.key\)\}"/.test(app)
    ? true : '缺勾选标记'));
t('勾选用的是分组键 g.key（不是 modId）', () =>
  (/data-gck="\$\{esc\(g\.key\)\}"/.test(app) ? true : '勾选键不对'));

// —— 筛选条 / 多选条 ——
t('筛选条含搜索框 #instSearch / 状态 chip / 类型下拉 #instKind', () => (
  /id="instSearch"/.test(app) && /data-istate=/.test(app) && /id="instKind"/.test(app) ? true : '筛选条元素不全'));
t('状态 chip 共 6 档（全部/已启用/已关闭/部分启用/未登记/已关联）', () => {
  const m = app.match(/const INST_STATE_FILTERS = \[([\s\S]*?)\n\];/);
  if (!m) return '缺 INST_STATE_FILTERS';
  const vs = [...m[1].matchAll(/v: '([^']*)'/g)].map(x => x[1]);
  return JSON.stringify(vs) === JSON.stringify(['', 'on', 'off', 'partial', 'unreg', 'linked']) ? true : '档位是 ' + JSON.stringify(vs);
});
t('多选条按钮齐全（多选/全选/批量启用/批量关闭/批量删除）', () =>
  (['data-gbatch-mode', 'data-gbatch-all', 'data-gbatch-on', 'data-gbatch-off', 'data-gbatch-del']
    .every(a => app.includes(a)) ? true : '有按钮缺失'));
t('类型下拉的选项来自当前列表里真实出现的类型', () =>
  (/for \(const g of state\.installedGroups \|\| \[\]\) \{\s*\n\s*if \(g\.kind && !seen\.includes\(g\.kind\)\)/.test(app)
    ? true : '选项没按实际类型生成'));

// —— 多选函数 ——
t('多选函数齐全', () => (['function gselToggle(', 'function gselSelectAll(', 'function gselSyncCard(',
  'function gselSyncAll(', 'function gselSetMode(', 'function gselUpdateBar(', 'function gselVisibleKeys(',
  'function gselSelected(', 'function syncSelBodyClass('].every(s => app.includes(s)) ? true : '有函数缺失'));
t('全选只作用于筛选后可见的分组', () =>
  (/const keys = gselVisibleKeys\(\);/.test(app) ? true : '全选没走 gselVisibleKeys'));
t('body.sel 由两页共用（浏览页 / 已安装页任一进多选就点亮）', () =>
  (/document\.body\.classList\.toggle\('sel', !!\(state\.sel\.on \|\| state\.gsel\.on\)\)/.test(app) ? true : 'body.sel 没合并'));
t('浏览页的 selSetMode 也改走 syncSelBodyClass（否则会互相熄灭）', () => {
  const i = app.indexOf('function selSetMode(');
  if (i < 0) return '缺 selSetMode';
  return /syncSelBodyClass\(\);/.test(app.slice(i, i + 220)) ? true : '还在直接 toggle';
});
t('gselUpdateBar 只重画多选那一排（replaceWith #instBatch）', () =>
  (/#installedArea #instBatch/.test(app) && /host\.replaceWith\(next\)/.test(app) ? true : '重画方式不对'));

// —— 批量动作 ——
t('批量启停：跳过前置组件、跳过已处于目标状态的文件、逐条调 mods.setEnabled', () =>
  (/if \(m\.kind === 'prereq'\) continue;/.test(app)
    && /if \(!!m\.enabled === !!target\) continue;/.test(app)
    && /window\.api\.mods\.setEnabled\(m\.id, !!target\)/.test(app) ? true : '批量启停实现不全'));
t('批量删除：走 mods.uninstall + purge:false（移进 backup，不真删）', () =>
  (/window\.api\.mods\.uninstall\(m\.id, \{ purge: false \}\)/.test(app) ? true : '卸载调用不对'));
t('批量删除：内置组件剔除，并告诉用户还有几个没动', () =>
  (/const usable = groups\.filter\(g => !g\.builtin\);/.test(app)
    && /内置组件不能卸载，请取消勾选后再试/.test(app) ? true : '内置组件没拦'));
t('两个批量动作都有 busy 守卫（防连点）', () => (
  (app.match(/if \(state\.gsel\.busy\) return;/g) || []).length >= 2 ? true : '缺 busy 守卫'));
t('批量动作结束后清空勾选并刷新', () => (
  (app.match(/state\.gsel\.ids\.clear\(\);/g) || []).length >= 2 ? true : '没清勾选'));

// —— 点击委托的顺序（最容易写错的地方）——
t('多选拦截排在 data-gtoggle 分支之前', () => {
  const inter = app.indexOf('if (state.gsel.on) {');
  const gt = app.indexOf("t.closest('[data-gtoggle]')");
  if (inter < 0) return '缺多选拦截';
  if (gt < 0) return '找不到 data-gtoggle 分支';
  return inter < gt ? true : `拦截在第 ${inter} 字符、gtoggle 在第 ${gt} 字符 —— 顺序反了`;
});
t('多选模式里点卡片 = 勾选（拦在落点判断之前，点开关也不会真关掉）', () =>
  (/const card = t\.closest\('\.card\[data-gid\]'\);\s*\n\s*if \(card\) \{ gselClick\(card\.dataset\.gid, e\); return; \}/.test(app)
    ? true : '拦截逻辑不对'));
t('批量/筛选的委托分支都挂在主点击委托里', () => (['data-gbatch-mode', 'data-gbatch-all', 'data-gbatch-on',
  'data-gbatch-off', 'data-gbatch-del', 'data-istate', 'data-iclear'].every(a =>
  new RegExp(`t\\.closest\\('\\[${a}\\]'\\)`).test(app)) ? true : '有分支缺失'));
t('清空筛选按钮把四个条件一起复位', () =>
  (app.includes("state.instFilters = { q: '', state: '', kind: '', bug: '' };") ? true : '清空不彻底'));
t('关键词输入走委托，且输入过程中**不重画**（只就地过滤）', () => {
  if (!/e\.target\.id !== 'instSearch'/.test(app)) return '没接委托';
  const seg = app.slice(app.indexOf("e.target.id !== 'instSearch'"), app.indexOf("e.target.id !== 'instSearch'") + 320);
  if (!/applyInstSearch\(\)/.test(seg)) return '输入后没调 applyInstSearch';
  if (/renderInstalled\(\)/.test(seg)) return '输入过程中仍然整页重画（会丢输入框）';
  return true;
});
t('输入处理里不再有「重画后补光标」那套（说明已经不靠重画了）', () =>
  (/setSelectionRange\(n, n\)/.test(app) ? '旧的重画补光标代码还在' : true));
t('类型下拉走 change 委托', () =>
  (/if \(e\.target\.id === 'instKind'\) \{/.test(app) ? true : '缺 instKind 的 change 分支'));

// —— renderInstalled / 就地筛选 ——
t('renderInstalled 排序作用在全部分组上（筛选不参与重画）', () =>
  (/const sorted = state\.installedGroups\s*\n\s*\.slice\(\)\s*\n\s*\.sort\(/.test(app)
    ? true : '没接上排序'));
t('applyInstSearch 只切 class，不重建 DOM，并记下 installedShown', () =>
  (/function applyInstSearch\(\) \{[\s\S]*?card\.classList\.toggle\('inst-hid', !hit\);[\s\S]*?state\.installedShown = shown;/.test(app)
    ? true : '就地筛选没接上'));
t('applyInstSearch 里不含 innerHTML（一旦重建就等于白改）', () => {
  const i = app.indexOf('function applyInstSearch()');
  const seg = app.slice(i, i + 1400);
  return /innerHTML/.test(seg) ? 'applyInstSearch 里还在重建 DOM' : true;
});
t('工具栏同时挂上筛选条与多选条', () =>
  (/\$\{installedFilterRowHtml\(\)\}\$\{sortBar\}\$\{installedBatchRowHtml\(\)\}/.test(app) ? true : '工具栏没挂全'));
t('筛选后重画会把勾选外观补回来（gselSyncAll）', () =>
  (/gselSyncAll\(\);/.test(app) ? true : '缺同步'));
t('空结果提示块始终存在、默认 hidden，由 applyInstSearch 显隐', () =>
  (/id="instEmpty" hidden/.test(app) && /empty\.hidden = shown\.length > 0/.test(app)
    && /没有符合筛选条件的 Mod/.test(app) && /data-iclear="1"/.test(app) ? true : '空结果没兜住'));
t('副标题在筛选时注明「筛选自 N 项」', () =>
  (/筛选自 \$\{total\} 项/.test(app) ? true : '副标题没说明'));
t('关键词也搜磁盘文件名 / nx 标识 / 类型', () =>
  (/m\.rel, m\.file, m\.tag \? 'nx' \+ m\.tag/.test(app) ? true : '搜索字段没扩展'));

// —— CSS ——
t('CSS 复用浏览页那套勾选框样式（body.sel .cover .ck）', () => (
  /body\.sel \.cover \.ck\{display:block\}/.test(css) && /body\.sel \.card\.sel\{/.test(css) ? true : '样式没复用'));
t('筛选条有独立样式（.sortgrp.ifilter）', () => {
  if (!/\.sortgrp\.ifilter\{/.test(css)) return '缺 .sortgrp.ifilter';
  return /\.sortgrp\.ifilter select\{/.test(css) ? true : '缺下拉框样式';
});
t('CSS 有 .card.inst-hid 的隐藏规则（就地筛选要用）', () =>
  (/\.card\.inst-hid\{display:none !important\}/.test(css) ? true : '缺 .card.inst-hid'));

/* 用户 2026-11-10（红框圈住工具条）：「红框里面的功能不随滚动条移动，一直保持在这里」。
   已安装页几百张卡，工具条一滚就没，改筛选得先滚回顶部。 */
t('已安装页工具条 .ibar 吸顶（sticky + 负 margin 与 top 成对）', () => {
  const m = css.match(/\.ibar\{[^}]*\}/);
  if (!m) return '没找到 .ibar 规则';
  const rule = m[0];
  if (!/position:sticky/.test(rule)) return '.ibar 没有 position:sticky';
  if (!/top:-16px/.test(rule)) return 'top 不是 -16px（要和 .body 的 16px padding 抵消）';
  if (!/margin:-16px -16px/.test(rule)) return '缺负 margin：sticky 约束的是 margin box，不抵消会留一条缝';
  if (!/background:var\(--bg\)/.test(rule)) return '没铺不透明底色，卡片会从条里透出来';
  return true;
});

// —— i18n ——
const NEW_KEYS = [
  '已关闭', '全部类型', '搜索已安装的 Mod（名字 / Mod ID / 作者）', '按类型筛选',
  '批量启用（%s）', '批量关闭（%s）', '批量删除（%s）',
  '没有符合筛选条件的 Mod', '换个关键词，或者把筛选清掉看看。', '清空筛选',
  '共 %s 项 · 筛选自 %s 项', '共 %s 项 · %s 个已启用（筛选自 %s 项）',
  '先勾选要处理的 Mod', '内置组件不能卸载，请取消勾选后再试',
  '已启用 %s 个 Mod', '已关闭 %s 个 Mod', '有 %s 个文件没能改过来',
  '已删除 %s 个 Mod', '有 %s 个文件没能删掉'
];
t('19 条新词条都在 keys.json 里', () => {
  const miss = NEW_KEYS.filter(k => !keys.includes(k));
  return miss.length ? '缺：' + miss.join(' / ') : true;
});
t('带数字的句子都登记成 %s 形状键（数字位不会漏翻）', () => {
  const shapes = NEW_KEYS.filter(k => k.includes('%s'));
  const bad = shapes.filter(k => !k.includes('%s'));
  if (bad.length) return '形状键写错：' + bad.join(' / ');
  return shapes.length >= 7 ? true : `形状键只有 ${shapes.length} 条，像漏登记`;
});
t('13 个语言包都补上了这 19 条', () => {
  const codes = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];
  const bad = [];
  for (const c of codes) {
    const f = path.join(LOCALES, c + '.js');
    if (!fs.existsSync(f)) { bad.push(c + '(缺文件)'); continue; }
    const src = fs.readFileSync(f, 'utf8');
    const miss = NEW_KEYS.filter(k => !src.includes(`'${k}':`));
    if (miss.length) bad.push(`${c} 缺 ${miss.length} 条`);
  }
  return bad.length ? bad.join('，') : true;
});

/* ---------- E. 开关改名规则（现在集中在 toggleName.js）真的能开能关 ---------- */

const TOGGLE = path.join(ROOT, 'src/main/toggleName.js');
const toggleName = require(TOGGLE);
const ipcSrc = fs.readFileSync(path.join(ROOT, 'src/main/ipc.js'), 'utf8');
const reconcileSrc = fs.readFileSync(path.join(ROOT, 'src/main/reconcile.js'), 'utf8');
const scannerSrc = fs.readFileSync(path.join(ROOT, 'src/main/scanner.js'), 'utf8');
const crashSrc = fs.readFileSync(path.join(ROOT, 'src/main/crashLog.js'), 'utf8');
const toggleSrc = fs.readFileSync(TOGGLE, 'utf8');

/**
 * 2026-11-10 用户连着报的三件事（批量关闭出错 / 关闭后又变回启用 / 开启了也开不回来）
 * 根都在「怎么判定开与关」上。所以这组断言直接跑真函数，不再靠读源码猜。
 */
t('pak 三件套：停用加后缀、启用去后缀（往返一致）', () => {
  const off = toggleName.renameStep('x.pak', false);
  const on = toggleName.renameStep('x.pak.disabled', true);
  if (!off.managed || off.next !== 'x.pak.disabled') return '停用没加 .disabled';
  if (!on.managed || on.next !== 'x.pak') return '启用没去掉 .disabled';
  return true;
});

t('已经关掉的 pak 仍算受管（否则永远开不回来）', () => {
  const r = toggleName.renameStep('x.ucas.disabled', true);
  return (r.managed && r.next === 'x.ucas') || '把 .ucas.disabled 当成不归我们管了';
});

t('CNS 换装索引：标记插在 .json 前面（不能是 .dekcns.json.disabled）', () => {
  const off = toggleName.renameStep('foo.dekcns.json', false);
  const on = toggleName.renameStep('foo.dekcns.disabled.json', true);
  if (off.next !== 'foo.dekcns.disabled.json') return '停用写法不对：' + off.next;
  if (on.next !== 'foo.dekcns.json') return '启用写法不对：' + on.next;
  return true;
});

t('裸 .dekcns / .dekani（老包）也能开关', () => {
  const a = toggleName.renameStep('foo.dekcns', false);
  const b = toggleName.renameStep('foo.dekcns', true);
  const c = toggleName.renameStep('bar.dekani.json', false);
  if (!a.managed || a.next !== 'foo.dekcns.disabled') return '裸 .dekcns 停用不对';
  if (!b.managed || b.next !== null) return '已经是开着的，不该再改';
  if (c.next !== 'bar.dekani.disabled.json') return '.dekani.json 停用不对';
  return true;
});

t('已经在目标状态时 next 为 null（不白改文件名）', () => {
  const a = toggleName.renameStep('x.pak', true);
  const b = toggleName.renameStep('x.pak.disabled', false);
  const c = toggleName.renameStep('foo.dekcns.disabled.json', false);
  return (a.next === null && b.next === null && c.next === null) || '目标状态还给了新名字';
});

t('不归我们管的文件 managed=false（文案/配置不该被改名）', () => {
  const bad = ['readme.txt', 'notes.lua', 'x.json'].filter((n) => toggleName.renameStep(n, false).managed);
  return bad.length === 0 || '误判为受管：' + bad.join(',');
});

t('isDisabledName 两种关闭写法都认，开着的名字不算关', () => {
  const yes = ['x.pak.disabled', 'x.ucas.disabled', 'foo.dekcns.disabled.json', 'foo.dekcns.disabled'];
  const no = ['x.pak', 'foo.dekcns.json', 'foo.dekani.json'];
  const bad = yes.filter((n) => !toggleName.isDisabledName(n)).concat(no.filter((n) => toggleName.isDisabledName(n)));
  return bad.length === 0 || '判错：' + bad.join(',');
});

t('stripDisabled 把关闭写法还原成开着的名字', () => {
  return (
    (toggleName.stripDisabled('x.pak.disabled') === 'x.pak' &&
      toggleName.stripDisabled('foo.dekcns.disabled.json') === 'foo.dekcns.json') ||
    '还原结果不对'
  );
});

t('counterpartName 正反都对得上（注册表名字和磁盘差一个后缀时要用它）', () => {
  const cases = [
    ['x.pak', 'x.pak.disabled'],
    ['x.pak.disabled', 'x.pak'],
    ['foo.dekcns.json', 'foo.dekcns.disabled.json'],
    ['foo.dekcns.disabled.json', 'foo.dekcns.json']
  ];
  const bad = cases.filter((p) => toggleName.counterpartName(p[0]) !== p[1]);
  return bad.length === 0 || '对不上：' + bad.map((p) => p[0]).join(',');
});

t('ipc 引用模块的 renameStep，自己不再留一份改名规则', () => {
  if (!ipcSrc.includes('const renameStep = toggleName.renameStep;')) return '没引用模块的 renameStep';
  if (ipcSrc.includes('const RENAMEABLE = ')) return 'ipc 里还留着自己那份 RENAMEABLE';
  if (ipcSrc.includes('const DATA_INDEX_ON')) return 'ipc 里还留着自己那份 DATA_INDEX_ON';
  if (ipcSrc.includes('function renameStep(')) return 'ipc 里还自己定义 renameStep';
  return true;
});

t('setEnabled 用注册表 manifest 的绝对路径改名（不再只拼 ~Mods）', () => {
  if (!ipcSrc.includes('manifest.map(x => x && x.path)')) return '没从 manifest 取绝对路径';
  return ipcSrc.includes('mod.meta.manifest') || '没读 mod.meta.manifest';
});

t('名字和磁盘差一个后缀时，去同目录找另一种写法（别再报找不到文件）', () => {
  if (!ipcSrc.includes('toggleName.counterpartName(')) return '没找另一种写法';
  if (!ipcSrc.includes('const fixed = [];')) return '没记录这类修正';
  return ipcSrc.includes('...fixed, ...renames') || '修正没并进 manifest 更新';
});

t('循环按 renameStep().managed 决定跳不跳', () => {
  return ipcSrc.includes('const step = renameStep(base, enabled);') && ipcSrc.includes('if (!step.managed) continue;')
    ? true
    : '缺 step.managed 判断';
});

t('改名后把注册表 manifest 也同步了（否则卸载会找不到文件）', () => {
  return ipcSrc.includes('registry.patch(id, { enabled, ...stamp, manifest: nextManifest })') || '没同步 manifest（或没带开关时间戳）';
});

t('返回值带上改了几个文件（renamed + fixed），前端能据此判断真动了磁盘', () => {
  return ipcSrc.includes('renamed: renames.length, fixed: fixed.length') || '返回值里没有 renamed/fixed';
});

t('磁盘上一个受管文件都找不到时报错，不假装成功', () => {
  return ipcSrc.includes('找不到这个 Mod 的文件') ? true : '没有兜底报错';
});

t('按磁盘核对（reconcile）用同一口径判「关着」，不会再把开关改回去', () => {
  if (!reconcileSrc.includes('toggleName.isDisabledName(')) return 'reconcile 还在自己判 .disabled';
  return reconcileSrc.includes("require('./toggleName')") || 'reconcile 没引入模块';
});

t('scanner 归组也用同一口径（关着的包不该变成看不见的幽灵）', () => {
  return scannerSrc.includes('toggleName.isDisabledName(name)') &&
    scannerSrc.includes('toggleName.stripDisabled(name)')
    ? true
    : 'scanner 没走模块';
});

t('崩溃诊断清点时也认 CNS 索引的关闭写法', () => {
  if (crashSrc.includes('DISABLED_EXT')) return 'crashLog 还留着自己那份 DISABLED_EXT';
  return crashSrc.includes('toggleName.') ? true : 'crashLog 没走模块';
});

t('模块注释写清「为什么不能加在 .json 后面」（DekCNS 子串匹配）', () => {
  return toggleSrc.includes('string.find(fileName, "dekcns.json")') ||
    '没注释 DekCNS 是子串匹配这个坑';
});

t('批量启停失败时把原因带出来，不只报个数', () => {
  if (!app.includes('const failedWhy = [];')) return '没收集失败原因';
  if (!app.includes('failedWhy.push(')) return '没有 push 原因';
  return app.includes('没改成功的原因：') || '没把原因弹给用户';
});


/* ============ B. 「有 bug」红色标识与顶部筛选（2026-11-10） ============ */
t('state 默认带 instFilters.bug', () =>
  (/instFilters: \{ q: '', state: '', kind: '', bug: '' \}/.test(app) ? true : '缺 bug 默认值'));
t('INST_BUG_FILTERS 有 only / none 两档', () => {
  const m = app.match(/const INST_BUG_FILTERS = \[([\s\S]*?)\n\];/);
  if (!m) return '缺 INST_BUG_FILTERS';
  const vs = [...m[1].matchAll(/v: '([^']*)'/g)].map(x => x[1]);
  return (vs.length === 2 && vs[0] === 'only' && vs[1] === 'none') ? true : '档位不对：' + vs.join(',');
});
t('筛选条里多了一组「有 bug」按钮（#instBug + data-ibug）', () => (
  /id="instBug"/.test(app) && /data-ibug=/.test(app) ? true : '缺筛选按钮'));
t('点「有 bug」再点一次会取消（互斥切换）', () => (
  /const ibug = t\.closest\('\[data-ibug\]'\);[\s\S]{0,200}state\.instFilters\.bug = \(state\.instFilters\.bug \|\| ''\) === v \? '' : v;/.test(app)
    ? true : '切换逻辑缺失'));
t('「清空筛选」也把 bug 清掉', () => (
  /state\.instFilters = \{ q: '', state: '', kind: '', bug: '' \};/.test(app) ? true : '清空时漏了 bug'));
t('installedIsBug() 只认 modId', () => (
  /function installedIsBug\(g\) \{[\s\S]{0,220}ids\.has\(String\(g\.modId\)\)/.test(app) ? true : '判定函数不对'));
t('已安装卡片带 hasbug 类（整卡红框）', () => (
  /class="card\$\{g\.enabled \? '' : ' off'\}\$\{isBug \? ' hasbug' : ''\}"/.test(app) ? true : '卡片没加 hasbug'));
t('在线列表卡片也标 bug（hasbug + 角标）', () => (
  /\$\{isBug \? ' hasbug' : ''\}/.test(app) && /const isBug = installedIsBug\(n\);/.test(app) ? true : '浏览卡没标'));
t('«有 bug» 角标是实心红（#e5342b），不再是橙', () => (
  /\.cover \.tag\.bug\{[^}]*background:#e5342b/.test(css) ? true : '角标还不是红的'));
t('.card.hasbug 有红边 + 封面内描边', () => (
  /\.card\.hasbug\{border-color:rgba\(229,52,43,\.55\)\}/.test(css)
    && /\.card\.hasbug \.cover\{box-shadow:inset 0 0 0 2px rgba\(229,52,43,\.5\)\}/.test(css) ? true : '缺红框样式'));
t('筛选按钮选中态是红的（.tabs#instBug button.on）', () => (
  /\.tabs#instBug button\.on\{[^}]*#ff6b60/.test(css) ? true : '缺选中态样式'));
t('新增的 4 个词条都在 keys.json 里', () => (
  ['有 bug', '不含 bug', '只看标记过「有 bug」的 Mod', '把标记过「有 bug」的 Mod 藏起来']
    .every(k => keys.includes(k)) ? true : '词条没登记全'));
/* ---------- 汇总 ---------- */
console.log('');
for (const f of fails) console.log('  ✗ ' + f);
console.log('='.repeat(56));
console.log(`instbatch：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(56));
if (fail) process.exitCode = 1;
