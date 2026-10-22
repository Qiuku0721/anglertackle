/*
 * gen-fish-textures.js —— 生成 21 张鱼贴图（尺寸随各自的 UV 图集走，通常 64×16/32/64）。
 *
 * ── 关键：每个像素属于哪个部件的哪个面，是算出来的 ──────────────
 * 见 tools/fish-model.js 的文件头：MC 的 box UV 按盒子尺寸自动展开，
 * 本文件直接调用它拿到"部件 → 6 个面的矩形"，于是可以**逐面**作画：
 *   west/east  鱼体侧面（长条）——背→体侧→腹的渐变与花纹画在这里
 *   up         背面（背色；画横带时也跟着断）
 *   down       腹面（腹色）
 *   north/south 前/后端面
 *
 * ── 朝向（从 ModelPart.Cube 的顶点序反推，见 fish-model.js 注释）──
 *   west 面：横向 = z，**头在右、尾在左**；纵向 = 背在上、腹在下
 *   east 面：横向 = z，**头在左、尾在右**（镜像）；纵向同上
 *   up/down 面：横向 = x，纵向 top=尾、bottom=头
 * 所以统一按"鱼体全局坐标 (Z, s)"作画，由 walk() 负责镜像，不用手算。
 *
 * ── 配色不允许凭空编 ─────────────────────────────────────────
 * 色值全部来自 fish_research/<id>.json，check-fish-appearance.js 会逐条断言。
 * 要换成手绘：UV 布局不变的话直接覆盖同名 PNG 即可。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('./fish-model');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/entity/fish');

// ---------------------------------------------------------------- 最小 PNG 编码
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function pngFromRgba(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = c[3];
    }
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

// ---------------------------------------------------------------- 颜色工具
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c, f) => c.map((v) => v * f);
const px255 = (c) => [...c, 255].map((v) => Math.max(0, Math.min(255, Math.round(v))));

function canvas(w, h) {
  const data = new Uint8Array(w * h * 4);
  const set = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c[3];
  };
  return { w, h, data, set };
}

// ---------------------------------------------------------------- 花纹
/**
 * 体表花纹 —— 作用在"鱼体全局坐标"上：
 *   Z   沿体轴的位置（越小越靠吻端）
 *   s   0=背 1=腹
 *   row 该侧的纵向像素行号（0=背）
 */
function makePattern(f) {
  const ops = f.pattern || [];
  const mark = f.colors.mark ? hex2rgb(f.colors.mark) : null;
  const mark2 = f.colors.mark2 ? hex2rgb(f.colors.mark2) : mark;
  if (!ops.length || !mark) return () => null;
  const k = f.patternContrast === undefined ? 0.7 : f.patternContrast;
  const dens = f.patternDensity === undefined ? 1 : f.patternDensity;
  const rearFade = f.rearFade || 0;
  const barStep = f.barStep || 3;

  let h = 7;
  for (const ch of f.id) h = (h * 1103515245 + ch.charCodeAt(0)) & 0x7FFFFFFF;
  const rnd = () => { h = (h * 1103515245 + 12345) & 0x7FFFFFFF; return h / 0x7FFFFFFF; };
  const NOISE = [];
  for (let i = 0; i < 8192; i++) NOISE.push(rnd());
  const noise = (a, b) => NOISE[((a * 37 + b * 101) % 8192 + 8192) % 8192];

  return (Z, s, row, zMin, zMax) => {
    const span = Math.max(1, zMax - zMin);
    const t = (Z - zMin) / span;
    // 越靠腹部花纹越淡（多数鱼的花纹只在上半身）
    const fade = s > 0.86 ? 0 : (s > 0.62 ? (0.86 - s) / 0.24 : 1);
    let hit = null, kk = k;
    for (const op of ops) {
      if (op === 'bars') {
        // 垂直暗带：细 1px、每 barStep 像素一条
        if (((Z % barStep) + barStep) % barStep === 0 && s < 0.9) hit = mark;
      } else if (op === 'stripes') {
        if (row % 3 === 1 && s < 0.92) hit = mark;
      } else if (op === 'spots') {
        if (noise(Z, row) < 0.16 * dens) hit = mark;
      } else if (op === 'speckle') {
        if (noise(Z * 3 + 11, row * 5 + 7) < 0.13 * dens) hit = mark2;
      } else if (op === 'plates') {
        // 鳞片网格：5×3 的菱形格，格线加深
        const gx = ((Z % 5) + 5) % 5, gy = ((row + Math.floor(Z / 5)) % 3 + 3) % 3;
        if (gx === 0 || gy === 0) { hit = mark; kk = k * 0.7; }
      }
    }
    if (!hit) return null;
    if (rearFade > 0 && t > 0.55) hit = mix(hit, mark, Math.min(1, (t - 0.55) / rearFade));
    return { c: hit, k: kk * (fade === 0 ? 0 : fade) };
  };
}

