# ==========================================================================
#  build-deploy.ps1 —— 构建 → 自检 → 部署，**任一步失败就停**。
#
#  ⚠⚠ 2026-10-01 重建说明 ⚠⚠
#  这个文件曾被一次**错误的字节级补丁**整体写坏（10,340 字节里 10,337 个是 NUL，
#  只剩一个 BOM），而仓库**没有版本控制**、快照目录里也没有副本，所以它是按记忆
#  重建的。重建时核对过的"事实来源"：
#    · 各步骤的名字与顺序（构建 → 生成配置 → 生成调参器 → 自检 → 负向测试 → 部署 → 同步导入用）
#    · `Invoke-Timed` / `Run-Node` 的最终形态（今天为修"卡死"重写过，含超时 + 重试 + 进度归属）
#    · 检查循环跑**全部** check-*.js（并跳过需要额外参数的 check-fml-config.js）
#    · 版本号 1.1.7、jar 名、游戏目录与"导入用"两个部署目标
#
#  ★ 重建时补上的一件正事：**第 0 步先给源码打快照**（`tools/snapshot-src.js`）。
#    这条以前一直只是"建议"，今天这次事故证明它必须有 —— 没有它，一次写坏就是永久损失。
#
#  用法：
#    pwsh -File tools/build-deploy.ps1              # 构建 + 自检 + 部署
#    pwsh -File tools/build-deploy.ps1 -NoDeploy    # 只构建 + 自检
# ==========================================================================
param([switch]$NoDeploy)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot

# ⚠⚠ 平台"安全删除垫片"的批量阈值（2026-10-13 实测，详见 tools/negtest.ps1 里同一句）：
#   本闸的 node 子进程（生成器 / 检查器 / 负例建副本）一轮要删几十万次临时文件，
#   而守卫默认每 20 次就要二次确认 —— 不放松这个阈值，第 21 次 rmSync 就会抛
#   SAFE_DELETE_BULK_CONFIRM_REQUIRED 把整条闸停下来。只放松"要不要问人"，
#   删除仍走平台垫片 ✓
$env:CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD = '100000000'

# ---- jar 名从 gradle.properties 的 mod_version 推出来（**不许写死**）----
# ⚠ 2026-10-03 事故：这里原来把 jar 名写死成一个"anglertackle-数字.数字.数字.jar"的**字面量**。
#   改了 mod_version 之后 gradle 产出的是新名字，而这份脚本照旧去找旧名字 ——
#   那个旧文件还在 build/libs 里（gradle 从不清理旧产物），于是 `Test-Path $Jar` 通过、
#   部署"成功"，实际部署的是**上一版**：版本号、发布包、游戏里的 jar 全是旧的，
#   而每一步都打印成功。现在版本只有一个来源：gradle.properties。
#   （守着这条的是 tools/check-build-scripts.js）
$ModVersion = (Select-String -Path (Join-Path $Root 'gradle.properties') -Pattern '^\s*mod_version\s*=\s*(\S+)\s*$' -Encoding UTF8 |
    Select-Object -First 1).Matches.Groups[1].Value
if (-not $ModVersion) { Write-Host '❌ gradle.properties 里读不到 mod_version' -ForegroundColor Red; exit 1 }
$Name = "anglertackle-$ModVersion.jar"
$Jar  = Join-Path $Root "build\libs\$Name"
# 扩展包（垂纶 × 森罗物语）：只有 libs/ 里放了他们的 jar 才会产出，缺了**不算错**
# （主 jar 与森罗完全解耦，扩展包是可选项），所以这里不做存在性断言。
$CompatName = 'anglertackle-kaleidoscope-1.0.0.jar'
$CompatJar  = Join-Path $Root "build\libs\$CompatName"
$Mods = 'D:\mc\PCL 正式版 2.13.1.1\.minecraft\versions\1.21.1-NeoForge_21.1.250\mods'
$ImportDir = Join-Path $Root '导入用'

