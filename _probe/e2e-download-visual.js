// 视觉验证：往渲染层灌入各种状态的假任务，截图看下载页排版。
// 纯前端状态，不落任何数据文件。
const now = new Date().toISOString();
const mk = (o) => ({
  id: o.id, status: o.status,
  meta: {
    game: 'stellarblade', modId: o.modId, fileId: o.fileId || 1,
    name: o.name, author: o.author || 'Dekita', version: o.version || '2.2',
    summary: o.summary || '', image: o.image || '', images: o.images || [],
    sourceUrl: 'https://www.nexusmods.com/stellarblade/mods/' + o.modId
  },
  createdAt: o.createdAt || now, updatedAt: now,
  progress: o.progress || { received: 0, total: 0, percent: 0 },
  archivePath: o.archivePath || null, filename: o.filename || null,
  size: o.size || 0, error: o.error || null, install: o.install || null
});

const tasks = [
  mk({
    id: 'v1', status: 'downloading', modId: 1496, name: 'Custom Nanosuit System',
    version: '2.2', size: 8321143, filename: 'CNS-2.2.zip',
    progress: { received: 5240000, total: 8321143, percent: 63 }
  }),
  mk({ id: 'v2', status: 'awaiting_authorization', modId: 2001, name: 'Eve Neon Outfit Pack', size: 15400000 }),
  mk({
    id: 'v3', status: 'needs_review', modId: 2002, name: 'Ultra HD Texture Overhaul', size: 42000000,
    install: { plan: null, reason: '有 3 个文件会被覆盖，等你确认后再装' }
  }),
  mk({
    id: 'v4', status: 'installed', modId: 2003, name: 'Better Hair Physics', size: 2300000,
    install: { kind: 'pak', kindLabel: 'Pak 模组', target: 'mods', targetLabel: 'SB\\Content\\Paks\\~Mods\\', registryId: 'nexus:2003:1', written: 4 }
  }),
  mk({
    id: 'v5', status: 'failed', modId: 2004, name: 'Broken Mod', size: 0,
    error: '下载授权已过期。请回 Nexus 网页重新点一次「Mod Manager Download」。'
  })
];

window.__downloadsChanged({ task: null, tasks, stats: { total: 5, active: 3, installed: 1, failed: 1 } });
window.switchPage('p-download');
return { items: document.querySelectorAll('.dl-item').length, badge: document.getElementById('navCountDownload').textContent };
