// ============================================================================
//  gen-reel-textures.js -- 生成 5 档渔轮贴图
//
//  做法沿用项目里的 16×16 像素画管线（tools/paint.js），
//  每档用不同配色 + 略有差异的造型，而不是简单地把一张图换个色——
//  换色版在 16px 下几乎分不出来，"哪颗轮"要靠形状也认得出。
//
//  用法: node tools/gen-reel-textures.js <输出目录>
// ============================================================================
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./paint.js');
const { encodePng } = require('./image-to-sprite.js');

const outDir = process.argv[2];
const SIZE = 16;
const OUT = 64;   // 最终贴图尺寸（16×16 最近邻放大到 64×64）

/**
 * 画一颗纺车轮（侧面视角）：圆形线杯 + 中心轴 + 下方摇把。
 * @param {object} c 配色 {body, light, dark, spool, accent}
 * @param {number} scale 整体尺寸微调（1 = 标准）
 */
function drawSpinningReel(col, big) {
  const c = new Canvas(SIZE, SIZE);
  const cx = 8, cy = big ? 6 : 7;
  const r = big ? 4 : 3.4;

  // 线杯：外圈深色轮廓
  c.ellipse(cx, cy, r + 0.5, r + 0.5, col.dark);
  c.ellipse(cx, cy, r, r, col.body);
  // 杯内凹陷
  c.ellipse(cx, cy, r - 1.2, r - 1.2, col.dark);
  c.ellipse(cx, cy, r - 1.6, r - 1.6, col.spool);
  // 中心轴
  c.set(cx, cy, col.dark);
  // 高光
  c.set(cx - 2, cy - 2, col.light);
  c.set(cx - 1, cy - 2, col.light);

  // 下方摇把
  const hy = cy + r + 1;
  c.rect(cx - 1, hy, 2, 1, col.dark);
  c.set(cx, hy + 1, col.dark);
  c.set(cx + 1, hy + 2, col.accent);
  c.set(cx + 2, hy + 2, col.accent);

  // 座（连到竿上的部分）
  c.set(cx, cy - r - 1, col.dark);
  c.set(cx + 1, cy - r - 1, col.dark);
  return c;
}

/** 画一颗鼓轮：横向的圆筒 + 两侧端盖。 */
function drawDrumReel(col) {
  const c = new Canvas(SIZE, SIZE);
  const cx = 8, cy = 8;
  // 圆筒主体（横向）
  c.ellipse(cx, cy, 4.5, 3, col.dark);
  c.ellipse(cx, cy, 4, 2.5, col.body);
  // 两侧端盖
  c.ellipse(cx - 3.5, cy, 1.2, 2.5, col.dark);
  c.ellipse(cx + 3.5, cy, 1.2, 2.5, col.dark);
  // 卷线纹理（横纹）
  c.line(cx - 2, cy - 1, cx + 2, cy - 1, col.dark);
  c.line(cx - 2, cy + 1, cx + 2, cy + 1, col.dark);
  // 高光
  c.line(cx - 2, cy - 2, cx + 2, cy - 2, col.light);
  // 摇把
  c.set(cx + 4, cy + 3, col.accent);
  c.set(cx + 5, cy + 4, col.accent);
  return c;
}

/** 画一颗水滴轮：矮扁的外形 + 顶部导线规 + 侧面摇把。 */
function drawBaitcastReel(col) {
  const c = new Canvas(SIZE, SIZE);
  const cx = 8, cy = 9;
  // 矮扁的主体
  c.ellipse(cx, cy, 4.5, 2.6, col.dark);
  c.ellipse(cx, cy, 4, 2, col.body);
  // 线杯（中间露出一截）
  c.ellipse(cx - 1, cy, 1.4, 1.4, col.spool);
  // 顶部导线规（水滴轮的标志）
  c.line(cx - 2, cy - 3, cx + 2, cy - 3, col.dark);
  c.set(cx, cy - 4, col.accent);
  // 侧面摇把
  c.set(cx + 4, cy + 1, col.dark);
  c.set(cx + 4, cy + 3, col.accent);
  // 高光
  c.set(cx - 2, cy - 1, col.light);
  c.set(cx - 1, cy - 1, col.light);
  return c;
}

const REELS = [
  {
    name: 'hand_reel',
    draw: (col) => drawSpinningReel(col, false),
    col: { body: '#8a8f96', light: '#b8bec6', dark: '#4a4f55', spool: '#6d737a', accent: '#3a3f45' },
  },
  {
    name: 'spinning_reel',
    draw: (col) => drawSpinningReel(col, false),
    col: { body: '#9aa3ab', light: '#c6ced5', dark: '#69727a', spool: '#7d868e', accent: '#2f2a26' },
  },
  {
    name: 'drum_reel',
    draw: drawDrumReel,
    col: { body: '#3f7fc4', light: '#7fb2e8', dark: '#25507f', spool: '#356ea8', accent: '#d8b048' },
  },
  {
    name: 'baitcast_reel',
    draw: drawBaitcastReel,
    col: { body: '#8a4fc4', light: '#bc8ce8', dark: '#55307f', spool: '#6f3fa0', accent: '#e0c060' },
  },
  {
    name: 'heavy_reel',
    draw: (col) => drawSpinningReel(col, true),
    col: { body: '#d8a832', light: '#f5d878', dark: '#9c7318', spool: '#b8892a', accent: '#7a5a10' },
  },
];

const OUTLINE = '#1a1a1e';   // MC 物品惯例：外圈一圈深色描边

fs.mkdirSync(outDir, { recursive: true });
for (const r of REELS) {
  const c = r.draw(r.col);
  // 描边：让物品在物品栏里"立"起来（不做这一步看起来就是一团糊色块）
  c.outline(OUTLINE);
  const { rows, palette } = c.toPaletteRows();

  // 16×16 → 64×64 最近邻放大
  const big = Buffer.alloc(OUT * OUT * 4);
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      const ch = rows[Math.floor(y / 4)][Math.floor(x / 4)];
      const hex = palette[ch];
      if (!hex) continue;
      const o = (y * OUT + x) * 4;
      big[o] = parseInt(hex.slice(1, 3), 16);
      big[o + 1] = parseInt(hex.slice(3, 5), 16);
      big[o + 2] = parseInt(hex.slice(5, 7), 16);
      big[o + 3] = 255;
    }
  }
  const file = path.join(outDir, r.name + '.png');
  fs.writeFileSync(file, encodePng(OUT, OUT, big));
  console.log('写出 ' + file);
}
