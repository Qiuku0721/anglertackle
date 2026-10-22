@echo off
REM Angler's Tackle - dev tuning entry (pure ASCII on purpose).
REM Chinese UI lives in tools\dev-menu.ps1: cmd parses .bat as GBK,
REM so UTF-8 Chinese here would be split into bogus commands
REM (seen: "'Config' is not recognized as an internal or external command").
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\dev-menu.ps1"
