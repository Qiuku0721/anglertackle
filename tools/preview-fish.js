/*
 * preview-fish.js —— 离屏正交渲染，把 21 种鱼按真实模型 + 真实贴图画成 PNG。
 *
 * 为什么需要它：模型/贴图都在 MC 里才看得见，而"进游戏看一眼"的代价极高
 * （构建 → 部署 → 开新世界 → 找鱼）。这个脚本用同一份 tools/fish-model.js
 * 排版与同一批 PNG，在本地把鱼画出来，人眼直接检查比例、朝向、花纹、眼睛位置。
 *
 * 投影：沿 -X 看（相机在 +X 侧）。屏幕右 = +Z（尾在右、头在左，经典鱼图方向），
 *       屏幕下 = +Y（MC 模型 y 轴本来就向下）。深度 = x，用 z-buffer。
 * UV 完全照 ModelPart.Cube 的顶点序，所以看到的就是游戏里会采样到的像素。
 *
 * 用法：node tools/preview-fish.js [鱼种...]
 *   不给参数 = 全部 21 种，输出 build/fish-preview.png
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('./fish-model');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TEXDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/entity/fish');

// ---------------------------------------------------------------- PNG
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const ty = Buffer.from(t, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([ty, d])), 0); return Buffer.concat([l, ty, d, c]); }
function pngRgb(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const c = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** 读我们自己写的 RGBA PNG（只支持 filter=None / 8bit / RGBA，够用） */
function readRgba(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const idat = [];
  let p = 8;
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w * 4 + 1)];
    if (f !== 0) throw new Error('只支持 filter=None 的 PNG，' + file + ' 用了 filter ' + f);
    raw.copy(out, y * w * 4, y * (w * 4 + 1) + 1, y * (w * 4 + 1) + 1 + w * 4);
  }
  return { w, h, data: out };
}

// ---------------------------------------------------------------- 数学
function rotXYZ(v, r) {
  const [rx, ry, rz] = r;
  let [x, y, z] = v;
  // MC: Quaternionf.rotationZYX(z, y, x) → 先绕 X，再 Y，最后 Z
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); const y1 = y * c - z * s, z1 = y * s + z * c; y = y1; z = z1; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); const x1 = x * c + z * s, z1 = -x * s + z * c; x = x1; z = z1; }
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); const x1 = x * c - y * s, y1 = x * s + y * c; x = x1; y = y1; }
  return [x, y, z];
}

/** 一个部件 → 6 个面（每个面 4 个顶点 + 4 组 uv） */
function faces(p, texOffs) {
  const [bx, by, bz, dx, dy, dz] = p.box;
  const [u0, v0] = texOffs;
  const X0 = bx, X1 = bx + dx, Y0 = by, Y1 = by + dy, Z0 = bz, Z1 = bz + dz;
  const V = (x, y, z) => [x, y, z];
  const defs = {
    down: [[X1, Y0, Z1], [X0, Y0, Z1], [X0, Y0, Z0], [X1, Y0, Z0], u0 + dz, v0, u0 + dz + dx, v0 + dz],
    up: [[X1, Y1, Z0], [X0, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1], u0 + dz + dx, v0 + dz, u0 + dz + 2 * dx, v0],
    west: [[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], u0, v0 + dz, u0 + dz, v0 + dz + dy],
    north: [[X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0], u0 + dz, v0 + dz, u0 + dz + dx, v0 + dz + dy],
    east: [[X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], u0 + dz + dx, v0 + dz, u0 + 2 * dz + dx, v0 + dz + dy],
    south: [[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], u0 + 2 * dz + dx, v0 + dz, u0 + 2 * dz + 2 * dx, v0 + dz + dy],
  };
  const out = {};
  for (const [name, d] of Object.entries(defs)) {
    const verts = [d[0], d[1], d[2], d[3]].map((v) => {
      const r = rotXYZ(v, p.rot);
      return [r[0] + p.at[0], r[1] + p.at[1], r[2] + p.at[2]];
    });
    // 索引 0→(u2,v1) 1→(u1,v1) 2→(u1,v2) 3→(u2,v2)
    // d = [v0,v1,v2,v3, u1,v1,u2,v2] —— 注意 6 是 u2、7 才是 v2
    const uv = [[d[6], d[5]], [d[4], d[5]], [d[4], d[7]], [d[6], d[7]]];
    out[name] = { verts, uv };
  }
  return out;
}

