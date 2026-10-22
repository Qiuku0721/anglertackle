/*
 * check-bait-effect.js —— 验证台钓饵料的新行为（用户定案）。
 *
 * 口径："台钓饵料不提升下限，只提升上高价值鱼概率，
 *        金红总概率随饵料升级概率变动为 2% 到 10%"
 *        〔2026-10-01 重定数值：紫 2% / 金 4.5% / 红 10%〕
 *
 * 要验三件事：
 *   ① 台钓饵料**不设咬钩下限**（任何档位的鱼都能咬）
 *   ② 金饵把"金+红"鱼种总占比拉到 4.5%、红饵拉到 10%、紫饵 2%
 *   ③ 路亚拟饵**保持**原来的下限规则（用户只说了台钓要改）
 *
 * 同时跑真实抽取模拟，看**实际出品质概率**（不是权重占比）落在哪。
 *
 * 用法：node tools/check-bait-effect.js
 */
const fs = require('fs');
const path = require('path');

const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const ROOT = ATL_ROOT;
const sessSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
  'whitecobalt', 'anglertackle', 'fishing', 'FishingSession.java'), 'utf8');

// ---- 从源码读目标占比，保证脚本和实现不脱节 ----
const TARGET = {};
{
  const m = /public static double targetHighValuePct\(int baitTier\)\s*\{([\s\S]*?)\n    \}/.exec(sessSrc);
  if (!m) throw new Error('没找到 targetHighValuePct');
  const re = /case (\d+) -> ([\d.]+);/g;
  let x;
  while ((x = re.exec(m[1])) !== null) TARGET[Number(x[1])] = Number(x[2]);
}
console.log('从 FishingSession.java 读到：');
console.log('  targetHighValuePct = ' + JSON.stringify(TARGET)
  + '   （目标"金+红"总占比 %；-1 = 不调整）');

// ---- 照抄鱼池与权重 ----
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
const minTierOf = (s) => s.tiers[0];
const maxTierOf = (s) => s.tiers[s.tiers.length - 1];
const SPLIT = { 4: 5, 5: 2, default: 6 };
const splitOf = (t) => SPLIT[t] !== undefined ? SPLIT[t] : SPLIT.default;

/** 照抄 FishingSession.highValueBonus —— 现在它直接返回**目标占比**，不是倍率 */
function highValueBonus(baitTier) {
  const t = TARGET[baitTier];
  return (t === undefined || t <= 0) ? -1.0 : t;
}

/**
 * 照抄 FishSpecies.buildPool（含**池子层面的精确求解**）。
 *
 * ⚠ 关键：目标占比必须在池子里解 k 值，不能在外面按固定"基准占比"反推。
 *   台钓池只含 1 种金红鱼、路亚池含 3 种，基准占比差一倍多，
 *   用固定常数算出来的倍率永远对不上目标（实测金饵 5.4% vs 目标 3%）。
 */
