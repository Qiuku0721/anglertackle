/*
 * check-top-end.js —— 顶配路亚的金/红鱼出现率诊断与调参。
 *
 * 触发理由（玩家原话）：
 *   "我的意思是几十杆下去看不到这两种等级的鱼，不怀疑他们不稀有，
 *     反而怀疑是不是稀有度出了问题概率这么低"
 *
 * 也就是说：不是嫌稀有，是嫌**概率低到像 bug**。
 * 这个脚本把"到底多少杆见一条"算准，然后扫描候选权重表找出合理值。
 *
 * 关键区分（两件一直被我混在一起的事）：
 *   · 鱼种抽取   → 由 FishSpecies.baseWeightByTier() 决定"多久碰到金红鱼种"
 *   · 鱼种内部   → 由 FishSpecies.tierSplit() 决定"碰到之后是金还是红"
 * 两张表都**直接从 Java 源码读**，不在这里另抄一份。
 *
 * 用法：node tools/check-top-end.js
 */
const fs = require('fs');
const path = require('path');

const FISH_SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing', 'FishSpecies.java');
const src = fs.readFileSync(FISH_SRC, 'utf8');

/** 读 baseWeightByTier() 里那张表 */
function readBaseWeights() {
  const m = /public static int\[\] baseWeightByTier\(\)\s*\{[\s\S]*?return new int\[\]\{([^}]*)\}/.exec(src);
  if (!m) throw new Error('没找到 FishSpecies.baseWeightByTier()，正则需要更新');
  const out = m[1].split(',').map((v) => Number(v.trim()));
  if (out.length !== 6 || out.some((v) => !Number.isFinite(v))) {
    throw new Error('baseWeightByTier() 解析结果不合法: ' + JSON.stringify(m[1]));
  }
  return out;
}

/** 读 tierSplit() 的 switch 规则 */
function readTierSplit() {
  const body = /public int\[\] tierSplit\(\)\s*\{([\s\S]*?)\n    \}/.exec(src);
  if (!body) throw new Error('没找到 FishSpecies.tierSplit()，正则需要更新');
  const rules = {};
  const caseRe = /case (\d+) -> (\d+);/g;
  let m;
  while ((m = caseRe.exec(body[1])) !== null) rules[Number(m[1])] = Number(m[2]);
  const def = /default -> (\d+);/.exec(body[1]);
  if (!def) throw new Error('tierSplit() 里没有 default 分支');
  return { rules, fallback: Number(def[1]) };
}

const BASE_WEIGHTS = readBaseWeights();
const SPLIT_RULES = readTierSplit();
const splitOf = (tiers) => tiers.map((t) => SPLIT_RULES.rules[t] ?? SPLIT_RULES.fallback);

// ---- 鱼种表（照抄 FishSpecies.ALL）----
const W_G = [0, 1], G_B = [1, 2], G_B_P = [1, 2, 3], B_P = [2, 3], G_R = [4, 5];
const SPECIES = [
  { id: 'crucian_carp',    minKg: 0.10,  maxKg: 1.20,   tiers: W_G,   rods: 'BOTH' },
  { id: 'tilapia',         minKg: 0.20,  maxKg: 2.00,   tiers: W_G,   rods: 'FLOAT' },
  { id: 'mullet',          minKg: 0.30,  maxKg: 2.50,   tiers: G_B,   rods: 'BOTH' },
  { id: 'grass_carp',      minKg: 1.50,  maxKg: 18.00,  tiers: G_B,   rods: 'BOTH' },
  { id: 'black_carp',      minKg: 3.00,  maxKg: 35.00,  tiers: G_B_P, rods: 'FLOAT' },
  { id: 'topmouth_culter', minKg: 0.60,  maxKg: 6.00,   tiers: B_P,   rods: 'LURE' },
  { id: 'zander',          minKg: 1.00,  maxKg: 9.00,   tiers: G_B_P, rods: 'LURE' },
  { id: 'atlantic_salmon', minKg: 2.00,  maxKg: 22.00,  tiers: G_R,   rods: 'BOTH' },
  { id: 'bluefin_tuna',    minKg: 12.00, maxKg: 180.00, tiers: G_R,   rods: 'LURE' },
  { id: 'juvenile_shark',  minKg: 8.00,  maxKg: 90.00,  tiers: G_R,   rods: 'LURE' },
];
const GOLD_RED_IDS = ['atlantic_salmon', 'bluefin_tuna', 'juvenile_shark'];

const minTierOf = (s) => s.tiers[0];
const maxTierOf = (s) => s.tiers[s.tiers.length - 1];
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

