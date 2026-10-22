/*
 * check-reel-floor-drain.js —— **保底体力削减**（渔轮属性，用户 2026-10-06 定案）。
 *
 * 用户原话：
 *   "创建一个属性：保底体力削减。拉鱼时每秒最少削减的鱼力，**不受上限限制**。
 *    由渔轮提供，根据压制阻尼转化而来。无论渔轮压制阻尼多少，该属性最小值为 5，
 *    即装备了渔轮的路亚至少每秒保底对鱼削减 5 体力。上限 20。
 *    思考怎样的一转化比例能够使得金轮的保底削减贴近 20。"
 *   （追加要求）"希望这个转化系数最好取整或 0.5。"
 *
 * 落地：{@code clamp(下限, 上限, 下限 + max(0, 压制阻尼 − 1) × 每点阻尼转化)}，
 * 默认 5 + (阻尼−1) × **10**（整数系数，且是为金轮倒推的：2.50 → 5+15 = 20.0 贴住上限）。
 *
 * ── 这个检查器守五件事 ────────────────────────────────────────
 * ① 三个旋钮的数值与"系数取整或 .5"；
 * ② 五个渔轮的保底值逐个复算（它们直接来自 ModItems 里的 damping）；
 * ③ 值域：任何轮子都在 [5, 20]；金轮贴住 20；
 * ④ 接线：扣力那一处**取较大者**（= 保底绕过单轮上限），而不是相加、也不是被上限吃掉；
 * ⑤ 提示不重写公式：tooltip 必须**调用** PartComposer 的同一个函数
 *    （damping_bonus 那段吃过"三个数全写死、调参器改了提示不动"的亏）。
 *
 * 用法：node tools/check-reel-floor-drain.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const { stripComments } = require('./java-source.js');
const TUNE = require('./tuning.js');
const cfg = TUNE.cfg;

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const assert = (cond, msg) => (cond ? ok(msg) : bad(msg));
const pad = (s, n) => String(s).padEnd(n);

console.log('=== 保底体力削减（渔轮）检查 ===\n');

// ---------------------------------------------------------------- ① 三个旋钮
const BASE = cfg.reelFloorDrainBase;
const PER = cfg.reelFloorDrainPerDamping;
const CAP = cfg.reelFloorDrainCap;

assert(BASE === 5.0, '下限 = 5.0 点/秒（用户定案"最小值为 5"）—— 当前 ' + BASE);
assert(CAP === 20.0, '上限 = 20.0 点/秒（用户定案）—— 当前 ' + CAP);
// 用户追加要求："希望这个转化系数最好取整或 0.5"
const perIsClean = Math.abs(PER - Math.round(PER * 2) / 2) < 1e-9;
assert(perIsClean, '每点阻尼转化系数取整或 .5（用户要求）—— 当前 ' + PER
  + (PER === 10 ? '（整数，且正好让金轮落在 20.0）' : ''));
assert(CAP >= BASE, '上限 ≥ 下限（否则 clamp 结果会自相矛盾）');

// ---------------------------------------------------------------- ②③ 五个渔轮逐个复算
const items = stripComments(read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'));
const REELS = [...items.matchAll(
  /PartStats\.reel\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d)\)/g)]
  .map((m) => ({ idle: Number(m[1]), struggle: Number(m[2]), drain: Number(m[3]),
    damping: Number(m[4]), tier: Number(m[5]) }))
  .sort((a, b) => a.tier - b.tier);
if (REELS.length < 5) {
  bad('只解析出 ' + REELS.length + ' 个渔轮（应 5 个）—— 这个检查器的正则要更新');
} else {
  const TIER_CN = ['-', '白', '绿', '蓝', '紫', '金', '红'];
  /** 与 PartComposer.floorDrainPerSec 逐字一致：先按 capDamping 夹，再线性转化并夹到 [下限, 上限] */
  const floorOf = (damping) => {
    const d = Math.min(damping, TUNE.CAP_DAMPING);
    const v = BASE + Math.max(0.0, d - 1.0) * PER;
    return Math.max(BASE, Math.min(v, CAP));
  };
  console.log('  轮子          档位  压制阻尼   保底削减（点/秒）');
  console.log('  ' + '-'.repeat(48));
  const rows = REELS.map((r) => {
    const f = floorOf(r.damping);
    console.log('  ' + pad(TIER_CN[r.tier] + '档轮(tier ' + r.tier + ')', 14)
      + pad(TIER_CN[r.tier], 6) + pad(r.damping.toFixed(2), 11) + f.toFixed(1));
    return { ...r, floor: f };
  });
  console.log('');

  const outOfRange = rows.filter((r) => r.floor < BASE - 1e-9 || r.floor > CAP + 1e-9);
  assert(outOfRange.length === 0, '所有渔轮的保底值都在 [' + BASE + ', ' + CAP + '] 内'
    + '（' + rows.length + ' 个轮子全部通过）');

  const lowest = Math.min(...rows.map((r) => r.floor));
  assert(lowest >= BASE - 1e-9, '最差的轮子也能拿到下限 ' + BASE + '（实测最低 ' + lowest.toFixed(1) + '）');

  const gold = rows[rows.length - 1];
  assert(Math.abs(gold.floor - CAP) < 1e-9,
    '金轮（tier 5，阻尼 ' + gold.damping.toFixed(2) + '）的保底 = ' + gold.floor.toFixed(1)
    + '，正好贴住上限 ' + CAP + ' —— 这就是"×' + PER + '"倒推的依据');

  // 单调性：保底必须随阻尼单调不降（它是"阻尼的转化"，不能反过来）
  const sortedByDamping = [...rows].sort((a, b) => a.damping - b.damping);
  let mono = true;
  for (let i = 1; i < sortedByDamping.length; i++) {
    if (sortedByDamping[i].floor < sortedByDamping[i - 1].floor - 1e-9) mono = false;
  }
  assert(mono, '保底随压制阻尼**单调不降**（阻尼是唯一输入）');

  // 档位顺序 vs 阻尼顺序不一致时**只提示**，不判失败 —— 那是配件数值的事
  const byTier = rows.map((r) => r.damping);
  const tierMonotone = byTier.every((d, i) => i === 0 || d >= byTier[i - 1]);
  if (!tierMonotone) {
    console.log('  ℹ️ 档位顺序与阻尼顺序不一致（例如水滴轮阻尼 1.40 < 鼓式轮 1.45）——'
      + '所以它的保底略低于低一档的轮子。这是配件数值本身的排序，不是这条转化的问题。');
  }
}

