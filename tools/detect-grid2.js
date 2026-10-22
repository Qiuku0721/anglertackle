// 更严格地测网格：只在主体范围内统计，并列出游程直方图，避免细长物体测错。
// 用法: node tools/detect-grid2.js <png> [背景容差]
const fs = require('fs');
const { decodePng } = require('./image-to-sprite.js');

const img = decodePng(fs.readFileSync(process.argv[2]));
const tol = Number(process.argv[3] || 60);
const { w, h, rgba } = img;
const px = (x, y) => { const i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };

const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => { const v = corners.map(p => p[c]).sort((a, b) => a - b); return Math.round((v[1] + v[2]) / 2); });
const isBg = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < tol;

let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (!isBg(px(x, y))) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
}
console.log('图 ' + w + 'x' + h + '  背景 rgb(' + bg.join(',') + ')  容差 ' + tol);
console.log('主体包围盒 ' + (maxX - minX + 1) + 'x' + (maxY - minY + 1) + '  (x ' + minX + '..' + maxX + ', y ' + minY + '..' + maxY + ')');

// 逐列/逐行的"前景像素数"，找周期性
function profile(isCol) {
  const n = isCol ? (maxX - minX + 1) : (maxY - minY + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    let c = 0;
    if (isCol) { const x = minX + i; for (let y = minY; y <= maxY; y++) if (!isBg(px(x, y))) c++; }
    else { const y = minY + i; for (let x = minX; x <= maxX; x++) if (!isBg(px(x, y))) c++; }
    out.push(c);
  }
  return out;
}
const colP = profile(true), rowP = profile(false);
const show = (p, name) => {
  console.log(name + ' 前景数序列: ' + p.join(','));
  // 自相关：找出让序列最相似的位移
  let best = 0, bestScore = -1;
  for (let lag = 2; lag <= Math.min(16, Math.floor(p.length / 2)); lag++) {
    let same = 0, tot = 0;
    for (let i = 0; i + lag < p.length; i++) { tot++; if (p[i] === p[i + lag]) same++; }
    const score = same / tot;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  console.log('  → 最可能的周期 = ' + best + ' px（吻合度 ' + (bestScore * 100).toFixed(0) + '%）');
};
show(colP, '列');
show(rowP, '行');
