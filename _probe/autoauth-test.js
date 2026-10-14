'use strict';
/**
 * 「免点击自动授权」离线断言套件。
 *
 * 覆盖三块：
 *   A. `nexusAutoAuth` 的纯函数 —— URL 构造 + 弹层解析 + 失败分类
 *      （夹具 `_probe/fixtures/nexus-download-popup.html` 是从**真实响应**脱敏来的）
 *   B. 接线断言 —— 四个入口（入队自动 / 单条 / 全部 / 设置开关）是否真的连上了
 *   C. 串行流水线的存在性 —— 防回归：不能又变成「每条各自起一个请求」
 *
 * 用法：node _probe/autoauth-test.js
 */
const fs = require('fs');
const path = require('path');

const aa = require('../src/main/nexusAutoAuth');
const nxm = require('../src/main/nxm');

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const FIXTURE = read('_probe/fixtures/nexus-download-popup.html');

console.log('=== A. 纯函数：URL 构造 ===');
t('stellarblade → game_id=7804', () => {
  const u = aa.popupUrl({ fileId: 8509 });
  return u === 'https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=8509&game_id=7804&nmm=1'
    ? true : u;
});
t('显式 gameId 优先', () => aa.popupUrl({ fileId: 1, gameId: 999 }).includes('game_id=999') ? true : '没生效');
t('不认识的游戏域抛错', () => {
  try { aa.popupUrl({ game: 'skyrimspecialedition', fileId: 1 }); return '没抛';
  } catch (e) { return /不认识的游戏域/.test(e.message) ? true : e.message; }
});
t('fileId 非法抛错', () => {
  try { aa.popupUrl({ fileId: 0 }); return '没抛';
  } catch (e) { return /fileId/.test(e.message) ? true : e.message; }
});
t('fileId 是字符串也能用', () => aa.popupUrl({ fileId: '8509' }).includes('id=8509') ? true : '不行');

console.log('');
console.log('=== A2. 纯函数：弹层解析（真实夹具）===');
const real = aa.parsePopup(FIXTURE);
t('真实弹层 → ok', () => real.ok === true ? true : JSON.stringify(real));
t('拿到 key', () => real.info.key === 'FIXTUREKEY_NOT_REAL' ? true : String(real.info.key));
t('拿到 expires（数字）', () => Number.isFinite(real.info.expires) && real.info.expires > 0 ? true : String(real.info.expires));
t('拿到 game / modId / fileId', () =>
  (real.info.game === 'stellarblade' && real.info.modId === 1461 && real.info.fileId === 8509)
    ? true : JSON.stringify([real.info.game, real.info.modId, real.info.fileId]));
t('文件名从 <h2> 里读出来', () => real.fileName === 'CNS_ShadowKunoichi725' ? true : JSON.stringify(real.fileName));
t('`&amp;` 被解码（key 里不会混进实体）', () => !/&amp;/.test(real.nxm) ? true : real.nxm);

