<#
  调参器启动器（发布包用）。
  由 调参入口.bat 调用 —— 中文交互全部在这里，因为：
    · .bat 用 UTF-8 存中文会被 cmd 按 GBK 错切
    · 用 Set-Content -Encoding ASCII 存又会把中文全变成 '?'（踩过：Join-Path 拿到 '???.html'）
  所以 .bat 只负责"用纯 ASCII 文件名调一个 ps1"，中文一律放 .ps1（UTF-8 BOM）。
#>
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = '垂纶 · 调参器'

function L($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

L ''
L '  === 《垂纶》调参器 ===' 'Cyan'
L ''
L '  用法：' 'White'
L '   1. 点「打开配置文件」，选游戏目录下的' 'Gray'
L '        .minecraft\versions\<版本名>\config\anglertackle-common.toml' 'DarkGray'
L '   2. 拖滑块或在右边填数字（改过的项会黄色高亮）' 'Gray'
L '   3. 点「保存修改」—— 会把配置写回，并弹出「调参变更记录.md」的保存框' 'Gray'
L ''
L '  保存后重启游戏生效。' 'Yellow'
L '  那份变更记录请发给作者 —— 他据此知道哪些数值是你有意调的，不会改回去。' 'DarkGray'
L ''
L '  需要 Edge 或 Chrome 打开（只有它们支持网页读写本地文件）。' 'DarkGray'
L ''

# 页面可能在两处之一：
#   · 发布包结构 —— tuner.html 在根目录，本脚本在 tools\ 下
#   · 工作区结构 —— 调参器.html 在根目录，本脚本在 tools\ 下
# 所以"脚本自己所在目录"和"它的上一级"都要找。
# 之前只找 $PSScriptRoot 是错的（那等于只在 tools\ 里面找），
# 表现为双击后打印"找不到调参器页面"。
$candidates = @()
foreach ($dir in @($PSScriptRoot, (Split-Path -Parent $PSScriptRoot))) {
  if (-not $dir) { continue }
  $candidates += (Join-Path $dir 'tuner.html')
  $candidates += (Join-Path $dir '调参器.html')
}
$f = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($f) {
  Start-Process $f
  L '  已用默认浏览器打开。' 'Green'
} else {
  L '  找不到调参器页面。找过这些位置：' 'Red'
  foreach ($c in $candidates) { L ('    ' + $c) 'DarkGray' }
}
L ''
Read-Host '  按回车关闭'
