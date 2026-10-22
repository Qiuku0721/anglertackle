/*
 * check-bobber-cast.js —— 抛竿落点：既不原地落水，也要落在设计的 8 / 16 / 24 米。
 *
 * 这个检查器守着两件事，两件都是用户报过的：
 *
 * ① 用户 2026-10-02："现在的竿子只要靠近水源或坐在船上就容易原地下漂。"
 *    根因（`BobberEntity.scanForWater`）：落水判定只问"我下面几格有没有水"，
 *    完全没问"我自己降到水面了没有"。站岸边时——
 *        水面方块 y=0（水面高度 0.875）／眼睛 y≈2.62／浮漂起点 y≈2.82
 *        → 所在格往下查 dy=0,−1,−2 就扫到第 0 层的**水** → 第一 tick 判落水
 *        → 漂被吸到水面、原地砸在脚下。
 *    现在要求 **py <= 水方块 y + 流体高度 + 余量** 才算落水。
 *
 * ② 用户 2026-10-02："希望低头落点平视落点抬头落点跟之前差不多。"
 *    根因（`FishingManager.simulateRange`）：反解初速时按"起点与落点等高"算，
 *    而浮漂是从眼睛上 0.2 格出竿、落到**水面**上的 —— 岸边差约 1.9 格。
 *    浅发射角下这点落差能多飞好几米，于是"低头 8 米"实际打到 13.6 米。
 *    现在反解带上 `estimateDrop` 量出来的落差。
 *
 * 这个检查器不"只查源码里有没有那行字"，而是**把源码里的物理常量与规则读出来**，
 * 沿真实抛物线复算，断言：
 *   A. 落点 ≈ 设计值（8 / 16 / 24 米，容差 25%）——去掉落差这一步就会超到 60% 以上；
 *   B. 三种视线都不落脚下（≥ 4 米）；
 *   C. 低头 < 平视 < 抬头（"抬头 = 远"是用户定案的手感）；
 *   D. 落水判定里有"浮漂自己降到水面"这一步。
 *
 * 用法：node tools/check-bobber-cast.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**，用来做负向测试（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 抛竿落点检查（不原地落水 + 落点≈设计值）===\n');

const bobberPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/entity/BobberEntity.java');
const mgrPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingManager.java');
if (!fs.existsSync(bobberPath) || !fs.existsSync(mgrPath)) {
  fail('找不到 BobberEntity.java 或 FishingManager.java');
  console.log('\n❌ 抛竿落点检查未通过（1 项）');
  process.exit(1);
}

/** 剥掉注释（注释里会引用旧写法当反面教材）。 */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}
/** 取一个方法体（按大括号配平）。 */
function body(src, name) {
  const m = new RegExp('private[\\w <>\\[\\].]*?\\s' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}

const bobberCode = strip(fs.readFileSync(bobberPath, 'utf8'));
const mgrCode = strip(fs.readFileSync(mgrPath, 'utf8'));

// ---------------------------------------------------------------- 读源码常量
const mDrag = /final double drag = ([0-9.]+), gravity = ([0-9.]+);/.exec(bobberCode);
const mMargin = /WATER_LAND_MARGIN = ([0-9.]+)/.exec(bobberCode);
const scan = body(bobberCode, 'scanForWater');
const mDist = /double distance = eyeDeg < (-?\d+) \? ([\d.]+) : eyeDeg < (-?\d+) \? ([\d.]+) : ([\d.]+);/.exec(mgrCode);
const mLaunch = /double launchDeg = Math\.max\(([\d.]+), Math\.min\(([\d.]+), eyeDeg\)\);/.exec(mgrCode);
const simBody = body(mgrCode, 'simulateRange');

if (!mDrag || !mMargin || !scan || !mDist || !mLaunch || !simBody) {
  fail('读不出关键常量：' + [
    mDrag ? '' : 'BobberEntity 的 drag/gravity',
    mMargin ? '' : 'WATER_LAND_MARGIN',
    scan ? '' : 'scanForWater()',
    mDist ? '' : 'FishingManager 的 distance 分段',
    mLaunch ? '' : 'FishingManager 的 launchDeg 夹取',
    simBody ? '' : 'simulateRange()',
  ].filter(Boolean).join(' / '));
  console.log('\n❌ 抛竿落点检查未通过（' + bad + ' 项）');
  process.exit(1);
}

const DRAG = Number(mDrag[1]), GRAVITY = Number(mDrag[2]);
const MARGIN = Number(mMargin[1]);
const TARGETS = [Number(mDist[2]), Number(mDist[4]), Number(mDist[5])];

// ① 落水判定里有没有"必须降到水面"这一步
const hasHeightGuard = /getHeight\s*\(/.test(scan) && /(py|this\.getY\(\))\s*<=\s*surface/.test(scan);
ok('物理参数取自源码：阻力 ' + DRAG + ' / 重力 ' + GRAVITY + ' / 落水余量 ' + MARGIN);
if (hasHeightGuard) {
  ok('落水判定里有"浮漂自己降到水面"这一步（py <= 水方块 y + 流体高度 + 余量）');
} else {
  fail('落水判定只看"下面有没有水" —— 站岸边/坐船上时眼睛下方一两格就是水，' +
    '浮漂出竿第一 tick 就判落水、原地砸在脚下（用户 2026-10-02 报的就是这个）');
}

// ② 射程反解有没有把"起点比水面高多少格"算进去
//
// 只验"源码里出现过 drop"是不够的：真正决定行为的是 simulateRange 里 y 的初值。
// 所以这里把两条都读出来，并用它决定下面按哪个模型复算。
// ⚠ 这里第一版写成 `/double\s+y\s*=\s*drop/`，而源码是 `double x = 0, y = drop;`
//   —— `double` 和 `y` 不相邻，匹配不上，于是**修好的代码被报成没修**。
//   改成"simulateRange 里确实把 drop 当值用了"（不依赖变量名，重命名也不会误报）。
const solveHonorsDrop = /=\s*drop\s*[;,)]/.test(simBody)
  && /solveSpeed\(\s*distance\s*,\s*angle\s*,\s*drop\s*\)/.test(mgrCode)
  && /estimateDrop\s*\(/.test(mgrCode);
if (solveHonorsDrop) {
  ok('射程反解带上了"起点比水面高多少格"（estimateDrop → solveSpeed(…, drop)）');
} else {
  fail('射程反解按"起步与落点等高"算 —— 浮漂实际从水面上方约 1.9 格出竿，' +
    '浅发射角下会多飞好几米（低头 8 米打成 13.6 米）。用户 2026-10-02：' +
    '"希望低头落点平视落点抬头落点跟之前差不多"');
}

// ---------------------------------------------------------------- 复算
/** 与 FishingManager.simulateRange 一致：起点在落点上方 drop 处。 */
function simulateRange(speed, angleRad, drop) {
  let vx = speed * Math.cos(angleRad), vy = speed * Math.sin(angleRad);
  let x = 0, y = drop;
  for (let t = 0; t < 400; t++) {
    x += vx; y += vy;
    vx *= DRAG; vy = vy * DRAG - GRAVITY;
    if (y <= 0 && t > 2) break;
  }
  return x;
}
function solveSpeed(target, angleRad, drop) {
  let lo = 0.2, hi = 4.0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (simulateRange(mid, angleRad, drop) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 真实弹道：起点在**水面上方 drop 格**（castProjectile 里那句 add(0, 0.2, 0)），
 * 落到水面为止。反解按源码的实际做法（带 / 不带落差）。
 */
function castDistance(pitchDeg, eyeAboveWater) {
  const eyeDeg = -pitchDeg;                       // MC 的 xRot 向下为正
  const target = eyeDeg < Number(mDist[1]) ? TARGETS[0]
    : eyeDeg < Number(mDist[3]) ? TARGETS[1] : TARGETS[2];
  const launchDeg = Math.max(Number(mLaunch[1]), Math.min(Number(mLaunch[2]), eyeDeg));
  const angle = launchDeg * Math.PI / 180;
  const drop = eyeAboveWater + 0.2;               // 真实落差：水面 → 出竿点
  const speed = solveSpeed(target, angle, solveHonorsDrop ? drop : 0);

  const SURFACE = 0.875;                          // 水方块顶面（满水）
  let vx = speed * Math.cos(angle), vy = speed * Math.sin(angle);
  let x = 0, y = SURFACE + drop;
  for (let t = 0; t < 400; t++) {
    x += vx; y += vy;
    vx *= DRAG; vy = vy * DRAG - GRAVITY;
    const landed = hasHeightGuard ? y <= SURFACE + MARGIN : y <= SURFACE + 2.0;
    if (landed) return { x, target };
  }
  return { x, target };
}

// ⚠ MC 的 xRot **向下为正**（FishingManager 里那句 `double eyeDeg = -pitch;`），
//   所以"低头看水面"要传 +40、"抬头"要传 −30。第一版写反了，
//   测出来"抬头最短"，看着像代码坏了，其实是这个检查器的用例反了。
const CASES = [['低头看水面', 40], ['平视', 0], ['抬头', -30]];
// 岸边站着抛：眼高约 1.62 格；坐船上更低，约 1.40 格
const STANCES = [['岸边', 1.62], ['船上', 1.40]];

const perStance = [];
let worstDev = 0, worstMsg = '', worstNear = Infinity;
for (const [stance, eyeH] of STANCES) {
  const got = CASES.map(([label, pitch]) => [label, castDistance(pitch, eyeH)]);
  perStance.push([stance, got]);
  console.log('  ' + stance + '（眼高离水面 ' + eyeH + ' 格）：' +
    got.map(([l, r]) => l + ' ' + r.x.toFixed(1) + ' 米（设计 ' + r.target + '）').join('  '));
  for (const [label, r] of got) {
    const dev = Math.abs(r.x - r.target) / r.target;
    if (dev > worstDev) { worstDev = dev; worstMsg = stance + ' · ' + label + '：' + r.x.toFixed(1) + ' 米 vs 设计 ' + r.target + ' 米'; }
    worstNear = Math.min(worstNear, r.x);
  }
}

// ---- A 落点 ≈ 设计值 ----
if (worstDev <= 0.25) {
  ok('三种视线的落点都贴着设计值（最大偏差 ' + (worstDev * 100).toFixed(0) + '%）');
} else {
  fail('落点偏离设计值：' + worstMsg + '（偏差 ' + (worstDev * 100).toFixed(0) + '%，容差 25%）—— ' +
    '多半是射程反解没算"起点比水面高多少格"');
}

// ---- B 不能落在脚下 ----
if (worstNear >= 4.0) {
  ok('三种视线都不会原地落水（最短 ' + worstNear.toFixed(1) + ' 米 ≥ 4 米）');
} else {
  fail('有视线角度**原地落水**：最短只有 ' + worstNear.toFixed(1) +
    ' 米 —— 说明落水判定在出竿那一刻就命中了（漂被吸到脚下，看起来就是"原地下漂"）');
}

// ---- C 抬头 = 远 ----
for (const [stance, got] of perStance) {
  const near = got[0][1].x, mid = got[1][1].x, far = got[2][1].x;
  if (near < mid && mid < far) {
    ok(stance + '：低头 < 平视 < 抬头（' + near.toFixed(1) + ' < ' + mid.toFixed(1) +
      ' < ' + far.toFixed(1) + ' 米）');
  } else {
    fail(stance + '：低头/平视/抬头 的距离不是递增（' + near.toFixed(1) + ' / ' +
      mid.toFixed(1) + ' / ' + far.toFixed(1) + '）—— "抬头 = 远"是用户定案的手感，不能反');
  }
}

console.log('');
console.log(bad === 0
  ? '✅ 抛竿会真的飞出去，且落点贴着设计的 8 / 16 / 24 米'
  : '❌ 抛竿落点检查未通过（' + bad + ' 项）');
process.exitCode = bad === 0 ? 0 : 1;
