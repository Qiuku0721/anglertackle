# 垂纶 · Angler's Tackle

> 一个把「手感」放在第一位的 Minecraft 钓鱼模组。
> A Minecraft fishing mod built around **feel**: physical casting, float reading, line-tension fighting.

- **Minecraft**: 1.21.1
- **加载器 / Loader**: NeoForge 21.1.x（`neo_version_range = [21.1.0,)`）
- **Java**: 21
- **作者 / Author**: 白钴 · White Cobalt
- **许可证 / License**: 代码 MIT（见 [`LICENSE`](LICENSE)）；第三方素材各自 CC0 / CC-BY（见 [`CREDITS.txt`](CREDITS.txt)）

---

## 它是什么

不是"右键、等、鱼进包"。整套设计围绕三件事：**抛得准、看得懂、拉得住**。

| 系统 | 一句话 |
|---|---|
| **物理抛投** | 蓄力 → 松手，落点由俯仰角、蓄力、竿的属性共同决定；浮漂真的飞出去、真的落水 |
| **读漂** | 浮漂的沉浮节奏告诉你水下是什么在试探；咬钩窗口只有几 tick，要自己判断提竿时机 |
| **张力对抗** | 中鱼后是拉锯：鱼会挣扎、会力竭、会假动作。张力进红区会断线，鱼力清零才算遛翻 |
| **六槽改装** | 鱼竿 / 鱼线 / 渔轮 / 鱼钩 / 拟饵 / 鱼饵，六件各管一项属性；配件有耐久，会磨损 |
| **图鉴与认证** | 47 种鱼，记录体长体重与稀有度；点亮图鉴解锁里程碑奖励 |
| **委托与邮件** | 每天/每周的委托由 NPC 寄信给你；奖励也走邮箱，点【领取】才入账 |
| **称号与联赛** | 成就、称号、钓鱼比赛与赛季排行榜 |

**47 种鱼**：从 3 克的入门小杂鱼到需要特定线号才拉得动的红档大鱼，每种都有自己的手感档案（拉力、体力、挣扎节奏、假动作概率）。

---

## 安装

1. 装好 **NeoForge 21.1.x**（Minecraft 1.21.1）；
2. 把 `anglertackle-x.y.z.jar` 放进 `.minecraft/mods/`；
3. 启动游戏。首次进入世界会收到一本《钓鱼手册》（在邮箱里，点【领取】）。

> 单人存档直接用；装到服务器时**只需装在服务端 + 客户端各一份**（本模组是双端模组）。

---

## 从源码构建

本仓库**没有**用 Gradle 官方 wrapper（`gradle/wrapper/gradle-wrapper.jar`）——开发机到 `services.gradle.org` 与 GitHub 不通，所以工具链走的是项目自带的脚本：

```bat
:: 1) 一次性准备 JDK 21 + Gradle（走国内镜像，落到 .jdk\）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\get-toolchain.ps1

:: 2) 构建
tools\gradlew.cmd build
```

产物在 `build/libs/anglertackle-<version>.jar`。

> 你机器上如果已经有 Gradle 9.x 与 JDK 21，也可以直接 `gradle build`；工程用的是
> **ModDevGradle 2.x**（`net.neoforged.moddev`），不需要 ForgeGradle。

---

## 目录结构

```
src/main/java/com/whitecobalt/anglertackle/   模组源码
src/main/resources/                            资源、语言文件、数据包（教程书）
tools/                                         构建/生成器/自检/调参器（开发者工具）
docs/                                          设计文档（中文，按系统分册）
```

⚠ `tools/` 与 `docs/` 是开发期资产，**不参与运行**；删掉也能正常构建，但会失去生成器与自检。

---

## 许可证与素材

- **代码**：MIT。你可以自由使用、修改、再分发、商用，保留版权与许可声明即可。
- **美术 / 音频素材**：**不在 MIT 覆盖范围内**，各自采用 CC0 或 CC-BY，作者、来源与许可证逐条登记在 [`CREDITS.txt`](CREDITS.txt)。
  如果你要再分发（包括打进整合包），请一并保留 `CREDITS.txt`。

---

## 状态

开发中。数值、界面与文档仍在迭代；配置项与存档格式**尚未冻结**，跨大版本可能需要迁移。

发现 bug 或有建议：请开 issue，附上 `logs/latest.log` 与复现步骤（模组会把关键判定打进日志，便于对账）。
