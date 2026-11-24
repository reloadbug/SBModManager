'use strict';
/**
 * 体检 v2：按「磁盘上真实装着的 Mod」逐个对账。
 *
 * 对每个在游戏目录里有文件的 Mod（按 modId 归并）：
 *   ① 压缩包文件数   —— 安装包里一共有几个文件（archive.listEntries）
 *   ② 应装文件数     —— 按安装规则该往游戏目录写几个（installer.analyze → plan.mapping）
 *   ③ 盘上文件数     —— 实际躺在游戏目录里的文件个数（scanner.scan 的结果，含伴随的数据文件）
 * 三个数字对不上的单独列出来。
 *
 * 只读：不写任何文件、不动游戏目录。
 */
const path = require('path');
const fs = require('fs');

const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const archive = M('archive.js');
const installer = M('installer.js');
const scanner = M('scanner.js');
const game = M('game.js');
const { createRegistry } = M('registry.js');

const root = process.argv[2] || 'C:\\games\\Star Blade';
const reg = createRegistry(path.join(root, '.sbmod', 'mods.json'));
const L = game.layout(root);

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

// 1) 队列任务：modId → 安装包（优先「已安装」的任务，其次任何有包的）
function queueArchives() {
  const map = new Map();
  const files = [path.join(root, '.sbmod', 'downloads.json'),
    path.join(__dirname, '..', 'data', 'downloads.json')];
  for (const f of files) {
    if (!exists(f)) continue;
    let db = null;
    try { db = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const t of (db.tasks || [])) {
      const id = t && t.meta && t.meta.modId;
      if (!id) continue;
      const ap = t.archivePath || '';
      if (!ap || !exists(ap)) continue;
      const prev = map.get(String(id));
      const score = (t.status === 'installed' ? 2 : 1);
      if (!prev || score > prev.score) map.set(String(id), { ap, score, name: t.meta.name || '' });
    }
  }
  return map;
}

// 2) 安装包目录里按 `<modId>_名字_版本.zip` 命名的兜底
function libraryArchives() {
  const map = new Map();
  const dir = path.join(__dirname, '..', 'data', 'library');
  if (!exists(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d+)_.*\.(zip|7z|rar)$/i);
    if (m && !map.has(m[1])) map.set(m[1], { ap: path.join(dir, f), score: 0, name: '' });
  }
  return map;
}

