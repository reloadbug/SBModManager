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

## 这台机器的环境事实

- **系统里没有全局 `node`**。跑 `_probe/*.js` 与 `tests/selftest.js` 用：
  `$env:ELECTRON_RUN_AS_NODE='1'; & 'node_modules\electron\dist\electron.exe' '_probe\xxx.js'`
  打包反过来：**不能带** `ELECTRON_RUN_AS_NODE`，直接
  `& 'node_modules\electron\dist\electron.exe' 'build\dist.js' --win`。
- 界面自动化验证靠主进程的 `--shot=<png> --shot-page=<p-xxx> --shot-eval-file=<js> --shot-delay=<ms>`
  （见 `src/main/index.js` 的 `setupScreenshotMode()`，注入脚本里的 `return` 会打到 stdout 的 `SHOT_EVAL`）。

## 代码约定（容易踩的几条）

- 渲染层**直接用中文写界面**是安全的：`i18n.js` 是「中文原文即 key」的后处理翻译，`_probe/i18n-test.js`
  只校验 13 个语言包与 `_probe/i18n-keys.json` 键集合严格一致（1228 条）。**不要随手往 keys.json 或语言包里加键**，
  否则那个断言会红。
- `scanner.scan(root, registry, links)` 的 `registry` 必填，探针里传 `null` 会抛
  `Cannot read properties of null (reading 'get')`。
- `ipc.listMods()` 返回 `{ installed, root }` 外壳，不是数组。
- `crashLog.inventory()` 的 `ext` 键是**带点**的扩展名（`.pak` / `.ucas` / `.utoc`）。
- `readSource()` 只认崩溃目录 / 游戏日志目录 / UE4SS 目录里的路径，测「目录外拒绝」要用 `kind:'file'`。
