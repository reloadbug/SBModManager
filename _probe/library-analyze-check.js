'use strict';
/**
 * 拿 `data/library/` 里**真实下载过的包**跑一遍结构识别，
 * 看哪些会落到「无法识别结构」（用户 2026-10-14 反馈的那 4 个）。
 *
 *   node _probe/library-analyze-check.js                     # 只跑已知失败的那几个
 *   node _probe/library-analyze-check.js --all               # 跑全部
 *   node _probe/library-analyze-check.js --filter=uniform    # 按文件名过滤
 *
 * 纯读：只调 analyze()，不写游戏目录、不动注册表。
 */
const fs = require('fs');
const path = require('path');
const installer = require('../src/main/installer');

const LIB = path.join(__dirname, '..', 'data', 'library');
const FAKE_ROOT = path.join(__dirname, '..', '_probe', '__fakegame');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find(a => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const FILTER = flag('filter', '');
const ALL = args.includes('--all');

/** 用户 2026-10-14 截图里报失败的那几个 */
const KNOWN_BAD = [
  '2595_School Uniform (CNS-Pale Skin compatible)_1.3.7z',
  '1378_Eve Iberis Dress CNS_1.4.zip',
  '437_BP Planet Diving Suit (7th) (CNS compatible)-Midsummer Edition_4.75.zip',
  '1591_Eve - Pink Bodysuit (CNS and New Colors)_1.0.zip',
  // 对照组：已知能正常识别的
  '1430_BP Cooling suit (CNS compatible)_3.0.zip'
];

async function main() {
  fs.mkdirSync(FAKE_ROOT, { recursive: true });
  let files;
  if (ALL) files = fs.readdirSync(LIB).filter(f => !f.startsWith('.'));
  else if (FILTER) files = fs.readdirSync(LIB).filter(f => f.toLowerCase().includes(FILTER.toLowerCase()));
  else files = KNOWN_BAD.filter(f => fs.existsSync(path.join(LIB, f)));

  let ok = 0, needPick = 0, bad = 0;
  const problems = [];

  for (const f of files) {
    const p = path.join(LIB, f);
    let res, plan = null, err = null;
    try {
      plan = await installer.analyze(FAKE_ROOT, p, { modId: 0, name: f.replace(/\.[^.]+$/, '') }, {});
      res = 'OK';
    } catch (e) {
      err = e;
      plan = e.plan || null;
      res = e.needsTargetPick ? 'NEED_PICK' : 'FAIL';
    }

    const short = f.length > 72 ? f.slice(0, 69) + '…' : f;
    if (res === 'OK') {
      ok++;
      console.log('  ✅ ' + short);
      console.log('       → ' + (plan.reason || '(无 reason)') + '  [' + (plan.kind || '?') + ']');
    } else if (res === 'NEED_PICK') {
      needPick++;
      const n = (plan.options || []).length;
      console.log('  🟡 ' + short);
      console.log('       → 需要选一套（候选 ' + n + ' 个）：' + String(err && err.message || '').split('\n')[0]);
      problems.push({ f, kind: 'NEED_PICK', n });
    } else {
      bad++;
      console.log('  ❌ ' + short);
      console.log('       → ' + String(err && err.message || '').split('\n').slice(0, 4).join('\n         '));
      problems.push({ f, kind: 'FAIL', msg: String(err && err.message || '') });
    }
  }

  console.log('\n合计：' + files.length + ' 个包 → 直接可装 ' + ok + ' / 需挑一套 ' + needPick + ' / 无法识别 ' + bad);
  if (problems.length) {
    console.log('\n需要关注的：');
    for (const p of problems) console.log('  · ' + p.f + '  [' + p.kind + ']');
  }
  try { fs.rmSync(FAKE_ROOT, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

main().catch(e => { console.error('探针失败：' + e.stack); process.exitCode = 1; });
