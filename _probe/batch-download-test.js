'use strict';
/**
 * 浏览页「多选 → 批量下载」的离线断言。
 *
 * 真身抽取：
 *   · `pickPrimaryFile` / `batchSummary`  纯函数，直接喂数据
 *   · `selToggle … selUpdateBar`          连续一段（互相调用），配 DOM 桩跑行为
 * 其余靠静态接线断言防回归。
 *
 * 关键风险点（这轮真实踩过的设计）：
 *   · 浏览列表 payload **不带文件信息** → 批量入队要逐个 mod 拉文件列表，挑第一个主文件钉 fileId
 *   · 批量只能 `download.enqueue`，**不能**走 `dlEnqueue`（后者会切页 + 逐个弹授权窗口）
 *   · 已安装的要跳过；文件列表取不到要退回「按整个 Mod 入队」而不是失败
 *
 * 跑法：node _probe/batch-download-test.js
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

/* ---------------- 纯函数 ---------------- */
const pure = {};
vm.createContext(pure);
// `batchSummary` 的结尾文案会跟随「自动授权」开关（state.config.autoAuthorize），
// 所以沙箱里必须有一个 state —— 测试还能改它来覆盖两种模式。
vm.runInContext(
  'var state = { config: {} };\n' +
  extract('pickPrimaryFile') + '\n' + extract('batchSummary') + '\n' +
  'this.state = state; this.pickPrimaryFile = pickPrimaryFile; this.batchSummary = batchSummary;',
  pure
);

console.log('=== pickPrimaryFile：第一个主文件怎么挑 ===');
t('primary 标记优先于排序位置', () => {
  const f = pure.pickPrimaryFile([
    { fileId: 1, categoryRaw: 'OPTIONAL' },
    { fileId: 2, categoryRaw: 'MAIN', primary: true }
  ]);
  return f && f.fileId === 2;
});
t('没有 primary 时取第一个 MAIN', () => {
  const f = pure.pickPrimaryFile([
    { fileId: 1, categoryRaw: 'UPDATE' },
    { fileId: 2, categoryRaw: 'MAIN' },
    { fileId: 3, categoryRaw: 'OPTIONAL' }
  ]);
  return f && f.fileId === 2;
});
t('后端已排序时直接拿第一个（主文件在最前）', () => {
  const f = pure.pickPrimaryFile([{ fileId: 9, categoryRaw: 'MAIN' }, { fileId: 8, categoryRaw: 'ARCHIVED' }]);
  return f && f.fileId === 9;
});
t('只有可选/归档文件也退回第一个，而不是返回 null', () => {
  const f = pure.pickPrimaryFile([{ fileId: 5, categoryRaw: 'ARCHIVED' }]);
  return f && f.fileId === 5;
});
t('空列表 / 非数组 → null', () => pure.pickPrimaryFile([]) === null && pure.pickPrimaryFile(null) === null && pure.pickPrimaryFile(undefined) === null);
t('列表里的 null 项被剔掉，不炸', () => {
  const f = pure.pickPrimaryFile([null, { fileId: 7, categoryRaw: 'MAIN' }]);
  return f && f.fileId === 7;
});

