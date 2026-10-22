# 生成发布包：把 jar 复制到一个干净的目录，附一份安装说明。
# 目的：用户要"用 QQ 把 mod 传给别人"，需要一个不含任何开发中间产物的目录，
# 避免误发 build/ 里的东西。
#
# 参数 -OutDir：换一个输出目录名（默认 发布包）。
#   用途：旧的输出目录被 QQ 等程序占用时，不必先去关它们。
param([string]$OutDir)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

# ---- jar 名从 gradle.properties 的 mod_version 推出来（**不许写死**）----
# ⚠ 2026-10-03 事故：这里原来把 jar 名写死成一个"anglertackle-数字.数字.数字.jar"的**字面量**
#   （build-deploy.ps1 也一样）。改了 mod_version 之后，两个脚本都还在找旧名字 ——
#   而 build\libs 里恰好留着上一版的同名文件，于是"构建成功 → 部署成功 → 打包成功"，
#   实际发出去的**全是上一版**。版本只有一个来源，守着它的是 tools/check-build-scripts.js。
$ModVersion = (Select-String -Path (Join-Path $Root 'gradle.properties') -Pattern '^\s*mod_version\s*=\s*(\S+)\s*$' -Encoding UTF8 |
    Select-Object -First 1).Matches.Groups[1].Value
if (-not $ModVersion) { Write-Host '❌ gradle.properties 里读不到 mod_version' -ForegroundColor Red; exit 1 }
$JarName = "anglertackle-$ModVersion.jar"
$Src = Join-Path $Root "build\libs\$JarName"
if (-not (Test-Path $Src)) { Write-Host "❌ 找不到 $Src，先构建"; exit 1 }

$Out = Join-Path $Root '发布包'

# 清空输出目录。
#
# ⚠️ 不能只写 Remove-Item -Recurse：如果用户正把 jar 放在 QQ 的"发送文件"
#    窗口里，QQ 会独占这个文件，删除直接抛 IOException 并中断整个打包。
#    （实际踩到：19 个 QQ/QQEX 进程占着发布包里的那个 jar）
# 所以这里逐项删，删不掉的**点名报出来并给出怎么解决**，而不是甩一个原始异常。
if (Test-Path $Out) {
    $locked = @()
    foreach ($item in Get-ChildItem $Out -Recurse -Force) {
        try { Remove-Item $item.FullName -Recurse -Force -ErrorAction Stop }
        catch { $locked += $item.Name }
    }
    # 目录本身也试一次（可能残留空目录）
    try { Remove-Item $Out -Recurse -Force -ErrorAction Stop } catch { }

    if ($locked.Count -gt 0) {
        Write-Host ""
        Write-Host "⚠ 有 $($locked.Count) 个文件被占用，删不掉：" -ForegroundColor Yellow
        $locked | Select-Object -Unique | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
        Write-Host ""
        Write-Host "  最常见的原因：你正把 jar 放在 QQ / 微信的「发送文件」窗口里 ——" -ForegroundColor Yellow
        Write-Host "  那个窗口会一直独占文件，直到你关掉它。" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  解决：关掉 QQ 的发送窗口（或退出 QQ），然后重新运行本脚本。" -ForegroundColor Yellow
        Write-Host "  或者用 -OutDir 换一个输出目录，不用动旧的那份：" -ForegroundColor Yellow
        Write-Host "      .\tools\make-release.ps1 -OutDir 发布包_new" -ForegroundColor DarkGray
        Write-Host ""
        if (-not $OutDir) { exit 1 }
    }
}
$Out = if ($OutDir) { Join-Path $Root $OutDir } else { $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

Copy-Item $Src (Join-Path $Out $JarName) -Force

# 扩展包（垂纶 × 森罗物语）：只有构建过才有（libs/ 里放了他们的 jar 时才会产出）。
# 它是**可选**的：装了森罗的玩家把它一起丢进 mods/ 就能拿到"砧板按重量切块 + 汤锅数据保真"，
# 没装森罗的玩家不放它就行（放了也不会加载 —— 它的 mods.toml 声明 required 依赖森罗）。
$CompatName = 'anglertackle-kaleidoscope-1.0.0.jar'
$CompatSrc  = Join-Path $Root "build\libs\$CompatName"
if (Test-Path $CompatSrc) {
    Copy-Item $CompatSrc (Join-Path $Out $CompatName) -Force
    Write-Host "  扩展包已一起打包：$CompatName" -ForegroundColor DarkCyan
} else {
    Write-Host "  （没有 $CompatName：libs/ 里没放森罗的 jar，本次不带扩展包）" -ForegroundColor Yellow
}

# 调参器也一起发：接收者不用改代码就能调手感，而且调完会生成一份变更记录，
# 发回来我就能看到改了什么（不会把他的调整改回去）。
#
# ⚠️ 发布包里只放**纯 ASCII 名**的 tuner.html，不放 调参器.html：
#    .bat 里只能引用 ASCII 文件名（引用中文会因编码问题炸，踩过），
#    放两份只会让人不知道点哪个。

# 双击入口 + 它的中文菜单脚本。
#
# ⚠️ 这一类坑踩过三次，别再改回去：
#   1) 把中文写进 .bat —— cmd 按 GBK 解析，中文被错切成命令，满屏
#      "'Config' 不是内部或外部命令"
#   2) 用 Set-Content -Encoding ASCII 存带中文的 .bat —— 中文变成 '?'，
#      于是 ps1 里 Join-Path 拿到 '???.html'，双击报
#      "无法将参数绑定到参数 Path，因为该参数为空字符串"
#   3) ps1 用 $PSScriptRoot 找页面 —— 那等于只在 tools\ 里找，
#      而页面在发布包根目录，表现为"找不到调参器页面"
#
# 正解：.bat 全 ASCII，只调一个**纯 ASCII 文件名**的 ps1；
#       中文全在 ps1（UTF-8 BOM）里；ps1 同时找自己和上一级目录。
$Entry = Join-Path $Root 'tools\release-entry.bat'
if (Test-Path $Entry) { Copy-Item $Entry (Join-Path $Out '调参入口.bat') -Force }
else { Write-Host "⚠ 缺少 tools\release-entry.bat" -ForegroundColor Yellow }

$Launch = Join-Path $Root 'tools\tuner-launcher.ps1'
if (Test-Path $Launch) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Out 'tools') | Out-Null
    Copy-Item $Launch (Join-Path $Out 'tools\tuner-launcher.ps1') -Force
} else { Write-Host "⚠ 缺少 tools\tuner-launcher.ps1" -ForegroundColor Yellow }

