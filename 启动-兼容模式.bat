@echo off
title Star Blade Mod Manager (compatibility mode)
setlocal
pushd "%~dp0"

rem Fallback launcher: disables the Chromium process sandbox and uses software
rem rendering. Needed on some virtual machines / remote desktop sessions where
rem the GPU process cannot start at all (symptom: window flashes and disappears).
rem
rem IMPORTANT: these switches have to be ON THE COMMAND LINE, not just appended
rem from JavaScript. The browser-process sandbox is created before main.js runs,
rem so `app.commandLine.appendSwitch('no-sandbox')` comes too late - on a broken
rem sandbox host the process just __debugbreak()s (exit code -2147483645 /
rem 0x80000003) without writing a single log line.
rem
rem Normally you do NOT need this file - the app switches to this mode
rem automatically and remembers it.
set "ELECTRON_RUN_AS_NODE="

set "EXE=%~dp0node_modules\electron\dist\electron.exe"
set "LOG=%~dp0launch-log.txt"
set "COMPAT=--compat --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer"

if not exist "%EXE%" goto :noelectron

echo ==== %DATE% %TIME% ==== >>"%LOG%"

echo Starting Star Blade Mod Manager (compatibility mode) ...
echo.

rem Chromium's native errors go to stderr, which we keep in launch-log.txt.
"%EXE%" "%~dp0." %COMPAT% 2>>"%LOG%"
set "CODE=%ERRORLEVEL%"

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
