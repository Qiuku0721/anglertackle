// 打印参考图还原后的格子矩阵（按亮度分档），用来确认杆子的形状与配色。
// 用法: node tools/dump-grid.js <png> <格子> [背景容差]
const fs = require('fs');
const { decodePng } = require('./image-to-sprite.js');

const img = decodePng(fs.readFileSync(process.argv[2]));
const cell = Number(process.argv[3] || 5);
const tol = Number(process.argv[4] || 80);
const { w, h, rgba } = img;
const px = (x, y) => { const i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };

const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => { const v = corners.map(p => p[c]).sort((a, b) => a - b); return Math.round((v[1] + v[2]) / 2); });

const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
function cellColor(gx, gy) {
  const bx = gx * cell, by = gy * cell;
  const rs = [], gs = [], bs = [];
  for (let y = 1; y < cell - 1; y++) for (let x = 1; x < cell - 1; x++) {
    const p = px(bx + x, by + y); rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
  }
  if (!rs.length) return px(bx + (cell >> 1), by + (cell >> 1));
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

console.log('格子 ' + cell + 'px  →  ' + gw + ' x ' + gh + ' 格   背景 rgb(' + bg.join(',') + ')');
console.log('每格显示：前景用「亮度档字符 + 色相字母」，背景用空格');
for (let gy = 0; gy < gh; gy++) {
  let line = '';
  for (let gx = 0; gx < gw; gx++) {
    const c = cellColor(gx, gy);
    const d = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
    if (d <= tol) { line += ' '; continue; }
    const mx = Math.max(...c), mn = Math.min(...c), s = mx === 0 ? 0 : (mx - mn) / mx;
    // 亮度档
    const v = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const ch = v < 50 ? '#' : v < 100 ? '+' : v < 160 ? 'o' : v < 215 ? '.' : ':';
    // 色相字母（饱和才显示）
    let hueChar = '';
    if (s > 0.15) {
      let r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      const mxx = Math.max(r, g, b), mnn = Math.min(r, g, b), dd = mxx - mnn;
      let hh = 0;
      if (dd > 0) {
        if (mxx === r) hh = ((g - b) / dd) % 6; else if (mxx === g) hh = (b - r) / dd + 2; else hh = (r - g) / dd + 4;
        hh *= 60; if (hh < 0) hh += 360;
      }
      hueChar = hh < 20 || hh >= 330 ? 'R' : hh < 45 ? 'O' : hh < 70 ? 'Y' : hh < 160 ? 'G' : hh < 250 ? 'B' : 'P';
    }
    line += ch + (hueChar || '-');
  }
  console.log(String(gy).padStart(2) + '|' + line);
}