// ---------------------------------------------------------------- 单条鱼
function paintSpecies(id) {
  const f = M.data.fish[id];
  const S = M.species[id];
  const C = f.colors;
  const t = f.traits || {};

  const back = hex2rgb(C.back), flank = hex2rgb(C.flank), belly = hex2rgb(C.belly);
  const fin = hex2rgb(C.fin || C.flank);
  const finSoft = hex2rgb(C.finSoft || C.fin || C.flank);
  const line = C.line ? hex2rgb(C.line) : null;
  const eye = hex2rgb(C.eye || '#141414');
  const bands = S.bands;
  const pat = makePattern(Object.assign({ id }, f));

  const g = M.bodies[S.group].params;
  const yAxis = 24 - g.H / 2 - 1;
  const shape = f.shape || {};
  const Ln = shape.snoutLen === undefined ? g.Ln : shape.snoutLen;
  const Lt = shape.tailLen === undefined ? g.Lt : shape.tailLen;
  const zMin = -(g.Lh + Ln), zMax = g.Lb + Lt;

  /** 背→体侧→腹三段渐变；断点由该鱼的 bands 决定（银白色的鱼背带很窄）
   *
   *  ⚠ 第二个参数是**沿体轴的绝对 z**：带 {@code shape.bellyStop} 的鱼，腹色在
   *  尾柄之前就**收住** —— 鲨鱼的白肚皮只到腹部，尾巴是整片体色 ✓。
   *  （用户 2026-10-08："前半部分真的很鲨鱼，就是后半也就是鱼尾处理不像。"）
   *  不设 bellyStop 的鱼行为完全不变 ✓（默认 1 = 一路画到尾，就是原来的样子）。 */
  const bellyStop = shape.bellyStop === undefined ? 1 : Number(shape.bellyStop);
  const bodyColor = (s, z) => {
    if (s <= bands[0]) return back;
    if (s <= bands[1]) return mix(back, flank, (s - bands[0]) / Math.max(1e-6, bands[1] - bands[0]));
    if (s <= bands[2]) return flank;
    let k = (s - bands[2]) / Math.max(1e-6, 1 - bands[2]);
    if (bellyStop < 1 && typeof z === 'number' && Number.isFinite(z)) {
      const zf = (z - zMin) / Math.max(1e-6, zMax - zMin);   // 0 = 吻端，1 = 尾鳍末端
      if (zf > bellyStop) k *= Math.max(0, 1 - (zf - bellyStop) / Math.max(1e-6, 1 - bellyStop));
    }
    return mix(flank, belly, k);
  };

  const cv = canvas(S.atlasW, S.atlasH);
  const off = (name) => S.texOffs[name];

  /** 遍历某个面的每个像素，带上它在"鱼体坐标"里的位置 */
  function walk(p, face, fn) {
    const R = M.facesOf(p, off(p.name))[face];
    if (!R || R[2] <= 0 || R[3] <= 0) return;
    const dz = p.size[2];
    for (let row = 0; row < R[3]; row++) {
      for (let col = 0; col < R[2]; col++) {
        let localZ = null;
        if (face === 'west') localZ = (dz - 1 - col) + p.box[2];
        else if (face === 'east') localZ = col + p.box[2];
        else if (face === 'up' || face === 'down') localZ = p.box[2] + (dz - 1 - row);
        // ① 只有 west/east/north/south 的 rect 高度 = dy，row 才是"纵向第几行"。
        //    up/down 的 rect 是 dx × dz —— row 走的是 **z 轴**，不是体高。
        // ② 渐变参数 s 必须按**这一段自身的高度**归一（row / (行数-1)），
        //    不能按"整条鱼的高度"算。鱼身是好几段盒子拼的，每段高度不同；
        //    若用绝对高度算，段的顶行会落在不同的 s 上 ——
        //    表现是**相邻两段之间出现一条色阶台阶**，整条鱼看着像码起来的积木。
        //    按自身归一之后，每段都完整走一遍"背→体侧→腹"，轮廓才是连续的。
        let s;
        if (face === 'up') s = 0;
        else if (face === 'down') s = 1;
        else s = R[3] > 1 ? row / (R[3] - 1) : 0;
        s = Math.max(0, Math.min(1, s));
        fn(R[0] + col, R[1] + row, {
          col, row, face, localZ, Z: localZ === null ? null : localZ + p.at[2],
          s, patRow: Math.round(s * (g.H - 1)),
        });
      }
    }
  }

  // —— 体干 / 尾柄 / 头 / 吻 / 下颌
  for (const p of S.parts) {
    // kind 由 fish-model.js 的 add() 打标：body/head/jaw 走体色渐变，其余走鳍
    if (p.kind !== 'body' && p.kind !== 'head' && p.kind !== 'jaw') continue;
    const patterned = p.kind === 'body' && p.name !== 'peduncle';
    const dark = p.kind !== 'body';              // 头/吻/下颌整体压暗一档
    for (const face of ['west', 'east', 'up', 'down', 'north', 'south']) {
      walk(p, face, (x, y, q) => {
        // 前后端面（q.Z 为 null）用各自那一端的位置代入：north = 吻端、south = 尾端
        const zAbs = q.Z !== null ? q.Z : (face === 'south' ? zMax : zMin);
        let col = bodyColor(q.s, zAbs);
        if (dark) col = shade(col, 0.92);
        if (face === 'up') col = mix(back, col, 0.35);
        if (face === 'down') col = mix(belly, col, 0.35);
        if (patterned) {
          const hit = pat(q.Z, q.s, q.patRow, zMin, zMax);
          if (hit) col = mix(col, hit.c, hit.k);
          // 侧线：体侧中线一条 1px 横线
          if (line && p.name === 'body2' && (face === 'west' || face === 'east') &&
              q.row === Math.round((g.H - 1) * 0.52)) {
            col = mix(col, line, 0.7);
          }
        }
        cv.set(x, y, px255(col));
      });
    }
  }

  // —— 眼睛：画在头侧面靠吻端、体高中线略偏上；eyeScale>1.2 时加大
  const head = S.parts.find((p) => p.name === 'head');
  if (head) {
    const big = (shape.eyeScale || 1) > 1.2 ? 1 : 0;
    for (const face of ['west', 'east']) {
      const R = M.facesOf(head, off('head'))[face];
      if (!R || R[2] <= 0) continue;
      const ex = face === 'west' ? R[2] - 2 - big : 1 + big;
      const ey = Math.max(1, Math.round(R[3] * 0.32));
      cv.set(R[0] + ex, R[1] + ey, px255(eye));
      cv.set(R[0] + ex, R[1] + ey + 1, px255([12, 12, 12]));
      if (big) {
        cv.set(R[0] + ex - 1, R[1] + ey, px255([12, 12, 12]));
        cv.set(R[0] + ex - 1, R[1] + ey + 1, px255(eye));
      }
    }
  }
  if (t.cheekSpot) {
    const cc = hex2rgb(t.cheekSpot);
    for (const face of ['west', 'east']) {
      const R = M.facesOf(head, off('head'))[face];
      if (!R || R[2] <= 0) continue;
      cv.set(R[0] + (face === 'west' ? 1 : R[2] - 2), R[1] + Math.round(R[3] * 0.7), px255(cc));
    }
  }

  // —— 鳍 / 离鳍 / 鳃裂 / 须
  const finletColor = t.finlets ? hex2rgb(t.finlets) : null;
  for (const p of S.parts) {
    let base = null, edge = null;
    if (p.name === 'adipose' && t.adiposeColor) { base = hex2rgb(t.adiposeColor); edge = shade(base, 0.7); }
    else if (p.kind === 'fang') { base = [238, 238, 232]; edge = [200, 200, 196]; }
    else if (p.kind === 'fin') {
      // 尾鳍/背鳍：原版鲑鱼的鳍是**同色系**的一整片板，不是高对比的黑板。
      // 混一点体侧色进去，深色的鱼（青鱼 fin 近黑）就不会变成一大块黑板。
      // 所有鳍都混一半体侧色：深色的鱼（青鱼 finSoft 近黑）也不会挂着一块黑板。
      // 用户实机截图里的"两块带细纹的黑板"就是胸鳍 —— 它是 ±45° 的水平面，
      // 斜着看面积很大，颜色一深就非常扎眼。
      // 尾鳍**完全用体侧色**：用户三次要求"改成 mc 鲑鱼样式"，
      // 每次看到的都是"尾部一块黑板" —— 根因是尾鳍用了 fin 色，
      // 而深色的鱼 fin 近黑。原版鲑鱼的尾鳍就是鱼身色的延伸。
      // ⚠ 尾鳍原来掺 25% **腹色**（belly = mix(flank, belly, 0.25)）——
      //   对白肚皮的鱼（格陵兰鲨 belly #F0F0EB 近白）来说，尾巴上就挂了一条白带 ✗，
      //   正是用户截图里那道白边。带 bellyStop 的鱼改用**体背色**（鲨鱼的尾鳍与背部同色 ✓）。
      const tailNoBelly = shape.bellyStop !== undefined;
      base = p.name.startsWith('tail')
        ? (tailNoBelly ? mix(back, flank, 0.45) : mix(flank, belly, 0.25))
        : mix(fin, flank, 0.5);
      edge = shade(base, 0.78);
    }
    else if (p.kind === 'finlet') { base = finletColor || fin; edge = shade(base, 0.7); }
    else if (p.kind === 'mouth') {
      // 口裂内部：压到很暗，读起来就是一道缝
      base = shade(C.mark2 ? hex2rgb(C.mark2) : flank, 0.45); edge = base;
    }
    else if (p.kind === 'gill') { base = C.mark2 ? hex2rgb(C.mark2) : shade(flank, 0.45); edge = base; }
    else if (p.kind === 'barbel') { base = shade(flank, 0.72); edge = base; }
        else if (p.name.startsWith('pectoral')) { base = finSoft; edge = shade(base, 0.7); }
    if (!base) continue;
    for (const face of ['west', 'east', 'up', 'down', 'north', 'south']) {
      walk(p, face, (x, y, q) => {
        // 尾叶的**贴图裁形**：轮廓靠透明像素切（方块几何做不出梯形）。
        // 判据集中在 fish-model.js 的 cutKeeps，判据本身由两处断言守着：
        // 本文件的自检 + tools/check-fish-model.js ④ —— 都要求"逐列不透明行数正好等于 cutRows"。
        if (!M.cutKeeps(p, face, q.col, q.row)) return;    // 留 alpha=0 ⇒ 渲染时被裁掉
        const flat = face !== 'north' && face !== 'south';
        const rib = flat && (q.col % 2 === 1);
        const isTail = p.name.startsWith('tail');
        const isPect = p.name.startsWith('pectoral');
        let cc = rib ? mix(base, edge, isTail ? 0.22 : isPect ? 0.15 : 0.35) : base;
        if (q.row === 0 && !isTail) cc = mix(cc, [255, 255, 255], 0.12);   // 尾鳍不留白边
        cv.set(x, y, px255(cc));
      });
    }
  }

  // —— 背鳍上缘压深（很多鱼的种征就是"背鳍边缘黑"）
  const dorsal = S.parts.find((p) => p.name === 'dorsal');
  if (dorsal) {
    for (const face of ['west', 'east']) {
      const R = M.facesOf(dorsal, off('dorsal'))[face];
      if (!R || R[3] <= 0) continue;
      for (let xx = 0; xx < R[2]; xx++) cv.set(R[0] + xx, R[1], px255(shade(fin, 0.55)));
    }
  }

  return { id, group: S.group, canvas: cv };
}

