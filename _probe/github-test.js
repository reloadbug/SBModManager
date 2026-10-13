'use strict';
/**
 * GitHub Release 通道自检。
 *
 * 重点在 `pickAsset` —— 选错资产会把 52MB 的 dev 包当成正式包下下来
 * （UE4SS 的 dev 包叫 `zDEV-UE4SS_...zip`，前缀 `z` 只是为了让它在列表里排最后）。
 *
 * 网络相关的那两项是**软断言**：连不上 GitHub 时记为「跳过」而不是失败，
 * 因为这个套件要能在离线环境下跑完。
 *
 * 用法：
 *   node _probe/github-test.js
 */
const github = require('../src/main/github');

let pass = 0, fail = 0, skip = 0;

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + label + '  → ' + e.message); }
}

/* UE4SS 官方 Release 的真实资产形状（2026-10 实测） */
const REAL_ASSETS = [
  { id: 269406487, name: 'UE4SS_v3.1.0-6.zip', size: 8029443, contentType: 'application/x-zip-compressed', downloadCount: 573647, url: 'https://github.com/Chrisr0/RE-UE4SS/releases/download/3.1.0-6/UE4SS_v3.1.0-6.zip', apiUrl: 'https://api.github.com/repos/Chrisr0/RE-UE4SS/releases/assets/269406487' },
  { id: 269406495, name: 'zDEV-UE4SS_v.3.1.0-6.zip', size: 52479241, contentType: 'application/x-zip-compressed', downloadCount: 54874, url: 'https://github.com/Chrisr0/RE-UE4SS/releases/download/3.1.0-6/zDEV-UE4SS_v.3.1.0-6.zip', apiUrl: 'https://api.github.com/repos/Chrisr0/RE-UE4SS/releases/assets/269406495' }
];

/* 上游 UE4SS-RE/RE-UE4SS 的资产形状（多了 CustomGameConfigs / MapGenBP） */
const UPSTREAM_ASSETS = [
  { id: 1, name: 'UE4SS_v3.0.1.zip', size: 5523402, contentType: 'application/zip', downloadCount: 100, url: 'u1', apiUrl: 'a1' },
  { id: 2, name: 'zCustomGameConfigs.zip', size: 45442, contentType: 'application/zip', downloadCount: 10, url: 'u2', apiUrl: 'a2' },
  { id: 3, name: 'zDEV-UE4SS_v3.0.1.zip', size: 23810106, contentType: 'application/zip', downloadCount: 20, url: 'u3', apiUrl: 'a3' },
  { id: 4, name: 'zMapGenBP.zip', size: 27568, contentType: 'application/zip', downloadCount: 5, url: 'u4', apiUrl: 'a4' }
];

const UE4SS_PICK = {
  prefer: [/^UE4SS_v?[\d.]/i],
  avoid: [/^z/i, /dev/i, /customgameconfigs/i, /mapgen/i]
};

console.log('\n=== 1) pickAsset：必须挑中正式包，不能挑到 dev 包 ===');
t('Chrisr0/RE-UE4SS：选中 UE4SS_v3.1.0-6.zip', () => {
  const a = github.pickAsset(REAL_ASSETS, UE4SS_PICK);
  if (!a) return '返回 null';
  return a.name === 'UE4SS_v3.1.0-6.zip' || a.name;
});
t('挑中的不是 52MB 的 dev 包', () => {
  const a = github.pickAsset(REAL_ASSETS, UE4SS_PICK);
  return a && a.size === 8029443 || String(a && a.size);
});
t('UE4SS-RE/RE-UE4SS：也选中正式包', () => {
  const a = github.pickAsset(UPSTREAM_ASSETS, UE4SS_PICK);
  if (!a) return '返回 null';
  return a.name === 'UE4SS_v3.0.1.zip' || a.name;
});
t('排除了 CustomGameConfigs / MapGenBP', () => {
  const a = github.pickAsset(UPSTREAM_ASSETS, UE4SS_PICK);
  return a && !/customgameconfigs|mapgen/i.test(a.name) || String(a && a.name);
});

