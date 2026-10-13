'use strict';
const fs = require('fs');
const path = require('path');

const installer = require('./installer');

/**
 * 「压缩包 → 游戏目录」的安装流程。
 *
 * 从 ipc.js 里抽出来，是因为现在有两条路都要用它：
 *   · 界面上的「导入 / 安装」（install:run）
 *   · 下载队列下载完之后自动安装（downloadEngine）
 * 两条路必须走同一套落点判定与注册表登记，否则「装完显示未登记」这种坑会重演。
 */

/**
 * 计算注册表 id。
 *
 * ⚠️ 必须与 scanner.js 的查找方式对齐，否则装完显示成「未登记」：
 *   · 脚本 mod —— scanner 用 `registry.get('disk:script:' + 目录名)`，所以 id 必须长这样
 *   · pak mod  —— scanner 用 `registry.byTarget(文件路径)` 反查，manifest 里带上路径即可
 */
function registryIdFor(L, plan, manifest, meta = {}) {
  // 显式指定的 id 优先 —— 前置组件（UE4SS）要用 `builtin:ue4ss`，
  // 这样 scanner 的第 1) 步和注册表指向同一个对象，不会在列表里多出一条。
  if (meta.registryId) return String(meta.registryId);

  if (plan.kind === 'script') {
    const base = path.resolve(L.ue4ssModsDir).toLowerCase() + path.sep;
    for (const f of manifest) {
      if (path.resolve(f.path).toLowerCase().startsWith(base)) {
        const seg = path.relative(L.ue4ssModsDir, f.path).split(path.sep)[0];
        if (seg) return 'disk:script:' + seg;
      }
    }
  }
  if (meta.modId) return 'nexus:' + meta.modId + ':' + (meta.fileId || 0);
  return 'local:' + Date.now();
}

/**
 * 预先算出注册表 id（安装**之前**）。
 *
 * 重装时必须先知道「上一次是哪条记录」，才能复用它的备份目录、并跳过
 * 已经备份过的路径（见 installer.install 的说明）。而 `registryIdFor` 里
 * 脚本 mod 那一支依赖 manifest（装完才有），所以这里只处理能提前确定的两种：
 *   · `meta.registryId` —— 显式指定（UE4SS 用 `builtin:ue4ss`）
 *   · `meta.modId`      —— Nexus 来源
 * 其余情况返回 null（退化成旧行为，不会更差）。
 */
function predictRegistryId(meta = {}) {
  if (meta.registryId) return String(meta.registryId);
  if (meta.modId) return 'nexus:' + meta.modId + ':' + (meta.fileId || 0);
  return null;
}

/**
 * 收集「这个 mod 自己已经装进游戏的文件」路径集合。
 *
 * 用途：把它传给 `installer.analyze(..., { ownedPaths })`，让冲突检测**跳过自己**。
 *
 * 为什么需要（实测踩坑，2026-10-13，mod 1595「Modified Neurolink Suit」）：
 * 用户先装了 fileId 7443（v1.0），后来又下了同一个 mod 的 fileId 7444，
 * 两个包文件名完全一样 → 4 个文件全部 `existsSync` 命中 →
 * `conflictCount = 4` → 自动安装被拦下，判成「有 4 个文件会被覆盖，等你确认」。
 * 可它覆盖的是**自己**，不是别人 —— 这就是普通的重装/升级，不该要用户确认。
 *
 * 关联口径与 `predictRegistryId` 一致：**按 `source.modId` 认亲**，不看 fileId。
 * 同一个 Nexus mod 的不同文件（不同版本、可选包）互相覆盖都属于「自己人」。
 *
 * @param {object} registry
 * @param {object} meta 至少含 modId
 * @returns {string[]} 绝对路径（原始大小写，比较时再统一小写）
 */
function ownedPathsFor(registry, meta = {}) {
  const modId = meta.modId == null ? null : Number(meta.modId);
  if (!modId || !registry || typeof registry.all !== 'function') return [];
  const out = [];
  let all = [];
  try { all = registry.all() || []; } catch { return []; }
  for (const m of all) {
    const src = m && m.source;
    if (!src || Number(src.modId) !== modId) continue;
    for (const f of m.manifest || []) {
      if (f && f.path) out.push(String(f.path));
    }
  }
  return out;
}

