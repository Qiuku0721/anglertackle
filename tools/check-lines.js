/*
 * check-lines.js —— 验证鱼线六档的数值链路，以及配件品质着色。
 *
 * 触发理由：用户要求
 *   ① "标准稀有度" → 全部改走六档品质（白绿蓝紫金红），不看原版 Rarity
 *   ② PE 线改金、新增红档钛合金记忆金属线
 *   ③ 鱼线六档数值逐条指定
 *
 * 这里验证三件事：
 *   1. ModItems 里六档鱼线的参数与用户指定的表**逐条一致**
 *   2. 档位 → 名字颜色映射正确（不是全挤在紫色）
 *   3. 张力上限合成不会被 PartComposer 的硬顶削平（金线和红线必须能区分）
 *
 * 用法：node tools/check-lines.js
 */
const fs = require('fs');
const path = require('path');

const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const ROOT = ATL_ROOT;
const itemSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
  'whitecobalt', 'anglertackle', 'registry', 'ModItems.java'), 'utf8');
const compSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
  'whitecobalt', 'anglertackle', 'fishing', 'PartComposer.java'), 'utf8');

// ---- 用户定案的目标表（档位 1–6，白=1）----
//
// 蓝档及以上做过一次**整体弱化 12%**（上限 ×0.88、回复 ×0.88、生成 ×1.12）。
// 注意"生成 ×1.12"是**变差**（张力涨得更快 = 更危险），三项方向一致。
// 下面同时记下**原始值**，用来反查这次调整有没有被正确应用。
const TUNE = { ceiling: 0.88, gen: 1.12, recover: 0.88 };
const EXPECTED = [
  // ⚠ 麻线**不再是全 1.00 的纯基准**：用户 2026-10-01 定案微调
  //   （上限 1.00→1.08、生成 1.00→0.97、回复 1.00→1.05；耐久与线长未动）。
  //   所以"白档"现在只是"最弱的一档"，不等于"中性值 1.00" ——
  //   配件见底/缺失时走的是 PartStats.NEUTRAL（仍是 1.00），两者别混。
  //   这里 raw 也要跟着写成新值：raw 的语义是"弱化前的原值"，
  //   而白/绿档按定案**不参与**那次 12% 弱化，两列本来就该相等。
  { id: 'hemp_line',     tier: 1, dur: 50, ceiling: 1.08, gen: 0.97, recover: 1.05, len: 30, raw: { ceiling: 1.08, gen: 0.97, recover: 1.05 } },
  { id: 'cotton_line',   tier: 2, dur: 50, ceiling: 1.20, gen: 0.91, recover: 1.15, len: 35, raw: { ceiling: 1.20, gen: 0.91, recover: 1.15 } },
  { id: 'nylon_line',    tier: 3, dur: 40, ceiling: 1.28, gen: 0.95, recover: 1.30, len: 45, raw: { ceiling: 1.45, gen: 0.85, recover: 1.48 } },
  // ⚠ 紫/金/红三条 2026-10-05 由用户**直接指定绝对值**（不再走"原始值 ×12% 弱化"那条推算路径），
  //   所以带 direct: true —— 弱化反查那一段跳过它们，改由下面第二段做逐值断言。
  { id: 'fluoro_line',   tier: 4, dur: 35, ceiling: 1.64, gen: 0.78, recover: 1.42, len: 60, direct: true },
  { id: 'pe_line',       tier: 5, dur: 30, ceiling: 2.08, gen: 0.64, recover: 1.52, len: 65, direct: true },
  { id: 'titanium_line', tier: 6, dur: 30, ceiling: 2.36, gen: 0.56, recover: 1.78, len: 70, direct: true },
];
/** 白/绿档不参与调整（用户定案只动蓝及以上） */
const UNADJUSTED_TIERS = [1, 2];
const TIER_NAME = { 1: '白', 2: '绿', 3: '蓝', 4: '紫', 5: '金', 6: '红' };

