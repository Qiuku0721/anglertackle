@echo off
REM ============================================================================
REM  gradlew.cmd -- Angler's Tackle build wrapper (no gradle-wrapper.jar needed)
REM
REM  Why a custom wrapper:
REM   1) The project path contains Chinese characters. Gradle reads
REM      gradle.properties as ISO-8859-1, so "org.gradle.java.home=<path with
REM      Chinese>" becomes mojibake and fails with "Java home supplied is
REM      invalid". Passing the same value on the command line is safe because it
REM      bypasses the properties file entirely.
REM   2) This machine cannot reach GitHub / services.gradle.org / maven.neoforged.net,
REM      so the JDK + Gradle are fetched once from Chinese mirrors by
REM      tools\get-toolchain.ps1 into .jdk\ and reused afterwards.
REM
REM  Usage:
REM     tools\gradlew.cmd build            # build the mod jar
REM     tools\gradlew.cmd runClient        # launch a dev client with the mod
REM     tools\gradlew.cmd runData          # generate data (recipes/loot/models)
REM     tools\gradlew.cmd --stop           # stop the Gradle daemon
REM ============================================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
pushd "%ROOT%" || exit /b 1
set "ROOT=%CD%"

REM ---- 1. locate Gradle -------------------------------------------------------
set "GRADLE_BIN=%ROOT%\.jdk\gradle-9.8.0\bin\gradle.bat"
if not exist "%GRADLE_BIN%" (
  where gradle >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%G in ('where gradle') do set "GRADLE_BIN=%%G"
  )
)
if not exist "%GRADLE_BIN%" (
  echo.
  echo ERROR: Gradle not found.
  echo   Run tools\get-toolchain.ps1 first to download JDK 21 + Gradle 9.8:
  echo     powershell -NoProfile -ExecutionPolicy Bypass -File tools\get-toolchain.ps1
  echo.
  popd & exit /b 1
)

REM ---- 2. locate JDK 21 ------------------------------------------------------
set "JAVA_HOME_LOCAL="
for /d %%D in ("%ROOT%\.jdk\jdk-21*") do set "JAVA_HOME_LOCAL=%%~fD"
if not defined JAVA_HOME_LOCAL (
  echo.
  echo ERROR: portable JDK 21 not found under .jdk\
  echo   Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools\get-toolchain.ps1
  echo.
  popd & exit /b 1
)
set "JAVA_HOME=%JAVA_HOME_LOCAL%"

REM ---- 3. keep all Gradle state inside the project (sandbox-writable) --------
if not defined GRADLE_USER_HOME set "GRADLE_USER_HOME=%ROOT%\.gradle-home"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"

echo [gradlew] JAVA_HOME        = %JAVA_HOME%
echo [gradlew] GRADLE_USER_HOME = %GRADLE_USER_HOME%
echo [gradlew] args             = %*
echo.

REM ---- 4. run -----------------------------------------------------------------
REM -Dorg.gradle.java.home on the command line: avoids the ISO-8859-1 property issue
call "%GRADLE_BIN%" -p "%ROOT%" %* "-Dorg.gradle.java.home=%JAVA_HOME%"
set "RC=%ERRORLEVEL%"

popd
endlocal & exit /b %RC%