console.log('\n=== batchSummary：汇总口径 ===');
t('全部为 0 → 一句人话，不拼空串', () => pure.batchSummary({}) === '没有可加入的 Mod。');
t('有新增 → 报数 + 主文件口径', () => {
  const s = pure.batchSummary({ added: 3 });
  return (s.includes('已加入 3 个') && s.includes('主文件')) || s;
});
t('自动授权开着（默认）→ 说「已自动开始授权下载」', () => {
  pure.state.config = {};
  const s = pure.batchSummary({ added: 3 });
  return s.includes('已自动开始授权下载') || s;
});
t('手动模式 → 指引去点「全部自动授权」', () => {
  pure.state.config = { autoAuthorize: false };
  const s = pure.batchSummary({ added: 3 });
  pure.state.config = {};
  return s.includes('全部自动授权') || s;
});
t('手动模式下没有新增 → 不提授权', () => {
  pure.state.config = { autoAuthorize: false };
  const s = pure.batchSummary({ dup: 2 });
  pure.state.config = {};
  return !s.includes('授权') || s;
});
t('只有重复 → 不出现「已加入 0 个」，也不提授权', () => {
  const s = pure.batchSummary({ dup: 2 });
  return !s.includes('已加入') && s.includes('2 个已在队列里') && !s.includes('授权');
});
t('跳过已安装要报出来', () => pure.batchSummary({ added: 1, skipped: 4 }).includes('4 个已安装已跳过'));
t('取不到文件列表要说明是按整个 Mod 入队', () => pure.batchSummary({ added: 1, noFile: 2 }).includes('按整个 Mod 入队'));
t('失败数要报出来', () => pure.batchSummary({ added: 1, failed: 2 }).includes('2 个失败'));
t('多段用「，」连接', () => {
  const s = pure.batchSummary({ added: 1, dup: 1, skipped: 1, noFile: 1, failed: 1 });
  // 只数主句：末尾那句「已自动开始授权下载，进度见…」自带一个逗号，不该算进来
  const head = s.split('。')[0];
  return head.split('，').length === 5 || head;
});

/* ---------------- 选择逻辑（DOM 桩） ---------------- */
const selCode = (() => {
  const i = code.indexOf('function selToggle(');
  const j = code.indexOf('function renderBrowseFilters(');
  assert.ok(i >= 0 && j > i, '应能切出 selToggle…selUpdateBar 这一整段');
  return code.slice(i, j);
})();

/** 假卡片：记录 classList 变更，便于断言「选中外观跟着变」 */
function fakeCard(modid, log) {
  return {
    dataset: { modid: String(modid) },
    classList: { toggle(cls, on) { log.push([String(modid), cls, !!on]); } },
    querySelector: () => null
  };
}

const bodyCls = { sel: null };   // body.classList.toggle 的记录（注意 toggle 里的 this 指向 classList，不是 body）
const dom = { cards: [], els: {}, body: { classList: { toggle(cls, on) { bodyCls[cls] = !!on; } } } };
const ctx = {
  state: { sel: { on: false, all: false, busy: false, ids: new Set() }, browse: { items: [] } },
  $$: (s) => (s === '#browseArea .card' ? dom.cards : []),
  $: (s) => {
    if (!dom.els[s]) dom.els[s] = { textContent: '', style: {}, disabled: false, classList: { toggle() {} } };
    return dom.els[s];
  },
  document: { querySelector: () => null, body: dom.body },
  Set
};
vm.createContext(ctx);
vm.runInContext(
  selCode + '\nthis.selToggle=selToggle; this.selSelectAll=selSelectAll; this.selClear=selClear;' +
  'this.selSetMode=selSetMode; this.selUpdateBar=selUpdateBar;',
  ctx
);

function reset(ids = [], items = []) {
  ctx.state.sel = { on: false, all: false, busy: false, ids: new Set(ids) };
  ctx.state.browse.items = items;
  dom.cards = [];
  dom.els = {};
}

console.log('\n=== selToggle：勾选 / 取消 ===');
t('勾上一个 modId（字符串集合）', () => {
  reset();
  ctx.selToggle(740);
  return ctx.state.sel.ids.has('740') && ctx.state.sel.ids.size === 1;
});
t('再点一次取消', () => {
  reset(['740']);
  ctx.selToggle(740);
  return !ctx.state.sel.ids.has('740') && ctx.state.sel.ids.size === 0;
});
t('数字/字符串 modId 都归一（不产生两份）', () => {
  reset();
  ctx.selToggle(740); ctx.selToggle('740');
  return ctx.state.sel.ids.size === 0;
});
t('手动勾选会取消「全选」语义', () => {
  reset([], [{ modId: 1 }, { modId: 2 }]);
  ctx.state.sel.all = true;
  ctx.selToggle(1);
  return ctx.state.sel.all === false;
});