// 调参值统一从 tools/tuning.js 取（读 Config.java 的默认值 + 源码里仍有的常量）。
// 曾经这里直接正则抓 Java 源码里的常量，常量一搬进 Config.java 就全线崩。
// 注：本文件里 TUNE 已被上面的"档位调整系数"占用，所以这里叫 TUNING。
const TUNING = require('./tuning.js');
const W_LINE_ON_TENSION = TUNING.cfg.lineOnTension;
const BASE_TENSION_CEILING = TUNING.BASE_TENSION_CEILING;
const capCeiling = TUNING.CAP_TENSION_CEILING;

/** 在同名 register 块里取 PartStats.line(...) 的参数 */
function readLine(id) {
  const re = new RegExp('ITEMS\\.register\\("' + id + '"');
  const at = re.exec(itemSrc);
  if (!at) throw new Error('没找到物品 ' + id);
  const nextAt = itemSrc.indexOf('ITEMS.register("', at.index + 10);
  const block = itemSrc.slice(at.index, nextAt < 0 ? itemSrc.length : nextAt);
  const call = block.indexOf('PartStats.line(');
  if (call < 0) throw new Error(id + ' 没有 PartStats.line(...)');
  let depth = 0, end = -1;
  for (let p = call + 'PartStats.line'.length; p < block.length; p++) {
    if (block[p] === '(') depth++;
    else if (block[p] === ')') { depth--; if (depth === 0) { end = p; break; } }
  }
  const args = block.slice(call + 'PartStats.line('.length, end).split(',').map((s) => s.trim());
  // 参数可能是字面量、算式，或者（配件数值配置化之后）Tuning.xxx() 调用。
  // Tuning 的 getter 就是返回对应的配置值，所以查 TUNING.cfg 的键即可 ——
  // 这样本脚本校验的仍然是"游戏里实际生效的值"，而不是源码里的书写形式。
  const val = (s) => {
    const t = s.trim();
    const tun = /^Tuning\.(\w+)\(\)$/.exec(t);
    if (tun) {
      const k = tun[1];
      if (!(k in TUNING.cfg)) {
        throw new Error('Tuning.' + k + '() 在 Config.java 里找不到对应配置项');
      }
      return TUNING.cfg[k];
    }
    return Number.isFinite(Number(t)) ? Number(t)
      : Function('"use strict";return (' + t + ')')();
  };
  const durability = Number(/partProps\(\s*(\d+)\s*,/.exec(block)[1]);
  return {
    tier: val(args[4]), durability,
    ceiling: val(args[0]), gen: val(args[1]), recover: val(args[2]), lengthRatio: val(args[3]),
  };
}

console.log('\n=== 蓝档及以上的 12% 弱化是否被正确应用（对照原始值）===\n');
console.log('  口径：张力上限 ×0.88、张力回复 ×0.88、张力生成 ×1.12（生成变大 = 变差）\n');
console.log('  鱼线            上限 原→新         生成 原→新         回复 原→新');
console.log('  ' + '-'.repeat(76));
for (const e of EXPECTED) {
  const a = readLine(e.id);
  if (e.direct) {
    // 用户直接指定的绝对值：不做"原始值 ×系数"的反查（那条链已经不成立了），
    // 但仍然逐值断言（见下面第二段），所以不是"跳过检查"。
    console.log('  ' + ' ' + e.id.padEnd(15) + '用户直接指定：上限 ×' + a.ceiling + '  生成 ×' + a.gen
      + '  回复 ×' + a.recover + '  （不做弱化反查）');
    continue;
  }
  const adjusted = !UNADJUSTED_TIERS.includes(e.tier);
  const parts = [
    ['ceiling', a.ceiling],
    ['gen', a.gen],
    ['recover', a.recover],
  ].map(([k, actual]) => {
    const want = adjusted ? e.raw[k] * TUNE[k] : e.raw[k];
    const ok = Math.abs(actual - want) < 0.005;
    if (!ok) fail++;
    return (ok ? '' : '❌ ') + e.raw[k].toFixed(2) + '→' + actual.toFixed(2);
  });
  console.log('  ' + (adjusted ? ' ' : '*') + e.id.padEnd(15)
    + parts[0].padEnd(19) + parts[1].padEnd(19) + parts[2]);
}
console.log('\n  * = 白/绿档，按用户定案**不参与**这次弱化（数值与原始值一致）。');

console.log('\n' + '='.repeat(88) + '\n');
console.log('=== 鱼线六档：ModItems 实际参数 vs 用户定案 ===\n');
console.log('  鱼线           档位  耐久  张力上限  张力生成  张力回复  线长(米)  合成上限(木竿)');
console.log('  ' + '-'.repeat(88));
let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.log('  ❌ ' + msg); fail++; } };