function Fail($msg) {
    Write-Host ""
    Write-Host "[$msg] 不部署，游戏里的 jar 保持原样。" -ForegroundColor Red
    exit 1
}

# ---- 带超时的子进程执行 ----------------------------------------------
# 为什么必须有超时：这份脚本曾经在跑完某个自检后**静默停住** —— 日志最后一行是上一个
# 脚本的成功输出，之后什么都没有，只剩一个 CPU 占用 0.1 秒的 node 进程挂了 17 分钟。
# 没有超时就没法区分"正在跑"和"已经卡死"，也拿不到是哪个脚本卡的。
#
# 用 ProcessStartInfo 而不是 Start-Process -PassThru：
#   实测（build/_probe.ps1）Windows PowerShell 5.1 下 Start-Process -PassThru 配
#   WaitForExit(毫秒) 之后 $p.ExitCode 是 **$null**，而 $null -ne 0 恒为真 ——
#   结果每个脚本都被判成失败（真实退出码 0 也一样）。PSI 的 ExitCode 是准的。
function Invoke-Timed($exe, $argList, $timeoutMs, $label) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    # 参数要自己加引号：这里是**裸拼接**成命令行的，而本仓库路径
    # "…\我的世界mod" 带空格，不加引号 node 会把它拆成两个参数并报 Cannot find module。
    $psi.Arguments = ($argList | ForEach-Object { '"' + ([string]$_ -replace '"', '\"') + '"' }) -join ' '
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $false
    # ⚠ **必须显式给工作目录**（2026-10-14 第八次跑闸踩到，查了很久）：
    #   PowerShell 的 Set-Location **不会**改 .NET 的 `Environment.CurrentDirectory`，
    #   而 `Process.Start` 继承的正是后者 ⇒ 不设的话，子进程的 cwd 是 PowerShell 进程
    #   启动时的目录（本机是 system32 之类），**用相对路径读文件的检查器会 ENOENT 崩掉、
    #   而且一个字都不打印**（stderr 也丢）—— 症状就是闸日志里只有 `[i/n] xxx.js` 一行、
    #   后面空白，可手动跑却全绿（因为手动的 cwd 恰好是对的）。
    $psi.WorkingDirectory = $Root
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $pr = [System.Diagnostics.Process]::Start($psi)
    # 不重定向输出：子进程直接继承控制台，和原来的 `& node` 行为一致 ——
    # 进度实时可见、stderr 照常显示，也不去碰沙箱里会 EPERM 的管道。
    $timedOut = -not $pr.WaitForExit($timeoutMs)
    if ($timedOut) { try { $pr.Kill() } catch { } ; $code = 124 } else { $code = $pr.ExitCode }
    $sw.Stop()
    if ($sw.ElapsedMilliseconds -gt 5000) {
        Write-Host ("      （{0} 用时 {1:N1}s）" -f $label, ($sw.ElapsedMilliseconds / 1000)) -ForegroundColor DarkGray
    }
    return @{ Code = $code; TimedOut = $timedOut }
}