console.log('');
console.log('=== A3. 纯函数：失败分类 ===');
t('Cloudflare 挑战页 → challenge', () => aa.parsePopup('<title>Just a moment...</title>Ray ID: abc').code === 'challenge' ? true : '没认出');
t('中文挑战页 → challenge', () => aa.parsePopup('<p>正在进行安全验证</p>').code === 'challenge' ? true : '没认出');
t('未登录 → not_logged_in', () => aa.parsePopup('<h2>Please login or signup to download this file</h2>').code === 'not_logged_in' ? true : '没认出');
t('大小写/空格变体也能认', () => aa.parsePopup('<h2>PLEASE  LOG IN OR SIGN UP</h2>').code === 'not_logged_in' ? true : '没认出');
t('没有 nxm → no_nxm', () => aa.parsePopup('<div class="widget-download"><h2>X</h2></div>').code === 'no_nxm' ? true : '没认出');
t('空字符串 → no_nxm（不抛）', () => aa.parsePopup('').code === 'no_nxm' ? true : '没认出');
t('null → no_nxm（不抛）', () => aa.parsePopup(null).code === 'no_nxm' ? true : '没认出');
t('nxm 缺 key → bad_link', () => aa.parsePopup('<input id="dl_link" value="nxm://stellarblade/mods/1/files/2">').code === 'bad_link' ? true : '没认出');
t('单引号属性也能解析', () => {
  const r = aa.parsePopup("<input id='dl_link' value='nxm://stellarblade/mods/1461/files/8509?key=K&expires=123'>");
  return (r.ok && r.info.key === 'K') ? true : JSON.stringify(r);
});
t('属性顺序颠倒（value 在前）也能解析', () => {
  const r = aa.parsePopup('<input value="nxm://stellarblade/mods/1461/files/8509?key=K2&expires=9" id="dl_link">');
  return (r.ok && r.info.key === 'K2') ? true : JSON.stringify(r);
});
t('id 改名后靠全文兜底仍能抓到', () => {
  const r = aa.parsePopup('<p>whatever</p><a href="nxm://stellarblade/mods/1461/files/8509?key=FALL&expires=7">x</a>');
  return (r.ok && r.info.key === 'FALL') ? true : JSON.stringify(r);
});
t('挑战页优先于「没有 nxm」判定', () => {
  // 挑战页里不会有 nxm，但**顺序**错了会报成 no_nxm，让用户以为作者没开按钮
  const r = aa.parsePopup('<title>Just a moment...</title><p>Ray ID: x</p>');
  return r.code === 'challenge' ? true : r.code;
});

console.log('');
console.log('=== A3b. 失败分类：「文件刚上传、还没同步好」===');
// 现场：作者 13:41:28 传完文件，13:44:00 去要链接就是 no_nxm（文件才 2.5 分钟大），
// 而同作者 3.7 小时前上传的另一个文件一次就拿到。老逻辑把这句说成「作者只开了手动下载」。
t('站方原话（being uploaded to our file servers）→ file_not_ready', () =>
  aa.parsePopup('<p>The file is currently being uploaded to our file servers and it will be ready to be downloaded soon.</p>').code === 'file_not_ready'
    ? true : '没认出');
t('「ready to be downloaded soon」单独出现也能认', () =>
  aa.parsePopup('<div>It will be ready to be downloaded soon.</div>').code === 'file_not_ready' ? true : '没认出');
t('「not yet available for download」也能认', () =>
  aa.parsePopup('<div>This file is not yet available for download</div>').code === 'file_not_ready' ? true : '没认出');
t('大小写变体也能认', () =>
  aa.parsePopup('<div>THE FILE IS NOT READY</div>').code === 'file_not_ready' ? true : '没认出');
t('★ 真·没有链接也没说「未就绪」→ 仍是 no_nxm（不能把作者的锅一并洗掉）', () =>
  aa.parsePopup('<div class="widget-download"><h2>X</h2></div>').code === 'no_nxm' ? true : '被误判成未就绪');
t('挑战页优先于「未就绪」判定（顺序反了会把 CF 拦截图说成等几分钟）', () =>
  aa.parsePopup('<title>Just a moment...</title><p>file is not ready</p>').code === 'challenge' ? true : '顺序错了');
t('未登录优先于「未就绪」判定', () =>
  aa.parsePopup('<h2>Please login or signup</h2><p>file is not ready</p>').code === 'not_logged_in' ? true : '顺序错了');
