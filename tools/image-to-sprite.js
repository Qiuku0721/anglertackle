// ============================================================================
//  image-to-sprite.js -- 把实拍照片转换成 32×32 的 MC 风格像素贴图
//
//  为什么这么做：手写像素画写实物体必然走形。直接从照片降采样则天然贴合现实。
//
//  流程：
//    1. 解码 PNG（自带解码器，无第三方依赖）
//    2. 抠背景：从四角做 flood fill，把连通的白色/浅灰背景设为透明
//    3. 面积平均降采样到 32×32（比最近邻保留更多细节）
//    4. 调色板量化（中位切分，限制颜色数，符合 MC 风格）
//    5. 增强对比 + 可选描边
//
//  用法:
//    node tools/image-to-sprite.js <输入.png> <输出名> [--size 32] [--colors 24] [--no-outline]
// ============================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG 解码
function decodePng(buf) {
  let off = 8;
  let w = 0, h = 0, colorType = 6, bitDepth = 8, palette = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8 位深度的 PNG（当前 ' + bitDepth + '）');
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // 每像素字节数
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 1;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);

  // 逐行反滤波
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xFF;
    }
  }

  // 统一成 RGBA
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (colorType === 6) {
      r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3];
    } else if (colorType === 2) {
      r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2];
    } else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 0) {
      r = g = b = out[i];
    } else {
      r = g = b = out[i * 2]; a = out[i * 2 + 1];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

// ---------------------------------------------------------------- PNG 编码
function crc32(buf) {
  const table = crc32.t || (crc32.t = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, c]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = rgba[y * w * 4 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 抠背景
/**
 * 从四边做 flood fill，把与边缘颜色接近的连通区域设为透明。
 * 比"把所有白色设透明"安全：物体内部的白色高光（比如鱼腹）不会被误删。
 */
function removeBackground(img, tolerance = 42) {
  const { w, h, rgba } = img;
  const visited = new Uint8Array(w * h);
  const queue = [];

  // 种子：四条边上的所有像素
  for (let x = 0; x < w; x++) {
    queue.push(x, 0, x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    queue.push(0, y, w - 1, y);
  }

  // 参考色 = 四角颜色的平均
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  let rr = 0, gg = 0, bb = 0;
  for (const [cx, cy] of corners) {
    const i = (cy * w + cx) * 4;
    rr += rgba[i]; gg += rgba[i + 1]; bb += rgba[i + 2];
  }
  rr /= 4; gg /= 4; bb /= 4;

  const near = (i) => {
    const dr = rgba[i] - rr;
    const dg = rgba[i + 1] - gg;
    const db = rgba[i + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db) < tolerance;
  };

  while (queue.length > 0) {
    const x = queue.pop();
    const y = queue.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx]) continue;
    const i = idx * 4;
    if (!near(i)) continue;
    visited[idx] = 1;
    rgba[i + 3] = 0;
    queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return img;
}

/** 裁掉四周全透明的边，让物体占满画布。 */
function cropToContent(img) {
  const { w, h, rgba } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 24) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return img;
  const nw = maxX - minX + 1;
  const nh = maxY - minY + 1;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const s = ((y + minY) * w + (x + minX)) * 4;
      const d = (y * nw + x) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { w: nw, h: nh, rgba: out };
}

/**
 * 按**颜色距离**抠背景（而不是 flood fill）。
 *
 * 为什么不用 flood fill：实拍物体内部常有与背景相近的高光/反光（钩子的不锈钢反光），
 * flood fill 进不去那些区域，导致物体被切成碎块、内侧留下背景色。
 * 按颜色距离逐个像素判断则干净得多——背景色（本例 rgb(226,226,226)）非常均匀。
 *
 * @param tolerance 与背景色的 RGB 距离阈值，超过即视为前景
 */
function maskByColorDistance(img, tolerance = 60) {
  const { w, h, rgba } = img;
  // 背景色 = 四角平均
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  let br = 0, bg = 0, bb = 0;
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    br += rgba[i]; bg += rgba[i + 1]; bb += rgba[i + 2];
  }
  br /= 4; bg /= 4; bb /= 4;

  for (let i = 0; i < w * h; i++) {
    const d = Math.hypot(rgba[i * 4] - br, rgba[i * 4 + 1] - bg, rgba[i * 4 + 2] - bb);
    if (d <= tolerance) rgba[i * 4 + 3] = 0;
  }
  return { img, bg: [br, bg, bb] };
}

/** 只保留面积最大的连通块（去掉水印、噪点、阴影等杂块）。 */
function keepLargestComponent(img) {
  const { w, h, rgba } = img;
  const label = new Int32Array(w * h).fill(-1);
  let best = -1;
  let bestSize = 0;
  let next = 0;

  for (let start = 0; start < w * h; start++) {
    if (rgba[start * 4 + 3] <= 24 || label[start] >= 0) continue;
    const id = next++;
    let size = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length > 0) {
      const idx = stack.pop();
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < w - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - w);
      if (y < h - 1) neighbors.push(idx + w);
      for (const n of neighbors) {
        if (label[n] < 0 && rgba[n * 4 + 3] > 24) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }

  let dropped = 0;
  for (let i = 0; i < w * h; i++) {
    if (label[i] >= 0 && label[i] !== best) { rgba[i * 4 + 3] = 0; dropped++; }
  }
  return { img, keptSize: bestSize, dropped };
}

// ---------------------------------------------------------------- 降采样

/**
 * 移除"水印式"的实心色块。
 *
 * 实拍图常见问题是底部有个实心矩形水印（本例是 rgb(51,51,51) 的方块）。
 * 它的特征是：**填充率高**（一块实心矩形），而真实物体（钩子/鱼）是细长或带轮廓的，
 * 填充率低。所以按"填充率 + 长宽比"就能把水印挑出来删掉。
 *
 * 另外钩子这种细线在抗锯齿下会被拆成 2 块，不能只保留最大块——
 * 这里改成"删掉明显像水印的块，其余保留"。
 */
function removeWatermarkBlocks(img, opts = {}) {
  const {
    minArea = 60,          // 小于这个面积的块视为噪点，直接删
    solidFill = 0.82,      // 填充率超过它、且长宽比接近 1 的块，判为水印
  } = opts;

  const { w, h, rgba } = img;
  const label = new Int32Array(w * h).fill(-1);
  const blocks = [];

  for (let start = 0; start < w * h; start++) {
    if (rgba[start * 4 + 3] <= 24 || label[start] >= 0) continue;
    const id = blocks.length;
    const members = [start];
    label[start] = id;
    const stack = [start];
    let minX = w, maxX = -1, minY = h, maxY = -1;
    while (stack.length > 0) {
      const idx = stack.pop();
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < w - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - w);
      if (y < h - 1) neighbors.push(idx + w);
      for (const n of neighbors) {
        if (label[n] < 0 && rgba[n * 4 + 3] > 24) {
          label[n] = id;
          members.push(n);
          stack.push(n);
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    blocks.push({
      id, members, bw, bh,
      fill: members.length / (bw * bh),
      aspect: Math.max(bw / bh, bh / bw),
    });
  }

  let removed = 0;
  for (const b of blocks) {
    const isNoise = b.members.length < minArea;
    const isWatermark = b.fill > solidFill && b.aspect < 2.2;
    if (isNoise || isWatermark) {
      for (const m of b.members) rgba[m * 4 + 3] = 0;
      removed++;
    }
  }
  return { img, removed, blocks };
}

// ---------------------------------------------------------------- 降采样
/** 面积平均降采样（保留更多细节，比最近邻好）。 */
function downsample(img, size) {
  const { w, h, rgba } = img;
  // 保持长宽比，物体居中
  const scale = Math.min(size / w, size / h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const offX = Math.floor((size - tw) / 2);
  const offY = Math.floor((size - th) / 2);

  const out = new Uint8Array(size * size * 4);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      // 对应原图区域
      const sx0 = Math.floor((tx / tw) * w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) / tw) * w));
      const sy0 = Math.floor((ty / th) * h);
      const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) / th) * h));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * w + sx) * 4;
          const al = rgba[i + 3] / 255;
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al;
          a += al; n++;
        }
      }
      if (n === 0 || a === 0) continue;
      const d = ((ty + offY) * size + (tx + offX)) * 4;
      out[d] = Math.round(r / a);
      out[d + 1] = Math.round(g / a);
      out[d + 2] = Math.round(b / a);
      out[d + 3] = Math.round((a / n) * 255);
    }
  }
  return { w: size, h: size, rgba: out };
}

