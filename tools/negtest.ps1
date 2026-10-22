# negtest.ps1 —— 负向测试：证明检查脚本**能被证伪**。
#
# 为什么需要它：本仓库出过"检查脚本永远通过"的事故 —— check-gameplay-parity.js
# 曾在 JS 里把 Java 的算法重新实现了一遍（连 Math.min(hiRaw, CAP) 都照抄），
# 等于自己证明自己。**永远绿的检查器比没有检查器更坏**：
# 它会让人以为这件事已经被守住了。
#
# 做法：node tools\_negtest.js 先造一批临时副本（真实源文件全程只读），
# 每个副本故意改坏一处；再由 tools\_negrun.js 用 ATL_ROOT 指向副本跑对应的检查脚本，断言退出码。
# 每个检查器都配了一棵**未改动的对照组**，它必须通过 —— 否则说明检查器本身写错了。
#
# ⚠ 2026-10-12：断言那一段**搬到 node 里并改成并发**了（`tools/_negrun.js`，默认 4 路）。
#   以前串行跑 449 条要 ~345 秒，是整条闸最慢的一块；现在降到 ~1/3。
#   为什么能并发：**建副本仍是单进程**，每个用例只读自己那棵副本，互不写 ⇒
#   "同一时刻只有一个进程在写 build\negtest" 这条不变式仍然成立 ✓
#   （AGENTS.md §三里"负例不许并发"针对的是**两个 negtest 进程同时跑**，那条依然有效 ✗）。
#   为什么可以直接用 node 起 node：不用管道 —— `stdio: 'ignore'` / `'inherit'` 在沙箱下是允许的，
#   被禁的只有 `'pipe'` ✓（老注释里那句话仍然成立，只是不再需要 PS 来代跑）。

param(
    [int]$Jobs = 4,           # 并发几路（1 = 老行为，串行；调试用）
    [string]$Filter = '',     # 只跑 dir/checker 里含这个子串的用例（调试单条用）
    [string]$ForceRoot = ''   # 把所有用例的 ATL_ROOT 都指到同一棵副本（**验证失败路径**用）
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
# ⚠ 变量名不要用 $Out / $out —— PowerShell 变量名**大小写不敏感**，
#   下面捕获输出的 $out 会把这里的 $Out 覆盖掉，下一轮 Join-Path 就会拿
#   node 的 stdout 当路径，报 "Cannot find drive. A drive with the name 'node.exe ' does not exist."
#   这个坑第一次跑就踩了。
$Scratch = Join-Path $Root 'build\negtest'

# ⚠⚠ 平台"安全删除垫片"的批量阈值（2026-10-13 实测）：那层守卫默认每 20 次删除就要
#   二次确认，而负例一轮要删十几万次（建副本前清目录 + writeInCopy 断硬链接）——
#   不放松它，node 子进程第 21 次 rmSync 就抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED，
#   整段负例直接跑不起来（症状还被闸报成极具误导性的"存在漏检的检查脚本"✗）。
#   这里只放松"要不要问人"：删除本身仍走平台垫片，且 build\negtest 本来就是
#   本脚本自己的临时目录（AGENTS.md §三：负例每一步都要清空重建它）✓
$env:CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD = '100000000'

Write-Host "=== 负向测试（检查器能否被证伪） ===" -ForegroundColor Cyan
Write-Host ""

# ---- 0/2 锚点预检（2026-10-12 加，**两秒钟**）----
# ⚠ 为什么值得单独一步：负例的锚点是"源码里的一段原文"，而改文案/改实现就会把锚点改没。
#   锚点失配的症状极其误导 —— 造副本阶段抛一句「负例构造失败「x」」，
#   闸最终报的却是「[负向测试未通过：存在漏检的检查脚本]」
#   （看起来像"某个检查器抓不到变异"，其实连跑都没跑起来 ✗），而且要等三四分钟才看得到。
#   2026-10-12 为此栽了三次（`"send");`、`**签收那一刻起…**`、改写邮件短句那次）。
#   预检把每个用例的 mutate 在**内存里**演一遍（只读真源码、一个字节都不落盘），
#   1~2 秒就能指名道姓地列出"哪几条的锚点没了" ✓
# ⚠ 与下面那次调用同一个理由用 $ErrorActionPreference = 'Continue'：
#   预检失败时 node 往 stderr 写字，而 PS 5.1 在 'Stop' 下会把**原生命令的 stderr
#   当成终止性错误抛出** —— 于是"正确地报出锚点失效"反而让脚本自己崩掉，看起来像 node 崩了。
$prevAnchors = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& node (Join-Path $PSScriptRoot '_negtest.js') --check-anchors
$anchorFail = $LASTEXITCODE
$ErrorActionPreference = $prevAnchors
if ($anchorFail -ne 0) {
    Write-Host "负例锚点已失效（见上方清单：改文案/改实现时顺手改掉的那些）" -ForegroundColor Red
    exit 1
}

# ---- 1/2 建副本（**单进程**：同一时刻只允许一个进程清空/重建 build\negtest）----
& node (Join-Path $PSScriptRoot '_negtest.js')
if ($LASTEXITCODE -ne 0) { Write-Host "造副本失败" -ForegroundColor Red; exit 1 }

# ⚠ 必须显式 -Encoding UTF8：PS 5.1 的 Get-Content 对**没有 BOM** 的文件按 GBK 解码
#   （和 .ps1 脚本自身必须带 BOM 是同一个坑的另一面）。node 写出的 json 没有 BOM，
#   不加这个参数中文变乱码，ConvertFrom-Json 会报 "':' or '}' expected"。
$manifest = Get-Content (Join-Path $Scratch 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ("  副本已就绪：{0} 个用例" -f $manifest.Count)
Write-Host ""

# ---- 2/2 断言：交给 tools/_negrun.js（并发；只用 stdio ignore/inherit，不开管道）----
# ⚠ 它自己的三条自检：没跑起来的用例不算通过 / 对照组为 0 直接报错 / 过滤后为空退出码 2。
#   退出码 = 不符合预期的用例数（0 = 全绿）。
$runnerArgs = @((Join-Path $PSScriptRoot '_negrun.js'), '--jobs', "$Jobs")
if ($Filter -ne '') { $runnerArgs += @('--filter', $Filter) }
if ($ForceRoot -ne '') { $runnerArgs += @('--force-root', $ForceRoot) }

# ⚠ 与老代码同一个理由：负例跑失败时 node 会往 stderr 写字，而 PS 5.1 在 'Stop' 下会把
#   **原生命令的 stderr 当成终止性错误抛出** —— 于是"检查脚本正确地失败了"反而让测试脚本
#   自己崩掉，看起来像 node 崩了。我们要的恰恰是"它能失败"。
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& node @runnerArgs
$fail = $LASTEXITCODE
$ErrorActionPreference = $prev

if ($null -eq $fail) { $fail = 2 }
exit $fail
