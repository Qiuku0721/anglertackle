'use strict';
/**
 * check-quest.js —— 守住**委托系统**（老柯的每日 / 周常；用户 2026-10-14 定案，策划 `docs/40`）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * 委托的每一种坏法都**不报错**：
 *   ① 池子条目**少于 8** ⇒ 用户点名的"种类数不低于 8、要有随机感"落空，
 *      而且抽出来的 5 条会高度重复，玩家一眼看出"就这几样" ✗；
 *   ② 奖励**两个都给**（鱼币 + 饵料）⇒ 违背用户第 3 条（"奖励饵料就别给鱼币"），
 *      而且产出失控**不会报错**，只是经济慢慢崩 ✗；
 *   ③ 周常里出现**红档**（tier 5）⇒ 用户第 4c 条明令禁止
 *      （"玩家很可能等级没上来、连钻石竿都没有"）✗；
 *   ④ id 前缀与周期对不上（`daily_` 写在 WEEKLY 里）⇒ 抽池、过期清理全错位 ✗；
 *   ⑤ 附件用 `fieldOf` 而不是 `optionalFieldOf` ⇒ **老存档整份数据读不进来**（一次就毁号）✗；
 *   ⑥ 少了 `copyOnDeath` ⇒ 死一次委托进度全清；
 *   ⑦ 配置项写在 Config 里却忘了加 `Tuning` 访问器 ⇒ 值永远读不到默认值，谁也不会发现 ✗。
 *
 * ── 判据 ────────────────────────────────────────────────────
 *   A. 池子规模：每日 ≥ 8、周常 ≥ 8（用户第 4b 条）
 *   B. id：全局唯一、前缀与周期一致（daily_ / weekly_）
 *   C. 奖励**恰好一种**（鱼币 XOR 物品）
 *   D. 周常**不出现红档**（GET_TIER_COUNT 的 tier 参数 ≤ 4 = 金）
 *   E. 附件：`QuestData` 全用 `optionalFieldOf`（零迁移）+ 注册 `player_quests` + `copyOnDeath`
 *   F. `PlayerData` 有 getQuests / setQuests / updateQuests，且走 `ModAttachments.PLAYER_QUESTS`
 *   G. 配置：`[quest]` 组存在，6 个 `quest*` 键在 Config 定义 + Tuning 都有访问器
 *   M. 上鱼接线：`LeaderboardHooks` 一行 `QuestService.onCatch`（**且包 try/catch**）；
 *      `FishingSession` 里**不许**出现 quest（玩法零改动）—— Q2 最容易接错的地方
 *   N. 判定：`QuestGoal` 是纯函数（不碰 PlayerData / 服务端类型），九种目标 target/advance 都覆盖
 *   O. 结算：奖励信**只有一个投递点**、是私有的 `settleReached`、**先投递后置位**、登录 `flushPending` 补发
 *   P. 活跃度：四档 = 25/50/75/100、增益读 `Tuning`（不硬编码 3/8）、位掩码挡重复、按周对齐
 *   Q. 活跃度奖励物品 id 在 `ModItems` 里真注册着（否则发出去是空气）+ 排除 AIR
 *   R. 每条委托都有中英 `quest.anglertackle.<id>.name`（否则界面/邮件显示一串 key）
 *   S. 附加契约：`Row.collected` 零迁移、`MailScreen` 支持 `#语言键` 参数
 *   T. 目标参数个数够用（不够 ⇒ 判定读到空串、永远不能达标，两边都不报错）
 *   U. 面板与入口（Q4）：`QuestPayload` 注册在 `Dist.CLIENT` 的处理器里（**common 侧不许有 playToClient**）、
 *      `QuestScreen` **只读**（没有任何 C→S 包）且不调 `super.render`（会吃两次背景 ⇒ 发灰）、
 *      三个入口齐（邮件【接下委托】/ `/atl quest` / 老柯**潜行**右键）且**普通右键仍是商店**、
 *      退出世界清客户端缓存、面板文案键中英成对
 *   V. 悬浮提示（1.6.4 用户验收后加）：`QuestScreen` 有 `renderHoverTips` 且 `render()` 最后调它、
 *      活跃度档位奖励读 `QuestTiers`（与服务端同一张表）、文字走 `renderComponentTooltip`、
 *      物品奖励走 `renderTooltip`、提示画在 widgets 之后
 *
 * 用法：node tools/check-quest.js
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

const POOL = 'src/main/java/com/whitecobalt/anglertackle/quest/QuestPool.java';
const DEF = 'src/main/java/com/whitecobalt/anglertackle/quest/QuestDef.java';
const SVC = 'src/main/java/com/whitecobalt/anglertackle/quest/QuestService.java';
const MAIL = 'src/main/java/com/whitecobalt/anglertackle/mail/MailService.java';
const HANDLERS = 'src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java';
const PAYLOAD = 'src/main/java/com/whitecobalt/anglertackle/network/MailPayload.java';
const SCR = 'src/main/java/com/whitecobalt/anglertackle/client/screen/QuestScreen.java';
const TIERS = 'src/main/java/com/whitecobalt/anglertackle/quest/QuestTiers.java';
const DATA = 'src/main/java/com/whitecobalt/anglertackle/player/QuestData.java';
const ATTR = 'src/main/java/com/whitecobalt/anglertackle/registry/ModAttachments.java';
const PDATA = 'src/main/java/com/whitecobalt/anglertackle/player/PlayerData.java';
const CFG = 'src/main/java/com/whitecobalt/anglertackle/Config.java';
const TUNING = 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java';
const MAIL_ACTIONS = 'src/main/java/com/whitecobalt/anglertackle/mail/MailActions.java';
const EVENTS = 'src/main/java/com/whitecobalt/anglertackle/event/QuestEvents.java';
const ZH = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';
const EN = 'src/main/resources/assets/anglertackle/lang/en_us.json';

console.log('=== 委托系统检查（池子 / 奖励 / 周期 / 附件 / 配置） ===\n');

for (const f of [POOL, DEF, DATA]) {
  if (!exists(f)) { bad('缺少文件 ' + f); }
}
if (fail) { console.log('\n❌ 文件不全，检查终止'); process.exit(1); }

// ---------------------------------------------------------------- 解析池子
const poolSrc = strip(read(POOL));
const ROW = /new QuestDef\(\s*"([^"]+)"\s*,\s*QuestDef\.Period\.(\w+)\s*,\s*QuestDef\.Goal\.(\w+)\s*,\s*List\.of\(([\s\S]*?)\)\s*,\s*(\d+)L?\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;

const rows = [];
let m;
while ((m = ROW.exec(poolSrc)) !== null) {
  rows.push({
    id: m[1], period: m[2], goal: m[3],
    args: m[4].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s.length > 0),
    coins: parseInt(m[5], 10), itemId: m[6], itemCount: parseInt(m[7], 10),
    minLevel: parseInt(m[8], 10), weight: parseInt(m[9], 10),
  });
}

if (rows.length === 0) {
  bad('QuestPool 里一条 `new QuestDef(...)` 都没解析出来 —— 表结构改了？本检查器要同步改');
  console.log('\n❌ 委托系统检查未通过（' + fail + ' 项）');
  process.exit(1);
}

const daily = rows.filter((r) => r.period === 'DAILY');
const weekly = rows.filter((r) => r.period === 'WEEKLY');

// ---- A. 池子规模 ----
console.log('[A] 池子规模');
if (daily.length >= 8) { ok('每日池 ' + daily.length + ' 条（≥ 8 ✓）'); }
else { bad('每日池只有 ' + daily.length + ' 条 —— 用户要求「种类数不低于 8」（同时可接 5 个但池子要更多）'); }
if (weekly.length >= 8) { ok('周常池 ' + weekly.length + ' 条（≥ 8 ✓）'); }
else { bad('周常池只有 ' + weekly.length + ' 条 —— 同上，要 ≥ 8'); }

// ---- B. id 唯一 + 前缀与周期一致 ----
console.log('\n[B] id 唯一性与前缀');
const seen = new Set();
let dupId = 0, prefixBad = 0;
for (const r of rows) {
  if (seen.has(r.id)) { bad('id 重复：' + r.id); dupId++; }
  seen.add(r.id);
  if (r.period === 'DAILY' && !r.id.startsWith('daily_')) { bad('id 前缀与周期不符：' + r.id + '（DAILY 应以 daily_ 开头）'); prefixBad++; }
  if (r.period === 'WEEKLY' && !r.id.startsWith('weekly_')) { bad('id 前缀与周期不符：' + r.id + '（WEEKLY 应以 weekly_ 开头）'); prefixBad++; }
}
if (dupId === 0) { ok('id 全局唯一（' + rows.length + ' 条）'); }
if (prefixBad === 0) { ok('id 前缀与周期一致（daily_ / weekly_）'); }

// ---- C. 奖励恰好一种 ----
console.log('\n[C] 奖励二选一（用户第 3 条：给饵料就不给鱼币）');
let rewardBad = 0, coinOnly = 0, itemOnly = 0;
for (const r of rows) {
  const hasCoins = r.coins > 0;
  const hasItem = r.itemId.length > 0 && r.itemCount > 0;
  if (hasCoins === hasItem) {
    bad(r.id + ' 的奖励不是「恰好一种」（鱼币=' + hasCoins + ' 物品=' + hasItem + '）');
    rewardBad++;
  }
  if (hasCoins) { coinOnly++; }
  if (hasItem) { itemOnly++; }
}
if (rewardBad === 0) { ok('每条委托的奖励恰好一种（鱼币 ' + coinOnly + ' 条 / 物品 ' + itemOnly + ' 条）'); }

// ---- D. 周常不出现红档 ----
console.log('\n[D] 周常不出现红档（用户第 4c 条；金 = tier 4 是上限）');
let redBad = 0;
for (const r of weekly) {
  if (r.goal === 'GET_TIER_COUNT') {
    const tier = parseInt(r.args[0], 10);
    if (Number.isFinite(tier) && tier > 4) {
      bad(r.id + ' 要求 tier ≥ ' + tier + ' —— 红档（5）是明令禁止的');
      redBad++;
    }
  }
}
if (redBad === 0) { ok('周常池里没有红档要求 ✓'); }

// ---- E. 附件：零迁移 + 注册 + copyOnDeath ----
console.log('\n[E] 附件（QuestData / ModAttachments）');
const dataSrc = strip(read(DATA));
if (!/optionalFieldOf/.test(dataSrc)) { bad('QuestData.CODEC 没用 optionalFieldOf —— 老存档整份数据读不进来（毁号级）'); }
else if (/\.fieldOf\(/.test(dataSrc)) { bad('QuestData.CODEC 里出现了 fieldOf —— 老存档没有这个键就会读不进来，必须一律 optionalFieldOf'); }
else { ok('QuestData 全部用 optionalFieldOf（老存档零迁移 ✓）'); }
if (!/EMPTY/.test(dataSrc)) { bad('QuestData 缺 EMPTY 默认值'); } else { ok('QuestData 有 EMPTY 默认值'); }

const attrSrc = strip(read(ATTR));
if (!/register\(\s*"player_quests"/.test(attrSrc)) { bad('ModAttachments 里没注册 player_quests'); }
else { ok('ModAttachments 注册了 player_quests'); }
if (!/QUEST_QUESTS|PLAYER_QUESTS/.test(attrSrc)) { bad('ModAttachments 缺 PLAYER_QUESTS 常量'); }
else { ok('ModAttachments 有 PLAYER_QUESTS 常量'); }
// copyOnDeath 必须挂在这个附件上（就近断言：player_quests 块里出现 copyOnDeath）
const questBlock = attrSrc.slice(attrSrc.indexOf('player_quests'));
const blockEnd = questBlock.indexOf('ATTACHMENT_TYPES.register(modBus)');
const blk = blockEnd > 0 ? questBlock.slice(0, blockEnd) : questBlock;
if (!/copyOnDeath\(\)/.test(blk)) { bad('player_quests 附件没挂 copyOnDeath —— 死一次委托进度（含累计完成数）全清'); }
else { ok('player_quests 挂了 copyOnDeath ✓'); }

// ---- F. PlayerData 访问器 ----
console.log('\n[F] PlayerData 访问器');
const pdataSrc = strip(read(PDATA));
for (const need of ['getQuests', 'setQuests', 'updateQuests']) {
  if (!new RegExp(need + '\\s*\\(').test(pdataSrc)) { bad('PlayerData 缺 ' + need + '()'); }
  else { ok('PlayerData 有 ' + need + '()'); }
}
if (!/ModAttachments\.PLAYER_QUESTS/.test(pdataSrc)) { bad('PlayerData 没走 ModAttachments.PLAYER_QUESTS'); }
else { ok('PlayerData 走 ModAttachments.PLAYER_QUESTS ✓'); }

// ---- G. 配置 + Tuning ----
console.log('\n[G] 配置（[quest] 组 + Tuning 访问器）');
const cfgSrc = strip(read(CFG));
const tunSrc = strip(read(TUNING));
const keys = ['questEnabled', 'questDailyCount', 'questWeeklyCount',
  'questActivityPerDaily', 'questActivityPerWeekly', 'questActivityCapWeekly'];
if (!/push\(\s*"quest"\s*\)/.test(cfgSrc)) { bad('Config 里没有 [quest] 组（push("quest")）'); }
else { ok('Config 里有 [quest] 组 ✓'); }
let cfgMiss = 0, tunMiss = 0;
for (const k of keys) {
  if (!new RegExp(k + '\\s*=').test(cfgSrc)) { bad('Config 缺字段 ' + k); cfgMiss++; }
  if (!new RegExp('public static .*\\b' + k + '\\s*\\(').test(tunSrc)) { bad('Tuning 缺访问器 ' + k + '()'); tunMiss++; }
}
if (cfgMiss === 0) { ok('Config 有全部 ' + keys.length + ' 个 quest* 字段 ✓'); }
if (tunMiss === 0) { ok('Tuning 有全部 ' + keys.length + ' 个访问器 ✓'); }

// ---- H. 日界口径（**本系统最容易做错的一处**）----
console.log('\n[H] 日界口径（docs/40 §3：按游戏内时刻，**不用 getGameTime**）');
const svc = strip(read(SVC));
const tiers = exists(TIERS) ? strip(read(TIERS)) : '';
if (!tiers) { bad('缺少文件 ' + TIERS + '（活跃度四档表，1.6.4 从 QuestService 搬出来的）'); }
// 26.1.2：Level#getDayTime() 已并入世界时钟，等价 API 是 getOverworldClockTime()
// （Environment.java:79 有同一处迁移说明；语义仍是"游戏内天明"，不是 tick 计数）。
if (!/getOverworldClockTime\(\)/.test(svc)) {
  bad('QuestService 没读 getOverworldClockTime()（26.1.2 顶替旧 getDayTime 的世界时钟）—— 日界就不是"游戏内天明"了');
} else { ok('QuestService 用 getOverworldClockTime() 判日界（26.1.2 的世界时钟，语义同旧 getDayTime）✓'); }
if (/getGameTime\(\)/.test(svc)) { bad('QuestService 里出现 getGameTime() —— 它是纯 tick 计数，会在半夜刷委托（用户点名的"乱套"）'); }
else { ok('QuestService 里没有 getGameTime() ✓'); }
if (!/Environment\.DAY_LENGTH/.test(svc)) { bad('QuestService 没复用 Environment.DAY_LENGTH —— 一天的长度要只有一个真源'); }
else { ok('QuestService 复用 Environment.DAY_LENGTH ✓'); }

// ---- I. 投递通道 ----
console.log('\n[I] 投递通道（委托信必须走邮件）');
if (!/MailService\.deliver\(/.test(svc)) { bad('QuestService 没走 MailService.deliver'); }
else { ok('QuestService 走 MailService.deliver ✓'); }
if (!/先.*投递|BOX_FULL|Result\.OK/.test(svc)) { bad('QuestService 没按"先投递、再置位"处理投递结果（邮箱满时会永久丢一天的委托）'); }
else { ok('QuestService 按先投递再置位处理结果 ✓'); }

// I-3. 两封委托信都必须**带 quest_accept 动作**（2026-10-14 验收实测：没带 = 邮件里
//      根本没有【接下委托】按钮，玩家接不了委托、面板也打不开 ✗）。
//      ⚠ 判据用 indexOf 定序 + 窗口（A1 的教训）：从投递调用点起 200 字内必须出现
//      MailActions.QUEST_ACCEPT；删掉它的话，下一个 QUEST_ACCEPT 在几百字外 ⇒ 判红 ✓。
function deliverCarriesAction(anchor, label) {
  const i = svc.indexOf(anchor);
  if (i < 0) { bad(label + '：找不到投递调用 ' + anchor); return; }
  const j = svc.indexOf('MailActions.QUEST_ACCEPT', i);
  if (j < 0 || j - i > 200) {
    bad(label + '没带 MailActions.QUEST_ACCEPT —— 邮件里没有【接下委托】按钮（2026-10-14 验收实测的真 bug）✗');
  } else { ok(label + '带 quest_accept 动作 ✓'); }
}
deliverCarriesAction('deliver(player, MAIL_DAILY', '每日委托信');
deliverCarriesAction('deliver(player, MAIL_WEEKLY', '周常委托信');

// I-4. 登录时升级 1.6.2 之前的旧委托信（那时寄信没挂动作 ⇒ 老信没有按钮；
//      不迁移的话玩家要等下一次刷新才能接，今天的验收就没法做 ✗）。
if (!/upgradeLegacyLetters\(player\)/.test(svc)) {
  bad('onLogin 没调 upgradeLegacyLetters(player) —— 1.6.2 旧委托信永远没有按钮');
} else { ok('登录时升级旧委托信 ✓'); }
const upg = /private static void upgradeLegacyLetters\([\s\S]*?\n    \}/.exec(svc);
if (!upg) { bad('找不到 upgradeLegacyLetters 方法体'); }
else if (!/withAction\(/.test(upg[0]) || !/MailActions\.QUEST_ACCEPT/.test(upg[0])) {
  bad('upgradeLegacyLetters 没用 withAction(MailActions.QUEST_ACCEPT) 补按钮');
} else { ok('旧信升级走 withAction(QUEST_ACCEPT) ✓'); }

// ---- J. 邮件动作白名单 ----
console.log('\n[J] 邮件动作（quest_accept）');
const ma = strip(read(MAIL_ACTIONS));
if (!/QUEST_ACCEPT\s*=\s*"quest_accept"/.test(ma)) { bad('MailActions 里没有 quest_accept 动作 id'); }
else { ok('MailActions 有 quest_accept ✓'); }
// ⚠ 这个正则必须**限定在 Set.of(...) 的括号内**：早先写成 `KNOWN\s*=\s*Set\.of\([\s\S]*?QUEST_ACCEPT`
//   被判过——`[\s\S]*?` 会跨过右括号、在文件别处找到 QUEST_ACCEPT，于是"从白名单里删掉"也照样通过
//   （证伪测试当场抓到，见 build/_quest-falsify.js 的第 7 条）。
const knownSet = /KNOWN\s*=\s*Set\.of\(([^)]*)\)/.exec(ma);
if (!knownSet) { bad('读不到 MailActions 的 KNOWN 白名单'); }
else if (!/QUEST_ACCEPT/.test(knownSet[1])) { bad('quest_accept 没进 KNOWN 白名单（客户端点了会被静默忽略）'); }
else { ok('quest_accept 在白名单里 ✓'); }

// ---- K. 语言键中英成对 ----
console.log('\n[K] 语言键（中英成对）');
const zh = JSON.parse(read(ZH));
const en = JSON.parse(read(EN));
const LANG_KEYS = [
  'mail.anglertackle.quest_daily.title', 'mail.anglertackle.quest_daily.body', 'mail.anglertackle.quest_daily.button',
  'mail.anglertackle.quest_weekly.title', 'mail.anglertackle.quest_weekly.body', 'mail.anglertackle.quest_weekly.button',
  'message.anglertackle.quest_accept_ok', 'message.anglertackle.quest_accept_already',
  'message.anglertackle.quest_accept_disabled', 'message.anglertackle.quest_accept_no_offer',
];
let langMiss = 0;
for (const k of LANG_KEYS) {
  if (!(k in zh)) { bad('zh_cn 缺 ' + k); langMiss++; }
  if (!(k in en)) { bad('en_us 缺 ' + k); langMiss++; }
}
if (langMiss === 0) { ok('委托的 ' + LANG_KEYS.length + ' 个语言键中英齐 ✓'); }

// ---- L. 事件挂载 ----
console.log('\n[L] 事件挂载（QuestEvents）');
const ev = strip(read(EVENTS));
if (!/LevelTickEvent\.Post/.test(ev)) { bad('QuestEvents 没挂 LevelTickEvent.Post —— 日界不会推进'); }
else { ok('QuestEvents 挂 LevelTickEvent.Post ✓'); }
if (!/PlayerLoggedInEvent/.test(ev)) { bad('QuestEvents 没挂 PlayerLoggedInEvent —— 离线跨过日界收不到委托'); }
else { ok('QuestEvents 挂 PlayerLoggedInEvent（登录补发）✓'); }
if ((ev.match(/catch\s*\(Throwable/g) || []).length < 2) { bad('QuestEvents 的入口没都包 try/catch —— 委托坏了不该拖垮 tick'); }
else { ok('QuestEvents 两个入口都包了 try/catch ✓'); }

// ---- M. 上鱼结算接线（Q2）----
console.log('\n[M] 上鱼结算接线（docs/40 §13 Q2：进度推进）');
const HOOKS = 'src/main/java/com/whitecobalt/anglertackle/leaderboard/LeaderboardHooks.java';
const FSS = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java';
const GOAL = 'src/main/java/com/whitecobalt/anglertackle/quest/QuestGoal.java';
const MAILSCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/MailScreen.java';
const hook = strip(read(HOOKS));
if (!/QuestService\.onCatch\(/.test(hook)) {
  bad('LeaderboardHooks 里没有 QuestService.onCatch 接线 —— 钓再多鱼也不会推进委托');
} else {
  ok('LeaderboardHooks 接了一行 QuestService.onCatch ✓');
  // ⚠ 判据必须**要求 try 紧贴在调用前**（中间只许空白）。
  //   早先写成"取调用前后 500 字找 try … catch"，会被**上一处接线**（`ContestService.onCatch`）
  //   那段的 try/catch 骗过 ⇒ 把本处 try 删掉照样绿 ✗（证伪测试当场抓到）。
  if (!/try\s*\{\s*com\.whitecobalt\.anglertackle\.quest\.QuestService\.onCatch\(/.test(hook)) {
    bad('onCatch 接线没包在**自己的** try/catch 里 —— 委托抛异常会让上鱼失败（抄联赛/比赛那两行的纪律）');
  } else { ok('onCatch 接线包在自己的 try 里 ✓'); }
}
// ⚠ 玩法零改动：排行榜那次的教训就是"别为了功能去动玩法"。
//   挂钩只许出现在 LeaderboardHooks 那一行；FishingSession 里出现 quest 就说明接错地方了 ✗
if (/\bquest/i.test(strip(read(FSS)))) {
  bad('FishingSession 里出现了 quest —— 委托必须零改动玩法（挂钩只许在 LeaderboardHooks 里那一行）');
} else { ok('FishingSession 里没有任何委托痕迹（玩法零改动）✓'); }

// ---- N. 判定是纯函数（QuestGoal）----
console.log('\n[N] 目标判定（QuestGoal：纯函数 + 九种目标都覆盖）');
const goal = strip(read(GOAL));
if (/PlayerData|ServerPlayer|ServerLevel|MinecraftServer/.test(goal)) {
  bad('QuestGoal 里出现了玩家/服务端类型 —— 判定必须是不碰数据的纯函数（否则没法脱离服务端测）');
} else { ok('QuestGoal 不碰 PlayerData / 服务端类型（纯函数）✓'); }
{
  const NINE = ['GET_COUNT', 'GET_TIER_COUNT', 'GET_SPECIES', 'GET_SPECIES_SET', 'GET_WEIGHT_SUM',
    'GET_BIGGEST', 'GET_LONGEST', 'GET_ROD_TYPE', 'GET_VARIETY'];
  // 每个目标要在 target() 与 advance() 里各出现一次 ⇒ 名字至少出现 2 次
  // （少一处就是"某条委托永远达不到 / 永远不需要达标"，两边都不报错）
  const thin = NINE.filter((g) => (goal.split(g).length - 1) < 2);
  if (thin.length) { bad('QuestGoal 里这些目标没同时出现在 target() 与 advance()：' + thin.join('、')); }
  else { ok('九种目标在 target() / advance() 里都覆盖 ✓'); }
}

// ---- O. 结算点唯一 + 先投递后置位 ----
console.log('\n[O] 结算（唯一入口 + 先投递后置位）');
{
  const n = (svc.match(/deliver\(player,\s*MAIL_DONE/g) || []).length;
  if (n !== 1) { bad('委托奖励信的投递点有 ' + n + ' 处（应为 1 —— 结算只能有一个入口，两处迟早不一致）'); }
  else { ok('委托奖励信只在一处投递（settleReached）✓'); }
  if (!/private static QuestData settleReached\(/.test(svc)) { bad('找不到私有的 settleReached 结算点'); }
  else { ok('结算点是私有的 settleReached ✓'); }
  const di = svc.indexOf('deliver(player, MAIL_DONE');
  const ci = svc.indexOf('withRowClaimed(id)');
  if (di < 0 || ci < 0 || ci < di) { bad('置位（withRowClaimed）没排在投递之后 —— 邮箱满时会白丢奖励'); }
  else { ok('先投递、再置位 ✓'); }
  if (!/flushPending\(player\)/.test(svc)) {
    bad('onLogin 里没有 flushPending —— 「当时邮箱满、奖励没寄出」的那条会永久丢失'
      + '（GET_BIGGEST 这类目标进度不会再涨，下次上鱼不会重试）');
  } else { ok('登录时 flushPending 补发（兜住邮箱满那条边界）✓'); }
}

// ---- P. 活跃度（Q3）----
console.log('\n[P] 活跃度（用户第 4 条：3 / 8、周上限 100、25/50/75/100 各发一种）');
{
  // ⚠ 四档表 1.6.4 起在 QuestTiers（纯表，客户端悬浮提示也读它）—— 别再去 QuestService 里找
  const t = /AT\s*=\s*\{([^}]*)\}/.exec(tiers);
  if (!t) { bad('读不到 QuestTiers.AT（四档表）'); }
  else {
    const nums = t[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (nums.join('/') !== '25/50/75/100') { bad('活跃度四档不是 25/50/75/100（读到 ' + nums.join('/') + '）'); }
    else { ok('四档 = 25/50/75/100 ✓'); }
  }
  if (!/Tuning\.questActivityPerDaily\(\)/.test(svc) || !/Tuning\.questActivityPerWeekly\(\)/.test(svc)) {
    bad('活跃度增益没走 Tuning —— 硬编码 3/8 会跟配置项对不上（玩家改了配置也不生效）');
  } else { ok('每日 / 周常的活跃度增益都读 Tuning ✓'); }
  if (!/tierClaimed\(bit\)/.test(svc)) { bad('档位发奖前没查 tierClaimed —— 同一档会被重复发'); }
  else { ok('档位发奖由位掩码挡重复 ✓'); }
  if (!/withActivityWeek\(/.test(svc)) {
    bad('结算时没把活跃度对齐到当前周 —— 跨周不会清零（用户要的"周"活跃就废了）');
  } else { ok('结算时按周对齐活跃度（跨周清零 + 清档位）✓'); }
  if (!/QuestTiers\./.test(svc)) {
    bad('settleTiers 没读 QuestTiers —— 结算与面板悬浮提示会各用一张档位表（两份迟早不一致）');
  } else { ok('结算读 QuestTiers（与面板同一张表）✓'); }
}

// ---- Q. 活跃度奖励的物品 id ----
console.log('\n[Q] 活跃度奖励的物品（75 / 100 两档）');
{
  const t = /ITEM\s*=\s*\{([^}]*)\}/.exec(tiers);
  if (!t) { bad('读不到 QuestTiers.ITEM'); }
  else {
    // ⚠ 别用 `/"([^"]+)"/g` 取 id：数组里的**空串**（给鱼币那两档写的是 `""`）会让正则
    //   从 `""` 的第二个引号一路吃到下一项的引号，把 `, ` 当成一个"物品 id"
    //   （这个坑当场踩到过：报出 3 个空的"没注册物品"）。按逗号切再剥引号 ✓。
    const ids = t[1].split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter((s) => s.length > 0 && !s.startsWith('minecraft:'));
    const items = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
    const miss = ids.filter((id) => !new RegExp('register\\("' + id.split(':').pop() + '"').test(items));
    if (miss.length) { bad('这些奖励物品在本模组里没注册（发出去是空气）：' + miss.join('、')); }
    else { ok('模组奖励物品都在 ModItems 里注册着（' + ids.join('、') + '）✓'); }
  }
  if (!/Items\.AIR/.test(svc)) { bad('stackOf 没排除空物品 —— 认不出的 id 会发出去一个空气物品'); }
  else { ok('奖励物品构造排除了空物品 ✓'); }
}

// ---- R. 委托名的语言键（每条都要有）----
console.log('\n[R] 委托名（界面与奖励信都要用）');
{
  const missName = rows.filter((r) => {
    const k = 'quest.anglertackle.' + r.id + '.name';
    return !(k in zh) || !(k in en);
  }).map((r) => r.id);
  if (missName.length) { bad('这些委托缺名字语言键（玩家会看到一串 key）：' + missName.join('、')); }
  else { ok(rows.length + ' 条委托的中英名字齐 ✓'); }
  if (!/"#quest\.anglertackle\."\s*\+\s*def\.id\(\)/.test(svc)) {
    bad('奖励信不是按 #语言键 发委托名（信里会显示成 id，而不是"钓到 3 条鱼"）');
  } else { ok('奖励信按 #语言键 发委托名（客户端翻成中文）✓'); }
}

// ---- S. 附加契约（collected 零迁移 / 邮件 # 前缀）----
console.log('\n[S] 附加契约');
{
  const data = strip(read(DATA));
  if (!/optionalFieldOf\(\s*"collected"/.test(data)) {
    bad('Row.collected 不是 optionalFieldOf —— 加字段之前存下的进度行会读不进来（整份委托数据报废）');
  } else { ok('Row.collected 零迁移（optionalFieldOf）✓'); }
  const ms = strip(read(MAILSCREEN));
  if (!/startsWith\("#"\)/.test(ms) || !/substring\(1\)/.test(ms)) {
    bad('MailScreen 不支持 #语言键 参数 —— 委托信里会显示成一串 key');
  } else { ok('MailScreen 支持 #语言键 参数 ✓'); }
}

// ---- T. 目标参数与判定对齐 ----
console.log('\n[T] 目标参数与判定对齐');
{
  const NEED = {
    GET_COUNT: 1, GET_TIER_COUNT: 2, GET_SPECIES: 2, GET_SPECIES_SET: 1,
    GET_WEIGHT_SUM: 1, GET_BIGGEST: 1, GET_LONGEST: 1, GET_ROD_TYPE: 2, GET_VARIETY: 1,
  };
  const short = rows.filter((r) => (r.args || []).length < (NEED[r.goal] || 1))
    .map((r) => r.id + '(' + r.args.length + '个)');
  if (short.length) { bad('这些委托的参数个数不够（判定会读到空串、永远不能达标）：' + short.join('、')); }
  else { ok(rows.length + ' 条委托的参数个数都够 ✓'); }
}

// ---- U. 面板与三个入口（Q4）----
console.log('\n[U] 面板与入口（docs/40 §13 Q4）');
{
  const PAYLOAD = 'src/main/java/com/whitecobalt/anglertackle/network/QuestPayload.java';
  const SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/QuestScreen.java';
  const CACHE = 'src/main/java/com/whitecobalt/anglertackle/client/ClientQuests.java';
  const HANDLERS = 'src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java';
  const NET = 'src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java';
  const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
  const NPC = 'src/main/java/com/whitecobalt/anglertackle/entity/FishermanEntity.java';
  const EVT = 'src/main/java/com/whitecobalt/anglertackle/event/CoinSyncEvents.java';

  let missing = 0;
  for (const f of [PAYLOAD, SCREEN, CACHE]) {
    if (!exists(f)) { bad('缺少文件 ' + f); missing++; }
  }
  if (missing === 0) {
    // ① S→C 的包**必须**注册在 Dist.CLIENT 的处理器里
    //    （ModNetwork 那次事故的形状：在 common 类里碰 Screen ⇒ 专用服务器整包装不进）
    const h = strip(read(HANDLERS));
    if (!/playToClient\(com\.whitecobalt\.anglertackle\.network\.QuestPayload\.TYPE/.test(h)) {
      bad('ClientPayloadHandlers 没注册 QuestPayload —— 面板永远不会打开');
    } else { ok('QuestPayload 注册在 Dist.CLIENT 的处理器里 ✓'); }
    const net = strip(read(NET));
    if (/playToClient/.test(net)) {
      bad('ModNetwork（common）里出现了 playToClient —— S→C 注册必须全在 ClientPayloadHandlers');
    } else { ok('common 侧没有 S→C 注册（ModNetwork 只留 sendTo）✓'); }

    // ② 面板**只读**：一个回写路径都不许有（接取在邮件、领取在邮箱）
    const sc = strip(read(SCREEN));
    if (/sendToServer|PacketDistributor/.test(sc)) {
      bad('QuestScreen 里有回写（C→S 包）—— 面板是只读的（接取在邮件、领取在邮箱）');
    } else { ok('QuestScreen 只读（没有任何 C→S 包）✓'); }
    if (/super\.render\(/.test(sc)) {
      bad('QuestScreen 调了 super.render(...) —— 会再吃一次 renderBackground，界面发灰');
    } else { ok('QuestScreen 不调 super.render ✓'); }
    if (!/renderables/.test(sc)) {
      bad('QuestScreen 既不调 super.render 也没手动遍历 renderables —— 按钮与文字不会显示');
    } else { ok('QuestScreen 手动遍历 renderables 渲染 ✓'); }

    // ③ 三个入口（用 indexOf 定序，**别用 [\s\S]{0,900}?** —— 那种正则会跨到文件别处去，前面踩过）
    const ma2 = strip(read(MAIL_ACTIONS));
    const iAccept = ma2.indexOf('QUEST_ACCEPT.equals(action)');
    if (iAccept < 0 || ma2.indexOf('syncQuests', iAccept) < 0) {
      bad('入口①断了：邮件【接下委托】之后没有打开面板');
    } else { ok('入口①：邮件【接下委托】→ 顺带打开面板 ✓'); }

    const cmd = strip(read(CMD));
    const iQuest = cmd.indexOf('lit("quest")');
    if (iQuest < 0 || cmd.indexOf('syncQuests', iQuest) < 0) {
      bad('入口②断了：没有 /atl quest（或它没调 syncQuests）');
    } else { ok('入口②：/atl quest ✓'); }

    const npc = strip(read(NPC));
    const iShift = npc.indexOf('isShiftKeyDown');
    if (iShift < 0 || npc.indexOf('syncQuests', iShift) < 0) {
      bad('入口③断了：老柯没有潜行右键开面板那一路');
    } else { ok('入口③：老柯潜行右键 ✓'); }
    // ⚠ 普通右键必须**还是商店**（用户定案过的行为，不能被面板顶掉）
    if (!/ShopManager\.open/.test(npc)) {
      bad('老柯的普通右键不再开商店了 —— 那是用户 2026-10-11 定案过的行为，只该新增潜行那一路');
    } else { ok('老柯普通右键仍然是商店（面板只走潜行那一路）✓'); }

    // ④ 缓存要清（换档别闪上个档的委托）
    const ev2 = strip(read(EVT));
    if (!/ClientQuests\.clear\(\)/.test(ev2)) {
      bad('退出世界时没清委托缓存 —— 换档会先闪一眼上个档的委托进度');
    } else { ok('退出世界清委托缓存 ✓'); }

    // ⑤ 包要走 ModNetwork.sendTo（不自己 PacketDistributor，免得绕过统一封装）
    if (!/sendTo\(player, new com\.whitecobalt\.anglertackle\.network\.QuestPayload/.test(net)) {
      bad('syncQuests 没走 ModNetwork.sendTo(new QuestPayload(...))');
    } else { ok('syncQuests 走 ModNetwork.sendTo ✓'); }

    // ⑥ 面板文案键中英成对（**从界面里抓真实用到的键**，而不是维护一份可能与代码脱节的清单）
    const used = new Set();
    for (const m of sc.matchAll(/(?:tr|translatable)\("(gui\.anglertackle\.[a-z_]+)"/g)) {
      used.add(m[1]);
    }
    const missGui = [...used].filter((k) => !(k in zh) || !(k in en));
    if (missGui.length) { bad('面板文案缺中英键（会显示成 key）：' + missGui.join('、')); }
    else { ok('面板 ' + used.size + ' 个文案键中英齐 ✓'); }
  }
}

// ---------------------------------------------------------------- 收尾

// ---------------------------------------------------------------- W 奖励信真的带奖励（2026-10-16）
//
// 用户复验原话：「完成日常任务后**邮件的奖励也没有显示出来**」。
// 真因：settleReached 投递完成信时附件传的是 `0L, List.of()` —— 空。
// 于是信里既没鱼币也没物品，而 docs/40 §6 写的是「奖励信带【领取】、鱼币或物品二选一」。
// ⇒ 断言盯「那一行有没有把定义表里的奖励带上」，而不是「有没有调用 deliver」。
{
  const m = /private static QuestData settleReached\([\s\S]*?\n    \}/.exec(svc);
  if (!m) {
    bad('QuestService 里找不到 settleReached() —— 结算点被改了名字？');
  } else {
    const code = strip(m[0]);
    if (/deliver\(player, MAIL_DONE[^;]*0L,\s*List\.of\(\)/.test(code)
      || /deliver\([^;]*List\.of\(\),\s*List\.of\(\)\s*\)/.test(code)) {
      bad('奖励信投递时附件是空的（0L, List.of()）—— 玩家点开信只看到一句话，看不到任何奖励'
        + '（用户 2026-10-16 报的正是这个）');
    } else if (/def\.givesCoins\(\)\s*\?\s*def\.coins\(\)\s*:\s*0L/.test(code)
      && /def\.givesItem\(\)/.test(code)) {
      ok('奖励信真的带上了定义表里的奖励（鱼币 OR 物品，与面板 rewardText() 同源）');
    } else {
      bad('奖励信没有按定义表带奖励（没看到 givesCoins()?coins():0L 与 givesItem() 两个分支）');
    }
    if (/MailService\.Result\.OK/.test(code)) {
      ok('仍然是「投递成功才置位」（邮箱满 ⇒ 不置位、下次补发）');
    } else {
      bad('settleReached 不再检查投递结果 —— 邮箱满时会静默丢奖励');
    }
  }
}

// ---------------------------------------------------------------- X 新信到达要立刻告诉玩家（2026-10-16）
//
// 用户复验原话：「邮件在触发后（如完成成就）**不会立刻弹出**，而是在下一次登录游戏才会显示」。
// 真因：投递只写服务端附件，唯一的推送点是「玩家自己开邮箱」那条路 ⇒ 玩家完全感觉不到。
{
  const mail = read(MAIL);
  // ⚠ 判据用「从 send( 起到文件里下一个 announce( 调用」这段**切片**，
  //   不要用 `/public static Result send\([\s\S]*?\n    \}/` —— send() 里嵌着 record 构造，
  //   第一个 `\n    }` 就把它截断了，于是「明明调了也报没调」（2026-10-16 当场踩到）。
  // ⚠⚠ 判据必须**盯行首非注释**：负例 `mail-arrival-not-announced` 的变异是 `// announce(to, entry);`
  //   而 `indexOf('announce(to, entry)')` 对注释里的那串字符照样命中 ⇒ 第一版**漏检**（实测到）。
  //   这正是仓库那条铁律：「断言某段代码存在时，必须剔除注释再判」——第 N 次踩同一个坑。
  const sendStart = mail.indexOf('public static Result send(ServerPlayer to, String template');
  const announceCallRe = /(^|\n)[ \t]*announce\(to, entry\);/;
  const sendSlice = sendStart < 0 ? '' : mail.slice(sendStart, sendStart + 3000);
  if (sendStart < 0) {
    bad('MailService 里找不到 send() —— 投递入口被改了结构？');
  } else if (announceCallRe.test(strip(sendSlice))) {
    ok('每封投递成功后都会 announce()（动作栏提示 + 快照推送）');
  } else {
    bad('send() 里没有**真的调用** announce(to, entry) —— 新信还是「悄悄投递」，'
      + '玩家要等下次登录才看得到（注释掉那行也算没有）');
  }
  const ann = /private static void announce\(ServerPlayer to, MailEntry entry\)[\s\S]*?\n    \}/.exec(mail);
  if (!ann) {
    bad('找不到 MailService.announce() —— 新信通知整块丢了');
  } else {
    const a = strip(ann[0]);
    if (/mail_arrived/.test(a)) {
      ok('动作栏用 message.anglertackle.mail_arrived 报出信名（不开界面也知道有信）');
    } else {
      bad('announce() 没有发动作栏提示 —— 只有数据同步，玩家仍然感觉不到');
    }
    if (/MailSnapshot\.of\(to,\s*"",\s*false\)/.test(a)) {
      ok('推快照时 autoOpen = false（后台收信**不许**把玩家的界面顶掉）');
    } else {
      bad('announce() 没有用 autoOpen=false 推快照 —— 后台收信会弹窗打断玩家');
    }
  }
  const handlers = read(HANDLERS);
  const hm = /private static void handleMails\([\s\S]*?\n    \}/.exec(handlers);
  if (hm && /payload\.autoOpen\(\)/.test(strip(hm[0]))) {
    ok('客户端 handleMails 尊重 autoOpen（false 时只更新缓存）');
  } else {
    bad('客户端 handleMails 不看 autoOpen —— 后台收信会把界面顶掉');
  }
  const payload = read(PAYLOAD);
  if (/boolean autoOpen\)/.test(payload) && /writeBoolean\(p\.autoOpen\)/.test(payload)
    && /readBoolean\(\)/.test(payload)) {
    ok('MailPayload 的 autoOpen 在编解码两端都带上了（漏一个就会错位读串）');
  } else {
    bad('MailPayload 的 autoOpen 没进 StreamCodec —— 编解码会错位');
  }
}

// ---------------------------------------------------------------- Y 活跃度悬浮提示要够大（2026-10-16）
//
// 用户复验：「任务界面的**活跃奖励节点**没有悬浮文本提示完成后有什么奖励」。
// 命中框原来只罩 24px 且左右各缩 6px，玩家从下面往上扫会从缝里漏掉。
{
  const scr = read(SCR);
  const tips = /private void renderHoverTips\([\s\S]*?\n    \}/.exec(scr);
  if (!tips) {
    bad('QuestScreen 里找不到 renderHoverTips()');
  } else {
    const tip = strip(tips[0]);
    if (/top \+ HEADER_H - 2[\s\S]{0,90}ACTIVITY_H \+ 8/.test(tip)) {
      ok('活跃度行的命中框宽出一圈（HEADER_H-2 起、ACTIVITY_H+8 高）—— 不会从缝里漏掉');
    } else {
      bad('活跃度行的命中框又缩回紧贴文字了 —— 玩家稍偏一点就「什么都没有」（用户报过的那个症状）');
    }
    if (/QuestTiers\.AT\[bit\]/.test(tip) && /tierRewardText\(bit\)/.test(tip)) {
      ok('提示里逐档写出「档位 + 奖励 + 还差多少」（读 QuestTiers，与服务端同一张表）');
    } else {
      bad('活跃度提示没有逐档写奖励 —— 玩家还是不知道到档给什么');
    }
  }
  const zh2 = read('src/main/resources/assets/anglertackle/lang/zh_cn.json');
  if (/quest_tip_pick[^\n]*活跃度行/.test(zh2)) {
    ok('页脚提示里写了「鼠标移到活跃度行看各档奖励」（否则没人知道那里能悬停）');
  } else {
    bad('页脚没有告诉玩家活跃度行可以悬停 —— 提示做得再好也没人发现');
  }
}


console.log('');
if (fail) {
  console.log('❌ 委托系统检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 委托系统检查通过（池 ' + daily.length + ' 每日 + ' + weekly.length + ' 周常；奖励二选一；周常无红档；附件零迁移；配置接入完整）');
