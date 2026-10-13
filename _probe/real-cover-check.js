'use strict';
/**
 * 本机诊断：对 `data/library/` 里**真实变体包**跑一遍预览图配对，看命中率。
 *
 * 纯 Node：不启 Electron、不写游戏目录。
 * 只往 `data/cache/variants/` 写**真实的预览图**（这是正常的运行时缓存，不是垃圾）。
 *
 * 用法：
 *   node _probe/real-cover-check.js           # 只看队列里非 installed 的
 *   node _probe/real-cover-check.js --all     # 全部归档
 *   node _probe/real-cover-check.js 1430 437  # 指定 modId
 */
const fs = require('fs');
const path = require('path');

const installer = require('../src/main/installer');
const paths = require('../src/main/paths');
const variantCover = require('../src/main/variantCover');

const ROOT = 'D:\\games\\Star Blade';

(async () => {
  const wantIds = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const all = process.argv.includes('--all');

  let tasks = [];
  try { tasks = JSON.parse(fs.readFileSync(paths.downloadQueueFile, 'utf8')).tasks || []; }
  catch { tasks = []; }
  const byId = new Map();
  for (const t of tasks) {
    const id = Number(t.meta && t.meta.modId);
    if (id && !byId.has(id)) byId.set(id, t);
  }

  const libFiles = fs.readdirSync(paths.LIBRARY).filter(f => !f.startsWith('.'));
  const targets = wantIds.length
    ? wantIds.map(id => ({ id, archive: libFiles.find(f => f.startsWith(id + '_')) || null }))
    : all
      ? libFiles.map(f => ({ id: Number((/^(\d+)_/.exec(f) || [])[1]) || 0, archive: f }))
      : [...byId.keys()].map(id => ({ id, archive: libFiles.find(f => f.startsWith(id + '_')) || null }));

  let withOpts = 0, allCovered = 0, someCovered = 0, noneCovered = 0, totalImgs = 0;

  for (const { id, archive } of targets) {
    if (!archive) continue;
    const archivePath = path.join(paths.LIBRARY, archive);
    const meta = { modId: id, name: archive };

    let plan;
    try { plan = await installer.analyze(ROOT, archivePath, meta, {}); }
    catch { continue; }

    const dirs = (plan.options || []).map(o => o.dir);
    if (!dirs.length) continue;          // 不是变体包，跳过
    withOpts++;

    let cov = {};
    try { cov = await variantCover.coversFor(archivePath, dirs); } catch { cov = {}; }
    const hit = Object.keys(cov).length;
    totalImgs += hit;

    const label = 'mod ' + String(id).padStart(5);
    console.log('=== ' + label + '  候选 ' + dirs.length + '  有图 ' + hit);
    for (const d of dirs) console.log('   ' + (cov[d] ? '[图]' : '[  ]') + ' ' + d);

    if (hit === 0) noneCovered++;
    else if (hit === dirs.length) allCovered++;
    else someCovered++;
  }

  console.log('\n---- 汇总 ----');
  console.log('变体包总数        : ' + withOpts);
  console.log('每套都有图        : ' + allCovered);
  console.log('部分有图          : ' + someCovered);
  console.log('完全没图（正常）  : ' + noneCovered);
  console.log('解出图片总数      : ' + totalImgs);
})();