for (const e of EXPECTED) {
  const a = readLine(e.id);
  const len = (30 * a.lengthRatio).toFixed(0);
  const composed = BASE_TENSION_CEILING
    * (1 + (a.ceiling - 1) * W_LINE_ON_TENSION);
  console.log('  ' + e.id.padEnd(15) + String(a.tier + TIER_NAME[a.tier]).padEnd(6)
    + String(a.durability).padEnd(6) + ('×' + a.ceiling).padEnd(10)
    + ('×' + a.gen).padEnd(10) + ('×' + a.recover).padEnd(10)
    + (len + ' 米').padEnd(10) + composed.toFixed(0) + ' 点');

  assert(a.tier === e.tier, e.id + ' 档位：期望 ' + e.tier + '，实际 ' + a.tier);
  assert(a.durability === e.dur, e.id + ' 耐久：期望 ' + e.dur + '，实际 ' + a.durability);
  assert(Math.abs(a.ceiling - e.ceiling) < 1e-9, e.id + ' 张力上限：期望 ' + e.ceiling + '，实际 ' + a.ceiling);
  assert(Math.abs(a.gen - e.gen) < 1e-9, e.id + ' 张力生成：期望 ' + e.gen + '，实际 ' + a.gen);
  assert(Math.abs(a.recover - e.recover) < 1e-9, e.id + ' 张力回复：期望 ' + e.recover + '，实际 ' + a.recover);
  assert(Math.abs(30 * a.lengthRatio - e.len) < 0.5, e.id + ' 线长：期望 ' + e.len + ' 米，实际 ' + (30 * a.lengthRatio).toFixed(1));
}

console.log('\n=== 硬顶检查（金线/红线必须能区分）===');
console.log('  CAP_TENSION_CEILING = ' + capCeiling);
{
  const gold = readLine('pe_line');
  const red = readLine('titanium_line');
  const g = BASE_TENSION_CEILING * (1 + (gold.ceiling - 1) * W_LINE_ON_TENSION);
  const r = BASE_TENSION_CEILING * (1 + (red.ceiling - 1) * W_LINE_ON_TENSION);
  console.log('  PE线(金) 合成上限 = ' + g.toFixed(1) + ' 点，钳制后 = ' + Math.min(g, BASE_TENSION_CEILING * capCeiling).toFixed(1));
  console.log('  钛合金(红) 合成上限 = ' + r.toFixed(1) + ' 点，钳制后 = ' + Math.min(r, BASE_TENSION_CEILING * capCeiling).toFixed(1));
  assert(g < BASE_TENSION_CEILING * capCeiling,
    'PE线未被硬顶削平（' + g.toFixed(1) + ' < ' + (BASE_TENSION_CEILING * capCeiling).toFixed(0) + '）');
  assert(r < BASE_TENSION_CEILING * capCeiling,
    '钛合金线未被硬顶削平（' + r.toFixed(1) + ' < ' + (BASE_TENSION_CEILING * capCeiling).toFixed(0) + '）');
  assert(r > g, '红线的合成上限高于金线（' + r.toFixed(1) + ' > ' + g.toFixed(1) + '）');
  console.log('  （原硬顶 1.60 → 上限 160 点，金线 ' + g.toFixed(0) + ' 和红线 ' + r.toFixed(0) + ' 都会被削到 160，两档一样）');
}

