'use strict';
/**
 * 浏览页「到底继续加载 + 切页保留位置」的离线断言。
 *
 * 渲染层函数没法直接 require（依赖 DOM），所以：
 *   1. 从 app.js 源码里**原样抽出** shouldLoadMore 的定义，在 vm 里跑真身；
 *   2. 对四段关键接线做静态断言（监听绑在哪、阈值多少、切页怎么存位置）。
 * 这样既能测行为，也不会让测试与实现漂移。
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

// ---- 抽出真身 ----
const m = code.match(/function shouldLoadMore\([\s\S]*?\n}/);
assert.ok(m, 'app.js 里应能找到 shouldLoadMore 函数定义');
// ⚠️ `shouldLoadMore` 依赖 `isLocalFiltering`（黑名单 / 只看未安装的前端筛选口径），
//    必须**一起**喂进 vm —— 否则 vm 里 ReferenceError，一整组行为断言全废。
const fi = code.match(/function isLocalFiltering\([\s\S]*?\n}/);
assert.ok(fi, 'app.js 里应能找到 isLocalFiltering 函数定义');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fi[0] + '\n' + m[0] + '\nthis.shouldLoadMore = shouldLoadMore;', ctx);
const shouldLoadMore = ctx.shouldLoadMore;

// blocked / blockMode 给上默认值，贴近真实的 state.browse 形状
const b = (over = {}) => Object.assign(
  { loading: false, items: [{ modId: 1 }], total: 999, blocked: new Set(), blockMode: 'hide' }, over);
console.log('=== shouldLoadMore：滚到底续加载的边界 ===');
t('距底 500px（阈值外）不加载', () => shouldLoadMore(1200, 700, 2400, b()) === false);
t('距底 421px 不加载', () => shouldLoadMore(1200, 700, 2321, b()) === false);
t('距底刚好 420px 就加载（>=，预取）', () => shouldLoadMore(1200, 700, 2320, b()) === true);
t('距底 400px 加载', () => shouldLoadMore(1200, 700, 2300, b()) === true);
t('滚到底（距底 0）加载', () => shouldLoadMore(1780, 700, 2480, b()) === true);
t('拉到最顶不加载', () => shouldLoadMore(0, 700, 2480, b()) === false);
t('内容不足一屏也要能触发（clientHeight > scrollHeight - 420）', () => shouldLoadMore(0, 700, 800, b()) === true);
t('正在加载中不重复触发', () => shouldLoadMore(1200, 700, 2100, b({ loading: true })) === false);
t('列表为空不触发', () => shouldLoadMore(0, 700, 800, b({ items: [] })) === false);
t('全部加载完不触发', () => shouldLoadMore(1200, 700, 2100, b({ items: [{ modId: 1 }, { modId: 2 }], total: 2 })) === false);
t('服务端翻完了（b.done）不触发', () => shouldLoadMore(1780, 700, 2480, b({ done: true })) === false);
t('「只看未安装」时 items < total 也可能没货（靠 b.done 兜底）', () =>
  shouldLoadMore(1780, 700, 2480, b({ onlyUninstalled: true, items: [{ modId: 1 }], total: 999 })) === true);
t('「只看未安装」且服务端还有货 → 正常续加载', () =>
  shouldLoadMore(1780, 700, 2480, b({ onlyUninstalled: true, done: false, items: [{ modId: 1 }], total: 999, offset: 48 })) === true);
t('b 为 null 不炸', () => shouldLoadMore(0, 0, 0, null) === false);

console.log('\n=== 静态接线断言（防回归） ===');
t('scroll 监听绑在滚动容器 #body 上', () => /\$\('#body'\)\.addEventListener\('scroll'[\s\S]{0,400}passive:\s*true/.test(code));
t('监听里调用 shouldLoadMore', () => /shouldLoadMore\(el\.scrollTop/.test(code));
t('监听里判断当前是浏览页', () => /addEventListener\('scroll'[\s\S]{0,320}p-browse'\)\.classList\.contains\('on'\)/.test(code));
t('rAF 节流（不会每像素都跑）', () => /scrollTick[\s\S]{0,80}requestAnimationFrame/.test(code));
t('切页保存滚动位置', () => /pageScroll\.set\(curId, \$\('#body'\)\.scrollTop\)/.test(code));
t('切回时恢复位置（rAF + 延时双保险）', () => /pageScroll\.get\(id\)[\s\S]{0,240}setTimeout/.test(code));
t('第一次进某页仍置顶（back 为 undefined 时 scrollTop=0）', () => /\$\('#body'\)\.scrollTop = 0;\s*\n\s*if \(back\)/.test(code));
t('reset（筛选变化）清掉旧位置', () => /pageScroll\.delete\('p-browse'\)/.test(code));
t('追加模式走增量 append 而不是整页重画', () => /for \(let i = before; i < b\.items\.length; i\+\+\)[\s\S]{0,220}grid\.appendChild/.test(code));
t('加载中已有列表时不重画（防闪烁）', () => /if \(!b\.loading \|\| !\$\('#browseArea \.grid'\)\)/.test(code));
t('追加失败给 toast 而不是踹回空态', () => /else toast\('加载更多失败：'/.test(code));
t('按钮显示剩余数量', () => /加载更多（还有 \$\{browseRest\(b\)/.test(code));
// ⚠️ 口径已收敛到 `isLocalFiltering(b)`（黑名单 + 只看未安装共用）—— 断言跟着改，
//    别再写死 `b.onlyUninstalled`，否则加了黑名单筛选后这里会假失败。
t('前端筛选时的剩余量按服务端偏移算（browseRest）', () => /const seen = isLocalFiltering\(b\) \? b\.offset : b\.items\.length;/.test(code));
t('翻页偏移按服务端推进（+= page.items.length）', () => /b\.offset \+= page\.items\.length;/.test(code));
t('本地黑名单列表不走分页偏移（那是「只看黑名单」专用的另一条路）', () =>
  /async function loadBlockedList[\s\S]{0,1800}b\.offset = b\.items\.length;/.test(code));
t('前端筛选剔完不满一屏会自动续翻', () => /if \(!isLocalFiltering\(b\) \|\| b\.done \|\| b\.items\.length - before >= BROWSE_PAGE\) break;/.test(code));
t('自动续翻有页数兜底（不会把整个站翻完）', () => /if \(\+\+guard >= 20\)/.test(code));
t('卡片状态变化只替换单卡片（不整页 renderBrowse）', () => /card\.replaceWith\(wrap\.firstElementChild\)/.test(code));
t('reset 能抢占正在飞的追加（代际令牌）', () => /if \(b\.loading && !reset\) return;/.test(code) && /const stale = \(\) => b\.gen !== gen;/.test(code));
t('旧请求的结果/收尾被代际挡掉', () => /if \(stale\(\)\) return;   \/\/ 已被更新的 reset 抢占/.test(code) && /if \(stale\(\)\) return;   \/\/ 旧请求的收尾一律跳过/.test(code));

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) process.exit(1);
