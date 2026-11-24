'use strict';
/**
 * 把 2272 / 3977 缺的那一套变体从安装包里补回游戏目录。
 * 只写「盘上确实没有」的文件，不碰已存在的文件，不改任何开关状态。
 * 用法：node _probe\repair-2272-3977.js [--apply]
 * 不带 --apply 时只打印要做的事。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const installer = M('installer.js');
const archive = M('archive.js');

const APPLY = process.argv.includes('--apply');
const root = 'C:\\games\\Star Blade';
const jobs = [
  { modId: 2272, name: 'Captain EVE Modular (CNS compatible)', ap: 'D:\\AI game\\StarBladeModManager\\data\\library\\2272_Captain EVE (CNS compatible)_1.01.rar' },
  { modId: 3977, name: 'more exposed bunny', ap: 'D:\\AI game\\StarBladeModManager\\data\\library\\3977_more exposed bunny_1.rar' }
];

(async () => {
  for (const j of jobs) {
    console.log('\n================ ' + j.name + '  (modId ' + j.modId + ') ================');
    const plan = await installer.analyze(root, j.ap, { name: j.name, modId: j.modId }, {});
    if (!plan || !plan.ok) { console.log('分析失败：' + (plan && (plan.diagnosis || plan.reason))); continue; }
    const v = installer.verifyExisting(plan);
    const byTo = new Map(plan.mapping.map(m => [m.to, m]));
    const todo = v.missing.concat(v.mismatched).map(f => byTo.get(f.path)).filter(Boolean);
    console.log('在位 ' + v.present.length + ' / 应装 ' + plan.mapping.length + '，要补 ' + todo.length + ' 个：');
    for (const m of todo) console.log('   + ' + path.basename(m.to) + '   ' + m.size);

    if (!APPLY) { console.log('（干跑，加 --apply 才真写）'); continue; }
    if (!todo.length) continue;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-' + j.modId + '-'));
    try {
      await archive.extract(j.ap, tmp);
      fs.mkdirSync(plan.target, { recursive: true });
      for (const m of todo) {
        const src = path.join(tmp, m.from.split('/').join(path.sep));
        if (!fs.existsSync(src)) { console.log('   ! 解压后找不到 ' + m.from); continue; }
        if (fs.existsSync(m.to)) { console.log('   = 已存在，跳过 ' + path.basename(m.to)); continue; }
        fs.copyFileSync(src, m.to);
        const st = fs.statSync(m.to);
        console.log('   ✓ 写入 ' + path.basename(m.to) + '  ' + st.size + (st.size === m.size ? ' 大小一致' : ' 大小不符!'));
      }
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    }
    const v2 = installer.verifyExisting(plan);
    console.log('补后复核：在位 ' + v2.present.length + '/' + plan.mapping.length + '  缺 ' + v2.missing.length + '  不符 ' + v2.mismatched.length);
  }
})().catch(e => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
