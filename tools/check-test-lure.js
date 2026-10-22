/*
 * check-test-lure.js —— 验证"测试拟饵必出红鱼"。
 *
 * 玩家反馈："测试用饵居然出蓝货，而且看挣扎条分明有六段。"
 *
 * ── 根因 ──────────────────────────────────────────────────────────
 * 测试拟饵原本只把**个体下限**钉到 5，以为这样就够了。但
 * {@code rollIndividual} 里有一句兜底：
 *     "这个鱼种到不了下限 → 抬到它能达到的最高档"
 * 于是鲻鱼（档位表 {1,2}）够不到 5，被抬到 2 —— **出蓝鱼**。
 *
 * 鱼种层为什么没拦住它？因为金/红拟饵的 {@code baitMinTier()} 只要求"下限 2"，
 * 而鲻鱼的**最高档**正好是 2，通过了 {@code s.maxTier() < minTier} 这条筛选。
 * 两处的"2"含义不同（一个是"别让太低的咬"，一个是"能不能出到高档"），
 * 混在一起就漏了。
 *
 * ── 修法 ──────────────────────────────────────────────────────────
 * 给 buildPool/roll 加一个独立的 speciesMinTier：
 *     鱼种必须**能达到**这一档，否则不进池。
 * 测试拟饵传 5，于是池子里只剩能出金红的鱼种（鲑 / 金枪鱼 / 幼鲨）。
 *
 * "六段挣扎"是**同一个 bug 的另一面**：fishTier 钉到了 5（红档 5~7 轮），
 * 而 hookedData 是蓝鱼 —— 两者来自不同来源，所以自相矛盾。
 *
 * 用法：node tools/check-test-lure.js
 */
const fs = require('fs');
const path = require('path');

const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const ROOT = ATL_ROOT;
const fishSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
  'whitecobalt', 'anglertackle', 'fishing', 'FishSpecies.java'), 'utf8');

// ---- 照抄鱼种表 ----
const W_G = [0, 1], G_B = [1, 2], G_B_P = [1, 2, 3], B_P = [2, 3], G_R = [4, 5];
const SPECIES = [
  { id: 'crucian_carp', minKg: 0.10, maxKg: 1.20, tiers: W_G, rods: 'BOTH' },
  { id: 'tilapia', minKg: 0.20, maxKg: 2.00, tiers: W_G, rods: 'FLOAT' },
  { id: 'mullet', minKg: 0.30, maxKg: 2.50, tiers: G_B, rods: 'BOTH' },
  { id: 'grass_carp', minKg: 1.50, maxKg: 18.00, tiers: G_B, rods: 'BOTH' },
  { id: 'black_carp', minKg: 3.00, maxKg: 35.00, tiers: G_B_P, rods: 'FLOAT' },
  { id: 'topmouth_culter', minKg: 0.60, maxKg: 6.00, tiers: B_P, rods: 'LURE' },
  { id: 'zander', minKg: 1.00, maxKg: 9.00, tiers: G_B_P, rods: 'LURE' },
  { id: 'atlantic_salmon', minKg: 2.00, maxKg: 22.00, tiers: G_R, rods: 'BOTH' },
  { id: 'bluefin_tuna', minKg: 12.00, maxKg: 180.00, tiers: G_R, rods: 'LURE' },
  { id: 'juvenile_shark', minKg: 8.00, maxKg: 90.00, tiers: G_R, rods: 'LURE' },
];
const BASE_WEIGHTS = [40, 26, 16, 12, 12, 6];
const SPLIT = { 4: 5, 5: 2, default: 6 };
const splitOf = (t) => SPLIT[t] !== undefined ? SPLIT[t] : SPLIT.default;
const minTierOf = (s) => s.tiers[0];
const maxTierOf = (s) => s.tiers[s.tiers.length - 1];
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

/** 照抄 buildPool（含 speciesMinTier 过滤） */
function buildPool(rodKind, maxTier, minTier, maxWeightKg, speciesMinTier) {
  const pool = [];
  for (const s of SPECIES) {
    if (s.rods !== 'BOTH' && s.rods !== rodKind) continue;
    if (speciesMinTier > 0 && maxTierOf(s) < speciesMinTier) continue;   // ★ 新增
    if (minTierOf(s) > maxTier) continue;
    if (maxTierOf(s) < minTier) continue;
    if (maxWeightKg > 0 && s.minKg > maxWeightKg) continue;
    pool.push({ s, w: BASE_WEIGHTS[Math.min(BASE_WEIGHTS.length - 1, minTierOf(s))] });
  }
  return pool;
}

function tierForWeight(s, w) {
  const n = s.tiers.length;
  const split = s.tiers.map(splitOf);
  const total = split.reduce((a, b) => a + b, 0);
  const span = Math.max(1e-6, s.maxKg - s.minKg);
  const ratio = Math.max(0, Math.min(0.9999999, (w - s.minKg) / span));
  const target = ratio * total;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += split[i];
    if (target < cum - 1e-9) return s.tiers[i];
  }
  return s.tiers[n - 1];
}