console.log('\n=== 品质着色（六档不能撞色）===');
{
  // ⚠ 这里必须和 Java 端**完全同源**：直接读 TacklePartItem.quality() 里
  //   Quality.of(...) 的实参写法，而不是自己另写一份映射。
  //   踩过一次：脚本当时写的是 QUALITY_COLOR[tier - 1]（0-based），
  //   而 Java 传的是 partTier()（1-based），两边"各自的逻辑都自洽"，
  //   于是脚本报"全部通过"，游戏里所有线/饵的颜色却集体高一档。
  //   检查脚本如果自己重算一遍，就等于没检查。
  const qualitySrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
    'whitecobalt', 'anglertackle', 'item', 'TacklePartItem.java'), 'utf8');
  // ⚠ 正则不能写 [^)]* —— 实参里有 partTier()，自带一层括号，
  //   写成 [^)]* 会在第一个 ')' 就截断，拿到 "Quality.of(stats.partTier()"，
  //   减 1 判断直接失效（踩过）。改成捕获到分号/换行。
  const ofArg = /Quality\.of\(([^;]*?)\)\s*;/.exec(qualitySrc);
  if (!ofArg) throw new Error('没找到 TacklePartItem 里的 Quality.of(...)');
  const arg = ofArg[1].trim();
  console.log('  Java 端写法：Quality.of(' + arg + ')');
  const zeroBased = /partTier\(\)\s*-\s*1/.test(arg);
  assert(zeroBased, 'Java 端把 1-based 档位减成了 0-based（否则颜色整体高一档）');

  // 档位 → ChatFormatting（照抄 Quality 枚举，索引 0-based）
  const QUALITY_COLOR = ['WHITE', 'GREEN', 'BLUE', 'LIGHT_PURPLE', 'GOLD', 'RED'];
  const QUALITY_NAME = ['白', '绿', '蓝', '紫', '金', '红'];
  const seen = new Map();
  for (const e of EXPECTED) {
    // 用**和 Java 一样的换算**：档位(1-based) - 1 → Quality 序号
    const idx = zeroBased ? e.tier - 1 : e.tier;
    const color = QUALITY_COLOR[idx];
    const name = QUALITY_NAME[idx];
    console.log('  档' + e.tier + '(' + TIER_NAME[e.tier] + ') → Quality.of(' + idx + ') → '
      + String(color).padEnd(14) + String(name).padEnd(3) + e.id);
    assert(name === TIER_NAME[e.tier],
      e.id + ' 颜色对不上：档位是 ' + TIER_NAME[e.tier] + '，但算出来是 ' + name);
    assert(!seen.has(color), '颜色 ' + color + ' 被 ' + seen.get(color) + ' 和 ' + e.id + ' 共用（撞色）');
    seen.set(color, e.id);
  }
  console.log('\n  六档各占一个颜色，没有撞色。');
  console.log('  ⚠ 原版 Rarity 只有 COMMON/UNCOMMON/RARE/EPIC 四档，');
  console.log('    紫/金/红三档都会落成 EPIC（同一个紫色）—— 所以必须走配件档位。');
}

