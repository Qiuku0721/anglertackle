/*
 * gen-effect-icons.js —— 画 11 个菜型效果的图标（18×18，明暗两张）。
 *
 * 为什么必须有：原版只按**注册名**去找 `textures/mob_effect/<id>.png`，
 * 找不到就在 HUD 上画一个紫黑格。11 项效果（docs/28）各有各的含义，
 * 所以自己画像素图 —— **不抄原版贴图**（那是 Mojang 的美术资源）。
 *
 * 画法：先在小画布上摆形状（点/线/圆/矩形），再整体放大到 18×18 的网格里；
 * 明暗两张的差别是"背景有没有描边"（原版 HUD 就是这么区分的：有剩余时间 = 亮底）。
 *
 * 用法：node tools/gen-effect-icons.js --write
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/mob_effect');

/** 18×18 画布；坐标 (x, y)，y 向下。 */
const S = 18;
const canvas = () => Array.from({ length: S }, () => new Array(S).fill(null));

const put = (c, x, y, col) => {
  if (x >= 0 && y >= 0 && x < S && y < S) c[y][x] = col;
};
const rect = (c, x0, y0, w, h, col) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(c, x, y, col);
};
const line = (c, x0, y0, x1, y1, col) => {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) {
    put(c, x, y, col);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
};
const disc = (c, cx, cy, r, col) => {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.4) put(c, x, y, col);
  }
};
/** 鱼形（简易轮廓）：朝右的小鱼/大鱼。 */
const fish = (c, x0, y0, w, h, col) => {
  rect(c, x0 + 2, y0 + 1, w - 3, h - 2, col);          // 身子
  // 尾巴（左侧三角）
  line(c, x0, y0, x0, y0 + h - 1, col);
  line(c, x0, y0, x0 + 1, y0 + Math.floor(h / 2), col);
  line(c, x0, y0 + h - 1, x0 + 1, y0 + Math.floor(h / 2), col);
  // 眼睛（挖空）
  put(c, x0 + w - 3, y0 + Math.floor(h / 2) - 1, null);
};

