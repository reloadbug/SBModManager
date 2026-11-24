'use strict';
/**
 * 批量解析（`src/main/linker.js`）：本地已装 Mod ↔ Nexus 条目的关联。
 *
 * 用户诉求（2026-11-06）：
 *   「从新设置了游戏目录，游戏内有大量已安装 mod，提供批量解析的功能，
 *     将本地 mod 与 nexus 上 mod 进行关联，并且获取 mod 的基本信息」
 *
 * 覆盖四块：
 *   1. 名字清洗 —— 落到 `~Mods` 里的文件名五花八门（`xxx_P.dekcns`、
 *      `yuyu_ModName-pak-json`、`[作者]名字`），不清洗干净后面全是噪声；
 *   2. 打分与分级 —— 高置信才能被「一键接受」，歧义/单薄名必须降档；
 *   3. 关联存储 —— 键是扫描条目 id，写盘原子、可删可查；
 *   4. 接线 —— ipc / preload / 渲染层 / index.html 该有的钩子都在。
 *
 * 纯 Node：不联网、不打真实 data/，全部用临时文件 + 假目录。
 * 运行：`npm run test:linker`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const L = require('../src/main/linker');

const TMP = path.join(os.tmpdir(), 'sb-linker-test');
const LINKS = path.join(TMP, 'mod-links.json');
const CATALOG = path.join(TMP, 'nexus-catalog.json');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const HTML = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const CSS = path.join(__dirname, '..', 'src', 'renderer', 'style.css');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');
const SCANNER = path.join(__dirname, '..', 'src', 'main', 'scanner.js');

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

const read = (f) => fs.readFileSync(f, 'utf8');

// ================================================================ 1. 名字清洗

console.log('\n[1] normalizeName：把磁盘上的文件名洗成可用于比对的词串');
{
  t('去掉 .dekcns 后缀', () => (L.normalizeName('yunwu2333CNS-A_SEXY_GIRL_910.dekcns') === 'yunwu cns sexy girl'));
  t('CamelCase 会被拆开', () => (L.normalizeName('105EVEPinkBodysuit_P.pak') === 'eve pink bodysuit'));
  t('尾部编号 token 被丢掉', () => (L.normalizeName('Devil_cns_651') === 'devil cns'));
  t('方括号里的作者名被去掉', () => (L.normalizeName('[songeda]whitepearl349') === 'whitepearl'));
  t('中文/全角括号内容被去掉', () => (L.normalizeName('圣洁服装（v2.1）_P') === '圣洁服装'));
  t('多重后缀一次剥干净', () => (L.normalizeName('Angel_CNS.pak.json.disabled') === 'angel cns'));
  t('空值不炸', () => (L.normalizeName('') === '' && L.normalizeName(null) === ''));
  t('相同内容不同写法的归一结果一致', () =>
    L.normalizeName('Dailys Knitted-Dress-3214_P.pak') === L.normalizeName('dailys_knitted_dress_3214'));
}

// ================================================================ 2. 打分与分级

console.log('\n[2] buildIndex / suggestFor：本地名 → Nexus 候选');
{
  const catalog = [
    { modId: 1591, name: 'Eve - Pink Bodysuit', author: 'someone', version: '1.2', downloads: 120000, pictureUrl: 'https://x/1591.jpg', url: 'https://www.nexusmods.com/stellarblade/mods/1591' },
    { modId: 3834, name: 'Daily Knitted Dress', author: 'kkkk', version: '2.0', downloads: 45000 },
    { modId: 3210, name: 'Undressable Motivation Resonance', author: 'abc', version: '1.0', downloads: 33000 },
    { modId: 2609, name: 'SantaEve', author: 'santa', version: '1.0', downloads: 9000 },
    { modId: 543, name: "Racer's High Outfit", author: 'r1', version: '1.0', downloads: 20000 },
    { modId: 1817, name: "Racer's High Edit", author: 'r2', version: '1.0', downloads: 19000 },
    { modId: 2694, name: "Racer's High Dress", author: 'r3', version: '1.0', downloads: 18000 },
    { modId: 7777, name: 'Unrelated Armor Set', author: 'zzz', version: '1.0', downloads: 500 }
  ];
  const index = L.buildIndex(catalog);
  eq(index.size, catalog.length, 'buildIndex 收录了全部条目');

  const pink = L.suggestFor({ id: 'disk:paks:105EVEPinkBodysuit_P', name: '105EVEPinkBodysuit_P' }, index);
  eq(pink.best && pink.best.modId, 1591, '`105EVEPinkBodysuit_P` → 1591 Eve - Pink Bodysuit');
  eq(pink.best.confidence, 'high', '这个是高置信');
  t('高置信 + 明显领先 → isConfident 为真', () => L.isConfident(pink) === true);
  eq(pink.best.name, 'Eve - Pink Bodysuit', '候选里带回正式名（要写进关联记录）');
  eq(typeof pink.best.score, 'number', '带回分数');

  const knit = L.suggestFor({ id: 'x1', name: '32A Daily Knitted Edit-3214_P' }, index);
  eq(knit.best && knit.best.modId, 3834, '带杂词的 `32A Daily Knitted Edit-3214_P` 也能对上 Daily Knitted Dress');

  const reso = L.suggestFor({ id: 'x2', name: '25_UndressableMotivationResonance_P' }, index);
  eq(reso.best && reso.best.modId, 3210, '`25_UndressableMotivationResonance_P` → 3210');

  // 歧义：一堆 Racer's High 变体，分数挤在一起 → 必须降档
  const racer = L.suggestFor({ id: 'x3', name: "41A Racer's High Edit-4114_P" }, index);
  eq(racer.ambiguous, true, '三个 0.03 内的近似候选 → 标 ambiguous');
  t('歧义项不再给出高置信（防一键接受错关联）', () => racer.candidates.every(c => c.confidence !== 'high') === true);

  // 单薄名：一个 token 且很短 → 降档
  const santa = L.suggestFor({ id: 'x4', name: 'santa_P.dekcns' }, index);
  eq(santa.thin, true, '只有一个短 token → 标 thin');
  t('单薄名不给高置信', () => santa.best && santa.best.confidence !== 'high');

  // 完全没有共享词 → 无候选（宁可空着，也不瞎猜）
  const none = L.suggestFor({ id: 'x5', name: 'AiK_CH57_4024' }, index);
  t('纯代号名不要硬凑候选', () => (none.best === null ? true : `不该有 best，却有 ${none.best.modId}`));

  // 候选上限
  const many = L.buildIndex(Array.from({ length: 40 }, (_, i) => ({ modId: 1000 + i, name: 'Same Name ' + i, downloads: i })));
  const big = L.suggestFor({ id: 'y', name: 'Same Name' }, many, { limit: 5 });
  t('候选数量受 limit 限制', () => (big.candidates.length <= 5 ? true : String(big.candidates.length)));

  // 同分时用下载量兜底
  const tie = L.buildIndex([
    { modId: 11, name: 'Twin Outfit', downloads: 10 },
    { modId: 22, name: 'Twin Outfit', downloads: 9999 }
  ]);
  const tieRes = L.suggestFor({ id: 'z', name: 'Twin Outfit' }, tie);
  eq(tieRes.best.modId, 22, '完全同名时先按分数、同分按下载量挑更热门的');
  eq(tieRes.best.score, 1, '完全同名给满分 1');
}

// ================================================================ 3. 关联存储

console.log('\n[3] mod-links.json：写 / 读 / 删 / 按 modId 清理');
reset();
{
  const reader0 = L.linkReader(LINKS);
  eq(reader0.count(), 0, '文件不存在时是空表（不抛错）');
  eq(reader0.get('disk:paks:aaa'), null, '空表 get() = null');

  L.putLink(LINKS, 'disk:paks:aaa', { modId: 1591, name: 'Eve - Pink Bodysuit', confidence: 'high', score: 0.94, pictureUrl: 'https://x/1.jpg' });
  const r1 = L.linkReader(LINKS);
  eq(r1.count(), 1, '写入后 count = 1');
  eq(r1.get('disk:paks:aaa').modId, 1591, '按本地条目 id 取回');
  t('putLink 自动补 at 时间戳', () => typeof r1.get('disk:paks:aaa').at === 'string');

  L.putLink(LINKS, 'disk:paks:aaa', { modId: 3834, name: 'Daily Knitted Dress', confidence: 'manual' });
  const r2 = L.linkReader(LINKS);
  eq(r2.count(), 1, '同一个 localId 再写一次是覆盖，不是追加');
  eq(r2.get('disk:paks:aaa').modId, 3834, '内容是最后一次写入的');

  L.putLink(LINKS, 'disk:script:SomeScriptMod', { modId: 3834, name: 'Daily Knitted Dress' });
  eq(L.linkReader(LINKS).count(), 2, '脚本 Mod 用目录名当键，也存得下');

  eq(L.removeLink(LINKS, 'disk:paks:aaa'), true, 'removeLink 删得掉');
  eq(L.removeLink(LINKS, 'disk:paks:aaa'), false, '再删一次返回 false（幂等）');
  eq(L.linkReader(LINKS).count(), 1, '删完只剩脚本那条');

  L.putLink(LINKS, 'disk:paks:bbb', { modId: 3834, name: 'Daily Knitted Dress' });
  eq(L.removeLinksByModId(LINKS, 3834), 2, '按 modId 一次性清掉两条关联');
  eq(L.linkReader(LINKS).count(), 0, '清干净了');

  eq(L.readLinks(LINKS).version, L.LINK_VERSION, '存盘文件带 version（将来好迁移）');
}

// ================================================================ 4. 合并进扫描结果

console.log('\n[4] applyToScanned：只给「没登记」的条目补来源信息');
reset();
{
  L.putLink(LINKS, 'disk:paks:aaa', {
    modId: 1591, name: 'Eve - Pink Bodysuit', author: 'someone', version: '1.2',
    summary: 'pink', pictureUrl: 'https://x/1.jpg', image: '/data/images/1591.jpg',
    url: 'https://www.nexusmods.com/stellarblade/mods/1591'
  });
  const reader = L.linkReader(LINKS);

  const scanned = [
    { id: 'disk:paks:aaa', name: 'aaa', kind: 'pak', registered: false, meta: null },
    { id: 'disk:paks:bbb', name: 'bbb', kind: 'pak', registered: false, meta: null },
    {
      id: 'reg:123', name: 'Real Name', kind: 'pak', registered: true,
      meta: { source: { modId: 999, fileId: 5, version: '9.9' } }
    }
  ];
  L.applyToScanned(scanned, reader);

  const a = scanned[0];
  eq(a.name, 'Eve - Pink Bodysuit', '卡片标题换成 Nexus 正式名');
  eq(a.linked, true, '打上 linked 标记（界面据此显示「已关联」）');
  eq(a.meta.source.modId, 1591, 'meta.source.modId 有了 → localState 认它是已安装');
  eq(a.meta.source.fileId, null, 'fileId 是 null（没装过具体文件，不能瞎填）');
  eq(a.meta.image, '/data/images/1591.jpg', '封面走本地缓存图');
  eq(a.meta.url, 'https://www.nexusmods.com/stellarblade/mods/1591', '抽屉里能给出来源链接');
  eq(a.meta.modId, 1591, 'meta.modId 也补上（groupInstalled 用它分组）');

  eq(scanned[1].linked, undefined, '没关联的条目一个字段都不动');
  eq(scanned[1].meta, null, '没关联的条目 meta 保持原样');

  eq(scanned[2].name, 'Real Name', '已登记条目不会被猜出来的关联覆盖');
  eq(scanned[2].meta.source.modId, 999, '已登记条目的真实来源保持原值');
  t('reader 为 null 时原样返回', () => L.applyToScanned(scanned, null) === scanned);
}

// ================================================================ 5. 目录缓存与抓取

console.log('\n[5] readCatalog / loadCatalog：缓存 7 天，抓取按页推进');
reset();
{
  eq(L.readCatalog(CATALOG), null, '没有缓存文件 → null');

  // 假 Nexus：3 页共 5 条，验证分页拼接 + 去重 + 落盘
  const all = Array.from({ length: 5 }, (_, i) => ({
    modId: 100 + i, name: 'Mod ' + i, author: 'a' + i, downloads: 5 - i,
    pictureUrl: 'https://x/' + i + '.jpg', url: 'https://www.nexusmods.com/stellarblade/mods/' + (100 + i)
  }));
  let calls = 0;
  const fakeNexus = {
    listMods: async ({ offset, count }) => {
      calls++;
      const items = all.slice(offset, offset + count);
      return { total: all.length, offset, count: items.length, items };
    }
  };
  const progress = [];
  return (async () => {
    const res = await L.loadCatalog({
      file: CATALOG, nexus: fakeNexus, force: true, pageDelay: 0,
      onProgress: (p) => progress.push(p)
    });
    eq(res.fromCache, false, '强制抓取时不标 fromCache');
    eq(res.mods.length, 5, '抓到全部 5 条');
    eq(calls, 1, '一页就取完（count=80，一页装得下）');
    t('进度回调被调用过', () => (progress.length >= 1 ? true : '没有回调'));
    eq(progress[progress.length - 1].loaded, 5, '最后一次进度是 5 条');

    const cached = L.readCatalog(CATALOG);
    eq(cached.mods.length, 5, '落盘后能读回来');
    eq(typeof cached.fetchedAt, 'number', '记下抓取时间');
    eq(cached.stale, false, '刚抓的不过期');

    const res2 = await L.loadCatalog({ file: CATALOG, nexus: fakeNexus, pageDelay: 0 });
    eq(res2.fromCache, true, '7 天内复用缓存，不再打接口');
    eq(calls, 1, '确实没有再发请求');

    // 过期 → 必须重抓
    const json = JSON.parse(read(CATALOG));
    json.fetchedAt = Date.now() - L.CATALOG_TTL_MS - 1000;
    fs.writeFileSync(CATALOG, JSON.stringify(json), 'utf8');
    eq(L.readCatalog(CATALOG).stale, true, '超过 7 天标 stale');

    // 版本不对就整份作废（将来改结构时不留旧数据）
    json.version = 999;
    fs.writeFileSync(CATALOG, JSON.stringify(json), 'utf8');
    eq(L.readCatalog(CATALOG), null, 'version 不匹配 → 当作没有缓存');

    // 取消：shouldStop 立刻抛「已取消」，不能把半份目录写进缓存
    let stopAfter = 0;
    const slowNexus = {
      listMods: async ({ offset, count }) => {
        stopAfter++;
        const items = all.slice(offset, offset + Math.min(count, 2));
        return { total: 100, offset, count: items.length, items };
      }
    };
    let err = '';
    try {
      await L.loadCatalog({
        file: path.join(TMP, 'cancel-catalog.json'), nexus: slowNexus, force: true, pageDelay: 0,
        shouldStop: () => stopAfter >= 2
      });
    } catch (e) { err = e.message; }
    eq(err, '已取消', '取消时抛「已取消」');
    eq(fs.existsSync(path.join(TMP, 'cancel-catalog.json')), false, '取消后不留半份缓存');

    finish();
  })().catch(e => { fail++; console.error('  异步段落异常：' + e.message); finish(); });
}

function finish() {
  // ============================================================== 6. 接线

  console.log('\n[6] 接线：ipc / preload / 渲染层 / index.html');
  {
    const ipc = read(IPC);
    const preload = read(PRELOAD);
    const app = read(APP);
    const html = read(HTML);
    const css = read(CSS);
    const scanner = read(SCANNER);

    for (const ch of ['linker:state', 'linker:resolve', 'linker:cancel', 'linker:apply', 'linker:unlink', 'linker:search']) {
      t('ipc 注册了 ' + ch, () => (ipc.includes(`handle('${ch}'`) || ipc.includes(`handleWithEvent('${ch}'`) ? true : '没找到'));
    }
    t('解析进度走 linker:progress 事件', () => (ipc.includes("'linker:progress'") ? true : '没找到'));
    t('ipc 里各处扫描都带上了关联视图', () => {
      // 现在所有扫描统一走 scanAll()（里面 = scanner.scan + 文件归属补挂），
      // 关联视图在 scanAll 内部包好了，不再各处手写。
      const calls = (ipc.match(/scanAll\(root\)/g) || []).length;
      const inner = /function scanAll\(root\)[\s\S]{0,300}?scanner\.scan\(root, registry, linkReaderSafe\(\)\)/.test(ipc);
      if (calls < 4) return `只有 ${calls} 处调用 scanAll`;
      if (!inner) return 'scanAll 里没把关联视图传进去';
      return true;
    });
    t('卸载时顺手清掉关联记录', () => (ipc.includes('linker.removeLink(paths.modLinksFile, id)') ? true : '没找到'));

    for (const fn of ['state:', 'resolve:', 'cancel:', 'apply:', 'unlink:', 'search:', 'onProgress:']) {
      t('preload 暴露 linker.' + fn, () => (preload.includes(fn) ? true : '没找到'));
    }
    t('preload 订阅 linker:progress', () => (preload.includes("ipcRenderer.on('linker:progress'") ? true : '没找到'));

    t('设置页里有「批量解析」按钮', () => (app.includes('id="btnLinker"') && app.includes('<h3>工具</h3>') ? true : '没找到'));
    t('顶栏不再放批量解析', () => (html.includes('id="btnLinker"') ? '顶栏还有' : true));

    t('app.js 用点击委托兜住 #btnLinker', () => (app.includes("e.target.id === 'btnLinker'") && app.includes('openLinkerModal()') ? true : '没找到'));
    t('app.js 有复核弹窗的入口', () => (app.includes('function openLinkerModal()') ? true : '没找到'));
    t('app.js 有应用入口', () => (app.includes('function applyLinkerChoices()') ? true : '没找到'));
    t('卡片标签认「已关联」', () => (app.includes("g.linked ? '已关联'") ? true : '没找到'));
    t('抽屉里有「解除关联」按钮', () => (app.includes('data-gunlink') ? true : '没找到'));
    t('解除关联的处理函数在', () => (app.includes('async function doUnlinkGroup(') ? true : '没找到'));
    t('弹窗按钮 lStart/lApply/lClose 都有分支', () =>
      (app.includes("id === 'lStart'") && app.includes("id === 'lApply'") && app.includes("id === 'lClose'") ? true : '缺分支'));
    t('下拉框改动会同步回 rows', () => (app.includes('linkerSyncFromDom') ? true : '没找到'));
    t('分组带 linked / link 字段', () => (app.includes('linked: items.some(m => m.linked)') ? true : '没找到'));

    t('style.css 有复核表样式', () => (css.includes('.lrow{') && css.includes('.lconf.high') ? true : '没找到'));
    // 复核表曾在真机上把下拉框撑出弹窗（出现横向滚动条、当地名字被压到几个字）。
    // 修法是「不写死宽度 + 行不许被压缩」，这两条断言就是防它退回去。
    t('复核表的下拉框不写死宽度（真机回归）', () => {
      const block = css.slice(css.indexOf('.lsel{'), css.indexOf('.lsel select'));
      const selRule = css.slice(css.indexOf('.lsel select'), css.indexOf('.lsel select') + 320);
      if (/width:\s*420px/.test(selRule) || /width:\s*4\d\dpx/.test(selRule)) return '下拉框又写死宽度了';
      if (!/min-width:0/.test(block)) return '.lsel 缺 min-width:0，长候选名会撑破行';
      if (!/width:100%/.test(selRule)) return '.lsel select 应随容器收缩（width:100%）';
      return true;
    });
    t('复核表的行不被纵向压缩（flex:none）', () => {
      const i = css.indexOf('.lrow{');
      const rule = css.slice(i, i + 240);
      return /flex:none/.test(rule) ? true : '.lrow 缺 flex:none，行会被压扁、第二行信息被裁掉';
    });
    t('复核表禁掉横向滚动', () => (css.includes('overflow-x:hidden') ? true : '缺 overflow-x:hidden'));

    t('scanner.scan 接受第 3 个参数并合并关联', () =>
      (scanner.includes('function scan(root, registry, links = null)') && scanner.includes('linker.applyToScanned(out, links)') ? true : '没找到'));
    t('scanner 在最后一步合并（archive 之后）', () =>
      (scanner.indexOf('linker.applyToScanned') > scanner.indexOf('m.archive = archiveInfo') ? true : '顺序不对'));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exitCode = 1;
  }
}
