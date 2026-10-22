// 把新鱼从原生像素缩到与老鱼同一显示档位。
//
// 背景：老参考图是 5px 一格的粗糙马赛克（原生只有 38~66 格），
//       新参考图是 1px 的精细像素画（原生 217~327 格）。
//       MC 按整幅贴图缩放填满 GUI 格，所以新鱼会长得大 5 倍 —— 背包里像贪饕。
//       这里统一外观尺度：缩到 --maxw（默认 64，对齐老鱼前景宽度）。
//
// 缩放用**面积平均**（box filter）而不是最近邻：缩小 5 倍时最近邻会丢整行整列，
// 出现锯齿和断裂；面积平均在这种大比例缩小时干净得多。
const fs = require('fs'), path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(n, d) {
  const h = process.argv.find(a => a.startsWith('--' + n + '='));
  return h ? h.slice(n.length + 3) : d;
}
const maxW = Number(opt('maxw', 64));
const maxH = Number(opt('maxh', 1e9));
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const outDir = opt('out', '参考资料/鱼图/_scaled');
if (files.length < 1) {
  console.error('用法: node tools/scale-fish.js <输入png...> [--maxw=64] [--maxh=999] [--out=目录]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

for (const f of files) {
  const img = decodePng(fs.readFileSync(f));
  const { w, h, rgba } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { console.log(path.basename(f) + ' 全透明，跳过'); continue; }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const scale = Math.min(maxW / bw, maxH / bh, 1);
  const nw = Math.max(1, Math.round(bw * scale));
  const nh = Math.max(1, Math.round(bh * scale));

  const out = Buffer.alloc(nw * nh * 4);
  for (let dy = 0; dy < nh; dy++) for (let dx = 0; dx < nw; dx++) {
    // 该目标像素覆盖的源区间
    const sx0 = x0 + Math.floor(dx * bw / nw), sx1 = x0 + Math.max(Math.floor((dx + 1) * bw / nw), Math.floor(dx * bw / nw) + 1);
    const sy0 = y0 + Math.floor(dy * bh / nh), sy1 = y0 + Math.max(Math.floor((dy + 1) * bh / nh), Math.floor(dy * bh / nh) + 1);
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = sy0; sy < sy1 && sy < y0 + bh; sy++) for (let sx = sx0; sx < sx1 && sx < x0 + bw; sx++) {
      const i = (sy * w + sx) * 4;
      if (rgba[i + 3] === 0) continue;          // 透明不参与平均
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
    }
    if (n === 0) continue;                       // 整格透明 -> 保持透明
    // 覆盖率过半才算不透明，避免边缘拖出半透明脏边
    const cover = n / ((sx1 - sx0) * (sy1 - sy0));
    if (cover < 0.5) continue;
    const d = (dy * nw + dx) * 4;
    out[d] = Math.round(r / n); out[d + 1] = Math.round(g / n);
    out[d + 2] = Math.round(b / n); out[d + 3] = 255;
  }
  const outp = path.join(outDir, path.basename(f));
  fs.writeFileSync(outp, encodePng(nw, nh, out));
  console.log(path.basename(f).padEnd(24) + (bw + 'x' + bh).padEnd(12) + '→ ' + (nw + 'x' + nh).padEnd(11)
    + '缩放 x' + scale.toFixed(3) + '  比例 ' + (nw / nh).toFixed(2));
}
