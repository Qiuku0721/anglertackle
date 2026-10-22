/*
 * gen-dish-icons.js —— 画"成品菜"贴图（16×16）。
 *
 * 规则（用户 2026-10-03）：清烤复用对应档位熟鱼块贴图，其余做法各出一张 → 共 12 张（蒲烧取消后）。
 *
 * ── 参照物（用户逐条指定的，但一律**不抄像素**）────────────────
 *   ① 森罗物语的**物品显示图**（`*_style_sashimi` 那 5 张是 3D 模型 UV 展开图，
 *      不能照着画；分辨脚本 build/_classify-ref.js）；
 *   ② 用户游戏内实拍（刺身 / 味噌汤 / 油泼鱼 / 黄花鱼 / 黄鱼汤 / 生鱼串…）；
 *   ③ **原版熟鱼贴图**（`minecraft:item/cooked_cod.png`，从
 *      `.gradle-home/caches/neoformruntime/artifacts/minecraft_1.21.1_client.jar` 取出看过）。
 *
 * ── 原版熟鱼教会我的（这是"鱼长什么样"的标准答案）──────────────
 *   · **一条斜放的整鱼**（头在左下、尾在右上），吃掉画布八成；
 *   · **黑方块眼**（2×2）—— 就这一笔让它一眼是鱼；
 *   · 背深、体色中、腹浅；尾柄收细后接**分叉尾鳍**；背鳍在上、胸鳍在下；
 *   · **没有描边**：靠自身的深色边缘定形（我前几版全靠外描边，所以像"块"）；
 *   · 生 → 熟只换调色板，形状一字不动。
 *
 * ── 五版血泪史（每条都是用户当场否掉之后总结的）────────────────
 *   v1 没有食欲 / 碗没画好 / 食材很奇怪一坨 → 褐色配色 + 梯形桶 + 无结构色块；
 *   v2 五道横纹，鱼块像三明治（整块按行分三段 + 上缘焦面 + 通长肌理线）；
 *   v3 比例错："人家也不会菜一坨比盘子大" → 菜比器皿还大；
 *   v4 器皿是主体了，但"食材不像食材"；
 *   v5（当前）**每道鱼菜都画一条鱼**（用原版的斜放整鱼解剖结构），
 *      做法靠调色板 + 器皿 + 点缀区分；刺身改成**摆盘成排**。
 *
 * ⚠ 16×16 里**不要用 sin/cos 扫曲线**画生物：扫出来是一团光滑色块，放大认不出。
 *   一律用**手摆像素图 + 最近邻旋转**。
 *
 * ⚠ 改这份文件请用编辑/写入工具，**不要用 PowerShell 的 Get-Content/Set-Content**：
 *   PS 5.1 会把没有 BOM 的 UTF-8 源文件按 GBK 解码，中文注释与**中文路径字符串**
 *   会被写坏（本仓库记录过这个坑，2026-10-03 又踩了一次，整份文件重写）。
 *
 * 用法：
 *   node tools/gen-dish-icons.js               # 出草案到 参考资料/菜品贴图/
 *   node tools/gen-dish-icons.js --install     # 同时写进 textures/item/（注册物品时才用）
 *   node tools/gen-dish-icons.js --review      # 额外出一张 8 倍放大对照图（带编号）
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./paint.js');
const { encodePng } = require('./image-to-sprite.js');

const ROOT = path.resolve(__dirname, '..');
const DRAFT = path.join(ROOT, '参考资料', '菜品贴图');
const TEX = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const INSTALL = process.argv.includes('--install');
const REVIEW = process.argv.includes('--review');

// 调色板：每个色族给 背(back) / 体(mid) / 腹(belly) / 尾(tail) 四档 + 点缀
const F = {
  // 熟鱼（清蒸 / 原版熟鳕鱼那一路）
  pale: { back: '#B49A78', mid: '#EBDCC2', belly: '#FFF8EA', tail: '#F2E4CE', fin: '#A08A66', eye: '#2E2418' },
  // 煎 / 炸
  gold: { back: '#C08028', mid: '#F0BA60', belly: '#FCE0A4', tail: '#F8D68C', fin: '#A86818', eye: '#3A2408' },
  // 熏
  smoke: { back: '#B87C38', mid: '#E8B474', belly: '#FBDCA8', tail: '#F2CE94', fin: '#96601F', eye: '#33200A' },
  // 炭烤
  char: { back: '#6E4A20', mid: '#A87A48', belly: '#D0A878', tail: '#BE9464', fin: '#4E3210', eye: '#20140A' },
  // 红烧（酱色裹身）
  braise: { back: '#7A3E10', mid: '#B8722C', belly: '#E0A050', tail: '#CE8C3C', fin: '#5E2C08', eye: '#2A1404' },
};
const P = {
  china: { base: '#EDEDE8', light: '#FFFFFF', dark: '#C4CAD4', inner: '#98A2AE' },
  wood: { base: '#D8AE72', light: '#F2D6A8', dark: '#A87A3C', inner: '#7A5420' },
  pot: { base: '#C08454', light: '#E4AE7C', dark: '#8A5424', inner: '#5E3410' },
  pan: { base: '#74767C', light: '#A2A4AC', dark: '#484A50', inner: '#2E3034' },
  tofu: { base: '#FFFDF4', light: '#FFFFFF', dark: '#E0DAC6' },
  amber: { base: '#F2C86A', light: '#FCE8A8', dark: '#C08A20' },
  cream: { base: '#FBF6EA', light: '#FFFFFF', dark: '#DCD2BC' },
  sashi: { base: '#F49A78', light: '#FFC8A8', dark: '#D06848', fat: '#FFF0E4' },
  green: '#7BC24A', greenL: '#A8E070', red: '#E04A2A',
  gingerL: '#F2DC8C', steam: '#E8F0E8', sesame: '#F8EED0',
};
const BAMBOO = '#D8B478';
const BAMBOO_D = '#96703C';

/**
 * **斜放的整鱼**（头在左下、尾在右上），照原版熟鱼的解剖结构自己摆的像素：
 *   B 背（深）/ M 体 / L 腹（浅）/ T 尾 / E 眼（黑方）/ F 鳍
 * 13×11，吃满画布；**不收描边**（靠 B/F 的深色边缘定形，这是原版的做法）。
 */
