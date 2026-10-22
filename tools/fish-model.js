/*
 * fish-model.js —— 鱼的几何 + UV 图集排版的**唯一真源**。
 *
 * 谁在用：
 *   gen-fish-model.js    → 把排版结果写成 Java（ModFishModel 的部件定义、ModModelLayers、FishVariants）
 *   gen-fish-textures.js → 按排版结果逐部件、逐面地画贴图
 *   preview-fish.js      → 用同一套排版做离屏正交渲染，出 PNG 供人眼检查
 *   check-fish-appearance.js / check-fish-model.js → 校验
 *
 * ── 2026-10-01 大改：从"4 组共用"改成"每种鱼一套" ─────────────
 * 上一版是 4 组体型共用一层模型，组内差异只靠三轴缩放。用户的反馈是
 * 「模板套用很严重」「我看不出狗鱼与其他鱼的那种明显的外形区别」——
 * 缩放改不了形状，21 种鱼看着就是同一块方盒子换色。
 *
 * 现在：**每种鱼按自己的 shape 参数展开零件、独立装箱、独立烘一层模型**。
 * 代价只有 21 个小组网格（原版有几百个），换来的是每条鱼可以有
 * 自己的吻型、尾型、背鳍长度与位置、须、鳃裂、离鳍。
 * 贴图本来就是每种一张，所以 UV 布局本来就该跟着鱼走。
 *
 * ── MC 的 box UV 是怎么展开的（改几何前必须知道）────────────────
 * 一个 (dx,dy,dz) 的盒子占
 *     w = 2*dz + 2*dx,  h = dz + dy
 * 的一块矩形，里面 6 个面的位置由 ModelPart.Cube 的构造顺序固定
 * （见 _fishsrc/.../ModelPart.java 第 252~344 行）：
 *
 *   u0        u0+dz      u0+dz+dx  +dz        +dx
 *   ┌──────────┬──────────┐
 *   │  DOWN    │   UP     │              高 = dz
 *   ├──────────┼────┬─────┼────────────┐
 *   │  WEST    │NORTH│EAST │   SOUTH    │     高 = dy
 *   └──────────┴────┴─────┴────────────┘
 *      w=dz      w=dx  w=dz    w=dx
 *
 * 左上角 [u0,u0+dz]×[v0,v0+dz] 是空的（原版如此）。
 * 面的**朝向**（哪一边是头、哪一边是背）也是从那段代码反推的，见 facesOf 的注释。
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 供 tools/negtest.ps1 把检查器指向临时副本；不给就是仓库根目录。
// 用 __dirname 而不是 '.' —— 否则从别的 cwd 调用就会读错文件。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const DATA = path.join(ROOT, 'tools', 'fish-appearance.json');

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

// ---------------------------------------------------------------- 几何
const box = (x, y, z, dx, dy, dz) => ({ box: [x, y, z, dx, dy, dz] });
const at = (x, y, z, rx, ry, rz) => ({ at: [x, y, z], rot: [rx || 0, ry || 0, rz || 0] });
const R = Math.round;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 把「体型组默认值 + 该鱼的 shape 覆盖」展开成零件列表。
 *
 * shape 的每一项都有默认值（= 组的推导值），所以 JSON 里只写要改的那几项。
 * 参数含义与"为什么这么建模"逐条写在下面的注释里。
 */

/**
 * v1 风格的几何：整条鱼身一个长方体，鳍是单块。
 *
 * 用户 2026-10-01 实机验收后的原话：「除了我明确承认的鱼，其他改回第一版」。
 * v1 虽然不像真鱼，但**起码像一条鱼** —— 原因是它的体干是一个连续的长方体，
 * 没有分段带来的台阶。v3 把体干切成了 N 段去逼近真鱼轮廓，反而在若干种鱼上
 * 变成了"码起来的积木"。这条路径就是那个连续长方体。
 *
 * 与 v3 的唯一保留差异：尾鳍**绕体轴居中**。v3 的尾鳍整片长在轴上方
 * （用户："尾巴翘到天上去了"），那是 bug，不能不修。
 */
function buildPartsV1(g, shape) {
  const s = shape || {};
  const num = (v, d) => (v === undefined || v === null ? d : v);
  const W = g.W, H = g.H, Lb = g.Lb, Lh = g.Lh;
  const Ln = Math.max(1, R(num(s.snoutLen, g.Ln)));
  const Lt = Math.max(1, R(num(s.tailLen, g.Lt)));
  const tailH = Math.max(2, R(num(s.tailHeight, g.tailH)));
  const analH = 1;
  const y = 24 - H / 2 - analH;
  const top = y - H / 2;
  const bot = y + H / 2;

  const P = [];
  const add = (name, b, a, kind) => {
    const bb = b.box;
    P.push(Object.assign({ name, size: [bb[3], bb[4], bb[5]], kind: kind || 'body' }, b, a));
  };

  // —— 体干：**一整块**（v1 的关键）
  add('body', box(-W / 2, -H / 2, 0, W, H, Lb), at(0, y, 0));
  add('head', box(-W / 2, -H / 2, -Lh, W, H, Lh), at(0, y, 0), 'head');
  const Wn = Math.max(1, R(W * num(s.snoutWidth, 0.7)));
  const Hn = Math.max(1, R(H * num(s.snoutHeight, 0.6)));
  add('nose', box(-Wn / 2, -Hn / 2, -Ln, Wn, Hn, Ln), at(0, y, -Lh), 'head');

  // —— 背鳍 / 第二背鳍 / 脂鳍 / 臀鳍：都是单块
  const dl = Math.max(2, R(num(s.dorsalLen, g.dorsalLong)));
  const dh = Math.max(1, R(num(s.dorsalHeight, 1)));
  const dpos = num(s.dorsalPos, 0.42);
  add('dorsal', box(0, -dh, -R(dl / 2), 0, dh, dl), at(0, top, R(Lb * dpos)), 'fin');
  if (s.secondDorsal) {
    const dl2 = Math.max(2, R(num(s.secondDorsalLen, dl * 0.55)));
    add('dorsal2', box(0, -dh, -R(dl2 / 2), 0, dh, dl2),
      at(0, top, R(Lb * num(s.secondDorsalPos, 0.78))), 'fin');
  }
  if (s.adipose) add('adipose', box(0, -1, -1, 0, 1, 2), at(0, top, Lb - 2), 'fin');
  const al = Math.max(2, R(num(s.analLen, Lb * 0.28)));
  const ah = Math.max(1, R(num(s.analHeight, analH)));
  add('anal', box(0, 0, -R(al / 2), 0, ah, al), at(0, bot, R(Lb * num(s.analPos, 0.72))), 'fin');

  // —— 胸鳍：单块水平面（v1 的样子）
  const pectLen = Math.max(2, R(num(s.pectoralLen, W * 0.6) + 1));
  const pectW = Math.max(2, W);
  const pectY = R(H * num(s.pectoralDrop, 0.28));
  add('pectoral_r', box(-pectW, 0, -R(pectLen / 2), pectW, 0, pectLen),
    at(-W / 2, y + pectY, 0, 0, 0, -Math.PI / 4), 'fin');
  add('pectoral_l', box(0, 0, -R(pectLen / 2), pectW, 0, pectLen),
    at(W / 2, y + pectY, 0, 0, 0, Math.PI / 4), 'fin');

  // —— 尾鳍：单块（圆尾/截形）或两叶（叉尾），**绕体轴居中**
  const tailType = s.tailType || 'fork';
  if (tailType === 'round' || tailType === 'truncate') {
    add('tail_round', box(0, -R(tailH / 2), 0, 0, tailH, Lt), at(0, y, Lb), 'fin');
  } else if (s.tailNotch) {
    // 末端凹陷的尾鳍（罗非鱼）：两叶几乎不张开，中间留一道浅 V 口。
    // 用户原话："尾巴不应该长方形，做一个凹陷会很好"。
    const fh = Math.max(1, R(tailH * 0.55));
    const gap = Math.max(1, R(num(s.tailNotch, 1)));
    add('tail_fork_up', box(0, -fh, 0, 0, fh, Lt), at(0, y - gap - R(fh / 2), Lb, 0.10), 'fin');
    add('tail_fork_lo', box(0, 0, 0, 0, fh, Lt), at(0, y + gap + R(fh / 2), Lb, -0.10), 'fin');
  } else {
    const fh = Math.max(1, R(tailH * 0.6));
    add('tail_fork_up', box(0, -fh, 0, 0, fh, Lt), at(0, y - R(fh / 2), Lb, 0.30), 'fin');
    add('tail_fork_lo', box(0, 0, 0, 0, fh, Lt), at(0, y + R(fh / 2), Lb, -0.30), 'fin');
  }

  // —— 鳃裂 / 口须（保留，但须压到最短）
  const gillN = s.gillSlits || 0;
  for (let i = 0; i < gillN; i++) {
    add('gill_' + (i + 1), box(-W / 2 - 0.02, -1, -R(Lh * 0.25) - i, W + 0.04, 2, 1),
      at(0, y, 0), 'gill');
  }
  const bN = s.barbels || 0;
  const bLen = Math.max(1, R(num(s.barbelLen, 1)));
  for (let i = 0; i < bN; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    add('barbel_' + (i + 1), box(-0.25, 0, -bLen, 0.5, 0.5, bLen),
      at(side * Math.max(0.5, Wn * 0.4), y - 0.5 + Math.floor(i / 2), -Lh - Ln,
        num(s.barbelDroop, 1.0), -side * 0.3, 0), 'barbel');
  }
  return P;
}


