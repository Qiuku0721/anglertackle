// ============================================================================
//  simulate-full-fight.js -- 完整模拟一次对抗（体力 + 距离 + 断线）
//
//  验证用户的要求：**只有断线才是失败**。
//  距离条不该变成隐形倒计时——原来无论如何都会在某个时刻满，
//  现在要确认：只要玩家不乱拉，就能一直遛下去直到把鱼拿下。
//
//  策略模型（简单但接近真人）：
//    · 鱼在歇 → 猛收线（安全，张力掉）
//    · 鱼在挣扎 → 看张力决定：安全就收，接近红区就松手
//
//  用法: node tools/simulate-full-fight.js
// ============================================================================
const TPS = 20;

// ---- 常量（与 FishingSession / FishingManager 对齐） ----
const BASE_DRAIN_PER_SEC = 0.20;
const REEL_GAIN = 0.9;
const RELEASE_LOSS = 1.6;
const IDLE_LOSS = 0.35;
const PULL_IDLE = 0.15;
const PULL_SPRINT = 0.95;
const WHITE_MAX = 55.0, YELLOW_MAX = 80.0, CEILING = 110.0;
// 与 FishSpecies.tierSpeed() 对齐
const TIER_SPEED_BASE = 1.12;
// 与 FightProfile.FATIGUE_PULL 对齐：所有鱼疲劳期游速统一 ×0.5（用户定案）
const FATIGUE_PULL = 0.5;

function struggleSeconds(t) { return 2.0 + Math.min(5, t) * 1.6; }
function restSeconds(t) { return 5.0 - Math.min(5, t) * 0.4; }
function roundsForTier(tier, rnd) {
  if (tier >= 5) return 5 + Math.floor(rnd() * 3);
  if (tier === 4) return 4 + Math.floor(rnd() * 2);
  return 2;
}
function roundDrainCap(tier, maxRounds) {
  return tier >= 4 ? 0.9 / Math.max(1, maxRounds) : 1.0;
}

function makeRnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/**
 * @param rod   竿属性：pullIdle(收线倍率) / staminaDrain(扣力倍率)
 * @param castDistance 抛出去多远（距离条初值）
 */
function fight(tier, pullSpeedBase, castDistance, rod, seed, struggleAware = true) {
  const rnd = makeRnd(seed);
  const maxRounds = roundsForTier(tier, rnd);
  const cap = roundDrainCap(tier, maxRounds);
  // 实际游速 = 鱼种基础 pullSpeed × tierSpeed(档位)（Java: FishSpecies.tierSpeed）
  const tierSpeed = Math.pow(TIER_SPEED_BASE, tier);
  const pullSpeed = pullSpeedBase * tierSpeed;

  let stamina = 1.0;
  let distance = castDistance;
  const maxDistance = Math.max(castDistance * 2.6, castDistance + 18);

  let tension = 20.0;
  let struggling = false;
  let phaseTicks = 1;
  let roundDrain = 0;
  let roundsDone = 0;
  let exhausted = false;
  let ticks = 0;
  let reeling = false;
  let fatigued = false;
  let fatigueTicks = 0;

  const MAX = TPS * 400;
  let result = 'timeout';
  let resultReason = '';

  while (ticks < MAX) {
    ticks++;

    // ---- 阶段 ----
    if (--phaseTicks <= 0) {
      if (!exhausted) struggling = !struggling; else struggling = false;
      roundDrain = 0;
      if (struggling) {
        roundsDone++;
        if (roundsDone >= maxRounds) exhausted = true;
        phaseTicks = Math.round(struggleSeconds(tier) * TPS);
      } else {
        phaseTicks = exhausted ? TPS * 600 : Math.round(restSeconds(tier) * TPS);
      }
    }

    // ---- 玩家策略：效仿真人 ----
    //  · 鱼在歇 → 抢线（这时它不拽，最安全）
    //  · 鱼在挣扎 → 只在张力低（白区）时才收，黄区就松手等它回落
    //    这是"遛鱼"的核心操作：不敢在它发力时硬拉。
    const FATIGUE_THRESHOLD = 0.30;
    if (!struggling) {
      reeling = tension < YELLOW_MAX * 0.9;
    } else {
      reeling = tension < WHITE_MAX * 0.75;
    }

    // ---- 疲劳期（Java: 冲刺后 + 体力低于阈值 → 反拉窗口）----
    if (fatigued) {
      if (--fatigueTicks <= 0) fatigued = false;
    } else if (struggling && stamina <= FATIGUE_THRESHOLD) {
      fatigued = true;
      fatigueTicks = Math.round(2.0 * TPS);
    }

    // ---- 张力 ----
    let gen = 1.0;
    let recoverMult = 1.0;
    // 疲劳期：张力 ×0.8（更安全）、收线扣力 ×1.2（Java: FishingSession.tickFight）
    if (fatigued) {
      gen *= 0.80;
      recoverMult *= 0.80;
    }
    let delta;
    if (reeling) delta = REEL_GAIN * gen;
    else delta = -RELEASE_LOSS * recoverMult;
    delta += PULL_IDLE * pullSpeed * gen;
    tension = Math.max(0, Math.min(110, tension + delta));

    if (tension >= CEILING) { result = 'snap'; resultReason = '张力触顶'; break; }

    // ---- 鱼力 ----
    if (reeling) {
      const drainFatigue = fatigued ? 1.20 : 1.0;
      const allowed = Math.min(BASE_DRAIN_PER_SEC / TPS * rod.staminaDrain * drainFatigue,
        cap - roundDrain);
      if (allowed > 0) {
        stamina -= allowed;
        roundDrain += allowed;
      }
    }
    stamina = Math.max(0, stamina);

    // ---- 距离 ----
    // 疲劳期：鱼拽得慢（Java: fatiguedPullSpeed，所有鱼统一 0.5）
    const outMult = fatigued ? FATIGUE_PULL : 1.0;
    // 收线速度分两档（Java: FishingSession 第 6 段）
    //   struggleAware=false 复现旧行为（恒定用 pullIdle，pullStruggle 是死字段）
    //   struggleAware=true  当前实现（挣扎用 pullStruggle / 休息用 pullIdle）
    const pullMult = struggleAware
      ? (struggling ? rod.pullStruggle : rod.pullIdle)
      : rod.pullIdle;
    if (reeling) {
      const reelSpeed = 0.22 * pullMult;
      const fishOut = struggling ? 0.055 * pullSpeed * outMult : 0.006;
      distance += fishOut - reelSpeed;
    } else {
      distance += struggling ? 0.012 + 0.020 * pullSpeed * outMult : 0.002;
    }
    distance = Math.max(0, distance);
    if (distance >= maxDistance) { result = 'escaped'; resultReason = '线被放完'; break; }

    // ---- 上鱼 ----
    // A 拉干：线收到 0 → 强制上鱼（用户定案）
    if (distance <= 0.0) { result = 'caught'; resultReason = '拉干'; break; }
    // B 遛翻：体力耗尽 + 线收回近岸
    if (stamina <= 0 && distance <= castDistance * 0.25 + 2.0) {
      result = 'caught'; resultReason = '遛翻'; break;
    }
  }

  return { result, resultReason, seconds: ticks / TPS, rounds: roundsDone, distance, maxDistance, tension };
}

