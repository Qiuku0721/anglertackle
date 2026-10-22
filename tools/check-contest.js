'use strict';
/**
 * check-contest.js —— 守住**钓鱼比赛**（用户 2026-10-11 定案；策划 `docs/35`）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * 比赛的坏法全是"**不报错、只是规则悄悄变了**"：
 *   ① 计时用"剩余秒数"而不是绝对结束刻 ⇒ **重启一次就漂**（40 分钟的比赛变 25 分钟）；
 *   ② 改成内存里的静态表 ⇒ 重启后比赛消失、成绩丢光；
 *   ③ 在别处再记一次分 ⇒ 同一尾鱼记两遍（榜单看着"大家都很猛"）；
 *   ④ 把 `contest` 塞进 OP 白名单 ⇒ **查询也要 OP**（违背用户"指令默认无门槛"，
 *      而且单人存档测不出来：房主永远是 OP ✗）；
 *   ⑤ 去掉结算幂等 ⇒ `/atl contest stop` 连点两次就发两遍钱（经济当场崩）；
 *   ⑥ 允许两场重叠 ⇒ "这一尾算哪一场"无法回答；
 *   ⑦ 公告写死 3 条 / 0 人上鱼时静默 ⇒ 与配置不符 / 玩家以为比赛没结束。
 *
 * ── 判据（六组）─────────────────────────────────────────────
 *   A. 时间：**绝对结束刻**（累计刻），不是"剩余秒数"；世界级 SavedData（重启后继续）
 *   B. 计分：**只有一处挂钩点**（`LeaderboardHooks.onLanded`），数值走 `Leaderboard.valueOf`；
 *      并列用"成绩 → 先达成者 → UUID"三级键
 *   C. 开赛：重叠被拒 + 人数门槛；时长/赛制**开赛时钉死**
 *   D. 结算：幂等（只发一次）+ 离线也拿得到（待领队列）+ 冠军称号
 *   E. 数字全部走配置；奖励只有前三名（**没有参加奖** —— 防小号挂着）
 *   F. 指令权限：`start`/`stop` 要 OP，`contest`/`last` 不要；中英语言键齐全
 *
 * 用法：node tools/check-contest.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const { stripComments: strip } = require('./java-source.js');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const PKG = 'src/main/java/com/whitecobalt/anglertackle/contest/';
const CONTEST = PKG + 'Contest.java';
const DATA = PKG + 'ContestData.java';
const SVC = PKG + 'ContestService.java';
const HOOK = 'src/main/java/com/whitecobalt/anglertackle/leaderboard/LeaderboardHooks.java';
const SNAP = 'src/main/java/com/whitecobalt/anglertackle/leaderboard/RankSnapshot.java';
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
const TUNING = 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java';
const CFG = 'src/main/java/com/whitecobalt/anglertackle/Config.java';
const SRVEV = 'src/main/java/com/whitecobalt/anglertackle/event/ServerEvents.java';
const JOIN = 'src/main/java/com/whitecobalt/anglertackle/event/FirstJoinEvents.java';

console.log('=== 比赛检查（时间 / 计分 / 开赛 / 结算 / 配置 / 权限） ===\n');

for (const f of [CONTEST, DATA, SVC]) {
  if (!exists(f)) {
    console.error('❌ 缺 ' + f + ' —— 比赛还没落地（docs/35 M2）');
    process.exit(1);
  }
}
const contest = strip(read(CONTEST));
const data = strip(read(DATA));
const svc = strip(read(SVC));
const cmd = strip(read(CMD));
const cfg = strip(read(CFG));
const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
const has2 = (k) => String(zh[k] || '').trim() && String(en[k] || '').trim();

// ---------------------------------------------------------------- A. 时间与世界数据
{
  // 存的是**绝对结束刻**：字段名与语义都要对得上（"剩余秒数"那种写法会重启即漂）
  if (/public long endGame;/.test(data) && /public long startGame;/.test(data)) {
    ok('存的是**绝对时刻**（startGame / endGame 两个累计刻），不是"剩余秒数" ✓');
  } else {
    bad('比赛数据里没有 startGame / endGame 两个绝对时刻 —— 存"剩余秒数"的话重启一次就不准 ✗');
  }
  if (/d\.endGame = game \+ Contest\.durationTicks/.test(svc)) {
    ok('结束刻 = 开赛刻 + 时长（开赛时一次算清）✓');
  } else {
    bad('结束刻不是"开赛刻 + 时长"算出来的 —— 计时会在某处漂');
  }
  if (/class ContestData extends SavedData/.test(data) && /FILE_ID = "anglertackle_contest"/.test(data)
      && /getDataStorage\(\)\.computeIfAbsent/.test(data)) {
    ok('比赛数据是**世界级 SavedData**（跟存档走、重启后继续）✓');
  } else {
    bad('比赛数据不是世界级 SavedData —— 改成内存静态量的话重启即丢 ✗（docs/35 §9）');
  }
  // 不许出现"把成绩放在静态字段里"的写法
  if (/static\s+(final\s+)?Map<[^>]*>\s+\w*SCORE/i.test(data) || /static .*List<.*> *scores/i.test(data)) {
    bad('成绩表写成了**静态字段** —— 那是"重启即丢"的经典写法 ✗');
  } else {
    ok('成绩表是实例字段（跟着 SavedData 存盘）✓');
  }
  // 计时用累计刻，不用世界时刻
  if (/getGameTime\(\)/.test(svc) && !/getDayTime\(/.test(svc + data)) {
    ok('计时用**累计刻**（getGameTime），不碰会被睡觉/指令改写的世界时刻 ✓');
  } else {
    bad('计时用了世界时刻（getDayTime）—— 睡一觉比赛就结束了 ✗');
  }
}

// ---------------------------------------------------------------- B. 计分只有一处
{
  const hook = strip(read(HOOK));
  const hits = (hook.match(/ContestService\.onCatch\(/g) || []).length;
  if (hits === 1) {
    ok('计分挂钩点**只有一处**（LeaderboardHooks.onLanded —— 与图鉴记账、排行榜、联赛同一处）✓');
  } else {
    bad('ContestService.onCatch 在挂钩文件里出现 ' + hits + ' 次（应为 1）——'
      + '多一处就会"同一尾鱼记两遍" ✗');
  }
  if (/Leaderboard\.valueOf\(rule\.board\(\), c\)/.test(svc)) {
    ok('比赛数值走 Leaderboard.valueOf（与排行榜、联赛同一套口径）✓');
  } else {
    bad('比赛自己算了一遍成绩 —— 口径会与排行榜/联赛分叉 ✗');
  }
  if (/Contest\.ORDER/.test(data) && /Comparator<Entry> ORDER/.test(contest)
      && /a\.atTick\(\), b\.atTick\(\)/.test(contest) && /a\.player\(\)\.compareTo\(b\.player\(\)\)/.test(contest)) {
    ok('并列用三级键（成绩 → **先钓到** → UUID），规则可公示不可操纵 ✓');
  } else {
    bad('并列没有三级键 —— 同重时名次会变成不可解释的（甚至受改名影响）✗');
  }
  if (/game >= d\.endGame[\s\S]{0,40}return;/.test(svc)) {
    ok('结束刻之后上来的那一尾**不计入本场**（跨场归属明确）✓');
  } else {
    bad('没有"结束刻之后不再计分"的判断 —— 结算完还在记分');
  }
}

// ---------------------------------------------------------------- C. 开赛
{
  const start = /public static Start start\(MinecraftServer server[\s\S]*?\n    \}/.exec(svc);
  if (!start) {
    bad('找不到 ContestService.start');
  } else {
    const body = start[0].replace(/\s+/g, ' ');
    if (!/if \(d\.running\) \{ return Start\.BUSY; \}/.test(body)) {
      bad('开赛没有"已有比赛就拒绝" —— 两场重叠会让"这一尾算哪一场"无法回答 ✗（docs/35 §6）');
    } else if (!/getPlayerCount\(\) < min/.test(body)) {
      bad('开赛没有人数门槛（minPlayers，默认 1 = 单人可玩）');
    } else if (!/d\.ruleMode = rule\.ordinal\(\);/.test(body) || !/d\.minutes = Math\.max\(1, minutes\);/.test(body)) {
      bad('赛制/时长没有在**开赛时钉死** —— 中途改配置会让正在进行的这一场换规则 ✗');
    } else {
      ok('开赛：重叠被拒 + 人数门槛 + 赛制与时长当场钉死 ✓');
    }
  }
}

// ---------------------------------------------------------------- D. 结算
{
  const settle = /public static int settle\(MinecraftServer server\)[\s\S]*?\n    \}/.exec(svc);
  if (!settle) {
    bad('找不到 ContestService.settle');
  } else {
    const body = settle[0].replace(/\s+/g, ' ');
    if (!/d\.running = false;/.test(body) || !/boolean first = !d\.settled;/.test(body)) {
      bad('结算没有幂等标记（`running=false` + `settled`）—— `/atl contest stop` 连点两次就发两遍钱 ✗');
    } else if (!/if \(first\) \{/.test(body)) {
      bad('发奖没有包在"第一次结算"里 —— 重复结算会重复发钱 ✗');
    } else {
      ok('结算幂等：关掉这一场 + 只在第一次发奖（重复调用不会发两遍）✓');
    }
  }
  if (/getPlayerList\(\)\.getPlayer\(e\.player\(\)\)/.test(svc) && /pendingCoins\.merge/.test(svc)) {
    ok('离线获奖者的奖励进**待领队列**，登录时兑付（结算不依赖在线）✓');
  } else {
    bad('只给在线玩家发奖 —— 中途下线的人奖励直接丢 ✗');
  }
  if (/contest_champion/.test(svc)) {
    ok('第 1 名同时授予称号「比赛冠军」（docs/38 表里已有这个 id，可重复 ⇒ 显示 ×N）✓');
  } else {
    bad('冠军没有称号 —— 称号表里那条 contest_champion 就永远是空的');
  }
  if (/contest_nobody/.test(svc)) {
    ok('0 人上鱼时明确公告"本场无人上鱼"（不静默）✓');
  } else {
    bad('没人上鱼时什么都不说 —— 玩家会以为比赛没结束 ✗（docs/35 §6 第 1 条）');
  }
}

// ---------------------------------------------------------------- E. 配置与奖励
{
  if (/Tuning\.contestRewardFirst\(\)/.test(contest) && /Tuning\.contestRewardSecond\(\)/.test(contest)
      && /Tuning\.contestRewardThird\(\)/.test(contest)) {
    ok('名次奖励全部走配置（代码里不写死鱼币数）✓');
  } else {
    bad('奖励额度写死在代码里 —— 调参器里改了没反应 ✗（docs/35 §7）');
  }
  const rf = /public static long rewardFor\([\s\S]*?\n    \}/.exec(contest);
  if (rf && /default -> 0L;/.test(rf[0]) && !/case 4|case 5/.test(rf[0])) {
    ok('只有前三名有奖励、**没有参加奖**（防"开小号挂着"的刷法）✓');
  } else {
    bad('奖励名次超出了前三名 —— 参加奖会带来小号刷分 ✗（docs/35 §5）');
  }
  const keys = ['defaultMinutes', 'defaultRuleMode', 'minPlayers', 'rewardFirst', 'rewardSecond',
    'rewardThird', 'autoEveryMinutes', 'announceTop'];
  const missing = keys.filter((k) => !new RegExp('contest\\.' + k + '"').test(read(TUNING))
    || !new RegExp('contest' + k[0].toUpperCase() + k.slice(1)).test(cfg));
  if (missing.length) {
    bad('这些配置项没走完整链路（Config 字段 / Tuning getter / 热重载映射）：' + missing.join('、'));
  } else {
    ok('8 个比赛配置项都在 Config + Tuning + 热重载映射里（调参器里改了当场生效）✓');
  }
  // 公告条数 == announceTop（不是写死的 3）
  if (/Tuning\.contestAnnounceTop\(\)/.test(svc) && /Math\.min\(top, ranked\.size\(\)\)/.test(svc)) {
    ok('公告条数取自 announceTop（配置改了就跟着变）✓');
  } else {
    bad('公告条数写死 —— 与 announceTop 对不上 ✗');
  }
  // 每 tick 遍历？不许
  if (!/for \(.*scores.*\)[\s\S]{0,80}getGameTime/.test(svc)) {
    ok('计分是上鱼时的 O(1) 比较/替换（没有每 tick 遍历成绩表）✓');
  } else {
    bad('出现"每 tick 遍历成绩表"的写法 —— 人数一多就是纯浪费');
  }
}

// ---------------------------------------------------------------- F. 权限与文案
{
  const opBlock = /OP_ONLY\s*=\s*java\.util\.Set\.of\(([\s\S]*?)\);/.exec(cmd);
  const opListed = opBlock ? [...opBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  if (opListed.includes('start') && opListed.includes('stop') && !opListed.includes('contest')) {
    ok('start / stop 在 OP_ONLY 里，而 `/atl contest` 与 `last` 不加门槛 ✓（AGENTS §六）');
  } else {
    bad('比赛指令的权限不对：开赛/停赛要 OP，查询不要（把 contest 整个塞进 OP_ONLY 就是"查询也锁住"✗）');
  }
  if (/lit\("contest"\)/.test(cmd) && /lit\("last"\)/.test(cmd) && /lit\("stop"\)/.test(cmd)) {
    ok('contest / last / stop 三个子指令都走 lit(...)（权限只有一个真源）✓');
  } else {
    bad('有子指令没走 lit(...) —— 权限又会变成"当时那个人随手决定"');
  }
  const want = [];
  for (const r of ['heaviest', 'total_weight', 'high_tier']) want.push('contest.anglertackle.rule.' + r);
  for (const m of ['contest_started', 'contest_started_ok', 'contest_stopped', 'contest_busy',
    'contest_too_few', 'contest_idle', 'contest_running', 'contest_mine', 'contest_no_score',
    'contest_settled', 'contest_nobody', 'contest_last_header', 'contest_no_last',
    'contest_reward', 'contest_reward_offline', 'contest_none_running']) {
    want.push('message.anglertackle.' + m);
  }
  const noLang = want.filter((k) => !has2(k));
  if (noLang.length) bad('语言文件里缺（中/英）：' + noLang.join('、'));
  else ok(want.length + ' 个比赛文案键中英齐全 ✓');

  // 接线：tick / 上鱼 / 登录 / 界面页
  const hooks = [
    ['周期检查', SRVEV, /ContestService\.tick\(/],
    ['上鱼计分', HOOK, /ContestService\.onCatch\(/],
    ['登录兑付', JOIN, /ContestService\.onLogin\(/],
  ];
  const miss = hooks.filter(([, f, re]) => !re.test(strip(read(f)))).map(([n]) => n);
  if (miss.length) bad('比赛的接线缺了：' + miss.join('、'));
  else ok('三个钩子各一行接线：服务端 tick / 上鱼计分 / 登录兑付 ✓');
  if (/CONTEST_ID = "contest"/.test(strip(read(SNAP)))) {
    ok('排行榜界面里有"本场"页（复用同一套渲染：只往同一个包里多塞一块）✓');
  } else {
    bad('排行榜界面没有"本场"页 —— docs/35 M2-3 没做');
  }
}

console.log('');
if (fail) {
  console.log('❌ 比赛检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 比赛检查通过');
