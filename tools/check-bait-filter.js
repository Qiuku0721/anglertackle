/*
 * check-bait-filter.js —— 验证「饵料下限」这条规则真的生效了。
 *
 * 背景（玩家反馈）：
 *   "用金以上的路亚饵还是会出绿色以下的鱼"
 *
 * 两个 bug：
 *   ① FishingSession.baitMinTier() 读的是鱼竿自己的 PART_STATS，
 *      而拟饵的档位存在拟饵自己身上 → 路亚竿永远拿到下限 0，等于没过滤。
 *   ② 就算下限拿到了，roll() 的过滤看的是鱼种的 maxTier()，
 *      而钓上来那条鱼的品质是 rollIndividual() 按体重单独 roll 的。
 *      对档位表跨多档的鱼种（鲫鱼 {0,1}、鲈 {1,2,3}），
 *      低档个体照样出得来。
 *
 * 这个脚本把 Java 侧的算法照抄一遍，对每种配置跑 20000 次上鱼，
 * 统计实际出现的品质分布，直接看有没有低于下限的鱼。
 *
 * 用法：node tools/check-bait-filter.js
 */

// ---- 鱼种表（照抄 FishSpecies.ALL）----
const W_G = [0, 1], G_B = [1, 2], G_B_P = [1, 2, 3], B_P = [2, 3], G_R = [4, 5];
const SPECIES = [
  { id: 'crucian_carp',   minKg: 0.10,  maxKg: 1.20,  tiers: W_G,   rods: 'BOTH'  },
  { id: 'tilapia',        minKg: 0.20,  maxKg: 2.00,  tiers: W_G,   rods: 'FLOAT' },
  { id: 'mullet',         minKg: 0.30,  maxKg: 2.50,  tiers: G_B,   rods: 'BOTH'  },
  { id: 'grass_carp',     minKg: 1.50,  maxKg: 18.00, tiers: G_B,   rods: 'BOTH'  },
  { id: 'black_carp',     minKg: 3.00,  maxKg: 35.00, tiers: G_B_P, rods: 'FLOAT' },
  { id: 'topmouth_culter',minKg: 0.60,  maxKg: 6.00,  tiers: B_P,   rods: 'LURE'  },
  { id: 'zander',         minKg: 1.00,  maxKg: 9.00,  tiers: G_B_P, rods: 'LURE'  },
  { id: 'atlantic_salmon',minKg: 2.00,  maxKg: 22.00, tiers: G_R,   rods: 'BOTH'  },
  { id: 'bluefin_tuna',   minKg: 12.00, maxKg: 180.00,tiers: G_R,   rods: 'LURE'  },
  { id: 'juvenile_shark', minKg: 8.00,  maxKg: 90.00, tiers: G_R,   rods: 'LURE'  },
];

const minTierOf = (s) => s.tiers[0];
const maxTierOf = (s) => s.tiers[s.tiers.length - 1];
// 照抄 FishSpecies.tierForWeight（含边界偏上取的 1e-9 修正）
const tierForWeight = (s, w) => {
  const n = s.tiers.length;
  const span = Math.max(1e-6, s.maxKg - s.minKg);
  let idx = Math.floor(((w - s.minKg) / span) * n + 1e-9);
  idx = Math.max(0, Math.min(n - 1, idx));
  return s.tiers[idx];
};

// ---- 拟饵档位（照抄 ModItems 的 PartStats.lure(tier, ...)）----
const LURES = {
  lure_spoon:  1, lure_minnow: 2, lure_soft: 2,
  lure_deep:   3, lure_rattle: 4, lure_gilded: 5,
  // 2026-10-01 用户定案新增的 3 个拟饵：档位与同档位的既有拟饵一致，
  // 所以这里也要跟着登记 —— 不登记的话它们**不进这个测试**，
  // 「新增拟饵的下限过滤到底生不生效」就没人验了。
  lure_depthfinder: 2,   // 蓝档，同 lure_soft
  lure_paddletail:  3,   // 紫档，同 lure_deep
  lure_vibration:   4,   // 金档，同 lure_rattle
};
// ---- 鱼饵档位（BaitItem.tier）----
const BAITS = { bait_worm: 0, bait_corn: 0, bait_shrimp: 1, bait_liver: 3, bait_secret: 4, bait_liquid: 5 };

// 照抄 FishingSession.minTierOf
function minTierOfBait(baitTier) {
  switch (baitTier) {
    case 3: return 1;
    case 4: case 5: return 2;
    default: return 0;
  }
}

