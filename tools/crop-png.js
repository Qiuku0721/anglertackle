// 裁剪 PNG 的指定区域，便于放大观察局部细节。
// 用法: node tools/crop-png.js <输入png> <输出png> <x> <y> <w> <h>
const fs = require('fs');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const [, , inFile, outFile, xs, ys, ws, hs] = process.argv;
const img = decodePng(fs.readFileSync(inFile));
const x0 = Number(xs), y0 = Number(ys), cw = Number(ws), ch = Number(hs);
const out = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const sx = x0 + x, sy = y0 + y;
  const d = (y * cw + x) * 4;
  if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
  const s = (sy * img.w + sx) * 4;
  out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1];
  out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
}
fs.writeFileSync(outFile, encodePng(cw, ch, out));
console.log('裁剪 ' + cw + 'x' + ch + ' @ (' + x0 + ',' + y0 + ') → ' + outFile);
