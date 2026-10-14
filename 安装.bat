@echo off
title 剑星 Mod 管理器 - 一键安装
echo.
echo   ===============================================
echo     剑星 Mod 管理器 (SBModManager)  一键安装
echo   ===============================================
echo.
echo   正在调用 PowerShell 安装脚本，请稍候……
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
echo   按任意键关闭本窗口……
pause >nul
