/*
 * trace-stamina.js —— 复现并验证"蓝条满却不上鱼"。
 *
 * 背景（玩家反馈）：红鱼出现蓝条满格却不上鱼。根因是
 *   roundDrainCap 固定 0.9/maxRounds，跑满所有轮最多扣 90%，
 *   而体力是每 tick min(drain, cap-used) 一段段累加的，
 *   **最后一次到不了精确的 cap**，攒不出最后零点几点。
 *   轮次耗尽后鱼锁死在休息再也不挣扎，体力永远停在略大于 0 的位置，
 *   而 tired 判的是精确的 <= 0.0 → 永远不成立。
 *
 * 用户定案（当前实现）：
 *   ① roundDrainCap 按**剩余轮数**重算，保证全程能扣到 90%
 *   ② 宽松判定：鱼力 ≤ 最大体力的 **0.5%** 就算遛翻 → **直接上鱼，不看距离**
 *
 * 用法：node tools/trace-stamina.js
 */
const TPS = 20;

// ---- 照抄 FishingSession 的常量 ----
const BASE_DRAIN_PER_SEC = 0.20;
const BASE_DRAIN_PER_TICK = BASE_DRAIN_PER_SEC / 20.0;
const SPRINT_DRAIN = 0.10;          // 每 tick 绝对扣，不是比例
const TOTAL_DRAIN_TARGET = 0.90;    // 整场计划扣掉的体力比例
const STAMINA_EPSILON_FLOOR = 0.05;
const STAMINA_EPSILON_RATIO = 0.005;   // ★ 用户定案：0.5%

/** 照抄 FishingSession.isFishTired —— 宽松判定，不看距离 */
function isFishTired(stamina, max) {
  return stamina <= Math.max(STAMINA_EPSILON_FLOOR, max * STAMINA_EPSILON_RATIO);
}

/** 该鱼在当前体力下的判定阈值（绝对值） */
function tiredThreshold(max) {
  return Math.max(STAMINA_EPSILON_FLOOR, max * STAMINA_EPSILON_RATIO);
}

// ---- 照抄 FishProfile 的各策略耐力参数（stamina / regen / 疲劳阈值）----
const PROFILES = {
  '亚特兰大鲑 BURST': { stamina: 260, regen: 0.02, threshold: 0.34, fatigueSec: 2.4, sprintSec: 1.6, sprintInterval: 2.6, struggleSec: null, restSec: null },
  '蓝鳍金枪鱼 BURST': { stamina: 420, regen: 0.02, threshold: 0.34, fatigueSec: 2.4, sprintSec: 1.6, sprintInterval: 2.6 },
  '幼鲨 ERRATIC': { stamina: 380, regen: 0.02, threshold: 0.32, fatigueSec: 2.0, sprintSec: 0.9, sprintInterval: 3.0 },
};

// 照抄 FishingSession.struggleSeconds / restSeconds
function struggleSeconds(t) { return 2.0 + Math.min(5, t) * 1.6; }
function restSeconds(t) { return 5.0 - Math.min(5, t) * 0.4; }
function roundsForTier(tier, rnd) {
  if (tier >= 5) return 5 + Math.floor(rnd() * 3);
  if (tier === 4) return 4 + Math.floor(rnd() * 2);
  return 2;
}
// 照抄 FishingSession.roundDrainCap
function roundDrainCap(tier, maxRounds) {
  if (tier >= 5 || tier === 4) return 0.9 / Math.max(1, maxRounds);
  return 1.0;
}
// 照抄 FishingSession.roundDrainCap（**修复后**的版本：按剩余轮数重算）
function roundDrainCapFor(tier, fishStaminaMax, totalDrain, maxRounds, roundsDone, exhausted) {
  if (tier < 4) return 1.0;
  if (exhausted) return 1.0;   // 没有下一轮了：放开剩余额度
  const target = fishStaminaMax * TOTAL_DRAIN_TARGET;
  const remaining = Math.max(0.0, target - totalDrain);
  const roundsLeft = Math.max(1, maxRounds - roundsDone + 1);
  const perRound = remaining / roundsLeft;
  return fishStaminaMax <= 0 ? 1.0 : perRound / fishStaminaMax;
}

// 照抄 FishingSession.isFishTired（宽松判定）
function makeRnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/**
 * 逐 tick 跑体力，返回终局数值。
 *
 * @param tier         鱼档位
 * @param prof         耐力参数
 * @param rodDrain     竿/线/轮的 staminaDrain 合成倍率
 * @param tierResist   鱼的 tierStaminaResist
 * @param damping      渔轮阻尼（抑制回气）
 * @param reelPlan     一个"什么时候收线"的函数：(tick, struggling) -> bool
 * @param fixed        是否用**修复后**的 roundDrainCap（false = 复现旧 bug）
 */
