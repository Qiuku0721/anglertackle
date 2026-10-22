// 锁定"打窝料必须真的能丢出去、而且丢得够远"这条。
//
// 背景：玩家反馈"右键在脚下创建了圈，需要的丢出看不到"。
// 两个原因（都已修）：
//   ① 站在水边/浅水里时眼睛下方一两格就是水，scanForWater 第一 tick 就命中，
//      实体原地落水 → 白圈套在脚下。需要"上升阶段不判落水 + 最短滞空"。
//   ② 渲染器在 !isLanded() 时直接 return，飞行中什么都不画，
//      所以"丢出去看不到实体"，直到远处突然冒出圈。
//
// 2026-10-02 用户："打窝料可以稍微再抛远一点。" 又补了三件事：
//   ③ 落水判定必须"窝料自己降到水面"（原来只看脚下 0~−2 格有没有水，
//      于是在离水面还有两三格时就落水 → 射程凭空少一截，浅角度下差得最多）；
//   ④ 初速改成具名常量 THROW_SPEED = 0.85；
//   ⑤ ⑤⑥ 两条**数值**断言：按源码里的初速/物理/落水规则复算射程，
//      15° 必须 ≥13 米（挡"又变回提前落水"）、45° 必须 ≥18 米（挡"初速被调回去"）。
const fs=require('fs'),path=require('path');
// 玩法数值现在住在配置文件里（[gameplay] 组），源码里没有对应常量了。
// 统一从 tools/tuning.js 的 cfg 取"游戏里实际生效的默认值"。
const __gameplayCfg = require('./tuning.js').cfg;
function __gameplay(key, fallback) {
  if (key in __gameplayCfg) return __gameplayCfg[key];
  throw new Error('配置里没有 ' + key + ' —— 检查 Config.java 的 [gameplay] 组');
}

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**，用来做负向测试（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8')
  .replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

const CE=read('src/main/java/com/whitecobalt/anglertackle/entity/ChumEntity.java');
const CR=read('src/main/java/com/whitecobalt/anglertackle/client/render/ChumRenderer.java');

// ① 最短滞空
// ⚠️ 这个值现在住在配置里（[gameplay] chumMinAirTicks），源码里没有常量了。
// 判据改成"读配置 + 确认代码真的用它卡滞空"，而不是 grep 常量定义。
const chumAir = require('./tuning.js').cfg.chumMinAirTicks;
if (typeof chumAir === 'number' && chumAir > 0) {
  ok('最短滞空可配（[gameplay] chumMinAirTicks = ' + chumAir + ' tick）');
} else { no('配置里没有 chumMinAirTicks（最短滞空无法调整）'); }
if (/Tuning\.chumMinAirTicks\(\)/.test(CE)) { ok('代码走配置读取最短滞空'); }
else { no('代码没有从配置读最短滞空 —— 改了配置不会生效'); }
if (/tickCount\s*<\s*Tuning\.chumMinAirTicks\(\)/.test(CE)) { ok('滞空不足时不判落水'); }
else { no('没有用 tickCount 卡最短滞空'); }

// ② 上升阶段不判落水
if(/motionY\(\)\s*>\s*0/.test(CE)) ok('上升阶段不判落水');
else no('没有"上升阶段不判落水"（站在水里抛会原地落）');

// ③ 飞行中要画东西
const fly=CR.match(/if\s*\(!entity\.isLanded\(\)\)\s*\{([\s\S]*?)\n        \}/);
if(!fly) no('渲染器没有处理飞行分支');
else if(/return\s*;/.test(fly[1])&&!/drawCube|drawRing/.test(fly[1]))
  no('飞行分支直接 return，丢出去看不见实体');
else ok('飞行中会画东西（drawCube）');
if(/drawCube/.test(CR)) ok('有窝料团的绘制');
else no('没有窝料团绘制');

// ④ 白圈半径仍与 ChumManager 同源。
// 注意是 radius() 而不是 RADIUS —— 半径现在是方法（现读配置），
// 早先那个 static 常量写法会让游戏在配置加载前崩，已经删掉了。
if(/ChumManager\.radius\(\)/.test(CR)) ok('白圈半径读 ChumManager.radius()');
else if(/ChumManager\.RADIUS/.test(CR)) no('渲染器还在用已删除的 ChumManager.RADIUS（编译不过）');
else no('白圈半径没有同源');

