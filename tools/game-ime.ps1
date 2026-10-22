# ============================================================================
#  game-ime.ps1 —— 进游戏自动切到英文键盘布局（解决"按 Shift 会切中英文"）
#
#  用户的痛点（原话）：
#    "我每次进游戏电脑都不会自动帮我切换输入法，一按shift还会更改"
#
#  根因不在游戏，在 Windows 的输入法模型：
#    · 中文输入法（微软拼音等）是**挂在键盘布局上的**，只要当前布局是中文，
#      输入法就一直激活，Shift 是它自己的"中/英切换"热键 —— 游戏里按 Shift
#      蹲下，输入法跟着切一次，键还被吃掉一半。
#    · Windows 记住了"每个窗口各自的输入法"，但记的是**你上次手动切的**，
#      所以每次进游戏都要手动切一遍。
#
#  为什么不去改输入法设置里的 Shift 热键（那条路也能走）：
#    那是全局设置，改了以后你在聊天框里打字时也不能用 Shift 切中英了。
#    而"游戏窗口用英文布局"是**按窗口**的：游戏里 Shift 老实蹲下，
#    聊天要打中文照样按 Ctrl+空格 切回来。互不影响，这才是对的粒度。
#
#  做法：盯着前台窗口，一旦是 Minecraft 的进程就把该窗口的输入语言
#        切成英语(美国) 00000409；离开游戏时再切回你原来的布局。
#        用的是 Windows 官方的 WM_INPUTLANGCHANGEREQUEST 消息，
#        不 hook、不改注册表、不动系统设置。
#
#  用法：
#    powershell -ExecutionPolicy Bypass -File tools\game-ime.ps1
#    powershell ... -File tools\game-ime.ps1 -DryRun     # 只报不改，先看看认不认得出游戏
#    powershell ... -File tools\game-ime.ps1 -NoRestore  # 离开游戏也不切回（一直保持英文）
#
#  退出：在窗口里按 Ctrl+C。
# ============================================================================
param(
    # Minecraft 的进程名。PCL2 启动的是 javaw；写成数组方便以后加启动器自己。
    [string[]]$ProcessNames = @('javaw', 'java'),
    # 目标键盘布局：00000409 = 英语(美国)。想用别的就换成对应的 KLID。
    [string]$LayoutId = '00000409',
    # 轮询间隔（毫秒）。400ms 足够跟手，CPU 占用可以忽略。
    [int]$PollMs = 400,
    # 离开游戏时切回原来的布局（默认开）。关掉就是"进过游戏之后一直是英文"。
    [switch]$NoRestore,
    # 只报告"认出了哪个窗口、会切成什么"，不做任何更改。
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AtlIme {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern IntPtr GetKeyboardLayout(uint idThread);
    // WM_INPUTLANGCHANGEREQUEST = 0x0050：官方给的"换某个窗口输入语言"的消息。
    // KLF_ACTIVATE = 0x0001。
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr LoadKeyboardLayout(string pwszKLID, uint Flags);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@

$WM_INPUTLANGCHANGEREQUEST = 0x0050
$KLF_ACTIVATE = 0x0001

# 目标布局的 HKL。LoadKeyboardLayout 只负责"把这个布局装进本进程"，
# 真正作用到游戏窗口的是下面 PostMessage 那一下。
$targetHkl = [AtlIme]::LoadKeyboardLayout($LayoutId, $KLF_ACTIVATE)
if ($targetHkl -eq [IntPtr]::Zero) {
    Write-Host "[垂纶] 加载键盘布局 $LayoutId 失败 —— 系统里没有这个布局？" -ForegroundColor Red
    exit 1
}
# HKL 低 16 位是 LANGID：00000409 → 0x0409
$targetLang = [int]($targetHkl.ToInt64() -band 0xFFFF)

function Get-ForegroundInfo {
    $hwnd = [AtlIme]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    # ⚠ 变量名不能叫 $pid —— 那是 PowerShell 的自动变量（当前进程 ID）。
    #   本仓库在 build-deploy.ps1 里踩过同类坑（$Out/$out 大小写不敏感），
    #   用自动变量接 P/Invoke 的 out 参数会读到莫名其妙的数字。
    $procId = 0
    $tid = [AtlIme]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $name = ''
    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $name = '' }
    return [pscustomobject]@{
        Hwnd = $hwnd
        Thread = $tid
        Pid = $procId
        Name = $name
        Lang = [int]([AtlIme]::GetKeyboardLayout($tid).ToInt64() -band 0xFFFF)
    }
}

Write-Host "[垂纶] 输入法守护已启动。" -ForegroundColor Cyan
Write-Host "        盯：$($ProcessNames -join ' / ')" -ForegroundColor DarkGray
Write-Host "        切到：$LayoutId（LANGID 0x$($targetLang.ToString('X4'))）" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "        [DryRun] 只看不改" -ForegroundColor Yellow }
if (-not $NoRestore) { Write-Host "        离开游戏时切回原布局" -ForegroundColor DarkGray }
Write-Host "        Ctrl+C 退出" -ForegroundColor DarkGray

