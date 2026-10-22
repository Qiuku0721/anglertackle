'use strict';
/**
 * check-titles.js —— 守住**称号系统**（用户 2026-10-11："开发称号系统" / "备选加过渡加。然后推进。"）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * 称号的每一种坏法都**不报错**：
 *   ① 表里有、语言文件里没有 ⇒ 聊天里显示成一串 `title.anglertackle.xxx`；
 *   ② 条件写到**永远拿不到**（"47 种全金"那次）⇒ 玩家以为是自己没钓到，永远不会来报 ✗；
 *   ③ 名字按"光秃秃一个名词"写（用户点名的 `大物`/`巨物`）⇒ 聊天栏里别人不知道在说什么 ✗；
 *   ④ 少一串颜色/多一个写死的颜色码 ⇒ 与图鉴/tooltip 的色号分叉；
 *   ⑤ 佩戴/查询被挂上 OP ⇒ **本机单人存档永远测不出来**（房主默认权限 4）；
 *   ⑥ 没佩戴的玩家聊天被别人改掉 ⇒ 违背"纯加法"。
 *
 * ── 判据（九组）─────────────────────────────────────────────
 *   A. `TitleDefs.ALL` 的 id 与 `docs/38` §4 的表格**逐条对账**（38 行 / 40 个 id）
 *   B. 每个 id 在 zh_cn / en_us 里都有名字与条件（`title.anglertackle.<id>` / `.cond`）
 *   C. **命名规则**：2~5 字 + 身份后缀/引用白名单 + 奇幻词黑名单（读 TitleDefs 里的三个数组）
 *   D. 颜色只走 `Quality`（源码里不出现 `0xFF......` 颜色码）
 *   E. 数量型条件**从源码数出来**：金鳞全录的"能出金的种数"必须来自 FishSpecies；
 *      "掌勺十味"的 10 必须等于 DishRecipe.Dish 的枚举数；等级线必须来自 AnglerLeveling
 *   F. 聊天：默认 full_line（`玩家[称号]：内容`）、走 `broadcastSystemMessage`（服务端广播）、
 *      没佩戴就**不拦事件**、异常要吞
 *   G. 指令：`list [玩家]` / `use` 无门槛，`grant` / `revoke` 在 OP_ONLY 里
 *   H. 附件：`copyOnDeath`（称号永久）+ `optionalFieldOf`（老存档零迁移）+ 幂等授予
 *   I. **界面**（2026-10-12 第二阶段）：`/atl title` 能开界面、默认**列未获得的**、
 *      佩戴只发动作包（判定在服务端一处）、客户端改不了状态、文字走 TextWidget、
 *      配色不新起色板、三个入口齐全
 *   J. **头顶名牌**（2026-10-13 §2.1）：包只在客户端注册且走 enqueueWork、缓存覆盖式、
 *      渲染挂 Dist.CLIENT 且用 setContent、认不出的 id 画前 return、equip/unequip 都广播
 *      （先写后发）、进服/退服都广播（退服带 skip 且真跳）、只发仍拥有的、退出世界清缓存
 *
 * 用法：node tools/check-titles.js
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

const DEFS = 'src/main/java/com/whitecobalt/anglertackle/title/TitleDefs.java';
const TITLES = 'src/main/java/com/whitecobalt/anglertackle/title/Titles.java';
const CHAT = 'src/main/java/com/whitecobalt/anglertackle/event/TitleChatEvents.java';
const ATTR = 'src/main/java/com/whitecobalt/anglertackle/registry/ModAttachments.java';
const DATA = 'src/main/java/com/whitecobalt/anglertackle/player/PlayerTitles.java';
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
const DOC = 'docs/38-称号系统策划案.md';
/** 称号界面（折叠显示的落点，`docs/39` §5.4）。 */
const TITLE_SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/TitleScreen.java';
/** 商店界面（联赛货架上的纪念称号也在那里渲染）。 */
const SHOP_SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/ShopScreen.java';

console.log('=== 称号系统检查（表 / 文案 / 命名 / 数值来源 / 聊天 / 权限 / 界面） ===\n');

if (!exists(DEFS) || !exists(TITLES)) {
  console.error('❌ 缺 title/TitleDefs.java 或 title/Titles.java —— 称号系统还没落地');
  process.exit(1);
}
const defs = strip(read(DEFS));
const titles = strip(read(TITLES));
const chat = strip(read(CHAT));

// ---------------------------------------------------------------- A. 表 ↔ 文档逐条对账
const ids = [...defs.matchAll(/new Def\("([a-z_0-9]+)",\s*(\d),\s*(true|false)\)/g)]
  .map((m) => ({ id: m[1], quality: Number(m[2]), repeatable: m[3] === 'true' }));
{
  const doc = read(DOC);
  // ⚠ 只认**主表**的行（7 列：`| n | id | 中文名 | 颜色 | 条件 | 判据 | 可重复 | 依赖 |`）。
  //   §7「待你拍板」那些 3 列的行里也在反引号里提到 id，一起收进来就会多数一轮 ✗（踩过）。
  const docIds = [];
  for (const line of doc.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.split('|');
    if (cells.length < 6) continue;
    for (const m of cells[2].matchAll(/`([a-z_0-9]+)`/g)) docIds.push(m[1]);
  }
  const setDoc = new Set(docIds);
  const setCode = new Set(ids.map((d) => d.id));
  const onlyDoc = [...setDoc].filter((x) => !setCode.has(x));
  const onlyCode = [...setCode].filter((x) => !setDoc.has(x));
  if (ids.length === 0) bad('TitleDefs 里一条称号都没有');
  else if (onlyDoc.length) bad('docs/38 里有、代码表里没有的称号：' + onlyDoc.join(', '));
  else if (onlyCode.length) bad('代码表里有、docs/38 里没有的称号：' + onlyCode.join(', '));
  else ok('代码表与 docs/38 §4 逐条对上：' + ids.length + ' 个 id（文档 38 行）');
  // 文档里的 id 总数（含"小/中/大联赛冠军"那一行的 3 个）
  if (docIds.length !== ids.length) {
    bad('文档表格里的 id 数（' + docIds.length + '）与代码表（' + ids.length + '）不一致');
  }
}

