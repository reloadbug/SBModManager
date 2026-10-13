// 真实端到端：把一个真实压缩包通过「下载队列」导入 → 自动识别 → 自动安装。
// 用的是无害可逆的测试包（只往 ~Mods 里放两个假文件），跑完由 e2e-queue-uninstall.js 清理。
const ZIP = 'D:\\AI game\\StarBladeModManager\\_probe\\fixtures\\queue-e2e.zip';
const log = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

try {
  const imp = await window.api.download.importLocal(ZIP, {
    game: 'stellarblade', modId: 900900, fileId: 1, name: 'E2E Queue Test', version: '1.0'
  });
  log.push('import.ok=' + imp.ok + ' status=' + (imp.data && imp.data.task && imp.data.task.status));
  if (!imp.ok) { log.push('err=' + imp.error); return log; }
  const id = imp.data.task.id;

  let t = null;
  for (let i = 0; i < 80; i++) {
    await wait(250);
    const l = await window.api.download.list();
    t = (l.data.tasks || []).find(x => x.id === id);
    if (t && ['installed', 'needs_review', 'failed'].includes(t.status)) break;
  }
  log.push('final.status=' + (t && t.status));
  log.push('error=' + (t && t.error));
  log.push('install=' + JSON.stringify(t && t.install));
  log.push('archivePath=' + (t && t.archivePath));

  window.switchPage('p-download');
  await window.__dlActions.refreshDownloads();
  log.push('pageItems=' + document.querySelectorAll('.dl-item').length);
} catch (e) {
  log.push('ERR ' + e.message);
}
return log;