# 纯 ASCII 文件名的调参器页面（.bat 里只敢引用 ASCII 名字）
$AsciiTuner = Join-Path $Root 'tuner.html'
if (Test-Path $AsciiTuner) { Copy-Item $AsciiTuner (Join-Path $Out 'tuner.html') -Force }
else { Write-Host "⚠ 缺少 tuner.html（调参器.html 的 ASCII 别名）" -ForegroundColor Yellow }

# 一份**完整**的默认配置。
#
# 为什么必须一起发：NeoForge 从不用新默认值覆盖已有配置（对的，玩家调过的值要留），
# 但它也**不会**把新加的分组补进老文件 —— 只有游戏启动那次写回才会。
# 于是"新版本加了 79 个配件配置项"这件事，在对方启动游戏之前是看不见的：
# 调参器会打开，但那 79 项显示为"文件里找不到"，看起来像工具坏了。
# 带上这份文件，对方直接覆盖过去就同步了。
$CfgInRelease = Join-Path $Root 'anglertackle-common.toml'
if (Test-Path $CfgInRelease) {
    Copy-Item $CfgInRelease (Join-Path $Out '默认配置_anglertackle-common.toml') -Force
} else { Write-Host "⚠ 缺少 anglertackle-common.toml" -ForegroundColor Yellow }

# 版本与校验
$hash = (Get-FileHash (Join-Path $Out $JarName) -Algorithm SHA256).Hash
$size = (Get-Item (Join-Path $Out $JarName)).Length

