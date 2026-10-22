/*
 * check-tension-cap.js —— 复现并验证"张力被硬钳在 110 卡住"。
 *
 * ── 来自真实日志的证据 ────────────────────────────────────────────
 *   23:29:10  输入=收线  delta=+0.522  鱼拉=3.793  →  张力=43.77
 *   23:29:11  输入=收线  delta=+0.522  鱼拉=3.793  →  张力=110.00   ← 撞墙
 *   23:29:12  输入=放线  delta=-3.168  鱼拉=0.599  →  张力=99.72    ← 松手才动
 *
 * 玩家配置：钛合金线 + 合金竿 → 合成上限 220，白区 121，黄区 181。
 * 张力涨到 110 就被 `Math.min(110.0, tension)` 钳死：
 *   · 110 / 220 = 恰好在条子一半 → 看起来"卡中间"
 *   · 110 < 白区 121 → 永远进不了黄区、永远不会断线
 *
 * 用法：node tools/check-tension-cap.js
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
const sess = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing', 'FishingSession.java'), 'utf8');

// ---- 检查源码里还有没有"给张力夹上界"的常数 ----
console.log('=== 张力钳制检查 ===\n');
const clampUpper = /Math\.min\(\s*[\d.]+\s*,\s*this\.tension\s*\)/.exec(sess);
const clampUpper2 = /this\.tension\s*=\s*Math\.max\([^)]*Math\.min\(([\d.]+)/.exec(sess);
const bad = clampUpper || clampUpper2;
console.log('  源码里给张力夹上界的常数：' + (bad ? '❌ ' + (bad[1] || bad[0]) : '✅ 没有了'));
console.log('  只夹下界（>= 0）：'
  + (/this\.tension = Math\.max\(0\.0, this\.tension\);/.test(sess) ? '✅ 是' : '❌ 否'));

// ---- 用日志里的真实数值复算 ----
const CEIL = 220, WHITE = 121, YELLOW = 181;   // 日志里打出来的
const DELTA_REEL = 0.522, DELTA_RELEASE = -3.168;
const FISH_REST = 0.599, FISH_SPRINT = 3.793;

console.log('\n=== 复算：从日志那一刻（张力 43.77）开始长按左键 ===\n');
console.log('  配置：钛合金线 + 合金竿 → 上限 ' + CEIL + '，白区 ' + WHITE + '，黄区 ' + YELLOW);

/** 模拟：一直收线，鱼在"休息(0.599)/冲刺(3.793)"之间切换 */
function sim(withCap) {
  let t = 43.77;
  let sprint = false;
  let sprintLeft = 0;
  let tick = 0;
  const log = [];
  for (tick = 1; tick <= 600; tick++) {
    // 简化冲刺节奏：每 52 tick 冲 32 tick
    if (sprintLeft > 0) { sprintLeft--; sprint = sprintLeft > 0; }
    else if (tick % 52 === 0) { sprintLeft = 32; sprint = true; }
    else sprint = false;
    const fish = sprint ? FISH_SPRINT : FISH_REST;
    let gain = DELTA_REEL + fish;
    const floor = DELTA_REEL * 0.25;
    if (gain < floor) gain = floor;
    t = t + gain;
    if (withCap) t = Math.min(110.0, t);      // 修复前的硬钳
    t = Math.max(0.0, t);
    if (log.length < 8 || (withCap && Math.abs(t - 110.0) < 0.01 && log.length < 12)) {
      log.push('    tick ' + String(tick).padStart(3) + '  鱼' + (sprint ? '冲刺' : '休息')
        + '  张力=' + t.toFixed(2) + (withCap && Math.abs(t - 110.0) < 0.01 ? '  ← 卡在 110' : ''));
    }
    if (t >= CEIL) {
      return { reached: true, tick, t, log, secs: tick / 20 };
    }
  }
  return { reached: false, tick, t, log, secs: tick / 20 };
}

console.log('\n  --- 修复前（夹 Math.min(110.0, t)）---');
const before = sim(true);
before.log.slice(0, 10).forEach((l) => console.log(l));
console.log('    600 tick 后张力 = ' + before.t.toFixed(2)
  + '  → ' + (before.reached ? '断线' : '❌ 永远到不了上限 ' + CEIL));

console.log('\n  --- 修复后（不夹上界）---');
const after = sim(false);
after.log.slice(0, 8).forEach((l) => console.log(l));
console.log('    断线于第 ' + after.tick + ' tick（' + after.secs.toFixed(1) + ' 秒），张力 '
  + after.t.toFixed(2));

console.log('\n=== 断言 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

assert(!bad, '源码里不再有写死的张力上界（原来那个 110 是按基准竿定的）');
assert(!before.reached, '修复前：一直收线也到不了上限（被 110 钳死）——复现了"完全不动"');
assert(Math.abs(before.t - 110.0) < 0.01, '修复前张力精确停在 110（= 条子一半，玩家看到的位置）');
assert(before.t < WHITE, '修复前停在 110 < 白区 ' + WHITE + ' → 连黄区都进不去，所以才"怎么操作都不涨红"');
assert(after.reached, '修复后：同样长按左键会在 ' + after.secs.toFixed(1) + ' 秒内涨到上限并断线');

console.log('\n  说明：110 这个常数是按"木竿+麻线"的基准上限 100 定的，');
console.log('        但张力上限现在是 鱼线 × 鱼竿 **合成**出来的（最高 220+）。');
console.log('        高配玩家一撞 110 就永远卡住 —— 这是"卡中间"的真凶。');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