function trace(tier, prof, rodDrain, tierResist, damping, reelPlan, fixed = true) {
  const rnd = makeRnd(7);
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

  let landedTick = -1;

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
    }

    if (sprintLeft > 0) {
      sprintLeft--;
      sprinting = true;
      if (sprintLeft === 0) sprintCooldown = Math.round(prof.sprintInterval * TPS);
    } else {
      sprinting = false;
      if (sprintCooldown > 0) {
        sprintCooldown--;
        if (sprintCooldown === 0 && struggling) sprintLeft = Math.round(prof.sprintSec * TPS);
      }
    }

    if (fatigued) {
      if (--fatigueTicks <= 0) fatigued = false;
    } else if (!sprinting && stamina <= max * prof.threshold) {
      fatigued = true;
      fatigueTicks = Math.round(prof.fatigueSec * TPS);
    }

    const reeling = reelPlan(tick, struggling);
    if (reeling) {
      const efficiency = 1.0;
      const drainMult = 1.0;
      const drain = BASE_DRAIN_PER_TICK * max * efficiency * drainMult * rodDrain / tierResist;
      const capRatio = fixed
        ? roundDrainCapFor(tier, max, totalDrain, maxRounds, roundsDone, exhausted)
        : (tier >= 4 ? TOTAL_DRAIN_TARGET / Math.max(1, maxRounds) : 1.0);
      const capAbs = max * capRatio;
      if (roundDrain < capAbs) {
        const allowed = Math.min(drain, capAbs - roundDrain);
        stamina -= allowed;
        roundDrain += allowed;
        totalDrain += allowed;
      }
    }
    if (sprinting) stamina -= SPRINT_DRAIN;
    else if (!fatigued) stamina += prof.regen / Math.max(0.5, damping);
    stamina = Math.max(0.0, Math.min(max, stamina));

    if (isFishTired(stamina, max)) { landedTick = tick; break; }
  }

  return { max, stamina, maxRounds, landedTick, tierResist, rodDrain, exhausted, roundsDone };
}

const ROD = { drain: 1.7, damping: 2.3 };   // 顶配装备的 staminaDrain / 阻尼
const reelAlways = () => true;

console.log('照抄 FishingSession 体力算术 —— 复现并验证"蓝条满不上鱼"\n');
console.log('  症状：fishStamina 差零点几点没到 0，而 HUD 把它四舍五入显示成 0.0%');
console.log('        → 蓝条看着满格，旧判定（精确 <= 0.0）却是 false，永远不上鱼');
console.log('  修复：① 单轮上限按剩余轮数重算  ② 宽松判定：≤ 最大体力 0.5% 即上鱼，不看距离\n');

console.log('  === 修复前（固定上限 0.9/maxRounds + 精确 <= 0.0）===');
console.log('  鱼种                档  轮数   终局体力     占最大值%   能否上鱼');
console.log('  ' + '-'.repeat(74));
let beforeFail = 0;
for (const [name, prof] of Object.entries(PROFILES)) {
  for (const tier of [4, 5]) {
    const resist = Math.pow(1.18, tier);
    const r = trace(tier, prof, ROD.drain, resist, ROD.damping, reelAlways, false);
    const exactZero = r.stamina <= 0.0;
    if (!exactZero) beforeFail++;
    console.log('  ' + name.padEnd(20) + String(tier).padEnd(4)
      + String(r.maxRounds).padEnd(6) + r.stamina.toFixed(3).padStart(9) + ' / '
      + String(r.max).padEnd(5) + (r.stamina / r.max * 100).toFixed(3).padStart(9) + '%   '
      + (exactZero ? '✅' : '❌ 卡住'));
  }
}
console.log('\n  修复前有 ' + beforeFail + ' 组到不了精确的 0.0（这就是蓝条满不上鱼的来源）');

console.log('\n  === 修复后（剩余轮数重算 + 0.5% 宽松判定）===');
console.log('  鱼种                档  轮数   判定阈值   终局体力     第几 tick 判定可上鱼');
console.log('  ' + '-'.repeat(82));
let afterFail = 0;
for (const [name, prof] of Object.entries(PROFILES)) {
  for (const tier of [4, 5]) {
    const resist = Math.pow(1.18, tier);
    const r = trace(tier, prof, ROD.drain, resist, ROD.damping, reelAlways, true);
    if (r.landedTick < 0) afterFail++;
    console.log('  ' + name.padEnd(20) + String(tier).padEnd(4)
      + String(r.maxRounds).padEnd(6) + tiredThreshold(r.max).toFixed(2).padStart(8)
      + r.stamina.toFixed(3).padStart(11) + ' / ' + String(r.max).padEnd(5)
      + (r.landedTick > 0
        ? '✅ 第 ' + r.landedTick + ' tick（' + (r.landedTick / TPS).toFixed(1) + 's）'
        : '❌ 400 秒内没上鱼'));
  }
}
console.log('\n  ' + (afterFail === 0 ? '✅ 全部能在 400 秒内判定为"鱼力耗尽"'
  : '❌ 还有 ' + afterFail + ' 组判不出来'));

// ---- 断言 ----
console.log('\n  === 断言 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

// 阈值就是最大体力的 0.5%
for (const [, prof] of Object.entries(PROFILES)) {
  const max = prof.stamina;
  const t = tiredThreshold(max);
  assert(Math.abs(t - max * 0.005) < 1e-9,
    '体力 ' + max + ' 的判定阈值 = ' + t.toFixed(2) + '（= 0.5% of ' + max + '）');
}

// 宽松判定：蓝条显示满格（四舍五入 0.0%）时，tired 必须为真
console.log('\n  宽松判定一致性检查（蓝条显示 0.0% 时必须判定为 tired）：');
for (const [, prof] of Object.entries(PROFILES)) {
  const max = prof.stamina;
  // HUD 显示 0.0% 意味着 体力/最大 < 0.05%，取最坏情况刚好卡在显示边界
  const borderline = max * 0.0005;
  assert(isFishTired(borderline, max),
    '体力 ' + borderline.toFixed(3) + '（显示 0.0%）判为 tired = true');
}

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
