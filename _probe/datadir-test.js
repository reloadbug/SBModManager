'use strict';
/**
 * 第三十八轮：「数据目录可以在设置里改位置 + 已有数据一键搬运」。
 *
 * 用户 2026-10-15：「数据位置可以在设置中设置，如果已有数据提供一键搬运到新位置；
 * 安装路径允许用户指定」。
 *
 * 这一套盯四件事：
 *
 *   ① **指针文件是唯一真源**（`paths.js :: pickDataDir`）。
 *      它必须放在**固定位置**（`userData/data-location.json`），不能放数据目录里 ——
 *      否则「改了数据目录」这件事就跟着数据目录一起搬走了，下次启动又回默认。
 *      而且任何一条不合法（坏 JSON / 空值 / 相对路径 / 指向默认本身）都要**回落默认**
 *      并把原因带出来给界面显示，绝不能让程序因为一个坏配置起不来。
 *
 *   ② **搬运要连绝对路径一起改写**（`dataMigrate.js :: rewritePathsIn`）。
 *      `mods.json` 里的备份指针、`downloads.json` 里的 `archivePath` 存的都是**绝对路径**，
 *      不跟着改就会指向一个已经不存在的位置 —— 卸载时「还原被覆盖的原文件」会去找空。
 *      ⚠️ 判定必须比到**分隔符边界**：`C:\data` 与 `C:\data-old` 前 7 个字符一样，
 *      但后者不在前者之下。
 *
 *   ③ **`move` 不许把数据弄丢**。同盘走 `rename`（瞬时），跨盘退化成「复制 + 删源」，
 *      但**复制有跳过时不能删源** —— 跳过的那些文件在目标里是旧版本。
 *
 *   ④ **接线不能断**。主进程 6 个 `data:*` 通道、preload 的 `api.data.*`、
 *      设置页三个按钮与向导 7 个按钮 id、43 条新文案在 13 个语言包里都齐 ——
 *      这套是静态断言，防止「功能写好了但界面接不上」。
 *
 * 运行：`npm run test:datadir`
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const paths = require(path.join(ROOT, 'src', 'main', 'paths.js'));
const dm = require(path.join(ROOT, 'src', 'main', 'dataMigrate.js'));

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

/* ---------------- 临时目录工具（全部在系统 temp 下，跑完删干净）---------------- */

const made = [];
function mk() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-dd-')); made.push(d); return d; }
function put(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function cleanup() { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ } } }

/* ---------------- 读源码（CRLF 归一成 LF，见 MEMORY 的踩坑说明）---------------- */

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

