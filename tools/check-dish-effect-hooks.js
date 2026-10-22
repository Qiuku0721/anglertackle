/*
 * check-dish-effect-hooks.js —— 11 项菜型效果的**行为**守门人（docs/28 §3 / §6）。
 *
 * 与 check-dish-effects.js 的分工：
 *   那个管"吃菜给哪个效果、几级、多久"（注册 / 图标 / 语言键 / 映射 / 互斥）；
 *   这个管"效果拿到之后到底做了什么" —— 也就是 §6 里最后四行 ⏳。
 *
 * 为什么需要它：行为层的错法**全都不报错、也不崩**，只是效果白拿：
 *   ① 数值漂移：渔运写成 +3%（相对）而不是 +3 个百分点 → 低档饵上几乎看不出，
 *      红饵上又变成 +30%，而日志里只显示"渔运 2 级"，谁都不会发现；
 *   ② **加成位置错**：爆口/空军乘在"解金红占比 k"之前，会被 k 原样除回去
 *      （净效果恰好为零）；乘在取整之后，3×1.05 = 3 也是一分不加；
 *   ③ 渔运在 `hvTargetPct < 0`（路亚/低档饵）时直接加成 → 把原本 20%+ 的金红占比
 *      **压到 3%**，吃了红烧鱼反而钓不到金红鱼；
 *   ④ 属性修饰符用 `addPermanentModifier` → 修饰符进存档，效果到期后永久加速；
 *   ⑤ 明目扫未加载区块（`getBlockState` 不看 `hasChunkAt`）→ 一路强加载，卡服；
 *   ⑥ 效果只在 `apply()` 里注册、**没有任何消费点** → 玩家吃了菜什么都没发生。
 *
 * 断言：
 *   A. 11 项数值与 docs/28 §3 表格逐条一致（源码常量 ↔ 文档数字，双向）
 *   B. 钓获类四条真的接进了钓鱼链：渔运/爆口/空军进 `FishSpecies.roll`，巨物猎手进回拉
 *   C. 爆口/空军的加成位置（解 k 之后、取整之前）与"两条入口"都在源码里看得见
 *   D. 战斗类挂在 `LivingIncomingDamageEvent` 上，且强力只认弹射物
 *   E. 生存/水下类挂在 `PlayerTickEvent.Post` 上，属性修饰符必须是**瞬态**；
 *      **水下加速必须走 SWIM_SPEED**（2026-10-03 用户实测："视野缩放变了但移速没变"）
 *   F. 明目改成"服务端报坐标 + 客户端画线"（不许再发粒子），且不碰未加载区块
 *   G. docs/28 §6 的进度表与代码状态一致（双向：⏳ ↔ 没有消费点）
 *
 * 用法：node tools/check-dish-effect-hooks.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 菜型效果行为检查（docs/28 §3 的 11 项到底做了什么）===\n');

const HOOKS = 'src/main/java/com/whitecobalt/anglertackle/effect/DishEffectHooks.java';
const SPECIES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';
const SESSION = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java';
const PAYLOAD = 'src/main/java/com/whitecobalt/anglertackle/network/OreSightPayload.java';
const CLIENT_STATE = 'src/main/java/com/whitecobalt/anglertackle/client/ClientOreSight.java';
const RENDERER = 'src/main/java/com/whitecobalt/anglertackle/client/render/OreSightRenderer.java';
const PAYLOAD_HANDLERS = 'src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java';
const DOC = 'docs/28-菜型效果策划.md';

for (const p of [HOOKS, SPECIES, SESSION, PAYLOAD, CLIENT_STATE, RENDERER, PAYLOAD_HANDLERS, DOC]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}
const hooks = read(HOOKS);
const species = read(SPECIES);
const session = read(SESSION);
const renderer = read(RENDERER);
const clientState = read(CLIENT_STATE);
const handlers = read(PAYLOAD_HANDLERS);
const doc = read(DOC);

// ---------------------------------------------------------------- A 数值口径 ↔ docs/28 §3
// 每一项：[常量名, 期望值, 文档里必须出现的写法（用户定案的数字）]
const NUMBERS = [
  ['LUCK_POINTS_PER_LEVEL', 3.0, '+3 个百分点**'],
  ['RANGED_DAMAGE_PER_LEVEL', 0.15, '**+15%**'],
  ['OCEAN_SPEED_PER_LEVEL', 0.25, '+25%'],
  ['STORM_DAMAGE_PER_LEVEL', 0.20, '**+20%**'],
  ['STORM_SPEED_PER_LEVEL', 0.25, '+25%'],
  ['VITALITY_REGEN_PER_LEVEL', 0.25, '**+25%**'],
  ['BITE_WEIGHT_PER_LEVEL', 0.05, '**+5%**'],
  ['BITE_THRESHOLD_KG', 5.0, '门槛 **5 kg**'],
  ['GIANT_PULL_PER_LEVEL', 0.20, '**+20%**'],
  ['GIANT_MIN_TIER', 4, '金品质以上'],
];
{
  const drift = [];
  for (const [name, want, docText] of NUMBERS) {
    const m = hooks.match(new RegExp('(?:double|int) ' + name + '\\s*=\\s*([0-9.]+)\\s*;'));
    if (!m) { drift.push(name + ' 在源码里找不到'); continue; }
    const got = Number(m[1]);
    if (Math.abs(got - want) > 1e-9) { drift.push(`${name} = ${got}（docs/28 §3 是 ${want}）`); continue; }
    if (!doc.includes(docText)) drift.push(`docs/28 §3 里找不到「${docText}」（代码是 ${want}）`);
  }
  if (drift.length) bad('效果数值与 docs/28 §3 脱节：' + drift.join('；'));
  else ok('10 项数值与 docs/28 §3 逐条一致（源码常量 ↔ 文档，双向）');
}

// ---------------------------------------------------------------- B 钓获类真的接进了钓鱼链
{
  // ① 渔运 / 爆口 / 空军：FishingSession 必须把 rollBonus 传进 FishSpecies.roll
  const call = session.match(/FishSpecies\.roll\(([\s\S]*?)\);/);
  if (!call) bad('FishingSession 里找不到 FishSpecies.roll(...) 调用');
  else if (!/rollBonus/.test(call[1])) {
    bad('FishSpecies.roll 的调用里没有 rollBonus —— 渔运/爆口/空军三条效果全是摆设');
  } else ok('渔运 / 爆口 / 空军：rollBonus 传进了 FishSpecies.roll（抽鱼时生效）');

  // ② 巨物猎手：回拉速度乘子
  if (!/pullMult\s*\*=\s*DishEffectHooks\.giantPullMultiplier\(this\.player,\s*this\.fishTier\)/.test(session)) {
    bad('FishingSession 的 pullMult 没乘 giantPullMultiplier —— 巨物猎手不影响回拉');
  } else if (!/hookedTier\s*<\s*GIANT_MIN_TIER[\s\S]{0,40}return 1\.0;/.test(hooks)) {
    bad('giantPullMultiplier 没有"低于金档原样返回 1.0"的护栏 —— 紫档鱼也会加速');
  } else ok('巨物猎手：金档以上咬钩才乘回拉速度（低于 GIANT_MIN_TIER 原样 1.0）');

  // ③ 没有效果时必须逐字节不变（RollBonus.NONE 快路径）
  if (!/luck\s*<=\s*0\.0\s*&&\s*big\s*<=\s*0\s*&&\s*small\s*<=\s*0[\s\S]{0,80}RollBonus\.NONE/.test(hooks)) {
    bad('rollBonus 没有"三个效果都没有 → NONE"的快路径 —— 没吃菜的玩家也会走加成分支');
  } else ok('没有任何钓获效果时返回 RollBonus.NONE（抽签路径与加效果之前相同）');
}

// ---------------------------------------------------------------- C 加成位置：解 k 之后 / 取整之前
{
  const kIdx = species.indexOf('double k = (p * other) / ((1.0 - p) * hvWeight);');
  const spIdx = species.indexOf('bonus.speciesWeight().applyAsDouble');
  const roundIdx = species.indexOf('int w = (int) Math.max(1, Math.round(weights.get(i)));');
  if (kIdx < 0 || spIdx < 0 || roundIdx < 0) {
    bad('FishSpecies 里找不到"解 k / 鱼种加成 / 取整"这三步中的某一步 —— 加成位置无从校验');
  } else if (spIdx < kIdx) {
    bad('爆口/空军的鱼种加成跑到了"解金红占比 k"之前 —— k 会把它原样除回去，净效果为零');
  } else if (spIdx > roundIdx) {
    bad('爆口/空军的鱼种加成跑到了"取整之后" —— 最小档位权重 3，3×1.05 仍是 3，一分不加');
  } else ok('爆口/空军乘在"解 k 之后、取整之前"（加成才不会被 k 抵消，也不会被取整吃掉）');

  // 渔运的两条入口：饵料有承诺 → 直接加；没承诺 → 先算当前占比再加
  const luckOnTarget = species.indexOf('targetPct += bonus.luckPoints();');
  const luckOnCurrent = species.indexOf('hvWeight / total * 100.0 + bonus.luckPoints()');
  if (luckOnTarget < 0) {
    bad('渔运没有加在"饵料承诺的占比目标"上（hvTargetPct > 0 这条入口）');
  } else if (luckOnCurrent < 0) {
    bad('渔运缺"饵料不承诺占比"那条入口（hvTargetPct < 0 时会拿 −1+3=2 当目标，'
      + '把路亚原本 20%+ 的金红占比压到 2%）');
  } else ok('渔运两条入口都在：承诺占比 → 直接加；不承诺 → 先按当前池子算占比再加');
}

// ---------------------------------------------------------------- D 战斗类
{
  if (!/@SubscribeEvent[\s\S]{0,120}onIncomingDamage\(LivingIncomingDamageEvent/.test(hooks)) {
    bad('没有挂 LivingIncomingDamageEvent —— 强力/风暴行者不会改伤害');
  } else if (!/source\.getDirectEntity\(\) instanceof Projectile/.test(hooks)) {
    bad('强力没判"是不是弹射物" —— 近战也会吃到 +15%/级');
  } else if (!/event\.setAmount\(\(float\) \(event\.getAmount\(\) \* mult\)\)/.test(hooks)) {
    bad('伤害加成最后没有写回 event.setAmount(...) —— 算了个寂寞');
  } else ok('强力（只认弹射物）/ 风暴行者挂在 LivingIncomingDamageEvent 上并写回伤害');

  if (!/getEntity\(\) instanceof Player attacker/.test(hooks)) {
    bad('伤害事件里没有从伤害来源反查攻击者 —— 加成会挂到挨打的人身上');
  } else ok('加成对象是**攻击者**（从 DamageSource.getEntity() 反查），不是挨打的人');
}

// ---------------------------------------------------------------- E 生存 / 水下类 + 瞬态修饰符
{
  if (!/@SubscribeEvent[\s\S]{0,120}onPlayerTick\(PlayerTickEvent\.Post/.test(hooks)) {
    bad('没有挂 PlayerTickEvent.Post —— 海洋亲和/两栖/如鱼得水/明目都不会生效');
  } else {
    const missing = ['tickMovementEffects', 'tickVitality', 'tickOreSight']
      .filter((m) => !new RegExp(m + '\\(player\\)').test(hooks));
    if (missing.length) bad('PlayerTickEvent 里没有调用：' + missing.join('、'));
    else ok('海洋亲和 / 风暴行者速度 / 两栖 / 如鱼得水 / 明目都在 PlayerTickEvent.Post 里重算');
  }

  if (!/addTransientModifier\(/.test(hooks)) {
    bad('属性修饰符不是瞬态（addTransientModifier）—— 会被存进玩家存档，效果到期也摘不掉');
  } else if (/addPermanentModifier\(/.test(hooks)) {
    bad('出现了 addPermanentModifier —— 效果类修饰符绝不能进存档');
  } else ok('三条速度修饰符都是瞬态的（addTransientModifier，不存档）');

  // 两栖的潮涌能量：只在水里**不**发（水里本来就有渠道），且走的是原版效果
  if (!/MobEffects\.CONDUIT_POWER/.test(hooks)) {
    bad('两栖没有补潮涌能量 —— ' + '"忽略前置条件强制生效水下效果"只做了一半');
  } else if (!/if \(inWater\) \{\s*return;/.test(hooks)) {
    bad('两栖的潮涌能量没有"在水里就不发"的短路 —— 会和潮涌核心叠出更长的时长');
  } else ok('两栖：陆地上补潮涌能量（水里交给潮涌核心，不叠时长）');

  // 深海探索者搬到陆地：等效倍率必须有出处（不许是个魔法数）
  if (!/DEPTH_STRIDER_LAND_FACTOR\s*=\s*0\.6825/.test(hooks)) {
    bad('两栖的陆地等效倍率不是 0.6825（深海探索者在水里的 0.546/0.8）—— 魔法数无从复核');
  } else ok('两栖的陆地速度用深海探索者的等效倍率 0.6825（0.546 / 0.8，推导写在注释里）');

  // ★ 水下加速必须走 SWIM_SPEED（2026-10-03 用户实测报错：
  //   "我能看到因为速度变化导致的视野缩放，但实际移速不会变化"）
  if (!/setModifier\(player, NeoForgeMod\.SWIM_SPEED, OCEAN_SWIM_ID,/.test(hooks)) {
    bad('海洋亲和的水下加速没有走 NeoForgeMod.SWIM_SPEED —— '
      + '原版水中 travel 分支不读 MOVEMENT_SPEED，加了只会改 FOV 不改移速（用户实测过）');
  } else if (!/OCEAN_SWIM_ID[\s\S]{0,200}OCEAN_SPEED_PER_LEVEL/.test(hooks)
      && !/OCEAN_SPEED_PER_LEVEL[\s\S]{0,400}OCEAN_SWIM_ID/.test(hooks)) {
    bad('SWIM_SPEED 那条修饰符用的不是 OCEAN_SPEED_PER_LEVEL（+25%/级）');
  } else if (!/陆地上 SWIM_SPEED 没人读|陆地[\s\S]{0,40}SWIM_SPEED/.test(hooks)) {
    bad('没有写清"陆地上 SWIM_SPEED 没人读，两栖的那一半只能走 MOVEMENT_SPEED" —— '
      + '下一个人会把海洋亲和改回 MOVEMENT_SPEED');
  } else ok('海洋亲和：水里走 SWIM_SPEED（真加速），陆地那一半（两栖）才走 MOVEMENT_SPEED');
}

// ---------------------------------------------------------------- F 明目：报坐标 + 客户端画线
{
  const scan = hooks.indexOf('private static void tickOreSight');
  if (scan < 0) {
    bad('明目缺 tickOreSight —— 扫描没实现');
  } else {
    const body = hooks.slice(scan, hooks.indexOf('private static BlockPos nearestOre'));
    // ⚠ 断言必须**盯着扫描循环里那一行**（`hasChunkAt(p)`，p 是循环变量）：
    //   早先只断言"这段代码里出现过 hasChunkAt"，于是把循环里的守卫删掉之后
    //   仍然能匹配到下面"目标被挖掉了吗"那次检查 —— 负例 effecthooks-no-chunk-guard
    //   当场报了"期望 1 实际 0"（负例自己抓出来的漏检，2026-10-03）。
    if (!/if \(!level\.hasChunkAt\(p\)\) \{/.test(hooks)) {
      bad('明目的扫描循环里没有 hasChunkAt 守卫 —— 会为了找矿强加载区块（卡服）');
    } else if (!/isValidTarget\(level, scan\.target, origin\)/.test(body)) {
      bad('明目没有"当前目标还有效吗"的检查 —— 会一直指着一块已经被挖掉的矿');
    } else if (/scan\.layer/.test(hooks)) {
      // 2026-10-03 用户实测："指引线乱跳，疑似指向多目标但不是最近的"
      bad('明目又回到"每 tick 扫一层、攒一轮"的分层轮扫 —— 那个算法里的"最近"只是'
        + '"本轮已扫过那几层里最近的"，每轮还会先清零，线会一直在跳');
    } else if (!/player\.tickCount >= scan\.nextSweepTick/.test(body)) {
      bad('明目的全量扫描没有节流 —— 每 tick 扫 3.6 万格会把服务器拖出卡顿');
    } else if (!/if \(sq >= bestSq\) \{\s*continue;/.test(hooks)) {
      bad('nearestOre 没有"只找更近的"比较 —— 退化成"第一个撞见的矿"，指的不是最近的');
    } else if (!/ORE_SIGHT_SWITCH_MARGIN \* ORE_SIGHT_SWITCH_MARGIN/.test(hooks)
        || !/ORE_SIGHT_SWITCH_RATIO \* ORE_SIGHT_SWITCH_RATIO/.test(hooks)) {
      bad('pickTarget 没有滞回（新目标明显更近才换）—— 远近差不多的两块矿会轮流当"最近"，'
        + '玩家一走线就来回抽搐');
    } else if (/sendParticles\(/.test(hooks)) {
      bad('明目还在发粒子 —— 2026-10-03 用户实测"粒子多会容易卡顿、也看不出方向"，'
        + '已定案改成客户端画线（参考鱼线）');
    } else if (!/ModNetwork\.sendTo\(player, new OreSightPayload\(/.test(hooks)) {
      bad('明目扫到矿之后没有把坐标发给玩家 —— 客户端拿不到目标，什么都画不出来');
    } else if (!/ModNetwork\.sendTo\(player, OreSightPayload\.none\(\)\)/.test(hooks)) {
      bad('效果到期时没有发"撤线"包 —— 客户端要靠 60 tick 超时兜底，会多留 3 秒的线');
    } else ok('明目：扫未加载区块时跳过（不强加载），目标只发一个包（粒子数为零）');
  }

  if (!/Tags\.Blocks\.ORES/.test(hooks)) {
    bad('明目没有用 #c:ores 判矿物（原版没有"全部矿物"这一个标签）');
  } else ok('明目的矿物判定用 NeoForge 通用标签 #c:ores（别的 mod 的矿石也认）');

  // 客户端：状态容器 + 渲染器 + 注册
  if (!/playToClient\(OreSightPayload\.TYPE/.test(handlers)) {
    bad('OreSightPayload 没有注册成 S→C 包 —— 服务端发了也没人收');
  } else if (!/TIMEOUT_TICKS\s*=\s*60;/.test(clientState) || !/mc\.level != level/.test(clientState)) {
    bad('客户端没有"心跳超时（60 tick）+ 换世界作废"的兜底 —— 丢包或换维度会留下一条指向空气的线');
  } else ok('OreSightPayload 注册为 S→C 包，客户端有 60 tick 超时与换世界清理');

  if (!/@SubscribeEvent[\s\S]{0,200}RenderLevelStageEvent/.test(renderer)
      || !/RenderType\.lines\(\)/.test(renderer)) {
    bad('OreSightRenderer 没有按鱼线那套画（RenderLevelStageEvent + RenderType.lines）');
  } else if (!/drawTargetBox\(/.test(renderer)) {
    bad('指引线没有目标方框 —— 只能看出"哪个方向"，看不出"是哪一块"');
  } else if (!/^\s*drawFlowDot\(/m.test(renderer)) {
    bad('指引线没有流动的点 —— 用户第一条反馈就是"不算很能清晰地指引方向"');
  } else if (!/ClientOreSight\.target\(\)/.test(renderer)) {
    bad('渲染器没读客户端目标状态 —— 它画的是别的东西');
  } else ok('OreSightRenderer：主线 + 目标方框 + 流动点，从准心指向矿物（鱼线同款渲染路径）');

  if (!/指引线/.test(doc)) {
    bad('docs/28 没写明目改用"指引线"（文档还停在粒子那版）');
  } else ok('docs/28 记的是"指引线"这一版（与代码一致）');
}

// ---------------------------------------------------------------- G docs/28 §6 进度表 ↔ 代码
{
  const behaviour = /@SubscribeEvent/.test(hooks) && /onPlayerTick/.test(hooks);
  const done = (doc.match(/\| ✅ 1\.1\.17/g) || []).length;
  const todo = (doc.match(/⏳/g) || []).length;
  if (behaviour && todo > 0) {
    bad('效果行为已经落地，docs/28 §6 里却还有 ' + todo + ' 行 ⏳ —— '
      + '下一个人会照着文档再实现一遍');
  } else if (!behaviour && done > 0) {
    bad('docs/28 §6 标了 ' + done + ' 行已实现，但 DishEffectHooks 里没有任何 @SubscribeEvent');
  } else ok('docs/28 §6 的进度表与代码一致（行为层的四行都已标 ✅）');
}

console.log('');
if (fail === 0) {
  console.log('✅ 效果行为检查通过：11 项数值、接入点、加成位置、瞬态修饰符、进度表都对得上');
  process.exitCode = 0;
} else {
  console.log('❌ 效果行为检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
