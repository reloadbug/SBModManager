'use strict';
/**
 * 探针：详情抽屉里的「空字段」补齐。
 *
 * 背景（2026-11-24，用户截图：Eve - Pink Bodysuit 的发布时间 / 禁用时间 /
 *   安装时间 / 压缩包位置四行全是「—」）：
 *   · 安装时间：磁盘扫描来的条目（未登记 / 已关联）注册表里本来就没有 installedAt，
 *     以前 groupInstalled() 也压根没算过这个字段 → 永远空。现在用文件创建时间补记，
 *     标「（推算/补记）」。
 *   · 发布时间：mod-info 档案里没存 createdAt → 现在走 nexus.getMod() 取回并落盘。
 *   · 压缩包位置：以前只看扫描条目的 archive；现在按 注册表 → 本地库 → 下载队列 找。
 *   · 禁用时间：从来没关过的 mod 现在写「无记录」，不再是一个空破折号。
 *
 * 这里只测「接线」和「口径」，不联网（nexus 那一段只查源码里有没有按 modId 找）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const scanner = M('scanner.js');
const { createRegistry } = M('registry.js');

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [ OK ] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); }
};

// ────────────────────────────────────────────────────────────
console.log('\n【A】磁盘扫描的每个文件都带创建时间（补记安装时间的依据）');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbmm-facts-'));
  const modsDir = path.join(tmp, '~Mods');
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'Alpha_P [nx1].pak'), Buffer.alloc(339, 0x41));
  fs.writeFileSync(path.join(modsDir, 'Alpha_P [nx1].ucas'), Buffer.alloc(512, 0x41));
  fs.writeFileSync(path.join(modsDir, 'Alpha.dekcns.json'), Buffer.alloc(120, 0x41));

  const registry = createRegistry(path.join(tmp, 'mods.json'));
  const out = scanner.scanPaks({ modsDir }, registry);
  const grp = out.find(m => m.name === 'Alpha_P [nx1]');

  ok('扫出了这一组', !!grp);
  ok('每个文件都有 btime 字段', grp && grp.files.every(f => 'btime' in f), grp && JSON.stringify(grp.files.map(f => f.btime)));
  const bt = grp && grp.files[0] && grp.files[0].btime;
  ok('btime 是 ISO 时间字符串', typeof bt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(bt || ''), bt);
  ok('btime 能被 Date 解析', !!bt && !Number.isNaN(Date.parse(bt)), bt);
  const comp = grp && grp.files.find(f => f.companion);
  ok('伴随文件也带 btime', !!comp && typeof comp.btime === 'string' && comp.btime.length > 0, comp && comp.btime);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────
console.log('\n【B】主进程：mods:facts 只补空值，且压缩包按三种来源找');
{
  const src = readSrc('src/main/ipc.js');
  ok('定义了 async function modFacts', /async function modFacts\(\{ modId = 0 \} = \{\}\)/.test(src));
  ok('注册了 mods:facts 通道', /handle\('mods:facts'/.test(src));
  ok('发布时间走 nexus.getMod 的 createdAt', /nexus\.getMod\(/.test(src) && /createdAt/.test(src));
  ok('发布时间取回后落盘（mod-info 档案）', /publishedAt/.test(src) && /store\.put\(/.test(src));
  ok('压缩包位置会找本地库（parseArchiveName）', /localLibrary\.parseArchiveName\(/.test(src));
  ok('压缩包位置会找下载队列（engine.list）', /engine\.list\(\)/.test(src));
  ok('安装时间取注册表里同 modId 最早的 installedAt', /installedAt/.test(src) && /installedFrom/.test(src));
  ok('整段包了 try/catch（拿不到就返回空串，不弹框）', /archiveFrom/.test(src) && /catch\s*\(/.test(src));
}

// ────────────────────────────────────────────────────────────
console.log('\n【C】预加载：把 facts 暴露给渲染层');
{
  const src = readSrc('src/preload/index.js');
  ok('mods.facts 存在', /facts:\s*\(opts\)\s*=>\s*invoke\('mods:facts'/.test(src));
}

// ────────────────────────────────────────────────────────────
console.log('\n【D】详情页：20 行都带字段标识，空值有说法');
{
  const src = readSrc('src/renderer/app.js');
  const start = src.indexOf('function unifiedInfoRows');
  const end = src.indexOf('\nfunction ', start + 10);
  const body = start >= 0 ? src.slice(start, end > start ? end : start + 8000) : '';

  ok('找到了 unifiedInfoRows', start > 0);
  ok('每行输出 data-f 字段标识', /data-f="' \+ field/.test(body) || /data-f="\$\{field\}"/.test(body) || /data-f=/.test(body));
  for (const f of ['posted', 'disabledAt', 'installedAt', 'archivePath']) {
    ok('行里有 ' + f, body.includes("'" + f + "'"));
  }
  ok('行数不少于 20', (body.match(/row\(/g) || []).length >= 20, (body.match(/row\(/g) || []).length);
  ok('禁用时间为空时写「无记录」', body.includes('无记录'));
  ok('压缩包为空时写「本地没有这个包」', body.includes('本地没有这个包'));
  ok('安装时间是推算来的会注明', body.includes('推算/补记'));
}

// ────────────────────────────────────────────────────────────
console.log('\n【E】详情页：facts 回来只重画信息区，不重画整个抽屉');
{
  const src = readSrc('src/renderer/app.js');
  ok('有 mergedInfoCtx(base, facts)', /function mergedInfoCtx\(/.test(src));
  ok('有 renderDrawerInfo()', /function renderDrawerInfo\(/.test(src));
  ok('有 fillDrawerFacts(modId)', /function fillDrawerFacts\(/.test(src));
  ok('调的是 window.api.mods.facts', /window\.api\.mods\.facts\(/.test(src));
  ok('结果有缓存（state.modFacts）', /state\.modFacts/.test(src));
  ok('抽屉渲染后按 kind 触发', /if \(kind === 'installed'\) fillDrawerFacts\(/.test(src));
  ok('groupInstalled 算了 btime（文件创建时间最早那个）', /btime:/.test(src));
  ok('groupInstalled 算了 installedAt（注册表最早那个）', /installedAt:/.test(src));
  ok('infoCtx 记了 factId（优先用 Nexus 的 modId）', /factId:/.test(src));
  ok('infoCtx 记了 disabledNever', /disabledNever:/.test(src));
}

// ────────────────────────────────────────────────────────────
console.log('\n【F】i18n：两条新文案在册');
{
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8'));
  ok('总键数 1318', keys.length === 1318, keys.length);
  ok('「无记录」在册', keys.includes('无记录'));
  ok('「本地没有这个包」在册', keys.includes('本地没有这个包'));
  const zh = readSrc('src/renderer/locales/en-US.js');
  ok('en-US 里有对应译文', zh.includes('No package'));
}

console.log('\n────────────────────────────────');
console.log((fail === 0 ? '[全部通过] ' : '[有失败] ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
