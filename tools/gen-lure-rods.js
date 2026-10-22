// ============================================================================
//  gen-lure-rods.js -- 生成五档材质的路亚竿贴图（对角摆放 + 渔轮 + 摇柄）
//
//  为什么不直接用参考图缩：
//    参考图是 709x188、马赛克只有 2px，主体 294x65。要缩进画布必须缩到 0.22 倍，
//    而杆身本身只有 1~2 格宽 —— 缩放时大量采样点被跳过，结果是一条断断续续的虚线。
//    细长物体无法靠"缩照片"得到可用结果。
//
//  所以这里按参考图的**结构**重新绘制：
//    竿梢在左上、握把在右下（杆是"\"），渔轮装在握把上方一点点 = 杆的右下部分，
//    轮子外面伸一条和竿身垂直的斜条当摇柄。
//
//  用法: node tools/gen-lure-rods.js <输出目录>
//
//  ── 改过的两处，别再改回去 ────────────────────────────────────────────────
//  1. 渔轮位置（2026-10-01 用户："所有路亚竿的渔轮位置都不对，原版鱼竿的渔轮在
//     **杆的右下部分**"）。以前竿梢画在右上、渔轮却挂在竿梢那头（rt = 0.82），
//     轮子跑到了杆的上端。现在 rt = 0.22：刚好越过握把，正是真实鱼竿装轮座的地方。
//  2. **鱼线整段删掉**（2026-10-01 用户："你把鱼线部分删掉吧"）。
//     画布上不再有鱼线和鱼漂，只有竿 + 轮 + 摇柄。
// ============================================================================
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./paint.js');
const { encodePng } = require('./image-to-sprite.js');

const outDir = process.argv[2];

/** 各材质的配色：竿身主色 / 亮部 / 暗部 / 握把色 */
const MATERIALS = {
  wood:      { base: '#8a6a42', light: '#b08a58', dark: '#5c4529', grip: '#3b2b1a' },
  iron:      { base: '#9aa3ab', light: '#c6ced5', dark: '#69727a', grip: '#2f2a26' },
  gold:      { base: '#d8a832', light: '#f5d878', dark: '#9c7318', grip: '#3a2f14' },
  diamond:   { base: '#4fd6c8', light: '#9df3ea', dark: '#2a8f86', grip: '#1d3a38' },
  netherite: { base: '#5a4a52', light: '#8b7681', dark: '#332a30', grip: '#1a1418' },
};

/** 轮的通用色 */
const REEL_BODY = '#3a4048';
const REEL_LIGHT = '#79838d';
const REEL_DARK = '#22262b';

const SIZE = 64;

/**
 * 杆身三段宽度：直接写"到杆轴的 |x−y| 上限"（整数）。
 *
 * <p>杆轴是 45° 对角线，法线距离 d = 0.7071·(x−y)，所以 `|x−y| ≤ k` 恰好是一段
 * 宽 `2k+1` 像素的斜带 —— **只有奇数宽度可选**（1 / 3 / 5 / 7），这是像素网格的硬约束。
 * 想要"4 像素宽"必然得到两侧各差半像素的锯齿。
 *
 * <p>取值历史（用户 2026-10-01 四轮反馈）：
 * 细丝 → "看不出品质" → 三倍加粗（7 像素，太肥）→ "中段和后段太粗" → 收成 5/4/3 →
 * "有中空、而且肥" → **5 / 3 / 3** → 2026-10-02 "杆子显得有点细，希望加粗到杆捎5像素左右"
 * → **7 / 5 / 5**（竿梢正好 5 像素）。
 *
 * <p>想试别的宽度：ATL_LURE_K_REAR / ATL_LURE_K_MID / ATL_LURE_K_TIP 三个环境变量
 * 可以临时覆盖（只用于出对比图，别把它当成配置项 —— 检查器是按源码常量算的）。
 * 中段与竿梢同为 5 像素：64×64 上再细分只能靠 1 像素，竿梢会细到断线。
 */
const K_REAR = Number(process.env.ATL_LURE_K_REAR ?? 3);   // 握把：7 像素宽
const K_MID = Number(process.env.ATL_LURE_K_MID ?? 2);     // 中段：5 像素宽
const K_TIP = Number(process.env.ATL_LURE_K_TIP ?? 2);     // 竿梢：5 像素宽

/** 握把/中段的分界（沿杆长的比例，0=握把末端，1=竿梢）。 */
const GRIP_END = 0.20;
/** 中段/竿梢的分界。 */
const TIP_START = 0.60;

