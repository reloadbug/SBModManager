@echo off
title Star Blade Mod Manager (compatibility mode)
setlocal
pushd "%~dp0"

rem Fallback launcher: disables the Chromium process sandbox and uses software
rem rendering. Needed on some virtual machines / remote desktop sessions where
rem the GPU process cannot start at all (symptom: window flashes and disappears).
rem
rem Normally you do NOT need this file - the app switches to this mode
rem automatically and remembers it.
set "ELECTRON_RUN_AS_NODE="

set "EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%EXE%" goto :noelectron

echo Starting Star Blade Mod Manager (compatibility mode) ...
echo.

"%EXE%" "%~dp0." --compat

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
