#!/usr/bin/env node
/*
 * 「有 bug」标记自检（2026-11-09）。
 *
 * 用户要求（原话）：
 *   「卸载mod的位置增加一个有bug点按钮，用于标记有问题的mod避免再次安装时影响游戏，
 *     批量安装时提示包含有bug的mod，是否全部跳过」
 *
 * 分四段：
 *   A. **主进程模块真跑** —— `createBugFlags()` 用临时文件测增删查、幂等、非法 id；
 *   B. **跟随游戏走** —— `paths.STATE_NAMES` 里有 `bugs.json`、`paths.bugsFile` 落在数据目录；
 *   C. **确认框真跑** —— 把 `confirmBugMarked()` 从 app.js 抠出来，
 *      配假的 `state.bugIds` / `openModal`，验证「没有标记就直装」「有标记就弹窗」
 *      以及三个按钮各自返回什么（跳过 / 全装 / 取消）；
 *   D. **接线静态断言** —— 角标、抽屉按钮、点击委托、三个安装入口的调用点、CSS。
 *
 * 跑法：node _probe/bugflag-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src/renderer/app.js');
const CSS = path.join(ROOT, 'src/renderer/style.css');
const IPC = path.join(ROOT, 'src/main/ipc.js');
const PRELOAD = path.join(ROOT, 'src/preload/index.js');
const PATHS = path.join(ROOT, 'src/main/paths.js');

const { createBugFlags } = require('../src/main/bugFlag');
const paths = require('../src/main/paths');

const TMP = path.join(os.tmpdir(), 'sb-bugflag-test');
const FILE = path.join(TMP, 'bugs.json');

let pass = 0;
let fail = 0;
const fails = [];
function t(label, fn) {
  let r;
  try { r = fn(); } catch (e) { r = '抛异常：' + e.message; }
  if (r === true) { pass++; }
  else { fail++; fails.push(label + ' → ' + r); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

function reset() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 沙箱守卫 */ }
  fs.mkdirSync(TMP, { recursive: true });
}

// 工作区 app.js 是 CRLF，先归一成 LF 再匹配（否则写死的 `\n` 永远匹配不上）
const app = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(CSS, 'utf8');
const ipc = fs.readFileSync(IPC, 'utf8');
const preload = fs.readFileSync(PRELOAD, 'utf8');

/** 把 app.js 里的 `confirmBugMarked()` 抠出来真跑 */
function confirmFactory() {
  const m = app.match(/function confirmBugMarked\(items\) \{[\s\S]*?\n\}/);
  if (!m) return null;
  // bugSkipCtx 是模块级变量，这里在闭包里重新声明一份，等价于真实作用域
  return new Function('state', 'esc', 'openModal', `
    let bugSkipCtx = null;
    ${m[0]}
    return { confirm: confirmBugMarked, ctx: () => bugSkipCtx };
  `);
}