/** 原版 SalmonModel 的拓扑（见本段上方的注释：这是逐值抄的，不要"顺手改好看点"）。 */
const SALMON = {
  LEN: 25,        // z = -3 .. 22
  HEIGHT: 5,      // y = 19 .. 24（含 +1.5 的抬升）
  Y: 21.5,        // 体轴
};

function buildPartsSalmon(g, shape) {
  const sh = shape || {};
  const P = [];
  // extra：第四个参数之外的附加字段（目前只有尾叶的贴图裁形表 cutRows/cutFrom）
  const add = (name, b, a, kind, extra) => {
    const bb = b.box;
    P.push(Object.assign({ name, size: [bb[3], bb[4], bb[5]], kind: kind || 'body' }, b, a, extra));
  };
  const Y = SALMON.Y;
  const PI4 = Math.PI / 4;

  add('body', box(-1.5, -2.5, 0, 3, 5, 8), at(0, Y, 0));
  add('body2', box(-1.5, -2.5, 0, 3, 5, 8), at(0, Y, 8));
  add('head', box(-1, -2, -3, 2, 4, 3), at(0, Y, 0), 'head');

  // 尾鳍：原版是一整片居中的板（这正是"不翘到天上、也不断断续续"的原因）
  // 尾鳍：**扇形**（3 片叠成），不是一块矩形平板。
  // 用户 2026-10-01：「我让你改形状啊」—— 之前几轮改的都是颜色，方向错了。
  // 尾鳍：**月牙形** —— 两片完整的叶子在尾柄处交汇，反向张开成 V。
  // ⚠ 每片必须是**一整块**；拆成多段会留缝，侧面看就是断断续续几块。
  // ★ 2026-10-08：这里原来**写死了新月尾**，压根不看 shape.tailType ✗ ——
  //   于是 `"tailType": "heterocercal"`（格陵兰鲨）也画成对称新月尾，玩家看到的
  //   是一条普通鱼的尾巴。用户原话："**前半部分真的很鲨鱼，就是后半也就是鱼尾处理不像**。"
  //   现在补一条**歪尾（heterocercal）**：上叶长而尖、近满高、仰角小；下叶短一截、
  //   俯角大 —— **绕体轴不对称**，鲨鱼的辨识度全在这。
  //   ⚠ 全表只有格陵兰鲨用 heterocercal（tools/fish-appearance.json），
  //     所以这条分支**不影响任何现有鱼** ✓；其余鱼种照旧走新月尾。
  if (sh.tailType === 'heterocercal' || sh.tailType === 'shark') {
    // 歪尾（鲨鱼）。两轮返工的结论（用户 2026-10-08 反馈"后半也就是鱼尾处理不像"）：
    //   ① 第一版用**一块旋转 0.36 的长方板**当上叶 → 渲染出来是"斜插上去的一块木板" ✗
    //   ② 第二版用**三段越靠后越高**的盒子 → 渲染出来是"阶梯砖墙" ✗，而且又高又厚
    //   这一版按**真实格陵兰鲨**来：它的尾鳍**小而低**，尾巴后面还有一段**收细的尾柄** ——
    //   身体在 z=16 处齐头截断、尾巴像另挂上去的，才是"不像"的真正来源。
    //   所以先补尾柄（kind='body' ⇒ 走体色渐变，bellyStop 也管得住它），再挂一片小歪尾。
    const tH = Number(sh.tailHeight || 4);
    const tL = Number(sh.tailLen || 5);
    // 尾叶：**两片长而薄的叶子**，从身体末端（z=16）斜着往后张开成 V，梢部收成尖。
    //   用户 2026-10-08 定案（原话）："**并非斜线问题，一个是你上下留那两条缝给谁看，
    //   二个是哪里有鱼尾末尾是平的**" ——
    //   ① 缝：之前另做了两级"尾柄"盒子（4 格 / 3.4 格高），而尾叶只有薄薄 2~3 格，
    //      于是尾柄的上下两个角从叶子旁边戳出来，身体和鳍之间留了两条黑缝 ✗。
    //      现在**去掉独立尾柄**、尾叶根部加厚到半个身高（2.5 格）并让两片在体轴线上
    //      **互相叠住 0.5 格**，根部合起来正好盖满身体后端面 —— 缝没了 ✓
    //   ② 平：之前尾端是 1 行高的平口 ✗。现在末三列用裁形表逐列收到 1 像素（尖 ✓）。
    //   方块**不再摆正**：长叶子靠旋转给出光滑的长斜边，裁形表只负责收尖和收细，
    //   因此只在梢部有几格台阶，中段是整条直线 ✓
    // ⚠ 长度按用户 2026-10-08 的示意图定：尾鳍从身体末端再往后约 4~5 格就收尖
    //   （图里量出来 ≈ 4.3 格），不要做成两条长飘带 ✗。
    //   salmon 风格的全长/碰撞箱用写死的 SALMON.LEN(25) 与 zMaxU=22 算 centerZ，
    //   尾巴伸太长整条鱼会相对碰撞箱往尾巴那头偏 ✗ —— 短尾巴顺带把这条也守住了 ✓
    const upLen = clamp(R(tL * 0.62), 4, 5);              // 上叶长（8 → 5）
    const loLen = clamp(R(tL * 0.50), 3, 4);              // 下叶更短（8 → 4）
    // 根部各占半个身高（整数格，方便和贴图行数对齐 ✓）、两片在体轴线上正好接住 ⇒ 无缝 ✓
    const upH = clamp(R(tH * 0.36), 2, 3);                // 上叶根厚（7 → 3）
    const loH = clamp(R(tH * 0.36), 2, 3);                // 下叶根厚（7 → 3）
    // 裁形表：中段整片保留，末两列逐列收到 1 像素 —— "末尾不能是平的" ✓
    // ⚠ 行数必须等于方块的高（= facesOf 的口径）：方块高带小数时两边会差一行，
    //   自检立刻报"裁形越界" ✗（2.5 格的高被四舍五入成 3 行，而表里按 2.5 算就超了）。
    const upDy = upH, loDy = loH;
    const upCols = Array.from({ length: upLen }, (_, i) => {
      const k = upLen - 1 - i;                            // 距梢部还有几列
      return [0, Math.max(1, upDy - (k < 2 ? 2 - k : 0))];
    });
    const loCols = Array.from({ length: loLen }, (_, i) => {
      const k = loLen - 1 - i;
      const n = Math.max(1, loDy - (k < 2 ? 2 - k : 0));
      return [loDy - n, n];                               // 下叶从**下缘**保留（收尖时削上缘）
    });
    add('tail_hetero_up', box(0, -upH, 0, 0, upH, upLen), at(0, Y, 16, 0.42), 'fin',
      { cutRows: upCols });
    add('tail_hetero_lo', box(0, 0, 0, 0, loH, loLen), at(0, Y, 16, -0.58), 'fin',
      { cutRows: loCols });  } else {
    add('tail_crescent_up', box(0, -1.8, 0, 0, 1.8, 5), at(0, Y, 16, 0.55), 'fin');
    add('tail_crescent_lo', box(0, 0, 0, 0, 1.8, 5), at(0, Y, 16, -0.55), 'fin');
  }
  // 背鳍两片（前小后大），贴在体背上
  add('top_fin', box(0, 0, 0, 0, 2, 3), at(0, Y - 4.5, 5), 'fin');
  add('top_fin2', box(0, 0, 0, 0, 2, 3), at(0, Y - 4.5, 7), 'fin');
  // 胸鳍（几何不动；"阶梯三角"是贴图的事 —— 待 up/down 面的裁形校验泛化后再做）
  // ⚠ 用户 2026-10-08 实机截图："何意味" —— 那两块黑板就是胸鳍：
  //   它是**水平面**，俯视时整面朝人，视觉面积是侧视的好几倍 ✗。
  //   ① 立起来一些：45° → 66°（1.15 弧度），俯视投影面积从 cos45°≈71% 降到 ≈41% ✓
  //   ② 贴图提亮（见 gen-fish-textures 的 pectoral 分支，掺体侧色）✓
  add('pectoral_r', box(-1.6, 0, 0, 1.6, 0, 1.6), at(-1.5, Y + 1.5, 0, 0, 0, -PI4), 'fin');
  add('pectoral_l', box(0, 0, 0, 1.6, 0, 1.6), at(1.5, Y + 1.5, 0, 0, 0, PI4), 'fin');

  // 鳃裂：鲑鱼模型没有，但鲨鱼没有鳃裂就不叫鲨鱼，保留
  const gillN = sh.gillSlits || 0;
  for (let i = 0; i < gillN; i++) {
    add('gill_' + (i + 1), box(-1.52, -1, -1 - i, 3.04, 2, 1), at(0, Y, 0), 'gill');
  }
  // 口须：只有明确要的鱼才给（镜鲤），且压到 1 单位
  const bN = sh.barbels || 0;
  for (let i = 0; i < bN; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    add('barbel_' + (i + 1), box(-0.5, 0, -1, 1, 1, 1),
      at(side * 0.6, Y, -3, 1.0, -side * 0.3, 0), 'barbel');
  }

  // ---- 按鱼种追加的鳍（原版模板本身没有，但种征需要）----
  // 背鳍/臀鳍的位置都从体轴长度推，不写死，换鱼种不会飘。
  const bodyTop = Y - (Y === 21.5 ? 2.5 : 2);
  const bodyBot = Y + (Y === 21.5 ? 2.5 : 2);
  // ① 鲨鱼背鳍：**垂直三角、垂边向后**（前缘竖直、后缘斜着往下收）
  if (sh.sharkDorsal) {
    const z0 = 2;
    // 鲨鱼背鳍：**前缘缓斜向上、后缘竖直**（垂边向后）。
    // ⚠ 上一版做成了"前高后低、斜着收下去"—— 那是斜边向后，正好做反。
    //   正确的大小关系是：越靠后越高，最后一块的后缘是一条竖直线。
    add('dorsal_a', box(0, -1, 0, 0, 1, 2), at(0, bodyTop, z0), 'fin');
    add('dorsal_b', box(0, -2, 0, 0, 2, 2), at(0, bodyTop, z0 + 2), 'fin');
    add('dorsal_c', box(0, -3, 0, 0, 3, 2), at(0, bodyTop, z0 + 4), 'fin');
    add('dorsal_d', box(0, -4, 0, 0, 4, 2), at(0, bodyTop, z0 + 6), 'fin');
  }
  // ② 嘴做成"7"形：吻下一道横口 + 后端一道短竖口（鲨鱼的口在腹面）
  if (sh.mouthSeven) {
    add('mouth_h', box(-0.7, 0, -2, 1.4, 0.5, 3), at(0, bodyBot - 0.5, -1), 'mouth');
    add('mouth_v', box(-0.7, 0, -1, 1.4, 1.2, 0.5), at(0, bodyBot - 1.7, 2), 'mouth');
  }
  // ③ 两个分离的背鳍（梭鲈）
  if (sh.secondDorsal) {
    add('dorsal2', box(0, -2, 0, 0, 2, 3), at(0, bodyTop, 9), 'fin');
  }
  // ④ 长背鳍（雷龙）：沿背部一整条。
  //    ⚠ 开关必须用**专用**的 longDorsal —— 不能用 dorsalLen：
  //    那是 v3 时代的遗留参数，很多鱼的 shape 里都还留着，
  //    拿它当开关会让那些鱼凭空长出一条长背鳍（梭鲈就这样中过一次招）。
  if (sh.longDorsal) {
    // ⚠ 兜底值从 12 降到 5（用户 2026-10-09：比目鱼/巨暹罗鲤的背鳍"逆天"，参照图一那种
  //   原版小背鳍）。这两个鱼种的数据里没有 longDorsalLen，落到这里的 12 就成了巨帆 ✗。
  //   臀鳍跟着它算（dl - 1 ⇒ 4），一起收 ✓
  const dl = R(sh.longDorsalLen || 5);
    add('dorsal_long', box(0, -2, 0, 0, 2, dl), at(0, bodyTop, 3), 'fin');
    // ⑤ 长臀鳍：**像把背鳍放到鱼肚上** —— 与背鳍上下对称的一整条
    // ⚠ 2026-10-09 用户原话：「下面那片就是多余的直接删，好多鱼都这样」——
    //   身体下方那条长板（anal_long）整类零件删除。classic 分支的小臀鳍
    //   （addTaperedFin('anal')）保留 ✓
  }
  // ⑥ 额外的胸鳍（雷龙只有最前面那对是成对的）
  if (sh.pectoralPairs) {
    for (let i = 1; i < sh.pectoralPairs; i++) {
      const px = 2 + i * 2;
      add('pectoral_r_' + (i + 1), box(-1.5, 0, -1, 1.5, 0, 1.5),
        at(-1.5, Y + 1, px, 0, 0, -PI4), 'fin');
      add('pectoral_l_' + (i + 1), box(0, 0, -1, 1.5, 0, 1.5),
        at(1.5, Y + 1, px, 0, 0, PI4), 'fin');
    }
  }
  return P;
}