console.log('\n=== selSelectAll：全选 / 取消全选 ===');
t('全选当前已加载的项', () => {
  reset([], [{ modId: 1 }, { modId: 2 }, { modId: 3 }]);
  ctx.selSelectAll();
  return ctx.state.sel.ids.size === 3 && ctx.state.sel.all === true;
});
t('已经全选时再点 = 取消全选', () => {
  reset(['1', '2'], [{ modId: 1 }, { modId: 2 }]);
  ctx.selSelectAll();
  return ctx.state.sel.ids.size === 0 && ctx.state.sel.all === false;
});
t('列表为空时不置 all（避免后续卡片莫名全选）', () => {
  reset([], []);
  ctx.selSelectAll();
  return ctx.state.sel.ids.size === 0 && ctx.state.sel.all === false;
});
t('部分选中时点全选 = 补齐（不是取消）', () => {
  reset(['1'], [{ modId: 1 }, { modId: 2 }]);
  ctx.selSelectAll();
  return ctx.state.sel.ids.size === 2 && ctx.state.sel.all === true;
});
t('选中外观跟着状态变（卡片加 sel 类）', () => {
  const log = [];
  reset();
  dom.cards = [fakeCard(11, log), fakeCard(12, log)];
  ctx.state.browse.items = [{ modId: 11 }, { modId: 12 }];
  ctx.selSelectAll();
  return log.filter(x => x[1] === 'sel' && x[2] === true).length === 2;
});

console.log('\n=== selClear / selSetMode：清空与模式切换 ===');
t('selClear 清空选择与 all 标志', () => {
  reset(['1', '2'], [{ modId: 1 }]);
  ctx.state.sel.all = true;
  ctx.selClear();
  return ctx.state.sel.ids.size === 0 && ctx.state.sel.all === false;
});
t('退出多选模式时清空选择', () => {
  reset(['1'], []);
  ctx.state.sel.on = true;
  bodyCls.sel = null;
  ctx.selSetMode(false);
  return ctx.state.sel.on === false && ctx.state.sel.ids.size === 0 && bodyCls.sel === false;
});
t('进入多选模式给 body 挂 sel 类', () => {
  reset();
  bodyCls.sel = null;
  ctx.selSetMode(true);
  return ctx.state.sel.on === true && bodyCls.sel === true;
});

console.log('\n=== selUpdateBar：按钮文案 / 显隐 ===');
t('未进多选：模式按钮写「多选」，另两颗隐藏', () => {
  reset();
  ctx.selUpdateBar();
  return dom.els['#btnBatchMode'].textContent === '多选' &&
    dom.els['#btnSelectAll'].style.display === 'none' &&
    dom.els['#btnBatchDownload'].style.display === 'none';
});
t('多选中且没勾选：批量按钮 disabled', () => {
  reset();
  ctx.state.sel.on = true;
  ctx.selUpdateBar();
  return dom.els['#btnBatchDownload'].disabled === true && dom.els['#btnBatchDownload'].textContent === '批量下载';
});
t('勾了 3 个：按钮显示计数且可点', () => {
  reset(['1', '2', '3']);
  ctx.state.sel.on = true;
  ctx.selUpdateBar();
  return dom.els['#btnBatchDownload'].textContent === '批量下载（3）' && dom.els['#btnBatchDownload'].disabled === false;
});
t('全选后「全选」按钮改写成「取消全选」', () => {
  reset(['1'], [{ modId: 1 }]);
  ctx.state.sel.on = true;
  ctx.selUpdateBar();
  return dom.els['#btnSelectAll'].textContent === '取消全选';
});
t('跑批中不覆盖进度文案', () => {
  reset(['1']);
  ctx.state.sel.on = true;
  ctx.state.sel.busy = true;
  dom.els['#btnBatchDownload'] = { textContent: '批量下载… 2/5', style: {}, disabled: true, classList: { toggle() {} } };
  ctx.selUpdateBar();
  return dom.els['#btnBatchDownload'].textContent === '批量下载… 2/5';
});