/**
 * 竿梢收尖。
 *
 * <p>用户 2026-10-02（附放大图）："需要做一下竿'尖'，现在像是平的。"
 * 原因是填色的截断条件 `t > 1` 让杆在 `x+y = 12` 那条**垂直端面**上齐刷刷断掉 ——
 * 45° 杆的端面正好是垂直于杆轴的直线，放大看就是一截被剪平的管子。
 *
 * <p>做法：最后这一小段让 `k` 从 `K_TIP` **线性收到 1**（不是收到 0）。
 * ⚠ 收到 0 会画成**虚线**：`|x−y| ≤ 0` 只留下 `x == y` 的像素，而 `x == y` 要求
 * `x+y` 是偶数 —— 于是奇数条对角线整条空掉，尖上出现 3 个互不相邻的孤立像素
 * （第一版就是这么写的，放大一眼就看出来了）。收到 1 时偶数条对角线 1 像素、
 * 奇数条 2 像素，交替前进、始终连在一起，端头就是一个真正的尖。
 *
 * <p>{@code TIP_TAPER_START = 0.94} 是刻意的：沿杆长比例 × 53√2 ≈ 75 像素，
 * 也就是**只有最后约 4.5 像素**收尖 —— 用户要的"竿梢 5 像素"在那之前都保持不变。
 *
 * <p>⚠ 收尖会把"最上-最左的不透明像素"往回收（`(7,5)` → `(6,6)`），
 * 也就是鱼线的锚点。改这里必须同步 {@code RodTipAnchor.LURE_TIP_PIXEL_X/Y}，
 * {@code check-line-anchor.js} 会从 PNG 重量一遍来核对。
 */
const TIP_TAPER_START = Number(process.env.ATL_LURE_TAPER ?? 0.94);
/** 杆轴两端：P0=握把端（右下），P1=竿梢端（左上）。两点都在 x==y 这条对角线上。 */
const P0 = [59, 59], P1 = [6, 6];

/** 沿杆的位置 t ∈ [0,1] → 该处的 |x−y| 上限（收尖段是小数）。 */
const kAt = (t) => {
  const base = t < GRIP_END ? K_REAR : t < TIP_START ? K_MID : K_TIP;
  if (t <= TIP_TAPER_START) return base;
  const u = Math.min(1, (t - TIP_TAPER_START) / (1 - TIP_TAPER_START));
  return base - (base - 1) * u;
};

/**
 * 导线环的位置（沿杆长比例），**只在渔轮那一侧**。
 *
 * <p>用户 2026-10-01 第四轮："现在杆身上有很多莫名凸起，我承认路亚有导线环，
 * 但只在渔轮那一侧的杆身上，另一侧理应是光滑的。"
 * 所以：导线环按**固定几个位置**画（不是每段都有），且只往左下侧凸；
 * 右上侧一条直线，完全光滑。
 */
const GUIDES = [0.28, 0.42, 0.56, 0.70, 0.84];

/**
 * 导线环的颜色。
 *
 * <p>⚠ 必须**不同于**渔轮的三个色（{@code #3a4048 / #79838d / #22262b}）：
 * {@code check-rod-icon-slant.js} 就是按这三个色找渔轮、再算它的重心与像素数的。
 * 用同一个色的话，沿杆分布的 15 个导线环像素会被算成"渔轮的一部分"，
 * 重心被拉到杆的中段 —— 那条"渔轮在右下"的断言就会以**错误的方式**红/绿。
 */
const GUIDE_COLOR = '#4a4a52';

/**
 * 画一根竿。
 *
 * @param {object} mat 材质配色
 */
