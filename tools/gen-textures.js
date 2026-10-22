// ============================================================================
//  gen-textures.js -- 生成《垂纶》的像素贴图（无第三方依赖，自带 PNG 编码器）
//
//  参考素材：用户提供的实物照片
//    · 玻纤钓竿（深色握把 + 竿身高光 + 金属导环 + 竿梢垂线）
//    · 金属纺车轮（圆形卷线器 + 摇臂 + 握丸）
//    · 米诺拟饵的配钩（钩眼 → 钩柄 → 底部 U 形弯 → 钩尖斜上）
//    · 阿波/立漂（细天线 + 红头 + 白身 + 水下配重）
//    · 卷线盘
//
//  用法: node tools/gen-textures.js
//  校验: node tools/check-sprites.js              （检查所有字符画是否 16×16）
//  预览: node tools/preview-texture.js <png>      （终端里用色块看效果）
//
//  调色板严格取自 docs/07-美术与素材.md §3 的 MC 风格 32 色板。
// ============================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const TEX_ITEM = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const TEX_ENTITY = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/entity');

// ---------------------------------------------------------------- 调色板
const P = {
  '.': null,            // 透明
  K: '#1A1A1A',         // 最黑（描边）
  k: '#2D2D2D',
  g: '#3F3F3F',
  G: '#4F4F4F',
  m: '#6B6B6B',         // 中灰（金属）
  M: '#8A8A8A',
  n: '#A8A8A8',         // 浅灰
  N: '#C6C6C6',
  w: '#E4E4E4',         // 近白
  W: '#FFFFFF',

  b: '#1B3A6B',         // 深蓝
  B: '#2A5A9E',
  c: '#3E7FD1',
  C: '#5FA8E8',
  d: '#8FCBF5',
  D: '#C2E4FA',

  e: '#1E4D1E',         // 深绿
  E: '#2F7A2F',
  f: '#4CAF4C',
  F: '#7BD07B',

  o: '#3B2A17',         // 深棕（木/握把暗部）
  O: '#5C4525',
  p: '#7A5C33',         // 棕（木）
  q: '#9C7A4A',
  Q: '#C2A06A',         // 浅棕（木高光）

  y: '#6B5214',         // 暗金
  Y: '#A88019',
  z: '#D8A81E',
  Z: '#F0C93B',
  x: '#FBE58A',         // 亮金

  r: '#5C1010',
  R: '#8B1A1A',
  s: '#C62828',         // 红
  S: '#E85C5C',

  u: '#3A1B4D',         // 紫
  U: '#5E2A7A',
  v: '#8B44B0',
  V: '#B476D6',

  t: '#0F3B3B',         // 青
  T: '#1A6B6B',
  a: '#2FA0A0',
  A: '#5FD0D0',
};

/**
 * 把字符画规整成严格的 16×16。
 *
 * 手写像素画最容易犯的错是某一行少写/多写一格。与其靠人数格子，
 * 不如让代码统一修正：短了右侧补透明，长了截断，行数不足补空行。
 * 这样任何一行的轻微笔误都不会让整个生成流程崩掉。
 */
function normalize16(rows) {
  const out = [];
  for (let i = 0; i < 16; i++) {
    let r = rows[i] === undefined ? '' : String(rows[i]);
    if (r.length < 16) {
      r += '.'.repeat(16 - r.length);
    } else if (r.length > 16) {
      r = r.slice(0, 16);
    }
    out.push(r);
  }
  return out;
}

/** 把字符画转成 RGBA 像素数组（35 行以上的大图不走 16×16 规整）。 */
function rasterizeRaw(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (!(ch in P)) {
        throw new Error('未知调色板字符 "' + ch + '" 在第 ' + y + ' 行第 ' + x + ' 列');
      }
      const hex = P[ch];
      const i = (y * w + x) * 4;
      if (hex === null) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      } else {
        px[i] = parseInt(hex.slice(1, 3), 16);
        px[i + 1] = parseInt(hex.slice(3, 5), 16);
        px[i + 2] = parseInt(hex.slice(5, 7), 16);
        px[i + 3] = 255;
      }
    }
  }
  return { w, h, px };
}

/** 把字符画转成 RGBA 像素数组（强制 16×16）。 */
function rasterize(rows) {
  return rasterizeRaw(normalize16(rows));
}