// ---------------------------------------------------------------- 量化
/** 中位切分量化到 N 色（保持 MC 风格的有限调色板）。 */
function quantize(img, maxColors) {
  const { w, h, rgba } = img;
  const pixels = [];
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] > 24) {
      pixels.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    }
  }
  if (pixels.length === 0) return img;

  let boxes = [pixels];
  while (boxes.length < maxColors) {
    // 找"最长边跨度最大"的盒子来切
    let bi = -1, best = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const spans = [0, 1, 2].map((ch) => {
        let mn = 255, mx = 0;
        for (const p of box) { mn = Math.min(mn, p[ch]); mx = Math.max(mx, p[ch]); }
        return mx - mn;
      });
      const s = Math.max(...spans);
      if (s > best) { best = s; bi = i; }
    });
    if (bi < 0 || best <= 0) break;
    const box = boxes[bi];
    const ch = (() => {
      let bs = -1, bc = 0;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (const p of box) { mn = Math.min(mn, p[c]); mx = Math.max(mx, p[c]); }
        if (mx - mn > bs) { bs = mx - mn; bc = c; }
      }
      return bc;
    })();
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(box.length / 2);
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }

  const colors = boxes.filter((b) => b.length > 0).map((box) => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)];
  });

  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] <= 24) continue;
    let bestD = Infinity, bestC = colors[0];
    for (const c of colors) {
      const d = (rgba[i * 4] - c[0]) ** 2 + (rgba[i * 4 + 1] - c[1]) ** 2 + (rgba[i * 4 + 2] - c[2]) ** 2;
      if (d < bestD) { bestD = d; bestC = c; }
    }
    out[i * 4] = bestC[0];
    out[i * 4 + 1] = bestC[1];
    out[i * 4 + 2] = bestC[2];
    out[i * 4 + 3] = 255;
  }
  return { w, h, rgba: out };
}

