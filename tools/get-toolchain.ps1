# get-toolchain.ps1 -- clean stale downloaders, then fetch JDK 21 + Gradle from Chinese mirrors.
#
# Why a script instead of a one-liner: long inline commands got truncated in transit
# and left orphan node downloaders fighting each other. A file cannot be truncated.
#
# ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI/GBK).
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\get-toolchain.ps1
#         powershell ... -File tools\get-toolchain.ps1 -CleanOnly

param(
  [switch]$CleanOnly,
  [switch]$KeepPart
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot      # project root
$jdkDir = Join-Path $root '.jdk'
New-Item -ItemType Directory -Force -Path $jdkDir | Out-Null

Write-Host "project root : $root"
Write-Host "toolchain dir: $jdkDir"
Write-Host ("-" * 64)

# ---------------------------------------------------------------- 1. clean up
$protected = @()
try {
  $protected = netstat -ano | Select-String ':3080\s+.*LISTENING' |
    ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
} catch { }
Write-Host ("protected PIDs (DSH web on 3080): " + ($protected -join ', '))

$killed = 0
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
  if ($protected -contains [string]$_.Id) { return }
  $cmdline = ''
  try {
    $cmdline = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction Stop).CommandLine
  } catch { $cmdline = '(unknown)' }
  if ($cmdline -match 'download\.js|bootstrap-toolchain') {
    Write-Host ("kill stale downloader pid " + $_.Id) -ForegroundColor Yellow
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    $killed++
  } else {
    Write-Host ("keep node pid " + $_.Id + " (not a downloader)") -ForegroundColor DarkGray
  }
}
Write-Host "stale downloaders killed: $killed"
Start-Sleep -Seconds 2

# remove corrupt partial downloads (unless asked to keep)
if (-not $KeepPart) {
  Get-ChildItem $jdkDir -Filter '*.part' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("remove partial: " + $_.Name) -ForegroundColor DarkGray
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
  }
}

if ($CleanOnly) { Write-Host "clean-only mode: done"; exit 0 }

# ---------------------------------------------------------------- 2. download
# Prefer BITS (native, resumable, throttled). Fall back to node if unavailable.
function Get-BitsAvailable {
  try {
    Get-Command Start-BitsTransfer -ErrorAction Stop | Out-Null
    $svc = Get-Service BITS -ErrorAction Stop
    return ($svc.Status -eq 'Running')
  } catch { return $false }
}

$targets = @(
  @{ Name = 'JDK 21 (Temurin 21.0.12.1)'
     Url  = 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'
     Sha  = 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e'
     Out  = (Join-Path $jdkDir 'jdk21.zip')
     Want = (Join-Path $jdkDir 'jdk-21.0.12.1+1\bin\java.exe') },
  @{ Name = 'Gradle 9.8.0'
     Url  = 'https://mirrors.cloud.tencent.com/gradle/gradle-9.8.0-bin.zip'
     Sha  = 'bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c'
     Out  = (Join-Path $jdkDir 'gradle.zip')
     Want = (Join-Path $jdkDir 'gradle-9.8.0\bin\gradle.bat') }
)

$useBits = Get-BitsAvailable
Write-Host ("BITS available: " + $useBits)

foreach ($t in $targets) {
  Write-Host ""
  Write-Host ("=== " + $t.Name + " ===") -ForegroundColor Cyan

  if (Test-Path $t.Want) { Write-Host "already extracted, skip"; continue }

  $needDownload = $true
  if (Test-Path $t.Out) {
    $h = (Get-FileHash $t.Out -Algorithm SHA256).Hash
    if ($h -eq $t.Sha.ToUpper()) { Write-Host "zip hash OK, skip download"; $needDownload = $false }
    else { Write-Host "zip hash mismatch, re-download"; Remove-Item $t.Out -Force }
  }

  if ($needDownload) {
    if ($useBits) {
      try {
        Write-Host ("BITS downloading: " + $t.Url)
        Start-BitsTransfer -Source $t.Url -Destination $t.Out -DisplayName $t.Name -Description 'AnglersTackle toolchain'
      } catch {
        Write-Host ("BITS failed: " + $_.Exception.Message) -ForegroundColor Yellow
        Write-Host "falling back to node downloader"
        node (Join-Path $PSScriptRoot 'download.js') $t.Out $t.Url $t.Sha
        if ($LASTEXITCODE -ne 0) { Write-Host "node download FAILED" -ForegroundColor Red; continue }
      }
    } else {
      node (Join-Path $PSScriptRoot 'download.js') $t.Out $t.Url $t.Sha
      if ($LASTEXITCODE -ne 0) { Write-Host "node download FAILED" -ForegroundColor Red; continue }
    }
  }

  if (Test-Path $t.Out) {
    $size = [math]::Round((Get-Item $t.Out).Length / 1MB, 1)
    $hash = (Get-FileHash $t.Out -Algorithm SHA256).Hash
    if ($hash -ne $t.Sha.ToUpper()) {
      Write-Host ("HASH MISMATCH (" + $hash + ") - not extracting") -ForegroundColor Red
      continue
    }
    Write-Host ("downloaded " + $size + " MB, sha256 OK, extracting ...")
    & tar -xf $t.Out -C $jdkDir
    if (Test-Path $t.Want) { Write-Host "extract OK" -ForegroundColor Green }
    else { Write-Host "extract FAILED (expected file missing)" -ForegroundColor Red }
  }
}

# ---------------------------------------------------------------- 3. verify
Write-Host ""
Write-Host ("-" * 64)
$java = Join-Path $jdkDir 'jdk-21.0.12.1+1\bin\java.exe'
$gradle = Join-Path $jdkDir 'gradle-9.8.0\bin\gradle.bat'

if (Test-Path $java) {
  Write-Host "JDK OK:" -ForegroundColor Green
  & $java -version 2>&1 | ForEach-Object { "  $_" }
} else { Write-Host "JDK MISSING" -ForegroundColor Red }

if (Test-Path $gradle) { Write-Host "Gradle OK: $gradle" -ForegroundColor Green }
else { Write-Host "Gradle MISSING" -ForegroundColor Red }

Write-Host ""
if ((Test-Path $java) -and (Test-Path $gradle)) { Write-Host "TOOLCHAIN READY" -ForegroundColor Green }
else { Write-Host "TOOLCHAIN INCOMPLETE" -ForegroundColor Yellow }
