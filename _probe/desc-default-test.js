'use strict';
/**
 * 「打开抽屉默认就显示 Nexus 原文说明」的离线断言。
 *
 * 从 app.js 里**原样抽出** renderDesc / originalDescHtml / zhDescHtml / descBoxHtml，
 * 在 vm 里喂一份假 state + esc 跑真身，断言：
 *   · 中文页默认摆出原文（英文 / 中文都算原文），不再是「只有一句翻译提示」
 *   · 翻译提示原文一字未改，且仍带「翻译成中文」按钮
 *   · 有译文时显示译文；English 页永远只显示原文
 *   · 已安装抽屉（meta.descriptionZh 通路）行为不回退
 *
 * 跑法：node _probe/desc-default-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const code = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === true) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' → ' + r); } }
  catch (e) { fail++; console.log('  ✗ ' + name + ' → 抛出 ' + e.message); }
}

// ---- 抽出四个函数 + 提示常量（源码里是连续一段）----
const start = code.indexOf('function renderDesc(');
const end = code.indexOf('\n}\n', code.indexOf('function descBoxHtml('));
assert.ok(start >= 0 && end > start, 'app.js 里应能找到 renderDesc…descBoxHtml 这一整段');
const block = code.slice(start, end + 3);

const sandbox = {
  state: { drawer: { kind: 'nexus', mod: null, lang: 'zh', translated: null } },
  esc: (s) => String(s == null ? '' : s)
};
vm.createContext(sandbox);
vm.runInContext(block + `
this.renderDesc = renderDesc;
this.originalDescHtml = originalDescHtml;
this.zhDescHtml = zhDescHtml;
this.descBoxHtml = descBoxHtml;
this.DESC_TRANSLATE_HINT = DESC_TRANSLATE_HINT;`, sandbox);

const HINT = '点下方按钮把说明翻译成中文（结果会缓存，只翻一次）。';
const nexusMod = {
  modId: 558,
  name: 'YoRHa Unofficial Ceremonial Attire - Modular',
  descriptionHtml: '<p>Replaces the <b>Modular</b> outfit.</p>',
  descriptionText: 'Replaces the Modular outfit.',
  description: 'Replaces the Modular outfit.'
};

const nexusDrawer = (over = {}) => Object.assign(
  { kind: 'nexus', mod: nexusMod, lang: 'zh', translated: null }, over);

console.log('=== 默认（中文页）就显示 Nexus 原文 ===');
t('默认画面里出现英文原文', () => sandbox.descBoxHtml(nexusDrawer()).indexOf('Replaces the <b>Modular</b> outfit.') >= 0);
t('原文在翻译提示之前（先看内容再决定翻不翻）', () => {
  const h = sandbox.descBoxHtml(nexusDrawer());
  return h.indexOf('Replaces the') < h.indexOf(HINT) ? true : '顺序不对';
});
t('翻译提示原文一字未改', () => sandbox.descBoxHtml(nexusDrawer()).includes(HINT));
t('仍带「翻译成中文」按钮', () => sandbox.descBoxHtml(nexusDrawer()).includes('data-translate="1"'));
t('nexus 抽屉默认 lang 就是 zh（打开即原文 + 提示）', () => /kind: 'nexus', mod: null, lang: 'zh'/.test(code));

console.log('\n=== 原文的语言不挑：中文说明也照样默认显示 ===');
const zhMod = { modId: 1, name: '某中文说明 mod', descriptionText: '这是一个中文说明的 Mod。\n第二行。' };
t('纯中文原文默认显示，且换行转 <br>', () => {
  const h = sandbox.descBoxHtml(nexusDrawer({ mod: zhMod }));
  return h.includes('这是一个中文说明的 Mod。<br>第二行。') ? true : h;
});
t('中文原文同样保留翻译提示', () => sandbox.descBoxHtml(nexusDrawer({ mod: zhMod })).includes(HINT));

console.log('\n=== 有译文 / English 页 ===');
t('翻完后中文页显示译文、不再显示提示', () => {
  const h = sandbox.descBoxHtml(nexusDrawer({ translated: '替换模块化套装。' }));
  return h === '<p>替换模块化套装。</p>' ? true : h;
});
t('English 页只显示原文，不带翻译提示', () => {
  const h = sandbox.descBoxHtml(nexusDrawer({ lang: 'en' }));
  return h.includes('Replaces the <b>Modular</b> outfit.') && !h.includes(HINT) ? true : h;
});
t('English 页有译文时也坚持原文（页签就是干这个的）', () => {
  const h = sandbox.descBoxHtml(nexusDrawer({ lang: 'en', translated: '译文' }));
  return h.includes('Replaces the') && !h.includes('译文') ? true : h;
});

console.log('\n=== 边界 ===');
t('没有任何说明时不空白，给一句人话 + 提示', () => {
  const h = sandbox.descBoxHtml(nexusDrawer({ mod: { modId: 9, name: 'x' } }));
  return h.includes('该 Mod 没有说明文字。') && h.includes(HINT) ? true : h;
});
t('drawer 为 null 不炸', () => sandbox.descBoxHtml(null) === '');
t('descriptionHtml 优先于纯文本（保留作者排版）', () => {
  const h = sandbox.originalDescHtml(nexusDrawer());
  return h === '<p>Replaces the <b>Modular</b> outfit.</p>' ? true : h;
});

console.log('\n=== 已安装抽屉（renderDesc 通路）===');
const instMod = { name: '某 mod', meta: { description: 'Original text.', descriptionHtml: '' } };
sandbox.state.drawer = { kind: 'installed', mod: instMod, lang: 'zh', translated: null };
t('没有 descriptionZh 时也先摆原文', () => sandbox.renderDesc(instMod, 'Original text.', '').includes('<p>Original text.</p>'));
t('已安装抽屉的提示保留', () => sandbox.renderDesc(instMod, 'Original text.', '').includes('尚未翻译。'));
t('有 descriptionZh 时显示译文', () => sandbox.renderDesc(instMod, 'Original text.', '中文译文').includes('<p>中文译文</p>'));
t('English 页显示原文', () => {
  sandbox.state.drawer.lang = 'en';
  const h = sandbox.renderDesc(instMod, 'Original text.', '中文译文');
  sandbox.state.drawer.lang = 'zh';
  return h.includes('<p>Original text.</p>') ? true : h;
});

console.log('\n=== 静态接线断言（防回归）===');
t('nexus 抽屉初始渲染走 descBoxHtml（不再手写 if/else）', () => /id="descBox">\$\{descBoxHtml\(state\.drawer\)\}/.test(code));
t('语言切换也走 descBoxHtml', () => /\$\('#descBox'\)\.innerHTML = descBoxHtml\(d\);/.test(code));
t('openNexusDrawer 在渲染前已把 mod 放进 state.drawer', () => /state\.drawer\.mod = m;[\s\S]{0,800}descBoxHtml\(state\.drawer\)/.test(code));
t('翻译提示只有一处定义（不在代码里散落硬编码）', () => (code.match(/点下方按钮把说明翻译成中文/g) || []).length === 1);
t('语言页签带 title 说明各自含义', () => /data-lang="zh" title="翻译成中文后显示在这里"/.test(code) && /data-lang="en" title="Nexus 上的原文（无论英文中文）"/.test(code));

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) process.exit(1);
