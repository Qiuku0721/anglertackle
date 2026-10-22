// ============================================================================
//  solve-fight-params.js -- 反推对抗参数
//
//  目标（用户定案）：
//    · 低档鱼（白/绿/蓝/紫）固定挣扎 2 轮，总时长约 15~20 秒
//    · 金档 4~5 轮，红档 5~7 轮（高级鱼更久）
//    · 每轮内扣掉的体力足够，但不至于在休息期就把鱼耗死
//
//  原理：一场对抗的总时长 ≈ 各轮（挣扎 + 休息）之和。
//  只要体力在"最后一轮"附近见底，就会自然收在那时候结束。
//  所以每轮扣力上限 ≈ 100% / 轮数，再留一点余量。
//
//  用法: node tools/solve-fight-params.js
// ============================================================================

const TPS = 20;
function struggleSeconds(t) { return 2.0 + Math.min(5, t) * 1.6; }
function restSeconds(t) { return 5.0 - Math.min(5, t) * 0.4; }

const FISH = [
  { name: '鲫鱼', min: 0.10, max: 1.20, tiers: [0, 1] },
  { name: '鲻鱼', min: 0.30, max: 2.50, tiers: [1, 2] },
  { name: '草鱼', min: 1.50, max: 18.00, tiers: [1, 2] },
  { name: '青鱼', min: 3.00, max: 35.00, tiers: [1, 2, 3] },
  { name: '翘嘴', min: 0.60, max: 6.00, tiers: [2, 3] },
  { name: '梭鲈', min: 1.00, max: 9.00, tiers: [1, 2, 3] },
  { name: '大西洋鲑', min: 2.00, max: 22.00, tiers: [4, 5] },
  { name: '蓝鳍金枪鱼', min: 12.00, max: 180.00, tiers: [4, 5] },
  { name: '幼鲨', min: 8.00, max: 90.00, tiers: [4, 5] },
];

function tierForWeight(f, w) {
  const n = f.tiers.length;
  let idx = Math.floor(((w - f.min) / Math.max(1e-6, f.max - f.min)) * n);
  idx = Math.max(0, Math.min(n - 1, idx));
  return f.tiers[idx];
}

function roundsForTier(tier, rnd) {
  if (tier >= 5) return 5 + Math.floor(rnd() * 3);
  if (tier === 4) return 4 + Math.floor(rnd() * 2);
  return 2;
}

function makeRnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

function simulate(tier, drainPerSec, capPerRound, reelDuty, seed) {
  const rnd = makeRnd(seed);
  const maxRounds = roundsForTier(tier, rnd);
  const drainPerTick = drainPerSec / TPS;

  let stamina = 1.0;          // 归一化：1.0 = 满体力
  let struggling = false;
  let phaseTicks = 1;
  let roundDrain = 0;
  let roundsDone = 0;
  let exhausted = false;
  let ticks = 0;
  const struggleTicksTotal = struggleSeconds(tier) * TPS;

  while (stamina > 0 && ticks < TPS * 300) {
    ticks++;
    if (--phaseTicks <= 0) {
      if (!exhausted) { struggling = !struggling; } else { struggling = false; }
      roundDrain = 0;
      if (struggling) {
        roundsDone++;
        if (roundsDone >= maxRounds) exhausted = true;
        phaseTicks = Math.round(struggleTicksTotal);
      } else {
        phaseTicks = exhausted ? TPS * 600 : Math.round(restSeconds(tier) * TPS);
      }
    }
    if (rnd() < reelDuty) {
      const cap = capPerRound;
      if (roundDrain < cap) {
        const allowed = Math.min(drainPerTick, cap - roundDrain);
        stamina -= allowed;
        roundDrain += allowed;
      }
    }
  }
  return { seconds: ticks / TPS, rounds: roundsDone, maxRounds };
}

function evaluate(drainPerSec, capPerRound, reelDuty) {
  const times = [], rounds = [];
  for (const f of FISH) {
    for (let i = 0; i < 60; i++) {
      const w = f.min + (f.max - f.min) * ((i + 0.5) / 60);
      const tier = tierForWeight(f, w);
      const r = simulate(tier, drainPerSec, capPerRound, reelDuty, i * 31 + 7);
      times.push(r.seconds);
      rounds.push(r.rounds);
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { avgTime: avg(times), minTime: Math.min(...times), maxTime: Math.max(...times), avgRounds: avg(rounds) };
}

// 分档看：低档（2 轮）和金红档（4~7 轮）的时长差异
console.log('\n  分档诊断（收线率 70%，每档取多个体重样本）');
console.log('  上限   速率   2轮档时长          金档(4~5轮)        红档(5~7轮)');
console.log('  ' + '-'.repeat(66));
for (const cap of [0.30, 0.36, 0.42, 0.50]) {
  for (const drain of [0.12, 0.18, 0.25, 0.35, 0.50]) {
    const byTier = {};
    for (const tier of [1, 4, 5]) {
      const arr = [];
      for (let i = 0; i < 40; i++) {
        arr.push(simulate(tier, drain, cap, 0.70, i * 17 + 3).seconds);
      }
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      byTier[tier] = { avg, max: Math.max(...arr) };
    }
    const fmt = (t) => (byTier[t].avg.toFixed(1) + 's').padEnd(6)
      + (byTier[t].max >= 299 ? '【超时!】' : '(≤' + byTier[t].max.toFixed(0) + 's)');
    console.log('  ' + cap.toFixed(2) + '   ' + drain.toFixed(2) + '   '
      + fmt(1).padEnd(18) + '  ' + fmt(4).padEnd(18) + '  ' + fmt(5));
  }
  console.log('');
}

console.log('  搜索"每轮扣力上限 × 扣力速率"，让平均时长落在 25~45 秒、且低档鱼能跑满 2 轮\n');
console.log('  上限   速率   平均时长  最短   最长   平均轮数');
console.log('  ' + '-'.repeat(52));

const results = [];
for (const cap of [0.32, 0.38, 0.45]) {
  for (const drain of [0.10, 0.14, 0.18, 0.24, 0.30]) {
    const r = evaluate(drain, cap, 0.70);
    const mark = (r.avgTime >= 20 && r.avgTime <= 50) ? '  ← 候选' : '';
    console.log('  ' + cap.toFixed(2) + '   ' + drain.toFixed(2) + '   '
      + r.avgTime.toFixed(1).padStart(6) + 's  '
      + r.minTime.toFixed(1).padStart(5) + 's '
      + r.maxTime.toFixed(1).padStart(6) + 's  '
      + r.avgRounds.toFixed(1).padStart(5) + mark);
    if (mark) results.push({ cap, drain, r });
  }
}

if (results.length) {
  results.sort((a, b) => Math.abs(a.r.avgTime - 32) - Math.abs(b.r.avgTime - 32));
  const best = results[0];
  console.log('\n  推荐：每轮上限 ' + best.cap + '，扣力速率 ' + best.drain + '/秒');
  console.log('  （平均 ' + best.r.avgTime.toFixed(1) + 's，范围 '
    + best.r.minTime.toFixed(1) + '~' + best.r.maxTime.toFixed(1) + 's）');
}
