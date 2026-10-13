'use strict';
// 探针：验证 installFlow.runInstall 透传 pickDir 后，变体包能真正装到假游戏根
const fs = require('fs');
const path = require('path');
const os = require('os');

const game = require('../src/main/game');
const installer = require('../src/main/installer');
const installFlow = require('../src/main/installFlow');
const { createRegistry } = require('../src/main/registry');

const ROOT = path.join(os.tmpdir(), 'sb-pickdir-e2e');
const ARCHIVE = path.join(__dirname, '..', 'data', 'library', '692', 'Nexus Global Content Delivery Network');
const PICK = 'BP_Nude_Skin Suit (2 variants)/BP_Nude_Skin Suit_A';

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'SB', 'Binaries', 'Win64', 'ue4ss', 'Mods'), { recursive: true });

  const registry = createRegistry(path.join(ROOT, 'registry.json'));
  const layout = game.layout(ROOT);

  const meta = { name: 'Eve BP Nude (CNS Compatible)', modId: 692, fileId: 1 };

  console.log('=== 1) 不传 pickDir（应抛「无法识别」）===');
  try {
    await installFlow.runInstall({ root: ROOT, archivePath: ARCHIVE, meta, registry, layout });
    console.log('  ✗ 竟然成功了（不该）');
  } catch (e) {
    console.log('  ✓ 按预期失败：' + e.message);
  }

  console.log('\n=== 2) 传 pickDir（应成功）===');
  let r = null;
  try {
    r = await installFlow.runInstall({
      root: ROOT, archivePath: ARCHIVE, meta, pickDir: PICK, registry, layout
    });
    console.log('  ✓ 安装成功');
    console.log('    id     =', r.id);
    console.log('    target =', r.target);
    console.log('    written=', r.written);
  } catch (e) {
    console.log('  ✗ 失败：' + e.message);
    process.exit(1);
  }

  console.log('\n=== 3) 落盘文件 ===');
  const modsDir = path.join(ROOT, 'SB', 'Content', 'Paks', '~Mods');
  const files = fs.readdirSync(modsDir, { withFileTypes: true });
  for (const f of files) {
    const size = f.isFile() ? fs.statSync(path.join(modsDir, f.name)).size : '(dir)';
    console.log('  ' + (f.isFile() ? '文件' : '目录') + '  ' + f.name + '  ' + size);
  }

  const okFlat = files.every(f => f.isFile());
  console.log('\n  ~Mods 下没有多出来的子目录 =', okFlat ? '✓' : '✗ 有 ' + files.filter(f => f.isDirectory()).map(f => f.name).join(','));
  console.log('  只装了选中的一套（3 个文件）=', files.filter(f => f.isFile()).length === 3 ? '✓' : '✗ 文件数 ' + files.filter(f => f.isFile()).length);

  console.log('\n=== 4) 注册表 ===');
  for (const m of registry.all()) {
    console.log('  ' + m.id + ' | ' + m.name + ' | ' + (m.manifest || []).length + ' 个文件');
  }

  fs.rmSync(ROOT, { recursive: true, force: true });
})().catch(e => { console.error('探针崩溃：' + e.message + '\n' + e.stack); process.exit(1); });
