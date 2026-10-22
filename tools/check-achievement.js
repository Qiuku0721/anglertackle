/*
 * check-achievement.js —— 成就系统的静态断言（策划 docs/41 §7，阶段 A1 起逐段加）。
 *
 * 为什么值得单独一条（而不是塞进 check-quest.js）：
 *   成就是**一次性里程碑**，它最贵的错误是"达成两次、发两份奖" ——
 *   而这类错误在游戏里看不出来（玩家只会高兴），只能靠静态断言盯住
 *   "幂等"那几处**写法**：集合语义、唯一结算点、先查后发。
 *
 * 本文件当前覆盖 **A1 的数据层**（附件 + 注册 + 发放纪律）与 **A2 的自动达成接线**
 * （[F] 组：onCatch 判定在服务里、挂钩点真调用、图鉴 +1、档位口径、11 条范围）；
 * 界面/其余类别到位后按 §7 继续加组，每组都要配 tools/_negtest.js 的负例
 * （"变异测试真判红"是本仓库的交付门槛）。
 *
 * 用法：node tools/check-achievement.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 负例副本要把断言指向副本（ATL_ROOT），否则"改的是副本、检查的是真源码"⇒ 改坏了也不红
const ATL_ROOT = process.env.ATL_ROOT
  ? path.resolve(process.env.ATL_ROOT)
  : path.join(__dirname, '..');

const read = (rel) => fs.readFileSync(path.join(ATL_ROOT, rel), 'utf8');

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => { console.log('  ❌ ' + m); bad++; };

const DATA = 'src/main/java/com/whitecobalt/anglertackle/player/AchievementData.java';
const ATTACH = 'src/main/java/com/whitecobalt/anglertackle/registry/ModAttachments.java';
const DEF = 'src/main/java/com/whitecobalt/anglertackle/achievement/AchievementDef.java';
const SERVICE = 'src/main/java/com/whitecobalt/anglertackle/achievement/AchievementService.java';
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
const HOOKS = 'src/main/java/com/whitecobalt/anglertackle/leaderboard/LeaderboardHooks.java';
const LANG_ZH = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';
const LANG_EN = 'src/main/resources/assets/anglertackle/lang/en_us.json';

console.log('=== 成就系统检查（docs/41 §7：A1 数据层 + 发放 + 接线；A2 上鱼类自动达成） ===\n');
console.log('[A] AchievementData（只存"点亮过哪些"，不存进度）');

const data = read(DATA);

// A1. 集合语义：重复点亮不能让数据"变大"。用 List 会让同一条成就在数据里堆两份，
//     而"堆两份"在游戏里完全看不出来（玩家已经拿到了），只有断言能盯住。
if (/Set<String> unlocked/.test(data) && /unlocked\.contains\(id\)/.test(data)) {
  ok('unlocked 是**集合**语义（重复点亮不会让它变大 ✓）');
} else no('unlocked 不是集合语义 —— 重复点亮会把同一条成就塞两份');

// A2. withUnlocked 必须**幂等且不动数据**：已点亮 ⇒ 原样返回 this。
//     判据要求"早退发生在新建集合之前"（先建再判 = 照样白跑一轮，且容易写反）。
const earlyOut = data.indexOf('unlocked.contains(id)');
const buildNew = data.indexOf('new java.util.HashSet<>(unlocked)');
if (earlyOut >= 0 && buildNew >= 0 && earlyOut < buildNew) {
  ok('withUnlocked 幂等（已点亮 ⇒ 早退返回 this，在新建集合之前 ✓）');
} else if (earlyOut >= 0) {
  no('withUnlocked 的 contains 早退在新建集合**之后** —— 幂等看着有、实际每次都在重建');
} else no('withUnlocked 少了 contains 早退 —— 重复点亮不是幂等的');

// A3. 老存档零迁移：Codec 一律 optionalFieldOf。
//     用 fieldOf 会让**整份**成就数据读不进来（老存档里根本没这个键），
//     症状是"玩家上线后成就全没了"，而代码看起来完全正常。
const opt = (data.match(/optionalFieldOf\(/g) || []).length;
if (opt >= 1 && !/\.fieldOf\(/.test(data)) {
  ok('Codec 全部 optionalFieldOf（老存档零迁移 ✓）');
} else no('AchievementData 的 Codec 用了 fieldOf 或没写 optionalFieldOf —— 老存档会读不进来');

// A4. 必须有 EMPTY 默认值：附件 builder 的默认值供应器要用它，
//     任何取值点都不该拿到 null。
if (/static final AchievementData EMPTY/.test(data)) ok('有 EMPTY 默认值 ✓');
else no('缺 EMPTY 默认值 —— 附件默认值供应器会拿到 null');

console.log('\n[B] ModAttachments 注册（三件套缺一不可）');
const att = read(ATTACH);

// B1. 注册名：成就与称号/委托平级，名字写错等于没注册。
if (/ATTACHMENT_TYPES\.register\("player_achievements"/.test(att)) {
  ok('注册名 player_achievements ✓');
} else no('没找到 player_achievements 的注册（成就数据不会被持久化）');

// B2. serialize：不序列化 ⇒ 数据只在内存里，退出游戏就没了。
//     这类 bug 当下看起来完全正常（"奖励发了"，重启后全没），最难发现。
const block = att.slice(att.indexOf('player_achievements'), att.indexOf('player_achievements') + 400);
if (/\.serialize\(AchievementData\.CODEC\)/.test(block)) ok('serialize(AchievementData.CODEC) ✓（会持久化）');
else no('player_achievements 少了 serialize —— 退出游戏后成就数据会消失');

// B3. copyOnDeath：成就是永久成果，死一次掉光不可接受（与称号/委托同一条口径）。
if (/\.copyOnDeath\(\)/.test(block)) ok('copyOnDeath() ✓（死亡不掉）');
else no('player_achievements 少了 copyOnDeath —— 死一次成就全掉');

console.log('\n[C] AchievementService：唯一入口 + 幂等 + 奖励通道');
const svc = read(SERVICE);

// C1. 幂等第一道：已点亮 ⇒ 早退，且必须在**发信之前**。
const hasAt = svc.indexOf('cur.has(id)');
const deliverAt = svc.indexOf('MailService.deliver');
const setAt = svc.indexOf('PlayerData.setAchievements');
if (hasAt >= 0 && deliverAt >= 0 && hasAt < deliverAt) {
  ok('已点亮 ⇒ 早退（幂等第一道，在发信之前 ✓）');
} else no('unlock 没在发信前查 has —— 重复触发会重复发信');

// C2. **先发信、成功才置位**。反过来写就是本仓库最贵的一类错误：
//     "点亮了但信没发出去" ⇒ 玩家永远拿不到奖励，而且看起来完全正常。
if (deliverAt >= 0 && setAt >= 0 && deliverAt < setAt) {
  ok('先发信、成功才置位（发信在 setAchievements 之前 ✓）');
} else no('置位在发信之前 —— 邮箱满时会"点亮了但没奖励"，玩家永远补不到');

// C3. 邮箱满必须"不置位、留到下次"：判据是拿 deliver 的返回值与 OK 比。
if (/!=\s*MailService\.Result\.OK/.test(svc)) ok('邮箱满 ⇒ 不置位（等下次补发 ✓，docs/36 口径"绝不静默丢"）');
else no('没检查 deliver 的返回值 —— 邮箱满时会静默丢奖励');

// C4. 奖励不新造通道：经验走既有 addXp，鱼币走信件附件。
if (/FishermanData\.addXp\(/.test(svc)) ok('经验走既有 FishermanData.addXp（不新造通道 ✓）');
else no('经验没走既有系统 —— 会出现第二套经验来源');

console.log('\n[D] 定义表 ↔ 语言键（"加了成就忘了文案"是这类系统最常见的漏）');
const def = read(DEF);
const ids = [...def.matchAll(/put\("([a-z0-9_]+)"/g)].map((m) => m[1]);
if (ids.length === 0) no('定义表里一条成就都没有 —— 表没建起来');
else ok('定义表 ' + ids.length + ' 条：' + ids.join(', '));

const zh = read(LANG_ZH);
const en = read(LANG_EN);
const missing = ids.filter((id) => !zh.includes('"achievement.anglertackle.' + id + '"')
  || !en.includes('"achievement.anglertackle.' + id + '"'));
if (ids.length > 0 && missing.length === 0) ok('每条成就 id 在中英语言文件里都有名字 ✓');
else no('这些成就 id 缺中英语言键（游戏里会显示成一串键名）：' + missing.join(', '));

// D2. 达成信的模板键也要成对，否则信没有标题/正文。
const tmpl = (svc.match(/MAIL_DONE = "([a-z0-9_]+)"/) || [])[1];
const mailOk = tmpl && ['title', 'body'].every((k) =>
  zh.includes('"mail.anglertackle.' + tmpl + '.' + k + '"') && en.includes('"mail.anglertackle.' + tmpl + '.' + k + '"'));
if (mailOk) ok('达成信模板 ' + tmpl + ' 的中英标题+正文都在 ✓');
else no('达成信模板 ' + (tmpl ?? '(没找到 MAIL_DONE)') + ' 的语言键不全 —— 信会没有标题或正文');

console.log('\n[E] 接线（服务写了但没挂进指令 = 玩家永远碰不到）');
const cmd = read(CMD);
// ⚠ 判据必须盯**非注释行**：只查"文件里有没有这串字符"的话，把调用注释掉照样算通过
//   —— 2026-10-15 负例 `achievement-unwired` 当场抓到了这个弱断言（第一版就是这么写的）。
const callWired = /(^|\n)[ \t]*registerAchievements\(dispatcher\);/.test(cmd);
if (callWired && cmd.includes('private static void registerAchievements(')) {
  ok('registerAchievements 已定义且**真被调用**（非注释行）✓（/atl ach 存在）');
} else no('registerAchievements 没接进 register(...) —— /atl ach 不会存在');
if (/lit\("grant"\)/.test(cmd)) ok('/atl ach grant 走 lit("grant")（OP 由 OP_ONLY 一处决定 ✓）');
else no('/atl ach grant 没走 lit("grant") —— 权限会出现第二个真源');

// ---------------------------------------------------------------- [F] A2 自动达成
console.log('\n[F] 自动达成接线（A2：上鱼类 11 条接 onCatch —— 服务写了但没挂 = 玩家永远等不到）');
const hooks = read(HOOKS);

// F1. 判定入口 onCatch 必须在服务里（挂钩点不写判断，理由见 AchievementService 的类注释）。
if (/public static void onCatch\(/.test(svc)) ok('AchievementService.onCatch 存在（判定在服务里 ✓）');
else no('AchievementService 没有 onCatch —— A2 的判定没地方放，自动达成无从谈起');

// F2. LeaderboardHooks 必须在**非注释行**上调它。
//   ⚠ 判据同 [E] 的教训（achievement-unwired 当场抓到过弱断言）：只查"文件里有没有这串"
//   会被"把调用注释掉"骗过去 —— 所以要求行首到调用名之间只有空白。
//   兼容全限定与短名两种写法（将来改成 import 后短名也认）。
const hookWired = /(^|\n)[ \t]*(?:com\.whitecobalt\.anglertackle\.achievement\.)?AchievementService\.onCatch\(/.test(hooks);
if (hookWired) ok('LeaderboardHooks.onLanded 真调了 AchievementService.onCatch（非注释行 ✓）');
else no('挂钩点没调 AchievementService.onCatch —— 上鱼类成就要靠手敲指令，等于没有');

// F3. 挂钩点里不许出现 unlock：判定写在共用的挂钩点上就会出现两份逻辑
//   （"改一处忘一处"正是本仓库反复吃亏的那类）。
if (/AchievementService\.unlock\(/.test(hooks)) {
  no('LeaderboardHooks 里直接调了 unlock —— 判定必须留在 AchievementService.onCatch（挂钩点是共用的）');
} else ok('挂钩点不写判定（unlock 只在服务里 ✓）');

// F4. ⚠ 图鉴种数必须含"这一杆"（+1）：recordCatch 比 onLanded 晚，不补就永远差一条鱼。
//   判据同时盯 hasCaught（用来判"是不是新种"）与 +1 本身 —— 少任何一个这个补丁都不成立。
if (/hasCaught\(fishId\)/.test(svc) && /codexCount\(\)\s*\+\s*\(newSpecies\s*\?\s*1\s*:\s*0\)/.test(svc)) {
  ok('图鉴种数含"这一杆"（+1 补齐 onLanded 早于 recordCatch 的时间差 ✓）');
} else no('onCatch 没给图鉴种数补 +1 —— 刚好凑满里程碑的那一杆永远点亮不了（差一条鱼，极难复现）');

// F5. 品质档位口径必须与 FishSpecies 逐字一致（白0 绿1 蓝2 紫3 金4 红5）——
//   数字错了不会报错，只会"初见金点成了初见紫"，玩家根本发现不了。
const tierOk = ['TIER_GREEN = 1', 'TIER_BLUE = 2', 'TIER_PURPLE = 3', 'TIER_GOLD = 4', 'TIER_RED = 5']
  .every((c) => svc.includes(c));
if (tierOk) ok('品质档位口径 绿1 蓝2 紫3 金4 红5（与 FishSpecies 一致 ✓）');
else no('品质档位常量与 FishSpecies 口径（白0 绿1 蓝2 紫3 金4 红5）不一致 —— 初见成就会点错档');

// F6. A2 范围钉死：这 11 条必须都在定义表里（少一条 = 这一批没做完就交了）。
//   ⚠ A3 加新类别时**要同步扩这个数组**（那是故意的：范围变更必须过检查器）。
const A2_IDS = ['a_first_catch', 'a_codex_5', 'a_codex_10', 'a_codex_24', 'a_codex_40', 'a_codex_all',
  'b_green', 'b_blue', 'b_purple', 'b_gold', 'b_red'];
const missA2 = A2_IDS.filter((id) => !ids.includes(id));
if (missA2.length === 0) ok('A2 上鱼类 11 条全部在定义表里 ✓（' + A2_IDS.length + ' 条）');
else no('A2 缺条（这批没做完）：' + missA2.join(', '));

// F7. 鱼类通鉴（a_codex_all）的总数必须**当场读** `FishSpecies.ALL.size()`，不许写死 47。
//   写死的话，以后加鱼种它就永远点不亮，而代码看起来完全正常（"写死 47"是本仓库踩过的老坑）。
//   ⚠ 判据必须盯**非注释行**：只查"文件里有没有这串"的话，把它挪进注释也算通过 ——
//   2026-10-15 负例 `ach-codex-hardcoded-total` 当场抓到过这个弱写法（第一版就是这么写的 ✗）。
if (/(^|\n)[ \t]*if \(codexAfter >= FishSpecies\.ALL\.size\(\)\)/.test(svc)) {
  ok('鱼类通鉴的总数当场读 FishSpecies.ALL.size()（以后加鱼种自动跟上 ✓）');
} else no('鱼类通鉴的总数没用 FishSpecies.ALL.size() —— 写死的数字在加鱼种后会永远点不亮（或只写在注释里）');

// ---------------------------------------------------------------- [G] A5：授予**既有**称号
console.log('\n[G] A5：与既有称号同条件 ⇒ 授予既有称号（不新增称号，docs/41 §9）');
// 与 TitleDefs 的 40 条逐字对齐：成就不再自己发明名字/门槛，只做"条件达成 → 授予既有称号"这一步。
const TITLE_MAP = [['a_codex_24', 'codex_24'], ['a_codex_40', 'codex_40'],
  ['a_codex_all', 'codex_all'], ['b_red', 'red_first']];
const titleDefs = read('src/main/java/com/whitecobalt/anglertackle/title/TitleDefs.java');
const missMap = TITLE_MAP.filter(([a, t]) => !new RegExp('"' + a + '"\\s*,\\s*"' + t + '"').test(def));
if (missMap.length === 0) ok('4 条同条件映射齐全（' + TITLE_MAP.map((p) => p[1]).join(', ') + '）✓');
else no('缺/写错了同条件映射：' + missMap.map((p) => p[0] + '→' + p[1]).join(', '));

// G2. ⚠ 映射指向的称号必须**真的存在于 TitleDefs**：写错一个字母 = 玩家达成后什么都没拿到，
//     而 Titles.grant 对不存在的 id 是静默 return false（不报错、不提示，只能靠这条断言）。
const ghost = TITLE_MAP.filter(([, t]) => !new RegExp('new Def\\("' + t + '"').test(titleDefs));
if (ghost.length === 0) ok('映射里的称号都在 TitleDefs 里真实存在 ✓（不会静默授予失败）');
else no('映射指向了不存在的称号：' + ghost.map((p) => p[1]).join(', ') + ' —— Titles.grant 会静默返回 false');

// G3. 授予必须在"发信成功 + 已置位"**之后**：放前面会出现"称号到手但成就没点亮/奖励没发"。
// ⚠ 判据盯**非注释行**：只查"文件里有没有 Titles.grant("的话，把调用注释掉照样算通过 ——
//   2026-10-15 负例 `ach-no-title-grant` 当场抓到过这个弱写法（今天第三次同类错误 ✗）。
const grantAt = (svc.match(/(^|\n)[ \t]*Titles\.grant\(player, titleId\);/) || { index: -1 }).index;
const setIdx = svc.indexOf('PlayerData.setAchievements(');
if (grantAt >= 0 && setIdx >= 0 && grantAt > setIdx) ok('Titles.grant 在置位之后（重复触发走不到 ✓）');
else if (grantAt >= 0) no('Titles.grant 在置位之前 —— 会出现"称号到手、成就没点亮"');
else no('成就没接 Titles.grant —— A5 的同条件称号不会授予');

// G4. 唯一授予入口：成就侧**绝不许**自己写称号存储（绕过去就没有首授提示与服务端日志）。
const svcCode = svc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
if (!/withGrant\(/.test(svcCode) && !/owned\.add/.test(svcCode)) ok('成就侧不碰称号存储（只调 Titles.grant ✓，判据已剔除注释）');
else no('成就侧直接改了称号数据 —— 绕过唯一入口（Titles.grant）');

// ---------------------------------------------------------------- [H] A4：成就面板（客户端多文件）
console.log('\n[H] A4：成就面板（载荷 → 客户端缓存 → 界面 → 注册）');
// 这一组盯的是"玩家敲 /atl ach 到底会不会弹出东西"。它坏了的症状是**什么都没发生** ——
// 玩家只会以为"这功能没做"，不会报 bug，所以四步接线每一步都要有断言。
const cph = read('src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java');
const coinSync = read('src/main/java/com/whitecobalt/anglertackle/event/CoinSyncEvents.java');
if (/playToClient\(com\.whitecobalt\.anglertackle\.network\.AchievementPayload\.TYPE/.test(cph)) {
  ok('AchievementPayload 已在客户端注册（playToClient ✓）');
} else no('AchievementPayload 没注册到客户端 —— 服务端推了也没人收，/atl ach 不会弹面板');
if (/(^|\n)[ \t]*mc\.setScreen\(new com\.whitecobalt\.anglertackle\.client\.screen\.AchievementScreen\(\)\);/.test(cph)) {
  ok('收到快照会开界面（setScreen，判据盯非注释行 ✓）');
} else no('处理器没开界面 —— 玩家敲 /atl ach 什么都不会发生');
if (/(^|\n)[ \t]*com\.whitecobalt\.anglertackle\.network\.ModNetwork\.syncAchievements\(player\);/.test(cmd)) {
  ok('/atl ach 会推快照（指令即请求，不需要 C2S 载荷 ✓）');
} else no('showAchievements 没推快照 —— 面板永远拿不到数据');
if (/(^|\n)[ \t]*com\.whitecobalt\.anglertackle\.client\.ClientAchievements\.clear\(\);/.test(coinSync)) {
  ok('退出世界清缓存 ✓（不闪上一个存档的成就）');
} else no('断线没清成就缓存 —— 换存档会先闪一眼上个存档的成就');

// H5. ⚠ 渲染顺序（2026-10-15 用户截图当场糊掉的那次）：**自己调一次 renderBackground，
//   绝不调 super.render()**。既有五个界面都这么写，我第一版写成了"不调 renderBackground +
//   结尾调 super.render"⇒ 那层全屏暗化画在内容之后 ⇒ 面板与文字发灰、界面像蒙了层雾。
//   两条判据**都要**：只查"有没有 super.render"会被"两个都调"绕过；只查 renderBackground
//   会被"只调 super"绕过（后者正是我踩的那次）。判据一律先剔除注释 ✓。
const screenSrc = read('src/main/java/com/whitecobalt/anglertackle/client/screen/AchievementScreen.java');
const screenCode = screenSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const hasBg = /(^|\n)[ \t]*this\.renderBackground\(/.test(screenCode);
const hasSuper = /(^|\n)[ \t]*super\.render\(/.test(screenCode);
// H6. ⚠ 三栏几何不许重叠（2026-10-15 用户截图："很明显有重叠部分"）：左栏右缘必须离
//   中栏选中高亮的左缘（MID_X - SEL_PAD）还有余量。判据直接读源码里的常量算，不靠肉眼。
const num = (n) => {
  const r = new RegExp(n + '\\s*=\\s*(-?\\d+)').exec(screenCode);
  return r ? parseInt(r[1], 10) : NaN;
};
const LX = num('LEFT_X');
const LW = num('LEFT_W');
const MG = num('MID_GAP');
const SP = num('SEL_PAD');
const MWid = num('MID_W');
if ([LX, LW, MG, SP, MWid].every(Number.isFinite)) {
  const leftRight = LX + LW;                 // 左栏右缘
  const midSelLeft = LX + LW + MG - SP;      // 中栏高亮左缘
  const midRight = LX + LW + MG + MWid;      // 中栏右缘
  if (midSelLeft > leftRight && midRight <= LX + 462) {
    ok('三栏几何不重叠（左栏右缘 ' + leftRight + ' < 中栏高亮左缘 ' + midSelLeft + ' ✓）');
  } else no('三栏几何重叠：左栏右缘 ' + leftRight + ' vs 中栏高亮左缘 ' + midSelLeft
    + '（重叠就会像 2026-10-15 那张截图：x/y 被高亮框压住）');
} else no('读不到三栏几何常量（LEFT_X/LEFT_W/MID_GAP/SEL_PAD/MID_W）—— 判据失效');

// H7. A3 等级类（2026-10-15 晚）：升级钩子必须**真的挂在唯一经验入口**上。
//   `FishermanData.addXp` 是全仓库唯一的经验入口（卡级规则也在它调用的 gainXp 里），
//   所以等级成就只该在这一个地方被触发；挂在别处就会出现"某些升级路径不发成就"。
const fdata = read('src/main/java/com/whitecobalt/anglertackle/player/FishermanData.java');
const fdataCode = fdata.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
if (/(^|\n)[ \t]*com\.whitecobalt\.anglertackle\.achievement\.AchievementService\.syncLevel\(sp, g\.next\(\)\.level\(\)\);/.test(fdataCode)) {
  ok('升级钩子挂在唯一经验入口上（addXp → syncLevel ✓）');
} else no('addXp 里没调 AchievementService.syncLevel —— 等级类成就永远不会点亮');

if (hasBg && !hasSuper) {
  ok('渲染顺序对（自己调一次 renderBackground、不调 super.render ✓）');
} else {
  no('渲染顺序错：' + (hasBg ? '' : '少了 renderBackground；')
    + (hasSuper ? '调了 super.render —— 全屏暗化会盖在面板和文字上，界面会糊' : ''));
}

// ---------------------------------------------------------------- [I] 生效审计（用户 2026-10-15："检查实际生效内容…实际游戏能达成"）
console.log('\n[I] 生效审计：定义表里每一条都必须有**能触发它的代码路径**');
// 这一组回答的是"这 50 条到底能不能在游戏里拿到"。判据两条：
//   ① 字面量触发：`unlock(player, "id")` 出现在某个会跑的类里；
//   ② 动态触发：id 是**拼出来**的（目前只有图鉴里程碑 `"a_codex_" + n`），
//      那就要求"模板里的 n"确实在源码的里程碑数组里 —— 光有前缀不算数。
// ⚠ 没有这一组时，加一条定义忘了接触发点 = 玩家永远点不亮，而且**界面一切正常**，最难发现。
const unlockFiles = [
  'src/main/java/com/whitecobalt/anglertackle/achievement/AchievementService.java',
  'src/main/java/com/whitecobalt/anglertackle/league/LeagueService.java',
  'src/main/java/com/whitecobalt/anglertackle/contest/ContestService.java',
  'src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java'
];
const literals = new Set();
let dynamicCode = '';
for (const f of unlockFiles) {
  const src = read(f).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  dynamicCode += src;
  for (const m of src.matchAll(/unlock\([A-Za-z_]+, "([a-z0-9_]+)"\)/g)) {
    literals.add(m[1]);
  }
}
const idRe = /put\("([a-z0-9_]+)"/g;
const allIds = [...def.matchAll(idRe)].map((m) => m[1]);
const dead = allIds.filter((id) => {
  if (literals.has(id)) {
    return false;
  }
  // 动态：`a_codex_5` ← `unlock(player, "a_codex_" + n)` 且 n 在 CODEX_MILESTONES 里
  const dyn = /^a_codex_(\d+)$/.exec(id);
  if (dyn && new RegExp('unlock\\([A-Za-z_]+, "a_codex_" \\+ n\\)').test(dynamicCode)) {
    const arr = /CODEX_MILESTONES\s*=\s*\{([^}]*)\}/.exec(dynamicCode);
    if (arr && arr[1].split(',').map((s) => s.trim()).includes(dyn[1])) {
      return false;
    }
  }
  return true;
});
if (dead.length === 0) {
  ok('50 条全部有触发路径（字面量 ' + literals.size + ' 条 + 动态模板补齐 ✓）');
} else {
  no('这些成就**永远点不亮**（有定义、没触发点，界面上却看不出来）：' + dead.join(', '));
}

console.log('\n' + (bad === 0
  ? '✅ 成就系统检查通过（A1：数据层 + 发放 + 接线；A2：上鱼类 11 条自动达成）'
  : '❌ 成就系统检查未通过（' + bad + ' 项）'));
process.exitCode = bad === 0 ? 0 : 1;