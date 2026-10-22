/*
 * fit-cells.js —— 量出参考图"主体占多少格"，并给出能凑成 64 宽的**整数**放大倍数。
 *
 * 背景：用户给的参考图是在线工具打好的马赛克（本次这批是 4px 一格）。
 * 规则是**不能降采样**（会破坏方块）。但 4px 格子的图主体有 79 格宽，
 * 直接提取得到 79x29 的画布，塞不满 64x64，和现有鱼贴图（前景 64 宽）不一致。
 *
 * 解法：先把原图**整数倍放大**（2 倍），再按 放大后格子 = 原格子 × 倍数 提取。
 * 这在数学上完全等价于"先用整数倍最近邻放大、再取代表色"，
 * 方块边界不会被破坏，只是每格从 4px 变 8px。
 *
 * 用法：node tools/fit-cells.js <png> [--grid=4]
 */
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

function opt(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const file = process.argv[2];
const grid = Number(opt('grid', 4));
if (!file) {
  console.error('用法: node tools/fit-cells.js <png> [--grid=4]');
  process.exit(2);
}

const img = decodePng(fs.readFileSync(file));
const { w, h, rgba } = img;
const px = (x, y) => { const i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };

// 背景色：四角中位数
const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map((c) => {
  const v = corners.map((p) => p[c]).sort((a, b) => a - b);
  return Math.round((v[1] + v[2]) / 2);
});
const tol = Number(opt('bgtol', 60));
const isBg = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < tol;

// 按格子判定：一格中只要超过 40% 的像素是前景，就算这一格是鱼
const cols = Math.floor(w / grid), rows = Math.floor(h / grid);
let minC = cols, maxC = -1, minR = rows, maxR = -1;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    let fg = 0;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        if (!isBg(px(c * grid + x, r * grid + y))) fg++;
      }
    }
    if (fg / (grid * grid) > 0.4) {
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
}

const cw = maxC - minC + 1, chh = maxR - minR + 1;
console.log(path.basename(file));
console.log('  图 ' + w + 'x' + h + '  格子 ' + grid + 'px  背景 rgb(' + bg.join(',') + ')  容差 ' + tol);
console.log('  主体占格：' + cw + ' x ' + chh + ' 格（列 ' + minC + '..' + maxC + '，行 ' + minR + '..' + maxR + '）');

// 找整数放大倍数，让"原格 × 倍数"后主体宽度落在 60~64
const cands = [];
for (let z = 1; z <= 8; z++) {
  const cw2 = cw * z, ch2 = chh * z;
  if (cw2 <= 64 && ch2 <= 64) cands.push({ z, cw: cw2, ch: ch2, grid2: grid * z });
}
if (!cands.length) {
  console.log('  ⚠ 即使放大 1 倍也超过 64 —— 需要裁掉一部分或允许非整数缩放');
} else {
  // 取宽度最大的那个（最接近 64）
  const best = cands.reduce((a, b) => (b.cw > a.cw ? b : a));
  console.log('  可选整数放大：');
  for (const c of cands) {
    console.log('     ×' + c.z + '  → ' + c.cw + 'x' + c.ch + ' 格，格边长 ' + c.grid2 + 'px'
      + (c === best ? '   ← 推荐（最接近 64 宽）' : ''));
  }
  console.log('');
  console.log('  推荐命令：');
  console.log('    node tools/upscale-textures.js ' + path.basename(file) + ' ' + best.z
    + '   # 或任意整数倍放大工具');
  console.log('    node tools/build-ref-texture.js <放大后图> <输出> --grid=' + best.grid2
    + ' --bgtol=' + tol);
}