// ---------------------------------------------------------------- B. 文案齐全（两种语言）
{
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
  const miss = [];
  for (const d of ids) {
    for (const [lang, j] of [['zh_cn', zh], ['en_us', en]]) {
      if (!String(j['title.anglertackle.' + d.id] || '').trim()) miss.push(lang + ' ' + d.id + '（名字）');
      if (!String(j['title.anglertackle.' + d.id + '.cond'] || '').trim()) miss.push(lang + ' ' + d.id + '（条件）');
    }
  }
  if (miss.length) bad('语言文件里缺这些：' + miss.join('、'));
  else ok('40 个称号的名字与条件在 zh_cn / en_us 里都有（各 ' + (ids.length * 2) + ' 条）');
}

// ---------------------------------------------------------------- C. 命名规则
{
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  // 白名单与黑名单从 TitleDefs 里读（**唯一真源**，见那个类的注释）
  const listOf = (name) => {
    const m = new RegExp(name + '\\s*=\\s*List\\.of\\(([\\s\\S]*?)\\);').exec(defs);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
  };
  const tails = listOf('NAME_TAILS');
  const explained = listOf('EXPLAINED_NAMES');
  const banned = listOf('BANNED_WORDS');
  if (!tails || !explained || !banned) {
    bad('TitleDefs 里读不到 NAME_TAILS / EXPLAINED_NAMES / BANNED_WORDS —— 命名规则的唯一真源没了');
  } else {
    const problems = [];
    for (const d of ids) {
      const cn = zh['title.anglertackle.' + d.id];
      const len = [...cn].length;
      if (len < 2 || len > 5) problems.push(cn + '（' + len + ' 字，要求 2~5）');
      const hit = banned.find((w) => cn.includes(w));
      if (hit) problems.push(cn + '（命中奇幻词「' + hit + '」）');
      if (!tails.some((t) => cn.endsWith(t)) && !explained.includes(cn)) {
        problems.push(cn + '（既不是身份词结尾，也不在引用短语白名单里 —— 光秃秃一个名词）');
      }
    }
    if (problems.length) bad('命名不合规：' + problems.join('；'));
    else ok('40 个名字全部合规（2~5 字 + 身份词/引用白名单 + 无奇幻词）');
    // 反向自检：白名单里不许留"表里没有的名字"（否则白名单会越攒越松）
    const names = ids.map((d) => zh['title.anglertackle.' + d.id]);
    const stale = explained.filter((n) => !names.includes(n));
    if (stale.length) bad('引用短语白名单里有已不存在的名字：' + stale.join('、') + '（白名单只许留现役的）');
    else ok('引用短语白名单没有过期条目（' + explained.length + ' 条全是现役名字）');
  }
  // 反例自检：`巨物` 这种写法必须被判不合规（用户点名的别扭写法）
  if (tails && explained) {
    const bare = '巨物';
    const bad1 = !tails.some((t) => bare.endsWith(t)) && !explained.includes(bare);
    if (bad1) ok('负例自检：「' + bare + '」会被判不合规（正是用户点名的"人家不知道干嘛"写法）');
    else bad('「' + bare + '」居然被判合规 —— 命名规则抓不住光秃秃的名词了');
  }
}

