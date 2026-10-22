/*
 * dump-fish.js —— 鱼种全表：体重/品质分界（**按真实的权重划分算**）、竿型、手感档案。
 *
 * 触发理由：dump-tables.js 里那张鱼种表是按"体重等分"算分界点的，
 * 但 tierForWeight 早就改成**按 tierSplit 的权重划分**了
 * （金:红 = 5:2，为了让红鱼真比金鱼稀有）。
 * 于是那张表的每个分界点都是错的 —— 玩家按它推"多大算金鱼"会全错。
 *
 * 这个脚本做三件事：
 *   ① 从 FishSpecies.java 读 tierSplit 权重，按真实算法算分界点
 *   ② 附上每种鱼的体重→体长对应（体长按体重开三次方映射）
 *   ③ 列出各品质档的实际出现概率（用真实的体重分布，不是均匀分布）
 *
 * 用法：node tools/dump-fish.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing', 'FishSpecies.java');
const src = fs.readFileSync(SRC, 'utf8');

// ---- 读 tierSplit 的 switch 规则 ----
const tsBody = /public int\[\] tierSplit\(\)\s*\{([\s\S]*?)\n    \}/.exec(src);
if (!tsBody) throw new Error('没找到 tierSplit()');
const SPLIT = {};
{
  const re = /case (\d+) -> (\d+);/g;
  let m;
  while ((m = re.exec(tsBody[1])) !== null) SPLIT[Number(m[1])] = Number(m[2]);
  const def = /default -> (\d+);/.exec(tsBody[1]);
  SPLIT.default = def ? Number(def[1]) : 1;
}
const splitOf = (t) => SPLIT[t] !== undefined ? SPLIT[t] : SPLIT.default;

// ---- 读鱼种 ----
const TIERSETS = {};
{
  const re = /private static final int\[\] (\w+) = \{([^}]*)\};/g;
  let m;
  while ((m = re.exec(src)) !== null) TIERSETS[m[1]] = m[2].split(',').map((v) => Number(v.trim()));
}
const SPECIES = [];
{
  const re = /new FishSpecies\("(\w+)",\s*ModItems\.(\w+),\s*([\d.]+),\s*([\d.]+),\s*(\w+),\s*([\s\S]*?),\s*RodKind\.(\w+)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const after = m[6].trim();
    let arch = null, pull = 0, stam = 0, tension = 0, named = null;
    if (after.startsWith('FightProfile.')) {
      // 具名常量（鲫鱼用的就是这个）。
      // ⚠ 不能走下面的函数解析分支：那样会把 "FightProfile" 当成策略名、
      //   "CRUCIAN_CARP" 当成 pullSpeed，NaN → 显示成 0（踩过）。
      //   数值从 FightProfile.java 的常量定义里读。
      named = after.replace('FightProfile.', '');
      arch = named;
    } else {
      const call = /(\w+)\(([^)]*)\)/.exec(after);
      arch = call[1];
      const a = call[2].split(',').map((v) => Number(v.trim()));
      pull = a[0]; stam = a[1]; tension = a[2];
    }
    SPECIES.push({
      id: m[1], minKg: Number(m[3]), maxKg: Number(m[4]),
      tiers: TIERSETS[m[5]] || [], arch, pull, stam, tension, named, rods: m[7],
    });
  }
}
if (!SPECIES.length) throw new Error('没解析到鱼种');

// ---- 读 FightProfile.java 里的具名常量 ----
const profSrc = fs.readFileSync(path.join(path.dirname(SRC), 'FightProfile.java'), 'utf8');
const NAMED = {};
{
  const re = /public static final FightProfile (\w+) = new FightProfile\(([\s\S]*?)\);/g;
  let m;
  while ((m = re.exec(profSrc)) !== null) {
    const vals = m[2].replace(/\/\/[^\n]*/g, '').split(',').map((s) => s.trim());
    // 形如 Archetype.STEADY / 0.70 / 0.70 * FATIGUE_PULL / 0.6 ...
    const num = (s) => {
      const stripped = s.replace(/^[A-Z]\w*\./, '');
      const n = Number(stripped);
      if (Number.isFinite(n)) return n;
      // 0.70 * FATIGUE_PULL 这种算式：取字面量部分，常量值另行替换
      const mul = /^([\d.]+)\s*\*\s*(\w+)$/.exec(stripped);
      if (mul) {
        const k = Number(mul[1]);
        const c = { FATIGUE_PULL: Number(/FATIGUE_PULL\s*=\s*([\d.]+)/.exec(profSrc)[1]) }[mul[2]];
        return k * c;
      }
      return NaN;
    };
    NAMED[m[1]] = {
      archetype: vals[0].replace('Archetype.', ''),
      pullSpeed: num(vals[1]),
      fatiguedPullSpeed: num(vals[2]),
      stamina: num(vals[8]),
      tensionGain: num(vals[7]),
    };
  }
}
// 把具名常量的数值回填到鱼种上
for (const s of SPECIES) {
  if (!s.named) continue;
  const p = NAMED[s.named];
  if (!p) throw new Error('没找到具名 profile ' + s.named);
  s.arch = p.archetype;
  s.pull = p.pullSpeed;
  s.stam = p.stamina;
  s.tension = p.tensionGain;
  s.fatigueRatio = p.fatiguedPullSpeed / p.pullSpeed;
}

