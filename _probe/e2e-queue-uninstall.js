// 清理 e2e-queue-install.js 装进去的测试 Mod（走正规卸载，验证回滚）。
const log = [];
try {
  const list = await window.api.mods.list();
  const m = (list.data.installed || []).find(x =>
    /E2EQueueTest/i.test(x.name) ||
    (x.meta && x.meta.source && Number(x.meta.source.modId) === 900900));
  log.push('found=' + !!m + ' id=' + (m && m.id) + ' name=' + (m && m.name));

  if (m) {
    const r = await window.api.mods.uninstall(m.id, {});
    log.push('uninstall.ok=' + r.ok + ' moved=' + (r.data && r.data.moved.length) +
      ' restored=' + (r.data && r.data.restored.length) + ' pruned=' + (r.data && r.data.pruned.length));
    if (!r.ok) log.push('uninstall.err=' + r.error);
  }

  const list2 = await window.api.mods.list();
  log.push('leftAfter=' + (list2.data.installed || []).filter(x => /E2EQueueTest/i.test(x.name)).length);
  await window.__refreshAll();
} catch (e) {
  log.push('ERR ' + e.message);
}
return log;