// ---------------------------------------------------------------- ④ 接线：越过单轮上限
const sess = stripComments(read('src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java'));
const composer = stripComments(read('src/main/java/com/whitecobalt/anglertackle/fishing/PartComposer.java'));
const rodStats = stripComments(read('src/main/java/com/whitecobalt/anglertackle/fishing/RodStats.java'));
const partItem = stripComments(read('src/main/java/com/whitecobalt/anglertackle/item/TacklePartItem.java'));

assert(/public static double floorDrainPerSec\(PartStats reel\)/.test(composer)
  && /Tuning\.reelFloorDrainBase\(\)/.test(composer)
  && /Tuning\.reelFloorDrainPerDamping\(\)/.test(composer)
  && /Tuning\.reelFloorDrainCap\(\)/.test(composer),
  'PartComposer.floorDrainPerSec 用的是三个配置项（不是写死的数）');

const APPLIED = /allowed = Math\.max\(allowed, this\.rodStats\.floorDrainPerSec\(\) \/ 20\.0\);/.test(sess);
assert(APPLIED,
  '扣力处**取较大者**：allowed = max(单轮上限允许的, 保底/20) —— 这才是"不受上限限制"');
const capFirst = sess.indexOf('double allowed = used < cap ? Math.min(drain, cap - used) : 0.0;')
  < sess.indexOf('allowed = Math.max(allowed, this.rodStats.floorDrainPerSec() / 20.0);');
assert(capFirst, '保底那一行在**单轮上限之后**（先算上限允许量，再抬到保底）');

assert(/double floorDrainPerSec,/.test(rodStats) && /public static double reelFloorDrain\(ItemStack reelStack\)/.test(rodStats),
  'RodStats 带 floorDrainPerSec 字段，并有 reelFloorDrain(堆栈) 的入口');
assert(/reelStack == null \|\| reelStack\.isEmpty\(\) \|\| isWornOut\(reelStack\)/.test(rodStats),
  '没装渔轮 / 轮子见底 → 保底 0（用户："装备了渔轮的路亚"才有保底）');

// ---------------------------------------------------------------- ⑤ 提示不重写公式
assert(/PartComposer\.floorDrainPerSec\(stats\)/.test(partItem),
  'tooltip **调用** PartComposer.floorDrainPerSec（不重写公式）');
const inlineFormula = /\*\s*Tuning\.reelFloorDrain|damping\(\)\s*\*\s*[\d.]+/.test(partItem);
assert(!inlineFormula, 'tooltip 里没有内联的阻尼×系数算式（吃过"写死三个数"的亏）');
assert(/floor_drain/.test(partItem), 'tooltip 里有专属于本属性的语言键 floor_drain');

for (const lang of ['zh_cn', 'en_us']) {
  const p = 'src/main/resources/assets/anglertackle/lang/' + lang + '.json';
  if (!exists(p)) { bad('缺少语言文件 ' + p); continue; }
  const j = JSON.parse(read(p));
  assert(typeof j['tooltip.anglertackle.floor_drain'] === 'string',
    lang + ' 里有 tooltip.anglertackle.floor_drain');
}

console.log('');
if (fail === 0) {
  console.log('✅ 保底体力削减检查通过：5 + (阻尼−1)×10，夹在 [5,20]，金轮 20.0，'
    + '扣力时取较大者（绕过单轮上限），提示调用同一个函数');
} else {
  console.log('❌ 保底体力削减检查失败：' + fail + ' 项');
}
process.exitCode = fail === 0 ? 0 : 1;
