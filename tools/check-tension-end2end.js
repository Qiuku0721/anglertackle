/*
 * check-tension-end2end.js —— 端到端复算：**长按左键收线时，张力到底涨不涨**。
 *
 * 玩家反复报"张力条卡中间"，我改了三轮公式都没根治。这个脚本把所有
 * 参与张力计算的项**逐条从源码读出来**，然后按真实顺序复算，
 * 而不是我凭记忆手写公式 —— 前三轮的修法都是基于手写公式推的，
 * 只要有一项读错，推论就全错。
 *
 * 用法：node tools/check-tension-end2end.js
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

const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const ROOT = ATL_ROOT;
const SRC = path.join(ROOT, 'src', 'main', 'java', 'com', 'whitecobalt', 'anglertackle');
const sess = fs.readFileSync(path.join(SRC, 'fishing', 'FishingSession.java'), 'utf8');
const comp = fs.readFileSync(path.join(SRC, 'fishing', 'PartComposer.java'), 'utf8');

// 调参值统一从 tools/tuning.js 取（读 Config.java 的默认值 + 源码里仍有的常量）。
// 曾经这里直接正则抓 Java 源码里的常量，常量一搬进 Config.java 就全线崩。
const TUNE = require('./tuning.js');

function constOf(src, name) {
  // ① tuning.js 的派生量优先（游戏里的实际生效值）
  if (TUNE[name] !== undefined) return TUNE[name];
  // ② [gameplay] 里的同名配置。这轮把一批玩法常量接进了配置
  //    （PULL_SPRINT / MIN_REEL_GAIN_RATIO / MAX_FISH_SLOWDOWN …），
  //    源码里已经没有 `static final double X = …` 可抓了。
  //    命名转换：PULL_SPRINT → pullSprint。
  const camel = name.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const cfg = TUNE.cfg || {};
  if (typeof cfg[camel] === 'number') return cfg[camel];
  // ③ 兜底：源码里仍是常量的（例如与注册期绑定的那些）
  const m = new RegExp('(?:private |public )?static final double ' + name + '\\s*=\\s*([\\d.]+)\\s*;')
    .exec(src);
  if (!m) throw new Error('没找到常量 ' + name + '（配置里也没有 ' + camel + '）');
  return Number(m[1]);
}

const REEL_GAIN = constOf(sess, 'REEL_GAIN');
const RELEASE_LOSS = constOf(sess, 'RELEASE_LOSS');
const IDLE_LOSS = constOf(sess, 'IDLE_LOSS');
const PULL_IDLE = constOf(sess, 'PULL_IDLE');
const PULL_SPRINT = constOf(sess, 'PULL_SPRINT');
const MIN_REEL_GAIN_RATIO = constOf(sess, 'MIN_REEL_GAIN_RATIO');
const MAX_FISH_SLOWDOWN = constOf(sess, 'MAX_FISH_SLOWDOWN');
const BASE_RECOVER = constOf(comp, 'BASE_TENSION_RECOVER');
const W_LINE_ON_TENSION = TUNE.cfg.lineOnTension;
const W_ROD_ON_TENSION = TUNE.cfg.rodOnTension;
const W_LINE_ON_RECOVER = TUNE.cfg.lineOnRecover;
const W_ROD_ON_RECOVER = TUNE.cfg.rodOnRecover;
const CAP_TENSION_CEILING = constOf(comp, 'CAP_TENSION_CEILING');

console.log('=== 从源码读出的常量 ===\n');
console.log('  张力：REEL_GAIN=' + REEL_GAIN + '  RELEASE_LOSS=' + RELEASE_LOSS
  + '  IDLE_LOSS=' + IDLE_LOSS);
console.log('  鱼拉：PULL_IDLE=' + PULL_IDLE + '  PULL_SPRINT=' + PULL_SPRINT);
console.log('  钳制：MIN_REEL_GAIN_RATIO=' + MIN_REEL_GAIN_RATIO
  + '  MAX_FISH_SLOWDOWN=' + MAX_FISH_SLOWDOWN);
console.log('  合成：BASE_RECOVER=' + BASE_RECOVER + '  线/竿权重(上限)=' + W_LINE_ON_TENSION
  + '/' + W_ROD_ON_TENSION + '  (回复)=' + W_LINE_ON_RECOVER + '/' + W_ROD_ON_RECOVER);
console.log('  硬顶：CAP_TENSION_CEILING=' + CAP_TENSION_CEILING);

const tierSpeed = (t) => Math.pow(1.12, t);
const weighted = (m, w) => 1 + (m - 1) * w;
const composeCeiling = (rodC, lineC) =>
  Math.min(100 * weighted(lineC, W_LINE_ON_TENSION) * weighted(rodC, W_ROD_ON_TENSION),
    100 * CAP_TENSION_CEILING);
const composeRecover = (rodR, lineR) =>
  BASE_RECOVER * weighted(lineR, W_LINE_ON_RECOVER) * weighted(rodR, W_ROD_ON_RECOVER);

// 用户截图里的线长是 79 米 —— 对应 PE(65×?) 或钛合金(70×?)。
// 先反查哪条线能显示成 79 米。
const LINES = [
  { name: '麻线', ceil: 1.00, gen: 1.00, rec: 1.00, len: 30 },
  { name: '棉线', ceil: 1.20, gen: 0.91, rec: 1.15, len: 35 },
  { name: '尼龙线', ceil: 1.28, gen: 0.95, rec: 1.30, len: 45 },
  { name: '碳氟线', ceil: 1.54, gen: 0.81, rec: 1.36, len: 55 },
  { name: 'PE线', ceil: 1.94, gen: 0.76, rec: 1.44, len: 65 },
  { name: '钛合金线', ceil: 2.20, gen: 0.58, rec: 1.76, len: 70 },
];
const RODS = [
  { name: '木竿', ceil: 1.00, rec: 1.00 },
  { name: '铁竿', ceil: 1.20, rec: 1.20 },
  { name: '金竿', ceil: 1.10, rec: 1.15 },
  { name: '钻竿', ceil: 1.60, rec: 1.70 },
  { name: '合金竿', ceil: 1.70, rec: 1.90 },
];
const FISH = [
  { name: '鲫鱼(白)', pull: 0.70, gain: 0.90, tier: 0 },
  { name: '翘嘴(紫)', pull: 1.35, gain: 1.20, tier: 3 },
  { name: '梭鲈(紫)', pull: 1.45, gain: 1.30, tier: 3 },
  { name: '鲑(金)', pull: 3.125, gain: 1.25, tier: 4 },
  { name: '金枪鱼(金)', pull: 3.4375, gain: 1.50, tier: 4 },
  { name: '幼鲨(红)', pull: 3.625, gain: 1.70, tier: 5 },
];

console.log('\n=== 收线时张力涨速（点/tick），合金竿 ===\n');
console.log('  鱼种          鱼线        上限   gen   控杆×0.50  控杆×1.00  控杆×1.40   判定');
console.log('  ' + '-'.repeat(94));
const MULT = { 正拉: 0.50, 中立: 1.00, 反拉: 1.40 };
const ROD_ALLOY = RODS.find((x) => x.name === '合金竿');
let slow = 0;
for (const f of FISH) {
  for (const l of LINES) {
    const ceil = composeCeiling(ROD_ALLOY.ceil, l.ceil);
    const fishT = PULL_IDLE * f.pull * tierSpeed(f.tier) * f.gain * l.gen;
    const col = {};
    for (const [k, m] of Object.entries(MULT)) {
      const delta = REEL_GAIN * m * l.gen;
      const ft = fishT * m;
      let gain = delta + ft;
      const floor = delta * MIN_REEL_GAIN_RATIO;
      if (gain < floor) gain = floor;
      col[k] = gain;
    }
    const show = (l.name === '钛合金线' || f.name === '幼鲨(红)');
    // 判"慢"：中立控杆下每秒涨不到 2 点
    if (col['中立'] * 20 < 2.0) slow++;
    if (show) {
      console.log('  ' + f.name.padEnd(13) + l.name.padEnd(12)
        + String(ceil.toFixed(0)).padEnd(6) + String(l.gen.toFixed(2)).padEnd(6)
        + col['正拉'].toFixed(3).padEnd(11) + col['中立'].toFixed(3).padEnd(11)
        + col['反拉'].toFixed(3).padEnd(11)
        + (col['中立'] * 20 < 2.0 ? '⚠ 极慢' : '正常'));
    }
  }
}
console.log('\n  慢的组合数（中立控杆下每秒不到 2 点）= ' + slow);

console.log('\n=== 关键：收线时"收线涨 + 鱼拉"是否恰好抵消 ===\n');
console.log('  公式：delta = REEL_GAIN × tensionMult × gen       （控杆关系只乘这一项）');
console.log('        鱼拉   = PULL_IDLE × pullSpeed × tierSpeed × tensionGain × gen');
console.log('        （鱼的拉力**不含** tensionMult —— 这是我前三轮算错的地方）\n');
console.log('  控杆关系：正拉 ×0.50 / 中立 ×1.00 / 反拉 ×1.40（只作用于 delta）\n');
console.log('  鱼种          鱼线        gen   正拉:delta+鱼拉   中立:delta+鱼拉   反拉:delta+鱼拉');
console.log('  ' + '-'.repeat(92));
for (const f of FISH) {
  for (const l of LINES) {
    const fishT = PULL_IDLE * f.pull * tierSpeed(f.tier) * f.gain * l.gen;
    const vals = Object.entries(MULT).map(([k, m]) => {
      const delta = REEL_GAIN * m * l.gen;
      let gain = delta + fishT;
      const floor = delta * MIN_REEL_GAIN_RATIO;
      const clamped = gain < floor;
      if (clamped) gain = floor;
      return (gain >= 0 ? '+' : '') + gain.toFixed(3) + (clamped ? '*' : ' ');
    });
    const show = (l.name === '钛合金线' || f.name === '幼鲨(红)');
    if (show) {
      console.log('  ' + f.name.padEnd(13) + l.name.padEnd(11)
        + String(l.gen.toFixed(2)).padEnd(6)
        + vals[0].padEnd(18) + vals[1].padEnd(18) + vals[2]);
    }
  }
}
console.log('\n  *= 被 MIN_REEL_GAIN_RATIO 下限钳住（说明鱼拉原本把它压成了负数）');
console.log('  如果某一列恰好是 +0.000，那就是"完全不动"——玩家报的现象。');
{
  const l = LINES.find((x) => x.name === '钛合金线');
  const r = RODS.find((x) => x.name === '合金竿');
  const ceil = composeCeiling(r.ceil, l.ceil);
  const rec = composeRecover(r.rec, l.rec);
  const recoverMult = rec / BASE_RECOVER;
  console.log('  合成张力上限 = ' + ceil.toFixed(1) + ' 点');
  console.log('    白区 = ' + (ceil * 0.55).toFixed(1) + ' 点   黄区 = ' + (ceil * 0.82).toFixed(1) + ' 点');
  console.log('  合成张力回复 = ' + rec.toFixed(2) + '（倍率 ×' + recoverMult.toFixed(2) + '）');
  console.log('  张力生成倍率 = ' + l.gen);
  console.log('');
  console.log('  收线每 tick 涨（中立控杆）与"涨到断线要多久"：');
  for (const f of FISH) {
    const delta = REEL_GAIN * 1.00 * l.gen;
    const fishT = PULL_IDLE * f.pull * tierSpeed(f.tier) * f.gain * l.gen;
    let gain = delta + fishT;
    const floor = delta * MIN_REEL_GAIN_RATIO;
    const clamped = gain < floor;
    if (clamped) gain = floor;
    // 从白区中点涨到黄区上限需要多少秒
    const from = ceil * 0.55 * 0.5;
    const to = ceil * 0.82;
    const secs = (to - from) / (gain * 20);
    console.log('    ' + f.name.padEnd(13)
      + '收线涨 ' + delta.toFixed(3) + '  鱼拉 ' + fishT.toFixed(3)
      + '  实际 ' + gain.toFixed(3) + '/tick（' + (gain * 20).toFixed(1) + '/秒）'
      + (clamped ? ' ← 被下限钳住' : '')
      + '  从半白区到黄区顶要 ' + secs.toFixed(1) + ' 秒');
  }
  console.log('\n  ⚠ 如果"实际"那一列很小（< 0.05/tick = 每秒不到 1 点），');
  console.log('    玩家就会觉得"条子不动"—— 即使它在涨。这是手感问题，不是逻辑错误。');
  console.log('    前三轮我一直在找"逻辑上不动"的原因，但可能真凶是"涨得太慢，看起来不动"。');
}

console.log('\n=== 你的配置（合金竿 + 钛合金线）===\n');
console.log('\n=== 中立（松手）时每 tick 的回落，合金竿 + 钛合金线 ===\n');
{
  const l = LINES.find((x) => x.name === '钛合金线');
  const r = RODS.find((x) => x.name === '合金竿');
  const rec = composeRecover(r.rec, l.rec);
  const recoverMult = rec / BASE_RECOVER;
  const fall = IDLE_LOSS * recoverMult;
  console.log('  回落 = ' + IDLE_LOSS + ' × ' + recoverMult.toFixed(2) + ' = '
    + fall.toFixed(3) + '/tick（' + (fall * 20).toFixed(1) + '/秒）');
  console.log('');
  for (const f of FISH) {
    const fishT = PULL_IDLE * f.pull * tierSpeed(f.tier) * f.gain * l.gen;
    const capped = Math.min(fishT, fall * MAX_FISH_SLOWDOWN);
    const net = capped - fall;
    console.log('    ' + f.name.padEnd(13) + '鱼拉 ' + fishT.toFixed(3)
      + '  实际净变化 ' + net.toFixed(3) + '/tick（' + (net * 20).toFixed(1) + '/秒）'
      + (Math.abs(net * 20) < 1.0 ? '  ⚠ 每秒不到 1 点 —— 看起来就是不动' : ''));
  }
}
