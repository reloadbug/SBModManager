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

    console.log('download queue tests passed');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
