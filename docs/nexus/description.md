[img]https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/01-mod-library.png[/img]

[size=6][b]剑星 Mod 管理器 · SBModManager[/b][/size]
[size=5][i]Stellar Blade Mod Manager[/i][/size]

一款专为《剑星 / Stellar Blade》打造的 Windows 桌面 Mod 管理器。管理、下载、安装、启停、卸载一条龙，Nexus 登录一次即可全自动下载安装。
A Windows desktop mod manager built for Stellar Blade. Manage, download, install, enable/disable and uninstall mods in one place — sign in to Nexus once and downloads install fully automatically.

[size=5][b]主要特性 / Features[/b][/size]

[list]
[*][b]Mod 库三态合一[/b] — 已安装 / 已下载 / 未下载在同一页，状态 + 标记 + 分类 + 排序四组筛选，排序支持开启 / 禁用 / 安装时间正反双向。
    [b]Unified mod library[/b] — installed / downloaded / online in one page; filter by status, tags, category and sort; sort by enable / disable / install time in both directions.
[*][b]全自动下载安装[/b] — Nexus 登录一次，点「下载」即自动授权 → 下载 → 识别 → 安装 → 登记，无需逐个去网页点。
    [b]One-click download & install[/b] — sign in to Nexus once; one click auto-authorizes, downloads, detects structure, installs and registers. No per-mod web clicks.
[*][b]生命周期档案[/b] — 下载 / 安装 / 开启 / 禁用 / 卸载全程记录，精确到毫秒；详情里有状态变更时间线。
    [b]Lifecycle history[/b] — every download / install / enable / disable / uninstall logged to the millisecond, with a status-change timeline in the details.
[*][b]崩溃回退[/b] — 游戏崩溃后按时间段查出这段时间新开启的 Mod，勾选批量禁用（只禁不重装）。
    [b]Crash rollback[/b] — after a crash, pick a time window to find mods enabled in it and batch-disable them (disable only, no reinstall).
[*][b]冲突检测[/b] — 安装前预检 + 全局扫描，按 CNS UniqueFitID 撞车判冲突，左右两列封面对比选留哪个。
    [b]Conflict detection[/b] — pre-install check and global scan; flags CNS UniqueFitID collisions and shows two-column cover art to choose which to keep.
[*][b]CNS 游戏内名称[/b] — 解析 dekcns 的 DisplayName（游戏里显示的名字）进详情与搜索，不再靠文件名猜。
    [b]In-game names[/b] — reads each dekcns DisplayName (the name shown in-game) into details and search; no more guessing from file names.
[*][b]多文件 / 子 Mod[/b] — 一个包里多套内容可各自单独装卸；逐文件安装账本，改名、关闭、换目录都不会对不上。
    [b]Multi-file / sub-mods[/b] — install or uninstall each variant in a pack separately; per-file ledger stays accurate through renames, disables and game-folder moves.
[*][b]覆盖前对比 + 自动备份[/b] — 列出会被覆盖文件的归属方、并列显示双方图集；原文件先备份，卸载可还原。
    [b]Overwrite compare + backup[/b] — shows which mod owns files about to be overwritten with side-by-side galleries; originals are backed up and restorable on uninstall.
[*][b]本地缓存[/b] — 封面与图集下载一次存本地，离线也能看；说明一键翻译成中文并永久缓存。
    [b]Local cache[/b] — covers and galleries cached locally for offline viewing; one-click translation to Chinese, cached permanently.
[*][b]14 种语言[/b] — 简体中文为原文，另 13 种完整语言包，跟随系统语言自动切换。
    [b]14 languages[/b] — Simplified Chinese is the source, plus 13 complete language packs; follows your system language automatically.
[/list]

[size=5][b]界面预览 / Screenshots[/b][/size]

[list]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/01-mod-library.png]Mod 库（三态合一）/ Mod library (three states)[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/02-installed.png]已安装 Mod / Installed mods[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/03-download-queue.png]下载队列 / Download queue[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/04-prereqs.png]前置组件 / Prerequisites[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/05-settings.png]设置 / Settings[/url]
[/list]

[size=5][b]安装 / Installation[/b][/size]

安装包（setup.exe）固定安装到 [b]D:\Program Files\sbmodmanager[/b]，下载的安装包库随程序放在安装目录的 library\ 下，升级覆盖不会删库。便携版（portable.exe）双击即用、放哪都行。需 Windows 10/11 x64。
The installer (setup.exe) installs to [b]D:\Program Files\sbmodmanager[/b]; the download library lives in library\ next to the app and is never deleted on upgrade. The portable build runs from anywhere. Requires Windows 10/11 x64.

[url=https://github.com/reloadbug/SBModManager/releases/latest]最新版下载 / 更新日志 · Latest release / changelog[/url] · [url=https://github.com/reloadbug/SBModManager]项目主页与源码 · Home & source[/url]

[size=5][b]说明 / Notes[/b][/size]

[list]
[*]初次使用需安装前置组件：UE4SS（Mod 加载器）与 CNS（服装框架），程序内有内置安装助手。 / First run needs prerequisites: UE4SS (mod loader) and CNS (outfit framework); built-in install assistant provided.
[*]浏览 Nexus 不需要 API Key；下载需要登录 Nexus 账号。免费账号即可，程序调用网页按钮背后的站内端点自动授权，不伪造 key、不绕 Cloudflare 验证。 / Browsing needs no API key; downloading needs a Nexus login (free account is fine). Authorization uses the site's own endpoint behind the download button — no fake keys, no Cloudflare bypass.
[*]数据（配置 / 注册表 / 时间线 / 黑名单）默认跟随游戏目录的 .sbmod，换机器跟游戏一起走。 / Data (config / registry / history / blacklist) follows the game folder in .sbmod by default, so it travels with your game.
[/list]
