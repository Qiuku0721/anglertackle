// ============================================================================
//  sprites32.js -- 32×32 高清贴图（按用户提供的实拍照片绘制）
//
//  为什么用 32×32：16×16 只有 256 个像素，画不出真实物体的曲线和明暗。
//  32×32 有 1024 个像素，配合 paint.js 的绘图 API（直线/圆弧/椭圆/多边形），
//  可以把照片里的轮廓和光影如实还原。
//
//  MC 对物品贴图没有硬性尺寸限制（原版盾牌就是 32×32），所以 32×32 安全。
// ============================================================================

const { Canvas } = require('./paint.js');

// ---------------------------------------------------------------- 调色板
// 全部取自用户提供的实拍照片（钩子=不锈钢冷灰，鲫鱼=橄榄褐背+米黄腹）
const C = {
  // 金属（钩子）
  STEEL_HI: '#F5F7F8',   // 高光（照片里最亮的反光）
  STEEL_LT: '#D2D6DA',
  STEEL: '#A8AEB4',      // 中间调
  STEEL_DK: '#7C8288',
  STEEL_DP: '#565A5F',   // 暗部
  BLACK: '#1A1A1A',      // 描边

  // 鱼身（鲫鱼照片取色）
  BACK_DK: '#5A5C38',    // 背部最深（橄榄褐）
  BACK: '#7E7F4C',       // 背
  SCALE: '#B4B282',      // 鳞片中间调（金橄榄）
  SCALE_LT: '#D8D2A0',   // 鳞片亮部
  BELLY: '#EDE6C8',      // 腹部米黄
  BELLY_LT: '#F7F3DE',   // 腹部最亮
  FIN: '#9C9A72',        // 鳍膜
  FIN_EDGE: '#C8C6A0',   // 鳍的外缘（更亮）
  FIN_DK: '#6E6C4E',
  EYE_RIM: '#E8E4C8',
  EYE: '#141414',

  // 竿身（玻纤，照片里是深棕红）
  BLANK: '#3E1F17',
  BLANK_LT: '#6B3A28',
  GRIP: '#1E1B19',
  GRIP_LT: '#3A3532',
};

/**
 * 钓鱼钩（严格按实拍照片）。
 *
 * 照片里的结构：
 *   · 顶端：扁平钩眼（细长的一条，几乎是个环）
 *   · 钩柄：很长，贴着右侧竖直向下
 *   · 底部：大半径圆弧，向左弯过去
 *   · 钩尖：从弧底向左上方伸出
 *   · 倒刺：钩尖背面一个小尖
 *
 * 实现要点：钩柄 + 弯 + 钩尖用**一条样条曲线**画完。
 * 之前分三段画（直线 + 圆弧 + 斜线），弧和斜线接不上，底部是断的。
 */
function drawHook(withBarb) {
  const cv = new Canvas(32, 32);

  // 关键点（从左下到右上依次是：钩尖 → 弯 → 钩柄）
  // 照片里的比例：窄而高，弯只占底部 1/4，钩尖伸到 2/3 高
  const spine = [
    [9, 8],     // 钩尖（左上方）
    [10, 16],   // 钩尖往下
    [12, 22],   // 开始入弯
    [15, 26],   // 弯底
    [19, 26],   // 弯的右侧
    [23, 20],   // 转弯向上
    [24, 16],   // 钩柄下段
    [24, 10],   // 钩柄中段
    [24, 7],    // 钩柄上端
  ];

  // Catmull-Rom 样条：保证曲线穿过所有关键点且平滑
  function spline(points, samples) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      for (let s = 0; s < samples; s++) {
        const t = s / samples;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, y]);
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  // ---- 1. 钩体主干（2px 粗，所以沿曲线左右各铺一格）----
  const curve = spline(spine, 24);
  for (const [x, y] of curve) {
    cv.set(x, y, C.STEEL);
    cv.set(x + 1, y, C.STEEL);
  }

  // ---- 2. 钩眼（顶端那个扁平环）----
  cv.arc(24, 4, 2.5, 2.0, 0, 360, C.STEEL);
  cv.set(24, 4, null);   // 中间掏空成环

  // ---- 3. 倒刺（照片里钩尖背面的小尖）----
  if (withBarb) {
    cv.line(11, 17, 14, 18, C.STEEL);
  }

  // ---- 4. 描边 + 金属明暗 ----
  cv.outline(C.BLACK);
  // 光源在左上：左上亮、右下暗（照片里钩子就是这种金属反光）
  cv.shade(C.STEEL, C.STEEL_HI, C.STEEL_DP, 12, 8);

  return cv;
}

/**
 * 鲫鱼（严格按实拍照片）。
 *
 * 照片里的结构：
 *   · 头朝左，眼睛大且靠前，嘴小
 *   · 身体是高椭圆（背比腹更拱）
 *   · 长背鳍，上缘带锯齿，从背部中间延伸到近尾
 *   · 尾鳍深分叉（上下两片）
 *   · 胸鳍/腹鳍/臀鳍
 *   · 背深橄榄褐 → 腹浅米黄
 */
