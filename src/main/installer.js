'use strict';
const fs = require('fs');
const path = require('path');

const archive = require('./archive');
const game = require('./game');
const paths = require('./paths');

/**
 * Mod 安装器：识别压缩包结构 → 算出落点 → 解压复制 → 返回清单。
 *
 * 本模块**不碰注册表**，只做文件层面的工作，返回结果由 ipc.js 决定是否登记。
 *
 * 落点规则见 skill 的 `references/architecture.md` 第四章「剑星 modding 分层」。
 * 核心思路：先把压缩包里的「公共顶层目录」剥掉（很多包会套一层 `ModName/`），
 * 再按剥掉后的首段目录判断结构。
 */

const PAK_EXT = /\.(pak|ucas|utoc)$/i;
const LUA_EXT = /\.lua$/i;
/**
 * CNS 专有数据文件的文件名特征。
 *
 * ⚠️ 只能按**文件名含 `.dekcns` / `.dekani`** 判断，不能只看扩展名：
 * 实测这类文件叫 `bcasecoolingsuit.dekcns.json`（真实扩展名是 `.json`），
 * 另一些则是裸的 `xxx.dekcns`。两种都要认。
 */
const CNS_DATA_NAME = /\.(dekcns|dekani)\b[^/]*$/i;

/**
 * 作者的**工程源文件** —— 这些是「做 mod 用的原料」，不是能装进游戏的东西。
 *
 * 实测踩坑（2026-10-13，mod 2182「Nude Eve Collection …」的某个可选文件）：
 * 归档里只有 6 个 `.blend`（Blender 工程），一个 pak 都没有。
 * 老规则判不出来 → 界面报「结构无法识别，需要手动指定安装位置」，
 * 于是用户真的去找目录、手动指定 —— 而**装到哪儿都不会生效**。
 *
 * ⚠️ 只在「整包**全是**源文件」时才算命中，所以误判风险极低。
 */
const SOURCE_EXT = /\.(blend\d*|psd|psb|fbx|obj|dae|ztl|zpr|spp|sbsar|xcf|kra|clip|max|ma|mb)$/i;

/** 归档里明确与安装无关的东西（任何层级都要剔除） */
const JUNK = /(^|\/)__macosx(\/|$)|(^|\/)\.ds_store$|(^|\/)thumbs\.db$/i;

/**
 * 「根级文档文件」：没有目录层级、且扩展名是文档/图片。
 * 这类文件几乎必然是 readme / 预览图，不该被复制进游戏目录。
 *
 * ⚠️ 只在**归档根层**生效 —— mod 内部（带目录）的同名文件一律保留，
 *    因为脚本 mod 常常自带图标与配置文件。
 */
const ROOT_DOC = /\.(txt|md|nfo|pdf|doc|docx|rtf|jpg|jpeg|png|gif|bmp|webp|url|lnk|html?)$/i;

/**
 * Mod 管理器的记账文件（Vortex / MO2 / 打包工具生成）。
 *
 * 实测踩坑（2026-10-13，mod 123「Sexy Harness - NSFW (CNS compatible)」）：
 * 包里除了 pak 三件套还有 `modinfo.ini`（221 字节，Vortex 用来记 modId/版本）。
 * 兜底规则把「根级 pak 之外的东西」一律原样带进 ~Mods，于是这个 ini 也被装进去了。
 * 它跟游戏无关，纯属垃圾。
 *
 * ⚠️ 与 ROOT_DOC 同口径：只在**基准根层**忽略。mod 内部（带目录）的同名文件不动 ——
 *    脚本 mod 常自带 `info.json` 之类的配置，误删会让 mod 失效。
 */
const MOD_META = /^(modinfo\.ini|info\.json|meta\.ini|fomod\.info\.xml)$/i;

const KIND_LABEL = {
  pak: 'Pak 模组',
  script: '脚本模组',
  cns: '框架 / 合并包',
  // UE4SS 蓝图模组（Logic Mod）—— 与普通 pak 的差别不在文件本身（都是 .pak 三件套），
  // 而在**落点**是 `Paks\LogicMods\` 而非 `Paks\~Mods\`。
  //
  // ⚠️ 单独给一个 kind 而不是复用 'pak'：`ipc.js` 的启用/禁用与卸载里
  //    `mod.kind === 'pak'` 分支**硬编码只认 `L.modsDir`（~Mods）**，
  //    复用 'pak' 会让这些操作在错误的目录里找文件 → 全部静默失败。
  //    走独立 kind 则落到「按 manifest 精确回滚」的兜底分支，反而是对的。
  logicmod: '逻辑模组（Logic Mod）',
  prereq: '前置组件（加载器）',
  files: '普通文件',
  unknown: '无法识别'
};

/* ---------------- 工具 ---------------- */

/** 文件系统安全的名字 */
function safeName(s, fallback = 'Mod') {
  const t = String(s == null ? '' : s)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 80);
  return t || fallback;
}

/**
 * 找出所有**文件**条目共享的顶层目录（无顶层散落文件时才剥），没有则返回 null。
 *
 * ⚠️ 必须忽略目录条目：归档里通常同时存在 `MyCoolMod`（目录项）和
 *    `MyCoolMod/xxx_P.pak`（文件项）。若把目录项也当文件统计，它会因为没有 `/`
 *    被误判成「顶层散落文件」，导致公共前缀永远剥不掉。
 */
function commonPrefix(entries) {
  const dirs = new Set();
  let rootFiles = 0;
  for (const e of entries) {
    if (e.dir) continue;                     // 目录条目直接跳过
    const i = e.path.indexOf('/');
    if (i < 0) rootFiles++;
    else dirs.add(e.path.slice(0, i));
  }
  // 只有「全都在同一个目录下、且顶层没有散落文件」才安全地剥掉
  if (dirs.size === 1 && rootFiles === 0) return [...dirs][0];
  return null;
}

function stripPrefix(p, prefix) {
  if (!prefix) return p;
  return p.slice(prefix.length).replace(/^\/+/, '');
}

/* ---------------- 结构分析 ---------------- */

/**
 * 分析压缩包，返回安装计划。
 * @param {string} root 游戏根目录
 * @param {string} archivePath 压缩包路径
 * @param {object} meta { name, version, modId, fileId, ... }
 * @param {{
 *   manualTarget?: string,
 *   pickDir?: string,
 *   pickDirs?: string[],
 *   ownedPaths?: Iterable<string>
 * }} opts
 *   · `manualTarget` —— 结构无法识别时手动指定的落点
 *   · `pickDir`      —— 多选一变体包里用户选中的**归档内**目录（单个，旧接口）
 *   · `pickDirs`     —— 同上，但可传多个：互不覆盖的几套可以一起装
 *                        （选中多套时按各自目录前缀剥掉后合并识别）
 *   · `ownedPaths`   —— 本 mod 自己已经装进游戏的绝对路径。
 *                       命中的文件**不算冲突**（那是重装/升级覆盖自己，不是撞别人）
 */
