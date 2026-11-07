'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDownloadQueue } = require('../src/main/downloadQueue');

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'starblade-download-queue-'));
  const file = path.join(dir, 'downloads.json');
  let tick = 0;
  const queue = createDownloadQueue({ file, now: () => '2026-10-11T00:00:' + String(tick++).padStart(2, '0') + '.000Z', makeId: () => 'task-' + tick });

  try {
    const { task, duplicate } = queue.add({
      game: 'stellarblade', modId: 1496, fileId: 13020, name: 'CNS',
      key: 'must-not-persist', expires: 123, raw: 'nxm://secret', uri: 'https://cdn/?token=secret',
      image: 'file:///cache/cover.png', images: [{ localUrl: 'file:///cache/1.png', url: 'https://images.nexusmods.com/1.jpg', mime: 'image/jpeg', size: 12 }]
    });
    assert.equal(duplicate, false);
    assert.equal(task.status, 'awaiting_authorization');
    assert.equal(task.meta.name, 'CNS');
    assert.equal(task.meta.key, undefined);
    assert.equal(task.meta.expires, undefined);
    assert.equal(task.meta.raw, undefined);
    assert.equal(task.meta.uri, undefined);

    const dup = queue.add({ game: 'stellarblade', modId: 1496, fileId: 13020, name: 'Renamed' });
    assert.equal(dup.duplicate, true);
    assert.equal(dup.task.id, task.id);

    queue.update(task.id, { status: 'queued', meta: { version: '2.2', key: 'still-private' } });
    queue.updateProgress(task.id, { received: 1024, total: 2048, percent: 50 });
    const onDisk = await fs.promises.readFile(file, 'utf8');
    assert(!onDisk.includes('must-not-persist'));
    assert(!onDisk.includes('secret'));
    assert.equal(queue.get(task.id).progress.percent, 50);

    const restarted = createDownloadQueue({ file, now: () => '2026-10-11T00:01:00.000Z' });
    assert.equal(restarted.get(task.id).status, 'interrupted');
    assert.match(restarted.get(task.id).error, /上次退出/);
    assert.equal(restarted.list().length, 1);

    restarted.update(task.id, { status: 'installed', install: { kind: 'cns', target: 'SB' } });
    assert.equal(restarted.findMatchingMod(1496).id, task.id);

    const failed = restarted.add({ modId: 1496, fileId: 13021, name: 'CNS optional' });
    assert.equal(failed.duplicate, false);
    assert.throws(() => restarted.add({ modId: 0 }), /Mod ID/);
    assert.throws(() => restarted.update(failed.task.id, { status: 'made-up' }), /状态/);

    // ── 进度与状态分流（2026-11-07 用户报「有下载进度时筛选按钮会失灵，一闪一闪的」）──
    // 根因：updateProgress 也走 onChange → 主进程推 download:changed → 渲染层整页 innerHTML 重绘，
    //       卡片 <img> 全量重载（闪），按下与松开之间节点被换掉，click 不派发（按钮失灵）。
    let changes = 0;
    let ticks = 0;
    const watched = createDownloadQueue({
      file,
      onChange: () => { changes += 1; },
      onTick: () => { ticks += 1; }
    });
    const changes0 = changes;
    watched.updateProgress(task.id, { percent: 61 });
    assert.equal(changes, changes0, 'updateProgress 不应触发 onChange（否则界面整页重绘）');
    assert.equal(ticks, 1, 'updateProgress 应走 onTick');
    watched.update(task.id, { status: 'queued' });
    assert.equal(changes, changes0 + 1, '状态变化仍然走 onChange');

    // 接线静态断言（源码层面把这条约定钉住）
    const read = (rel) => fs.promises.readFile(path.join(__dirname, '..', rel), 'utf8');
    const queueSrc = await read('src/main/downloadQueue.js');
    const upBody = queueSrc.slice(queueSrc.indexOf('function updateProgress'), queueSrc.indexOf('function findByIdentity'));
    assert(!/onChange\(/.test(upBody), 'updateProgress 里不能再调 onChange');
    assert(/onTick\(clone\(task\)\)/.test(upBody), 'updateProgress 要调 onTick');

    const engineSrc = await read('src/main/downloadEngine.js');
    assert(/onTick:\s*\(task\)\s*=>/.test(engineSrc), 'downloadEngine 要把 onTick 转给 onProgress');
    assert(/onProgress\(task\.id, \{ received/.test(engineSrc), '进度回调要带 received/total/percent');

    const appSrc = await read('src/renderer/app.js');
    assert(/function dlStatusSig\(/.test(appSrc), 'app.js 要有 dlStatusSig');
    assert(/if \(dlStatusSig\(prev\) === dlStatusSig\(state\.downloads\)\)/.test(appSrc), 'onDownloadChanged 状态未变时要提前返回');
    assert(/function renderLiveStrip\(/.test(appSrc), 'app.js 要有 renderLiveStrip');
    assert(/cur\.outerHTML = html/.test(appSrc), 'renderLiveStrip 应就地替换 .live 节点');

    console.log('download queue tests passed');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