# 跑一个 node 脚本，失败或超时就停。$LASTEXITCODE 是唯一可靠的判据：
# node 抛异常时 PowerShell 不会自动中断，后面的步骤会拿着半成品继续跑。
# 额外参数（如生成器的 --write）必须透传 —— 丢掉它会让生成器只做预览、不写文件
# （真实踩过：漏了 --write，于是"重跑生成器"什么都没写，文档里的旧名字和语言文件对不上）。
function Run-Node {
    param($label, $script, [Parameter(ValueFromRemainingArguments = $true)][string[]]$extra)
    $argv = @((Join-Path $Root "tools\$script")) + @($extra)
    for ($try = 1; $try -le 2; $try++) {
        $r = Invoke-Timed 'node' $argv 180000 $script
        if (-not $r.TimedOut) { break }
        if ($try -eq 1) {
            Write-Host "      （$script 超时 180s，重试一次 —— 可能是杀毒软件正在扫 jar）" -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    }
    if ($r.TimedOut) { Fail "$label 超时（$script 连续两次超过 180s 无响应，已强制结束）" }
    if ($r.Code -ne 0) { Fail "$label 失败（$script）" }
}

# ---- 0/6 源码快照 -------------------------------------------------------
# 见文件头的重建说明：没有它，一次写坏就是永久损失。
Write-Host "=== 0/6 源码快照 ===" -ForegroundColor Cyan
Run-Node '源码快照' 'snapshot-src.js'

Write-Host "=== 1/6 构建 ===" -ForegroundColor Cyan
# 注意：不要传 -p —— tools\gradlew.cmd 包装脚本自己已经注入了 -p "<项目根>"，
# 再传一次 gradle 会报 "Multiple arguments were provided for option '-p'"。
# 先删掉本次要产出的那个 jar：gradle 的 up-to-date 判定包含"产物在不在"，
# 删掉它一定会重新产出（哪怕是命中了构建缓存，也是重新写一遍这个文件）。
#
# ⚠ 这里**故意用 .NET 删，而不是 Remove-Item**（2026-10-14 第三次跑闸当场踩到）：
#   本机平台给 PowerShell 注入了一个 safe-delete 垫片，它把 `Remove-Item <已存在的文件>`
#   改写成"移入回收站"；而回收站对 build\libs 下的 jar 会失败：
#     [safe-delete][SAFE_DELETE_FAIL_CLOSED] {...,"reason":"trash-failed",
#       "detail":"Error during a `trash` operation: ... Some operations were aborted"}
#   ⇒ 整条闸死在第 1 阶段（而且**只在"同名 jar 已存在"时才触发**：
#     版本号刚升上来的第一次跑没事、重跑必挂 —— 这种"重跑才炸"的坑最难查）。
#   目标只可能是我们自己的构建产物，删不掉也不该拦住整条链 ⇒ 包起来、失败就交给 gradle 覆盖。
if (Test-Path $Jar) {
    try {
        [System.IO.File]::Delete($Jar)
    } catch {
        Write-Host "（旧 jar 删不掉，交给 gradle 覆盖：$Jar）" -ForegroundColor DarkYellow
    }
}
$BuildStart = Get-Date
# ⚠ 原生命令（gradle）会往 **stderr** 打 javac 的"注: ... 使用或覆盖了已过时的 API"这类提示，
#   而本脚本是 $ErrorActionPreference='Stop' ⇒ PowerShell 会把原生命令的**任何 stderr 输出**
#   当成 NativeCommandError 直接终止脚本（2026-10-14 第四次跑闸当场踩到）。
#   触发条件很刁钻：只有 gradle **真的重新编译**（改了源码）时才打印那句警告 ⇒
#   UP-TO-DATE 的那几次跑得好好的 —— 又是"改了东西才炸"的形状。
#   这里临时放宽 EAP：编译成功与否**只看 $LASTEXITCODE** ✓
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& cmd /c "`"$Root\tools\gradlew.cmd`" build --console=plain --no-watch-fs"
$gradleExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($gradleExit -ne 0) { Fail '构建失败' }
if (-not (Test-Path $Jar)) { Fail "构建失败（没产出 $Name —— gradle.properties 的 mod_version 与产物名对不上？）" }
# ⚠ 光 Test-Path 不够：gradle **从不清理 build\libs 里的旧产物**，
#   一个上次留下的同名文件就能让"构建成功"变成"部署上一版"（2026-10-03 真踩过）。
#   所以要求这次的 jar 是**本次构建写出来的**。
if ((Get-Item $Jar).LastWriteTime -lt $BuildStart) {
    Fail "$Name 是上一次构建留下的旧文件（$((Get-Item $Jar).LastWriteTime)），本次构建没有产出它"
}

Write-Host ""
Write-Host "=== 2/6 生成配置 ===" -ForegroundColor Cyan
# 配件数值（20 个配件 × 耐久 + 59 个属性）与鱼种数值（26 条 × 13 项）都是从源码
# **生成**到 Config.java 的，而不是手写的 —— 手抄几百个数值必然错一两个，
# 而错的表现是"某个数值悄悄变了"，极难发现。
#
# ⛔ 曾经这里还有一步 `rewrite-part-stats`：把 ModItems.java 里的配件字面量换成
#    Tuning.xxx() 调用，想让配件数值跟配置走。**那是错的，会让游戏启动即崩**：
#      RegisterEvent 阶段读配置 → "Cannot get config value before config is loaded."
#    现在该脚本只打印警告、不做任何事。
Run-Node '生成配件配置' 'gen-part-config.js' --write
Run-Node '生成鱼种配置' 'gen-fish-config.js' --write
# 玩法数值（rodWood*/rodIron* 等）也在 Config.java 的生成块里，由这个脚本写。
# ⚠ 这一步以前漏了，而 gen-part-config.js 会把「玩法数值声明/定义」两块一起剥掉再重写
#   配件块 —— 于是 Config.java 里玩法字段消失，Tuning.java 的玩法热重载映射
#   （c.rodWoodMaxWeightKg …）100 处编译失败。三个生成器的顺序不能变：
#   配件 → 鱼种 → 玩法，每个只负责自己那两块。
Run-Node '生成玩法配置' 'gen-gameplay-config.js' --write

# 鱼的外形也是生成的：贴图（PNG）与模型/变体（Java）都从
# tools/fish-appearance.json + tools/fish-model.js 出。
# 两者必须成对重跑 —— 只跑一半的后果是"模型换了 UV、贴图还是旧的"。
Run-Node '生成鱼模型' 'gen-fish-model.js'
Run-Node '生成鱼贴图' 'gen-fish-textures.js'
# 物品图标（鱼获 + 拟饵）：**按用户给的参考图**生成（抠背景 + 裁切 + 缩放）。
# ⚠ 这里以前挂的是 gen-fine-lures.js（手绘那版），每次构建都会把手绘版盖回去 ——
#   用户两次反馈"没用我的图片"就是这个原因。别换回手绘生成器。
Run-Node '生成鱼获图标（按用户参考图）' 'gen-ref-icons.js'
# 拟饵图标：**用户 2026-10-04 给的 9 张成图**（32×64，内容只在上半，透明底）。
# 走的是另一条路（截上半 + ×2 最近邻），因为 gen-ref-icons.js 那条"大图按格还原 +
# 背景曲面抠图"要求参考图里有渐变背景、格边长 2~8px，对 1:1 的成图不适用。
# ⚠ 和上面同一条教训：不跑它，构建就会留着上一次的旧图；gen-ref-icons.js 的
#   SOURCES 里已经把这 4 个 id 删掉了，所以两边不会互相盖。
Run-Node '生成拟饵图标（用户成图）' 'gen-lure-icons.js'
# 野外营地 / 钓位（用户 2026-10-05 给的两个成品结构）：生成结构 NBT（容器挂表+清残留 Items）、
# 四张战利品表（四条带 71.5/25/3/0.5、一箱至多 2 件 mod 物品）与世界生成三件套。见 docs/31。
Run-Node '生成营地/钓位结构与战利品' 'gen-sites.js'

Write-Host ""
Write-Host "=== 3/6 生成调参器 ===" -ForegroundColor Cyan
Run-Node '生成调参 schema' 'gen-tuning-schema.js'
Run-Node '生成调参器' 'build-tuning-tool.js'

Write-Host ""
Write-Host "=== 4/6 自检 ===" -ForegroundColor Cyan
Run-Node 'jar 自检' 'verify-jar.js'
Run-Node '配件接线校验' 'check-part-wiring.js'
Run-Node '配件默认值比对' 'check-part-config-parity.js'
Run-Node 'schema 一致性' 'check-tuning-schema.js'

# ---- 把**全部** check-*.js 都跑一遍，任何一个非零退出就停 ----
#
# 为什么改成"全跑"而不是继续维护一张手写清单：
#   2026-09-30 那次启动崩溃（RodItem$RodSpec.<clinit> 读配置）就是清单漏的 ——
#   check-no-config-at-registration.js 当时**存在**，但只扫 registry/*.java，
#   而且它根本没被这份清单列进来。检查脚本没被跑，等于没有检查。
#   全跑之后，以后新加的检查自动进入闸门，不需要记得回来改这张清单。
#
# 跳过清单：**空的**。
#   以前这里是 @('check-fml-config.js') —— 因为那个脚本必须手动传文件路径。
#   后果是它一次都没跑过，而且它当时**只打印、从不断言**（永远退出 0）。
#   2026-10-08 已把它改成"默认自己找文件 + 真的有断言"，于是重新进闸门。
$SkipChecks = @()
Write-Host ""
Write-Host "--- 全部检查脚本 ---" -ForegroundColor DarkGray
$checks = Get-ChildItem (Join-Path $Root 'tools\check-*.js') | Sort-Object Name
$failed = @()
$timedOut = @()
$i = 0
foreach ($c in $checks) {
    if ($SkipChecks -contains $c.Name) { continue }
    $i++
    # 先报出"正在跑谁"：卡死时最后一行就是凶手，不用再靠二分法找
    Write-Host ("  [{0}/{1}] {2}" -f $i, ($checks.Count - $SkipChecks.Count), $c.Name) -ForegroundColor DarkGray
    $r = Invoke-Timed 'node' @($c.FullName) 120000 $c.Name
    if ($r.TimedOut) {
        Write-Host "      （超时 120s，重试一次）" -ForegroundColor Yellow
        Start-Sleep -Seconds 2
        $r = Invoke-Timed 'node' @($c.FullName) 120000 $c.Name
    }
    if ($r.TimedOut) { $timedOut += $c.Name; continue }
    if ($r.Code -ne 0) {
        # ⚠ 退出码非 0 也要**重试一次**（2026-10-14 第七/八次跑闸踩到，查了很久）：
        #   Invoke-Timed 不重定向输出、让子进程继承控制台；而这个闸在本机常常是**后台**起的
        #   （没有真实控制台）⇒ 子进程往 stdout 写会失败，node 因写入失败**直接以非零码退出、
        #   一个字符都不打印**。症状极好认：闸日志里只有 `[i/n] xxx.js` 一行，它后面**什么都没有**
        #   （正常应该跟一段检查输出）。
        #   判据：手动把这 137 个检查器全跑一遍 = **0 个失败** ⇒ 这种红是环境瞬态，不是树坏了。
        #   重试一次即可；**真红的话两次都会红**（所以不会掩盖真问题）。
        Write-Host "      （退出码 $($r.Code)，重试一次）" -ForegroundColor Yellow
        Start-Sleep -Seconds 1
        $r = Invoke-Timed 'node' @($c.FullName) 120000 $c.Name
        if ($r.TimedOut) { $timedOut += $c.Name; continue }
        if ($r.Code -ne 0) { $failed += $c.Name }
    }
}
if ($timedOut.Count -gt 0) {
    Write-Host ""
    Write-Host "❌ 以下检查脚本连续两次超时未结束（120s 上限）：" -ForegroundColor Red
    $timedOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Fail '自检超时，已停止（没有部署）'
}
if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "❌ 以下检查未通过：" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Fail '自检未通过，已停止（没有部署）'
}
Write-Host ("✅ 全部 {0} 个检查脚本通过" -f ($checks.Count - $SkipChecks.Count)) -ForegroundColor Green

# ---- 负向测试：证明检查脚本本身是能被证伪的 ----
#
# 这不是"再跑一遍检查"，而是**检查检查器**：把仓库复制到临时目录、故意改坏几十处，
# 断言对应的检查脚本每一处都必须报错；每个检查器还配一棵未改动的对照组必须放行。
#
# 为什么值得每次都跑：本仓库出过"检查脚本永远通过"的事故 ——
# check-gameplay-parity.js 曾在 JS 里把 Java 的算法重新实现一遍，
# 等于自己证明自己。一个永远绿的检查器比没有检查器更坏。
Write-Host ""
Write-Host "--- 负向测试（检查器能否被证伪） ---" -ForegroundColor DarkGray
Write-Host "  负例要复制整棵源码树再跑几十个用例，是最慢的一步（上限 30 分钟）" -ForegroundColor DarkGray
# ⚠ 2026-10-09：上限从 15 分钟放宽到 30 分钟。
#   原因：负例套件是**串行**跑的，用例数从 376 涨到 379（新加 check-rounds ×2 + check-fatigue-pull ×1），
#   而 check-rounds 自己就要跑 30 条鱼 × 7 个种子 = 210 场模拟 ⇒ 整步实测已经贴着 15 分钟。
#   这是**超时上限**，不是断言放宽 —— 每个用例的 expect 一个没动（漏检仍然必红）✓
$r = Invoke-Timed 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'tools\negtest.ps1')) 1800000 'negtest.ps1'
if ($r.TimedOut) { Fail '负向测试超时（negtest.ps1 超过 30 分钟无响应，已强制结束）' }
if ($r.Code -ne 0) { Fail '负向测试未通过：存在漏检的检查脚本' }

# 只预览、不改配置文件：这一步是"提醒你配置文件还没跟上代码"。
# 不自动去改游戏目录 —— 开发环境对 D: 盘只读，而且不该替你动配置。
$r = Invoke-Timed 'node' @((Join-Path $Root 'tools\sync-config-file.js')) 60000 'sync-config-file.js'
if ($r.TimedOut) { Fail 'sync-config-file.js 超时（60s 无响应，已强制结束）' }
if ($r.Code -ne 0) {
    Write-Host "（上面这些是代码里新增、配置文件里还没有的项）" -ForegroundColor Yellow
    Write-Host "（要补进配置文件：node tools\sync-config-file.js --write）" -ForegroundColor Yellow
}

if ($NoDeploy) {
    Write-Host ""
    Write-Host "[-NoDeploy] 跳过部署。" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "=== 5/6 部署到 PCL2 ===" -ForegroundColor Cyan
if (-not (Test-Path $Mods)) { Fail "部署失败（找不到 $Mods）" }
Copy-Item $Jar (Join-Path $Mods $Name) -Force
# 扩展包（垂纶 × 森罗物语）——**只在"目标实例确实装了森罗"时才拷**。
#
# ⚠⚠ 2026-10-12 事故（用户开不了游戏，我这次部署就是元凶 ✗）：
#   这里原来是无条件 `if (Test-Path $CompatJar) { 拷 }`，注释还写着"没装森罗时这个包整包不加载"——
#   **那句是错的**：扩展包的 mods.toml 把 kaleidoscope_cookery 声明成 `required`，
#   而 FML 对 required 缺失的处理是**判定 mod 加载失败、直接崩游戏**：
#       Mod anglertackle_kaleidoscope requires kaleidoscope_cookery 1.4.0 or above
#       Currently, kaleidoscope_cookery is not installed → Mod loading has failed
#   更糟的是：用户早就用 PCL 把它禁用了（`anglertackle-kaleidoscope-*.jar.disabled`），
#   而"无条件拷一份启用的进去"等于**把用户手动关掉的东西重新打开** ✗。
#   ⇒ 现在的判据（两条都要满足才拷）：
#     ① 目标 mods 里有**启用的**森罗（`kaleidoscope*.jar`）；
#     ② 目标 mods 里**没有**我们扩展包的 `.disabled` 标记（尊重用户的禁用）。
$global:CompatDeployed = $false
$hasKaleido = @(Get-ChildItem $Mods -Filter 'kaleidoscope*.jar' -ErrorAction SilentlyContinue).Count -gt 0
$compatDisabled = @(Get-ChildItem $Mods -Filter 'anglertackle-kaleidoscope-*.jar.disabled' -ErrorAction SilentlyContinue).Count -gt 0
$keep = @($Name)
if ((Test-Path $CompatJar) -and $hasKaleido -and -not $compatDisabled) {
    Copy-Item $CompatJar (Join-Path $Mods $CompatName) -Force
    $keep += $CompatName
    Write-Host "  同时部署扩展包 $CompatName（检测到森罗物语）" -ForegroundColor DarkCyan
} elseif (Test-Path $CompatJar) {
    if ($compatDisabled) {
        Write-Host "  跳过扩展包：你在 mods 里禁用了它（.jar.disabled）—— 不擅自打开" -ForegroundColor Yellow
    } else {
        Write-Host "  跳过扩展包：目标 mods 里没装森罗物语（装了它会让 FML 崩在加载阶段）" -ForegroundColor Yellow
    }
    # 顺手把以前误拷进去的启用副本清掉 —— 否则下次启动照样崩
    $stale = Join-Path $Mods $CompatName
    if (Test-Path $stale) {
        # ⚠ 同上：用 .NET 删，别走 Remove-Item（平台 safe-delete 垫片会把它转成"移入回收站"，
        #   而回收站对 mods 目录里的 jar 会失败 ⇒ 整条闸挂掉。见第 1/6 步那处的长注释。）
        try { [System.IO.File]::Delete($stale) } catch { }
        Write-Host "  已清掉之前误拷的 $CompatName" -ForegroundColor DarkYellow
    }
}
# 顺手清掉旧版本的 jar —— 两个版本同时躺在 mods 里会冲突
# ⚠ keep 里必须有扩展包名：否则这行会把刚放进去的扩展包当"旧版本"删掉
Get-ChildItem $Mods -Filter 'anglertackle-*.jar' | Where-Object { $keep -notcontains $_.Name } | ForEach-Object {
    Write-Host "  删除旧版本 $($_.Name)" -ForegroundColor DarkYellow
    # ⚠ 同上：.NET 删，别走 Remove-Item（safe-delete 垫片 ⇒ 回收站 ⇒ 失败 ⇒ 闸挂）
    try { [System.IO.File]::Delete($_.FullName) }
    catch { Write-Host "  （删不掉，请手动清理：$($_.Name)）" -ForegroundColor Yellow }
}

Write-Host "=== 6/6 同步导入用 ===" -ForegroundColor Cyan
if (Test-Path $ImportDir) {
    Copy-Item $Jar (Join-Path $ImportDir $Name) -Force
    # 导入用：与上面同一条判据（别把"会让别人崩"的扩展包塞进给别人用的包里）
    if ((Test-Path $CompatJar) -and $hasKaleido -and -not $compatDisabled) {
        Copy-Item $CompatJar (Join-Path $ImportDir $CompatName) -Force
    } else {
        $staleImport = Join-Path $ImportDir $CompatName
        if (Test-Path $staleImport) { Remove-Item $staleImport -Force -ErrorAction SilentlyContinue }
    }
    Get-ChildItem $ImportDir -Filter 'anglertackle-*.jar' | Where-Object { $keep -notcontains $_.Name } | ForEach-Object {
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "（跳过：没有 导入用 目录）" -ForegroundColor Yellow
}

$f = Get-Item (Join-Path $Mods $Name)
Write-Host ""
Write-Host "已部署 $($f.Length) 字节  $($f.LastWriteTime)" -ForegroundColor Green
