// ============================================================================
//  gen-release-platform-texture.js -- 生成放生台的方块贴图
//
//  用法: node tools/gen-release-platform-texture.js
//  产物: src/main/resources/assets/anglertackle/textures/block/release_platform.png
//
//  ── 为什么单独开一个脚本，而不是把这张图塞进 gen-textures.js ──────────────
//  gen-textures.js 只写 textures/item 与 textures/entity，而且它一跑就会
//  **重写全部 60 多张物品贴图**。为一个方块贴图去动那个脚本，等于让所有
//  物品贴图重新生成一次 —— 收益是一张图，风险是几十张图，不划算。
//  这里复用它的两样东西：同一张调色板 P（docs/07-美术与素材.md §3 的
//  MC 风格色板）和同一个**自带 PNG 编码器**（下方 crc32/chunk/encodePng
//  逐行照抄），保证两张图的编码方式完全一致，且不引入任何新依赖。
//
//  ── 构图 ─────────────────────────────────────────────────────────────
//  木板围着中间一块水色开口，开口上压三条格栅（竖两根 + 横一根）：
//    · 四周 3 格宽 = 木板（浅木高光 → 木纹 → 深色板缝 → 木色）
//    · 中间 10×8   = 水（上浅下深，看得出是有深度的一片水）
//    · 开口边缘一圈深灰 = 洞口的厚度，让"这里是个洞"一眼能看出来
// ============================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/block/release_platform.png');

// ---------------------------------------------------------------- 调色板
// 只列这张图用到的字符，取值与 tools/gen-textures.js 的 P 表逐字节一致。
const P = {
  k: '#2D2D2D',   // 深灰（洞口边缘）
  o: '#3B2A17',   // 深棕（板缝）
  O: '#5C4525',   // 棕（格栅竖条）
  p: '#7A5C33',   // 木色
  q: '#9C7A4A',   // 浅棕（木高光）
  Q: '#C2A06A',   // 最浅（迎光的一排）
  t: '#0F3B3B',   // 最深的水
  T: '#1A6B6B',   // 深水
  a: '#2FA0A0',   // 水
  A: '#5FD0D0',   // 浅水（近水面）
};

/**
 * 16×16 字符画。
 *
 * ⚠ 这里**故意不用** gen-textures.js 的 normalize16：那个函数会把写短的
 * 一行静默补透明、写长的一行静默截断，适合手写像素画的宽松场景；
 * 但方块贴图多一格少一格是"看起来只是有点歪"的 bug，很难在游戏里发现。
 * 这个脚本对它自己的输入零容忍：长度不对就直接抛，并把行号和实际长度打出来。
 */
const ROWS = [
  'QQQQQQQQQQQQQQQQ',   // 0  迎光的顶边
  'qqqqqqqqqqqqqqqq',   // 1
  'oooooooooooooooo',   // 2  板缝
  'pppppppppppppppp',   // 3
  'ppokkkkkkkkkkopp',   // 4  开口上沿
  'ppoAAOAAAAOAAopp',   // 5  水面（浅）
  'ppoAaOaAAaOaAopp',   // 6
  'ppoaaOaaaaOaaopp',   // 7
  'ppoqqqqqqqqqqopp',   // 8  横向格栅
  'ppoTaOaTTaOaTopp',   // 9
  'ppoTTOTTTTOTTopp',   // 10 水底（深）
  'ppoTtOtTTtOtTopp',   // 11
  'ppokkkkkkkkkkopp',   // 12 开口下沿
  'pppppppppppppppp',   // 13
  'oooooooooooooooo',   // 14 板缝
  'qqqqqqqqqqqqqqqq',   // 15 底边
];

const SIZE = 16;

function rasterize() {
  if (ROWS.length !== SIZE) {
    throw new Error('行数必须是 ' + SIZE + '，实际 ' + ROWS.length);
  }
  const px = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const row = ROWS[y];
    if (row.length !== SIZE) {
      throw new Error('第 ' + y + ' 行长度是 ' + row.length + '，应为 ' + SIZE + '：「' + row + '」');
    }
    for (let x = 0; x < SIZE; x++) {
      const ch = row[x];
      const hex = P[ch];
      if (!hex) {
        throw new Error('第 ' + y + ' 行第 ' + x + ' 列用了调色板里没有的字符 "' + ch + '"');
      }
      const i = (y * SIZE + x) * 4;
      px[i] = parseInt(hex.slice(1, 3), 16);
      px[i + 1] = parseInt(hex.slice(3, 5), 16);
      px[i + 2] = parseInt(hex.slice(5, 7), 16);
      px[i + 3] = 255;
    }
  }
  return px;
}

// ---------------------------------------------------------------- PNG 编码
// 以下三个函数照抄 tools/gen-textures.js（同一套无依赖编码器）。
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

// ---------------------------------------------------------------- 输出
function main() {
  const png = encodePng(SIZE, SIZE, rasterize());
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log('生成 textures/block/release_platform.png  ' + SIZE + 'x' + SIZE
    + '  ' + png.length + ' 字节');
}

module.exports = { ROWS, P, SIZE };

if (require.main === module) {
  main();
}
