/*
 * gen-hut-clue-icon.js —— 生成「渔夫小屋定位线索」的 16×16 图标。
 *
 * 用户 2026-10-02 把追踪罗盘换成了一次性的定位线索，图标要跟着换：
 * 一张**泛黄的纸**（线索），右下角一个朱红的**小屋标记**（指向渔夫小屋），
 * 底部两道水波（这是钓鱼模组的东西）。
 *
 * 为什么做成生成器而不是手画一张 PNG 贴进仓库：
 *   · 和鱼图标/竿图标一样，"图标是生成物" —— 以后要调色、调形状，
 *     改这里的调色板重跑即可，不用去二进制文件里手改（那种改动没法 review）；
 *   · 检查器 `check-sprites.js` 会断言它是 16×16、`check-hut-clue.js` 会断言它存在。
 *
 * 用法：node tools/gen-hut-clue-icon.js          # 预览（不写）
 *       node tools/gen-hut-clue-icon.js --write  # 写盘
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item/hut_clue.png');

const W = 16;
const H = 16;

/** 调色板（ARGB）。 */
const PAPER = [0xF2, 0xE8, 0xC8, 0xFF];      // 泛黄纸面
const PAPER_DARK = [0xCE, 0xBE, 0x92, 0xFF]; // 纸边/折痕
const INK = [0x8A, 0x6A, 0x3A, 0xFF];        // 字迹（棕墨）
const ROOF = [0xB0, 0x3A, 0x2A, 0xFF];       // 朱红屋顶
const WALL = [0xE8, 0xD8, 0xA8, 0xFF];       // 屋墙
const WATER = [0x3A, 0x6E, 0xA8, 0xFF];      // 水波
const CLEAR = [0, 0, 0, 0];

/** 返回第 y 行第 x 列的像素；用"画形状"的方式写，比逐像素表好读也好改。 */
function pixel(x, y) {
  // 纸：整张，四角切掉一格让轮廓不那么方
  const corner = (x === 0 || x === W - 1) && (y === 0 || y === H - 1);
  if (corner) return CLEAR;
  // 纸边（最外一圈）
  if (x === 0 || x === W - 1 || y === 0 || y === H - 1) return PAPER_DARK;
  // 折痕：从左下到右上的一条斜线
  if (x + y === 9) return PAPER_DARK;
  // 字迹：左上三行短横线（"写着线索"）
  if (y >= 3 && y <= 4 && x >= 3 && x <= 8) return INK;
  if (y === 6 && x >= 3 && x <= 6) return INK;
  // 小屋：右下角（第 10~14 列、第 8~12 行）
  const hx = x - 10, hy = y - 8;
  if (hx >= 0 && hx <= 4 && hy >= 0 && hy <= 4) {
    if (hy === 0) return ROOF;                       // 屋脊
    if (hy === 1 && hx >= 1 && hx <= 3) return ROOF;  // 斜屋顶
    if (hy >= 2) {
      if (hx === 0 || hx === 4) return WALL;         // 两侧墙
      if (hx === 2 && hy === 4) return INK;          // 门
      return WALL;
    }
  }
  // 水波：最下面两行
  if (y === 14 && (x % 4 === 1 || x % 4 === 2)) return WATER;
  if (y === 15 && (x % 4 === 3 || x % 4 === 0)) return WATER;
  return PAPER;
}

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
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

function buildPng() {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const rowStart = y * (W * 4 + 1);
    raw[rowStart] = 0;   // filter: None
    for (let x = 0; x < W; x++) {
      const c = pixel(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = buildPng();
const write = process.argv.includes('--write');
if (!write) {
  console.log('预览：' + W + '×' + H + '，' + png.length + ' 字节 → ' +
    path.relative(ROOT, OUT).replace(/\\/g, '/'));
  console.log('（加 --write 写盘）');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT) : null;
  if (old && old.equals(png)) {
    console.log('已是最新，未改动');
  } else {
    fs.writeFileSync(OUT, png);
    console.log('✅ 已写出 ' + path.relative(ROOT, OUT).replace(/\\/g, '/') + '（' + png.length + ' 字节）');
  }
}
