// ============================================================================
//  tune-bgtol.js -- 对同一张参考图试多个"背景容差"，拼成一张对比图
//
//  为什么需要：马赛克图里主体常常也有和背景相近的浅色块，
//  容差太小会留下残影、太大会把主体咬掉。肉眼看一张对比图最快。
//
//  用法: node tools/tune-bgtol.js <参考图> <格子> <输出png> <容差1,容差2,...>
//
//  注意：全部在一个进程里算完——沙箱下 Node 起子进程会 EPERM。
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const src = process.argv[2];
const cell = Number(process.argv[3]);
const outPng = process.argv[4];
const tols = process.argv[5].split(',').map(s => Number(s.trim()));

const img = decodePng(fs.readFileSync(src));
const { w, h, rgba } = img;
const px = (x, y) => { const i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };

// 四角中位数作为背景色
const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => {
  const v = corners.map(p => p[c]).sort((a, b) => a - b);
  return Math.round((v[1] + v[2]) / 2);
});

const gw = Math.floor(w / cell), gh = Math.floor(h / cell);

function cellColor(gx, gy) {
  const bx = gx * cell, by = gy * cell;
  const rs = [], gs = [], bs = [];
  for (let y = 1; y < cell - 1; y++) for (let x = 1; x < cell - 1; x++) {
    const p = px(bx + x, by + y);
    rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
  }
  if (!rs.length) return px(bx + (cell >> 1), by + (cell >> 1));
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

// 预先把所有格子颜色算好（容差循环里复用，避免重复采样）
const colors = [];
for (let gy = 0; gy < gh; gy++) {
  const row = [];
  for (let gx = 0; gx < gw; gx++) row.push(cellColor(gx, gy));
  colors.push(row);
}

/** 按给定容差生成 64x64 RGBA。 */
function render(tol) {
  const fg = colors.map(row => row.map(c => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) > tol));
  // 去孤立格
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh) ? false : fg[y][x];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (fg[y][x] && !at(x - 1, y) && !at(x + 1, y) && !at(x, y - 1) && !at(x, y + 1)) fg[y][x] = false;
  }
  let x0 = gw, y0 = gh, x1 = -1, y1 = -1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (fg[y][x]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const TARGET = 64;
  const zoom = Math.min(TARGET / sw, TARGET / sh) >= 1 ? 1 : Math.min(TARGET / sw, TARGET / sh);
  const rw = Math.min(TARGET, Math.round(sw * zoom)), rh = Math.min(TARGET, Math.round(sh * zoom));
  const ox = (TARGET - rw) >> 1, oy = (TARGET - rh) >> 1;
  const out = Buffer.alloc(TARGET * TARGET * 4);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const sx = Math.min(sw - 1, Math.floor(x / zoom)), sy = Math.min(sh - 1, Math.floor(y / zoom));
    if (!fg[y0 + sy][x0 + sx]) continue;
    const c = colors[y0 + sy][x0 + sx];
    const d = ((y + oy) * TARGET + (x + ox)) * 4;
    out[d] = c[0]; out[d + 1] = c[1]; out[d + 2] = c[2]; out[d + 3] = 255;
  }
  return { rgba: out, sw, sh };
}

const results = tols.map(t => ({ t, r: render(t) }));
results.forEach(({ t, r }) => console.log('  容差 ' + String(t).padStart(3) + ' → '
  + (r ? r.sw + 'x' + r.sh + ' 像素' : '【全被扣光】')));

// 拼对比图（横向，每格 64x64，放大 3 倍）
const zoom = 3, pad = 6;
const ok = results.filter(x => x.r);
const W = ok.length * 64 * zoom + (ok.length + 1) * pad;
const H = 64 * zoom + pad * 2;
const sheet = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { sheet[i * 4] = 40; sheet[i * 4 + 1] = 44; sheet[i * 4 + 2] = 52; sheet[i * 4 + 3] = 255; }
ok.forEach(({ r }, i) => {
  const ox = pad + i * (64 * zoom + pad);
  for (let y = 0; y < 64 * zoom; y++) for (let x = 0; x < 64 * zoom; x++) {
    const s = ((y / zoom | 0) * 64 + (x / zoom | 0)) * 4;
    if (r.rgba[s + 3] < 128) continue;
    const d = ((pad + y) * W + ox + x) * 4;
    sheet[d] = r.rgba[s]; sheet[d + 1] = r.rgba[s + 1]; sheet[d + 2] = r.rgba[s + 2]; sheet[d + 3] = 255;
  }
});
fs.mkdirSync(path.dirname(outPng), { recursive: true });
fs.writeFileSync(outPng, encodePng(W, H, sheet));
console.log('对比图: ' + outPng + '  容差顺序: ' + ok.map(x => x.t).join(' , '));