const WEIGHT_BY_TIER = [40, 26, 16, 10, 6, 2];
const CAST_LEVEL = { mult: () => 1.0 };   // 平抛：不改权重

// 照抄 FishSpecies.buildPool
function buildPool(rodKind, maxTier, minTier, maxWeightKg) {
  const pool = [];
  for (const s of SPECIES) {
    if (s.rods !== 'BOTH' && s.rods !== rodKind) continue;
    if (minTierOf(s) > maxTier) continue;
    if (maxTierOf(s) < minTier) continue;                 // ★ 饵料下限（鱼种级）
    if (maxWeightKg > 0 && s.minKg > maxWeightKg) continue;
    const base = WEIGHT_BY_TIER[Math.min(WEIGHT_BY_TIER.length - 1, minTierOf(s))];
    const w = Math.max(1, Math.round(base * CAST_LEVEL.mult()));
    pool.push({ s, w });
  }
  return pool;
}

// 照抄 FishSpecies.rollIndividualOnce + tierForWeight
function rollIndividualOnce(rnd, s) {
  const raw = Math.max(rnd(), rnd() * 0.85);
  const sizeFactor = 0.35 + raw * 0.65;
  let weight = s.minKg + (s.maxKg - s.minKg) * Math.pow(sizeFactor, 3.0);
  weight = Math.round(weight * 100) / 100;
  return { s, weight, tier: tierForWeight(s, weight) };
}

// 照抄 FishSpecies.rollIndividual（带 minTier 下限的精确采样）
function rollIndividual(rnd, s, minTier) {
  let floor = minTier;
  if (!s.tiers.some((t) => t >= floor)) floor = maxTierOf(s);   // 够不到 → 抬到本鱼种最高档

  const n = s.tiers.length;
  const span = Math.max(1e-6, s.maxKg - s.minKg);
  const lo = [], hi = [];
  let totalSpan = 0;
  for (let i = 0; i < n; i++) {
    if (s.tiers[i] < floor) continue;
    lo.push(s.minKg + (span * i) / n);
    hi.push(s.minKg + (span * (i + 1)) / n);
    totalSpan += hi[hi.length - 1] - lo[lo.length - 1];
  }
  let weight;
  if (lo.length === 0 || totalSpan <= 0) {
    weight = s.maxKg;
  } else {
    let pick = rnd() * totalSpan;
    weight = hi[hi.length - 1];
    for (let i = 0; i < lo.length; i++) {
      const w = hi[i] - lo[i];
      if (pick < w) { weight = lo[i] + pick; break; }
      pick -= w;
    }
  }
  weight = Math.round(weight * 100) / 100;
  return { s, weight, tier: tierForWeight(s, weight) };
}

