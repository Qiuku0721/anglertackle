/*
 * measure-cell.js —— 量一张**成品贴图**里的马赛克格边长。
 *
 * 为什么要它：新鱼参考图是 4px 格，但现有成品贴图（如 atlantic_salmon）
 * 看起来格子更小。在决定"新图该按什么规格处理"之前，
 * 必须先量准现有成品的实际格边长，否则规格会不一致。
 *
 * 方法：在主体内部找一行/一列，统计"连续同色像素"的游程，
 * 取游程的众数（GCD 会被抗锯齿噪声干扰，众数更稳）。
 *
 * 用法：node tools/measure-cell.js <png>
 */
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

const file = process.argv[2];
if (!file) { console.error('用法: node tools/measure-cell.js <png>'); process.exit(2); }

const img = decodePng(fs.readFileSync(file));
const { w, h, rgba } = img;
const opaque = (x, y) => rgba[(y * w + x) * 4 + 3] > 127;
const same = (x1, y1, x2, y2) => {
  const a = (y1 * w + x1) * 4, b = (y2 * w + x2) * 4;
  return rgba[a] === rgba[b] && rgba[a + 1] === rgba[b + 1] && rgba[a + 2] === rgba[b + 2];
};

function runModes(horizontal) {
  const hist = new Map();
  const n = horizontal ? h : w;
  const m = horizontal ? w : h;
  for (let i = 0; i < n; i++) {
    let run = 0;
    for (let j = 0; j < m; j++) {
      const x = horizontal ? j : i, y = horizontal ? i : j;
      if (!opaque(x, y)) { run = 0; continue; }
      const px2 = horizontal ? j - 1 : x, py2 = horizontal ? y : j - 1;
      if (j > 0 && opaque(px2, py2) && same(x, y, px2, py2)) {
        run++;
      } else {
        run = 1;
      }
      if (j === m - 1 || !opaque(horizontal ? j + 1 : x, horizontal ? y : j + 1)
        || !same(x, y, horizontal ? j + 1 : x, horizontal ? y : j + 1)) {
        hist.set(run, (hist.get(run) || 0) + 1);
      }
    }
  }
  return [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

console.log(path.basename(file) + '  (' + w + 'x' + h + ')');
console.log('  横向游程（连续同色像素数）出现次数：'
  + runModes(true).map(([k, v]) => k + 'px×' + v).join('  '));
console.log('  纵向游程：'
  + runModes(false).map(([k, v]) => k + 'px×' + v).join('  '));
