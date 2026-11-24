#!/usr/bin/env node
/*
 * 「崩溃诊断」自检（2026-11-10）。
 *
 * 用户要求（原话）：
 *   「增加一个查看报错日志和错误日志分析的功能，用于排除 mod 冲突导致的游戏崩溃」
 *
 * 这个功能的价值全在**结论对不对**：说错了用户会去拆掉没问题的 Mod，白折腾一小时。
 * 所以自检的重点不是「函数能跑」，而是几条判定是否按设计成立：
 *
 *   A. UE4SS.log 解析 —— UTC 时间、版本行、加载了什么、日志停在哪一行；
 *   B. 崩溃快照解析 —— 哪个线程崩的、异常码、读的什么地址、SecondsSinceStart；
 *   C. 阶段判定 —— 0 秒 = 启动期（这类崩基本是加载链上的东西）；
 *   D. 结论与打分 —— 六种现场各给一份数据，检查 verdict / 嫌疑 / 步骤是否合理；
 *   E. 读原文的路径守卫 —— 渲染层传上来的路径不能变成任意文件读取；
 *   F. 接线 —— ipc / preload / index.html / app.js / style.css 五处都连上了；
 *   G. 真机冒烟 —— 装了游戏就顺手跑一遍真实数据（只读，不改任何文件）。
 *
 * 跑法：npm run test:crashlog（或 node _probe/crashlog-test.js）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const crashLog = require('../src/main/crashLog');

const TMP = path.join(os.tmpdir(), 'sb-crashlog-test');

let pass = 0;
let fail = 0;
const fails = [];
function ok(label, cond, extra) {
  if (cond) { pass++; return true; }
  fail++;
  fails.push(label + (extra ? '  → ' + extra : ''));
  return false;
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------- 样本 ---------------- */

const LOG_SAMPLE = `[2026-11-09 16:16:28.9708650] UE4SS - v3.0.1 Beta #0 - Git SHA #47477f8
UE4SS Build Configuration: Game__Shipping__Win64 (MSVC)
[2026-11-09 16:16:29.1000000] Starting C++ mod 'NGNL1Mod'
[2026-11-09 16:16:30.0000000] Starting mods (from mods.txt load order)...
[2026-11-09 16:16:30.1000000] Starting Lua mod 'Keybinds'
[2026-11-09 16:16:30.2000000] Mod 'jsbLuaProfilerMod' disabled in mods.txt.
[2026-11-09 16:16:31.0000000] [Lua] [BPModLoaderMod] Mods/BPModLoaderMod/load_order.txt not present or no matching mods, loading all BP mods in random order.
[2026-11-09 16:16:31.1000000] [Lua] [BPModLoaderMod] DekCNS_P == table: 0x1234abcd
[2026-11-09 16:16:31.1000000] [Lua] [BPModLoaderMod]   AssetName == ModActor_C
[2026-11-09 16:16:31.1000000] [Lua] [BPModLoaderMod]   AssetPath == /Game/Mods/DekCNS_P/ModActor
[2026-11-09 16:16:31.2000000] [Lua] [BPModLoaderMod] SkipStartupLogos_P [nx483] == table: 0x5678ef01
[2026-11-09 16:16:31.2000000] [Lua] [BPModLoaderMod]   AssetPath == /Game/Mods/SkipStartupLogos_P [nx483]/ModActor
[2026-11-09 16:16:31.3000000] [Lua] [BPModLoaderMod] Loading mod: DekCNS_P
[2026-11-09 16:16:39.7852776] [PS] Failed to find ConsoleManagerSingleton: found 2 unique values [1, 2]
[2026-11-09 16:16:39.7852776] Event loop start
`;

