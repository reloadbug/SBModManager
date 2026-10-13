'use strict';
/**
 * 探针引导：**让探针跑在与正式应用完全相同的 userData 目录下**。
 *
 * ## 为什么必须有这个
 *
 * `electron .` 会把 appPath 认成项目根，于是 `app.getName()` 读到 package.json 的
 * `productName` → userData = `%APPDATA%\剑星 Mod 管理器`。
 *
 * 但 `electron _probe/xxx.js` 的 appPath 是 **`_probe` 目录**（那儿没有 package.json），
 * app 名退化成默认的 `Electron` → userData = `%APPDATA%\Electron`。
 *
 * 后果非常隐蔽（2026-10-13 实测踩到）：
 *   · `persist:nexus` 分区在那边是**另一个空会话** —— cookie 全无、未登录
 *   · 未登录时 Nexus 页面渲染成 guest，成人内容默认关闭
 *   · 于是 mod 页只给出「Adult content disabled」+ 站点头尾，正文一个按钮都没有
 *   · 探针会一本正经地报「页面上没有下载按钮」「会话失效」—— 全是假象
 *
 * 更坑的是：这个坑早先的探针也踩过（`nexus-files-dom.js` v1 的结论
 * 「cookieCount=0（会话失效）」多半就是这么来的），结论被写进了文档。
 *
 * 用法：在探针里**第一行** require 它（必须在 app ready 之前）：
 *     require('./_appctx');
 */
const path = require('path');
const { app } = require('electron');

const NAME = '剑星 Mod 管理器';

try { app.setName(NAME); } catch { /* 忽略 */ }
try { app.setPath('userData', path.join(app.getPath('appData'), NAME)); } catch { /* 忽略 */ }

module.exports = { NAME, userData: () => app.getPath('userData') };
