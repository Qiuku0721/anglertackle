/*
 * dump-baits.js —— 从 ModItems.java 里抽出鱼饵/拟饵的真实注册参数。
 *
 * 存在理由：文档表格里那张"鱼饵品质下限"表是手写的，随着饵料改档早就过期了
 * （表里还写着"面包屑/发光饵/秘制香饵"这些不存在的名字）。
 * 与其手抄，不如直接从源码里读——这样表永远和代码一致。
 *
 * 用法：node tools/dump-baits.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'registry', 'ModItems.java');
const src = fs.readFileSync(SRC, 'utf8');

const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

// 照抄 FishingSession.minTierOf
function minTierOfBait(t) {
  if (t === 3) return 1;
  if (t === 4 || t === 5) return 2;
  return 0;
}

/**
 * 从 src 的 startAt 位置（指向 '(' 之后）开始，按**括号配对**扫描出这一层调用的参数体。
 *
 * <p>为什么不用正则：ModItems 里嵌套调用长这样
 * {@code partProps(40, Rarity.UNCOMMON, PartStats.lure(1, 15.0, 1.8))))}，
 * 尾部括号层数随嵌套深度变化，而且 {@code PartStats.lure(...)} 内部还有逗号。
 * 正则要么吃过头（把内层右括号吞掉，参数被切残），要么按逗号 split 时把内层逗号也切开。
 * 按括号深度扫一遍最简单也最不容易错。
 *
 * @return 参数体字符串；找不到配对括号时返回 null
 */
function readArgs(s, startAt) {
  let depth = 1;
  for (let i = startAt; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return s.slice(startAt, i);
    } else if (c === ';') {
      return null;   // 越过了语句结尾，说明没找到配对
    }
  }
  return null;
}

/** 按**顶层逗号**切分参数（忽略括号内的逗号）。 */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 找出 s 中第一个 {@code Name(} 调用，返回其参数体。 */
function callArgs(s, callName) {
  const idx = s.indexOf(callName + '(');
  if (idx < 0) return null;
  return readArgs(s, idx + callName.length + 1);
}

// ---- 鱼饵：BaitItem(tier, ...) ----
const baits = [];
{
  const re = /ITEMS\.register\(\s*"(bait_[a-z_]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const ctorIdx = src.indexOf('new BaitItem(', m.index);
    if (ctorIdx < 0 || ctorIdx - m.index > 200) continue;   // 不是同一个注册块
    const args = readArgs(src, ctorIdx + 'new BaitItem('.length);
    if (args === null) continue;
    const parts = splitTop(args);
    baits.push({ id: m[1], tier: Number(parts[0]) });
  }
}

// ---- 拟饵：TacklePartItem(Slot.LURE, partProps(耐久, Rarity, PartStats.lure(档, 体重, 倍率))) ----
const lures = [];
{
  const re = /ITEMS\.register\(\s*"(lure_[a-z_]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const ctorIdx = src.indexOf('new TacklePartItem(', m.index);
    if (ctorIdx < 0 || ctorIdx - m.index > 200) continue;
    const ctor = readArgs(src, ctorIdx + 'new TacklePartItem('.length);
    if (ctor === null) continue;
    const ppIdx = ctor.indexOf('partProps(');
    if (ppIdx < 0) continue;
    const pp = readArgs(ctor, ppIdx + 'partProps('.length);
    if (pp === null) continue;
    const head = splitTop(pp);
    const lureArgs = callArgs(pp, 'PartStats.lure');
    const la = lureArgs === null ? [] : splitTop(lureArgs);
    lures.push({
      id: m[1],
      durability: Number(head[0]),
      rarity: head[1],
      tier: Number(la[0]),
      maxWeight: Number(la[1]),
      bonus: Number(la[2]),
    });
  }
}

const pad = (s, n) => String(s).padEnd(n);

console.log('=== 鱼饵（BaitItem）===');
console.log(pad('id', 16) + pad('档位', 6) + pad('咬钩下限', 22) + '额外吸引力');
console.log('-'.repeat(68));
for (const b of baits.sort((x, y) => x.tier - y.tier)) {
  const min = minTierOfBait(b.tier);
  const lim = min === 0 ? '无（不限）' : `${TIER_NAME[min]}档起（滤${TIER_NAME.slice(0, min).join('')}）`;
  const bonus = b.tier === 5 ? '金鱼 +5%、红鱼 +1.8%' : '无';
  console.log(pad(b.id, 16) + pad(String(b.tier) + TIER_NAME[b.tier], 6) + pad(lim, 22) + bonus);
}

console.log('\n=== 拟饵（TacklePartItem, Slot.LURE）===');
console.log(pad('id', 16) + pad('档位', 6) + pad('耐久', 6) + pad('体型上限', 11)
  + pad('吸引倍率', 10) + '咬钩下限');
console.log('-'.repeat(78));
for (const l of lures.sort((x, y) => x.tier - y.tier)) {
  const min = minTierOfBait(l.tier);
  const lim = min === 0 ? '无（不限）' : `${TIER_NAME[min]}档起（滤${TIER_NAME.slice(0, min).join('')}）`;
  const extra = l.tier === 5 ? '  +金红加成' : '';
  console.log(pad(l.id, 16) + pad(String(l.tier) + TIER_NAME[l.tier], 6) + pad(l.durability, 6)
    + pad(l.maxWeight + ' kg', 11) + pad('×' + l.bonus, 10) + lim + extra);
}

console.log('\n=== 关键规则 ===');
console.log('  品质着色：拟饵读自己的档位（1~5 → 绿/蓝/紫/金/红），不再看 Rarity（原版只有四档，金红会都变紫）');
console.log('  咬钩下限：紫饵/紫拟饵 → 绿档起；金、红 → 蓝档起');
console.log('  下限同时作用于**鱼种**和**个体**：鱼种级按 maxTier 过滤，个体级按体重区间精确采样');
console.log('  红档额外：金鱼 +5%、红鱼 +1.8%（鱼种抽取阶段的权重倍率，台钓红饵与路亚红拟饵同享）');
