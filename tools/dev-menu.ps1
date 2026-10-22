<#
  调参菜单（开发迭代入口）。
  由 调参器.bat 调用 —— 中文交互全部放在这里，
  因为 .bat 用 UTF-8 存中文会被 cmd 按 GBK 错切（踩过：'Config' 不是内部或外部命令）。
  .ps1 用 UTF-8 with BOM，PowerShell 能正确读。
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Host.UI.RawUI.WindowTitle = '垂纶 · 调参入口'

function L($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

Clear-Host
L ''
L '  ╔══════════════════════════════════════════════════════╗' 'Cyan'
L '  ║           《垂纶》调参入口                            ║' 'Cyan'
L '  ╚══════════════════════════════════════════════════════╝' 'Cyan'
L ''
L '  【最快】游戏内热重载 —— 不用重启、不用构建：' 'Green'
L '     1. 游戏开着，改 config\anglertackle-common.toml' 'Gray'
L '        （用记事本，或本菜单选 1 打开调参器）' 'DarkGray'
L '     2. 游戏里敲： /atl config reload' 'Gray'
L '     3. 确认当前生效值： /atl config list' 'Gray'
L ''
L '  【改了代码才需要】构建 + 部署：本菜单选 4' 'Yellow'
L ''
L '  ────────────────────────────────────────────────────' 'DarkGray'
L '     1 = 打开调参器（网页，改数值）' 'White'
L '     2 = 打开游戏配置文件夹' 'White'
L '     3 = 只构建（检查有没有编译错误，不部署）' 'White'
L '     4 = 构建并部署到游戏' 'White'
L '     q = 退出' 'White'
L '  ────────────────────────────────────────────────────' 'DarkGray'
L ''

$choice = Read-Host '  请选择'
switch ($choice.Trim().ToLower()) {
  '1' {
    $f = Join-Path $Root '调参器.html'
    if (Test-Path $f) { Start-Process $f; L '  已打开调参器。改完保存，回来选 4 构建部署。' 'Green' }
    else { L "  找不到 $f" 'Red' }
  }
  '2' {
    $dir = 'D:\mc\PCL 正式版 2.13.1.1\.minecraft\versions\1.21.1-NeoForge_21.1.250\config'
    if (Test-Path $dir) { Start-Process explorer.exe $dir; L "  已打开 $dir" 'Green' }
    else { L "  找不到配置目录：$dir" 'Red' }
  }
  '3' {
    L ''
    L '  === 构建（不部署）===' 'Cyan'
    & (Join-Path $Root 'tools\build-deploy.ps1') -NoDeploy
    if ($LASTEXITCODE -eq 0) { L '  ✅ 构建通过' 'Green' } else { L "  ❌ 失败（exit $LASTEXITCODE）" 'Red' }
  }
  '4' {
    L ''
    L '  === 构建并部署 ===' 'Cyan'
    & (Join-Path $Root 'tools\build-deploy.ps1')
    if ($LASTEXITCODE -eq 0) {
      L ''
      L '  ✅ 完成，启动游戏即可。' 'Green'
      L '     启动后数值仍可用 /atl config reload 继续微调，不必重复构建。' 'DarkGray'
    } else { L "  ❌ 失败（exit $LASTEXITCODE），往上翻看错误。" 'Red' }
  }
  'q' { return }
  default { L '  没听懂，请输入 1 / 2 / 3 / 4 / q' 'Yellow' }
}
L ''
Read-Host '  按回车关闭'