function drawCrucianCarp() {
  const cv = new Canvas(32, 32);

  // 身体几何（改小一点，给尾鳍留出空间）
  const bodyCx = 11.5;
  const bodyCy = 17;
  const bodyRx = 8.5;
  const bodyRy = 6.5;
  // 身体右边缘 ≈ x = 20, 上边缘最低点 ≈ y = 10.5

  // ---- 1. 鱼身（高椭圆）----
  cv.ellipse(bodyCx, bodyCy, bodyRx, bodyRy, C.SCALE);

  // ---- 2. 背部更深（上半部分换深色）----
  cv.ellipse(bodyCx, bodyCy, bodyRx, bodyRy, C.BACK, -1.0, -0.30);
  cv.ellipse(bodyCx, bodyCy, bodyRx, bodyRy, C.BACK_DK, -1.0, -0.72);

  // ---- 3. 腹部更浅 ----
  cv.ellipse(bodyCx, bodyCy, bodyRx, bodyRy, C.BELLY, 0.45, 1.0);
  cv.ellipse(bodyCx, bodyCy, bodyRx, bodyRy, C.BELLY_LT, 0.78, 1.0);

  // ---- 4. 长背鳍（从背中延伸到近尾，上缘带棘）----
  const dorsalBaseY = bodyCy - bodyRy + 1;      // ≈ y=11.5
  cv.polygon([
    [6, dorsalBaseY + 1],
    [7, 4],          // 第一棘（最高）
    [10, 3],
    [13, 5],
    [16, 6],
    [18, 8],
    [19, dorsalBaseY + 2],
  ], C.FIN);
  for (const x of [8, 10, 12, 14, 16, 18]) {
    cv.line(x, 5, x, dorsalBaseY + 1, C.FIN_DK);
  }
  cv.line(7, 4, 10, 3, C.FIN_EDGE);
  cv.line(10, 3, 18, 8, C.FIN_EDGE);

  // ---- 5. 尾鳍（深分叉）----
  // 接点必须落在身体右边缘**外侧**：身体在 y=15~19 时右边缘约 x=19~20
  const tailRootX = 21;
  cv.polygon([
    [tailRootX, bodyCy - 3],    // 尾柄上方接身体（y=14）
    [30, bodyCy - 6],           // 上叉尖（y=11）
    [26, bodyCy - 1],           // 分叉凹口
    [30, bodyCy + 5],           // 下叉尖（y=22）
    [tailRootX, bodyCy + 3],    // 尾柄下方接身体（y=20）
    [25, bodyCy],               // 尾柄最窄处
  ], C.FIN);
  // 鳍条（放射状细线）
  for (const [x, y] of [[24, bodyCy - 2], [26, bodyCy - 3], [28, bodyCy - 4]]) {
    cv.line(23, bodyCy, x, y, C.FIN_DK);
  }
  for (const [x, y] of [[24, bodyCy + 2], [26, bodyCy + 3], [28, bodyCy + 4]]) {
    cv.line(23, bodyCy, x, y, C.FIN_DK);
  }

  // ---- 6. 胸鳍 / 腹鳍 / 臀鳍 ----
  cv.polygon([[7, bodyCy + 3], [5, bodyCy + 8], [10, bodyCy + 7]], C.FIN);      // 胸鳍
  cv.polygon([[10, bodyCy + 6], [9, bodyCy + 10], [13, bodyCy + 8]], C.FIN);    // 腹鳍
  cv.polygon([[17, bodyCy + 6], [17, bodyCy + 9], [21, bodyCy + 8]], C.FIN_DK); // 臀鳍

  // ---- 7. 头：眼睛 + 嘴 + 鳃盖 ----
  // 眼睛（大，靠前靠上）：浅色眼圈 + 黑瞳
  cv.ellipse(6.5, bodyCy - 2, 2.2, 2.2, C.EYE_RIM);
  cv.ellipse(6.5, bodyCy - 2, 1.2, 1.2, C.EYE);
  // 嘴（最左边，略上翘）
  cv.line(4, bodyCy + 1, 6, bodyCy + 2, C.BACK_DK);
  // 鳃盖（一条弧线）
  cv.arc(9.5, bodyCy, 3.0, 5.5, 110, 250, C.FIN_DK);

  // ---- 8. 鳞片纹理（照片里最显眼的特征）----
  // 用细密的短弧表现，不要画满，否则会糊
  for (let ry = -4; ry <= 4; ry += 2) {
    for (let rx = -6; rx <= 6; rx += 2) {
      const x = bodyCx + rx;
      const y = bodyCy + ry;
      if (Math.hypot(rx / bodyRx, ry / bodyRy) > 0.86) continue;
      cv.line(x, y, x + 1, y + 1, C.SCALE_LT);
    }
  }

  // ---- 9. 描边 ----
  // ⚠ 关键：只在**最后**整体描一次边。
  // 之前给每个部件（身体/背鳍/尾鳍）分别 outline，导致部件之间出现黑线，
  // 看起来像"尾鳍飘在身体外面"。
  cv.outline(C.BLACK);
  return cv;
}

module.exports = { drawHook, drawCrucianCarp, C };
