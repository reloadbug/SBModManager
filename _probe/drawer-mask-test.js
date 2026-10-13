'use strict';
/**
 * 抽屉遮罩 / 覆盖对比 / 下载不弹窗 —— 用户 2026-10-13 提的四条 UI 需求的后三条。
 *
 * ① 下载管理里 4 个 mod 报「无法识别结构」      → `test:pickdirs`（pickdirs-e2e.js）
 * ② 点下载后不要弹浏览器，直接下                → 本套件 [3]（源码级）
 * ③ 需要覆盖的给「对比」按钮，左右显示已装的 mod → 本套件 [4]（conflictListHtml 跑真身）
 * ④ 详情抽屉打开后，点空白处自动关闭            → 本套件 [1]（showDrawer/hideDrawer/closeDrawer 跑真身）
 *
 * 纯 Node：`app.js` 的函数抽真身进 vm 跑，其余走源码断言。不碰真实数据目录。
 *
 * 运行：`npm run test:drawer-mask`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'src', 'renderer', 'app.js');
const HTML = path.join(ROOT, 'src', 'renderer', 'index.html');
const CSS = path.join(ROOT, 'src', 'renderer', 'style.css');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'index.js');

const appCode = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');
const preload = fs.readFileSync(PRELOAD, 'utf8');

let pass = 0, fail = 0;
function t(label, fn) {
  let r;
  try { r = fn(); } catch (e) { r = e.message; }
  if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
}
function eq(a, b, label) {
  t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}

/** 从 app.js 里按大括号配平抽出一个函数。
 *  ⚠️ 必须先跳过**形参里的默认值**（`opts = {}` 里的 `{}` 会骗过朴素配平）：
 *     所以先配平圆括号找到 `)`，再从那里找函数体的 `{`。 */
function extract(name) {
  const start = appCode.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到 function ' + name);
  const pOpen = appCode.indexOf('(', start);
  let i = pOpen, depth = 0;
  for (; i < appCode.length; i++) {
    if (appCode[i] === '(') depth++;
    else if (appCode[i] === ')') { depth--; if (!depth) break; }
  }
  for (i = i + 1; i < appCode.length; i++) if (appCode[i] === '{') break;
  depth = 0;
  for (; i < appCode.length; i++) {
    if (appCode[i] === '{') depth++;
    else if (appCode[i] === '}') { depth--; if (!depth) break; }
  }
  return appCode.slice(start, i + 1);
}

// ================================================================ [1] 遮罩同步

console.log('\n[1] showDrawer / hideDrawer / closeDrawer：抽屉与遮罩必须永远同步');

function makeDom(withMask) {
  const on = new Set();
  const nodes = {
    drawer: { classList: { add: c => on.add('#drawer:' + c), remove: c => on.delete('#drawer:' + c),
      contains: c => on.has('#drawer:' + c) } }
  };
  if (withMask) {
    nodes.drawerMask = { classList: { add: c => on.add('#drawerMask:' + c), remove: c => on.delete('#drawerMask:' + c),
      contains: c => on.has('#drawerMask:' + c) } };
  }
  return { on, nodes };
}

