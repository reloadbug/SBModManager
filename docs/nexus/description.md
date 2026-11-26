[img]https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/01-mod-library.png[/img]

[size=6][b]剑星 Mod 管理器（SBModManager）[/b][/size]

一款专为《剑星 / Stellar Blade》打造的 Windows 桌面 Mod 管理器。管理、下载、安装、启停、卸载一条龙，Nexus 登录一次即可全自动下载安装。

[size=5][b]主要特性[/b][/size]

[list]
[*][b]Mod 库三态合一[/b]：已安装 / 已下载 / 未下载在同一页，状态 + 标记 + 分类 + 排序四组筛选；排序支持开启时间 / 禁用时间 / 安装时间 / 名称正反双向
[*][b]全自动下载安装[/b]：Nexus 登录一次，点「下载」即自动授权 → 下载 → 识别结构 → 安装 → 登记，无需逐个去网页点
[*][b]生命周期档案[/b]：下载 / 安装 / 开启 / 禁用 / 卸载全程记录，精确到毫秒；详情里有状态变更时间线
[*][b]崩溃回退[/b]：游戏崩溃后，按时间段查出这段时间新开启的 Mod，勾选批量禁用（只禁不重装）
[*][b]冲突检测[/b]：安装前预检 + 全局扫描，按 CNS UniqueFitID 撞车判冲突，左右两列封面对比选留哪个
[*][b]CNS 游戏内名称[/b]：解析 dekcns 的 DisplayName（游戏里显示的名字）进详情与搜索，不再靠文件名猜
[*][b]多文件 / 子 Mod[/b]：一个包里多套内容可各自单独装卸；逐文件安装账本，改名、关闭、换目录都不会对不上
[*][b]覆盖前对比 + 自动备份[/b]：会被覆盖的文件列出归属方、并列显示双方图集；原文件先备份，卸载可还原
[*][b]本地缓存[/b]：封面与图集下载一次存本地，离线也能看；说明一键翻译成中文并永久缓存
[*][b]14 种语言[/b]：简体中文为原文，另 13 种完整语言包，跟随系统语言自动切换
[/list]

[size=5][b]界面预览[/b][/size]

[list]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/01-mod-library.png]Mod 库（三态合一）[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/02-installed.png]已安装 Mod[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/03-download-queue.png]下载队列[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/04-prereqs.png]前置组件[/url]
[*][url=https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/05-settings.png]设置[/url]
[/list]

[size=5][b]安装[/b][/size]

安装包（setup.exe）固定安装到 [b]D:\Program Files\sbmodmanager[/b]，下载的安装包库随程序放在安装目录的 library\ 下，升级覆盖不会删库。便携版（portable.exe）双击即用、放哪都行。需 Windows 10/11 x64。

[url=https://github.com/reloadbug/SBModManager/releases/latest]最新版下载 / 完整更新日志[/url] · [url=https://github.com/reloadbug/SBModManager]项目主页与源码[/url]

[size=5][b]说明[/b][/size]

[list]
[*]初次使用需安装前置组件：UE4SS（Mod 加载器）与 CNS（服装框架），程序内有内置安装助手。
[*]浏览 Nexus 不需要 API Key；下载需要登录 Nexus 账号。免费账号即可，程序调用网页按钮背后的站内端点自动授权，不伪造 key、不绕 Cloudflare 验证。
[*]数据（配置 / 注册表 / 时间线 / 黑名单）默认跟随游戏目录的 .sbmod，换机器跟游戏一起走。
[/list]
