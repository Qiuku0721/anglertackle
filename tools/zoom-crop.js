/*
 * zoom-crop.js —— 把图片的一个局部按整数倍放大，用于**肉眼数马赛克格边长**。
 *
 * 为什么需要它：detect-grid2 的自相关在这批图上吻合度只有 12%~41%，
 * 得出的"周期 2px"不可信（背景容差、抗锯齿、格子内颜色变化都会干扰）。
 * 与其信一个低置信度的自动结果，不如裁一小块放大 12 倍，直接数格子。
 *
 * 用法：node tools/zoom-crop.js <png> <输出png> [--x=] [--y=] [--w=] [--h=] [--zoom=12]
 */
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? Number(hit.slice(name.length + 3)) : def;
}

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('用法: node tools/zoom-crop.js <png> <输出png> [--x=] [--y=] [--w=] [--h=] [--zoom=12]');
  process.exit(2);
}

const img = decodePng(fs.readFileSync(inFile));
const { w, h, rgba } = img;

const cx = opt('x', Math.floor(w / 2) - 20);
const cy = opt('y', Math.floor(h / 2) - 10);
const cw = Math.min(opt('w', 40), w - cx);
const ch = Math.min(opt('h', 20), h - cy);
const zoom = opt('zoom', 12);

const ow = cw * zoom, oh = ch * zoom;
const out = Buffer.alloc(ow * oh * 4);

for (let oy = 0; oy < oh; oy++) {
  const sy = cy + Math.floor(oy / zoom);
  for (let ox = 0; ox < ow; ox++) {
    const sx = cx + Math.floor(ox / zoom);
    const si = (sy * w + sx) * 4;
    const di = (oy * ow + ox) * 4;
    out[di] = rgba[si];
    out[di + 1] = rgba[si + 1];
    out[di + 2] = rgba[si + 2];
    out[di + 3] = rgba[si + 3];
  }
}

// 每 step 个原像素画一条细网格线，方便直接数出格子边长。
// ⚠ step=1 时线太密（每个原像素一条），反而看不清格子边界。
//   默认按 2 原像素一条 —— 马赛克格通常是 2/3/4 像素，2 像素一格线
//   既能数清、又不会糊成一片。
const step = Math.max(1, opt('line', 2));
for (let gy = 0; gy <= ch; gy += step) {
  for (let gx = 0; gx < ow; gx++) {
    const oy = gy * zoom;
    if (oy >= oh) continue;
    const di = (oy * ow + gx) * 4;
    out[di] = 255 - out[di]; out[di + 1] = 0; out[di + 2] = 255; out[di + 3] = 255;
  }
}
for (let gx = 0; gx <= cw; gx += step) {
  for (let gy = 0; gy < oh; gy++) {
    const ox = gx * zoom;
    if (ox >= ow) continue;
    const di = (gy * ow + ox) * 4;
    out[di] = 255 - out[di]; out[di + 1] = 0; out[di + 2] = 255; out[di + 3] = 255;
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(ow, oh, out));

console.log('裁剪 (' + cx + ',' + cy + ') 尺寸 ' + cw + 'x' + ch + ' → 放大 ' + zoom + ' 倍 = ' + ow + 'x' + oh);
console.log('输出 ' + outFile);
console.log('');
console.log('图上的品红细线**每 ' + step + ' 个原像素一条**。');
console.log('如果马赛克格是 N 原像素，那么每 N/' + step + ' 条线之间的颜色才变化一次 —— 数一下就知道 N。');
