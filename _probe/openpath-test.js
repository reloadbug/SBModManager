'use strict';
/**
 * 「打开游戏目录 / 打开 Mod 目录」两个按钮背后的路径判断（0.4.14）。
 *
 * 为什么要单独测这一段：按钮本身只是 `shell.openPath()`，真正会出错的是**打开哪**——
 *   · 游戏根要经过「用户设置 + 便携指针 + 自动探测」才算出来，算错就是打开一个空目录；
 *   · Mod 目录有三种形态（~Mods / LogicMods / ue4ss\Mods），得挑真存在的那个，
 *     挑错了用户点下去像什么都没发生一样。
 *
 * 覆盖四段：
 *   A. `paths.modDirsOf()` 的候选与优先级（外加空 root 的兜底）；
 *   B. 「挑第一个真存在的目录」这套语义在临时目录里跑一遍（只有 LogicMods、只有 ue4ss、全都没有）；
 *   C. ipc 两个通道的接线：缺目录时说人话、用 paths.modDirsOf、打开后回传真实路径；
 *   D. preload 与设置页按钮的接线（按钮 id、处理器、以及「成功不弹提示」这个约定）。
 *
 * 纯 Node：不联网、不碰真实游戏目录与 data/，临时目录落在系统 temp。
 * 运行：`npm run test:openpath`
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const paths = require('../src/main/paths');

const IPC = path.join(__dirname, '..', 'src', 'main', 'ipc.js');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const TMP = path.join(os.tmpdir(), 'sb-openpath-test');

const read = (f) => fs.readFileSync(f, 'utf8');
const ipcSrc = read(IPC);
const preSrc = read(PRELOAD);
const appSrc = read(APP);

let pass = 0, fail = 0;
const fails = [];
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + ' → ' + r); console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; fails.push(label + ' → ' + e.message); console.log('  ✗ ' + label + '  → ' + e.message); }
}

/** 从源码里抠出一段：ipc 的两个通道体 */
function channelBody(name) {
  const re = new RegExp("handle\\('" + name + "', \\(\\) => \\{([\\s\\S]*?)\\n  \\}\\);");
  const m = ipcSrc.match(re);
  if (!m) throw new Error('通道 ' + name + ' 没找到');
  return m[1];
}

main();

