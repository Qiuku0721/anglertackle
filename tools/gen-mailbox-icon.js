/*
 * gen-mailbox-icon.js —— 生成「邮箱」的 16×16 图标（用户 2026-10-11 点名要的邮件系统）。
 *
 * 画的是什么：一只**木箱**（邮筒底），正面挂一块**信封**（米白 + 折线），
 * 右上角一面**小旗**（未读标记 —— 与 `Mighty Mail` 用"箱子上方一面红旗"表示未读同一路子）。
 *
 * 为什么做成生成器而不是手画一张 PNG 贴进仓库（与 gen-hut-clue-icon.js 同一条理由）：
 *   · 图标是**生成物** —— 以后调色/改形状改这里的调色板重跑即可，二进制改动没法 review；
 *   · `check-sprites.js` 会断言它是 16×16。
 *
 * 用法：node tools/gen-mailbox-icon.js          # 预览（不写）
 *       node tools/gen-mailbox-icon.js --write  # 写盘
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item/mailbox.png');

const W = 16;
const H = 16;

/** 调色板（RGBA）。木色与 mod 里别的手作物品一致，信封用米白。 */
const WOOD = [0x8A, 0x62, 0x38, 0xFF];        // 箱身木色
const WOOD_DARK = [0x5E, 0x40, 0x22, 0xFF];   // 箱身边/缝
const WOOD_LIGHT = [0xB0, 0x86, 0x52, 0xFF];  // 箱身高光
const PAPER = [0xF2, 0xEC, 0xD8, 0xFF];       // 信封
const PAPER_DARK = [0xC8, 0xBE, 0xA0, 0xFF];  // 信封折线
const FLAG = [0xC0, 0x3A, 0x2A, 0xFF];        // 未读小旗（红）
const POLE = [0x40, 0x40, 0x40, 0xFF];        // 旗杆
const CLEAR = [0, 0, 0, 0];

function pixel(x, y) {
  // ---- 小旗：右上角（旗杆 x=12，y=2..5；旗面 x=9..11，y=2..3）----
  if (x === 12 && y >= 2 && y <= 5) return POLE;
  if (y >= 2 && y <= 3 && x >= 9 && x <= 11) return FLAG;
  // ---- 信封：贴在箱身正面中央（x 4..11，y 8..12）----
  //   ⚠ 必须**排在箱身之前**判：信封是"贴在箱子正面"的，先判箱子就永远画不到它
  //   （第一版就是这么写的，预览里只看得到一只空箱子 ✗）。
  if (x >= 4 && x <= 11 && y >= 8 && y <= 12) {
    if (y === 8 || y === 12 || x === 4 || x === 11) return PAPER_DARK;
    // 折线：两条斜线在中间交汇（信封的封盖）
    if (y - 8 === Math.abs(x - 7) || y - 8 === Math.abs(x - 8)) return PAPER_DARK;
    return PAPER;
  }
  // ---- 箱身：x 1..14，y 6..13，四角切一格 ----
  const box = x >= 1 && x <= 14 && y >= 6 && y <= 13;
  if (box) {
    const corner = (x === 1 || x === 14) && (y === 6 || y === 13);
    if (corner) return CLEAR;
    // 顶面：上面两行是浅木（箱盖的斜面）
    if (y === 6) return WOOD_LIGHT;
    if (y === 7) return x % 5 === 0 ? WOOD_DARK : WOOD_LIGHT;
    // 立面：木色 + 木纹（每 4 列一条深缝）
    if (x === 1 || x === 14 || y === 13) return WOOD_DARK;
    if (x % 4 === 0) return WOOD_DARK;
    return WOOD;
  }
  return CLEAR;
}

// ---- PNG 写入（与 gen-hut-clue-icon.js 逐字相同的最小实现）----
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
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log('已写入 ' + path.relative(ROOT, OUT) + '（' + png.length + ' 字节，' + W + '×' + H + '）');
} else {
  console.log('预览：' + W + '×' + H + '，' + png.length + ' 字节（加 --write 写盘）');
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const c = pixel(x, y);
      line += c[3] === 0 ? '.' : (c === FLAG ? 'R' : (c === PAPER || c === PAPER_DARK ? 'e'
        : (c === POLE ? '|' : '#')));
    }
    console.log('  ' + line);
  }
}
