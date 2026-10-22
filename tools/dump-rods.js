/*
 * dump-rods.js —— 从 ModItems.java 读出十根竿的真实参数，
 * 并按 FishingSession.maxTier() 的口径算出每根竿能出到几档。
 *
 * 存在理由：玩家反馈"几十杆下去没一条金以上"。
 * 竿的承重是一道硬闸门（maxTier），但 tooltip 上只写"最大体重"，
 * 玩家看不出这根竿其实根本钓不到金鱼。这个脚本把闸门直接列出来。
 *
 * 用法：node tools/dump-rods.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'registry', 'ModItems.java');
const src = fs.readFileSync(SRC, 'utf8');

// 复用 dump-baits 里的括号配对扫描
function readArgs(s, startAt) {
  let depth = 1;
  for (let i = startAt; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return s.slice(startAt, i); }
    else if (c === ';') return null;
  }
  return null;
}
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ⚠ 2026-10-08 修：这里原来是**手抄的一份竿表**（而且抄的是更旧的值：铁 20、钻 40 ✗）。
//   用户改了竿的承重与档位上限（10/06 调参、10/08 定案烧进默认值）之后，
//   这份表就开始撒谎 —— 它打印的"配置真值"根本不是配置里的值。
//   现在直接读 tools/tuning.js（= Config.java 的默认值），**一个数都不手抄**。
const { cfg } = require('./tuning.js');
const ROD_SPECS = {
  WOOD:      { maxWeightKg: cfg.rodWoodMaxWeightKg,           materialFactor: cfg.rodWoodMaterialFactor,      tier: cfg.rodWoodTier },
  IRON:      { maxWeightKg: cfg.rodIronMaxWeightKg,           materialFactor: cfg.rodIronMaterialFactor,      tier: cfg.rodIronTier },
  GOLD:      { maxWeightKg: cfg.rodGoldMaxWeightKg,           materialFactor: cfg.rodGoldMaterialFactor,      tier: cfg.rodGoldTier },
  DIAMOND:   { maxWeightKg: cfg.rodDiamondMaxWeightKg,        materialFactor: cfg.rodDiamondMaterialFactor,   tier: cfg.rodDiamondTier },
  NETHERITE: { maxWeightKg: cfg.rodNetheriteMaxWeightKg,      materialFactor: cfg.rodNetheriteMaterialFactor, tier: cfg.rodNetheriteTier },
};

// 修复前的口径（按承重推导）——保留下来是为了能一眼看出原来错在哪
function maxTierByWeight(w) {
  if (w < 10) return 1;
  if (w < 25) return 2;
  if (w < 50) return 3;
  return 5;
}

// rod("wood_float_rod", RodType.FLOAT, RodSpec.WOOD)
const rods = [];
const re = /rod\(\s*"([a-z_]+)"\s*,\s*RodItem\.RodType\.([A-Z]+)\s*,\s*RodItem\.RodSpec\.([A-Z]+)\s*\)/g;
let m;
while ((m = re.exec(src)) !== null) {
  const spec = ROD_SPECS[m[3]];
  if (!spec) continue;
  rods.push({ id: m[1], type: m[2], mat: m[3], spec });
}

const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log('=== 十根竿：材质档位 vs 承重（值读自 Config.java 默认值）===\n');
console.log(pad('id', 22) + pad('竿型', 7) + padL('承重kg', 9) + padL('材质系数', 10)
  + padL('档位上限', 11));
console.log('-'.repeat(70));
for (const r of rods.sort((a, b) => a.spec.tier - b.spec.tier)) {
  const w = r.spec.maxWeightKg;
  console.log(pad(r.id, 22) + pad(r.type === 'FLOAT' ? '台钓' : '路亚', 7)
    + padL(w.toFixed(0), 9)
    + padL(r.spec.materialFactor.toFixed(2), 10)
    + padL(r.spec.tier + '（' + TIER_NAME[Math.min(5, r.spec.tier)] + '）', 11));
}

console.log('\n=== 自检 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

// ⚠ 这里原来断言的是"五级材质各占一个档位（覆盖 1~5 没洞）" —— 那是 2026-10-02 的设计。
//   2026-10-08 用户定案把他调过的值烧进默认值（木3 / 铁4 / 金6），那条断言**不再成立** ✗。
//   现在守的是真正该守的两件事：**档位上限不随材质倒退**、**承重不随材质倒退**。
const byTier = [...rods].sort((a, b) => a.spec.tier - b.spec.tier);
let tierOk = true, wtOk = true;
for (let i = 1; i < byTier.length; i++) {
  const a = byTier[i - 1].spec, b = byTier[i].spec;
  if (b.tier < a.tier) tierOk = false;
  if (b.maxWeightKg < a.maxWeightKg) wtOk = false;
}
assert(tierOk, '档位上限随材质单调不减（' + byTier.map((r) => r.spec.tier).join(' ≤ ') + '）');
assert(wtOk, '承重随材质单调不减（' + byTier.map((r) => r.spec.maxWeightKg.toFixed(0)).join(' ≤ ') + '）');
assert(rods.every((r) => r.spec.tier >= 1 && r.spec.tier <= 6),
  '档位上限都在 1~6（6 = 不限，显示时钳到红）');
assert(rods.every((r) => r.spec.maxWeightKg > 0), '每根竿都有承重值');

// 每级材质对应的档位（打印用）
//
// ⚠ 变量名别再叫 byTier：上面已经有一个 `const byTier`（按档位排序后的竿列表），
//   同一个作用域里声明两次就是 **SyntaxError**，整个脚本直接跑不起来 ——
//   tools/gen-fish-table.js 今天刚因为同一个坑被修过一次（那边叫 byTier/byTierNums）。
const byTierMap = {};
for (const r of rods) {
  (byTierMap[r.spec.tier] ||= []).push(r.mat);
}
for (const t of Object.keys(byTierMap).map(Number).sort((a, b) => a - b)) {
  console.log('  档 ' + t + '（' + TIER_NAME[Math.min(5, t)] + '）→ ' + [...new Set(byTierMap[t])].join(', '));
}
assert(rods.every((r) => r.spec.tier >= 1), '每根竿都有档位上限（0 起算那套只用于鱼饵/鱼，竿不用）');

// 金/红档鱼种的可达性
console.log('\n=== 金/红档鱼种的可达性 ===');
const GOLD_SPECIES = [
  { id: 'atlantic_salmon', minKg: 2.00, mat: 'DIAMOND' },
  { id: 'bluefin_tuna',    minKg: 12.00, mat: 'DIAMOND' },
  { id: 'juvenile_shark',  minKg: 8.00, mat: 'DIAMOND' },
];
for (const g of GOLD_SPECIES) {
  const ok = rods.filter((r) => r.spec.tier >= 4 && r.spec.maxWeightKg >= g.minKg);
  const mats = [...new Set(ok.map((r) => r.mat))];
  console.log('  ' + pad(g.id, 18) + pad('最低 ' + g.minKg + 'kg', 14) + '能钓到的竿: ' + mats.join(', '));
  assert(mats.includes('DIAMOND'), g.id + ' 钻竿就能钓到（不必先凑合金）');
}

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
