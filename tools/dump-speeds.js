/*
 * dump-speeds.js —— 拉出"鱼各品质档的游速表"。
 *
 * 全部参数**从 Java 源码读**，不在这里另抄一份：
 *   FishSpecies.java   → tierSpeed() / tierStaminaResist() 的公式与底数、
 *                        ALL 列表的鱼种与档位、四种策略的构造参数
 *   FightProfile.java  → record 的字段顺序（用来把构造参数对上名字）
 *
 * 游速怎么来的（见 FishSpecies 顶部注释）：
 *   实际游速 = 鱼种基础 pullSpeed × tierSpeed(档位)
 *   tierSpeed(档) = 1.12^档     → 档越高游得越快
 *   挣扎时的"疲劳动作"再乘 fatiguedPullSpeed 的比例（各策略不同）
 *
 * 用法：node tools/dump-speeds.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing');
const fishSrc = fs.readFileSync(path.join(DIR, 'FishSpecies.java'), 'utf8');
const profSrc = fs.readFileSync(path.join(DIR, 'FightProfile.java'), 'utf8');

// ---------------------------------------------------------------- 读源码
/** 读 tierSpeed / tierStaminaResist 的底数 */
function readFormula(name) {
  const re = new RegExp('public static double ' + name + '\\(int tier\\)\\s*\\{\\s*'
    + 'return Math\\.pow\\(([\\d.]+),');
  const m = re.exec(fishSrc);
  if (!m) throw new Error('没找到 ' + name + '() 的底数，正则需要更新');
  return Number(m[1]);
}
const SPEED_BASE = readFormula('tierSpeed');
const RESIST_BASE = readFormula('tierStaminaResist');