function drawRod(mat) {
  const c = new Canvas(SIZE, SIZE);

  // ---------- 竿身：**按几何直接填像素** ----------
  //
  // 画法换过三次，每次的原因都记在这里，免得再绕回去：
  //   ① 最初：沿杆走 71 步，每步画一串**横截面采样点**（d 从 -half 到 +half 步长 0.5）。
  //      偏移量还写成了沿杆方向（不是法线），所以只把杆拉长、一格厚度都加不出来；
  //      方向修正之后两侧边缘又变成锯齿（相邻两步端点取整差 1 像素）。
  //   ② 上一版：改用 `c.line()` 画 3~5 条**平行线**。边缘不抖了，但 45° 下
  //      相邻两条线的像素阶梯互相错开，**中间留出透明缝**（空心管）——
  //      用户 2026-10-01："现在杆子有很多莫名中空……而且这种中空导致杆子肥大了"。
  //   ③ 现在：不画线，直接判"这个像素到杆轴的法线距离够不够近"。
  //      一次遍历填满，**结构上不可能有缝**；边缘是 |x−y| = k 的完美阶梯
  //      （法线距离 d 沿整条边恒定），天生光滑。
  //
  // 几何：杆轴是 x == y（P0、P1 都在对角线上），于是
  //   法线距离 d = 0.7071·(x − y)     （只跟 x−y 有关，与沿杆位置无关）
  //   沿杆位置 t = (P0[0] − (x+y)/2) / (P0[0] − P1[0])
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = (P0[0] - (x + y) / 2) / (P0[0] - P1[0]);
      if (t < 0 || t > 1) continue;
      const k = kAt(t);
      const off = x - y;                    // 越大越靠杆的右上侧
      if (Math.abs(off) > k) continue;
      const col = t < GRIP_END ? mat.grip
        : off >= k ? mat.light : off <= -k ? mat.dark : mat.base;
      c.set(x, y, col);
    }
  }

  // ---------- 导线环：**只在渔轮那一侧**（左下），固定几个位置 ----------
  // 每处就是从杆身下缘往外顶 3 像素的小突刺。
  //
  // ⚠ 用 `c.line()` 画**一条短线**，而不是点几个孤立像素：
  //   法线偏移换算成 (x−m/2, y+m/2) 之后再取整，两个孤立点会错开一格，
  //   中间留下 1 个透明像素 —— 那正是"真镂空"，用户放大就能看见（2026-10-01 踩过）。
  //   起点取杆身下缘（off = −k）本身，保证突刺与杆身连着。
  for (const t of GUIDES) {
    const ax = P0[0] + (P1[0] - P0[0]) * t;
    const ay = P0[1] + (P1[1] - P0[1]) * t;
    const k = kAt(t);
    c.line(Math.round(ax - k / 2), Math.round(ay + k / 2),
      Math.round(ax - (k + 3) / 2), Math.round(ay + (k + 3) / 2), GUIDE_COLOR);
  }

  // ---------- 渔轮：**挂在**握把与中段的交界处 ----------
  //
  // 用户 2026-10-01 第三轮反馈（附原版鱼竿图标作参考）：
  //   "渔轮应该是像挂在杆子握柄与中段交界处上一样，而不是安在中间"
  // 两个要点，缺一个都不像：
  //   ① 位置在**交界处**（t = GRIP_END），不是杆的中段；
  //   ② 轮心要从杆轴**沿法线偏移出去**（挂在下侧），而不是骑在杆身上 ——
  //      原版图标里那几个灰像素就在杆线的**左下方**，看着才像"装上去的"。
  // 偏移 5.0 配轮半径 5.6：轮子内侧越过杆轴 0.6 像素，所以是"贴住"而不是"飘开"。
  const REEL_OFFSET = 5.0;
  const jx = P0[0] + (P1[0] - P0[0]) * GRIP_END;
  const jy = P0[1] + (P1[1] - P0[1]) * GRIP_END;
  const rx = Math.round(jx - REEL_OFFSET * 0.7071);
  const ry = Math.round(jy + REEL_OFFSET * 0.7071);
  c.ellipse(rx, ry, 5.6, 5.6, REEL_DARK);    // 轮体外圈
  c.ellipse(rx, ry, 3.6, 3.6, REEL_LIGHT);   // 线杯
  c.set(rx, ry, REEL_DARK);                  // 轴心
  // 摇柄：一条**和竿身垂直**的斜条（竿身走"\"，所以摇柄走"/"）。
  // ⚠ 不能顺着竿身那个 45°：那样只会让杆看起来加粗了一段，读不出是摇柄。
  // 从轮缘外侧起画，免得和线杯糊成一团。
  for (let i = 0; i < 4; i++) c.set(rx - 6 - i, ry + 6 + i, REEL_DARK);

  // 金属箍：**已删除**（用户 2026-10-01 第三轮）。
  // 原来在 t=0.34（杆的**中段**）画了一道浅灰箍，它和渔轮都是灰的，
  // 玩家会把它读成"装在中段的渔轮" —— 正好是用户说的"安在中间"。
  // 附来的原版参考图上杆身是干净的、只有右下角一个灰轮子，所以整段去掉。
  //
  // 鱼线/鱼漂：**已按用户要求整段删除**（2026-10-01 第二轮）。
  // 想加回来的话，之前那版是"从竿梢垂下一小段 + 线末端两像素上白下红"。

  return c;
}

fs.mkdirSync(outDir, { recursive: true });
for (const [name, mat] of Object.entries(MATERIALS)) {
  const c = drawRod(mat);
  const { rows, palette } = c.toPaletteRows();
  // 用 image-to-sprite 的编码器写 PNG（它接受 RGBA Buffer）
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 这里**不做**任何镜像：drawRod 已经按最终朝向（竿梢左上、握把右下）画好了。
      // 上一版是"画成向右斜、写 PNG 时翻一下"，那种两套朝向的写法看不出对错 ——
      // 渔轮被翻到左上就是这么漏过去的。
      const ch = rows[y][x];
      const hex = palette[ch];
      const o = (y * SIZE + x) * 4;
      if (!hex) continue;
      rgba[o] = parseInt(hex.slice(1, 3), 16);
      rgba[o + 1] = parseInt(hex.slice(3, 5), 16);
      rgba[o + 2] = parseInt(hex.slice(5, 7), 16);
      rgba[o + 3] = 255;
    }
  }
  const file = path.join(outDir, name + '_lure_rod.png');
  fs.writeFileSync(file, encodePng(SIZE, SIZE, rgba));
  console.log('写出 ' + file);
}
