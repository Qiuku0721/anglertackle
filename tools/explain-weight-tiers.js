// 回答一个具体问题：改了鱼的"体重上下限"，会影响品质判定吗？
//
// 做法：把 FishSpecies 的判定逻辑（tierSplit + tierForWeight）原样搬到离线脚本里，
// 用真实的档位表和真实的采样分布跑数，而不是读代码后的推断。
//
// ⚠️ 这个脚本的第一版写错了结论：我凭直觉认为"上下限一起平移会让占比变化"，
// 于是拿"平移 1kg"当证据 —— 结果跑出来三行都是 50/50。原因很简单：
// 判据用的是**相对位置** (w-min)/(max-min)，上下限同时乘/加同一个量时比例不变。
// 所以这里改成只做**会真正改变分布**的对照，并把这个反直觉的点写在最前面。
//
// 用法：node tools/explain-weight-tiers.js
const fs = require('fs'), path = require('path');
const { parseFish } = require('./fish-source.js');

const bak = fs.readFileSync(path.join(__dirname, '..',
  '参考资料/_before_fishcfg/FishSpecies.java.bak'), 'utf8');

const TIER_TABLES = {};
for (const m of bak.matchAll(/private static final int\[\] (\w+) = \{([^}]*)\}/g)) {
  TIER_TABLES[m[1]] = m[2].split(',').map((s) => Number(s.trim()));
}
const fishLiteral = parseFish(bak);
const TIER_CN = { 0: '白', 1: '绿', 2: '蓝', 3: '紫', 4: '金', 5: '红' };

/** 与 FishSpecies.tierSplit() 一致：金档权重 2、紫档 5、其余 6。 */
const tierSplit = (tiers) => tiers.map((t) => (t === 5 ? 2 : t === 4 ? 5 : 6));

/** 与 FishSpecies.tierForWeight() 一致。 */
function tierForWeight(tiers, minKg, maxKg, weightKg) {
  const n = tiers.length;
  const split = tierSplit(tiers);
  const total = split.reduce((a, b) => a + b, 0);
  const span = Math.max(1.0e-6, maxKg - minKg);
  const ratio = Math.max(0.0, Math.min(0.9999999, (weightKg - minKg) / span));
  const target = ratio * total;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += split[i];
    if (target < cum - 1.0e-9) return tiers[i];
  }
  return tiers[n - 1];
}

/** 在 [min,max] 内分层采样，统计各档占比。 */
function dist(tiers, minKg, maxKg, samples = 200000) {
  const cnt = new Map();
  for (let i = 0; i < samples; i++) {
    const w = minKg + (maxKg - minKg) * ((i + 0.5) / samples);
    const t = tierForWeight(tiers, minKg, maxKg, w);
    cnt.set(t, (cnt.get(t) || 0) + 1);
  }
  return [...cnt.entries()].sort((a, b) => a[0] - b[0])
    .map(([t, c]) => TIER_CN[t] + (c / samples * 100).toFixed(0) + '%').join(' ');
}

/** 某个档位的占比（0~1），用来做"某档变多了还是变少了"的对照。 */
function share(tiers, minKg, maxKg, tier, samples = 200000) {
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    const w = minKg + (maxKg - minKg) * ((i + 0.5) / samples);
    if (tierForWeight(tiers, minKg, maxKg, w) === tier) hit++;
  }
  return hit / samples;
}

const show = (label, tiers, min, max, ref) => {
  const d = dist(tiers, min, max);
  const mark = ref === undefined ? '' :
    '   绿档 ' + (share(tiers, min, max, 1) * 100).toFixed(0) + '%' +
    '（原 ' + (ref * 100).toFixed(0) + '%）';
  console.log('  ' + label.padEnd(22) + min + '~' + max + 'kg'.padEnd(8) + '→  ' + d + mark);
};

console.log('=== 关键：各档占比由**档位权重**决定，跟体重区间无关 ===');
console.log('档位权重是 tierSplit()：金档 2、紫档 5、其余 6（源码固定）。');
console.log('判档时先把相对位置映射到"权重总和"上，所以占比 = 该档权重 / 权重总和 ——');
console.log('上下限只决定"分界落在哪个体重"，不改变各档占多少比例。');
console.log('');

