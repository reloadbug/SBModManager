# Animation Tool (ATOOL) 调研与支持方案

> 调研日期：2026-10-14　目标：让管理器具名支持 ATOOL 本体 + 其动画包生态的下载与安装
> 证据来源：Nexus GraphQL（本机实测）、作者原文说明、第三方转载说明、**本机现有安装器实测跑包**
> 关联数据：`_probe/atool-catalog.json`（45 个依赖 ATOOL 的 mod 全量清单）

---

## 0. 一句话结论

ATOOL 不是普通 pak 替换模组，而是一个 **UE4SS Blueprint（Logic Mod）框架**：
本体住 `SB\Content\Paks\LogicMods\`，动画包住 `~Mods\`，外置音频住 `LogicMods\HD-ATOOL_P\audio\`。

**现有安装器完全不认识 `LogicMods` 这个落点**（实测：会把它当成「变体包」让用户挑，挑完还会错落到 `~Mods`）。
所以支持 ATOOL 的**唯一硬需求**是：在 `installer.js` 里把 `LogicMods` 提升为一等结构目录。其余（动画包下载）都是已有能力的复用。

---

## 1. 身份

| 项 | 值 |
|---|---|
| Nexus | [mod 1662](https://www.nexusmods.com/stellarblade/mods/1662) · 游戏 `stellarblade` (gameId 7804) |
| 名称 / 作者 / 版本 | Animation Tool (ATOOL) / **hbd** / **v6.1** |
| 热度 | 157,978 下载 · 1,212 认可（剑星工具类第一梯队） |
| 摘要 | Eve's tool for loading poses, expressions, and animations |
| 依赖 | **UE4SS**（`Chrisr0/RE-UE4SS`，作者指定 `UE4SS_v3.1.0-6.zip`） |
| 更新状态 | 作者声明「很长一段时间不会更新」，专注做动画 |

### 1.1 主文件（当前 v6.1，三者**只能装一个**）

| fileId | 文件名 | 说明 |
|---|---|---|
| **12834** | HD-ATOOL | 默认键位（推荐默认选它） |
| 12835 | HD-ATOOL-k2 | 备用键位方案 2 |
| 12836 | HD-ATOOL-k3 | 备用键位方案 3（主要靠拓展菜单） |

三者等大（≈14.4 MB），差异只在热键映射。**装多个会互相覆盖**，本管理器应做互斥处理（沿用现有 `exclusiveGroups` 机制即可）。

### 1.2 可选文件

| fileId | 文件名 | 用途 |
|---|---|---|
| 7703 | HD-ATOOL-animtest | 测试动画包（**装到 `~Mods`**，不是 LogicMods） |
| 12621 | ATOOL making mod related files | 作者工程文件（57 MB，**不能装**，属 `SOURCE_EXT` 范畴） |
| 12827 | Better Jiggle Mod 2 ATOOL Patch | 覆盖 `ue4ss\` 文件的兼容补丁（前置是 mod 1570） |

---

## 2. 功能

- **姿势 / 表情 / 自定义动画**加载：槽位 **1–1000**，可在游戏内左右切换
- **动画包生态**：第三方以「动画包 mod」形式扩展，**必须路径与命名一致**才生效
- **挂载系统**：往骨骼插槽挂物体 / Niagara 粒子 / 其他角色（多角色同步动画）
- **自由镜头** + 动画播放暂停 + 外置音频（wav，与动画同编号，音量 `vNN.txt`）
- 隐藏 UI、隐藏伊芙、拓展菜单

### 2.1 热键（默认版）

| 功能 | 键 |
|---|---|
| 姿势 上/下 | `Alt`+`,` / `Alt`+`.` |
| 表情 上/下 | `Alt`+`L` / `Alt`+`;` |
| 自定义动画 上/下 | `Alt`+`[` / `Alt`+`]` |
| 拓展菜单开/关 | `Alt`+`'` |
| 退出 | `Alt`+`/` |

（k2 / k3 换了一套键位；k3 几乎全靠拓展菜单。）

### 2.2 已知坑（值得在界面上提示用户）