async function analyze(root, archivePath, meta = {}, opts = {}) {
  const L = game.layout(root);
  const { entries, skipped, tool } = await archive.listEntries(archivePath);

  const allFiles = entries.filter(e => !e.dir);
  if (!allFiles.length) throw new Error('压缩包里没有文件（只有目录）');

  // ⚠️ 这里**不做任何前缀剥离**：rel 必须保持归档内的原始路径。
  //    原因有两个 ——
  //      1. 结构识别需要看到 Content\/Binaries\/~Mods 这些原始信号
  //      2. install() 要按 `from` 去解压目录里找文件，路径必须与归档一致
  //    所有剥离统一放到最后生成 mapping 时做（totalStrip）。
  const rel = allFiles.map(e => ({ path: e.path, size: e.size }));

  const warnings = [];

  // ---- 阶段 A：剔除与安装无关的文件（归档原始路径上判断） ----
  //
  // `isDoc(p)` 判断的是「相对某个基准的路径」：
  //   · JUNK  —— __MACOSX / .DS_Store / Thumbs.db，任何层级都算垃圾
  //   · ROOT_DOC / MOD_META —— 没有 `/` 的文档/图片/管理器记账文件，
  //     即「基准根目录下的旁路文件」
  // 阶段 A 的基准是归档根；剥掉包装层后还要以包装层为基准再判一次（阶段 B），
  // 否则 `MyMod/README.md` 这种会漏网，把「全是 pak」的识别破坏掉。
  const isDoc = (p) => JUNK.test(p) ||
    (!p.includes('/') && (ROOT_DOC.test(p) || MOD_META.test(p)));

  const excludedA = new Set();
  const droppedDocsA = [];
  for (const f of rel) {
    if (isDoc(f.path)) { excludedA.add(f.path); droppedDocsA.push(f); }
  }
  const meaningful = rel.filter(f => !excludedA.has(f.path));
  if (!meaningful.length) throw new Error('压缩包里没有可安装的文件（只剩说明文档）');

  const pkgName = safeName(meta.name || path.basename(archivePath).replace(/\.[^.]+$/, ''), 'Mod');

  // ============================================================
  // 结构识别
  //
  // 关键顺序问题：**必须先按原始路径匹配结构规则，再考虑剥包装层。**
  //   `Content/Paks/~Mods/x.pak` 的公共前缀是 `Content`，
  //   如果一上来就把它剥掉，`Content` 这个结构信号就丢了，
  //   会被误判成「~Mods 里有个叫 Content 的子目录」。
  //
  // 所以分两轮：
  //   第一轮 —— 结构规则（SB / Content|Binaries / ~Mods / ue4ss / Scripts）跑在原始路径上
  //   第二轮 —— 剥掉「非结构性」的包装目录（如 ModName\）后，再跑一遍结构规则，
  //             然后是内容规则（全是 pak / 含 lua）
  // ============================================================

  /** 这些顶层目录名是游戏结构的一部分，绝不能被当成包装层剥掉 */
  const STRUCTURAL = new Set([
    'sb', 'content', 'binaries', 'paks', '~mods',
    // ⚠️ `logicmods` 必须在这里。它是 UE4SS 蓝图模组（Logic Mod）的落点，
    //    与 `~mods` 是**两套互不相通的加载机制**。少了它，`LogicMods\` 这一层
    //    会被当成「用户的包装目录」剥掉，于是 ATOOL / 其它 Logic Mod 被塞进
    //    `~Mods\` —— 文件静静躺着，游戏一个字都不加载（实测见 §6）。
    'logicmods',
    'ue4ss', 'scripts', 'engine', 'plugins'
  ]);

  /** 在给定文件集上尝试「结构规则」；命中返回 plan（strip 相对于该文件集），否则 null */
  function structuralRules(L, files) {
    const inDir = files.filter(f => f.path.includes('/'));
    const segs = new Set(inDir.map(f => f.path.split('/')[0]));
    const has = (n) => segs.has(n);
    const onlyDirs = (...names) => inDir.length > 0 && [...segs].every(s => names.includes(s));
    const hasRoot = (n) => files.some(f => f.path.toLowerCase() === n);

    // ⚠️ 这条必须排在下面通用的 `ue4ss\` 规则**之前**。
    //
    // UE4SS 本体的包结构是「根级 dwmapi.dll + ue4ss\ 目录」，
    // 直接落到 SB\Binaries\Win64\ 才是对的：
    //     dwmapi.dll        → SB\Binaries\Win64\dwmapi.dll
    //     ue4ss\...         → SB\Binaries\Win64\ue4ss\...
    // 如果被通用规则先接走（它会把 `ue4ss` 这一层剥掉，落到 Win64\ue4ss\），
    // dwmapi.dll 会被塞进 Win64\ue4ss\dwmapi.dll —— 加载器直接失效。
    if (has('ue4ss') && (hasRoot('dwmapi.dll') || hasRoot('ue4ss.dll') || hasRoot('ue4ss-settings.ini'))) {
      return {
        kind: 'prereq', target: L.win64, strip: null, prereqKey: 'ue4ss',
        reason: 'UE4SS 本体（根级 dwmapi.dll + ue4ss\\）→ 原样落到 SB\\Binaries\\Win64\\'
      };
    }

    if (segs.size === 1 && has('SB')) {
      // 自带 SB\ 前缀：原样落到游戏根，不剥层
      return { kind: 'cns', target: L.root, strip: null, reason: '包含 SB\\ 目录，按游戏根目录结构原样落盘' };
    }

    // ---- (a) 归档里自带 `LogicMods\` 层 —— 最强信号，直接锚定 ----
    //
    // UE4SS 蓝图模组（Logic Mod）的落点是 `SB\Content\Paks\LogicMods\`，
    // 与 `~Mods\` 是**两套互不相通的加载机制**：放错地方游戏一个字都不加载。
    //
    // 命中：所有带目录的文件路径里都出现名为 `logicmods` 的段（大小写不敏感）。
    // 落点：`Paks\LogicMods\`；剥掉「到 LogicMods 为止」的前缀，**保留内层结构**。
    //      内层往往是与 pak 配对的伴随资源目录（ATOOL 的 `HD-ATOOL_P\audio\*.wav`
    //      就在那儿），剥掉会散架。
    //
    // 例：LogicMods/HD-ATOOL_P.pak        → Paks\LogicMods\HD-ATOOL_P.pak
    //     LogicMods/HD-ATOOL_P/audio/x.wav → Paks\LogicMods\HD-ATOOL_P\audio\x.wav
    //
    // ⚠️ 要求**全部**带目录的文件都含该段（不是「任一」）。若只在个别路径上出现
    //    （例如 `Content\Paks\~Mods\x.pak` 旁边还混着 `LogicMods\y.pak`），
    //    那是结构混合包，交给下面的通用规则更安全。
    // ⚠️ 还要求这些文件共享**同一个**「到 LogicMods 为止」的前缀，否则一条 `strip`
    //    表达不了（多前缀的情形极少，宁可退回通用规则）。
    //
    // 注：`SB\Content\Paks\LogicMods\...` 这种带 SB 前缀的形态已被上面的 SB 规则接走，
    //    两者落点一致，这里不重复处理。
    if (inDir.length) {
      const isLogicSeg = (s) => s.toLowerCase() === 'logicmods';
      const prefixes = inDir.map(f => {
        const segsOf = f.path.split('/');
        const i = segsOf.findIndex(isLogicSeg);
        return i < 0 ? null : segsOf.slice(0, i + 1).join('/');
      });
      if (prefixes.every(p => p !== null) && new Set(prefixes).size === 1) {
        return {
          kind: 'logicmod', target: L.logicModsDir, strip: prefixes[0],
          reason: '包含 LogicMods\\ 目录，按 UE4SS 逻辑模组落盘到 SB\\Content\\Paks\\LogicMods\\'
        };
      }
    }

    if (onlyDirs('Content', 'Binaries')) {
      const hasContent = has('Content');
      const hasBinaries = has('Binaries');
      return {
        kind: hasContent && hasBinaries ? 'cns' : (hasContent ? 'pak' : 'script'),
        target: L.sb, strip: null,
        reason: hasContent && hasBinaries
          ? '同时包含 Content\\ 与 Binaries\\，按框架包合并到 SB\\'
          : (hasContent ? '包含 Content\\，按 Paks 结构落盘' : '包含 Binaries\\，按脚本结构落盘')
      };
    }
    if (segs.size === 1 && has('~Mods')) {
      // 剥掉 ~Mods 包装层后，落点正是 ~Mods 本身
      return { kind: 'pak', target: L.modsDir, strip: '~Mods', reason: '包含 ~Mods\\ 目录' };
    }
    if (segs.size === 1 && has('ue4ss')) {
      // 同理：剥掉 ue4ss 包装层后，落点正是 Win64\ue4ss
      return { kind: 'script', target: L.ue4ssDir, strip: 'ue4ss', reason: '包含 ue4ss\\ 目录' };
    }
    if (segs.size === 1 && has('Scripts')) {
      return {
        kind: 'script',
        target: path.join(L.ue4ssModsDir, pkgName),
        strip: 'Scripts',
        reason: '包含 Scripts\\ 目录，按 UE4SS 脚本模组落盘到 ue4ss\\Mods\\' + pkgName
      };
    }

    // ---- (b) 没有 LogicMods 层，但包本身就是 Logic Mod（具名特征） ----
    //
    // ATOOL 本体（mod 1662）的官方安装说明是「把主文件压缩包里的**文件夹**放进
    // `Paks\LogicMods`」，所以归档里**没有** `LogicMods\` 这一层 —— (a) 抓不到。
    // 实测的两种形态（见 `docs/ATOOL-调研与支持方案.md` §5.2）：
    //     V2 平铺      HD-ATOOL_P.pak
    //     V3 单文件夹  HD-ATOOL_P\HD-ATOOL_P.pak
    // 两者都得落 `Paks\LogicMods\`，否则进 `~Mods\` 就是白装。
    //
    // 判据：任一目录段的 basename，或任一文件的 stem（去扩展名），等于 `HD-ATOOL_P`。
    //  · V2  `HD-ATOOL_P.pak`             → stem 命中
    //  · V3  `HD-ATOOL_P/HD-ATOOL_P.pak`  → stem 与目录段都命中
    //        `HD-ATOOL_P/audio/1.wav`     → 目录段命中（伴生音频跟着一起走）
    //
    // ⚠️ **刻意不用 `/^HD-ATOOL/i` 这种宽松前缀**：ATOOL 的动画包里有
    //    `HD-ATOOL-animtest`（mod 7703）这类**应当落 `~Mods`** 的包，宽松匹配会把
    //    它们误塞进 LogicMods。要求精确等于 `HD-ATOOL_P` 才两者都能分开。
    // ⚠️ 也**刻意没有**实现「pak 基名 == 同级目录名」这条通用伴随目录判据：
    //    普通 mod 常见 `MySuit\MySuit_P.pak` 这种单文件夹包装（它该落 `~Mods` 根级），
    //    单靠名字相等无法与 Logic Mod 的伴随目录区分 → 会**新增**一批误装。
    //    等 P1 有了 `atoolStatus()` / LogicMods 扫描做交叉印证再收紧实现。
    //
    // ⚠️ 顺序：这条在 `structuralRules` 内，天然早于 `contentRules` 的
    //    「全是 pak → ~Mods」；否则 V2/V3 又会被塞进 ~Mods。
    const isAtoolCore = (s) => /^hd-atool_p$/i.test(s);
    const atoolNamed = files.some(f => {
      const parts = f.path.split('/');
      const base = parts[parts.length - 1];
      if (isAtoolCore(base.replace(/\.[^.]+$/, ''))) return true;
      return parts.slice(0, -1).some(isAtoolCore);
    });
    if (atoolNamed) {
      return {
        kind: 'logicmod', target: L.logicModsDir, strip: null,
        reason: '命中 ATOOL 本体（HD-ATOOL_P）特征，落盘到 SB\\Content\\Paks\\LogicMods\\'
      };
    }
    return null;
  }

  /** 内容规则（在剥完包装层之后判断） */
  function contentRules(L, files) {
    // 🔴 「pak 系 + CNS 数据文件」混合包，必须放在 `all pak` 之前想清楚。
    //
    // 实测踩坑（2026-10-12，mod 533「Cake Unveiled - Cooling Suit」）：
    // 包内 4 个文件**全在根级**、没有任何包装目录：
    //     CakeUnveiledAliceCNS_P.pak
    //     CakeUnveiledAliceCNS_P.ucas
    //     CakeUnveiledAliceCNS_P.utoc
    //     bcasecoolingsuit.dekcns.json   ← CNS 的外观数据
    // 老规则第一句要求 `files.every(f => PAK_EXT)` —— 混进那个 .json 就直接不成立，
    // 于是整轮落空，最终报「包里也没找到 .pak 文件」（其实有 3 个）。
    // 处理办法：pak 全在根级、且非 pak 的**全部**是 CNS 数据文件 → 一起原样进 ~Mods。
    const paks = files.filter(f => PAK_EXT.test(f.path));
    const side = files.filter(f => !PAK_EXT.test(f.path));
    const sameLevel = files.every(f => !f.path.includes('/'));

    // 🔴 **纯 CNS 数据包**：只有 `.dekcns` / `.dekani` 数据文件，一个 pak 都没有。
    //
    // 实测踩坑（2026-10-13，mod 1647「CNS - Female NPC Faces」）：
    // 归档里只有一个 `female_npc_faces.dekcns.json`（1725 字节）。
    // 下面两条规则都要求「有 pak」→ 全部落空 → 报「结构无法识别」，
    // 而界面还提示「包里没有 .pak 文件」，用户完全不知道该干什么。
    //
    // 依据：CNS 的数据文件本来就住在 `~Mods` **根级**，和 pak 并排 ——
    // 实测游戏目录里就是 `~Mods\bcasecoolingsuit.dekcns.json`、
    // `~Mods\CNS-Ultimate-1690.dekcns.json`。这类包的作用是**改写已装 CNS 服装的
    // 外观定义**（换脸、换配色），落点必须和 pak 一致，否则游戏读不到。
    if (files.length && sameLevel && files.every(f => CNS_DATA_NAME.test(f.path))) {
      return {
        kind: 'cns', target: L.modsDir, strip: null,
        reason: 'CNS 外观数据文件（.dekcns / .dekani），放进 ~Mods'
      };
    }

    if (paks.length && side.length && sameLevel && side.every(f => CNS_DATA_NAME.test(f.path))) {
      return {
        kind: 'cns', target: L.modsDir, strip: null,
        reason: 'CNS 服装数据（pak + .dekcns / .dekani）全部原样放进 ~Mods'
      };
    }

    if (files.every(f => PAK_EXT.test(f.path))) {
      // ⚠️ 必须**文件全在同一层**才算「直接放进 ~Mods」。
      //
      //    `strip` 为 null 时 mapping 保留归档内相对路径，于是
      //    `Solo Variant/x.pak` 会落到 `~Mods\Solo Variant\x.pak` ——
      //    而游戏**只加载 ~Mods 根级**的 pak，等于白装（实测踩过）。
      //
      //    带子目录的多目录包（同一件衣服的多套变体各占一个子目录）
      //    落到下面的 `pickOptions`，让用户挑一套。
      if (files.every(f => !f.path.includes('/'))) {
        return {
          kind: 'pak', target: L.modsDir, strip: null,
          reason: '全部是 .pak / .ucas / .utoc，直接放进 ~Mods'
        };
      }
    }
    if (files.some(f => LUA_EXT.test(f.path))) {
      return {
        kind: 'script',
        target: path.join(L.ue4ssModsDir, pkgName),
        strip: null,
        reason: '包含 Lua 脚本，按 UE4SS 脚本模组落盘到 ue4ss\\Mods\\' + pkgName
      };
    }

    // 🔴 兜底：pak 系文件**全在根级**（子目录里一个 pak 都没有），其余是什么都无所谓
    //    —— 整包原样放进 ~Mods。
    //
    //    为什么需要这条（实测 2026-10-13，mod 123「Sexy Harness - NSFW (CNS compatible)」）：
    //    根级有 pak 三件套，但混进了**不是** CNS 数据的旁路文件，于是两条老规则从夹缝里掉下去 ——
    //      · 「CNS 混合包」要求 side **全部**是 .dekcns/.dekani → 不成立
    //      · 「全是 pak」要求一个旁路都没有 → 也不成立
    //    结果报「结构无法识别」，可 `pakCount` 明明 > 0，用户完全不知道该干什么。
    //
    //    依据：游戏**只从 ~Mods 根级**加载 pak（见 architecture.md 第四章），
    //    所以「根级有 pak」本身就是足够强的落点信号；旁边那些文件跟着原样进去不会破坏加载。
    //
    //    ⚠️ 必须排在 lua 规则**之后**：`根级 pak + Scripts\\*.lua` 这种包要先被脚本规则接走，
    //       否则脚本会被当成「旁路文件」一起丢进 ~Mods，UE4SS 就不认它了。
    //    ⚠️ 子目录里有 pak 的包不会命中（那是「多选一变体包」，该让用户挑一套）。
    //    ⚠️ 包里带 `Content\` / `Binaries\` / `~Mods\` 这类**游戏结构目录**时也不命中 ——
    //       那种包的真身是「按游戏目录树展开」，整包丢进 ~Mods 会把目录树一起埋掉。
    const topSegs = new Set(
      files.filter(f => f.path.includes('/')).map(f => f.path.split('/')[0].toLowerCase())
    );
    const hasStructuralDir = [...topSegs].some(s => STRUCTURAL.has(s));
    const paksAtRoot = paks.length > 0 && !hasStructuralDir &&
      paks.every(f => !f.path.includes('/'));
    if (paksAtRoot) {
      return {
        kind: 'pak', target: L.modsDir, strip: null,
        reason: '根级有 .pak 系文件，其余内容一并原样放进 ~Mods'
      };
    }
    return null;
  }

  /**
   * 从 pak 文件名里抠「游戏资产 ID」。
   *
   * 实测两种写法都存在（同一个包里混用，见 mod 437「BP Planet Diving Suit (7th)」）：
   *     `77117-Planet_Diving_Suit (7th)_A_P.pak`     ← 裸数字
   *     `ID77117-Planet_Diving_Suit (7th)_D_P.pak`   ← 带 ID 前缀
   * 两者是**同一个资产**（同一件衣服），所以前缀要当可选的。
   *
   * ⚠️ 两条判据的严格程度不同，是刻意的：
   *   · 带 `ID` 前缀 → 无论几位数字都认（前缀本身就是明确信号，如 `ID111-xxx`）
   *   · 裸数字     → 要 ≥4 位才认（3 位的裸数字太容易是版本号/序号，会误判）
   *
   * 抠不出来返回 ''（文件名里没有资产编号 → 没法据此判断是否互相覆盖）。
   */
  function assetIdOf(base) {
    const m = /^(?:ID(\d+)|(\d{4,}))/i.exec(String(base));
    return m ? 'ID' + (m[1] || m[2]) : '';
  }

  /**
   * 候选目录的「资产 key」：优先用资产 ID，抠不出来就用文件名本身。
   *
   * 用途：判断两套内容会不会互相覆盖 —— key 相同就是同一个资产。
   */
  function assetKeyOf(base) {
    return assetIdOf(base) || 'name:' + String(base).replace(PAK_EXT, '').toLowerCase();
  }

  /**
   * 结构识别不了时，找出「直接含 .pak 的目录」当作可选安装内容。
   *
   * 典型场景是**多选一的变体包**：同一件衣服的若干套配色/版本各自放在一个子目录里，
   * 只能装其中一套（装多套会互相覆盖）。例如：
   *     BP_Nude_Skin Suit (2 variants)\BP_Nude_Skin Suit_A\ID99001-..._P.pak
   *     BP_Nude_Skin Suit (2 variants)\BP_Nude_Skin Suit_B\ID99001-..._P.pak
   * 这里就把 `..._A` / `..._B` 各列成一项让用户挑。
   *
   * 返回 `{dir, label, group, key, files, size}`；`dir` 是归档内的原始目录路径，
   * 之后作为 `analyze(..., { pickDir })` / `analyze(..., { pickDirs })` 的入参。
   * `key` 是资产 ID（`ID77117` 这样），界面拿它提示「这几套是同一件东西的版本」。
   */
  function pickOptions(files) {
    const map = new Map();
    for (const f of files) {
      const i = f.path.lastIndexOf('/');
      if (i < 0) continue;
      const base = f.path.slice(i + 1);
      if (!PAK_EXT.test(base)) continue;
      const dir = f.path.slice(0, i);
      const e = map.get(dir) || {
        dir,
        // 只显示最后一段，太长的话界面上放不下
        label: dir.split('/').pop(),
        group: dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '',
        key: '',
        // 这个目录里**所有** pak 的资产 key（供 exclusiveGroups 判互斥用）。
        // 一个目录可能装好几个 pak（三件套），key 一般相同，但不去假设。
        keys: [],
        files: 0,
        size: 0
      };
      // 同一目录里的 pak 三件套资产 ID 相同，取第一个非空的即可
      if (!e.key) e.key = assetIdOf(base);
      const k = assetKeyOf(base);
      if (!e.keys.includes(k)) e.keys.push(k);
      e.files++;
      e.size += f.size || 0;
      map.set(dir, e);
    }
    return [...map.values()].sort((a, b) => a.dir.localeCompare(b.dir, 'en'));
  }

  /**
   * 把候选目录按「互斥关系」分组 —— 组内只能选一个，组间可以一起装。
   *
   * 判据与「兜底 1」里选完之后的撞车检测**完全一致**（否则会出现
   * 「界面说可以一起装、主进程又报互相覆盖」的自相矛盾）：
   * 两个候选只要含**同一份资产**（资产 ID 相同，或都没 ID 时 pak 文件名相同），
   * 装在一起必然互相覆盖。
   *
   * 实测三种真实形态：
   *   - mod 1430「BP Cooling suit」：A~G 七套配色，key 全是 ID223699 → 1 组 7 个
   *   - mod 1378「Eve Iberis Dress」：没有资产 ID，但两套里的 pak **同名** → 1 组 2 个
   *   - mod 3970「Nv_pu_CNS」：主 mod / 皮肤 / 中文字体，key 各不相同 → 不成组，全都能装
   *
   * 返回的只包含**元素多于一个**的组（单元素不是互斥组，界面不用特别标注）。
   */
  function exclusiveGroups(options) {
    const parent = options.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    const byKey = new Map();
    options.forEach((o, i) => {
      for (const k of (o.keys || [])) {
        if (!k) continue;
        const prev = byKey.get(k);
        if (prev === undefined) byKey.set(k, i);
        else uni(prev, i);
      }
    });

    const groups = new Map();
    options.forEach((o, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(o.dir);
    });
    return [...groups.values()].filter(g => g.length > 1);
  }

  /**
   * 「默认选择」：每个互斥组取**第一套**，不在任何组里的**全部选中**。
   *
   * ⚠️ 口径必须与界面 `openVariantPicker()` 的预选**逐条一致**（组内取 `[0]`）——
   *    两处不一样就会出现「界面看着选好了、实际装的是另一套」。
   *
   * 主进程也要算一遍的原因（2026-10-14 用户要求「不冲突的直接全部安装」）：
   * `exclusiveGroups` 为空的包（那几套互不相关）可以直接按这个集合**全部装掉**，
   * 根本不用弹选择框，用户也不用逐条点确认。
   */
  function defaultPickOf(options, groups) {
    const pick = [];
    const grouped = new Set();
    for (const g of (Array.isArray(groups) ? groups : [])) {
      if (!Array.isArray(g) || !g.length) continue;
      pick.push(g[0]);
      for (const d of g) grouped.add(d);
    }
    for (const o of (Array.isArray(options) ? options : [])) {
      if (o && o.dir && !grouped.has(o.dir)) pick.push(o.dir);
    }
    return pick;
  }

  /**
   * 变体包那组公共字段：候选清单 / 互斥分组 / 默认选择 / **有没有真冲突**。
   *
   * `hasConflicts` 是给上层判断「要不要停下来问用户」用的。
   * 真正的判据是 `exclusiveGroups.length > 0`，但让调用方自己去摸数组长度很容易写错
   * （`[]` 与 `undefined` 的区别在 `openVariantPicker` 那个老 bug 里踩过），这里一次算清楚。
   */
  function variantFields(options) {
    const groups = exclusiveGroups(options);
    return {
      options,
      exclusiveGroups: groups,
      defaultPick: defaultPickOf(options, groups),
      hasConflicts: groups.length > 0
    };
  }

  // ---- 第一轮：原始路径 ----
  let plan = structuralRules(L, meaningful);
  let wrapper = null;             // 被剥掉的包装目录（相对原始路径）
  let stripMap = null;            // 多目录选择时的「原始路径 → 剥掉前缀后的相对路径」映射
  let working = meaningful;       // 供 mapping 用的相对路径基准

  // ---- 第二轮：剥掉非结构性包装目录 ----
  if (!plan) {
    const prefix = commonPrefix(entries);
    if (prefix && !STRUCTURAL.has(prefix.toLowerCase())) {
      // 以「剥掉包装层之后」为基准重新过滤一次：
      // 原本 `MyMod/README.md` 不算根级文档，剥掉 MyMod 后就是根级文档了。
      const excludedB = new Set();
      const stripped = [];
      for (const f of meaningful) {
        if (!f.path.startsWith(prefix + '/')) continue;
        const p = f.path.slice(prefix.length + 1);
        if (isDoc(p)) { excludedB.add(f.path); continue; }
        stripped.push({ ...f, path: p });
      }

      if (stripped.length) {
        const p2 = structuralRules(L, stripped) || contentRules(L, stripped);
        if (p2) {
          plan = p2;
          wrapper = prefix;
          for (const p of excludedB) excludedA.add(p);
        }
      }
    }
  }

  // ---- 第三轮：内容规则（不剥层） ----
  if (!plan) plan = contentRules(L, meaningful);

  /** 被「选中的变体目录」排除掉的文件（不算「忽略的说明文件」，别报误导性 warning） */
  const pickedOut = new Set();

  // ---- 兜底 1：用户从「候选目录」里挑了内容 ----
  //
  // `opts.pickDirs` 是数组；旧的单个 `opts.pickDir` 仍然兼容（等价于单元素数组）。
  // 以选中目录为新基准重新过滤 + 重新识别：候选目录里通常只剩 pak 三件套，
  // 于是 contentRules 自然命中「全是 pak → 落 ~Mods」。
  // 这样不用为「手动选目录」另写一套落点逻辑，复用现有规则即可。
  //
  // 🔴 **允许选多套**（2026-10-13 实测 mod 3970「Nv_pu_CNS」）：
  // 那包里三个子目录是**三个互不相关的 mod**（主 mod + Ahuang 皮肤 + 中文字体），
  // 界面却按「3 选 1」处理 —— 用户只能装到其中一个，另外两个永远装不上。
  // 现在选中多套时把它们**各自剥掉自己的目录前缀后合并**识别，
  // 于是「paks + CNS 数据文件」混在一起也能正确落 ~Mods。
  const pickDirs = (Array.isArray(opts.pickDirs) ? opts.pickDirs : (opts.pickDir ? [opts.pickDir] : []))
    .map(d => String(d).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);

  if (!plan && pickDirs.length) {
    const inner = [];
    const relSeen = new Map();     // 拍平后的相对路径 → 归档内原始路径
    const dupes = [];              // 重名的相对路径（选了两套会互相覆盖的内容）
    const owner = new Map();       // 资产 key → 第一次出现的目录
    const clashes = [];            // 跨目录的「同一份资产」（选了两套变体）

    for (const f of meaningful) {
      const dir = pickDirs.find(d => f.path === d || f.path.startsWith(d + '/'));
      if (!dir) { pickedOut.add(f.path); continue; }
      const p = f.path.slice(dir.length + 1);
      if (!p) { pickedOut.add(f.path); continue; }
      if (isDoc(p)) { excludedA.add(f.path); continue; }   // 目录里的封面图/说明同样忽略
      if (relSeen.has(p)) dupes.push(p);
      relSeen.set(p, f.path);

      // 跨目录的「同一份资产」检测 —— 这是**真正的**撞车信号。
      //
      // 实测（mod 692「Eve BP Nude」）：两套变体叫
      //     ID77117-BP_Nude_Planet Diving Suit (7th)_A_P.pak
      //     ID77117-BP_Nude_Planet Diving Suit (7th)_B_P.pak
      // **文件名不同**，所以「同名文件」那条判据抓不到；但 `ID77117` 是同一个游戏资产，
      // 装两套必然互相覆盖（同一件衣服被替换两次，后加载的赢）。
      // 而 mod 3970「Nv_pu_CNS」那三套（主 mod / 皮肤 / 字体）ID 各不相同 → 放行。
      if (PAK_EXT.test(p)) {
        const base = p.split('/').pop();
        const key = assetKeyOf(base);
        const prev = owner.get(key);
        if (prev && prev !== dir) clashes.push(key);
        else if (!prev) owner.set(key, dir);
      }

      inner.push({ ...f, path: p });
    }

    // 选中的内容里有互相覆盖的部分 → 一起装只有一套会生效。说清楚是哪些，让用户少选一套。
    if (dupes.length || clashes.length) {
      const names = [...new Set([...dupes, ...clashes])].map(n => String(n).replace(/^name:/, ''));
      const shown = names.slice(0, 4).join('、');
      const clashOpts = pickOptions(meaningful);
      return {
        ok: false,
        kind: 'unknown',
        kindLabel: KIND_LABEL.unknown,
        needsTargetPick: true,
        reason: `选中的内容里有 ${names.length} 处会互相覆盖（${shown}${names.length > 4 ? ' 等' : ''}），` +
          '一起装只有其中一套会生效 —— 请少选一套（列表里 ID 标签相同的，就是同一件东西）',
        ...variantFields(clashOpts),
        archivePath,
        tool: tool.label,
        entries: meaningful.slice(0, 200).map(f => f.path),
        pakCount: meaningful.filter(f => PAK_EXT.test(f.path)).length,
        fileCount: meaningful.length,
        totalBytes: meaningful.reduce((s, f) => s + f.size, 0),
        strippedPrefix: wrapper,
        skipped,
        warnings: []
      };
    }

    if (inner.length) {
      const p2 = structuralRules(L, inner) || contentRules(L, inner);
      if (p2) {
        plan = p2;
        if (pickDirs.length === 1) {
          // 单目录：沿用老的 wrapper 机制（`strippedPrefix` 也更直观）
          wrapper = pickDirs[0];
        } else {
          // 多目录：一条 wrapper 表达不了多个前缀，改成按文件逐个记录剥掉的路径
          stripMap = new Map();
          for (const f of inner) {
            const orig = relSeen.get(f.path);
            if (orig) stripMap.set(orig, f.path);
          }
        }
        // 选中目录之外的文件一律排除，否则 mapping 里会混进别的变体
        for (const p of pickedOut) excludedA.add(p);
      }
    }
  }

  // ---- 兜底 2：用户手动指定了安装目录 ----
  if (!plan && opts.manualTarget) {
    plan = {
      kind: 'files', target: opts.manualTarget, strip: null,
      reason: '结构无法自动识别，按你指定的目录原样展开'
    };
  }

  if (!plan) {
    // 整包都是作者的工程源文件（.blend / .psd / .fbx …）—— 这不是「结构没见过」，
    // 而是「这东西根本不该装」。给一句明确结论，别让用户白找目录。
    const srcExts = [...new Set(meaningful
      .map(f => (String(f.path).match(SOURCE_EXT) || [''])[0].toLowerCase())
      .filter(Boolean))];
    const sourceOnly = srcExts.length > 0 && meaningful.every(f => SOURCE_EXT.test(f.path));
    const optsOut = sourceOnly ? [] : pickOptions(meaningful);

    return {
      ok: false,
      kind: 'unknown',
      kindLabel: KIND_LABEL.unknown,
      needsTargetPick: !sourceOnly,
      // 「不是游戏 Mod」这类结论 —— 界面据此换按钮（不给「确认安装」，给「移除」）
      diagnosis: sourceOnly
        ? `这是作者的工程源文件（${srcExts.join(' / ')}），不是能装进游戏的 Mod，装到哪个目录都不会生效`
        : null,
      // 让界面能列出「装哪一套」—— 多选一变体包全靠这个。
      // 顺带给出 `defaultPick`（每组第一套 + 互不相关的全选）与 `hasConflicts`：
      // 「不冲突的直接全装、冲突的才停下来问」全靠这两个字段判断。
      ...variantFields(optsOut),
      // 🔴 **有候选时必须给出 reason**（2026-10-13 用户报「提示结构无法识别」）。
      //
      // 实测 mod 1430「BP Cooling suit」：包里 7 个目录各一套配色，
      // `pickOptions` 明明挑出了 7 个候选，但这里**没写 reason** →
      // `downloadEngine` 兜底成「结构无法自动识别，需要手动指定安装位置」，
      // 界面照实显示 —— 用户看到「结构无法识别」就以为是坏包。
      //
      // 真相是「**识别成功了，只是要你挑一套**」，两者是完全不同的事：
      //   前者该去找目录/换包，后者只要点一下。
      reason: optsOut.length
        ? `包里有 ${optsOut.length} 套内容，需要你选要装哪些（互不相关的可以一起装）`
        : null,
      archivePath,
      tool: tool.label,
      entries: meaningful.slice(0, 200).map(f => f.path),
      // 界面要区分「包是空的/非 pak」和「有 pak 但目录结构没见过」——
      // 老文案一句「也没找到 .pak 文件」在有 3 个 pak 时是把人往错方向引（实测踩过）
      pakCount: meaningful.filter(f => PAK_EXT.test(f.path)).length,
      fileCount: meaningful.length,
      totalBytes: meaningful.reduce((s, f) => s + f.size, 0),
      strippedPrefix: wrapper,
      skipped,
      warnings: warnings.concat([sourceOnly
        ? '压缩包里全是作者的工程源文件，没有可安装的游戏内容。'
        : optsOut.length
          // 有候选 = 识别出来了，只是要用户挑 —— 别再说成「结构没见过」
          ? `这个包里按目录分了 ${optsOut.length} 套内容，需要你选要装哪些。`
          : '压缩包结构与已知的 mod 布局都不匹配，需要手动指定安装目录。'])
    };
  }

  // ---- 展开成文件映射 ----
  //
  // 脚本模组有自己独立的目录（ue4ss\Mods\<name>\），根级的 icon.png / readme.txt
  // 对它是正常内容，所以这种情况下把阶段 A 剔掉的根级文件还回去。
  const inOwnFolder = plan.kind === 'script' &&
    path.resolve(plan.target).toLowerCase().startsWith(path.resolve(L.ue4ssModsDir).toLowerCase());

  // 把「包装层 + 规则内的 strip」合成一条完整前缀，再统一从原始路径里剥
  const totalStrip = [wrapper, plan.strip].filter(Boolean).join('/');

  const installSet = rel.filter(f => {
    if (!excludedA.has(f.path)) return true;
    return inOwnFolder && droppedDocsA.some(d => d.path === f.path);
  });

  for (const f of rel) {
    if (!excludedA.has(f.path)) continue;
    if (installSet.some(x => x.path === f.path)) continue;
    if (pickedOut.has(f.path)) continue;   // 其它变体的文件，不是「被忽略的说明」
    warnings.push('忽略说明/图片文件：' + f.path);
  }

  const mapping = [];
  for (const f of installSet) {
    // 多目录选择时按文件逐个取「剥掉前缀后的相对路径」（见兜底 1）；
    // 其余情况统一用「包装层 + 规则内的 strip」拼出的前缀来剥。
    const inner = (stripMap && stripMap.get(f.path)) || stripPrefix(f.path, totalStrip);
    if (!inner) continue;                                   // 被剥成空路径
    mapping.push({
      from: f.path,
      rel: inner,
      to: path.join(plan.target, inner.split('/').join(path.sep)),
      size: f.size
    });
  }

  if (!mapping.length) throw new Error('压缩包里没有可安装的文件');

  // ---- 依赖识别：这个包是不是 CNS 服装 Mod ----
  //
  // 判据（任一命中即算）：
  //   · 落点里出现 `CustomNanosuitSystem\` 这一层数据目录（CNS 的服装数据都在这）
  //   · 含 CNS 专有数据文件 `.dekcns`（外观定义）/ `.dekani`（动画定义）
  //
  // 为什么值得单独识别：服装 Mod 装了但没装 CNS 时，文件会安安静静躺进
  // `~Mods\CustomNanosuitSystem\`，游戏里什么都不显示 —— 用户完全不知道
  // 「其实还差一个前置」。所以这里要把依赖关系标出来，让界面能提示。
  const cnsHit = mapping.find(m => /(^|\/)customnanosuit(system)?(\/|$)/i.test('/' + String(m.rel || '').replace(/\\/g, '/')));
  // ⚠️ 用 CNS_DATA_NAME 而不是 `/\.(dekcns|dekani)$/` —— 实测文件名是
  //    `bcasecoolingsuit.dekcns.json`（真实扩展名是 .json），只看扩展名会漏判，
  //    于是「需要 CNS」的依赖提示不出现，用户装完看不到效果也不知道为什么。
  const cnsExt = mapping.find(m => CNS_DATA_NAME.test(m.rel || ''));
  const requiresCns = !!(cnsHit || cnsExt);
  const requiresCnsReason = requiresCns
    ? (cnsHit ? '包含 CustomNanosuitSystem\\ 服装数据目录' : '包含 CNS 服装数据文件（.dekcns / .dekani）')
    : null;

  // ---- 依赖识别：这个包是不是 ATOOL 体系的 Logic Mod ----
  //
  // 判据：落盘后的相对路径里出现 ATOOL 本体的**具名特征** —— 目录段或文件名
  //      stem（去扩展名）等于 `HD-ATOOL_P`。
  //
  // ⚠️ **不能用「落点在 LogicMods」当判据**：CNS 的主体 `DekCNS_P.pak` 同样住在
  //    `LogicMods\`，那样会给每个 CNS 包都挂上一条凭空的「需要 ATOOL」错误依赖。
  // ⚠️ ATOOL 的**动画包**（落 `~Mods\`、文件名各异，见 `_probe/atool-catalog.json`
  //    的 45 个下游 mod）无法从包内文件识别（pak 是二进制，看不到内部路径）。
  //    那要靠 Nexus 反向依赖查询，属 P1，见方案 §8.4。
  const isAtoolStem = (s) => /^hd-atool_p$/i.test(s);
  const atoolHit = mapping.find(m => {
    const rel = '/' + String(m.rel || '').replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length) return false;
    const stem = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    return isAtoolStem(stem) || parts.slice(0, -1).some(isAtoolStem);
  });
  const requiresAtool = !!atoolHit;
  const requiresAtoolReason = requiresAtool ? '包含 ATOOL 本体（HD-ATOOL_P）文件' : null;

  // ---- 冲突检测 ----
  //
  // 🔴 **「覆盖自己上次装的文件」不算冲突**（实测踩坑，2026-10-13，mod 1595）。
  //
  // 用户把「Modified Neurolink Suit with CNS compatible」装了 v1.0（fileId 7443），
  // 后来又下了一份同一个 mod 的 fileId 7444 —— 两个包的文件名一模一样
  // （`56_156_P.pak/.ucas/.utoc` + `Modified Neurolink Suit.dekcns.json`）。
  // 于是 4 个文件全部 existsSync 命中 → `conflictCount = 4` →
  // 自动安装被拦下、判成「有 4 个文件会被覆盖，等你确认」。
  //
  // 可它**根本没覆盖别人**，覆盖的是自己的旧版本 —— 这正是「升级/重装」，
  // 是正常操作，不该要用户确认。installer.install() 本来就会备份 + 覆盖，
  // installFlow 也已经会复用上一次的备份目录（见那边的 `skipBackupPaths`）。
  //
  // 所以由调用方把「本 mod 自己拥有的路径」传进来（`opts.ownedPaths`），
  // 命中这些路径的一律不算冲突。
  const ownedSet = new Set(
    (opts.ownedPaths ? Array.from(opts.ownedPaths) : []).map(p => String(p).toLowerCase())
  );
  // 🔴 **同名 + 同大小 = 极可能就是同一个文件 → 不算「要用户决策」的冲突**
  //
  // 实测（2026-10-13）：Minervha 系的 CNS 服装 mod **每一个都自带同一个底座**：
  //     Minervha_Master_P.pak / .ucas / .utoc   （339 / 100743776 / 20140 字节，逐字节一致）
  // 于是第二个及以后的 mod 一装上就会命中 3 个「冲突」，全被拦下等确认 ——
  // 而正确的动作显然是「覆盖它」（社区里 Vortex/MO2 就是这么装的）。
  //
  // 判据用**大小相等**：同一个文件大小必然相同；不同版本几乎不可能刚好一样大。
  // 这类「软冲突」照旧会走**覆盖前备份**（`install()` 对已存在的目标都会备份），
  // 所以即使判断错了也没有信息损失 —— 只是不再打扰用户。
  const softConflicts = [];
  const conflicts = mapping.filter(m => {
    if (ownedSet.has(String(m.to).toLowerCase())) return false;
    try {
      const st = fs.statSync(m.to);
      if (m.size && st.size === m.size) { softConflicts.push(m); return false; }
      return true;
    } catch { return false; }
  });

  return {
    ok: true,
    archivePath,
    tool: tool.label,
    kind: plan.kind,
    kindLabel: KIND_LABEL[plan.kind],
    reason: plan.reason,
    // 前置组件包（目前只有 UE4SS 走这条路）—— 调用方据此决定注册表 id 与依赖提示
    prereqKey: plan.prereqKey || null,
    target: plan.target,
    targetLabel: describeTarget(L, plan.target),
    requiresCns,
    requiresCnsReason,
    requiresAtool,
    requiresAtoolReason,
    fileCount: mapping.length,
    totalBytes: mapping.reduce((s, m) => s + m.size, 0),
    mapping,
    preview: mapping.slice(0, 120).map(m => m.rel),
    conflicts: conflicts.map(m => m.to),
    conflictCount: conflicts.length,
    // 🔴 「同名 + 同大小」的软覆盖：**不算冲突、不拦自动安装**，但要把数量报出来。
    //
    // 上面 `softConflicts` 那段注释写了为什么。这里额外暴露 `softOverwritePaths`
    // 是为了让日志/诊断能说清「这次其实盖了 N 个同内容文件」——
    // 排查「装完没变化」时，这一栏能直接告诉你「包里带的是和游戏里一模一样的底座」。
    // 注意：这些路径**仍会走覆盖前备份**（`install()` 只对「目标已存在」判断，
    // 不看是不是软冲突），所以卸载时还能还原，不会丢东西。
    softOverwriteCount: softConflicts.length,
    softOverwritePaths: softConflicts.map(m => m.to),
    // 命中的「自己上次装进去的文件」数（重装/升级时 > 0）—— 只用于日志与提示
    selfOverwriteCount: mapping.filter(m => ownedSet.has(String(m.to).toLowerCase())).length,
    strippedPrefix: totalStrip || null,
    skipped,
    warnings
  };
}