const crucian = fishLiteral.find((f) => f.id === 'crucian_carp');
const W_G = TIER_TABLES.W_G;
const base = share(W_G, crucian.minKg, crucian.maxKg, 1);
console.log('鲫鱼（{0,1} 权重 6:6），默认 ' + crucian.minKg + '~' + crucian.maxKg + 'kg：');
show('默认', W_G, crucian.minKg, crucian.maxKg, base);
show('整体平移 +1kg', W_G, crucian.minKg + 1, crucian.maxKg + 1, base);
show('整体 ×2', W_G, crucian.minKg * 2, crucian.maxKg * 2, base);
show('只把上限减半', W_G, crucian.minKg, crucian.maxKg / 2, base);
show('只把下限抬到 0.6', W_G, 0.6, crucian.maxKg, base);
show('只把上限抬到 3kg', W_G, crucian.minKg, 3.0, base);
console.log('  ↑ 六行占比完全一样（都是 6:6 → 50/50）—— 体重怎么改都不影响各档比例');
console.log('');

console.log('对比：换一张档位表（权重不同），占比立刻就变：');
console.log('  ' + '金红鱼（{4,5} 权重 5:2）'.padEnd(28) + '→  金' +
  (share(TIER_TABLES.G_R, 2, 22, 4) * 100).toFixed(0) + '% 红' +
  (share(TIER_TABLES.G_R, 2, 22, 5) * 100).toFixed(0) + '%    （红比金稀有）');
console.log('  ' + '紫金红鱼（{3,4,5} 权重 6:5:2）'.padEnd(28) + '→  紫' +
  (share(TIER_TABLES.P_G_R, 20, 100, 3) * 100).toFixed(0) + '% 金' +
  (share(TIER_TABLES.P_G_R, 20, 100, 4) * 100).toFixed(0) + '% 红' +
  (share(TIER_TABLES.P_G_R, 20, 100, 5) * 100).toFixed(0) + '%');
console.log('  → 红档天生就比金档稀有，这是**权重**定的，不是体重区间定的');
console.log('');

console.log('三档鱼同理（梭鲈 {1,2,3} 权重 6:6:6）：');
const zander = fishLiteral.find((f) => f.id === 'zander');
const G_B_P = TIER_TABLES.G_B_P;
show('默认', G_B_P, zander.minKg, zander.maxKg);
show('下限抬到 5kg', G_B_P, 5, zander.maxKg);
show('上限压到 3kg', G_B_P, zander.minKg, 3);
console.log('  ↑ 也是稳定 33/33/33');
console.log('');

console.log('=== 那改体重到底影响什么？===');
console.log('影响"分界落在哪个体重" —— 也就是**同一条鱼**会换档：');
console.log('');
{
  const t = W_G;
  const cases = [
    ['默认 0.1~1.2', crucian.minKg, crucian.maxKg],
    ['上限压到 0.6', crucian.minKg, crucian.maxKg / 2],
    ['整体 ×2 到 0.2~2.4', crucian.minKg * 2, crucian.maxKg * 2],
  ];
  for (const [label, lo, hi] of cases) {
    const mid = (lo + hi) / 2;
    const midTier = TIER_CN[tierForWeight(t, lo, hi, mid)];
    console.log('  ' + label.padEnd(22) + '中间体重 ' + mid.toFixed(2) + 'kg → ' + midTier + '档' +
      '   分界线在 ' + (lo + (hi - lo) * 0.5).toFixed(2) + 'kg');
  }
  console.log('');
  console.log('  同一个"0.6kg 的鲫鱼"：');
  for (const [label, lo, hi] of cases) {
    console.log('    ' + label.padEnd(22) + '→ ' + TIER_CN[tierForWeight(t, lo, hi, 0.6)] + '档');
  }
  console.log('  ↑ 这才是改体重上下限真正改变的东西：**同一个体重落在哪一档**');
}

console.log('=== 各鱼种的档位表（源码固定，配置里改不了）===');
const seen = new Map();
for (const f of fishLiteral) {
  if (!seen.has(f.tiers)) seen.set(f.tiers, []);
  seen.get(f.tiers).push(f.name);
}
for (const [tbl, names] of seen) {
  console.log('  ' + tbl.padEnd(8) +
    (TIER_TABLES[tbl] || []).map((x) => TIER_CN[x]).join('→').padEnd(14) +
    names.length + ' 种：' + names.join('、'));
}
console.log('');

console.log('=== 连带影响（改体重会顺带改变的东西）===');
console.log('1. 个体体重在 [下限,上限] 内采样');
console.log('   → 鱼获重量、图鉴里的最大/最小记录都跟着变');
console.log('2. buildPool 按 minKg 过滤竿的承重');
console.log('   → 把下限抬到超过某根竿的承重，那根竿就再也钓不到这种鱼');
console.log('3. 拟饵按**这条鱼的实际档位**过滤（金饵过滤蓝档以下）');
console.log('   → 各档**比例**不变（见上），但"某个具体体重算哪一档"变了，');
console.log('     所以某些个体能不能上钩会变 —— 不是变多变少，是换了一批个体');
console.log('4. 长度是按上限反推显示的（12 + cbrt(上限)×26）→ 只受上限影响');