/** FightProfile record 的字段名（按顺序） */
function readProfileFields() {
  const m = /public record FightProfile\(([\s\S]*?)\)\s*\{/.exec(profSrc);
  if (!m) throw new Error('没找到 FightProfile record，正则需要更新');
  return m[1].split(',').map((s) => s.trim().split(/\s+/).pop());
}
const PROFILE_FIELDS = readProfileFields();

/** 四种策略的构造：steady(pull, stamina, tensionGain) -> new FightProfile(...) */
function readArchetypes() {
  const out = {};
  const re = /private static FightProfile (\w+)\(double pull, double stamina, double tensionGain\)\s*\{\s*return new FightProfile\(([\s\S]*?)\);\s*\}/g;
  let m;
  while ((m = re.exec(fishSrc)) !== null) {
    out[m[1]] = m[2].replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  }
  if (!Object.keys(out).length) throw new Error('没找到策略构造函数，正则需要更新');
  return out;
}
const ARCH_SRC = readArchetypes();

/** 读 FishSpecies 里的数值常量（如 FATIGUE_PULL），供策略实参求值用 */
function readDoubleConst(name) {
  const m = new RegExp('private static final double ' + name + '\\s*=\\s*([\\d.]+)\\s*;').exec(fishSrc);
  if (!m) throw new Error('没找到常量 ' + name + '，正则需要更新');
  return Number(m[1]);
}
const NUM_CONSTS = {};
{
  // FATIGUE_PULL 定义在 FightProfile.java（FishSpecies 只是个别名），
  // 所以两个文件都要扫，否则读不到。
  for (const srcText of [fishSrc, profSrc]) {
    const re = /(?:public |private )?static final double (\w+)\s*=\s*([\d.]+)\s*;/g;
    let m;
    while ((m = re.exec(srcText)) !== null) NUM_CONSTS[m[1]] = Number(m[2]);
  }
}
if (!('FATIGUE_PULL' in NUM_CONSTS)) {
  throw new Error('没找到 FATIGUE_PULL 常量，正则需要更新');
}

/**
 * 把 Java 里的简单算术实参求值。
 *
 * <p>支持字面量、命名常量（如 FATIGUE_PULL）、以及它们的乘除加减——
 * 例如 {@code 0.70 * FATIGUE_PULL}。刻意不做到通用表达式解析：
 * 只认数字和已读到的常量，认不出就抛错，绝不静默给个错值。
 */
function evalArg(expr) {
  const stripped = expr.trim().replace(/^[A-Z]\w*\./, '');   // Archetype.STEADY -> STEADY
  const bare = Number(stripped);
  if (Number.isFinite(bare)) return bare;
  if (!/^[\w.\s*+\-/()]+$/.test(stripped)) throw new Error('实参含不支持的字符: ' + expr);
  const substituted = stripped.replace(/[A-Za-z_]\w*/g, (name) => {
    const v = NUM_CONSTS[name];
    if (v === undefined) throw new Error('引用未知常量: ' + name + '（在 ' + expr + ' 里）');
    return String(v);
  });
  // 只允许数字与四则运算，杜绝 eval 注入
  if (!/^[\d.\s*+\-/()]+$/.test(substituted)) {
    throw new Error('实参替换后仍含非数字内容: ' + substituted);
  }
  // eslint-disable-next-line no-new-func
  const v = Function('"use strict";return (' + substituted + ')')();
  if (!Number.isFinite(v)) throw new Error('实参求值失败: ' + expr + ' -> ' + substituted);
  return v;
}

/** 把策略体的实参代进公式（pull / stamina / tensionGain 是形参，其余字面量或常量） */
function evalArch(body, pull, stamina, tensionGain) {
  const args = body.split(',').map((s) => s.trim());
  const vals = args.map((a) => {
    // FightProfile.Archetype.STEADY -> "STEADY"（枚举名，不是数字）
    if (/FightProfile\.Archetype\./.test(a)) return a.replace('FightProfile.Archetype.', '');
    if (a === 'pull') return pull;
    if (a === 'stamina') return stamina;
    if (a === 'tensionGain') return tensionGain;
    // "pull × 系数"（系数可能是字面量也可能是常量）
    const multi = /^pull\s*\*\s*([\w.]+)$/.exec(a);
    if (multi) {
      const coef = Number.isFinite(Number(multi[1])) ? Number(multi[1]) : NUM_CONSTS[multi[1]];
      if (!Number.isFinite(coef)) throw new Error('未知常量: ' + multi[1]);
      return pull * coef;
    }
    return evalArg(a);
  });
  const prof = {};
  PROFILE_FIELDS.forEach((f, i) => { prof[f] = vals[i]; });
  return prof;
}

/** ALL 里的鱼种列表：id, minKg, maxKg, tiers, 策略名+三参数, 竿型 */
function readSpecies() {
  const tiersets = {};
  const tsRe = /private static final int\[\] (\w+) = \{([^}]*)\};/g;
  let tm;
  while ((tm = tsRe.exec(fishSrc)) !== null) {
    tiersets[tm[1]] = tm[2].split(',').map((v) => Number(v.trim()));
  }
  const out = [];
  // profile 参数有两种写法：
  //   FightProfile.CRUCIAN_CARP            （具名常量，无括号）
  //   steady(0.80, 90, 0.95)               （策略函数调用）
  // 早先只用 [\s\S]*? 通配，遇到不含括号的具名常量会一路吃掉后面的
  // 逗号直到下一个 "("，于是 zander 的 steady(...) 被当成 crucian_carp 的 profile，
  // 鲫鱼的 pullSpeed 被读成 70（实际是 zander 之外的串味值）。
  // 现在两种写法各写一条，解析结果必须自洽。
  const re = /new FishSpecies\("(\w+)",\s*ModItems\.(\w+),\s*([\d.]+),\s*([\d.]+),\s*(\w+),\s*(FightProfile\.\w+|\w+\([^)]*\)),\s*RodKind\.(\w+)\)/g;
  let m;
  while ((m = re.exec(fishSrc)) !== null) {
    const after = m[6].trim();
    let arch = null, pull = 0, stamina = 0, tension = 0;
    if (after.startsWith('FightProfile.')) {
      arch = after;   // 具名常量，稍后从 FightProfile.java 查
    } else {
      const call = /(\w+)\(([^)]*)\)/.exec(after);
      if (!call) throw new Error('无法解析 profile: ' + after);
      arch = call[1];
      const a = call[2].split(',').map((v) => Number(v.trim()));
      pull = a[0]; stamina = a[1]; tension = a[2];
      if (!Number.isFinite(pull)) throw new Error('profile 参数解析失败: ' + after);
    }
    out.push({
      id: m[1], item: m[2], minKg: Number(m[3]), maxKg: Number(m[4]),
      tiers: tiersets[m[5]] || [], arch, pull, stamina, tension,
      rods: m[7],
    });
  }
  if (!out.length) throw new Error('没解析到鱼种列表，正则需要更新');
  return out;
}
const SPECIES = readSpecies();