async function main() {
  // ===================================================== A. 主进程模块
  console.log('\n[1] createBugFlags：增删查 + 幂等 + 持久化');
  reset();
  {
    const bf = createBugFlags(FILE);
    eq(bf.count(), 0, '初始为空');
    eq(bf.has(4102), false, '空名单里 has() = false');
    eq(bf.ids().length, 0, 'ids() 空数组');

    const e1 = bf.add(4102, { name: 'Jeanne Suit No Feathers' });
    eq(e1.modId, 4102, 'add 返回记录，modId 正确');
    eq(bf.count(), 1, '加入后 count = 1');
    eq(bf.has(4102), true, 'has() = true');
    eq(bf.has('4102'), true, '字符串形式的 modId 也认得（渲染层传过来就是字符串）');
    eq(bf.ids()[0], 4102, 'ids() 里是**数字**（渲染层建 Set 时要 String 一下）');
    eq(bf.get(4102).name, 'Jeanne Suit No Feathers', '存下了 name（提示弹窗要显示）');

    // 幂等：再标一次不该产生第二条，也不该把「什么时候标的」改掉
    const at1 = bf.get(4102).at;
    const e2 = bf.add(4102, { name: 'Jeanne Suit（改名）' });
    eq(bf.count(), 1, '重复标记不产生第二条');
    eq(e2.at, at1, '重复标记不改 at');
    eq(bf.get(4102).name, 'Jeanne Suit（改名）', '但说明可以更新');

    eq(bf.add(0), null, 'add(0) 返回 null（没有 modId 就标记不了）');
    eq(bf.add('abc'), null, 'add(非数字) 返回 null');
    eq(bf.count(), 1, '非法 id 不写进名单');

    // 落盘：新实例能读回来
    const bf2 = createBugFlags(FILE);
    eq(bf2.count(), 1, '换一个实例从文件读回 1 条');
    eq(bf2.has(4102), true, '读回来的记录认得 4102');

    bf2.add(221, { name: 'Crimson Wings' });
    eq(bf2.count(), 2, '可以标第二个');
    eq(bf2.all()[0].modId, 221, 'all() 最近标的排前面');

    eq(bf.remove(9999), null, '移出不在名单里的 id 返回 null，不抛');
    const rm = bf2.remove(4102);
    eq(rm.modId, 4102, 'remove 返回被移除的记录');
    eq(bf2.count(), 1, '移除后 count = 1');
    eq(bf2.has(4102), false, '移除后 has() = false');

    eq(bf2.clear(), 1, 'clear() 返回清掉了多少条');
    eq(bf2.count(), 0, 'clear() 之后为空');
    eq(createBugFlags(FILE).count(), 0, '清空也落盘了');
  }

  // ===================================================== B. 跟着游戏走
  console.log('\n[2] paths：bugs.json 属于状态文件（跟着游戏走）');
  eq(paths.STATE_NAMES.includes('bugs.json'), true, 'STATE_NAMES 里有 bugs.json（会镜像进 <游戏根>\\.sbmod）');
  eq(path.basename(paths.bugsFile), 'bugs.json', 'paths.bugsFile 指向 bugs.json');
  eq(path.dirname(paths.bugsFile), paths.DATA, 'bugsFile 在数据目录里（数据目录可切到游戏目录）');

  // ===================================================== C. 确认框真跑
  console.log('\n[3] confirmBugMarked：没有标记直装，有标记才弹窗');
  const make = confirmFactory();
  t('confirmBugMarked 能从 app.js 抠出来', () => (make ? true : '没找到函数体'));
  if (make) {
    const items = [
      { modId: 221, name: 'Crimson Wings' },
      { modId: 4102, name: 'Jeanne Suit' },
      { modId: 4109, name: 'Nikke Cinderella' }
    ];
    // 没有标记：直接放行，且不弹窗
    {
      let modal = null;
      const api = make({ bugIds: new Set() }, s => String(s), (...a) => { modal = a; });
      const out = await api.confirm(items);
      eq(Array.isArray(out) && out.length, 3, '没有标记时原样返回全部');
      eq(modal, null, '没有标记时不弹窗');
      eq(api.ctx(), null, '没有标记时不留下挂起上下文');
    }
    // 有标记：弹窗，且挂起上下文
    {
      let modal = null;
      const api = make({ bugIds: new Set(['4102']) }, s => String(s), (...a) => { modal = a; });
      const p = api.confirm(items);
      t('有标记时弹出确认框', () => (modal ? true : '没有调用 openModal'));
      if (modal) {
        eq(modal[0], '这批里有标过「有 bug」的 Mod', '标题说清是什么事');
        eq(modal[1].includes('Jeanne Suit'), true, '正文点名了那个 Mod');
        eq(modal[1].includes('里面这 1 个你之前标记过'), true, '正文里带命中条数（单文本节点，便于翻译）');
        eq(modal[2].map(b => b.id).join(','), 'bugSkipAll,bugKeepAll,bugCancel', '三个按钮：跳过 / 全装 / 取消');
        eq(modal[2][0].primary, true, '「跳过」是主按钮（默认建议动作）');
      }
      const ctx = api.ctx();
      t('有标记时留下挂起上下文', () => (ctx && typeof ctx.onSkip === 'function' ? true : 'ctx 不对'));
      ctx.onSkip();
      const out = await p;
      eq(out.length, 2, '「全部跳过」返回剩下的 2 个');
      eq(out.some(x => x.modId === 4102), false, '被标记的那个不在结果里');
    }
    // 「仍然全部安装」
    {
      const api = make({ bugIds: new Set(['4102', '4109']) }, s => String(s), () => {});
      const p = api.confirm(items);
      api.ctx().onAll();
      const out = await p;
      eq(out.length, 3, '「仍然全部安装」原样返回 3 个');
    }
    // 「取消」
    {
      const api = make({ bugIds: new Set(['221']) }, s => String(s), () => {});
      const p = api.confirm(items);
      api.ctx().onCancel();
      eq(await p, null, '「取消」返回 null（调用方据此什么都不做）');
    }
    // 全部都被标记
    {
      const api = make({ bugIds: new Set(['221', '4102', '4109']) }, s => String(s), () => {});
      const p = api.confirm(items);
      api.ctx().onSkip();
      eq((await p).length, 0, '全被标记时「跳过」返回空列表');
    }
  }

  // ===================================================== D. 接线与外观
  console.log('\n[4] 接线：通道 / 角标 / 抽屉按钮 / 三个安装入口 / CSS');
  t('ipc 有 bugs:list / ids / add / remove', () => (
    ["handle('bugs:list'", "handle('bugs:ids'", "handle('bugs:add'", "handle('bugs:remove'"]
      .every(s => ipc.includes(s)) ? true : '缺通道'));
  t('ipc 用 paths.bugsFile 建 bugFlags', () => (
    ipc.includes('bugFlags = createBugFlags(paths.bugsFile);') ? true : '没接上 bugFlag'));
  t('preload 暴露 window.api.bugs 四个方法', () => (
    /bugs: \{[\s\S]*?ids: \(\) => invoke\('bugs:ids'\)[\s\S]*?add: \(modId, meta\) => invoke\('bugs:add'/.test(preload)
      ? true : 'preload 缺 bugs 组'));
  t('state 里有 bugIds', () => (app.includes('bugIds: new Set()') ? true : '状态里没有 bugIds'));
  t('loadBugs() 存在且在启动流程里被调用', () => (
    app.includes('async function loadBugs()') && app.includes('await loadBugs();') ? true : '没加载'));
  t('loadBugs 读 window.api.bugs.ids()', () => (
    /loadBugs[\s\S]{0,400}window\.api\.bugs\.ids\(\)/.test(app) ? true : '没走 IPC'));
  t('卡片有「⚠ 有 bug」角标', () => (
    app.includes('class="tag bug"') && app.includes('⚠ 有 bug') ? true : '卡片上没有角标'));
  t('角标只在 state.bugIds 命中时出现', () => (
    app.includes('state.bugIds.has(String(modId))') ? true : '没有按标记判断'));
  t('抽屉底部有 data-gbug 按钮', () => (
    app.includes('data-gbug="${esc(g.key)}"') && app.includes('⚠ 标为有 bug') ? true : '抽屉里没有按钮'));
  t('按钮只在有 Nexus modId 时出现', () => (
    app.includes('${srcModId ? `<button class="btn bug" data-gbug=') ? true : '没有按 srcModId 判定'));
  t('点击委托里有 data-gbug 分支', () => (
    app.includes("closest('[data-gbug]')") ? true : '点了没反应'));
  t('doBugToggleGroup 会调 add / remove 并重新载入', () => (
    app.includes('async function doBugToggleGroup(key)')
      && app.includes('window.api.bugs.add(') && app.includes('window.api.bugs.remove(')
      && /doBugToggleGroup[\s\S]{0,900}await loadBugs\(\);/.test(app) ? true : '切换逻辑不全'));
  t('单个安装（libInstall）先过 confirmBugMarked', () => (
    /async function libInstall\(modId\)[\s\S]{0,500}await confirmBugMarked\(\[it\]\)/.test(app)
      ? true : '单个安装没查标记'));
  t('批量安装（libBatchInstall）先过 confirmBugMarked', () => (
    /async function libBatchInstall\(\)[\s\S]{0,700}await confirmBugMarked\(picked\)/.test(app)
      ? true : '批量安装没查标记'));
  t('全部安装（libInstallAll）先过 confirmBugMarked', () => (
    /async function libInstallAll\(\)[\s\S]{0,700}await confirmBugMarked\(all\)/.test(app)
      ? true : '全部安装没查标记'));
  t('确认框在置 busy 标志之前（取消不会锁死按钮）', () => (
    /const list = await confirmBugMarked\(all\);\n  if \(!list\) return;\n  if \(!list\.length\)[\s\S]{0,200}libInstallRunning = true;/.test(app)
      ? true : '标志顺序不对'));
  t('弹窗三个按钮都有处理分支', () => (
    app.includes("id === 'bugSkipAll' || id === 'bugKeepAll' || id === 'bugCancel'")
      && app.includes('c.onSkip()') && app.includes('c.onAll()') && app.includes('c.onCancel()')
      ? true : '按钮没接线'));
  t('markup 里用了 esc() 转义名字', () => (
    app.includes('esc(names)') ? true : '名字没转义'));
  t('CSS 有 .cover .tag.bug', () => (css.includes('.cover .tag.bug{') ? true : '没有角标样式'));
  t('CSS 有 .btn.bug', () => (css.includes('.btn.bug{') ? true : '没有按钮样式'));

  // ===================================================== 汇总
  reset();
  console.log('');
  if (fail) {
    console.log('❌ bugflag: ' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('\n失败项：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ bugflag: ' + pass + ' 通过 / 0 失败');
}

main().catch(e => {
  console.error('套件本身崩了：', e);
  process.exit(1);
});