/** 加 1px 深色描边（MC 物品的标准做法）。 */
function addOutline(img, color = [26, 26, 26]) {
  const { w, h, rgba } = img;
  const copy = rgba.slice();
  const opaque = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return copy[(y * w + x) * 4 + 3] > 24;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opaque(x, y)) continue;
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
        const i = (y * w + x) * 4;
        rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = 255;
      }
    }
  }
  return img;
}

/** 提高饱和度与对比度，让 32×32 下更清晰。 */
function punch(img, saturation = 1.25, contrast = 1.1) {
  const { rgba } = img;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 24) continue;
    let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + (r - lum) * saturation;
    g = lum + (g - lum) * saturation;
    b = lum + (b - lum) * saturation;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    rgba[i] = Math.max(0, Math.min(255, Math.round(r)));
    rgba[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
  return img;
}

// ---------------------------------------------------------------- 主流程
function convert(inputPath, size, maxColors, outline, tolerance = 60) {
  let img = decodePng(fs.readFileSync(inputPath));
  console.log('  原始尺寸: ' + img.w + 'x' + img.h);
  // 1) 按颜色距离抠背景（比 flood fill 可靠）
  const masked = maskByColorDistance(img, tolerance);
  img = masked.img;
  console.log('  背景色: rgb(' + masked.bg.map((v) => Math.round(v)).join(',') + ') 容差 ' + tolerance);
  // 2) 只保留最大的连通块 → 水印/阴影/噪点全丢
  const kept = keepLargestComponent(img);
  console.log('  保留主体: ' + kept.keptSize + ' 像素，丢弃 ' + kept.dropped);
  // 3) 裁到内容边界
  img = cropToContent(img);
  console.log('  裁剪后: ' + img.w + 'x' + img.h);
  img = downsample(img, size);
  img = punch(img);
  img = quantize(img, maxColors);
  if (outline) addOutline(img);
  return img;
}

module.exports = {
  decodePng, encodePng, convert, removeBackground, maskByColorDistance, cropToContent,
  downsample, quantize, addOutline, punch, keepLargestComponent, removeWatermarkBlocks,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const input = args[0];
  const outName = args[1];
  const size = Number((args.find((a) => a.startsWith('--size=')) || '--size=32').split('=')[1]);
  const colors = Number((args.find((a) => a.startsWith('--colors=')) || '--colors=24').split('=')[1]);
  const tolerance = Number((args.find((a) => a.startsWith('--tol=')) || '--tol=60').split('=')[1]);
  const outline = !args.includes('--no-outline');
  const addBarb = args.includes('--barb');
  if (!input || !outName) {
    console.error('用法: node tools/image-to-sprite.js <输入.png> <输出名> [--size=32] [--colors=24] [--tol=60] [--barb] [--no-outline]');
    process.exit(2);
  }
  let img = convert(input, size, colors, outline, tolerance);
  if (addBarb) {
    // 倒刺钩：在钩尖内侧点一个倒刺（原图是普通钩，这里做区分）
    // 位置大约在钩体左上方（钩尖背面）
    const barbX = Math.round(size * 0.34);
    const barbY = Math.round(size * 0.52);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 4; j++) {
        const x = barbX + i + j;
        const y = barbY + Math.round(j * 0.6);
        if (x >= 0 && y >= 0 && x < size && y < size) {
          const idx = (y * size + x) * 4;
          img.rgba[idx] = 210;
          img.rgba[idx + 1] = 214;
          img.rgba[idx + 2] = 218;
          img.rgba[idx + 3] = 255;
        }
      }
    }
  }
  const outDir = path.join(__dirname, '..', 'src/main/resources/assets/anglertackle/textures/item');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName + '.png');
  fs.writeFileSync(outPath, encodePng(img.w, img.h, img.rgba));
  console.log('  输出: ' + outPath + '  (' + img.w + 'x' + img.h + ')');
}
