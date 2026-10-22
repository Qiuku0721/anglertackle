/*
 * gen-cookbook-icon.js —— 画【菜谱】的物品贴图（16×16 逻辑像素，导出 64×64）。
 *
 * ── 为什么从 guide_book.png 派生，而不是从零画一本 ────────────────
 * 三本书（教程书 / 图鉴 / 菜谱）在物品栏里是**并排**摆着的（创造页签里挨着放），
 * 所以它们必须一眼看出"是同一套书、但内容不同"：剪影与开本完全一致，靠**封面色 + 封面徽记**区分。
 * 从零画第二本几乎必然会画出不同的开本比例，摆在一起就露馅。
 * 做法：读 guide_book.png 的 16×16 逻辑像素 → 换一套"菜谱"配色 → 把封面中央的
 * 徽记（原本是蓝方块）换成**一条鱼** → ×4 放大成 64×64。
 *
 * ── 配色来自哪 ────────────────────────────────────────────
 * 保持本模组既有的两条约束（见 gen-kitchen-icons.js 的头部注释）：
 * 近黑暖描边（#1A1611，不是纯黑）、每个面 2~3 段明暗、不用渐变。
 * 封面用砖红（食谱书的直觉色），内页用暖白（纸），鱼用砖红 + 暖白眼睛。
 *
 * 用法：node tools/gen-cookbook-icon.js [--review]
 *   默认写 src/main/resources/assets/anglertackle/textures/item/cookbook.png
 *   --review 额外在 参考资料/物品贴图/ 出一张 8 倍放大对照图
 */
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item/guide_book.png');
const OUT = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item/cookbook.png');
const REVIEW = path.join(ROOT, '参考资料', '物品贴图');
const REVIEW_MODE = process.argv.includes('--review');

/** 教程书那套配色 → 菜谱那套配色（键是小写十六进制，与 decodePng 的输出对齐）。 */
const PALETTE = {
  '#1a1a1a': '#1a1611',   // 描边：换成模组统一的暖黑
  '#3b2a17': '#3a1410',   // 封面顶沿
  '#5c4525': '#5e2018',   // 封面内框
  '#9c7a4a': '#b0432f',   // 封面主色：棕 → 砖红
  '#e4e4e4': '#efe6d2',   // 内页纸：冷白 → 暖白
  '#5fa8e8': '#b0432f',   // 原徽记（蓝方块）：被下面的鱼覆盖，这里只是兜底
};

/**
 * 封面中央那条鱼：8×5 逻辑像素，纯剪影（不描边）—— 16px 下描边会把
 * 只有两行高的鱼身糊成一团黑，反而认不出是鱼。留白 + 实心色块最清楚。
 * 'o' = 鱼身，'e' = 眼睛，'.' = 内页底色。
 */
const FISH = [
  '...oo...',
  '..ooooo.',
  '.ooooeoo',
  '..ooooo.',
  '...oo...',
];
const FISH_COLORS = {
  'o': '#c0392b',   // 鱼身
  'e': '#efe6d2',   // 眼睛（暖白）
};
/** 鱼所在区域左上角的逻辑坐标。 */
const FISH_X = 4;
const FISH_Y = 5;
/** 封面上的"窗口"（徽记底板）：比基准图大一圈，好放下一条看得清的鱼。 */
const PANEL_X0 = 3;
const PANEL_Y0 = 3;
const PANEL_X1 = 12;
const PANEL_Y1 = 10;
const PAPER = '#efe6d2';
const LINE = '#1a1611';