const FISH_MAP = [
  '.........TTT.',
  '.......TTTTT.',
  '......BBBBTT.',
  '.....BBBMMM..',
  '....BBBMMMM..',
  '...BBMMMMLL..',
  '..BBMMMMLLL..',
  '.BBMMMMLLLL..',
  'EBBMMMLLLL...',
  '.BMMMLLL.....',
  '..FF.F.......',
];

/** 把像素图盖到画布上（deg ≠ 0 时按最近邻旋转，仍是硬边像素）。 */
function stampMap(c, map, colors, cx, cy, deg = 0) {
  const h = map.length, w = map[0].length;
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - cx, dy = y - cy;
      const u = Math.round(dx * ca + dy * sa + (w - 1) / 2);
      const v = Math.round(-dx * sa + dy * ca + (h - 1) / 2);
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const ch = map[v][u];
      if (ch === '.') continue;
      c.set(x, y, colors[ch]);
    }
  }
}

/** 画一条鱼（默认 -20°，可以再斜一点）。 */
function fish(c, pal, cx, cy, deg) {
  stampMap(c, FISH_MAP, {
    B: pal.back, M: pal.mid, L: pal.belly, T: pal.tail, F: pal.fin, E: pal.eye,
  }, cx, cy, deg);
}

/**
 * **鱼块**（横切段）：一侧是深色鱼皮弧、中间两条浅色肌理、左上受光。
 * 用于"块状"的菜（鱼汤里的料、油炸块、慢炖）。
 */
const STEAK_MAP = [
  '.BBBB.',
  'BMMMMF',
  'BMMLMF',
  'BMLMMF',
  '.DDDD.',
];
function steak(c, x, y, pal) {
  stampMap(c, STEAK_MAP, {
    B: pal.fin || pal.back, M: pal.mid, L: pal.belly, F: pal.back, D: pal.back,
  }, x + 2.5, y + 2, 0);
}