t('导出 NOT_READY_RE（探针可离线断言）', () => aa.NOT_READY_RE instanceof RegExp ? true : '没导出');
t('失败时带回 snippet 供日志排查（剥标签、压空白）', () => {
  const r = aa.parsePopup('<html><body>\n  <h1>Whatever</h1>\n  <p>第二行</p>\n</body></html>');
  return (typeof r.snippet === 'string' && /Whatever/.test(r.snippet)
    && !/<[a-z]/i.test(r.snippet) && !/\n/.test(r.snippet)) ? true : JSON.stringify(r.snippet);
});
t('snippetOf 会砍掉 <script>（页面里的大块 JS 不该进日志）', () => {
  const s = aa.snippetOf('<p>hi</p><script>var a=1;</script>');
  return (!/var a/.test(s) && /hi/.test(s)) ? true : s;
});
t('snippetOf 有长度上限', () => {
  const s = aa.snippetOf('<p>' + 'x'.repeat(5000) + '</p>');
  return s.length <= aa.SNIPPET_MAX ? true : String(s.length);
});
t('成功解析时不带 snippet（省得日志里混进正常响应）', () =>
  aa.parsePopup(FIXTURE).snippet === undefined ? true : '多带了 snippet');

console.log('');
console.log('=== A5. 纯函数：「刚上传」判定与等待时长（settleDecision）===');
// 现场数据：任务创建于 13:43:59.678Z，文件上传于 13:41:28Z —— 差值 151 秒。
const S = aa.settleDecision;
t('★ no_nxm + 文件才 151 秒大 → 按未就绪处理（复现用户现场）', () => {
  const d = S({ code: 'no_nxm', ageMs: 151 * 1000 });
  const want = aa.FILE_SETTLE_MS - 151 * 1000;
  return (d.notReady === true && d.wait === want) ? true : JSON.stringify(d);
});
t('★ no_nxm + 文件已经 3.7 小时大（同作者那个成功的）→ 不按未就绪', () => {
  const d = S({ code: 'no_nxm', ageMs: 3.7 * 3600 * 1000 });
  return (d.notReady === false && d.wait === 0) ? true : JSON.stringify(d);
});
t('★★ 查不到上传时间（null）→ 不按未就绪（不能把「作者关了」说成「稍后再试」）', () => {
  const d = S({ code: 'no_nxm', ageMs: null });
  return (d.notReady === false && d.wait === 0) ? true : JSON.stringify(d);
});
t('刚好卡在宽限边界（= FILE_SETTLE_MS）→ 不再等', () => {
  const d = S({ code: 'no_nxm', ageMs: aa.FILE_SETTLE_MS });
  return (d.notReady === false && d.wait === 0) ? true : JSON.stringify(d);
});
t('wait 被上限截断（刚上传 5 秒也不会等满 3 分钟）', () => {
  const d = S({ code: 'no_nxm', ageMs: 5000 });
  return d.wait === aa.FILE_SETTLE_WAIT_MAX_MS ? true : String(d.wait);
});
t('等待上限 < 宽限期（否则「等满再问一次」是空话）', () =>
  aa.FILE_SETTLE_WAIT_MAX_MS < aa.FILE_SETTLE_MS ? true : '上限不小于宽限期');
t('页面写明「还没就绪」→ 即使查不到时间也按未就绪（只是不等）', () => {
  const d = S({ code: 'file_not_ready', ageMs: null });
  return (d.notReady === true && d.wait === 0) ? true : JSON.stringify(d);
});
t('其余失败码一律不按未就绪', () =>
  ['challenge', 'not_logged_in', 'network', 'http', 'bad_link', 'bad_args'].every(c => {
    const d = S({ code: c, ageMs: 10 * 1000 });
    return d.notReady === false && d.wait === 0;
  }) ? true : '有码被误判成未就绪');
t('负数 / NaN / 缺参不炸', () =>
  [-1, NaN, undefined, {}, null].every(v => typeof S({ code: 'no_nxm', ageMs: v }).notReady === 'boolean')
    ? true : '炸了');
t('未知码不炸（走 notReady=false）', () => S({ code: 'whatever', ageMs: 1000 }).notReady === false ? true : '误判');