1. 退出游戏可能触发 `ue4ss_crash` → 进游戏前把输入法切成**美式键盘**可避免。
2. 与任何「更换伊芙动画蓝图」的 mod 冲突 → 作者推荐用 [mod 861](https://www.nexusmods.com/stellarblade/mods/861) 处理。
3. Better Jiggle Mod 新版即使不打 ATOOL 补丁也会崩，且自动刷新与 ATOOL 冲突。
4. 动画包必须与 ATOOL **同路径同命名**，改名即失效。

---

## 3. 安装拓扑（核心）

```
游戏根/
├─ SB/Binaries/Win64/
│   ├─ dwmapi.dll                     ← UE4SS 本体（已有前置支持）
│   └─ ue4ss/                          ← UE4SS 本体（已有前置支持）
└─ SB/Content/Paks/
    ├─ LogicMods/                      ← ★ ATOOL 本体落点（现有安装器不认识）
    │   ├─ HD-ATOOL_P.pak  / .ucas / .utoc      （或嵌套在 HD-ATOOL_P\ 内，见 §5）
    │   └─ HD-ATOOL_P/audio/*.wav       ← 外置音频，文件名 = 动画编号
    └─ ~Mods/                          ← 动画包 / 舞蹈 mod（普通 pak，已支持）
        └─ XXX_P.pak / .ucas / .utoc
```

**三类东西三个落点**，这是全部复杂度的来源：

| 内容 | 落点 | 现有安装器 |
|---|---|---|
| ATOOL 本体（框架） | `SB\Content\Paks\LogicMods` | ❌ 不支持 |
| 动画包 / 舞蹈 mod | `SB\Content\Paks\~Mods` | ✅ 已支持 |
| 外置音频 wav | `SB\Content\Paks\LogicMods\HD-ATOOL_P\audio` | ❌ 不支持（且是**手工放置**，非 mod 包内） |

pak 内部虚拟路径（作者工程口径）：`/Game/Mods/HD-ATOOL_P/{anim|pose|expr}/<编号>`。

---

## 4. 本机现状核实（2026-10-14）

- 游戏根：`D:\games\Star Blade`（配置里 `gameRoot` 即此）
- `SB\Content\Paks\LogicMods\` 已存在，里面**只有 CNS 的** `DekCNS_P.pak/.ucas/.utoc`
- `~Mods\` 里有一大批 CNS 服装 mod
- **ATOOL 尚未安装**
- 本机 Nexus 登录态有效（`nexusmods_session`，有效期至 2026-10-24），Nexus GraphQL 可直连

> ⚠️ 说明：想直接抓 ATOOL 压缩包落地验证档内目录，但 `www.nexusmods.com` 站内页有 Cloudflare 挑战，
> 纯 HTTP 客户端拿不到（需真浏览器窗口）。因此 §5 的「归档内层级」由**作者原文 + 三处第三方转载交叉印证**得出，
> 并已按「多形态兼容」设计规则以消解残余不确定性（§8.1）。

---

## 5. 归档结构：证据与候选形态

### 5.1 官方/转载原文

| 来源 | 原文 |
|---|---|
| 作者（Nexus 描述） | "Create a 'LogicMods' folder in the game root directory\SB\Content\Paks, and place **the folder from the main file archive** into the 'LogicMods' folder." |
| 模组加加 / xmodhub 转载 | 同上：「在游戏根目录 `\SB\Content\Paks` 下创建 `LogicMods` 文件夹，将主文件压缩包内的**文件夹**解压到 `LogicMods` 中」 |
| 外置音频路径（多源一致） | `SB\Content\Paks\LogicMods\HD-ATOOL_P\audio\*.wav` |
| 舞蹈 mod 安装说明（18183/游侠多篇） | pak → `~Mods`；音频 → `LogicMods\HD-ATOOL_P\audio`（不存在则手建这些目录） |
| UE4SS BP Mod 官方约定 | `Content/Paks/LogicMods/ModName.pak` + 可选 `LogicMods/ModName/config.lua` |

**推论**：压缩包内**有且只有一个顶层文件夹**，名字不是 `LogicMods`（否则"放进 LogicMods"会变成双层），
最可能是 `HD-ATOOL_P\`；且 `HD-ATOOL_P` 与音频目录同名 —— 说明 pak 与 `audio\` 是**同一个文件夹的两部分**。

### 5.2 需要兼容的三种形态

| 形态 | 归档内路径 | 解压后应落到 |
|---|---|---|
| **V1** 自带 LogicMods 层 | `LogicMods/HD-ATOOL_P.pak` (+`LogicMods/HD-ATOOL_P/audio/`) | `Paks\LogicMods\HD-ATOOL_P.pak` |
| **V2** 平铺（无包装） | `HD-ATOOL_P.pak` + `HD-ATOOL_P/audio/` | `Paks\LogicMods\HD-ATOOL_P.pak` |
| **V3** 单文件夹包一层 | `HD-ATOOL_P/HD-ATOOL_P.pak` + `HD-ATOOL_P/audio/` | `Paks\LogicMods\HD-ATOOL_P\...`（保留内层） |
| V4 带 SB\ 前缀 | `SB/Content/Paks/LogicMods/...` | ✅ 现有 `SB\` 规则已正确覆盖 |

V1/V2/V3 三种**规则必须都能吃下**，且都要保留各自内层相对结构（音频目录不能被剥掉）。

---

## 6. 现有安装器实测（决定性证据）

用 `_probe/atool-layout-probe.js` 造了 7 种候选归档，直接跑**当前** `installer.analyze()`：

| # | 归档形态 | 现有结果 | 判定 |
|---|---|---|---|
| A | `LogicMods/HD-ATOOL_P/*.pak` | ❌ 「包里有 1 套内容，需要你选要装哪些」；选中后落 **~Mods** | **错位**（应 LogicMods） |
| B | `SB/Content/Paks/LogicMods/...` | ✅ `SB\` 规则 → 正确落 `LogicMods` | 可用 |
| C | `HD-ATOOL_P/*.pak`（单文件夹） | ⚠️ 落 `~Mods` | **错位** |
| D | `HD-ATOOL_P.pak`（根级平铺） | ⚠️ 落 `~Mods` | **错位** |
| E | 动画包平铺 pak（如 1740） | ✅ 落 `~Mods` | 正确 |
| F | 动画包包一层文件夹 | ✅ 落 `~Mods` | 正确 |
| G | 散装 `Mods/HD-ATOOL_P/anim/*.uasset` | ❌ 「结构无法识别」 | 若存在该形态需另处理 |

**结论：现有代码对 ATOOL 本体的四种可能形态里，三种会装错地方，一种要用户手挑。必须补规则。**

---

## 7. 代码缺口清单（精确到函数）

| # | 文件 | 现状 | 缺什么 |
|---|---|---|---|
| 1 | `src/main/game.js :: layout()` | 无 `logicModsDir`（`cnsStatus()` 里临时拼了 `path.join(L.paks,'LogicMods')`） | 提升为布局字段 |
| 2 | `src/main/installer.js :: analyze()` 内 `STRUCTURAL` | `['sb','content','binaries','paks','~mods','ue4ss','scripts','engine','plugins']` —— **没有 `logicmods`** | 加进去，否则包装层剥离会吃掉 `LogicMods` |
| 3 | `installer.js :: structuralRules()` | 无 LogicMods 分支 | 新增规则（且必须排在通用 pak 规则前） |
| 4 | `installer.js :: describeTarget()` | 无 LogicMods 文案 | 加 `SB\Content\Paks\LogicMods` 人话 |
| 5 | `installer.js` 返回体 | 有 `requiresCns` / `prereqKey` | 加 `requiresAtool` / `requiresAtoolReason` |
| 6 | `src/main/prereqs.js` | 只有 `ue4ss` / `cns` | 加 `atool` 条目（modId 1662 / fileId 12834 / requires `ue4ss`） |
| 7 | `src/main/nexus.js` | 无反向依赖查询 | 封装 `modsRequiringThisMod` |
| 8 | `src/main/game.js` | 无 ATOOL 探测 | 加 `atoolStatus()`（仿 `cnsStatus()`） |
| 9 | `src/main/scanner.js` | `claimedScriptDirs()` 防重复列条 | LogicMods 下的 pak 也需纳入「已装 mod」扫描/认领 |

---

## 8. 支持方案

### 8.1 安装器：把 LogicMods 提升为一等结构（P0，唯一硬需求）

**改动 1 —— `game.js :: layout()` 新增字段**

```js
logicModsDir: path.join(sb, 'Content', 'Paks', 'LogicMods'),
```

**改动 2 —— `STRUCTURAL` 加入 `'logicmods'`**

**改动 3 —— `structuralRules()` 新增两条规则（顺序很关键）**

```js
// (a) 归档里本来就带 LogicMods\ 层 —— 最强信号，直接锚定
//     命中：任何路径段名等于 logicmods（大小写不敏感）
//     落点：L.logicModsDir；剥掉「到 LogicMods 为止」的全部前缀，**保留内层结构**
//     例：LogicMods/HD-ATOOL_P.pak        → Paks\LogicMods\HD-ATOOL_P.pak
//         LogicMods/HD-ATOOL_P/audio/x.wav → Paks\LogicMods\HD-ATOOL_P\audio\x.wav

// (b) 无 LogicMods 层，但命中「Logic Mod 特征」→ 落 Paks\LogicMods
//     特征（任一）：
//       · 任一路径段匹配 /^HD-ATOOL/i（与 CNS 的 .dekcns 同思路的具名特征）
//       · 存在「pak 基名（去掉 _P/.pak…）」与某**同级目录名**相同的情形
//         （HD-ATOOL_P.pak 与 HD-ATOOL_P/ 并存 → 典型 Logic Mod + 伴随资源目录）
//     落点：L.logicModsDir
//     V2 平铺 → 原样进去；V3 单文件夹 → 剥离该文件夹（等价于 V2）
//     ⚠️ 必须排在 contentRules 的「全是 pak → ~Mods」之前，否则又落错
```

**为什么 (b) 不会误伤普通包装层 pak 包**：普通包（如 `Solo Variant/x.pak`）既不含 `HD-ATOOL`
字样，也不会出现「pak 基名 == 同级目录名」的伴随目录形态 —— 判据是**合取**，不是单独的名字匹配。

**改动 4 —— `describeTarget()` 加分支**

```js
if (t === norm(L.logicModsDir)) return 'LogicMods（UE4SS 逻辑/蓝图模组目录）';
if (under(L.logicModsDir)) return 'LogicMods\\' + path.basename(target);
```

**改动 5 —— 依赖标记**

```js
const atoolHit = mapping.find(m => /(^|\/)logicmods(\/|$)/i.test('/' + String(m.rel||'').replace(/\\/g,'/'))
                              || /hd-atool/i.test(String(m.rel||'')));
const requiresAtool = !!atoolHit;   // 与 requiresCns 完全同构，照抄那套接线
```

> 「动画包」判定不能靠包内文件（pak 是二进制，看不到内部路径）。改用 **Nexus 反向依赖**（§8.4），
> 既准确又不依赖文件名猜测。若离线，退化为「包的说明含 ATOOL」+ 包名含 `ATOOL|Anim_Pack|Expr_Pack`。

### 8.2 前置组件化（P0）

`prereqs.js` 新增：

```js
atool: {
  key: 'atool',
  name: 'ATOOL',
  fullName: 'Animation Tool（ATOOL）',
  desc: '姿势 / 表情 / 自定义动画加载框架 · 大量舞蹈与动画 Mod 的前置',
  kind: 'nexus',
  modId: 1662,
  fileId: 12834,          // 默认键位版；k2/k3 作为互斥变体让用户挑
  version: '6.1',
  pageUrl: 'https://www.nexusmods.com/stellarblade/mods/1662',
  filesUrl: 'https://www.nexusmods.com/stellarblade/mods/1662?tab=files',
  target: 'SB\\Content\\Paks\\LogicMods',
  targetHint: 'LogicMods\\（+ HD-ATOOL_P\\audio\\ 放外置音频）',
  requires: ['ue4ss'],
  hint: 'HD-ATOOL v6.1'
}
```

- 一键安装通道**零改动复用**：`ipc.js :: prereq:install` 已经会跑「检查 requires → 起下载 → 走 analyze/install」全链路，
  只要 `installer` 认识 LogicMods 落点它就自动装对地方。
- `prereq:list` / 前置管理页会自动多出一张卡片（`app.js :: renderPrereq()` 是数据驱动的）。
- **UI 增强（可选）**：卡片上给一句「默认/k2/k3 三个版本只能装一个，装多个会互相覆盖」。

### 8.3 检测与展示（P1）

`game.js` 仿 `cnsStatus()` 加 `atoolStatus()`：

| 特征 | 路径 | 核心 |
|---|---|---|
| 主体 pak | `SB\Content\Paks\LogicMods\HD-ATOOL_P.pak` | ✅ |
| 伴生文件 | 同目录 `HD-ATOOL_P.ucas` + `.utoc`（IoStore 三件套齐才完整） | ✅ |
| 音频目录 | `SB\Content\Paks\LogicMods\HD-ATOOL_P\audio\` | 可选（数量=已配音频数） |
| 依赖 | `ue4ss` 已装 | ✅ |

`inspect()` 里加 `atool` 字段；`scanner.js` 在「前置组件」段加一条 ATOOL（与 UE4SS/CNS 并列）。
LogicMods 下的**非前置** pak 也要能被 `scanPaks` 类逻辑扫到（新增 `scanLogicMods()`），否则用户手装的 Logic Mod 不会出现在列表里。

### 8.4 下载侧：ATOOL 动画目录（P1）

**Nexus 有现成的反向依赖接口**（本机实测可用）：

```graphql
{ mod(modId:1662, gameId:7804){
    modRequirements {
      modsRequiringThisMod(count:300){ totalCount nodes{ modId modName } }
      nexusRequirements(count:50){ nodes{ modId modName url } }
    } } }
```

实测返回 **45 个 mod** 明确依赖 ATOOL —— 正好覆盖全部动画/舞蹈/姿势包生态。据此：

1. `nexus.js` 新增 `getModsRequiring(modId)`（带缓存，与 `getModFacets` 同风格）。
2. 浏览页加一个**「ATOOL 动画」入口**：一次列出这 45 个 mod（含封面/热度/主文件），支持**批量下载**（复用现有 `test:batch-download` 通道）。
3. 这 45 个里挑出「框架自带包」做精选置顶：`1740 InGame Animation Pack`(69 个游戏内动画)、
   `1744 InGame Facial Expression Pack`(29 个表情)、`1699 ATOOL extension animation package 1`。
4. 安装时按 §8.1 落 `~Mods` —— **已有能力，无需改动**。
5. 音频（wav）不在 Nexus 包里，属用户自备 → 在 UI 上给一句路径指引 + 一个「打开 audio 目录」按钮。

全量清单已落盘：`_probe/atool-catalog.json`（45 条，含 modId / 名称 / 版本 / 摘要 / 作者 / 认可数 / 下载数 / 主文件 fileId）。

### 8.5 冲突与互斥

- **k2 / k3 / 默认三版互斥**：靠现有 `pickOptions` + `exclusiveGroups`（同一目录含 pak → 候选）——但 **V3 单文件夹形态**
  会被走成「1 个候选」，需要按 §8.1(b) 直接判为 LogicMod 而非让用户挑。若做到「不被当变体包」，则互斥改由
  **Nexus 侧同 modId 不同 fileId 的既往安装记录**兜住（`ownedPaths` 已能识别自覆盖）。
- **ATOOL vs Better Jiggle Mod**：属真实冲突（作者明说），应在装了 ATOOL 的用户装 Better Jiggle 时给黄条提示。
- **与 CNS 不冲突**：两者落点不同（LogicMods vs ~Mods），可共存（本机现状即 CNS 在 LogicMods）。

---

## 9. 测试计划

沿用现有零依赖 probe 风格（退出码即结果）：

1. `_probe/atool-layout-probe.js`（**已写**）—— 7 种形态的识别矩阵，支持 `--assert` 模式并入 `test:all`：
   - A/B/C/D → `kind=logicmod` 且 `target === L.logicModsDir`
   - E/F → `kind=pak` 且落 `~Mods`
   - 内层相对结构不被剥（`HD-ATOOL_P/audio/x.wav` 必须仍在 `HD-ATOOL_P\audio\` 下）
2. 回归：`npm run test:all` 必须保持 **30 套件 / 1320 断言 / 0 失败**；尤其 `test:pickdirs`、`test:variant-auto`、`test:conflicts`。
3. 新增 `_probe/atool-detect-test.js`：`atoolStatus()` 的三件套齐/缺/半装三种情形。
4. `_probe/atool-catalog.js`（**已写**）—— 反向依赖 + 主文件解析，产出 JSON。

---

## 10. 风险与待确认

| # | 项 | 状态 | 处置 |
|---|---|---|---|
| 1 | 归档内确切层级（V1/V2/V3） | **未 100% 实包确认**（Nexus 站内有 CF 挑战，抓包需真浏览器窗口） | 规则设计为三形态兼容 + probe 全覆盖；首次真实下载时把 `mapping` 落日志即可一眼确认 |
| 2 | 散装 uasset 目录形态（G）是否存在 | 未知 | 暂不处理；若真出现，届时按 `Mods\` 特征补规则 |
| 3 | `fileId` 易变 | 必然 | 与 CNS 同策略：注入高亮失效则降级为「高亮所有下载按钮」，不阻断 |
| 4 | 外置音频手工放置 | 设计如此 | UI 给路径指引，不代装 |
| 5 | LogicMods 下多余 pak 是否被游戏加载 | — | 本机只有 CNS 一个，无法旁证；以作者说明与 UE4SS 通用约定为准 |

---

## 11. 落地顺序（建议）

| 阶段 | 内容 | 影响面 |
|---|---|---|
| **P0** | `game.layout().logicModsDir` + `STRUCTURAL` + `structuralRules` 两条规则 + `describeTarget` | installer/game，纯新增规则，回归风险低 |
| **P0** | `prereqs.js` 加 `atool`；测 `prereq:install` 端到端 | 复用现有一键安装通道 |
| **P1** | `requiresAtool` 标记 + 界面黄条（照抄 `requiresCns` 的 6 处接线） | downloadEngine / installFlow / app.js |
| **P1** | `atoolStatus()` + `scanner` 展示 + `scanLogicMods()` | game/scanner |
| **P2** | `nexus.getModsRequiring(1662)` + 「ATOOL 动画」浏览入口 + 批量下载 | nexus/app.js |

---

## 附录 A：依赖 ATOOL 的 45 个 mod（Top 12，按认可数）

| modId | 名称 | 认可 | 主文件 fileId |
|---|---|---|---|
| 1725 | (V2.1)_PERFECT BRIDE_SFW_NSFW | 1454 | 9151 |
| 1740 | InGame Animation Pack for Animation Tool (ATOOL) | 315 | 9704 |
| 1874 | NSFW Animation - Feet's Whisper | 263 | 9030 |
| 1929 | NSFW Facial Animation- Ahegao learned from Belle Delphine | 245 | 9300 |
| 1939 | NSFW Dance - Beep Beep I'm a Sheep | 233 | 9416 |
| 1744 | InGame Facial Expression Pack for Animation Tool (ATOOL) | 222 | 8264 |
| 3782 | ESAP - Eve Sexy Animation Pose | 196 | 16662 |
| 3823 | Eve Finger masturbate AnimPack | 183 | 16883 |
| 2215 | ShakeItDance | 160 | 10556 |
| 2301 | ComeCloserDance | 146 | 10923 |
| 2539 | EVE-HappyDanc | 132 | 11882 |
| 2125 | strikeoutdance | 129 | 10159 |

完整 45 条（含摘要/下载数/版本）见 **`_probe/atool-catalog.json`**。

## 附录 B：本次产出的探针脚本

| 文件 | 用途 |
|---|---|
| `_probe/atool-layout-probe.js` | 7 种归档形态跑现有 `analyze()` 的识别矩阵 |
| `_probe/atool-catalog.js` | 反向依赖 → 45 个相关 mod + 主文件，输出 JSON |
| `_probe/atool-nexus.js` | 单 mod 文件清单查询 |
| `_probe/atool-search2.js` | 按名搜索（`gameDomainName` 口径） |
