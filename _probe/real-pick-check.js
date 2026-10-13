'use strict';
/**
 * 对**真实归档**验证「多选 + 互相覆盖护栏」。
 *
 * 纯 Node：不启 Electron、不写任何文件、不碰游戏目录。
 *
 * 用法：node _probe/real-pick-check.js [modId]
 *   默认拿 mod 437「BP Planet Diving Suit (7th)」——
 *   它有 9 套候选，资产 ID 分成三组：
 *     `77117-..._A/B/C` 与 `ID77117-..._D/E/F`  → 同一件衣服（ID77117）
 *     `77127-..._V2_A`                          → 另一件（ID77127）
 *     `77137-..._V3_A/B`                        → 再一件（ID77137）
 *   所以「每件挑一套」= 合法，挑同一组的两套 = 该被拦下。
 */
const fs = require('fs');
const path = require('path');

const installer = require('../src/main/installer');
const paths = require('../src/main/paths');

const ROOT = 'D:\\games\\Star Blade';

let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

(async () => {
  const modId = Number(process.argv[2]) || 437;
  const archive = fs.readdirSync(paths.LIBRARY).find(f => f.startsWith(modId + '_'));
  if (!archive) { console.log('library 里没有 mod ' + modId); process.exit(1); }
  const archivePath = path.join(paths.LIBRARY, archive);
  const meta = { modId, name: archive };
  const analyze = (opts) => installer.analyze(ROOT, archivePath, meta, opts);

  console.log('归档 : ' + archive + '\n');

  const base = await analyze({});
  const opts = base.options || [];
  console.log('候选 ' + opts.length + ' 个：');
  for (const o of opts) console.log('  · ' + String(o.label).padEnd(30) + ' ID=' + (o.key || '(无)') + '  ' + o.files + ' 个文件');

  // 按资产 ID 分组
  const byKey = new Map();
  for (const o of opts) {
    const k = o.key || ('name:' + o.label);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(o);
  }
  console.log('\n按资产 ID 分组：');
  for (const [k, arr] of byKey) console.log('  ' + k.padEnd(12) + ' → ' + arr.map(x => x.label).join(', '));

  console.log('\n---- 断言 ----');

  t('每个候选都有 key 字段（可能为空串）', () =>
    opts.length > 0 && opts.every(o => typeof o.key === 'string') ? true : '候选缺 key 字段');

  const withId = opts.filter(o => o.key).length;
  t(`有 ${withId}/${opts.length} 个候选带资产 ID（带 ID 的界面会标出来）`, () => true);

  // ① 同组两套 → 必须拦下
  const sameGroup = [...byKey.values()].find(a => a.length >= 2 && a[0].key);
  if (sameGroup) {
    const r = await analyze({ pickDirs: sameGroup.slice(0, 2).map(o => o.dir) });
    t(`同组两套（${sameGroup[0].label} + ${sameGroup[1].label}）→ 拦下并说明原因`, () =>
      (r.ok === false && /互相覆盖/.test(r.reason || '') && new RegExp(sameGroup[0].key).test(r.reason || ''))
        ? true : `ok=${r.ok} reason=${r.reason}`);
    t('拦下后仍给候选清单（能重选）', () =>
      (r.options || []).length === opts.length ? true : 'options=' + (r.options || []).length);
  } else {
    t('（该包没有同组候选，跳过同组断言）', () => true);
  }

  // ② 每组挑一套 → 必须放行，且文件全部拍平到 ~Mods 根级
  const oneEach = [...byKey.values()].map(a => a[0].dir);
  const r2 = await analyze({ pickDirs: oneEach });
  t(`每组挑一套（共 ${oneEach.length} 套）→ 识别成功`, () =>
    r2.ok === true ? true : `ok=false reason=${r2.reason}`);
  t('落点是 ~Mods', () =>
    r2.ok && /Paks[\\/]~Mods$/i.test(r2.target || '') ? true : 'target=' + r2.target);
  t('文件全部拍平到 ~Mods 根级（不带子目录）', () => {
    if (!r2.ok) return 'ok=false';
    const nested = r2.mapping.map(m => m.rel).filter(r => r.includes('/') || r.includes('\\'));
    return nested.length === 0 ? true : '还有嵌套：' + nested.slice(0, 3).join(', ');
  });
  t('每组各一套 → pak 数量 ≥ 分组数', () => {
    if (!r2.ok) return 'ok=false';
    const paks = r2.mapping.map(m => m.rel).filter(r => /\.pak$/i.test(r));
    return paks.length >= byKey.size ? true : `只落了 ${paks.length} 个 pak，期望 ≥${byKey.size}`;
  });
  if (oneEach.length < opts.length) {
    t('选中的套数少于候选数（确实只装了挑的那些）', () =>
      r2.ok && r2.fileCount < base.fileCount ? true : `fileCount=${r2.ok ? r2.fileCount : '?'}`);
  } else {
    t('（候选全是独立内容，全选即全装）', () => true);
  }

  console.log('\n' + '='.repeat(52));
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：' + e.message + '\n' + e.stack); process.exit(1); });
