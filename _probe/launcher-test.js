/*
 * launcher-test —— 双击即用的 exe（0.3.9）
 *
 * 这一轮把「启动方式」从 .bat 脚本换成真正的 exe：
 *   - NSIS 安装版：装到 %LOCALAPPDATA%\Programs\sbmodmanager，桌面留快捷方式
 *   - portable 便携版：双击解包到临时目录跑，放哪都行
 *   - 高分屏：命令行上只加 high-dpi-support，绝不 force-device-scale-factor
 *
 * 断言分五段：
 *   [1] package.json 的打包配置（产物名、图标、两个 target）
 *   [2] src/main/index.js 的高分屏开关（有 high-dpi-support、没有强制缩放因子、且在 createWindow 之前）
 *   [3] build/dist.js 的镜像与 ELECTRON_RUN_AS_NODE 清理
 *   [4] README 里写清了两个产物
 *   [5] dist/ 里真有产物时，校验文件名与体积（没打包过就跳过，不误报）
 *
 * 跑法：node _probe/launcher-test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
const fails = [];

function t(label, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + label);
  } catch (e) {
    fail++;
    fails.push(label + ' —— ' + e.message);
    console.log('  ✗ ' + label + ' —— ' + e.message);
  }
}

function eq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) throw new Error(label + `：期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`);
}

function ok(v, label) {
  if (!v) throw new Error(label || '断言失败');
}

const pkg = JSON.parse(read('package.json'));
const build = pkg.build || {};
const indexSrc = read('src/main/index.js');
const distSrc = read('build/dist.js');
const readme = read('README.md');

console.log('\n[1] package.json 的打包配置');
t('版本号是 0.3.x 之后的三段式', () => {
  ok(/^\d+\.\d+\.\d+$/.test(String(pkg.version)), '版本号形状不对：' + pkg.version);
  const [a, b] = String(pkg.version).split('.').map(Number);
  ok(a === 0 && b >= 3, '版本应 ≥ 0.3.0，实得 ' + pkg.version);
});
t('产品名与应用 id', () => {
  eq(build.productName, '剑星 Mod 管理器', 'productName');
  eq(build.appId, 'com.reloadbug.sbmodmanager', 'appId');
});
t('带应用图标', () => eq(build.win && build.win.icon, 'build/icon.ico', 'win.icon'));
t('两个 target：nsis + portable（都要 x64）', () => {
  const targets = (build.win && build.win.target) || [];
  ok(Array.isArray(targets) && targets.length === 2, 'target 应该是两个，实得 ' + JSON.stringify(targets));
  const byName = {};
  for (const x of targets) {
    const name = typeof x === 'string' ? x : x.target;
    const arch = typeof x === 'string' ? ['x64'] : (x.arch || []);
    byName[name] = arch;
    ok(arch.includes('x64'), name + ' 缺 x64');
  }
  ok(byName.nsis, '缺 nsis');
  ok(byName.portable, '缺 portable');
});
t('安装版：可换目录、不强制管理员、建桌面快捷方式', () => {
  const n = build.nsis || {};
  eq(n.oneClick, false, 'nsis.oneClick');
  eq(n.perMachine, false, 'nsis.perMachine');
  eq(n.createDesktopShortcut, true, 'nsis.createDesktopShortcut');
  eq(n.artifactName, 'SBModManager-${version}-setup.${ext}', 'nsis.artifactName');
});
t('便携版产物名', () => eq(build.portable && build.portable.artifactName, 'SBModManager-${version}-portable.${ext}', 'portable.artifactName'));
t('打包脚本还在（dist / dist:dir）', () => {
  ok(/build\/dist\.js/.test(pkg.scripts.dist || ''), 'scripts.dist 应调用 build/dist.js');
  ok(/--dir/.test(pkg.scripts['dist:dir'] || ''), 'scripts.dist:dir 应带 --dir');
});
t('打包产物不进 git（dist 被忽略）', () => {
  const gi = fs.existsSync(path.join(ROOT, '.gitignore')) ? read('.gitignore') : '';
  ok(/(^|\n)\s*\/?dist\/?\s*(\n|$)/.test(gi) || /dist\//.test(gi), '.gitignore 应忽略 dist');
});

console.log('\n[2] 高分屏开关（src/main/index.js）');
t('命令行上设了 high-dpi-support', () => {
  ok(/app\.commandLine\.appendSwitch\(\s*['"]high-dpi-support['"]\s*,\s*['"]1['"]\s*\)/.test(indexSrc),
    '没找到 appendSwitch(\'high-dpi-support\', \'1\')');
});
t('没有强制缩放因子（只在注释里提过，代码里不许出现）', () => {
  ok(!/^\s*app\.commandLine\.appendSwitch\(\s*['"]force-device-scale-factor/m.test(indexSrc),
    '代码里出现了 appendSwitch(\'force-device-scale-factor\')，会让 150% 屏上界面过小');
});
t('开关在 createWindow 之前生效', () => {
  const at = indexSrc.search(/appendSwitch\(\s*['"]high-dpi-support/);
  const w = indexSrc.search(/function createWindow\s*\(/);
  ok(at > 0 && w > 0, '定位失败');
  ok(at < w, 'high-dpi-support 应该写在 createWindow 之前');
});
t('兼容模式那组开关仍然在（不许被覆盖掉）', () => {
  ok(/COMPAT_FLAGS/.test(indexSrc), '缺 COMPAT_FLAGS');
  ok(/--no-sandbox/.test(indexSrc), '缺 --no-sandbox');
});

console.log('\n[3] build/dist.js 的镜像与环境保护');
t('设了 electron 与 builder-binaries 两个镜像', () => {
  ok(/ELECTRON_MIRROR\s*=/.test(distSrc), '缺 ELECTRON_MIRROR');
  ok(/ELECTRON_BUILDER_BINARIES_MIRROR/.test(distSrc), '缺 ELECTRON_BUILDER_BINARIES_MIRROR');
  ok(/registry\.npmmirror\.com/.test(distSrc), '镜像地址不像国内的 npmmirror');
});
t('删掉 ELECTRON_RUN_AS_NODE', () => ok(/delete\s+process\.env\.ELECTRON_RUN_AS_NODE/.test(distSrc), '缺 delete process.env.ELECTRON_RUN_AS_NODE'));
t('走 electron-builder（不自己拼 NSIS）', () => {
  ok(/electron-builder/.test(distSrc), '应调用 electron-builder');
});

console.log('\n[4] README 里写清两个产物');
t('提到安装版与便携版', () => {
  ok(/setup\.exe/.test(readme), '缺 setup.exe');
  ok(/portable\.exe/.test(readme), '缺 portable.exe');
});
t('说明双击即用', () => ok(/双击/.test(readme), 'README 应说明双击启动'));

console.log('\n[4b] 图标（美术稿驱动）');
t('有源图 build/icon-source.png', () => {
  const p = path.join(ROOT, 'build', 'icon-source.png');
  ok(fs.existsSync(p), '缺 build/icon-source.png —— 换图标就是把新图存成这个名字再跑 make-icon.py');
  const w = fs.statSync(p).size;
  ok(w > 100 * 1024, `源图只有 ${(w / 1024).toFixed(0)}KB，太小了不像是美术稿`);
});
t('icon.png 是 1024 的 png', () => {
  const p = path.join(ROOT, 'build', 'icon.png');
  ok(fs.existsSync(p), '缺 build/icon.png');
  // PNG 头 16~24 字节是宽高（大端）
  const b = fs.readFileSync(p).subarray(16, 24);
  const w = b.readUInt32BE(0);
  const h = b.readUInt32BE(4);
  ok(w === 1024 && h === 1024, `期望 1024×1024，实得 ${w}×${h}`);
});
t('icon.ico 是多尺寸（不是单张 256 糊出来的）', () => {
  const p = path.join(ROOT, 'build', 'icon.ico');
  ok(fs.existsSync(p), '缺 build/icon.ico');
  const b = fs.readFileSync(p);
  const type = b.readUInt16LE(2);
  const count = b.readUInt16LE(4);
  eq(type, 1, 'ico 头 type 应为 1');
  ok(count >= 5, `ico 里只有 ${count} 个尺寸，任务栏/小图标会糊`);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = b[off] === 0 ? 256 : b[off];
    sizes.push(w);
  }
  ok(sizes.includes(16) && sizes.includes(32) && sizes.includes(256), 'ico 应含 16/32/256，实得 ' + sizes.join('/'));
});
t('make-icon.py 从源图生成（不再手绘矢量）', () => {
  const py = fs.readFileSync(path.join(ROOT, 'build', 'make-icon.py'), 'utf8');
  ok(/icon-source\.png/.test(py), 'make-icon.py 应读取 build/icon-source.png');
  ok(/format='ICO'/.test(py) || /format="ICO"/.test(py), 'make-icon.py 应输出 ICO');
});
t('小尺寸预览图存在（换图标时要眼看 16px）', () => {
  ok(fs.existsSync(path.join(ROOT, 'build', 'icon-preview.png')), '缺 build/icon-preview.png');
});

console.log('\n[5] dist/ 里的产物（没打包就跳过）');
const dist = path.join(ROOT, 'dist');
const version = String(pkg.version);
const setupName = `SBModManager-${version}-setup.exe`;
const portableName = `SBModManager-${version}-portable.exe`;
const unpacked = path.join(dist, 'win-unpacked', '剑星 Mod 管理器.exe');
const hasDist = fs.existsSync(dist);

if (!hasDist) {
  console.log('  · 跳过：dist/ 还没有打包产物');
} else {
  t(`安装版 ${setupName} 存在且 > 50MB`, () => {
    const p = path.join(dist, setupName);
    ok(fs.existsSync(p), '文件不存在：' + setupName);
    const mb = fs.statSync(p).size / 1024 / 1024;
    ok(mb > 50, `体积只有 ${mb.toFixed(1)}MB，像是没打全`);
  });
  t(`便携版 ${portableName} 存在且 > 50MB`, () => {
    const p = path.join(dist, portableName);
    ok(fs.existsSync(p), '文件不存在：' + portableName);
    const mb = fs.statSync(p).size / 1024 / 1024;
    ok(mb > 50, `体积只有 ${mb.toFixed(1)}MB，像是没打全`);
  });
  t('win-unpacked 里有能直接双击的 exe', () => {
    ok(fs.existsSync(unpacked), '缺 win-unpacked/剑星 Mod 管理器.exe');
  });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  for (const f of fails) console.log('  - ' + f);
  process.exitCode = 1;
}