/**
 * 把「会被覆盖的文件」讲清楚 —— 界面据此列出清单，而不是只说一句「有 3 个文件会被覆盖」。
 *
 * 用户原话（2026-10-13）：
 * > 这种需要覆盖的情况要把被覆盖的文件列出来，点击后能在资源管理器里面显示出来；
 * > 要列出被替换的 mod 文件属于哪个 mod，是否为同一个 mod。
 *
 * 所以每条要能回答四个问题：
 *   1. **是哪个文件**（相对游戏根的路径 + 文件名）
 *   2. **现在多大、装进去多大** —— 大小一样基本就是同一个文件（软冲突）
 *   3. **原来是谁装的**（查注册表；查不到 = 游戏原文件 / 手动装的）——
 *      同一路径可能被**多个** mod 登记，所以是 `owners` 数组而不是单个 `owner`
 *   4. **是不是同一个 mod** —— 只有当登记者**全是自己**时 `isSelf` 才为 true
 *      （有任何一个别人登记着，覆盖下去照样破坏别人）
 *
 * @param {object} registry
 * @param {string} root            游戏根（用于算相对路径）
 * @param {object} plan            `installer.analyze()` 的结果
 * @param {object} meta            `{ modId, name, ... }`
 * @param {number} [limit]         最多返回多少条（防极端情况把 payload 撑爆）
 * @returns {{total:number, shown:number, sameSizeCount:number, items:Array}}
 *   `items[]` 每条含：`{path, rel, name, exists, currentSize, incomingSize, sameSize,
 *                       owner, owners, isSelf, hasOther}`
 */
function explainConflicts(registry, root, plan, meta = {}, limit = 60) {
  const empty = { total: 0, shown: 0, sameSizeCount: 0, items: [] };
  if (!plan || !plan.ok) return empty;

  const mine = meta.modId == null ? null : Number(meta.modId);
  const soft = new Set((plan.softOverwritePaths || []).map(p => String(p).toLowerCase()));

  // 归档里那份文件有多大 —— 用来和游戏里现有的比
  const incoming = new Map();
  for (const m of plan.mapping || []) {
    if (m && m.to) incoming.set(String(m.to).toLowerCase(), Number(m.size) || 0);
  }

  const paths = [...(plan.conflicts || []), ...(plan.softOverwritePaths || [])];
  const items = [];
  for (const p of paths) {
    const abs = String(p);
    const key = abs.toLowerCase();

    let curSize = null;
    try { curSize = fs.statSync(abs).size; } catch { curSize = null; }   // 刚被删/读不到
    const inSize = incoming.has(key) ? incoming.get(key) : null;

    let rel = abs;
    try {
      const r = path.relative(root, abs);
      if (r && !r.startsWith('..')) rel = r.split(path.sep).join('/');
    } catch { /* 用绝对路径 */ }

    // 登记该路径的**全部** mod —— 不是只取第一个。
    // 实测（2026-10-13）：`minervha_master_P.pak/ucas/utoc` 被 4 个 mod 同时登记，
    // 只报一个会误导用户。registry 可能是旧对象（没有 byTargetAll）或 null，都要兜住。
    let owners = [];
    try {
      const list = registry && typeof registry.byTargetAll === 'function'
        ? registry.byTargetAll(abs)
        : (registry && typeof registry.byTarget === 'function'
          ? [registry.byTarget(abs)].filter(Boolean)
          : []);
      owners = (list || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        modId: m.source ? (m.source.modId == null ? null : Number(m.source.modId)) : null,
        version: (m.source && m.source.version) || null,
        // 对比用：作者 + 封面。用户要求「并列显示对应的已安装模组的信息，尤其是图片」——
        // 没有这两个字段，渲染层就只能报一个名字，做不出左右对比。
        // ⚠️ 只放封面 URL，**不把整个 images 数组塞进 downloads.json**：
        //    那个数组带本地路径、会随缓存变化，会把队列文件撑爆且立刻过期。
        //    真正的图集由渲染层按需调 `mod:images` 拉（本地有缓存就是瞬时的）。
        author: (m.source && m.source.author) || null,
        pictureUrl: m.image || (m.source && m.source.pictureUrl) || null,
        isSelf: mine != null && m.source != null && Number(m.source.modId) === mine
      }));
    } catch { owners = []; }

    // 「是不是同一个 mod」只有在**登记者全是自己**时才成立 ——
    // 同一路径既有自己又有别人时，覆盖下去照样会破坏别人。
    const others = owners.filter(o => !o.isSelf);
    const isSelf = owners.length > 0 && others.length === 0;

    items.push({
      path: abs,
      rel,
      // 用 path.basename（而不是 rel 的尾段）：路径落在游戏根之外时 rel 是绝对路径，
      // 那时 `rel.split('/').pop()` 会把整条路径当文件名。
      name: path.basename(abs),
      exists: curSize != null,
      currentSize: curSize,
      incomingSize: inSize,
      // 同名同大小 ≈ 同一个文件（installer 就是按这条把它归成「软冲突」的）
      sameSize: soft.has(key),
      owner: owners[0] || null,   // 兼容旧调用方：第一个登记者
      owners,                     // 全部登记者（可能 0 条 / 1 条 / 多条）
      isSelf,
      hasOther: others.length > 0
    });
  }

  // 排序：**最该看清楚**的排前面 ——
  //   ① 不是 mod 装的（游戏原文件被覆盖，出问题最难查）
  //   ② 别的 mod 装的（会破坏别人）
  //   ③ 同一个 mod 自己上次装的（就是升级/重装，最不用担心）→ 放最后
  items.sort((a, b) => {
    const rank = (x) => (x.isSelf ? 2 : x.owners.length ? 1 : 0);
    return rank(a) - rank(b) || String(a.rel).localeCompare(String(b.rel), 'en');
  });

  return {
    total: items.length,
    shown: Math.min(items.length, limit),
    sameSizeCount: items.filter(x => x.sameSize).length,
    items: items.slice(0, limit)
  };
}

