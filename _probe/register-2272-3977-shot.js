const out = [];
for (const taskId of ['39c26a1f-24fa-4c21-b97e-af572c3285be', '43afedf5-86d8-4cad-9a5f-2dc02ba3d419']) {
  try {
    const r = await window.api.mods.registerExisting({ taskId });
    out.push({ ok: true, id: r.id, name: r.name, files: r.files, size: r.size, enabled: r.enabled, installedAt: r.installedAt });
  } catch (e) {
    out.push({ ok: false, taskId, err: (e && e.message) || String(e) });
  }
}
if (window.refreshDownloads) await window.refreshDownloads();
return out;
