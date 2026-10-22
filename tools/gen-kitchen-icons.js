/*
 * gen-kitchen-icons.js —— 画"料理系统里参与配方的物品"贴图（调料 / 工具 / 油）。
 *
 * 见 docs/25 §3（调料清单）与 §8.5（要画的贴图清单）：
 *   盐 / 酱油 / 芥末 / 鱼油 / 鱼刀 —— 共 5 张。
 *
 * ── 风格从哪来 ────────────────────────────────────────────────
 * 不是照搬参考资料里那套"同色系最暗描边"（那是**食材块**的规格），
 * 而是**跟本模组已有的物品图标保持一致**：把 chum_grain / bait_worm / hemp_line /
 * plain_hook / codex_book 放大 8 倍量过 ——
 *   · 16×16，物件占 80~130 个不透明像素（不铺满，也不缩成一个小点）
 *   · **近黑描边**（#1A1611 一类的暖黑），不是纯黑 #000
 *   · 每个面 2~3 段明暗（亮部靠左上），不用渐变
 *   · 剪影优先：5 张的**外形语言各不相同**（方盒 / 高瓶 / 矮罐 / 圆瓶 / 斜刀），
 *     缩到 16px 也分得清 —— 这是这套图标最重要的约束
 *
 * 用法：node tools/gen-kitchen-icons.js [--review]
 *   默认**只写进** src/main/resources/assets/anglertackle/textures/item/
 *   --review 额外在 参考资料/物品贴图/ 出一张 8 倍放大对照图（给用户审阅用）
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./paint.js');
const { encodePng, decodePng } = require('./image-to-sprite.js');

const ROOT = path.resolve(__dirname, '..');
const TEX = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const REVIEW = path.join(ROOT, '参考资料', '物品贴图');
const REVIEW_MODE = process.argv.includes('--review');

// 本模组物品图标的描边色（比纯黑暖，和已有图标一致）
const LINE = '#1A1611';

// ---------------------------------------------------------------- 盐：木盐盒
// 为什么不做成"一堆白粉"：原版**糖**就是一堆白粉，盐再画成白粉玩家分不出。
// 木盒 + 掀盖 + 粗盐粒，靠"容器"把两者区分开，也符合现实里的盐罐。
function drawSalt() {
  const c = new Canvas(16, 16);
  const wood = { base: '#B98A4E', light: '#D8B274', dark: '#8A6234' };
  // 盒身
  c.polygon([[3, 7], [12, 7], [12, 13], [3, 13]], wood.base);
  c.shade(wood.base, wood.light, wood.dark, 4, 8);
  // 盒口：一条暗色内沿，让"开着盖"看得出来
  c.rect(4, 7, 8, 1, '#5E4020');
  // 盒身木纹：一道横线，避免大块纯色
  for (let x = 4; x <= 11; x++) if (c.get(x, 11) === wood.base) c.set(x, 11, wood.dark);
  // 盐堆（露在盒口上方）：不规则的小丘 + 几粒粗盐（不然放大看就是一朵白云）
  c.polygon([[4, 7], [4, 5], [6, 3], [9, 3], [11, 5], [11, 7]], '#F2F0E8');
  c.shade('#F2F0E8', '#FFFFFF', '#CFCBC0', 6, 4);
  c.set(6, 4, '#FFFFFF');
  c.set(8, 3, '#FFFFFF');
  c.set(6, 6, '#D8D4C8');
  c.set(8, 5, '#D8D4C8');
  c.set(9, 6, '#D8D4C8');
  c.outline(LINE);
  return c;
}

// ---------------------------------------------------------------- 酱油：深色高瓶
function drawSoySauce() {
  const c = new Canvas(16, 16);
  const glass = '#3A2010';       // 深色玻璃里的酱油
  // 瓶身
  c.polygon([[4, 7], [11, 7], [11, 14], [4, 14]], glass);
  c.shade(glass, '#6A3A1E', '#20100A', 4, 8);
  // 瓶颈 + 肩
  c.polygon([[6, 4], [9, 4], [9, 7], [6, 7]], glass);
  c.shade(glass, '#6A3A1E', '#20100A', 6, 5);
  // 左侧玻璃反光：一条竖亮线（玻璃瓶最关键的特征）
  for (let y = 8; y <= 13; y++) c.set(5, y, '#8A5A34');
  for (let y = 5; y <= 6; y++) c.set(7, y, '#8A5A34');
  // 标签：米色纸 + 一道深色"字"
  c.rect(5, 9, 6, 3, '#E2D4AE');
  for (let x = 6; x <= 9; x++) c.set(x, 10, '#6E4A24');
  c.set(5, 9, '#F4EAD0');
  // 软木塞
  c.rect(6, 2, 3, 2, '#C9A46A');
  c.set(6, 2, '#E0C08E');
  c.rect(6, 1, 3, 1, '#A8845019');   // 顶面
  c.rect(6, 1, 3, 1, '#A88450');
  c.outline(LINE);
  return c;
}

// ---------------------------------------------------------------- 芥末：矮罐
// 黄绿膏体是"芥末"最强的识别特征（原版里没有别的东西是这个色）；
// 罐子故意画**矮**，和高瓶酱油、圆瓶鱼油在外形上就分得开。
function drawMustard() {
  const c = new Canvas(16, 16);
  // 玻璃罐身
  c.polygon([[3, 8], [12, 8], [12, 14], [3, 14]], '#BFCBCE');
  c.shade('#BFCBCE', '#E4ECEE', '#8E9C9F', 4, 9);
  // 罐里的芥末膏：顶面**拱起来**（像抹满的酱），不是一块方砖
  c.rect(4, 11, 8, 2, '#D8C63A');
  c.rect(5, 10, 6, 1, '#EFE27A');
  c.rect(4, 13, 8, 1, '#A8921E');
  c.set(6, 12, '#8A7A14');
  c.set(9, 11, '#8A7A14');
  // 玻璃上的一小道反光
  c.set(4, 9, '#FFFFFF');
  // 盖子：木塞式一圈深色
  c.rect(3, 7, 10, 2, '#B08A3A');
  c.rect(3, 7, 10, 1, '#D8B45E');
  c.rect(3, 8, 10, 1, '#7A5A20');
  c.outline(LINE);
  return c;
}

// ---------------------------------------------------------------- 鱼油：圆瓶 + 鱼标
function drawFishOil() {
  const c = new Canvas(16, 16);
  // 瓶颈
  c.polygon([[6, 5], [9, 5], [9, 8], [6, 8]], '#C2CED0');
  c.shade('#C2CED0', '#E8F0F2', '#8E9C9F', 6, 6);
  // 瓶身（圆肚）
  c.ellipse(7.5, 11, 4.4, 3.6, '#C2CED0');
  c.shade('#C2CED0', '#E8F0F2', '#8E9C9F', 4, 9);
  // 里面的油：金黄（明暗差拉小一点，油里那点图形才不会被糊掉）
  c.ellipse(7.5, 11.4, 3.4, 2.6, '#EFC24A');
  c.shade('#EFC24A', '#FBE08C', '#B8860E', 5, 10);
  // 油里的**奶白色小鱼**（一眼看出是"鱼"油，不是蜂蜜/植物油）。
  // ⚠ 第一版画的是"深色剪影"，放大一看就是一坨黑斑 —— 深色在深色油里读不出来，
  //   改成**浅色图形压在金色上**，对比度才够（16×16 里图形只有 5×3 px）。
  for (let x = 5; x <= 9; x++) if (c.get(x, 11) !== null) c.set(x, 11, '#F6EEDA');
  c.set(4, 10, '#F6EEDA');
  c.set(4, 12, '#F6EEDA');
  c.set(6, 10, '#F6EEDA');
  c.set(8, 11, '#EFC24A');   // 眼睛：挖一个油色的小孔
  // 软木塞
  c.rect(6, 3, 3, 2, '#C9A46A');
  c.set(6, 3, '#E0C08E');
  c.rect(6, 2, 3, 1, '#A88450');
  c.outline(LINE);
  return c;
}

// ---------------------------------------------------------------- 鱼刀：斜放的刀
// 用户 2026-10-03 定的配方是"铁锭 + 任意木头按钮 + 木棍"，
// 所以刀柄末端**画一个圆钮**（按钮），让贴图和配方对得上。
function drawFishKnife() {
  const c = new Canvas(16, 16);
  // 刀刃：斜向的楔形 —— 刀尖在左上 (2,3)，刀根在右下 (9,9)；
  // 上缘是**刀背**（直），下缘是**刃口**（收成一条细边）
  c.polygon([[2, 3], [5, 2], [10, 7], [9, 9], [3, 4]], '#C8CED4');
  c.shade('#C8CED4', '#EDF1F4', '#8A9298', 3, 3);
  // 刀背高光：只点 3 个像素，多了刀刃会糊成一团白
  c.set(4, 3, '#FFFFFF');
  c.set(6, 4, '#FFFFFF');
  c.set(8, 6, '#FFFFFF');
  // 刀柄：木色，从刀根往右下
  c.thickLine(10, 9, 13, 12, 3, '#8A5A2E');
  c.set(10, 9, '#B07A44');
  c.set(11, 10, '#B07A44');
  c.set(12, 11, '#5E3A1A');
  c.set(13, 12, '#5E3A1A');
  // 柄末的圆钮（配方里的"木头按钮"）
  c.ellipse(13.4, 13.2, 1.6, 1.6, '#B07A44');
  c.set(12, 12, '#D8A868');
  c.outline(LINE);
  return c;
}

// ---------------------------------------------------------------- 输出
const ITEMS = [
  ['salt', drawSalt, '盐'],
  ['soy_sauce', drawSoySauce, '酱油'],
  ['mustard', drawMustard, '芥末'],
  ['fish_oil', drawFishOil, '鱼油'],
  ['fish_knife', drawFishKnife, '鱼刀'],
];

const toRgba = (canvas) => {
  const buf = Buffer.alloc(canvas.w * canvas.h * 4);
  for (let i = 0; i < canvas.w * canvas.h; i++) {
    const col = canvas.px[i];
    if (!col) continue;
    buf[i * 4] = parseInt(col.slice(1, 3), 16);
    buf[i * 4 + 1] = parseInt(col.slice(3, 5), 16);
    buf[i * 4 + 2] = parseInt(col.slice(5, 7), 16);
    buf[i * 4 + 3] = 255;
  }
  return buf;
};
const stats = (c) => {
  let opaque = 0; const colors = new Set();
  for (const p of c.px) { if (p) { opaque++; colors.add(p); } }
  return { opaque, colors: colors.size };
};

fs.mkdirSync(TEX, { recursive: true });
console.log('=== 料理物品贴图（调料 / 工具 / 油）===\n');
const made = [];
let bad = 0;
for (const [id, draw, zh] of ITEMS) {
  const c = draw();
  const s = stats(c);
  fs.writeFileSync(path.join(TEX, id + '.png'), encodePng(c.w, c.h, toRgba(c)));
  made.push({ id, zh, canvas: c, ...s });
  const okSize = s.opaque >= 70 && s.opaque <= 140;
  const okColors = s.colors >= 5 && s.colors <= 20;
  if (!okSize || !okColors) bad++;
  console.log('  ' + (id + '.png').padEnd(16) + zh + '  不透明 ' + String(s.opaque).padStart(3)
    + ' px（规格 70~140 ' + (okSize ? '✓' : '✗') + '）  用色 ' + String(s.colors).padStart(2)
    + '（规格 5~20 ' + (okColors ? '✓' : '✗') + '）');
}
console.log('\n写入 ' + path.relative(ROOT, TEX));

// ---------------------------------------------------------------- 审阅用放大图
if (REVIEW_MODE) {
  const SC = 8, COLS = 5, pad = 8;
  const CW = 16 * SC, CH = 16 * SC;
  const W = COLS * CW + (COLS + 1) * pad, H = CH + 2 * pad;
  const sheet = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 40; sheet[i * 4 + 1] = 44; sheet[i * 4 + 2] = 52; sheet[i * 4 + 3] = 255; }
  made.forEach((m, i) => {
    const ox = pad + i * (CW + pad), oy = pad;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const col = m.canvas.px[y * 16 + x];
      if (!col) {                    // 透明处画棋盘格
        const chk = ((x >> 1) + (y >> 1)) & 1;
        for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) {
          const d = ((oy + y * SC + dy) * W + ox + x * SC + dx) * 4;
          const v = chk ? 70 : 52;
          sheet[d] = v; sheet[d + 1] = v; sheet[d + 2] = v + 6; sheet[d + 3] = 255;
        }
        continue;
      }
      const rr = parseInt(col.slice(1, 3), 16), gg = parseInt(col.slice(3, 5), 16), bb = parseInt(col.slice(5, 7), 16);
      for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) {
        const d = ((oy + y * SC + dy) * W + ox + x * SC + dx) * 4;
        sheet[d] = rr; sheet[d + 1] = gg; sheet[d + 2] = bb; sheet[d + 3] = 255;
      }
    }
  });
  fs.mkdirSync(REVIEW, { recursive: true });
  const out = path.join(REVIEW, '_对照_放大8倍.png');
  fs.writeFileSync(out, encodePng(W, H, sheet));
  console.log('放大对照图（8×，左→右：' + ITEMS.map((i) => i[2]).join(' / ') + '）\n  ' + out);
}

process.exitCode = bad === 0 ? 0 : 1;