// 照抄 FishSpecies.tierForWeight（按 tierSplit 的权重划分区间）
function tierForWeight(s, w) {
  const n = s.tiers.length;
  const split = splitOf(s.tiers);
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

const LURES = {
  lure_spoon: 1, lure_minnow: 2, lure_soft: 2, lure_deep: 3, lure_rattle: 4, lure_gilded: 5,
};
const RODS = {
  木: { tier: 1, kg: 8 }, 铁: { tier: 2, kg: 20 }, 金: { tier: 3, kg: 12 },
  钻: { tier: 4, kg: 40 }, 合金: { tier: 5, kg: 999 },
};
const CAST = { NEAR: 0, LEVEL: 1, FAR: 2 };
function castMult(range, maxTier) {
  if (maxTier < 3) return 1.0;
  if (maxTier >= 5) return [0.85, 1.0, 1.30][range];
  return [0.91, 1.0, 1.18][range];
}
function baitBonus(tier, baitTier) {
  if (baitTier !== 5) return 1.0;
  if (tier === 4) return 1.0 + 0.05 * 6.0;
  if (tier === 5) return 1.0 + 0.018 * 6.0;
  return 1.0;
}
const minTierOfBait = (t) => (t === 3 ? 1 : t >= 4 ? 2 : 0);

function buildPool(rodKind, rod, baitTier, range, weights) {
  const minTier = minTierOfBait(baitTier);
  const pool = [];
  for (const s of SPECIES) {
    if (s.rods !== 'BOTH' && s.rods !== rodKind) continue;
    if (minTierOf(s) > rod.tier) continue;
    if (maxTierOf(s) < minTier) continue;
    if (s.minKg > rod.kg) continue;
    const base = weights[Math.min(weights.length - 1, minTierOf(s))];
    const w = base * castMult(range, maxTierOf(s)) * baitBonus(maxTierOf(s), baitTier);
    pool.push({ s, w });
  }
  return pool;
}

function makeRnd(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function rollIndividual(rnd, s, minTier) {
  let floor = minTier;
  if (!s.tiers.some((t) => t >= floor)) floor = maxTierOf(s);
  const n = s.tiers.length;
  const split = splitOf(s.tiers);
  const splitTotal = split.reduce((a, b) => a + b, 0);
  const span = Math.max(1e-6, s.maxKg - s.minKg);
  const lo = [], hi = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const from = cum;
    cum += split[i];
    if (s.tiers[i] < floor) continue;
    lo.push(s.minKg + (span * from) / splitTotal);
    hi.push(s.minKg + (span * cum) / splitTotal);
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
  if (mHi.length) {
    const hiMax = mHi[mHi.length - 1];
    if (w > hiMax && hiMax - 0.005 >= mLo[mLo.length - 1]) w = Math.round((hiMax - 0.005) * 100) / 100;
  }
  return { s, weight: w, tier: tierForWeight(s, w) };
}

const N = 200000;

function simulate(rodKind, rod, baitId, range, weights, seed = 20260929) {
  const baitTier = LURES[baitId];
  const minTier = minTierOfBait(baitTier);
  const pool = buildPool(rodKind, rod, baitTier, range, weights);
  const total = pool.reduce((a, e) => a + e.w, 0);
  const rnd = makeRnd(seed);
  const hist = {}, bySpecies = {};
  for (let i = 0; i < N; i++) {
    let pick = rnd() * total, chosen = pool[pool.length - 1].s;
    for (const e of pool) { pick -= e.w; if (pick < 0) { chosen = e.s; break; } }
    const d = rollIndividual(rnd, chosen, minTier);
    hist[d.tier] = (hist[d.tier] || 0) + 1;
    bySpecies[d.s.id] = (bySpecies[d.s.id] || 0) + 1;
  }
  return { pool, hist, bySpecies, total };
}

const pct = (v) => (v / N * 100);
function fmtHist(hist) {
  return TIER_NAME.map((t, i) => hist[i] ? `${t}${pct(hist[i]).toFixed(2)}%` : null)
    .filter(Boolean).join(' ');
}
const goldPct = (h) => pct(h[4] || 0);
const redPct = (h) => pct(h[5] || 0);
/** 平均多少杆见一条该档以上 */
const castsPer = (p) => (p > 0 ? Math.round(100 / p) : Infinity);

console.log('从 FishSpecies.java 读到：');
console.log('  baseWeightByTier() = [' + BASE_WEIGHTS.join(', ') + ']   （按鱼种最低档索引）');
console.log('  tierSplit()        = ' + JSON.stringify(SPLIT_RULES.rules) + '  default=' + SPLIT_RULES.fallback);
console.log('  → 金红鱼三种的 minTier 都是 4，拿到的权重 = ' + BASE_WEIGHTS[4] + '\n');

console.log('======== 现状：顶配路亚（合金竿 + 红拟饵，平抛）========');
const cur = simulate('LURE', RODS.合金, 'lure_gilded', CAST.LEVEL, BASE_WEIGHTS);
console.log('  池子权重合计 ' + cur.total.toFixed(0) + '，其中金红鱼种：');
for (const e of cur.pool.filter((e) => GOLD_RED_IDS.includes(e.s.id))) {
  console.log('    ' + e.s.id.padEnd(18) + '权重 ' + e.w.toFixed(1).padStart(6)
    + '  占 ' + (e.w / cur.total * 100).toFixed(2) + '%');
}
console.log('\n  品质分布（' + N.toLocaleString() + ' 次）：');
console.log('    ' + fmtHist(cur.hist));
console.log('    金 ' + goldPct(cur.hist).toFixed(2) + '%  红 ' + redPct(cur.hist).toFixed(2)
  + '%  金以上 ' + (goldPct(cur.hist) + redPct(cur.hist)).toFixed(2) + '%');
console.log('    → 平均 ' + castsPer(goldPct(cur.hist)) + ' 杆见一条金鱼，'
  + castsPer(redPct(cur.hist)) + ' 杆见一条红鱼');
console.log('\n  ⚠ 这就是"几十杆看不到"的来源：金红合计只占池子的 '
  + (cur.pool.filter((e) => GOLD_RED_IDS.includes(e.s.id)).reduce((a, e) => a + e.w, 0) / cur.total * 100).toFixed(1)
  + '%，');
console.log('    其余全是权重 26/16 的低档鱼。而且三个金红鱼种全都锁在权重 '
  + BASE_WEIGHTS[4] + ' 上（因为 minTier 都是 4）。');

// ---- 方案扫描 ----
console.log('\n\n======== 候选权重表扫描（同为合金竿 + 红拟饵 + 平抛）========');
console.log('  目标是让顶配路亚"金红鱼经常见得到"，同时低档配置不能被带飞。\n');
const SCHEMES = {
  '现状      [40,26,16,10,6,2]':   [40, 26, 16, 10, 6, 2],
  'A 温和    [40,26,16,12,12,6]':  [40, 26, 16, 12, 12, 6],
  'B 中档    [34,24,16,12,16,8]':  [34, 24, 16, 12, 16, 8],
  'C 明显    [30,22,16,12,20,10]': [30, 22, 16, 12, 20, 10],
  'D 激进    [26,20,16,12,24,12]': [26, 20, 16, 12, 24, 12],
  'E 很激进  [22,18,15,12,28,15]': [22, 18, 15, 12, 28, 15],
};
console.log('  方案'.padEnd(32) + '金     红     金以上   见金杆数  见红杆数');
console.log('  ' + '-'.repeat(78));
for (const [name, w] of Object.entries(SCHEMES)) {
  const r = simulate('LURE', RODS.合金, 'lure_gilded', CAST.LEVEL, w);
  const g = goldPct(r.hist), rd = redPct(r.hist);
  console.log('  ' + name.padEnd(30) + g.toFixed(2).padStart(6) + '%'
    + rd.toFixed(2).padStart(7) + '%' + (g + rd).toFixed(2).padStart(8) + '%'
    + (castsPer(g) + ' 杆').padStart(11) + (castsPer(rd) + ' 杆').padStart(10));
}

// ---- 低档配置不能被带飞 ----
console.log('\n\n======== 对照：低档配置不应因为抬高端而变容易 ========');
const CFG = [
  ['木竿 + 绿拟饵', 'LURE', RODS.木, 'lure_spoon'],
  ['铁竿 + 蓝拟饵', 'LURE', RODS.铁, 'lure_minnow'],
  ['金竿 + 紫拟饵', 'LURE', RODS.金, 'lure_deep'],
  ['钻竿 + 金拟饵', 'LURE', RODS.钻, 'lure_rattle'],
  ['合金竿 + 红拟饵', 'LURE', RODS.合金, 'lure_gilded'],
];
for (const [name, w] of Object.entries(SCHEMES)) {
  console.log('\n  【' + name + '】');
  for (const [label, kind, rod, bait] of CFG) {
    const r = simulate(kind, rod, bait, CAST.LEVEL, w);
    console.log('    ' + label.padEnd(22) + fmtHist(r.hist).padEnd(50)
      + '金以上 ' + (goldPct(r.hist) + redPct(r.hist)).toFixed(2) + '%');
  }
}
