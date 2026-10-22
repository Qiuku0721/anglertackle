/*
 * check-ice-fishing.js —— 守住冰钓的四条数值链（用户 2026-10-08 拍板，docs/33 §8）。
 *
 * 这一批的数值全是**乘在既有链子上**的（咬钩时间、金红总占比、鱼线磨损），
 * 所以出错的形态都是**静默**的：
 *   · ×1.5 挂在"已经被别的东西算过的"变量上 → 数值不对但游戏照跑；
 *   · 单位搞错（0.01 直接加到"百分数"上）→ +1% 变成 +0.01%，等于没加，还查不出来；
 *   · 判据散成三份（咬钩时间认了 tag、爆率没认）→ 只错一半，玩家只会觉得"冰上钓鱼怪怪的"。
 *
 * 用法：node tools/check-ice-fishing.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { stripComments } = require('./java-source.js');

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 冰钓数值链检查 ===\n');

const GEN = read('tools/gen-gameplay-config.js');
const ICE = stripComments(read(
  'src/main/java/com/whitecobalt/anglertackle/fishing/IceFishing.java'));
const SESS = stripComments(read(
  'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java'));
const WATER = stripComments(read(
  'src/main/java/com/whitecobalt/anglertackle/fishing/WaterBody.java'));

// ---------------------------------------------------------------- ① 七个配置项
// 表见 docs/33 §8.6。键名/默认值错了都不报错，只是"调参器里那个旋钮没用"。
const KEYS = [
  ['brokenIceToPackIceMinutes', 5], ['packIceToIceMinutes', 10],
  ['icePickDurabilityCost', 1], ['iceHoleLineWearMultiplier', 2.0],
  ['iceHoleHighValueBonus', 0.01], ['openIceBiteTimeMultiplier', 1.5],
  ['openIceHighValuePenalty', 0.01],
];
{
  const miss = [], wrong = [];
  for (const [k, v] of KEYS) {
    const m = new RegExp("key: '" + k + "'[\\s\\S]{0,200}?def:\\s*([0-9.]+)").exec(GEN);
    if (!m) { miss.push(k); continue; }
    if (Number(m[1]) !== v) wrong.push(k + '（登记 ' + m[1] + '，docs/33 §8.6 是 ' + v + '）');
  }
  if (miss.length) no('生成器里缺这些冰钓配置项：' + miss.join(', '));
  if (wrong.length) no('默认值与策划案不一致：' + wrong.join(' / '));
  if (!miss.length && !wrong.length) ok('7 个配置项的键名与默认值都与 docs/33 §8.6 一致');
}
// ★ 反向断言：**不许有"冰洞回冻"配置项** —— 用户 2026-10-08 定案"冰洞不会回冻"。
//   以后谁手滑加一个，这里必须红（否则就是悄悄推翻了用户的定案）。
if (/iceHole(Refreeze|FreezeBack|Refrost)/i.test(GEN)) {
  no('出现了"冰洞回冻"相关的配置项 —— 用户定案是**不会回冻**，这条得先问过他');
} else ok('没有"冰洞回冻"配置项（用户定案：冰洞永久存在 ✓）');

// ---------------------------------------------------------------- ② 判据只有一份
if (/public static boolean iceFishingBiome\(/.test(WATER)) {
  ok('WaterBody 提供了 iceFishingBiome（"非高山且覆冰"的布尔版）');
} else no('WaterBody 没有 iceFishingBiome —— 判据会散到各处');
if (/biome\.is\(IS_ICE_FISHING\)\s*&&\s*!biome\.is\(IS_ALPINE\)/.test(WATER)) {
  ok('"非高山"这条排除写在代码里（JSON 标签表达不了"不在某标签里"）');
} else no('iceFishingBiome 里没有"且不在 alpine" —— 高山覆冰群系会误生效');
if (/WaterBody\.iceFishingBiome\(level, pos\)/.test(ICE)) {
  ok('IceFishing 复用了 WaterBody.iceFishingBiome（不是自己再拼一份 tag 判断）');
} else no('IceFishing 没有复用 WaterBody.iceFishingBiome —— 同一个判断散在两处，改一处漏一处');

// ---------------------------------------------------------------- ③ 咬钩时间
if (/IceFishing\.biteTimeMultiplier\(/.test(SESS)) {
  ok('beginWaiting 里接了咬钩时间倍率');
} else no('beginWaiting 没接 IceFishing.biteTimeMultiplier —— 覆冰群系不延长咬钩等待');
if (/Tuning\.openIceBiteTimeMultiplier\(\)/.test(ICE)) {
  ok('倍率取自配置项 openIceBiteTimeMultiplier（调参器可热改）');
} else no('倍率没有读配置项 —— 写死的话调参器改了没反应');
// 洞内**不变**：里面必须有一条"在洞里就 return 1.0"的早退
if (/inIceHole\(level, pos\)\)\s*\{\s*return 1\.0;/.test(ICE.replace(/\s+/g, ' '))) {
  ok('洞内咬钩时间不变（用户定案：洞口内不延长）');
} else no('咬钩时间没有"洞内不变"的早退 —— 洞里也会被延长 50%');

// ---------------------------------------------------------------- ④ 金红总占比
// ⚠ 两个口径坑：单位换算（0.01 → 1 个百分点）与"只在饵料确实在控占比时才动"。
// ⚠ 这条断言第一版写的是 `/iceHvDelta \* 100\.0/` —— **太宽**：下面那行日志里
//   也有同样的 `iceHvDelta * 100.0`，于是"把计算行的 ×100 删掉"这个负例照样绿（假绿，
//   是负例 ice-hv-unit 抓出来的）。判据必须锚在**赋值**上。
if (/hvPct \+ iceHvDelta \* 100\.0/.test(SESS)) {
  ok('金红占比按**百分点**换算（配置是 0.01 比例，hvPct 是"10 = 10%"的百分数）');
} else no('没有 `hvPct + iceHvDelta * 100.0` —— 配置 0.01 会当成 0.01 个百分点加，等于没加');
if (/iceHvDelta != 0\.0 && hvPct > 0/.test(SESS)) {
  ok('只在 hvPct > 0（饵料确实在控占比）时才加，不会把路亚的"不调占比"变成"强行 1%"');
} else no('缺少 hvPct > 0 的守卫 —— 会把路亚的"不调占比"变成"强行 1%"（性质变了）');
if (/IceFishing\.highValueDelta\(/.test(SESS)) ok('会话里接了 IceFishing.highValueDelta');
else no('会话没接 IceFishing.highValueDelta —— ±1% 不生效');

// ---------------------------------------------------------------- ⑤ 线损只乘线
if (/public static double lineWearMultiplier\(/.test(ICE)) {
  ok('IceFishing 提供了 lineWearMultiplier（**只乘鱼线**，用户定案）');
} else no('没有 lineWearMultiplier');
if (/IceFishing\.lineWearMultiplier\(/.test(SESS)) {
  ok('会话的"咬钩扣耐久"里接了线损倍率');
} else no('会话没接 lineWearMultiplier —— 洞内线损 ×2 不生效');
// ★ 反向断言：**竿的损耗那一段不许出现冰钓倍率**（用户明确"只加鱼线，竿不加"）。
//   这条要防的是"顺手把倍率乘到整个耐久链上" —— 那种错会让竿也寿命减半，
//   而玩家只会觉得"我的竿怎么坏得这么快"，极难联想到冰洞。
// ⚠ 锚点必须用**代码**、不能用注释：SESS 是 stripComments 过的，
//   第一版用注释里的"---- 2. 再改鱼竿本体 ----"当锚点 → 永远解析不出来（自己抓自己）。
{
  const rodSeg = /duraCfg\.rodDurabilityPerBite\.get\(\)([\s\S]{0,900}?)this\.lastBiteCost/.exec(SESS);
  if (!rodSeg) no('解析不出"再改鱼竿本体"那一段 —— 这条反向断言失效了，先修它');
  else if (/IceFishing\./.test(rodSeg[1])) {
    no('**鱼竿**的损耗里出现了 IceFishing 调用 —— 用户定案线损只加鱼线、竿不加');
  } else ok('鱼竿损耗那一段没有冰钓倍率（只加鱼线 ✓）');
}

// ---------------------------------------------------------------- ⑦ 方块与凿冰镐
const PICK = stripComments(read('src/main/java/com/whitecobalt/anglertackle/item/IcePickItem.java'));
const HOLE_B = stripComments(read('src/main/java/com/whitecobalt/anglertackle/block/IceHoleBlock.java'));
const BROKEN_B = stripComments(read('src/main/java/com/whitecobalt/anglertackle/block/BrokenIceBlock.java'));
const PACK_B = stripComments(read('src/main/java/com/whitecobalt/anglertackle/block/PackIceBlock.java'));

// ① 四种冰都能凿出洞（少一种就是"某种冰凿不动"，玩家只会以为那方块不能用）
{
  const four = ['ICE', 'PACKED_ICE', 'BLUE_ICE', 'FROSTED_ICE'];
  const miss = four.filter((b) => !new RegExp('Blocks\\.' + b + '\\b').test(PICK));
  if (miss.length) no('凿冰镐少认了这些冰：' + miss.join(', ') + '（那种冰凿不出洞，且不报错）');
  else ok('凿冰镐认全部四种冰（ice / packed_ice / blue_ice / frosted_ice）');
}
if (/state\.getBlock\(\) instanceof IceHoleBlock/.test(PICK)) ok('右键冰洞 → 砸成碎冰 ✓');
else no('凿冰镐没有"冰洞 → 碎冰"这一支');
if (/return InteractionResult\.PASS;/.test(PICK)) ok('碎冰/浮冰/别的方块：无效果（防刷 ✓）');
else no('凿冰镐对非冰方块没有 PASS 分支 —— 可能到处乱凿');
if (/IceFishing\.icePickCost\(\)/.test(PICK) && /hurtAndBreak/.test(PICK)) {
  ok('每次凿扣 icePickDurabilityCost 点耐久');
} else no('凿冰不扣耐久（或扣的数没走配置项）');

// ② 状态机三段 + **冰洞不回冻**（用户定案）
if (/scheduleTick\(pos, this, IceFishing\.brokenIceToPackIceTicks\(\)\)/.test(BROKEN_B)) {
  ok('碎冰放置时按 brokenIceToPackIceMinutes 排下一形态');
} else no('碎冰没有按配置排"碎冰 → 浮冰"');
if (/ModBlocks\.PACK_ICE\.get\(\)\.defaultBlockState\(\)/.test(BROKEN_B)) ok('碎冰到点变浮冰 ✓');
else no('碎冰的 tick 没有换成浮冰');
if (/scheduleTick\(pos, this, IceFishing\.packIceToIceTicks\(\)\)/.test(PACK_B)) {
  ok('浮冰放置时按 packIceToIceMinutes 排"浮冰 → 冰"');
} else no('浮冰没有按配置排"浮冰 → 冰"');
if (/Blocks\.ICE\.defaultBlockState\(\)/.test(PACK_B)) ok('浮冰到点变回原版冰 ✓（于是还能再凿）');
else no('浮冰的 tick 没有变回原版冰');
// ★★ 用户 2026-10-08 定案"**冰洞不会回冻**"：所以 IceHoleBlock 里**不许**有调度/ tick。
if (/scheduleTick|\btick\s*\(/.test(HOLE_B)) {
  no('IceHoleBlock 里出现了 scheduleTick/tick —— 用户定案"冰洞不会回冻"，这条是明确推翻过的设计');
} else ok('冰洞不排回冻调度（用户定案 ✓）');

// ③ inIceHole 真的接上了方块
if (/instanceof IceHoleBlock/.test(ICE)) ok('inIceHole 认的是真方块（不是恒 false 的占位）');
else no('inIceHole 没有认冰洞方块 —— 洞内三条数值都不生效');

// ---------------------------------------------------------------- ⑧ 精准入洞 + 洞内的群系门槛
const ROD = stripComments(read('src/main/java/com/whitecobalt/anglertackle/item/RodItem.java'));
const MGR = stripComments(read('src/main/java/com/whitecobalt/anglertackle/fishing/FishingManager.java'));

// ★★ 用户 2026-10-08 当场纠正过的一条：洞里给 M_POLAR **必须同时**要求群系在覆冰名单里。
//   只有洞的话，"把冰运到平原挖个洞就能钓北极鳕" ✗ —— 这是用户明确否掉的设计。
if (/inIceHole\([\s\S]{0,200}?&&\s*WaterBody\.iceFishingBiome\(/.test(SESS)) {
  ok('洞内按极地水判定时**同时要求群系在覆冰名单里**（运冰到温带钓不到极地鱼 ✓）');
} else no('洞里无条件给 M_POLAR —— "把冰运到平原挖个洞"就能钓极地鱼（用户明确否掉过）');
// 反向：那句 M_POLAR 只许出现在这一处带群系门槛的分支里（别处再冒一个无条件的就是漏网）
{
  const hits = (SESS.match(/M_POLAR/g) || []).length;
  if (hits !== 1) no('会话里 M_POLAR 出现了 ' + hits + ' 次 —— 只该有"洞内且覆冰群系"这一处');
  else ok('M_POLAR 只在"洞内 + 覆冰群系"那一处出现 ✓');
}

// 精准入洞：右键冰洞 → 直接放浮漂（用户实测"准心对准也投不进去"，所以必须走独立落点）
if (/public net\.minecraft\.world\.InteractionResult useOn\(/.test(ROD)
    && /instanceof com\.whitecobalt\.anglertackle\.block\.IceHoleBlock/.test(ROD)
    && /castIntoIceHole\(/.test(ROD)) {
  ok('鱼竿右键冰洞 → 走精准入洞（不再走抛物线）');
} else no('鱼竿右键冰洞没有接精准入洞 —— 一格宽的洞靠抛物线瞄基本投不进去（用户实测过）');
if ((ROD.match(/InteractionResult\.PASS/g) || []).length >= 2) {
  ok('非冰洞的右键仍然 PASS 给原来的蓄力/收线逻辑 ✓');
} else no('useOn 没给非冰洞留 PASS 分支 —— 会把普通右键吃掉（蓄力/收线全废）');
if (/public void castIntoIceHole\(ServerPlayer player/.test(MGR)
    && /session\.castIntoIceHole\(level, hole\)/.test(MGR)) {
  ok('FishingManager 复用了同一套前置检查（已有会话 / 竿破损 / 服务端）');
} else no('castIntoIceHole 没有复用前置检查 —— 可能出现"破损竿也能入洞"这种漏判');

// ★★ 用户 2026-10-08 的**第二次**纠正："它的 buff 只在那种群系生效，不在就只生效线损耗"。
//   所以爆率加成那条函数**第一件事就是查群系**：不在覆冰名单里 → 直接 0（只剩线损 ×2）。
//   没有这道门槛的话，"把冰运到温带"就能白拿 +1% 爆率 ✗
if (/!\s*WaterBody\.iceFishingBiome\(level,\s*pos\)\s*\)\s*\{\s*return 0\.0;/.test(ICE)) {
  ok('爆率加成带群系门槛：出了覆冰群系就只剩线损（用户："不在就只生效线损耗"）✓');
} else no('爆率加成没有群系门槛 —— 把冰运到温带就能白拿 +1%（用户明确否掉）');

// ---------------------------------------------------------------- ⑥ 档位口径
// ⚠ "+1%" 是加在**占比**上的，不是加在档位上。历史上这条链出过两次事故
//   （tier >= 6 永不满足 / 1 起算整体差一档），所以这里反向断言一句。
if (/partTier\(\)|equippedBaitTier|Tier\s*[+-]/.test(ICE)) {
  no('IceFishing 里出现了档位相关的运算 —— 冰钓只碰"占比/时间/磨损"，不碰档位（AGENTS.md §2）');
} else ok('IceFishing 不碰档位（只动占比 / 时间 / 磨损），不踩 AGENTS.md §2 那条线');

// ---------------------------------------------------------------- ⑨ "记作 12 米"必须活到上钩那一刻
//
// ⚠ 用户 2026-10-08 报的 bug："**钓鱼在冰洞上钩后依旧显示 6 米左右**"。
//   根因不是没设 12 米，而是它**被后来的一步冲掉了**：
//     castIntoIceHole() 设 castDistance = IceFishing.iceHoleCastDistance()（12 米）
//     → beginWaiting() 末尾**无条件**执行
//        castDistance = player.position().distanceTo(bobber.position())
//       而洞就在脚边（真实距离约 6 米）⇒ 上钩时又变回 6 米 ✗。
//   所以这一节守的不是"有没有 12 米"，而是"**它有没有活到最后**"：
//   覆盖那一行必须带 !iceHoleCast 的门槛，且两条普通抛投路径要把标记清掉。
{
  const hasSet = /castDistance\s*=\s*IceFishing\.iceHoleCastDistance\(\)/.test(SESS);
  const hasFlag = /this\.iceHoleCast\s*=\s*true/.test(SESS);
  if (hasSet && hasFlag) ok('精准入洞：记作 IceFishing.iceHoleCastDistance() 并打上 iceHoleCast 标记');
  else no('castIntoIceHole 没有同时设 12 米与 iceHoleCast 标记（12 米会被 beginWaiting 冲掉）');

  // 关键一条：覆盖必须被门槛挡住
  const guarded = /if\s*\(\s*!\s*this\.iceHoleCast\s*\)\s*\{\s*this\.castDistance\s*=\s*this\.player\.position\(\)\.distanceTo\(/.test(SESS);
  const bare = /^\s*this\.castDistance\s*=\s*this\.player\.position\(\)\.distanceTo\(/m.test(SESS);
  if (guarded) ok('beginWaiting 的"按真实距离重算"带 iceHoleCast 门槛（冰洞的 12 米不会被 6 米覆盖 ✓）');
  else if (bare) no('beginWaiting 里那句 castDistance 重算**没有门槛** —— 冰洞上钩后会变回真实距离（约 6 米），正是用户报的 bug');
  else no('找不到 beginWaiting 里的 castDistance 重算 —— 检查器需要跟着代码改');

  // 两条普通抛投路径必须把标记清掉，否则"先精准入洞、再手抛"会一直按 12 米算
  const clears = (SESS.match(/this\.iceHoleCast\s*=\s*false/g) || []).length;
  if (clears >= 2) ok('两条普通抛投路径（castProjectile / cast）都清了 iceHoleCast 标记');
  else no('只有 ' + clears + ' 处 iceHoleCast = false —— 手抛那一竿会被上一竿的"冰洞"状态污染');
}

console.log(bad === 0 ? '\n✅ 冰钓数值链接线正确' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
