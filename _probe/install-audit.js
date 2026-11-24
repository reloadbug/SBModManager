'use strict';
/**
 * 体检：每个「已登记」的 Mod，把
 *   ① 压缩包里到底有多少个文件（archive.listEntries）
 *   ② 按安装规则「应该装进去」多少个（installer.analyze → plan.mapping）
 *   ③ 游戏目录里现在真实在位的多少个（installer.verifyExisting，认 .disabled 写法）
 * 三组数字摆在一起，只报对不上的。
 *
 * 只读：不写任何文件、不动游戏目录。
 */
const path = require('path');
const fs = require('fs');

const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const archive = M('archive.js');
const installer = M('installer.js');
const game = M('game.js');
const toggleName = M('toggleName.js');
const { createRegistry } = M('registry.js');

const root = process.argv[2] || 'C:\\games\\Star Blade';
const regFile = path.join(root, '.sbmod', 'mods.json');
const reg = createRegistry(regFile);
const L = game.layout(root);

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const existsToggle = (p) => exists(p)
  || exists(path.join(path.dirname(p), toggleName.counterpartName(path.basename(p))));

(async () => {
  const rows = [];
  const recs = reg.all();
  for (const r of recs) {
    const row = {
      id: r.id, name: r.name, kind: r.kind,
      archives: null, planned: null, present: null,
      missing: [], mismatched: [], note: '', archivePath: r.archivePath || ''
    };
    const man = (r.manifest || []).filter(f => f && f.path);
    row.manifest = man.length;
    row.manifestAlive = man.filter(f => existsToggle(f.path)).length;

    const ap = r.archivePath || '';
    if (!ap) { row.note = '没有安装包路径（本地导入 / 手动装）'; rows.push(row); continue; }
    if (!exists(ap)) { row.note = '安装包已不在'; rows.push(row); continue; }

    try {
      const list = await archive.listEntries(ap);
      row.archives = (list.entries || []).filter(e => !e.isDir).length;

      const meta = {
        name: r.name,
        modId: (r.source && r.source.modId) || null,
        fileId: (r.source && r.source.fileId) || null
      };
      let plan = await installer.analyze(root, ap, meta, {});
      if (plan && !plan.ok && plan.needsTargetPick && Array.isArray(plan.options) && plan.options.length
          && plan.hasConflicts === false) {
        const dirs = (Array.isArray(plan.defaultPick) && plan.defaultPick.length)
          ? plan.defaultPick : plan.options.map(o => o.dir).filter(Boolean);
        if (dirs.length) plan = await installer.analyze(root, ap, meta, { pickDirs: dirs });
      }
      if (!plan || !plan.ok) {
        row.note = '结构分析没通过：' + ((plan && (plan.diagnosis || plan.reason)) || '未知');
        rows.push(row); continue;
      }
      const v = installer.verifyExisting(plan);
      row.planned = (plan.mapping || []).length;
      row.present = v.present.length;
      row.missing = v.missing.map(x => path.basename(x.path || ''));
      row.mismatched = v.mismatched.map(x => path.basename(x.path || ''));
      rows.push(row);
    } catch (e) {
      row.note = 'ERR ' + (e && e.message);
      rows.push(row);
    }
  }

  const bad = rows.filter(r => r.note || (r.planned != null && r.planned !== r.present));
  const fine = rows.filter(r => !bad.includes(r));
  const skipped = rows.filter(r => r.archives != null && r.planned != null && r.archives !== r.planned);

  console.log('=== 已登记 Mod 体检：' + rows.length + ' 条 ===');
  console.log('\n--- 对不上的（' + bad.length + '）---');
  for (const r of bad) {
    console.log([
      r.name + '  [' + r.id + ']',
      '  压缩包文件 ' + (r.archives == null ? '?' : r.archives)
        + ' / 应装 ' + (r.planned == null ? '?' : r.planned)
        + ' / 实到 ' + (r.present == null ? '?' : r.present),
      r.missing.length ? '  缺：' + r.missing.join('、') : '',
      r.mismatched.length ? '  大小不符：' + r.mismatched.join('、') : '',
      r.note ? '  备注：' + r.note : '',
      '  安装包：' + (r.archivePath || '—')
    ].filter(Boolean).join('\n'));
  }

  console.log('\n--- 数量对上的（' + fine.length + '）---');
  for (const r of fine) {
    console.log('  ' + r.name + '  [' + r.id + ']  压缩包 ' + r.archives + ' / 应装 ' + r.planned + ' / 实到 ' + r.present);
  }

  if (skipped.length) {
    console.log('\n--- 压缩包里有、按规则没装的（正常：说明文档 / 预览图 / 重复目录）---');
    for (const r of skipped) {
      console.log('  ' + r.name + '  压缩包 ' + r.archives + ' → 应装 ' + r.planned + '（差 ' + (r.archives - r.planned) + '）');
    }
  }
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
