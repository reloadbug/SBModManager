@echo off
title Star Blade Mod Manager
setlocal
pushd "%~dp0"

rem --- IMPORTANT ---
rem Clear ELECTRON_RUN_AS_NODE. If it is set, Electron degrades into a plain
rem Node process and the app fails with "Cannot read properties of undefined".
set "ELECTRON_RUN_AS_NODE="

set "EXE=%~dp0node_modules\electron\dist\electron.exe"
set "LOG=%~dp0launch-log.txt"
set "COMPAT=--compat --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer"

if not exist "%EXE%" goto :noelectron

echo ==== %DATE% %TIME% ==== >>"%LOG%"

echo Starting Star Blade Mod Manager ...
echo (keep this window open; closing it closes the app)
echo.

rem stderr (where Chromium prints its native errors) goes to launch-log.txt,
rem stdout stays in this window.
"%EXE%" "%~dp0." 2>>"%LOG%"
set "CODE=%ERRORLEVEL%"

rem Fallback: if the very first start fails, retry once with the compatibility
rem switches. Exit code -2147483645 (0x80000003) means the Chromium browser
rem process died before any of our JavaScript ran (sandbox / named-pipe access
rem denied), so the app cannot heal itself - the launcher has to pass the
rem switches.
if "%CODE%"=="0" goto :report

echo.
echo  [!] Startup failed (exit code %CODE%).
echo      Retrying in compatibility mode (no sandbox / software rendering) ...
echo.

"%EXE%" "%~dp0." %COMPAT% 2>>"%LOG%"
set "CODE=%ERRORLEVEL%"

:report
echo.
echo App exited with code %CODE%.
if not "%CODE%"=="0" echo Native errors were appended to: %LOG%
pause
goto :done

:noelectron
echo.
echo  [ERROR] Electron runtime not found:
echo      %EXE%
echo.
echo  Open a terminal in this folder and run:
echo      npm install
pause

:done
popd
endlocal
