'use strict';
// 探针：验证「结构识别不了」的包在指定 pickDir 后能否正确落盘
const path = require('path');
const installer = require('../src/main/installer');

const ROOT = 'D:\\games\\Star Blade';
const ARCHIVE = path.join(__dirname, '..', 'data', 'library', '692', 'Nexus Global Content Delivery Network');

(async () => {
  const meta = { name: 'Eve BP Nude (CNS Compatible)', modId: 692, fileId: 1 };

  console.log('=== 1) 不指定 pickDir ===');
  const p0 = await installer.analyze(ROOT, ARCHIVE, meta, {});
  console.log('ok=' + p0.ok, 'needsTargetPick=' + p0.needsTargetPick, 'options=' + (p0.options || []).length);
  console.log('候选：');
  for (const o of (p0.options || [])) {
    console.log(`  [${o.files} 文件 ${o.size} B] group="${o.group}" label="${o.label}"`);
    console.log(`     dir="${o.dir}"`);
  }

  console.log('\n=== 2) 指定 pickDir（选 Skin Suit_A）===');
  const pick = 'BP_Nude_Skin Suit (2 variants)/BP_Nude_Skin Suit_A';
  const p1 = await installer.analyze(ROOT, ARCHIVE, meta, { pickDir: pick });
  console.log('ok        =', p1.ok);
  console.log('kind      =', p1.kind);
  console.log('target    =', p1.target);
  console.log('strip     =', p1.strip, '| strippedPrefix =', p1.strippedPrefix);
  console.log('reason    =', p1.reason);
  console.log('fileCount =', p1.fileCount);
  console.log('mapping（落点相对路径 → 归档内路径）：');
  for (const m of (p1.mapping || [])) {
    console.log('  ' + (m.rel || m.to || JSON.stringify(m)).slice(0, 90));
  }
  console.log('warnings  =', JSON.stringify(p1.warnings));

  console.log('\n=== 3) 指定 pickDir（选单层目录 EVE39_...）===');
  const p2 = await installer.analyze(ROOT, ARCHIVE, meta, { pickDir: 'EVE39_BP_Nude_Daily Force (1variants)' });
  console.log('ok=' + p2.ok, 'kind=' + p2.kind, 'target=' + p2.target, 'fileCount=' + p2.fileCount);
  console.log('reason    =', p2.reason);

  console.log('\n=== 4) 指定一个不存在的 pickDir（应回落成 needsTargetPick）===');
  const p3 = await installer.analyze(ROOT, ARCHIVE, meta, { pickDir: '不存在的目录' });
  console.log('ok=' + p3.ok, 'needsTargetPick=' + p3.needsTargetPick);
})().catch(e => { console.error('探针失败：' + e.message + '\n' + e.stack); process.exit(1); });
