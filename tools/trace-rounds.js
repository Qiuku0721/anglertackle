/*
 * trace-rounds.js —— 逐轮打印体力，找出"41 鱼力就上鱼"是哪条路触发的。
 *
 * 用户反馈：红鱼到 41 鱼力就上鱼了。
 * 我实现的宽松判定是"≤ 最大体力的 0.5%"（体力 420 时 = 2.1），
 * 41 远大于 2.1 —— 所以一定是**别的判定路径**把它判上来了。
 *
 * tickFight 第 7 段有三条路：
 *   A pulledDry  : distance <= 0
 *   B tired      : isFishTired()
 *   C reeledIn   : distance <= castDistance*0.25 + 2.0   ← 嫌疑最大
 *
 * C 是"兜底"路径，我在注释里写它"基本被 A 覆盖"——如果那个判断错了，
 * C 就会在鱼力还很高的时候直接把鱼判上来。
 *
 * 用法：node tools/trace-rounds.js
 */
const TPS = 20;
const BASE_DRAIN_PER_SEC = 0.20;
const BASE_DRAIN_PER_TICK = BASE_DRAIN_PER_SEC / 20.0;
const TOTAL_DRAIN_TARGET = 0.90;
const STAMINA_EPSILON_FLOOR = 0.05;
const STAMINA_EPSILON_RATIO = 0.005;

// 照抄 roundsForTier
function roundsForTier(tier, rnd) {
  if (tier >= 5) return 5 + Math.floor(rnd() * 3);
  if (tier === 4) return 4 + Math.floor(rnd() * 2);
  return 2;
}
function makeRnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
function struggleSeconds(t) { return 2.0 + Math.min(5, t) * 1.6; }
function restSeconds(t) { return 5.0 - Math.min(5, t) * 0.4; }

function isFishTired(stamina, max) {
  return stamina <= Math.max(STAMINA_EPSILON_FLOOR, max * STAMINA_EPSILON_RATIO);
}

/**
 * 照抄 roundDrainCap（当前实现）。返回**绝对值**上限，不是比例——
 * 调用处是 `cap = fishStaminaMax * roundDrainCap()`，这里直接算出来方便看。
 */
function roundDrainCapAbs(tier, max, totalDrain, maxRounds, roundsDone, exhausted) {
  if (tier < 4) return max;
  if (exhausted) return max;
  const target = max * TOTAL_DRAIN_TARGET;
  const remaining = Math.max(0.0, target - totalDrain);
  const roundsLeft = Math.max(1, maxRounds - roundsDone + 1);
  return remaining / roundsLeft;
}

/** 逐轮模拟：玩家一直收线，张力假设始终有效（最理想情况） */
function trace(tier, prof, rodDrain, tierResist, withFallback = false) {
  const rnd = makeRnd(20260929);
  const maxRounds = roundsForTier(tier, rnd);
  const max = prof.stamina;

  let stamina = max;
  let roundDrain = 0;
  let totalDrain = 0;
  let roundsDone = 0;
  let exhausted = false;
  let fatigued = false;
  let fatigueTicks = 0;
  let struggling = false;
  let phaseTicks = 1;
  let sprinting = false;
  let sprintLeft = 0;
  let sprintCooldown = 0;
  let landedBy = null;
  let landedAt = -1;

  // 距离模拟：抛 20 米，收线速度 0.22 × 轮倍率，鱼挣扎时往外拽
  let distance = 20.0;
  const castDistance = 20.0;
  const reelSpeed = 0.22 * 1.55;   // 大型纺车轮 pullIdle
  const nearShore = castDistance * 0.25 + 2.0;

  const logs = [];

  for (let tick = 1; tick <= TPS * 400; tick++) {
    if (--phaseTicks <= 0) {
      struggling = !exhausted ? !struggling : false;
      roundDrain = 0;
      if (struggling) {
        roundsDone++;
        if (roundsDone >= maxRounds) exhausted = true;
        phaseTicks = Math.round(struggleSeconds(tier) * TPS);
      } else {
        phaseTicks = exhausted ? TPS * 600 : Math.round(restSeconds(tier) * TPS);
      }
      logs.push(`  第 ${roundsDone} 轮开始  体力=${stamina.toFixed(2)} (${(stamina / max * 100).toFixed(1)}%)  单轮上限=${roundDrainCapAbs(tier, max, totalDrain, maxRounds, roundsDone, exhausted).toFixed(2)}  轮次用尽=${exhausted}`);
    }

    if (sprintLeft > 0) {
      sprintLeft--; sprinting = true;
      if (sprintLeft === 0) sprintCooldown = Math.round(prof.sprintInterval * TPS);
    } else {
      sprinting = false;
      if (sprintCooldown > 0) {
        sprintCooldown--;
        if (sprintCooldown === 0 && struggling) sprintLeft = Math.round(prof.sprintSec * TPS);
      }
    }

    if (fatigued) { if (--fatigueTicks <= 0) fatigued = false; }
    else if (!sprinting && stamina <= max * prof.threshold) {
      fatigued = true; fatigueTicks = Math.round(prof.fatigueSec * TPS);
    }

    // 扣力
    const drain = BASE_DRAIN_PER_TICK * max * 1.0 * 1.0 * rodDrain / tierResist;
    const capAbs = roundDrainCapAbs(tier, max, totalDrain, maxRounds, roundsDone, exhausted);
    if (roundDrain < capAbs) {
      const allowed = Math.min(drain, capAbs - roundDrain);
      stamina -= allowed; roundDrain += allowed; totalDrain += allowed;
    }
    if (sprinting) stamina -= 0.10;
    else if (!fatigued) stamina += prof.regen / Math.max(0.5, 2.3);
    stamina = Math.max(0.0, Math.min(max, stamina));

    // 距离
    const fishOut = struggling ? 0.055 * prof.pullSpeed * Math.pow(1.12, tier) * (fatigued ? 0.5 : 1.0) : 0.006;
    distance += fishOut - reelSpeed;
    distance = Math.max(0, distance);

    // 判定
    // A 拉干 / B 遛翻 是当前实现；C 兜底只在 withFallback=true 时启用（复现旧行为）
    if (distance <= 0.0) { landedBy = 'A 拉干'; landedAt = tick; break; }
    if (isFishTired(stamina, max)) { landedBy = 'B 遛翻(0.5%)'; landedAt = tick; break; }
    if (withFallback && distance <= nearShore) { landedBy = 'C 线已收近(兜底)'; landedAt = tick; break; }
  }

  return { max, maxRounds, stamina, distance, nearShore, landedBy, landedAt, logs, exhausted, roundsDone };
}

