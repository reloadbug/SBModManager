# Nexus 发布素材 · SBModManager 0.9.20

## 上传能力说明（先读）

管理器的登录状态**不是上传权限**：
- `nexusApiKey` = GraphQL **读**接口（查 mod 信息）。
- `persist:nexus` cookie = 自动**下载** mod（点下载按钮）。

Nexus 发布 mod 必须走网站上传表单（multipart + 登录 cookie + 分类/版本/说明），且 Cloudflare 会拦非浏览器请求。所以**无法从管理器直接上传**。以下是全部素材，网页上传时直接用。

## 发布信息

- 游戏：`Steel Blade`（Stellar Blade）
- 分类：Tools / Utility（管理器工具，非游戏内服装）
- 标题：`SBModManager - Mod Manager for Stellar Blade`
- 版本：`0.9.20`
- 主页：`https://github.com/reloadbug/SBModManager`

## 文件

1. `SBModManager-0.9.20-nexus.zip` — 含 setup.exe + portable.exe + 本说明
2. `description.md` — 完整描述（含 5 张截图外链）
3. `short-description.txt` — 短描述

截图已托管在 GitHub Release，描述里外链，不用重复上传：
`https://github.com/reloadbug/SBModManager/releases/download/v0.9.20/0X-*.png`
