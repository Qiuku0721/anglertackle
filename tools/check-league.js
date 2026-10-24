'use strict';
/**
 * check-league.js —— 守住**联赛**（用户 2026-10-11 定案；策划 `docs/37`）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * 联赛的每一种坏法都**不报错、也不崩**，只是"规则悄悄变成了另一个样子"：
 *   ① 用世界时刻（`getDayTime`）算周期 ⇒ **睡一觉赛季就跳完了**（用户永远想不到是这个原因）；
 *   ② 窗口写成全局的 ⇒ A 的签收时间会影响 B（"每人独立"当场失效）；
 *   ③ 窗口终点不取硬截止 ⇒ 晚签收的人能越过结算时刻还在计分；
 *   ④ 加一句"打满才结算" ⇒ 谁都不打满就永远不结算（钱一直不发）；
 *   ⑤ 发奖先发钱后写流水键 ⇒ 重跑/回档就双发（经济直接崩）；
 *   ⑥ 计分口径混进 `fastest_catch` / `streak` ⇒ 脚本刷榜（调研结论明说这两项可刷）；
 *   ⑦ 奖励数字写死在代码里 ⇒ 调参器里改了没反应（本仓库踩过"改了配置不生效"）；
 *   ⑧ 奖励物品超过邮件 4 格 ⇒ `MailService.send` **静默截掉**多的那件（玩家少了东西没人知道）✗。
 *
 * ── 判据（八组）─────────────────────────────────────────────
 *   A. 时间：只用**累计刻**（`getGameTime`），全链不出现 `getDayTime`；现实口径用毫秒 + 负增量当 0
 *   B. 窗口：**每人独立**（计分读自己的 `windowEnd`）、终点取 `min(签收+窗口, 硬截止)`、
 *      用完只是不计分（绝不去动钓鱼会话）
 *   C. 周期：硬截止**强行结算**（没有"打满才结算"的早退）；锚点 `+= 间隔` 且对回档取 max 钳制；
 *      结算与开期在**同一段代码**里先后完成；三级**轮转**（默认不并开）
 *   D. 计分口径：与排行榜**同一套**（`Leaderboard.valueOf`），**不含** fastest_catch / streak
 *   E. 发奖：流水键 `season|uuid|tier` **先写键后发钱**；离线走待投递队列（结算不依赖在线）；
 *      绝不重置永久数据
 *   F. 数字全部走配置（奖励/间隔/窗口/下限），代码里不出现写死的奖励额
 *   G. 邮件接线：动作走**白名单**且在**领取成功之后**才跑；联赛邮件走 365/30 天保管期；
 *      签收礼与名次奖励的**物品格数 ≤ 4**（邮件附件上限）
 *   H. 接线与文案：tick / 上鱼 / 登录三个钩子各一行；`ruleMode` 与 `Rule` 枚举顺序一致；
 *      `/atl league` 与 `stats` 不加门槛（`start` / `settle` 在 OP_ONLY 里）；中英语言键齐全
 *
 * 用法：node tools/check-league.js
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

const PKG = 'src/main/java/com/whitecobalt/anglertackle/league/';
const LEAGUE = PKG + 'League.java';
const DATA = PKG + 'LeagueData.java';
const SVC = PKG + 'LeagueService.java';
/** 联赛积分（`docs/39` P1/P2）：口径与唯一入口。 */
const PTS = PKG + 'LeaguePoints.java';
const PFD = 'src/main/java/com/whitecobalt/anglertackle/player/PlayerFishingData.java';
const MAILACT = 'src/main/java/com/whitecobalt/anglertackle/mail/MailActions.java';
const MAILSVC = 'src/main/java/com/whitecobalt/anglertackle/mail/MailService.java';
const CONFIG = 'src/main/java/com/whitecobalt/anglertackle/Config.java';
const TUNING = 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java';
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
const LBHOOK = 'src/main/java/com/whitecobalt/anglertackle/leaderboard/LeaderboardHooks.java';
const SRVEV = 'src/main/java/com/whitecobalt/anglertackle/event/ServerEvents.java';
const JOIN = 'src/main/java/com/whitecobalt/anglertackle/event/FirstJoinEvents.java';
const DOC = 'docs/37-联赛功能策划案.md';
/** 联赛积分与赛季制的策划案（`docs/39`）。 */
const DOC39 = 'docs/39-联赛赛季与积分策划案.md';
/** 生成式称号（`docs/39` §5）：模板表 + 快照投影。 */
const DEFS = 'src/main/java/com/whitecobalt/anglertackle/title/TitleDefs.java';
const SNAPC = 'src/main/java/com/whitecobalt/anglertackle/title/TitleSnapshot.java';
/** 联赛商店（`docs/39` P4）：管理器 / 目录（生成物）/ 界面 / 网络包。 */
const MGR = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java';
const CATALOG = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopCatalog.java';
const SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/ShopScreen.java';
const PAYLOAD = 'src/main/java/com/whitecobalt/anglertackle/network/ShopActionPayload.java';

console.log('=== 联赛检查（时间 / 窗口 / 周期 / 计分 / 发奖 / 配置 / 邮件 / 接线） ===\n');

for (const f of [LEAGUE, DATA, SVC]) {
  if (!exists(f)) {
    console.error('❌ 缺 ' + f + ' —— 联赛还没落地（docs/37 L2）');
    process.exit(1);
  }
}
const league = strip(read(LEAGUE));
const data = strip(read(DATA));
const svc = strip(read(SVC));
const mailAct = strip(read(MAILACT));
const mailSvc = strip(read(MAILSVC));
const cfg = strip(read(CONFIG));
const cmd = strip(read(CMD));
const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
const has2 = (k) => String(zh[k] || '').trim() && String(en[k] || '').trim();