# 说明里的鱼种数**从源码数出来**，不许写死。
# ⚠ 2026-10-08 之前这里写的是"21 种鱼"（而当时已经是 47 种），版本号也写死成 v1.0.1 ——
#   发布说明是唯一直接给玩家看的东西，写死了就会一直撒谎。
#   守着这两条的是 tools/check-build-scripts.js。
$FishCount = (Select-String -Path (Join-Path $Root 'src\main\java\com\whitecobalt\anglertackle\fishing\FishSpecies.java') `
        -Pattern 'new FishSpecies\("' -AllMatches).Count
if (-not $FishCount) { Write-Host '❌ 数不出鱼种数（FishSpecies.java 的正则失效？）' -ForegroundColor Red; exit 1 }

$readme = @"
《垂纶》Angler's Tackle  v$ModVersion
================================================

这是给 Minecraft 1.21.1 + NeoForge 用的钓鱼模组。

------------------------------------------------
怎么装（三步）
------------------------------------------------
1. 确认你已经装了 NeoForge 21.1.x 的 1.21.1 客户端
   （PCL2 / HMCL 里选 "1.21.1-Forge/NeoForge" 那个版本即可）

2. 把 $JarName 放进这个文件夹：
       .minecraft\versions\<你的版本名>\mods\
   如果 mods 文件夹不存在，自己新建一个（名字必须是 mods）

   · 用 PCL2 的话更简单：右键版本 → 打开版本文件夹 → 进 mods

3. 启动游戏。主界面 → Mods 列表里能看到 "Angler's Tackle" 就成了。

注意：只要这一个 jar 文件，不要解压。
      放进 mods 的是 .jar 本身，不是解压出来的文件夹。

------------------------------------------------
开局怎么玩
------------------------------------------------
1. 合成钓竿：木棍 x3 + 线 x1 = 木台钓竿
2. 找水深至少 2 格的地方，长按右键蓄力，松手抛出
3. 浮漂先抖两下是鱼在试探（别动），整个沉下去时按左键提竿
4. 上鱼后按住左键收线、松开放线，A / D 控杆绕开鱼挣扎的方向
   线变红赶紧松手，不然会崩断

游戏里有一本《钓鱼手册》，右键打开，里面有完整教程。

------------------------------------------------
这个版本有什么
------------------------------------------------
· 视角抛投：低头约 8 米 / 平视约 16 米 / 抬头约 24 米
· 两种竿：台钓竿（浮漂）与路亚竿（拟饵），鱼种各不相同
· $FishCount 种鱼、六档品质（白 绿 蓝 紫 金 红），颜色直接显示在鱼名上
· 六槽改装：鱼线 / 渔轮 / 鱼钩 / 拟饵 / 鱼饵
  在铁砧和工作台上组装，用砂轮拆解
· 张力对抗：鱼会左右挣扎，用 A/D 反向控杆能更快耗尽它的体力
· 水体与水域：河流 / 湖泊 / 沼泽 / 海洋 / 深海 / 洞穴各有一批鱼；
  极地（常冰群系）、高寒湖、冷水溪流另有专属鱼，用 /atl water 看当前判定
· 冰钓：拿冰镐在冰面上凿洞，往洞里下钩；洞里不结冰、咬钩更快、鱼线损耗更大
· 环境：时段（晨昏夜）、天气、月相会影响出鱼，用 /atl env 看当前条件
· 图鉴 / 商店 / 菜谱：钓到的鱼进图鉴、卖鱼币、按鱼做菜
· 打窝：窝料抛出后浮在水面冒泡，半径 10 格内的浮漂享受加成
· 配件耐久：有耐久的配件会显示在屏幕左下角，抛出后右键可提前收回且不耗耐久

------------------------------------------------
已知问题
------------------------------------------------
· 深海/大面积水域的窝子上限、鱼种分布还在调整

================================================
想自己调手感？（可选，全部数值都能改）
================================================
包里还有一个 tuner.html（调参器），双击 调参入口.bat 也能打开：

1. 点「打开配置文件」，选：
       .minecraft\versions\<版本名>\config\anglertackle-common.toml
   （如果还没启动过游戏、没有这个文件，把包里的
     默认配置_anglertackle-common.toml 复制过去改名即可）
2. 拖动滑块或直接填数字改（黄色高亮 = 改过的项）
3. 点「保存修改」

⚠ 装之前先看一眼 mods 文件夹：
   如果里面已经有**旧版本**的 anglertackle-*.jar（或者叫 "xxx (1).jar"
   这种带括号的），**先把旧的删掉**再放新的。
   两个同 id 的 jar 同时存在，游戏会因为重复 mod 直接起不来；
   而带 (1) 的那种是 Windows 给重名文件自动加的后缀，
   光看名字分不出新旧 —— 出了事很难查。
   想确认自己装的是哪一版：启动游戏后看日志里的这一行：
       [垂纶] 加载自 anglertackle-<版本>.jar（433449 字节，2026-09-30 16:53:10）

项太多找不着？
  · 最上面的搜索框搜中文名 / 配置键 / 说明，空格分词（例：鱼 拉力），
    默认把不匹配的行整行藏掉、命中的字高亮 —— 446 项里定位一项不用再翻。
  · 想一次改一批，四种选法随便挑：
      同属性  —— 例「体力上限」= 21 条鱼的那一项，一次全选
      同对象  —— 例「鲫鱼」= 这条鱼的全部 13 项，一次全选
      全选匹配项 —— 先搜索再一键选中搜出来的那些
      逐行勾选 —— 或点分组标题右上角的「全选本组」
  · 选了什么一眼能看见：拖到上面有「已选清单」，逐条列出来、每条都能单独 × 掉；
    顶部那行还会写着「已选 21 项 · 同属性：体力上限」，回头一看就知道改的是哪一批。
    下拉选完会自动弹回「— 选择 —」，所以同一个选项想连选几次都行。
  · 选好后在「×」里填倍数（例 1.2）点「应用到已选」。
    顶到范围上下限的项会被夹住并**报出数量**，不会静默；整数项乘完自动取整。
  · 点「撤销上次批量」可以整批反悔（撤销掉的不会记进变更日志）。
  · 「配件数值（逐件）」那组是只读的，勾不上、也选不进批量 —— 免得白调。

共 446 项，分 11 组。其中**10 组真的可调**：
  · 抛投 / 提竿窗口 / 张力模型 / 咬钩等待   <- 核心手感
  · 配件属性合成                           <- 六槽合成的权重与上限（改完立刻生效）
  · 鱼种数值（逐条）                       <- 每条鱼的体重、拉力、体力、张力、冲刺、变向
  · 玩法数值（全局）                       <- 鱼竿五材质、张力模型、档位曲面、抛投蓄力、超重鱼
  · 窝料 / 耐久 / 渲染

另有一组「配件数值（逐件）」是**只读**的（界面里灰色、拖不动）：
  它只用来查看"每个配件当前是多少"，改了不会有任何效果。
  原因：配件属性是物品注册时烘进物品数据的，那一刻配置还没加载 ——
  在物品定义里读配置会让游戏启动直接崩溃（已经踩过这个坑）。
  想调配件手感请用「配件属性合成」那一组。

保存时会写入游戏配置，并弹出「调参变更记录.md」的保存框 ——
那个文件记录了"你改了哪些项、从多少改成多少"。把它发给作者，
作者就知道你调过什么，后续更新不会把你的调整改回去。

生效方式：游戏里敲  /atl config reload  立刻生效，不用重启。
          鱼种数值只影响**之后**咬钩的鱼 —— 正在遛的那条用的是咬钩瞬间的手感，
          改了也不会中途变（免得遛到一半手感突然变了，像卡了）。
          （配件耐久上限是注册时固定的，那几项要重启游戏才变。）

------------------------------------------------
文件信息
------------------------------------------------
文件名 : $JarName
大小   : $([math]::Round($size/1KB,1)) KB
SHA256 : $hash

适用   : Minecraft 1.21.1 + NeoForge 21.1.x
作者   : 白钴 / White Cobalt
许可   : MIT
"@
[System.IO.File]::WriteAllText((Join-Path $Out '安装说明.txt'), $readme, (New-Object System.Text.UTF8Encoding $true))

Write-Host "=== 发布包已生成 ==="
Get-ChildItem $Out | ForEach-Object { "  $($_.Name)  $([math]::Round($_.Length/1KB,1)) KB" }
Write-Host ""
Write-Host "目录: $Out"

# ---------------------------------------------------------------- 旧包体检
#
# 为什么必须做这一步：2026-09-30 的真实事故 ——
#   ① 发布包\ 被 QQ 的"发送文件"窗口占住，脚本删不掉里面的 jar，只能改写 发布包_new\；
#   ② 但 QQ 窗口里挂着的那份**还是三小时前的旧 jar**；
#   ③ 用户从那个窗口把文件发了出去，对方装上的是一版早就修掉的、启动必崩的 jar；
#   ④ 对方发回崩溃报告，文件名和版本号看不出任何区别，
#      只能靠调用栈反推是哪一次构建。
#
# 所以这里主动把**其它发布目录**里的 jar 和刚打出来的这份比一比，
# 不一致就点名说出来：不要去那里拿文件发人。
$fresh = (Get-FileHash (Join-Path $Out $JarName) -Algorithm SHA256).Hash
$stale = @()
foreach ($d in (Get-ChildItem $Root -Directory | Where-Object { $_.Name -like '发布包*' })) {
    if ($d.FullName -eq (Resolve-Path $Out).Path) { continue }
    $j = Join-Path $d.FullName $JarName
    if (-not (Test-Path $j)) { continue }
    $h = (Get-FileHash $j -Algorithm SHA256).Hash
    if ($h -ne $fresh) {
        $stale += [pscustomobject]@{
            Dir  = $d.Name
            Size = (Get-Item $j).Length
            Time = (Get-Item $j).LastWriteTime
        }
    }
}
if ($stale.Count -gt 0) {
    Write-Host ""
    Write-Host "⚠ 下面这些发布目录里是**旧的** jar，别从那里拿文件发人：" -ForegroundColor Yellow
    foreach ($s in $stale) {
        Write-Host ("    {0}\{1}  {2} 字节  {3}" -f $s.Dir, $JarName, $s.Size, $s.Time) -ForegroundColor Yellow
    }
    Write-Host "  原因通常是那个目录被 QQ/微信的发送窗口占着，脚本刷不进去。" -ForegroundColor Yellow
    Write-Host "  请关掉对应窗口后重跑本脚本，或者直接用上面这个新目录。" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "✅ 其它发布目录里的 jar 与本次一致（没有旧包残留）" -ForegroundColor Green
}