/** 原版 CodModel 的拓扑。逐值抄的，不要"顺手改好看点"。 */
const COD = { LEN: 15, HEIGHT: 4, Y: 22 };

function buildPartsCod(g, shape) {
  const sh = shape || {};
  const P = [];
  const add = (name, b, a, kind) => {
    const bb = b.box;
    P.push(Object.assign({ name, size: [bb[3], bb[4], bb[5]], kind: kind || 'body' }, b, a));
  };
  const Y = COD.Y;
  const PI4 = Math.PI / 4;

  add('body', box(-1, -2, 0, 2, 4, 7), at(0, Y, 0));
  add('head', box(-1, -2, -3, 2, 4, 3), at(0, Y, 0), 'head');
  add('nose', box(-1, -2, -1, 2, 3, 1), at(0, Y, -3), 'head');
  // 尾鳍：扇形（3 片），理由同上
  // 尾鳍：月牙形（两片完整叶子，理由同上）
  add('tail_crescent_up', box(0, -1.5, 0, 0, 1.5, 4), at(0, Y, 7, 0.55), 'fin');
  add('tail_crescent_lo', box(0, 0, 0, 0, 1.5, 4), at(0, Y, 7, -0.55), 'fin');
  add('top_fin', box(0, -1, -1, 0, 1, 3), at(0, Y - 2, 0), 'fin');
  // 胸鳍比原版再收一档：它是 ±45° 的水平面，斜看面积大，太显眼
  add('pectoral_r', box(-1.5, 0, -1, 1.5, 0, 1.5), at(-1, Y + 1, 0, 0, 0, -PI4), 'fin');
  add('pectoral_l', box(0, 0, -1, 1.5, 0, 1.5), at(1, Y + 1, 0, 0, 0, PI4), 'fin');

  // 罗非鱼：鱼身照鳕鱼不变，只把尾鳍换成"末端凹陷的扇尾"
  //（用户原话：罗非鱼身可以不变但鱼尾部要动；罗非真鱼的尾是截形/扇形）
  //
  // ⚠ 这里原来是先把 tail_round 截掉再补扇尾。尾鳍改名成 tail_mid/up/lo 之后
  //   findIndex 返回 -1，`P.length = -1` 直接抛 RangeError（Invalid array length）。
  //   改成"按名字删"，找不到也不炸。
  if (sh.tailShape === 'fan') {
    for (let i = P.length - 1; i >= 0; i--) {
      if (P[i].name.startsWith('tail_')) P.splice(i, 1);
    }
    add('tail_crescent_up', box(0, -1.6, 0, 0, 1.6, 3), at(0, Y, 7, 0.45), 'fin');
    add('tail_crescent_lo', box(0, 0, 0, 0, 1.6, 3), at(0, Y, 7, -0.45), 'fin');
  }

  const gillN = sh.gillSlits || 0;
  for (let i = 0; i < gillN; i++) {
    add('gill_' + (i + 1), box(-1.02, -1, -1 - i, 2.04, 2, 1), at(0, Y, 0), 'gill');
  }
  const bN = sh.barbels || 0;
  for (let i = 0; i < bN; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    add('barbel_' + (i + 1), box(-0.5, 0, -1, 1, 1, 1),
      at(side * 0.6, Y + 1, -4, 1.0, -side * 0.3, 0), 'barbel');
  }

  // ---- 按鱼种追加的鳍（原版模板本身没有，但种征需要）----
  // 背鳍/臀鳍的位置都从体轴长度推，不写死，换鱼种不会飘。
  const bodyTop = Y - (Y === 21.5 ? 2.5 : 2);
  const bodyBot = Y + (Y === 21.5 ? 2.5 : 2);
  // ① 鲨鱼背鳍：**垂直三角、垂边向后**（前缘竖直、后缘斜着往下收）
  if (sh.sharkDorsal) {
    const z0 = 2;
    add('dorsal_a', box(0, -4, 0, 0, 4, 2), at(0, bodyTop, z0), 'fin');
    add('dorsal_b', box(0, -3, 0, 0, 3, 2), at(0, bodyTop, z0 + 2), 'fin');
    add('dorsal_c', box(0, -2, 0, 0, 2, 2), at(0, bodyTop, z0 + 4), 'fin');
    add('dorsal_d', box(0, -1, 0, 0, 1, 2), at(0, bodyTop, z0 + 6), 'fin');
  }
  // ② 嘴做成"7"形：吻下一道横口 + 后端一道短竖口（鲨鱼的口在腹面）
  if (sh.mouthSeven) {
    add('mouth_h', box(-0.7, 0, -2, 1.4, 0.5, 3), at(0, bodyBot - 0.5, -1), 'mouth');
    add('mouth_v', box(-0.7, 0, -1, 1.4, 1.2, 0.5), at(0, bodyBot - 1.7, 2), 'mouth');
  }
  // ③ 两个分离的背鳍（梭鲈）
  if (sh.secondDorsal) {
    add('dorsal2', box(0, -2, 0, 0, 2, 3), at(0, bodyTop, 9), 'fin');
  }
  // ④ 长背鳍（雷龙）：沿背部一整条
  if (sh.dorsalLen) {
    // ⚠ 2026-10-08 实机反馈"部分鱼存在背鳍过度放大"：这里的 dorsalLen 直接来自
    //   fish-appearance.json，北非鲶写到 15 格 —— 而 salmon 体干全长只有 16 格，
    //   于是一片鳍盖住整条背、侧视就是一张巨帆 ✗。按体干 70% 夹住（≈11 格），
    //   旗鱼/鲯鳅这类真·长背鳍仍然保留（它们本就该长 ✓）。
    add('dorsal_long', box(0, -2, 0, 0, 2, R(sh.dorsalLen)), at(0, bodyTop, 3), 'fin');
  }
  // ⑤ 长臀鳍（雷龙）：**像把背鳍放到鱼肚上** —— 沿腹面一整条，与背鳍上下对称
  if (sh.analLen) {
    // ⚠ 2026-10-09 用户原话：「下面那片就是多余的直接删，好多鱼都这样」——
    //   身体下方那条长板（anal_long）整类零件删除。classic 分支的小臀鳍
    //   （addTaperedFin('anal')）保留 ✓
  }
  // ⑥ 额外的胸鳍（雷龙只有最前面那对是成对的）
  if (sh.pectoralPairs) {
    for (let i = 1; i < sh.pectoralPairs; i++) {
      const px = 2 + i * 2;
      add('pectoral_r_' + (i + 1), box(-1.5, 0, -1, 1.5, 0, 1.5),
        at(-1.5, Y + 1, px, 0, 0, -PI4), 'fin');
      add('pectoral_l_' + (i + 1), box(0, 0, -1, 1.5, 0, 1.5),
        at(1.5, Y + 1, px, 0, 0, PI4), 'fin');
    }
  }
  return P;
}