/** 把绝对路径翻译成「~Mods / ue4ss\Mods / SB\」这种人话 */
function describeTarget(L, target) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  const t = norm(target);
  const under = (base) => t === norm(base) || t.startsWith(norm(base) + path.sep.toLowerCase()) || t.startsWith(norm(base) + '/');

  if (t === norm(L.modsDir)) return '~Mods（Pak 模组目录）';
  if (t === norm(L.logicModsDir)) return 'LogicMods（UE4SS 逻辑 / 蓝图模组目录）';
  if (under(L.logicModsDir)) return 'LogicMods\\' + path.basename(target);
  if (t === norm(L.ue4ssModsDir)) return 'ue4ss\\Mods（脚本模组目录）';
  if (under(L.ue4ssModsDir)) return 'ue4ss\\Mods\\' + path.basename(target);
  if (t === norm(L.sb)) return 'SB\\（游戏模组根，Content + Binaries 合并）';
  if (t === norm(L.root)) return '游戏根目录';
  if (t === norm(L.paks)) return 'SB\\Content\\Paks';
  if (t === norm(L.ue4ssDir)) return 'SB\\Binaries\\Win64\\ue4ss';
  if (t === norm(L.win64)) return 'SB\\Binaries\\Win64';
  return target;
}

/* ---------------- 安装执行 ---------------- */

