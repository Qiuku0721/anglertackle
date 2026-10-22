// ============================================================================
//  analyze-ref.js -- 分析参考图：找出像素网格尺寸、背景色、主体包围盒
//
//  用户发来的参考图是被放大/重采样过的，不能直接当 16×16 像素画用。
//  这个脚本回答三个问题：
//    1. 它本身是不是"整齐的像素放大"（相邻格子颜色一致）？如果是，原始分辨率是多少？
//    2. 背景色是什么？（用户说"背景色自己改"，也就是要去掉）
//    3. 主体占哪块区域？
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

const file = process.argv[2];
const img = decodePng(fs.readFileSync(file));
const { w, h, rgba } = img;

function px(x, y) {
  const i = (y * w + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

console.log('\n================ ' + path.basename(file) + ' ================');
console.log('尺寸: ' + w + ' x ' + h);

// ---- 1) 背景色：取四个角的中位数 ----
const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => {
  const v = corners.map(p => p[c]).sort((a, b) => a - b);
  return Math.round((v[1] + v[2]) / 2);
});
console.log('背景色: rgb(' + bg.join(',') + ')   亮度 ' + lum(...bg).toFixed(0));
console.log('四角采样: ' + corners.map(p => '(' + p[0] + ',' + p[1] + ',' + p[2] + ')').join(' '));

// ---- 2) 主体包围盒（与背景差异大的像素）----
let minX = w, minY = h, maxX = -1, maxY = -1, fg = 0;
const bgTol = 40;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const p = px(x, y);
    if (p[3] < 24) continue;
    if (dist(p, bg) > bgTol) {
      fg++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) { console.log('没找到主体'); process.exit(0); }
const bw = maxX - minX + 1, bh = maxY - minY + 1;
console.log('主体包围盒: x ' + minX + '..' + maxX + ' (宽 ' + bw + '), y ' + minY + '..' + maxY + ' (高 ' + bh + ')');
console.log('主体像素占比: ' + (100 * fg / (w * h)).toFixed(1) + '%');

// ---- 3) 检测网格：在包围盒内统计"水平/垂直方向颜色变化的位置"，看间隔是否均匀 ----
// 对每一列，计算它和前一列的平均色差；变化大的列就是格子边界。
function colDiffs(x0, x1, y0, y1) {
  const out = [];
  for (let x = x0 + 1; x <= x1; x++) {
    let s = 0, n = 0;
    for (let y = y0; y <= y1; y++) { s += dist(px(x, y), px(x - 1, y)); n++; }
    out.push({ x, d: s / n });
  }
  return out;
}
function rowDiffs(x0, x1, y0, y1) {
  const out = [];
  for (let y = y0 + 1; y <= y1; y++) {
    let s = 0, n = 0;
    for (let x = x0; x <= x1; x++) { s += dist(px(x, y), px(x, y - 1)); n++; }
    out.push({ y, d: s / n });
  }
  return out;
}

console.log('\n-- 垂直边界候选（列色差 > 25 的列号）--');
const cd = colDiffs(minX, maxX, minY, maxY).filter(o => o.d > 25);
console.log(cd.length ? cd.map(o => o.x).join(' ') : '（没有明显边界，说明不是硬边像素放大，或是照片）');
console.log('\n-- 水平边界候选（行色差 > 25 的行号）--');
const rd = rowDiffs(minX, maxX, minY, maxY).filter(o => o.d > 25);
console.log(rd.length ? rd.map(o => o.y).join(' ') : '（没有）');

// ---- 4) 统计相邻列色差为 0 的比例：如果是整数倍最近邻放大，会有大量重复列 ----
let dupCols = 0;
for (const o of colDiffs(minX, maxX, minY, maxY)) if (o.d < 1.5) dupCols++;
let dupRows = 0;
for (const o of rowDiffs(minX, maxX, minY, maxY)) if (o.d < 1.5) dupRows++;
console.log('\n几乎重复的列: ' + dupCols + '/' + bw + '，几乎重复的行: ' + dupRows + '/' + bh);
console.log('→ ' + (dupCols > bw * 0.5 && dupRows > bh * 0.5
  ? '看起来是"最近邻放大"，原始分辨率约 ' + Math.round(bw / Math.max(1, Math.round(bw / (bw - dupCols)))) + ' 级'
  : '不是整齐的整数倍放大（可能是照片或重采样过，需要重新绘制而不是直接缩小）'));