function buildLogical() {
  const img = decodePng(fs.readFileSync(SRC));
  const scale = img.w / 16;
  if (!Number.isInteger(scale) || img.h !== img.w) {
    throw new Error('基准贴图不是 16 的整数倍正方形：' + img.w + '×' + img.h);
  }
  // ① 按逻辑像素取色 → 换色 → 存成 16×16 的色表
  const grid = [];
  for (let ly = 0; ly < 16; ly++) {
    const row = [];
    for (let lx = 0; lx < 16; lx++) {
      const i = ((ly * scale) * img.w + lx * scale) * 4;
      if (img.rgba[i + 3] < 24) { row.push(null); continue; }
      const key = '#' + [0, 1, 2].map((k) => img.rgba[i + k].toString(16).padStart(2, '0')).join('');
      const mapped = PALETTE[key];
      if (!mapped) throw new Error('基准贴图里出现了没登记的配色 ' + key + '（换了基准图就要更新 PALETTE）');
      row.push(mapped);
    }
    grid.push(row);
  }
  // ② 把封面上的"窗口"放大一圈（基准图那块只有 4×4，放不下一条看得清的鱼），
  //    再把鱼画进去 —— 三本书靠"封面色 + 徽记"区分，徽记必须一眼认得出
  for (let y = PANEL_Y0; y <= PANEL_Y1; y++) {
    for (let x = PANEL_X0; x <= PANEL_X1; x++) {
      grid[y][x] = (x === PANEL_X0 || x === PANEL_X1 || y === PANEL_Y0 || y === PANEL_Y1)
              ? LINE : PAPER;
    }
  }
  for (let y = 0; y < FISH.length; y++) {
    for (let x = 0; x < FISH[y].length; x++) {
      const ch = FISH[y][x];
      if (ch === '.') continue;
      const color = FISH_COLORS[ch];
      if (!color) throw new Error('鱼的字面图里有没登记的字符 ' + ch);
      grid[FISH_Y + y][FISH_X + x] = color;
    }
  }
  return grid;
}

function render(grid, scale) {
  const W = 16 * scale;
  const buf = Buffer.alloc(W * W * 4);
  for (let ly = 0; ly < 16; ly++) {
    for (let lx = 0; lx < 16; lx++) {
      const color = grid[ly][lx];
      if (!color) continue;
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const d = (((ly * scale + dy) * W) + (lx * scale + dx)) * 4;
          buf[d] = r; buf[d + 1] = g; buf[d + 2] = b; buf[d + 3] = 255;
        }
      }
    }
  }
  return { buf, W };
}

function ascii(grid) {
  const palette = [...new Set(grid.flat().filter(Boolean))];
  const chars = 'ABCDEFGH';
  let out = '    ' + Array.from({ length: 16 }, (_, i) => i % 10).join('') + '\n';
  for (let y = 0; y < 16; y++) {
    let line = String(y).padStart(3) + ' ';
    for (let x = 0; x < 16; x++) {
      line += grid[y][x] ? chars[palette.indexOf(grid[y][x])] : '.';
    }
    out += line + '\n';
  }
  return '用色 ' + palette.length + ' 种：' + palette.join(' ') + '\n' + out;
}

const grid = buildLogical();
const { buf, W } = render(grid, 4);
fs.writeFileSync(OUT, encodePng(W, W, buf));
console.log('写入 ' + path.relative(ROOT, OUT) + '  ' + W + '×' + W);
console.log(ascii(grid));

if (REVIEW_MODE) {
  const SC = 8, PAD = 12;
  const CW = 16 * SC;
  const sheetW = CW * 2 + PAD * 3;
  const sheetH = CW + PAD * 2;
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  for (let i = 0; i < sheetW * sheetH; i++) {
    sheet[i * 4] = 40; sheet[i * 4 + 1] = 44; sheet[i * 4 + 2] = 52; sheet[i * 4 + 3] = 255;
  }
  const paint = (g, ox) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const color = g[y][x];
      if (!color) continue;
      const r = parseInt(color.slice(1, 3), 16);
      const gg = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) {
        const d = (((PAD + y * SC + dy) * sheetW) + ox + x * SC + dx) * 4;
        sheet[d] = r; sheet[d + 1] = gg; sheet[d + 2] = b; sheet[d + 3] = 255;
      }
    }
  };
  // 左：基准（教程书），右：本次结果（菜谱）
  const base = decodePng(fs.readFileSync(SRC));
  const baseGrid = [];
  for (let ly = 0; ly < 16; ly++) {
    const row = [];
    for (let lx = 0; lx < 16; lx++) {
      const i = ((ly * 4) * base.w + lx * 4) * 4;
      row.push(base.rgba[i + 3] < 24 ? null
        : '#' + [0, 1, 2].map((k) => base.rgba[i + k].toString(16).padStart(2, '0')).join(''));
    }
    baseGrid.push(row);
  }
  paint(baseGrid, PAD);
  paint(grid, PAD * 2 + CW);
  fs.mkdirSync(REVIEW, { recursive: true });
  const out = path.join(REVIEW, '_对照_菜谱.png');
  fs.writeFileSync(out, encodePng(sheetW, sheetH, sheet));
  console.log('放大对照图（8×，左=教程书 右=菜谱）\n  ' + out);
}
