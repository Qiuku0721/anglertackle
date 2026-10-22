// ============================================================================
//  rod-rotate.js -- 把参考图里的鱼竿**整体二维旋转**到对角摆放
//
//  和 rod-diagonal.js 的区别：
//    rod-diagonal 是"沿杆轴投影"，适合只有杆身的图；
//    本工具是真正的二维旋转，渔轮、垂下的鱼线、挂在下面的拟饵都会跟着转过去，
//    不会像投影那样被压成一条线。
//
//  流程：
//    1. 按马赛克格子还原像素，抠掉背景
//    2. 估出杆轴角度，算出"要转到 45° 还差多少度"
//    3. 整幅图绕前景中心最近邻旋转
//    4. 裁到前景包围盒，等比缩放进 64×64
//
//  用法: node tools/rod-rotate.js <参考图> <输出png> [选项]
//    --grid=2        马赛克格子
//    --bgtol=80      背景容差
//    --target=45     目标角度（度，低于水平线的仰角）
//    --hue=45        换色（可选）
//    --scale=fit|none  缩放策略
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(name, def) {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const inFile = process.argv[2];
const outFile = process.argv[3];
const cell = Number(opt('grid', 2));
const bgTol = Number(opt('bgtol', 80));
const targetAngle = Number(opt('target', 45));
const hueArg = opt('hue', null);
const scaleMode = opt('scale', 'fit');

const img = decodePng(fs.readFileSync(inFile));
const { w, h, rgba } = img;
const px = (x, y) => { const i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };

const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => { const v = corners.map(p => p[c]).sort((a, b) => a - b); return Math.round((v[1] + v[2]) / 2); });

// ---- 还原格子 ----
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

const grid = [];
let cn = 0, cx = 0, cy = 0;
for (let gy = 0; gy < gh; gy++) {
  const row = [];
  for (let gx = 0; gx < gw; gx++) {
    const c = cellColor(gx, gy);
    const fg = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) > bgTol;
    row.push({ rgb: c, fg });
    if (fg) { cn++; cx += gx; cy += gy; }
  }
  grid.push(row);
}
if (!cn) { console.error('没找到前景'); process.exit(1); }
cx /= cn; cy /= cn;

// ---- 估杆轴角度（用主轴方向，比最小二乘更稳） ----
let sxx = 0, syy = 0, sxy = 0;
for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
  if (!grid[gy][gx].fg) continue;
  const dx = gx - cx, dy = gy - cy;
  sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
}
// 主轴方向角（图像坐标 y 向下，所以取负号换成"仰角"）
const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
const currentAngle = -theta * 180 / Math.PI;
const delta = (targetAngle - currentAngle) * Math.PI / 180;
console.log('参考图 ' + w + 'x' + h + '  格子 ' + cell + 'px  前景格 ' + cn);
console.log('当前杆轴 ' + currentAngle.toFixed(1) + '°  → 目标 ' + targetAngle + '°，需转 ' + (delta * 180 / Math.PI).toFixed(1) + '°');

// ---- 整幅图旋转（最近邻，绕前景中心） ----
const cos = Math.cos(-delta), sin = Math.sin(-delta);
const rotW = Math.ceil(Math.abs(gw * cos) + Math.abs(gh * sin)) + 2;
const rotH = Math.ceil(Math.abs(gw * sin) + Math.abs(gh * cos)) + 2;
const rot = Array.from({ length: rotH }, () => new Array(rotW).fill(null));
const rcx = rotW / 2, rcy = rotH / 2;
for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
  if (!grid[gy][gx].fg) continue;
  const dx = gx - cx, dy = gy - cy;
  const nx = dx * cos - dy * sin + rcx;
  const ny = dx * sin + dy * cos + rcy;
  const ix = Math.round(nx), iy = Math.round(ny);
  if (ix < 0 || iy < 0 || ix >= rotW || iy >= rotH) continue;
  rot[iy][ix] = grid[gy][gx].rgb;
}

// ---- 收紧包围盒 ----
let x0 = rotW, y0 = rotH, x1 = -1, y1 = -1;
for (let y = 0; y < rotH; y++) for (let x = 0; x < rotW; x++) {
  if (!rot[y][x]) continue;
  if (x < x0) x0 = x; if (y < y0) y0 = y;
  if (x > x1) x1 = x; if (y > y1) y1 = y;
}
const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
console.log('旋转后主体 ' + sw + 'x' + sh);

// ---- 换色 ----
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 0) {
    if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return [hh, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgb(hh, s, v) {
  hh = ((hh % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; } else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function recolor(c) {
  if (hueArg === null) return c;
  const [hh, ss, vv] = rgb2hsv(c[0], c[1], c[2]);
  if (ss <= 0.14) {
    const [tr, tg, tb] = hsv2rgb(Number(hueArg), 0.85, 1.0);
    const k = 0.6;
    return [Math.round(c[0] * (1 - k) + (c[0] * tr / 255) * k),
            Math.round(c[1] * (1 - k) + (c[1] * tg / 255) * k),
            Math.round(c[2] * (1 - k) + (c[2] * tb / 255) * k)];
  }
  return hsv2rgb(Number(hueArg), Math.min(1, ss * 1.05), vv);
}

// ---- 缩放进 64×64 ----
const TARGET = 64;
const zoom = scaleMode === 'none'
  ? (Math.min(TARGET / sw, TARGET / sh) >= 1 ? 1 : Math.min(TARGET / sw, TARGET / sh))
  : Math.min(TARGET / sw, TARGET / sh);
const rw = Math.min(TARGET, Math.max(1, Math.round(sw * zoom)));
const rh = Math.min(TARGET, Math.max(1, Math.round(sh * zoom)));
const out = Buffer.alloc(TARGET * TARGET * 4);
const ox = (TARGET - rw) >> 1, oy = (TARGET - rh) >> 1;
for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
  const sx = Math.min(sw - 1, Math.floor(x / zoom));
  const sy = Math.min(sh - 1, Math.floor(y / zoom));
  const c = rot[y0 + sy][x0 + sx];
  if (!c) continue;
  const col = recolor(c);
  const d = ((y + oy) * TARGET + (x + ox)) * 4;
  out[d] = col[0]; out[d + 1] = col[1]; out[d + 2] = col[2]; out[d + 3] = 255;
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(TARGET, TARGET, out));
console.log('→ ' + outFile + '  主体 ' + rw + 'x' + rh + '（缩放 x' + (Math.round(zoom * 100) / 100) + '）'
  + (hueArg !== null ? ' 色相 ' + hueArg + '°' : ''));
