/*
 * build-dish-icons.js —— 把**抠好的素材**做成物品贴图（16×16 的替代：64/128/256）。
 *
 * 素材来源：`build/subagent-out/`（子代理按"相邻相似区域生长 + 补内部孔洞"抠出来的 12 张，
 * 已过 independent 校验：RGB 零改动、无内部空洞、裁切贴边）。详见它的报告。
 *
 * 这一步只做三件事：
 *   ① 丢掉**与主体不相连的小连通块**（原图自带的右下角数字水印、孤立 5×5 灰块都在这条被清掉）
 *   ② 按参考图的**放大格**（10px / 5px）**取格心**还原原生像素画（33×33 / 66×66）
 *      —— 用户："你怎么降像素了，有些是 5px 有些是 10px"；不能在放大图上直接缩放
 *   ③ 整数倍最近邻放大到 64² / 128² / 256²（用户："64规格不行就128，再不行就256"）
 *
 * ⚠ 不做颜色量化、不做容差抠图 —— 素材已经是干净的前景，只做上面三件事。
 *
 * 用法：node tools/build-dish-icons.js
 */
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'build', 'subagent-out');
const OUT = path.join(ROOT, '参考资料', '菜品贴图');

/** 中文菜名 → 物品 id + 该图的放大格边长（10px / 5px，仓库里已量过）。 */
const MAP = [
  ['刺身', 'sashimi', 10], ['鱼汤', 'fish_soup', 10], ['奶白鱼汤', 'creamy_fish_soup', 10],
  ['慢炖鱼', 'fish_stew', 10], ['清蒸鱼', 'steamed_fish', 10], ['红烧鱼', 'braised_fish', 5],
  ['香煎鱼', 'pan_fried_fish', 5], ['油炸鱼块', 'fried_fish_chunk', 5], ['鱼丸', 'fish_ball', 10],
  ['整条油炸', 'deep_fried_fish', 5], ['熏鱼', 'smoked_fish', 10], ['碳烤鱼', 'charred_fish', 10],
  // 蒲烧不做（用户 2026-10-03：'蒲烧不做'）
];

const SPECS = [64, 128, 256];
const MARGIN = 2;
const FILL_MIN = 0.7;
const KEEP_RATIO = 0.05;   // 小于最大连通块 5% 的块当外来物丢掉（水印/孤点）

/**
 * ①a 丢掉**细长条**外来物（用户 2026-10-03："水印块去掉…上面莫名竖灰条，下面莫名横黑条"）：
 *   · 右下角**数字水印** = 宽扁条（宽 >> 高）
 *   · 原图自带的**蒸汽/装饰竖条** = 细高条（高 >> 宽）
 *   规则：长宽比 > 3 **且** 面积小于最大连通块的 20% → 判为外来物删掉。
 *   （盘子/碗/鱼都是块状，长宽比小；鱼尾、筷子这类细部都**连着主体**，属同一连通块，不受影响。）
 */
function dropBars(img, ratioLimit = 3, areaLimit = 0.2) {
  const { w, h, rgba } = img;
  const seen = new Uint8Array(w * h);
  const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 128;
  const comps = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!op(x, y) || seen[y * w + x]) continue;
    const cells = [];
    let minX = x, maxX = x, minY = y, maxY = y;
    const st = [[x, y]];
    seen[y * w + x] = 1;
    while (st.length) {
      const [cx, cy] = st.pop();
      cells.push([cx, cy]);
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!op(nx, ny) || seen[ny * w + nx]) continue;
        seen[ny * w + nx] = 1;
        st.push([nx, ny]);
      }
    }
    comps.push({ cells, bw: maxX - minX + 1, bh: maxY - minY + 1 });
  }
  if (!comps.length) return { bars: 0, px: 0 };
  const biggest = Math.max(...comps.map((c) => c.cells.length));
  let bars = 0, px = 0;
  for (const c of comps) {
    const long = Math.max(c.bw, c.bh), short = Math.min(c.bw, c.bh);
    if (long / Math.max(1, short) > ratioLimit && c.cells.length < biggest * areaLimit) {
      for (const [pxx, pyy] of c.cells) rgba[(pyy * w + pxx) * 4 + 3] = 0;
      bars++; px += c.cells.length;
    }
  }
  return { bars, px };
}

/**
 * ①b **开运算重建**：先把粗细 ≤ 2k+1 像素的"细条"腐蚀掉，再在**原始掩膜内**做测地膨胀长回来。
 *   用于清掉"与主体相连"的细长外来物（用户截图里奶白鱼汤上方那条竖灰条、下方那条横黑条 ——
 *   它们和碗是同一个连通块，按连通块/长宽比的规则抓不到）。
 *   主体是几百像素宽的块，腐蚀 7×7 掉不下去；细条直接消失，且不会把主体啃出缺口。
 */
