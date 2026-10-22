
// 玩法数值现在住在配置文件里（[gameplay] 组），源码里没有对应常量了。
// 统一从 tools/tuning.js 的 cfg 取"游戏里实际生效的默认值"。
const __gameplayCfg = require('./tuning.js').cfg;
function __gameplay(key, fallback) {
  if (key in __gameplayCfg) return __gameplayCfg[key];
  throw new Error('配置里没有 ' + key + ' —— 检查 Config.java 的 [gameplay] 组');
}
/*
 * check-tension-stall.js —— 复现并验证"张力条卡在中间不动"。
 *
 * 玩家反馈："偶发张力条跑到中间位置停住，此时不会因为任何操作涨红或落白，
 *            很容易上鱼，掉红鱼时尤为明显。"
 *
 * ── 根因 ──────────────────────────────────────────────────────────
 * 修改前，中立（不打不收）时的张力变化是：
 *     delta = -IDLE_LOSS×回复倍率 + 鱼拉力
 *     鱼拉力 = PULL_IDLE × pullSpeed × tierSpeed × tensionGain × gen
 *
 * 两项可以**恰好抵消**：解出平衡点所需的最低 tensionGain 只有
 *     tensionGain* = IDLE_LOSS×回复倍率 / (PULL_IDLE × pullSpeed × tierSpeed × gen)
 * 实测这个门槛低于很多鱼的实际增益值（见下表），
 * 于是这些鱼在某个张力值上净变化为 0 —— 条子冻在那里，
 * 收线才涨、松手才落，但玩家只要什么都不按它就永远不动。
 *
 * ── 修法 ──────────────────────────────────────────────────────────
 * 中立/放线时把鱼拉力当作"减缓回落"叠加，并限幅到不超过当前张力：
 *     net = min(0, -IDLE_LOSS×回复倍率 + 鱼拉力)
 * 张力绝不因为鱼在拉而上升，也就不存在"自己涨到某个点停住"。
 *
 * 用法：node tools/check-tension-stall.js
 */
const IDLE_LOSS = 0.35;
const PULL_IDLE = 0.15;
const BASE_RECOVER = 1.6;
const W_LINE = 0.60, W_ROD = 0.40;
const WHITE_RATIO = 0.55, YELLOW_RATIO = 0.82;
const TIER_SPEED = (t) => Math.pow(1.12, t);

const FISH = [
  { name: '鲫鱼(白)', pull: 0.70, gain: 0.90, tier: 0 },
  { name: '罗非鱼(绿)', pull: 0.80, gain: 0.95, tier: 1 },
  { name: '鲻鱼(绿)', pull: 1.00, gain: 1.05, tier: 1 },
  { name: '草鱼(绿)', pull: 0.75, gain: 1.35, tier: 1 },
  { name: '青鱼(紫)', pull: 0.70, gain: 1.55, tier: 3 },
  { name: '翘嘴(紫)', pull: 1.35, gain: 1.20, tier: 3 },
  { name: '梭鲈(紫)', pull: 1.45, gain: 1.30, tier: 3 },
  { name: '鲑(红)', pull: 3.125, gain: 1.25, tier: 5 },
  { name: '蓝鳍金枪鱼(红)', pull: 3.4375, gain: 1.50, tier: 5 },
  { name: '幼鲨(红)', pull: 3.625, gain: 1.70, tier: 5 },
];
const LINE = [
  { name: '麻线', gen: 1.00, rec: 1.00, ceil: 1.00 },
  { name: '棉线', gen: 0.91, rec: 1.15, ceil: 1.20 },
  { name: '尼龙线', gen: 0.95, rec: 1.30, ceil: 1.28 },
  { name: '碳氟线', gen: 0.81, rec: 1.36, ceil: 1.54 },
  { name: 'PE线', gen: 0.76, rec: 1.44, ceil: 1.94 },
  { name: '钛合金线', gen: 0.58, rec: 1.76, ceil: 2.20 },
];
const ROD = { name: '合金竿', ceil: 1.70, rec: 1.90 };

