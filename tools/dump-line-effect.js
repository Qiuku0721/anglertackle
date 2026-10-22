/*
 * dump-line-effect.js —— 鱼线六档的**合成后实际效果**，以及"危险窗口"占比。
 *
 * 为什么光看原始倍率不够：
 *   张力上限是 100 × [1+(线-1)×0.60] × [1+(竿-1)×0.40]，**加权合成**，
 *   不是直接取线的值；张力回复同样加权。而真正决定手感的是
 *   "白区/黄区/红区各占多少" —— 上限抬高之后三区按比例放大，
 *   危险窗口（黄区→断线）的**占比**才是"这条线安不安全"的量化指标。
 *
 * 用法：node tools/dump-line-effect.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const itemSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
  'whitecobalt', 'anglertackle', 'registry', 'ModItems.java'), 'utf8');

const W_LINE = 0.60, W_ROD = 0.40;
const BASE_CEILING = 100.0, BASE_RECOVER = 1.6;
const WHITE_RATIO = 0.55, YELLOW_RATIO = 0.82;

const LINES = [
  { id: 'hemp_line', name: '麻线' },
  { id: 'cotton_line', name: '棉线' },
  { id: 'nylon_line', name: '尼龙线' },
  { id: 'fluoro_line', name: '碳氟线' },
  { id: 'pe_line', name: 'PE线' },
  { id: 'titanium_line', name: '钛合金记忆线' },
];
const RODS = [
  { name: '木竿', ceiling: 1.00, recover: 1.00 },
  { name: '铁竿', ceiling: 1.20, recover: 1.20 },
  { name: '金竿', ceiling: 1.10, recover: 1.15 },
  { name: '钻竿', ceiling: 1.60, recover: 1.70 },
  { name: '合金竿', ceiling: 1.70, recover: 1.90 },
];
const TIER = { hemp_line: '白', cotton_line: '绿', nylon_line: '蓝', fluoro_line: '紫', pe_line: '金', titanium_line: '红' };

function readLine(id) {
  const at = itemSrc.indexOf('ITEMS.register("' + id + '"');
  const next = itemSrc.indexOf('ITEMS.register("', at + 10);
  const block = itemSrc.slice(at, next < 0 ? itemSrc.length : next);
  const call = block.indexOf('PartStats.line(');
  let depth = 0, end = -1;
  for (let p = call + 'PartStats.line'.length; p < block.length; p++) {
    if (block[p] === '(') depth++;
    else if (block[p] === ')') { depth--; if (depth === 0) { end = p; break; } }
  }
  const args = block.slice(call + 'PartStats.line('.length, end).split(',').map((s) => s.trim());
  const val = (s) => Number.isFinite(Number(s)) ? Number(s) : Function('"use strict";return (' + s + ')')();
  const dur = Number(/partProps\(\s*(\d+)\s*,/.exec(block)[1]);
  return { id, dur, ceiling: val(args[0]), gen: val(args[1]), recover: val(args[2]), len: 30 * val(args[3]) };
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log('=== 鱼线六档：原始数值 ===\n');
console.log('  鱼线            档位  耐久  张力上限  张力生成  张力回复  线长');
console.log('  ' + '-'.repeat(66));
const data = LINES.map((l) => ({ ...l, ...readLine(l.id) }));
for (const l of data) {
  console.log('  ' + pad(l.name, 15) + pad(TIER[l.id], 6) + padL(l.dur, 5)
    + padL('×' + l.ceiling.toFixed(2), 10) + padL('×' + l.gen.toFixed(2), 10)
    + padL('×' + l.recover.toFixed(2), 10) + padL(l.len.toFixed(0) + ' 米', 8));
}

// ---- 合成后：以木竿为基准展示（竿的影响另列） ----
console.log('\n=== 合成后（配木竿：竿倍率全 1.0，即"线本身给多少"）===\n');
console.log('  鱼线            张力上限  白区   黄区   红区缓冲  红区占比  松手回落   涨到断线');
console.log('  ' + '-'.repeat(96));
// ⚠ 白区/黄区是按**上限的固定比例**（55% / 82%）划的，所以"红区占比"恒为 18%，
//   不随线变化 —— 别把它当成高档线的收益（这个脚本第一版就是这么写错的）。
//   真正随档位变的只有两件事：
//     ① 红区缓冲的**绝对点数**（上限抬高 → 容错空间变大）
//     ② 涨到断线要多久（生成倍率下降 → 反应时间变长）
for (const l of data) {
  const ceil = BASE_CEILING * (1 + (l.ceiling - 1) * W_LINE) * (1 + (1.00 - 1) * W_ROD);
  const white = ceil * WHITE_RATIO;
  const yellow = ceil * YELLOW_RATIO;
  const buffer = ceil - yellow;
  const recover = BASE_RECOVER * (1 + (l.recover - 1) * W_LINE) * (1 + (1.00 - 1) * W_ROD);
  // 从黄区上限涨到断线要多少秒（只算收线带来的稳定涨幅，不含鱼的拉力）
  const risePerSec = 0.9 * 20 * l.gen;
  const secToSnap = buffer / risePerSec;
  console.log('  ' + pad(l.name, 15) + padL(ceil.toFixed(0), 8)
    + padL(white.toFixed(0), 7) + padL(yellow.toFixed(0), 7)
    + padL(buffer.toFixed(0) + ' 点', 11) + padL('18.0%', 10)
    + padL((recover * 20).toFixed(1), 10) + padL(secToSnap.toFixed(2) + ' 秒', 11));
}
// ⚠ 结论文字**必须从上面算出来的数据生成**，不能硬编码 ——
//   第一版把"麻线 18 点 → 钛合金 34 点、1.0 秒 → 3.6 秒"写死了，
//   后来用户把蓝档及以上整体弱化 12%，表格更新了、这段文字还在说旧值。
const first = data[0], last = data[data.length - 1];
const calc = (l) => {
  const ceil = BASE_CEILING * (1 + (l.ceiling - 1) * W_LINE) * (1 + (1.00 - 1) * W_ROD);
  const recover = BASE_RECOVER * (1 + (l.recover - 1) * W_LINE) * (1 + (1.00 - 1) * W_ROD);
  const buffer = ceil - ceil * YELLOW_RATIO;
  return { buffer, recover: recover * 20, secToSnap: buffer / (0.9 * 20 * l.gen) };
};
const f0 = calc(first), f1 = calc(last);
console.log('\n  ⚠ "红区占比"恒为 18% —— 因为白/黄区是按上限的固定比例划的，它不随线变化。');
console.log('  高档线的真实收益是另外两条：');
console.log('    ① 红区**绝对缓冲**变大（' + first.name + ' ' + f0.buffer.toFixed(0)
  + ' 点 → ' + last.name + ' ' + f1.buffer.toFixed(0) + ' 点，'
  + (f1.buffer / f0.buffer).toFixed(2) + ' 倍容错）');
console.log('    ② **涨到断线的时间变长**（' + f0.secToSnap.toFixed(2) + ' 秒 → '
  + f1.secToSnap.toFixed(2) + ' 秒，' + (f1.secToSnap / f0.secToSnap).toFixed(2) + ' 倍反应时间）');
console.log('  第三条是松手回落更快（' + f0.recover.toFixed(1) + ' → ' + f1.recover.toFixed(1)
  + ' 点/秒），放线时脱险更利索。');

// ---- 竿的影响 ----
console.log('\n=== 竿对张力上限的影响（同一根钛合金线）===\n');
console.log('  竿        竿倍率  合成上限  白区  黄区  红区  危险占比');
console.log('  ' + '-'.repeat(60));
const ti = data.find((l) => l.id === 'titanium_line');
for (const r of RODS) {
  const ceil = BASE_CEILING * (1 + (ti.ceiling - 1) * W_LINE) * (1 + (r.ceiling - 1) * W_ROD);
  const white = ceil * WHITE_RATIO, yellow = ceil * YELLOW_RATIO;
  console.log('  ' + pad(r.name, 9) + padL('×' + r.ceiling.toFixed(2), 8)
    + padL(ceil.toFixed(0), 10) + padL(white.toFixed(0), 7)
    + padL((yellow - white).toFixed(0), 6) + padL((ceil - yellow).toFixed(0), 6)
    + padL(((ceil - yellow) / ceil * 100).toFixed(1) + '%', 11));
}

// ---- 张力生成的影响 ----
console.log('\n=== 张力生成的影响（收线时张力涨多快）===\n');
console.log('  BASE_REEL_GAIN 取 0.9（中立控杆）：');
console.log('  鱼线            生成倍率  每分钟最大涨幅（不放线）');
console.log('  ' + '-'.repeat(56));
for (const l of data) {
  // 稳定涨速（忽略鱼的拉力）：REEL_GAIN 0.9 / tick
  const perSec = 0.9 * 20 * l.gen;
  console.log('  ' + pad(l.name, 15) + padL('×' + l.gen.toFixed(2), 10)
    + padL(perSec.toFixed(1) + ' 点/秒', 22));
}
console.log('\n  麻线 18 点/秒 vs 钛合金 9.4 点/秒 —— 后者要涨两倍时间才到同样的张力。');