// 手写 profile（鲫鱼用的是 FightProfile.CRUCIAN_CARP 常量，不在策略函数里）
const NAMED_PROFILES = {};
{
  const re = /public static final FightProfile (\w+) = new FightProfile\(([\s\S]*?)\);/g;
  let m;
  while ((m = re.exec(profSrc)) !== null) {
    const vals = m[2].replace(/\/\/[^\n]*/g, '').split(',').map((s) => s.trim());
    const prof = {};
    PROFILE_FIELDS.forEach((f, i) => {
      const v = vals[i];
      if (v === undefined) { prof[f] = 0; return; }
      // 实参可能是字面量、Java 限定名（Archetype.STEADY）、或含常量的算式
      // （如 0.70 * FATIGUE_PULL）。统一交给 evalArg。
      // ⚠ 曾经写成 v.replace(/^\w+\./, '')，那个正则会把 0.70 的 "0." 也剥掉，
      // pullSpeed 从 0.70 变成 70（踩过一次，表里出现过一个离谱的 70.00）。
      prof[f] = /^[A-Z]\w*\.\w+$/.test(v) ? v.replace(/^[A-Z]\w*\./, '') : evalArg(v);
    });
    NAMED_PROFILES[m[1]] = prof;
  }
  if (process.env.ATL_PROBE) {
    console.log('[探针] 具名常量原始值 = ' + JSON.stringify(Object.fromEntries(
      Object.entries(NAMED_PROFILES).map(([k, v]) => [k, v.pullSpeed]))));
  }
}

function profileOf(s) {
  if (s.arch.startsWith('FightProfile.')) {
    const key = s.arch.replace('FightProfile.', '');
    const p = NAMED_PROFILES[key];
    if (!p) throw new Error('没找到具名 profile: ' + key);
    return p;
  }
  return evalArch(ARCH_SRC[s.arch], s.pull, s.stamina, s.tension);
}

// ---------------------------------------------------------------- 公式
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];
const tSpeed = (t) => Math.pow(SPEED_BASE, Math.max(0, Math.min(5, t)));
const tResist = (t) => Math.pow(RESIST_BASE, Math.max(0, Math.min(5, t)));
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const f2 = (v) => v.toFixed(2);

console.log('从源码读到：');
console.log('  tierSpeed(t)         = ' + SPEED_BASE + '^t');
console.log('  tierStaminaResist(t) = ' + RESIST_BASE + '^t');
console.log('  数值常量             = ' + JSON.stringify(NUM_CONSTS));
console.log('  FightProfile 字段    = ' + PROFILE_FIELDS.join(', '));
console.log('  策略构造             = ' + Object.keys(ARCH_SRC).join(', ')
  + '   + 具名 ' + Object.keys(NAMED_PROFILES).join(', '));