function bowl(c, pal, broth, pieces, opts = {}) {
  const rimY = opts.rimY === undefined ? 7 : opts.rimY;
  const rx = opts.rx === undefined ? 7.0 : opts.rx;
  const bottom = opts.bottom === undefined ? 15 : opts.bottom;
  c.polygon([[7.5 - rx + 0.3, rimY], [7.5 + rx - 0.3, rimY], [7.5 + 3.8, bottom], [7.5 - 3.8, bottom]], pal.base);
  for (let y = rimY; y <= bottom + 1; y++) {
    const t = (y - rimY) / Math.max(1, bottom + 1 - rimY);
    const col = t < 0.34 ? pal.light : t < 0.78 ? pal.base : pal.dark;
    for (let x = 0; x < 16; x++) if (c.get(x, y) === pal.base) c.set(x, y, col);
  }
  c.ellipse(7.5, rimY, rx, 2.3, pal.light);
  c.ellipse(7.5, rimY + 0.3, rx - 1.3, 1.7, pal.inner);
  c.ellipse(7.5, rimY + 0.4, rx - 2.2, 1.4, broth.base);
  for (let x = Math.round(7.5 - rx + 2.4); x <= Math.round(7.5 + rx - 2.4); x++) {
    if (c.get(x, rimY) === broth.base) c.set(x, rimY, broth.light);
  }
  if (pieces) pieces();
  c.arc(7.5, rimY + 0.2, rx - 0.5, 2.2, 12, 168, pal.light, 1);
}

function plate(c, cy, rx, ry, pal = P.china) {
  c.ellipse(7.5, cy, rx, ry, pal.dark);
  c.ellipse(7.5, cy - 0.3, rx - 0.8, ry - 0.6, pal.base);
  c.ellipse(7.5, cy - 0.5, rx - 1.7, ry - 1.1, pal.light);
  c.set(Math.round(7.5 - rx + 1), Math.round(cy), pal.light);
}

function steam(c, x, y) {
  c.set(x, y, P.steam);
  c.set(x + 1, y - 2, P.steam);
  c.set(x - 1, y - 4, P.steam);
}

// ---------------------------------------------------------------- 1 熏鱼（木板上一条熏透的鱼）
function drawSmokedFish() {
  const c = new Canvas(16, 16);
  plate(c, 11.6, 7.0, 3.8, P.wood);
  fish(c, F.smoke, 7.5, 8.4, -18);
  c.set(4, 6, P.sesame); c.set(11, 12, P.sesame);
  return c;
}

// ---------------------------------------------------------------- 2 炭烤鱼（烤架上一条带烤痕的鱼）
function drawCharredFish() {
  const c = new Canvas(16, 16);
  plate(c, 11.6, 7.0, 3.8, P.wood);
  fish(c, F.char, 7.5, 8.4, -18);
  // 烤痕：三道斜杠压在鱼身上
  for (const [x0, y0] of [[4, 9], [7, 7], [10, 5]]) {
    for (let k = 0; k < 3; k++) {
      const x = x0 + k, y = y0 + k;
      if (c.get(x, y) !== null && c.get(x, y) !== P.wood.light && c.get(x, y) !== P.wood.base && c.get(x, y) !== P.wood.dark) {
        c.set(x, y, '#2A1A08');
      }
    }
  }
  return c;
}

// ---------------------------------------------------------------- 3 鱼汤（白瓷碗里浮着鱼块）
function drawFishSoup() {
  const c = new Canvas(16, 16);
  bowl(c, P.china, P.amber, () => {
    steak(c, 2, 5, F.pale);
    steak(c, 8, 6, F.pale);
    c.rect(6, 8, 2, 2, P.tofu.light);
    c.set(3, 9, P.green); c.set(12, 7, P.greenL); c.set(11, 9, P.green);
  });
  steam(c, 11, 4);
  return c;
}

// ---------------------------------------------------------------- 4 奶白鱼汤
function drawCreamySoup() {
  const c = new Canvas(16, 16);
  bowl(c, P.china, P.cream, () => {
    steak(c, 2, 5, F.pale);
    steak(c, 8, 6, F.pale);
    c.rect(6, 8, 2, 2, P.tofu.light);
    c.set(3, 9, P.greenL); c.set(12, 8, P.green);
  });
  steam(c, 11, 4);
  return c;
}

// ---------------------------------------------------------------- 5 慢炖鱼（土锅）
function drawFishStew() {
  const c = new Canvas(16, 16);
  c.rect(0, 8, 2, 3, P.pot.dark);
  c.rect(14, 8, 2, 3, P.pot.dark);
  c.rect(0, 8, 2, 1, P.pot.light);
  c.rect(14, 8, 2, 1, P.pot.light);
  bowl(c, P.pot, P.amber, () => {
    steak(c, 1, 5, F.braise);
    steak(c, 8, 5, F.braise);
    c.set(7, 7, P.gingerL); c.set(8, 8, P.gingerL);
    c.set(3, 9, P.green); c.set(12, 9, P.greenL);
  }, { rx: 6.6 });
  steam(c, 12, 4);
  return c;
}

