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
  return (filters) => make({ instFilters: filters });
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
}

/* ============ B. 静态接线 ============ */
// —— 状态 ——
t('state 里有独立的 gsel（与浏览页 sel 分开）', () =>
  (/gsel: \{ on: false, busy: false, ids: new Set\(\) \}/.test(app) ? true : '缺 gsel'));
t('state 里有 instFilters（q / state / kind）', () =>
  (/instFilters: \{ q: '', state: '', kind: '' \}/.test(app) ? true : '缺 instFilters'));
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
  (/const card = t\.closest\('\.card\[data-gid\]'\);\s*\n\s*if \(card\) \{ gselToggle\(card\.dataset\.gid\); return; \}/.test(app)
    ? true : '拦截逻辑不对'));
t('批量/筛选的委托分支都挂在主点击委托里', () => (['data-gbatch-mode', 'data-gbatch-all', 'data-gbatch-on',
  'data-gbatch-off', 'data-gbatch-del', 'data-istate', 'data-iclear'].every(a =>
  new RegExp(`t\\.closest\\('\\[${a}\\]'\\)`).test(app)) ? true : '有分支缺失'));
t('清空筛选按钮把三个条件一起复位', () =>
  (/state\.instFilters = \{ q: '', state: '', kind: '' \};/.test(app) ? true : '清空不彻底'));
t('关键词输入走委托 + 重画后把焦点与光标还回去', () =>
  (/e\.target\.id !== 'instSearch'/.test(app) && /el\.setSelectionRange\(n, n\)/.test(app) ? true : '输入框会丢焦点'));
t('类型下拉走 change 委托', () =>
  (/if \(e\.target\.id === 'instKind'\) \{/.test(app) ? true : '缺 instKind 的 change 分支'));

// —— renderInstalled ——
t('renderInstalled 先分组再筛选，并记下 installedShown', () =>
  (/const shown = state\.installedGroups\.filter\(installedGroupMatches\);/.test(app)
    && /state\.installedShown = shown;/.test(app) ? true : '没接上筛选'));
t('工具栏同时挂上筛选条与多选条', () =>
  (/\$\{installedFilterRowHtml\(\)\}\$\{sortBar\}\$\{installedBatchRowHtml\(\)\}/.test(app) ? true : '工具栏没挂全'));
t('筛选后重画会把勾选外观补回来（gselSyncAll）', () =>
  (/gselSyncAll\(\);/.test(app) ? true : '缺同步'));
t('结果为空时给「没有符合筛选条件的 Mod」+ 清空筛选', () =>
  (/没有符合筛选条件的 Mod/.test(app) && /data-iclear="1"/.test(app) ? true : '空结果没兜住'));
t('副标题在筛选时注明「筛选自 N 项」', () =>
  (/筛选自 \$\{state\.installedGroups\.length\} 项/.test(app) ? true : '副标题没说明'));

// —— CSS ——
t('CSS 复用浏览页那套勾选框样式（body.sel .cover .ck）', () => (
  /body\.sel \.cover \.ck\{display:block\}/.test(css) && /body\.sel \.card\.sel\{/.test(css) ? true : '样式没复用'));
t('筛选条有独立样式（.sortgrp.ifilter）', () => {
  if (!/\.sortgrp\.ifilter\{/.test(css)) return '缺 .sortgrp.ifilter';
  return /\.sortgrp\.ifilter select\{/.test(css) ? true : '缺下拉框样式';
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

/* ---------- E. 批量启停真的落到磁盘上（setEnabled 的改名范围） ---------- */

const IPC = path.join(ROOT, 'src/main/ipc.js');

function setEnabledSrc() {
  const s = fs.readFileSync(IPC, 'utf8');
  const i = s.indexOf('function setEnabled(');
  const j = s.indexOf('function toggleScriptMod(');
  if (i < 0 || j < 0) throw new Error('没找到 setEnabled');
  return s.slice(i, j);
}

t('setEnabled 用注册表 manifest 的绝对路径来改名（不再只拼 ~Mods）', () => {
  const s = setEnabledSrc();
  if (!/mod\.meta\.manifest/.test(s)) return '没读 mod.meta.manifest';
  const ok = /manifest\.map\(x => x && x\.path\)/.test(s);
  return ok || '没有从 manifest 取 path';
});

t('只重命名 pak 三件套，`.dekcns.json` 这类数据文件不碰', () => {
  const s = setEnabledSrc();
  if (!/const RENAMEABLE = \/\\\.\(pak\|ucas\|utoc\)\$\/i;/.test(s)) return 'RENAMEABLE 正则不对';
  const guard = /if \(!RENAMEABLE\.test\(from\.replace\(\/\\\.disabled\$\/i, ''\)\)\) continue;/.test(s);
  return guard || '缺少非三件套的跳过判断';
});

t('改名后把注册表 manifest 也同步了（否则卸载会找不到文件）', () => {
  const s = setEnabledSrc();
  const ok = /registry\.patch\(id, \{ enabled, manifest: nextManifest \}\)/.test(s);
  return ok || '没有 registry.patch(id, { enabled, manifest })';
});

t('磁盘上一个文件都找不到时报错，不假装成功', () => {
  const s = setEnabledSrc();
  if (!/found === 0/.test(s)) return '没有统计 found';
  const hasThrow = /throw new Error\(enabled\s*\?\s*'找不到这个 Mod 的文件/.test(s);
  return hasThrow || '没有在文件缺失时抛错';
});

t('已经在目标状态时不报错（只翻注册表开关）', () => {
  const s = setEnabledSrc();
  const ok = /else \{\s*registry\.setEnabled\(id, enabled\);\s*\}/.test(s.replace(/\r\n/g, '\n'));
  return ok || '缺少「已经到位」的分支';
});

t('返回值带上实际改名的文件数，前端可据此判断是否真的动了磁盘', () => {
  const s = setEnabledSrc();
  const ok = /return \{ id, enabled, renamed: renames\.length \}/.test(s);
  return ok || '返回值里没有 renamed';
});

/* ---------- 汇总 ---------- */
console.log('');
for (const f of fails) console.log('  ✗ ' + f);
console.log('='.repeat(56));
console.log(`instbatch：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(56));
if (fail) process.exitCode = 1;
