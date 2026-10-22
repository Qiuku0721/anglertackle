/*
 * check-damping-bonus.js —— 验证"压制阻尼溢出转化"这条新机制。
 *
 * 用户定案："压制阻尼高于 1 的部分中的 50% 转化为单次拉线鱼力消耗上限叠加"。
 *
 * 要验证三件事：
 *   1. 转化率确实是 50%，且只作用于高于 1.0 的部分
 *   2. 加成真的进了 roundDrainCap（不是只算了个数没人用）
 *   3. 加了它之后**不会**让金红鱼变成一刀秒（扣力速度本身仍是主要限制）
 *
 * 用法：node tools/check-damping-bonus.js
 */
const fs = require('fs');
// 玩法数值现在住在配置文件里（[gameplay] 组），源码里没有对应常量了。
// 统一从 tools/tuning.js 的 cfg 取"游戏里实际生效的默认值"。
const __gameplayCfg = require('./tuning.js').cfg;
function __gameplay(key, fallback) {
  if (key in __gameplayCfg) return __gameplayCfg[key];
  throw new Error('配置里没有 ' + key + ' —— 检查 Config.java 的 [gameplay] 组');
}

const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing', 'FishingSession.java');
const src = fs.readFileSync(SRC, 'utf8');

// ---- 从源码读常量，保证脚本和实现不脱节 ----
function readConst(name) {
  const m = new RegExp('private static final double ' + name + '\\s*=\\s*([\\d.]+)\\s*;').exec(src);
  if (!m) throw new Error('没找到常量 ' + name + '，正则需要更新');
  return Number(m[1]);
}
const RATIO = __gameplay('dampingToCapRatio');
const CAP_BONUS = __gameplay('capDampingBonus');
const TOTAL_TARGET = __gameplay('totalDrainTarget');

if (Math.abs(RATIO - 0.50) > 1e-9) {
  throw new Error('转化率不是 50%：读到 ' + RATIO);
}

/** 照抄 FishingSession.dampingBonusOnCap */
function dampingBonus(damping) {
  return Math.min(CAP_BONUS, Math.max(0.0, damping - 1.0) * RATIO);
}

// ---- 渔轮表（照抄 ModItems，顺序 pullIdle/pullStruggle/drain/damping）----
const REELS = [
  { id: '手线轮',   rarity: '白', pullIdle: 1.00, pullStruggle: 1.00, drain: 1.00, damping: 1.00 },
  { id: '纺车轮',   rarity: '绿', pullIdle: 1.25, pullStruggle: 1.25, drain: 1.25, damping: 1.20 },
  { id: '鼓轮',     rarity: '蓝', pullIdle: 1.45, pullStruggle: 1.45, drain: 1.60, damping: 1.45 },
  { id: '水滴轮',   rarity: '紫', pullIdle: 2.20, pullStruggle: 2.30, drain: 1.40, damping: 1.40 },
  { id: '大型纺车轮', rarity: '紫', pullIdle: 1.55, pullStruggle: 1.55, drain: 2.30, damping: 2.50 },
];
// 竿身对阻尼没有贡献（damping 直接取渔轮值），对 drain 贡献 40%
const W_REEL_ON_DRAIN = 0.6, W_ROD_ON_DRAIN = 0.4;

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log('从 FishingSession.java 读到：');
console.log('  DAMPING_TO_CAP_RATIO = ' + RATIO + '   (用户定案 0.50)');
console.log('  CAP_DAMPING_BONUS    = ' + CAP_BONUS + '  (硬顶，防一刀秒)');
console.log('  TOTAL_DRAIN_TARGET   = ' + TOTAL_TARGET + '   (原有总目标)');

console.log('\n' + '='.repeat(80));
console.log('  表一、各渔轮的阻尼转化');
console.log('='.repeat(80));
console.log('  渔轮          品质  压制阻尼   溢出部分   转化加成    单轮上限   总目标');
console.log('  ' + '-'.repeat(76));
for (const r of REELS) {
  const excess = Math.max(0, r.damping - 1.0);
  const bonus = dampingBonus(r.damping);
  const capped = excess * RATIO > CAP_BONUS;
  console.log('  ' + pad(r.id, 13) + pad(r.rarity, 6)
    + padL('×' + r.damping.toFixed(2), 9) + padL('+' + excess.toFixed(2), 11)
    + padL('+' + (bonus * 100).toFixed(1) + '%', 11)
    + padL(((TOTAL_TARGET + bonus) * 100).toFixed(1) + '%', 11)
    + padL(((TOTAL_TARGET + bonus) * 100).toFixed(1) + '%', 10)
    + (capped ? '  ← 被硬顶截断' : ''));
}
console.log('\n  "单轮上限"列显示的是**整场总目标**（TOTAL_DRAIN_TARGET + 加成），');
console.log('  实际每轮上限 = 剩余额度 ÷ 剩余轮数，跑满轮数后总量就是这个数。');