/** 目标文件相对游戏根的路径；不在游戏根内时退化成文件名 */
function safeRel(root, abs) {
  try {
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return path.basename(abs);
    return rel;
  } catch {
    return path.basename(abs);
  }
}

/**
 * 同步睡眠（Node 里没有同步 sleep，用 Atomics.wait 是最干净的做法）。
 * 用于删除失败后的退避重试 —— 必须同步，因为 rmrf 的调用点都在 finally 里。
 */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* 极少数环境不支持，退化成不睡 */ }
}

/**
 * 递归删除，带重试。
 *
 * ⚠️ Windows 上 `fs.rmSync` 会**偶发**失败（EBUSY / EPERM）——
 * 刚写完的文件可能还被句柄或杀软短暂占用。不加重试的话，
 * `data/tmp/extract-*` 会悄悄泄漏，而且失败被 `catch {}` 吞掉后完全无感
 * （实测：连跑几次自检后临时目录里堆了 11 个残留）。
 *
 * `fs.rmSync` 自带的 maxRetries 在本机实测**不够**（负载高时仍会漏），
 * 所以这里在外面再套一层自己的退避重试。重试仍失败时**打日志**，不要静默。
 */
function rmrf(dir, opts = {}) {
  if (!dir) return true;
  // 统一用 `.trash-<时间戳>` 后缀（注意是**点**，不是连字符）——
  // 生成与识别必须用同一个正则，否则改名后的目录永远匹配不上，会一直堆着。
  const alreadyTrash = /\.trash-\d+$/.test(dir);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
      return true;
    } catch (e) {
      // ⚠️ Windows 上 `fs.rmSync` 递归删目录会**先删干净再抛**（顶层 rmdir 与
      //    子项删除竞态，Node 已知行为）：目录其实已经没了，但异常照样冒出来。
      //    不判这一下就会「删成功却报失败」—— 调用方以为目录还在，
      //    `sweepTrash()` 收不到名字（实测会让 deps 测试偶发红一条），
      //    日志里也会留一行误导的「删除失败」。
      if (!fs.existsSync(dir)) return true;
      if (attempt === 4) {
        // 实在删不掉就**改名**。改名只需要父目录的句柄，不需要碰目录里的内容，
        // 所以「某个文件被句柄/杀软占着」这种情况改名照样能成功 ——
        // 于是目录不会原地泄漏，交给 sweepTrash() 过一会儿再清。
        if (!opts.noRename && !alreadyTrash) {
          try {
            const t = dir + '.trash-' + Date.now();
            fs.renameSync(dir, t);
            console.error('[清理] 删除失败，已改名待稍后清扫：' + path.basename(t) + '（' + e.message + '）');
            return true;
          } catch { /* 改名也失败（可能目录刚好被删掉），落到下面再判一次 */ }
          if (!fs.existsSync(dir)) return true;
        }
        console.error('[清理] 删除失败：' + dir + ' → ' + e.message);
        return false;
      }
      sleepSync(250 * (attempt + 1));
    }
  }
  return false;
}

