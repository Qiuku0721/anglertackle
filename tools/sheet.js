// ============================================================================
//  sheet.js -- 把多张图拼成一张总览图（带棋盘格透明底），用于肉眼核对
//  用法: node tools/sheet.js <输出png> <列数> <放大倍数> <图1> <图2> ...
// ============================================================================
const fs = require('fs');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const out = process.argv[2];
const cols = Number(process.argv[3] || 4);
const zoom = Number(process.argv[4] || 1);
const files = process.argv.slice(5);

const imgs = files.map(f => decodePng(fs.readFileSync(f)));
const cw = Math.max(...imgs.map(i => i.w)) * zoom;
const chh = Math.max(...imgs.map(i => i.h)) * zoom;
const pad = 6;
const rows = Math.ceil(imgs.length / cols);
const W = cols * cw + (cols + 1) * pad;
const H = rows * chh + (rows + 1) * pad;
const buf = Buffer.alloc(W * H * 4);

// 深灰底
for (let i = 0; i < W * H; i++) { buf[i * 4] = 40; buf[i * 4 + 1] = 44; buf[i * 4 + 2] = 52; buf[i * 4 + 3] = 255; }

imgs.forEach((img, i) => {
  const cx = i % cols, cy = Math.floor(i / cols);
  const ox = pad + cx * (cw + pad), oy = pad + cy * (chh + pad);
  const w = img.w * zoom, h = img.h * zoom;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y / zoom | 0) * img.w + (x / zoom | 0)) * 4;
    if (img.rgba[s + 3] < 128) {
      // 透明处画棋盘格
      const chk = ((x >> 3) + (y >> 3)) & 1;
      const d = ((oy + y) * W + ox + x) * 4;
      const v = chk ? 70 : 52;
      buf[d] = v; buf[d + 1] = v; buf[d + 2] = v + 6; buf[d + 3] = 255;
      continue;
    }
    const d = ((oy + y) * W + ox + x) * 4;
    buf[d] = img.rgba[s]; buf[d + 1] = img.rgba[s + 1];
    buf[d + 2] = img.rgba[s + 2]; buf[d + 3] = 255;
  }
});
fs.writeFileSync(out, encodePng(W, H, buf));
console.log('总览图: ' + out + '  ' + W + 'x' + H);
files.forEach((f, i) => console.log('  [' + (i + 1) + '] ' + f.split(/[\\/]/).pop()));