// ---------------------------------------------------------------- 输出
fs.mkdirSync(DIR, { recursive: true });
const made = [];
for (const id of Object.keys(M.data.fish)) {
  const r = paintSpecies(id);
  const d = r.canvas.data;
  const buf = pngFromRgba(r.canvas.w, r.canvas.h, (x, y) => {
    const o = (y * r.canvas.w + x) * 4;
    return [d[o], d[o + 1], d[o + 2], d[o + 3]];
  });
  fs.writeFileSync(path.join(DIR, id + '.png'), buf);
  made.push(r);
}
console.log('✅ 生成 ' + made.length + ' 张贴图 → ' + DIR);
console.log('   尺寸随各自的 UV 图集：' +
  [...new Set(made.map((m) => m.canvas.w + '×' + m.canvas.h))].join('  '));

// —— 联络表：放大 3× 并排，供人眼一次看完
const COLS = 7, SCALE = 3;
const CW = Math.max(...made.map((m) => m.canvas.w)) * SCALE;
const CH = Math.max(...made.map((m) => m.canvas.h)) * SCALE;
const sheet = pngFromRgba(COLS * CW, Math.ceil(made.length / COLS) * CH, (x, y) => {
  const idx = Math.floor(y / CH) * COLS + Math.floor(x / CW);
  if (idx >= made.length) return [24, 24, 24, 255];
  const m = made[idx];
  const ox = Math.floor((x % CW) / SCALE), oy = Math.floor((y % CH) / SCALE);
  if (ox >= m.canvas.w || oy >= m.canvas.h) return [40, 40, 46, 255];
  const o = (oy * m.canvas.w + ox) * 4;
  const d = m.canvas.data;
  if (d[o + 3] === 0) return [40, 40, 46, 255];
  return [d[o], d[o + 1], d[o + 2], 255];
});
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'fish-textures-sheet.png'), sheet);
console.log('   联络表 → build/fish-textures-sheet.png');

