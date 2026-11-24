'use strict';
/**
 * rootguard 探针 —— 「别再悄悄认错游戏目录」（2026-11-22 事故回归护栏）
 *
 * 事故经过：用户把游戏从 `c:\Star Blade` 搬到 `C:\games\Star Blade`
 * （`.sbmod\mods.json` 里 313 条记录，是活的），机器上 `D:\games\Star Blade`
 * 还留着一份旧副本（只有 1 条记录）。管理器这次启动后**悄悄**把游戏目录认成了
 * D 盘那份，还顺手新建了一个空 `.sbmod` —— 用户看到的是「Mod 全没了」。
 *
 * 根因三条，这个文件逐条盯住：
 *   A. 主进程 DEFAULT_CONFIG 里硬编码了开发机路径 `D:\games\Star Blade`，
 *      配置缺 gameRoot 时静默回落到它；
 *   B. 候选探测把 D 盘排在了 C 盘前面，且候选只是字符串，从不看「哪份带记录」；
 *   C. 没有有效目录时拿 `candidates[0]` 当默认值 —— 等于替用户拍板。
 *
 * 对应断言：
 *   A. store.js 的 gameRoot 必须是空串，且代码里不再出现 `D:\games`
 *   B. game.js 的 parents 里 C 盘早于 D 盘；导出 candidateInfo / rankCandidates；排序看 records
 *   C. rankCandidates 真跑一遍（临时目录造 3 条 vs 1 条两个游戏根）
 *   D. ipc.js 的 inspectGame() 只回报事实（current: '' + reason），不静默采用候选
 *   E. 新通道 game:chooseRoot（只选不生效）/ game:rootCandidates + preload 暴露
 *   F. 设置页三个节点接线 + 样式
 *   G. i18n：5 条中文原文在 keys.json 里，总条数 1323
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  →  ' + extra)); }
}
function eq(name, got, want) { ok(name, got === want, JSON.stringify(got) + ' ≠ ' + JSON.stringify(want)); }
function srcOf(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/**
 * 去掉注释后的「代码行」（注释行整行抹掉，行尾 `// …` 截掉）。
 *
 * ⚠️ 必须这么做：`store.js` / `ipc.js` 里**故意**用注释记着这次事故
 * （"这里曾经写着 'D:\games\Star Blade'"、"曾经拿 candidates[0] 当默认值"），
 * 逐字搜索会把「解释历史的注释」当成「还在犯的错」，天天误报。
 */
function codeLines(src) {
  return src.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return '';
    const m = line.match(/(^|[^:])\/\//);   // 行尾注释；`[^:]` 避开 http://
    return m ? line.slice(0, m.index + m[1].length) : line;
  });
}
function codeOf(src) { return codeLines(src).join('\n'); }
function codeMentions(src, needle) { return codeLines(src).filter(l => l.includes(needle)); }
function rawMentions(src, needle) { return src.split(/\r?\n/).filter(l => l.includes(needle)); }

/** 从 marker 之后第一个 `{` 起做括号配平，取出一整个块（函数体 / 对象字面量） */
function blockAt(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return '';
  const b = src.indexOf('{', i);
  if (b < 0) return '';
  let depth = 0;
  let inS = '';
  for (let k = b; k < src.length; k++) {
    const c = src[k];
    if (inS) {
      if (c === '\\') { k++; continue; }
      if (c === inS) inS = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(b, k + 1); }
  }
  return '';
}
function fnBody(src, name) { return blockAt(src, 'function ' + name); }

