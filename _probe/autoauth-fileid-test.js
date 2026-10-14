'use strict';
/**
 * 「自动授权前现场补 fileId」断言套件（第二十七轮）。
 *
 * ## 这一轮修的是什么
 *
 * 任务入队时 `fileId` 为空是**常态** —— 浏览页卡片直接点「下载」时抽屉还没加载
 * 文件列表，批量下载时那次 `nexus.files()` 也可能失败。而 Nexus 的站内下载弹层
 * 端点**必须按 fileId 走**，所以老逻辑直接把这类任务判成
 * 「缺少 Mod ID / 文件 ID，无法自动授权」推到用户手上点「手动」。
 *
 * 新逻辑：**只要有 modId**，就在授权前现场查一次该 mod 的主文件补上 fileId
 * （`ipc.js :: autoAuthorizeTask` → `resolvePrimaryFile` → `engine.patchMeta`）。
 *
 * ## 覆盖
 *   A. `nexus.pickPrimaryFile` 的挑选口径（纯函数，真调用）
 *   B. 它与渲染层 `app.js` 的 `pickPrimaryFile` **行为完全一致**（同用例跑两边）
 *   C. 接线：补齐发生在 `fetchNxm` **之前**，且写回 meta
 *   D. 一刀切的老判定已消失
 *   E. `engine.patchMeta` 存在 / 已导出 / 只动 meta 不动状态
 *   F. 三条分层文案同时存在于源码、keys.json 与 13 个语言包
 *   G. **fileId 失效自愈**：任务自带的 fileId 变成死号（作者更新后旧文件被归档/删掉）时，
 *      重查主文件换新 fileId 再试一次，而不是把「作者只开了手动下载」甩给用户
 *   H. **实例契约**（第二十九轮回归钉子）：`createNexus()` 返回对象上真的有 ipc.js
 *      会调的那些方法 —— 第二十七轮这里漏挂了 `pickPrimaryFile`，A~G 全绿也照样线上崩
 *
 * 用法：node _probe/autoauth-fileid-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const nexus = require('../src/main/nexus');
const IPC = read('src/main/ipc.js').replace(/\r\n/g, '\n');
const ENGINE = read('src/main/downloadEngine.js').replace(/\r\n/g, '\n');
// ⚠️ 工作区的 app.js 是 CRLF —— 下面要按 `\n}` 抽函数，必须先归一
const APP = read('src/renderer/app.js').replace(/\r\n/g, '\n');
const KEYS = JSON.parse(read('_probe/i18n-keys.json'));

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

const NEW_KEYS = [
  '这条任务没有来源 Mod ID，无法自动授权（可点「手动」）。',
  '这个 Mod 在 Nexus 上没有可下载的文件，无法自动授权（可点「手动」）。',
  '取不到这个 Mod 的文件列表（网络或接口问题），稍后再试或点「手动」。'
];
const OLD_KEY = '这条任务缺少 Mod ID / 文件 ID，无法自动授权（可点「手动」）。';

/* ================= A. pickPrimaryFile 挑选口径 ================= */

const CASES = [
  { label: '空数组 → null', files: [], want: null },
  { label: '非数组（null）→ null', files: null, want: null },
  { label: '非数组（对象）→ null', files: { fileId: 1 }, want: null },
  { label: 'primary 标记优先', files: [{ fileId: 1 }, { fileId: 2, primary: true }], want: 2 },
  { label: 'primary 在首位也认它', files: [{ fileId: 9, primary: true }, { fileId: 8 }], want: 9 },
  { label: '无 primary 时退到 MAIN', files: [{ fileId: 1 }, { fileId: 2, categoryRaw: 'MAIN' }], want: 2 },
  { label: 'primary 与 MAIN 并存时 primary 赢', files: [{ fileId: 3, categoryRaw: 'MAIN' }, { fileId: 4, primary: true }], want: 4 },
  { label: '什么都没有就取第一个', files: [{ fileId: 5 }, { fileId: 6 }], want: 5 },
  { label: '数组里有空洞（null 项）不炸', files: [null, { fileId: 7 }], want: 7 }
];