/**
 * 清扫 `data/tmp` 下的陈旧临时目录。
 *
 * 兜底用的：即使某次删除真的失败了（句柄没释放），下一次安装也会把它扫掉，
 * 不会让临时目录无限膨胀。只删**足够旧**的（默认 1 小时），
 * 免得误删另一个正在跑的进程刚建的目录。
 *
 * @param {number} [maxAgeMs]
 * @returns {string[]} 被清掉的目录名
 */
function sweepStaleTmp(maxAgeMs = 60 * 60 * 1000) {
  const swept = [];
  let items = [];
  try { items = fs.readdirSync(paths.TMP, { withFileTypes: true }); } catch { return swept; }
  const now = Date.now();
  for (const it of items) {
    if (!it.isDirectory()) continue;
    // 只清我们自己建的临时目录，不动别的（比如用户手动放的包）
    if (!/^(extract|dl)-/.test(it.name)) continue;
    const p = path.join(paths.TMP, it.name);
    let mtime = 0;
    try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
    if (now - mtime < maxAgeMs) continue;
    if (rmrf(p)) swept.push(it.name);
  }
  return swept;
}

/**
 * 清扫「改名待删」的目录（`rmrf` 删不掉时留下的 `*-trash-<时间戳>`）。
 *
 * 为什么要有这一步：`rmrf` 删不掉时会把目录改名而不是原地失败，这样目录不会
 * 卡在原地（改名不受「目录里有文件被占用」影响）。代价是得有人来收尾 ——
 * 就是这里。等一小会儿（默认 10 分钟）再删，那时占用它的句柄通常已经释放。
 *
 * 同时扫 `data/tmp` 和 `data/backup/overwritten`（备份目录也会走 rmrf）。
 *
 * @param {number} [maxAgeMs]
 * @returns {string[]} 被清掉的目录名
 */
