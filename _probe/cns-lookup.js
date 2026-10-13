'use strict';
/* 调研 CNS (#1496) 的真实文件列表与安装说明，用于设计「自动安装 CNS」。 */
const { createNexus } = require('../src/main/nexus');

(async () => {
  const nx = createNexus();
  const modId = 1496;

  const mod = await nx.getMod(modId);
  console.log('===== MOD =====');
  console.log('name    :', mod.name);
  console.log('author  :', mod.author);
  console.log('version :', mod.version);
  console.log('summary :', mod.summary);
  console.log('url     :', mod.url);

  console.log('\n===== 说明（纯文本，前 2500 字）=====');
  console.log((mod.descriptionText || '').slice(0, 2500));

  console.log('\n===== 文件列表 =====');
  const files = await nx.getModFiles(modId);
  for (const f of files) {
    console.log(`- [${f.categoryRaw}] ${f.name}`);
    console.log(`    fileId=${f.fileId}  version=${f.version}  size=${f.size}  primary=${f.primary}`);
    if (f.description) console.log('    desc:', String(f.description).replace(/\s+/g, ' ').slice(0, 200));
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
