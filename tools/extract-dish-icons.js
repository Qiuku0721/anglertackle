/*
 * extract-dish-icons.js —— 参考图 → 物品贴图。**只删背景那一个色号，其它一律不动。**
 *
 * 用户 2026-10-03 反复纠正后定下的规则（照做，不要再加花样）：
 *   · "先识别我给的图大体背景什么颜色，再强制把背景色取一个色号，再直接删掉那个色号"
 *   · "扣黑色就黑色，连褐色棕色也连带？蓝色就蓝色，非要把里面的颜色全改？"
 *     → **只按颜色删**：与背景色号每通道相差 ≤ KEY_DIFF 的像素 → 透明。
 *       **不做连通性判断、不做孔洞填充、不做量化、不改任何其它像素的颜色。**
 *       （前几版就是加了这些"聪明"步骤才去挖人家盘子内部；量化更是把菜色整体改了。）
 *
 * 唯一保留的一步预处理：参考图是**最近邻放大的像素画**（10px / 5px 一格），
 * 所以先按格心取样还原成原生像素画（33×33 / 66×66），否则等于在放大图上抠。
 * 用户："你怎么降像素了，有些是 5px 有些是 10px" —— 指的就是这一步。
 *
 * 尺寸（用户："64规格不行就128，再不行就256"）：整数倍最近邻放大，取能填满 ≥70% 的最小一档。
 *
 * 用法：
 *   node tools/extract-dish-icons.js             # 草案 + 对照图
 *   node tools/extract-dish-icons.js --install   # 同时写进 textures/item/
 */
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '参考资料', '菜品贴图', '_参考原图');
const OUT = path.join(ROOT, '参考资料', '菜品贴图');
const TEX = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const INSTALL = process.argv.includes('--install');

const MAP = [
  ['刺身', 'sashimi'], ['鱼汤', 'fish_soup'], ['奶白鱼汤', 'creamy_fish_soup'],
  ['慢炖鱼', 'fish_stew'], ['清蒸鱼', 'steamed_fish'], ['红烧鱼', 'braised_fish'],
  ['香煎鱼', 'pan_fried_fish'], ['油炸鱼块', 'fried_fish_chunk'], ['鱼丸', 'fish_ball'],
  ['整条油炸', 'deep_fried_fish'], ['熏鱼', 'smoked_fish'], ['碳烤鱼', 'charred_fish'],
  ['蒲烧', 'kabayaki'],
];

const KEY_DIFF = 8;          // 每通道允许的差（背景是平的，8 足够；褐色/暗酱差得远，绝不会被带走）
const SPECS = [64, 128, 256];
const MARGIN = 2;
const FILL_MIN = 0.7;

/** ① 量格子边长（最近邻放大的整数倍）。 */
function detectCell(img) {
  const { w, h, rgba } = img;
  const px = (x, y) => [rgba[(y * w + x) * 4], rgba[(y * w + x) * 4 + 1], rgba[(y * w + x) * 4 + 2]];
  const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
  const bg = [0, 1, 2].map((c) => {
    const v = corners.map((p) => p[c]).sort((a, b) => a - b);
    return Math.round((v[1] + v[2]) / 2);
  });
  const isBg = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 45;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (isBg(px(x, y))) continue;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return 1;
  const sig = (fixed, isCol) => {
    let r = 0, g = 0, b = 0, n = 0;
    const from = isCol ? minY : minX, to = isCol ? maxY : maxX;
    for (let i = from; i <= to; i++) {
      const p = isCol ? px(fixed, i) : px(i, fixed);
      if (isBg(p)) continue;
      r += p[0]; g += p[1]; b += p[2]; n++;
    }
    if (n === 0) return 'bg';
    return [Math.round(r / n / 6), Math.round(g / n / 6), Math.round(b / n / 6), Math.round(n / 4)].join(',');
  };
  const runs = (isCol) => {
    const out = [];
    const from = isCol ? minX : minY, to = isCol ? maxX : maxY;
    let cur = sig(from, isCol), len = 1;
    for (let i = from + 1; i <= to; i++) {
      const s = sig(i, isCol);
      if (s === cur) len++;
      else { if (len > 1) out.push(len); cur = s; len = 1; }
    }
    if (len > 1) out.push(len);
    return out;
  };
  const gcd2 = (a, b) => (b ? gcd2(b, a % b) : a);
  const g = (arr) => arr.reduce((a, b) => gcd2(a, b), 0);
  const cand = [g(runs(true)), g(runs(false))].filter((v) => v > 1);
  return cand.length ? Math.min(...cand) : 1;
}

