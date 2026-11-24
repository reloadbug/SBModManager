/*
 * 孤儿 CNS 数据文件对账（只读，不写任何游戏文件）
 *
 * 背景（用户 2026-11-24）：
 *   `~Mods` 根目录里有一批 `.dekcns.json` / `.dekani.json`，跟任何卡片的 pak 名字都对不上。
 *   正常流程本该在安装时就把「哪个文件属于哪个 mod」记下来，可这批数据是早期装的、账本没有，
 *   于是它们成了「盘上有、界面上看不见」的孤儿。
 *   用户的处理原则：**拿去跟库里的压缩包比对**——能以压缩包确认归属的就补回记录；
 *   确认库里、盘上都没有出处的，当垃圾清掉（先列清单，人工过一遍再删）。
 *
 * 这份探针只做取证：
 *   ① 扫盘算出当前没挂到任何卡片上的 CNS 数据文件（孤儿名单）
 *   ② 把 `data\library` 里每个压缩包的条目摊开，建「CNS 文件名 → 压缩包/modId」索引
 *   ③ 逐个孤儿查索引：能认领的列出来源包，认不出的标成「无出处」
 *
 * 用法：node _probe/orphan-cns-audit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\games\\Star Blade';
const REPO = path.resolve(__dirname, '..');

const paths = require(path.join(REPO, 'src', 'main', 'paths'));
const scanner = require(path.join(REPO, 'src', 'main', 'scanner'));
const { createRegistry } = require(path.join(REPO, 'src', 'main', 'registry'));
const { linkReader } = require(path.join(REPO, 'src', 'main', 'linker'));
const installer = require(path.join(REPO, 'src', 'main', 'installer'));
const archive = require(path.join(REPO, 'src', 'main', 'archive'));
const localLibrary = require(path.join(REPO, 'src', 'main', 'localLibrary'));

const L = require(path.join(REPO, 'src', 'main', 'game')).layout(ROOT);
const registryFile = path.join(ROOT, '.sbmod', 'mods.json');

(async () => {
  // ── ① 当前卡片认领了哪些文件 ──────────────────────────────
  const registry = createRegistry(registryFile);
  let links = null;
  try { links = linkReader(paths.modLinksFile); } catch { links = null; }
  const items = scanner.scan(ROOT, registry, links);
  const owned = new Set();
  for (const m of items) {
    for (const f of (m.files || [])) owned.add(String(f.name).toLowerCase());
  }

  const diskCns = fs.readdirSync(L.modsDir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(n => scanner.CNS_DATA.test(n));

  const orphans = diskCns.filter(n => !owned.has(n.toLowerCase()));

  // ── ② 库里的压缩包摊开，建 CNS 文件名索引 ─────────────────
  const libDir = paths.LIBRARY;
  const archives = fs.existsSync(libDir)
    ? fs.readdirSync(libDir).filter(n => /\.(zip|7z|rar)$/i.test(n))
    : [];

  const index = new Map();     // fileKey → [{archive, modId, entry, size}]
  const archiveErrors = [];
  for (const name of archives) {
    const ap = path.join(libDir, name);
    let entries = [];
    try {
      const r = await archive.listEntries(ap);
      entries = (r && r.entries) || [];
    } catch (e) {
      archiveErrors.push({ archive: name, error: e.message });
      continue;
    }
    const parsed = (() => { try { return localLibrary.parseArchiveName(name); } catch { return null; } })();
    const modId = parsed ? parsed.modId : 0;
    for (const e of entries) {
      const rel = String(e.path || '').replace(/\\/g, '/');
      const base = rel.split('/').pop();
      if (!scanner.CNS_DATA.test(base)) continue;
      const key = installer.fileKey(base);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ archive: name, modId, entry: rel, size: e.size });
    }
  }

  // ── ③ 逐个孤儿查出处 ─────────────────────────────────────
  const found = [];
  const lost = [];
  for (const name of orphans) {
    const key = installer.fileKey(name);
    const hit = index.get(key);
    const st = (() => { try { return fs.statSync(path.join(L.modsDir, name)); } catch { return null; } })();
    const row = {
      name,
      size: st ? st.size : 0,
      btime: st ? st.birthtime.toISOString() : '',
      src: hit ? hit[0] : null,
      hits: hit ? hit.length : 0
    };
    (hit ? found : lost).push(row);
  }

  console.log('==== 孤儿 CNS 数据文件对账（只读）====');
  console.log('扫描条目：', items.length, '　磁盘 CNS 数据文件：', diskCns.length,
    '　卡片认领：', diskCns.length - orphans.length, '　孤儿：', orphans.length);
  console.log('库内压缩包：', archives.length, '　索引到的 CNS 条目：', [...index.values()].reduce((a, b) => a + b.length, 0));
  console.log('');
  console.log(`【A】能在压缩包里查到出处：${found.length} 个`);
  for (const r of found) {
    console.log(`  ${r.name}  (${r.size} B, ${r.btime.slice(0, 10)})  ←  ${r.src.archive}  [modId ${r.src.modId}]  ${r.src.entry}`);
  }
  console.log('');
  console.log(`【B】库里、盘上都没有出处：${lost.length} 个`);
  for (const r of lost) {
    console.log(`  ${r.name}  (${r.size} B, ${r.btime.slice(0, 10)})`);
  }
  if (archiveErrors.length) {
    console.log('');
    console.log(`【C】读不了的压缩包：${archiveErrors.length}`);
    for (const e of archiveErrors) console.log(`  ${e.archive}  ${e.error}`);
  }

  // 落一份 JSON 给后续脚本用
  const out = path.join(REPO, '_shots', 'orphan-cns-audit.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), items: items.length, diskCns: diskCns.length, orphans, found, lost, archiveErrors }, null, 2), 'utf8');
  console.log('\n明细已写入', out);
})().catch(e => { console.error('探针出错：', e && e.stack || e); process.exit(1); });
