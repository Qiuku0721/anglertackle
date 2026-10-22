/*
 * gen-fine-lures.js —— 三个"精细"拟饵贴图（64×64，像素画风）。
 *
 * ── 为什么单独一条路，不塞进 gen-textures.js 的 SPRITES ────────────────
 * `tools/gen-textures.js` 里的 `SPRITES` 是 **16×16 字符画**：
 * 一行一个字符串、一个字符一个像素、颜色由字符表查。那套写法
 * 只能表达"16 格见方"的粗略形状，做不出用户要的**细节**
 * （软虫的身体渐变、桨尾的鳍条、硬饵的唇板与三本钩的金属反光）。
 *
 * 这里走的是 `gen-lure-rods.js` 那条路：`tools/paint.js` 的 `Canvas`
 * 直接在一张 **64×64** 的画布上按坐标作画，再用 `image-to-sprite.js` 的
 * `encodePng` 写出 RGBA PNG。竿子贴图本来就是 64×64，拟饵跟着对齐。
 *
 * ⚠️ 绝不"画 16×16 再整体放大" —— 那只会得到 4×4 的大色块，
 *    正是用户明确不要的效果。一切都在 64 画布上逐像素完成。
 *
 * ── 像素画纪律 ────────────────────────────────────────────
 *   · 不抗锯齿、不模糊：paint.js 的 set() 是**最近整数格**，天生硬边
 *   · 每条 8~14 色：底色 + 亮部 + 暗部各一档，高光/金属单独给
 *   · 形状由数学决定（椭圆/直线/多边形），不靠数格子
 *
 * 用法：node tools/gen-fine-lures.js
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./paint.js');
const { encodePng } = require('./image-to-sprite.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const CHECK = process.argv.includes('--check');
const SIZE = 64;

// ---------------------------------------------------------------- 调色板
/** 每件 8~14 色：底色 / 亮部 / 暗部 + 该件特有的高光与金属色。 */
const PALETTE = {
  // ① 蓝—深水探索米诺：淡粉/白软虫，冷白发光质感
  depthfinder: {
    body: '#EBC9CE', bodyLit: '#F8E4E6', bodyDim: '#C79AA2',
    belly: '#FBF2F3', tail: '#E4B7BE', tailLit: '#F6E2E5', tailDim: '#BE8A93',
    glow: '#FFF6F7', eye: '#1A1416', eyeLit: '#6E5A5E',
    wire: '#9AA6AE', wireLit: '#D2DAE0',
  },
  // ② 紫-深水摆尾拟饵：绿背 + 银白腹
  paddletail: {
    body: '#3F7A3A', bodyLit: '#67A455', bodyDim: '#28502A',
    belly: '#DCE3E5', bellyDim: '#A9B4B8',
    tail: '#4E8A42', tailLit: '#7CB768', tailDim: '#2E5A2E',
    wire: '#B9C3C9', wireLit: '#E4EAEE',
    blade: '#D8B23A', bladeLit: '#F5DC86', bladeDim: '#9A7A1C',
    eye: '#15181A',
  },
  // ③ 金-深潜巨物振动饵：蓝身 + 黄头硬饵，带唇板与两枚三本钩
  vibration: {
    head: '#E8B62C', headLit: '#F8DA79', headDim: '#A87C12',
    body: '#2E5D8A', bodyLit: '#4C86B8', bodyDim: '#1B3B5C',
    belly: '#DCE6EC', bellyDim: '#9FB0BC',
    lip: '#C9D4DA', lipLit: '#EFF4F7', lipDim: '#8C9BA4',
    hook: '#AFB9C0', hookLit: '#E8EEF2', hookDim: '#6C767D',
    eye: '#14171A', eyeLit: '#8A949B',
    gill: '#123049',
  },
};

// ---------------------------------------------------------------- 画图小工具
/** 用椭圆填一块实心（paint.js 的 ellipse 是描边，这里要填充）。 */
function fillEllipse(c, cx, cy, rx, ry, color) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) c.set(x, y, color);
    }
  }
}

