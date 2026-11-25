# 给改这个仓库的助手看

## 每次改完都要打包

用户实际在用的是仓库根目录的 `SBModManager-<版本>-portable.exe`，**源码改了不打包，用户就还在用旧版**。
所以每次做完功能 / 修完 bug，收尾必须走完这一串：

1. `npm run test:all`（探针全绿再往下走）
2. 改 `package.json` 的 `version` + 在 `CHANGELOG.md` 顶部加同版本小节（`### 新增` / `### 修改` / `### 测试`）
3. `npm run dist`（入口是 `build/dist.js`，它负责设 npmmirror 镜像；直接调 electron-builder 会卡在下载上）
4. `node build\portable.js` 把 `dist\SBModManager-<版本>-portable.exe` 复制到仓库根目录，
   **并且把 exe 的完整性级别改成 Medium** —— 复制这一动作必须走这个脚本，不要手工拖。

打包相关细节见 `README.md` 的「打包」一节（旧 `dist\` 里有 73 个文件时要先逐项搬走，否则会撞批量删除护栏）。

## 🚨 安装 = 覆盖，绝不许删用户数据（2026-11-25 血泪教训）

**事故**：把 library 挪到安装目录（`D:\Program Files\sbmodmanager\library`）后，做了一次版本升级覆盖安装，
14.5 GB / 336 个 mod 安装包被**全部清空**。根因：electron-builder 的 NSIS 在「升级」时会先跑**旧版本的卸载器**，
而官方卸载模板 `uninstaller.nsh` 在未定义 `customRemoveFiles` 时默认执行 `RMDir /r $INSTDIR` ——
它会连安装目录里所有非清单文件（包括我们的 `library\`）一起删掉。

**铁律**：安装/升级/重装**只做文件覆盖，永远不做删除用户数据的操作**。用户数据 = library、下载的游戏 mod、
config、历史档案等，任何情况下安装流程都不得删。要删只能由用户在界面里显式操作。

**已落地的防护**：`build/installer.nsh` 定义了 `!macro customRemoveFiles`，只删已知的程序载荷
（exe/dll/pak/dat/bin/json/txt/html/ico + locales\ + resources\），**明确不碰 `$INSTDIR\library`**。
这个宏**绝对不能删**，删了升级又会清库。任何改动安装脚本时必须先验证：
「升级覆盖安装后 library 文件数/字节数不变」。验证方法：装前记 `Get-ChildItem library -Recurse | Measure-Object Length -Sum`，
覆盖装后再记一次，必须完全一致；不一致就是回归，立刻停手恢复数据（源备份在 `D:\AI game\StarBladeModManager\data\library`）。

操作纪律：动 14GB 数据前先确认源还在、先 robocopy 不删源、验证通过再谈清理；用户说「真搬家删源」也只是指
验证完成后手动清理，任何自动流程不得含删除。

## 低完整性标签会毒化签名外的所有可执行文件

工作区根目录曾被标成 `Mandatory Label\Low Mandatory Level`（沙箱工具写的）。从那儿复制出来的 exe
会继承低完整性，Windows 会让它启动的进程也跑在低完整性上 —— 于是：

- 免安装版（NSIS，要先解到 `%TEMP%`）双击报 `Error writing temporary file. Make sure your temp folder is valid.`；
- 安装/写入游戏目录时 `EPERM`。

排查与修复：

```powershell
icacls "SBModManager-<版本>-portable.exe" | findstr Mandatory        # 看到 Low 就不对
icacls "SBModManager-<版本>-portable.exe" /setintegritylevel M       # 单个文件
icacls "D:\AI game\StarBladeModManager" /setintegritylevel "(OI)(CI)M"   # 目录，之后新建的子项才是 Medium
```

## 用户定下的界面硬规则（改动前必读）

完整总账在技能 `starblade-modmanager`（`~/.dsh/skills/starblade-modmanager/SKILL.md`），这里只留最容易违反的几条：

- **任何控件不得重叠、不得超出界面范围**；放不下就自动换行 / 自动布局，不许硬塞。
- 卡片自上而下：**顶端标签行（小巧、统一风格）→ 标题/副标题 → 元信息 → 底部操作按钮**；封面上只放图，不叠状态徽标；同一个信息不许出现两次。
- 界面文字**最多 4 个字**，细节放进 `title` 悬停提示（写清"是什么 / 现在什么态 / 点了会怎样"）。
- 同一区域的 chip / 按钮 / 下拉**统一规格**：高 24px、圆角 7px、字号 11.5px。
- 顶部条分三块：**筛选（状态 / 信息 / 标记）· 排序 · 操作**；吸顶区高度目标 ≤200px。
- 标记是**三态循环**（任意 → 排除 → 只看 → 任意；负面标记默认排除）；状态以磁盘为准。
- **测试不许弹窗打扰用户**：自动化验证必须带 `--shot=…` 走静默模式。
- 大改动**先讲规划再动手**，等用户点头。

## 这台机器的环境事实

- **系统里没有全局 `node`**。跑 `_probe/*.js` 与 `tests/selftest.js` 用：
  `$env:ELECTRON_RUN_AS_NODE='1'; & 'node_modules\electron\dist\electron.exe' '_probe\xxx.js'`
  打包反过来：**不能带** `ELECTRON_RUN_AS_NODE`，直接
  `& 'node_modules\electron\dist\electron.exe' 'build\dist.js' --win`。
- 界面自动化验证靠主进程的 `--shot=<png> --shot-page=<p-xxx> --shot-eval-file=<js> --shot-delay=<ms>`
  （见 `src/main/index.js` 的 `setupScreenshotMode()`，注入脚本里的 `return` 会打到 stdout 的 `SHOT_EVAL`）。

## 代码约定（容易踩的几条）

- 渲染层**直接用中文写界面**是安全的：`i18n.js` 是「中文原文即 key」的后处理翻译，`_probe/i18n-test.js`
  只校验 13 个语言包与 `_probe/i18n-keys.json` 键集合严格一致（当前 1301 条，改文案必须走 `_probe/i18n-add-keys.js`）。**不要随手往 keys.json 或语言包里加键**，
  否则那个断言会红。
- `scanner.scan(root, registry, links)` 的 `registry` 必填，探针里传 `null` 会抛
  `Cannot read properties of null (reading 'get')`。
- `ipc.listMods()` 返回 `{ installed, root }` 外壳，不是数组。
- `crashLog.inventory()` 的 `ext` 键是**带点**的扩展名（`.pak` / `.ucas` / `.utoc`）。
- `readSource()` 只认崩溃目录 / 游戏日志目录 / UE4SS 目录里的路径，测「目录外拒绝」要用 `kind:'file'`。
