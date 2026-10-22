// 列出还原后像素画的主要颜色，用来判断"该染哪个色"。
// 用法: node tools/dump-colors.js <png> [最多显示几种]
const fs = require('fs');
const { decodePng } = require('./image-to-sprite.js');

const img = decodePng(fs.readFileSync(process.argv[2]));
const topN = Number(process.argv[3] || 12);
const { w, h, rgba } = img;

const tally = new Map();
for (let i = 0; i < w * h; i++) {
  const o = i * 4;
  if (rgba[o + 3] < 128) continue;
  const k = rgba[o] + ',' + rgba[o + 1] + ',' + rgba[o + 2];
  tally.set(k, (tally.get(k) || 0) + 1);
}
const total = [...tally.values()].reduce((a, b) => a + b, 0);
const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 0) {
    if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return [Math.round(hh), mx === 0 ? 0 : d / mx, mx];
}

console.log('图 ' + w + 'x' + h + '  不透明像素 ' + total + '  不同颜色 ' + tally.size);
console.log('  排名  颜色         占比     色相   饱和   明度');
console.log('  ' + '-'.repeat(52));
sorted.slice(0, topN).forEach(([k, n], i) => {
  const [r, g, b] = k.split(',').map(Number);
  const [hh, ss, vv] = hsv(r, g, b);
  console.log('  ' + String(i + 1).padStart(3) + '   #'
    + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    + '   ' + (100 * n / total).toFixed(1).padStart(5) + '%'
    + '   ' + String(hh).padStart(4) + '°'
    + '   ' + ss.toFixed(2)
    + '   ' + vv.toFixed(2));
});
