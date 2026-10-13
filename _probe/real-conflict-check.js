'use strict';
/**
 * 对 `data/library/` 里的**真实归档**跑「会被覆盖的文件」归属核查。
 *
 * 纯 Node：只读，不启 Electron、不写任何文件、不碰游戏目录。
 *
 * 验的是 `installFlow.explainConflicts` 在**真实注册表**上的表现：
 * 每条冲突能不能查出「原来是谁装的」，以及「是不是同一个 mod」。
 *
 * 用法：
 *   node _probe/real-conflict-check.js            # 只看有冲突的
 *   node _probe/real-conflict-check.js 3023 1595  # 只看指定 modId
 *   node _probe/real-conflict-check.js --all      # 全部归档（体检，慢）
 *   node _probe/real-conflict-check.js --rows=20  # 每个 mod 最多打印 20 条
 *
 * ⚠️ 本机诊断脚本，**故意不进 `test:all`**（依赖真实游戏目录与用户 data/）。
 */
const fs = require('fs');
const path = require('path');

const installer = require('../src/main/installer');
const paths = require('../src/main/paths');
const { createRegistry } = require('../src/main/registry');
const { ownedPathsFor, explainConflicts } = require('../src/main/installFlow');

const ROOT = 'D:\\games\\Star Blade';
const argRows = process.argv.find(a => a.startsWith('--rows='));
const ROWS = argRows ? Math.max(1, Number(argRows.split('=')[1]) || 10) : 10;

(async () => {
  const reg = createRegistry(paths.registryFile);
  const wantIds = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const all = process.argv.includes('--all');

  const libFiles = fs.readdirSync(paths.LIBRARY).filter(f => !f.startsWith('.'));
  const targets = wantIds.length
    ? wantIds.map(id => ({ id, archive: libFiles.find(f => f.startsWith(id + '_')) || null }))
    : libFiles.map(f => ({ id: Number((/^(\d+)_/.exec(f) || [])[1]) || 0, archive: f }));

  console.log('游戏根 : ' + ROOT);
  console.log('注册表 : ' + reg.all().length + ' 条');
  console.log('归档   : ' + targets.length + ' 个\n');

  let withConf = 0, totalRows = 0, selfN = 0, otherN = 0, noneN = 0, softN = 0;
  const owners = new Map();   // 谁的文件被撞得最多

  for (const { id, archive } of targets) {
    if (!archive) { console.log('mod ' + id + ' : 归档不在 library，跳过'); continue; }
    const archivePath = path.join(paths.LIBRARY, archive);
    const meta = { modId: id, name: archive };

    let plan;
    try { plan = await installer.analyze(ROOT, archivePath, meta, { ownedPaths: ownedPathsFor(reg, meta) }); }
    catch (e) { console.log('mod ' + id + ' : ✗ analyze 抛错 ' + e.message); continue; }
    if (!plan.ok) continue;

    const d = explainConflicts(reg, ROOT, plan, meta, 500);
    if (!d.total) continue;

    withConf++;
    totalRows += d.total;
    softN += d.sameSizeCount;

    console.log('=== mod ' + String(id).padStart(5) + '  ' + archive.slice(0, 56));
    console.log('    共 ' + d.total + ' 个文件会被覆盖（其中同名同大小 ' + d.sameSizeCount + ' 个）');
    for (const x of d.items.slice(0, ROWS)) {
      // 版本号可能自带 `v`，别拼成 "vv1.0"
      const vtag = (o) => {
        const v = o && o.version ? String(o.version).trim() : '';
        return v ? (/^v/i.test(v) ? ' ' : ' v') + v : '';
      };
      const own = x.owners || (x.owner ? [x.owner] : []);
      const others = own.filter(o => !o.isSelf);
      let who;
      if (!own.length) { who = '【不是 mod 装的】'; noneN++; }
      else if (!others.length) { who = '【同一个 mod】' + own[0].name + vtag(own[0]); selfN++; }
      else {
        who = '【别的 mod】' + others.map(o => o.name + vtag(o)).join('  /  ')
          + (own.length > others.length ? '（也含你自己装的）' : '');
        otherN++;
      }
      for (const o of others) owners.set(o.name, (owners.get(o.name) || 0) + 1);
      const size = x.currentSize == null ? '?' : x.currentSize;
      console.log('      ' + (x.sameSize ? '≈' : '!') + ' ' + x.rel + '  (' + size +
        ' → ' + (x.incomingSize == null ? '?' : x.incomingSize) + ')  ' + who);
    }
    if (d.total > ROWS) console.log('      …还有 ' + (d.total - ROWS) + ' 条');
  }

  console.log('\n---- 汇总 ----');
  console.log('有冲突的 mod        : ' + withConf);
  console.log('冲突文件总条数      : ' + totalRows + '（同名同大小 ' + softN + '）');
  console.log('  · 不是 mod 装的   : ' + noneN);
  console.log('  · 别的 mod 装的   : ' + otherN);
  console.log('  · 同一个 mod 自己 : ' + selfN);
  if (owners.size) {
    console.log('\n被撞得最多的 mod（别的 mod 那一类）：');
    [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([n, c]) => console.log('  ' + String(c).padStart(4) + ' 次  ' + n));
  }
})();
