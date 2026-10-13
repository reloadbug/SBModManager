/* 主进程模块自检：不需要 Electron 也能跑 */
const path = require('path');

// 本沙箱的 GPU 进程不可用（见 skill 的 lessons.md）。
// 走 Electron 入口跑自检时必须提前关掉硬件加速，否则跑到联网那一节会 FATAL 退出。
try {
  const { app } = require('electron');
  if (app && app.commandLine) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }
} catch { /* 纯 Node 环境，忽略 */ }

const paths = require('../src/main/paths');
const game = require('../src/main/game');
const scanner = require('../src/main/scanner');
const { createRegistry } = require('../src/main/registry');
const { createNexus } = require('../src/main/nexus');
const { createTranslator } = require('../src/main/translate');
const { bbcodeToHtml, bbcodeToText } = require('../src/main/bbcode');

paths.ensure();
const ROOT = 'D:\\games\\Star Blade';
let pass = 0, fail = 0;
function t(label, fn) {
  try {
    const r = fn();
    if (r === false) { console.log('  ✗ ' + label); fail++; }
    else { console.log('  ✓ ' + label + (r ? '  → ' + r : '')); pass++; }
  } catch (e) { console.log('  ✗ ' + label + '  → ' + e.message); fail++; }
}

(async () => {
  console.log('\n=== 1. 游戏目录 ===');
  t('isGameRoot', () => game.isGameRoot(ROOT) === true);
  t('探测候选', () => JSON.stringify(game.detectCandidates([ROOT])));
  const info = game.inspect(ROOT);
  t('exe 存在', () => info.exe.exists === true);
  t('IoStore 判定', () => 'iostore=' + info.engine.iostore + ', paks=' + info.engine.paksCount);
  t('UE4SS 已安装', () => info.ue4ss.installed === true);
  t('~Mods 目录', () => 'exists=' + info.modsDir.exists + ', files=' + info.modsDir.fileCount);
  t('CNS 探测', () => JSON.stringify(info.cns));

  console.log('\n=== 2. 扫描已安装 Mod ===');
  const registry = createRegistry(paths.registryFile);
  const list = scanner.scan(ROOT, registry);
  t('扫描无异常', () => '共 ' + list.length + ' 项');
  for (const m of list.slice(0, 20)) {
    console.log(`     · [${m.kind}] ${m.name}  ${m.fileCount} 文件 ${m.size}B enabled=${m.enabled} registered=${m.registered}`);
  }

  console.log('\n=== 3. BBCode 转换 ===');
  t('转 HTML', () => bbcodeToHtml('[b]粗体[/b] [url=https://a.com]链接[/url]<br />第二行').slice(0, 90));
  t('转纯文本', () => bbcodeToText('[b]粗体[/b] [url=https://a.com]链接[/url]').slice(0, 60));

  console.log('\n=== 4. Nexus 接口 ===');
  const nexus = createNexus({ getApiKey: () => '' });
  try {
    const page = await nexus.listMods({ sort: 'downloads', count: 3 });
    t('列表', () => 'total=' + page.total + ' 返回=' + page.items.length);
    page.items.forEach(i => console.log(`     · #${i.modId} ${i.name}  ⬇${i.downloads} ♥${i.endorsements}`));
    const detail = await nexus.getMod(1496);
    t('详情', () => `#${detail.modId} ${detail.name} v${detail.version} by ${detail.author}`);
    t('说明长度', () => detail.descriptionText.length + ' 字（原文）');
    const files = await nexus.getModFiles(1496);
    t('文件列表', () => '共 ' + files.length + ' 个文件，主文件 ' + files.filter(f => f.primary).length + ' 个');
    files.slice(0, 3).forEach(f => console.log(`     · ${f.name} v${f.version} ${f.size} ${f.category} primary=${f.primary}`));
  } catch (e) {
    console.log('  ✗ Nexus 请求失败：' + e.message); fail++;
  }

  console.log('\n=== 5. 翻译 ===');
  try {
    const tr = createTranslator({ cacheFile: paths.translateCache, targetLang: 'zh-CN' });
    const r = await tr.translate('This mod adds a customizable nanosuit system to the game.');
    t('翻译', () => r.text + (r.cached ? ' (缓存)' : ''));
  } catch (e) { console.log('  ✗ 翻译失败：' + e.message); fail++; }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====\n`);
  process.exit(fail ? 1 : 0);
})();