// ---------------------------------------------------------------- 渲染
function renderSpecies(id, texture) {
  const S = M.species[id];
  const s = S.scale;

  // PARTS=1：不采样贴图，改成"每个零件一种颜色"——排查"这块到底是谁"用
  const dbg = process.env.PARTS === '1';
  const PALETTE = [[255,80,80],[80,255,80],[80,120,255],[255,255,80],[255,80,255],[80,255,255],
    [255,160,60],[160,80,255],[80,255,160],[255,80,160],[200,200,200],[120,120,120],
    [255,120,0],[0,180,255],[180,255,0],[255,0,120],[0,255,120],[120,0,255],[255,220,180],[90,60,30]];
  const colorOf = {};
  S.parts.forEach((p, i) => { colorOf[p.name] = PALETTE[i % PALETTE.length]; });
  const tris = [];
  for (const p of S.parts) {
    for (const f of Object.values(faces(p, S.texOffs[p.name]))) {
      const v = f.verts.map((q) => [q[0] * s[0], q[1] * s[1], q[2] * s[2]]);
      // 退化面（面积 0）跳过
      const area = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      const areaYZ = (v[1][1] - v[0][1]) * (v[2][2] - v[0][2]) - (v[2][1] - v[0][1]) * (v[1][2] - v[0][2]);
      const areaXY = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      if (Math.abs(area) < 1e-9 && Math.abs(areaYZ) < 1e-9 && Math.abs(areaXY) < 1e-9) continue;
      tris.push({ v, uv: f.uv, part: p.name });
    }
  }

  const PPU = Number(process.env.PPU || 4);   // 每模型单位多少像素
  const pad = 6;
  const xs = tris.flatMap((t) => t.v.map((q) => q[2]));
  const ys = tris.flatMap((t) => t.v.map((q) => q[1]));
  const z0 = Math.min(...xs), z1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = Math.ceil((z1 - z0) * PPU) + pad * 2;
  const H = Math.ceil((y1 - y0) * PPU) + pad * 2;
  const img = new Uint8Array(W * H * 3).fill(28);
  const zbuf = new Float32Array(W * H).fill(-1e9);

  const px = (q) => (q[2] - z0) * PPU + pad;
  const py = (q) => (q[1] - y0) * PPU + pad;

  for (const t of tris) {
    const P = t.v.map((q) => [px(q), py(q), q[0]]);
    const U = t.uv.map((uv) => [uv[0] / S.atlasW, uv[1] / S.atlasH]);
    for (let i = 1; i < 3; i++) {
      const a = P[0], b = P[i], c = P[i + 1];
      const ua = U[0], ub = U[i], uc = U[i + 1];
      const minx = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxx = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const miny = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxy = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-9) continue;
      for (let y = miny; y <= maxy; y++) {
        for (let x = minx; x <= maxx; x++) {
          const l0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
          const l1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
          const depth = l0 * a[2] + l1 * b[2] + l2 * c[2];
          const o = y * W + x;
          if (depth <= zbuf[o]) continue;
          const u = l0 * ua[0] + l1 * ub[0] + l2 * uc[0];
          const vv = l0 * ua[1] + l1 * ub[1] + l2 * uc[1];
          const tx = Math.min(S.atlasW - 1, Math.max(0, Math.floor(u * S.atlasW)));
          const ty = Math.min(S.atlasH - 1, Math.max(0, Math.floor(vv * S.atlasH)));
          const to = (ty * S.atlasW + tx) * 4;
          if (!dbg && texture.data[to + 3] === 0) continue;   // 透明 = 没画 = 不显示
          zbuf[o] = depth;
          const cc = dbg ? colorOf[t.part] : [texture.data[to], texture.data[to + 1], texture.data[to + 2]];
          img[o * 3] = cc[0]; img[o * 3 + 1] = cc[1]; img[o * 3 + 2] = cc[2];
        }
      }
    }
  }
  return { W, H, img };
}

// ---------------------------------------------------------------- 出图
const only = process.argv.slice(2);
const ids = Object.keys(M.data.fish).filter((x) => only.length === 0 || only.includes(x));
const rendered = ids.map((id) => ({ id, r: renderSpecies(id, readRgba(path.join(TEXDIR, id + '.png'))) }));

const COLS = 3;
// 所有格子一样大、每条鱼**居中**放 —— 这样光看这张图就能比大小。
// 如果按各自的包围盒缩放，21 条鱼画出来会一样大，"该大的要大"就验不了。
const cellW = Math.max(...rendered.map((x) => x.r.W)) + 8;
const cellH = Math.max(...rendered.map((x) => x.r.H)) + 14;
const rows = Math.ceil(rendered.length / COLS);
const W = COLS * cellW, H = rows * cellH;

fs.mkdirSync('build', { recursive: true });
const out = pngRgb(W, H, (x, y) => {
  const ci = Math.floor(x / cellW), ri = Math.floor(y / cellH);
  const idx = ri * COLS + ci;
  if (idx >= rendered.length) return [20, 20, 20];
  const { r } = rendered[idx];
  const ox = (x % cellW) - Math.floor((cellW - r.W) / 2);
  const oy = (y % cellH) - Math.floor((cellH - r.H) / 2);
  if (ox < 0 || oy < 0 || ox >= r.W || oy >= r.H) return [45, 45, 52];
  const o = (oy * r.W + ox) * 3;
  return [r.img[o], r.img[o + 1], r.img[o + 2]];
});
const outPath = only.length ? 'build/fish-preview-' + only[0] + '.png' : 'build/fish-preview.png';
fs.writeFileSync(outPath, out);
console.log('✅ ' + rendered.length + ' 种 → ' + outPath + '  (' + W + '×' + H + '，' + COLS + ' 列，统一比例)');
console.log('   体长（资料实测值）→ 模型长度：');
for (const { id, r } of rendered) {
  const S = M.species[id];
  console.log('     ' + id.padEnd(19) + String(S.lengthCm).padStart(5) + ' cm  →  ' +
    String(S.modelLenBlocks).padStart(5) + ' 格   ' + r.W + '×' + r.H + 'px');
}