// ---------------------------------------------------------------- PNG 编码
function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(w, h, px) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w * 4; x++) {
      raw[y * (w * 4 + 1) + 1 + x] = px[y * w * 4 + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============================================================================
//  一、钓竿（5 材质 × 2 类型 = 10 根）
//
//  构图（16×16，左下 → 右上）：
//    左下 5 格 = 握把（深色发泡，略粗）
//    中段 6 格 = 竿身（材质色 + 描边 + 高光）
//    右上 3 格 = 竿梢（亮色）
//    右上角    = 金属导环 + 垂下的鱼线
//  路亚竿额外在竿梢挂一枚亮片拟饵。
// ============================================================================

const ROD_MATS = {
  wood:      { dark: 'o', main: 'p', tip: 'Q', guide: 'm', grip: 'O', gripDark: 'o' },
  iron:      { dark: 'g', main: 'm', tip: 'N', guide: 'n', grip: 'o', gripDark: 'K' },
  gold:      { dark: 'y', main: 'z', tip: 'x', guide: 'Z', grip: 'o', gripDark: 'K' },
  diamond:   { dark: 't', main: 'a', tip: 'A', guide: 'C', grip: 'o', gripDark: 'K' },
  netherite: { dark: 'k', main: 'g', tip: 'm', guide: 'n', grip: 'U', gripDark: 'u' },
};

function makeRodSprite(m, isLure) {
  const rows = [
    '................',
    '.............KK.',
    '............K' + m.guide + 'KK',
    '...........K' + m.tip + 'K..',
    '..........K' + m.tip + 'K...',
    '.........K' + m.tip + 'K....',
    '........K' + m.main + 'K.....',
    '.......K' + m.main + 'K......',
    '......K' + m.main + 'K.K.....',
    '.....K' + m.dark + 'K.K' + m.guide + 'K....',
    '....K' + m.main + 'K........',
    '...K' + m.main + 'K.........',
    '..K' + m.grip + 'K..........',
    '.K' + m.grip + 'K...........',
    '.K' + m.gripDark + 'K...........',
    '..KK............',
  ];
  if (isLure) {
    rows[10] = '....K' + m.main + 'K.KzK....';
    rows[11] = '...K' + m.main + 'K..KK.....';
  }
  return normalize16(rows);
}

const SPRITES = {};

/**
 * 水平镜像。用户 2026-10-01：杆子图标"现在是向右斜，我要向左斜"。
 *
 * ⚠ 必须在 {@link normalize16} **之后**做：它给短行**右补**透明，
 *   在它之前镜像会把补出来的透明挪到左边，图案整体错位半格。
 *   规整完每行都是严格 16 字符，反序就是无损的水平镜像。
 */
function mirrorRows(rows) {
  return rows.map((r) => r.split('').reverse().join(''));
}

for (const [matName, mat] of Object.entries(ROD_MATS)) {
  SPRITES[matName + '_float_rod'] = mirrorRows(makeRodSprite(mat, false));
  SPRITES[matName + '_lure_rod'] = mirrorRows(makeRodSprite(mat, true));
}

// ============================================================================
//  二、鱼线（卷线盘）
//  中间 6 行用两种颜色交替，表现缠绕的线；线色按品质区分
// ============================================================================

function makeLineSprite(wrapA, wrapB) {
  const row = (a, b) => normalize16(['..KpK' + a + a + b + b + 'KpK'])[0];
  return normalize16([
    '................',
    '....KKKKKKKK....',
    '...KppppppppK...',
    '..KpKKKKKKKKpK..',
    row(wrapA, wrapB),
    row(wrapB, wrapA),
    row(wrapA, wrapB),
    row(wrapB, wrapA),
    row(wrapA, wrapB),
    row(wrapB, wrapA),
    '...KppppppppK...',
    '....KKKKKKKK....',
  ]);
}

SPRITES.hemp_line = makeLineSprite('N', 'n');     // 麻线：米白
SPRITES.cotton_line = makeLineSprite('F', 'f');   // 棉线：浅绿
SPRITES.nylon_line = makeLineSprite('D', 'C');    // 尼龙：浅蓝
SPRITES.fluoro_line = makeLineSprite('V', 'v');   // 碳氟：灰紫
SPRITES.pe_line = makeLineSprite('x', 'Z');       // PE：金黄

// ============================================================================
//  三、渔轮（纺车轮，参考实物照片）
//  圆形卷线器 + 中心线杯 + 左下摇臂 + 握丸
// ============================================================================

SPRITES.hand_reel = normalize16([
  '................',
  '.........KK.....',
  '........KmmK....',
  '.......KmMMmK...',
  '......KmMNNMmK..',
  '.....KmMNwwNMmK.',
  '.....KmMNwwNMmK.',
  '......KmMNNMmK..',
  '.......KmMMmK...',
  '........KmmK....',
  '.......KgKK.....',
  '......KgK.......',
  '.....KgK........',
  '....KggK........',
  '....KmmK........',
  '.....KK.........',
]);

SPRITES.spinning_reel = normalize16([
  '................',
  '.........KK.....',
  '........KnnK....',
  '.......KnNNnK...',
  '......KnNwwNnK..',
  '.....KnNwmmwNnK.',
  '.....KnNwmmwNnK.',
  '......KnNwwNnK..',
  '.......KnNNnK...',
  '........KnnK....',
  '.......KgKK.....',
  '......KgK.......',
  '.....KgK........',
  '....KggK........',
  '....KmmK........',
  '.....KK.........',
]);

// ============================================================================
//  四、鱼钩（严格按用户提供的实物照片）
//
//  照片特征：
//    · 顶端是**扁平的钩眼**（细长一条，几乎和钩柄同宽，不是圆环）
//    · 钩柄长而直，贴着右侧竖直向下
//    · 底部是**大半径圆弧**，向左弯过去
//    · 钩尖从弧底**向左上方**伸出，尖端到钩高的 2/3 处
//    · 钩尖背面（朝左那侧）有一个向上的倒刺
//    · 整体是窄高的 J 形，占满整个 16 格高度
// ============================================================================

SPRITES.plain_hook = normalize16([
  '...........KK...',   // 扁平钩眼（顶端正中）
  '..........KnnK..',
  '..........KnnK..',
  '...........KnnK.',   // 长直钩柄（略微右偏）
  '...........KnnK.',
  '...........KnnK.',
  '...........KnnK.',
  '...........KnnK.',
  '..........KnnK..',
  '..........KnnK..',
  '.........KnnnK..',   // 弧开始向左弯
  '........KnnnK...',
  '.......KnnK.....',
  '......KnnK......',   // 弧底
  '.....KnnK.......',   // 钩尖向左上
  '......KK........',
]);

// 倒刺钩：钩尖背面多一个向上的倒刺（照片里那个小尖）
SPRITES.barbed_hook = normalize16([
  '.........KK.....',
  '........KnnK....',
  '........KnnK....',
  '.........KnnK...',
  '.........KnnK...',
  '.........KnnK...',
  '.........KnnK...',
  '.........KnnK...',
  '........KnnK....',
  '........KnnK....',
  '.......KnnnK....',
  '.......KnnKK....',
  '......KnnK......',
  '.....KnnK.......',
  '....KnnK........',
  '.....KK.........',
]);

// ============================================================================
//  五、浮漂（阿波/立漂：细天线 + 红头 + 白身 + 黑箍 + 水下配重）
// ============================================================================

SPRITES.wood_float = normalize16([
  '................',
  '.......KK.......',
  '.......KwK......',
  '.......KwK......',
  '......KKsKK.....',
  '......KsSSK.....',
  '......KsSSK.....',
  '.....KKwwKK.....',
  '.....KwWWwK.....',
  '.....KwWWwK.....',
  '.....KwWWwK.....',
  '.....KKggKK.....',
  '......KmK.......',
  '......KmK.......',
  '......KgK.......',
  '.......K........',
]);

SPRITES.glow_float = normalize16([
  '................',
  '.......KK.......',
  '......KxZK......',
  '......KxZK......',
  '......KKxKK.....',
  '......KxZZK.....',
  '......KxZZK.....',
  '.....KKDDKK.....',
  '.....KDaAK......',
  '.....KDaAK......',
  '.....KDaAK......',
  '.....KKttKK.....',
  '......KTK.......',
  '......KTK.......',
  '......KtK.......',
  '.......K........',
]);

// ============================================================================
//  六、鱼获（河流鲫鱼，严格按用户提供的实物照片）
//
//  照片特征：
//    · **头朝左**（眼睛在左侧靠上，嘴在最左边、略上翘）
//    · 身体是**高的椭圆**，背比腹更拱
//    · **背鳍长而高**，上缘带锯齿，从背部中间一直延伸到尾部
//    · 尾鳍**深分叉**（上下两片，中间凹进去）
//    · 体色：背深橄榄褐（q/o）→ 腹浅米黄（Q）
//    · 眼睛大，外面一圈浅色、中间一个黑点
// ============================================================================

SPRITES.crucian_carp = normalize16([
  '................',
  '..........KKK...',   // 背鳍上缘（锯齿）
  '.........KqqK..K',
  'KKKKKKKKKqqqK.KK',
  'KQQQQQQQQqqqKKKK',   // 背鳍下方（深色背）
  'KQQKQQQQQqqqqqKK',   // 眼（左起第 4 格是黑点）
  'KQQKQQQQQqqqqqKK',
  'KQQQQQQQQqqqqqKK',
  'KQQQQQQQQqqqqqKK',   // 尾鳍中间凹口
  'KQQQQQQQQqqqqqKK',
  'KKQQQQQQQqqqqqKK',
  '.KKQQQQQQqqqKKK',   // 尾鳍下片
  '..KKQQQQQqqKK.K.',
  '....KKQQQKK...K.',
  '......KKK.......',   // 腹鳍
  '................',
]);

// ============================================================================
//  七、教程书（钓鱼手册）：棕色封面 + 书页边缘 + 封面上的小鱼标记
// ============================================================================

SPRITES.guide_book = normalize16([
  '................',
  '..KKKKKKKKKKKK..',
  '..KooooooooooK..',
  '..KOqqqqqqqqOK..',
  '..KOqKKKKKKqOK..',
  '..KOqKwwwwKqOK..',
  '..KOqKwCCwKqOK..',
  '..KOqKwCCwKqOK..',
  '..KOqKwwwwKqOK..',
  '..KOqKKKKKKqOK..',
  '..KOqqqqqqqqOK..',
  '..KOqqqqqqqqOK..',
  '..KwwwwwwwwwwK..',
  '..KwwwwwwwwwwK..',
  '..KKKKKKKKKKKK..',
  '................',
]);

// ============================================================================
//  八、浮漂实体贴图（32×32，供 BobberRenderer 的三段共用）
//  自上而下：细杆 → 红头 → 白身 → 水下配重
//  行位置与 BobberRenderer 里写的 UV 对齐
// ============================================================================

const BOBBER_TEX = (() => {
  const rows = [];
  for (let y = 0; y < 32; y++) {
    let row = '';
    for (let x = 0; x < 32; x++) {
      if (y < 4) row += 'm';        // 顶部细杆
      else if (y < 8) row += 'S';   // 红头
      else if (y < 11) row += 'K';  // 黑箍
      else if (y < 19) row += 'W';  // 白身
      else if (y < 22) row += 'K';  // 黑箍
      else if (y < 28) row += 'g';  // 水下部分
      else row += 'k';
    }
    rows.push(row);
  }
  return rows;
})();

// ============================================================================
//  输出
// ============================================================================
function main() {
  fs.mkdirSync(TEX_ITEM, { recursive: true });
  fs.mkdirSync(TEX_ENTITY, { recursive: true });

  const written = [];

  for (const [name, rows] of Object.entries(SPRITES)) {
    let result;
    try {
      result = rasterize(rows);
    } catch (e) {
      throw new Error('贴图 "' + name + '" 生成失败：' + e.message);
    }
    fs.writeFileSync(path.join(TEX_ITEM, name + '.png'), encodePng(result.w, result.h, result.px));
    written.push('item/' + name + '.png  ' + result.w + 'x' + result.h);
  }

  {
    // 浮漂实体贴图是 32×32，必须走 rasterizeRaw（不能用 16×16 规整）
    const result = rasterizeRaw(BOBBER_TEX);
    fs.writeFileSync(path.join(TEX_ENTITY, 'bobber.png'), encodePng(result.w, result.h, result.px));
    written.push('entity/bobber.png  ' + result.w + 'x' + result.h);
  }

  console.log('生成 ' + written.length + ' 张贴图：');
  for (const line of written) {
    console.log('  ' + line);
  }
}

// ---------------------------------------------------------------- 导出
// 被 preview-sprite.js require 时可以拿到字符画；直接运行时才生成 PNG。
module.exports = { SPRITES, BOBBER_TEX, P, normalize16 };

if (require.main === module) {
  main();
}