/**
 * 安装一个压缩包。
 *
 * 会**重新分析一遍**结构（不信任调用方传来的计划），再解压复制并登记注册表。
 *
 * @param {object} p
 * @param {string} p.root            游戏根目录
 * @param {string} p.archivePath     压缩包路径
 * @param {object} [p.meta]          来源信息（name / modId / fileId / version / author / pictureUrl / url）
 * @param {string} [p.manualTarget]  结构识别失败时人工指定的落点
 * @param {string} [p.pickDir]       结构识别失败时人工选定的**归档内**目录（多选一变体包）
 * @param {'overwrite'|'skip'} [p.onConflict]
 * @param {Function} [p.onProgress]
 * @param {Function} [p.onPlan]      结构分析完成后的回调（用于日志 / 界面提示）
 * @param {object} p.registry
 * @param {object} p.layout          game.layout(root) 的结果
 * @returns {Promise<object>}        安装结果（含 id / written / target / manifest / plan）
 */
async function runInstall({
  root, archivePath, meta = {}, manualTarget = null, pickDir = '', pickDirs = null,
  onConflict = 'overwrite', onProgress, onPlan, registry, layout
}) {
  if (!root) throw new Error('尚未配置有效的游戏目录，请先到「设置」里指定');
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error('安装包不存在：' + archivePath);

  // ⚠️ 这里会**重新分析**（不信任调用方传来的计划），所以人工指定的信息
  //    必须一并透传 —— 漏传 `pickDir` 会让变体包在下载链路里分析成功、
  //    到这一步又失败（报「无法识别这个压缩包的结构」，实测踩过）。
  // 🔴 `pickDirs`（**复数**）也必须透传（2026-10-13 实测 mod 2595 / 1378 / 437）：
  //    「选哪几套」界面提交的是数组。只传 `pickDir` 时，installPhase 的分析能过
  //    （它拿到了 pickDirs），runInstall 这一次过不了 → 任务直接掉到 failed，
  //    用户看到的是「安装失败：无法识别这个压缩包的结构」—— 明明已经选过了。
  //
  // ⚠️ `ownedPaths` 也要透传，否则「升级自己」会被当成「覆盖别人」而中断
  //    （见 ownedPathsFor 的注释）。注意它必须在 analyze **之前**算出来，
  //    所以 `prev` 的解析被提到了前面。
  const prevId = predictRegistryId(meta);
  const prev = prevId ? registry.get(prevId) : null;
  const ownedPaths = ownedPathsFor(registry, meta);

  const plan = await installer.analyze(root, archivePath, meta, { manualTarget, pickDir, pickDirs, ownedPaths });
  if (!plan.ok) {
    // 🔴 报错要说**人话**（2026-10-13 实测）。
    //    多选一变体包走到 `!plan.ok` 有两种截然不同的情况，老代码一律报
    //    「无法识别这个压缩包的结构，请指定安装目录」——
    //    用户刚在界面上选完一套，看到这句只会以为是程序坏了
    //    （实测 mod 2595 / 1378 / 437 三个包全这样）。
    //
    //    ① `reason` 里带「互相覆盖」= **用户选多了**（两套配重名 pak）。
    //       该直接把冲突原因告诉他（"请少选一套"），别再绕回「去选一套」。
    //    ② 其它 = **还没选**（`plan.options` 里有候选目录）。
    //       该告诉他有几套、让他去「去处理」挑。
    const detail = plan.diagnosis || plan.reason;
    const pickedTooMany = /互相覆盖|少选一套/.test(String(detail || ''));
    if (!pickedTooMany && Array.isArray(plan.options) && plan.options.length) {
      const names = plan.options.map(o => o.label || o.dir || '').filter(Boolean).slice(0, 3).join('、');
      throw new Error(`这个压缩包里有 ${plan.options.length} 套内容（${names}${plan.options.length > 3 ? ' 等' : ''}），`
        + '需要先选要装哪些 —— 请在「下载管理」里点「去处理」重新选择');
    }
    throw new Error(detail || '无法识别这个压缩包的结构，请指定安装目录');
  }
  if (typeof onPlan === 'function') { try { onPlan(plan); } catch { /* 忽略 */ } }

  // ---- 重装支持：复用上一次的备份目录 + 跳过已备份过的路径 ----
  //
  // 不这么做的话，第二次安装会把「自己上次装进去的文件」也当成游戏原文件备份一遍，
  // 卸载时又把它们还原回来 —— 卸载等于没卸，备份目录还会持续泄漏。
  const skipBackupPaths = new Set();
  let reuseBackupDir = null;
  if (prev) {
    // ① 上次**我们自己装进去**的文件 —— 它们不是游戏原文件，再备份一遍毫无意义，
    //    而且卸载时会把自己刚移走的文件又还原回来（卸载等于没卸）。
    for (const f of prev.manifest || []) {
      if (f && f.path) skipBackupPaths.add(String(f.path).toLowerCase());
    }
    // ② 已经有原始备份的路径 —— 同一份原文件不需要备份两次。
    for (const o of prev.overwritten || []) {
      if (o && o.path) skipBackupPaths.add(String(o.path).toLowerCase());
    }
    // 只在备份目录还在磁盘上时才复用，否则会指向一个已经不存在的位置
    if (prev.backupDir && fs.existsSync(prev.backupDir)) reuseBackupDir = prev.backupDir;
  }

  const r = await installer.install(root, plan, {
    onConflict, onProgress,
    backupDir: reuseBackupDir,
    skipBackupPaths
  });

  const id = registryIdFor(layout, plan, r.manifest, meta);

  // 备份清单做**并集**：上一次留下的「游戏原文件」备份不能丢（卸载时还要用），
  // 这一次新备份的补进来。因为已经跳过重复路径，直接拼接不会有重复项。
  const mergedOverwritten = [...(prev && prev.overwritten ? prev.overwritten : []), ...(r.backed || [])];

  registry.upsert({
    id,
    name: meta.name || path.basename(plan.archivePath, path.extname(plan.archivePath)),
    kind: plan.kind,
    enabled: true,
    source: {
      url: meta.url || null,
      modId: meta.modId || null,
      fileId: meta.fileId || null,
      author: meta.author || null,
      version: meta.version || null,
      pictureUrl: meta.pictureUrl || null
    },
    installedAt: new Date().toISOString(),
    target: plan.target,
    archivePath: plan.archivePath,
    manifest: r.manifest,
    // 覆盖前备份的原件（CNS 这类合并型框架会盖掉游戏自己的文件）
    backupDir: r.backupDir || null,
    overwritten: mergedOverwritten,
    fileCount: r.manifest.length,
    size: r.manifest.reduce((s, f) => s + (f.size || 0), 0),
    // 来源下载任务（便于「已安装」页回连下载记录）
    taskId: meta.taskId || null,
    // 依赖标记：装的是 CNS 服装 Mod（界面据此提示「需要 CNS」）
    requiresCns: !!plan.requiresCns,
    // 这个包本身是前置组件（UE4SS）—— 供 scanner 归类
    prereqKey: plan.prereqKey || null
  });

  return {
    id,
    written: r.written,
    skipped: r.skipped,
    target: plan.target,
    targetLabel: plan.targetLabel,
    kind: plan.kind,
    kindLabel: plan.kindLabel,
    reason: plan.reason,
    manifest: r.manifest,
    backupDir: r.backupDir || null,
    backedCount: (r.backed || []).length,
    overwrittenCount: mergedOverwritten.length,
    backupFailed: r.backupFailed || 0,
    requiresCns: !!plan.requiresCns,
    requiresCnsReason: plan.requiresCnsReason || null,
    prereqKey: plan.prereqKey || null,
    reinstalled: !!prev,
    plan
  };
}

module.exports = { registryIdFor, predictRegistryId, ownedPathsFor, explainConflicts, runInstall };
