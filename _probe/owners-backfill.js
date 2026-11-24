/*
 * 一次性补建「文件归属表」：拿本地安装包里的条目反推「~Mods 里这个数据文件属于哪个 Mod」
 *
 * 用户 2026-11-24：
 *   「这部分文件要跟库里的压缩包比对……既然已经丢失了这部分数据就想办法补回来」
 *
 * 只写一个文件：`<游戏根>\.sbmod\mod-file-owner.json`（就是管理器自己那份状态表，跟着游戏走）。
 * 不改游戏目录、不解压、不删任何东西。
 *
 * 用法：
 *   node _probe/owners-backfill.js            # 建表 + 报告能挂上多少
 *   node _probe/owners-backfill.js --dry      # 只看，不落盘
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const ROOT = 'C:\\games\\Star Blade';

const paths = require(path.join(REPO, 'src', 'main', 'paths'));
const scanner = require(path.join(REPO, 'src', 'main', 'scanner'));
const { createRegistry } = require(path.join(REPO, 'src', 'main', 'registry'));
const { linkReader } = require(path.join(REPO, 'src', 'main', 'linker'));
const installer = require(path.join(REPO, 'src', 'main', 'installer'));
const localLibrary = require(path.join(REPO, 'src', 'main', 'localLibrary'));
const { createFileOwner, indexLibrary } = require(path.join(REPO, 'src', 'main', 'fileOwner'));
const { attachOwners } = require(path.join(REPO, 'src', 'main', 'attachOwners'));
const game = require(path.join(REPO, 'src', 'main', 'game'));

const L = game.layout(ROOT);
const ownerFile = path.join(ROOT, '.sbmod', 'mod-file-owner.json');

(async () => {
  const owner = createFileOwner(ownerFile);
  console.log('归属表：', ownerFile, '　现有', JSON.stringify(owner.stats()));

  const lib = await indexLibrary(owner, paths.LIBRARY, { parseName: localLibrary.parseArchiveName });
  console.log('扫库结果：包 %d 个（读到 %d、跳过 %d、失败 %d），CNS 条目 %d，新增 %d、更新 %d → 表内 %d 条 / %d 个 Mod',
    lib.archives, lib.read, lib.skipped, lib.failed.length, lib.entries, lib.added, lib.changed, lib.total,
    owner.stats().mods);
  if (lib.failed.length) for (const f of lib.failed.slice(0, 8)) console.log('   ✗', f.archive, f.error);

  // 建完表立刻按它扫一遍，看能挂上多少
  const registry = createRegistry(path.join(ROOT, '.sbmod', 'mods.json'));
  const list = scanner.scan(ROOT, registry, linkReader(paths.modLinksFile));
  const before = { items: list.length, files: list.reduce((n, m) => n + (m.files || []).length, 0) };
  const out = attachOwners(list, owner, L.modsDir);
  const after = { items: list.length, files: list.reduce((n, m) => n + (m.files || []).length, 0) };
  console.log('\n扫描：条目 %d，文件 %d → 补挂后 %d（+%d，涉及 %d 个 Mod；有出处但没卡片的 %d 个）',
    before.items, before.files, after.files, out.attached, out.mods, out.noCard);

  // 还没挂上的数据文件（真孤儿）
  const claimed = new Set();
  for (const m of list) for (const f of (m.files || [])) claimed.add(String(f.name).toLowerCase());
  const left = fs.readdirSync(L.modsDir, { withFileTypes: true })
    .filter(e => e.isFile()).map(e => e.name)
    .filter(n => scanner.CNS_DATA.test(n.replace(/\.disabled\.json$/i, '.json').replace(/\.disabled$/i, '')))
    .filter(n => !claimed.has(n.toLowerCase()));
  console.log('\n仍然没有归属的数据文件：%d 个', left.length);
  for (const n of left) {
    const st = (() => { try { return fs.statSync(path.join(L.modsDir, n)); } catch { return null; } })();
    console.log('   %s  (%s B, %s)', n, st ? st.size : 0, st ? st.birthtime.toISOString().slice(0, 10) : '');
  }

  if (DRY) { console.log('\n--dry：没有落盘'); return; }
  console.log('\n归属表已写入', ownerFile, JSON.stringify(owner.stats()));
})().catch(e => { console.error('出错：', e && e.stack || e); process.exit(1); });