console.log('');
console.log('=== A4. 失败文案 humanize ===');
t('not_logged_in 提到登录', () => /登录/.test(aa.humanize('not_logged_in')) ? true : '文案没提登录');
t('challenge 提到稍后再试 / 手动', () => /手动|稍后/.test(aa.humanize('challenge')) ? true : '文案不对');
t('no_nxm 指向手动授权', () => /手动/.test(aa.humanize('no_nxm')) ? true : '文案不对');
t('★ file_not_ready 说的是「过几分钟再点自动授权」，不再甩锅给作者', () => {
  const s = aa.humanize('file_not_ready');
  return (/再点|过几分钟|稍后/.test(s) && !/作者/.test(s)) ? true : s;
});
t('★ 两种成因的文案必须不同（一个是「作者关了」，一个是「等同步」）', () =>
  aa.humanize('no_nxm') !== aa.humanize('file_not_ready') ? true : '两条文案一样，等于没区分');
t('network 带上原始原因', () => aa.humanize('network', '请求超时').includes('请求超时') ? true : '原因丢了');
t('未知码不炸', () => typeof aa.humanize('whatever') === 'string' ? true : '不是字符串');

console.log('');
console.log('=== B. 离线可 require（顶层不能拉 electron）===');
t('nxm.js 顶层没有 electron', () => !/^const \{[^}]*\} = require\('electron'\)/m.test(read('src/main/nxm.js')) ? true : '仍在顶层');
t('nxm.js 里 app 用法都走 electronApp()', () => !/(?<![A-Za-z_.])app\./.test(read('src/main/nxm.js')) ? true : '还有裸 app.');
t('nexusAutoAuth 顶层没有 electron', () => !/require\('electron'\)/.test(read('src/main/nexusAutoAuth.js').split('/* ---------------- 网络')[0]) ? true : '仍在顶层');
t('nexusAutoAuth 顶层没有 nexusAuth', () => !/^const nexusAuth = require/m.test(read('src/main/nexusAutoAuth.js')) ? true : '仍在顶层');
t('parseNxm 离线可用', () => nxm.parseNxm('nxm://stellarblade/mods/1/files/2?key=k&expires=1').fileId === 2 ? true : '解析失败');

console.log('');
console.log('=== C. 接线：主进程 ===');
const ipc = read('src/main/ipc.js');
const eng = read('src/main/downloadEngine.js');
const pre = read('src/preload/index.js');
const app = read('src/renderer/app.js');
const store = read('src/main/store.js');

t('ipc 引入 nexusAutoAuth', () => /require\('\.\/nexusAutoAuth'\)/.test(ipc) ? true : '没引入');
t('ipc 有 download:autoAuthorize 通道', () => ipc.includes("'download:autoAuthorize'") ? true : '缺');
t('ipc 有 download:autoAuthorizeAll 通道', () => ipc.includes("'download:autoAuthorizeAll'") ? true : '缺');
t('ipc 推 download:autoauth 进度', () => ipc.includes("'download:autoauth'") ? true : '缺');
t('入队路径调 maybeAutoAuthorize', () => /if \(r\.task && !r\.duplicate\) maybeAutoAuthorize\(r\.task\.id\)/.test(ipc) ? true : '没接上');
t('maybeAutoAuthorize 受配置开关控制', () => /config\.get\('autoAuthorize'\)/.test(ipc) ? true : '没读配置');
t('批量走 enqueueAutoAuth（单一流水线）', () => /await enqueueAutoAuth\(ids\)/.test(ipc) ? true : '没走流水线');
t('串行流水线只有一条（autoAuthDrain）', () => {
  const n = (ipc.match(/let autoAuthDrain = null;/g) || []).length;
  return n === 1 ? true : '出现 ' + n + ' 次';
});
t('节流间隔存在（不是裸循环）', () => /await sleep\(autoAuthGapMs\)/.test(ipc) ? true : '没有节流');
t('未登录 → 立刻清队停下', () => /r\.code === 'not_logged_in' \|\| challengeStreak >= MAX_CHALLENGE_STREAK/.test(ipc) ? true : '没停');
t('单条撞挑战 → 放回队尾重试一次', () => /challengeRetried\.has\(id\)/.test(ipc) && /autoAuthQueue\.push\(id\)/.test(ipc) ? true : '没重试');
t('连续 3 次挑战才认定「真被拦」', () => /MAX_CHALLENGE_STREAK = 3/.test(ipc) ? true : '阈值不对');
t('撞挑战后额外冷却（叠在正常间隔上）', () => /CHALLENGE_COOLDOWN_MS = 2600/.test(ipc) ? true : '没冷却');
t('授权失败会写回任务原因', () => /engine\.markAuthFailed\(id, reason\)/.test(ipc) ? true : '没写回');
t('自动授权复用 handleIncomingNxm', () => /const task = await handleIncomingNxm\(info\)/.test(ipc) ? true : '没复用');

