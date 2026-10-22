@echo off
REM Reset anglertackle config (pure ASCII; Chinese UI is in tools\reset-config.ps1).
REM Pass -Force to kill the running java process instead of waiting.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\reset-config.ps1" %*
