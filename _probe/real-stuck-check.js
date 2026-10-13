'use strict';
/**
 * 对 `data/library/` 里的**真实归档**跑一遍结构识别，验证本轮三条新规则。
 *
 * 纯 Node：不启 Electron、不写任何文件、不碰游戏目录。
 *
 * 用法：
 *   node _probe/real-stuck-check.js            # 只查「队列里非 installed 的」任务
 *   node _probe/real-stuck-check.js 1647 2182  # 只查指定的 modId
 *   node _probe/real-stuck-check.js --all      # 查 library 里**全部**归档（体检）
 */
const fs = require('fs');
const path = require('path');

const installer = require('../src/main/installer');
const paths = require('../src/main/paths');
const { createRegistry } = require('../src/main/registry');
const { ownedPathsFor } = require('../src/main/installFlow');

const ROOT = 'D:\\games\\Star Blade';

(async () => {
  const reg = createRegistry(paths.registryFile);
  const wantIds = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const all = process.argv.includes('--all');

  // 队列里「还没装成」的任务 —— 它们才是需要识别的
  let tasks = [];
  try { tasks = JSON.parse(fs.readFileSync(paths.downloadQueueFile, 'utf8')).tasks || []; }
  catch { tasks = []; }
  const pending = tasks.filter(t => t.status !== 'installed' && t.archivePath);
  const byId = new Map();
  for (const t of pending) {
    const id = Number(t.meta && t.meta.modId);
    if (id && !byId.has(id)) byId.set(id, t);
  }

  const libFiles = fs.readdirSync(paths.LIBRARY).filter(f => !f.startsWith('.'));
  const targets = wantIds.length
    ? wantIds.map(id => ({ id, archive: (libFiles.find(f => f.startsWith(id + '_')) || null), task: byId.get(id) || null }))
    : all
      ? libFiles.map(f => {
          const id = Number((/^(\d+)_/.exec(f) || [])[1]) || 0;
          return { id, archive: f, task: byId.get(id) || null };
        })
      : [...byId.keys()].map(id => ({ id, archive: libFiles.find(f => f.startsWith(id + '_')) || null, task: byId.get(id) }));

  console.log('游戏根 : ' + ROOT);
  console.log('待识别 : ' + targets.length + ' 个 mod\n');

  let okAuto = 0, okVariant = 0, noSource = 0, broken = 0, needReview = 0;

  for (const { id, archive, task } of targets) {
    const label = 'mod ' + String(id).padStart(5);
    if (!archive) { console.log(label + ' : 归档不在 library，跳过'); continue; }
    const archivePath = path.join(paths.LIBRARY, archive);
    const meta = { ...((task && task.meta) || {}), modId: id, name: archive };
    const owned = ownedPathsFor(reg, meta);

    let plan;
    try { plan = await installer.analyze(ROOT, archivePath, meta, { ownedPaths: owned }); }
    catch (e) { broken++; console.log(label + ' : ✗ analyze 抛错 ' + e.message); continue; }

    const conflicts = plan.conflictCount || 0;
    console.log('=== ' + label + '  ' + archive.slice(0, 58));
    const soft = plan.softOverwriteCount || 0;
    console.log('    ok=' + plan.ok + ' kind=' + plan.kind +
      ' conflict=' + conflicts + ' softOverwrite=' + soft +
      ' selfOverwrite=' + (plan.selfOverwriteCount || 0) +
      ' 自己已装=' + owned.length + ' 个');
    console.log('    落点: ' + (plan.target || '(未定)'));
    if (plan.reason) console.log('    理由: ' + plan.reason);
    if (plan.diagnosis) console.log('    结论: ' + plan.diagnosis);
    if (plan.options && plan.options.length) console.log('    候选: ' + plan.options.length + ' 个');
    if (conflicts) console.log('    冲突: ' + plan.conflicts.map(p => p.split('\\').pop()).join(', '));
    if (soft) console.log('    软覆盖(同名同大小): ' + plan.softOverwritePaths.map(p => p.split('\\').pop()).join(', '));

    if (!plan.ok && plan.diagnosis) noSource++;
    else if (!plan.ok && (plan.options || []).length) okVariant++;
    else if (plan.ok && conflicts === 0) okAuto++;
    else if (plan.ok && conflicts > 0) needReview++;
  }

  console.log('\n---- 汇总 ----');
  console.log('可直接自动安装（ok 且无冲突）  : ' + okAuto);
  console.log('需用户选一套（多选一变体包）   : ' + okVariant);
  console.log('不是游戏 Mod（源文件等）       : ' + noSource);
  console.log('真冲突·待用户确认              : ' + needReview);
  if (broken) console.log('analyze 抛错                   : ' + broken);
})();
