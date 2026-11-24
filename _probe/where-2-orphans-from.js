/*
 * 查两个「谁都不认领」的 CNS 数据文件到底是哪来的（只读）
 *   · Luna_TFD.dekcns.json            → UniqueFitID "Luna TFD_P"，要 /Game/OutfitMods/LunaEvent/…
 *   · CNS_SumParadase_1123.dekcns.disabled.json → UniqueFitID "SummerParadise_CNS"
 *
 * 判定标准：
 *   ① 游戏目录里有没有文件名带这些关键字的 pak（有 → 只是名字对不上，不能删）
 *   ② 本地安装包库里有没有包住这些关键字的 pak（有 → 属于那个包的 Mod，只是那 Mod 没装）
 *   ③ 两处都没有 → 对应的 pak 确实不在了，这几个数据文件是残留（可以清，先挪备份）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const paths = require(path.join(REPO, 'src', 'main', 'paths'));
const archive = require(path.join(REPO, 'src', 'main', 'archive'));

const ROOT = 'C:\\games\\Star Blade';
const KEYS = [/lunaevent/i, /summerparadise/i, /sumparadase/i, /luna_tfd/i];
const ARCHIVE_EXT = /\.(zip|7z|rar)$/i;

function walk(dir, out, depth = 0) {
  if (depth > 6) return;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (/\.(pak|ucas|utoc)$/i.test(e.name) && KEYS.some(k => k.test(e.name))) out.push(p);
  }
}

(async () => {
  const diskHits = [];
  walk(ROOT, diskHits);
  console.log('① 游戏目录里名字对得上的 pak：', diskHits.length);
  for (const p of diskHits) console.log('   ', p.replace(ROOT + '\\', ''));

  const inLib = [];
  let names = [];
  try { names = fs.readdirSync(paths.LIBRARY); } catch { names = []; }
  for (const n of names) {
    if (!ARCHIVE_EXT.test(n)) continue;
    let entries = [];
    try {
      const r = await archive.listEntries(path.join(paths.LIBRARY, n));
      entries = (r && r.entries) || [];
    } catch { continue; }
    for (const e of entries) {
      const rel = String(e.path || '');
      if (KEYS.some(k => k.test(rel))) inLib.push({ archive: n, entry: rel });
    }
  }
  console.log('\n② 本地安装包里包着这些关键字的条目：', inLib.length);
  for (const r of inLib.slice(0, 20)) console.log('   ', r.archive, '→', r.entry);
  if (inLib.length > 20) console.log('    …还有', inLib.length - 20, '条');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
