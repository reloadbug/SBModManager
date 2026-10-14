'use strict';
/**
 * 浏览页「喜欢」（`src/main/favorites.js`）+ 👍/👎 纯图标按钮 + 「只看喜欢」本地视图。
 *
 * 用户诉求（2026-10-14）：
 *   「mod 图标上增加喜欢按钮，与不喜欢对应，不显示文字，只显示两个图标，
 *     大拇指向上，大拇指向下」
 * 追问后敲定的口径：「**标记 + 筛选 + 喜欢的排前面**」。
 *
 * 三个要点各对应一组断言：
 *   · 标记 —— `voteHtml()` 的两种态（点亮/未点亮）与 data-* 属性；
 *   · 筛选 —— `loadLocalList(reset, 'liked')` 这条本地视图（零网络请求）；
 *   · 排前面 —— `applyLocalFilter()` 里的稳定置顶（**只是本页内**，不承诺全站）。
 *
 * 纯 Node：主进程模块用**临时文件**测（不碰用户 `data/`）；
 * 渲染层函数从 `app.js` 源码里**原样抽出**在 vm 里跑真身（不会与实现漂移）。
 *
 * ⚠️ 整份测试跑在 `async main()` 里：`applyLocalFilter` 是 async 函数，
 * 若用裸 IIFE 调用，断言会被推到微任务、跑到文件末尾的统计之后（计数全乱）。
 *
 * 运行：`npm run test:favorites`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const { createFavorites } = require('../src/main/favorites');
const { createBlacklist } = require('../src/main/blacklist');

const TMP = path.join(os.tmpdir(), 'sb-favorites-test');
const FILE = path.join(TMP, 'favorites.json');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const HTML = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const CSS = path.join(__dirname, '..', 'src', 'renderer', 'style.css');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');
const PATHS = path.join(__dirname, '..', 'src', 'main', 'paths.js');

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}
const eq = (a, b, label) => t(label, () => (a === b ? true : `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

function reset() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 沙箱守卫 */ }
  fs.mkdirSync(TMP, { recursive: true });
}

// ⚠️ 工作区 app.js 是 CRLF，必须归一成 LF —— 否则断言里写死的 `\n`
// 永远匹配不上（`\r` 卡在中间），整段静默变「缺失」。
const code = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');

