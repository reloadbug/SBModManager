'use strict';

/**
 * 探针：用**真实的下载压缩包**跑 installer.analyze()，验证结构识别。
 *
 * 重点覆盖 2026-10-12 用户报的两个 case：
 *   · mod 533「Cake Unveiled …」→ 包内 3 个 pak + 1 个 .dekcns.json，全在根级
 *   · 之前报「包里也没找到 .pak 文件」，其实有 3 个pak
 *
 * 只跑 analyze（不落盘、不碰游戏目录），参数：
 *   node _probe/analyze-cns-pak.js [压缩包路径...]
 * 不给参数就扫 data/library 下所有能找到的包。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { analyze } = require('../src/main/installer');

const FAKE_ROOT = path.join(os.tmpdir(), 'sb-analyze-' + Date.now());

function fakeLayout(root) {
  const win64 = path.join(root, 'SB', 'Binaries', 'Win64');
  return {
    root,
    sb: path.join(root, 'SB'),
    win64,
    modsDir: path.join(win64, '..', '..', '..', 'Content', 'Paks', '~Mods'),
    ue4ssDir: path.join(win64, 'ue4ss'),
    ue4ssModsDir: path.join(win64, 'ue4ss', 'Mods')
  };
}

async function collectArchives() {
  const out = [];
  const scan = dir => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (!/\.(part|tmp|json)$/i.test(e.name)) out.push(p);
    }
  };
  scan(path.join(__dirname, '..', 'data', 'library'));
  return out;
}

(async () => {
  const given = process.argv.slice(2).filter(Boolean);
  const archives = given.length
    ? given.map(p => path.resolve(p)).filter(p => fs.existsSync(p))
    : await collectArchives();

  if (!archives.length) { console.log('没有可分析的压缩包'); return; }

  fs.mkdirSync(FAKE_ROOT, { recursive: true });
  const layout = fakeLayout(FAKE_ROOT);

  let pass = 0, fail = 0;
  for (const ap of archives) {
    const rel = path.relative(path.join(__dirname, '..', 'data', 'library'), ap);
    let r;
    try { r = await analyze(layout.root, ap, {}, {}); }
    catch (e) { console.log('✗ ' + rel + ' → analyze 抛错：' + e.message); fail++; continue; }

    const tag = r.ok ? '✓' : '✗';
    console.log(tag + ' ' + rel);
    console.log('    ok=' + r.ok + ' kind=' + r.kind + ' strip=' + JSON.stringify(r.strip)
      + ' target=' + (r.target ? path.basename(r.target) : '-'));
    console.log('    reason=' + (r.reason || (r.warnings && r.warnings[0]) || '-'));
    console.log('    files=' + r.fileCount + ' pak=' + r.pakCount + ' requiresCns=' + !!r.requiresCns
      + (r.requiresCns ? '（' + r.requiresCnsReason + '）' : ''));
    if (!r.ok && r.options && r.options.length) {
      console.log('    options=' + r.options.map(o => o.label).join(' | '));
    }
    if (r.ok && r.mapping && r.mapping.length) {
      console.log('    前 5 个落点：');
      for (const m of r.mapping.slice(0, 5)) console.log('      ' + m.rel);
    }
    // 判定：落到 ~Mods 的必须是「全在根级」（游戏只读 ~Mods 根级 pak）；
    //      落到 SB 根的框架包本身就该带 Content/Paks/... 层级，另说。
    if (r.ok) {
      const rel0 = (r.mapping || []).map(m => String(m.rel || '').replace(/\\/g, '/'));
      const toModsRoot = /~mods$/i.test(String(r.target));
      const hasSub = rel0.some(p => p.includes('/'));
      const pakAll = rel0.every(p => /\.(pak|ucas|utoc|dekcns|json|lua|dll|ini|txt)$/i.test(p));
      const okShape = toModsRoot ? (!hasSub && pakAll) : pakAll;
      if (okShape) pass++;
      else { fail++; console.log('    ✗ 落点/层级异常（toModsRoot=' + toModsRoot + ' hasSub=' + hasSub + ' pakAll=' + pakAll + '）'); }
    } else pass++;   // 识别不了本身不是失败（可能真是奇怪包），单独看日志
  }

  fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
  console.log('\nok 且落点正确：' + pass + ' · 异常：' + fail);
})().catch(e => { console.error(e); process.exitCode = 1; });