function buildParts(g, shape) {
  const s = shape || {};
  // v1 风格：整条鱼身一个长方体（见 buildPartsV1 的注释）
  if (s.style === 'v1' || s.style === 'cod') return buildPartsCod(g, s);
  if (s.style === 'salmon') return buildPartsSalmon(g, s);
  const W = g.W, H = g.H, Lb = g.Lb, Lh = g.Lh;
  const num = (v, d) => (v === undefined || v === null ? d : v);

  const Ln = R(num(s.snoutLen, g.Ln));           // 吻的 z 向长度
  const Lt = R(num(s.tailLen, g.Lt));             // 尾鳍 z 向长度
  const tailH = R(num(s.tailHeight, g.tailH));    // 尾鳍高
  const tailType = s.tailType || (s.tail === 'round' ? 'round' : 'fork');
  const snoutShape = s.snoutShape || 'normal';
  const analH = 1;
  // 腹鳍（臀鳍）向下伸 1 格，所以整条鱼抬高 1，让最低点在 y=24（地面）
  const y = 24 - H / 2 - analH;
  const top = y - H / 2;
  const bot = y + H / 2;

  // ---- 体干分段：body（前段）→ back（后段）→ peduncle（尾柄）→ 尾鳍
  // 分三段才画得出"向后收细"的轮廓；上一版只有 body+peduncle，
  // 后段是一刀切的，所有鱼的中段都一样粗。
  // ---- 体干分段：按**体高分布曲线**切成 N 段 → 侧面是鱼形轮廓，不是方盒子
  //
  // 这是"模板套用"的根源：上一版体干只有 2 段等高的方盒，从侧面看就是一块矩形。
  // 真鱼的体高沿体轴是"头后快速升至最高（约体前 1/4）→ 缓慢收细到尾柄"。
  // 现在按 g.profile 采样（可用 shape.profile 覆盖，6 个数，t=0→1）。
  const pedFrac = num(s.peduncleLen, 0.22);
  const pedL = Math.max(1, R(Lb * pedFrac));
  const trunkL = Lb - pedL;
  const pedW = Math.max(1, R(W * num(s.peduncleWidth, 0.6)));
  const pedH = Math.max(1, R(H * num(s.peduncleHeight, 0.5)));
  const eyeScale = num(s.eyeScale, 1);

  // ⚠ 组参数缺失时 segN 会变成 NaN，for 循环一次都不跑 ——
  //   表现是"鱼只剩头和尾鳍、身子整段消失"，而且不报任何错。
  //   这里兜底到 4，并在构造时断言它必须是有限数。
  const segN = Math.max(2, Math.min(6, R(num(s.segments, g.segments || 4))));
  if (!Number.isFinite(segN)) throw new Error("体干段数算不出来（segments/profile 缺失）");
  const prof = (s.profile && s.profile.length >= 2) ? s.profile : g.profile;
  const profileAt = (t) => {
    const x = Math.max(0, Math.min(1, t)) * (prof.length - 1);
    const i = Math.min(prof.length - 2, Math.floor(x));
    return prof[i] + (prof[i + 1] - prof[i]) * (x - i);
  };
  // 各段长度取整，总和必须正好等于 trunkL（否则体干会短一截或长一截）
  const segLen = [];
  let acc = 0;
  for (let i = 1; i <= segN; i++) {
    const b = R(trunkL * i / segN);
    segLen.push(b - acc);
    acc = b;
  }

  const P = [];
  const add = (name, b, a, kind) => {
    const bb = b.box;
    P.push(Object.assign({
      name,
      size: [bb[3], bb[4], bb[5]],
      kind: kind || 'body',
    }, b, a));
  };

  // —— 鳍的统一做法：**分段递变**，不是一块矩形板。
  //
  // 上一版每片鳍就是一个 0 厚度的盒子，从侧面投影出来是一块平行四边形 ——
  // 用户的评价是"尾巴两个黑长条""鳍像贴图块"。真鱼的鳍是三角形的：
  // 基部高、向末端收尖。这里把一片鳍拆成 n 段、高度线性递减，
  // 像素画里就自然读成一片鳍。
  const finN = Math.max(1, Math.min(4, R(num(s.finSegments, 3))));
  const addTaperedFin = (name, len, hBase, hTip, baseX, baseY, baseZ, rot, kind, axis, edge, centre) => {
    const n = finN;
    const segL = Math.max(1, R(len / n));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const h = Math.max(1, R(hBase + (hTip - hBase) * t));
      const nm = i === 0 ? name : name + '_' + (i + 1);
      // ⚠ 背鳍/臀鳍的基线必须**跟着背线/腹线走**。鱼身各段高度不同，
      //   若把基线写成固定值，鳍在矮的那几段上就会悬空 ——
      //   表现是"背鳍浮在头顶上方一块灰方块"（鲫鱼的长背鳍起点在头后，正好踩这个坑）。
      let by = baseY;
      if (axis === 'z' && edge) {
        const tt = tAt(baseZ + i * segL + segL / 2);
        by = edge === 'top' ? y - R(H / 2 * sample(topProf, tt))
                            : y + R(H / 2 * sample(botProf, tt));
      }
      if (axis === 'out') {
        // 尾鳍叶：每段以**自身中心**定位在旋转后的射线上，盒子也以自身中心为原点。
        // ⚠ 上一版把盒子原点放在段的起点、位置却按 i*segL 整段跳 ——
        //   两者差半段，于是相邻段之间越走越开，尾巴看着"断断续续、一条条没连起来"。
        //   改成"中心对中心"之后首尾自然相接。
        const th = rot[0];
        const cdist = (i + 0.5) * segL;
        add(nm, box(0, -R(h / 2), -R(segL / 2), 0, h, segL),
          at(baseX, baseY - R(cdist * Math.sin(th)), baseZ + R(cdist * Math.cos(th)),
            th, rot[1], rot[2]), kind);
      } else {
        // 背鳍/臀鳍/圆尾：沿体轴铺开，高度从 hBase 递减到 hTip。
        // centre=true 时绕体轴居中（尾鳍要的），否则从基线向一侧长（背鳍/臀鳍要的）。
        const off = centre ? -R(h / 2) : -h;
        add(nm, box(0, off, 0, 0, h, segL),
          at(baseX, by, baseZ + i * segL, rot[0], rot[1], rot[2]), kind);
      }
    }
  };

  // —— 头 + 体干 = **一条连续的链**，用「背线」和「腹线」两条曲线采样。
  //
  // ⚠ 这是"鱼嘴上有怪东西"的根因所在，务必理解：
  //   上一版头（两段）和体干（N 段）是**各自独立、以体轴为中心**的方块，
  //   高度各不相同。于是每一段比相邻段矮的地方，其**下缘底面会露出来**，
  //   而底面画的是腹色（接近白）—— 从侧面看就是"嘴里戳出几块白色的东西"，
  //   像牙又像碎块。真鱼的下颌线是平的：**腹线连续、背线起拱**。
  //
  //   所以现在整条链共用一个参数 t（0 = 吻端之后，1 = 尾柄之前），
  //   高度拆成「轴以上 top(t)」和「轴以下 bot(t)」两半分别取，
  //   相邻段的上下缘自然对齐，不会再露出底面。
  const topProf = (s.top && s.top.length >= 2) ? s.top : g.top;
  const botProf = (s.bot && s.bot.length >= 2) ? s.bot : g.bot;
  const sample = (arr, t) => {
    const x = Math.max(0, Math.min(1, t)) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(x));
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  };
  const chainLen = Lh + trunkL;               // 从吻端之后到尾柄之前的长度
  const tAt = (zCentre) => (zCentre + Lh) / Math.max(1, chainLen);

  /** 造一段体块：上下缘分别由两条曲线给出，宽度随总高收细 */
  const addChainBox = (name, len, z0, kind) => {
    const t = tAt(z0 + len / 2);
    const bu = Math.max(1, R(H / 2 * sample(topProf, t)));
    const bd = Math.max(1, R(H / 2 * sample(botProf, t)));
    // headWide：鲨鱼等头部**扁平而宽**，头段要比体干宽
    const wide = kind === 'head' ? num(s.headWide, 1) : 1;
    const w = Math.max(1, R(W * (0.62 + 0.38 * sample(topProf, t)) * wide));
    add(name, box(-w / 2, -bu, 0, w, bu + bd, len), at(0, y, z0), kind);
    return { bu, bd, w };
  };

  // 头：两段（前段就是"头2"），与体干共用曲线 → 头身之间没有台阶
  const lh2 = Math.max(1, R(Lh * 0.45));
  const lh1 = Math.max(1, Lh - lh2);
  addChainBox('head', lh1, -lh1, 'head');
  const headFront = addChainBox('head2', lh2, -Lh, 'head');

  // 体干 N 段
  let zc = 0;
  for (let i = 0; i < segN; i++) {
    addChainBox(i === 0 ? 'body' : 'body' + (i + 1), segLen[i], zc);
    zc += segLen[i];
  }
  add('peduncle', box(-pedW / 2, -pedH / 2, 0, pedW, pedH, pedL), at(0, y, trunkL));

  const headH = Math.max(1, R(H * num(s.headHeight, 1.0)));
  const hw2 = headFront.w;

  // —— 吻：4 种吻型。这是"一眼分辨"最关键的地方（鸭嘴狗鱼 / 上翘翘嘴 / 骨板巨骨舌鱼）
  const Wn = Math.max(1, R(W * num(s.snoutWidth, 0.5)));
  const Hn = Math.max(1, R(H * num(s.snoutHeight, 0.4)));
  const noseY = y + R(H * 0.08);
  if (snoutShape === 'duckbill') {
    // 狗鱼：扁而宽的鸭嘴，向前平伸，位于头部**下位**
    add('nose', box(-Wn / 2, -Hn / 2, -Ln, Wn, Math.max(1, R(Hn * 0.5)), Ln),
      at(0, y + R(H * 0.22), -Lh));
  } else if (snoutShape === 'upturned') {
    // 翘嘴鲌：口上位、下颌突出并向上翘。
    // 上颌块绕 X 轴负向转（尖端朝上），下颌块更长、从下方托出去 ——
    // "翘嘴"这个名字的全部含义就在这两块上，光靠贴图是画不出来的。
    add('nose', box(-Wn / 2, -Hn / 2, -Ln, Wn, Hn, Ln), at(0, y + R(H * 0.06), -Lh, -0.42));
    add('jaw', box(-Wn / 2, 0, -Ln - 1, Wn, Math.max(1, R(Hn * 0.45)), Ln + 1),
      at(0, y + R(H * 0.30), -Lh, -0.28), 'jaw');
  } else if (snoutShape === 'blunt') {
    // 巨骨舌鱼：头骨板厚重、吻短而钝、口裂大且略上斜
    add('nose', box(-Wn / 2, -Hn / 2, -Ln, Wn, Math.max(1, R(H * 0.75)), Ln),
      at(0, y + R(H * 0.04), -Lh, -0.12));
  } else if (snoutShape === 'subterminal') {
    // 镜鲤等：口**亚下位**、马蹄形，吻端向下 —— 与"端位口"的区别就在这一块的下沉
    add('nose', box(-Wn / 2, -Hn / 2, -Ln, Wn, Math.max(1, R(Hn * 0.8)), Ln),
      at(0, y + R(H * 0.24), -Lh, 0.28));
  } else {
    add('nose', box(-Wn / 2, -Hn / 2, -Ln, Wn, Hn, Ln), at(0, noseY, -Lh));
  }

  // —— 犬齿（虎鱼/梭鲈）：资料里"满口匕首状犬齿在闭嘴时仍全部外露"，
  //    是这两种鱼最硬的辨识点，光靠贴图表现不出来，必须真的长出牙。
  const fangs = Math.max(0, R(num(s.canines, 0)));
  for (let i = 0; i < fangs; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const k = Math.floor(i / 2);
    add('fang_' + (i + 1),
      box(-0.25, 0, -1, 0.5, 1, 1),
      at(side * Math.max(0.5, Wn * 0.3), y + R(H * 0.16) + k, -Lh - Ln + 1, 1.15, 0, 0), 'fang');
  }

  // —— 鳍端的丝状延长（大眼海鲢）：资料"背鳍与臀鳍各自最后一根鳍条拖成细长丝状"。
  //    做成一根 1 单位粗、向后拖 6 单位的细条，接在背鳍/臀鳍的末端之后。
  if (s.finFilament) {
    const fl = Math.max(3, R(num(s.finFilament, 6)));
    add('filament_d', box(0, -1, 0, 0, 1, fl), at(0, top + 1, R(Lb * 0.34)), 'fin');
    add('filament_a', box(0, 0, 0, 0, 1, fl), at(0, bot - 1, R(Lb * 0.66)), 'fin');
  }

  // —— 眼下骨刺（花鳅）：资料"眼下有一根外露的分叉小骨刺"
  if (s.cheekSpine) {
    for (const side of [-1, 1]) {
      add('spine_' + (side > 0 ? 'l' : 'r'), box(-0.25, 0, -2, 0.5, 0.5, 2),
        at(side * Math.max(0.5, W * 0.5), y + R(H * 0.1), -Lh + 1, 0.9, -side * 0.5, 0), 'fang');
    }
  }
  // 下颌前突（龙鱼、大眼海鲢、鲑）：单独一块，比吻更靠前、更低
  if (s.lowerJaw) {
    const jh = Math.max(1, R(Hn * 0.4));
    add('jaw', box(-Wn / 2, Hn / 2 - jh, -Ln - num(s.lowerJaw, 1), Wn, jh, R(Ln * 0.8)),
      at(0, noseY, -Lh), 'jaw');
  }

  // —— 背鳍
  // 用户实机反馈「所有鱼的背鳍都太大」→ 全局打 0.7 折；
  // 确实需要大背鳍的鱼（雷龙/龙鱼）用自己的 dorsalLen 配 dorsalScale 放回去。
  // ⚠ 2026-10-08 实机又反馈「部分鱼存在背鳍胸鳍过度放大问题」——
  //   根因：dorsalLen 直接来自 fish-appearance.json（北非鲶 15 格、比目鱼 12、旗鱼 13），
  //   而这一组的体干只有 ~12 格 ⇒ 背鳍比整条背还长，侧视里就是一片巨大的帆 ✗。
  //   现在按**体干长**夹住：普通鱼 ≤45%，真要长背鳍的走 longDorsal 那条专用分支 ✓。
  const dl = Math.max(2, R(num(s.dorsalLen, g.dorsalLong) * num(s.dorsalScale, 0.7)));
  const dh = Math.max(1, R(num(s.dorsalHeight, 1)));
  const dpos = num(s.dorsalPos, 0.42);
  addTaperedFin('dorsal', dl, dh, Math.max(1, R(dh * num(s.dorsalTaper, 0.35))),
    0, top, R(Lb * dpos) - R(dl / 2), [0, 0, 0], 'fin', 'z', 'top');
  // 第二背鳍（梭鲈/狗鱼/鲨鱼）：与第一背鳍分离
  if (s.secondDorsal) {
    const dl2 = Math.max(2, R(num(s.secondDorsalLen, dl * 0.55)));
    const dh2 = Math.max(1, R(dh * 1.2));
    addTaperedFin('dorsal2', dl2, dh2, Math.max(1, R(dh2 * 0.4)),
      0, top, R(Lb * num(s.secondDorsalPos, 0.8)) - R(dl2 / 2), [0, 0, 0], 'fin', 'z', 'top');
  }
  // 脂鳍（鲑科 + 虎鱼）：第一背鳍与尾鳍之间的小肉鳍
  if (s.adipose) add('adipose', box(0, -1, -1, 0, 1, 2), at(0, top, Lb - 2), 'fin');
  // 离鳍（金枪鱼）：第二背鳍之后的一排小鳍。
  // ⚠ 间距必须**从体长推**，不能写死 2 —— 上一版写死 2 单位，
  //   7 枚离鳍从 z=6 排到 z=18，而金枪鱼的体干只到 10，
  //   后 4 枚直接飘在尾鳍上方的空气里（还带着 UV，所以画面上是 4 个悬空方块）。
  if (s.finlets) {
    const fz = R(Lb * num(s.finletsPos, 0.55));
    for (let i = 0; i < s.finlets; i++) {
      add('finlet_' + (i + 1), box(0, -1, -1, 0, 1, 1), at(0, top, fz + i), 'finlet');
    }
  }

  // —— 臀鳍（腹面后段，向下）：同样按体干长夹住（≤35%）✓
  const al = Math.max(2, R(num(s.analLen, Lb * 0.28) * num(s.analScale, 0.8)));
  const ah = Math.max(1, R(num(s.analHeight, 1)));
  addTaperedFin('anal', al, ah, Math.max(1, R(ah * num(s.analTaper, 0.35))),
    0, bot, R(Lb * num(s.analPos, 0.72)) - R(al / 2), [0, 0, 0], 'fin', 'z', 'bot');

  // —— 胸鳍（左右各一，从鳃盖后下方斜出）
  const pectLen = Math.max(2, R(num(s.pectoralLen, W * 0.6) + 1));
  // —— 胸鳍：鲨鱼的宽圆胸鳍要单独放大（资料"胸鳍宽大圆钝，位于体侧后方"）
  const pectW = Math.max(2, R(W * num(s.pectoralBroad, 1)));
  const pectY = R(H * num(s.pectoralDrop, 0.28));
  // 胸鳍：沿向外方向分 2 段、z 向长度递减 —— 侧面看是三角形。
  // 用户原话：肚子下面那两个东西，请不要用正方形，请用三角形。
  const pectZ = R(num(s.pectoralPos, 0));
  const pn = 2;
  const pw = Math.max(1, R(pectW / pn));
  for (let i = 0; i < pn; i++) {
    const pl = Math.max(1, R(pectLen * (1 - 0.45 * i)));
    add(i === 0 ? 'pectoral_r' : 'pectoral_r_' + (i + 1),
      box(-pw, 0, -R(pl / 2), pw, 0, pl),
      at(-W / 2 - i * pw, y + pectY, pectZ, 0, 0, -Math.PI / 4), 'fin');
    add(i === 0 ? 'pectoral_l' : 'pectoral_l_' + (i + 1),
      box(0, 0, -R(pl / 2), pw, 0, pl),
      at(W / 2 + i * pw, y + pectY, pectZ, 0, 0, Math.PI / 4), 'fin');
  }

  // —— 尾鳍：6 种尾型
  const forkH = Math.max(1, R(tailH * 0.6));
  // 叉尾叶端圆钝（鲫鱼资料"尾鳍浅叉而叶端圆钝"）：末端不收成尖
  const forkTip = Math.max(1, R(forkH * num(s.tailTip, 0.25)));
  // 下叶更长（翘嘴资料"深叉且下叶更长"）
  const loLen = s.tailLowerLong ? R(Lt * 1.35) : Lt;
  if (tailType === 'round') {
    addTaperedFin('tail_round', Lt, tailH, Math.max(1, R(tailH * 0.55)), 0, y, Lb,
      [0, 0, 0], 'fin', 'z', null, true);
  } else if (tailType === 'truncate') {
    // 罗非鱼：截形/扇形 —— 末端几乎不收，是一道平截的边
    addTaperedFin('tail_truncate', Lt, tailH, Math.max(1, R(tailH * 0.85)), 0, y, Lb,
      [0, 0, 0], 'fin', 'z', null, true);
  } else if (tailType === 'crescent') {
    // 金枪鱼/鲭科：细长的新月尾，两叶窄而长、夹角大
    const ch = Math.max(1, R(tailH * 0.34));
    addTaperedFin('tail_crescent_up', Lt, ch, 1, 0, y - R(ch / 2), Lb, [0.55, 0, 0], 'fin', 'out');
    addTaperedFin('tail_crescent_lo', Lt, ch, 1, 0, y + R(ch / 2), Lb, [-0.55, 0, 0], 'fin', 'out');
  } else if (tailType === 'shark') {
    // 条纹斑竹鲨：尾鳍**狭长而尾椎轴平直不上翘**（区别于真鲨的上翘歪尾）。
    // 所以上叶只是微微抬起、下叶很小 —— 关键是"细长"，不是"大歪尾"。
    const up = Math.max(2, R(tailH * 0.42));
    addTaperedFin('tail_shark_up', Lt, up, 1, 0, y - R(up / 2), Lb, [0.16, 0, 0], 'fin', 'out');
    addTaperedFin('tail_shark_lo', R(Lt * 0.4), Math.max(1, R(up * 0.6)), 1, 0, y + 1, Lb,
      [-0.30, 0, 0], 'fin', 'out');
  } else {
    addTaperedFin('tail_fork_up', Lt, forkH, forkTip, 0, y - R(forkH / 2), Lb, [0.34, 0, 0], 'fin', 'out');
    addTaperedFin('tail_fork_lo', loLen, forkH, forkTip, 0, y + R(forkH / 2), Lb, [-0.34, 0, 0], 'fin', 'out');
  }

  // —— 鳃裂（鲨鱼 5 对）
  const gillN = s.gillSlits || 0;
  for (let i = 0; i < gillN; i++) {
    const z = -R(Lh * 0.25) - i;
    add('gill_' + (i + 1), box(-W / 2 - 0.02, -1, z, W + 0.04, 2, 1), at(0, y, 0), 'gill');
  }

  // —— 口须：**必须短、细、向下垂**。
  //    上一版是 3 单位长的水平方棍，rot x 取的是负值 ——
  //    绕 X 轴负向旋转会把"沿 -Z 伸出的尖端"抬**向上**，所以四条有须的鱼
  //    （镜鲤/白金龙鱼/花鳅/幼鲨）嘴上都是两根朝前翘的棍子。
  //    用户的原话是「嘴上有很诡异的两个长条」，就是这么来的。
  //    现在：长度 2 起、粗细 0.5、绕 X **正**向旋转让尖端下垂，再绕 Y 向外撇。
  const bN = s.barbels || 0;
  const bLen = Math.max(2, R(num(s.barbelLen, 2)));
  const bAt = s.barbelAt || 'mouth';              // mouth=口角 / lower=下颌
  const bDroop = num(s.barbelDroop, 0.9);
  for (let i = 0; i < bN; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const by = bAt === 'lower' ? y + Hn * 0.4 : y - 0.5 + row;
    add('barbel_' + (i + 1), box(-0.25, 0, -bLen, 0.5, 0.5, bLen),
      at(side * Math.max(0.5, Wn * 0.4), by, -Lh - Ln, bDroop, -side * 0.3, 0), 'barbel');
  }

  return P;
}