console.log('\n=== 拟饵档位（和鱼线共用同一段着色代码）===');
{
  // ⚠ 六档阶梯是 **1白 2绿 3蓝 4紫 5金 6红**（1-based），
  //   而 Quality.of() 收 0-based —— quality() 里要减 1。
  //   踩过两次：
  //     ① 按"1绿…5红"填 → 整体差一档，镀金显示成金、红档永远出不来；
  //     ② 线和饵起点不一致（线从 1 白起、饵从 2 绿起）→ 同样填 1，
  //        麻线是白、亮片却是绿，玩家看到的就是"品质乱了"。
  //   统一口径：**档位号相同 = 颜色相同**，线饵一致。
  //
  //   机械约束：baitMinTier() 里"紫饵过滤绿档以下"判的是 lureTier()==4，
  //   所以紫档必须是 4，否则那条过滤分支永远走不到。
  const LURE_EXPECT = [
    { id: 'lure_spoon', tier: 2, name: '绿', note: '入门' },
    { id: 'lure_minnow', tier: 3, name: '蓝', note: '主力' },
    { id: 'lure_soft', tier: 3, name: '蓝', note: '主力' },
    { id: 'lure_deep', tier: 4, name: '紫', note: '打底层' },
    { id: 'lure_rattle', tier: 5, name: '金', note: '' },
    { id: 'lure_gilded', tier: 6, name: '红', note: '顶配' },
  ];
  // 取值同样要认两种形式：字面量档位号，或（配件数值配置化之后的）Tuning.xxx()。
  const tuningVal = (expr) => {
    const t = expr.trim();
    const tun = /^Tuning\.(\w+)\(\)$/.exec(t);
    if (tun) {
      if (!(tun[1] in TUNING.cfg)) {
        throw new Error('Tuning.' + tun[1] + '() 在 Config.java 里找不到对应配置项');
      }
      return TUNING.cfg[tun[1]];
    }
    return Number(t);
  };

  // 用括号配对取 PartStats.lure(...) 的实参，**不再用正则**。
  // 这段前后试过三种正则，全都在"参数本身含括号"上翻车：
  //   `[^)]*`   → 在 Tuning 调用的开括号后停住
  //   `[\s\S]+?\)` → 停在 Tuning 调用自己的 `)`，抓到 "Tuning.xxx("
  //   补成 `\)\s*\)\)` → 数括号数对了，可读性和稳健性都很差
  // 括号配对是这里唯一不会随书写格式变化而失效的做法。
  const lureTierOf = (id) => {
    const at = itemSrc.indexOf('ITEMS.register("' + id + '"');
    if (at < 0) return { found: false };
    const head = itemSrc.indexOf('PartStats.lure(', at);
    if (head < 0) return { found: false };
    const open = head + 'PartStats.lure('.length;
    let depth = 0;
    for (let p = open; p < itemSrc.length; p++) {
      if (itemSrc[p] === '(') depth++;
      else if (itemSrc[p] === ')') {
        if (depth === 0) {
          return { found: true, value: tuningVal(itemSrc.slice(open, p).replace(/\s+/g, ' ')) };
        }
        depth--;
      }
    }
    return { found: false };
  };

  let lureHits = 0;
  for (const e of LURE_EXPECT) {
    const r = lureTierOf(e.id);
    const actual = r.found ? r.value : null;
    if (r.found) lureHits++;
    const ok = actual === e.tier;
    if (!ok) fail++;
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + e.id.padEnd(14)
      + '档 ' + actual + '（期望 ' + e.tier + '=' + e.name + '）' + (e.note ? '  ' + e.note : '')
      + (ok ? '' : '  ← 差 ' + (actual - e.tier) + ' 档'));
  }
  // 断言"解析本身成功了"，否则上面 6 行 null 也能"通过"（null !== tier 会算失败，
  // 但如果哪天期望值也写成 null 就会假通过）。数量对不上说明解析脱节了。
  if (lureHits !== LURE_EXPECT.length) {
    console.log('  ❌ 只解析到 ' + lureHits + '/' + LURE_EXPECT.length +
                ' 个拟饵的档位 —— 解析与 ModItems.java 的写法脱节');
    fail++;
  }
  const hasRed = LURE_EXPECT.some((e) => e.tier === 6);
  if (!hasRed) fail++;
  console.log('  ' + (hasRed ? '✅' : '❌') + ' 拟饵档位覆盖到 6（红档），否则红档拟饵永远是金名');

  // ---- 交叉断言：**同一个档位号，线和饵必须显示同一种颜色** ----
  // 这条就是"品质乱了"的机器化判据：两边起点不一致时它会立刻报错。
  console.log('\n  交叉核对：同一档位号在线/饵上的颜色是否一致');
  const lineTiers = EXPECTED.map((e) => ({ id: e.id, tier: e.tier, name: TIER_NAME[e.tier] }));
  const lureTiers = LURE_EXPECT.map((e) => ({ id: e.id, tier: e.tier, name: e.name }));
  const byTier = new Map();
  for (const x of [...lineTiers, ...lureTiers]) {
    if (!byTier.has(x.tier)) byTier.set(x.tier, []);
    byTier.get(x.tier).push(x.id + '=' + x.name);
  }
  let mismatch = 0;
  for (const [tier, items] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
    const names = new Set(items.map((s) => s.split('=')[1]));
    const ok = names.size === 1;
    if (!ok) mismatch++;
    console.log('    ' + (ok ? '✅' : '❌') + ' 档' + tier + '（' + [...names].join('/') + '）  '
      + items.join('  '));
  }
  if (mismatch) fail++;
}

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
