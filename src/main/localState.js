'use strict';

/**
 * 浏览页「本地状态」判定 —— 把「Nexus 上的 mod」和「本地已装 / 已下载的东西」对上。
 *
 * 关联键**只有 Nexus modId 一个**（可靠且唯一）：
 *   1. 已安装 —— scanner 扫出来的条目里带 `meta.source.modId` 的。
 *      ⚠️ 用 scanner 结果而不是原始注册表：这样「文件已被手动删掉」的注册表条目
 *         不会误报成「已安装」。
 *   2. 下载队列 —— `meta.modId` 命中，且状态属于「进行中 / 待安装」。
 *   3. 安装包库（`paths.LIBRARY`）—— 磁盘上的 `<modId>_<名>_<版本>.zip`，算「已下载」。
 *      ⚠️ 2026-11-09 用户实测：下载记录被「清理已完成记录」删掉之后，浏览页
 *      明明包就在本地，卡片却又显示「⬇ 下载」，点一下是**又下一遍**。
 *      所以「本地有没有这个包」必须以磁盘为准，不能只看任务账本。
 *
 * ⚠️ **手动丢进 `~Mods` 的 pak 没有 modId，关联不上** —— 这里刻意不做名字模糊匹配。
 *    误标（显示已装其实没装）比不标更糟：用户会以为装好了，进游戏发现没生效。
 */

/**
 * 下载任务状态 → 浏览页标记。
 * 未列出的状态（`failed` / `cancelled` / `interrupted` / `installed`）一律**不标记**：
 *   · 失败/取消 —— 本地没有可用产物，不该显示
 *   · `installed` —— 交给 scanner 判定。若用户已卸载，下载记录仍是 installed，
 *     此时浏览页不该继续显示「已安装」
 */
const TASK_STATE = {
  awaiting_authorization: 'downloading',
  queued: 'downloading',
  resolving: 'downloading',
  downloading: 'downloading',
  downloaded: 'pending',
  analyzing: 'pending',
  needs_review: 'pending',
  installing: 'installing'
};

/** 同一个 modId 命中多条任务时，取「更靠后」的那个状态 */
const STATE_RANK = { installed: 4, installing: 3, pending: 2, downloading: 1 };

const STATES = ['installed', 'installing', 'pending', 'downloading'];

/** 状态的中文说明（主进程与渲染层共用同一套措辞） */
const STATE_LABEL = {
  installed: '已安装',
  installing: '安装中',
  pending: '已下载',
  downloading: '下载中'
};

/**
 * 建索引。
 * @param {object}   p
 * @param {Array}    p.scanned   scanner.scan() 的结果
 * @param {Array}    p.tasks     downloadEngine.list() 的结果
 * @param {Array}   [p.library]  localLibrary.scan().items（安装包库里的包）
 * @returns {{installed: Map<number, object>, pending: Map<number, object>}}
 */
function buildLocalIndex({ scanned = [], tasks = [], library = [] } = {}) {
  const installed = new Map();

  for (const m of Array.isArray(scanned) ? scanned : []) {
    const src = m && m.meta && m.meta.source;
    const modId = Number(src && src.modId);
    if (!modId) continue;
    installed.set(modId, {
      state: 'installed',
      modId,
      registryId: m.id || null,
      name: m.name || '',
      version: (src && src.version) || '',
      fileId: Number(src && src.fileId) || 0,
      target: m.location || ''
    });
  }

  const pending = new Map();

  for (const t of Array.isArray(tasks) ? tasks : []) {
    const meta = t && t.meta;
    const modId = Number(meta && meta.modId);
    if (!modId) continue;

    const state = TASK_STATE[t.status];
    if (!state) continue;

    // 已装的优先：注册表 + 磁盘都在，比「下载记录里说装过」可信
    if (installed.has(modId)) continue;

    const prev = pending.get(modId);
    if (prev && (STATE_RANK[prev.state] || 0) >= (STATE_RANK[state] || 0)) continue;

    pending.set(modId, {
      state,
      modId,
      taskId: t.id || null,
      status: t.status || null,
      name: (meta && meta.name) || '',
      fileName: (meta && meta.fileName) || '',
      fileId: Number(meta && meta.fileId) || 0
    });
  }

  // ③ 安装包库：包躺在 `paths.LIBRARY` 里，但下载记录可能早被清掉了。
  //    只是**兜底** —— 队列里已经有这个 modId 的任何状态（下载中 / 待安装 / 安装中）
  //    就整条让给队列：队列那条带 taskId，按钮能问到确认信息，且「正在下载」
  //    这件事比「库里有一份旧包」更该显示。
  for (const it of Array.isArray(library) ? library : []) {
    const modId = Number(it && it.modId);
    if (!modId) continue;
    if (installed.has(modId)) continue;
    if (pending.has(modId)) continue;

    pending.set(modId, {
      state: 'pending',
      modId,
      taskId: null,
      status: 'library',
      name: (it && it.name) || '',
      fileName: (it && it.filename) || '',
      fileId: 0,
      // 渲染层据此改走 `library:install`（安装包在管理器里，不用再下一次）
      fromLibrary: true,
      archivePath: (it && it.archivePath) || ''
    });
  }

  return { installed, pending };
}

/** 查单个 modId 的本地状态（找不到返回 null） */
function localFor(modId, index) {
  const id = Number(modId);
  if (!id || !index) return null;
  return (index.installed && index.installed.get(id)) ||
    (index.pending && index.pending.get(id)) || null;
}

/**
 * 给 Nexus 列表条目挂上 `local` 字段。
 * 返回**新对象**，不污染入参（缓存里的原始数据要保持干净）。
 */
function decorateMods(items, index) {
  return (Array.isArray(items) ? items : []).map(m => {
    const local = localFor(m && m.modId, index);
    return local ? { ...m, local } : m;
  });
}

/** modId 数组 → `{ "1252": {...} }`（给「局部刷新某几张卡片」用） */
function stateMap(modIds, index) {
  const out = {};
  for (const raw of Array.isArray(modIds) ? modIds : []) {
    const id = Number(raw);
    if (!id) continue;
    const local = localFor(id, index);
    if (local) out[String(id)] = local;
  }
  return out;
}

module.exports = {
  buildLocalIndex,
  localFor,
  decorateMods,
  stateMap,
  TASK_STATE,
  STATE_RANK,
  STATES,
  STATE_LABEL
};