// ---------------------------------------------------------------- 装箱
/** 一个盒子在贴图上要占的矩形：w = 2dz+2dx, h = dz+dy */
function unwrapSize(size) {
  const dx = size[0], dy = size[1], dz = size[2];
  return { w: 2 * dz + 2 * dx, h: dz + dy };
}

/** 货架装箱：按高度降序、逐行从左到右，行放不下就换行。 */
function pack(parts, atlasW) {
  const items = parts.map((p) => {
    const { w, h } = unwrapSize(p.size);
    return { name: p.name, w: Math.ceil(w - 1e-6), h: Math.ceil(h - 1e-6) };
  }).sort((a, b) => (b.h - a.h) || (b.w - a.w) || a.name.localeCompare(b.name));

  const texOffs = {};
  let x = 0, y = 0, shelfH = 0, maxX = 0;
  for (const it of items) {
    if (x + it.w > atlasW) { y += shelfH; x = 0; shelfH = 0; }
    texOffs[it.name] = [x, y];
    x += it.w;
    maxX = Math.max(maxX, x);
    shelfH = Math.max(shelfH, it.h);
  }
  return { texOffs, used: { w: maxX, h: y + shelfH } };
}

const pow2 = (v) => { let n = 1; while (n < v) n *= 2; return n; };