// ---- 确定性 PRNG（跑出来的数每次一样，方便对比修复前后）----
function makeRnd(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

// 竿的材质 → maxTier + 承重（修复后：档位由材质显式决定，不再从承重推导）
const RODS = {
  '木竿':    { maxTier: 1, maxKg: 8 },
  '铁竿':    { maxTier: 2, maxKg: 20 },
  '金竿':    { maxTier: 3, maxKg: 12 },
  '钻竿':    { maxTier: 4, maxKg: 40 },
  '合金竿':  { maxTier: 5, maxKg: 999 },
};

const N = 20000;
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

function run(label, rodKind, rod, equipId, equipTier, fixLureBug) {
  // fixLureBug=false 模拟修复前：路亚竿读自己竿上的 PART_STATS → 永远 0
  const effectiveTier = (fixLureBug || rodKind === 'FLOAT') ? equipTier : 0;
  const minTier = minTierOfBait(effectiveTier);
  const pool = buildPool(rodKind, rod.maxTier, minTier, rod.maxKg);
  const total = pool.reduce((a, e) => a + e.w, 0);

  const hist = {};
  const seen = {};
  const violations = [];
  const rnd = makeRnd(20260929);
  for (let i = 0; i < N; i++) {
    let pick = rnd() * total;
    let chosen = pool[pool.length - 1].s;
    for (const e of pool) { pick -= e.w; if (pick < 0) { chosen = e.s; break; } }
    // 个体：修复前不传下限
    const d = fixLureBug ? rollIndividual(rnd, chosen, minTier) : rollIndividual(rnd, chosen, 0);
    hist[d.tier] = (hist[d.tier] || 0) + 1;
    seen[d.s.id] = (seen[d.s.id] || 0) + 1;
    if (d.tier < minTier && violations.length < 5) {
      violations.push({ id: d.s.id, w: d.weight, tier: d.tier, tiers: d.s.tiers.join('/'), kg: `${d.s.minKg}~${d.s.maxKg}` });
    }
  }

  const below = Object.entries(hist)
    .filter(([t]) => Number(t) < minTier)
    .reduce((a, [, c]) => a + c, 0);

  const dist = TIER_NAME.map((n, t) => (hist[t] ? `${n}${(hist[t] / N * 100).toFixed(1)}%` : null))
    .filter(Boolean).join(' ');
  const bad = below > 0 ? `  ❌ 低于下限 ${below} 条 (${(below / N * 100).toFixed(1)}%)` : '  ✅';
  console.log(`${label.padEnd(26)} 下限${minTier}  鱼种${String(pool.length).padStart(2)}  ${dist}${bad}`);
  for (const v of violations) {
    console.log(`      违规样本: ${v.id} 体重${v.w}kg 得档${v.tier} (鱼种档${v.tiers}, 体重域${v.kg})`);
  }
  return { pool, hist, below, minTier, seen };
}

console.log('=== 路亚竿：饵料下限验证（每行 ' + N + ' 次上鱼）===\n');
console.log('--- 修复前（路亚竿下限永远 0 = 没过滤）---');
for (const [lure, tier] of Object.entries(LURES)) {
  run(`${lure}(${TIER_NAME[tier]})`, 'LURE', RODS['合金竿'], lure, tier, false);
}

console.log('\n--- 修复后 ---');
for (const [lure, tier] of Object.entries(LURES)) {
  run(`${lure}(${TIER_NAME[tier]})`, 'LURE', RODS['合金竿'], lure, tier, true);
}

console.log('\n--- 修复后：钻竿 + 各档拟饵（这是"几十杆没金以上"那条路径）---');
for (const [lure, tier] of Object.entries(LURES)) {
  run(`${lure}(${TIER_NAME[tier]})`, 'LURE', RODS['钻竿'], lure, tier, true);
}

console.log('\n--- 修复后：五级竿 + 红拟饵（看升级竿的实际收益）---');
for (const [rod, r] of Object.entries(RODS)) {
  run(`${rod} + 红拟饵`, 'LURE', r, 'lure_gilded', 5, true);
}

console.log('\n--- 台钓竿（这条路径本来就是对的，作为对照组）---');
for (const [bait, tier] of Object.entries(BAITS)) {
  run(`${bait}(档${tier})`, 'FLOAT', RODS['合金竿'], bait, tier, true);
}

console.log('\n=== 关键断言 ===');
let fail = 0;
const assert = (cond, msg) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg);
  if (!cond) fail++;
};
const r1 = run('金拟饵·合金竿', 'LURE', RODS['合金竿'], 'lure_rattle', 4, true);
assert(r1.below === 0, '金拟饵（档4）不出蓝档以下：实际违规 ' + r1.below + ' 条');
assert(r1.minTier === 2, '金拟饵下限 = 2（蓝）');
const r2 = run('紫拟饵·合金竿', 'LURE', RODS['合金竿'], 'lure_deep', 3, true);
assert(r2.below === 0, '紫拟饵（档3）不出绿档以下：实际违规 ' + r2.below + ' 条');
const r3 = run('红拟饵·合金竿', 'LURE', RODS['合金竿'], 'lure_gilded', 5, true);
assert(r3.below === 0, '红拟饵（档5）不出蓝档以下：实际违规 ' + r3.below + ' 条');
const r4 = run('绿拟饵·合金竿', 'LURE', RODS['合金竿'], 'lure_spoon', 1, true);
assert(r4.minTier === 0, '绿拟饵不设下限（应该能出白绿鱼）');
assert((r4.hist[0] || 0) + (r4.hist[1] || 0) > 0, '绿拟饵确实能出白/绿鱼（下限设置没误伤低档饵）');

// 竿档位阶梯：每升一级材质都必须能碰到更高一档的鱼
console.log('  竿档位阶梯检查：');
const reach = {};
for (const [rod, r] of Object.entries(RODS)) {
  const res = run(`${rod} + 红拟饵`, 'LURE', r, 'lure_gilded', 5, true);
  reach[rod] = Math.max(...Object.keys(res.hist).map(Number));
}
assert(reach['木竿'] < reach['钻竿'],
  '木竿能出的最高档 < 钻竿（' + reach['木竿'] + ' vs ' + reach['钻竿'] + '）');
assert((reach['钻竿'] || 0) >= 4, '钻竿能出金鱼（实际最高档 ' + reach['钻竿'] + '）');
assert((reach['合金竿'] || 0) >= 5, '合金竿能出红鱼（实际最高档 ' + reach['合金竿'] + '）');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