// ---------------------------------------------------------------- 6 清蒸鱼
// 网上成品 + 实拍（油泼鱼）：整鱼 + 葱姜丝 + 一勺热油的亮面，盘沿露一圈
function drawSteamedFish() {
  const c = new Canvas(16, 16);
  plate(c, 12.0, 7.2, 3.8);
  c.ellipse(7.5, 10.6, 4.8, 1.4, P.china.dark);
  fish(c, F.pale, 7.5, 8.6, -16);
  for (const [x, y] of [[6, 6], [8, 5]]) if (c.get(x, y) === F.pale.mid) c.set(x, y, '#FFFFFF');
  c.set(4, 9, P.gingerL); c.set(10, 7, P.gingerL);
  c.set(5, 10, P.green); c.set(11, 9, P.greenL);
  c.set(9, 4, P.red);
  steam(c, 12, 4);
  return c;
}

// ---------------------------------------------------------------- 7 红烧鱼（酱色裹身 + 盘里一圈亮汁）
function drawBraisedFish() {
  const c = new Canvas(16, 16);
  plate(c, 12.0, 7.2, 3.8);
  c.ellipse(7.5, 11.6, 5.4, 2.6, '#7A3E10');
  c.ellipse(7.5, 11.4, 4.4, 1.8, '#A85E1C');
  for (const [x, y] of [[5, 11], [6, 11], [9, 12], [10, 12]]) c.set(x, y, '#F8DCA8');
  fish(c, F.braise, 7.5, 8.4, -16);
  c.set(4, 9, P.greenL); c.set(11, 10, P.green); c.set(10, 5, P.red);
  return c;
}

// ---------------------------------------------------------------- 8 香煎鱼（铁锅里一条煎到金黄的鱼）
function drawPanFriedFish() {
  const c = new Canvas(16, 16);
  c.ellipse(7, 8.6, 7.0, 4.6, P.pan.base);
  c.ellipse(7, 8.4, 6.0, 3.8, P.pan.light);
  c.ellipse(7, 8.4, 5.3, 3.2, P.pan.inner);
  c.thickLine(13.4, 8.2, 15, 9.2, 2, P.pan.dark);
  fish(c, F.gold, 7, 8.2, -20);
  for (const [x, y] of [[5, 9], [8, 7]]) if (c.get(x, y) === F.gold.mid) c.set(x, y, F.gold.back);
  c.set(11, 10, P.green);
  return c;
}

// ---------------------------------------------------------------- 9 油炸鱼块（一盘带面包糠的炸鱼块）
function drawFriedChunks() {
  const c = new Canvas(16, 16);
  plate(c, 11.8, 6.8, 3.6, P.wood);
  steak(c, 1, 2, F.gold);
  steak(c, 8, 2, F.gold);
  steak(c, 4, 7, F.gold);
  steak(c, 10, 7, F.gold);
  for (const [x, y] of [[3, 3], [5, 4], [10, 3], [12, 4], [6, 8], [8, 9], [12, 8]]) {
    const cur = c.get(x, y);
    if (cur !== null && cur !== P.wood.base && cur !== P.wood.light && cur !== P.wood.dark && cur !== P.wood.inner) {
      c.set(x, y, P.sesame);
    }
  }
  return c;
}

// ---------------------------------------------------------------- 10 鱼丸（一碗清汤里浮着丸子）
function drawFishBalls() {
  const c = new Canvas(16, 16);
  bowl(c, P.china, P.cream, () => {
    for (const [x, y] of [[4, 6], [8, 5], [10, 8]]) {
      c.ellipse(x, y, 2.2, 2.2, P.tofu.base);
      c.set(x - 1, y - 1, '#FFFFFF'); c.set(x, y - 1, '#FFFFFF');
      c.set(x - 1, y + 1, P.tofu.dark); c.set(x + 1, y + 1, P.tofu.dark); c.set(x + 1, y, P.tofu.dark);
    }
    c.set(3, 9, P.green); c.set(12, 6, P.greenL);
  });
  steam(c, 11, 4);
  return c;
}