/** 11 张图：每张返回 [(x,y,color)]，颜色写 0xRRGGBB。 */
const ART = {
  // 渔运：金色鱼钩（J 形 + 倒刺）
  fishing_luck: (c) => {
    const gold = '#E8B33C', dark = '#8A6420';
    line(c, 12, 2, 12, 10, gold);
    line(c, 12, 10, 9, 13, gold);
    line(c, 9, 13, 6, 12, gold);
    line(c, 6, 12, 5, 9, gold);
    line(c, 13, 2, 9, 2, gold);
    for (const [x, y] of [[12, 2], [12, 10], [9, 13], [6, 12], [5, 9], [9, 2], [13, 2], [11, 3]]) {
      put(c, x, y, dark);
    }
    disc(c, 5, 7, 1, gold);               // 钩尖
  },
  // 强力：红弓 + 箭
  ranged_power: (c) => {
    const red = '#D8483C', wood = '#7A4A22', white = '#F0F0F0';
    line(c, 4, 3, 4, 14, wood);           // 弓背
    line(c, 4, 3, 9, 5, wood);
    line(c, 4, 14, 9, 12, wood);
    line(c, 9, 5, 9, 12, white);          // 弦
    line(c, 8, 9, 15, 9, red);            // 箭杆
    line(c, 15, 9, 13, 7, red);
    line(c, 15, 9, 13, 11, red);
  },
  // 海洋亲和：三道浪
  ocean_affinity: (c) => {
    const blue = '#2E7BC4', light = '#7EC4F0';
    for (const y of [5, 9, 13]) {
      line(c, 2, y, 5, y - 2, light);
      line(c, 5, y - 2, 9, y, light);
      line(c, 9, y, 12, y - 2, light);
      line(c, 12, y - 2, 15, y, blue);
    }
    disc(c, 2, 5, 1, blue);
  },
  // 两栖：上半陆地（草）+ 下半水（波纹），中间一只脚印跨在分界线上
  amphibious: (c) => {
    const land = '#5E8C34', land2 = '#7AB04A', water = '#2E8FA8', wave = '#7ED0E0', foot = '#F0E0B0';
    rect(c, 1, 1, 16, 8, land);
    rect(c, 1, 1, 16, 2, land2);
    rect(c, 1, 9, 16, 8, water);
    line(c, 2, 12, 5, 10, wave); line(c, 5, 10, 8, 12, wave);
    line(c, 10, 12, 13, 10, wave); line(c, 13, 10, 16, 12, wave);
    disc(c, 9, 9, 2, foot);                     // 脚印主体（压在水陆分界上）
    put(c, 6, 8, foot); put(c, 12, 8, foot);    // 两趾
    put(c, 7, 6, foot); put(c, 11, 6, foot);
  },
  // 明目：黄色宝石 + 四条射线
  ore_sight: (c) => {
    const gold = '#F0D040', dark = '#9A7A18';
    disc(c, 9, 9, 3, gold);
    line(c, 7, 9, 11, 9, dark);
    line(c, 9, 7, 9, 11, dark);
    for (const [x, y] of [[9, 2], [9, 16], [2, 9], [16, 9], [4, 4], [14, 4], [4, 14], [14, 14]]) {
      put(c, x, y, gold);
    }
  },
  // 风暴行者：乌云 + 闪电
  storm_walker: (c) => {
    const cloud = '#5A6A8A', bolt = '#FFE24A', rain = '#8FA8D8';
    disc(c, 6, 6, 3, cloud); disc(c, 10, 5, 3, cloud); disc(c, 13, 7, 2, cloud);
    rect(c, 3, 6, 12, 3, cloud);
    line(c, 10, 9, 7, 13, bolt); line(c, 7, 13, 10, 13, bolt); line(c, 10, 13, 8, 17, bolt);
    put(c, 4, 12, rain); put(c, 5, 15, rain);
  },
  // 干旱耐受：太阳
  drought_tolerance: (c) => {
    const sun = '#E08A2C', ray = '#F8C868';
    disc(c, 9, 9, 4, sun);
    for (const [x, y] of [[9, 1], [9, 17], [1, 9], [17, 9], [3, 3], [15, 3], [3, 15], [15, 15]]) {
      put(c, x, y, ray);
    }
    disc(c, 9, 9, 2, '#FFE0A0');
  },
  // 如鱼得水：绿心 + 心跳线
  vitality: (c) => {
    const green = '#4CB05A', light = '#A8E0A8';
    disc(c, 6, 6, 3, green); disc(c, 12, 6, 3, green);
    for (let y = 6; y <= 14; y++) {
      const w = 6 - Math.abs(y - 6);
      rect(c, 9 - w, y, w * 2, 1, y > 10 ? light : green);
    }
    line(c, 4, 10, 7, 10, '#FFFFFF'); line(c, 7, 10, 8, 8, '#FFFFFF');
    line(c, 8, 8, 10, 13, '#FFFFFF'); line(c, 10, 13, 11, 10, '#FFFFFF');
    line(c, 11, 10, 14, 10, '#FFFFFF');
  },
  // 爆口：大鱼（张嘴）—— 身子 + 左侧尾 + 右侧张开的嘴（别把嘴画太大，否则整条鱼糊成一坨）
  big_bite: (c) => {
    const body = '#8A4FD8', fin = '#C0A0F0', dark = '#2A1040';
    rect(c, 4, 5, 9, 8, body);                 // 身子
    line(c, 4, 5, 1, 3, body);                 // 上尾
    line(c, 1, 3, 1, 14, body);
    line(c, 1, 14, 4, 12, body);               // 下尾
    line(c, 4, 6, 2, 4, fin);
    rect(c, 13, 6, 3, 2, dark);                // 上颚
    rect(c, 13, 10, 3, 2, dark);               // 下颚
    rect(c, 13, 8, 2, 2, body);                // 嘴里的舌
    put(c, 10, 7, '#FFFFFF');                  // 眼
  },
  // 空军：小鱼群
  small_fry: (c) => {
    const body = '#6FC7E8', fin = '#B8E8F8';
    fish(c, 2, 3, 6, 5, body);
    fish(c, 10, 4, 6, 5, fin);
    fish(c, 5, 10, 7, 6, body);
    put(c, 8, 8, fin); put(c, 9, 8, fin);
  },
  // 巨物猎手：鱼钩 + 向上的箭头（拉得快）
  giant_hunter: (c) => {
    const red = '#A03030', dark = '#F0A0A0';
    line(c, 4, 15, 4, 6, dark); line(c, 4, 6, 7, 3, dark);
    line(c, 4, 15, 8, 15, red); line(c, 8, 15, 11, 12, red);
    line(c, 8, 15, 8, 9, red);
    line(c, 14, 15, 14, 6, dark); line(c, 14, 6, 11, 9, dark); line(c, 14, 6, 17, 9, dark);
  },
};

// ---------------------------------------------------------------- PNG 输出
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3];
    }
  }
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** 把画布渲染成 RGBA，outline=true 时给所有不透明像素加一圈深色描边（HUD 的"亮底"版）。 */
function render(c, outline) {
  const px = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const col = c[y][x];
      const i = (y * S + x) * 4;
      if (col) {
        const [r, g, b] = hex(col);
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      } else if (outline) {
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < S && ny < S && c[ny][nx];
        });
        const [r, g, b] = near ? [30, 30, 40] : [0, 0, 0];
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = near ? 200 : 0;
      }
    }
  }
  return px;
}

const write = process.argv.includes('--write');
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [id, draw] of Object.entries(ART)) {
  const c = canvas();
  draw(c);
  if (!write) { console.log('  预览 ' + id); continue; }
  writePng(path.join(OUT, id + '.png'), S, S, render(c, false));
  n++;
}
console.log(write ? ('写出 ' + n + ' 张到 ' + path.relative(ROOT, OUT).replace(/\\/g, '/')) : '（预览模式，加 --write 写入）');