(async () => {
  const items = scanner.scan(root, reg, null);
  const qa = queueArchives();
  const lib = libraryArchives();

  // 盘上条目按 modId 归并（同一个 mod 可能有多张卡/多个文件）
  const byMod = new Map();
  for (const it of items) {
    const modId = String((it.meta && it.meta.source && it.meta.source.modId) || (it.tag && it.tag.modId) || '');
    const key = modId || ('disk:' + it.id);
    if (!byMod.has(key)) byMod.set(key, { modId, name: it.name, kind: it.kind, files: 0, ids: [], names: new Set() });
    const g = byMod.get(key);
    g.files += (it.files ? it.files.length : 0) || it.fileCount || 0;
    g.ids.push(it.id);
    for (const f of (it.files || [])) if (f && f.name) g.names.add(f.name);
    if (it.meta && it.meta.source && it.meta.source.modId) g.name = it.name;
  }

  const rows = [];
  for (const [key, g] of byMod) {
    const row = {
      key, modId: g.modId, name: g.name, kind: g.kind, disk: g.files,
      archives: null, planned: null, note: ''
    };
    const cand = g.modId ? (qa.get(g.modId) || lib.get(g.modId)) : null;
    if (!cand) { row.note = '没有安装包（手动放进去的 / 包已删）'; rows.push(row); continue; }
    try {
      const list = await archive.listEntries(cand.ap);
      row.archives = (list.entries || []).filter(e => !e.isDir).length;
      const meta = { name: g.name, modId: g.modId || null, fileId: null };
      let plan = await installer.analyze(root, cand.ap, meta, {});
      if (plan && !plan.ok && plan.needsTargetPick && Array.isArray(plan.options) && plan.options.length
          && plan.hasConflicts === false) {
        const dirs = (Array.isArray(plan.defaultPick) && plan.defaultPick.length)
          ? plan.defaultPick : plan.options.map(o => o.dir).filter(Boolean);
        if (dirs.length) plan = await installer.analyze(root, cand.ap, meta, { pickDirs: dirs });
      }
      if (!plan || !plan.ok) {
        row.note = '结构分析没通过：' + ((plan && (plan.diagnosis || plan.reason)) || '未知');
        rows.push(row); continue;
      }
      row.planned = (plan.mapping || []).length;
      row.archivePath = cand.ap;
      // 应装的文件里，有多少真的在盘上（认 .disabled 写法）
      const v = installer.verifyExisting(plan);
      row.present = v.present.length;
      row.missing = v.missing.map(x => path.basename(x.path || ''));
      row.mismatched = v.mismatched.map(x => path.basename(x.path || ''));
      // 盘上在位、但没被任何卡片认领的文件（界面上看不见的那些）
      row.orphan = v.present
        .map(f => path.basename(f.path || ''))
        .filter(n => n && !g.names.has(n) && ![...g.names].some(x => x === n.replace(/\.disabled(?=\.)/, '')));
      rows.push(row);
    } catch (e) {
      row.note = 'ERR ' + (e && e.message);
      rows.push(row);
    }
  }

  const isBad = (r) => !!r.note
    || (r.planned != null && (r.planned !== r.present || (r.orphan && r.orphan.length)))
    || (r.planned != null && r.planned !== r.disk);
  const bad = rows.filter(isBad);
  const fine = rows.filter(r => !isBad(r));
  const noArchive = rows.filter(r => r.note.startsWith('没有安装包'));

  console.log('=== 磁盘上装着 ' + items.length + ' 个条目 / ' + byMod.size + ' 个 Mod ===');
  console.log('对账成功 ' + fine.length + '，对不上 ' + (bad.length - noArchive.length) + '，没有安装包 ' + noArchive.length);

  console.log('\n--- 数量对不上的 ---');
  if (!bad.length) console.log('  （无）');
  for (const r of bad) {
    if (r.note.startsWith('没有安装包')) continue;
    console.log([
      (r.name || '(无名)') + '  [' + (r.modId || r.key) + ']  ' + r.kind,
      '  压缩包 ' + (r.archives == null ? '?' : r.archives)
        + ' / 应装 ' + (r.planned == null ? '?' : r.planned)
        + ' / 盘上实到 ' + (r.present == null ? '?' : r.present)
        + ' / 卡片认领 ' + r.disk,
      r.missing && r.missing.length ? '  缺：' + r.missing.join('、') : '',
      r.mismatched && r.mismatched.length ? '  大小不符：' + r.mismatched.join('、') : '',
      r.orphan && r.orphan.length ? '  隐形（在盘上但没卡片）：' + r.orphan.slice(0, 4).join('、') : '',
      r.note ? '  备注：' + r.note : '',
      r.archivePath ? '  包：' + r.archivePath : ''
    ].filter(Boolean).join('\n'));
  }

  console.log('\n--- 数量对上的（' + fine.length + '）---');
  for (const r of fine) {
    console.log('  ✓ ' + (r.name || '(无名)') + '  [' + (r.modId || r.key) + ']  压缩包 ' + r.archives + ' / 应装 ' + r.planned + ' / 盘上 ' + r.present);
  }

  if (noArchive.length) {
    console.log('\n--- 没有安装包、无从对账的（' + noArchive.length + '，手动放进去的或包已删）---');
    for (const r of noArchive) console.log('  · ' + (r.name || '(无名)') + '  盘上 ' + r.disk + ' 个文件');
  }
})().catch(e => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
