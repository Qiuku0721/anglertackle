@echo off
rem ===========================================================================
rem  game-ime.bat -- double-click launcher for the "auto switch to English
rem  keyboard layout while in game" watcher.  See tools\game-ime.ps1 for why.
rem
rem  IMPORTANT: this file must stay PURE ASCII.
rem  cmd.exe reads .bat in the OEM code page. Any non-ASCII byte in here gets
rem  mis-decoded, and the broken bytes can eat the beginning of the following
rem  line -- we hit exactly that: "powershell" arrived as "werShell".
rem  Paths are expanded with %~dp0, so nothing non-ASCII is needed even though
rem  the project path itself contains Chinese.
rem ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0game-ime.ps1" %*
if errorlevel 1 pause