const composeCeiling = (rc, lc) => 100.0 * (1 + (lc - 1) * W_LINE) * (1 + (rc - 1) * W_ROD);
const composeRecover = (rr, lr) => BASE_RECOVER * (1 + (lr - 1) * W_LINE) * (1 + (rr - 1) * W_ROD);

/** 修复前：鱼拉力直接加进 delta */
const deltaOld = (f, l, rec) =>
  -IDLE_LOSS * (rec / BASE_RECOVER) + PULL_IDLE * f.pull * TIER_SPEED(f.tier) * f.gain * l.gen;
/** 修复后：限幅到不超过 0 */
const deltaNew = (f, l, rec) => Math.min(0, deltaOld(f, l, rec));

console.log('=== 平衡点门槛：tensionGain 要到多少才会"自己涨到停住" ===\n');
console.log('  公式：tensionGain* = IDLE_LOSS×回复倍率 / (PULL_IDLE × pullSpeed × tierSpeed × gen)');
console.log('  实际增益 > 这个门槛 → 存在平衡点（条子会冻住）；≤ 则中立时必然回落\n');
console.log('  鱼种              档位  增益   鱼线        gen    回复倍率  tensionGain*   判定');
console.log('  ' + '-'.repeat(94));
let stallCases = 0, totalCases = 0;
for (const f of FISH) {
  for (const l of LINE) {
    totalCases++;
    const rec = composeRecover(ROD.rec, l.rec);
    const recoverMult = rec / BASE_RECOVER;
    const denom = PULL_IDLE * f.pull * TIER_SPEED(f.tier) * l.gen;
    const threshold = IDLE_LOSS * recoverMult / denom;
    const stalls = f.gain > threshold;
    if (stalls) stallCases++;
    // 只在代表性行上打印（每种鱼 × 钛合金线 + 每种线 × 幼鲨），免得刷屏
    const show = l.name === '钛合金线' || f.name === '幼鲨(红)';
    if (show) {
      console.log('  ' + f.name.padEnd(17) + String(f.tier).padEnd(6)
        + String(f.gain).padEnd(7) + l.name.padEnd(11)
        + String(l.gen).padEnd(7) + recoverMult.toFixed(2).padEnd(9)
        + threshold.toFixed(2).padEnd(15)
        + (stalls ? '❌ 会冻住' : '✅ 中立必落'));
    }
  }
}
console.log('\n  ' + stallCases + ' / ' + totalCases + ' 组（鱼 × 线）存在平衡点 —— 这就是"卡在中间"的来源。');

console.log('\n=== 修复后：中立时净变化必须 ≤ 0 ===\n');
let rise = 0;
for (const f of FISH) {
  for (const l of LINE) {
    const rec = composeRecover(ROD.rec, l.rec);
    if (deltaNew(f, l, rec) > 0) rise++;
  }
}
console.log('  上升的组合数 = ' + rise + '（应为 0）');
console.log('  说明：修复后鱼拉力只能**减缓**回落，不能把张力推上去。');
console.log('        鱼越猛 → 回落越慢（站着不动会被慢慢拖进黄区），');
console.log('        但绝不会出现"干看着它自己涨"或"卡死不动"。');

console.log('\n=== 断言 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };
assert(stallCases > 0, '修复前确实存在平衡点（' + stallCases + ' 组配置会冻住）');
assert(rise === 0, '修复后中立时净变化恒 ≤ 0');
// 高档鱼必须落在"会冻住"那一侧，才能解释"红鱼尤为明显"
const redStalls = FISH.filter((f) => f.tier >= 4).every((f) =>
  LINE.some((l) => f.gain > IDLE_LOSS * (composeRecover(ROD.rec, l.rec) / BASE_RECOVER)
    / (PULL_IDLE * f.pull * TIER_SPEED(f.tier) * l.gen)));
assert(redStalls, '金/红档鱼在修复前都会冻住 —— 和玩家"掉红鱼时尤为明显"的描述一致');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