console.log('=== A. nexus.pickPrimaryFile 挑选口径 ===');
t('已从 nexus.js 导出', () => typeof nexus.pickPrimaryFile === 'function' ? true : typeof nexus.pickPrimaryFile);
for (const c of CASES) {
  t(c.label, () => {
    const f = nexus.pickPrimaryFile(c.files);
    const got = f ? f.fileId : null;
    return got === c.want ? true : '得到 ' + JSON.stringify(got);
  });
}

/* ================= B. 与渲染层同口径 ================= */

console.log('');
console.log('=== B. 与渲染层 app.js 的 pickPrimaryFile 行为一致 ===');

const m = APP.match(/function pickPrimaryFile\(files\) \{[\s\S]*?\n\}/);
t('能从 app.js 抽出该函数', () => m ? true : '没匹配到');

let rendererPick = null;
if (m) {
  const body = m[0].slice(m[0].indexOf('{') + 1, m[0].lastIndexOf('}'));
  rendererPick = new Function('files', body);
}
for (const c of CASES) {
  t('两端一致：' + c.label, () => {
    if (!rendererPick) return '拿不到渲染层实现';
    const a = nexus.pickPrimaryFile(c.files);
    const b = rendererPick(c.files);
    const av = a ? a.fileId : null, bv = b ? b.fileId : null;
    return av === bv ? true : ('主进程 ' + av + ' vs 渲染层 ' + bv);
  });
}

/* ================= C. 接线：补齐在 fetchNxm 之前 ================= */

console.log('');
console.log('=== C. autoAuthorizeTask 的接线 ===');

const fnStart = IPC.indexOf('async function autoAuthorizeTask(');
const fnEnd = IPC.indexOf('\n}\n', fnStart);
const FN = fnStart >= 0 && fnEnd > fnStart ? IPC.slice(fnStart, fnEnd) : '';