(async () => {
  const DEF = paths.DEFAULT_DATA;

  /* ==========================================================
   * ① pickDataDir —— 纯函数，指针文件的全部判定分支
   * ========================================================== */
  console.log('\n【① 指针文件解析 pickDataDir】');

  const p1 = paths.pickDataDir('', DEF);
  eq(p1.dir, DEF, '没有指针文件 → 用默认目录');
  eq(p1.source, 'default', '没有指针文件 → source=default');
  eq(p1.reason, '', '没有指针文件 → 原因留空（这是正常状态，不是异常）');

  eq(paths.pickDataDir('这不是 json', DEF).reason, 'bad-json', '指针文件坏了（不是 JSON）→ bad-json');
  eq(paths.pickDataDir('这不是 json', DEF).dir, DEF, '坏 JSON 也要回落到默认（不能让程序起不来）');
  eq(paths.pickDataDir('{}', DEF).reason, 'empty', 'JSON 里没有 dataDir → empty');
  eq(paths.pickDataDir('{"dataDir":""}', DEF).reason, 'empty', 'dataDir 是空串 → empty');
  eq(paths.pickDataDir('{"dataDir":"   "}', DEF).reason, 'empty', 'dataDir 全是空格 → empty');
  eq(paths.pickDataDir('{"dataDir":123}', DEF).reason, 'empty', 'dataDir 不是字符串 → empty');
  eq(paths.pickDataDir('{"dataDir":"mydata"}', DEF).reason, 'not-absolute',
    '相对路径（用户手改坏了）→ not-absolute');
  eq(paths.pickDataDir('{"dataDir":' + JSON.stringify(DEF) + '}', DEF).reason, 'same-as-default',
    '指针指向的就是默认目录 → same-as-default（当默认处理，不写自定义标记）');

  const custom = mk();
  const p2 = paths.pickDataDir('{"dataDir":' + JSON.stringify(custom) + '}', DEF);
  eq(p2.source, 'custom', '正常的绝对路径 → source=custom');
  eq(p2.reason, '', '正常的绝对路径 → 没有回落原因');
  eq(path.resolve(p2.dir).toLowerCase(), path.resolve(custom).toLowerCase(), '返回的是 path.resolve 归一化后的路径');
  eq(paths.pickDataDir('{"dataDir":' + JSON.stringify(DEF.toUpperCase()) + '}', DEF).source, 'default',
    '大小写不同的默认路径也算「就是默认」（Windows 路径不区分大小写）');
  eq(paths.pickDataDir('{"dataDir":' + JSON.stringify(custom.replace(/\\+$/, '') + '\\') + '}', DEF).source,
    'custom', '末尾多一个反斜杠不影响判定');
  // ⚠️ 故意不检查目录是否存在：数据放在移动硬盘上，没插不该把设置丢掉
  const goneDir = path.join(mk(), 'not-plugged-in');
  eq(paths.pickDataDir('{"dataDir":' + JSON.stringify(goneDir) + '}', DEF).source, 'custom',
    '目录不存在也照样认（移动硬盘没插不该丢设置，可用性另外判）');

  /* ==========================================================
   * ② rewritePathsIn —— 绝对路径改写
   * ========================================================== */
  console.log('\n【② 绝对路径改写 rewritePathsIn】');

  const FROM = 'C:\\sbmm-data';
  const TO = 'D:\\big\\sbmm-data';

  const r1 = dm.rewritePathsIn({ archivePath: FROM + '\\library\\a.zip' }, FROM, TO, { n: 0 });
  eq(r1.value.archivePath, TO + '\\library\\a.zip', 'from 之下的路径改成 to 之下');
  eq(r1.count, 1, '改了几条会计数');

  const r2 = dm.rewritePathsIn({ archivePath: 'C:\\sbmm-data-old\\library\\a.zip' }, FROM, TO, { n: 0 });
  eq(r2.value.archivePath, 'C:\\sbmm-data-old\\library\\a.zip',
    '⚠️ 前缀相同但**不在其下**（sbmm-data-old）不许改 —— 必须比到分隔符边界');
  eq(r2.count, 0, '没改就不计数');

  const r3 = dm.rewritePathsIn({ a: FROM.toLowerCase() + '\\x' }, FROM, TO, { n: 0 });
  // 大小写不敏感只用于「认得出」，替换值一律用 to 的写法（用户给的那串大小写不保留）
  eq(r3.value.a, TO + '\\x', '大小写不敏感（用户在别处贴的小写路径也要认）');

  const r4 = dm.rewritePathsIn({ a: FROM }, FROM, TO, { n: 0 });
  eq(r4.value.a, TO, '恰好等于 from 本身也算（改完就是 to）');

  const r5 = dm.rewritePathsIn(
    { list: [{ p: FROM + '\\1' }, { p: FROM + '\\2' }], keep: 42, nil: null, flag: true },
    FROM, TO, { n: 0 });
  eq(r5.count, 2, '数组 / 嵌套对象里的字符串都要走一遍');
  eq(r5.value.list[0].p, TO + '\\1', '数组里的路径也改');
  eq(r5.value.keep, 42, '非字符串原样保留');
  eq(r5.value.nil, null, 'null 原样保留');
  eq(r5.value.flag, true, '布尔原样保留');

  const r6 = dm.rewritePathsIn({ a: FROM + '/' + 'posix' }, FROM, TO, { n: 0 });
  eq(r6.value.a, TO + '/posix', '正斜杠分隔的路径也认（同一台机器上两种写法都出现过）');

  eq(dm.rewritePathsIn({ a: FROM + '\\x' }, FROM + '\\', TO, { n: 0 }).count, 1,
    'from 末尾带斜杠时也要正常工作');

  /* ==========================================================
   * ③ inspect —— 「目标里有没有数据」才决定要不要问用户
   * ========================================================== */
  console.log('\n【③ 目录体检 inspect】');

  const empty = mk();
  const i0 = dm.inspect(empty);
  eq(i0.exists, true, '空目录：exists=true');
  eq(i0.isEmpty, true, '空目录：isEmpty=true');
  eq(i0.hasData, false, '空目录：hasData=false（不该弹「目标里有数据」）');

  eq(dm.inspect(path.join(empty, 'nope')).exists, false, '不存在的目录：exists=false');
  eq(dm.inspect('').exists, false, '空字符串：exists=false（不炸）');

  const src = mk();
  put(path.join(src, 'mods.json'), JSON.stringify({ version: 1, mods: [{ id: 'a' }, { id: 'b' }] }));
  put(path.join(src, 'downloads.json'), JSON.stringify({ version: 1, tasks: [{ id: 't1' }] }));
  put(path.join(src, 'config.json'), '{}');
  put(path.join(src, 'library', 'pkg1.zip'), 'x');
  put(path.join(src, 'backup', 'old.pak'), 'x');
  put(path.join(src, 'cache', 'images', '1496', '1.jpg'), 'x');
  put(path.join(src, 'tmp', 'junk.bin'), 'x');

  const i1 = dm.inspect(src);
  eq(i1.hasData, true, '有 mods.json / library 等 → hasData=true');
  eq(i1.isEmpty, false, '有内容 → isEmpty=false');
  eq(i1.marks.mods, 2, 'marks.mods = 注册表里的 mod 条数');
  eq(i1.marks.downloads, 1, 'marks.downloads = 队列任务数');
  eq(i1.marks.hasConfig, true, 'marks.hasConfig 认 config.json');
  eq(i1.marks.library, 1, 'marks.library = library/ 下的文件数');
  eq(i1.marks.backup, 1, 'marks.backup = backup/ 下的文件数');
  eq(i1.marks.images, 1, 'marks.images = cache/images/ 下的目录数（按 modId 分目录）');
  eq(i1.files >= 7, true, 'files 统计递归到全部文件（含 tmp）');

  const onlyTmp = mk();
  put(path.join(onlyTmp, 'tmp', 'junk.bin'), 'x');
  eq(dm.inspect(onlyTmp).hasData, false, '只有 tmp/ → hasData=false（tmp 是可再生垃圾，不算数据）');

  /* ==========================================================
   * ④ plan —— 搬什么、搬多少、跟谁撞名
   * ========================================================== */
  console.log('\n【④ 搬运计划 plan】');

  const dst = mk();
  const pl = dm.plan(src, dst);
  const names = pl.items.map(x => x.name);
  eq(names.includes('mods.json'), true, 'plan 里有 mods.json');
  eq(names.includes('library/'), true, 'plan 里有 library/（目录项带尾斜杠）');
  eq(names.includes('tmp/'), false, '⚠️ plan **不含** tmp/（解压临时目录，可再生）');
  eq(pl.clash, 0, '目标空 → 没有撞名');
  eq(pl.samePath, false, '两个不同目录 → samePath=false');

  put(path.join(dst, 'mods.json'), '{}');
  eq(dm.plan(src, dst).clash, 1, '目标已有 mods.json → clash=1');
  eq(dm.plan(src, src).samePath, true, '源 = 目标 → samePath=true');
  eq(dm.plan('', dst).items.length, 0, '源为空 → 空计划（不炸）');

  /* ==========================================================
   * ⑤ run —— 真搬
   * ========================================================== */
  console.log('\n【⑤ 执行搬运 run】');

  // —— copy：源保留 ——
  const s1 = mk(); const d1 = mk();
  put(path.join(s1, 'mods.json'), JSON.stringify({ version: 1, mods: [{ id: 'm', backup: path.join(s1, 'backup', 'a.pak') }] }));
  put(path.join(s1, 'downloads.json'), JSON.stringify({ version: 1, tasks: [{ id: 't', archivePath: path.join(s1, 'library', 'a.zip') }] }));
  put(path.join(s1, 'config.json'), '{}');
  put(path.join(s1, 'library', 'a.zip'), 'PKG');
  put(path.join(s1, 'backup', 'a.pak'), 'BAK');
  put(path.join(s1, 'tmp', 'junk.bin'), 'JUNK');

  const ticks = [];
  const rr = await dm.run(s1, d1, { mode: 'copy', onProgress: (x) => ticks.push(x) });
  eq(rr.mode, 'copy', 'run 返回的 mode 是 copy');
  eq(rr.copied >= 4, true, '复制了文件（mods/downloads/config/library/backup）');
  eq(fs.existsSync(path.join(s1, 'mods.json')), true, 'copy 模式：源文件还在');
  eq(fs.existsSync(path.join(d1, 'library', 'a.zip')), true, 'copy 模式：目标里有包');
  eq(fs.existsSync(path.join(d1, 'tmp', 'junk.bin')), false, '⚠️ tmp/ 不搬（可再生）');
  eq(ticks.length >= 2, true, '有进度回调');
  eq(ticks[ticks.length - 1].phase, 'done', '最后一个进度事件是 done');

  const mj = JSON.parse(fs.readFileSync(path.join(d1, 'mods.json'), 'utf8'));
  eq(mj.mods[0].backup, path.join(d1, 'backup', 'a.pak'), '⚠️ mods.json 里的备份指针指向**新**目录');
  const dj = JSON.parse(fs.readFileSync(path.join(d1, 'downloads.json'), 'utf8'));
  eq(dj.tasks[0].archivePath, path.join(d1, 'library', 'a.zip'), '⚠️ downloads.json 里的 archivePath 也改了');
  eq(rr.rewritten >= 2, true, 'rewritten 统计到改写的处数');
  eq(JSON.parse(fs.readFileSync(path.join(s1, 'mods.json'), 'utf8')).mods[0].backup,
    path.join(s1, 'backup', 'a.pak'), 'copy 模式**不动**源那边的 JSON（源还要能用）');

  // —— move：源删掉（同盘 rename 或跨盘复制 + 删源）——
  const s2 = mk(); const d2 = mk();
  put(path.join(s2, 'config.json'), '{}');
  put(path.join(s2, 'library', 'b.zip'), 'PKG2');
  const rr2 = await dm.run(s2, d2, { mode: 'move' });
  eq(rr2.mode, 'move', 'run 返回的 mode 是 move');
  eq(fs.existsSync(path.join(d2, 'library', 'b.zip')), true, 'move：目标里有包');
  eq(fs.existsSync(path.join(s2, 'library')), false, 'move：源目录已删');
  eq(fs.existsSync(path.join(s2, 'config.json')), false, 'move：源文件已删');

  // —— 目标已有同名 + 不覆盖 → 跳过，且**不删源** ——
  const s3 = mk(); const d3 = mk();
  put(path.join(s3, 'config.json'), '{"new":true}');
  put(path.join(d3, 'config.json'), '{"old":true}');
  const rr3 = await dm.run(s3, d3, { mode: 'move', overwrite: false });
  eq(rr3.skipped, 1, '目标已有同名、overwrite=false → skipped=1');
  eq(JSON.parse(fs.readFileSync(path.join(d3, 'config.json'), 'utf8')).old, true,
    '⚠️ 跳过的文件在目标里保持原样（不被源覆盖）');
  eq(fs.existsSync(path.join(s3, 'config.json')), true,
    '⚠️⚠️ 只要有跳过，**绝不能删源** —— 目标里那份是旧的，删了就等于把新数据丢了');
  eq(rr3.copied, 0, '没复制任何文件');

  // —— 覆盖模式 ——
  const s4 = mk(); const d4 = mk();
  put(path.join(s4, 'config.json'), '{"new":true}');
  put(path.join(d4, 'config.json'), '{"old":true}');
  const rr4 = await dm.run(s4, d4, { mode: 'copy', overwrite: true });
  eq(rr4.skipped, 0, 'overwrite=true → 没有跳过');
  eq(JSON.parse(fs.readFileSync(path.join(d4, 'config.json'), 'utf8')).new, true, 'overwrite=true → 新的盖掉旧的');

  // —— 非法参数 ——
  let threw = 0;
  try { await dm.run(src, src, { mode: 'copy' }); } catch { threw++; }
  eq(threw, 1, '源 = 目标 → 直接报错（不能自己搬给自己）');
  threw = 0;
  try { await dm.run(path.join(src, 'not-here'), dst, { mode: 'copy' }); } catch { threw++; }
  eq(threw, 1, '源不存在 → 报错');
  threw = 0;
  try { await dm.run('', dst, { mode: 'copy' }); } catch { threw++; }
  eq(threw, 1, '源为空 → 报错');

  /* ==========================================================
   * ⑥ setDataDir / 指针文件
   * ========================================================== */
  console.log('\n【⑥ 写指针文件 setDataDir】');

  const BOOT = paths.BOOTSTRAP_FILE;
  const origBootstrap = fs.existsSync(BOOT) ? fs.readFileSync(BOOT, 'utf8') : null;

  try {
    const target = mk();
    const w = paths.setDataDir(target);
    eq(w.source, 'custom', 'setDataDir(目录) → source=custom');
    eq(fs.existsSync(BOOT), true, '指针文件写出来了');
    const onDisk = JSON.parse(fs.readFileSync(BOOT, 'utf8'));
    eq(path.resolve(onDisk.dataDir).toLowerCase(), path.resolve(target).toLowerCase(),
      '指针文件里存的是绝对路径');
    eq(paths.pickDataDir(paths.readBootstrap(), DEF).source, 'custom', '重新读回来能认出是自定义');

    const back = paths.setDataDir('');
    eq(back.source, 'default', 'setDataDir(\'\') → 恢复默认');
    eq(back.dir, DEF, '恢复默认后 dir 就是默认目录');
    eq(fs.existsSync(BOOT), false, '⚠️ 恢复默认是**删掉指针文件**（不是写个指向默认的值）');
    eq(paths.pickDataDir(paths.readBootstrap(), DEF).source, 'default', '删掉之后读回来的就是默认');

    // 幂等：再删一次不该炸
    let boom = 0;
    try { paths.setDataDir(''); } catch { boom++; }
    eq(boom, 0, '重复恢复默认不报错（本来就没有指针文件）');
  } finally {
    // 还原现场，别把开发者本机的设置改掉
    try {
      if (origBootstrap === null) fs.unlinkSync(BOOT);
      else { fs.mkdirSync(path.dirname(BOOT), { recursive: true }); fs.writeFileSync(BOOT, origBootstrap); }
    } catch { /* 忽略 */ }
  }

  /* ==========================================================
   * ⑦ 接线：主进程 IPC / preload / 设置页 / i18n
   * ========================================================== */
  console.log('\n【⑦ 接线（静态断言）】');

  const ipc = readSrc('src/main/ipc.js');
  const pre = readSrc('src/preload/index.js');
  const app = readSrc('src/renderer/app.js');

  for (const ch of ['data:info', 'data:choose', 'data:inspect', 'data:migrate', 'data:setDir', 'data:relaunch']) {
    t(`主进程有 handle('${ch}')`, () => (ipc.includes(`handle('${ch}'`) ? true : '缺失'));
  }
  t('搬运进度走 sendToMain(\'data:progress\')', () =>
    (ipc.includes(`sendToMain('data:progress'`) ? true : '缺失'));
  t('搬运前会挡住在跑的任务（engine.stats().active）', () =>
    (/handle\('data:migrate'[\s\S]{0,900}active/.test(ipc) ? true : '缺失'));
  t('data:info 会重新读指针文件算出「重启后会用的位置」next', () =>
    (/handle\('data:info'[\s\S]{0,500}pickDataDir\(paths\.readBootstrap\(\)/.test(ipc) ? true : '缺失'));
  t('搬到默认位置时按「恢复默认」处理（删指针文件）', () =>
    (/isDefault[\s\S]{0,200}setDataDir\(''\)/.test(ipc) ? true : '缺失'));
  t('data:relaunch 用 app.relaunch() + app.exit(0)', () =>
    (/app\.relaunch\(\)[\s\S]{0,80}app\.exit\(0\)/.test(ipc) ? true : '缺失'));

  for (const m of ['info', 'choose', 'inspect', 'migrate', 'setDir', 'relaunch']) {
    t(`preload 暴露 api.data.${m}`, () => (pre.includes(`${m}: (`) ? true : '缺失'));
  }
  t('preload 暴露了 data:progress 订阅（onProgress）', () =>
    (pre.includes(`ipcRenderer.on('data:progress'`) ? true : '缺失'));

  for (const id of ['btnChangeData', 'btnRestoreData', 'btnOpenData']) {
    t(`设置页有 #${id} 按钮`, () => (app.includes(`id="${id}"`) ? true : '缺失'));
  }
  t('设置页有「默认/自定义位置」标记节点 #ddTag', () =>
    (app.includes('id="ddTag"') ? true : '缺失'));
  t('设置页有提示节点 #ddHint', () => (app.includes('id="ddHint"') ? true : '缺失'));
  t('renderSettings 之后会刷新数据目录那一行', () =>
    (/refreshLogLine\(\);[\s\S]{0,60}refreshDataDirLine\(\);/.test(app) ? true : '缺失'));

  for (const id of ['ddMove', 'ddCopy', 'ddOver', 'ddKeep', 'ddUse', 'ddRelaunch', 'ddLater', 'ddCancel']) {
    t(`搬运向导有 ${id} 按钮`, () => (app.includes(`id: '${id}'`) ? true : '缺失'));
  }
  t('⚠️ 向导按钮都在模态框的 data-mbtn 分支里处理', () =>
    // 窗口 900：中间还夹着 ddCopy/ddOver/ddKeep/ddUse 四条分支与注释，别给太窄
    (/id === 'ddMove'[\s\S]{0,900}id === 'ddRelaunch'/.test(app) ? true : '缺失'));
  t('搬运时订阅了进度并更新进度条 #ddProgBar', () =>
    (/data\.onProgress[\s\S]{0,400}ddProgBar/.test(app) ? true : '缺失'));
  t('「更改位置…」会先探目标里有没有数据（inspect）', () =>
    (/changeDataDir[\s\S]{0,2000}data\.inspect/.test(app) ? true : '缺失'));
  t('目标已有数据时会给「覆盖 / 保留 / 直接用」三条路', () =>
    (/target\.hasData[\s\S]{0,900}ddOver[\s\S]{0,200}ddKeep[\s\S]{0,200}ddUse/.test(app) ? true : '缺失'));
  t('⚠️ 「不搬」在两个向导里语义不同，靠 ddPending.restore 区分', () =>
    (/applyDataDir\(p\.restore \? '' : p\.to\)/.test(app) ? true : '缺失'));
  t('带路径的提示都走 data-i18n-skip（动态数据不许被片段替换啃）', () =>
    ((app.match(/data-i18n-skip>\$\{esc\(/g) || []).length >= 4 ? true : '新提示里的路径没打 skip'));

  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8'));
  eq(keys.length, 1040, '键表 1040 条（0.2.10 的 997 + 本轮 43）');
  const NEW_KEYS = [
    '更改位置…', '恢复默认', '默认位置', '自定义位置', '待重启生效', '约',
    '目标目录里已经有数据', '这个目录里已经有一份数据了：', '把现有数据搬到新目录吗？',
    '恢复到默认位置', '不搬，直接用那个位置的数据', '移动（推荐，搬完删掉旧目录）',
    '复制（旧目录保留一份）', '需要重启', '立即重启', '稍后自己重启', '搬运失败',
    '正在改写路径引用…', '目标：', '新位置：',
    '这个目录里已经有 %s 个文件了', '当前数据有 %s 个文件，要搬到新位置吗？',
    '当前数据有 %s 个文件，要搬回默认位置吗？', '搬运了 %s 个文件，跳过 %s 个已存在的',
    '改写了 %s 处路径引用',
    '还有 %s 个下载 / 安装任务在跑，先暂停或等它跑完再搬数据',
    '还有 %s 个下载 / 安装任务在跑，先处理完再改数据位置'
  ];
  const keySet = new Set(keys);
  for (const k of NEW_KEYS) {
    t(`键表里有「${k.slice(0, 14)}…」`, () => (keySet.has(k) ? true : '缺失'));
  }

  const locDir = path.join(ROOT, 'src', 'renderer', 'locales');
  const locFiles = fs.readdirSync(locDir).filter(f => f.endsWith('.js'));
  eq(locFiles.length, 13, '13 个语言包');
  t('13 个语言包与键表条数一致', () => {
    for (const f of locFiles) {
      const n = (fs.readFileSync(path.join(locDir, f), 'utf8').match(/^\s*'(?:[^'\\]|\\.)*':\s/gm) || []).length;
      if (n !== keys.length) return `${f}: ${n} 条 ≠ ${keys.length}`;
    }
    return true;
  });
  t('新增形状键在英文包里带 %s 占位（翻译时被丢掉了就会显示成半句）', () => {
    const en = fs.readFileSync(path.join(locDir, 'en-US.js'), 'utf8');
    const enLines = en.split('\n');
    for (const k of NEW_KEYS.filter(x => x.includes('%s'))) {
      // ⚠️ 必须按行精确匹配：不含 %s 的前缀键（如「这个目录里已经有一份数据了：」）
      //    在文件里先出现，用 indexOf 会命中别的行、数出错误的 %s 个数
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const line = enLines.find(l => new RegExp(`^\\s*'${esc}':`).test(l));
      if (!line) return `en-US 缺 ${k}`;
      // ⚠️ 只数冒号**后面**的译文段：整行里 key 自己就带一个 %s，
      //    不切开的话英文包永远「多一个」（1 → 2）而误报
      const val = line.slice(line.indexOf("':") + 2);
      const holes = (k.match(/%s/g) || []).length;
      const filled = (val.match(/%s/g) || []).length;
      if (filled !== holes) return `${k} → 译文里 %s 有 ${filled} 个（应为 ${holes}）`;
    }
    return true;
  });

  t('安装脚本 install.ps1 支持 -NoPrompt', () =>
    (readSrc('install.ps1').includes('[switch] $NoPrompt') ? true : '缺失'));
  t('安装脚本会给安装目录做规范化（展开环境变量 / 相对路径补全）', () => {
    const ps = readSrc('install.ps1');
    return (/function Resolve-Dir/.test(ps) && /ExpandEnvironmentVariables/.test(ps)) || '缺失';
  });
  t('安装脚本在交互式终端里会问一次安装目录', () => {
    const ps = readSrc('install.ps1');
    return (/function Ask-InstallDir/.test(ps) && /Test-CanPrompt/.test(ps) && /Read-Host/.test(ps)) || '缺失';
  });
  t('⚠️ -DryRun 不问（否则会卡住自动化）', () =>
    (/Test-CanPrompt[\s\S]{0,200}\$DryRun[\s\S]{0,80}return \$false/.test(readSrc('install.ps1')) ? true : '缺失'));

  cleanup();

  console.log('');
  if (fail) {
    console.log('❌ datadir: ' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('\n失败项：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ datadir: ' + pass + ' 通过 / 0 失败');
})().catch(e => {
  cleanup();
  console.error('套件本身崩了：', e);
  process.exit(1);
});