function buildPool(rodKind, maxTier, minTier, maxWeightKg, baitTier) {
  const kept = [], weights = [];
  let total = 0, hvWeight = 0;
  for (const s of SPECIES) {
    if (s.rods !== 'BOTH' && s.rods !== rodKind) continue;
    if (minTierOf(s) > maxTier) continue;
    if (maxTierOf(s) < minTier) continue;
    if (maxWeightKg > 0 && s.minKg > maxWeightKg) continue;
    const w = BASE_WEIGHTS[Math.min(BASE_WEIGHTS.length - 1, minTierOf(s))];
    kept.push(s); weights.push(w); total += w;
    if (maxTierOf(s) >= 4) hvWeight += w;
  }
  const hvTargetPct = highValueBonus(baitTier);
  if (hvTargetPct > 0 && hvWeight > 0 && total > hvWeight) {
    const p = Math.min(0.95, hvTargetPct / 100);
    const other = total - hvWeight;
    const k = (p * other) / ((1 - p) * hvWeight);
    for (let i = 0; i < kept.length; i++) {
      if (maxTierOf(kept[i]) >= 4) weights[i] *= k;
    }
  }
  return kept.map((s, i) => ({ s, w: Math.max(1, Math.round(weights[i])) }));
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

function rollIndividual(rnd, s, minTier) {
  let floor = minTier;
  if (!s.tiers.some((t) => t >= floor)) floor = maxTierOf(s);
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

const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];
const N = 60000;
function simulate(rodKind, rodMaxTier, rodMaxKg, baitTier, minTier) {
  const pool = buildPool(rodKind, rodMaxTier, minTier, rodMaxKg, baitTier);
  const total = pool.reduce((a, e) => a + e.w, 0);
  const hvWeight = pool.filter((e) => maxTierOf(e.s) >= 4).reduce((a, e) => a + e.w, 0);
  const rnd = makeRnd(20260929);
  const hist = {};
  for (let i = 0; i < N; i++) {
    let pick = rnd() * total, chosen = pool[pool.length - 1].s;
    for (const e of pool) { pick -= e.w; if (pick < 0) { chosen = e.s; break; } }
    const d = rollIndividual(rnd, chosen, minTier);
    hist[d.tier] = (hist[d.tier] || 0) + 1;
  }
  return { pool, hvWeightShare: total > 0 ? hvWeight / total : 0, hist };
}

const BAITS = [
  { name: '面包屑', tier: 0 }, { name: '蚯蚓', tier: 0 }, { name: '玉米粒', tier: 1 },
  { name: '活虾', tier: 4 - 1 }, { name: '发光饵', tier: 4 }, { name: '秘制香饵', tier: 5 },
];

console.log('\n=== ① 台钓：饵料不再提升下限（任何档位的鱼都能咬）===\n');
console.log('  饵料        档位  目标金红占比   金红鱼种权重占比   实际出"金+红"概率');
console.log('  ' + '-'.repeat(78));
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

const ALLOY = { maxTier: 5, maxKg: 999 };
for (const b of BAITS) {
  // 台钓：minTier 恒为 0
  const r = simulate('FLOAT', ALLOY.maxTier, ALLOY.maxKg, b.tier, 0);
  const hvPct = ((r.hist[4] || 0) + (r.hist[5] || 0)) / N * 100;
  const target = TARGET[b.tier];
  console.log('  ' + b.name.padEnd(12) + String(b.tier).padEnd(6)
    + (target ? (target + '%').padEnd(15) : '—'.padEnd(15))
    + (r.hvWeightShare * 100).toFixed(1).padStart(14) + '%'
    + hvPct.toFixed(1).padStart(18) + '%');
}

console.log('\n=== ② 金饵 3% / 红饵 10% 的落点（实际出金+红概率）===\n');
for (const [tier, want] of Object.entries(TARGET)) {
  const r = simulate('FLOAT', ALLOY.maxTier, ALLOY.maxKg, Number(tier), 0);
  const hvPct = ((r.hist[4] || 0) + (r.hist[5] || 0)) / N * 100;
  const ok = Math.abs(hvPct - want) <= 1.5;
  if (!ok) fail++;
  console.log('  ' + (ok ? '✅' : '❌') + ' 档' + tier + ' 目标 ' + want + '%  →  实测 '
    + hvPct.toFixed(2) + '%  （差 ' + (hvPct - want).toFixed(2) + ' 个百分点）');
}

console.log('\n=== ③ 路亚拟饵：下限规则保持（用户只要求改台钓）===\n');
console.log('  拟饵档位(1起算)  下限  说明');
console.log('  ' + '-'.repeat(50));
// ⚠ 这里的 key 是**拟饵自己的档位**（1 起算：2绿 3蓝 4紫 5金 6红），
//   而喂给 buildPool/highValueBonus 的必须是**归一后的 0 起算档**（−1），
//   与 FishingSession.equippedBaitTier() 的归一一致。混用就是那条"台钓整体错一档"的根。
const LURE_MIN = { 2: 0, 3: 0, 4: 1, 5: 2, 6: 2 };
for (const [tier, want] of Object.entries(LURE_MIN)) {
  const desc = want === 0 ? '不限' : ('过滤 ' + TIER_NAME.slice(0, want).join('') + '档');
  console.log('  档 ' + tier + '      ' + String(want).padEnd(6) + desc);
}
console.log('\n  实际池子大小对比（路亚，合金竿）：');
for (const [tier, minTier] of Object.entries(LURE_MIN)) {
  const pool = buildPool('LURE', 5, minTier, 999, Number(tier) - 1);
  console.log('    档 ' + tier + '（归一后 ' + (Number(tier) - 1) + '，下限 ' + minTier + '）→ '
    + pool.length + ' 种：' + pool.map((e) => e.s.id).join(', '));
}

console.log('\n=== 断言 ===');
// 台钓：所有饵料的 minTier 都是 0 —— 已在上面用 0 调用，这里核对源码
const baitMinTierSrc = /public int baitMinTier\(\)\s*\{([\s\S]*?)\n    \}/.exec(sessSrc)[1];
assert(/RodType\.FLOAT\)\s*\{\s*return 0;/.test(baitMinTierSrc),
  'baitMinTier() 对台钓竿直接返回 0（不设下限）');
// ⚠ 归一之后这里只有一套刻度：紫 = 3、金 = 4、红 = 5（0 起算）。
//   曾经写成 `case 4 -> 1; case 5, 6 -> 2;` —— 那是拟饵的 1 起算刻度，
//   配上本来就是 0 起算的鱼饵，会让**台钓整条链错一档**。
assert(/case 3 -> 1;/.test(baitMinTierSrc), '路亚紫拟饵（归一档 3）下限 = 1');
assert(/case 4, 5 -> 2;/.test(baitMinTierSrc), '路亚金/红拟饵（归一档 4、5）下限 = 2');
// 用户 2026-10-01 重定数值：紫 2% / 金 4.5% / 红 10%（绿蓝不调整）。
// ⚠ 这里曾断言"紫(4)/金(5)/红(6)"，是**两套刻度混用**时写下的；
//   归一之后三个 case 是 3 / 4 / 5。逐档核对数值，比"数一数有几档"更强。
assert(TARGET[3] === 2.0 && TARGET[4] === 4.5 && TARGET[5] === 10.0,
  '紫(归一档 3)=2% / 金(4)=4.5% / 红(5)=10%（用户 2026-10-01 定案）');
assert(TARGET[6] === undefined,
  '不存在"档 6"——归一之后红就是 5，留着 case 6 只会让红档再掉进 default');
assert(TARGET[0] === undefined && TARGET[1] === undefined && TARGET[2] === undefined,
  '白/绿/蓝档不设高价值占比（不调整）');
assert(TARGET[5] > TARGET[4] && TARGET[4] > TARGET[3],
  '金红占比随档位递增，红档最高（不许倒挂）');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