// ---------------------------------------------------------------- A. 只用累计刻
{
  const lines = [LEAGUE, DATA, SVC].map((f) => strip(read(f))).join('\n');
  // ⚠ 剥注释再判：这三份文件的注释里**正是在解释**为什么不能用 getDayTime
  const day = /getDayTime\s*\(/.exec(lines);
  if (day) {
    bad('联赛链里出现了 getDayTime() —— 世界时刻会被睡觉/`/time set`/冻结时间改写，'
      + '用它算周期 ⇒ **睡一觉赛季就跳完了** ✗（`docs/37` §3.1）');
  } else if (!/getGameTime\s*\(/.test(svc)) {
    bad('联赛服务里没有 getGameTime() —— 周期是按什么算的？');
  } else {
    ok('周期只用**累计刻**（getGameTime）：睡觉跳夜 / /time set / 冻结时间都影响不了联赛 ✓');
  }
  // 现实口径：负增量必须夹到 0（否则改一次系统时间就能瞬间跨期）
  if (/now\s*-\s*anchor\s*>=\s*intervalOf\(d\)/.test(svc)
      && /while\s*\(now\s*-\s*anchor\s*>=\s*interval\)/.test(svc)) {
    ok('现实口径只比差值、并按整段间隔推进锚点（改系统时间不会瞬间跨期）✓');
  } else {
    bad('找不到"只比差值 + 按间隔推进"的锚点推进 —— 时钟被改一次就可能跳期');
  }
}

// ---------------------------------------------------------------- B. 窗口每人独立
{
  const onCatch = /public static void onCatch\([\s\S]*?\n    \}/.exec(svc);
  if (!onCatch) {
    bad('找不到 LeagueService.onCatch —— 上鱼计分的入口没了');
  } else {
    const body = onCatch[0];
    if (!/m\.windowEnd/.test(body)) {
      bad('计分没有读**这个玩家自己的** windowEnd ⇒ 窗口不是每人独立的 ✗'
        + '（A 的签收时间会影响 B）');
    } else if (!/return;/.test(body)) {
      bad('窗口判定没有"只是不计分"的早退 —— 它可能去拦钓鱼了 ✗');
    } else if (/FishingManager|forget\(|retrieveEarly/.test(body)) {
      bad('计分里出现了动钓鱼会话的调用 —— 窗口用完**只是不计分**，绝不拦他继续钓鱼 ✗'
        + '（`docs/37` §3.4"只计分不惩罚"）');
    } else {
      ok('计分读的是**这个玩家自己的** windowEnd，且窗口用完只是 return（不碰钓鱼会话）✓');
    }
  }
  const we = /public static long windowEnd\([\s\S]*?\n    \}/.exec(league);
  if (!we) {
    bad('找不到 League.windowEnd —— 窗口终点没有唯一实现');
  } else if (!/Math\.min\(/.test(we[0]) || !/hardDeadlineTick/.test(we[0])) {
    bad('窗口终点不是 min(签收刻 + 窗口, 硬截止) —— 只取一边就会"越过结算时刻还在计分"'
      + '或"每人独立"失效 ✗（用户原话：无论有没有打满，结算时也强行截止）');
  } else {
    ok('窗口终点 = min(签收刻 + 窗口, 硬截止)（两处都取）✓');
  }
}

// ---------------------------------------------------------------- C. 周期与结算
{
  const tick = /public static void tick\(MinecraftServer server\)[\s\S]*?\n    \}/.exec(svc);
  if (!tick) {
    bad('找不到 LeagueService.tick —— 周期检查没了');
  } else {
    const body = tick[0];
    const forced = /if\s*\(!d\.settled\s*&&\s*game\s*>=\s*d\.hardDeadlineGame\)\s*\{\s*settle\(server\)/.test(
      body.replace(/\s+/g, ' '));
    const hasPush = /push\(server/.test(body);
    if (!forced) {
      bad('硬截止没有"强行结算"那一段 —— 用户原话是"无论有没有打满，联赛结算时也强行截止" ✗');
    } else if (!hasPush) {
      bad('tick 里只结算不开期 —— 下一期永远不会开始');
    } else {
      ok('硬截止到点**强行结算**（不看有没有人打满），且结算与开期在同一段代码里 ✓');
    }
  }
  const settle = /public static int settle\(MinecraftServer server\)[\s\S]*?\n    \}/.exec(svc);
  if (!settle) {
    bad('找不到 LeagueService.settle');
  } else if (!/if\s*\(d\.seasonId == 0 \|\| d\.settled\)\s*\{\s*return 0;/.test(
    settle[0].replace(/\s+/g, ' '))) {
    bad('settle 开头没有"结算过就不再算"的幂等早退 —— 会被重复调用');
  } else if (/catches\s*<\s*minCatches[\s\S]{0,80}return\s+0/.test(settle[0])) {
    bad('settle 里有"没人打满就不结算"的早退 —— 那会让奖励永远发不出去 ✗');
  } else {
    ok('settle 幂等（结算过就早退），且没有"打满才结算"的旁路 ✓');
  }
  // 回档钳制
  if (/game\s*<\s*d\.lastSeenGame/.test(svc)
      && /Math\.max\(d\.pushAnchorGame,\s*clamped\)/.test(svc)
      && /Math\.max\(d\.hardDeadlineGame,\s*clamped\)/.test(svc)) {
    ok('回档钳制在：累计刻倒退时把锚点与硬截止**向前取 max**（同一期不会被反复触发）✓');
  } else {
    bad('没有回档钳制（`max(存档, 当前)`）—— 回档后同一期会被重复结算 ✗');
  }
  // 轮转（默认不并开）
  if (/nextTierIndex/.test(data) && /nextTierIndex\s*=\s*\(idx \+ 1\)/.test(svc)
      && !/allowConcurrent/.test(cfg)) {
    ok('三级**轮转**（nextTierIndex 推进），且没有"并开"配置项 —— 默认只开一级 ✓'
      + '（分级=分割人口，调研实证）');
  } else {
    bad('三级轮转不成立（要么没推进 nextTierIndex，要么又加回了"并开"开关）');
  }
}

// ---------------------------------------------------------------- D. 计分口径只有一份
{
  if (/Leaderboard\.valueOf\(/.test(svc)) {
    ok('计分数值取自 Leaderboard.valueOf —— 与排行榜**同一套口径**（没有第二份实现）✓');
  } else {
    bad('联赛没有用 Leaderboard.valueOf —— 它自己又写了一遍"怎么算成绩" ✗'
      + '（两份口径迟早分叉，本仓库在档位刻度上栽过两次）');
  }
  const ruleEnum = /public enum Rule \{([\s\S]*?)\n    \}/.exec(league);
  if (!ruleEnum) {
    bad('找不到 League.Rule 枚举');
  } else {
    const banned = ['FASTEST_CATCH', 'STREAK'].filter((x) => ruleEnum[1].includes(x));
    if (banned.length) {
      bad('计分口径里混进了可刷的维度：' + banned.join('、')
        + ' —— 调研结论明说这两项极易被脚本刷，只能作排行榜展示 ✗（`docs/37` §2）');
    } else {
      ok('计分口径不含 fastest_catch / streak（可刷的两项被挡在选项之外）✓');
    }
  }
  // ruleMode 与枚举顺序一致
  const order = ruleEnum ? [...ruleEnum[1].matchAll(/^\s*([A-Z_]+)\("([a-z_]+)"/gm)].map((m) => m[2]) : [];
  const modeSrc = /defineInRange\("ruleMode",\s*(\d+),\s*(\d+),\s*(\d+)\)/.exec(cfg);
  if (!order.length || !modeSrc) {
    bad('读不出 ruleMode 与 Rule 枚举的对应关系（检查器要跟着改）');
  } else if (order.length !== Number(modeSrc[3]) + 1) {
    bad('ruleMode 的取值上限是 ' + modeSrc[3] + '，而 Rule 有 ' + order.length + ' 项 —— 对不上');
  } else {
    // ⚠ 判据要**按位比对**（第 i 个下标 vs 第 i 个枚举项），不能只搜"文件里有没有这些字"：
    //   把枚举里两项换个位置、而注释不动 ⇒ 玩家照着注释选到的就是另一个口径 ✗。
    //   负例 league-rule-order-drift 专门盯这条（只搜关键字的话它抓不到）。
    // ⚠ 锚点必须选**构造函数里那段注释**（"计分口径（开期时钉死）"是唯一的），
    //   不能用 indexOf('ruleMode') —— 那会落在字段声明处，而它后面 900 字里
    //   第一个 `0 = ` 其实来自字段名 `leagueRewardCoinsTop10 = b.comment(...` ✗（踩过一次）。
    const at = cfg.indexOf('计分口径（开期时');
    const block = at < 0 ? '' : cfg.slice(at, at + 900);
    const wrong = [];
    for (let i = 0; i < order.length; i++) {
      const m = new RegExp(i + '\\s*=\\s*([^\\n；]*)').exec(block);
      const text = m ? m[1] : '';
      if (!text.includes(modeOf(order[i]))) {
        wrong.push(i + ' 应是「' + modeOf(order[i]) + '」实际写着「' + text.trim() + '」');
      }
    }
    if (wrong.length) {
      bad('Config 的 ruleMode 注释与 League.Rule 的顺序**逐位对不上**：' + wrong.join('；')
        + ' —— 玩家会照着注释选错口径');
    } else {
      ok('ruleMode（0..' + modeSrc[3] + '）与 League.Rule 的顺序逐位一致：'
        + order.map((id, i) => i + '=' + modeOf(id)).join(' / ') + ' ✓');
    }
  }
}

/** 枚举常量名 → 注释里写的中文名。 */
function modeOf(id) {
  return { heaviest: '最重', total_weight: '总重量', high_tier_count: '金红', codex: '图鉴' }[id] || id;
}

// ---------------------------------------------------------------- E. 发奖幂等与离线
{
  const settle = /public static int settle\(MinecraftServer server\)[\s\S]*?\n    \}/.exec(svc);
  const body = settle ? settle[0] : '';
  const ledgerAt = body.indexOf('d.ledger.add(key)');
  const payAt = body.indexOf('deliver(server, d, e.player()');
  if (ledgerAt < 0) {
    bad('发奖没有写流水键（`season|uuid|tier`）—— 重跑/回档会双发 ✗');
  } else if (payAt < 0) {
    bad('发奖里找不到 deliver(...)');
  } else if (ledgerAt > payAt) {
    bad('**先发钱后写流水键** —— 中间挂掉或重跑就会双发（`docs/37` §5.2 的幂等键必须写在前面）✗');
  } else {
    ok('发奖幂等：流水键 `season|uuid|tier` **先写键、再发钱** ✓');
  }
  // ⚠ 判据必须看**结构**（在线的先 return、随后才写待投递队列），不能只搜两个字符串：
  //   "文件里有 getPlayer(target) 和 pushPending(" 这句话，在把离线分支整个短路掉之后**照样成立** ✗
  //   —— 负例 league-online-only 就是这么设计的（"文件里存在某字符串" ≠ "那件事真的在做"）。
  const deliverFn = /private static void deliver\(MinecraftServer server[\s\S]*?\n    \}/.exec(svc);
  const deliverSrc = deliverFn ? deliverFn[0].replace(/\s+/g, ' ') : '';
  // ⚠ 判据盯**结构**（在线的先 return、随后才写待投递队列），**不锁参数列表** ——
  //   2026-10-13 加"联赛积分"时给 deliver 多传了 `points`，逐字写死的签名当场失配 ✗
  //   （与"锚点漂移"同一类问题：断言该盯行为，不该盯相邻参数的个数 ✓）
  //   但它**不能**放宽成"文件里同时有 getPlayer(target) 和 pushPending(" ——
  //   那样把离线分支整个短路掉之后照样成立 ✗（负例 league-online-only 就是这么设计的）。
  const offlineOk = /if \(online != null\) \{ deliverNow\(online,[^)]*\); return; \} LeagueData\.Pending p = new LeagueData\.Pending\(target\);/.test(deliverSrc);
  if (offlineOk) {
    ok('结算**不依赖在线**：在线的直接投递，离线的写进待投递队列（登录时兑付）✓');
  } else {
    bad('结算只处理在线玩家 —— 离线玩家的奖励会丢（Hypixel 的实测坑）✗');
  }
  // 绝不重置永久数据
  const perm = ['PlayerData.set', 'PlayerData.update', 'codex().put', 'withLevel(', 'setData(']
    .filter((k) => svc.includes(k));
  if (perm.length) {
    bad('联赛服务里出现了改玩家永久数据的调用：' + perm.join('、')
      + ' —— 联赛只重置"本期成绩"，图鉴/纪录/等级/鱼币一律不许碰 ✗（`docs/37` §5.3）');
  } else {
    ok('联赛不写任何永久数据（奖励只走邮件 + addXp + 称号）✓');
  }
}

// ---------------------------------------------------------------- F. 数字全部走配置
{
  const rf = /public static Reward rewardFor\([\s\S]*?\n    \}/.exec(league);
  if (!rf) {
    bad('找不到 League.rewardFor');
  } else {
    const hard = [...rf[0].matchAll(/\b(10000|5000|3000|2000|1200|600|300|500)\b/g)].map((m) => m[1]);
    // 4~10 名的"名次边界"是结构常量（TOP10_RANK），不是奖励额；金额本身不许写死
    const bare = hard.filter((v) => v !== '10' && v !== '4');
    if (bare.length) {
      bad('奖励额写死在代码里：' + [...new Set(bare)].join('、')
        + ' —— 调参器里改了不会有反应（`docs/37` §6"全部可热改"）✗');
    } else {
      ok('奖励额全部走 Tuning（代码里一个写死的金额都没有）✓');
    }
    if (/Tuning\.leagueRewardCoins1st\(\)/.test(rf[0]) && /Tuning\.leagueRewardXp1st\(\)/.test(rf[0])) {
      ok('第 1 名的鱼币与经验确实来自配置（冠军奖最贵，最不能写死）✓');
    } else {
      bad('第 1 名的奖励没有走配置');
    }
  }
  const keys = ['useRealDays', 'minLevel', 'allowBelowLevel', 'smallDays', 'mediumDays', 'largeDays',
    'periodGameDays', 'playerWindowMinutes', 'periodBoundaryHour', 'ruleMode', 'minCatchesToRank',
    'rewardCoinsParticipant', 'rewardCoinsTop10', 'rewardCoins1st', 'rewardCoins2nd', 'rewardCoins3rd',
    'rewardXp1st', 'rewardXp2nd', 'rewardXp3rd', 'scaleMediumCoinsXp', 'scaleLargeCoinsXp',
    'scaleLargeVanillaItems', 'rewardMailKeepDays', 'noticeMailKeepDays', 'inviteOnLogin'];
  const missing = keys.filter((k) => !new RegExp('league\\.' + k + '"').test(read(TUNING))
    || !new RegExp('league' + k[0].toUpperCase() + k.slice(1)).test(cfg));
  if (missing.length) {
    bad('这些配置项没走完整链路（Config 字段 / Tuning getter / 热重载映射）：' + missing.join('、'));
  } else {
    ok('25 个联赛配置项都在 Config + Tuning + 热重载映射里（调参器里改了当场生效）✓');
  }
}

// ---------------------------------------------------------------- G. 邮件接线
{
  const known = /KNOWN\s*=\s*Set\.of\(([^)]*)\)/.exec(mailAct);
  if (!known || !/LEAGUE_JOIN/.test(known[1])) {
    bad('MailActions 的白名单里没有 league_join —— 点【签收】不会报名');
  } else if (!/KNOWN\.contains\(action\)/.test(mailAct)) {
    bad('MailActions 没有按白名单判定 —— 客户端能自造动作 id ✗');
  } else {
    ok('邮件动作走**白名单**（只有 league_join，未知 id 一律忽略）✓');
  }
  // 动作 ↔ 语言键：界面按 `mail.anglertackle.<action>.button` / `.done` 取字
  //   ⚠ 缺键的症状是**按钮上显示一串 mail.anglertackle.league_join.button**，
  //   而单人测试时很容易只点一次就以为"能点就行" ✗ ⇒ 双向核对。
  {
    const ids = [...mailAct.matchAll(/public static final String ([A-Z_]+) = "([a-z_]+)"/g)]
      .map((m) => m[2]);
    const ms = strip(read('src/main/java/com/whitecobalt/anglertackle/client/screen/MailScreen.java'));
    const usesAction = /"mail\.anglertackle\." \+ r\.action \+ "\.button"/.test(ms)
      && /"mail\.anglertackle\." \+ r\.action \+ "\.done"/.test(ms);
    const noLang = [];
    for (const id of ids) {
      for (const suffix of ['button', 'done']) {
        if (!has2('mail.anglertackle.' + id + '.' + suffix)) noLang.push(id + '.' + suffix);
      }
    }
    if (!ids.length) {
      bad('读不出动作 id 常量（检查器要跟着改）');
    } else if (!usesAction) {
      bad('MailScreen 没有按动作取按钮文案（`mail.anglertackle.<action>.button` / `.done`）'
        + ' —— 联赛邀请的按钮会写成"领取"，签收后也不会变成"已签收"');
    } else if (noLang.length) {
      bad('动作缺语言键（中/英）：' + noLang.join('、') + ' —— 按钮上会显示原始键名 ✗');
    } else {
      ok(ids.length + ' 个动作 id 的按钮/已办文案中英齐全（' + ids.join(' / ') + '）✓');
    }
  }
  const claim = /public static Claim claim\([\s\S]*?\n    \}/.exec(mailSvc);
  if (!claim) {
    bad('找不到 MailService.claim');
  } else {
    const body = claim[0];
    // ⚠ 这条断言守的是**附件路径**的顺序："先入账、后动作"。
    //   2026-10-14（1.6.3）起 claim 里有了**两处** MailActions.run：
    //   ① 无附件分支（委托 quest_accept：没有附件可入账，动作照跑 —— 由 check-mail.js J 组守）；
    //   ② 附件路径末尾（联赛签收礼：附件入账之后才跑 —— 就是本条守的）。
    //   所以必须先把 claim 体从 `return Claim.NOTHING;`（①的出口）**切开**，只看附件路径；
    //   直接 indexOf 全文会锚到①上误报（1.6.3 跑闸实测撞上 ✗），
    //   而两侧都 lastIndexOf 又会放过"在 withClaimed 前插一份动作副本"的变异
    //   （负例 league-action-before-claim 正是插副本 —— 原块还在，lastIndexOf 找不到它 ✗）。
    const iNothing = body.indexOf('return Claim.NOTHING;');
    const tail = iNothing < 0 ? body : body.slice(iNothing);
    const runAt = tail.indexOf('MailActions.run(player, m.action())');
    // ⚠ withClaimed 也有两处（①无附件分支的标记 + ②附件路径末尾的标记），
    //   在 tail 里只剩②那一处 —— 它就是"附件已入账"的那个点。
    const claimedAt = tail.lastIndexOf('withClaimed()');
    if (runAt < 0) {
      bad('MailService.claim 的附件路径里没有跑动作 —— 【签收】按钮点了不报名');
    } else if (claimedAt < 0 || runAt < claimedAt) {
      bad('动作在**附件入账之前**就跑了 —— 背包满时会出现"报了名但礼物没领到"✗'
        + '（`docs/36` §4.2：两件事都要发生，顺序不能反）');
    } else {
      ok('动作在**领取成功之后**才跑（背包满会整封回滚 ⇒ 报名也不会发生）✓');
    }
  }
  if (/leagueRewardMailKeepDays/.test(mailSvc) && /leagueNoticeMailKeepDays/.test(mailSvc)
      && /startsWith\("league_invite"\)/.test(mailSvc)) {
    ok('联赛邮件走长保管期（邀请/成绩单 365 天、通知 30 天，据调研改）✓');
  } else {
    bad('联赛邮件没有单独的保管期 —— 30 天会惩罚休假玩家（`docs/37` §6 据调研改）✗');
  }
  // 附件格数 ≤ 4：数每个分支里 add( 的次数
  const inv = /public static Invite inviteGift\([\s\S]*?\n    \}/.exec(league);
  const slots = /MAX_ATTACHMENT_SLOTS\s*=\s*(\d+)/.exec(read('src/main/java/com/whitecobalt/anglertackle/player/MailEntry.java'));
  if (!inv || !slots) {
    bad('读不出签收礼或附件上限（检查器要跟着改）');
  } else {
    const max = Number(slots[1]);
    const branches = inv[0].split(/case [A-Z]+ ->|default ->/).slice(1);
    const over = branches.filter((b) => (b.match(/items\.add\(/g) || []).length > max);
    if (over.length) {
      bad('有一档签收礼的物品格数 > ' + max + ' —— MailService.send 会**静默截掉**多的那件，'
        + '玩家少了东西却没有任何提示 ✗');
    } else {
      ok('三档签收礼的物品格数都 ≤ ' + max + '（不会被静默截断）✓');
    }
  }
  // 奖励也 ≤ 4
  const rf2 = /public static Reward rewardFor\([\s\S]*?\n    \}/.exec(league);
  if (rf2 && slots) {
    const max = Number(slots[1]);
    const branches = rf2[0].split(/case \d ->|default ->/).slice(1);
    const over = branches.filter((b) => (b.match(/items\.add\(/g) || []).length > max);
    if (over.length) bad('有一档名次奖励的物品格数 > ' + max + '（会被静默截断）');
    else ok('三档名次奖励的物品格数都 ≤ ' + max + ' ✓');
  }
}

// ---------------------------------------------------------------- H. 接线与文案
{
  const hooks = [
    ['tick', SRVEV, /LeagueService\.tick\(/],
    ['上鱼计分', LBHOOK, /LeagueService\.onCatch\(/],
    ['登录兑付', JOIN, /LeagueService\.onLogin\(/],
  ];
  const miss = hooks.filter(([, f, re]) => !re.test(strip(read(f)))).map(([n]) => n);
  if (miss.length) bad('联赛的接线缺了：' + miss.join('、') + '（功能写了但没接上）');
  else ok('三个钩子各一行接线：服务端 tick / 上鱼计分 / 登录兑付 ✓（想摘掉就删这三行）');

  const opBlock = /OP_ONLY\s*=\s*java\.util\.Set\.of\(([\s\S]*?)\);/.exec(cmd);
  const opListed = opBlock ? [...opBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  if (opListed.includes('start') && opListed.includes('settle') && !opListed.includes('league')) {
    ok('start / settle 在 OP_ONLY 里（会给全服发东西），而 /atl league 与 stats 不加门槛 ✓');
  } else {
    bad('联赛指令的权限不对：start/settle 该要 OP，league/stats 不该要');
  }
  const stats = /private static int showLeagueStats\([\s\S]*?\n    \}/.exec(cmd);
  // ⚠ 判据必须盯**算式**，不能只搜变量名：负例 league-no-stats 把
  //   `int idle = joined - ranked;` 改成 `int idle = 0;` —— 变量名还在，
  //   只搜 `/idle/` 照样绿 ✗（这条负例第一次跑就是这么溜过去的，实测）。
  const statsBody = stats ? stats[0].replace(/\s+/g, ' ') : '';
  const statsOk = /int joined = d\.members\.size\(\);/.test(statsBody)
    && /int ranked = d\.ranked\(/.test(statsBody)
    && /int idle = joined - ranked;/.test(statsBody)
    && /100\.0 \* idle \/ joined/.test(statsBody);
  if (!statsOk) {
    bad('`/atl league stats` 没有真的算"签收人数 − 上榜人数"（签收后未参赛率）—— '
      + '那正是"参与度虚高但留存差"的早期信号（`docs/37` §4.2 第 3 条）✗');
  } else {
    ok('/atl league stats 真的算并输出签收/上榜/未参赛率（观测指标）✓');
  }
  // 不给"绕开邀请"的报名指令
  if (/lit\("join"\)/.test(cmd)) {
    bad('出现了 `/atl league join` —— 有它就等于绕开邀请，"邀请制"当场失效 ✗');
  } else {
    ok('没有 /atl league join：参赛的唯一入口是邮件里的【签收】按钮 ✓');
  }

  // 语言键：4 个模板 × 标题/正文/按钮 + 级别与口径名 + 用到的 message 键
  const want = [];
  for (const t of ['league_invite', 'league_result', 'league_no_score', 'league_missed']) {
    for (const part of ['title', 'body', 'button']) want.push('mail.anglertackle.' + t + '.' + part);
  }
  // 动作按钮的两把键（界面按动作取字；缺了按钮上就是一串原始键名）
  want.push('mail.anglertackle.league_join.button', 'mail.anglertackle.league_join.done');
  for (const t of ['small', 'medium', 'large']) want.push('league.anglertackle.tier.' + t);
  for (const r of ['heaviest', 'total_weight', 'high_tier_count', 'codex']) {
    want.push('league.anglertackle.rule.' + r);
  }
  for (const m of ['league_none', 'league_header', 'league_running', 'league_closed', 'league_stats',
    'league_started', 'league_settled', 'league_settled_broadcast', 'league_settled_empty',
    'league_join_ok', 'league_join_already', 'league_join_too_late', 'league_join_not_eligible',
    'league_join_no_period']) {
    want.push('message.anglertackle.' + m);
  }
  const noLang = want.filter((k) => !has2(k));
  if (noLang.length) bad('语言文件里缺（中/英）：' + noLang.join('、'));
  else ok(want.length + ' 个联赛文案键中英齐全 ✓');

  // 模板不再需要 sender 映射（服务端只发 template + args）
  if (/sender\.league/.test(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'))) {
    ok('发件人映射里已有 league（邀请信显示"垂纶联赛委员会"）✓');
  } else {
    bad('缺 mail.anglertackle.sender.league —— 联赛邮件会显示成别的发件人');
  }
  if (exists(DOC) && /L1|L2|L3|L4|L5/.test(read(DOC))) {
    ok('策划文档 docs/37 在（实现依据）✓');
  } else {
    bad('缺 docs/37-联赛功能策划案.md');
  }
}

// ---------------------------------------------------------------- I. 联赛积分（`docs/39` P1/P2）
{
  const ptsSrc = exists(PTS) ? strip(read(PTS)) : '';
  const pfdSrc = strip(read(PFD));
  const dataSrc = strip(read(DATA));
  const svcSrc = strip(read(SVC));
  // 文档对账前先把 markdown 记号抹掉（`**5**` / 空格 / 换行都不该影响判定）
  const docSrc = exists(DOC39) ? read(DOC39).replace(/[*`\s|]/g, '') : '';

  if (!ptsSrc) {
    bad('缺 league/LeaguePoints.java —— 积分没有唯一入口（口径会散到调用点）✗');
  } else {
    // ① 口径数字（一个都不许自己发明）
    const baseOk = /BASE_PER_CATCH\s*=\s*5\s*;/.test(ptsSrc);
    const bonusOk = /QUALITY_BONUS\s*=\s*\{\s*0\s*,\s*2\s*,\s*5\s*,\s*10\s*,\s*20\s*,\s*32\s*\}/.test(ptsSrc);
    const rankOk = /RANK_1\s*=\s*1000\s*;/.test(ptsSrc) && /RANK_2\s*=\s*500\s*;/.test(ptsSrc)
            && /RANK_3\s*=\s*300\s*;/.test(ptsSrc) && /RANK_TOP10\s*=\s*200\s*;/.test(ptsSrc);
    if (baseOk && bonusOk && rankOk) {
      ok('积分口径对账：每尾 5 ＋ 白0/绿2/蓝5/紫10/金20/红32；名次 1000/500/300/200 ✓');
    } else {
      bad('积分口径与 `docs/39` §3.1 不一致（基础分 / 品质加成 / 名次分）✗');
    }

    // ② 与策划文档逐条对账（改代码不改文档，或反过来 ⇒ 当场红）
    if (docSrc.includes('白0/绿2/蓝5/紫10/金20/红32')) {
      ok('策划文档 `docs/39` 的品质加成与代码一致 ✓');
    } else {
      bad('`docs/39` 里的品质加成与代码对不上（两边必须一处改一处跟）✗');
    }

    // ③ 上鱼分只接在"签收 + 窗口"那两道闸**之后**（绝不另写一份判定）
    const guardAt = svcSrc.indexOf('if (game > m.windowEnd || game >= d.hardDeadlineGame)');
    const catchAwardAt = svcSrc.indexOf('LeaguePoints.onCatch(');
    const onCatchCalls = (svcSrc.match(/LeaguePoints\.onCatch\(/g) || []).length;
    if (guardAt < 0) {
      bad('`LeagueService.onCatch` 里找不到"窗口/硬截止"那道闸 ✗');
    } else if (catchAwardAt < 0) {
      bad('上鱼积分没有接在联赛计分入口里（那一尾到底算不算，只有那两道闸说了算）✗');
    } else if (catchAwardAt < guardAt) {
      bad('上鱼积分给在**窗口判定之前** —— 未签收 / 窗口外的人也会涨分（`docs/39` D4）✗');
    } else if (onCatchCalls !== 1) {
      bad('`LeaguePoints.onCatch(` 在 LeagueService 里出现 ' + onCatchCalls + ' 次（只允许 1 次）✗');
    } else {
      ok('上鱼积分接在"已签收 ＋ 窗口内"那道闸之后，且只有一个调用点 ✓');
    }

    // ④ 名次分：与流水键**同一个循环**，且在**写键之后**（先写键后加分 ⇒ 重跑不双发）
    const settleFn = /public static int settle\(MinecraftServer server\)[\s\S]*?\n    \}/.exec(svcSrc);
    const settleBody = settleFn ? settleFn[0] : '';
    const keyAt = settleBody.indexOf('d.ledger.add(key)');
    const rankAt = settleBody.indexOf('LeaguePoints.rankAward(');
    if (keyAt < 0 || rankAt < 0) {
      bad('结算里找不到"流水键 + 名次分"（重跑会双发名次分）✗');
    } else if (rankAt < keyAt) {
      bad('名次分**先发后写键** —— 重复结算会多给一次积分（`docs/39` §8.2）✗');
    } else {
      ok('名次分与流水键同一循环，且**先写键后加分** ✓');
    }

    // ⑤ 积分只增不减：加分的唯一入口是 award，减少只允许出现在 spend（P4 起）
    const hasAwardOnly = /public static long award\(ServerPlayer player, int delta, String reason\)/.test(ptsSrc);
    if (hasAwardOnly) {
      ok('加分的唯一入口是 `LeaguePoints.award(...)` ✓');
    } else {
      bad('`LeaguePoints.award(...)` 不存在 —— 加分路径会散开 ✗');
    }
  }

  // ⑥ 玩家数据：字段必须是 optionalFieldOf（老存档读不出整份数据 = 钱包归零 ✗）
  if (/optionalFieldOf\("league_points", 0L\)/.test(pfdSrc)) {
    ok('`league_points` 走 optionalFieldOf（老存档零迁移）✓');
  } else {
    bad('`PlayerFishingData.league_points` 没有用 optionalFieldOf ⇒ 老存档可能整份读不出来 ✗');
  }

  // ⑦ 名次分不依赖在线：待投递队列必须**存得下、读得回**积分
  // 26.1.2：LeagueData 的持久化改成了 Codec（Pending ↔ PendingRow 记录），
  // 不再手写 putInt/getInt。判据跟着换写法，语义不变：**积分必须存得下、也读得回**。
  const storeOk = /Codec\.INT\.optionalFieldOf\("points", 0\)\.forGetter\(PendingRow::points\)/.test(dataSrc);
  const loadOk = /pend\.points\s*=\s*p\.points\(\)/.test(dataSrc);
  if (storeOk && loadOk) {
    ok('离线待投递队列带上了积分（登录时补发：`docs/37` §5.2 的"绝不吞掉")✓');
  } else {
    bad('离线玩家的名次分丢了 —— Pending 里没存 points 或没读回来（结算只处理在线玩家）✗');
  }
}

console.log('');

// ---------------------------------------------------------------- J. 生成式称号与赛季号（`docs/39` §5）
{
  const defsSrc = exists(DEFS) ? strip(read(DEFS)) : '';
  const snapSrc = exists(SNAPC) ? strip(read(SNAPC)) : '';
  const svcSrc = strip(read(SVC));

  // ① 模板另立一表：**模板 id 绝不许出现在 ALL 里**（否则会把 docs/38 的逐条对账撑爆）
  const tmplIds = [...defsSrc.matchAll(/new Template\("([a-z_]+)"/g)].map((m) => m[1]);
  if (tmplIds.length !== 4) {
    bad('TitleDefs.TEMPLATES 里应有 4 个模板（冠/亚/季/纪念），实际 ' + tmplIds.length + ' 个 ✗');
  } else {
    const allBlock = /public static final List<Def> ALL = List\.of\(([\s\S]*?)\n    \);/.exec(defsSrc);
    const allSrc = allBlock ? allBlock[1] : '';
    const leaked = tmplIds.filter((t) => new RegExp('"' + t + '"').test(allSrc));
    if (leaked.length) {
      bad('模板跑进了 ALL：' + leaked.join('、') + '（会把 docs/38 对账与"40 条进度"一起撑爆）✗');
    } else {
      ok('生成式模板另立一表，**ALL 40 条一个字节没动**（' + tmplIds.join('/') + '）✓');
    }
  }

  // ② 实例白名单三道都要（模板在表里 ＋ 赛季号 > 0 ＋ 规模在白名单）
  if (/return template\(templateIdOf\(id\)\) != null && seasonOf\(id\) > 0 && sizeIndex\(id\) >= 0;/.test(defsSrc)) {
    ok('实例 id 走白名单校验（模板 ＋ 赛季号>0 ＋ 规模三选一）✓');
  } else {
    bad('`validInstance` 没有同时校验"模板 + 赛季号 + 规模" —— 乱写的实例会被认成合法称号 ✗');
  }

  // ③ 赛季号**独立计数**：绝不拿 seasonId 反推（allowConcurrent 打开时界桩会漂）
  const derived = /seasonId\s*[-+)]?\s*\/\s*3|\/\s*3\s*\+\s*1/.test(svcSrc);
  const counter = /if \(d\.seasonNo <= 0 \|\| idx == 0\)/.test(svcSrc) && /d\.seasonNo \+ 1/.test(svcSrc);
  if (derived) {
    bad('赛季号是从 seasonId 反推的（`/3+1` 那类）—— 三级并开时界桩会漂 ✗');
  } else if (!counter) {
    bad('`push` 里找不到"轮到小型就进新赛季"的独立计数 ✗');
  } else {
    ok('赛季号独立计数（"轮到小型即新赛季"），不靠 seasonId 反推 ✓');
  }

  // ④ 名次称号：1/2/3 各一条，且用**赛季号**拼实例 id
  const t3 = /rank == 1 \? "league_champ"/.test(svcSrc) && /rank == 2 \? "league_runnerup"/.test(svcSrc)
      && /rank == 3 \? "league_third"/.test(svcSrc);
  const bySeason = /titleFor\(d\.seasonNo, d\.tierId, rank\)/.test(svcSrc);
  if (t3 && bySeason) {
    ok('名次称号：冠/亚/季三档都发，且用**赛季号**拼实例（S{n}{规模}联赛冠军）✓');
  } else {
    bad('名次称号不对：要么缺档（冠/亚/季要都发），要么没用赛季号 ✗');
  }

  // ⑤ ⚠ 最易漏的一步：快照**必须**把 owned 里的实例补成行（不补 = 发了也看不见）
  const snapLoop = /for \(String id : t\.owned\(\)\)/.test(snapSrc);
  if (snapLoop && /TitleDefs\.validInstance\(id\)/.test(snapSrc)) {
    ok('称号快照补了"owned 里不在 ALL 的实例"行（不补的话界面与 /atl title 里看不见）✓');
  } else {
    bad('称号快照只按 ALL 拍 —— 生成式赛季称号"发了也看不见"（docs/39 §5.3⑥ 的坑）✗');
  }
}
// ---------------------------------------------------------------- K. 联赛商店（`docs/39` P4）
{
  const ptsSrc = exists(PTS) ? strip(read(PTS)) : '';
  const mgrSrc = exists(MGR) ? strip(read(MGR)) : '';
  const dataSrc = strip(read(DATA));
  const screenSrc = exists(SCREEN) ? strip(read(SCREEN)) : '';
  const paySrc = exists(PAYLOAD) ? strip(read(PAYLOAD)) : '';
  const catSrc = exists(CATALOG) ? strip(read(CATALOG)) : '';

  // ① 扣分只有一处（"哪一处能让积分变少"必须数得出来）
  const spendCalls = (mgrSrc.match(/LeaguePoints\.spend\(/g) || []).length;
  const withPts = (ptsSrc.match(/withLeaguePoints\(/g) || []).length;
  if (/public static boolean spend\(ServerPlayer player, int points\)/.test(ptsSrc) && spendCalls === 1
      && withPts === 1) {
    ok('扣积分只有一个入口（`LeaguePoints.spend`：全仓唯一会调 `withLeaguePoints` 的地方，且只被调用 1 次）✓');
  } else {
    bad('扣积分的路径不止一处（spend 调用 ' + spendCalls + ' 次 / LeaguePoints 里 withLeaguePoints '
      + withPts + ' 处）—— "哪一处能扣分"就数不清了 ✗');
  }

  // ② **先扣分、再发货**（反过来异常时会"白拿"）
  const buy = /private static void buyLeague\(ServerPlayer player, int index\)[\s\S]*?\n    \}/.exec(mgrSrc);
  const body = buy ? buy[0] : '';
  const spendAt = body.indexOf('LeaguePoints.spend(');
  const giveAt = body.indexOf('resultStack(');
  if (spendAt < 0 || giveAt < 0) {
    bad('`buyLeague` 里找不到"扣分"或"发货"（`docs/39` P4 的核心两步）✗');
  } else if (spendAt > giveAt) {
    bad('联赛商店**先发货后扣分** —— 发货失败/异常时会白拿（`docs/39` §8.2）✗');
  } else {
    ok('联赛商店**先扣分、再发货** ✓（扣不动就整笔拒绝）');
  }

  // ③ 每届限购放**世界侧**（绝不碰玩家侧那套按分钟补货的 stock）
  const worldStock = /leagueBoughtOf\(/.test(mgrSrc)
      && /public final Map<String, Integer> leagueBought/.test(dataSrc);
  if (!worldStock) {
    bad('联赛商店的"每届限购"没走世界侧计数 ⇒ 要么没限购、要么混进了玩家侧那套 ✗');
  } else {
    ok('联赛商店每届限购走**世界侧**（届号写在计数键里 ⇒ 新一届天然刷新）✓');
  }

  // ④ 目录条数与关键价格（与 `docs/39` §4.1 对账；数字全部来自用户）
  const offerLines = catSrc.match(/new LeagueOffer\(/g) || [];
  const need = ['"lure_deep", 20, 2', '"nylon_line", 70, 3', '"fluoro_line", 280, 3',
    '"pe_line", 500, 2', '"titanium_line_low", 750, 1', '"titanium_line_high", 1050, 1',
    '"red_tigerfish", 300, 1', '"iron_ingot_32", 200, 1', '"netherite_ingot_5", 700, 1'];
  const miss = need.filter((x) => !catSrc.includes(x));
  if (offerLines.length !== 16) {
    bad('联赛商店应有 16 条报价（15 项，紫饵算两条），实际 ' + offerLines.length + ' 条 ✗');
  } else if (miss.length) {
    bad('联赛商店的积分价/限购与 `docs/39` §4.1 对不上：' + miss.join('、') + ' ✗');
  } else {
    ok('联赛商店 16 条报价，积分价与每届限购**逐条对账**（20/70/280/500/750/1050/300/500/200/700）✓');
  }

  // ⑤ 界面：页签 + 点击只发下标（客户端**不许**发送价格）
  if (/TAB_LEAGUE = 11/.test(screenSrc) && /ShopActionPayload\.league\(row\)/.test(screenSrc)
      && /OP_LEAGUE_PREFIX = "@lg:"/.test(paySrc)) {
    ok('老柯界面有「联赛」页签，点击只发下标（价格与限购一律服务端现查）✓');
  } else {
    bad('界面没接上联赛商店（页签 / 点击发下标 / `@lg:` 前缀，三者缺一）✗');
  }
}

if (fail) {
  console.log('❌ 联赛检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 联赛检查通过');
