/* 只读干跑：验证「子 Mod」账本与「单独装某一套」的过滤口径
 *
 * 用户 2026-11-24：「一个安装包有多个 mod 的如果只选择了其中部分安装，则其余的子 mod
 * 要显示安装按钮」「每个子 mod 都可以单独选择安装或卸载」。
 *
 * 这里不写任何文件，只回答三件事：
 *   1. 4184 的安装包被拆成几套（顶层目录），各几个文件；
 *   2. packageLedger 的 subs 记账对不对（装了几个、装的是哪几个 rel）；
 *   3. 单独装某一套时，按顶层目录过滤出来的 mapping 是不是**只有那一套**。
 */
const path = require('path');
const fs = require('fs');
const installer = require('../src/main/installer');

const ROOT = 'C:\\games\\Star Blade';
const AP = 'D:\\AI game\\StarBladeModManager\\data\\library\\4184_Blossom Butterfly Sexy JK Girl_1.zip';

function stemOfN(rel) { return installer.fileKey(path.basename(String(rel || ''))); }

(async () => {
  const out = [];
  const ok = (name, cond, extra) => {
    out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    return cond;
  };

  if (!fs.existsSync(AP)) { console.log('安装包不在：' + AP); process.exit(1); }

  let plan = await installer.analyze(ROOT, AP, { name: 'Blossom Butterfly Sexy JK Girl', modId: 4184 }, {});
  if (!plan.ok && plan.needsTargetPick && plan.options && plan.options.length) {
    const dirs = (plan.defaultPick && plan.defaultPick.length)
      ? plan.defaultPick : plan.options.map(o => o.dir);
    plan = await installer.analyze(ROOT, AP, { name: 'Blossom Butterfly Sexy JK Girl', modId: 4184 }, { pickDirs: dirs });
  }
  ok('分析成功', !!plan.ok, plan.ok ? '' : (plan.reason || ''));

  const led = installer.packageLedger(plan);
  out.push('');
  out.push(`包内 ${led.entryCount} 个文件，应装 ${led.installedCount} 个，没装 ${led.notInstalledCount} 个`);
  for (const s of led.subs) {
    out.push(`  子 Mod「${s.dir || '(根)'}」：包内 ${s.entryCount} 个，已装 ${s.installedCount} 个  rels=${JSON.stringify(s.installedRels)}`);
  }

  ok('拆出 2 套子 Mod', led.subs.length === 2, `实际 ${led.subs.length}`);
  const phys = led.subs.find(s => s.dir === 'Breast and Hip_Physics');
  const jk = led.subs.find(s => s.dir === 'Kamenlaideng_Blossom Butterfly JK');
  ok('物理特效那套 3 个文件且全装上', !!phys && phys.entryCount === 3 && phys.installedCount === 3,
    phys ? `${phys.installedCount}/${phys.entryCount}` : '没找到');
  ok('JK 那套 4 个文件且全装上', !!jk && jk.entryCount === 4 && jk.installedCount === 4,
    jk ? `${jk.installedCount}/${jk.entryCount}` : '没找到');

  // —— 单独装某一套时的过滤口径：只留这一套的文件 ——
  for (const dir of ['Breast and Hip_Physics', 'Kamenlaideng_Blossom Butterfly JK']) {
    const want = new Set();
    for (const e of (plan.entries || [])) {
      const seg = String(e.rel || '').split('/').filter(Boolean);
      if ((seg.length > 1 ? seg[0] : '') !== dir) continue;
      want.add(stemOfN(e.rel));
    }
    const only = (plan.mapping || []).filter(x => want.has(stemOfN(x.rel || x.to)));
    const v = installer.verifyExisting({ ...plan, mapping: only });
    const foreign = only.filter(x => {
      const seg = String(plan.entries.find(e => stemOfN(e.rel) === stemOfN(x.rel || x.to)).rel || '').split('/');
      return (seg.length > 1 ? seg[0] : '') !== dir;
    });
    ok(`「${dir}」过滤后只剩这一套（${only.length} 个文件）`,
      only.length === want.size && foreign.length === 0,
      `want=${want.size} got=${only.length} 外来=${foreign.length}`);
    ok(`「${dir}」逐个核对在位（${v.present.length}/${only.length}）`,
      v.ok && v.present.length === only.length,
      `缺 ${v.missing.length} 个 / 大小不符 ${v.mismatched.length} 个`);
  }

  // —— 卸掉一套之后剩几个：manifest 里属于「物理特效」的文件能被精确挑出来吗 ——
  const physRels = new Set((phys ? phys.installedRels : []).map(String));
  const hit = (plan.mapping || []).filter(x => physRels.has(String(x.rel)));
  ok('按 installedRels 能精确挑出「物理特效」那 3 个文件', hit.length === 3, `实际 ${hit.length}`);

  console.log(out.join('\n'));
  const bad = out.filter(l => l.startsWith('FAIL')).length;
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} 通过 / ${bad} 失败`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：', e); process.exit(1); });