// ---------------------------------------------------------------- 11 整条油炸（竹签串起整条炸鱼）
function drawDeepFriedFish() {
  const c = new Canvas(16, 16);
  c.thickLine(0, 13, 15, 5, 1, BAMBOO);
  fish(c, F.gold, 7.5, 8.6, -22);
  for (const [x, y] of [[6, 5], [8, 4]]) if (c.get(x, y) === F.gold.mid) c.set(x, y, '#FFF3D4');
  c.set(12, 11, P.greenL); c.set(3, 6, P.red);
  return c;
}

// ---------------------------------------------------------------- 12 刺身（**摆盘成排**，学实拍的下界风味刺身）
function drawSashimi() {
  const c = new Canvas(16, 16);
  // 木盘
  plate(c, 11.0, 7.0, 4.0, P.wood);
  // 三片鱼片**并排斜放**（每片：粉身 + 白脂肪纹 + 上缘浅色），片与片之间留缝
  const slices = [[2, 6], [6, 5], [10, 6]];
  for (const [sx, sy] of slices) {
    c.polygon([[sx, sy + 4], [sx + 1, sy], [sx + 5, sy - 1], [sx + 6, sy + 3], [sx + 4, sy + 5], [sx + 1, sy + 5]], P.sashi.base);
    c.set(sx + 1, sy, P.sashi.light); c.set(sx + 2, sy, P.sashi.light);
    c.set(sx + 3, sy + 1, P.sashi.fat); c.set(sx + 2, sy + 3, P.sashi.fat);
    c.set(sx + 4, sy + 3, P.sashi.dark); c.set(sx + 5, sy + 2, P.sashi.dark);
  }
  c.set(8, 12, P.greenL);   // 垫底的紫苏/青菜
  c.set(14, 8, P.green);
  return c;
}

// ---------------------------------------------------------------- 13 蒲烧（竹签串三片刷亮酱的鱼排）
function drawKabayaki() {
  const c = new Canvas(16, 16);
  c.rect(7, 1, 2, 14, BAMBOO);
  c.rect(7, 1, 1, 14, '#EACB98');
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 4;
    c.polygon([[3, y], [12, y], [13, y + 1], [12, y + 3], [3, y + 3], [2, y + 1]], F.braise.mid);
    for (let x = 3; x <= 12; x++) {
      c.set(x, y, F.braise.back);
      if (c.get(x, y + 1) === F.braise.mid) c.set(x, y + 1, F.braise.belly);
      if (c.get(x, y + 3) === F.braise.mid) c.set(x, y + 3, F.braise.back);
    }
    c.set(5, y + 2, '#F8DCA8'); c.set(10, y + 2, '#F8DCA8');
    c.set(7, y, F.braise.fin); c.set(8, y, F.braise.fin);
    if (c.get(4, y + 2) !== null) c.set(4, y + 2, P.sesame);
  }
  c.set(7, 15, BAMBOO_D); c.set(8, 15, BAMBOO_D);
  return c;
}

// ---------------------------------------------------------------- 输出
const ITEMS = [
  ['smoked_fish', '熏鱼', drawSmokedFish],
  ['charred_fish', '炭烤鱼', drawCharredFish],
  ['fish_soup', '鱼汤', drawFishSoup],
  ['creamy_fish_soup', '奶白鱼汤', drawCreamySoup],
  ['fish_stew', '慢炖鱼', drawFishStew],
  ['steamed_fish', '清蒸鱼', drawSteamedFish],
  ['braised_fish', '红烧鱼', drawBraisedFish],
  ['pan_fried_fish', '香煎鱼', drawPanFriedFish],
  ['fried_fish_chunk', '油炸鱼块', drawFriedChunks],
  ['fish_ball', '鱼丸', drawFishBalls],
  ['deep_fried_fish', '整条油炸', drawDeepFriedFish],
  ['sashimi', '刺身', drawSashimi],
  // 蒲烧不做（用户 2026-10-03）—— 所以菜图是 12 张，不是 13
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
  for (const p of c.px) if (p) { opaque++; colors.add(p); }
  return { opaque, colors: colors.size };
};

fs.mkdirSync(DRAFT, { recursive: true });
if (INSTALL) fs.mkdirSync(TEX, { recursive: true });