const DARK_BAR_FIX = new Set(['creamy_fish_soup']);
function cutDarkOutsideBowl(img, lumDark = 150, lumBright = 185, pad = 6) {
  const { w, h, rgba } = img;
  const lum = (i) => rgba[i] * 0.3 + rgba[i + 1] * 0.6 + rgba[i + 2] * 0.1;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] === 0 || lum(i) < lumBright) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { cut: 0 };
  const bx0 = minX - pad, by0 = minY - pad, bx1 = maxX + pad, by1 = maxY + pad;
  let cut = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] === 0) continue;
    if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) continue;
    if (lum(i) < lumDark) { rgba[i + 3] = 0; cut++; }
  }
  return { cut };
}
function openingByReconstruction(img, k) {
  const { w, h, rgba } = img;
  const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 128;
  // 1) 腐蚀
  const er = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!op(x, y)) continue;
    let all = true;
    for (let dy = -k; dy <= k && all; dy++) for (let dx = -k; dx <= k; dx++) {
      if (!op(x + dx, y + dy)) { all = false; break; }
    }
    if (all) er[y * w + x] = 1;
  }
  // 2) 测地膨胀：只在原始掩膜内长回来
  const out = er.slice();
  const st = [];
  for (let i = 0; i < w * h; i++) if (out[i]) st.push([i % w, (i / w) | 0]);
  while (st.length) {
    const [x, y] = st.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (out[i] || !op(nx, ny)) continue;
      out[i] = 1;
      st.push([nx, ny]);
    }
  }
  let cut = 0;
  for (let i = 0; i < w * h; i++) if (op(i % w, (i / w) | 0) && !out[i]) { rgba[i * 4 + 3] = 0; cut++; }
  return cut;
}
/** ① 丢掉小连通块：只保留面积 ≥ max(4, KEEP_RATIO × 最大块) 的块。 */
function keepMainBlobs(img) {
  const { w, h, rgba } = img;
  const seen = new Uint8Array(w * h);
  const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 128;
  const comps = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!op(x, y) || seen[y * w + x]) continue;
    const comp = [];
    const st = [[x, y]];
    seen[y * w + x] = 1;
    while (st.length) {
      const [cx, cy] = st.pop();
      comp.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!op(nx, ny) || seen[ny * w + nx]) continue;
        seen[ny * w + nx] = 1;
        st.push([nx, ny]);
      }
    }
    comps.push(comp);
  }
  if (!comps.length) return { dropped: 0, comps: 0 };
  const biggest = Math.max(...comps.map((c) => c.length));
  const limit = Math.max(4, biggest * KEEP_RATIO);
  let dropped = 0, kept = 0;
  for (const c of comps) {
    if (c.length >= limit) { kept++; continue; }
    for (const [px, py] of c) rgba[(py * w + px) * 4 + 3] = 0;
    dropped += c.length;
  }
  return { dropped, comps: comps.length, kept, biggest };
}

/** ② 按格心取样还原原生像素画（裁切边界正好落在格边界上，所以从 cell/2 起采）。 */
function sampleNative(img, cell) {
  const { w, h, rgba } = img;
  const nw = Math.max(1, Math.floor(w / cell)), nh = Math.max(1, Math.floor(h / cell));
  const out = Buffer.alloc(nw * nh * 4);
  const c0 = cell / 2;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(w - 1, Math.round(c0 + x * cell));
    const sy = Math.min(h - 1, Math.round(c0 + y * cell));
    const s = (sy * w + sx) * 4, d = (y * nw + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1];
    out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3] > 128 ? 255 : 0;
  }
  return { w: nw, h: nh, rgba: out };
}

/** ③ 裁紧。 */
function cropTight(img) {
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

/** ④ 整数倍最近邻放大 + 居中，尺寸取 64 / 128 / 256 里能填满 ≥70% 的最小一档。 */
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
console.log('=== 抠好的素材 → 物品贴图（丢外来块 → 取格心 → 整数倍放大）===\n');
const made = [];
const missing = [];
for (const [zh, id, cell] of MAP) {
  const src = path.join(SRC, zh + '.png');
  if (!fs.existsSync(src)) { missing.push(zh + '（' + id + '，素材缺）'); continue; }
  const img = decodePng(fs.readFileSync(src));
  const opened = openingByReconstruction(img, 5);
  const darkBars = DARK_BAR_FIX.has(id) ? cutDarkOutsideBowl(img) : { cut: 0, box: null };
  const bars = dropBars(img);
  const blobs = keepMainBlobs(img);
  const cropped0 = cropTight(img);
  if (!cropped0) { missing.push(zh + '（抠完没剩下东西）'); continue; }
  const native = sampleNative(cropped0, cell);
  const cropped = cropTight(native) || native;
  const final = place(cropped);
  fs.writeFileSync(path.join(OUT, id + '.png'), encodePng(final.w, final.h, final.rgba));
  made.push({ id, zh, img: final });
  console.log('  ' + (id + '.png').padEnd(22) + zh.padEnd(6)
    + ' 素材 ' + (img.w + '×' + img.h).padEnd(9)
    + ' 细条清理 ' + opened + ' px  碗外暗条 ' + darkBars.cut + ' px  细长条 ' + bars.bars + '（' + bars.px + ' px） 连通块 ' + blobs.comps + '（丢 ' + blobs.dropped + ' px）'
    + ' 格 ' + String(cell).padStart(2) + 'px 原生 ' + native.w + '×' + native.h
    + ' 裁后 ' + (cropped.w + '×' + cropped.h).padEnd(7)
    + ' → ' + final.spec + '²  ×' + final.k + '（占 ' + Math.round(final.fill * 100) + '%）');
}
if (missing.length) {
  console.log('\n⚠ 缺素材：');
  for (const m of missing) console.log('    ' + m);
}

// 对照图：左=抠好的素材、右=成图
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
const sheetPath = path.join(OUT, '_成图对照_左素材_右成图.png');
fs.writeFileSync(sheetPath, encodePng(W, H, sheet));
console.log('\n成图目录：' + path.relative(ROOT, OUT));
console.log('对照图（左=子代理抠好的素材、右=成图）\n  ' + sheetPath);