/** 某个盒子的 6 个面在贴图上的矩形（绝对像素）：[x, y, w, h] */
function facesOf(part, texOffs) {
  const dx = part.size[0], dy = part.size[1], dz = part.size[2];
  const [u, v] = texOffs;
  const r = Math.round;
  return {
    down: [r(u + dz), r(v), r(dx), r(dz)],
    up: [r(u + dz + dx), r(v), r(dx), r(dz)],
    west: [r(u), r(v + dz), r(dz), r(dy)],
    north: [r(u + dz), r(v + dz), r(dx), r(dy)],
    east: [r(u + dz + dx), r(v + dz), r(dz), r(dy)],
    south: [r(u + dz + dx + dz), r(v + dz), r(dx), r(dy)],
  };
}

// ---------------------------------------------------------------- 组装
const bodies = {};
for (const [key, g] of Object.entries(data.bodies)) {
  bodies[key] = { key, params: g, baseParts: buildParts(g, null) };
}

/** 一种鱼的完整体型：零件 + 该鱼自己的图集尺寸 + UV 排版 + 渲染缩放 + 碰撞箱。 */
function buildSpecies(id, f) {
  const g = bodies[f.group];
  if (!g) throw new Error(id + ' 的 group ' + f.group + ' 不存在');
  const params = g.params;
  const parts = buildParts(params, f.shape);
  const W = (f.atlas && f.atlas.w) || 64;
  const { texOffs, used } = pack(parts, W);
  const aw = pow2(Math.max(used.w, 16));
  const ah = pow2(Math.max(used.h, 16));

  // —— 重叠检查：UV 撞车 = "鱼身上出现别的零件的颜色"，不报错只难看
  const seen = [];
  for (const p of parts) {
    const sz = unwrapSize(p.size);
    const rect = [texOffs[p.name][0], texOffs[p.name][1], Math.ceil(sz.w - 1e-6), Math.ceil(sz.h - 1e-6)];
    for (const o of seen) {
      if (rect[0] < o.rect[0] + o.rect[2] && o.rect[0] < rect[0] + rect[2] &&
          rect[1] < o.rect[1] + o.rect[3] && o.rect[1] < rect[1] + rect[3]) {
        throw new Error(id + ' 的 ' + p.name + ' 与 ' + o.name + ' UV 重叠');
      }
    }
    seen.push({ name: p.name, rect });
  }

  // —— 尺寸：直接按真实体长定目标模型长度。
  //    上一版是"组内归一 → 0.6 次方 → 夹 [0.78,1.5]"三重压缩，
  //    200cm 的巨骨舌鱼只比 20cm 的鲫鱼长一倍出头，用户的原话是
  //    「把应该大模型的鱼做大」。现在只此一处归一，不再额外压缩。
  // ⚠ salmon 风格用的是原版 SalmonModel 的几何，全长/体高和组参数**无关** ——
  //   这里若不特判，renderScale 会拿组参数算长度，鱼会忽大忽小。
  const isSalmon = f.shape && f.shape.style === 'salmon';
  const isCod = f.shape && (f.shape.style === 'cod' || f.shape.style === 'v1');
  const totalUnits = isSalmon ? SALMON.LEN : isCod ? COD.LEN
    : params.Lb + params.Lh + (f.shape && f.shape.snoutLen !== undefined
      ? f.shape.snoutLen : params.Ln) + (f.shape && f.shape.tailLen !== undefined
      ? f.shape.tailLen : params.Lt);
  const rs = params.renderScale || [1, 1, 1];
  const target = SIZE_A * Math.pow(f.lengthCm || 30, SIZE_B);
  const base = clamp(target / totalUnits, SIZE_MIN, SIZE_MAX);
  const t = f.traits || {};
  const scale = [
    +(base * rs[0] * (t.wide || 1)).toFixed(3),
    +(base * rs[1] * (t.squat || 1)).toFixed(3),
    +(base * rs[2] * (t.long || 1)).toFixed(3),
  ];
  // 碰撞箱：长度用全长、高度把背鳍臀鳍各算 1 单位，宽度乘 0.8（贴着走手感更好）
  const lenUnits = totalUnits * scale[2];
  const heiUnits = (isSalmon ? SALMON.HEIGHT + 2 : isCod ? COD.HEIGHT + 2 : params.H + 2) * scale[1];
  // 鱼模型的 z 原点在**头身交界**，不在鱼的中心 —— 摆到方块上时必须补这个偏移，
  // 否则整条鱼会往尾巴那头甩出去（用户："鱼身也要往前一点至少居中"）。
  const zMinU = isSalmon ? -3 : isCod ? -4 : -(params.Lh + (f.shape && f.shape.snoutLen !== undefined ? f.shape.snoutLen : params.Ln));
  const zMaxU = isSalmon ? 22 : isCod ? 11 : params.Lb + (f.shape && f.shape.tailLen !== undefined ? f.shape.tailLen : params.Lt);
  const centerZ = (zMinU + zMaxU) / 2;
  const hit = [
    +clamp(lenUnits / 16 * 0.80, 0.30, 2.20).toFixed(2),
    +clamp(heiUnits / 16 * 1.00, 0.20, 1.20).toFixed(2),
  ];

  return {
    id, group: f.group,
    parts, texOffs, atlasW: aw, atlasH: ah,
    bands: ((f.shape && f.shape.bands) || [0.26, 0.50, 0.74]).slice(),
    scale, hit, centerZ, lengthCm: f.lengthCm || 30,
    modelLenBlocks: +(lenUnits / 16).toFixed(2),
  };
}

