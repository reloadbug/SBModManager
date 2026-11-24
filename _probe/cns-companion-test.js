'use strict';
/**
 * 探针：CNS 服装数据文件（.dekcns.json / .dekani.json）挂在同名 pak 组上
 *        + 「补登记」的前置校验 installer.verifyExisting()。
 *
 * 背景（2026-11-24，mod 4184「Blossom Butterfly Sexy JK Girl」）：
 *   · `.dekcns.json` 以前被 scanPaks 一句 `if (!PAK_EXT.test(base)) continue` 丢掉，
 *     界面上完全看不见，关 pak 不关外观数据、卸载也不带走它；
 *   · 记录丢了但文件还在盘上时，只能整包重装（白覆盖一百多 MB）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const scanner = M('scanner.js');
const installer = M('installer.js');
const { createRegistry } = M('registry.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [ OK ] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-cns-'));
const modsDir = path.join(tmp, 'SB', 'Content', 'Paks', '~Mods');
fs.mkdirSync(modsDir, { recursive: true });

const write = (name, bytes) => fs.writeFileSync(path.join(modsDir, name), Buffer.alloc(bytes, 0x41));

// ① 同名一套（差 `_P` 与一处下划线，正是 4184 的形状）
write('Kamenlaideng_Sexy Jk_P [nx4184].pak', 339);
write('Kamenlaideng_Sexy Jk_P [nx4184].ucas', 2048);
write('Kamenlaideng_Sexy Jk_P [nx4184].utoc', 128);
write('Kamenlaideng_SexyJK.dekcns.json', 300);

// ② 伴随件被单独关掉
write('Mask_Mode_P [nx7].pak', 339);
write('Mask_Mode.dekcns.disabled.json', 200);

// ③ 名字差太远（另一个 mod 的数据文件）→ 不许硬凑
write('Foo_P [nx9].pak', 339);
write('Completely_Different_Thing.dekcns.json', 100);

// ④ 已登记的组：也带伴随件（同一套文件一起开关/卸载）
write('Regged_P [nx11].pak', 339);
write('Regged_P [nx11].ucas', 4096);
write('Regged.dekcns.json', 150);

const regFile = path.join(tmp, 'mods.json');
const registry = createRegistry(regFile);
registry.upsert({
  id: 'nexus:11:1', name: 'Regged', kind: 'pak', enabled: true,
  installedAt: '2026-11-01T00:00:00.000Z',
  manifest: [{ path: path.join(modsDir, 'Regged_P [nx11].pak'), rel: 'Regged_P [nx11].pak', size: 339 },
    { path: path.join(modsDir, 'Regged_P [nx11].ucas'), rel: 'Regged_P [nx11].ucas', size: 4096 }]
});

const L = { modsDir };
const out = scanner.scanPaks(L, registry);
const byKey = (k) => out.find(m => m.name === k) || null;

console.log('\n【A】同名 pak 组带上伴随件');
const jk = byKey('Kamenlaideng_Sexy Jk_P [nx4184]');
ok('1184 形状的组被扫出来', !!jk);
ok('组里 4 个文件（3 pak + 1 数据）', jk && jk.fileCount === 4, jk && jk.fileCount);
ok('数据文件标了 companion', jk && jk.files.some(f => f.companion && f.name === 'Kamenlaideng_SexyJK.dekcns.json'));
ok('cnsData 里记了它', jk && (jk.cnsData || []).includes('Kamenlaideng_SexyJK.dekcns.json'));
ok('大小把伴随件算进去了', jk && jk.size === 339 + 2048 + 128 + 300, jk && jk.size);

console.log('\n【B】伴随件被单独关掉');
const mask = byKey('Mask_Mode_P [nx7]');
ok('组扫出来了', !!mask);
ok('伴随件挂上了', mask && (mask.cnsData || []).includes('Mask_Mode.dekcns.disabled.json'));
ok('打了 partialDisabled 标记', mask && mask.partialDisabled === true);
ok('pak 自己仍算启用（开关态由 pak 决定）', mask && mask.enabled === true);

console.log('\n【C】名字差太远的不硬凑');
const foo = byKey('Foo_P [nx9]');
ok('Foo 组只有 1 个文件', foo && foo.fileCount === 1, foo && foo.fileCount);
ok('不相干的数据文件没被挂上', !out.some(m => (m.cnsData || []).includes('Completely_Different_Thing.dekcns.json')));

console.log('\n【D】已登记的组也带上伴随件（同一套东西一起开关/卸载）');
const regged = out.find(m => m.registered);
ok('找到已登记条目', !!regged);
ok('已登记条目的文件数把伴随件算进来（3 个）', regged && regged.fileCount === 3, regged && regged.fileCount);
ok('已登记条目的 cnsData 里有它', regged && (regged.cnsData || []).includes('Regged.dekcns.json'));

console.log('\n【E】verifyExisting：补登记的前置校验');
const planOf = (pairs) => ({ mapping: pairs.map(([n, size]) => ({ from: n, rel: n, to: path.join(modsDir, n), size })) });
const v1 = installer.verifyExisting(planOf([['Foo_P [nx9].pak', 339], ['Kamenlaideng_SexyJK.dekcns.json', 300]]));
ok('文件都在、大小一致 → ok', v1.ok === true, JSON.stringify(v1.missing.concat(v1.mismatched)));
ok('present 里带回创建时间', !!v1.present[0].bornAt);

const v2 = installer.verifyExisting(planOf([['Foo_P [nx9].pak', 999]]));
ok('大小不一致 → 不 ok', v2.ok === false && v2.mismatched.length === 1);

const v3 = installer.verifyExisting(planOf([['Not_Here_P.pak', 339]]));
ok('文件不在 → 不 ok', v3.ok === false && v3.missing.length === 1);

const v4 = installer.verifyExisting(planOf([['Mask_Mode.dekcns.json', 200]]));
ok('关掉的文件（.disabled 写法）也能认出来', v4.ok === true && v4.present[0].disabled === true, JSON.stringify(v4.missing));
ok('认出来的是盘上真实名字', v4.present[0] && v4.present[0].path.endsWith('Mask_Mode.dekcns.disabled.json'));

console.log('\n【F】接线：IPC / preload / 渲染层都通了');
const src = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
ok('installer 导出 verifyExisting', src('main/installer.js').includes('verifyExisting,'));
ok('ipc 有 registerExisting', src('main/ipc.js').includes('async function registerExisting('));
ok('ipc 注册了 mods:registerExisting', src('main/ipc.js').includes("handle('mods:registerExisting'"));
ok('preload 暴露 mods.registerExisting', src('preload/index.js').includes('registerExisting:'));
ok('渲染层有补登记按钮', src('renderer/app.js').includes('data-dl-register'));
ok('渲染层有处理函数', src('renderer/app.js').includes('async function dlRegisterExisting('));

console.log('\n【G】同一条登记记录横跨两套文件 → 只出一张卡');
// mod 4184 的真实形状：一条记录 = 「物理特效组」+「衣服组」两个 pak 基名。
// scanPaks 按基名各出一条、id 却是同一条记录，scan() 里必须按 id 合回一张。
write('Two_Group_A_P [nx4184].pak', 339);
write('Two_Group_A_P [nx4184].ucas', 1024);
write('Two_Group_B_P [nx4184].pak', 339);
write('Two_Group_A.dekcns.json', 111);   // 挂到 A 组，合并后仍只有一张卡
registry.upsert({
  id: 'nexus:4184:test', name: 'Two Group Mod', kind: 'cns', enabled: true,
  installedAt: '2026-11-02T00:00:00.000Z',
  manifest: [
    { path: path.join(modsDir, 'Two_Group_A_P [nx4184].pak'), rel: 'Two_Group_A_P [nx4184].pak', size: 339 },
    { path: path.join(modsDir, 'Two_Group_A_P [nx4184].ucas'), rel: 'Two_Group_A_P [nx4184].ucas', size: 1024 },
    { path: path.join(modsDir, 'Two_Group_B_P [nx4184].pak'), rel: 'Two_Group_B_P [nx4184].pak', size: 339 }
  ]
});
const whole = scanner.scan(tmp, registry, null);
const dupe = whole.filter(m => m.id === 'nexus:4184:test');
ok('同一条记录只出现一次', dupe.length === 1, dupe.length);
ok('合并后文件取并集（4 个：A 三件 + B 一件）', dupe[0] && dupe[0].fileCount === 4, dupe[0] && dupe[0].fileCount);
ok('伴随件没丢', dupe[0] && (dupe[0].cnsData || []).includes('Two_Group_A.dekcns.json'));
ok('大小是两组相加', dupe[0] && dupe[0].size === 339 + 1024 + 339 + 111, dupe[0] && dupe[0].size);
ok('整轮没有重复 id', new Set(whole.map(m => m.id)).size === whole.length);

console.log('\n【H】补登记把任务从「已下载」翻成「已安装」');
ok('引擎有 markRegistered', src('main/downloadEngine.js').includes('function markRegistered('));
ok('引擎导出了 markRegistered', /syncFromInstalled,\s*markRegistered/.test(src('main/downloadEngine.js'))
  || src('main/downloadEngine.js').includes('markRegistered,'));
ok('ipc 补登记里调了 markRegistered', src('main/ipc.js').includes('engine.markRegistered('));

console.log('\n---------------------------------------------');
console.log(`通过 ${pass} / 失败 ${fail}`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
