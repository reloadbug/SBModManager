'use strict';
/**
 * 「账本 vs 磁盘」一致性核对。
 *
 * ## 为什么需要
 *
 * 注册表（`mods.json`）是「我装过什么」的记账本，磁盘才是事实。用户手动删掉
 * 一两个 pak、或整个 ~Mods 目录被清理过之后，记账本里会留下指向空气的记录：
 *
 *   · 「已安装」页虽然以磁盘扫描为准（看不到幽灵条目），但**数量、账本、
 *     冲突检测**这些还在用注册表 —— 幽灵会让它们说假话。
 *   · 反过来，如果文件被人**直接改了扩展名**（不是通过管理器开关），记账本里的
 *     `enabled` 就和磁盘对不上，界面显示「已关闭」，游戏其实照旧加载。
 *
 * 所以启动后跑一次核对，按磁盘裁决：
 *
 *   1. 清单里一个文件都不在了 → 整条删掉（`drop`）
 *   2. 只少了一部分        → 把清单裁成还在的那几份（`trim`），其余字段不动
 *   3. 有文件但开关对不上   → 按磁盘上的 `.disabled` 后缀纠正 `enabled`（`flag`）
 *
 * ## 三条取舍
 *
 * · **只按绝对路径判断存在性**：不猜名字、不按名字模糊匹配 —— 宁可多删记录，
 *   也不能把 A mod 的文件算成 B mod 的。
 * · **只删「全丢」的记录**：只少一两个文件的记录留着并裁剪清单，因为用户可能
 *   只是误删了一部分，剩下的仍要能开关 / 卸载。
 * · **本模块只算不写**（`plan()` 是纯函数），落盘交给调用方传给 `registry`
 *   的 `remove` / `patchMany` —— 这样测试可以喂假数据，也不会半途写坏账本。
 */

const fs = require('fs');
const toggleName = require('./toggleName');

/** 磁盘上这个路径存在吗（读不了也算不存在，别让权限问题把记录删掉…不，宁可保守：报 true） */
function defaultExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    // 权限/占用之类的异常：当作「在」，避免因为一时读不到就把记录删了
    return true;
  }
}

/**
 * 算出该怎么改，不落盘。
 *
 * @param {Array} entries 注册表条目（`registry.all()`）
 * @param {(p: string) => boolean} exists 存在性判定（测试可注入）
 * @returns {{
 *   total: number, kept: number, dropped: number, trimmed: number, flagged: number,
 *   missingFiles: number,
 *   drop: Array<{id: string, name: string, files: number, target: string}>,
 *   trim: Array<{id: string, name: string, manifest: Array, removed: number}>,
 *   flag: Array<{id: string, name: string, from: boolean, to: boolean}>
 * }}
 */
function plan(entries, exists = defaultExists) {
  const report = {
    total: 0, kept: 0, dropped: 0, trimmed: 0, flagged: 0, missingFiles: 0,
    drop: [], trim: [], flag: []
  };

  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e) continue;
    report.total++;
    const manifest = Array.isArray(e.manifest) ? e.manifest.filter(x => x && x.path) : [];

    // 没有清单的记录（理论上不该有）不动它 —— 没有判据就别乱删。
    if (!manifest.length) { report.kept++; continue; }

    const alive = manifest.filter(x => exists(x.path));

    if (!alive.length) {
      report.dropped++;
      report.missingFiles += manifest.length;
      report.drop.push({ id: e.id, name: e.name || e.id, files: manifest.length, target: e.target || '' });
      continue;
    }

    if (alive.length < manifest.length) {
      report.trimmed++;
      report.missingFiles += manifest.length - alive.length;
      report.trim.push({ id: e.id, name: e.name || e.id, manifest: alive, removed: manifest.length - alive.length });
    }

  // 开关状态以磁盘为准：清单里有文件挂着「关着」的名字，就是「关着」。
  // 「关着」有两种写法（pak 加 .disabled 后缀；CNS 索引把标记插在 .json 前面），
  // 判定统一走 toggleName.isDisabledName —— 只认后缀的话，xxx.dekcns.disabled.json
  // 会被当成「开着」，于是这里把注册表改回 enabled=true，界面又显示「已启用」，
  // 用户看到的就是「关掉了又自己回来了」。
    // （用户绕过管理器直接改扩展名时，账本会停在旧值。）
  const anyDisabled = alive.some(x => toggleName.isDisabledName(String(x.path)));
    const want = !anyDisabled;
    if (!!e.enabled !== want) {
      report.flagged++;
      report.flag.push({ id: e.id, name: e.name || e.id, from: !!e.enabled, to: want });
    }

    report.kept++;
  }

  return report;
}