console.log('');
console.log('=== C2. 「文件刚上传、还没同步好」的处理（第三十一轮）===');
t('ipc 用 nexusAutoAuth.settleDecision 判定（判定逻辑只有一处）', () =>
  /nexusAutoAuth\.settleDecision\(\{ code: r\.code, ageMs: age \}\)/.test(ipc) ? true : '没调纯函数');
t('★ 上传时间只查一次（两条路径各查一次会白打两次接口）', () => {
  const n = (ipc.match(/await fileAgeMs\(modId, fileId\)/g) || []).length;
  return n === 1 ? true : '查了 ' + n + ' 次';
});
t('fileAgeMs 走 getModFiles 的文件 date', () =>
  /await nexus\.getModFiles\(Number\(modId\)\)/.test(ipc) && /Number\(f\.date\)/.test(ipc) ? true : '没查上传时间');
t('★ fileAgeMs 查不到返回 null，不用 0 兜底', () => {
  const i = ipc.indexOf('async function fileAgeMs');
  const seg = ipc.slice(i, i + 420);
  return (/if \(!d\) return null;/.test(seg) && !/return 0/.test(seg)) ? true : '用了 0 兜底（老文件会被误判成刚上传）';
});
t('★ 只有 no_nxm / file_not_ready 两种码才去查上传时间', () =>
  /if \(!r\.ok && \(notReady \|\| r\.code === 'no_nxm'\)\)/.test(ipc) ? true : '判定条件不对');
t('★ 判过「刚上传」后，最终错误码统一成 file_not_ready（重试后仍失败也别再说作者）', () =>
  /const code = notReady \? 'file_not_ready' : r\.code;/.test(ipc) ? true : '没统一错误码');
t('重试前真的睡了（不是立刻再打一次）', () =>
  /if \(d\.wait > 0\) \{[\s\S]{0,200}?await sleep\(d\.wait\);[\s\S]{0,120}?fetchNxm/.test(ipc) ? true : '没等就重试');
t('「刚上传」事件进日志，带上上传时长与等待时长', () =>
  /logger\.event\('download:fileNotReady'/.test(ipc) && /ageMs: age, waitMs: d\.wait/.test(ipc) ? true : '没记日志');
t('失败日志带上响应片段（下次 Nexus 改措辞也有据可查）', () =>
  /snippet: r\.snippet \|\| null/.test(ipc) ? true : '没记片段');
t('fetchNxm 不对 file_not_ready 做无谓重试（等多久都一样）', () =>
  /p\.code === 'file_not_ready'\) return p;/.test(read('src/main/nexusAutoAuth.js')) ? true : '还在重试');
t('★ markAuthFailed 只改 error、保持「等待授权」——按钮还能再点', () =>
  /if \(t\.status !== 'awaiting_authorization'\) return queue\.get\(id\);/.test(eng) ? true : '会改状态');
t('★ 新文案已进键表与 13 个语言包（否则界面回退成中文原文）', () => {
  const KEYS2 = JSON.parse(read('_probe/i18n-keys.json'));
  const msg = aa.humanize('file_not_ready');
  if (!KEYS2.includes(msg)) return '键表里没有';
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'locales');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const miss = files.filter(f => !fs.readFileSync(path.join(dir, f), 'utf8').includes("'" + msg + "'"));
  if (miss.length) return '缺：' + miss.join(',');
  return files.length === 13 ? true : '语言包数不是 13：' + files.length;
});
t('旧文案没被顺手删掉（作者确实关了管理器下载时还得靠它）', () =>
  JSON.parse(read('_probe/i18n-keys.json')).includes(aa.humanize('no_nxm')) ? true : '键表里找不到 no_nxm 文案');
