// ============================================================================
//  detect-grid.js -- 精确测出"最近邻放大"的格子大小
//
//  思路：把每一列（或行）压成一个平均色向量，然后找"连续相同的列"的游程长度。
//  如果是 N 倍最近邻放大，所有游程长度都是 N 的倍数（或 N 的倍数±1 的边界误差）。
//  取所有游程长度的最大公约数，就是格子边长。
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

const file = process.argv[2];
const img = decodePng(fs.readFileSync(file));
const { w, h, rgba } = img;

function px(x, y) {
  const i = (y * w + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

// 先把"和背景接近"的像素标为背景
const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => {
  const v = corners.map(p => p[c]).sort((a, b) => a - b);
  return Math.round((v[1] + v[2]) / 2);
});
const isBg = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 45;

// 前景包围盒
let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (!isBg(px(x, y))) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
}

// 一列/一行的签名：把该列（在包围盒范围内）的平均颜色量化成整数
function colSig(x) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = minY; y <= maxY; y++) {
    const p = px(x, y);
    if (isBg(p)) continue;
    r += p[0]; g += p[1]; b += p[2]; n++;
  }
  if (n === 0) return 'bg';
  return [Math.round(r / n / 6), Math.round(g / n / 6), Math.round(b / n / 6), Math.round(n / 4)].join(',');
}
function rowSig(y) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let x = minX; x <= maxX; x++) {
    const p = px(x, y);
    if (isBg(p)) continue;
    r += p[0]; g += p[1]; b += p[2]; n++;
  }
  if (n === 0) return 'bg';
  return [Math.round(r / n / 6), Math.round(g / n / 6), Math.round(b / n / 6), Math.round(n / 4)].join(',');
}

function runs(sigFn, from, to) {
  const out = [];
  let cur = sigFn(from), len = 1;
  for (let i = from + 1; i <= to; i++) {
    const s = sigFn(i);
    if (s === cur) len++;
    else { out.push(len); cur = s; len = 1; }
  }
  out.push(len);
  return out;
}
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

const cr = runs(colSig, minX, maxX);
const rr = runs(rowSig, minY, maxY);
// 忽略长度 1 的游程（噪声），它们会毁掉 GCD
const crF = cr.filter(l => l > 1);
const rrF = rr.filter(l => l > 1);
const g1 = crF.reduce((a, b) => gcd(a, b), 0);
const g2 = rrF.reduce((a, b) => gcd(a, b), 0);

console.log('\n===== ' + path.basename(file) + ' =====');
console.log('前景包围盒 ' + (maxX - minX + 1) + ' x ' + (maxY - minY + 1));
console.log('列游程 (前 30): ' + cr.slice(0, 30).join(','));
console.log('行游程 (前 30): ' + rr.slice(0, 30).join(','));
console.log('列游程 GCD = ' + g1 + '   行游程 GCD = ' + g2);
// 统计最常见的游程长度
const tally = (arr) => {
  const m = new Map();
  for (const l of arr) m.set(l, (m.get(l) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, c]) => l + '×' + c).join('  ');
};
console.log('列游程最常见长度: ' + tally(crF));
console.log('行游程最常见长度: ' + tally(rrF));
const cell = (g1 > 1 && g1 === g2) ? g1 : (g1 > 1 ? g1 : g2);
if (cell > 1) {
  console.log('→ 推测格子边长 = ' + cell + ' px，原始分辨率约 '
    + Math.round((maxX - minX + 1) / cell) + ' x ' + Math.round((maxY - minY + 1) / cell));
} else {
  console.log('→ 测不出整数格子，可能不是最近邻放大');
}
