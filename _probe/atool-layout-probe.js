'use strict';
/**
 * ATOOL 包结构探测：用候选归档布局跑**现有** installer.analyze()，
 * 看它今天能识别到什么程度、哪里会掉进「结构无法识别」。
 *
 * 用法: node _probe/atool-layout-probe.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../src/main/installer');

const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const BASE = path.join(os.tmpdir(), 'sb-atool-probe');
const SRC = path.join(BASE, 'src');
const PKG = path.join(BASE, 'pkg');
const ROOT = path.join(BASE, 'fakeroot');

function mk(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(base, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
}
function zip(name, files) {
  const stage = path.join(SRC, name);
  fs.rmSync(stage, { recursive: true, force: true });
  mk(stage, files);
  const out = path.join(PKG, name + '.zip');
  fs.mkdirSync(PKG, { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx1', out, '.'], { cwd: stage, stdio: 'ignore' });
  return out;
}

/** 造一个假游戏根，让 analyze 的路径推断/冲突检测有东西可依 */
function fakeRoot() {
  fs.mkdirSync(path.join(ROOT, 'SB', 'Binaries', 'Win64'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'SB', 'Binaries', 'Win64', 'SB-Win64-Shipping.exe'), 'x');
  return ROOT;
}

const CASES = [
  {
    n: 'A 主文件·LogicMods 目录形式（官方说明的字面结构）',
    f: {
      'LogicMods/HD-ATOOL_P/HD-ATOOL_P.pak': 'PAK',
      'LogicMods/HD-ATOOL_P/HD-ATOOL_P.ucas': 'UCAS',
      'LogicMods/HD-ATOOL_P/HD-ATOOL_P.utoc': 'UTOC',
      'LogicMods/HD-ATOOL_P/audio/readme.txt': 'audio here'
    }
  },
  {
    n: 'B 主文件·带 SB\\ 前缀',
    f: {
      'SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.pak': 'PAK',
      'SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.ucas': 'UCAS',
      'SB/Content/Paks/LogicMods/HD-ATOOL_P/HD-ATOOL_P.utoc': 'UTOC'
    }
  },
  {
    n: 'C 主文件·只包一层 HD-ATOOL_P\\',
    f: {
      'HD-ATOOL_P/HD-ATOOL_P.pak': 'PAK',
      'HD-ATOOL_P/HD-ATOOL_P.ucas': 'UCAS',
      'HD-ATOOL_P/HD-ATOOL_P.utoc': 'UTOC'
    }
  },
  {
    n: 'D 主文件·全部平铺在归档根',
    f: {
      'HD-ATOOL_P.pak': 'PAK',
      'HD-ATOOL_P.ucas': 'UCAS',
      'HD-ATOOL_P.utoc': 'UTOC'
    }
  },
  {
    n: 'E 动画包·平铺 pak（如 1740 InGame_Anim_pack）',
    f: {
      'InGame_Anim_pack_v1200_P.pak': 'PAK',
      'InGame_Anim_pack_v1200_P.ucas': 'UCAS',
      'InGame_Anim_pack_v1200_P.utoc': 'UTOC'
    }
  },
  {
    n: 'F 动画包·包一层文件夹（官方说「把文件夹放进 ~mods」）',
    f: {
      'HD-ATOOL-animtest/HD-ATOOL-animtest_P.pak': 'PAK',
      'HD-ATOOL-animtest/HD-ATOOL-animtest_P.ucas': 'UCAS',
      'HD-ATOOL-animtest/HD-ATOOL-animtest_P.utoc': 'UTOC'
    }
  },
  {
    n: 'G 动画包·散装 uasset 目录（非 pak，若存在这种分发包）',
    f: {
      'Mods/HD-ATOOL_P/anim/33.uasset': 'A',
      'Mods/HD-ATOOL_P/anim/33.uexp': 'B',
      'Mods/HD-ATOOL_P/pose/15.uasset': 'C',
      'Mods/HD-ATOOL_P/pose/15.uexp': 'D'
    }
  }
];

async function main() {
  fakeRoot();
  for (const c of CASES) {
    const zp = zip('atool_' + CASES.indexOf(c), c.f);
    let r;
    try { r = await installer.analyze(ROOT, zp, { name: 'ATOOL case' }); }
    catch (e) { console.log('\n### ' + c.n + '\n    ✗ 抛错: ' + e.message); continue; }

    console.log('\n### ' + c.n);
    if (r.ok) {
      console.log('    ✓ 识别成功');
      console.log('      kind   = ' + r.kind + '  (' + r.kindLabel + ')');
      console.log('      target = ' + r.target);
      console.log('      label  = ' + r.targetLabel);
      console.log('      reason = ' + r.reason);
      console.log('      落点样例: ' + (r.mapping[0] ? path.relative(ROOT, r.mapping[0].to) : '-'));
    } else {
      console.log('    ✗ 未识别  reason=' + r.reason);
      console.log('      pakCount=' + r.pakCount + '  fileCount=' + r.fileCount +
        '  候选目录=' + (r.options || []).length);
      if ((r.options || []).length) console.log('      候选: ' + r.options.map(o => o.dir).join(' | '));
      if (r.warnings && r.warnings.length) console.log('      warn: ' + r.warnings.join(' / '));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
