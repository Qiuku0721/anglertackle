// ============================================================================
//  ref-to-sprite.js -- 把"最近邻放大的参考图"精确还原成像素画，再导出成贴图
//
//  关键点：不是"缩小图片"（缩小会做插值，一定糊），而是
//    · 已知格子边长 cell，直接取每个格子的中心像素当这一格的颜色
//    · 和背景色接近的格子 → 透明
//    · 再把结果按需缩放/居中到目标尺寸
//
//  用法:
//    node tools/ref-to-sprite.js <参考图> --cell=5 --out=xxx.px.js
//    node tools/ref-to-sprite.js <参考图> --cell=5 --png=out.png --size=64
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(name, def) {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const file = process.argv[2];
const img = decodePng(fs.readFileSync(file));
const { w, h, rgba } = img;

function px(x, y) {
  const i = (y * w + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

// ---- 背景色 ----
const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
const bg = [0, 1, 2].map(c => {
  const v = corners.map(p => p[c]).sort((a, b) => a - b);
  return Math.round((v[1] + v[2]) / 2);
});
const bgTol = Number(opt('bgtol', 42));
const isBg = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < bgTol;

// ---- 前景包围盒（按格子对齐）----
const cell = Number(opt('cell', 5));
// 找前景格子的范围
let gx0 = Infinity, gy0 = Infinity, gx1 = -1, gy1 = -1;
const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
for (let gy = 0; gy < gh; gy++) {
  for (let gx = 0; gx < gw; gx++) {
    // 取格子中心（并采样 3x3 取中位数，抗单点噪声）
    const cx = gx * cell + Math.floor(cell / 2);
    const cy = gy * cell + Math.floor(cell / 2);
    if (!isBg(px(cx, cy))) {
      if (gx < gx0) gx0 = gx; if (gy < gy0) gy0 = gy;
      if (gx > gx1) gx1 = gx; if (gy > gy1) gy1 = gy;
    }
  }
}
if (gx1 < 0) { console.error('没找到前景'); process.exit(1); }

const sw = gx1 - gx0 + 1, sh = gy1 - gy0 + 1;
console.log('参考图 ' + path.basename(file) + '  ' + w + 'x' + h);
console.log('背景 rgb(' + bg.join(',') + ')  格子 ' + cell + 'px');
console.log('前景格子范围 x ' + gx0 + '..' + gx1 + ' (' + sw + '), y ' + gy0 + '..' + gy1 + ' (' + sh + ')');

// ---- 还原成 sprite：sw x sh 的 RGBA ----
// 每格不取单点，而是取格内 (cell/2) 见方区域的中位数——原图有噪点和压缩痕迹，
// 单点采样会把噪点原样搬进像素画。
function cellSample(gx, gy) {
  const bx = (gx0 + gx) * cell, by = (gy0 + gy) * cell;
  const r = [], g = [], b = [], a = [];
  const half = Math.max(1, Math.floor(cell / 2));
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = bx + Math.floor(cell / 2) + dx, y = by + Math.floor(cell / 2) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = px(x, y);
      r.push(p[0]); g.push(p[1]); b.push(p[2]); a.push(p[3]);
    }
  }
  const med = (arr) => { const s = arr.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  return [med(r), med(g), med(b), med(a)];
}

const sprite = { w: sw, h: sh, rgba: Buffer.alloc(sw * sh * 4) };
for (let gy = 0; gy < sh; gy++) {
  for (let gx = 0; gx < sw; gx++) {
    const p = cellSample(gx, gy);
    const o = (gy * sw + gx) * 4;
    // 硬阈值：不再保留半透明边缘，MC 物品贴图要么实要么空
    if (isBg(p)) { sprite.rgba[o + 3] = 0; continue; }
    sprite.rgba[o] = p[0]; sprite.rgba[o + 1] = p[1]; sprite.rgba[o + 2] = p[2]; sprite.rgba[o + 3] = 255;
  }
}

// ---- 去噪：对每个不透明格，取 3x3 邻域的主色（众数）----
// 这样能消掉"高光旁边夹一个暗点"这类压缩噪点，同时保住真正的结构边缘。
if (opt('denoise', 'on') !== 'off') {
  const before = Buffer.from(sprite.rgba);
  const aAt = (x, y) => (x < 0 || y < 0 || x >= sw || y >= sh) ? 0 : before[(y * sw + x) * 4 + 3];
  const key = (o) => before[o] + ',' + before[o + 1] + ',' + before[o + 2];
  let changed = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const o = (y * sw + x) * 4;
    if (aAt(x, y) === 0) continue;
    // 统计 3x3 内出现次数；只有"某个邻居色出现 >= 5 次且与自身不同"才替换
    const tally = new Map();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (aAt(nx, ny) === 0) continue;
      const k = key((ny * sw + nx) * 4);
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    let bestK = null, bestC = 0;
    for (const [k, c] of tally) if (c > bestC) { bestC = c; bestK = k; }
    const own = key(o);
    if (bestK && bestK !== own && bestC >= 6) {
      const [r, g, b] = bestK.split(',').map(Number);
      sprite.rgba[o] = r; sprite.rgba[o + 1] = g; sprite.rgba[o + 2] = b;
      changed++;
    }
  }
  console.log('去噪替换像素: ' + changed);
}

// ---- 去边缘孤点：若某不透明格的四邻全是透明，则也置透明 ----
const idx = (x, y) => (y * sw + x) * 4;
const alphaAt = (x, y) => (x < 0 || y < 0 || x >= sw || y >= sh) ? 0 : sprite.rgba[idx(x, y) + 3];
let cleaned = 0;
for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
  if (alphaAt(x, y) === 0) continue;
  if (alphaAt(x - 1, y) === 0 && alphaAt(x + 1, y) === 0 && alphaAt(x, y - 1) === 0 && alphaAt(x, y + 1) === 0) {
    sprite.rgba[idx(x, y) + 3] = 0; cleaned++;
  }
}
console.log('清掉孤立像素: ' + cleaned);

