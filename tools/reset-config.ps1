<#
  重置配置：删掉旧的 anglertackle-common.toml，让游戏下次启动按**当前代码默认值**重新生成。

  为什么需要：NeoForge 对**已存在**的配置文件不会用新默认值覆盖。
  所以改过默认值之后，旧文件里会留着老值，而代码的手感是按新值设计的 —— 两边分叉且无提示。
  这次就踩到了：文件里躺着 9 项旧默认值，其中提竿窗口 0.75 秒（应为 2.0）、
  张力上限 ×1.6（应为 ×3.0，导致金线红线被钳成一样）。

  用法：
    关掉游戏后双击 重置配置.bat
    不想手动关游戏：重置配置.bat -Force（强制结束 java 进程；存档可能丢，慎用）
#>
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = '垂纶 · 重置配置'

$CfgDir = 'D:\mc\PCL 正式版 2.13.1.1\.minecraft\versions\1.21.1-NeoForge_21.1.250\config'
$Cfg = Join-Path $CfgDir 'anglertackle-common.toml'

# 工程根：从脚本所在目录往上找，直到看见 gradle.properties。
# 不写死"父目录" —— 脚本被复制到别处运行时，写死的相对层级会算错，
# 把备份丢到莫名其妙的路径下（写这个脚本时测试就踩到了，
# New-Item 试图在 %TEMP%\参考资料 下建目录）。
$Root = $PSScriptRoot
while ($Root -and -not (Test-Path (Join-Path $Root 'gradle.properties'))) {
  $parent = Split-Path -Parent $Root
  if (-not $parent -or $parent -eq $Root) { $Root = $null; break }
  $Root = $parent
}
if (-not $Root) { $Root = $PSScriptRoot }
$BackupDir = Join-Path $Root '参考资料'

function L($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

L ''
L '  === 重置《垂纶》配置 ===' 'Cyan'
L ''

<#
  判断"游戏是否在跑"。

  ⚠️ 不能简单地 Get-Process java —— 构建用的 **Gradle 守护进程**也是一条 java，
  而且它常驻不退出。原先的写法会把它当成游戏，于是永远卡在"等待游戏关闭"，
  文件根本删不掉（实际踩到：等了 5 分钟，而游戏从来没开过）。

  区分办法：按**可执行文件路径**。本工程自己的 JDK 在 <工程根>\.jdk\ 下，
  那条 java 是 Gradle 守护进程，不是游戏。
#>
function Get-RunningGame {
  $mine = Join-Path $Root '.jdk'
  Get-Process java, javaw, javawx -ErrorAction SilentlyContinue | Where-Object {
    $path = $null
    try { $path = $_.Path } catch { }
    if (-not $path) { return $true }                  # 取不到路径就保守当成游戏
    if ($mine -and $path.StartsWith($mine, 'OrdinalIgnoreCase')) { return $false }  # 我们自己的 JDK
    return $true
  }
}

function Show-JavaProcs {
  $all = Get-Process java, javaw, javawx -ErrorAction SilentlyContinue
  if (-not $all) { L '  当前没有 java 进程' 'DarkGray'; return }
  L '  当前 java 进程：' 'DarkGray'
  foreach ($p in $all) {
    $path = ''
    try { $path = $p.Path } catch { }
    $ours = $path -and (Join-Path $Root '.jdk') -and $path.StartsWith((Join-Path $Root '.jdk'), 'OrdinalIgnoreCase')
    $tag = if ($ours) { '  ← 这是 Gradle 构建进程，不是游戏' } else { '  ← 可能是游戏' }
    L ("    PID {0}  {1}{2}" -f $p.Id, $path, $tag) 'DarkGray'
  }
}

# 1) 等游戏退出（最多等 5 分钟）
#    -Force：不等，直接结束进程（存档可能丢，所以默认不做，要显式要求）
$game = Get-RunningGame
if ($game) { Show-JavaProcs }

$waited = 0
while ($game -and $waited -lt 300) {
  if ($Force) {
    L '  [-Force] 强制结束检测到的游戏进程…' 'Yellow'
    $game | ForEach-Object {
      try { $_.Kill(); L ("    已结束 PID {0}" -f $_.Id) 'DarkGray' } catch { }
    }
    Start-Sleep -Seconds 3
    $game = Get-RunningGame
    continue
  }
  if ($waited -eq 0) {
    L '  检测到疑似游戏的 java 进程。请关掉游戏 —— 关了会自动继续。' 'Yellow'
    L '  （不想手动关可以改用：重置配置.bat -Force）' 'DarkGray'
  }
  Start-Sleep -Seconds 3
  $waited += 3
  $game = Get-RunningGame
  if ($waited % 30 -eq 0) { L ("  等待中… {0} 秒" -f $waited) 'DarkGray' }
}
if ($game) {
  L '  等了 5 分钟还没关。请关掉游戏后重新运行本脚本。' 'Red'
  L ''
  Read-Host '  按回车关闭'
  return
}
L '  ✅ 可以继续（没有检测到游戏进程）' 'Green'

# 2) 备份 + 删除
if (-not (Test-Path $Cfg)) {
  L '  配置文件本来就不存在，无需删除。启动游戏即可生成新文件。' 'Green'
} else {
  $bk = Join-Path $Root ("参考资料\_config_备份_{0}.toml" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
  New-Item -ItemType Directory -Force -Path (Split-Path $bk) | Out-Null
  Copy-Item $Cfg $bk -Force
  L ("  已备份到 参考资料\{0}" -f (Split-Path $bk -Leaf)) 'DarkGray'
  try {
    Remove-Item $Cfg -Force -ErrorAction Stop
    L '  ✅ 已删除旧配置' 'Green'
  } catch {
    L ("  ❌ 删除失败：{0}" -f $_.Exception.Message) 'Red'
    L '     可能是启动器还占着文件，或者权限不足。' 'Yellow'
    L ''
    Read-Host '  按回车关闭'
    return
  }
}

L ''
L '  下一步：启动游戏 —— 它会按当前代码默认值重新生成配置文件。' 'White'
L '  进游戏后可以敲 /atl config list 核对生效值。' 'DarkGray'
L ''
Read-Host '  按回车关闭'