console.log('\n=== 静态接线断言（防回归） ===');
t('工具栏有「多选」开关', () => /id="batchBar"[\s\S]{0,400}id="btnBatchMode">多选</.test(html));
t('工具栏有「全选」和「批量下载」', () => /id="btnSelectAll"[\s\S]{0,200}id="btnBatchDownload"/.test(html));
t('批量下载按钮有解释性 title', () => /id="batchBar" title="[^"]*多选模式[^"]*"/.test(html));
t('CSS 有多选态复选框（默认隐藏，body.sel 才显示）', () => /\.cover \.ck\{display:none/.test(css) && /body\.sel \.cover \.ck\{display:block\}/.test(css));
t('CSS 给选中卡片加边框', () => /body\.sel \.card\.sel\{border-color:var\(--accent\)/.test(css));
t('CSS 让「成人内容」角标给复选框让位', () => /body\.sel \.cover \.tag\{left:38px\}/.test(css));
t('卡片渲染带复选框与选中类', () => /class="card\$\{state\.sel\.ids\.has\(String\(n\.modId\)\) \? ' sel' : ''\}"/.test(code) && /class="ck\$\{state\.sel\.ids\.has\(String\(n\.modId\)\) \? ' on' : ''\}" data-ck=/.test(code));
t('多选态下点卡片 = 勾选，不弹抽屉', () => /if \(state\.sel\.on && card\.dataset\.modid\) \{ selToggle\(card\.dataset\.modid\); return; \}/.test(code));
t('按钮事件已接', () => /\$\('#btnBatchMode'\)\.addEventListener\('click', \(\) => selSetMode\(!state\.sel\.on\)\)/.test(code) &&
  /\$\('#btnSelectAll'\)\.addEventListener\('click', \(\) => selSelectAll\(\)\)/.test(code) &&
  /\$\('#btnBatchDownload'\)\.addEventListener\('click'/.test(code));
t('列表重置时清空选择', () => /if \(el\) el\.scrollTop = 0;[\s\S]{0,80}selClear\(\);/.test(code));
t('全选状态下追加的卡片自动并入', () => /if \(state\.sel\.all\) for \(let i = before; i < b\.items\.length; i\+\+\) state\.sel\.ids\.add/.test(code));
t('批量下载逐个拉文件列表', () => /await call\(window\.api\.nexus\.files\(modId\), \{ silent: true \}\)/.test(code));
t('批量下载把主文件钉进 meta', () => /meta\.fileId = Number\(f\.fileId\);[\s\S]{0,160}meta\.fileVersion = f\.version \|\| '';[\s\S]{0,80}meta\.fileSize = f\.sizeInBytes \|\| 0;/.test(code));
t('取不到文件列表退回整包入队（不是失败）', () => /else out\.noFile\+\+;/.test(code));
t('已安装的跳过', () => /installed = await installedIdsOf\(picked\)/.test(code) && /picked\.filter\(m => !installed\.has\(Number\(m\.modId\)\)\)/.test(code));
t('批量走 enqueue，不走 dlEnqueue（避免切页 + 弹 N 个授权窗）', () => /const r = await call\(window\.api\.download\.enqueue\(meta\), \{ silent: true \}\);/.test(code) && !/for[\s\S]{0,200}dlEnqueue\(/.test(code));
t('并发度有上限', () => /const BATCH_CONCURRENCY = 4;/.test(code) && /Array\.from\(\{ length: Math\.min\(BATCH_CONCURRENCY, todo\.length\) \}, worker\)/.test(code));
t('跑批有 busy 守卫（重入直接返回）', () => /if \(state\.sel\.busy\) return;/.test(code) && /state\.sel\.busy = true;/.test(code) && /finally \{\s*state\.sel\.busy = false;/.test(code));
t('完成后切到下载页并汇总提示', () => /await refreshDownloads\(\);[\s\S]{0,120}switchPage\('p-download'\);[\s\S]{0,80}toast\(batchSummary\(out\)/.test(code));
t('启动时初始化工具栏状态', () => /selUpdateBar\(\);\s*\/\/ 多选工具栏初始态/.test(code));
t('暴露自动化入口', () => /window\.__batch = \{ batchDownload, selToggle, selSelectAll, selSetMode, selUpdateBar, pickPrimaryFile, batchSummary \};/.test(code));

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) process.exit(1);
