@echo off
REM Angler's Tackle - tuner launcher (release build).
REM This file is intentionally pure ASCII: cmd parses .bat as GBK, so UTF-8 Chinese
REM here would be mangled, and storing it as ASCII would turn Chinese into '?'.
REM All Chinese UI lives in tools\tuner-launcher.ps1 (UTF-8 with BOM).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tuner-launcher.ps1"