// ---------------------------------------------------------------- D. 颜色只走 Quality
{
  const srcFiles = [DEFS, TITLES, CHAT, CMD];
  const hard = [];
  for (const f of srcFiles) {
    const s = strip(read(f));
    const m = /0x[Ff][Ff][0-9A-Fa-f]{6}/.exec(s);
    if (m) hard.push(path.basename(f) + ' 里的 ' + m[0]);
  }
  if (hard.length) bad('称号链里写死了颜色码：' + hard.join('、') + '（必须走 Quality）');
  else ok('称号链里没有写死的颜色码（颜色全部走 Quality）');
  if (/Quality\.of\(/.test(defs) || /Quality\.of\(/.test(titles) || /Quality\.of\(/.test(chat)
      || /Quality\.of\(/.test(read(CMD))) {
    ok('颜色确实由 Quality.of(档位) 取（与 tooltip / 图鉴同一套色号）');
  } else bad('找不到 Quality.of(...) —— 称号的颜色是从哪来的？');
}

// ---------------------------------------------------------------- E. 数量型条件必须从源码数出来
{
  // ① 金鳞全录：能出金的种数必须来自 FishSpecies（不许写死 47 或 30）
  if (/maxTier\(\)\s*>=\s*4/.test(titles) && /FishSpecies\.ALL/.test(titles)) {
    ok('「金鳞全录」的"能出金的种数"是从 FishSpecies 数出来的（写死 47 就会红）');
  } else {
    bad('「金鳞全录」没有从 FishSpecies 数"能出金的鱼种" —— 写死就可能是永远拿不到的条件 ✗');
  }
  if (/goldDone\s*>=\s*goldCapable/.test(titles) || /goldCapable\s*>=\s*\d+/.test(titles)) {
    ok('判定用的是"数出来的种数"（goldDone >= goldCapable），不是常量');
  } else bad('金鳞全录的判定没跟数出来的种数比');
  // ② 掌勺十味：菜型数必须来自 DishRecipe.Dish
  if (/DishRecipe\.Dish\.values\(\)\.length/.test(titles)) {
    ok('「鱼宴大厨」的菜型数取自 DishRecipe.Dish 的枚举（不是写死的 10）');
  } else bad('「鱼宴大厨」没有从 DishRecipe.Dish 数菜型数');
  // ③ 等级线：必须来自 AnglerLeveling
  if (/AnglerLeveling\.GATE_LEVELS/.test(titles) && /AnglerLeveling\.MAX_LEVEL/.test(titles)) {
    ok('等级线取自 AnglerLeveling 的 GATE_LEVELS / MAX_LEVEL');
  } else bad('等级线没有取自 AnglerLeveling（写死数字以后改等级体系就会漂）');
  // ④ 三冠王：三个榜必须真的存在
  const boardOk = ['HEAVIEST', 'LONGEST_FIGHT', 'FASTEST_CATCH']
    .every((b) => new RegExp('Leaderboard\\.Board\\.' + b).test(titles));
  if (boardOk) ok('「三冠王」判的三个榜（最重 / 最长对抗 / 最短上鱼）在 Leaderboard.Board 里都存在');
  else bad('三冠王判的榜名对不上 Leaderboard.Board —— 会永远判不成立');
}

// ---------------------------------------------------------------- F. 聊天行为
{
  if (!exists(CHAT)) {
    bad('缺 TitleChatEvents.java —— 聊天里不会有称号后缀');
  } else {
    if (/ServerChatEvent/.test(chat)) ok('监听的是 ServerChatEvent（服务端事件：别人也看得到 ✓）');
    else bad('没有监听 ServerChatEvent');
    if (/broadcastSystemMessage/.test(chat)) {
      ok('默认模式走 broadcastSystemMessage（服务端广播 ⇒ 全服都看得到，不是只发给自己）');
    } else bad('没有 broadcastSystemMessage —— 称号会变成"只有自己看得见"的花架子 ✗');
    // 没佩戴 ⇒ 不拦事件（纯加法）
    const emptyGuard = /equipped\(\)/.test(chat) && /isEmpty\(\)/.test(chat) && /return;/.test(chat);
    if (emptyGuard) ok('没佩戴称号就提前 return（原版聊天一个字都不动 ✓）');
    else bad('找不到"没佩戴就放行"的早退 —— 未使用该功能的玩家聊天会被改动 ✗');
    if (/setCanceled\(true\)/.test(chat) && /\["|"\["/.test(chat) && /"\]："/.test(chat)) {
      ok('full_line 的格式与用户口径逐字一致：玩家[称号]：内容');
    } else bad('full_line 的格式不是 玩家[称号]：内容（少了方括号或全角冒号）');
    if (/message_only|mode == 1|mode >= 2/.test(chat)) ok('留了退路（message_only）与关闭开关（vanilla）');
    else bad('没有"退路 / 关闭"两条配置分支（用户说：实在有困难可以方案 2）');
    if (/catch \(Throwable/.test(chat)) ok('异常被吞掉（称号坏了也不许把聊天带崩）');
    else bad('聊天事件里没有 try/catch —— 称号一坏，玩家连话都说不了 ✗');
  }
}

// ---------------------------------------------------------------- G. 指令与权限
{
  const cmd = strip(read(CMD));
  const hasList = /\.then\(lit\("list"\)/.test(cmd);
  const hasUse = /\.then\(lit\("use"\)/.test(cmd);
  const opBlock = /OP_ONLY\s*=\s*java\.util\.Set\.of\(([\s\S]*?)\);/.exec(cmd);
  const opListed = opBlock ? [...opBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  if (hasList && hasUse) ok('/atl title list 与 /atl title use 都在');
  else bad('缺 /atl title list 或 use');
  if (opListed.includes('grant') && opListed.includes('revoke')) {
    ok('grant / revoke 在 OP_ONLY 里（改别人的显示身份 ⇒ 需要 OP）');
  } else bad('grant / revoke 不在 OP_ONLY 里 —— 任何人都能给自己发称号 ✗');
  if (!opListed.includes('list') && !opListed.includes('use')) {
    ok('list / use 不在 OP_ONLY 里（看别人 ≠ 改别人；use 只改自己）');
  } else bad('list / use 被塞进 OP_ONLY 了 —— "别人也看得到"那条就废了（单人存档还测不出来）✗');
  // 看别人的那条必须有"玩家参数"分支
  if (/argument\("player"/.test(cmd) && /getPlayerByName/.test(cmd)) {
    ok('/atl title list <玩家> 通过 getPlayerByName 读**目标玩家**（不是调用者自己）');
  } else bad('/atl title list <玩家> 没有读目标玩家的入口 —— "别人也看得到"没实现');
}

// ---------------------------------------------------------------- H. 附件与幂等
{
  const attr = read(ATTR);
  // ⚠ 断言必须**限定在称号那一块注册里**：ModAttachments 里还有 player_data / fisherman
  //   两个附件也写着 `.copyOnDeath()` —— 用"整个文件里有没有 copyOnDeath"当判据时，
  //   把称号那块删掉照样能通过。这正是负例 `titles-no-copy-on-death` 第一次跑出来的洞
  //   （它报了"期望退出码 1，实际 0"），所以这里按注册块切开再判 ✓。
  const block = /PLAYER_TITLES\s*=[\s\S]*?\.build\(\)\)/.exec(attr);
  if (!block) {
    bad('ModAttachments 里找不到 PLAYER_TITLES 的注册块 —— 称号附件不存在？');
  } else if (!/\.copyOnDeath\(\)/.test(block[0])) {
    bad('称号附件**自己那块**没有 copyOnDeath（玩家死一次称号全没 ✗）——'
      + '注意别被同文件里另外两个附件的 copyOnDeath 蒙过去');
  } else if (!/serialize\(PlayerTitles\.CODEC\)/.test(block[0])) {
    bad('称号附件的注册块里没有 serialize(PlayerTitles.CODEC) —— 称号不会存盘');
  } else {
    ok('称号附件注册块自带 copyOnDeath + serialize（死一次不丢、且会存盘 ✓）');
  }
  const data = strip(read(DATA));
  const optional = (data.match(/optionalFieldOf\(/g) || []).length;
  if (optional >= 4) ok('PlayerTitles 的四个字段全部 optionalFieldOf（老存档零迁移 ✓）');
  else bad('PlayerTitles 有字段没用 optionalFieldOf —— 老存档会读不进来');
  if (/Set<String> owned/.test(data) && /owned\.contains\(id\)/.test(data)) {
    ok('owned 是**集合**（重复授予不会让它变大 ✓）');
  } else bad('owned 不是集合语义 —— 重复授予会把同一个称号塞两份');
  if (/merge\(id, 1, Integer::sum\)/.test(data)) ok('重复授予只把 counts +1（幂等 ✓）');
  else bad('找不到 counts 的幂等累加');
  const grantFirst = /boolean first = !cur\.has\(id\)/.test(titles);
  if (grantFirst) ok('Titles.grant 只在**第一次**拿到时报消息/写日志（幂等 ✓）');
  else bad('Titles.grant 分不清"第一次拿到"—— 每次触发都会发一遍消息');
  // docs/41 §9.6 第 3 条闸：不可重复称号已拥有 ⇒ 直接返回、连 counts 都不动。
  // 判据盯**守卫本身就位于 withGrant 之前**（不是"文件里出现过 repeatable"）：
  // ② 那种写法（把守卫挪到 withGrant 之后）照样 +1，脏计数照旧产生。
  const guardAt = titles.indexOf('!def.repeatable() && cur.has(id)');
  const grantAt = titles.indexOf('cur.withGrant(id)');
  if (guardAt >= 0 && grantAt >= 0 && guardAt < grantAt) {
    ok('不可重复称号已拥有 ⇒ grant 直接返回、不 +1（§9.6 第 3 条闸 ✓，且守卫在写入之前）');
  } else if (guardAt >= 0) {
    bad('§9.6 闸的守卫在 withGrant **之后** —— 计数照样 +1，等于没挡');
  } else {
    bad('Titles.grant 少了"不可重复且已拥有 ⇒ 不 +1"那道闸（docs/41 §9.6 第 3 条）');
  }
}

// ---------------------------------------------------------------- I. 界面（第二阶段，2026-10-12）
//
// 用户原话："**称号佩戴在哪，很难发现。**"
// 在那之前，佩戴**只有** `/atl title use <id>` 一条路 —— 玩家得先知道有这条指令、
// 再知道自己的称号 id、还得打对。称号是"给别人看的"东西，拿到却不知道去哪戴 = 白做。
//
// 这一组守的正是那次修复的每一条，而且**每条都能被一句改动弄红**（见 _negtest.js）：
//   ① `/atl title`（光打这一条）能开界面
//   ② 界面**默认列出未获得的**（那是"接下来去钓什么"的清单，藏起来正好相反 ✗）
//   ③ 佩戴只发动作包 ⇒ 判定在服务端**一处**（客户端改不了自己的称号）
//   ④ 协议里没有 targetUuid（"替别人戴上"在协议层就不存在）
//   ⑤ 文字走 TextWidget、尺寸走 UiLayout、配色不新起色板、品质色走 Quality
//   ⑥ 三个入口齐全（指令 / 图鉴按钮 / 拿到称号时那句提示）
//   ⑦ 行格式两侧字段数一致（不一致的表现是"界面空白"，不报错 ✗）
//   ⑧ 退出世界清缓存（不清就会先画上一个存档的"已获得"）
{
  const SCR = 'src/main/java/com/whitecobalt/anglertackle/client/screen/TitleScreen.java';
  const NET = 'src/main/java/com/whitecobalt/anglertackle/network/TitleActionPayload.java';
  const SNAPC = 'src/main/java/com/whitecobalt/anglertackle/title/TitleSnapshot.java';
  const MODNET = 'src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java';
  const CODEX = 'src/main/java/com/whitecobalt/anglertackle/client/screen/CodexScreen.java';
  const SYNC = 'src/main/java/com/whitecobalt/anglertackle/event/CoinSyncEvents.java';
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
  const has2 = (k) => String(zh[k] || '').trim() && String(en[k] || '').trim();

  if (!exists(SCR)) {
    bad('缺 ' + SCR + ' —— 称号界面没做，用户那句"很难发现"就没解决 ✗');
  } else {
    const scr = strip(read(SCR));
    const cmd = strip(read(CMD));

    // ① `/atl title` 光打这一条 = 开界面
    //   ⚠ 判据要**连着调用链**看：`.executes(` 挂在 title 这个 literal 上**并且**
    //   那条 executes 真的去发快照了。只搜"文件里有没有 syncTitles"的话，
    //   把 executes 整行删掉照样绿（这个坑今天已经踩过三次：
    //   "文件里存在某字符串" ≠ "那件事真的在做"）。
    const titleNode = /(?:Commands\.literal|lit)\("title"\)([\s\S]{0,300}?)\)\s*\.then\(lit\("list"\)/.exec(cmd);
    const openFn = /private static int openTitles\([\s\S]*?\n    \}/.exec(cmd);
    if (!titleNode) {
      bad('AnglerCommands 里找不到 title 节点（或它后面不再是 list 分支）—— 这条断言失效了，请更新');
    } else if (!/\.executes\(/.test(titleNode[1])) {
      bad('/atl title 光打这一条没有 executes —— 玩家打了也开不出界面（"很难发现"没解决）✗');
    } else if (!openFn || !/syncTitles\(/.test(openFn[0])) {
      bad('/atl title 的 executes 没有去 syncTitles(...) —— 开了个空壳界面');
    } else {
      ok('/atl title（光打这一条）会请求一份称号快照 ⇒ 客户端据此开界面 ✓');
    }

    // ② 默认**列未获得的**（藏起来就违背用户要的"发现得了"）
    const onlyOwnedDecl = /onlyOwned\s*=\s*(true|false)/.exec(scr);
    const visFn = /private List<Row> visible\(\)[\s\S]*?\n    \}/.exec(scr);
    if (!onlyOwnedDecl) {
      bad('界面里找不到 onlyOwned 的初值 —— 筛选默认是开是关看不出来');
    } else if (onlyOwnedDecl[1] !== 'false') {
      bad('界面默认"只看已获得" —— 没拿到的称号一进来就全看不见，'
        + '与用户那句"很难发现"正好相反 ✗（默认必须是全部）');
    } else if (!visFn || !/if\s*\(!onlyOwned\)/.test(visFn[0])) {
      bad('visible() 里没有"只有 !onlyOwned 时才把未获得的加进去" —— '
        + '要么未获得的根本没列，要么筛选开关是假的');
    } else if (!has2('gui.anglertackle.title_locked')) {
      bad('缺 gui.anglertackle.title_locked（中/英）—— 未获得的那些画不出状态词');
    } else {
      ok('默认列**全部**称号（未获得的带条件一起列），"只看已获得"是可选项 ✓');
    }

    // ③ 佩戴只发动作包：界面自己不许改状态（判定统一在服务端 Titles.equip）
    const toggle = /private void toggleEquip\(Row[\s\S]*?\n    \}/.exec(scr);
    if (!toggle || !/new TitleActionPayload\(/.test(toggle[0])) {
      bad('toggleEquip 没有发 TitleActionPayload —— 界面上那个按钮点了没用');
    } else if (/withEquipped|updateTitles|setTitles|PlayerData/.test(scr)) {
      bad('称号界面里出现了直接改数据的调用（withEquipped / updateTitles / PlayerData）—— '
        + '客户端不许自己决定"我戴着哪个"（服务端权威那条纪律）✗');
    } else if (!/Titles\.equip\(player, id\)/.test(cmd)) {
      bad('/atl title use 没有走 Titles.equip(...) —— 指令与界面会各判一套（迟早分叉）✗');
    } else if (!/\.has\(id\)/.test(titles)) {
      bad('Titles.equip 里没有"有没有拿到"的校验 —— 没拿到的称号也能戴上 ✗');
    } else {
      ok('佩戴只有一条判定（Titles.equip 校验已获得），指令与界面共用；界面只发动作包 ✓');
    }

    // ④ 协议：没有 targetUuid（"替别人戴"在协议层就不存在）
    if (!exists(NET)) {
      bad('缺 ' + NET + ' —— 界面点不了');
    } else {
      const net = strip(read(NET));
      if (/targetUuid|target|playerUuid|uuid/i.test(net.replace(/UUID/g, 'UUID'))) {
        // 只允许出现在注释里（strip 之后还出现就是真字段）
        bad(NET + ' 里出现了 target/uuid 字段 —— 佩戴必须只作用于发起者自己 ✗');
      } else if (!/record TitleActionPayload\(int action, String titleId\)/.test(net)) {
        bad('TitleActionPayload 的字段不是 (action, titleId) —— 协议被改宽了，请确认没有人能指定"替谁戴"');
      } else {
        ok('TitleActionPayload 只有 (action, titleId)：协议层就没有"替别人佩戴"这回事 ✓');
      }
      const modnet = strip(read(MODNET));
      const handler = /handleTitleAction\(TitleActionPayload payload[\s\S]*?\n    \}/.exec(modnet);
      if (!handler) {
        bad('ModNetwork 里找不到 handleTitleAction —— 动作包没人处理');
      } else if (!/context\.player\(\)/.test(handler[0])) {
        bad('handleTitleAction 没有只看 context.player() —— 它可能去改别人了 ✗');
      } else if (!/default\s*->/.test(handler[0])) {
        bad('handleTitleAction 没有 default 分支 —— 客户端自定义的动作会被接受（动作必须是白名单）✗');
      } else {
        ok('服务端处理只看 context.player()，且动作走白名单（default 直接忽略）✓');
      }
      // 服务端能回的错误码，客户端必须都有对应文案（跨文件契约）
      const codes = new Set([...handler[0].matchAll(/->\s*"([a-z_]+)"/g)].map((m) => m[1]));
      const missing = [...codes].filter((c) => !has2('gui.anglertackle.title_err_' + c));
      if (codes.size === 0) {
        bad('handleTitleAction 里一个错误码都没有？佩戴失败时界面将无话可说');
      } else if (missing.length) {
        bad('服务端会回这些错误码，但语言文件里没有对应文案（中/英）：' + missing.join('、'));
      } else {
        ok('服务端回的每个错误码都有中英文案（' + [...codes].join(' / ') + '）✓');
      }
    }

    // ⑤ 文字 / 尺寸 / 配色
    if (!/new TextWidget\(/.test(scr)) {
      bad('称号界面没有用 TextWidget —— 本机环境下 drawString 画出来是糊的'
        + '（docs/16 与 docs/29 都写了这条）✗');
    } else {
      const uses = ['UiLayout.panelW(', 'UiLayout.panelH(', 'UiLayout.rows(', 'UiLayout.fitText(']
        .filter((k) => !scr.includes(k));
      if (uses.length) bad('界面没用 ' + uses.join(' / ') + ' —— 小窗口会切内容（check-ui-fit.js 也会红）');
      else ok('文字走 TextWidget，面板/行数/截断走 UiLayout（四种窗口尺寸都装得下）✓');
    }
    // 品质色只走 Quality，且色号不许新起（与 check-mail.js 的既有色板**同一张表**）
    const KNOWN = ['0xFFFFD050', '0xFF8FCBF5', '0xFFE8E8E8', '0xFFB0B0B0', '0xFF909090',
      '0xFF243028', '0xF0000000', '0xFF5A6A60', '0xFF3A4A40', '0xFFFF5555', '0x40FFFFFF', '0x30000000'];
    const unknown = [...new Set([...scr.matchAll(/0x[0-9A-Fa-f]{8}/g)].map((m) => m[0]))]
      .filter((c) => !KNOWN.includes(c));
    if (!/TitleDefs\.byId\(/.test(scr) || !/Quality\.of\(/.test(scr)) {
      bad('界面的品质/颜色不是从 TitleDefs + Quality 取的 —— 手抄一份就会出现'
        + '"图鉴里金字、称号界面里白字"✗');
    } else if (unknown.length) {
      bad('界面里出现了既有色板之外的颜色码：' + unknown.join('、'));
    } else {
      ok('品质与颜色都走 TitleDefs + Quality，色号全部落在既有色板里 ✓');
    }

    // ⑥ 交互齐 + 三个入口
    //   ⚠ 判据盯**覆写签名**并把键位限定在方法体里（2026-10-12 从 check-mail.js 那边
    //   学来的那一条：只搜 `keyPressed(` 的话，把签名改名后方法体里的
    //   `super.keyPressed(...)` 还在 ⇒ 检查器照样绿 ✗ —— 负例 mail-no-keys 抓出来的）。
    const scrollFn = /public boolean mouseScrolled\([\s\S]*?\n    \}/.exec(scr);
    const keyFn = /public boolean keyPressed\([\s\S]*?\n    \}/.exec(scr);
    const clickFn = /public boolean mouseClicked\([\s\S]*?\n    \}/.exec(scr);
    const missing = [];
    if (!clickFn) missing.push('mouseClicked 覆写（点选）');
    if (!scrollFn) missing.push('mouseScrolled 覆写（滚轮翻页）');
    if (!keyFn) missing.push('keyPressed 覆写（键盘）');
    else {
      if (!/case 265/.test(keyFn[0])) missing.push('↑(265)');
      if (!/case 264/.test(keyFn[0])) missing.push('↓(264)');
      if (!/case 257/.test(keyFn[0]) && !/case 335/.test(keyFn[0])) missing.push('Enter(257/335)');
    }
    if (!/renderComponentTooltip\(/.test(scr)) missing.push('悬浮提示');
    if (missing.length) {
      bad('界面交互不齐 —— 缺：' + missing.join('、')
        + '（用户："所有功能必须做到点击交互"）');
    } else {
      ok('交互齐：点选 / 滚轮翻页 / ↑↓ / Enter 佩戴 / 悬浮提示 ✓'
        + '（判据限定在各自的覆写方法体里）');
    }
    if (!has2('gui.anglertackle.codex_titles')) {
      bad('缺 gui.anglertackle.codex_titles（中/英）—— 图鉴上那个按钮没有字');
    } else if (!new RegExp('TitleActionPayload\\.OPEN').test(strip(read(CODEX)))) {
      bad('图鉴里没有称号入口 —— 一个玩家最常打开的界面里找不到它，"发现得了"就还是没做到 ✗');
    } else {
      ok('入口②：图鉴上有「称号」按钮（只发 OPEN，服务端回快照才开界面）✓');
    }
    const got = String(zh['message.anglertackle.title_got'] || '');
    if (!got.includes('/atl title')) {
      bad('message.anglertackle.title_got 里没有告诉玩家去哪佩戴 —— '
        + '拿到称号那一刻是最好的发现时机（用户就是"拿到了却不知道去哪戴"）✗');
    } else if (!String(en['message.anglertackle.title_got'] || '').includes('/atl title')) {
      bad('英文的 title_got 少了同一句提示');
    } else {
      ok('入口③：第一次拿到称号时，聊天里那句提示就写着怎么佩戴 ✓');
    }
    // 空状态：**真的画了字**（不是空列表）
    const drawn = new Set();
    for (const m of scr.matchAll(
      /addText\([\s\S]{0,200}?"(gui\.anglertackle\.title_(?:empty_filter|empty_hint|loading))"/g)) {
      drawn.add(m[1]);
    }
    const missEmpty = ['gui.anglertackle.title_empty_filter', 'gui.anglertackle.title_empty_hint']
      .filter((k) => !drawn.has(k));
    if (missEmpty.length) {
      bad('空状态没有真的画出这几行字：' + missEmpty.join('、')
        + '（"只看已获得"点一下就是空列表 —— 空列表与"界面坏了"长得一模一样 ✗）');
    } else {
      ok('筛选后的空状态真的画了两行字（提示 + 怎么切回全部）✓');
    }

    // ⑦ 行格式两侧字段数一致（不一致的表现是"界面一片空白"，不报错 ✗）
    if (!exists(SNAPC)) {
      bad('缺 ' + SNAPC + ' —— 快照投影没了');
    } else {
      const snapSrc = strip(read(SNAPC));
      const bars = (snapSrc.match(/\+\s*'\|'\s*\+/g) || []).length + 1;   // 字段数
      const clientMin = /f\.length\s*<\s*(\d+)/.exec(scr);
      if (!clientMin) {
        bad('称号界面里没有字段数校验（`f.length < N`）—— 坏行会让下标越界');
      } else if (Number(clientMin[1]) !== bars) {
        bad('行格式两侧对不上：服务端写 ' + bars + ' 个字段，客户端按 ' + clientMin[1] + ' 个解析');
      } else {
        ok('行格式两侧字段数一致（各 ' + bars + ' 个）；投影只读 ✓');
      }
      if (/Titles\.(equip|unequip|grant)\(/.test(snapSrc)) {
        bad('TitleSnapshot（给客户端看的投影）里调了写操作 —— 投影必须只读 ✗');
      }
    }

    // ⑧ 退出世界清缓存
    const syncSrc = strip(read(SYNC));
    if (!/ClientTitles\.clear\(\)/.test(syncSrc)) {
      bad('退出世界时没有清 ClientTitles —— 换存档会先画上一个档的"已获得"状态 ✗');
    } else {
      ok('退出世界清掉称号缓存（换存档不会先闪一眼旧状态）✓');
    }

    // ⑨ 界面里用到的每个语言键都必须中英齐全（自带维护：写错一个键名就红）
    //   ⚠ 以 `_` 结尾的是**动态前缀**（`title_err_` + 服务端错误码），
    //   它的完整性由 ④ 那段"服务端每个错误码都要有文案"来守 —— 这里排除掉，
    //   否则会把自己拼出来的前缀当成一个缺键报红（踩过一次）。
    const keys = new Set([...scr.matchAll(/"(gui\.anglertackle\.title_[a-z_]+)"/g)]
      .map((m) => m[1]).filter((k) => !k.endsWith('_')));
    const noLang = [...keys].filter((k) => !has2(k));
    if (keys.size < 10) {
      bad('只认出 ' + keys.size + ' 个语言键 —— 界面文案的键名写法变了，这条断言失效了');
    } else if (noLang.length) {
      bad('界面用到但语言文件里缺（中/英）：' + noLang.join('、'));
    } else {
      ok('界面用到的 ' + keys.size + ' 个 gui 文案键中英齐全 ✓');
    }
  }
}

// ---------------------------------------------------------------- 折叠显示（`docs/39` §5.4）
//
// 用户 2026-10-13 定案："折叠成…优先显示本赛季称号，旁边会有一个可以展开的符号，
// 用来收录之前已经拥有的赛季称号。" 三件事都不能退化：
//   ① 默认**全收起**（不展开时观感跟以前一模一样）；
//   ② 组首是**最新一届**（= "本赛季优先"：称号是结算时发的，手里最新的那届就是本赛季的）；
//   ③ 点方框**只展开、不改选中**（误触不该把详情栏跳走）。
{
  const scr = read(TITLE_SCREEN);
  if (/groupKeyOf/.test(scr) && /isInstance\(id\)/.test(scr)) {
    ok('称号界面有折叠分组（静态 = 自己，实例 = 模板@规模 ⇒ 各届归一行）✓');
  } else {
    bad('称号界面没有折叠分组 —— 每拿一届就多一行，几十届以后列表会长得没法看');
  }
  if (/expandedGroups\.contains|expandedGroups\.add/.test(scr) && /private final java\.util\.Set<String> expandedGroups/.test(scr)
      && !/expandedGroups\.addAll|expandedGroups = new java\.util\.HashSet<>\(List/.test(scr)) {
    ok('展开状态默认是空的（**默认全收起**：不点就跟以前一样）✓');
  } else {
    bad('展开状态可能不是"默认全收起" —— 用户明确要求不展开时观感与现在一致');
  }
  // 组首 = 赛季号最大的那个（倒序排）
  if (/members\.sort\(\(a, b\) -> Integer\.compare\(TitleDefs\.seasonOf\(b\.id\),\s*TitleDefs\.seasonOf\(a\.id\)\)\)/.test(scr)) {
    ok('组内按赛季号倒序 ⇒ 组首就是最新那届（"本赛季优先"）✓');
  } else {
    bad('组内没有按赛季号倒序 —— 折叠后显示的可能是一年前的旧称号');
  }
  // 点击：先判展开符号、再落到"选行"
  // ⚠ 用"取方法体 + 比下标"而不是一条长正则：中间隔了多少行注释不该影响判定
  //   （第一版写成 [\s\S]{0,600}? 就被自己的注释撑爆了）
  const clickBody = (/public boolean mouseClicked\(double mx, double my, int button\) \{[\s\S]*?\n    \}/.exec(scr) || [''])[0];
  const iMarker = clickBody.indexOf('overMarker(mx, my, i)');
  const iSelect = clickBody.indexOf('selectIndex(i)');
  if (iMarker >= 0 && iSelect > iMarker) {
    ok('点方框只展开/收起，**不改选中**（误触不会把详情栏跳走）✓');
  } else {
    bad('鼠标点击里没有先判展开符号 —— 点方框会连带换掉选中项'
      + '（iMarker=' + iMarker + ' iSelect=' + iSelect + '）');
  }
  // 收起时若选着往年那行，选中要挪回组首（否则详情栏空掉）
  if (/if \(!open && groupKeyOf\(selectedId\)\.equals\(r\.groupKey\)\)/.test(scr)) {
    ok('收起时把选中的"往年"挪回组首（详情栏不会突然空掉）✓');
  } else {
    bad('收起时没处理"正选着往年那行" —— 详情栏会空掉，看着像界面坏了');
  }
}

// ---------------------------------------------------------------- 商店的联赛货架（称号名的第 5 个渲染点）
//
// 2026-10-13 用户截图发现：商店「联赛」页那条纪念称号**显示成 `S%s%s联赛纪念`** ——
// 渲染时**没把参数传进去**，占位符被原样画了出来。这条断言守的就是"必须带参数"。
{
  const shop = read(SHOP_SCREEN);
  if (shop === null) {
    bad('找不到商店界面（称号名在商店里也有一处渲染）');
  } else {
    const withArgs = /translatable\("title\.anglertackle\." \+ o\.titleTemplate\(\), season,/.test(shop);
    const withoutArgs = /translatable\("title\.anglertackle\." \+ o\.titleTemplate\(\)\)\s*\.getString\(\)/.test(shop);
    if (withArgs && !withoutArgs) {
      ok('商店的联赛货架把**届号与规模**传给了称号模板 ✓（不会把 %s 画出来）');
    } else {
      bad('商店的联赛货架没给称号模板传参数 —— 那一行会把 %s%s 原样画出来'
        + '（2026-10-13 用户截图发现的那条 bug）');
    }
  }
}

// ---------------------------------------------------------------- J. 头顶名牌显示称号（`docs/38` §2.1）
//
// 用户 2026-10-13 原话："需要让玩家在他人显示视角里看到名字后有已经佩戴的称号。"
// 形态 = `名字[称号]`，与聊天同一套括号、同一个品质色。
//
// 这一组守的每一条坏法都**不报错**，只是"别人看不到 / 看到了不该看的"：
//   ① 包注册成了双向 / 没走 enqueueWork ⇒ 网络线程直接碰客户端缓存（每帧读的那张表）；
//   ② 处理器挂在服务端 dist / 不用 setContent ⇒ 名牌压根不会变（或两边都挂错）；
//   ③ 去掉"认不出就不画"的早退 ⇒ 客户端版本不一致时把 `%s` 或语言键画到别人头顶；
//   ④ equip / unequip 有一处忘了广播 ⇒ 戴上别人立刻看到、摘下要等下一次广播（几分钟）；
//   ⑤ 进服不发 / 退服不带 skip ⇒ 晚进来看不到先来的人；退房那位的称号赖在别人屏幕上；
//   ⑥ 退出世界不清缓存 ⇒ 换存档先闪上一个档的称号（玩家会当成"新档里我已有这个称号"）；
//   ⑦ 广播时把"已经失去的称号"也发出去 ⇒ 头顶挂着一个玩家不该有的称号（与聊同一口径）。
{
  const PAYLOAD = 'src/main/java/com/whitecobalt/anglertackle/network/TitleNameplatePayload.java';
  const CACHE = 'src/main/java/com/whitecobalt/anglertackle/client/ClientNameplates.java';
  const RENDER = 'src/main/java/com/whitecobalt/anglertackle/client/TitleNameplateEvents.java';
  const SYNCF = 'src/main/java/com/whitecobalt/anglertackle/event/TitleNameplateSync.java';
  const MODNET = 'src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java';
  const HANDLERS = 'src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java';
  const SYNC = 'src/main/java/com/whitecobalt/anglertackle/event/CoinSyncEvents.java';

  if (!exists(PAYLOAD) || !exists(CACHE) || !exists(RENDER) || !exists(SYNCF)) {
    bad('缺名牌那一套新文件（TitleNameplatePayload / ClientNameplates / TitleNameplateEvents / TitleNameplateSync）'
      + ' —— 用户 2026-10-13 要的"别人看得到称号"没落地 ✗');
  } else {
    const payload = strip(read(PAYLOAD));
    const cache = strip(read(CACHE));
    const render = strip(read(RENDER));
    const syncF = strip(read(SYNCF));
    const modnet = strip(read(MODNET));
    const handlers = strip(read(HANDLERS));

    // ① 包只在**客户端**注册（playToClient），且处理器走 enqueueWork；
    //    绝不许有 playToServer —— "客户端只能说我想要什么"那条纪律（佩戴判定只在服务端）。
    const regOk = /registrar\.playToClient\(TitleNameplatePayload\.TYPE/.test(handlers);
    const regBad = /registrar\.playToServer\(TitleNameplatePayload\.TYPE/.test(handlers);
    const handleFn = /private static void handleNameplates\([\s\S]*?\n    \}/.exec(handlers);
    if (!regOk) {
      bad('TitleNameplatePayload 没有注册成 playToClient —— 客户端收不到这张表，名牌永远是光名字 ✗');
    } else if (regBad) {
      bad('TitleNameplatePayload 注册了 playToServer —— 客户端能回写称号，服务端权威那条纪律破了 ✗');
    } else if (!handleFn || !/context\.enqueueWork\(/.test(handleFn[0])) {
      bad('handleNameplates 没走 enqueueWork —— 这张表是渲染线程每帧读的，'
        + '在网络线程上换表可能读到换到一半的状态（同鱼币/积分那条纪律）');
    } else {
      ok('名牌包只注册在客户端、且走 enqueueWork（与鱼币/积分同一纪律）✓');
    }
    // 覆盖式缓存：整表必须先清再装（合并会让"服务端已删掉的玩家"永远留下）
    if (/TITLES\.clear\(\);[\s\S]{0,80}?TITLES\.putAll\(next\)/.test(cache)) {
      ok('客户端缓存是覆盖式（先清再装）—— 服务端删掉的人不会赖在别人屏幕上 ✓');
    } else {
      bad('ClientNameplates.accept 不是"先清再装" —— 增量合并会让退房/摘称号的玩家永远留在表里 ✗');
    }

    // ② 渲染处理器：挂在 Dist.CLIENT、用 setContent、只对玩家生效
    const onTag = /public static void onNameTag\(RenderNameTagEvent event\) \{[\s\S]*?\n    \}/.exec(render);
    if (!/@EventBusSubscriber\([^)]*value\s*=\s*Dist\.CLIENT/.test(render)) {
      bad('TitleNameplateEvents 没有挂在 Dist.CLIENT —— 渲染事件只存在于逻辑客户端，挂错等于没挂 ✗');
    } else if (!onTag || !/event\.setContent\(/.test(onTag[0])) {
      bad('名牌处理器没有调 setContent —— 不换内容，称号永远不会出现在别人眼前 ✗');
    } else if (!/event\.getEntity\(\) instanceof Player/.test(onTag[0])) {
      bad('名牌处理器没有"只对玩家生效"的早退 —— 会给动物/展示框也拼一遍（纯浪费，且容易踩到非玩家实体）');
    } else {
      ok('渲染处理器挂在 Dist.CLIENT、用 setContent 换内容、只对玩家生效 ✓');
    }

    // ③ 认不出的 id 必须**在 setContent 之前** return（绝不把 %s / 语言键画到头顶）
    if (!onTag) {
      bad('找不到 onNameTag 方法体 —— 这条断言失效了，请更新检查器');
    } else {
      const iUnknown = onTag[0].indexOf('TitleDefs.byId(id) == null && !TitleDefs.validInstance(id)');
      const iContent = onTag[0].indexOf('event.setContent(');
      const seg = iUnknown >= 0 && iContent > iUnknown ? onTag[0].slice(iUnknown, iContent) : '';
      if (iUnknown < 0) {
        bad('名牌处理器里没有"认不出就不画"的判定 —— 客户端版本不一致时会把语言键画到别人头顶 ✗');
      } else if (iContent < iUnknown) {
        bad('"认不出"的判定排在了 setContent 后面 —— 那时候字已经画出去了，return 也来不及 ✗');
      } else if (!/return;/.test(seg)) {
        bad('"认不出"的判定后面没有 return —— 判了等于没判，照样往下画 ✗');
      } else {
        ok('认不出的称号 id 在画出去之前就 return（绝不把 %s / 语言键画到头顶）✓');
      }
    }

    // ④ 佩戴的两个入口（equip / unequip）都必须广播，且广播排在写数据之后
    const equipFn = /public static EquipResult equip\(ServerPlayer player, String id\) \{[\s\S]*?\n    \}/.exec(titles);
    const unequipFn = /public static EquipResult unequip\(ServerPlayer player\) \{[\s\S]*?\n    \}/.exec(titles);
    const bcastCount = (titles.match(/broadcastNameplates\(/g) || []).length;
    if (bcastCount !== 2) {
      bad('Titles.java 里广播名牌的调用点有 ' + bcastCount + ' 处（应为 2：equip / unequip 各一）'
        + ' —— 少一处就是"戴上别人立刻看到、摘下要等下一次广播"✗');
    } else if (!equipFn || !/withEquipped\(id\)/.test(equipFn[0])
        || equipFn[0].indexOf('broadcastNameplates(') < equipFn[0].indexOf('withEquipped(id)')) {
      bad('equip 里广播排在写数据之前（或没广播）—— 别人可能收到一张还没有他的旧表 ✗');
    } else if (!unequipFn || !/withEquipped\(""\)/.test(unequipFn[0])
        || unequipFn[0].indexOf('broadcastNameplates(') < unequipFn[0].indexOf('withEquipped("")')) {
      bad('unequip 里广播排在写数据之前（或没广播）—— 摘下称号后别人的屏幕上还挂着旧称号 ✗');
    } else {
      ok('equip / unequip 各广播一次，且都排在写数据之后（戴上摘下别人都立刻看到）✓');
    }

    // ⑤ 进服 / 退服都广播；退服**带 skip**；skip 真生效；只发"现在仍然拥有"的
    const loginFn = /public static void onLogin\([\s\S]*?\n    \}/.exec(syncF);
    const logoutFn = /public static void onLogout\([\s\S]*?\n    \}/.exec(syncF);
    const twoArg = /public static void broadcastNameplates\(net\.minecraft\.server\.MinecraftServer server,\s*java\.util\.UUID skip\) \{[\s\S]*?\n    \}/.exec(modnet);
    const oneArg = /public static void broadcastNameplates\(net\.minecraft\.server\.MinecraftServer server\) \{[\s\S]*?\n    \}/.exec(modnet);
    if (!loginFn || !/broadcastNameplates\(sp\.server\)/.test(loginFn[0])) {
      bad('进服没有广播名牌整表 —— 晚进来的人看不到先来的人头上的称号（要等别人换一次佩戴）✗');
    } else if (!logoutFn || !/broadcastNameplates\(sp\.server,\s*sp\.getUUID\(\)\)/.test(logoutFn[0])) {
      bad('退服没有带 skip 广播 —— 原版是先发事件后移出列表，'
        + '不跳过的话退房那位的称号会赖在别人屏幕上直到下一次广播 ✗');
    } else if (!twoArg || !/skip != null && skip\.equals\(p\.getUUID\(\)\)/.test(twoArg[0])
        || !/continue;/.test(twoArg[0])) {
      bad('broadcastNameplates 的 skip 参数没有真正跳过那个人 —— 传了等于没传 ✗');
    } else if (!oneArg || !/broadcastNameplates\(server, null\)/.test(oneArg[0])) {
      bad('单参版没有转调双参版（server, null）—— 两套入口迟早分叉 ✗');
    } else if (!/!t\.has\(id\)/.test(twoArg[0])) {
      bad('广播时没有校验"现在仍然拥有" —— 已经失去的称号也会被画到头顶（与聊天的口径分叉）✗');
    } else {
      ok('进服/退服都广播（退服带 skip 且真跳过），只发现在仍拥有的称号 ✓');
    }

    // ⑥ 退出世界清缓存（不清 ⇒ 换存档先闪上一个档的称号）
    if (!/ClientNameplates\.clear\(\)/.test(strip(read(SYNC)))) {
      bad('退出世界时没有清 ClientNameplates —— 进下一个存档的第一眼会给别人挂上一个档的称号 ✗');
    } else {
      ok('退出世界清掉名牌缓存（换存档不会先闪一眼旧档的称号）✓');
    }

    // 包的基本形状：整表 + 两个分隔符（uuid/称号 id 里都不可能出现的字符）
    if (!/LINE_SEP|FIELD_SEP/.test(payload)) {
      bad('TitleNameplatePayload 里看不到分隔符常量 —— 格式散着写，两端迟早对不上 ✗');
    }
  }
}

console.log('');
if (fail) {
  console.log('❌ 称号系统检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 称号系统检查通过');