const CRASH_XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<FGenericCrashContext>
<RuntimeProperties>
<CrashVersion>3</CrashVersion>
<IsEnsure>false</IsEnsure>
<IsAssert>false</IsAssert>
<CrashType>Crash</CrashType>
<ErrorMessage>Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x0000000000000008</ErrorMessage>
<ProcessId>13088</ProcessId>
<SecondsSinceStart>0</SecondsSinceStart>
<EngineVersion>4.26.2-0+++UE4+Release-4.26</EngineVersion>
<CommandLine> -DistributionPlatform=Steam</CommandLine>
<BaseDir>c:/Star Blade/SB/Binaries/Win64/</BaseDir>
<CallStack></CallStack>
</RuntimeProperties>
<Threads>
<Thread>
<ThreadName>GameThread</ThreadName>
<ThreadID>100</ThreadID>
<IsCrashed>true</IsCrashed>
<CallStack>ntdll  0x00007ffb00000000 + 20a34
KERNELBASE  0x00007ffb00000000 + 3d6a
SB-Win64-Shipping  0x0000000140000000 + 293f0ad
UE4SS  0x00007ffb10000000 + 1a2b
VCRUNTIME140  0x00007ffb20000000 + 1a9c0</CallStack>
</Thread>
<Thread>
<ThreadName>FAsyncLoadingThread</ThreadName>
<ThreadID>101</ThreadID>
<IsCrashed>false</IsCrashed>
<CallStack>ntdll  0x00007ffb00000000 + 20a34</CallStack>
</Thread>
</Threads>
</FGenericCrashContext>
`;

/** 造一份崩溃对象（buildReport 只吃解析后的字段，不走 XML） */
function crashAt(minutesAgo, secondsSinceStart, thread, address) {
  const at = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return {
    guid: 'GUID' + minutesAgo,
    at,
    dmpSize: 1200000,
    crashType: 'Crash',
    isEnsure: false,
    isAssert: false,
    errorMessage: 'Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address ' + (address || '0x0000000000000008'),
    exception: 'EXCEPTION_ACCESS_VIOLATION',
    address: address || '0x0000000000000008',
    secondsSinceStart,
    engineVersion: '4.26.2-0+++UE4+Release-4.26',
    commandLine: ' -DistributionPlatform=Steam',
    threads: 2,
    crashedThread: { name: thread || 'GameThread', frames: [] },
    frameOffsets: [],
    modules: [],
    foreign: []
  };
}

/** 造一份 inventory（目录清点）结果 */
function inv(groups, jsons) {
  return { dir: 'x', exists: true, groups: groups || [], jsons: jsons || [], others: [] };
}
const pakGroup = (key, ext) => ({
  key,
  ext: ext || { '.pak': true, '.ucas': true, '.utoc': true },
  files: [{ name: key + '.pak', size: 1024, path: 'x\\' + key + '.pak' }],
  size: 1024,
  newestMs: Date.now() - 60 * 1000,
  disabled: false,
  subdir: ''
});

/* ---------------- 测试 ---------------- */

function testLogParse() {
  const p = crashLog.parseUe4ssLog(LOG_SAMPLE);
  ok('A1 版本行', p.version === 'v3.0.1 Beta #0', p.version);
  ok('A2 Git SHA', p.gitSha === '47477f8', p.gitSha);
  ok('A3 构建串', /Game__Shipping__Win64/.test(p.build), p.build);
  ok('A4 C++ mod', JSON.stringify(p.startedCpp) === '["NGNL1Mod"]', JSON.stringify(p.startedCpp));
  ok('A5 Lua mod', p.startedLua.includes('Keybinds'), JSON.stringify(p.startedLua));
  ok('A6 已禁用', p.disabled.includes('jsbLuaProfilerMod'), JSON.stringify(p.disabled));
  ok('A7 load_order 缺失', p.loadOrderMissing === true);
  ok('A8 蓝图 Mod 名单', p.bpMods.length === 2 && p.bpMods[0] === 'DekCNS_P', JSON.stringify(p.bpMods));
  ok('A9 蓝图资源路径', p.bpAssetPaths.some(x => /DekCNS_P\/ModActor/.test(x)), JSON.stringify(p.bpAssetPaths));
  ok('A10 最后在加载谁', p.lastLoadingMod === 'DekCNS_P', p.lastLoadingMod);
  ok('A11 事件循环', p.eventLoopStarted === true);
  ok('A12 日志报错', p.errors.length >= 1 && /ConsoleManagerSingleton/.test(p.errors[0]), JSON.stringify(p.errors));
  // 时间戳是 UTC：本地 00:16 那次，日志写的是前一天 16:16
  const wantLast = Date.UTC(2026, 10, 9, 16, 16, 39, 785);
  ok('A13 时间按 UTC 解', Math.abs(p.lastAtMs - wantLast) < 5, p.lastAtMs + ' vs ' + wantLast);
  ok('A14 行数', p.lineCount >= 14, String(p.lineCount));
  // 横幅行不能被当成「最后一行」
  const banner = crashLog.parseUe4ssLog(
    '[2026-11-09 16:16:28.0000000] UE4SS - v3.0.1 Beta #0 - Git SHA #47477f8\n' +
    '######  Dekitarpg  ######\nSupport development @ https://x\n');
  ok('A15 横幅不覆盖最后一行', /Git SHA/.test(banner.lastLine), banner.lastLine);
}

function testCrashParse() {
  const c = crashLog.parseCrashXml(CRASH_XML_SAMPLE, { guid: 'UE4CC-Windows-ABC_0000', at: '2026-11-09T22:35:46.000Z', dmpSize: 1220000 });
  ok('B1 崩溃类型', c.crashType === 'Crash', c.crashType);
  ok('B2 异常码', c.exception === 'EXCEPTION_ACCESS_VIOLATION', c.exception);
  ok('B3 读的地址', c.address === '0x0000000000000008', c.address);
  ok('B4 启动秒数', c.secondsSinceStart === 0, String(c.secondsSinceStart));
  ok('B5 线程数', c.threads === 2, String(c.threads));
  ok('B6 崩的线程', c.crashedThread.name === 'GameThread', c.crashedThread.name);
  ok('B7 崩溃线程栈帧', c.crashedThread.frames.length === 5, String(c.crashedThread.frames.length));
  ok('B8 栈里有 UE4SS', c.foreign.map(x => x.toUpperCase()).includes('UE4SS'), JSON.stringify(c.foreign));
  ok('B9 引擎版本', /4\.26/.test(c.engineVersion), c.engineVersion);
  ok('B10 空 CallStack 不报错', (() => {
    const e = crashLog.parseCrashXml('<RuntimeProperties><ErrorMessage>boom</ErrorMessage></RuntimeProperties>');
    return e.crashedThread.frames.length === 0;
  })());
}

function testPhase() {
  ok('C1 0 秒=启动期', crashLog.crashPhase(crashAt(1, 0, 'GameThread')).phase === 'startup');
  ok('C2 30 秒=加载期', crashLog.crashPhase(crashAt(1, 30, 'FAsyncLoadingThread')).phase === 'loading');
  ok('C3 286 秒=运行中', crashLog.crashPhase(crashAt(1, 286, 'FAsyncLoadingThread')).phase === 'runtime');
  ok('C4 断言=assert', crashLog.crashPhase({ secondsSinceStart: 5, isAssert: true }).phase === 'assert');
}

function testReports() {
  const now = Date.now();

  /* D1 —— 日志停在 `Loading mod: X` 且启动期崩：这是最硬的证据，要给 high + 45 分 */
  const bpLog = crashLog.parseUe4ssLog(
    '[2026-11-09 16:16:28.0000000] UE4SS - v3.0.1 Beta #0 - Git SHA #47477f8\n' +
    '[2026-11-09 16:16:31.1000000] [Lua] [BPModLoaderMod] DekCNS_P == table: 0x1\n' +
    '[2026-11-09 16:16:31.3000000] [Lua] [BPModLoaderMod] Loading mod: DekCNS_P\n');
  const crash1 = crashAt(0.2, 0, 'GameThread');       // 和日志最后一行只差十几秒
  const r1 = crashLog.buildReport({
    now,
    ue4ss: bpLog,
    crashes: [crash1],
    mods: [],
    files: { mods: inv([pakGroup('EldenEddyCNS-BlackSling-96')]), logic: inv([pakGroup('DekCNS_P')]) },
    env: {}
  });
  ok('D1.1 停在 Loading mod → high', r1.analysis.verdict.level === 'high', r1.analysis.verdict.level);
  ok('D1.2 结论点名', /DekCNS_P/.test(r1.analysis.verdict.headline), r1.analysis.verdict.headline);
  ok('D1.3 该 Mod 45 分', (r1.analysis.suspects[0] || {}).score === 45, JSON.stringify((r1.analysis.suspects[0] || {}).score));
  ok('D1.4 步骤先移它', /DekCNS_P/.test((r1.analysis.steps[0] || '')), r1.analysis.steps[0]);

  /* D2 —— 启动期崩、有 2 个蓝图 Mod、日志早已结束（无硬证据）：只能给 low + 对撞步骤 */
  const doneLog = crashLog.parseUe4ssLog(
    '[2026-11-09 10:00:00.0000000] UE4SS - v3.0.1 Beta #0 - Git SHA #47477f8\n' +
    '[2026-11-09 10:00:05.0000000] [Lua] [BPModLoaderMod] DekCNS_P == table: 0x1\n' +
    '[2026-11-09 10:00:05.0000000] [Lua] [BPModLoaderMod] SkipStartupLogos_P [nx483] == table: 0x2\n' +
    '[2026-11-09 10:00:09.0000000] Event loop start\n');
  const r2 = crashLog.buildReport({
    now,
    ue4ss: doneLog,
    crashes: [crashAt(60, 0, 'GameThread'), crashAt(90, 0, 'FAsyncLoadingThread')],
    mods: [],
    files: { mods: inv([]), logic: inv([pakGroup('DekCNS_P'), pakGroup('SkipStartupLogos_P [nx483]')]) },
    env: {}
  });
  ok('D2.1 无硬证据 → low', r2.analysis.verdict.level === 'low', r2.analysis.verdict.level);
  ok('D2.2 两个蓝图 Mod 都在嫌疑里', r2.analysis.suspects.length === 2, String(r2.analysis.suspects.length));
  ok('D2.3 步骤要求「全部」移出再逐个放回', /全部/.test(r2.analysis.steps[0] || '') && /逐个放回/.test(r2.analysis.steps[0] || ''),
    r2.analysis.steps[0]);

  /* D3 —— 没有崩溃记录：老实说没现场，不编结论 */
  const r3 = crashLog.buildReport({ now, ue4ss: bpLog, crashes: [], mods: [], files: { mods: inv([]), logic: inv([]) }, env: {} });
  ok('D3.1 没崩溃 → none', r3.analysis.verdict.level === 'none', r3.analysis.verdict.level);
  ok('D3.2 文案是「还没抓到」', /还没抓到/.test(r3.analysis.verdict.headline), r3.analysis.verdict.headline);

  /* D4 —— 容器缺 .utoc：IoStore 缺索引，加载到就崩，必须报 error */
  const r4 = crashLog.buildReport({
    now, ue4ss: bpLog, crashes: [crashAt(1, 0)],
    mods: [],
    files: { mods: inv([pakGroup('Broken_P', { '.pak': true, '.ucas': true })]), logic: inv([]) },
    env: {}
  });
  ok('D4.1 缺 utoc 报 error',
    r4.analysis.findings.some(f => f.level === 'error' && /容器文件不完整/.test(f.title) && /Broken_P/.test(f.title)),
    JSON.stringify(r4.analysis.findings.map(f => f.title)));

  /* D5 —— 回归：`.dekcns.json` 名字和 pak 天生不同名，不能当成「找不到 pak」报警 */
  const r5 = crashLog.buildReport({
    now, ue4ss: bpLog, crashes: [crashAt(1, 0)],
    mods: [],
    files: {
      mods: inv([pakGroup('Kamenlaideng_Nun_P [nx4114]')], [{ name: 'Kamenlaideng_Nun_CNS.dekcns.json', size: 900, path: 'x' }]),
      logic: inv([])
    },
    env: {}
  });
  ok('D5.1 不再判定孤儿索引', !r5.analysis.findings.some(f => /找不到对应的 pak/.test(f.title)),
    JSON.stringify(r5.analysis.findings.map(f => f.title)));
  ok('D5.2 只报数量（info）', r5.analysis.findings.some(f => f.level === 'info' && /1 个 CNS 换装索引/.test(f.title)),
    JSON.stringify(r5.analysis.findings.map(f => f.title)));

  /* D6 —— 异步加载线程占比不到 4 成就不提，免得把无关崩溃也归到「加载压力」上 */
  const async6 = [crashAt(1, 0, 'FAsyncLoadingThread'), crashAt(2, 0, 'GameThread'),
    crashAt(3, 0, 'GameThread'), crashAt(4, 0, 'GameThread'), crashAt(5, 0, 'GameThread')];
  const r6 = crashLog.buildReport({
    now, ue4ss: bpLog, crashes: async6, mods: [],
    files: { mods: inv([]), logic: inv([]), assetLoadingMemCap: 85 }, env: {}
  });
  ok('D6.1 占比不足不提异步', !r6.analysis.findings.some(f => /异步加载线程崩得多/.test(f.title)),
    JSON.stringify(r6.analysis.findings.map(f => f.title)));
  const async7 = [crashAt(1, 0, 'FAsyncLoadingThread'), crashAt(2, 0, 'FAsyncLoadingThread'),
    crashAt(3, 0, 'FAsyncLoadingThread'), crashAt(4, 0, 'GameThread'), crashAt(5, 0, 'GameThread')];
  const r7 = crashLog.buildReport({
    now, ue4ss: bpLog, crashes: async7, mods: [],
    files: { mods: inv([]), logic: inv([]), assetLoadingMemCap: 85 }, env: {}
  });
  ok('D7.1 占比过半就提异步', r7.analysis.findings.some(f => /异步加载线程崩得多/.test(f.title)),
    JSON.stringify(r7.analysis.findings.map(f => f.title)));
  ok('D7.2 顺带给内存上限建议', r7.analysis.findings.some(f => /MaxMemoryUsageDuringAssetLoading=85/.test(f.detail || '')));

  /* D8 —— 停用注入型 Mod 的步骤要挑「玩家自己装的 C++ Mod」，不能挑 UE4SS 自带组件 */
  const r8 = crashLog.buildReport({
    now, ue4ss: { ...bpLog, startedCpp: ['NGNL1Mod'], bpMods: [] }, crashes: [crashAt(1, 0)],
    mods: [],
    files: {
      mods: inv([]), logic: inv([]),
      modsTxt: { map: { CheatManagerEnablerMod: true, ConsoleEnablerMod: true, NGNL1Mod: true } }
    },
    env: {}
  });
  ok('D8.1 挑自写 C++ Mod', r8.analysis.steps.some(s => /NGNL1Mod/.test(s)), JSON.stringify(r8.analysis.steps));
  ok('D8.2 不挑 UE4SS 自带', !r8.analysis.steps.some(s => /CheatManagerEnablerMod/.test(s)), JSON.stringify(r8.analysis.steps));

  /* D9 —— 统计口径 */
  ok('D9.1 统计总数', r2.stats.total === 2, String(r2.stats.total));
  ok('D9.2 启动期计数', r2.stats.startup === 2, String(r2.stats.startup));
  ok('D9.3 最近一次时间存在', !!r2.stats.lastAt, String(r2.stats.lastAt));
  ok('D9.4 异常分类', !!r2.stats.exceptions.EXCEPTION_ACCESS_VIOLATION, JSON.stringify(r2.stats.exceptions));
  ok('D9.5 线程分类', r2.stats.threads.GameThread === 1, JSON.stringify(r2.stats.threads));
  /* D10 —— 排他全屏：Alt+Tab 切回来时 D3D12 交换链重建失败 → 报 error + 把「改无边框全屏」排第一
     实机原话（04:55:54 那份崩溃）：CommandList->Close() failed at .../D3D12CommandList.cpp:158
     改了 FullscreenMode=1（无边框全屏）之后，暂停条和「切出去几秒后进程直接消失」一起没了。 */
  const d3dCrash = () => {
    const c = crashAt(1, 300, 'GameThread');
    c.crashType = 'Assert';
    c.isAssert = true;
    c.exception = 'ASSERT';
    c.errorMessage = 'LowLevelFatalError [File:Unknown] [Line: 703] CommandList->Close() failed at ' +
      'D:/BuildDepot/Program_QA/PC/Client/Engine/Source/Runtime/D3D12RHI/Private/D3D12CommandList.cpp:158 with error E_INVALIDARG';
    return c;
  };
  const quietLog = { version: 'v3.0.1 Beta #0', bpMods: [], startedCpp: [], startedLua: [], errors: [], eventLoopStarted: true, lastLine: 'Event loop start' };
  const exclusiveEnv = {
    gameSettings: { fullscreenMode: 0, resolutionX: 2560, resolutionY: 1440 },
    gameSettingsPath: 'C:\\x\\GameUserSettings.ini'
  };
  const r10 = crashLog.buildReport({
    now, ue4ss: quietLog, crashes: [d3dCrash()], mods: [],
    files: { mods: inv([]), logic: inv([]) }, env: exclusiveEnv
  });
  ok('D10.1 排他全屏 + D3D12 → error 发现',
    r10.analysis.findings.some(f => f.level === 'error' && /排他全屏/.test(f.title)),
    JSON.stringify(r10.analysis.findings.map(f => f.level + ':' + f.title)));
  ok('D10.2 第一步就是改显示模式', /无边框全屏/.test(r10.analysis.steps[0] || ''), r10.analysis.steps[0]);
  ok('D10.3 结论指向显示模式',
    r10.analysis.verdict.level === 'mid' && /显示模式/.test(r10.analysis.verdict.headline),
    r10.analysis.verdict.level + ' / ' + r10.analysis.verdict.headline);

  /* D11 —— 已经是无边框全屏时不怪显示模式 */
  const r11 = crashLog.buildReport({
    now, ue4ss: quietLog, crashes: [d3dCrash()], mods: [],
    files: { mods: inv([]), logic: inv([]) },
    env: { gameSettings: { fullscreenMode: 1, resolutionX: 2560, resolutionY: 1440 } }
  });
  ok('D11.1 无边框全屏不报显示模式',
    !r11.analysis.findings.some(f => /排他全屏/.test(f.title)),
    JSON.stringify(r11.analysis.findings.map(f => f.title)));
  ok('D11.2 结论也不指向显示模式', !/显示模式/.test(r11.analysis.verdict.headline), r11.analysis.verdict.headline);

  /* D12 —— 排他全屏但压根没崩过：别提显示模式，步骤也不许有 */
  const r12 = crashLog.buildReport({
    now, ue4ss: quietLog, crashes: [], mods: [],
    files: { mods: inv([]), logic: inv([]) }, env: exclusiveEnv
  });
  ok('D12.1 没崩过不提显示模式',
    !r12.analysis.findings.some(f => /排他全屏/.test(f.title)),
    JSON.stringify(r12.analysis.findings.map(f => f.title)));
  ok('D12.2 没崩过没有排除步骤', r12.analysis.steps.length === 0, JSON.stringify(r12.analysis.steps));

  /* D13 —— 排他全屏 + 普通崩溃（不是 D3D12）：只给 warn，但步骤仍把显示模式排第一 */
  const r13 = crashLog.buildReport({
    now, ue4ss: quietLog, crashes: [crashAt(1, 300, 'GameThread')], mods: [],
    files: { mods: inv([]), logic: inv([]) }, env: exclusiveEnv
  });
  ok('D13.1 普通崩溃只给 warn',
    r13.analysis.findings.some(f => f.level === 'warn' && /排他全屏/.test(f.title)),
    JSON.stringify(r13.analysis.findings.map(f => f.level + ':' + f.title)));
  ok('D13.2 步骤仍先改显示模式', /无边框全屏/.test(r13.analysis.steps[0] || ''), r13.analysis.steps[0]);

  /* D14 —— parseGameUserSettings：同一个键出现两次时取**最后**一次（游戏自己的段落在后面） */
  const gs = crashLog.parseGameUserSettings(
    '[/Script/Engine.GameUserSettings]\nFullscreenMode=2\nResolutionSizeX=1920\n\n' +
    '[/Script/SB.SBGameUserSettings]\nFullscreenMode=0\nPreferredFullscreenMode=0\n' +
    'ResolutionSizeX=2560\nResolutionSizeY=1440\nFrameRateLimit=60.000000\n');
  ok('D14.1 取最后一段的 FullscreenMode', gs && gs.fullscreenMode === 0, JSON.stringify(gs));
  ok('D14.2 取最后一段的分辨率', gs && gs.resolutionX === 2560 && gs.resolutionY === 1440, JSON.stringify(gs));
  ok('D14.3 空文本给 null', crashLog.parseGameUserSettings('') === null);
}

function testReadSourceGuard() {
  fs.rmSync(TMP, { recursive: true, force: true });
  const root = path.join(TMP, 'game');
  const win64 = path.join(root, 'SB', 'Binaries', 'Win64');
  const ue4ss = path.join(win64, 'ue4ss');
  const crashes = path.join(root, 'SB', 'Saved', 'Crashes', 'UE4CC-Windows-ABC_0000');
  fs.mkdirSync(ue4ss, { recursive: true });
  fs.mkdirSync(crashes, { recursive: true });
  fs.writeFileSync(path.join(ue4ss, 'UE4SS.log'), '[2026-11-09 16:16:28.0000000] UE4SS - v3.0.1 Beta #0 - Git SHA #47477f8\n', 'utf8');
  fs.writeFileSync(path.join(crashes, 'CrashContext.runtime-xml'), CRASH_XML_SAMPLE, 'utf8');

  const L = crashLog.locate(root);
  ok('E1 找到 ue4ss 目录', path.resolve(L.ue4ssDir) === path.resolve(ue4ss), L.ue4ssDir);
  ok('E2 找到崩溃目录', path.resolve(L.crashes).startsWith(path.resolve(path.join(root, 'SB', 'Saved'))), L.crashes);

  const good = crashLog.readSource({ root, kind: 'ue4ss', file: path.join(ue4ss, 'UE4SS.log') });
  ok('E3 读已知目录里的文件', /Git SHA/.test(good.text), good.text.slice(0, 40));

  const bad = (() => {
    try { crashLog.readSource({ root, kind: 'file', file: 'C:\\Windows\\win.ini' }); return null; }
    catch (e) { return e.message; }
  })();
  ok('E4 目录外一律拒绝', !!bad && /不允许|不在/.test(bad), String(bad));

  const xmlRead = crashLog.readSource({ root, kind: 'crash', file: path.join(crashes, 'CrashContext.runtime-xml'), maxBytes: 400 });
  ok('E5 超长截断有标记', xmlRead.truncated === true || xmlRead.text.length <= 400, String(xmlRead.text.length));

  fs.rmSync(TMP, { recursive: true, force: true });
}

function testWiring() {
  const ipc = read('src/main/ipc.js');
  ok('F1 ipc require crashLog', /require\('\.\/crashLog'\)/.test(ipc));
  for (const ch of ['crash:report', 'crash:read', 'crash:openDir', 'crash:openFile']) {
    ok('F2 ipc 通道 ' + ch, new RegExp("handle\\('" + ch + "'").test(ipc));
  }
  ok('F3 ipc 分析要带实时 Mod 列表', /crashLog\.analyze\(\{[\s\S]{0,120}mods/.test(ipc));

  const pre = read('src/preload/index.js');
  ok('F4 preload 暴露 crash 命名空间', /crash:\s*\{/.test(pre));
  for (const m of ['report', 'read', 'openDir', 'openFile']) {
    ok('F5 preload crash.' + m, new RegExp('crash:' + '[\\s\\S]{0,400}?' + m + ':').test(pre) || new RegExp('\\b' + m + ': \\(\\) =>').test(pre));
  }

  const html = read('src/renderer/index.html');
  ok('F6 侧栏有入口', /data-p="p-crash"/.test(html));
  ok('F7 页面容器', /id="p-crash"/.test(html) && /id="crashArea"/.test(html));

  const app = read('src/renderer/app.js');
  ok('F8 标题表', /'p-crash':\s*\[/.test(app));
  ok('F9 切页时懒加载', /id === 'p-crash'/.test(app));
  ok('F10 渲染函数', /function paintCrash\(/.test(app) && /async function renderCrash\(/.test(app));
  ok('F11 自动化钩子', /window\.__renderCrash/.test(app));
  ok('F12 调主进程通道', /api\.crash\.report\(\)/.test(app) && /api\.crash\.read\(/.test(app));

  const css = read('src/renderer/style.css');
  ok('F13 样式', /\.crash-verdict/.test(css) && /\.sus-bar/.test(css) && /\.crash-row/.test(css));

  /* 操作按钮要放顶部并吸顶：这一页的结论 + 嫌疑 + 日志概览能滚好几屏，
     按钮留在页底的后果是每次都要先滚到底才能点「重新分析」。 */
  const paint = app.slice(app.indexOf('function paintCrash('), app.indexOf('async function renderCrash('));
  ok('F15 按钮在最上面（crashbar 先于结论）',
    paint.indexOf('class="crashbar"') > -1 &&
    paint.indexOf('class="crashbar"') < paint.indexOf('crash-verdict'));
  ok('F16 顶部条里三个动作齐全',
    /class="crashbar"[\s\S]{0,400}data-crash="reload"/.test(paint) &&
    /class="crashbar"[\s\S]{0,400}data-crashread=/.test(paint) &&
    /class="crashbar"[\s\S]{0,400}data-crash="openDir"/.test(paint));
  ok('F17 页底不再重复放按钮（reload 只剩顶部条 + 未分析态两处）',
    !/底部按钮/.test(paint) && (paint.match(/data-crash="reload"/g) || []).length === 2);
  ok('F18 未分析态也用同一个条', /class="crashbar"><button class="btn p" data-crash="reload">开始分析/.test(paint));
  ok('F19 样式是吸顶（top:-16px 与 .bhead 同套路）',
    /\.crashbar\{position:sticky;top:-16px/.test(css) && /\.crashbar-at\{/.test(css));

  // 语言包不用动：新界面文本就是中文原文，其它语言缺键会回退中文
  ok('F14 没碰语言包键表', !fs.existsSync(path.join(ROOT, '_probe/i18n-keys.json')) ||
    !read('_probe/i18n-keys.json').includes('崩溃诊断'));
}

function testRealMachine() {
  const root = 'c:\\Star Blade';
  if (!fs.existsSync(path.join(root, 'SB', 'Binaries', 'Win64', 'SB-Win64-Shipping.exe'))) {
    console.log('   （本机没装游戏，跳过真机冒烟）');
    return;
  }
  let rep = null;
  try { rep = crashLog.analyze({ root, mods: [], now: Date.now() }); }
  catch (e) { ok('G1 真机分析不抛错', false, e.message); return; }
  ok('G1 真机分析不抛错', !!rep);
  ok('G2 读到 UE4SS 版本', !!rep.ue4ss.version, rep.ue4ss.version);
  ok('G3 崩溃记录非空', rep.stats.total > 0, String(rep.stats.total));
  ok('G4 结论有等级', ['high', 'mid', 'low', 'none'].includes(rep.analysis.verdict.level), rep.analysis.verdict.level);
  ok('G5 有排查步骤', rep.analysis.steps.length > 0, String(rep.analysis.steps.length));
  ok('G6 嫌疑带原因', rep.analysis.suspects.every(s => (s.reasons || []).length > 0));
  ok('G7 崩溃对象带原文路径', rep.crashes.slice(0, 3).every(c => !!c.xml), JSON.stringify(rep.crashes.slice(0, 1).map(c => c.xml)));
}

async function main() {
  testLogParse();
  testCrashParse();
  testPhase();
  testReports();
  testReadSourceGuard();
  testWiring();
  testRealMachine();

  if (fail) {
    console.log('❌ crashlog: ' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('\n失败项：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ crashlog: ' + pass + ' 通过 / 0 失败');
}

main().catch(e => {
  console.error('套件本身崩了：', e);
  process.exit(1);
});