// ------------------------------------------------------------------ ⑤⑥ 射程
// 把源码里的初速/物理/落水规则**读出来**再复算，而不是只 grep 有没有那行字。
const mSpeed = /THROW_SPEED\s*=\s*([0-9.]+)/.exec(CE);
const mDrag = /final double drag = ([0-9.]+), gravity = ([0-9.]+);/.exec(CE);
const mLaunch = /Math\.max\(([0-9.]+),\s*Math\.min\(([0-9.]+),\s*-pitch\)\)/.exec(CE);
const mEye = /getEyeY\(\)\s*-\s*([0-9.]+)/.exec(CE);
const mMargin = /WATER_LAND_MARGIN\s*=\s*([0-9.]+)/.exec(CE);
if (!mSpeed || !mDrag || !mLaunch || !mEye || !mMargin) {
  no('读不出关键常量：' + [
    mSpeed ? '' : 'THROW_SPEED', mDrag ? '' : 'drag/gravity', mLaunch ? '' : '发射角夹取',
    mEye ? '' : 'getEyeY() 偏移', mMargin ? '' : 'WATER_LAND_MARGIN',
  ].filter(Boolean).join(' / '));
} else {
  // ⑤ 落水判定里必须有"窝料自己降到水面"这一步
  const hasHeightGuard = /getHeight\s*\(/.test(CE) && /this\.getY\(\)\s*<=\s*surface/.test(CE);
  if (hasHeightGuard) {
    ok('落水判定里有"窝料自己降到水面"这一步（getY() <= 水面高度 + 余量）');
  } else {
    no('落水判定只看"脚下 0~−2 格有没有水" —— 窝料在离水面还有两三格时就落水，' +
      '射程凭空少一截（用户 2026-10-02："打窝料可以稍微再抛远一点"）');
  }

  const SPEED = Number(mSpeed[1]), DRAG = Number(mDrag[1]), GRAVITY = Number(mDrag[2]);
  const MIN_DEG = Number(mLaunch[1]), MAX_DEG = Number(mLaunch[2]);
  const EYE_OFFSET = Number(mEye[1]), MARGIN = Number(mMargin[1]);
  const SURFACE = 0.875;                       // 水方块顶面（满水）
  const EYE_ABOVE_WATER = 1.62;                // 站岸边：眼睛离水面约 1.62 格

  /** 复算射程：起点 = 水面 + 眼高 − 0.1；仰角 = clamp(−pitch)；物理与源码一致。 */
  function range(pitchDeg) {
    const launchDeg = Math.max(MIN_DEG, Math.min(MAX_DEG, -pitchDeg));
    const rad = launchDeg * Math.PI / 180;
    let vx = Math.cos(rad) * SPEED;
    let vy = Math.sin(rad) * SPEED;
    let x = 0, y = SURFACE + EYE_ABOVE_WATER - EYE_OFFSET;
    for (let t = 1; t <= 400; t++) {
      x += vx; y += vy;
      vx *= DRAG; vy = vy * DRAG - GRAVITY;
      if (vy > 0 || t < chumAir) continue;     // 上升 / 最短滞空：不判落水
      const landed = hasHeightGuard
        ? y <= SURFACE + MARGIN                // ★ 修好：自己降到水面
        : y <= SURFACE + 2.15;                 // 坏：脚下 0~−2 格里有水就算
      if (landed) return x;
    }
    return x;
  }

  const flat = range(0), up15 = range(-15), up30 = range(-30), up45 = range(-45);
  console.log('   射程复算（初速 ' + SPEED + '，眼高 ' + EYE_ABOVE_WATER + '）：' +
    '平视 ' + flat.toFixed(1) + ' / 抬头15° ' + up15.toFixed(1) +
    ' / 30° ' + up30.toFixed(1) + ' / 45° ' + up45.toFixed(1) + ' 米');

  // ⑥ 数值断言
  if (up15 >= 13.0) {
    ok('抬头 15° 能抛到 ' + up15.toFixed(1) + ' 米（≥13）—— 落水判定没有提前落水');
  } else {
    no('抬头 15° 只有 ' + up15.toFixed(1) + ' 米（要求 ≥13）—— 多半是落水判定又变成' +
      '"脚下 0~−2 格有水就落"，窝料在离水面两三格时就停下了');
  }
  if (up45 >= 18.0) {
    ok('抬头 45° 能抛到 ' + up45.toFixed(1) + ' 米（≥18）—— 初速没有被调回去');
  } else {
    no('抬头 45° 只有 ' + up45.toFixed(1) + ' 米（要求 ≥18）—— 初速 THROW_SPEED 被调小了' +
      '（用户要的是"稍微再抛远一点"，不是更近）');
  }
  if (flat >= 7.0) {
    ok('平视也能抛 ' + flat.toFixed(1) + ' 米（≥7）—— 不会掉在脚下');
  } else {
    no('平视只有 ' + flat.toFixed(1) + ' 米（要求 ≥7）—— 平抛掉在脚边');
  }
  if (flat < up15 && up15 < up30 && up45 >= up30 * 0.95) {
    ok('抬头 = 远（平视 ' + flat.toFixed(1) + ' < 15° ' + up15.toFixed(1) +
      ' < 30° ' + up30.toFixed(1) + ' ≈ 45° ' + up45.toFixed(1) + '）');
  } else {
    no('射程不随抬头递增 —— 玩家按抛竿的手感抬头会把窝子丢到脚边（"抬头 = 远"是定案的手感）');
  }
}

console.log(bad===0?'\n✅ 打窝料可以正常丢出、可见、且抛得够远':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