/** 水平方向的"两端收尖"身体：按 x 采样半高，逐列画竖条。 */
function taperedBody(c, x0, x1, cy, halfAt, color) {
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / Math.max(1, x1 - x0);
    const h = Math.max(0.5, halfAt(t));
    for (let y = -h; y <= h; y += 1) c.set(x, cy + Math.round(y), color);
  }
}

/**
 * 桨状尾（paddle tail）—— 三个拟饵共有的招牌件。
 *
 * 做法：一个"上宽下窄"的椭圆 + 内部放射状鳍条。鳍条从尾根（左侧）向右扇形展开，
 * 逐条用 line() 画，末端收在椭圆边界内 —— 这样既不越界，又真的读得出"桨"。
 */
function paddleTail(c, rootX, cy, len, halfH, col) {
  const cx = rootX + len * 0.55;
  fillEllipse(c, cx, cy, len * 0.55, halfH, col.tail);
  // 上缘亮、下缘暗，做出圆润感
  for (let x = rootX; x <= rootX + len; x++) {
    const dx = (x - cx) / (len * 0.55);
    if (Math.abs(dx) > 1) continue;
    const h = halfH * Math.sqrt(Math.max(0, 1 - dx * dx));
    c.set(x, cy - Math.round(h), col.tailLit);
    c.set(x, cy + Math.round(h), col.tailDim);
  }
  // 鳍条：从尾根扇形展开
  const ribs = 7;
  for (let i = 0; i < ribs; i++) {
    const t = ribs === 1 ? 0 : i / (ribs - 1);
    const ax = Math.round(rootX + len * 0.78);
    const ay = Math.round(cy + (t - 0.5) * 2 * halfH * 0.82);
    c.line(rootX + 1, cy, ax, ay, i % 2 === 0 ? col.tailLit : col.tailDim);
  }
  // 尾根一道深色接缝
  for (let y = -halfH * 0.7; y <= halfH * 0.7; y += 1) c.set(rootX, cy + Math.round(y), col.tailDim);
}

/** 一枚三本钩：钩柄 + 三个朝上的钩尖，金属高光在柄上。 */
function trebleHook(c, x, y, size, col) {
  const s = size;
  // 钩柄（竖直的金属杆）+ 上方的小环
  for (let i = 0; i < s; i++) c.set(x, y + i, i < s * 0.4 ? col.hookLit : col.hook);
  c.set(x, y - 1, col.hookDim);
  c.set(x - 1, y - 1, col.hookDim); c.set(x + 1, y - 1, col.hookDim);
  // 三个钩尖：左、中、右
  const tipY = y + s;
  c.line(x, y + s - 1, x - 2, tipY + 1, col.hook);
  c.line(x, y + s - 1, x + 2, tipY + 1, col.hook);
  c.set(x, tipY + 1, col.hookLit);
  c.set(x - 2, tipY, col.hookDim); c.set(x + 2, tipY, col.hookDim);
  c.set(x - 3, tipY - 1, col.hookLit); c.set(x + 3, tipY - 1, col.hookLit);
}

// ---------------------------------------------------------------- ① 深水探索米诺
/** 淡粉/白色的细长软虫：身体渐变 + 大桨尾 + 头部黑眼 + 鼻端金属线环。 */
function drawDepthfinder() {
  const c = new Canvas(SIZE, SIZE);
  const P = PALETTE.depthfinder;
  const cy = 30, x0 = 12, x1 = 42;
  // 身体：两端收尖，中段最粗（半高 5）
  taperedBody(c, x0, x1, cy, (t) => 5 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t + 0.12) / 1.06))), P.body);
  // 背脊亮、腹侧更白：逐列上下各压一档
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const h = 5 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t + 0.12) / 1.06)));
    for (let y = -h; y <= h; y += 1) {
      const yy = cy + Math.round(y);
      if (y < -h * 0.35) c.set(x, yy, y < -h * 0.7 ? P.bodyLit : P.body);
      else if (y > h * 0.45) c.set(x, yy, P.belly);
    }
    // 下缘暗一档，读出体积
    if (h >= 1) c.set(x, cy + Math.round(h), P.bodyDim);
  }
  // 身体上的环纹（软虫的招牌）：浅浅几道
  for (const dx of [4, 9, 14, 19, 24]) {
    for (let y = -4; y <= 4; y += 1) {
      const yy = cy + y;
      const cur = c.get(x0 + dx, yy);
      if (cur && cur !== P.bodyDim) c.set(x0 + dx, yy, P.glow);
    }
  }
  // 桨状尾
  paddleTail(c, x1, cy, 13, 8, P);
  // 头部黑眼（本件的辨识点：一个纯黑眼点）
  fillEllipse(c, x0 + 4, cy - 2, 2.2, 2.2, P.eye);
  c.set(x0 + 3, cy - 3, P.eyeLit);
  // 鼻端金属线环（接主线用）
  c.set(x0 - 1, cy - 2, P.wire); c.set(x0 - 2, cy - 2, P.wireLit);
  c.set(x0 - 1, cy + 2, P.wire); c.set(x0 - 2, cy + 2, P.wireLit);
  c.set(x0 - 3, cy, P.wire); c.set(x0 - 3, cy - 1, P.wireLit); c.set(x0 - 3, cy + 1, P.wireLit);
  return c;
}