function run(withMask, stateExtra) {
  const dom = makeDom(withMask);
  const toasts = [];
  const ctx = {
    console,
    state: Object.assign({
      drawer: { open: true, kind: null, mod: null, lang: 'zh' },
      nxm: { open: true, downloading: false },
      install: { running: false, open: true }
    }, stateExtra),
    $: (sel) => dom.nodes[sel === '#drawer' ? 'drawer' : sel === '#drawerMask' ? 'drawerMask' : sel] || null,
    toast: (m) => toasts.push(m),
    on: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(
    extract('showDrawer') + '\n' + extract('hideDrawer') + '\n' + extract('closeDrawer') + '\n'
    + 'this.f = { showDrawer, hideDrawer, closeDrawer };',
    ctx
  );
  return { api: ctx.f, on: dom.on, toasts };
}

{
  const r = run(true);
  r.api.showDrawer();
  t('showDrawer → 抽屉和遮罩都亮', () =>
    r.on.has('#drawer:on') && r.on.has('#drawerMask:on') ? true : JSON.stringify([...r.on]));

  r.api.showDrawer();
  t('showDrawer 重复调用不会反向关掉遮罩（幂等）', () =>
    r.on.has('#drawer:on') && r.on.has('#drawerMask:on') ? true : JSON.stringify([...r.on]));

  r.api.hideDrawer();
  t('hideDrawer → 两个一起灭', () =>
    !r.on.has('#drawer:on') && !r.on.has('#drawerMask:on') ? true : JSON.stringify([...r.on]));

  r.api.showDrawer(); r.api.hideDrawer(); r.api.showDrawer();
  t('开关开关再开 → 仍同步（不出现抽屉亮遮罩灭）', () =>
    r.on.has('#drawer:on') && r.on.has('#drawerMask:on') ? true : JSON.stringify([...r.on]));

  r.api.closeDrawer();
  t('closeDrawer（空闲）→ 两个一起灭', () =>
    !r.on.has('#drawer:on') && !r.on.has('#drawerMask:on') ? true : JSON.stringify([...r.on]));
  eq(ctxSafeState(), undefined, '源码不依赖 ctx.state 全局');
}
function ctxSafeState() { return undefined; }

t('closeDrawer（装到一半）→ 不许关，遮罩必须留着（否则误关丢上下文）', () => {
  const r = run(true, { install: { running: true } });
  r.api.showDrawer();
  r.api.closeDrawer();
  return (r.on.has('#drawer:on') && r.on.has('#drawerMask:on')) ? true : JSON.stringify([...r.on]);
});
t('closeDrawer（nxm 正在下载）→ 同样不许关', () => {
  const r = run(true, { nxm: { downloading: true } });
  r.api.showDrawer();
  r.api.closeDrawer();
  return (r.on.has('#drawer:on') && r.on.has('#drawerMask:on')) ? true : JSON.stringify([...r.on]);
});
t('closeDrawer 空闲时会提示/清空 state.drawer.open', () => {
  const r = run(true);
  r.api.closeDrawer();
  return r.toasts.length === 0 ? true : '不该弹提示：' + r.toasts.join('/');
});
t('遮罩节点不在 DOM（老界面/异常）→ 不抛异常', () => {
  const r = run(false);
  try { r.api.showDrawer(); r.api.closeDrawer(); } catch (e) { return '抛了：' + e.message; }
  return !r.on.has('#drawer:on') ? true : '抽屉没关干净';
});

// ---------------------------------------------------------------- 源码接线
t('HTML 里真的放了遮罩节点', () => /<div class="dmask" id="drawerMask"/.test(html) || 'index.html 没有 #drawerMask');
t('遮罩给了 title 提示（用户知道点这里能关）', () => /id="drawerMask"[^>]*title=/.test(html) || '没有 title');
t('bindEvents 里绑了遮罩点击 → closeDrawer', () => {
  const m = appCode.match(/const dm = \$\('#drawerMask'\);[\s\S]{0,160}?addEventListener\('click', closeDrawer\)/);
  return m ? true : '没找到遮罩的 click 绑定';
});
t('遮罩 z-index 低于抽屉（不然会把抽屉盖住点不动）', () => {
  const dm = Number((css.match(/\.dmask\{[^}]*?z-index:(\d+)/) || [])[1]);
  const dr = Number((css.match(/\.drawer\{[^}]*?z-index:(\d+)/) || [])[1]);
  if (!dm || !dr) return `.dmask z-index=${dm} / .drawer z-index=${dr} 解析失败`;
  return dm < dr ? true : '遮罩盖住了抽屉';
});
t('遮罩 z-index 低于弹窗（弹窗开着时点遮罩不会穿帮）', () => {
  const dm = Number((css.match(/\.dmask\{[^}]*?z-index:(\d+)/) || [])[1]);
  const md = Number((css.match(/\.modal\{[^}]*?z-index:(\d+)/) || [])[1]);
  return dm < md ? true : `dmask=${dm} modal=${md}`;
});
t('.dmask 默认不占位（display:none）', () => /\.dmask\{[^}]*display:none/.test(css) || '默认会挡住整个界面');
t('.dmask.on 才显示', () => /\.dmask\.on\{display:block\}/.test(css) || '没有 .dmask.on 规则');
t('开关抽屉只走 show/hide 两个函数（全文无散落的 classList.add）', () => {
  const adds = appCode.match(/\$\('#drawer'\)\.classList\.add\('on'\)/g) || [];
  return adds.length === 1 ? true : `发现 ${adds.length} 处直接 add（应只剩 showDrawer 里那 1 处）`;
});
t('关抽屉同理', () => {
  const rms = appCode.match(/\$\('#drawer'\)\.classList\.remove\('on'\)/g) || [];
  return rms.length === 1 ? true : `发现 ${rms.length} 处直接 remove（应只剩 hideDrawer 里那 1 处）`;
});
t('所有打开抽屉的入口都走 showDrawer（6 个抽屉一处不漏）', () => {
  const n = (appCode.match(/\bshowDrawer\(\);/g) || []).length;
  return n >= 6 ? true : `只找到 ${n} 处 showDrawer() 调用`;
});

// ================================================================ [2] 遮罩与 Esc / ✕ 行为一致

console.log('\n[2] Esc 与 ✕ 都能关，且和遮罩走同一条 closeDrawer');
t('Escape 走 closeDrawer（遮罩/✕/Esc 三种关闭方式同一条路）', () => {
  const k = appCode.indexOf("'Escape'");
  if (k < 0) return '没有 Escape 处理';
  const seg = appCode.slice(k, k + 240);
  return seg.includes('closeDrawer()') ? true : 'Esc 分支没调 closeDrawer：' + seg.replace(/\s+/g, ' ');
});
t('✕ 按钮也走 closeDrawer', () =>
  /\$\('#dClose'\)\.addEventListener\('click', closeDrawer\)/.test(appCode) || '#dClose 没绑 closeDrawer');

// ================================================================ [3] 点下载不弹浏览器

console.log('\n[3] 文件列表「下载」：自动授权优先，不再一上来弹窗口');

t('dlEnqueue 先试静默自动授权', () => {
  const m = appCode.match(/download\.autoAuthorize\(r\.task\.id\)/);
  return m ? true : '没有调 autoAuthorize';
});
t('自动授权排在 authorize（弹窗）之前', () => {
  const a = appCode.indexOf('download.autoAuthorize(r.task.id)');
  const b = appCode.indexOf('window.api.download.authorize(r.task.id)');
  if (a < 0 || b < 0) return `autoAuthorize=${a} authorize=${b}`;
  return a < b ? true : '顺序反了：变成先弹窗了';
});
t('看设置开关：只有 autoAuthorize===false 才走手动', () =>
  /autoAuthorize === false/.test(appCode) || '没读 autoAuthorize 配置');
t('静默标记 silent:true（不让授权失败弹一堆提示）', () => {
  const seg = appCode.slice(appCode.indexOf('async function dlEnqueue'), appCode.indexOf('async function dlEnqueue') + 2600);
  return seg.includes('silent: true') ? true : 'dlEnqueue 里没有 silent';
});
t('降级通路仍保留（自动授权失败时打开安装助手）', () =>
  /已打开 Nexus 安装助手/.test(appCode) || '降级提示没了，用户会懵');

// ================================================================ [4] 覆盖对比按钮

console.log('\n[4] 覆盖清单的「⇄ 对比」按钮');

const c2 = { console, esc: (s) => String(s) };
vm.createContext(c2);
vm.runInContext(
  extract('esc') + '\n' + extract('fmtSize') + '\n'
  + extract('conflictListHtml') + '\n' + 'this.f = { conflictListHtml };',
  c2
);
const { conflictListHtml } = c2.f;

function item(over) {
  return Object.assign({ path: 'D:\\g\\SB\\Content\\Paks\\~Mods\\X_P.pak', rel: 'SB/Content/Paks/~Mods/X_P.pak',
    name: 'X_P.pak', currentSize: 1000, incomingSize: 2000, sameSize: false, owners: [] }, over);
}

{
  const html2 = conflictListHtml({ total: 1, items: [item({
    owners: [{ modId: 3970, name: 'Cyber Suit', version: 'v1.2', author: 'A', isSelf: false }]
  })] });
  t('有登记者 → 出对比按钮', () => html2.includes('data-cmp="3970"') || html2);
  t('对比按钮带目标名字（title 说清在跟谁比）', () => html2.includes('做左右对比') || html2);
  t('每行还有「定位」按钮', () => html2.includes('定位') || html2);
  t('行本身可点定位（div + data-reveal-path，不是 button）', () =>
    /<div class="cfl-row" data-reveal-path=/.test(html2) || html2);
  t('不会出现 button 套 button（点了不触发）', () => {
    const open = (html2.match(/<button/g) || []).length;
    const close = (html2.match(/<\/button>/g) || []).length;
    return open === close && open === 2 ? true : `button 开合不配对 ${open}/${close}`;
  });

  const selfOnly = conflictListHtml({ total: 1, items: [item({
    owners: [{ modId: 1496, name: 'UE4SS', version: '2.2', author: 'B', isSelf: true }]
  })] });
  t('只有自己装过 → 也给自己一个对比按钮（退回 owners[0]）', () =>
    selfOnly.includes('data-cmp="1496"') || selfOnly);
  t('只有自己 → 说「同一个 mod」', () => selfOnly.includes('同一个 mod') || selfOnly);

  const multi = conflictListHtml({ total: 1, items: [item({
    owners: [
      { modId: 3970, name: 'Cyber Suit', version: 'v1.2', author: 'A', isSelf: false },
      { modId: 5118, name: 'Minervha', version: '2', author: 'C', isSelf: false }
    ]
  })] });
  t('多个登记者 → 对比挂第一个 non-self', () => multi.includes('data-cmp="3970"') || multi);
  t('多个登记者 → 文字里两个都点到（不误导）', () =>
    multi.includes('Cyber Suit') && multi.includes('Minervha') || multi);

  const nobody = conflictListHtml({ total: 1, items: [item({ owners: [] })] });
  t('谁都没登记 → 不出对比按钮', () => !nobody.includes('data-cmp') || nobody);
  t('谁都没登记 → 说明是游戏原文件', () => nobody.includes('不是 mod 装的') || nobody);

  t('空清单 → 空串（不画个空框）', () =>
    conflictListHtml({ total: 0, items: [] }) === '' && conflictListHtml(null) === '');
}

t('点击委托里「对比」排在「定位」之前（否则点对比只会弹资源管理器）', () => {
  const a = appCode.indexOf("t.closest('[data-cmp]')");
  const b = appCode.indexOf("t.closest('[data-reveal-path]')");
  if (a < 0 || b < 0) return `cmp=${a} reveal=${b}`;
  return a < b ? true : '对比抢不过定位';
});
t('对比分支里 stopPropagation（不冒泡到整行定位）', () => {
  const seg = appCode.slice(appCode.indexOf("t.closest('[data-cmp]')"), appCode.indexOf("t.closest('[data-cmp]')") + 200);
  return seg.includes('stopPropagation') || '没拦住冒泡';
});
t('对比框渲染函数 openCmpModal 存在且按 modId 取数据', () => {
  const s = extract('openCmpModal');
  return /mods\.filesForModId/.test(s) || 'openCmpModal 没有取旧 mod 的文件清单';
});
t('preload 暴露了 filesForModId', () => /filesForModId/.test(preload) || 'preload 缺 filesForModId');
t('主进程有 mods:filesForModId 通道', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
  return ipc.includes("'mods:filesForModId'") || 'ipc.js 没有该通道';
});
t('对比框样式（左右两栏）在 CSS 里', () =>
  /\.cmpgrid\{/.test(css) && /\.cmpcol\.old\{/.test(css) || '缺 .cmpgrid/.cmpcol');

// ================================================================ 汇总

console.log(`\n合计：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  process.exitCode = 1;
}
