'use strict';

/**
 * 前置组件（框架类 Mod）的集中定义。
 *
 * 为什么单独一个文件：
 *   前置组件的「一键安装」需要知道 Nexus 的 modId + **主文件 fileId**，
 *   而 fileId 是易变的（作者每次更新都会新建文件）。集中放这里，
 *   以后加别的框架（比如 Mod Pak Chunk ID Patcher）只改这一处。
 *
 * ⚠️ fileId 变更提醒
 *   CNS 主文件当前是 v2.2 / fileId=13020（2026-10 实测）。
 *   作者更新后 fileId 会变 —— 但这**不影响一键安装**：注入脚本按 fileId 精确高亮，
 *   高亮不到时会退化成「高亮页面上所有 Mod Manager Download 按钮」，
 *   提示条里带着文件名，用户仍能自己挑。所以 fileId 过期只是降级，不是失效。
 */

const PREREQS = {
  ue4ss: {
    key: 'ue4ss',
    name: 'UE4SS',
    fullName: 'UE4SS（Mod 加载器本体）',
    desc: '脚本注入运行时 · Chrisr0/RE-UE4SS · 剑星专用分支',
    // UE4SS 不走 Nexus，直接从 GitHub Release 拿
    kind: 'github',
    repo: 'Chrisr0/RE-UE4SS',
    releasesUrl: 'https://github.com/Chrisr0/RE-UE4SS/releases',
    // 安装落点：SB\Binaries\Win64\  (dwmapi.dll + ue4ss\)
    target: 'SB\\Binaries\\Win64',
    targetHint: 'dwmapi.dll + ue4ss\\'
  },

  cns: {
    key: 'cns',
    name: 'CNS',
    fullName: 'Custom Nanosuit System（CNS）',
    desc: '服装/外观系统框架 · 绝大多数服装 Mod 的前置',
    kind: 'nexus',
    modId: 1496,
    // 主文件（primary=true）。见文件顶部关于 fileId 易变的说明。
    fileId: 13020,
    version: '2.2',
    pageUrl: 'https://www.nexusmods.com/stellarblade/mods/1496',
    filesUrl: 'https://www.nexusmods.com/stellarblade/mods/1496?tab=files',
    // 安装落点：包内是 SB\ 目录 → 合并到游戏根目录（官方说明原文：
    //   "Copy the extracted SB folder and merge it with your games SB folder"）
    target: 'SB\\',
    targetHint: 'Binaries\\ + Content\\ 合并进游戏 SB\\',
    requires: ['ue4ss'],
    // 高亮提示用的可读名，注入脚本会把它写进顶部指引条
    hint: 'CustomNanosuitSystem v2.2'
  }
};

function get(key) { return PREREQS[key] || null; }

function all() { return Object.values(PREREQS); }

/**
 * 检查某个前置组件的依赖是否满足。
 * @param {object} gameInfo game.inspect() 的结果（含 ue4ss / cns 状态）
 * @param {string} key 前置组件 key
 */
function checkRequires(gameInfo, key) {
  const p = get(key);
  if (!p || !p.requires || !p.requires.length) return { ok: true, missing: [] };

  const missing = [];
  for (const dep of p.requires) {
    const st = gameInfo && gameInfo[dep];
    // ue4ss 用 installed 字段；其它前置暂按 installed 约定
    if (!st || !st.installed) missing.push(dep);
  }
  return { ok: missing.length === 0, missing };
}

module.exports = { PREREQS, get, all, checkRequires };
