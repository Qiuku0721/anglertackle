/*
 * recolor-sprite.js —— 直接给一张**成品贴图**改色（不缩放、不抠图）。
 *
 * 为什么不用 build-ref-texture.js / ref-to-sprite.js：
 *   那两个是"参考图 → 成品"的流水线，要指定马赛克格边长、要做抠图。
 *   这次的输入（hemp_line.png）本身就是 64×64 的成品、无背景，
 *   只需要逐像素换色 —— 走那条流水线反而会引入缩放和抠图的副作用。
 *
 * 改色模型：RGB → HSV → 把色相设为指定值 → 调饱和度/明度 → 回 RGB。
 *   · 色相**直接设定**，不是相对偏移（麻线是棕橙色，设成 0 就是纯红）
 *   · 明度用乘法保留原图的明暗层次（线圈的立体感全靠它）
 *   · 低饱和像素（灰白高光）默认**原样保留**，否则高光会被染成粉色
 *
 * 用法:
 *   node tools/recolor-sprite.js <输入png> <输出png> --hue=0 [--sat=1.5] [--val=1.0]
 *                                 [--satkeep=0.15] [--hueTol=999]
 *
 *   --satkeep=N  饱和度低于 N 的像素不参与换色（保留灰白高光），默认 0.15
 *   --hueTol=N   只改与目标色相相差 N 度以内的像素（默认 999 = 全改）
 */
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('用法: node tools/recolor-sprite.js <输入png> <输出png> --hue=0 [--sat=1.5] [--val=1.0]');
  process.exit(2);
}

const hueTarget = Number(opt('hue', 0));
const satMul = Number(opt('sat', 1.0));
const valMul = Number(opt('val', 1.0));
const satKeep = Number(opt('satkeep', 0.15));
const hueTol = Number(opt('hueTol', 999));

const img = decodePng(fs.readFileSync(inFile));
const { w, h, rgba } = img;

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d !== 0) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
    if (hh < 0) hh += 360;
  }
  return [hh, mx === 0 ? 0 : d / mx, mx];
}

function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** 两个色相之间的最短夹角 */
function hueDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

let changed = 0, kept = 0, transparent = 0;
const out = Buffer.from(rgba);

for (let i = 0; i < w * h; i++) {
  const o = i * 4;
  const a = rgba[o + 3];
  if (a === 0) { transparent++; continue; }

  const [hh, ss, vv] = rgb2hsv(rgba[o], rgba[o + 1], rgba[o + 2]);

  // 低饱和像素（灰白高光/阴影）保留原色，否则会被染成粉色
  if (ss < satKeep) { kept++; continue; }
  // 只改目标色相附近的像素
  if (hueTol < 999 && hueDelta(hh, hueTarget) > hueTol) { kept++; continue; }

  const ns = Math.min(1, ss * satMul);
  const nv = Math.min(1, vv * valMul);
  const [r, g, b] = hsv2rgb(hueTarget, ns, nv);
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
  changed++;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(w, h, out));

console.log('改色完成 → ' + outFile);
console.log('  尺寸 ' + w + '×' + h
  + '  改色 ' + changed + ' px'
  + '  保留 ' + kept + ' px（低饱和/色相不符）'
  + '  透明 ' + transparent + ' px');
console.log('  色相 → ' + hueTarget + '°  饱和 ×' + satMul + '  明度 ×' + valMul
  + '  satkeep=' + satKeep + '  hueTol=' + hueTol);