/**
 * 尺寸口径：目标模型长度 = SIZE_A × 体长(cm)^SIZE_B
 * 0.48 次方把 25 倍的真实体长差压成 4.2 倍尺寸差；系数 2.98 的标定是
 * "10cm 小鱼 ≈ 9 单位（0.56 格）看得见，200cm 巨物 ≈ 38 单位（2.4 格）"，
 * 和原版同量级（原版鳕鱼模型 15 单位 ≈ 一条 50cm 鱼）。
 */
const SIZE_A = 2.98, SIZE_B = 0.48;
const SIZE_MIN = 0.30, SIZE_MAX = 2.10;

const species = {};
for (const [id, f] of Object.entries(data.fish)) species[id] = buildSpecies(id, f);

// 旧接口：bodies[g].parts / texOffs 仍被部分脚本引用，给个"组默认"的相容视图
for (const [key, b] of Object.entries(bodies)) {
  const { texOffs, used } = pack(b.baseParts, 64);
  b.parts = b.baseParts;
  b.texOffs = texOffs;
  b.used = used;
}

/**
 * 尾叶的**贴图裁形**：这块方块的第 (col,row) 个像素该不该上色。
 *
 * 背景（用户 2026-10-08）："你可以直接画一张梯块，而不是通过几张矩形拼接成梯形 ——
 * 尾巴两片本质是一个看上去像 30 度垂直三角的梯形。"
 * MC 的方块几何做不出梯形，但贴图能：整片尾叶只用一个方块，轮廓由**透明像素**切出来
 * （实体渲染走 entityCutoutNoCull，alpha=0 的像素直接被丢掉；preview-fish.js 同样跳过）。
 *
 * 零件用 `cutRows: [[起始行, 行数], …]`（长度 = 盒子的 dz，行 0 = 方块顶）声明形状；
 * 没有这个字段的零件一律 true —— **老零件的行为一个像素都不变** ✓。
 *
 * ⚠ 面的"长度轴"不同，判据要分开对待（见 gen-fish-textures 的 walk）：
 *   · west/east（竖直薄片：尾鳍）：列走 z、行走体高 ⇒ 表按 z 索引，保留的是**行**；
 *   · up/down（水平薄片：胸鳍）：行其实走 z、列走 x ⇒ 表同样按 z 索引，保留的是**列**；
 *   · north/south：列走 x、行走体高，本项目没用到，一律不裁 ✓。
 */