// 竿配件组合（pullIdle / pullStruggle / staminaDrain）
// pullStruggle 接上之后才真正生效，所以这里必须带上它
const ROD_GOOD = { pullIdle: 1.90, pullStruggle: 1.95, staminaDrain: 1.7 };  // 水滴轮 + 钻/合金竿
const ROD_HEAVY = { pullIdle: 1.55, pullStruggle: 1.55, staminaDrain: 2.30 }; // 大型纺车轮
const ROD_BASE = { pullIdle: 1.00, pullStruggle: 1.00, staminaDrain: 1.0 };   // 手线轮 + 木竿

// 鱼种与档位对齐 FishSpecies.ALL（原来这里的档位和名字有几处是错的，
// 比如"草鱼(绿) tier 2"实际草鱼是 {1,2}、"幼鲨(红) tier 5"是准的但
// "鲑(金) pull 1.60" 已经随用户定案抬到 2.50）。改动后请同步这里。
const CASES = [
  { name: '鲫鱼(白)', tier: 0, pull: 0.70 },
  { name: '草鱼(绿)', tier: 1, pull: 0.75 },
  { name: '翘嘴(蓝)', tier: 2, pull: 1.35 },
  { name: '梭鲈(紫)', tier: 3, pull: 1.45 },
  { name: '鲑(金)', tier: 4, pull: 3.125 },
  { name: '金枪鱼(金)', tier: 4, pull: 3.4375 },
  { name: '幼鲨(红)', tier: 5, pull: 3.625 },
];

function runCase(c, rod, castDistance, label, struggleAware = true) {
  const counts = { caught: 0, snap: 0, escaped: 0, timeout: 0 };
  const reasons = {};
  const times = [];
  const N = 200;
  for (let i = 0; i < N; i++) {
    const r = fight(c.tier, c.pull, castDistance, rod, i * 37 + 11, struggleAware);
    counts[r.result]++;
    if (r.result === 'caught') {
      times.push(r.seconds);
      reasons[r.resultReason] = (reasons[r.resultReason] || 0) + 1;
    }
  }
  const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : '-';
  const pc = (v) => (v / N * 100).toFixed(0) + '%';
  const dry = reasons['拉干'] || 0;
  console.log('  ' + c.name.padEnd(12) + label.padEnd(12)
    + ('上鱼 ' + pc(counts.caught)).padEnd(11)
    + ('断线 ' + pc(counts.snap)).padEnd(11)
    + ('逃脱 ' + pc(counts.escaped)).padEnd(11)
    + ('超时 ' + pc(counts.timeout)).padEnd(11)
    + ('拉干 ' + pc(dry)).padEnd(11)
    + '平均 ' + avg + 's');
}

const HEAD = '  鱼种        配置        ' + '结果'.padEnd(44) + '拉干占比   耗时';
const LINE = '  ' + '-'.repeat(90);

console.log('  === 旧行为：pullStruggle 是死字段（恒定用 pullIdle）===');
console.log(HEAD);
console.log(LINE);
CASES.forEach(c => runCase(c, ROD_GOOD, 20, '20格/水滴轮', false));

console.log('\n  === 当前实现：收线速度分挣扎/休息两档 ===');
console.log(HEAD);
console.log(LINE);
CASES.forEach(c => runCase(c, ROD_GOOD, 20, '20格/水滴轮', true));

console.log('\n  === 对照：大型纺车轮（1.55/1.55，高体力削减）===');
console.log(HEAD);
console.log(LINE);
CASES.forEach(c => runCase(c, ROD_HEAVY, 20, '20格/大型纺车', true));

console.log('\n  === 对照：基础竿（手线轮 1.00/1.00）===');
console.log(HEAD);
console.log(LINE);
CASES.forEach(c => runCase(c, ROD_BASE, 20, '20格/基础', true));