/** ② 找相位：色块边界落在 x ≡ 相位 (mod cell)，取水平梯度总和最大的那个。 */
function detectPhase(img, cell) {
  const { w, h, rgba } = img;
  if (cell <= 1) return 0;
  const lum = (x, y) => {
    const i = (y * w + x) * 4;
    return rgba[i] * 0.3 + rgba[i + 1] * 0.6 + rgba[i + 2] * 0.1;
  };
  let bestP = 0, bestScore = -1;
  for (let p = 0; p < cell; p++) {
    let score = 0;
    for (let x = p; x < w; x += cell) {
      if (x === 0) continue;
      for (let y = 0; y < h; y++) score += Math.abs(lum(x, y) - lum(x - 1, y));
    }
    if (score > bestScore) { bestScore = score; bestP = p; }
  }
  return bestP;
}

/** ③ 按格心取样 → 原生像素画（33×33 / 66×66）。 */
function sampleNative(img, cell) {
  const { w, h, rgba } = img;
  const nw = Math.max(1, Math.floor(w / cell)), nh = Math.max(1, Math.floor(h / cell));
  const c0 = detectPhase(img, cell) + cell / 2;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(w - 1, Math.max(0, Math.round(c0 + x * cell)));
    const sy = Math.min(h - 1, Math.max(0, Math.round(c0 + y * cell)));
    const s = (sy * w + sx) * 4, d = (y * nw + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = 255;
  }
  return { w: nw, h: nh, rgba: out };
}

/**
 * ④ **只删背景那一个色号**：
 *   a. 键色 = 画面最外一圈里出现最多的**精确**颜色（不量化）；
 *   b. 每通道都在 ±KEY_DIFF 内的像素 → 透明；
 *   c. 其它像素**一个都不动**（不连通性、不补洞、不量化）。
 */
function keyOut(img, diff) {
  const { w, h, rgba } = img;
  const tally = new Map();
  const note = (x, y) => {
    const i = (y * w + x) * 4;
    const k = rgba[i] + ',' + rgba[i + 1] + ',' + rgba[i + 2];
    tally.set(k, (tally.get(k) || 0) + 1);
  };
  for (let x = 0; x < w; x++) { note(x, 0); note(x, h - 1); }
  for (let y = 0; y < h; y++) { note(0, y); note(w - 1, y); }
  let keyStr = '0,0,0', bestN = -1;
  for (const [k, n] of tally) if (n > bestN) { bestN = n; keyStr = k; }
  const key = keyStr.split(',').map(Number);
  let cut = 0;
  for (let i = 0; i < w * h; i++) {
    if (Math.abs(rgba[i * 4] - key[0]) <= diff
      && Math.abs(rgba[i * 4 + 1] - key[1]) <= diff
      && Math.abs(rgba[i * 4 + 2] - key[2]) <= diff) { rgba[i * 4 + 3] = 0; cut++; }
  }
  return { cut, total: w * h, key, border: bestN };
}

/** ⑤ 裁到内容外框。 */
function cropContent(img) {
  const { w, h, rgba } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] === 0) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const s = ((minY + y) * w + minX + x) * 4, d = (y * cw + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return { w: cw, h: ch, rgba: out };
}

/** ⑥ 整数倍最近邻放大 + 居中（尺寸 64 / 128 / 256）。 */
function place(img) {
  const n = Math.max(img.w, img.h);
  let best = { spec: SPECS[SPECS.length - 1], k: 1 };
  for (const s of SPECS) {
    const k = Math.floor((s - MARGIN * 2) / n);
    if (k < 1) continue;
    best = { spec: s, k };
    if ((k * n) / s >= FILL_MIN) break;
  }
  const sw = img.w * best.k, sh = img.h * best.k;
  const out = Buffer.alloc(best.spec * best.spec * 4);
  const ox = Math.floor((best.spec - sw) / 2), oy = Math.floor((best.spec - sh) / 2);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const s = ((y / best.k | 0) * img.w + (x / best.k | 0)) * 4;
    if (img.rgba[s + 3] === 0) continue;
    const d = ((oy + y) * best.spec + ox + x) * 4;
    out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1];
    out[d + 2] = img.rgba[s + 2]; out[d + 3] = 255;
  }
  return { w: best.spec, h: best.spec, rgba: out, spec: best.spec, k: best.k,
    fill: (best.k * n) / best.spec };
}

