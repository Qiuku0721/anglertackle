// 紧裁到包围盒、原生像素、可选留白。画布 = 内容尺寸（不放大到 2 的幂）。
// Minecraft 物品贴图允许任意尺寸，而且模型用整幅贴图 -> 留白会缩小显示，
// 所以默认 pad=0，让鱼填满整幅。
const fs = require('fs'), path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(n, d) {
  const h = process.argv.find(a => a.startsWith('--' + n + '='));
  return h ? h.slice(n.length + 3) : d;
}
const inFile = process.argv[2], outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('用法: node tools/crop-sprite.js <输入png> <输出png> [--pad=0] [--scale=1]');
  process.exit(2);
}
const PAD = Number(opt('pad', 0));
let Z = Number(opt('scale', 1));   // 1 = 原生像素；>1 只能整数

const img = decodePng(fs.readFileSync(inFile));
const { w, h, rgba } = img;
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (rgba[(y * w + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
}
if (x1 < 0) { console.error('输入没有前景: ' + inFile); process.exit(1); }
if (!Number.isInteger(Z) || Z < 1) { console.error('--scale 必须是 ≥1 的整数'); process.exit(2); }

const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const cw = bw + PAD * 2, ch = bh + PAD * 2;
const W = cw * Z, H = ch * Z;
const buf = Buffer.alloc(W * H * 4);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const sx = x0 - PAD + x, sy = y0 - PAD + y;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
  const s = (sy * w + sx) * 4;
  if (rgba[s + 3] === 0) continue;
  for (let dy = 0; dy < Z; dy++) for (let dx = 0; dx < Z; dx++) {
    const d = ((y * Z + dy) * W + (x * Z + dx)) * 4;
    buf[d] = rgba[s]; buf[d + 1] = rgba[s + 1]; buf[d + 2] = rgba[s + 2]; buf[d + 3] = 255;
  }
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(W, H, buf));
const ar = (bw / bh);
console.log(path.basename(outFile).padEnd(24) + ' 主体 ' + bw + 'x' + bh
  + ' + 留白 ' + PAD + ' → 画布 ' + W + 'x' + H + '  宽高比 ' + ar.toFixed(2)
  + (Z > 1 ? '  (x' + Z + ' 放大)' : ''));
