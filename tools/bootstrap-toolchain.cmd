@echo off
REM Fast bootstrap: downloads Temurin JDK 21 + Gradle from Chinese mirrors.
REM Sets .jdk\java21 and .jdk\gradle as the portable toolchain.
REM Uses node (OpenSSL TLS) because PowerShell 5.1 / curl Schannel is blocked here.
setlocal
cd /d "%~dp0.."

set JDK_URL=https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip
set JDK_SHA=f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e
set GRADLE_URL=https://mirrors.cloud.tencent.com/gradle/gradle-9.8.0-bin.zip
set GRADLE_SHA=bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c

echo ============================================
echo  [1/4] Temurin JDK 21  (Tsinghua mirror)
echo ============================================
node tools\download.js ".jdk\jdk21.zip" "%JDK_URL%" "%JDK_SHA%"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  [2/4] Extracting JDK
echo ============================================
if exist ".jdk\jdk-21.0.12.1+1" rmdir /s /q ".jdk\jdk-21.0.12.1+1"
tar -xf ".jdk\jdk21.zip" -C ".jdk"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  [3/4] Gradle 9.8.0  (Tencent mirror)
echo ============================================
node tools\download.js ".jdk\gradle.zip" "%GRADLE_URL%" "%GRADLE_SHA%"
if errorlevel 1 goto :fail

if exist ".jdk\gradle-9.8.0" rmdir /s /q ".jdk\gradle-9.8.0"
tar -xf ".jdk\gradle.zip" -C ".jdk"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  [4/4] Verify
echo ============================================
if exist ".jdk\jdk-21.0.12.1+1\bin\java.exe" (
  echo JDK OK:
  ".jdk\jdk-21.0.12.1+1\bin\java.exe" -version
) else (
  echo JDK MISSING - listing .jdk:
  dir /b .jdk
  goto :fail
)
if exist ".jdk\gradle-9.8.0\bin\gradle.bat" (
  echo GRADLE OK
) else (
  echo GRADLE MISSING
  goto :fail
)

echo.
echo ALL DONE
exit /b 0

:fail
echo.
echo BOOTSTRAP FAILED
exit /b 1
