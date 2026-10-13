'use strict';
// 探针：对「结构识别不了」的包跑一遍 analyze，看清 needsTargetPick 分支的真实输出
const path = require('path');
const installer = require('../src/main/installer');

const ROOT = 'D:\\games\\Star Blade';
const ARCHIVE = path.join(__dirname, '..', 'data', 'library', '692', 'Nexus Global Content Delivery Network');

(async () => {
  const meta = { name: 'Eve BP Nude (CNS Compatible)', modId: 692, fileId: 1 };
  const plan = await installer.analyze(ROOT, ARCHIVE, meta, {});

  console.log('ok           =', plan.ok);
  console.log('kind         =', plan.kind);
  console.log('needsTargetPick =', plan.needsTargetPick);
  console.log('fileCount    =', plan.fileCount);
  console.log('totalBytes   =', plan.totalBytes);
  console.log('warnings     =', JSON.stringify(plan.warnings, null, 1));

  const entries = plan.entries || [];
  console.log('\nentries 条数 =', entries.length, '（analyze 只回前 200 条）');

  // 提取「直接含 .pak 的目录」—— 这些就是可选变体
  const dirs = new Map();
  for (const p of entries) {
    const i = p.lastIndexOf('/');
    if (i < 0) continue;
    const dir = p.slice(0, i);
    const base = p.slice(i + 1);
    if (!/\.(pak|ucas|utoc)$/i.test(base)) continue;
    if (!dirs.has(dir)) dirs.set(dir, { dir, files: 0, pak: 0 });
    const d = dirs.get(dir);
    d.files++;
    if (/\.pak$/i.test(base)) d.pak++;
  }

  console.log('\n=== 直接含 pak 的目录（候选变体）===');
  for (const d of dirs.values()) {
    console.log('  ' + d.files + ' 文件 | ' + d.dir);
  }
  console.log('  共 ' + dirs.size + ' 个候选');
})().catch(e => { console.error('探针失败：' + e.message); process.exit(1); });