function sweepTrash(maxAgeMs = 10 * 60 * 1000) {
  const swept = [];
  const now = Date.now();
  for (const dir of [paths.TMP, path.join(paths.BACKUP, 'overwritten')]) {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (!it.isDirectory() || !/\.trash-\d+$/.test(it.name)) continue;
      const p = path.join(dir, it.name);
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
      if (now - mtime < maxAgeMs) continue;
      // noRename：已经在垃圾桶里了，别再套一层 .trash-x.trash-y
      if (rmrf(p, { noRename: true })) swept.push(it.name);
    }
  }
  return swept;
}

/**
 * 执行安装。
 *
 * ⚠️ 覆盖前备份（opts.backup，默认开）
 *   普通 pak mod 是往 `~Mods\` 丢独立文件，覆盖风险低；但 **CNS 这类框架是把文件
 *   合并进 `SB\Binaries\` + `SB\Content\`，会直接盖掉游戏自己的文件**。
 *   没有备份就完全不可逆，所以只要目标文件已存在，就先原样复制到
 *   `data/backup/overwritten/ov-<时间戳>/`，并在返回值里带出清单，
 *   供注册表记录、卸载时还原。
 *
 * ⚠️ 重装（更新版本）时必须区分「游戏原文件」和「我们上次装的自己的文件」
 *
 *   否则会踩一个很隐蔽的坑：第二次安装时目标文件全都存在，于是**把自己上次装的
 *   文件也备份了一遍**。卸载时先按 manifest 移走文件、再「还原被覆盖的原文件」——
 *   结果把自己刚移走的文件又还原回来了，**卸载等于没卸**，而且备份目录还会一直泄漏。
 *
 *   两个参数解决它：
 *     · `skipBackupPaths` —— 这些路径已经有原始备份了，不用再备份（同一份原文件
 *       备份两次没有意义）
 *     · `backupDir`       —— **复用同一个注册表 id 的备份目录**，而不是每次新建。
 *       这样「原文件备份」始终只有一份，`dropBackup` 一次就能清干净。
 *
 * @param {string} root 游戏根目录
 * @param {object} plan analyze() 的返回值
 * @param {object} opts
 * @param {'overwrite'|'skip'|'abort'} [opts.onConflict]
 * @param {Function} [opts.onProgress]
 * @param {boolean} [opts.backup]            默认 true
 * @param {string}  [opts.backupDir]         复用已有备份目录（重装时传上一次的）
 * @param {Set<string>} [opts.skipBackupPaths] 已有原始备份的路径（小写绝对路径）
 * @returns {Promise<{manifest:Array, written:number, skipped:number, backed:Array, backupDir:string|null, target:string}>}
 */
