// 视觉验证：已安装页顶部的「正在处理」实时条 + 卡片封面来源。
const now = new Date().toISOString();
const mk = (o) => ({
  id: o.id, status: o.status,
  meta: {
    game: 'stellarblade', modId: o.modId, fileId: 1,
    name: o.name, author: 'Dekita', version: '2.2', summary: '',
    image: '', images: [], sourceUrl: 'https://www.nexusmods.com/stellarblade/mods/' + o.modId
  },
  createdAt: now, updatedAt: now,
  progress: o.progress || { received: 0, total: 0, percent: 0 },
  archivePath: null, filename: null, size: o.size || 0, error: null, install: o.install || null
});

const tasks = [
  mk({ id: 'v1', status: 'downloading', modId: 1496, name: 'Custom Nanosuit System', size: 8321143, progress: { received: 5240000, total: 8321143, percent: 63 } }),
  mk({ id: 'v2', status: 'installing', modId: 2005, name: 'Weapon Skin Collection', size: 12300000 }),
  mk({ id: 'v3', status: 'awaiting_authorization', modId: 2001, name: 'Eve Neon Outfit Pack', size: 15400000 })
];

window.__downloadsChanged({ task: null, tasks, stats: { total: 3, active: 3, installed: 0, failed: 0 } });
window.switchPage('p-installed');
return { items: document.querySelectorAll('.dl-item').length, live: !!document.querySelector('.live') };