# 上一次"我们切走之前"的布局，用来在离开游戏时还原。
# 只在**我们改动过**的时候才记，避免把玩家自己切的布局也当成"原布局"记下来。
$savedLang = 0
$inGame = $false
# DryRun 下用来"前台窗口一换就报一行"—— 没开游戏时也能验证它到底认不认得出窗口。
$lastSeen = ''

while ($true) {
    $info = Get-ForegroundInfo
    if ($null -ne $info) {
        $isGame = $ProcessNames -contains $info.Name
        if ($DryRun) {
            $tag = "$($info.Name)|$($info.Lang)"
            if ($tag -ne $lastSeen) {
                $lastSeen = $tag
                $mark = if ($isGame) { '【是游戏，会切】' } else { '（不是游戏）' }
                Write-Host "[DryRun] 前台：$($info.Name)(pid $($info.Pid))  布局 0x$($info.Lang.ToString('X4'))  $mark"
            }
        }
        if ($isGame -and $info.Lang -ne $targetLang) {
            if (-not $inGame) { $savedLang = $info.Lang }   # 进游戏前的那一个
            if ($DryRun) {
                Write-Host "[DryRun] $($info.Name)(pid $($info.Pid)) 当前 0x$($info.Lang.ToString('X4')) → 会切成 0x$($targetLang.ToString('X4'))"
            } else {
                [void][AtlIme]::PostMessage($info.Hwnd, $WM_INPUTLANGCHANGEREQUEST, [IntPtr]::Zero, $targetHkl)
                Write-Host "[垂纶] 已切到英文：$($info.Name)(pid $($info.Pid))  0x$($info.Lang.ToString('X4')) → 0x$($targetLang.ToString('X4'))" -ForegroundColor Green
            }
            $inGame = $true
        } elseif (-not $isGame) {
            # 离开游戏了：把布局还回去（只在切换过、且真的还需要还原时动）
            if ($inGame -and -not $NoRestore -and $savedLang -ne 0 -and $info.Lang -eq $targetLang) {
                $back = [AtlIme]::LoadKeyboardLayout($savedLang.ToString('X8'), $KLF_ACTIVATE)
                if ($back -ne [IntPtr]::Zero) {
                    if ($DryRun) {
                        Write-Host "[DryRun] 离开游戏，会切回 0x$($savedLang.ToString('X4'))"
                    } else {
                        [void][AtlIme]::PostMessage($info.Hwnd, $WM_INPUTLANGCHANGEREQUEST, [IntPtr]::Zero, $back)
                        Write-Host "[垂纶] 已切回原布局 0x$($savedLang.ToString('X4'))：$($info.Name)" -ForegroundColor DarkCyan
                    }
                }
            }
            $inGame = $false
        }
    }
    Start-Sleep -Milliseconds $PollMs
}