async function install(root, plan, opts = {}) {
  if (!plan || !plan.ok || !Array.isArray(plan.mapping)) throw new Error('安装计划无效');
  const onConflict = opts.onConflict || 'overwrite';
  const onProgress = opts.onProgress;
  const wantBackup = opts.backup !== false;
  const skipBackup = opts.skipBackupPaths instanceof Set ? opts.skipBackupPaths : new Set();

  if (plan.conflictCount && onConflict === 'abort') {
    throw new Error('目标目录已存在 ' + plan.conflictCount + ' 个同名文件，已中止');
  }

  const stamp = Date.now();
  const tmp = path.join(paths.TMP, 'extract-' + stamp);
  // 兜底清扫：上一次若因句柄未释放而没删干净，这次顺手带走
  try { sweepStaleTmp(); } catch { /* 忽略 */ }
  try { sweepTrash(); } catch { /* 忽略 */ }
  const backupDir = opts.backupDir || path.join(paths.BACKUP, 'overwritten', 'ov-' + stamp);
  // 复用过来的备份目录在装之前就存在 → 即使这次一个文件都没备份，也不能把它删掉，
  // 里面装着更早那次安装留下的「游戏原文件」，卸载时还要用。
  let backupDirPreexisting = false;
  try { backupDirPreexisting = fs.existsSync(backupDir) && fs.readdirSync(backupDir).length > 0; } catch { /* 忽略 */ }

  const manifest = [];
  const backed = [];
  let written = 0;
  let skipped = 0;
  let backupFailed = 0;

  try {
    onProgress && onProgress({ stage: 'extract', percent: 0 });
    await archive.extract(plan.archivePath, tmp);
    onProgress && onProgress({ stage: 'extract', percent: 100 });

    const total = plan.mapping.length;
    for (let i = 0; i < total; i++) {
      const m = plan.mapping[i];
      const src = path.join(tmp, m.from.split('/').join(path.sep));

      if (!fs.existsSync(src)) { skipped++; continue; }

      if (onConflict === 'skip' && fs.existsSync(m.to)) { skipped++; continue; }

      // 覆盖前先留一份原件（但「已有原始备份」和「是我们自己上次装的」都跳过）
      const alreadyBacked = skipBackup.has(String(m.to).toLowerCase());
      if (wantBackup && !alreadyBacked && fs.existsSync(m.to)) {
        try {
          const rel = safeRel(root, m.to);
          const dest = path.join(backupDir, rel.split('/').join(path.sep));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(m.to, dest);
          let size = 0;
          try { size = fs.statSync(dest).size; } catch { /* 忽略 */ }
          backed.push({ path: m.to, backup: dest, rel, size });
          onProgress && onProgress({ stage: 'backup', done: backed.length, file: rel });
        } catch (e) {
          backupFailed++;
          console.error('[安装] 备份失败：' + m.to + ' → ' + e.message);
        }
      }

      fs.mkdirSync(path.dirname(m.to), { recursive: true });
      fs.copyFileSync(src, m.to);

      let size = m.size;
      try { size = fs.statSync(m.to).size; } catch { /* 用归档里的大小 */ }
      manifest.push({ path: m.to, rel: m.rel, size });
      written++;

      if (onProgress && (i % 20 === 0 || i === total - 1)) {
        onProgress({ stage: 'copy', done: i + 1, total, percent: Math.round(((i + 1) / total) * 100) });
      }
    }
  } finally {
    rmrf(tmp);
  }

  // 一个文件都没备份、且这个目录是我们新建的 → 不留空目录。
  // 复用过来的（里面本来就有东西）必须保留。
  let usedBackupDir = null;
  if (backed.length || backupDirPreexisting) usedBackupDir = backupDir;
  else rmrf(backupDir);

  return {
    manifest, written, skipped,
    backed, backupDir: usedBackupDir, backupFailed,
    target: plan.target, archivePath: plan.archivePath
  };
}