/**
 * 把 `plan()` 的结果落到注册表上。调用方负责传真的 registry（或同形状的桩）。
 *
 * @returns {{dropped: number, trimmed: number, flagged: number}}
 */
function apply(registry, report) {
  const out = { dropped: 0, trimmed: 0, flagged: 0 };
  if (!registry || !report) return out;

  const patches = [];
  for (const t of report.trim || []) {
    patches.push({ id: t.id, patch: { manifest: t.manifest } });
    out.trimmed++;
  }
  for (const f of report.flag || []) {
    patches.push({ id: f.id, patch: { enabled: f.to } });
    out.flagged++;
  }
  if (patches.length) {
    if (typeof registry.patchMany === 'function') registry.patchMany(patches);
    else for (const p of patches) registry.patch(p.id, p.patch);
  }

  for (const d of report.drop || []) {
    registry.remove(d.id);
    out.dropped++;
  }
  return out;
}

/** 有没有值得跟用户说一声的变化 */
function noteworthy(report) {
  if (!report) return false;
  return !!(report.dropped || report.trimmed || report.flagged);
}

/** 给日志/界面看的一句话摘要 */
function summarize(report) {
  if (!report) return '没有核对结果';
  if (!noteworthy(report)) return `账本与磁盘一致（${report.kept} 条）`;
  const parts = [];
  if (report.dropped) parts.push(`移除 ${report.dropped} 条（文件已不在）`);
  if (report.trimmed) parts.push(`裁剪 ${report.trimmed} 条的文件清单`);
  if (report.flagged) parts.push(`按磁盘纠正 ${report.flagged} 条的开关状态`);
  return parts.join('，');
}

/**
 * 下载任务与磁盘的一致性：装过、但现在游戏目录里找不到的任务。
 *
 * 这些任务要能被**重新安装**（尤其换过游戏目录之后），所以不能停在
 * `installed` —— 那个状态在界面上没有「安装」按钮。
 *
 * @param {Array} tasks 队列任务
 * @param {Set<string>} installedIds 当前磁盘扫描出来的注册表 id
 * @param {Set<number>} installedModIds 当前磁盘扫描出来的 Nexus modId
 * @param {(p: string) => boolean} exists 安装包是否存在
 * @returns {{ downgrade: Array<{id, modId, status, reason, archived}>, keep: number }}
 */
function planQueue(tasks, installedIds, installedModIds, exists = defaultExists) {
  const ids = installedIds instanceof Set ? installedIds : new Set(installedIds || []);
  const modIds = installedModIds instanceof Set ? installedModIds : new Set(installedModIds || []);
  const out = { downgrade: [], keep: 0 };

  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t) continue;
    if (t.status !== 'installed') { out.keep++; continue; }
    const regId = t.install && t.install.registryId;
    const modId = Number((t.meta && t.meta.modId) || 0);
    const present = (regId && ids.has(regId)) || (modId && modIds.has(modId));
    if (present) { out.keep++; continue; }

    const archived = !!(t.archivePath && exists(t.archivePath));
    out.downgrade.push({
      id: t.id, modId,
      // 有安装包 → 回到「已下载」，界面上就有「安装」按钮；
      // 没安装包 → 只能算失败（得重新下载）。
      status: archived ? 'downloaded' : 'failed',
      archived,
      reason: archived
        ? '游戏目录里找不到这些文件了（可能被手动删掉，或换过游戏目录）'
        : '游戏目录里找不到这些文件，本地也没留安装包'
    });
  }
  return out;
}

module.exports = { plan, apply, planQueue, noteworthy, summarize, defaultExists };
