#!/usr/bin/env node
'use strict';

/**
 * 把 dist 里刚打好的免安装版复制到仓库根目录，并顺手把「完整性级别」修正为 Medium。
 *
 * 为什么需要这一步（2026-11-10 实测踩到）：
 *   这台机器的工作区根目录曾被标成低完整性（Mandatory Label\Low Mandatory Level），
 *   从这里复制出来的 exe 会继承那个标签。Windows 会让用低完整性 exe 启动的进程
 *   也跑在低完整性上，而低完整性进程无权往中完整性的 %TEMP% 写东西 ——
 *   NSIS 免安装包（先把 app 解到 %TEMP% 再运行）于是双击就弹：
 *     「NSIS Error: Error writing temporary file. Make sure your temp folder is valid.」
 *   同一份 exe 放到别处（继承 Medium）就能正常启动，所以这不是包坏了。
 *
 * 用法：
 *   node build/portable.js            # 复制当前 package.json 版本对应的 portable
 *   node build/portable.js 0.4.15     # 指定版本
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = process.argv[2] || pkg.version;
const name = `SBModManager-${version}-portable.exe`;
const src = path.join(ROOT, 'dist', name);
const dst = path.join(ROOT, name);

function fail(msg) {
  console.error('[portable] ' + msg);
  process.exit(1);
}

if (!fs.existsSync(src)) {
  fail(`找不到 ${src}，先跑一次打包（node build/dist.js --win）。`);
}

// 复制（旧文件可能被占用，重试几次）
let copied = false;
for (let i = 0; i < 5 && !copied; i++) {
  try {
    fs.copyFileSync(src, dst);
    copied = true;
  } catch (e) {
    if (i === 4) fail('复制失败：' + e.message);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  }
}

// 修正完整性级别：低完整性 → 中完整性（只对 Windows 有意义）
let label = '';
if (process.platform === 'win32') {
  const r = spawnSync('icacls', [dst, '/setintegritylevel', 'M'], { encoding: 'utf8' });
  if (r.status !== 0) console.warn('[portable] 修正完整性级别失败（不致命）：' + (r.stderr || '').trim());
  const q = spawnSync('icacls', [dst], { encoding: 'utf8' });
  const line = String(q.stdout || '').split(/\r?\n/).find(l => /Mandatory Label/i.test(l)) || '';
  label = line.replace(/\s+/g, ' ').trim();
}

const size = fs.statSync(dst).size;
console.log(`[portable] ${name} → 仓库根目录`);
console.log(`[portable] 大小 ${(size / 1024 / 1024).toFixed(1)} MB`);
if (label) console.log('[portable] ' + label);
if (/Low Mandatory/i.test(label)) {
  console.warn('[portable] ⚠ 仍是低完整性：双击可能报 NSIS「Error writing temporary file」，请检查 icacls 权限。');
}