// ---------------------------------------------------------------- 表一：档位系数
console.log('\n' + '='.repeat(78));
console.log('  表一、品质档位 → 游速 / 体力抗性系数');
console.log('='.repeat(78));
console.log('  档位   游速×     体力抗性×     相对白档游速');
console.log('  ' + '-'.repeat(46));
for (let t = 0; t <= 5; t++) {
  console.log('  ' + pad(t + TIER_NAME[t], 7) + pad('×' + f2(tSpeed(t)), 10)
    + pad('×' + f2(tResist(t)), 14) + '+' + ((tSpeed(t) - 1) * 100).toFixed(0) + '%');
}
console.log('\n  游速随档位指数上升（每档 ×' + SPEED_BASE + '），白→红 差 '
  + f2(tSpeed(5) / tSpeed(0)) + ' 倍。');
console.log('  体力抗性每档 ×' + RESIST_BASE + '，白→红 差 ' + f2(tResist(5) / tResist(0))
  + ' 倍（直接除在收线扣鱼力上）。');

// ---------------------------------------------------------------- 表二：各鱼种 × 档位
console.log('\n' + '='.repeat(78));
console.log('  表二、各鱼种在不同品质档下的游速（= 基础 pullSpeed × 游速系数）');
console.log('='.repeat(78));
console.log('  鱼种             策略    基础游速  档位范围    白     绿     蓝     紫     金     红');
console.log('  ' + '-'.repeat(92));
for (const s of SPECIES) {
  const p = profileOf(s);
  const range = s.tiers[0] + '~' + s.tiers[s.tiers.length - 1];
  const cols = [];
  for (let t = 0; t <= 5; t++) {
    cols.push(s.tiers.includes(t) || (t >= s.tiers[0] && t <= s.tiers[s.tiers.length - 1])
      ? f2(p.pullSpeed * tSpeed(t)) : '—');
  }
  console.log('  ' + pad(s.id, 17) + pad(p.archetype, 8)
    + padL(f2(p.pullSpeed), 8) + padL(range, 10) + '  '
    + cols.map((c) => padL(c, 6)).join(' '));
}
console.log('\n  "—" = 该鱼种吃不到这一档（档位表决定的）。');
console.log('  注意同一档位下**不同鱼种的基础游速差别很大**（' +
  f2(Math.min(...SPECIES.map((s) => profileOf(s).pullSpeed))) + ' ~ ' +
  f2(Math.max(...SPECIES.map((s) => profileOf(s).pullSpeed))) + '），');
console.log('  所以"高级鱼"不等于"同档最快"——鲑鱼基础就比鲫鱼快得多。');

// ---------------------------------------------------------------- 表三：疲劳期
// fatiguedPullSpeed 在 FishingSession 里是**乘数**：
//   fishOut = 0.055 × pullSpeed × tierSpeed × (疲劳 ? fatiguedPullSpeed : 1.0)
// 用户定案：所有鱼统一 = 正常拉力 × 0.5。疲劳期的另外两项收益在 FishingSession.tickFight：
//   张力倍率 ×0.80（更安全）、收线扣鱼力 ×1.20（更快耗它的体力）
console.log('\n' + '='.repeat(78));
console.log('  表三、疲劳期游速（用户定案：所有鱼统一 ×0.5）');
console.log('='.repeat(78));
console.log('  策略        疲劳/常态   红档常态   红档疲劳   判定');
console.log('  ' + '-'.repeat(58));
const seen = new Set();
for (const s of SPECIES) {
  const p = profileOf(s);
  if (seen.has(p.archetype)) continue;
  seen.add(p.archetype);
  const ratio = p.fatiguedPullSpeed / p.pullSpeed;
  const maxPull = Math.max(...SPECIES.filter((x) => profileOf(x).archetype === p.archetype)
    .map((x) => profileOf(x).pullSpeed));
  const norm = maxPull * tSpeed(5);
  const fat = ratio * norm;
  const delta = (ratio - 1) * 100;
  const verdict = ratio > 1.001 ? '⚠ 更难拉 +' + delta.toFixed(0) + '%'
    : ratio < 0.999 ? '✅ 好拉 ' + delta.toFixed(0) + '%'
      : '— 无变化';
  console.log('  ' + pad(p.archetype, 12) + pad('×' + f2(ratio), 12)
    + padL(f2(norm), 10) + padL(f2(fat), 11) + '   ' + verdict);
}
console.log('\n  四条全是 ×0.50 —— 遛到疲劳对所有鱼都是实打实的收益，没有例外。');
console.log('  策略差异不再靠"疲劳好不好拉"体现，而是靠 stamina / tensionGain / 冲刺频率。');
console.log('\n  疲劳期的另外两项收益（FishingSession.tickFight）：');
console.log('    · 张力倍率 ×0.80  → 更安全，可以放心反拉');
console.log('    · 收线扣鱼力 ×1.20 → 每一秒收线都更疼');
console.log('    · 浮漂停止被拖动    → 一眼能看出"它现在没劲了"');