/** 按 manifest 反向卸载（只动登记过的文件） */
function removeByManifest(manifest) {
  const removed = [];
  const failed = [];
  for (const f of manifest || []) {
    try {
      if (fs.existsSync(f.path)) { fs.unlinkSync(f.path); removed.push(f.path); }
    } catch (e) {
      failed.push({ path: f.path, error: e.message });
    }
  }
  return { removed, failed };
}

/**
 * 把「安装时被覆盖的原文件」还原回去。
 * 与 removeByManifest 配合：先删掉我们装进去的文件，再把原件放回原位。
 */
function restoreOverwritten(backed) {
  const restored = [];
  const failed = [];
  for (const b of backed || []) {
    try {
      if (!b.backup || !fs.existsSync(b.backup)) { failed.push({ path: b.path, error: '备份文件不存在' }); continue; }
      fs.mkdirSync(path.dirname(b.path), { recursive: true });
      fs.copyFileSync(b.backup, b.path);
      restored.push(b.path);
    } catch (e) {
      failed.push({ path: b.path, error: e.message });
    }
  }
  return { restored, failed };
}

/** 丢弃一次安装留下的备份目录 */
function dropBackup(backupDir) {
  if (!backupDir) return false;
  return rmrf(backupDir);
}

/**
 * 自底向上清理空目录。
 *
 * ## 为什么需要
 *
 * 卸载是**按 manifest 逐个文件移走**的 —— 文件走了，目录还在。CNS 这类框架包
 * 会在 `~Mods\CustomNanosuitSystem\{Animations,Cosmetics}\` 与
 * `ue4ss\Mods\DekCNS\{Scripts,ScreenshotConsoleVariables}\` 下建好几层。
 * 不清理会留下两个真问题（实测都踩到了）：
 *
 *   1. **检测误报**：CNS 的「服装数据目录」特征是一个目录，空壳还在 →
 *      卸载后仍被判定为「已安装（不完整）」，界面显示得莫名其妙。
 *   2. **幽灵条目**：通用脚本扫描是**按目录**认 mod 的，空的
 *      `ue4ss\Mods\DekCNS\` 会被重新列成一条「已装 mod」，看起来像没卸干净。
 *
 * ## 安全边界
 *
 * · 用 `rmdirSync`（**非递归**）—— 非空目录会被它直接拒绝，天然安全，
 *   绝不可能误删还有内容的目录。
 * · 向上回溯时碰到 `stopAt` 里的路径立刻停，不会把 `~Mods` / `Win64` /
 *   游戏根这类**结构目录**删掉（游戏不一定自己重建它们）。
 *
 * @param {string[]} dirs 起始目录（通常是被移走文件的父目录）
 * @param {string[]} stopAt 不许删的路径（含其自身）
 * @returns {string[]} 实际删掉的目录
 */
function pruneEmptyDirs(dirs, stopAt = []) {
  const stop = new Set((stopAt || []).filter(Boolean).map(p => path.resolve(p).toLowerCase()));
  const seen = new Set();
  const all = [];

  for (const d of dirs || []) {
    if (!d) continue;
    let p = path.resolve(d);
    for (let i = 0; i < 40; i++) {
      const key = p.toLowerCase();
      if (stop.has(key) || seen.has(key)) break;
      seen.add(key);
      all.push(p);
      const parent = path.dirname(p);
      if (parent === p) break;
      p = parent;
    }
  }

  all.sort((a, b) => b.length - a.length);   // 深的先删，浅的才有机会变空
  const removed = [];
  for (const d of all) {
    try { fs.rmdirSync(d); removed.push(d); }
    catch { /* 非空 / 不存在 / 无权限 —— 都是正常情况，跳过 */ }
  }
  return removed;
}

module.exports = {
  analyze,
  install,
  removeByManifest,
  restoreOverwritten,
  dropBackup,
  pruneEmptyDirs,
  sweepStaleTmp,
  sweepTrash,
  rmrf,
  commonPrefix,
  safeName,
  describeTarget,
  KIND_LABEL
};