// ---------------------------------------------------------------- ② 深水摆尾拟饵
/** 绿背 + 银白腹的桨尾软饵，头部上方一小段金属丝 + 亮片。 */
function drawPaddletail() {
  const c = new Canvas(SIZE, SIZE);
  const P = PALETTE.paddletail;
  const cy = 34, x0 = 11, x1 = 40;
  const halfAt = (t) => 5.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t + 0.14) / 1.04)));
  taperedBody(c, x0, x1, cy, halfAt, P.body);
  // 绿背 → 银白腹的过渡：按体高分三段
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const h = halfAt(t);
    for (let y = -h; y <= h; y += 1) {
      const yy = cy + Math.round(y);
      if (y < -h * 0.25) c.set(x, yy, y < -h * 0.65 ? P.bodyLit : P.body);
      else if (y > h * 0.15) c.set(x, yy, y > h * 0.6 ? P.belly : P.bellyDim);
    }
    if (h >= 1) c.set(x, cy + Math.round(h), P.bodyDim);
  }
  // 背部的小亮片/金属点（"高频摆尾"的卖相）
  for (const [dx, dy] of [[6, -4], [12, -3], [18, -3], [24, -2]]) {
    c.set(x0 + dx, cy + dy, P.wireLit);
    c.set(x0 + dx + 1, cy + dy, P.wire);
  }
  // 桨状尾
  paddleTail(c, x1, cy, 14, 8, P);
  // 唇端金属丝 + 一枚小亮片（头部上方）
  for (let i = 0; i < 6; i++) c.set(x0 - 2 - i, cy - 3 - Math.floor(i / 2), i % 2 ? P.wire : P.wireLit);
  fillEllipse(c, x0 - 9, cy - 6, 3.0, 2.0, P.blade);
  c.set(x0 - 10, cy - 7, P.bladeLit); c.set(x0 - 8, cy - 6, P.bladeLit);
  c.set(x0 - 11, cy - 5, P.bladeDim); c.set(x0 - 7, cy - 8, P.bladeDim);
  // 眼
  fillEllipse(c, x0 + 4, cy - 1, 1.6, 1.6, P.eye);
  return c;
}

