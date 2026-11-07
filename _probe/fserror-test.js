'use strict';
/**
 * 文件系统错误的人话翻译（`src/main/fsError.js`）。
 *
 * 背景（2026-11-07 真实事故）：
 *   用户的游戏目录从 `D:\games\Star Blade` 换到 `c:\Star Blade` 之后，三条下载全挂在安装阶段，
 *   界面只显示：
 *     `安装失败：EPERM: operation not permitted, copyfile '…\extract-1793\Bayoedt_P.pak'
 *        -> 'c:\Star Blade\SB\Content\Paks\~Mods\Bayoedt_P [nx4104].pak'`
 *   真实原因是程序目录带 Low 完整性标签、进程被降权（不是游戏目录权限），
 *   但用户看到的只是一串裸错误码，完全无从下手。
 *
 * 覆盖四块：
 *   1. 错误码 → 人话：权限 / 占用 / 磁盘满 / 只读 / 目录不存在 / 路径太长 / 认不出来的兜底；
 *   2. 抓目标目录：调用方给的优先，其次 `err.dest`，再次从 `copyfile '…' -> '…'` 文案里挖；
 *   3. `probeWritable()`：能写的目录返回 ok，不存在的目录返回人话；
 *   4. 接线：下载引擎安装失败用它、`game:inspect` 带 `writable`、两处界面把它显示出来。
 *
 * 纯 Node：不联网、不碰真实 `data/`，临时目录落在系统 temp。
 * 运行：`npm run test:fserror`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const fsError = require('../src/main/fsError');

const TMP = path.join(os.tmpdir(), 'sb-fserror-test');
const ENGINE = path.join(__dirname, '..', 'src', 'main', 'downloadEngine.js');
const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');
const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');

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
const has = (hay, needle, label) => t(label, () => (hay.includes(needle) ? true : `缺少 ${JSON.stringify(needle)}`));
const notHas = (hay, needle, label) => t(label, () => (!hay.includes(needle) ? true : `不该出现 ${JSON.stringify(needle)}`));

/** 造一个贴近真实的 Node fs 错误（带 message/code/path/dest） */
function fsErr(code, { message, p, dest } = {}) {
  const e = new Error(message || `${code}: operation not permitted, open '${p || ''}'`);
  e.code = code;
  if (p) e.path = p;
  if (dest) e.dest = dest;
  return e;
}

const GAME_MODS = 'c:\\Star Blade\\SB\\Content\\Paks\\~Mods';