console.log('\n=== 2) pickAsset：边界情况 ===');
t('空数组 → null', () => github.pickAsset([], UE4SS_PICK) === null || '非 null');
t('全是 dev 包 → null（宁可不装也不装错）', () => {
  const onlyDev = [REAL_ASSETS[1]];
  return github.pickAsset(onlyDev, UE4SS_PICK) === null || '挑到了 dev 包';
});
t('非 zip 资产被扩展名过滤掉', () => {
  const assets = [
    { name: 'checksums.txt', size: 1, url: 'u', apiUrl: 'a' },
    { name: 'UE4SS_v1.zip', size: 2, url: 'u2', apiUrl: 'a2' }
  ];
  const a = github.pickAsset(assets, UE4SS_PICK);
  return a && a.name === 'UE4SS_v1.zip' || String(a && a.name);
});
t('prefer 正则按顺序优先匹配', () => {
  const assets = [
    { name: 'UE4SS_v1.zip', size: 1, url: 'u1', apiUrl: 'a1' },
    { name: 'UE4SS_v2.zip', size: 2, url: 'u2', apiUrl: 'a2' }
  ];
  const a = github.pickAsset(assets, { prefer: [/v2/], avoid: [] });
  return a && a.name === 'UE4SS_v2.zip' || String(a && a.name);
});
t('prefer 全不命中时回落到第一个可用资产', () => {
  const assets = [{ name: 'UE4SS_v9.zip', size: 1, url: 'u', apiUrl: 'a' }];
  const a = github.pickAsset(assets, { prefer: [/v1/], avoid: [] });
  return a && a.name === 'UE4SS_v9.zip' || String(a && a.name);
});
t('assets 为 null 也不炸', () => github.pickAsset(null, UE4SS_PICK) === null || '非 null');

// 注意：getLatestRelease 是 async，校验失败会变成 **rejected promise** 而不是同步抛错。
// 所以必须 await，不能在同步断言里 try/catch（那样会留下未处理的 rejection，直接崩进程）。
async function testRepoValidation() {
  console.log('\n=== 3) 仓库名校验 ===');
  let bad = false;
  try { await github.getLatestRelease('not a repo'); } catch { bad = true; }
  t('非法仓库名（带空格）被拒', () => bad === true || '没有拒绝');

  let bad2 = false;
  try { await github.getLatestRelease(''); } catch { bad2 = true; }
  t('空仓库名被拒', () => bad2 === true || '没有拒绝');
}

console.log('\n=== 4) 导出面完整 ===');
t('导出 request / getJson / getLatestRelease / pickAsset / downloadAsset', () => {
  const need = ['request', 'getJson', 'getLatestRelease', 'pickAsset', 'downloadAsset'];
  const miss = need.filter(k => typeof github[k] !== 'function');
  return miss.length === 0 || '缺少：' + miss.join(',');
});

/* ---------------- 网络（软断言） ---------------- */

(async function main() {
  await testRepoValidation();

  console.log('\n=== 5) 真实 GitHub API（软断言，失败记为跳过） ===');
  try {
    const rel = await github.getLatestRelease('Chrisr0/RE-UE4SS');
    t('拿到 tag', () => !!rel.tag || '没有 tag');
    t('拿到资产列表', () => Array.isArray(rel.assets) && rel.assets.length > 0 || '资产为空');
    t('资产里有 id（资产 API 通路需要它）', () => {
      const a = github.pickAsset(rel.assets, UE4SS_PICK);
      return a && a.id > 0 || '没有 id';
    });
    t('选中的是正式包', () => {
      const a = github.pickAsset(rel.assets, UE4SS_PICK);
      return a && /^UE4SS_v?[\d.]/i.test(a.name) || String(a && a.name);
    });
  } catch (e) {
    skip += 4;
    console.log('  · 跳过（GitHub 不可达：' + e.message + '）');
  }

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' 跳过' : '') + ' =====');
  process.exit(fail ? 1 : 0);
})();