console.log('=== 成品菜贴图（' + ITEMS.length + ' 张；清烤复用熟鱼块，不在其中）===\n');
console.log('v5：每道鱼菜画**一条斜放的整鱼**（照原版熟鱼的解剖结构自己摆像素，不收描边）');
console.log('    刺身改成摆盘成排；鱼块类用横切段（深色鱼皮弧 + 两道肌理）\n');
const made = [];
let suspect = 0;
for (const [id, zh, draw] of ITEMS) {
  const c = draw();
  const s = stats(c);
  let minX = 16, maxX = -1, minY = 16, maxY = -1;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!c.px[y * 16 + x]) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const box = Math.max(maxX - minX + 1, maxY - minY + 1);
  const buf = encodePng(c.w, c.h, toRgba(c));
  fs.writeFileSync(path.join(DRAFT, id + '.png'), buf);
  if (INSTALL) fs.writeFileSync(path.join(TEX, id + '.png'), buf);
  made.push({ id, zh, canvas: c, ...s });
  const okSize = s.opaque >= 90 && s.opaque <= 200;
  const okColors = s.colors >= 5 && s.colors <= 22;
  const okBox = box >= 12;
  if (!okSize || !okColors || !okBox) suspect++;
  console.log('  ' + (id + '.png').padEnd(22) + zh.padEnd(6)
    + ' 不透明 ' + String(s.opaque).padStart(3) + (okSize ? '✓' : '✗')
    + '  用色 ' + String(s.colors).padStart(2) + (okColors ? '✓' : '✗')
    + '  内容框 ' + String(box).padStart(2) + 'px' + (okBox ? '✓' : '✗'));
}
console.log('\n草案目录：' + path.relative(ROOT, DRAFT) + (INSTALL ? '（并已写进 textures/item/）' : ''));

// ---------------------------------------------------------------- 审阅图（带编号）
const DIGITS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
};
function stampDigit(buf, W, x0, y0, text, scale, color) {
  let cx = x0;
  for (const ch of String(text)) {
    const g = DIGITS[ch];
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 3; col++) {
        if (g[r][col] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const d = ((y0 + r * scale + dy) * W + cx + col * scale + dx) * 4;
            buf[d] = color[0]; buf[d + 1] = color[1]; buf[d + 2] = color[2]; buf[d + 3] = 255;
          }
        }
      }
    }
    cx += 4 * scale;
  }
}

if (REVIEW) {
  const SC = 8, COLS = 7, pad = 10, labelH = 16;
  const CW = 16 * SC, CH = 16 * SC + labelH;
  const rows = Math.ceil(made.length / COLS);
  const W = COLS * CW + (COLS + 1) * pad, H = rows * CH + (rows + 1) * pad;
  const sheet = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 40; sheet[i * 4 + 1] = 44; sheet[i * 4 + 2] = 52; sheet[i * 4 + 3] = 255; }
  made.forEach((m, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const ox = pad + col * (CW + pad), oy = pad + row * (CH + pad);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const px = m.canvas.px[y * 16 + x];
      if (!px) {
        const chk = ((x >> 1) + (y >> 1)) & 1;
        for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) {
          const d = ((oy + y * SC + dy) * W + ox + x * SC + dx) * 4;
          const v = chk ? 70 : 52;
          sheet[d] = v; sheet[d + 1] = v; sheet[d + 2] = v + 6; sheet[d + 3] = 255;
        }
        continue;
      }
      const rr = parseInt(px.slice(1, 3), 16), gg = parseInt(px.slice(3, 5), 16), bb = parseInt(px.slice(5, 7), 16);
      for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) {
        const d = ((oy + y * SC + dy) * W + ox + x * SC + dx) * 4;
        sheet[d] = rr; sheet[d + 1] = gg; sheet[d + 2] = bb; sheet[d + 3] = 255;
      }
    }
    stampDigit(sheet, W, ox + 2, oy + 16 * SC + 2, i + 1, 2, [230, 230, 236]);
  });
  const out = path.join(DRAFT, '_对照_放大8倍_带编号.png');
  fs.writeFileSync(out, encodePng(W, H, sheet));
  console.log('放大对照图（8×，编号 1~' + made.length + '，每行 ' + COLS + ' 张）\n  ' + out);
}

process.exitCode = suspect === 0 ? 0 : 1;
