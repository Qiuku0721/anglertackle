@echo off
REM Downloads Temurin JDK 21 (portable zip) and extracts it into .jdk\
REM Uses node (OpenSSL TLS) instead of PowerShell/curl (Schannel blocked in this sandbox).
setlocal
cd /d "%~dp0.."
set URL=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip
set SHA=f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e
set DEST=.jdk\jdk21.zip

echo [1/3] downloading JDK 21 ...
node tools\download.js "%DEST%" "%URL%" "%SHA%"
if errorlevel 1 goto :fail

echo [2/3] extracting to .jdk\ ...
if exist ".jdk\extract" rmdir /s /q ".jdk\extract"
tar -xf "%DEST%" -C ".jdk"
if errorlevel 1 goto :fail
if not exist ".jdk\extract" mkdir ".jdk\extract"

echo [3/3] reporting result ...
for /d %%D in (".jdk\jdk-*") do echo JDK_HOME=%%~fD
if exist ".jdk\jdk-21.0.12.1+1\bin\java.exe" (
  ".jdk\jdk-21.0.12.1+1\bin\java.exe" -version
) else (
  echo WARNING: expected folder .jdk\jdk-21.0.12.1+1 not found, listing .jdk:
  dir /b .jdk
)
echo DONE
exit /b 0

:fail
echo FAILED with errorlevel %errorlevel%
exit /b 1