async function main() {
  // ============================================================== 1. 主进程模块

  console.log('\n[1] createFavorites：增删查 + 持久化');
  reset();
  {
    const fv = createFavorites(FILE);
    eq(fv.count(), 0, '初始为空');
    eq(fv.has(3023), false, '空名单里 has() = false');
    eq(fv.ids().length, 0, 'ids() 空数组');

    const e1 = fv.add(3023, { name: 'Tiger Head Necklace', author: 'someone', thumbnail: 'https://x/t.jpg' });
    eq(e1.modId, 3023, 'add 返回记录，modId 正确');
    eq(typeof e1.at, 'string', 'add 记下时间戳 at');
    eq(fv.count(), 1, '加入后 count = 1');
    eq(fv.has(3023), true, 'has() = true');
    eq(fv.has('3023'), true, '字符串形式的 modId 也认得（渲染层传过来就是字符串）');
    eq(fv.ids()[0], 3023, 'ids() 里是**数字**（渲染层拿去建 Set 要 String 一下）');

    const got = fv.all()[0];
    eq(got.name, 'Tiger Head Necklace', '存下了 name（「只看喜欢」要离线渲染卡片）');
    eq(got.author, 'someone', '存下了 author');
    eq(got.thumbnail, 'https://x/t.jpg', '存下了 thumbnail');
  }

  // ============================================================== 2. 幂等与边界

  console.log('\n[2] 幂等 + 字段合并 + 非法输入');
  {
    const fv = createFavorites(FILE);
    const before = fv.all()[0];
    const again = fv.add(3023, { name: 'Tiger Head Necklace' });
    eq(fv.count(), 1, '重复 add 不产生第二条（幂等）');
    eq(again.at, before.at, '重复 add 保留原 at（「什么时候喜欢的」不该被刷新）');

    const merged = fv.add(3023, { thumbnail: 'https://x/new.jpg' });
    eq(merged.author, 'someone', '只给 thumbnail 时保留原 author（浅合并，不是整条替换）');
    eq(merged.thumbnail, 'https://x/new.jpg', '新字段覆盖旧字段');
    eq(fv.count(), 1, '合并后仍然只有一条');

    // 非法 id：不入库、返回 null、不抛
    eq(fv.add(0, { name: 'x' }), null, 'add(0) 返回 null');
    eq(fv.add(null, { name: 'x' }), null, 'add(null) 返回 null');
    eq(fv.add('', { name: 'x' }), null, 'add("") 返回 null');
    eq(fv.add('abc', { name: 'x' }), null, 'add("abc") 返回 null（Number("abc") 是 NaN）');
    eq(fv.count(), 1, '非法输入一条都没进去');
    eq(fv.remove(9999), null, 'remove 不存在的返回 null（不抛）');
  }

  // ============================================================== 3. 持久化

  console.log('\n[3] 持久化 + 倒序 + 移除 + 清空');
  {
    // 手工塞两条不同时间的记录，验证 all() 的排序口径
    // （直接改文件，避免依赖真实时间间隔导致偶发失败）
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    raw.mods = [
      { modId: 1, name: 'older', at: '2026-10-01T00:00:00.000Z' },
      { modId: 2, name: 'newer', at: '2026-10-14T00:00:00.000Z' }
    ];
    fs.writeFileSync(FILE, JSON.stringify(raw, null, 2));

    const fv2 = createFavorites(FILE);
    eq(fv2.count(), 2, '重新打开能读回来（真的落盘了）');
    eq(fv2.all()[0].modId, 2, 'all() 按加入时间**倒序**（最近喜欢的排前面）');

    const rm = fv2.remove(1);
    eq(rm && rm.modId, 1, 'remove 返回被移除的记录');
    eq(fv2.count(), 1, '移除后 count = 1');
    eq(fv2.has(1), false, '被移除的 has() = false');

    const fv3 = createFavorites(FILE);
    eq(fv3.count(), 1, '移除也落盘了');
    eq(fv3.clear(), 1, 'clear 返回清掉的条数');
    eq(fv3.count(), 0, 'clear 后为空');
  }

  // ============================================================== 4. 与黑名单对称

  console.log('\n[4] 与 blacklist 对称（防止两个模块将来分叉）');
  {
    const fvFile = path.join(TMP, 'sym-favorites.json');
    const blFile = path.join(TMP, 'sym-blacklist.json');
    const fv = createFavorites(fvFile);
    const bl = createBlacklist(blFile);

    const keys = (o) => Object.keys(o).sort().join(',');
    // ⚠️ 别在断言里直接调 add() —— 那会真的写进模块（第一版就踩了这个坑，
    // 断言「黑名单里没有 7」时它已经被前面的 add 写进去了）。先各自取回记录再比。
    const fvRec = fv.add(7, { name: 'x', author: 'a', thumbnail: 't' });
    const blRec = bl.add(7, { name: 'x', author: 'a', thumbnail: 't' });
    eq(keys(fvRec), keys(blRec), 'add() 返回记录的字段名与 blacklist 完全一致');

    eq(fvFile === blFile, false, '两者写的是不同的文件（共用一个文件会在语义分叉时被迫做数据迁移）');
    eq(fv.has(7), true, 'favorites 有 7');
    eq(bl.has(7), true, 'blacklist 也有 7（两边各存一份，互不影响）');

    // 真正的「互不干扰」：只在一边新增，另一边不应该看见
    fv.add(8, { name: 'only-liked' });
    eq(fv.has(8), true, '只在喜欢里加的 mod，喜欢里有');
    eq(bl.has(8), false, '只在喜欢里加的 mod，黑名单里查不到');
  }

  // ============================================================== 5. 投票按钮真身

  console.log('\n[5] voteHtml：👍/👎 两只图标按钮（从 app.js 抽真身跑）');
  {
    const m = code.match(/function voteHtml\([\s\S]*?\n}/);
    t('app.js 里能找到 voteHtml 定义', () => !!m || '找不到');
    const ctx = {
      // 注入最小依赖：state 里只有 voteHtml 会读到的两个集合；图标常量换成可断言的短串
      fakeState: { browse: { liked: new Set(), blocked: new Set() } },
      ICON_THUMB_UP: '<UP/>',
      ICON_THUMB_DOWN: '<DOWN/>'
    };
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\nthis.vote = voteHtml;', ctx);
    // voteHtml 引用的是闭包外的 `state`，在 vm 语境里把它指到 fakeState
    vm.runInContext('var state = this.fakeState;', ctx);
    const vote = ctx.vote;

    const withSets = (liked, blocked) => {
      ctx.fakeState.browse.liked = new Set(liked);
      ctx.fakeState.browse.blocked = new Set(blocked);
    };

    // ---- 都没点 ----
    withSets([], []);
    const plain = vote({ modId: 101 });
    t('未点亮时给的是 data-like（点它去加喜欢）', () => /data-like="101"/.test(plain) || plain);
    t('未点亮时不给 data-unlike', () => !/data-unlike="101"/.test(plain) || '不该出现 unlike');
    t('未拉黑时给的是 data-dislike（点它去拉黑）', () => /data-dislike="101"/.test(plain) || plain);
    t('未拉黑时不给 data-undislike', () => !/data-undislike="101"/.test(plain) || '不该出现 undislike');

    // ---- 按钮里只有图标，没有文字（用户明确要求「不显示文字，只显示两个图标」）----
    const upInner = (plain.match(/class="vbtn up[^"]*"[^>]*>([\s\S]*?)<\/button>/) || [])[1];
    const downInner = (plain.match(/class="vbtn down[^"]*"[^>]*>([\s\S]*?)<\/button>/) || [])[1];
    eq(upInner, '<UP/>', '👍 按钮的可见内容**只有图标**（不是「喜欢」这两个字）');
    eq(downInner, '<DOWN/>', '👎 按钮的可见内容**只有图标**（不是「不喜欢」这三个字）');
    t('两只按钮都在同一个 .vote 容器里（贴在一起，与不喜欢对称）',
      () => /<div class="vote">[\s\S]{0,900}<\/div>\s*$/.test(plain) || plain);
    t('👍 的 title 说明它还能用来筛选（「只看喜欢」）+ 置顶',
      () => /title="喜欢 —— [^"]*只看喜欢[^"]*"/.test(plain) || plain);

    // ---- 已喜欢 ----
    withSets(['101'], []);
    const liked = vote({ modId: 101 });
    t('已喜欢 → 给 data-unlike（再点一次是取消）', () => /data-unlike="101"/.test(liked) || liked);
    t('已喜欢 → 👍 按钮带 on 类（点亮）', () => /class="vbtn up on"/.test(liked) || liked);
    t('已喜欢 → 不给 data-like', () => !/data-like="101"/.test(liked) || '不该出现 like');
    t('喜欢**不改变** 👎 的态（两者独立，不是二选一）',
      () => /data-dislike="101"/.test(liked) && !/class="vbtn down on"/.test(liked) || liked);

    // ---- 已拉黑 ----
    withSets([], ['101']);
    const blocked = vote({ modId: 101 });
    t('已拉黑 → 给 data-undislike（再点一次是移出黑名单）', () => /data-undislike="101"/.test(blocked) || blocked);
    t('已拉黑 → 👎 按钮带 on 类（点亮）', () => /class="vbtn down on"/.test(blocked) || blocked);
    t('已拉黑 → 不给 data-dislike', () => !/data-dislike="101"/.test(blocked) || '不该出现 dislike');
    t('拉黑**不改变** 👍 的态', () => /data-like="101"/.test(blocked) || blocked);
  }

  // ============================================================== 6. 置顶真身

  console.log('\n[6] applyLocalFilter：「喜欢的排前面」（从 app.js 抽真身跑）');
  {
    const m = code.match(/async function applyLocalFilter\([\s\S]*?\n}/);
    t('app.js 里能找到 applyLocalFilter 定义', () => !!m || '找不到');
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\nthis.f = applyLocalFilter;', ctx);
    const f = ctx.f;

    const b = (over = {}) => Object.assign(
      { onlyUninstalled: false, blockMode: 'hide', blocked: new Set(), liked: new Set() }, over);

    const items = [{ modId: 1 }, { modId: 2 }, { modId: 3 }, { modId: 4 }];
    const ids = (arr) => arr.map(x => x.modId).join(',');

    // 没有喜欢 → 原样返回（连数组引用都不换，省一次切片）
    ctx.state = { browse: b() };
    const none = await f(items);
    eq(none, items, '没有喜欢时**原样返回同一个数组**（不做无谓的排序）');

    // 喜欢 2、4 → 排前面，各自组内保持原相对顺序（稳定排序）
    ctx.state = { browse: b({ liked: new Set(['2', '4']) }) };
    const sorted = await f(items);
    eq(ids(sorted), '2,4,1,3', '喜欢的排前面，其余保持原相对顺序（稳定排序）');
    eq(sorted.length, items.length, '喜欢**不隐藏任何东西**（只重排，不删）');

    // 喜欢 + 隐藏黑名单：两条规则叠加，先过滤再置顶
    ctx.state = { browse: b({ liked: new Set(['4']), blocked: new Set(['2']) }) };
    const both = await f(items);
    eq(ids(both), '4,1,3', '先按黑名单过滤，再把喜欢的置顶');

    // 只有喜欢、没有别的筛选 → 全量保留
    ctx.state = { browse: b({ liked: new Set(['1', '2', '3', '4']) }) };
    const allLiked = await f(items);
    eq(ids(allLiked), '1,2,3,4', '全都喜欢时顺序保持原样');

    // 源码级：喜欢分支里只有 sort，没有 filter（口径不能变成「只看喜欢」）
    t('applyLocalFilter 的 liked 分支只排序、不过滤',
      () => /if \(b\.liked\.size\) \{[\s\S]{0,260}\.slice\(\)\.sort\(/.test(m[0]) || '缺失');
    t('置顶只作用于传进来的这一页（没有全站/翻页参数）',
      () => /applyLocalFilter\(items\)/.test(m[0]) || '签名变了，要复核「全站置顶」的口径');
  }

  // ============================================================== 7. 接线（源码级）

  console.log('\n[7] 渲染层 / 主进程接线（源码级断言）');
  {
    const html = fs.readFileSync(HTML, 'utf8');
    const css = fs.readFileSync(CSS, 'utf8');
    const pre = fs.readFileSync(PRELOAD, 'utf8');
    const ipc = fs.readFileSync(IPC, 'utf8');
    const paths = fs.readFileSync(PATHS, 'utf8');

    // ---- 顶部筛选 ----
    t('index.html 有 #likeTabs', () => /id="likeTabs"/.test(html) || '缺失');
    t('#likeTabs 里是「只看喜欢」按钮（data-onlyliked）', () => /data-onlyliked/.test(html) || '缺失');
    t('CSS 有 .tabs.liked 选中态', () => /\.tabs\.liked button\.on\{/.test(css) || '缺失');

    // ---- 卡片按钮 ----
    t('browseCard 用 voteHtml(n) 画投票按钮', () =>
      /function browseCard\(n\)[\s\S]{0,2600}\$\{voteHtml\(n\)\}/.test(code) || '缺失');
    t('旧的「🚫 不喜欢」文字按钮已移除', () => !/🚫 不喜欢</.test(code) || '还残留文字按钮');
    t('旧的 noBtn 变量已移除', () => !/const noBtn = /.test(code) || '还残留 noBtn');
    t('data-like 的点击处理在 .card 之前', () => {
      const iLike = code.indexOf("t.closest('[data-like]')");
      const iCard = code.indexOf("const card = t.closest('.card');");
      return (iLike > 0 && iCard > 0 && iLike < iCard) || `like@${iLike} card@${iCard}`;
    });
    t('data-dislike 的点击处理在 .card 之前', () => {
      const iDis = code.indexOf("t.closest('[data-dislike]')");
      const iCard = code.indexOf("const card = t.closest('.card');");
      return (iDis > 0 && iCard > 0 && iDis < iCard) || `dislike@${iDis} card@${iCard}`;
    });

    // ---- 图标按钮的样式 ----
    t('CSS 有 .vote 容器（绝对定位贴在封面右下角）', () => /\.vote\{[\s\S]{0,200}position:absolute/.test(css) || '缺失');
    t('CSS 有 .vbtn', () => /\.vbtn\{/.test(css) || '缺失');
    t('CSS 有 .vbtn.up.on（点亮色）', () => /\.vbtn\.up\.on\{/.test(css) || '缺失');
    t('CSS 有 .vbtn.down.on（点亮色）', () => /\.vbtn\.down\.on\{/.test(css) || '缺失');
    t('图标用 currentColor（这样才能靠 on 类整体变色）', () => /fill="currentColor"/.test(code) || '缺失');

    // ---- 立即生效 ----
    t('likeMod 先改内存集合再落盘（立刻生效）', () =>
      /async function likeMod[\s\S]{0,600}b\.liked\.add\(id\)[\s\S]{0,600}window\.api\.favorites\.add/.test(code) || '缺失');
    t('unlikeMod 先删集合再落盘', () =>
      /async function unlikeMod[\s\S]{0,400}b\.liked\.delete\(id\)[\s\S]{0,1400}window\.api\.favorites\.remove/.test(code) || '缺失');
    t('unlikeMod 在「只看喜欢」视图里会把卡片摘掉', () =>
      /async function unlikeMod[\s\S]{0,600}if \(b\.onlyLiked\) \{[\s\S]{0,300}removeBrowseCard\(id\)/.test(code) || '缺失');
    t('注释里写明「喜欢不隐藏任何东西」（防止后人照抄黑名单的过滤口径）',
      () => /喜欢\*\*不隐藏任何东西\*\*|喜欢不隐藏任何东西/.test(code) || '缺失');
    t('likeMod 的注释写明「取消喜欢在 unlikeMod 里」', () =>
      /取消喜欢/.test(code) || '缺失');

    // ---- 「只看喜欢」本地视图 ----
    t("loadBrowse 开头分支到 loadLocalList(reset, 'liked')", () =>
      /if \(b\.onlyLiked\) return loadLocalList\(reset, 'liked'\)/.test(code) || '缺失');
    t('loadFavorites 读 favorites.ids() 建 Set', () =>
      /async function loadFavorites[\s\S]{0,400}window\.api\.favorites\.ids\(\)[\s\S]{0,200}new Set/.test(code) || '缺失');
    t('loadFavorites 取不到时不把 mod 藏掉（只当没置顶）', () =>
      /async function loadFavorites[\s\S]{0,600}catch \{[\s\S]{0,200}\}/.test(code) || '缺失');
    t('updateLikeTabs 同步选中态', () => /function updateLikeTabs\(\)[\s\S]{0,300}onlyLiked/.test(code) || '缺失');
    t('#likeTabs 点击切换 onlyLiked 并重载', () =>
      /#likeTabs'\)\.addEventListener\('click'[\s\S]{0,900}loadBrowse\(true\)/.test(code) || '缺失');
    t('「只看喜欢」与「只看黑名单」互斥（点一个关掉另一个）', () =>
      /if \(mode === 'only' && state\.browse\.onlyLiked\)/.test(code) || '缺失');
    t('空态有「只看喜欢」的专门文案', () => /还没有点过喜欢的 Mod/.test(code) || '缺失');
    t('空态提示告诉用户去哪儿点 👍', () => /在卡片右下角点 👍 就会收在这里/.test(code) || '缺失');
    t('filterSummary 会显示「只看喜欢」', () => /只看喜欢/.test(code) || '缺失');
    t('loadLocalList 的报错是两条完整字面量（避免中英混排）', () =>
      /isLiked \? '[^']*' : '[^']*'/.test(code) || '缺失');

    // ---- 启动顺序 ----
    t('启动时先拿「喜欢」再 refreshAll（否则首屏画不出点亮的 👍）', () =>
      /await loadFavorites\(\);[\s\S]{0,300}await refreshAll\(\);/.test(code) || '缺失');

    // ---- 主进程接线 ----
    t('preload 暴露 favorites.list/ids/add/remove', () =>
      /favorites:\s*\{[\s\S]{0,300}list:[\s\S]{0,200}ids:[\s\S]{0,200}add:[\s\S]{0,200}remove:/.test(pre) || '缺失');
    t('ipc 注册 favorites:list / ids / add / remove', () =>
      /handle\('favorites:list'/.test(ipc) && /handle\('favorites:ids'/.test(ipc)
      && /handle\('favorites:add'/.test(ipc) && /handle\('favorites:remove'/.test(ipc) || '缺失');
    t('ipc 在 init 里创建 favorites 单例', () => /favorites = createFavorites\(paths\.favoritesFile\)/.test(ipc) || '缺失');
    t('paths 里有 favoritesFile', () => /favoritesFile: path\.join\(DATA, 'favorites\.json'\)/.test(paths) || '缺失');
  }

  // ============================================================== 8. 隔离

  console.log('\n[8] 测试没污染真实数据目录');
  {
    const real = path.join(__dirname, '..', 'data', 'favorites.json');
    t('本套件用的是临时目录（不写 data/favorites.json）', () => FILE.startsWith(os.tmpdir()) || FILE);
    let polluted = false;
    try {
      if (fs.existsSync(real)) {
        const j = JSON.parse(fs.readFileSync(real, 'utf8'));
        polluted = (j.mods || []).some(m => m.modId === 3023 || m.modId === 7 || m.modId === 9999);
      }
    } catch { /* 读不动就当没污染 */ }
    eq(polluted, false, 'data/favorites.json 没被本套件写入测试数据');
  }
}

// ================================================================

main().then(() => {
  reset();
  console.log('');
  if (fail) {
    console.log('❌ favorites: ' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('\n失败项：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ favorites: ' + pass + ' 通过 / 0 失败');
}).catch(e => {
  console.error('套件本身崩了：', e);
  process.exit(1);
});
