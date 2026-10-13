'use strict';
/**
 * 拿 data/library 里的**真实归档**跑一遍 installer.analyze，打印识别结果。
 *
 * 用途：
 *   · 看清实际存在的包结构（改规则前先有事实依据）
 *   · 改规则后回归：这些已装成功的包必须仍然识别成同样的落点
 *
 * analyze() 只列目录 + 算计划，**不写任何文件**，可以放心在纯 Node 里跑。
 *
 * 跑法：node _probe/analyze-real.js [--entries]
 */
const fs = require('fs');
const path = require('path');
const installer = require('../src/main/installer');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const GAME = 'D:\\games\\Star Blade';
const withEntries = process.argv.includes('--entries');

(async () => {
  const files = fs.readdirSync(LIB).filter(f => /\.(zip|7z|rar)$/i.test(f)).sort();
  console.log('游戏根：' + GAME);
  console.log('归档数：' + files.length + '\n');
  for (const f of files) {
    const p = path.join(LIB, f);
    let r;
    try {
      r = await installer.analyze(GAME, p, { name: f.replace(/\.[^.]+$/, '') }, {});
    } catch (e) {
      console.log('✗ ' + f + '\n    抛出：' + e.message + '\n');
      continue;
    }
    const mark = r.ok ? '✓' : '✗';
    console.log(mark + ' ' + f);
    console.log('    kind=' + r.kind + ' strip=' + JSON.stringify(r.strip) +
      ' pakCount=' + r.pakCount + ' files=' + r.fileCount);
    console.log('    target=' + r.target);
    console.log('    reason=' + r.reason);
    if (!r.ok) {
      console.log('    options=' + JSON.stringify((r.options || []).map(o => o.dir + '(' + o.files + ')')));
      console.log('    entries=' + JSON.stringify((r.entries || []).slice(0, 40)));
    } else if (withEntries) {
      console.log('    entries=' + JSON.stringify((r.entries || r.plan && r.plan.entries || []).slice(0, 40)));
    }
    console.log('');
  }
})();
