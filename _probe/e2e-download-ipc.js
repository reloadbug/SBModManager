// 真实 IPC 冒烟测试：走主进程的 download:* 通道，最后清理干净（不留数据）。
// 由 --shot-eval-file= 加载执行，返回一串日志。
const log = [];
try {
  const before = await window.api.download.list();
  log.push('before=' + (before.data.tasks || []).length);

  const enq = await window.api.download.enqueue({
    game: 'stellarblade', modId: 900001, fileId: 1,
    name: 'E2E 测试 Mod', author: 'tester', version: '1.0',
    sourceUrl: 'https://www.nexusmods.com/stellarblade/mods/900001'
  });
  log.push('enqueue.ok=' + enq.ok + ' duplicate=' + (enq.data && enq.data.duplicate) +
    ' status=' + (enq.data && enq.data.task && enq.data.task.status));
  const id = enq.data && enq.data.task && enq.data.task.id;
  if (!id) throw new Error('没有拿到任务 id');

  const after = await window.api.download.list();
  log.push('after=' + after.data.tasks.length + ' stats=' + JSON.stringify(after.data.stats));

  window.switchPage('p-download');
  await window.__dlActions.refreshDownloads();
  log.push('pageItems=' + document.querySelectorAll('.dl-item').length);

  const dup = await window.api.download.enqueue({ game: 'stellarblade', modId: 900001, fileId: 1, name: '重复' });
  log.push('dup.duplicate=' + (dup.data && dup.data.duplicate));

  const bad = await window.api.download.enqueue({ modId: 0 });
  log.push('bad.ok=' + bad.ok + ' err=' + String(bad.error).slice(0, 40));

  const rm = await window.api.download.remove(id, { deleteArchive: true });
  log.push('remove.ok=' + rm.ok);

  const finalList = await window.api.download.list();
  log.push('final=' + finalList.data.tasks.length);
  await window.__dlActions.refreshDownloads();
  log.push('pageAfter=' + document.querySelectorAll('.dl-item').length);
  log.push('navBadge=' + document.getElementById('navCountDownload').textContent);
} catch (e) {
  log.push('ERR ' + e.message);
}
return log;