// ---- 关键断言 ----
console.log('\n' + '='.repeat(80));
console.log('  断言');
console.log('='.repeat(80));
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

assert(Math.abs(dampingBonus(1.00) - 0.0) < 1e-9, '阻尼 1.00 → 加成 0（不高于 1 的部分不转化）');
assert(Math.abs(dampingBonus(1.20) - 0.10) < 1e-9, '阻尼 1.20 → +10%（溢出 0.20 × 50%）');
assert(Math.abs(dampingBonus(1.45) - 0.225) < 1e-9, '阻尼 1.45 → +22.5%（溢出 0.45 × 50%）');
assert(Math.abs(dampingBonus(2.50) - 0.75) < 1e-9, '阻尼 2.50 → +75%（溢出 1.50 × 50%）');
assert(dampingBonus(0.80) === 0.0, '阻尼低于 1（鱼竿系数 0.5 那种）→ 不加成，也不为负');
assert(dampingBonus(99.0) === CAP_BONUS, '离谱阻尼被硬顶 ' + CAP_BONUS + ' 截住，不会一刀秒鱼');

// 加成必须真的进了 roundDrainCap
// ⚠️ 常量已进配置：源码里现在是 Tuning.totalDrainTarget() 而不是 TOTAL_DRAIN_TARGET。
assert(/Tuning\.totalDrainTarget\(\) \+ dampingBonusOnCap\(\)/.test(src),
  'roundDrainCap 里确实用了 dampingBonusOnCap()（不是只算不用）');
// ★ 2026-10-07 公式搬家：原来这条只查 FishingSession 里有没有 `damping() - 1.0`。
//   现在公式收进 PartComposer.dampingBonusOnCap（**判定与 tooltip 共用一份**），
//   所以拆成两条 —— ①公式的新家确实只转化 >1.0 的部分；②FishingSession 必须**委托**给它。
//   这样以后谁再把公式搬走/复制一份，都会立刻报红。
const composerSrc = require('fs').readFileSync(require('path').join(
  process.env.ATL_ROOT ? process.env.ATL_ROOT : require('path').join(__dirname, '..'),
  'src/main/java/com/whitecobalt/anglertackle/fishing/PartComposer.java'), 'utf8');
assert(/damping - 1\.0/.test(composerSrc) && /Math\.max\(0\.0, damping - 1\.0\)/.test(composerSrc),
  'PartComposer 里只对高于 1.0 的部分转化（公式的新家）');
assert(/PartComposer\.dampingBonusOnCap\(/.test(src),
  'FishingSession 委托 PartComposer.dampingBonusOnCap（公式只有一份，不再各写一遍）');

// ---- 不会一刀秒：扣力速度仍是主要限制 ----
console.log('\n  检查"加成不会让鱼一刀秒"（合成扣力 vs 单轮上限）：');
// 扣力 = 0.01 × 体力上限 × 效率 × 控杆 × staminaDrain ÷ 抗性
function drainPerTick(staminaMax, efficiency, drainMult, staminaDrain, resist) {
  return 0.01 * staminaMax * efficiency * drainMult * staminaDrain / resist;
}
const CASES = [
  { name: '幼鲨(红)', max: 380, tier: 5, resist: Math.pow(1.18, 5) },
  { name: '金枪鱼(金)', max: 420, tier: 4, resist: Math.pow(1.18, 4) },
];
for (const c of CASES) {
  for (const r of REELS) {
    // 竿身 drain 取 1.7（钻/合金竿），合成 = 0.6×轮 + 0.4×竿
    const composedDrain = W_REEL_ON_DRAIN * r.drain + W_ROD_ON_DRAIN * 1.7;
    const perTick = drainPerTick(c.max, 1.0, 1.0, composedDrain, c.resist);
    const bonus = dampingBonus(r.damping);
    const totalTarget = c.max * (TOTAL_TARGET + bonus);
    // 第一轮的每轮上限
    const maxRounds = c.tier >= 5 ? 6 : 5;
    const perRound = totalTarget / maxRounds;
    const ticksToCap = perRound / perTick;
    console.log('  ' + pad(c.name, 12) + pad(r.id, 13)
      + '扣力/秒 ' + padL((perTick * 20 / c.max * 100).toFixed(1) + '%', 7)
      + '  单轮上限 ' + padL((perRound / c.max * 100).toFixed(1) + '%', 7)
      + '  打满要 ' + padL(ticksToCap.toFixed(0), 4) + ' tick'
      + (ticksToCap < 20 ? '  ⚠ 不到1秒就顶到上限' : ''));
  }
  console.log('');
}
console.log('  说明：只要"打满单轮上限需要的 tick 数"明显大于一轮的长度');
console.log('  （红鱼一轮 2+5×1.6 = 10 秒 = 200 tick），上限就不是瓶颈，');
console.log('  真正决定节奏的是扣力速度 —— 加成只是让好轮子不至于被上限卡住。');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
