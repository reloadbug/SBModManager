/*
 * 侧栏折叠 + 详情页归属补挂的目视确认（静默截图）
 *  注意：本文件的内容会被 --shot-eval-file 包进 (async()=>{ … })()，
 *  所以这里不能再自己包一层 IIFE，最后 return 一个对象即可。
 *  1) 切到 Mod 库 → 折叠侧栏 → 记录导航项文字是否隐藏、宽度是否变小
 *  2) 展开回来 → 搜索 Blossom → 点卡片 → 读「包内文件」表与子 Mod 小结
 */
const out = {};
try { switchPage('p-browse'); } catch (e) {}
await new Promise(r => setTimeout(r, 1200));

const side = document.querySelector('.side');
const btn = document.querySelector('#btnSideToggle');
out.beforeWidth = side ? Math.round(side.getBoundingClientRect().width) : -1;
if (btn) { btn.click(); await new Promise(r => setTimeout(r, 700)); }
out.afterWidth = side ? Math.round(side.getBoundingClientRect().width) : -1;
out.collapsedClass = !!(side && side.classList.contains('collapsed'));
const navText = document.querySelector('.nav-i .nav-text');
out.navTextHidden = navText ? getComputedStyle(navText).display === 'none' : null;

if (btn) { btn.click(); await new Promise(r => setTimeout(r, 700)); }
out.restoredWidth = side ? Math.round(side.getBoundingClientRect().width) : -1;

const search = document.querySelector('#instSearch');
if (search) {
  search.value = 'Blossom';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
}
const cards = [...document.querySelectorAll('#p-browse .card')];
const card = cards.find(c => /Blossom|Kamenlaideng/i.test(c.textContent || ''));
if (card) { card.click(); await new Promise(r => setTimeout(r, 3500)); }

const pkg = document.querySelector('#drawerPkg');
out.subRows = [...document.querySelectorAll('#drawerPkg .sf-row')].map(r => r.textContent.trim().replace(/\s+/g, ' ').slice(0, 40));
out.pkgRows = [...document.querySelectorAll('#drawerPkg .pf-row')].length;
out.pkgStates = [...document.querySelectorAll('#drawerPkg .pf-st')].map(e => e.textContent.trim());
out.summary = pkg ? (pkg.textContent.replace(/\s+/g, ' ').match(/包里\s*\d+\s*个文件[^·]*·\s*已装\s*\d+\s*个/) || [''])[0] : '';
out.pfOverflow = [...document.querySelectorAll('#drawerPkg .pf-row')].some(r => r.scrollWidth > r.clientWidth + 1);
return out;