function cutKeeps(p, face, col, row) {
  if (!p.cutRows) return true;
  if (face !== 'west' && face !== 'east') return true;   // up/down 的校验尚未泛化，见文件头说明
  const dz = p.size[2];
  const z = face === 'west' ? dz - 1 - col : col;        // 西面的列序与 z 相反
  if (z < 0 || z >= p.cutRows.length) return true;
  const [s0, n] = p.cutRows[z];
  return row >= s0 && row < s0 + n;
}

module.exports = {
  data, bodies, species, buildParts, buildSpecies, pack, unwrapSize, facesOf, cutKeeps,
  SIZE_A, SIZE_B,
};

// ---------------------------------------------------------------- CLI
if (require.main === module) {
  const rows = Object.values(species).sort((a, b) => a.modelLenBlocks - b.modelLenBlocks);
  console.log('鱼种 → 组 / 模型长度 / 碰撞箱 / 零件数 / 图集');
  for (const s of rows) {
    console.log('  ' + s.id.padEnd(19) + s.group + '  ' +
      String(s.lengthCm).padStart(5) + 'cm → ' + String(s.modelLenBlocks).padStart(5) + ' 格  ' +
      ('box=' + s.hit.join('×')).padEnd(15) +
      String(s.parts.length).padStart(2) + ' 件  ' +
      s.atlasW + '×' + s.atlasH);
  }
  console.log('\n共 ' + rows.length + ' 种');
}