fs.mkdirSync(OUT, { recursive: true });
if (INSTALL) fs.mkdirSync(TEX, { recursive: true });

console.log('=== 参考图 → 物品贴图（只删背景色号，其它一律不动）===\n');
const made = [];
const missing = [];
for (const [zh, id] of MAP) {
  const src = path.join(SRC, zh + '.png');
  if (!fs.existsSync(src)) { missing.push(zh + '（' + id + '）'); continue; }
  let img;
  try { img = decodePng(fs.readFileSync(src)); }
  catch (e) { missing.push(zh + '（读不出来：' + e.message + '）'); continue; }
  const cell = detectCell(img);
  const native = sampleNative(img, cell);
  const key = keyOut(native, KEY_DIFF);
  const cropped = cropContent(native);
  if (!cropped) { missing.push(zh + '（抠完没剩下东西）'); continue; }
  const final = place(cropped);
  const buf = encodePng(final.w, final.h, final.rgba);
  fs.writeFileSync(path.join(OUT, id + '.png'), buf);
  if (INSTALL) fs.writeFileSync(path.join(TEX, id + '.png'), buf);
  made.push({ id, zh, img: final });
  console.log('  ' + (id + '.png').padEnd(22) + zh.padEnd(6)
    + ' 背景色号 ' + String(key.key.join(',')).padEnd(13)
    + '（边界命中 ' + key.border + ' px） 格子 ' + String(cell).padStart(2) + 'px'
    + ' 原生 ' + native.w + '×' + native.h
    + ' 内容 ' + (cropped.w + '×' + cropped.h).padEnd(7)
    + ' → ' + final.spec + '²  ×' + final.k + '（占 ' + Math.round(final.fill * 100) + '%）');
}
if (missing.length) {
  console.log('\n⚠ 缺图（这轮没发）：');
  for (const m of missing) console.log('    ' + m);
}

// 对照图：左=原图、右=成图
const BOX = 96, COLS = 4, pad = 10;
const rows = Math.ceil(made.length / COLS);
const W = COLS * (BOX * 2 + pad * 3), H = rows * (BOX + pad) + pad;
const sheet = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { sheet[i * 4] = 40; sheet[i * 4 + 1] = 44; sheet[i * 4 + 2] = 52; sheet[i * 4 + 3] = 255; }
const blit = (img, ox, oy, box) => {
  const sc = Math.min(box / img.w, box / img.h);
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) {
    const sx = Math.min(img.w - 1, Math.floor(x / sc)), sy = Math.min(img.h - 1, Math.floor(y / sc));
    const s = (sy * img.w + sx) * 4;
    const d = ((oy + y) * W + ox + x) * 4;
    if (img.rgba[s + 3] === 0) {
      const chk = ((x >> 2) + (y >> 2)) & 1; const v = chk ? 70 : 52;
      sheet[d] = v; sheet[d + 1] = v; sheet[d + 2] = v + 6; sheet[d + 3] = 255;
      continue;
    }
    sheet[d] = img.rgba[s]; sheet[d + 1] = img.rgba[s + 1]; sheet[d + 2] = img.rgba[s + 2]; sheet[d + 3] = 255;
  }
};
made.forEach((m, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const ox = pad + col * (BOX * 2 + pad * 3), oy = pad + row * (BOX + pad);
  const raw = decodePng(fs.readFileSync(path.join(SRC, m.zh + '.png')));
  blit(raw, ox, oy, BOX);
  blit(m.img, ox + BOX + pad, oy, BOX);
});
const sheetPath = path.join(OUT, '_抠图对照_左原图_右成图.png');
fs.writeFileSync(sheetPath, encodePng(W, H, sheet));
console.log('\n对照图（左=原图、右=成图）\n  ' + sheetPath);
