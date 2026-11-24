'use strict';
/**
 * 诊断 2272 / 3977 这两个「少一套变体」的包：
 *  - 包里到底有什么、装到哪、签名有没有冲突
 *  - 盘上哪些在位（含 .disabled 写法）、哪些真的没了
 * 只读。
 */
const path = require('path');
const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const installer = M('installer.js');
const archive = M('archive.js');

const root = 'C:\\games\\Star Blade';
const jobs = [
  { modId: 2272, name: 'Captain EVE Modular (CNS compatible)', ap: 'D:\\AI game\\StarBladeModManager\\data\\library\\2272_Captain EVE (CNS compatible)_1.01.rar' },
  { modId: 3977, name: 'more exposed bunny', ap: 'D:\\AI game\\StarBladeModManager\\data\\library\\3977_more exposed bunny_1.rar' }
];

(async () => {
  for (const j of jobs) {
    console.log('\n================ ' + j.name + '  (modId ' + j.modId + ') ================');
    const list = await archive.listEntries(j.ap);
    console.log('包内文件：');
    for (const e of (list.entries || [])) {
      if (e.isDir) continue;
      console.log('   ' + e.path + '   ' + e.size);
    }
    let plan = await installer.analyze(root, j.ap, { name: j.name, modId: j.modId }, {});
    if (plan && !plan.ok && plan.needsTargetPick && Array.isArray(plan.options) && plan.options.length
        && plan.hasConflicts === false) {
      const dirs = (plan.defaultPick && plan.defaultPick.length) ? plan.defaultPick : plan.options.map(o => o.dir).filter(Boolean);
      console.log('多变体：options=' + plan.options.map(o => o.dir).join(' | ') + ' → 取 ' + dirs.join(' | '));
      plan = await installer.analyze(root, j.ap, { name: j.name, modId: j.modId }, { pickDirs: dirs });
    }
    if (!plan || !plan.ok) { console.log('分析失败：', plan && (plan.diagnosis || plan.reason)); continue; }
    console.log('kind=' + plan.kind + '  target=' + plan.target + '  hasConflicts=' + plan.hasConflicts
      + '  soft=' + plan.softOverwriteCount + '  self=' + plan.selfOverwriteCount);
    const v = installer.verifyExisting(plan);
    console.log('在位 ' + v.present.length + '/' + plan.mapping.length + '：');
    for (const f of v.present) console.log('   [在位] ' + path.basename(f.path) + (f.disabled ? '   (关着)' : ''));
    for (const f of v.missing) console.log('   [缺失] ' + path.basename(f.path));
    for (const f of v.mismatched) console.log('   [大小不符] ' + path.basename(f.path));
  }
})().catch(e => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