function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  console.log('\nA. paths.modDirsOf()');
  t('三个候选，顺序就是优先级', () => {
    const d = paths.modDirsOf('c:\\Star Blade');
    if (d.length !== 3) return '候选数 ' + d.length;
    if (!/~Mods$/.test(d[0])) return '第一候选不是 ~Mods：' + d[0];
    if (!/LogicMods$/.test(d[1])) return '第二候选不是 LogicMods：' + d[1];
    if (!/ue4ss[\\/]Mods$/.test(d[2])) return '第三候选不是 ue4ss\\Mods：' + d[2];
    return true;
  });
  t('三段路径都挂在同一个根下面', () => {
    const d = paths.modDirsOf('D:\\games\\Star Blade');
    return d.every(x => x.toLowerCase().startsWith('d:\\games\\star blade\\')) || '有候选跑出根目录：' + JSON.stringify(d);
  });
  t('空根 / 非字符串 → 空数组（调用方据此报错，而不是拼出相对路径）', () => {
    if (paths.modDirsOf('').length !== 0) return '空串没返回 []';
    if (paths.modDirsOf(null).length !== 0) return 'null 没返回 []';
    if (paths.modDirsOf(undefined).length !== 0) return 'undefined 没返回 []';
    return true;
  });
  t('末尾不重复拼反斜杠（根带尾斜杠也正常）', () => {
    const d = paths.modDirsOf('c:\\Star Blade\\');
    return !/\\\\SB/.test(d[0]) || '拼出了双斜杠：' + d[0];
  });

  console.log('\nB. 挑第一个真存在的目录（临时目录里跑）');
  t('只有 ~Mods → 选它', () => {
    const root = path.join(TMP, 'r1');
    fs.mkdirSync(path.join(root, 'SB', 'Content', 'Paks', '~Mods'), { recursive: true });
    const dirs = paths.modDirsOf(root);
    const hit = dirs.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    return hit === dirs[0] || '挑成了 ' + hit;
  });
  t('只有 LogicMods → 跳过不存在的 ~Mods，选 LogicMods', () => {
    const root = path.join(TMP, 'r2');
    fs.mkdirSync(path.join(root, 'SB', 'Content', 'Paks', 'LogicMods'), { recursive: true });
    const dirs = paths.modDirsOf(root);
    const hit = dirs.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    return hit === dirs[1] || '挑成了 ' + hit;
  });
  t('只有 ue4ss\\Mods → 选第三个', () => {
    const root = path.join(TMP, 'r3');
    fs.mkdirSync(path.join(root, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods'), { recursive: true });
    const dirs = paths.modDirsOf(root);
    const hit = dirs.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    return hit === dirs[2] || '挑成了 ' + hit;
  });
  t('三个都没有 → 一个都挑不出来（好让调用方报「还没装过 Mod」）', () => {
    const root = path.join(TMP, 'r4');
    fs.mkdirSync(root, { recursive: true });
    const dirs = paths.modDirsOf(root);
    const hit = dirs.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    return hit === undefined || '竟然挑出了 ' + hit;
  });

  console.log('\nC. ipc 两个通道');
  t("game:openRoot 存在", () => ipcSrc.includes("handle('game:openRoot'") || '没找到通道');
  t("game:openModsDir 存在", () => ipcSrc.includes("handle('game:openModsDir'") || '没找到通道');
  t('两个通道都在没游戏目录时说人话（而不是返回 false 让界面沉默）', () => {
    const a = channelBody('game:openRoot');
    const b = channelBody('game:openModsDir');
    if (!/还没识别到游戏目录/.test(a)) return 'openRoot 少了没目录的提示';
    if (!/还没识别到游戏目录/.test(b)) return 'openModsDir 少了没目录的提示';
    return true;
  });
  t('game:openRoot 先确认目录真在，再 shell.openPath，最后把路径回传', () => {
    const a = channelBody('game:openRoot');
    if (!/fs\.existsSync\(root\)/.test(a)) return '没做存在性检查';
    if (!/shell\.openPath\(root\)/.test(a)) return '没调 shell.openPath(root)';
    if (!/return root;/.test(a)) return '没回传路径';
    return true;
  });
  t('game:openModsDir 走 paths.modDirsOf（三个候选别各写一遍）', () => {
    const b = channelBody('game:openModsDir');
    return /paths\.modDirsOf\(root\)/.test(b) || '没复用 paths.modDirsOf';
  });
  t('game:openModsDir 挑真存在的那个，一个都没有时报「还没装过 Mod」', () => {
    const b = channelBody('game:openModsDir');
    if (!/isDirectory\(\)/.test(b)) return '没做目录判断';
    if (!/还没装过 Mod/.test(b)) return '少了「还没装过 Mod」的提示';
    if (!/shell\.openPath\(hit\)/.test(b)) return '打开的不是挑中的目录';
    if (!/return hit;/.test(b)) return '没回传真实打开的路径';
    return true;
  });

  console.log('\nD. preload 与设置页');
  t('preload 暴露 game.openRoot / game.openModsDir', () => {
    if (!/openRoot: \(\) => invoke\('game:openRoot'\)/.test(preSrc)) return 'preload 少了 openRoot';
    if (!/openModsDir: \(\) => invoke\('game:openModsDir'\)/.test(preSrc)) return 'preload 少了 openModsDir';
    return true;
  });
  t('设置页「游戏」区块有这两个按钮（且在自动探测旁边）', () => {
    const i = appSrc.indexOf('id="btnOpenGameRoot"');
    if (i < 0) return '没有 btnOpenGameRoot';
    if (!appSrc.includes('id="btnOpenModsDir"')) return '没有 btnOpenModsDir';
    const near = appSrc.slice(Math.max(0, i - 900), i + 400);
    return near.includes('btnDetect') || '离「自动探测」那一排太远，可能塞错了区块';
  });
  t('按钮文案就是词条里的中文（i18n 才有得换）', () => {
    return (appSrc.includes('>打开游戏目录<') && appSrc.includes('>打开 Mod 目录<')) || '按钮文案和词条对不上';
  });
  t('两个按钮都挂了处理器，调的是新通道', () => {
    if (!/e\.target\.id === 'btnOpenGameRoot'[\s\S]{0,220}api\.game\.openRoot\(\)/.test(appSrc)) return 'btnOpenGameRoot 没接 openRoot';
    if (!/e\.target\.id === 'btnOpenModsDir'[\s\S]{0,220}api\.game\.openModsDir\(\)/.test(appSrc)) return 'btnOpenModsDir 没接 openModsDir';
    return true;
  });
  t('成功时不弹 toast（资源管理器本身就是反馈），失败交给 call() 弹人话', () => {
    const seg = appSrc.slice(appSrc.indexOf("e.target.id === 'btnOpenGameRoot'"), appSrc.indexOf("e.target.id === 'btnLedgerCheck'"));
    if (/toast\(/.test(seg)) return '成功路径里多余地弹了提示';
    return /catch \{ \/\* 已提示 \*\/ \}/.test(seg) || '失败没按约定吞掉（call() 已提示）';
  });

  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exitCode = 1;
  }
}