/* ================= A. 不许硬编码机器路径 ================= */
console.log('\n【A】DEFAULT_CONFIG 里不许有机器相关的绝对路径');
{
  const s = srcOf('src/main/store.js');
  const cfg = blockAt(s, 'DEFAULT_CONFIG');
  ok('store.js 里有 DEFAULT_CONFIG', !!cfg);

  const cfgCode = codeOf(cfg);
  ok("DEFAULT_CONFIG.gameRoot 是空串（空 = 未配置，绝不猜）",
    /gameRoot\s*:\s*''\s*,?/.test(cfgCode), cfgCode.match(/gameRoot[^\n]*/)?.[0]);

  ok('DEFAULT_CONFIG 里没有任何盘符绝对路径',
    !/[A-Za-z]:\\/.test(cfgCode), (cfgCode.match(/[A-Za-z]:\\[^'"]*/g) || []).join(' | '));

  // 这一条是那次事故的**原凶**：`D:\games\Star Blade` 曾被当成默认值写在这里。
  const code = codeOf(s);
  ok('store.js 的代码里不再出现 D:\\games（注释里记历史不算）',
    !code.includes('D:\\games') && !code.includes('D:/games'),
    codeMentions(s, 'D:\\games').concat(codeMentions(s, 'D:/games')).join(' | '));

  const raw = rawMentions(s, 'D:\\games');
  console.log('    （备注：store.js 里还有 ' + raw.length + ' 行提到 D:\\games，'
    + (raw.length ? '都在注释里 —— 说明「不许硬编码」的来由' : '一处都没有') + '）');

  ok('game.js 里也没有把它当默认值写死（只在候选探测名单里）',
    !/gameRoot\s*:\s*'D:\\/.test(codeOf(srcOf('src/main/game.js'))));
}

/* ================= B. 探测顺序与排序依据 ================= */
console.log('\n【B】game.js：C 盘优先 + 候选带记录数 + 排序看 records');
{
  const s = srcOf('src/main/game.js');
  const iC = s.indexOf("'C:\\\\games'");
  const iD = s.indexOf("'D:\\\\games'");
  ok('parents 候选名单里能同时找到 C:\\games 与 D:\\games', iC >= 0 && iD >= 0, 'C=' + iC + ' D=' + iD);
  ok('parents 里 C:\\games 排在 D:\\games 前面（系统盘优先）', iC >= 0 && iD >= 0 && iC < iD,
    'C@' + iC + ' vs D@' + iD);

  const exp = blockAt(s, 'module.exports');
  ok('导出里有 candidateInfo', exp.includes('candidateInfo'));
  ok('导出里有 rankCandidates', exp.includes('rankCandidates'));

  const body = fnBody(s, 'rankCandidates');
  ok('rankCandidates 有实现', !!body);
  ok('排序里出现 records', body.includes('records'));
  ok('排序里出现 sort', body.includes('sort'));
  ok('主排序键是 records（多的优先）',
    /b\.info\.records\s*-\s*a\.info\.records/.test(body), body.match(/b\.info\.records[^)]*/)?.[0]);

  const ciBody = fnBody(s, 'candidateInfo');
  ok('candidateInfo 会数 .sbmod\\mods.json 的记录数', /mods\.json/.test(ciBody) && /records/.test(ciBody));
  ok('candidateInfo 读不到就当 0（绝不抛）', /catch\s*\{[^}]*records\s*=\s*0/.test(ciBody));
}

/* ================= C. rankCandidates 真跑（临时目录造两个游戏根） ================= */
console.log('\n【C】rankCandidates 真跑：records 多的排前面');
{
  const game = require(path.join(ROOT, 'src/main/game.js'));
  const base = path.join(os.tmpdir(), 'sbmm-rootguard-' + process.pid + '-' + Date.now());

  /** 造一个「像样的」剑星根：exe + ~Mods 里 N 个假 pak + .sbmod\\mods.json 里 R 条记录 */
  function makeRoot(dir, records, paks) {
    fs.mkdirSync(path.join(dir, 'SB', 'Binaries', 'Win64'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SB', 'Binaries', 'Win64', 'SB-Win64-Shipping.exe'), '');
    const mods = path.join(dir, 'SB', 'Content', 'Paks', '~Mods');
    fs.mkdirSync(mods, { recursive: true });
    for (let i = 0; i < paks; i++) fs.writeFileSync(path.join(mods, 'fake' + i + '.pak'), 'x');
    fs.mkdirSync(path.join(dir, '.sbmod'), { recursive: true });
    const list = [];
    for (let i = 0; i < records; i++) list.push({ id: 'm' + i, name: 'Mod ' + i });
    fs.writeFileSync(path.join(dir, '.sbmod', 'mods.json'), JSON.stringify({ mods: list }, null, 1), 'utf8');
  }

  const A = path.join(base, 'a');   // 「活的」那份：3 条记录
  const B = path.join(base, 'b');   // 旧副本：1 条记录
  try {
    makeRoot(A, 3, 2);
    makeRoot(B, 1, 2);

    ok('临时造的 a 被认成剑星根目录', game.isGameRoot(A) === true);
    ok('临时造的 b 被认成剑星根目录', game.isGameRoot(B) === true);

    const infoA = game.candidateInfo(A);
    const infoB = game.candidateInfo(B);
    eq('candidateInfo(a).records', infoA.records, 3);
    eq('candidateInfo(b).records', infoB.records, 1);
    eq('candidateInfo(a).mods（~Mods 文件数）', infoA.mods, 2);
    ok('candidateInfo 带齐 root/mods/records/sbmodAt/mtime',
      ['root', 'mods', 'records', 'sbmodAt', 'mtime'].every(k => k in infoA),
      Object.keys(infoA).join(','));
    ok('candidateInfo 的 sbmodAt 有值（读到 mods.json 的 mtime）', !!infoA.sbmodAt, infoA.sbmodAt);

    // 事故现场就是这样：旧副本排在前面传入，结果却是活的排第一
    const ranked = game.rankCandidates([B, A]);
    eq('rankCandidates([b, a]) 的条数', ranked.length, 2);
    eq('rankCandidates([b, a])[0].root === a（记录多的排前面）', ranked[0].root, A);
    eq('排序后第一条的 records', ranked[0].records, 3);
    eq('排序后第二条的 records', ranked[1].records, 1);
    eq('排序后第二条的 root === b', ranked[1].root, B);

    // 传参顺序反过来结论必须一样（不能靠"谁先传谁第一"）
    const ranked2 = game.rankCandidates([A, B]);
    eq('rankCandidates([a, b])[0].root 仍是 a', ranked2[0].root, A);

    // 两种入参形状都要认：字符串 / 已带 root 的对象
    const ranked3 = game.rankCandidates([{ root: B }, { root: A }]);
    eq('对象形状入参也能排对', ranked3[0].root, A);

    // 空值 / 垃圾值不许炸
    const ranked4 = game.rankCandidates([null, '', '   ', undefined, B]);
    eq('空值被丢掉，只剩 b 一条', ranked4.length, 1);
    eq('rankCandidates(null) 返回空数组', game.rankCandidates(null).length, 0);
  } finally {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
    ok('临时目录已删干净', !fs.existsSync(base), base);
  }
}

/* ================= D. 不再静默采用候选 ================= */
console.log('\n【D】ipc.js：没有有效目录时只回报事实，不拿 candidates[0] 当默认值');
{
  const s = srcOf('src/main/ipc.js');
  const body = fnBody(s, 'inspectGame');
  ok('ipc.js 里有 inspectGame()', !!body);
  ok("未配置分支返回 current: ''（不冒充「当前目录」）", /current\s*:\s*''/.test(body),
    body.match(/current\s*:[^\n,]*/)?.[0]);
  ok('未配置分支给出一句 reason（人话）', /reason\s*:/.test(body));
  ok('未配置分支的 candidates 走 rankCandidates（对象数组，带记录数）', /rankCandidates/.test(body));
  ok('reason 会区分「配置无效」与「还没配置」', /无效/.test(body) && /还没有配置/.test(body));

  const code = codeOf(s);
  const bad = [
    'config.set({ gameRoot: candidates',
    'setRoot(candidates',
    'gameRoot: candidates[0]',
    'gameRoot: roots[0]',
    'candidates[0]'
  ];
  for (const p of bad) {
    ok('代码里没有「静默采用候选」的写法：' + p, !code.includes(p),
      codeMentions(s, p).slice(0, 3).join(' | '));
  }

  ok('没有有效目录时 init 只记日志、不 seed / 不写指针',
    codeOf(s).includes('game:noRoot') && !/if\s*\(!currentRoot\(\)\)\s*\{[^}]*config\.set/.test(codeOf(s)));

  // game:setRoot 换成空目录时要回报事实（而不是默默把数据 seed 到一个空副本里）
  const setRoot = blockAt(s, "handle('game:setRoot'");
  ok('game:setRoot 里算了目标目录的记录数', /candidateInfo\(root\)\.records/.test(setRoot));
  ok('game:setRoot 里备好了 warn 对象', /warn\s*=/.test(setRoot) && setRoot.includes('emptyTarget'));
  ok('warn.richer 会带上「更富的候选」和它的记录数', /richer/.test(setRoot) && /records/.test(setRoot));
}

/* ================= E. 新通道与 preload ================= */
console.log('\n【E】game:chooseRoot（只选不生效）/ game:rootCandidates + preload');
{
  const s = srcOf('src/main/ipc.js');
  ok("ipc.js 有 handle('game:chooseRoot'", s.includes("handle('game:chooseRoot'"));
  ok("ipc.js 有 handle('game:rootCandidates'", s.includes("handle('game:rootCandidates'"));

  const i = s.indexOf("handle('game:chooseRoot'");
  const j = s.indexOf("handle('game:rootCandidates'", i);
  const seg = i < 0 ? '' : s.slice(i, j > i ? j : i + 1500);
  ok('chooseRoot 弹系统目录选择框', seg.includes('showOpenDialog'));
  ok('chooseRoot 限定成「选目录」', seg.includes('openDirectory'));
  ok('chooseRoot **不写配置**（只选不生效，生效走 game:setRoot）',
    !codeOf(seg).includes('config.set'), codeMentions(seg, 'config.set').join(' | '));
  ok('chooseRoot 不擅自 seed 数据（没有 ensure 之类的副作用）',
    !/ensureModsDir|relocate|seed/i.test(codeOf(seg)),
    (codeOf(seg).match(/ensureModsDir|relocate|seed/gi) || []).join(','));
  ok('chooseRoot 取消时返回 canceled', /canceled\s*:\s*true/.test(seg));

  const k = s.indexOf("handle('game:rootCandidates'");
  const seg2 = k < 0 ? '' : s.slice(k, k + 1200);
  ok('rootCandidates 也走 rankCandidates（按记录数排序）', /rankCandidates/.test(seg2));
  ok('rootCandidates 把指针文件 / 配置 / 当前生效三个来源一起给界面',
    /pointer/.test(seg2) && /configured/.test(seg2) && /current/.test(seg2));

  const p = srcOf('src/preload/index.js');
  ok('preload 暴露 chooseRoot:', p.includes('chooseRoot:'));
  ok('preload 暴露 rootCandidates:', p.includes('rootCandidates:'));
  ok("chooseRoot 走 invoke('game:chooseRoot')", /chooseRoot:[^\n]*game:chooseRoot/.test(p));
  ok("rootCandidates 走 invoke('game:rootCandidates')", /rootCandidates:[^\n]*game:rootCandidates/.test(p));
}

/* ================= F. 界面接线 ================= */
console.log('\n【F】设置页「游戏目录」行：选目录 / 候选下拉 / 警告行');
{
  const a = srcOf('src/renderer/app.js');
  ok('app.js 有「选择目录」按钮 #btnPickRoot', a.includes('id="btnPickRoot"'));
  ok('app.js 有候选下拉 #setRootCand', a.includes('id="setRootCand"'));
  ok('app.js 有警告行 #rootWarn', a.includes('id="rootWarn"'));
  ok('app.js 调 window.api.game.chooseRoot()', a.includes('window.api.game.chooseRoot()'));
  ok('app.js 调 window.api.game.rootCandidates()', a.includes('window.api.game.rootCandidates()'));
  ok('#btnPickRoot 有点击处理', /e\.target\.id === 'btnPickRoot'/.test(a));
  ok('#setRootCand 有 change 处理（选候选后填进输入框）', /e\.target\.id === 'setRootCand'/.test(a));
  ok('选完目录只回填、不直接生效（后面还有 保存/应用 一步）', a.includes('picked'));

  const c = srcOf('src/renderer/style.css');
  ok('style.css 给了 #rootWarn 或 #setRootCand 样式',
    c.includes('#rootWarn') || c.includes('#setRootCand'));
  ok('警告行有 [hidden] 收起规则（没话说时不许占位）',
    c.includes('#rootWarn[hidden]') || c.includes('#setRootCand[hidden]'));
}

/* ================= G. i18n ================= */
console.log('\n【G】i18n：5 条新文案在册，总条数 1323');
{
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8'));
  const WANT = [
    '选择目录',
    String.raw`选一个剑星游戏目录（里面有 SB\Binaries\Win64\SB-Win64-Shipping.exe）`,
    '找到 %s 个游戏目录',
    '当前目录里只有 %s 条 Mod 记录，这些目录里有更多：',
    '这个目录里没有 Mod 记录，候选列表里另一个目录有 %s 条'
  ];
  for (const k of WANT) ok('keys.json 里有：' + k.slice(0, 24), keys.includes(k));
  eq('键表总条数', keys.length, 1323);
  ok('键表里没有重复项', new Set(keys).size === keys.length,
    keys.length - new Set(keys).size + ' 条重复');

  // 补词入口也留着这 5 条 —— 否则下次 `_rebuild-keys.js` 重建会把它们洗掉
  const mod = require(path.join(__dirname, 'i18n-add-keys.js'));
  const tableKeys = mod.TABLE.map(e => e[0]);
  for (const k of WANT) ok('i18n-add-keys.js 的 TABLE 里也有：' + k.slice(0, 16), tableKeys.includes(k));
  ok('TABLE 每条都是 13 个译文',
    mod.TABLE.every(e => e[1].length === 13),
    mod.TABLE.filter(e => e[1].length !== 13).map(e => e[0]).slice(0, 3).join(' | '));
}

console.log('');
console.log((fail ? '❌' : '✅') + ' rootguard: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
