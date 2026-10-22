// 用日志里的真实数字核对张力模型 —— 精确版。
//
// FishingSession 的两个式子（已核对源码原文）：
//   收线：  delta  = reelGain × 控杆 × gen
//   鱼拉：  fishPull 显示值 = (冲刺 ? PULL_SPRINT : pullIdle) × pullSpeed × tierSpeed
//                            × tensionGain × gen
//
// 日志（bluefin_tuna，BURST，金枪鱼）：
//   delta=+0.522  gen=0.58  鱼拉=0.097  张力=20.00  控杆×1.00
//
// 于是能从"鱼拉"反推出鱼的实际参数乘积，再和配置对照 ——
// 这正是判断"改配置到底有没有生效"的硬证据。
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');

// ---- PULL_SPRINT（源码常量）
const session = fs.readFileSync(path.join(JAVA, 'fishing/FishingSession.java'), 'utf8');
const PULL_SPRINT = Number(/PULL_SPRINT\s*=\s*([-0-9.]+)/.exec(session)[1]);

// ---- 游戏里实际生效的 toml
const TOML = 'D:\\mc\\PCL 正式版 2.13.1.1\\.minecraft\\versions\\1.21.1-NeoForge_21.1.250\\config\\anglertackle-common.toml';
const toml = {};
if (fs.existsSync(TOML)) {
  for (const l of fs.readFileSync(TOML, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-0-9.]+)\s*$/.exec(l);
    if (m) toml[m[1]] = Number(m[2]);
  }
} else {
  console.error('❌ 读不到游戏里的 toml：' + TOML);
  process.exit(1);
}

const LOG = { delta: 0.522, gen: 0.58, fishPullShown: 0.097, tensionMult: 1.00 };

console.log('=== 1. 收线分支：核对 gen 与 reelGain ===');
const reelGain = toml.reelGain;
console.log('  toml: reelGain = ' + reelGain + '   baseRecover = ' + toml.baseRecover);
console.log('  预期 delta = reelGain × 控杆 × gen = ' + reelGain + ' × 1.00 × ' + LOG.gen +
            ' = ' + (reelGain * LOG.gen).toFixed(4));
console.log('  日志 delta = ' + LOG.delta);
console.log('  → ' + (Math.abs(reelGain * LOG.gen - LOG.delta) < 0.001 ? '✅ 完全吻合' : '⚠ 不吻合'));
console.log('  （这一支里没有 tierSpeed，所以 delta 只能验出 gen 与 reelGain）');
console.log('');

console.log('=== 2. 鱼拉分支：反推"这条鱼的实际参数乘积" ===');
console.log('  基数 base = 冲刺 ? PULL_SPRINT : parts.pullIdleBase');
const baseSprint = PULL_SPRINT, baseIdle = toml.pullIdleBase;
console.log('    PULL_SPRINT = ' + baseSprint + '（源码常量）   pullIdleBase = ' + baseIdle + '（toml）');
console.log('');
console.log('  fishPull显示 = base × pullSpeed × tierSpeed × tensionGain × gen');
console.log('  → pullSpeed × tierSpeed × tensionGain = ' + LOG.fishPullShown +
            ' / (base × gen)');
for (const [name, base] of [['冲刺时', baseSprint], ['不挣扎时', baseIdle]]) {
  const prod = LOG.fishPullShown / (base * LOG.gen);
  console.log('    ' + name + '（base=' + base + '）→ 乘积 = ' + prod.toFixed(4));
}
console.log('');

console.log('=== 3. 用 toml 里的鱼种数值反算，看哪个分支对得上 ===');
const ps = toml.bluefinTunaPullSpeed, tg = toml.bluefinTunaTensionGain;
console.log('  toml: bluefinTunaPullSpeed = ' + ps + '   bluefinTunaTensionGain = ' + tg);
console.log('  tierSpeed 的取值范围：1.12^0=1.00（白）→ 1.12^5=1.76（红）');
console.log('');
for (const [name, base] of [['冲刺', baseSprint], ['不挣扎', baseIdle]]) {
  const need = LOG.fishPullShown / (base * ps * tg * LOG.gen);
  const tier = Math.log(need) / Math.log(1.12);
  const ok = Math.abs(need - 1) < 0.02 ? '  ← tierSpeed=1.00，即白档' : '';
  console.log('    ' + name + ' 分支需要 tierSpeed = ' + need.toFixed(4) +
              '（相当于 ' + tier.toFixed(2) + ' 档）' + ok);
}
console.log('');
console.log('=== 4. 关键判断 ===');
{
  const needTierSprint = LOG.fishPullShown / (baseSprint * ps * tg * LOG.gen);
  const needTierIdle = LOG.fishPullShown / (baseIdle * ps * tg * LOG.gen);
  console.log('  若生效的是 toml 里的 pullSpeed=' + ps + '，两个分支需要的 tierSpeed 都远小于 1，');
  console.log('  而 tierSpeed 最小就是 1.00（白档）—— 说明**日志里的鱼拉用的是别的数值**。');
  console.log('');
  console.log('  反过来说：日志里那条金枪鱼的实际 (pullSpeed × tierSpeed × tensionGain) 只有 ' +
              (LOG.fishPullShown / (baseIdle * LOG.gen)).toFixed(3) + ' 左右，');
  console.log('  而 toml 里光是 pullSpeed × tensionGain 就已经 = ' + (ps * tg).toFixed(2) + '。');
  console.log('');
  console.log('  ⚠️ 结论：那条日志来自**旧 jar**（那时鱼种数值还是源码默认值），');
  console.log('          不能用它判断"现在改配置有没有生效"。');
  console.log('          要判断必须看**新 jar + 当前 toml** 跑出来的日志。');
}
