'use strict';
/**
 * 把「开发版数据目录」搬进「打包版数据目录」。
 *
 * 背景：开发版把数据放在项目里的 `data/`（方便直接看文件），打包版放在
 * `%APPDATA%\<productName>\data`（`paths.resolveDataDir()` 的 `app.isPackaged` 分支）。
 * 两边是**两套独立的注册表** —— 打包版第一次启动会看到「所有 mod 都未登记」。
 *
 * 这个脚本把开发版的数据搬过去，并**重写注册表里的绝对路径**
 * （`backupDir` 与每条 `overwritten[].backup` 都指向旧数据目录），
 * 否则卸载时「还原被覆盖的原文件」会去找一个不存在的位置。
 *
 * 用法：
 *   node _probe/migrate-data.js            # 预演（只报告，不写任何东西）
 *   node _probe/migrate-data.js --apply    # 真正执行
 *   node _probe/migrate-data.js --apply --force   # 覆盖目标已存在的文件
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'data');
const PRODUCT = '剑星 Mod 管理器';
const DEST = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  PRODUCT, 'data'
);

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

/** 只搬这些：注册表、下载队列、覆盖备份、下载库。cache/logs/tmp 都是可再生的，不搬 */
const WANT_FILES = ['mods.json', 'downloads.json', 'config.json', 'watch-seen.json'];
const WANT_DIRS = ['backup', 'library'];

let copied = 0, skipped = 0, rewritten = 0;

function copyTree(from, to) {
  let items = [];
  try { items = fs.readdirSync(from, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const s = path.join(from, it.name);
    const d = path.join(to, it.name);
    if (it.isDirectory()) {
      if (APPLY) fs.mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else {
      if (fs.existsSync(d) && !FORCE) { skipped++; return; }
      if (APPLY) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
      copied++;
    }
  }
}

/** 把 JSON 里所有以 from 开头的绝对路径改写成 to */
function rewritePaths(obj, from, to) {
  const f = from.toLowerCase();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (v.toLowerCase().startsWith(f)) { rewritten++; return to + v.slice(from.length); }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(obj);
}

function main() {
  console.log('源（开发版）  ：' + SRC);
  console.log('目标（打包版）：' + DEST);
  console.log('模式          ：' + (APPLY ? '执行' : '预演（加 --apply 才真正写）')
    + (FORCE ? ' · 覆盖已存在文件' : ''));

  if (!fs.existsSync(SRC)) {
    console.error('\n源目录不存在，没什么可搬的。');
    process.exit(1);
  }
  if (path.resolve(SRC).toLowerCase() === path.resolve(DEST).toLowerCase()) {
    console.error('\n源和目标居然是同一个目录，中止。');
    process.exit(1);
  }

  console.log('\n--- 1) 复制文件 ---');
  if (APPLY) fs.mkdirSync(DEST, { recursive: true });
  for (const f of WANT_FILES) {
    const s = path.join(SRC, f);
    if (!fs.existsSync(s)) { console.log('  · 跳过（源里没有）' + f); continue; }
    const d = path.join(DEST, f);
    if (fs.existsSync(d) && !FORCE) { console.log('  · 跳过（目标已有）' + f); skipped++; continue; }
    if (APPLY) fs.copyFileSync(s, d);
    console.log('  ✓ ' + f);
    copied++;
  }
  for (const dir of WANT_DIRS) {
    const s = path.join(SRC, dir);
    if (!fs.existsSync(s)) { console.log('  · 跳过（源里没有）' + dir + '/'); continue; }
    const before = copied;
    if (APPLY) fs.mkdirSync(path.join(DEST, dir), { recursive: true });
    copyTree(s, path.join(DEST, dir));
    console.log('  ✓ ' + dir + '/  （' + (copied - before) + ' 个文件）');
  }

  console.log('\n--- 2) 重写注册表里的绝对路径 ---');
  const regSrc = path.join(SRC, 'mods.json');
  if (!fs.existsSync(regSrc)) {
    console.log('  · 源里没有 mods.json，跳过');
  } else {
    const reg = JSON.parse(fs.readFileSync(regSrc, 'utf8'));
    const fixed = rewritePaths(reg, SRC, DEST);
    console.log('  · 改写了 ' + rewritten + ' 处指向旧数据目录的路径');
    if (APPLY) {
      fs.writeFileSync(path.join(DEST, 'mods.json'), JSON.stringify(fixed, null, 2), 'utf8');
      console.log('  ✓ 已写出 ' + path.join(DEST, 'mods.json'));
    }
  }

  console.log('\n===== ' + (APPLY ? '完成' : '预演结束') + ' =====');
  console.log('复制 ' + copied + ' 个文件，跳过 ' + skipped + ' 个，重写路径 ' + rewritten + ' 处');
  if (!APPLY) console.log('（预演不会改动任何文件；确认无误后加 --apply 再跑一次）');

  if (APPLY) {
    console.log('\n下一步：启动打包版，到「已安装 Mod」页确认条目不再是「未登记」。');
  }
}

main();