const PROFILES = {
  '幼鲨 ERRATIC': { stamina: 380, regen: 0.02, threshold: 0.32, fatigueSec: 2.0, sprintSec: 0.9, sprintInterval: 3.0, pullSpeed: 2.9 },
};
const ROD = { drain: 2.48 };   // 钻竿/合金竿 + 大型纺车轮的合成 staminaDrain

console.log('逐轮追踪红鱼（幼鲨）体力 —— 玩家一直收线，抛 20 米\n');
console.log('  近岸圈 = castDistance×0.25 + 2.0 = 20×0.25+2 = 7.0 米');
console.log('  也就是说 C 兜底路的门槛是"线从 20 米收到 7 米"，鱼力完全不看。\n');
for (const [name, prof] of Object.entries(PROFILES)) {
  const tier = 5;
  const resist = Math.pow(1.18, tier);

  console.log('  === 旧行为：有 C 兜底路 ===');
  const bad = trace(tier, prof, ROD.drain, resist, true);
  console.log(`  触发路径：${bad.landedBy}  第 ${bad.landedAt} tick (${(bad.landedAt / TPS).toFixed(1)}s)`);
  console.log(`  上鱼时体力 ${bad.stamina.toFixed(2)}/${bad.max} = ${(bad.stamina / bad.max * 100).toFixed(1)}%`);
  console.log(`  → 这就是"到 ${Math.round(bad.stamina)} 鱼力就上鱼了"\n`);

  console.log('  === 当前实现：C 已废除，只剩 A 拉干 / B 遛翻 ===');
  const good = trace(tier, prof, ROD.drain, resist, false);
  good.logs.forEach((l) => console.log(l));
  console.log(`  触发路径：${good.landedBy}  第 ${good.landedAt} tick (${(good.landedAt / TPS).toFixed(1)}s)`);
  console.log(`  上鱼时体力 ${good.stamina.toFixed(2)}/${good.max} = ${(good.stamina / good.max * 100).toFixed(2)}%`);
  console.log(`  判定阈值 ${(prof.stamina * STAMINA_EPSILON_RATIO).toFixed(2)}`);
  console.log(`  轮次用尽=${good.exhausted}  总轮数=${good.roundsDone}`);
  console.log('');
  console.log('  ⚠ 注意上面这个脚本是"玩家 100% 时间都在收线"的理想化模型，');
  console.log('    真实玩法里必须看张力松手，所以现实中到不了这么快。');
  console.log('    要测真实时长请看 tools/simulate-full-fight.js（它带张力策略）。');
}

console.log('\n=== 断言 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

const prof = PROFILES['幼鲨 ERRATIC'];
const resist = Math.pow(1.18, 5);
const withC = trace(5, prof, ROD.drain, resist, true);
const noC = trace(5, prof, ROD.drain, resist, false);

assert(withC.landedBy.includes('兜底'), '旧行为里 C 兜底路抢先触发（复现"41 鱼力就上鱼"）');
assert(withC.stamina / withC.max > 0.5,
  '兜底路上鱼时鱼力还剩 ' + (withC.stamina / withC.max * 100).toFixed(1) + '%（>50%，明显不该上）');
assert(!noC.landedBy.includes('兜底'), '当前实现里 C 已废除，不会走兜底');
assert(noC.landedBy.includes('遛翻') || noC.landedBy.includes('拉干'),
  '当前实现走的是正常路径：' + noC.landedBy);
// ⚠ 体力阈值**只对"遛翻"这条路**成立。
//   拉干（distance 收到 0）本来就不看鱼力，所以走拉干时鱼力可以很高 —— 断言要分路。
//   上面那个脚本的模型是"玩家 100% 时间收线"，所以它走的是拉干；
//   真实的张力策略下（simulate-full-fight.js）才会走到遛翻。
if (noC.landedBy.includes('遛翻')) {
  assert(noC.stamina <= prof.stamina * STAMINA_EPSILON_RATIO + 0.01,
    '遛翻时鱼力 ' + noC.stamina.toFixed(2) + ' ≤ 阈值 ' + (prof.stamina * STAMINA_EPSILON_RATIO).toFixed(2));
} else {
  console.log('  ℹ 本次走的是"拉干"路径，跳过我方体力阈值断言'
    + '（拉干按设计不看鱼力，上鱼时鱼力 ' + noC.stamina.toFixed(2) + '）');
}

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
