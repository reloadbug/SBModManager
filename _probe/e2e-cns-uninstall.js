/*
 * 端到端验证 · 第 2 步：卸载 CNS，并确认被覆盖的游戏原文件被还原。
 *
 * 运行：
 *   MSYS2_ARG_CONV_EXCL='*' env -u ELECTRON_RUN_AS_NODE \
 *     ./node_modules/electron/dist/electron.exe . \
 *     --shot=_shots/e2e-cns-uninstall.png --shot-page=p-prereq \
 *     --shot-delay=18000 --shot-eval-file=_probe/e2e-cns-uninstall.js
 */

const CNS_ID = 'nexus:1496:13020';
const out = {};

try {
  const before = await window.api.mods.list();
  const list0 = (before.data && before.data.installed) || [];
  out.beforeTotal = list0.length;
  out.beforeIds = list0.map(m => m.id);

  const target = list0.find(m => m.id === CNS_ID);
  out.found = !!target;
  if (target) {
    out.target = {
      id: target.id, name: target.name, kind: target.kind,
      fileCount: target.fileCount, registered: target.registered,
      location: target.location
    };
    out.manifestHead = (target.meta && target.meta.manifest || []).slice(0, 4).map(f => f.rel);
    out.overwritten = (target.meta && target.meta.overwritten || []).map(o => ({ rel: o.rel, size: o.size }));
    out.backupDir = (target.meta && target.meta.backupDir) || null;
  }

  // 卸载（不 purge —— 文件挪到 data/backup/uninstalled/，可回滚）
  const un = await window.api.mods.uninstall(CNS_ID, { purge: false });
  out.uninstallOk = un.ok;
  out.uninstallErr = un.ok ? null : un.error;
  if (un.ok) {
    out.movedCount = (un.data.moved || []).length;
    out.movedHead = (un.data.moved || []).slice(0, 5).map(m => m.file);
    out.restoredCount = (un.data.restored || []).length;
    out.restored = un.data.restored || [];
    out.backupDirUninstall = un.data.backupDir;
  }

  // 卸完：CNS 应当是「未安装」
  const after = await window.api.prereq.list();
  const cns = (after.data || []).find(p => p.key === 'cns') || null;
  out.afterInstalled = cns ? cns.installed : null;
  out.afterMarkers = cns ? cns.markers.map(m => ({ label: m.label, exists: m.exists })) : null;

  // 列表里不该再有 CNS / DekCNS
  const mods2 = await window.api.mods.list();
  const list1 = (mods2.data && mods2.data.installed) || [];
  out.afterTotal = list1.length;
  out.afterIds = list1.map(m => m.id);
  out.leftoverCns = list1.filter(m => /Nanosuit|DekCNS/i.test(m.name) || m.id === CNS_ID).map(m => m.id);

  // 日志留痕
  const log = await window.api.log.tail(300);
  out.logEvents = ((log.data && log.data.lines) || []).filter(l => /\[EVENT\] mods:uninstall/.test(l));

  // 让界面跟上磁盘状态
  if (typeof window.__refreshAll === 'function') {
    await window.__refreshAll();
    out.uiRefreshed = true;
  }
} catch (e) {
  out.fatal = e && e.message ? e.message : String(e);
}

return out;
