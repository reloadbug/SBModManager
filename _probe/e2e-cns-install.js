/*
 * 端到端验证 · 第 1 步：用真实的 CNS 压缩包走一遍「分析 → 安装」。
 *
 * 这个文件是给 `--shot-eval-file=` 用的（渲染层上下文，可以调 window.api）。
 * 从文件读脚本是为了绕开 Git Bash 对引号 / 等号 / 反斜杠的改写。
 *
 * 运行：
 *   MSYS2_ARG_CONV_EXCL='*' env -u ELECTRON_RUN_AS_NODE \
 *     ./node_modules/electron/dist/electron.exe . \
 *     --shot=_shots/e2e-cns-install.png --shot-page=p-prereq \
 *     --shot-delay=25000 --shot-eval-file=_probe/e2e-cns-install.js
 */

const ZIP = 'D:\\Downloads\\CustomNanosuitSystem-1496-2-2-1771093897.zip';
const META = {
  name: 'CustomNanosuitSystem',
  modId: 1496,
  fileId: 13020,
  version: '2.2',
  url: 'https://www.nexusmods.com/stellarblade/mods/1496',
  isPrereq: true
};

const out = { zip: ZIP };

try {
  // 1) 装之前：CNS 应当是「未安装」
  const before = await window.api.prereq.list();
  out.beforeCns = (before.data || []).find(p => p.key === 'cns') || null;

  // 2) 分析压缩包
  const an = await window.api.install.analyze(ZIP, META, {});
  out.analyzeOk = an.ok;
  out.analyzeErr = an.ok ? null : an.error;
  if (an.ok) {
    const d = an.data;
    out.plan = {
      ok: d.ok, kind: d.kind, kindLabel: d.kindLabel,
      target: d.target, targetLabel: d.targetLabel,
      fileCount: d.fileCount, conflictCount: d.conflictCount,
      strippedPrefix: d.strippedPrefix, reason: d.reason
    };
    out.preview = (d.preview || []).slice(0, 8);
    out.conflicts = d.conflicts || [];
  }

  // 3) 执行安装
  if (an.ok && an.data.ok) {
    const run = await window.api.install.run({ archivePath: ZIP, meta: META, onConflict: 'overwrite' });
    out.runOk = run.ok;
    out.runErr = run.ok ? null : run.error;
    if (run.ok) {
      out.run = {
        id: run.data.id,
        kind: run.data.kind,
        kindLabel: run.data.kindLabel,
        written: run.data.written,
        skipped: run.data.skipped,
        backedCount: run.data.backedCount,
        backupFailed: run.data.backupFailed,
        backupDir: run.data.backupDir,
        targetLabel: run.data.targetLabel,
        manifestCount: (run.data.manifest || []).length
      };
      out.manifestHead = (run.data.manifest || []).slice(0, 5).map(f => f.rel);
    }
  }

  // 4) 装之后：CNS 应当是「已安装（确证）」
  const after = await window.api.prereq.list();
  out.afterCns = (after.data || []).find(p => p.key === 'cns') || null;

  // 5) 已安装列表里应当出现 CNS，且不重复
  const mods = await window.api.mods.list();
  const list = (mods.data && mods.data.installed) || [];
  out.modsTotal = list.length;
  out.cnsEntries = list
    .filter(m => /Nanosuit|CNS/i.test(m.name) || m.id === 'builtin:cns')
    .map(m => ({
      id: m.id, name: m.name, kind: m.kind,
      confirmed: m.confirmed, partial: m.partial,
      fileCount: m.fileCount, registered: m.registered,
      note: m.note || null
    }));

  // 6) 日志里应当留下 install:run / install:done 事件
  const log = await window.api.log.tail(400);
  const lines = (log.data && log.data.lines) || [];
  out.logEvents = lines.filter(l => /\[EVENT\] install:/.test(l)).slice(-6);
  out.logFile = (log.data && log.data.file) || null;

  // 7) 让界面跟上磁盘状态，这样截图反映的是真实结果
  if (typeof window.__refreshAll === 'function') {
    await window.__refreshAll();
    await new Promise(r => setTimeout(r, 600));
    // 直接读 DOM —— 用来区分「界面没刷新」和「截图是旧帧」这两种情况
    const area = document.querySelector('#prereqArea');
    const txt = (area && area.innerText) || '';
    out.uiBadges = (txt.match(/未安装|已安装|安装不完整/g) || []).join(',');
    out.uiHasInstalled = /已安装/.test(txt);
    out.uiRefreshed = true;
  }
} catch (e) {
  out.fatal = e && e.message ? e.message : String(e);
}

return out;