/** 中日韩字符按 2 列宽算，否则中文列全歪（padEnd 只数字符数） */
function width(str) {
  let w = 0;
  for (const ch of String(str)) w += /[\u2E80-\u9FFF\uFF00-\uFF60]/.test(ch) ? 2 : 1;
  return w;
}
const padW = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));
const padLW = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + String(s);

const CN = {
  crucian_carp: '鲫鱼', tilapia: '罗非鱼', mullet: '鲻鱼', grass_carp: '草鱼',
  black_carp: '青鱼', topmouth_culter: '翘嘴', zander: '梭鲈',
  atlantic_salmon: '大西洋鲑', bluefin_tuna: '蓝鳍金枪鱼', juvenile_shark: '幼鲨',
};
const ARCH_CN = { STEADY: '均衡', SLUGGISH: '黏液', BURST: '爆发', ERRATIC: '神经质' };
/** 策略函数名（小写）→ 中文。鱼种表里写的是 steady(...)/burst(...) 这种小写函数名 */
const ARCH_FN_CN = { steady: '均衡', sluggish: '黏液', burst: '爆发', erratic: '神经质' };
const archName = (s) => ARCH_CN[s.arch] || ARCH_FN_CN[s.arch] || s.arch;
const ROD_CN = { FLOAT: '台钓', LURE: '路亚', BOTH: '通用' };
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

/** 照抄 tierForWeight：按 tierSplit 的权重划分区间 */
function tierForWeight(s, w) {
  const n = s.tiers.length;
  const split = s.tiers.map(splitOf);
  const total = split.reduce((a, b) => a + b, 0);
  const span = Math.max(1e-6, s.maxKg - s.minKg);
  const ratio = Math.max(0, Math.min(0.9999999, (w - s.minKg) / span));
  const target = ratio * total;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += split[i];
    if (target < cum - 1e-9) return { tier: s.tiers[i], from: s.minKg + span * (cum - split[i]) / total, to: s.minKg + span * cum / total };
  }
  return { tier: s.tiers[n - 1], from: 0, to: s.maxKg };
}

/** 照抄 tierSplit 权重占总量的比例 = 该档的体重区间占比 */
function tierRanges(s) {
  const n = s.tiers.length;
  const split = s.tiers.map(splitOf);
  const total = split.reduce((a, b) => a + b, 0);
  const span = s.maxKg - s.minKg;
  const out = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const from = s.minKg + span * cum / total;
    cum += split[i];
    const to = s.minKg + span * cum / total;
    out.push({ tier: s.tiers[i], from, to, weightShare: split[i] / total });
  }
  return out;
}