// ---------------------------------------------------------------- ③ 深潜巨物振动饵
/** 蓝身 + 黄头的硬饵：唇板、身侧高光、鳃线、两枚三本钩。 */
function drawVibration() {
  const c = new Canvas(SIZE, SIZE);
  const P = PALETTE.vibration;
  const cy = 28, x0 = 14, x1 = 50;
  // 身体：黄头（前 1/3）→ 蓝身
  const halfAt = (t) => 6.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t + 0.1) / 1.02)));
  taperedBody(c, x0, x1, cy, halfAt, P.body);
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const h = halfAt(t);
    const headZone = t < 0.34;
    for (let y = -h; y <= h; y += 1) {
      const yy = cy + Math.round(y);
      if (headZone) {
        c.set(x, yy, y < -h * 0.4 ? P.headLit : (y > h * 0.5 ? P.headDim : P.head));
      } else {
        if (y < -h * 0.3) c.set(x, yy, y < -h * 0.68 ? P.bodyLit : P.body);
        else if (y > h * 0.4) c.set(x, yy, y > h * 0.72 ? P.belly : P.bellyDim);
        else c.set(x, yy, P.body);
      }
    }
    // 背部中线高光：逐列一个像素，读出硬饵的漆面反光
    c.set(x, cy - Math.round(h) + 1, headZone ? P.headLit : P.bodyLit);
  }
  // 鳃线：黄头与蓝身之间一道深色竖线
  const gx = x0 + Math.round((x1 - x0) * 0.34);
  for (let y = -6; y <= 6; y += 1) c.set(gx, cy + y, P.gill);
  // 身侧高光条（硬饵的漆面）
  for (let x = x0 + 3; x < x1 - 3; x++) {
    const t = (x - x0) / (x1 - x0);
    if (t > 0.38 && t < 0.92) c.set(x, cy - 1, P.bodyLit);
  }
  // 唇板：从吻端向前下方伸出的一块斜板（深潜型拟饵的招牌 —— 现在挂这个唇板的是「浅层刺激拟饵」的旧图，见 gen-lure-icons.js）
  for (let i = 0; i < 12; i++) {
    const x = x0 - 1 - Math.round(i * 0.75);
    const y = cy + 2 + Math.round(i * 0.55);
    c.set(x, y, P.lip);
    c.set(x, y - 1, P.lipLit);
    c.set(x, y + 1, P.lipDim);
  }
  // 眼（硬饵的大眼 + 高光）
  fillEllipse(c, x0 + 5, cy - 2, 2.6, 2.6, P.eye);
  c.set(x0 + 4, cy - 3, P.eyeLit); c.set(x0 + 5, cy - 4, P.eyeLit);
  // 两枚三本钩：挂在腹下
  trebleHook(c, x0 + 10, cy + 10, 4, P);
  trebleHook(c, x1 - 8, cy + 10, 4, P);
  // 尾部的接线环
  c.set(x1 + 1, cy, P.lipLit); c.set(x1 + 2, cy, P.lip); c.set(x1 + 3, cy, P.lipDim);
  return c;
}

// ---------------------------------------------------------------- 输出
const JOBS = [
  ['lure_depthfinder', drawDepthfinder],
  ['lure_paddletail', drawPaddletail],
  ['lure_vibration', drawVibration],
];

fs.mkdirSync(OUTDIR, { recursive: true });
let changed = 0;
for (const [id, draw] of JOBS) {
  const c = draw();
  const { rows, palette } = c.toPaletteRows();
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  let colored = 0;
  const used = new Set();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ch = rows[y][x];
      const hex = palette[ch];
      if (!hex) continue;
      used.add(hex);
      const o = (y * SIZE + x) * 4;
      rgba[o] = parseInt(hex.slice(1, 3), 16);
      rgba[o + 1] = parseInt(hex.slice(3, 5), 16);
      rgba[o + 2] = parseInt(hex.slice(5, 7), 16);
      rgba[o + 3] = 255;
      colored++;
    }
  }
  const buf = encodePng(SIZE, SIZE, rgba);
  const file = path.join(OUTDIR, id + '.png');
  const old = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const same = old && old.equals(buf);
  if (!same) {
    changed++;
    if (!CHECK) { fs.writeFileSync(file, buf); console.log('  ✎ ' + path.relative(ROOT, file)); }
    else console.log('  ✗ ' + path.relative(ROOT, file) + ' 与生成结果不一致');
  }
  console.log('  ' + id.padEnd(18) + SIZE + '×' + SIZE + '  上色像素 ' + String(colored).padStart(4)
    + '  用色 ' + String(used.size).padStart(2) + ' 种'
    + (colored === 0 ? '  ❌ 整张全透明' : ''));
}

if (CHECK) {
  console.log(changed === 0 ? '\n✅ 三张拟饵贴图与生成结果一致' : '\n❌ 有 ' + changed + ' 张需要重新生成');
  process.exitCode = changed === 0 ? 0 : 1;
} else {
  console.log('\n✅ 三个拟饵贴图 → ' + changed + ' 个文件变更');
}