function makeRnd(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

/** 照抄 rollIndividual —— 注意那句"够不到下限就抬到自己的最高档"的兜底 */
function rollIndividual(rnd, s, minTier) {
  let floor = minTier;
  if (!s.tiers.some((t) => t >= floor)) floor = maxTierOf(s);   // ← 就是这句漏出蓝鱼
  const n = s.tiers.length, span = Math.max(1e-6, s.maxKg - s.minKg);
  const split = s.tiers.map(splitOf);
  const splitTotal = split.reduce((a, b) => a + b, 0);
  const lo = [], hi = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const from = cum; cum += split[i];
    if (s.tiers[i] < floor) continue;
    lo.push(s.minKg + span * from / splitTotal);
    hi.push(s.minKg + span * cum / splitTotal);
  }
  const mLo = [], mHi = [];
  for (let i = 0; i < lo.length; i++) {
    if (mHi.length && Math.abs(lo[i] - mHi[mHi.length - 1]) < 1e-9) mHi[mHi.length - 1] = hi[i];
    else { mLo.push(lo[i]); mHi.push(hi[i]); }
  }
  const total = mHi.reduce((a, h, i) => a + (h - mLo[i]), 0);
  let w;
  if (!mLo.length || total <= 0) w = s.maxKg;
  else {
    let pick = rnd() * total; w = mHi[mHi.length - 1];
    for (let i = 0; i < mLo.length; i++) {
      const d = mHi[i] - mLo[i];
      if (pick < d) { w = mLo[i] + pick; break; }
      pick -= d;
    }
  }
  w = Math.round(w * 100) / 100;
  return { s, weight: w, tier: tierForWeight(s, w) };
}

const N = 40000;
/** 测试拟饵 = 路亚竿(上限5) + 下限2 + 个体下限5 */
function simulate(speciesMinTier) {
  const pool = buildPool('LURE', 5, 2, 999, speciesMinTier);
  const total = pool.reduce((a, e) => a + e.w, 0);
  const rnd = makeRnd(20260929);
  const hist = {}, bySpecies = {};
  for (let i = 0; i < N; i++) {
    let pick = rnd() * total, chosen = pool[pool.length - 1].s;
    for (const e of pool) { pick -= e.w; if (pick < 0) { chosen = e.s; break; } }
    const d = rollIndividual(rnd, chosen, 5);   // 个体下限钉 5
    hist[d.tier] = (hist[d.tier] || 0) + 1;
    bySpecies[d.s.id] = (bySpecies[d.s.id] || 0) + 1;
  }
  return { pool, hist, bySpecies };
}

console.log('=== 修复前：只钉个体下限，不加鱼种过滤（speciesMinTier = 0）===\n');
const before = simulate(0);
console.log('  池子（' + before.pool.length + ' 种）：' + before.pool.map((e) => e.s.id).join(', '));
console.log('  出品质分布：' + TIER_NAME.map((n, t) =>
  before.hist[t] ? n + (before.hist[t] / N * 100).toFixed(1) + '%' : null).filter(Boolean).join('  '));
console.log('  按鱼种：' + Object.entries(before.bySpecies).map(([k, v]) =>
  k + ' ' + (v / N * 100).toFixed(1) + '%').join(', '));

console.log('\n=== 修复后：speciesMinTier = 5（鱼种必须能达到红档）===\n');
const after = simulate(5);
console.log('  池子（' + after.pool.length + ' 种）：' + after.pool.map((e) => e.s.id).join(', '));
console.log('  出品质分布：' + TIER_NAME.map((n, t) =>
  after.hist[t] ? n + (after.hist[t] / N * 100).toFixed(1) + '%' : null).filter(Boolean).join('  '));
console.log('  按鱼种：' + Object.entries(after.bySpecies).map(([k, v]) =>
  k + ' ' + (v / N * 100).toFixed(1) + '%').join(', '));

console.log('\n=== 断言 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

const beforeBlue = (before.hist[0] || 0) + (before.hist[1] || 0) + (before.hist[2] || 0)
  + (before.hist[3] || 0);
assert(beforeBlue > 0, '修复前确实会出蓝及更低的鱼（' + beforeBlue + ' / ' + N
  + ' 条 = ' + (beforeBlue / N * 100).toFixed(1) + '%）——复现了"测试拟饵出蓝货"');
assert(before.bySpecies.mullet > 0, '修复前鲻鱼会进池（' + (before.bySpecies.mullet / N * 100).toFixed(1)
  + '%）——它的档位表 {1,2} 够不到 5，被兜底抬成蓝鱼');
assert(after.pool.every((e) => maxTierOf(e.s) >= 5),
  '修复后池子里每个鱼种的最高档都 ≥ 5：' + after.pool.map((e) => e.s.id).join(', '));
assert((after.hist[4] || 0) + (after.hist[5] || 0) === N,
  '修复后**全部**是金或红（' + (((after.hist[4] || 0) + (after.hist[5] || 0)) / N * 100).toFixed(1) + '%）');
assert(!after.bySpecies.mullet, '修复后鲻鱼不再出现');

console.log('\n  说明：修复后是 **100% 红**，不是"金或红"。');
console.log('        因为个体下限 5 只在"档位 >= 5"的体重区间里采样，');
console.log('        而金红鱼种（{4,5}）能到 5 的区间就是红档本身 —— 采出来的必然是红。');
console.log('        顺带解释"六段挣扎"：fishTier 也被钉成了 5（红档 5~7 轮），');
console.log('        而蓝鱼本来只该有 2 轮 —— 两者来自不同来源，所以自相矛盾。');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