/** 照抄 rollIndividualOnce 的体重分布（偏中小） */
function sizeFactorDist() {
  // raw = max(rnd, rnd*0.85); sizeFactor = 0.35 + raw*0.65
  // 用解析法算不出，直接枚举网格近似
  const N = 400;
  const hist = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = i / N, b = (j / N) * 0.85;
      hist.push(0.35 + Math.max(a, b) * 0.65);
    }
  }
  return hist;
}
const SF = sizeFactorDist();

console.log('从 FishSpecies.java 读到 tierSplit 权重：');
console.log('  ' + JSON.stringify(SPLIT) + '   （权重越小该档越稀有）');
console.log('  → 金:红 = ' + splitOf(4) + ':' + splitOf(5) + ' = '
  + (splitOf(4) / splitOf(5)).toFixed(1) + ':1');

console.log('\n' + '='.repeat(94));
console.log('  一、鱼种总表');
console.log('='.repeat(94));
console.log('  鱼种          体重区间        竿型   手感     基础游速  体力  张力');
console.log('  ' + '-'.repeat(86));
for (const s of SPECIES) {
  console.log('  ' + padW(CN[s.id] || s.id, 13)
    + padW(s.minKg + ' ~ ' + s.maxKg + ' kg', 16)
    + padW(ROD_CN[s.rods] || s.rods, 7)
    + padW(archName(s), 8)
    + padW(s.pull, 10) + padW(s.stam, 6) + s.tension);
}

console.log('\n' + '='.repeat(94));
console.log('  二、品质分界（**按 tierSplit 权重划分**，不是等分）');
console.log('='.repeat(94));
console.log('  鱼种          分界（kg）                             各档体重区间占比');
console.log('  ' + '-'.repeat(86));
for (const s of SPECIES) {
  const rs = tierRanges(s);
  const parts = rs.map((r) => TIER_NAME[r.tier] + ' ' + r.from.toFixed(1) + '~' + r.to.toFixed(1));
  console.log('  ' + padW(CN[s.id] || s.id, 13) + parts.join('  '));
  console.log('  ' + ' '.repeat(13) + '权重占比  '
    + rs.map((r) => TIER_NAME[r.tier] + ' ' + (r.weightShare * 100).toFixed(0) + '%').join('  '));
}

console.log('\n' + '='.repeat(94));
console.log('  三、实际出品质概率（按真实的体重分布，不是均匀分布）');
console.log('='.repeat(94));
console.log('  鱼种          白     绿     蓝     紫     金     红      （分布偏中小，所以低档更常见）');
console.log('  ' + '-'.repeat(86));
for (const s of SPECIES) {
  const counts = {};
  for (const sf of SF) {
    const w = s.minKg + (s.maxKg - s.minKg) * Math.pow(sf, 3.0);
    const t = tierForWeight(s, w).tier;
    counts[t] = (counts[t] || 0) + 1;
  }
  const cells = [];
  for (let t = 0; t <= 5; t++) {
    const pct = (counts[t] || 0) / SF.length * 100;
    cells.push(counts[t] ? pct.toFixed(1) + '%' : '—');
  }
  console.log('  ' + padW(CN[s.id] || s.id, 13) + cells.map((c) => padW(c, 7)).join(''));
}
console.log('\n  "—" = 该鱼种吃不到这一档（档位表决定的）。');
console.log('  注意分布是"偏中小"的（尺寸系数 0.35~1.0 且两次取大），');
console.log('  所以**低档概率明显高于高档**，不是按权重占比线性分布。');

console.log('\n' + '='.repeat(94));
console.log('  四、体长范围（由体重开三次方映射）');
console.log('='.repeat(94));
console.log('  鱼种          最长体长   最短体长(=45%)');
console.log('  ' + '-'.repeat(50));
for (const s of SPECIES) {
  const maxLen = 12.0 + Math.cbrt(s.maxKg) * 26.0;
  console.log('  ' + padW(CN[s.id] || s.id, 13)
    + padW(maxLen.toFixed(1) + ' cm', 12) + (maxLen * 0.45).toFixed(1) + ' cm');
}
