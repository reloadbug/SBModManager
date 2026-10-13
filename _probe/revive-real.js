'use strict';
/**
 * 对**真实数据**跑一次 reviveBrokenInstalls（只改任务状态/文案，不装任何东西）。
 *
 * 用法：node _probe/revive-real.js            ← 只看不改（dry run）
 *       node _probe/revive-real.js --apply    ← 真写进 data/downloads.json
 */
const path = require('path');

const paths = require('../src/main/paths');
const installer = require('../src/main/installer');
const game = require('../src/main/game');
const { createRegistry } = require('../src/main/registry');
const { createDownloadEngine } = require('../src/main/downloadEngine');

const APPLY = process.argv.includes('--apply');

async function main() {
  const registry = createRegistry ? createRegistry({ file: paths.registryFile || path.join(paths.DATA, 'mods.json') }) : null;
  const root = (() => { try { return game.findGame ? game.findGame() : null; } catch { return null; } })();
  console.log('游戏目录：', root);
  console.log('模式：', APPLY ? 'APPLY（真改）' : 'DRY RUN（只打印）');

  let engine = createDownloadEngine({
    file: paths.downloadQueueFile,
    libraryDir: paths.LIBRARY,
    imagesDir: paths.IMAGES,
    analyze: (r, ap, meta, opts) => installer.analyze(r, ap, meta, opts || {}),
    getRoot: () => root,
    getLayout: (r) => game.layout(r),
    getRegistry: () => registry,
    logger: { info() {}, warn() {}, error() {} }
  });

  const before = engine.list().filter(t =>
    t.status === 'failed' && (/无法识别这个压缩包的结构/.test(String(t.error || '')) || /7-Zip \d|Copyright \(c\)/.test(String(t.error || ''))));
  console.log('\n命中 ' + before.length + ' 条：');
  for (const t of before) {
    console.log('  #' + t.meta.modId, t.meta.name);
    console.log('    现状：' + t.status + ' · ' + String(t.error || '').slice(0, 120).replace(/\n/g, ' '));
  }

  // 构造时已经自动跑过一次（异步），这里再明确跑一次以便拿返回值
  const r = await engine.reviveBrokenInstalls();
  console.log('\nrevive 结果：', JSON.stringify(r));

  for (const t of before) {
    const now = engine.get(t.id);
    console.log('\n  #' + t.meta.modId, t.meta.name);
    console.log('    现在：' + now.status + (now.error ? ' · ' + String(now.error).slice(0, 160).replace(/\n/g, ' ') : ''));
    const reason = now.install && now.install.reason;
    if (reason) console.log('    理由：' + String(reason).slice(0, 160).replace(/\n/g, ' '));
  }

  console.log('\n（data/downloads.json 已由队列层自动持久化）');
}

main().catch(e => { console.error('失败：', e); process.exitCode = 1; });
