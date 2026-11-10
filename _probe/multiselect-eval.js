/*
 * 多选 Shift / Ctrl 连选 —— 渲染进程里的真跑脚本（由 _probe/multiselect-test.js 注入）。
 *
 * 为什么在这里跑而不是抠函数：selRangeTo / gselRangeTo 依赖真实 DOM 顺序
 * （`#browseArea .card[data-modid]` 的排列 = 用户看到的顺序），抠出来就测不到
 * 「按屏幕顺序连选」这件事本身。所以直接造一批假卡片、调真函数、读真 state。
 */
const S = window.__state;
const B = window.__batch;
const G = window.__gsel;

const out = [];
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  out.push({ name, ok, got: ok ? undefined : got, want: ok ? undefined : want });
}

/* ---- 造场景：浏览页 8 张、已安装页 5 张 ---- */
let area = document.querySelector('#browseArea');
if (!area) { area = document.createElement('div'); area.id = 'browseArea'; document.body.appendChild(area); }
const gridOld = area.innerHTML;
area.innerHTML = '<div class="grid">' + [1, 2, 3, 4, 5, 6, 7, 8]
  .map(i => '<div class="card" data-modid="' + i + '"><div class="ck" data-ck="' + i + '">✓</div></div>')
  .join('') + '</div>';

let ia = document.querySelector('#installedArea');
if (!ia) { ia = document.createElement('div'); ia.id = 'installedArea'; document.body.appendChild(ia); }
const instOld = ia.innerHTML;
ia.innerHTML = '<div class="grid">' + ['a', 'b', 'c', 'd', 'e']
  .map(k => '<div class="card" data-gid="' + k + '"><div class="ck" data-gck="' + k + '">✓</div></div>')
  .join('') + '</div>';

// 「全选」走的是数据（browseVisibleItems），不是 DOM —— 临时塞一份假数据
const itemsOld = S.browse.items;
S.browse.items = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ modId: String(i) }));

const ids = () => Array.from(S.sel.ids).map(Number).sort((a, b) => a - b);
const keys = () => Array.from(S.gsel.ids).sort();

/* ---- 浏览页 ---- */
B.selSetMode(true);
eq('进入多选模式', S.sel.on, true);

B.selClick('2', {});
eq('普通点击只选 2', ids(), [2]);

B.selClick('6', { shiftKey: true });
eq('Shift 连选 2→6（含两端）', ids(), [2, 3, 4, 5, 6]);

B.selClick('8', { ctrlKey: true });
eq('Ctrl 点击追加 8', ids(), [2, 3, 4, 5, 6, 8]);

B.selClick('8', { ctrlKey: true });
eq('Ctrl 再点一次取消 8', ids(), [2, 3, 4, 5, 6]);

// 上一步（Ctrl 点 8）把锚点设为 8
B.selClick('3', { shiftKey: true });
eq('Shift 从锚点 8 反方向连选到 3（先清空）', ids(), [3, 4, 5, 6, 7, 8]);

B.selClick('1', { shiftKey: true, ctrlKey: true });
eq('Ctrl+Shift 在已有选择上追加 1→3 段', ids(), [1, 2, 3, 4, 5, 6, 7, 8]);

// ⚠️ 应用自己的轮询/加载随时会把 state.browse.items 换成真数据，
//    每次调「全选」前都重新塞一次假数据，避免测试被后台刷新打断。
// ⚠️ 上一步 Ctrl+Shift 之后 1~8 已经全被选中了，「全选」会先判定「已经是全选」而去清空，
//    所以这里先 selClear() 归零，再测「全选 → 取消全选」这一对。
B.selClear();
eq('清空选择', ids(), []);
// 「全选」的取数口径随档位变：本地/已安装档走 libSelectableKeys()（记录键），
// 在线档才走 browseVisibleItems()（modId）。要测塞进去的假数据，必须先站到在线档。
S.lib = S.lib || {};
S.lib.status = 'online';
S.browse.items = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ modId: String(i) }));
B.selSelectAll();
eq('全选', ids(), [1, 2, 3, 4, 5, 6, 7, 8]);
eq('全选后锚点清空', S.sel.anchor, null);
S.lib.status = 'online';
S.browse.items = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ modId: String(i) }));
B.selSelectAll();
eq('再点一次取消全选', ids(), []);

B.selClick('5', { shiftKey: true });
eq('没有锚点时 Shift 退化成只选一张', ids(), [5]);

eq('被选中的卡片带 sel 类', document.querySelector('#browseArea .card[data-modid="5"]').classList.contains('sel'), true);
eq('未选中的卡片不带 sel 类', document.querySelector('#browseArea .card[data-modid="3"]').classList.contains('sel'), false);

/* ---- 已安装页（同一套语义） ---- */
G.gselSetMode(true);
G.gselClick('b', {});
eq('已安装页普通点击 b', keys(), ['b']);
G.gselClick('d', { shiftKey: true });
eq('已安装页 Shift b→d', keys(), ['b', 'c', 'd']);
G.gselClick('a', { ctrlKey: true });
eq('已安装页 Ctrl 追加 a', keys(), ['a', 'b', 'c', 'd']);
G.gselClick('e', { shiftKey: true, ctrlKey: true });
eq('已安装页 Ctrl+Shift 追加 a→e', keys(), ['a', 'b', 'c', 'd', 'e']);

/* ---- 退出清空 ---- */
B.selSetMode(false);
eq('退出多选清空选择', ids(), []);
eq('退出多选清空锚点', S.sel.anchor, null);
G.gselSetMode(false);
eq('已安装页退出清空', keys(), []);

/* ---- 还原场景 ---- */
area.innerHTML = gridOld;
ia.innerHTML = instOld;
S.browse.items = itemsOld;

return { ok: out.every(c => c.ok), checks: out };