// ---------------------------------------------------------------- 自检
let bad = 0;
const fishes = JSON.parse(fs.readFileSync(path.join(ROOT,
  'src/main/resources/data/anglertackle/tags/item/fishes.json'), 'utf8'))
  .values.map((v) => v.replace('anglertackle:', ''));
const missing = fishes.filter((x) => !fs.existsSync(path.join(DIR, x + '.png')));
if (missing.length) { console.log('  ❌ 缺贴图：' + missing.join(', ')); bad++; }
else console.log('  ✅ ' + fishes.length + ' 个鱼种都有贴图');

const wrongSize = [];
for (const x of fishes) {
  const b = fs.readFileSync(path.join(DIR, x + '.png'));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const S = M.species[x];
  if (w !== S.atlasW || h !== S.atlasH) wrongSize.push(x + '(' + w + 'x' + h + ' 应为 ' + S.atlasW + 'x' + S.atlasH + ')');
}
if (wrongSize.length) { console.log('  ❌ 尺寸与 UV 图集不符：' + wrongSize.join(', ')); bad++; }
else console.log('  ✅ 每张贴图的尺寸都等于它自己的 UV 图集（LayerDefinition 用同一组数字）');

// 覆盖检查：每个零件的每个非退化面都必须被画过。
// ⚠ 带 cutRows 的零件（尾叶）例外：它**故意**留透明把方块的轮廓切成梯形/三角。
//   对这类零件不能放宽成"只要有像素就行" —— 那等于把断言删空。
//   改成更强的判据：**逐像素**必须等于 cutRows 算出来的裁形，且顺着 z 只会变细、梢部恰 1 行。
// ⚠ 这份期望值**故意不调用 M.cutKeeps**（上色用的那个）：变异测试证明复用它是同义反复 ——
//   把 cutKeeps 改坏，上色与自检一起改坏，照样全绿 ✗。
const cutExpect = (p, face, col) => {
  if (!p.cutRows || (face !== 'west' && face !== 'east')) return null;
  const dz = p.size[2];
  const z = face === 'west' ? dz - 1 - col : col;      // 西面的列序与 z 相反
  const [s0, n] = p.cutRows[z];
  const rows = [];
  for (let row = 0; row < p.size[1]; row++) rows.push(row >= s0 && row < s0 + n);
  return rows;
};

