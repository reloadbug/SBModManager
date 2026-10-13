@echo off
title Star Blade Mod Manager
setlocal
pushd "%~dp0"

rem --- IMPORTANT ---
rem Clear ELECTRON_RUN_AS_NODE. If it is set, Electron degrades into a plain
rem Node process and the app fails with "Cannot read properties of undefined".
set "ELECTRON_RUN_AS_NODE="

set "EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%EXE%" goto :noelectron

echo Starting Star Blade Mod Manager ...
echo (keep this window open; closing it closes the app)
echo.

"%EXE%" "%~dp0."

echo.
echo App exited with code %ERRORLEVEL%.
pause
goto :done

:noelectron
echo.
echo  [ERROR] Electron runtime not found:
echo      %EXE%
echo.
echo  Open a terminal in this folder and run:
echo      npm install
echo.
pause

:done
popd
endlocal