// ---------------------------------------------------------------- 上鱼规则
console.log('\n' + '='.repeat(78));
console.log('  上鱼判定（FishingSession.tickFight 第 7 段）');
console.log('='.repeat(78));
console.log('  A 遛翻（宽松判定，用户定案）：鱼力 ≤ 最大体力的 0.5% → 直接上鱼');
console.log('     ★ 不再要求把线收回近岸。蓝条一满格就该给鱼。');
console.log('  B 拉干：distance 收到 0 → 强制上鱼，不看鱼力（用户定案）');
console.log('  C 兜底：线已收近（castDistance×0.25 + 2.0 以内）');
console.log('');
console.log('  各鱼种的 0.5% 判定阈值（绝对值）：');
console.log('    体力 260（鲑）    → 1.30');
console.log('    体力 380（幼鲨）  → 1.90');
console.log('    体力 420（金枪鱼）→ 2.10');
console.log('    体力  80（鲫鱼）  → 0.40');
console.log('');
console.log('  唯一失败条件是**断线**（张力触顶）；distance 超过 maxDistance 则鱼逃脱');
console.log('  （maxDistance = max(castDistance×2.5, 竿线长)）。');

// ---------------------------------------------------------------- 表四：手感参数
console.log('\n' + '='.repeat(78));
console.log('  表四、各策略完整手感参数');
console.log('='.repeat(78));
console.log('  策略        冲刺时长  冲刺间隔  变向间隔  假动作  张力上涨  体力');
console.log('  ' + '-'.repeat(70));
for (const arch of [...new Set(SPECIES.map((s) => profileOf(s).archetype))]) {
  const s0 = SPECIES.find((x) => profileOf(x).archetype === arch);
  const p = profileOf(s0);
  console.log('  ' + pad(arch, 12) + pad(f2(p.sprintDurationSec) + 's', 10)
    + pad(f2(p.sprintIntervalSec) + 's', 10) + pad(f2(p.turnIntervalSec) + 's', 11)
    + pad((p.fakeOutChance * 100).toFixed(0) + '%', 8)
    + pad(f2(p.tensionGain), 10) + f2(p.stamina));
}

// ---------------------------------------------------------------- 表五：逐鱼种实参数
console.log('\n' + '='.repeat(78));
console.log('  表五、逐鱼种实参（策略函数里传进去的三个数）');
console.log('='.repeat(78));
console.log('  鱼种             策略      pullSpeed  stamina  tensionGain  体重区间');
console.log('  ' + '-'.repeat(76));
for (const s of SPECIES) {
  const p = profileOf(s);
  console.log('  ' + pad(s.id, 17) + pad(p.archetype, 10)
    + padL(f2(p.pullSpeed), 10) + padL(String(p.stamina), 9) + padL(String(p.tensionGain), 13)
    + '   ' + s.minKg + '~' + s.maxKg + 'kg');
}
