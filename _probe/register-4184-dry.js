'use strict';
/**
 * 探针（只读，不写注册表）：用 mod 4184 的安装包验证「补登记」这条链路。
 *  · analyze 能不能对当前游戏根认出结构
 *  · verifyExisting 是否 7 个文件全在位、大小一致
 *  · registryIdFor 生成的 id 是不是原来那条
 */
const path = require('path');
const root = 'C:\\games\\Star Blade';
const M = (n) => require(path.join(__dirname, '..', 'src', 'main', n));
const paths = M('paths.js');
const game = M('game.js');
const installer = M('installer.js');
const installFlow = M('installFlow.js');
const { createRegistry } = M('registry.js');

(async () => {
  const L = game.layout(root);
  const reg = createRegistry(paths.modsFile);

  // 从下载队列里取 4184 那条任务的 meta
  const q = JSON.parse(require('fs').readFileSync(path.join(root, '.sbmod', 'downloads.json'), 'utf8'));
  const tasks = q.tasks || [];
  const task = tasks.find(t => Number(t.meta && t.meta.modId) === 4184 && t.archivePath);
  if (!task) throw new Error('队列里没有 4184 的任务');
  console.log('任务:', task.id, '| 状态:', task.status);
  console.log('安装包:', task.archivePath, require('fs').existsSync(task.archivePath) ? '(在)' : '(不在!)');

  const meta = { ...task.meta, taskId: task.id };
  const ownedPaths = installFlow.ownedPathsFor(reg, meta);
  let plan = await installer.analyze(root, task.archivePath, meta, { ownedPaths });
  console.log('\nanalyze ok:', plan.ok, '| kind:', plan.kind, plan.kindLabel, '| 目标:', plan.target);

  if (!plan.ok && plan.needsTargetPick && (plan.options || []).length && plan.hasConflicts === false) {
    const dirs = (plan.defaultPick || []).length ? plan.defaultPick : plan.options.map(o => o.dir).filter(Boolean);
    console.log('多变体 → 全选:', dirs);
    plan = await installer.analyze(root, task.archivePath, meta, { ownedPaths, pickDirs: dirs });
    console.log('二次 analyze ok:', plan.ok);
  }

  const v = installer.verifyExisting(plan);
  console.log('\nverifyExisting:', v.ok, '| 在位', v.present.length + '/' + v.total,
    '| 缺', v.missing.length, '| 大小不符', v.mismatched.length);
  v.present.forEach(f => console.log('   ✓', path.basename(f.path), f.size, f.disabled ? '[关闭]' : '', f.bornAt));
  v.missing.forEach(f => console.log('   ✗ 缺', f.rel));
  v.mismatched.forEach(f => console.log('   ✗ 大小', f.rel, f.size, '→ 实际', f.currentSize));

  if (v.ok) {
    const manifest = v.present.map(f => ({ path: f.path, rel: f.rel, size: f.size }));
    const id = installFlow.registryIdFor(L, plan, manifest, meta);
    console.log('\nregistryIdFor →', id, '| 注册表里已经有吗:', !!reg.get(id));
  }
})().catch(e => { console.error('失败:', e && e.message); process.exit(1); });