t('找得到 autoAuthorizeTask 函数体', () => FN ? true : '没匹配到（源码结构变了？）');
t('函数体里定义了 resolvePrimaryFile 调用', () => /await\s+resolvePrimaryFile\(modId\)/.test(FN) ? true : '没调用');
t('补齐分支确实以「缺 fileId」为条件', () => /if\s*\(!fileId\)\s*\{/.test(FN) ? true : '没找到 if (!fileId)');
t('补齐后写回任务 meta', () => /engine\.patchMeta\(id,\s*\{[\s\S]{0,200}?fileId/.test(FN) ? true : '没写回');
t('写回的字段含 fileName', () => /engine\.patchMeta\(id,\s*\{[\s\S]{0,300}?fileName/.test(FN) ? true : '没写 fileName');
t('写回后立刻广播（界面马上能看到补上的文件）', () => {
  const i = FN.indexOf('engine.patchMeta');
  const j = FN.indexOf('broadcastDownloads', i);
  return (i >= 0 && j > i && j - i < 400) ? true : '没有紧随的 broadcast';
});

t('★ 补齐发生在 fetchNxm **之前**（顺序错了就白补）', () => {
  const iResolve = FN.search(/await\s+resolvePrimaryFile\(modId\)/);
  const iFetch = FN.indexOf('nexusAutoAuth.fetchNxm');
  if (iResolve < 0 || iFetch < 0) return '找不到关键调用';
  return iResolve < iFetch ? true : '补齐在 fetchNxm 之后（顺序颠倒）';
});

t('fileId 是可变绑定（let），补齐后能带到 fetchNxm', () => /let\s+fileId\s*=/.test(FN) ? true : '不是 let');
t('fetchNxm 用的是补齐后的 fileId', () => {
  const i = FN.indexOf('nexusAutoAuth.fetchNxm');
  const seg = FN.slice(i, i + 200);
  return /\bmodId\b/.test(seg) && /\bfileId\b/.test(seg) ? true : '调用参数里没带 fileId';
});

console.log('');
console.log('=== C2. resolvePrimaryFile 的实现 ===');
const rpStart = IPC.indexOf('async function resolvePrimaryFile(');
const rpEnd = IPC.indexOf('\n}\n', rpStart);
const RP = rpStart >= 0 && rpEnd > rpStart ? IPC.slice(rpStart, rpEnd) : '';
t('找得到 resolvePrimaryFile', () => RP ? true : '没匹配到');
t('用 nexus.getModFiles 拉文件列表', () => /nexus\.getModFiles\(/.test(RP) ? true : '没用 getModFiles');
t('挑文件走 nexus.pickPrimaryFile（与渲染层同口径）', () => /nexus\.pickPrimaryFile\(/.test(RP) ? true : '没走 pickPrimaryFile');
t('永不抛：catch 里返回结构化失败', () => /catch\s*\(e\)\s*\{[\s\S]{0,120}?ok:\s*false/.test(RP) ? true : 'catch 里没有 ok:false');

/* ================= D. 老的一刀切判定已消失 ================= */

console.log('');
console.log('=== D. 一刀切判定已移除 ===');
t('不再有 `if (!modId || !fileId)` 这种合并判定', () =>
  /if\s*\(!modId\s*\|\|\s*!fileId\)/.test(FN) ? '还在（会把能补的任务也判死）' : true);
t('缺 modId 有单独分支', () => /if\s*\(!modId\)\s*\{/.test(FN) ? true : '没有单独处理缺 modId');
t('缺 modId 的文案与缺文件的文案不同', () => {
  const a = IPC.includes('这条任务没有来源 Mod ID');
  const b = IPC.includes('这个 Mod 在 Nexus 上没有可下载的文件');
  const c = IPC.includes('取不到这个 Mod 的文件列表');
  return (a && b && c) ? true : JSON.stringify({ a, b, c });
});

/* ================= E. engine.patchMeta ================= */

console.log('');
console.log('=== E. downloadEngine.patchMeta ===');
t('定义了 patchMeta', () => /function patchMeta\(id,\s*partial\)/.test(ENGINE) ? true : '没定义');
t('patchMeta 已导出', () => /markAuthFailed,\s*patchMeta,/.test(ENGINE) ? true : '导出列表里没有');
// ⚠️ 只截到 patchMeta 自己的结束花括号 —— 多截一点就会把后面 `retry` 里的
//    `status` 当成 patchMeta 的（这个坑本套件自己先踩过一次）。
const pmStart = ENGINE.indexOf('function patchMeta(');
const pmEndRaw = ENGINE.indexOf('\n  }\n', pmStart);
const PM = pmStart < 0 ? '' : ENGINE.slice(pmStart, pmEndRaw > pmStart ? pmEndRaw : pmStart + 600);
t('patchMeta 只合并 meta（浅合并，不覆盖整块）', () => {
  return /meta:\s*\{\s*\.\.\.\(t\.meta\s*\|\|\s*\{\}\),\s*\.\.\.partial\s*\}/.test(PM)
    ? true : '没有用浅合并写法';
});
t('patchMeta 不碰 status', () => /status/.test(PM) ? '里面出现了 status（不该改状态）' : true);
t('patchMeta 对不存在的任务安静返回 null', () =>
  /if\s*\(!t\)\s*return\s+null/.test(PM) ? true : '没做存在性检查');

/* ================= F. 分层文案 × 源码 / keys / 13 语言包 ================= */

console.log('');
console.log('=== F. 分层文案落位 ===');
for (const k of NEW_KEYS) {
  t('源码里有：「' + k.slice(0, 12) + '…」', () => IPC.includes(k) ? true : 'ipc.js 里没有');
  t('keys.json 里有：「' + k.slice(0, 12) + '…」', () => KEYS.includes(k) ? true : 'keys.json 里没有');
}
t('旧的笼统键已从 keys.json 移除', () => KEYS.includes(OLD_KEY) ? '还在' : true);
t('旧的笼统键已从 ipc.js 移除', () => IPC.includes(OLD_KEY) ? '还在' : true);

const LANGS = ['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU',
  'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL', 'tr-TR', 'th-TH'];
/** 这两种语言的译文天然含汉字，不能拿「含 CJK」当漏翻判据 */
const HAN_NATIVE = new Set(['zh-TW', 'ja-JP']);

function loadPack(lang) {
  const src = read('src/renderer/locales/' + lang + '.js');
  const captured = [];
  const sandbox = {
    window: { I18N: { register(code, dict) { captured.push({ code, dict }); } } },
    module: { exports: {} },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: lang, timeout: 10000 });
  if (!captured.length) throw new Error(lang + ' 没有调用 I18N.register()');
  return captured[0].dict;
}

for (const lang of LANGS) {
  t(lang + '：3 条新文案齐全且非空、非照抄原文', () => {
    const dict = loadPack(lang);
    for (const k of NEW_KEYS) {
      const v = dict[k];
      if (typeof v !== 'string' || !v.trim()) return '缺或空：' + k.slice(0, 12);
      if (!HAN_NATIVE.has(lang) && v === k) return '照抄了中文原文：' + k.slice(0, 12);
    }
    return true;
  });
}

/* ================= G. fileId 失效自愈 ================= */

console.log('');
console.log('=== G. fileId 失效自愈（作者更新后旧文件没了） ===');

// 从源码里**取出真身**来断言，而不是另写一份副本 —— 抄一份就失去意义了
const staleSrc = IPC.match(/const STALE_FILE_CODES = new Set\(\[([^\]]*)\]\)/);
t('定义了 STALE_FILE_CODES', () => {
  if (!staleSrc) return 'ipc.js 里没定义';
  const items = staleSrc[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return items.length ? true : '集合是空的';
});

const STALE = staleSrc
  ? new Set(staleSrc[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))
  : new Set();

for (const c of ['no_nxm', 'bad_link', 'http']) {
  t('自愈集合包含 ' + c, () => STALE.has(c) ? true : '不包含（这类失败其实该救）');
}
for (const c of ['not_logged_in', 'challenge', 'network']) {
  t('自愈集合**不含** ' + c + '（换文件也没用 / 该等一等）', () => STALE.has(c) ? '不该含' : true);
}

/** 复刻源码里的守卫表达式，逐例验证「救不救」 */
const shouldHeal = (r, fileIdResolved) => !r.ok && !fileIdResolved && STALE.has(r.code);

const HEAL_CASES = [
  { label: '旧 fileId 死号（no_nxm）→ 救', r: { ok: false, code: 'no_nxm' }, resolved: false, want: true },
  { label: '旧 fileId 死号（http 404）→ 救', r: { ok: false, code: 'http' }, resolved: false, want: true },
  { label: '坏链接（bad_link）→ 救', r: { ok: false, code: 'bad_link' }, resolved: false, want: true },
  { label: '已授权成功 → 不救', r: { ok: true }, resolved: false, want: false },
  { label: 'fileId 本就是这次查出来的 → 不重复救（防死循环）', r: { ok: false, code: 'no_nxm' }, resolved: true, want: false },
  { label: '未登录 → 不救（换文件也没用）', r: { ok: false, code: 'not_logged_in' }, resolved: false, want: false },
  { label: 'Cloudflare 挑战 → 不救（该退避）', r: { ok: false, code: 'challenge' }, resolved: false, want: false },
  { label: '网络抖动 → 不救（该重试而不是换文件）', r: { ok: false, code: 'network' }, resolved: false, want: false }
];
for (const c of HEAL_CASES) {
  t(c.label, () => {
    const got = shouldHeal(c.r, c.resolved);
    return got === c.want ? true : '得到 ' + got;
  });
}

t('源码里确实写了这个守卫', () =>
  /if\s*\(!r\.ok && !fileIdResolved && STALE_FILE_CODES\.has\(r\.code\)\)/.test(FN) ? true : '没找到守卫');

t('fileIdResolved 在「补齐分支」里被置 true', () =>
  /fileIdResolved\s*=\s*true/.test(FN) ? true : '没置位（会导致重复救 / 死循环）');

t('新旧 fileId 必须真的不同才重试（防空转）', () => {
  const i = FN.indexOf('STALE_FILE_CODES.has');
  const seg = FN.slice(i, i + 400);
  return /nf\s*!==\s*fileId/.test(seg) ? true : '没有 nf !== fileId 判断';
});

t('自愈时会写回 meta（卡片上能看到换成了哪个文件）', () => {
  const i = FN.indexOf('STALE_FILE_CODES.has');
  const seg = FN.slice(i, i + 700);
  return /engine\.patchMeta\(id,\s*\{[\s\S]{0,300}?fileId/.test(seg) ? true : '自愈分支里没 patchMeta';
});

t('自愈有独立日志事件，便于事后追因', () =>
  /logger\.event\('download:fileIdStale'/.test(FN) ? true : '没有 fileIdStale 日志');

t('自愈会带上新旧 fileId 与触发原因', () => {
  const i = FN.indexOf("logger.event('download:fileIdStale'");
  const seg = FN.slice(i, i + 260);
  const need = ['oldFileId', 'newFileId', 'cause'];
  const miss = need.filter(k => !seg.includes(k));
  return miss.length ? ('缺字段：' + miss.join(',')) : true;
});

t('自愈会重试 fetchNxm（换完新 fileId 再试一次）', () => {
  const i = FN.indexOf('STALE_FILE_CODES.has');
  const seg = FN.slice(i, i + 900);
  return /r\s*=\s*await\s+nexusAutoAuth\.fetchNxm\(/.test(seg) ? true : '自愈分支里没有重试';
});

t('★ 首次 fetchNxm → 自愈 → 失败判定，顺序正确', () => {
  const iFirst = FN.indexOf('nexusAutoAuth.fetchNxm');
  const iHeal = FN.indexOf('STALE_FILE_CODES.has');
  const iFail = FN.lastIndexOf("logger.event('download:autoauthFailed'");
  if (iFirst < 0 || iHeal < 0 || iFail < 0) return '找不到关键片段';
  if (!(iFirst < iHeal)) return '自愈跑到首次授权之前了';
  if (!(iHeal < iFail)) return '失败判定跑在自愈之前（救不回来）';
  return true;
});

t('自愈是**一次性**的，不会自己套娃（源码里只出现一个守卫）', () => {
  const n = (FN.match(/STALE_FILE_CODES\.has\(/g) || []).length;
  return n === 1 ? true : ('出现了 ' + n + ' 次');
});

t('首次 fetchNxm 用的是 let 绑定（自愈能改写它）', () => /let\s+r\s*=\s*await\s+nexusAutoAuth\.fetchNxm\(/.test(FN) ? true : '不是 let r =');

/* ================= H. 实例契约（第二十九轮回归钉子） =================
 * 第二十七轮把 `pickPrimaryFile` 写成了**模块级函数**，却在 ipc.js 里按
 * `nexus.pickPrimaryFile(...)`（**实例方法**）调用 —— 实例上根本没挂，
 * 于是所有「入队时没有 fileId」的任务（卡片直点下载 / 批量下载 / fileId 失效自愈）
 * 补齐时必抛 `nexus.pickPrimaryFile is not a function`，
 * 还被 `autoAuthorizeTask` 兜成「取不到这个 Mod 的文件列表（网络或接口问题）」。
 *
 * ⚠️ 只断言「模块里有个 pickPrimaryFile 函数」是**抓不到这个 bug 的** ——
 *    上面 A 段就是这么写的，所以它一直全绿。修 bug 之外必须补**实例契约**断言。
 */
const NEXUS_INST = nexus.createNexus({ getApiKey: () => '' });

t('★ createNexus() 实例上挂有 pickPrimaryFile（ipc.js 走的是实例方法）',
  () => (typeof NEXUS_INST.pickPrimaryFile === 'function'
    ? true
    : '实例上没有 pickPrimaryFile —— resolvePrimaryFile 必抛 TypeError，补齐链路全废'));

t('实例方法与模块级导出是**同一个实现**（口径不会分叉）',
  () => (NEXUS_INST.pickPrimaryFile === nexus.pickPrimaryFile
    ? true
    : '两者不是同一个函数，主进程内部可能挑出不同的文件'));

t('ipc.js 的调用点确实是实例方法 `nexus.pickPrimaryFile(files)`',
  () => (/nexus\.pickPrimaryFile\(files\)/.test(IPC)
    ? true
    : 'IPC 调用点写法变了 —— 若改成裸函数名，本契约断言要一起改'));

t('ipc.js 没有改成「从模块直接解构 pickPrimaryFile」（换条路仍会漏挂）',
  () => (!/require\(['"]\.\/nexus['"]\)[\s\S]{0,120}pickPrimaryFile/.test(IPC)
    ? true
    : 'IPC 直接从模块解构了 pickPrimaryFile —— 与实例契约脱节'));

t('真实例在真文件列表上能挑出 fileId（链路端到端可用）', () => {
  const f = NEXUS_INST.pickPrimaryFile([
    { fileId: 10001, categoryRaw: 'MAIN', primary: false },
    { fileId: 10002, categoryRaw: 'OPTIONAL', primary: false }
  ]);
  return (f && Number(f.fileId) === 10001) ? true : '没挑出第一个 MAIN';
});

console.log('');
console.log('---');
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
