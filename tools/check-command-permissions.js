'use strict';
/**
 * check-command-permissions.js —— 守住用户 2026-10-11 定的那条规矩：
 *
 *   "需要注意的是本 mod 很多指令本就是**不应该有权限限制**的，**除非是明显影响平衡**。"
 *   （同一条里还点了名：排行榜"点击那个按钮执行打开排行榜的指令，**无需权限**"。）
 *
 * ── 为什么需要它 ─────────────────────────────────────────────
 * "某条指令忽然要 OP"的坏性质：
 *   ① **本地单人存档测不出来** —— 单人房主永远是 OP（权限等级 4）⇒ 怎么试都能用 ✗；
 *   ② 症状是"玩家说用不了"，而玩家往往以为是自己打错了，不会报给你 ✗；
 *   ③ 反向也危险：`/atl coins add` 这类**凭空造钱**的口子一旦漏掉门槛，
 *      在多人服上就是经济直接崩，而且没有任何日志 ✗。
 * 所以权限必须**只有一处真源**（{@code AnglerCommands.OP_ONLY}），这里双向守着。
 *
 * 断言：
 *   A. `/atl` 树里的子指令**一律**由 `lit(...)` 建（不许再手写 `Commands.literal("x")`
 *      —— 手写就意味着"这条的权限由某个人当时随手决定"）。
 *   B. `OP_ONLY` 恰好 = {stage, coins, resetstock, repair}（**双向**：加进去要红、删出去也要红）。
 *   C. 这四个名字在树里真的有对应指令（拼错一个字母 = 那条指令其实没门槛，而白名单看着很齐全）。
 *   D. `lit()` 真的把 2 级门槛挂上了（26.1.2：`src.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER)`，
 *      旧的 `hasPermission(2)` 已随 PermissionSet 改造删除），并且判据里用的是 `OP_ONLY`。
 *   E. 单条指令上不许再出现**第二处** `hasPermission(` （两处真源 = 以后改一处漏一处）。
 *   F. 每条 OP_ONLY 的旁边**必须有一句理由注释**（"为什么它影响平衡"）——
 *      没有理由的白名单，下一个人只会照着加，最后所有指令都要 OP。
 *   G. 用户点名的 `/atl rank` **不许**有门槛（排行榜按钮与它是同一条路）。
 *
 * 用法：node tools/check-command-permissions.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 指令权限检查（默认人人可用，只有"明显影响平衡"的才要 OP） ===\n');

const raw = fs.readFileSync(path.join(ROOT, CMD), 'utf8');
// 判源码时剥掉注释：注释里会写 hasPermission / Commands.literal（说明文字），
// 不剥就会把"解释"当成"实现"（本仓库踩过同类假红）。
const src = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------- A. 一律 lit()
//
// ⚠ 2026-10-11 精化：这里原先"见到 `.then(Commands.literal("x"))` 就红" ——
//   而称号系统需要一个**纯分组节点** `/atl title`（它自己不可执行，四个叶子
//   `list/use/grant/revoke` 才是命令）。分组节点**不能**走 lit()：Brigadier 的
//   `requires` 会**向下继承**，给 `title` 挂上 OP 就等于把 `list`/`use` 也锁掉 ✗
//   （而"看别人的称号"正是用户点名要无权限的那条）。
//   所以判据改成：
//     · **叶子**（带 `.executes(...)` 的）**一律**由 lit(...) 建；
//     · 允许**不可执行的纯分组节点**手写，但它不许带 `.requires(`（权限只能在叶子上决定）。
//   负例 `cmdperm-group-gated` 会盯住后半条：给分组节点挂 requires 必须红。
//
// ⚠ 2026-10-12 补充：`title` 现在**自己也可执行**了（"称号佩戴在哪，很难发现。"
//   ⇒ 光打 `/atl title` 就开界面），于是它必须改走 `lit("title")`。
//   这里的关键是：`"title"` **不在** OP_ONLY 里 ⇒ lit() 给它的谓词恒为真
//   ⇒ 依然不会向下继承锁掉 list/use（"挂在分组上的 requires"那个坑没有被重新踩进来）。
//   ⇒ 上面那条判据**一个字都不用改**，它自己就要求了这个改法 ✓。
{
  // 逐条 `.then(...)` 节点切出来，判断它是不是"可执行的叶子"
  const nodes = [...src.matchAll(/\.then\((\w*(?:Commands\.literal|lit)\("([a-z_]+)"\)[\s\S]{0,400}?)\)\)/g)];
  const bareLeaves = [];
  const gatedGroups = [];
  const lits = [];
  for (const m of src.matchAll(/\.then\((lit|Commands\.literal)\("([a-z_]+)"\)([\s\S]{0,600}?)(?=\.then\((?:lit|Commands\.literal)\("|$)/g)) {
    const kind = m[1];
    const name = m[2];
    const body = m[3];
    const executable = /\.executes\(/.test(body);
    if (kind === 'lit') {
      lits.push(name);
    } else if (executable) {
      bareLeaves.push(name);
    } else if (/\.requires\(/.test(body)) {
      gatedGroups.push(name);
    }
  }
  if (bareLeaves.length) {
    bad('/atl 树里有**可执行叶子**手写 Commands.literal（' + bareLeaves.join(', ') + '）—— '
      + '手写就意味着权限由当时那个人随手决定；请改成 lit("…")');
  } else if (gatedGroups.length) {
    bad('纯分组节点被挂了 requires（' + gatedGroups.join(', ') + '）—— Brigadier 的 requires '
      + '会向下继承，等于把整棵子树（含 list/use）一起锁掉 ✗');
  } else {
    ok('/atl 的可执行子指令全部由 lit(...) 建（' + lits.length + ' 条：'
      + [...new Set(lits)].sort().join(', ') + '）；分组节点不带 requires ✓');
  }
  void nodes;
}

// ---------------------------------------------------------------- B. OP_ONLY 恰好这七条
const mBlock = /OP_ONLY\s*=\s*java\.util\.Set\.of\(([\s\S]*?)\);/.exec(src);
// 2026-10-11 加两条（称号系统）：grant / revoke 改的是**别人**的显示身份 ⇒ 影响他人，
// 属于用户口径里的"明显影响平衡"。⚠ 同一次改动里 `list` / `use` **故意不在表里** ——
// 看别人不等于改别人，而 use 只改自己（负例 cmdperm-title-open 会盯着这条）。
// 2026-10-12 加一条（邮件箱）：`send` = 服主给任意玩家发信 + 附带鱼币 ⇒ 凭空给钱 + 发东西。
// 2026-10-12 加两条（联赛，docs/37）：`start` = 让全服立刻收到邀请（并结算上一期）、
// `settle` = 立刻发一轮奖励（币 + 物品 + 经验 + 称号）⇒ 与 send 同一类。
// ⚠ 同一组里 `/atl league`（看状态）与 `/atl league stats`（看观测指标）**不在表里**：
//   那是看数据，AGENTS §六 明说"看数据的一律不加门槛"。
// 2026-10-12 加一条（用户："增加经验的指令"）：`add` = 加垂纶经验
// （`/atl xp add [玩家] <数量>`）⇒ 凭空推进等级与商店档位，与 stage 同一类。
// ⚠ 它同时是 `/atl coins add` 的叶子名（两条本来都要 OP）；而 `/atl xp`（看进度）不加门槛。
// 2026-10-12 加一条（比赛，docs/35）：`stop` = 立刻结束并结算一场比赛（发鱼币 + 冠军称号）；
// 开赛那条叶子叫 `start`（联赛加的，已在表里）⇒ `/atl contest start` 自动继承 OP 门槛。
// ⚠ 而 `/atl contest`（看本场）与 `/atl contest last`（看上一场）**不在表里** ✓。
const EXPECT = ['add', 'coins', 'grant', 'repair', 'resetstock', 'revoke', 'send', 'settle',
  'stage', 'start', 'stop'];
let listed = [];
if (!mBlock) {
  bad('读不到 OP_ONLY —— 权限没有唯一真源了');
} else {
  listed = [...mBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const extra = listed.filter((x) => !EXPECT.includes(x));
  const missing = EXPECT.filter((x) => !listed.includes(x));
  if (extra.length) {
    bad('OP_ONLY 里多了：' + extra.join(', ') + ' —— 只有"明显影响平衡"的才该进来；'
      + '要是确实该加，就连同理由一起改这里和 EXPECT（检查器不替你决定，但必须是你改的）');
  } else if (missing.length) {
    bad('OP_ONLY 里少了：' + missing.join(', ') + ' —— 它们都能凭空改数值/改别人的东西：'
      + 'stage 改等级 / coins 造钱 / resetstock 刷限购 / repair 免费修竿 / grant+revoke 改别人的称号 ✗');
  } else {
    ok('OP_ONLY 恰好 ' + EXPECT.length + ' 条：' + listed.join(' / ') + '（与"明显影响平衡"一一对应）');
  }
}

// ---------------------------------------------------------------- C. 白名单里的名字在树里真的有
{
  const names = new Set([...src.matchAll(/\.then\(lit\("([a-z_]+)"\)/g)].map((m) => m[1]));
  const ghost = listed.filter((n) => !names.has(n));
  if (ghost.length) {
    bad('OP_ONLY 里的 ' + ghost.join(', ') + ' 在树里找不到同名指令 —— '
      + '拼错一个字母的后果是"那条真指令其实没门槛"，而白名单看起来一切正常 ✗');
  } else if (listed.length) {
    ok('这 ' + EXPECT.length + ' 条白名单都能对上真实指令（不是幽灵条目）');
  }
}

// ---------------------------------------------------------------- D. lit() 真的挂了门槛且读 OP_ONLY
{
  const f = /private static[\s\S]{0,200}?lit\(String name\)\s*\{([\s\S]*?)\n    \}/.exec(src);
  if (!f) bad('找不到 lit(String name) —— 子指令没有统一入口了');
  else {
    const body = f[1];
    if (!/OP_ONLY\.contains\(name\)/.test(body)) {
      bad('lit() 没有读 OP_ONLY（那白名单形同虚设）');
    } else if (!/src\.permissions\(\)\.hasPermission\(\s*Permissions\.COMMANDS_GAMEMASTER\s*\)/.test(body)) {
      // 26.1.2：CommandSourceStack 持 PermissionSet，旧的 hasPermission(int) 已删除；
      // 2 级 = GAMEMASTER（Permissions.COMMANDS_GAMEMASTER，server/permissions/Permissions.java:7）。
      bad('lit() 里没有按 26.1.2 的权限 API 判 2 级（src.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER)）'
        + ' —— 白名单里的指令其实人人可用（造钱口子敞着）');
    } else if (!/\bimport\s+net\.minecraft\.server\.permissions\.Permissions\s*;/.test(raw)) {
      bad('用了 Permissions.COMMANDS_GAMEMASTER 却没有 import net.minecraft.server.permissions.Permissions'
        + ' —— 编译就过不了（或者被同名常量骗过去了）');
    } else {
      ok('lit() 用 OP_ONLY.contains(name) + permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER) 决定权限（2 级 = GAMEMASTER）');
    }
  }
}

// ---------------------------------------------------------------- E. 不许第二处 hasPermission
{
  const all = [...src.matchAll(/hasPermission\(/g)];
  if (all.length !== 1) {
    bad('源码里有 ' + all.length + ' 处 hasPermission( —— 只允许 lit() 里那一处。'
      + '多出来的每一处都是"某个指令偷偷要 OP"，而且以后改权限要改好几个地方 ✗');
  } else {
    ok('hasPermission( 全文件只有一处（在 lit() 里）—— 权限只有一个真源');
  }
}

// ---------------------------------------------------------------- F. 每条都要有理由注释
{
  const noReason = [];
  // 理由写在 OP_ONLY **上方那段 javadoc** 里（一处真源，别在集合里再抄一遍 ——
  // 两处都写必然漂移：改了 javadoc 忘改旁边那行，读代码的人只会更迷惑）。
  // 判据：`{@code 名字}` 之后 200 字内要有中文说明（只出现名字不算理由）。
  const commentEnd = raw.indexOf('private static final java.util.Set<String> OP_ONLY');
  const commentStart = raw.lastIndexOf('/**', commentEnd);
  const block = (commentStart >= 0 && commentEnd > commentStart)
    ? raw.slice(commentStart, commentEnd) : '';
  for (const name of listed) {
    const hit = new RegExp('\\{@code ' + name + '\\}([\\s\\S]{0,200})').exec(block);
    if (!hit || !/[\u4e00-\u9fa5]/.test(hit[1])) noReason.push(name);
  }
  if (!block) {
    bad('OP_ONLY 上方没有 javadoc 说明 —— 权限白名单必须写明"为什么这几条要 OP"');
  } else if (noReason.length) {
    bad('OP_ONLY 里这几条没有一句理由：' + noReason.join(', ')
      + ' —— 没有理由的白名单，下一个人只会照着加，最后所有指令都要 OP');
  } else if (listed.length) {
    ok('这 ' + EXPECT.length + ' 条白名单每条都写了"为什么它影响平衡"（写在 OP_ONLY 上方，只有一处）');
  }
}

// ---------------------------------------------------------------- G. /atl rank 必须人人可用
{
  const rank = /\.then\(lit\("rank"\)/.test(src);
  const gated = new RegExp('lit\\("rank"\\)\\s*\\.requires\\(').test(src);
  if (!rank) bad('找不到 /atl rank（排行榜按钮与它是同一条路）');
  else if (gated || listed.includes('rank')) {
    bad('/atl rank 被加了权限门槛 —— 用户 2026-10-11 明说排行榜"**无需权限**"，'
      + '图鉴里的按钮走的就是这条指令');
  } else {
    ok('/atl rank 无门槛（用户点名：排行榜不需要权限）');
  }
}

// ---------------------------------------------------------------- H. 称号的 list/use 必须人人可用
//
// 用户 2026-10-11："称号需要做到的是**不止自己连别人也能看到**" +
// "本 mod 很多指令本就是不应该有权限限制的，除非是明显影响平衡"。
// ⇒ `/atl title list [玩家]` 与 `/atl title use <id>` **不许**挂门槛：
//   前者是"别人也看得到"的那一层，后者只改自己。
// ⚠ 这条必须写成断言：挂上 OP 之后**本机单人存档永远测不出来**（房主默认权限 4），
//   线上症状只是"玩家说用不了"，而玩家多半以为自己打错了 ✗（与 AGENTS.md §六同一个坑）。
{
  const hasList = /\.then\(lit\("list"\)/.test(src);
  const hasUse = /\.then\(lit\("use"\)/.test(src);
  const listGated = /lit\("list"\)\s*\.requires\(/.test(src) || listed.includes('list');
  const useGated = /lit\("use"\)\s*\.requires\(/.test(src) || listed.includes('use');
  if (!hasList || !hasUse) {
    bad('找不到 /atl title list 或 /atl title use（"别人也看得到"与"佩戴"就靠这两条）');
  } else if (listGated) {
    bad('/atl title list 被加了权限门槛 —— 用户要的就是"不止自己连别人也能看到"，'
      + '加门槛等于把这条功能锁掉（而单人存档测不出来）');
  } else if (useGated) {
    bad('/atl title use 被加了权限门槛 —— 它只改自己（与设置界面同一条纪律：不带 targetUuid）');
  } else {
    ok('/atl title list 与 use 都无门槛（看别人 ≠ 改别人；use 只改自己）');
  }
}

// ---------------------------------------------------------------- I. 邮件的 read/claim/readall 必须人人可用
//
// 用户口径同上："看数据、改自己"的一律不加门槛。邮件三条（读 / 领 / 全部已读）
// **只作用于发起者自己**（`MailService.claim(player, id)` 没有 target 参数），
// 所以不许挂 OP —— 挂了就等于"玩家领不了自己的奖励"，而单人存档测不出来 ✗。
// ⚠ 只有 `mail send`（服主给任意人发信 + 附带鱼币）需要 OP，它已在 OP_ONLY 里。
{
  const needs = ['read', 'claim', 'readall'];
  const missing = needs.filter((n) => !new RegExp('\\.then\\(lit\\("' + n + '"\\)').test(src));
  const gated = needs.filter((n) => listed.includes(n)
    || new RegExp('lit\\("' + n + '"\\)\\s*\\.requires\\(').test(src));
  if (missing.length) {
    bad('找不到这几个邮件子指令：' + missing.join(', ') + '（玩家就领不了自己的邮件了）');
  } else if (gated.length) {
    bad('邮件指令被加了权限门槛：' + gated.join(', ')
      + ' —— 它们只改发起者自己，加门槛等于玩家领不了自己的奖励（单人存档测不出来）✗');
  } else {
    ok('/atl mail 的 read / claim / readall 都无门槛（只改自己）；send 在 OP_ONLY 里 ✓');
  }
}

console.log('');
if (fail === 0) {
  console.log('✅ 指令权限检查通过：默认人人可用，只有 ' + EXPECT.length + ' 条"影响平衡"的要 OP，且只有一处真源');
  process.exitCode = 0;
} else {
  console.log('❌ 指令权限检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
