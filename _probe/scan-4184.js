'use strict';
/**
 * 探针：管理器当前把 4184 这套文件识别成哪些条目？
 * 用真实游戏根跑一遍 scanner.scan，打印与被 4184 相关的一切。
 */
const path = require('path');
const root = 'C:\\games\\Star Blade';
const scanner = require(path.join(__dirname, '..', 'src', 'main', 'scanner.js'));
const { createRegistry } = require(path.join(__dirname, '..', 'src', 'main', 'registry.js'));
const paths = require(path.join(__dirname, '..', 'src', 'main', 'paths.js'));
const { linkReader } = require(path.join(__dirname, '..', 'src', 'main', 'linker.js'));

(async () => {
  const reg = createRegistry(paths.modsFile);
  const links = linkReader(paths.modLinksFile);
  const res = await scanner.scan(root, reg, links);
  const list = res.installed || res;
  const hits = list.filter(m => /Kamenlaideng|Breast_Hip/i.test(JSON.stringify(m)));
  console.log('总条目数:', list.length);
  console.log('与 4184 相关的条目数:', hits.length);
  for (const m of hits) {
    console.log('---');
    console.log('id      :', m.id);
    console.log('name    :', m.name);
    console.log('kind    :', m.kind, 'enabled:', m.enabled, 'registered:', !!m.registered, 'linked:', !!m.linked);
    console.log('files   :', (m.files || []).length, JSON.stringify((m.files || []).slice(0, 12)));
    console.log('modId   :', (m.meta && m.meta.modId) || m.modId || 0);
  }
  // CNS 索引里有没有登记这套
  const cns = (res.cns || []);
  console.log('CNS 索引条目数:', Array.isArray(cns) ? cns.length : typeof cns);
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