function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  console.log('\n[1] 错误码 → 人话');
  {
    const e = fsErr('EPERM', {
      message: `EPERM: operation not permitted, copyfile 'D:\\AI game\\StarBladeModManager\\data\\tmp\\extract-1793\\Bayoedt_P.pak' -> '${GAME_MODS}\\Bayoedt_P [nx4104].pak'`,
      p: 'D:\\AI game\\StarBladeModManager\\data\\tmp\\extract-1793\\Bayoedt_P.pak',
      dest: `${GAME_MODS}\\Bayoedt_P [nx4104].pak`
    });
    const s = fsError.describe(e, { action: '把文件复制到游戏目录' });
    has(s, '把文件复制到游戏目录', 'EPERM：带上「在做什么」');
    has(s, GAME_MODS, 'EPERM：正文里出现目标目录');
    has(s, '权限不足', 'EPERM：说明是权限问题');
    has(s, '完整性级别', 'EPERM：提示可能被降权/沙箱（本机真实原因）');
    has(s, '管理员身份运行', 'EPERM：给出可执行的处置建议');
    notHas(s, 'operation not permitted', 'EPERM：不再把裸系统文案当主句');
    // EACCES 同族，走同一条分支
    has(fsError.describe(fsErr('EACCES', { dest: `${GAME_MODS}\\a.pak` })), '权限不足', 'EACCES：同样按权限问题处理');
    // 目标目录缺失时不能说成「目标目录」以外的假路径
    const noTarget = fsError.describe(fsErr('EPERM', { message: 'EPERM: operation not permitted, open' }));
    has(noTarget, '目标目录', 'EPERM：拿不到路径时退回泛称');
  }

  console.log('\n[2] 其它错误码');
  {
    has(fsError.describe(fsErr('EBUSY', { dest: `${GAME_MODS}\\a.pak` })), '占用', 'EBUSY：说文件被占用');
    has(fsError.describe(fsErr('ENOSPC', { dest: `${GAME_MODS}\\a.pak` })), '磁盘空间不足', 'ENOSPC：说磁盘满');
    has(fsError.describe(fsErr('EROFS', { dest: `${GAME_MODS}\\a.pak` })), '只读', 'EROFS：说只读');
    has(fsError.describe(fsErr('ENOENT', { dest: `${GAME_MODS}\\a.pak` })), '重新指定游戏目录', 'ENOENT：让用户重新指定目录');
    has(fsError.describe(fsErr('ENOTDIR', { dest: `${GAME_MODS}\\a.pak` })), '类型不对', 'ENOTDIR：说路径类型冲突');
    has(fsError.describe(fsErr('ENAMETOOLONG', { dest: `${GAME_MODS}\\a.pak` })), '路径太长', 'ENAMETOOLONG：说路径太长');
    const odd = fsError.describe(fsErr('EWEIRD', { message: 'EWEIRD: 说不清的错误' }));
    has(odd, 'EWEIRD', '认不出来的错误：原样保留 code 当证据');
    has(odd, '说不清的错误', '认不出来的错误：原样保留 message');
    eq(fsError.describe(null), '未知错误', 'null 也不炸，返回兜底文案');
  }

  console.log('\n[3] 目标目录怎么取');
  {
    const fromFallback = fsError.targetOf(fsErr('EPERM', { dest: 'c:\\x\\y.pak' }), 'c:\\given');
    eq(fromFallback, 'c:\\given', '调用方给的目标优先');
    const fromDest = fsError.targetOf(fsErr('EPERM', { dest: `${GAME_MODS}\\a.pak` }), '');
    eq(fromDest, GAME_MODS, '其次是 err.dest 的父目录');
    const fromMsg = fsError.targetOf(fsErr('EPERM', {
      message: `EPERM: operation not permitted, copyfile 'D:\\t\\a.pak' -> '${GAME_MODS}\\a [nx1].pak'`
    }), '');
    eq(fromMsg, GAME_MODS, '没有 dest 时从 copyfile 文案里挖');
    const fromPath = fsError.targetOf(fsErr('EPERM', { message: 'EPERM: operation not permitted, open', p: `${GAME_MODS}\\a.pak` }), '');
    eq(fromPath, GAME_MODS, '再退一步用 err.path 的父目录');
    eq(fsError.targetOf(fsErr('EPERM', { message: 'no path here' }), ''), '', '什么都没有时返回空串');
    eq(fsError.codeOf(fsErr('EPERM')), 'EPERM', 'codeOf 取到 code');
  }

  console.log('\n[4] probeWritable 真写一遍试试');
  {
    const okDir = path.join(TMP, 'okdir');
    fs.mkdirSync(okDir, { recursive: true });
    const r1 = fsError.probeWritable(okDir);
    eq(r1.ok, true, '可写目录 → ok:true');
    eq(fs.readdirSync(okDir).length, 0, '试探文件用完会删掉，不留垃圾');

    const missing = path.join(TMP, 'not-here', 'deep');
    const r2 = fsError.probeWritable(missing);
    eq(r2.ok, false, '不存在的目录 → ok:false');
    has(r2.message, '目标目录不存在', '不存在的目录：给出人话');

    // 拿一个「文件」当目录用 → 写必然失败，验证失败分支不抛异常且有话可说
    const asFile = path.join(TMP, 'asfile');
    fs.writeFileSync(asFile, 'x');
    const r3 = fsError.probeWritable(asFile);
    eq(r3.ok, false, '把文件当目录 → ok:false 而不是抛异常');
    t('失败分支带 code', () => (r3.code ? true : '没有 code'));
    t('失败分支带 message', () => (r3.message ? true : '没有 message'));

    eq(fsError.probeWritable('').ok, false, '空目录参数 → ok:false');
  }

  console.log('\n[5] 接线');
  {
    const engineSrc = fs.readFileSync(ENGINE, 'utf8');
    has(engineSrc, "require('./fsError')", '下载引擎引入了 fsError');
    has(engineSrc, 'fsError.describe(e, { target: plan && plan.target', '安装失败时走人话翻译');
    notHas(engineSrc, "error: '安装失败：' + e.message", '不再直接拼裸 e.message');
    has(engineSrc, 'code: fsError.codeOf(e) || null', '日志里留下错误码便于排查');

    const ipcSrc = fs.readFileSync(IPC, 'utf8');
    has(ipcSrc, "require('./fsError')", 'ipc 引入了 fsError');
    has(ipcSrc, 'fsError.probeWritable(probeDir)', 'game:inspect 会真写一次试探');
    has(ipcSrc, 'writable', 'game:inspect 返回 writable');

    const appSrc = fs.readFileSync(APP, 'utf8');
    has(appSrc, 'function gameWriteBanner()', '渲染层有告警条');
    has(appSrc, "if (!w || w.ok) return ''", '可写时不打扰用户');
    t('已安装页用上了告警条', () => ((appSrc.match(/gameWriteBanner\(\)/g) || []).length >= 3 ? true : '调用点不足（函数定义 + 两处渲染）'));
    has(appSrc, 'g.writable && !g.writable.ok', '设置页也显示不可写原因');
  }

  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exitCode = 1;
  }
}

main();
