'use strict';
/*
 * 分析一个 mod 压缩包的结构识别结果（用真实游戏目录做落点判断，但**不写任何文件**）。
 *
 * 用法：node _probe/cns-pkg-analyze.js [zip路径]
 */
const installer = require('../src/main/installer');
const archive = require('../src/main/archive');

const GAME = 'D:\\games\\Star Blade';
const zip = process.argv[2] || 'D:\\Downloads\\CustomNanosuitSystem-1496-2-2-1771093897.zip';

(async () => {
  console.log('工具: ' + JSON.stringify(archive.toolInfo()));
  console.log('包  : ' + zip);
  console.log('');

  const { entries } = await archive.listEntries(zip);
  console.log('=== 归档条目（共 ' + entries.length + ' 条）===');
  for (const e of entries) console.log('  ' + (e.dir ? '[D] ' : '    ') + e.path);

  console.log('');
  console.log('=== analyze ===');
  try {
    const plan = await installer.analyze(GAME, zip, { name: 'CNS' });
    console.log(JSON.stringify({
      ok: plan.ok,
      kind: plan.kind,
      kindLabel: plan.kindLabel,
      target: plan.target,
      targetLabel: plan.targetLabel,
      fileCount: plan.fileCount,
      conflictCount: plan.conflictCount,
      strippedPrefix: plan.strippedPrefix,
      reason: plan.reason,
      warnings: plan.warnings,
      skipped: plan.skipped,
      needsTargetPick: plan.needsTargetPick
    }, null, 2));

    console.log('--- mapping ---');
    (plan.mapping || []).forEach(m => console.log('  ' + m.from + '\n        ->  ' + m.to));
    console.log('--- 冲突文件 ---');
    (plan.conflicts || []).forEach(c => console.log('  ! ' + c));
  } catch (e) {
    console.log('analyze 抛错: ' + e.message);
    console.log(e.stack);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