// ---- 再收紧一次包围盒 ----
let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
  if (alphaAt(x, y)) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
}
const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
console.log('收紧后主体: ' + fw + ' x ' + fh);

const tight = { w: fw, h: fh, rgba: Buffer.alloc(fw * fh * 4) };
for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
  const s = idx(x0 + x, y0 + y), d = (y * fw + x) * 4;
  tight.rgba[d] = sprite.rgba[s]; tight.rgba[d + 1] = sprite.rgba[s + 1];
  tight.rgba[d + 2] = sprite.rgba[s + 2]; tight.rgba[d + 3] = sprite.rgba[s + 3];
}

// ---- 输出 ----
const outPx = opt('out', null);
if (outPx) {
  // 导出成 JS 里的字符画，便于人工微调
  const palette = new Map();
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rows = [];
  for (let y = 0; y < tight.h; y++) {
    let row = '';
    for (let x = 0; x < tight.w; x++) {
      const o = (y * tight.w + x) * 4;
      if (tight.rgba[o + 3] < 128) { row += '.'; continue; }
      const key = tight.rgba[o] + ',' + tight.rgba[o + 1] + ',' + tight.rgba[o + 2];
      if (!palette.has(key)) {
        if (palette.size >= chars.length) { row += '?'; continue; }
        palette.set(key, chars[palette.size]);
      }
      row += palette.get(key);
    }
    rows.push(row);
  }
  const pal = {};
  for (const [k, c] of palette) pal[c] = '#' + k.split(',').map(v => (+v).toString(16).padStart(2, '0')).join('');
  fs.writeFileSync(outPx, '// 由 tools/ref-to-sprite.js 从 ' + path.basename(file) + ' 还原\n'
    + '// 原尺寸 ' + tight.w + ' x ' + tight.h + '\n'
    + 'module.exports = ' + JSON.stringify({ w: tight.w, h: tight.h, palette: pal, rows }, null, 1) + ';\n');
  console.log('已写出像素画: ' + outPx + '  (调色板 ' + palette.size + ' 色)');
}

const outPng = opt('png', null);
if (outPng) {
  const target = Number(opt('size', 64));
  // 等比最近邻缩放：优先整数倍放大；放不下时用分数比（向下取整映射，
  // 不用双线性，否则像素画的硬边会被插值糊掉），最后居中。
  const k = Math.min(target / tight.w, target / tight.h);
  const scale = k >= 1 ? Math.floor(k) : k;
  const rw = Math.min(target, Math.max(1, Math.round(tight.w * scale)));
  const rh = Math.min(target, Math.max(1, Math.round(tight.h * scale)));
  const ox = Math.floor((target - rw) / 2), oy = Math.floor((target - rh) / 2);
  const out = Buffer.alloc(target * target * 4);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const sx = Math.min(tight.w - 1, Math.floor(x / scale));
    const sy = Math.min(tight.h - 1, Math.floor(y / scale));
    const s = (sy * tight.w + sx) * 4;
    const d = ((y + oy) * target + (x + ox)) * 4;
    out[d] = tight.rgba[s]; out[d + 1] = tight.rgba[s + 1];
    out[d + 2] = tight.rgba[s + 2]; out[d + 3] = tight.rgba[s + 3];
  }
  fs.writeFileSync(outPng, encodePng(target, target, out));
  console.log('已写出 PNG: ' + outPng + '  (' + target + 'x' + target
    + ', 主体 ' + rw + 'x' + rh + ', 缩放 x' + (Math.round(scale * 100) / 100) + ')');
}
