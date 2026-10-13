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
process.exit(r.status === null ? 1 : r.status);