t('引擎导出 markAuthFailed', () => /markAuthFailed,/.test(eng) ? true : '没导出');
t('引擎有下载并发闸门', () => /acquireSlot\(\)/.test(eng) && /releaseSlot\(\)/.test(eng) ? true : '缺闸门');
t('闸门在 finally 里释放（异常也不漏名额）', () => /finally \{\s*\n\s*releaseSlot\(\);\s*\n\s*running\.delete\(id\);/.test(eng) ? true : '不在 finally');
t('闸门默认 3 路并发', () => /MAX_PARALLEL_DOWNLOADS = Math\.max\(1, Number\(opts\.maxParallelDownloads\) \|\| 3\)/.test(eng) ? true : '默认值不对');
t('排队期间被取消 → 不占名额', () => /tNow\.status === 'cancelled'/.test(eng) ? true : '没判');
t('配置默认开启自动授权', () => /autoAuthorize: true/.test(store) ? true : '没开');

console.log('');
console.log('=== D. 接线：preload / 渲染层 ===');
t('preload 暴露 autoAuthorize', () => /autoAuthorize: \(id\) => invoke\('download:autoAuthorize', id\)/.test(pre) ? true : '缺');
t('preload 暴露 autoAuthorizeAll', () => /autoAuthorizeAll: \(opts\) => invoke\('download:autoAuthorizeAll', opts\)/.test(pre) ? true : '缺');
t('preload 暴露 onAutoAuth', () => /onAutoAuth: \(cb\)/.test(pre) ? true : '缺');
t('卡片有自动授权按钮', () => /data-dl-autoauth="\$\{esc\(t\.id\)\}"/.test(app) ? true : '缺');
t('顶部有全部自动授权按钮', () => /data-dl-autoauthall="1"/.test(app) ? true : '缺');
t('手动授权降级为「手动」小按钮', () => /data-dl-auth="\$\{esc\(t\.id\)\}"[^>]*>手动</.test(app) ? true : '缺');
t('点击分支接上 dlAutoAuthorize', () => /t\.closest\('\[data-dl-autoauth\]'\)/.test(app) ? true : '没接');
t('点击分支接上 dlAutoAuthorizeAll', () => /t\.closest\('\[data-dl-autoauthall\]'\)/.test(app) ? true : '没接');
t('订阅了批量授权进度', () => /onAutoAuth\(onAutoAuthProgress\)/.test(app) ? true : '没订阅');
t('设置页有自动授权开关', () => /id="setAutoAuth"/.test(app) ? true : '缺');
t('设置开关会写回配置', () => /config\.set\(\{ autoAuthorize: on \}\)/.test(app) ? true : '没写');
t('全部自动授权按钮带条数', () => /全部自动授权（\$\{waitAuthCount\}）/.test(app) ? true : '没带');
t('批量下载汇总文案跟随开关', () => /state\.config\.autoAuthorize === false/.test(app) ? true : '没跟随');
t('导出给探针用', () => /dlAutoAuthorize, dlAutoAuthorizeAll/.test(app) ? true : '没导出');

console.log('');
console.log('===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
