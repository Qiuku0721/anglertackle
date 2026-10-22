// ============================================================================
//  rod-diagonal.js -- 把"水平摆放的鱼竿参考图"转成"对角摆放"的贴图
//
//  为什么不能直接缩到 64 再旋转：
//    水平原始 122x27，缩到 64 宽只剩 14 高；再转 45° 后线宽掉到 1px 以下，
//    糊成一根头发丝（杆梢本来就只有 1-2px）。
//
//  做法：**沿杆轴采样，按固定线宽重新铺到对角线上**。
//    把杆子按长度切成 maxRun 段，每段取该段的代表色；
//    每段在对角线上画一条厚度为 thickness 的短线，段与段首尾相接。
//    这样线的粗细由我们指定（不再取决于原图那一列有多高），
//    而颜色沿杆长变化（握把深、竿身浅）被保留下来。
//
//  用法: node tools/rod-diagonal.js <参考图> <输出png> [选项]
//    --grid=2        马赛克格子
//    --bgtol=80      背景容差
//    --thickness=4   对角线的像素厚度
//    --hue=45        换色（可选，用于生成不同材质的竿）
//    --keep-warm     换色时保留木色握把（默认开）
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
const hueArg = opt('hue', null);
const thickness = Number(opt('thickness', 4));

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
const isFg = (c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) > bgTol;

const grid = [];
for (let gy = 0; gy < gh; gy++) {
  const row = [];
  for (let gx = 0; gx < gw; gx++) { const c = cellColor(gx, gy); row.push({ rgb: c, fg: isFg(c) }); }
  grid.push(row);
}

// ---- 统计每一列的前景纵跨度，找出杆子的横向范围 ----
const cols = [];
for (let gx = 0; gx < gw; gx++) {
  let top = -1, bot = -1, n = 0;
  for (let gy = 0; gy < gh; gy++) if (grid[gy][gx].fg) { if (top < 0) top = gy; bot = gy; n++; }
  cols.push({ gx, top, bot, n });
}
const used = cols.filter(c => c.n > 0);
if (!used.length) { console.error('没找到前景'); process.exit(1); }
const x0 = used[0].gx, x1 = used[used.length - 1].gx;
const span = x1 - x0 + 1;
console.log('参考图 ' + w + 'x' + h + '  格子 ' + cell + 'px  背景 rgb(' + bg.join(',') + ')');
console.log('杆长 ' + span + ' 列（x ' + x0 + '..' + x1 + '）');

// ---- 沿杆轴采样：把 span 列切成 N 段 ----
const TARGET = 64;
const PAD = 3;                                   // 四边留白，避免贴边
const maxRun = TARGET - PAD * 2;                 // 对角线长度

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
const keepWarm = opt('keep-warm', 'on') !== 'off';
function recolor(c) {
  if (hueArg === null) return c;
  const [hh, ss, vv] = rgb2hsv(c[0], c[1], c[2]);
  // 暖色（木/软木握把）保留，避免把握把也染成金属色
  if (keepWarm && (hh < 60 || hh > 330) && ss > 0.12) return c;
  if (ss <= 0.14) {
    // 灰白金属：正片化着色
    const [tr, tg, tb] = hsv2rgb(Number(hueArg), 0.85, 1.0);
    const k = 0.6;
    return [
      Math.round(c[0] * (1 - k) + (c[0] * tr / 255) * k),
      Math.round(c[1] * (1 - k) + (c[1] * tg / 255) * k),
      Math.round(c[2] * (1 - k) + (c[2] * tb / 255) * k),
    ];
  }
  return hsv2rgb(Number(hueArg), Math.min(1, ss * 1.05), vv);
}

// ---- 把每个前景格投影到杆轴上 ----
// 先用最小二乘拟合杆轴直线 y = a·x + b，再算每个前景格的
//   u = 沿轴位置，v = 垂直偏移（正值在杆下方，渔轮和垂线都在这边）。
const axisA = (() => {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!grid[gy][gx].fg) continue;
    n++; sx += gx; sy += gy; sxx += gx * gx; sxy += gx * gy;
  }
  if (n < 2) return { a: 0, b: 0 };
  const a = (n * sxy - sx * sy) / Math.max(1e-6, n * sxx - sx * sx);
  return { a, b: (sy - a * sx) / n };
})();
console.log('杆轴拟合 y = ' + axisA.a.toFixed(3) + 'x + ' + axisA.b.toFixed(1)
  + '  角度约 ' + (Math.atan(-axisA.a) * 180 / Math.PI).toFixed(1) + '°');

const nrm = Math.sqrt(1 + axisA.a * axisA.a);
const cosT = 1 / nrm, sinT = -axisA.a / nrm;
const proj = [];
for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
  if (!grid[gy][gx].fg) continue;
  const rx = gx - x0;
  const ry = gy - (axisA.a * x0 + axisA.b);
  proj.push({
    u: rx * cosT - ry * sinT,        // 沿轴
    v: rx * sinT + ry * cosT,        // 垂直（正 = 杆下方）
    rgb: grid[gy][gx].rgb,
  });
}
const uMin = Math.min(...proj.map(p => p.u));
const uSpan = Math.max(1e-6, Math.max(...proj.map(p => p.u)) - uMin);
console.log('前景格 ' + proj.length + ' 个，沿轴跨度 ' + uSpan.toFixed(1) + ' 格，'
  + '垂直范围 ' + Math.min(...proj.map(p => p.v)).toFixed(1) + ' .. ' + Math.max(...proj.map(p => p.v)).toFixed(1));

// ---- 画对角线：逐像素按真实投影绘制 ----
// 不"按线宽填充"——那样会把渔轮和垂下的鱼线一起抹平。
// 而是把每个原始前景格换算成 (沿轴 u, 垂直 v)，再画到对角坐标系里：
//   杆身 → v≈0 的一条细线
//   渔轮 → v 为正的一小团
//   垂下的鱼线 → v 更大的一串点
// 这样不用为每个部件写专门逻辑，形状自然带过来。
const out = Buffer.alloc(TARGET * TARGET * 4);
const N = maxRun;
let drawn = 0;

/** 把 (u, v) 写进画布：u 沿对角线（左下→右上），v 垂直对角线（向下为正）。 */
function put(u, v, col) {
  const x = PAD + u + v;
  const y = TARGET - 1 - PAD - u + v;
  if (x < 0 || y < 0 || x >= TARGET || y >= TARGET) return false;
  const d = (y * TARGET + x) * 4;
  out[d] = col[0]; out[d + 1] = col[1]; out[d + 2] = col[2]; out[d + 3] = 255;
  return true;
}

// 目标：把沿轴跨度 uSpan 映射到 N 个对角线位置
const uScale = N / uSpan;
// 垂直方向：杆身本来只有几格厚，适当放大一点让它看得见（原图杆径太细）
const vScale = Number(opt('vscale', 1.6));

for (const p of proj) {
  const u = Math.round((p.u - uMin) * uScale);
  if (u < 0 || u >= N) continue;
  const v = Math.round(p.v * vScale);
  const col = recolor(p.rgb);
  if (put(u, v, col)) drawn++;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(TARGET, TARGET, out));
console.log('逐像素绘制 ' + drawn + '/' + proj.length + ' 个像素 → ' + outFile
  + '（沿轴缩放 x' + uScale.toFixed(2) + '，垂直 x' + vScale + '）'
  + (hueArg !== null ? ' 色相 ' + hueArg + '°' : ''));