const uncovered = [];
const cutBad = [];
const wedgeBad = [];
for (const r of made) {
  const S = M.species[r.id];
  for (const p of S.parts) {
    for (const [face, R] of Object.entries(M.facesOf(p, S.texOffs[p.name]))) {
      if (R[2] <= 0 || R[3] <= 0) continue;
      const counts = [];
      for (let col = 0; col < R[2]; col++) {
        const want = cutExpect(p, face, col);
        let opaqueN = 0;
        for (let row = 0; row < R[3]; row++) {
          const o = ((R[1] + row) * r.canvas.w + (R[0] + col)) * 4;
          const opaque = r.canvas.data[o + 3] === 255;
          if (opaque) opaqueN++;
          if (want && opaque !== want[row]) cutBad.push(r.id + ':' + p.name + '.' + face);
          else if (!want && !opaque) uncovered.push(r.id + ':' + p.name + '.' + face);
        }
        counts.push(opaqueN);
      }
      if (p.cutRows && (face === 'west' || face === 'east')) {
        // 楔子判据：顺着 z，每列的**起止行都必须单调**（上叶往上走、下叶往下走，都算），
        // 梢部恰 1 行 —— 读出来才是一片梯形，而不是一个方块或一根棍。
        const byZ = face === 'west' ? counts.slice().reverse() : counts;
        const starts = [], ends = [];
        for (const [s0, n] of p.cutRows) { starts.push(s0); ends.push(s0 + n - 1); }
        const mono = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]) || a.every((v, i) => i === 0 || v <= a[i - 1]);
        if (!mono(starts) || !mono(ends)) wedgeBad.push(r.id + ':' + p.name + '.' + face + ' 起止行不单调');
        if (byZ[byZ.length - 1] !== 1) wedgeBad.push(r.id + ':' + p.name + '.' + face + ' 梢部 ' + byZ[byZ.length - 1] + ' 行');
      }
    }
  }
}
const uniq = [...new Set(uncovered)];
if (uniq.length) { console.log('  ❌ 有面没画到：' + uniq.slice(0, 12).join(', ') + (uniq.length > 12 ? ' …共 ' + uniq.length : '')); bad++; }
else console.log('  ✅ 所有零件的所有面都已上色（尾叶按 cutRows 裁形，逐像素比对过）');
{
  const u = [...new Set(cutBad)];
  if (u.length) { console.log('  ❌ 尾叶裁形与 cutRows 对不上：' + u.slice(0, 6).join(', ')); bad++; }
  const w = [...new Set(wedgeBad)];
  if (w.length) { console.log('  ❌ 尾叶裁形不是楔子（越往梢越宽 / 梢部没收到 1 行）：' + w.slice(0, 6).join(', ')); bad++; }
  if (!u.length && !w.length) console.log('  ✅ 尾叶裁形逐像素等于 cutRows，且根粗梢尖（末列恰 1 行）');
}

// 裁形表本身的形状：长度必须等于方块长、每列的起止行必须在方块内、梢部恰 1 行
{
  const shapeBad = [];
  for (const r of made) {
    for (const p of M.species[r.id].parts) {
      if (!p.cutRows) continue;
      const rows = p.cutRows;
      if (rows.length !== p.size[2]) shapeBad.push(r.id + ':' + p.name + ' 裁形表长度 ' + rows.length + ' ≠ 方块长 ' + p.size[2]);
      for (const [s0, n] of rows) {
        if (s0 < 0 || n < 1 || s0 + n > p.size[1]) shapeBad.push(r.id + ':' + p.name + ' 裁形越界：[' + s0 + ',' + n + ']');
      }
      if (rows[rows.length - 1][1] !== 1) shapeBad.push(r.id + ':' + p.name + ' 尾端不是尖的（末列 ' + rows[rows.length - 1][1] + ' 行）');
    }
  }
  if (shapeBad.length) { console.log('  ❌ 尾叶裁形表不合法：' + shapeBad.slice(0, 6).join('；')); bad++; }
  else console.log('  ✅ 尾叶裁形表都是"根粗梢尖"的合法楔子');
}

process.exitCode = bad === 0 ? 0 : 1;
