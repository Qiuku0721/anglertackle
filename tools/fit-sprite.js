// 把一张已抠好的 PNG 紧裁到包围盒，加少量留白，居中放进目标画布（整数倍，放不下就报错）
// 用法: node tools/fit-sprite.js <输入png> <输出png> [--size=512] [--pad=6]
const fs = require('fs');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(n, d) {
  const h = process.argv.find(a => a.startsWith('--' + n + '='));
  return h ? h.slice(n.length + 3) : d;
}
const inFile = process.argv[2], outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('用法: node tools/fit-sprite.js <输入png> <输出png> [--size=512] [--pad=6]');
  process.exit(2);
}
const TARGET = Number(opt('size', 512));
const PAD = Number(opt('pad', 6));

const img = decodePng(fs.readFileSync(inFile));
const { w, h, rgba } = img;
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (rgba[(y * w + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
}
if (x1 < 0) { console.error('输入没有前景'); process.exit(1); }
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const cw = bw + PAD * 2, ch = bh + PAD * 2;

const z = Math.floor(TARGET / Math.max(cw, ch));
if (z < 1) {
  console.error('❌ 内容 ' + cw + 'x' + ch + '（含留白 ' + PAD + '）放不下 ' + TARGET + ' 画布');
  console.error('   最小需要 ' + Math.max(cw, ch) + 'px → 建议 --size=' + (2 ** Math.ceil(Math.log2(Math.max(cw, ch)))));
  process.exit(3);
}
const dw = cw * z, dh = ch * z;
const ox = Math.floor((TARGET - dw) / 2), oy = Math.floor((TARGET - dh) / 2);
const buf = Buffer.alloc(TARGET * TARGET * 4);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const sx = x0 - PAD + x, sy = y0 - PAD + y;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
  const s = (sy * w + sx) * 4;
  if (rgba[s + 3] === 0) continue;
  for (let dy = 0; dy < z; dy++) for (let dx = 0; dx < z; dx++) {
    const d = ((oy + y * z + dy) * TARGET + (ox + x * z + dx)) * 4;
    buf[d] = rgba[s]; buf[d + 1] = rgba[s + 1]; buf[d + 2] = rgba[s + 2]; buf[d + 3] = 255;
  }
}
fs.mkdirSync(require('path').dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(TARGET, TARGET, buf));
console.log(require('path').basename(outFile));
console.log('  主体 ' + bw + 'x' + bh + ' + 留白 ' + PAD + ' → 内容 ' + cw + 'x' + ch
  + ' → 整数放大 x' + z + ' → ' + dw + 'x' + dh + ' 居中于 ' + TARGET + 'x' + TARGET);
console.log('  前景占画布宽 ' + (dw / TARGET * 100).toFixed(0) + '%  高 ' + (dh / TARGET * 100).toFixed(0) + '%');
