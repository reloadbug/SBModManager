'use strict';
/**
 * 打包入口（`npm run dist` / `npm run dist:dir`）。
 *
 * 为什么要包一层、而不是直接 `electron-builder --win`：
 *
 *   electron-builder 第一次打包时会去下载两样东西 ——
 *     · electron 运行时本体
 *     · 打包辅助二进制（nsis、winCodeSign、app-builder）
 *   后两者默认从 **github.com** 拉。本机实测 `github.com:443` 直连不通
 *   （ETIMEDOUT），所以必须换成 npmmirror 的镜像，否则第一次打包必然卡死/失败。
 *
 *   镜像地址只能通过环境变量给（`ELECTRON_BUILDER_BINARIES_MIRROR`），
 *   而环境变量在 Windows 的 npm script 里没法跨 shell 通用地设置
 *   （cmd 的 `VAR=x cmd` 语法在 PowerShell / Git Bash 里都不成立），
 *   所以在这里用 Node 设好再拉起 CLI —— 三种 shell 下都一样能跑。
 *
 * 另外顺手删掉 `ELECTRON_RUN_AS_NODE`：某些沙箱会给它注入 =1，
 * 那会让 Electron 退化成普通 Node 进程，打包出来的东西会不对。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/';
const BUILDER_MIRROR = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/';

process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || ELECTRON_MIRROR;
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR || BUILDER_MIRROR;
delete process.env.ELECTRON_RUN_AS_NODE;

let cli;
let version = '?';
try {
  version = require('electron-builder/package.json').version;
  cli = require.resolve('electron-builder/cli.js');
} catch (e) {
  console.error('[dist] 没找到 electron-builder，先执行：npm i -D electron-builder');
  process.exit(1);
}

const args = [cli, ...process.argv.slice(2)];

/**
 * 打包成功后，只保留当前版本的产物，清掉 dist 里的历史版本 exe/blockmap。
 *
 * 用户要求（2026-11-26）：dist 只留最新版本，以后每次打包自动做，不靠手动记。
 * 只删形如 `SBModManager-<旧版本>-*.exe|*.blockmap` 的构建产物；
 * 配置文件（latest.yml / builder-debug.yml / build.log）和 win-unpacked/ 一律不动，
 * 因为 electron-builder 升级时要读 latest.yml、调试要用 build.log。
 * 删之前先读 package.json 的当前版本，绝不误删这一版刚打好的包。
 */
function pruneOldArtifacts() {
  let pkgVersion;
  try {
    pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  } catch (e) {
    console.warn('[dist] 读不到 package.json 版本，跳过旧版本清理：' + e.message);
    return;
  }
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) return;
  const keep = new RegExp('^SBModManager-' + pkgVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-');
  const artifact = /^SBModManager-\d[\w.-]*?\.(exe|blockmap)$/i;
  let removed = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(distDir)) {
    if (!artifact.test(name) || keep.test(name)) continue;
    const full = path.join(distDir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      bytes += st.size;
      fs.unlinkSync(full);
      removed++;
    } catch (e) {
      console.warn('[dist] 删旧产物失败 ' + name + '：' + e.message);
    }
  }
  if (removed) {
    console.log('[dist] 已清理 ' + removed + ' 个旧版本产物（' + (bytes / 1048576).toFixed(1) + ' MB），只留 ' + pkgVersion);
  } else {
    console.log('[dist] 旧版本产物检查完成：无需清理（只留 ' + pkgVersion + '）');
  }
}

console.log('[dist] electron-builder ' + version);
console.log('[dist] ELECTRON_MIRROR                    = ' + process.env.ELECTRON_MIRROR);
console.log('[dist] ELECTRON_BUILDER_BINARIES_MIRROR   = ' + process.env.ELECTRON_BUILDER_BINARIES_MIRROR);
console.log('[dist] 参数：' + process.argv.slice(2).join(' ') || '(默认)');
console.log('');

const r = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..')
});

if (r.error) {
  console.error('[dist] 拉起 electron-builder 失败：' + r.error.message);
  process.exit(1);
}
// 只有打包真的成功才清理旧版本；失败时保留现场方便排查。
// 清理只针对 dist 里的历史 SBModManager-*.exe/.blockmap，绝不碰 latest.yml 等配置文件、
// 也不碰上一轮的配置内容（用户 2026-11-26 明确要求）。
if (r.status === 0) {
  // 用户要求：发布包里不能带 library（安装包是运行时下载/搬运的用户数据，不随程序发布）。
  // build.files 只打 src/**/*，正常情况下 win-unpacked 里不会有 library；这里加一道闸，
  // 万一以后有人改了打包配置把这个目录带进来，立刻失败而不是悄悄发一个巨大的包。
  const unpackedLib = path.join(__dirname, '..', 'dist', 'win-unpacked', 'library');
  if (fs.existsSync(unpackedLib)) {
    console.error('[dist] 发布包里出现了 library 目录：' + unpackedLib);
    console.error('[dist] library 是用户数据，不允许随程序发布；请检查 package.json 的 build.files。');
    process.exit(1);
  }
  pruneOldArtifacts();
} else {
  console.warn('[dist] 打包未成功（exit ' + r.status + '），跳过旧版本清理。');
}
process.exit(r.status === null ? 1 : r.status);
