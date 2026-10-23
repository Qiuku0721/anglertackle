@echo off
REM ============================================================================
REM  gradlew.cmd -- Angler's Tackle build wrapper (no gradle-wrapper.jar needed)
REM
REM  Toolchain: JDK 25 + Gradle 9.6.1, both pre-installed on this machine.
REM  services.gradle.org / maven.neoforged.net / plugins.gradle.org are not
REM  reachable here, so this script only uses local paths and never downloads
REM  a JDK or a Gradle distribution.
REM
REM  Why a custom wrapper:
REM   1) The project path contains Chinese characters. Gradle reads
REM      gradle.properties as ISO-8859-1, so "org.gradle.java.home=<path with
REM      Chinese>" becomes mojibake and fails with "Java home supplied is
REM      invalid". Passing the same value on the command line is safe because it
REM      bypasses the properties file entirely.
REM   2) The default Gradle home (%USERPROFILE%\.gradle) already holds the
REM      shared MDG / NeoForm / NeoForge cache. Do NOT point GRADLE_USER_HOME at
REM      a project-local .gradle-home: that cache would be empty.
REM
REM  Usage:
REM     tools\gradlew.cmd build            # build the mod jar
REM     tools\gradlew.cmd :compileJava     # compile only
REM     tools\gradlew.cmd runClient        # launch a dev client with the mod
REM     tools\gradlew.cmd runData          # generate data (recipes/loot/models)
REM     tools\gradlew.cmd --stop           # stop the Gradle daemon
REM ============================================================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
pushd "%ROOT%" || exit /b 1
set "ROOT=%CD%"

REM ---- 1. locate Gradle 9.6.1 -------------------------------------------------
set "GRADLE_BIN=%USERPROFILE%\.gradle\wrapper\dists\gradle-9.6.1-bin\4ticwg1pgcbps2hj28r8so764\gradle-9.6.1\bin\gradle.bat"
if not exist "%GRADLE_BIN%" (
  where gradle >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%G in ('where gradle') do set "GRADLE_BIN=%%G"
  )
)
if not exist "%GRADLE_BIN%" (
  echo.
  echo ERROR: Gradle 9.6.1 not found.
  echo   Expected: %USERPROFILE%\.gradle\wrapper\dists\gradle-9.6.1-bin\...
  echo.
  popd ^& exit /b 1
)

REM ---- 2. locate JDK 25 -------------------------------------------------------
set "JAVA_HOME_LOCAL=%USERPROFILE%\.jdks\ms-25.0.4.1"
if not exist "%JAVA_HOME_LOCAL%\bin\java.exe" (
  echo.
  echo ERROR: portable JDK 25 not found at %JAVA_HOME_LOCAL%
  echo   Install it under %%USERPROFILE%%\.jdks\ or pass your own JDK path.
  echo.
  popd ^& exit /b 1
)
set "JAVA_HOME=%JAVA_HOME_LOCAL%"

REM ---- 3. use the default Gradle home (%USERPROFILE%\.gradle) -----------------
set "GRADLE_USER_HOME=%USERPROFILE%\.gradle"
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
endlocal ^& exit /b %RC%
