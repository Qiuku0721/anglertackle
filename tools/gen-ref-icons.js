/*
 * gen-ref-icons.js —— 用**用户给的参考图**重做 7 张鱼获图标（7 个 id）。
 *                    （拟饵 9 张 2026-10-04 起改由 tools/gen-lure-icons.js 负责，见 SOURCES 末尾）
 *
 * ── 为什么要有它（2026-10-02）────────────────────────────────────
 * 这 8 张原来是别的路子出的，用户验收后说"错了，应该用我给的图"：
 *   · 5 种新鱼的图标是 `gen-fish-item.js` 从鱼模型**离屏渲染**的。那条路为了
 *     表达"这条鱼多大"故意不按包围盒归一化，于是 4cm 的孔雀鱼在 64×64 上
 *     就是一条 14×8 的小鱼 —— 和 21 张老图标（抠实物照片、占满画布）
 *     放一起明显不像一套东西。
 *   · 3 个新拟饵是 `gen-fine-lures.js` 用 `paint.js` **按坐标画**的：横放的
 *     软虫 + 一个大圆桨尾，而 6 张老拟饵图标全是**斜放**的（内容恒为 44×45
 *     居中 @(10,9)）。摆在一起就不是一个风格。
 *
 * 所以这里走回**老图标当年那条路**：参考图 → 按格还原像素 → 抠背景 → 裁到主体
 * → 1:1 居中放进 64×64。
 *
 * ── 为什么是"按格取样"而不是"缩小图片"──────────────────────────
 * 参考图是 **5px 马赛克**（在线像素画工具打好格再最近邻放大 5 倍）。
 * 本脚本实测过：每 5×5 块**完全同色**（格内偏差 0.00），所以取格中位数是
 * **无损**还原，不是"缩图"。绝不走 `downsample()` 那条面积平均的路 ——
 * 那会把 1px 的硬边搅成灰边，正是用户三番五次说的"不要糊"。
 *
 * ── 抠图：为什么用"背景曲面拟合"而不是现成的两个函数 ──────────────
 * `image-to-sprite.js` 里有两个现成的：
 *   · `removeBackground()` —— 四边泛洪，基准色取**四角平均**
 *   · `maskByColorDistance()` —— 逐像素跟**四角平均色**比距离
 * 两个都假设"背景是一块均匀纯色"。这 8 张不是：
 *   · 鱼图背景是**渐变**，四角之间就差着 30+ 的色距（蓝底从 (16,121,188)
 *     渐变到 (5,104,164)）；
 *   · 拟饵背景是深灰渐变 (25,32,38)→(28,36,46)，而拟饵身上的**阴影和高光**
 *     离背景色并不远。
 * 用一个四角平均色去卡渐变背景，必然是一头留脏边、一头啃主体。
 *
 * 所以改成：**外圈 2 格环做二次多项式最小二乘**，拟合出一张"背景曲面"，
 * 再逐格算与曲面的色距。渐变被曲面吃掉了，鱼身上的任何一个像素都不用去
 * 迁就"背景色只有一个"这个假前提。拟合带一次离群剔除（残差 > 40 的环格不参与
 * 二次拟合），防止主体正好贴到边上时把曲面带歪。
 *
 * ── 阈值怎么定的（--tol，默认 45）──────────────────────────────
 * 边缘的抗锯齿"晕"是**主体色与背景色的插值**：一格被主体盖住的比例是 a，
 * 它离背景曲面的距离就约等于 a × |主体色 − 背景色|。实测主体与背景的色距在
 * 120~360 之间，所以：
 *   · 距离 > 45  ⇔ 该格至少被主体盖住 ~35% 以上 → 算主体
 *   · 距离 ≤ 45 ⇔ 该格大部分是背景 → 判为背景，晕被吃掉
 * 这正是用户要的"边缘干净、不留一圈背景色描边"。
 *
 * ⚠️ 阈值不能一味调高：鱼鳍尖、拟饵的钩子都是**细结构**，它们在按格还原时
 * 本来就是弱信号。`--tol` 调到 110 时实测齿蝶鱼的高度从 36 格掉到 28 格
 * —— 掉的全是上下那几片长鳍。所以默认 45，并且脚本每张都会打印
 * "被丢掉的最强背景格"（`丢边最大`），这个数一旦接近 100 就说明啃到主体了。
 *
 * ── 尺寸口径（和 21 张老鱼图标 / 6 张老拟饵图标完全一致）──────────
 *   · 画布固定 64×64
 *   · 主体**1:1** 放进去，不缩放、不重采样 → 5px 格 → 1 个贴图像素
 *   · 居中位置用 `floor((64 − 边长) / 2)`，和 `square-fish.js` 同一个式子
 * 实测现有成品的口径确实是这个（老鱼图标横/纵游程众数都是 1px = 原生像素，
 * 老拟饵图标内容恒为 44×45 @(10,9)），所以这不是"我另定一套规格"。
 *
 * ── 水印 ──────────────────────────────────────────────────────
 * 8 张原图右下角都有一枚工具水印（鱼图上是 3 行字，色距 70+ 所以阈值法抠不掉）。
 * 它和主体**不连通**，所以按连通块处理：只保留"离主体不超过 --gap 格"的块。
 * 鳍尖、须这类真零件即使被阈值切断了也紧贴主体，不会被误删；
 * 水印在 6~20 格开外，必然被丢掉。丢掉的每一块都会打印出来（块大小 + 距主体格数），
 * 便于人眼复核"丢掉的是水印，不是鱼鳍"。
 *
 * 所以 `minBlob` 默认是 **1**：只要还紧贴主体，**一格也算数**。
 * 实测这条例外很值 —— 蝴蝶鱼尾巴那几根飘出来的腹鳍丝（6 格、4 格、2 格）和
 * 振动饵两只三本钩的钩尖（各 1 格）都被阈值切成了独立小块，离主体 0 格。
 * 按"小于 N 格就当噪点"的常规做法会把它们删掉，表现就是"鳍和钩子被啃掉一截"。
 *
 * ── ⛔ 绝不误伤老图标 ──────────────────────────────────────────
 * 本脚本只能写 `TARGETS` 里那 7 个 id 的贴图。清单是硬编码的常量，
 * **不是**扫目录得来的 —— 所以哪怕以后有人加参数、改循环，也写不到别的 id 上。
 * 想写第 9 个 id 必须同时给 `--only=<id>` 和 `--allow=<id>`，且 id 必须在
 * `SOURCES` 里有参考图；给不出参考图就直接报错退出。
 * （上一轮的教训：无条件重跑生成器把 21 张老图标全换成渲染图，
 *   比例基线集体报红。老图标是逐张抠实物照片做的，没有任何脚本能重新生成它们。）
 *
 * ── 用法 ─────────────────────────────────────────────────────
 *   node tools/gen-ref-icons.js                 # 出全部 7 张，并把 7 条鱼的比例基线一起更新
 *   node tools/gen-ref-icons.js --dry           # 只算不写，打印全部参数与前后包围盒
 *   node tools/gen-ref-icons.js --only=guppy    # 只做其中一张（仍受 TARGETS 白名单约束）
 *   node tools/gen-ref-icons.js --tol=guppy=30  # 临时改某一张的阈值（用于对比，不要提交）
 *   node tools/gen-ref-icons.js --preview       # 额外输出 build/ref-icons-preview.png 与对比图
 *   node tools/gen-ref-icons.js --check         # 只比对，不写盘（与 --dry 的区别：会报"是否需要重生成"）
 *
 * ── 原图在哪 ─────────────────────────────────────────────────
 * 用户发来的原图（**只读，本脚本从不修改**）原始路径是：
 *   C:\Users\LENOVO-\.dsh\attachments\v1\objects\<sha256 前 2 位>\<sha256>
 * 文件没有扩展名。为了"换台机器也能重跑"，已经原样拷贝进仓库：
 *   参考资料/新鱼拟饵原图/<id>.png
 * 并且脚本每次都会**校验 sha256**（文件名就是 sha256），对不上直接报错退出 ——
 * 这样"用错图"这件事不可能悄悄发生。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TEXDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const REFDIR = path.join(ROOT, '参考资料/新鱼拟饵原图');
const BASEDIR = path.join(ROOT, '参考资料/鱼图/_baseline');
const BUILDDIR = path.join(ROOT, 'build');
const ATTACH = 'C:/Users/LENOVO-/.dsh/attachments/v1/objects';

const CANVAS = 64;     // 画布边长：和 26 张鱼图标、6 张老拟饵图标一致
const LOGPAD = 26;

// ---------------------------------------------------------------- 参数表
/**
 * 唯一的数据源。id → 参考图（仓库内路径 + 原图 sha256 + 用户原始路径）。
 *
 * 这里是**白名单**：本脚本只会写这 8 个 id。加新条目 = 显式地多认一张参考图。
 */
const SOURCES = {
  // ---- 5 种新鱼的鱼获图标 ----
  african_butterflyfish: {
    sha: '0b9fe487ea20901dd40ade2f6fc5a3c2bbcfb8adcf7388457d139968c8a07f0d',
    ref: '参考资料/新鱼拟饵原图/african_butterflyfish.png',
    orig: ATTACH + '/0b/0b9fe487ea20901dd40ade2f6fc5a3c2bbcfb8adcf7388457d139968c8a07f0d',
  },
  north_african_catfish: {
    sha: 'd38d12b1cbcdac57c23c2ce7d8a1b57c130418d08fe49d652e0423f3f42fda4c',
    ref: '参考资料/新鱼拟饵原图/north_african_catfish.png',
    orig: ATTACH + '/d3/d38d12b1cbcdac57c23c2ce7d8a1b57c130418d08fe49d652e0423f3f42fda4c',
  },
  jewel_cichlid: {
    sha: '8df2a4b9c3b340a989a9c1f5d13aad6eff036e2cce5967429d38a364be4482ff',
    ref: '参考资料/新鱼拟饵原图/jewel_cichlid.png',
    orig: ATTACH + '/8d/8df2a4b9c3b340a989a9c1f5d13aad6eff036e2cce5967429d38a364be4482ff',
  },
  guppy: {
    sha: 'ea0ed7d1e218525d96376eb3dbaa84cd3af8e599b82cbc941d0ff50bd7037bfa',
    ref: '参考资料/新鱼拟饵原图/guppy.png',
    orig: ATTACH + '/ea/ea0ed7d1e218525d96376eb3dbaa84cd3af8e599b82cbc941d0ff50bd7037bfa',
  },
  elephantnose: {
    sha: 'b81e328a4cceaa9ea6d4e2b331d8468a9df6647b62ef442e00cf856c25085bf8',
    ref: '参考资料/新鱼拟饵原图/elephantnose.png',
    orig: ATTACH + '/b8/b81e328a4cceaa9ea6d4e2b331d8468a9df6647b62ef442e00cf856c25085bf8',
  },
  // ---- 用户 2026-10-02 追加的洞穴鱼：金泥鳅 / 盲鱼 ----
  // 这两张是用户在"洞穴只出草鱼青鱼"的反馈之后补的参考图（洞穴鱼种从 2 条扩到 4 条），
  // 原图放在 参考资料/鱼图/新参考/ 下，这里拷贝一份到统一目录，sha256 逐字节校验。
  golden_loach: {
    sha: 'f77297ef822a6c53b972999cfaf4aa52b680cb4abecc3ac5b6f488902ecbec7a',
    ref: '参考资料/新鱼拟饵原图/golden_loach.png',
    orig: '参考资料/鱼图/新参考/金泥鳅.png',
  },
  cave_blindfish: {
    sha: '54001d34f04ca98654cc69073fb4e87444de4980ce3d2c0272071646a8e0d086',
    ref: '参考资料/新鱼拟饵原图/cave_blindfish.png',
    orig: '参考资料/鱼图/新参考/盲鱼.png',
  },
  // ⛔ 拟饵（lure_*）2026-10-04 起**不在这里**。
  //    用户给了 9 张做好的成图（32×64、内容只在上半、透明底、无背景无水印），
  //    上面那条"大图按格还原 + 背景曲面抠图"的路对它们不适用 ——
  //    probeCell 只探 2..8px 的格边长（1:1 的图上探不出来），背景曲面拟合也没有背景可拟合。
  //    它们现在由 tools/gen-lure-icons.js 负责（截上半 + ×2 最近邻 → 64×64）。
  //    原先这里登记过 lure_depthfinder / lure_paddletail / lure_vibration / lure_glowspoon，
  //    保留条目就会在每次构建时把新成图盖回旧图（2026-10-04 踩过一次），所以整条删掉。
};

/** 需要随贴图一起更新比例基线的鱼（check-fish-textures.js / verify-jar.js 在守）。 */
const FISH_IDS = ['african_butterflyfish', 'north_african_catfish', 'jewel_cichlid', 'guppy', 'elephantnose',
  'golden_loach', 'cave_blindfish'];

/** 每张的参数。未列出的走默认值；列出来是为了"参数在代码里一眼可见"。 */
const PARAMS = {
  // 鱼：细长、鳍多、有须/长鳍条 —— 弱信号多，阈值用默认 45
  african_butterflyfish: { tol: 45, gap: 3 },
  north_african_catfish: { tol: 45, gap: 3 },
  jewel_cichlid: { tol: 45, gap: 3 },
  guppy: { tol: 45, gap: 3 },
  elephantnose: { tol: 45, gap: 3 },
  // 洞穴鱼：金泥鳅身上有 5 对须（细结构多），盲鱼整体半透明灰粉、与深背景色距不大，
  // 两头都容易在阈值上调高时被啃掉零件，所以都用默认 45。
  golden_loach: { tol: 45, gap: 3 },
  cave_blindfish: { tol: 45, gap: 3 },
  // 拟饵不在这里（见上面 SOURCES 末尾的说明）：由 tools/gen-lure-icons.js 负责。
};

const TARGETS = Object.keys(SOURCES);

// ---------------------------------------------------------------- 命令行
const argv = process.argv.slice(2);
const hasFlag = (n) => argv.some((a) => a === '--' + n || a.startsWith('--' + n + '='));
const optOf = (n, d) => {
  const h = argv.find((a) => a.startsWith('--' + n + '='));
  return h === undefined ? d : h.slice(n.length + 3);
};
const DRY = hasFlag('dry');
const CHECK = hasFlag('check');
const PREVIEW = hasFlag('preview');
const SOFT = hasFlag('allow-soft');
const ONLY = optOf('only', '').split(',').filter(Boolean);
const ALLOW = optOf('allow', '').split(',').filter(Boolean);
// --tol=id=值 / --tol=值（对全部生效）
const TOL_OVERRIDE = {};
for (const a of argv.filter((x) => x.startsWith('--tol='))) {
  const v = a.slice(6);
  if (v.includes('=')) { const [id, n] = v.split('='); TOL_OVERRIDE[id] = Number(n); }
  else for (const id of TARGETS) TOL_OVERRIDE[id] = Number(v);
}

// ---------------------------------------------------------------- 白名单闸门
// 这是本脚本最重要的十行：**写盘目标只能是 TARGETS**。
// 上一轮的教训是"生成器无条件重跑，把 21 张老图标全换掉"，
// 所以这里不扫目录、不接受任意 id，只认硬编码的 SOURCES。
if (ONLY.length) {
  const unknown = ONLY.filter((x) => !TARGETS.includes(x));
  if (unknown.length) {
    console.error('❌ --only 里有本脚本不认识的 id：' + unknown.join(', '));
    console.error('   本脚本只认这几张参考图：' + TARGETS.join(', '));
    process.exit(2);
  }
}
for (const id of ALLOW) {
  if (!TARGETS.includes(id)) {
    console.error('❌ --allow=' + id + '：SOURCES 里没有它的参考图，拒绝生成。');
    console.error('   要新增一张，请先在 SOURCES 里登记参考图与 sha256 —— 这是故意的。');
    process.exit(2);
  }
}
const jobs = (ONLY.length ? ONLY : TARGETS).filter((id) => true);

// ---------------------------------------------------------------- PNG 工具
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readSource(id) {
  const s = SOURCES[id];
  const local = path.join(ROOT, s.ref);
  let file = local, buf = null;
  if (fs.existsSync(local)) buf = fs.readFileSync(local);
  else if (fs.existsSync(s.orig)) { file = s.orig; buf = fs.readFileSync(s.orig); }
  else {
    console.error('❌ ' + id + '：找不到参考图\n   仓库内 ' + local + '\n   原图   ' + s.orig);
    process.exit(1);
  }
  const got = sha256(buf);
  if (got !== s.sha) {
    console.error('❌ ' + id + '：参考图 sha256 不符，拒绝用它生成。\n   期望 ' + s.sha + '\n   实际 ' + got);
    console.error('   （文件：' + file + '）');
    process.exit(1);
  }
  return { img: decodePng(buf), file, bytes: buf.length };
}

// ---------------------------------------------------------------- 按格还原
/** 取格内**全部**像素的中位数。参考图每 5×5 块完全同色，所以这是无损还原。 */
function cellGrid(img, cell) {
  const { w, h, rgba } = img;
  const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const G = [];
  for (let gy = 0; gy < gh; gy++) {
    const row = [];
    for (let gx = 0; gx < gw; gx++) {
      const rs = [], gs = [], bs = [];
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const i = ((gy * cell + y) * w + (gx * cell + x)) * 4;
          rs.push(rgba[i]); gs.push(rgba[i + 1]); bs.push(rgba[i + 2]);
        }
      }
      row.push([med(rs), med(gs), med(bs)]);
    }
    G.push(row);
  }
  return { G, gw, gh };
}

/**
 * 断言"这张图确实是 cell×cell 最近邻放大的"——**直接验证每块是否恒定**，
 * 而不是去猜格边长。
 *
 * 为什么不用 `detect-grid.js` 那套"游程 GCD"：它要求背景是**一块纯色**
 * （游程才只出现在格子边界上）。这 8 张的背景是渐变，沿着行每几个像素就变一点，
 * 于是游程里混进 1、2、3 这种长度，GCD 立刻塌成 1，量出来"格边长 = 1px"。
 * 实测踩过这个坑。
 *
 * 而本脚本真正依赖的性质只有一条：**格内像素完全同色**（那样取中位数才是无损还原）。
 * 那就直接验它：扫描每个 cell×cell 块，看块内单通道最大偏差。
 * 顺手报出别的候选边长，万一哪天真换了参考图，报错信息直接告诉人该写几。
 *
 * ⚠️ 参考图是 331×331，**不能被 5 整除**（331 = 5×66 + 1）。所以只验
 * `floor(w/cell)` 这一段能被格边界整除的区域；右下多出来的 1px 亮条单独量一下：
 * 它等于相邻格色说明只是"最后一个格子被裁掉一角"（无害），
 * 差得多才需要人过问。
 */
function probeCell(img, cell) {
  const { w, h, rgba } = img;
  const chAt = (x, y, c) => rgba[(y * w + x) * 4 + c];
  const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
  /** 在 [0, gw*cell) × [0, gh*cell) 上扫描块内单通道最大偏差（>8 就早退）。 */
  const devOf = (n) => {
    let maxDev = 0;
    const gn = Math.floor(w / n), gm = Math.floor(h / n);
    for (let by = 0; by < gm; by++) {
      for (let bx = 0; bx < gn; bx++) {
        for (let c = 0; c < 3; c++) {
          const v0 = chAt(bx * n, by * n, c);
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
              const d = Math.abs(chAt(bx * n + x, by * n + y, c) - v0);
              if (d > maxDev) maxDev = d;
              if (maxDev > 8) return maxDev;
            }
          }
        }
      }
    }
    return maxDev;
  };
  // 右下余边（不足一格的那一条）与相邻整格的色差
  let rimDev = 0;
  for (let y = 0; y < gh * cell; y++) for (let c = 0; c < 3; c++) {
    for (let x = gw * cell; x < w; x++) rimDev = Math.max(rimDev, Math.abs(chAt(x, y, c) - chAt(gw * cell - 1, y, c)));
  }
  for (let x = 0; x < gw * cell; x++) for (let c = 0; c < 3; c++) {
    for (let y = gh * cell; y < h; y++) rimDev = Math.max(rimDev, Math.abs(chAt(x, y, c) - chAt(x, gh * cell - 1, c)));
  }
  const dev = gw > 0 && gh > 0 ? devOf(cell) : Infinity;
  const candidates = [];
  for (let n = 2; n <= 8; n++) if (devOf(n) === 0) candidates.push(n);
  return { dev, rimDev, gw, gh, candidates, rim: [w - gw * cell, h - gh * cell] };
}

// ---------------------------------------------------------------- 背景曲面
/**
 * 外圈 `ring` 格环做二次多项式最小二乘，得到"背景色随位置怎么变"。
 * 带一次离群剔除：第一次拟合后残差 > 40 的环格不参与第二次拟合。
 * 为什么需要：万一主体贴到边上（或角上有水印），那些格会把曲面带歪，
 * 而后面的阈值判定全都建立在这张曲面上。
 */
function fitBackground(G, gw, gh, ring) {
  const T = (x, y) => [1, x, y, x * x, x * y, y * y];
  const ringCells = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (x < ring || y < ring || x >= gw - ring || y >= gh - ring) ringCells.push([x, y]);
    }
  }
  const solve = (samples, ch) => {
    const n = 6;
    const A = new Float64Array(n * n), b = new Float64Array(n);
    for (const [x, y] of samples) {
      const t = T(x, y), v = G[y][x][ch];
      for (let i = 0; i < n; i++) { b[i] += t[i] * v; for (let j = 0; j < n; j++) A[i * n + j] += t[i] * t[j]; }
    }
    const M = [];
    for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < n; j++) r.push(A[i * n + j]); r.push(b[i]); M.push(r); }
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      const t = M[c]; M[c] = M[p]; M[p] = t;
      if (Math.abs(M[c][c]) < 1e-12) continue;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : r[n] / M[i][i]));
  };
  let C = [solve(ringCells, 0), solve(ringCells, 1), solve(ringCells, 2)];
  const at = (x, y) => { const t = T(x, y); return C.map((c) => t.reduce((s, v, i) => s + v * c[i], 0)); };
  const kept = ringCells.filter(([x, y]) => {
    const b = at(x, y), c = G[y][x];
    return Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]) <= 40;
  });
  const rejected = ringCells.length - kept.length;
  if (kept.length >= 12 && rejected > 0) C = [solve(kept, 0), solve(kept, 1), solve(kept, 2)];
  return {
    at: (x, y) => { const t = T(x, y); return C.map((c) => t.reduce((s, v, i) => s + v * c[i], 0)); },
    ring: ringCells.length, rejected,
    corner: at(0, 0), cornerBR: at(gw - 1, gh - 1),
  };
}

/** 4/8 邻接连通块。 */
function components(grid, gw, gh, conn) {
  const DIRS = conn === 8
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const lab = new Int32Array(gw * gh).fill(-1);
  const out = [];
  for (let s = 0; s < gw * gh; s++) {
    if (grid[s] !== 1 || lab[s] >= 0) continue;
    const id = out.length;
    const cells = [];
    const st = [s];
    lab[s] = id;
    while (st.length) {
      const i = st.pop();
      cells.push(i);
      const x = i % gw, y = (i / gw) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (lab[j] >= 0 || grid[j] !== 1) continue;
        lab[j] = id;
        st.push(j);
      }
    }
    out.push(cells);
  }
  return out;
}

const bboxOf = (cells, gw) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const i of cells) {
    const x = i % gw, y = (i / gw) | 0;
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

/** 两块之间的切比雪夫间距（格）。0 = 有格子直接相邻。 */
function gapBetween(a, b, gw) {
  const A = bboxOf(a, gw), B = bboxOf(b, gw);
  const dx = Math.max(0, Math.max(B.x0 - A.x1, A.x0 - B.x1) - 1);
  const dy = Math.max(0, Math.max(B.y0 - A.y1, A.y0 - B.y1) - 1);
  return Math.max(dx, dy);
}

// ---------------------------------------------------------------- 单张
function build(id) {
  const p = Object.assign({ cell: 5, tol: 45, gap: 3, minBlob: 1, ring: 2 }, PARAMS[id] || {});
  if (TOL_OVERRIDE[id] !== undefined) p.tol = TOL_OVERRIDE[id];
  const src = readSource(id);
  const img = src.img;

  // ① 断言"这确实是 cell×cell 的马赛克"（本脚本的无损还原全靠这条性质）
  const pc = probeCell(img, p.cell);
  if (pc.dev > (SOFT ? 40 : 0)) {
    console.error('❌ ' + id + '：这张参考图不是 ' + p.cell + 'px 马赛克，按格取样会毁掉整张图。');
    console.error('   尺寸 ' + img.w + 'x' + img.h + '，按 ' + p.cell + 'px 切块后块内单通道最大偏差 = '
      + (pc.dev === Infinity ? '—' : pc.dev) + '（无损还原要求 0）');
    console.error('   实测块内完全同色的候选边长：' + (pc.candidates.length ? pc.candidates.join(', ') : '无'));
    console.error('   参考图确实不是马赛克（比如实拍照片）时，加 --allow-soft 可降级为警告。');
    process.exit(1);
  }
  if (pc.dev !== 0) console.log('   ⚠ ' + id + '：块内最大偏差 ' + pc.dev + '（--allow-soft 放行，还原不再是无损的）');
  const rimNote = (pc.rim[0] || pc.rim[1])
    ? '，右下余边 ' + pc.rim[0] + '+' + pc.rim[1] + 'px（与相邻格色差 ' + pc.rimDev + '）'
    : '';

  // ② 按格还原
  const { G, gw, gh } = cellGrid(img, p.cell);

  // ③ 背景曲面 + 逐格色距
  const fit = fitBackground(G, gw, gh, p.ring);
  const dist = [];
  const edgeDropped = [];   // 被丢掉、但紧贴主体的背景格（用来量"晕"有多强、有没有啃到主体）
  for (let y = 0; y < gh; y++) {
    const row = [];
    for (let x = 0; x < gw; x++) {
      const b = fit.at(x, y), c = G[y][x];
      row.push(Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    }
    dist.push(row);
  }

  // ④ 阈值 → 连通块 → 只留主体附近的块（水印在远处）
  const flat = new Int32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) flat[y * gw + x] = dist[y][x] > p.tol ? 1 : 0;
  let comps = components(flat, gw, gh, 4);
  comps.sort((a, b) => b.length - a.length);
  if (!comps.length) throw new Error(id + '：阈值 ' + p.tol + ' 下一个前景格都没有');

  const main = comps[0];
  const kept = [main];
  const dropped = [];
  for (let i = 1; i < comps.length; i++) {
    const c = comps[i];
    const gap = gapBetween(c, main, gw);
    if (gap <= p.gap && c.length >= p.minBlob) kept.push(c);
    else dropped.push({ n: c.length, gap, bbox: bboxOf(c, gw) });
  }
  const mainBB = bboxOf(main, gw);
  const keptInfo = kept.slice(1).map((c) => {
    const b = bboxOf(c, gw);
    return c.length + '格@(' + b.x0 + ',' + b.y0 + ')';
  }).join('，');

  // 把"保留下来的块"重新合成掩膜
  const mask = new Int32Array(gw * gh);
  for (const c of kept) for (const i of c) mask[i] = 1;

  // ⑤ 裁到主体包围盒
  const all = [];
  for (let i = 0; i < gw * gh; i++) if (mask[i]) all.push(i);
  const bb = bboxOf(all, gw);

  // ⑥ 量一下边缘：紧贴前景、却因为阈值被判成背景的格，最大色距是多少
  for (let y = bb.y0 - 1; y <= bb.y1 + 1; y++) {
    for (let x = bb.x0 - 1; x <= bb.x1 + 1; x++) {
      if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
      if (mask[y * gw + x]) continue;
      let touch = false;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        if (mask[ny * gw + nx]) { touch = true; break; }
      }
      if (touch) edgeDropped.push(dist[y][x]);
    }
  }
  const edgeMax = edgeDropped.length ? Math.max(...edgeDropped) : 0;

  // ⑦ 放进 64×64（1:1，居中；和 square-fish.js 同一个居中式子）
  if (bb.w > CANVAS || bb.h > CANVAS) {
    throw new Error(id + '：主体 ' + bb.w + 'x' + bb.h + ' 放不进 ' + CANVAS + 'x' + CANVAS
      + '。不要偷偷缩小（会毁掉 1px 硬边），请先看参考图是不是框太大了。');
  }
  const ox = Math.floor((CANVAS - bb.w) / 2);
  const oy = Math.floor((CANVAS - bb.h) / 2);
  const out = Buffer.alloc(CANVAS * CANVAS * 4);
  for (let y = 0; y < bb.h; y++) {
    for (let x = 0; x < bb.w; x++) {
      const gx = bb.x0 + x, gy = bb.y0 + y;
      if (!mask[gy * gw + gx]) continue;
      const c = G[gy][gx];
      const o = ((y + oy) * CANVAS + (x + ox)) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }

  // ⑧ 自检：写出来的画布里，前景包围盒必须正好是 bb.w × bb.h（没被裁、没被丢）
  let cx0 = CANVAS, cy0 = CANVAS, cx1 = -1, cy1 = -1, fg = 0;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      if (out[(y * CANVAS + x) * 4 + 3] === 0) continue;
      fg++;
      if (x < cx0) cx0 = x; if (y < cy0) cy0 = y;
      if (x > cx1) cx1 = x; if (y > cy1) cy1 = y;
    }
  }
  const okBox = (cx1 - cx0 + 1) === bb.w && (cy1 - cy0 + 1) === bb.h;
  const okPos = cx0 === ox && cy0 === oy;

  return {
    id, img, src, cell: p.cell, tol: p.tol, gap: p.gap, rimNote, mainBB, keptInfo,
    gw, gh, fit, dist, bb, ox, oy, out, fg,
    kept: kept.length, dropped, edgeMax,
    mainCells: main.length,
    okBox, okPos,
  };
}

// ---------------------------------------------------------------- 主流程
fs.mkdirSync(BUILDDIR, { recursive: true });
if (!DRY && !CHECK) fs.mkdirSync(TEXDIR, { recursive: true });

console.log('=== 参考图 → 贴图（按格还原 + 背景曲面抠图 + 1:1 居中）===');
console.log('画布 ' + CANVAS + 'x' + CANVAS + '，白名单 ' + TARGETS.length + ' 个 id：' + TARGETS.join(', '));
console.log('');

const results = [];
let changed = 0, wrote = 0;
let bad = 0;

for (const id of jobs) {
  let r;
  try { r = build(id); }
  catch (e) { console.error('❌ ' + id + '：' + e.message); bad++; continue; }
  results.push(r);

  console.log('── ' + id);
  console.log('   参考图      ' + path.relative(ROOT, r.src.file).replace(/\\/g, '/')
    + '  ' + r.img.w + 'x' + r.img.h + '  ' + r.src.bytes + ' 字节  sha256 校验通过');
  console.log('   格边长      ' + r.cell + 'px（块内完全同色，断言通过）  →  网格 ' + r.gw + 'x' + r.gh + r.rimNote);
  console.log('   背景曲面    外圈 ' + r.fit.ring + ' 格拟合，剔除离群 ' + r.fit.rejected
    + ' 格；角 ' + r.fit.corner.map((v) => Math.round(v)).join(',')
    + ' → 右下 ' + r.fit.cornerBR.map((v) => Math.round(v)).join(','));
  console.log('   抠图阈值    tol=' + r.tol + '（色距 > ' + r.tol + ' 判为主体）');
  console.log('   抠图后包围盒 ' + r.bb.w + 'x' + r.bb.h + ' 格 @(' + r.bb.x0 + ',' + r.bb.y0 + ')'
    + '  主体 ' + r.mainCells + ' 格，额外保留 ' + (r.kept - 1) + ' 块'
    + (r.kept > 1 ? '（' + r.keptInfo + '）' : ''));
  console.log('   丢边最大    ' + r.edgeMax.toFixed(1) + ' / ' + r.tol
    + '（被丢掉的最强背景格；越接近阈值说明越贴边，>100 就要怀疑啃到主体）');
  if (r.dropped.length) {
    // 丢掉的多半是水印；打印出来才能人眼确认"丢的是水印不是鳍"
    const d = r.dropped.sort((a, b) => b.n - a.n).slice(0, 6)
      .map((c) => c.n + '格@距主体' + c.gap + ' @(' + c.bbox.x0 + ',' + c.bbox.y0 + ')');
    console.log('   丢弃块      ' + r.dropped.length + ' 个：' + d.join('，')
      + (r.dropped.length > 6 ? ' …' : ''));
  } else {
    console.log('   丢弃块      无');
  }
  console.log('   最终        64x64，主体 ' + r.bb.w + 'x' + r.bb.h + ' 居中 @(' + r.ox + ',' + r.oy + ')'
    + '，留白 左' + r.ox + ' 右' + (CANVAS - r.bb.w - r.ox) + ' 上' + r.oy + ' 下' + (CANVAS - r.bb.h - r.oy)
    + '，不透明 ' + r.fg + ' 像素');
  console.log('   自检        包围盒 ' + (r.okBox ? '✅' : '❌') + '  居中位置 ' + (r.okPos ? '✅' : '❌'));
  if (!r.okBox || !r.okPos) bad++;

  // 写贴图
  const file = path.join(TEXDIR, id + '.png');
  const buf = encodePng(CANVAS, CANVAS, r.out);
  const old = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (old && old.equals(buf)) {
    console.log('   贴图        = 与生成结果一致（未改动）');
  } else {
    changed++;
    if (DRY) console.log('   贴图        [--dry] 需要重写 ' + path.relative(ROOT, file));
    else if (CHECK) { console.log('   贴图        ✗ 与生成结果不一致 ' + path.relative(ROOT, file)); }
    else {
      fs.writeFileSync(file, buf);
      wrote++;
      console.log('   贴图        ✎ ' + path.relative(ROOT, file).replace(/\\/g, '/')
        + (old === null ? '（新建）' : '（更新，原 ' + old.length + ' 字节 → ' + buf.length + ' 字节）'));
    }
  }
  console.log('');
}

// ---------------------------------------------------------------- 比例基线
// 只更新**这 5 条鱼**的基线。⚠ 绝不调 freeze-fish-baseline.js —— 它会把
// fish-list.js 里 26 个 id 全刷一遍，等于顺手给 21 张老图标"重新盖章"，
// 那样基线就再也守不住"老图标有没有被无意改坏"了。
if (results.length) {
  const fish = results.filter((r) => FISH_IDS.includes(r.id));
  if (fish.length) {
    console.log('=== 比例基线（check-fish-textures.js / verify-jar.js 守的是"贴图别被无意改坏"）===');
    if (!DRY && !CHECK) fs.mkdirSync(BASEDIR, { recursive: true });
    for (const r of fish) {
      const bp = path.join(BASEDIR, r.id + '.json');
      const oldTxt = fs.existsSync(bp) ? fs.readFileSync(bp, 'utf8') : null;
      const oldJson = oldTxt ? JSON.parse(oldTxt) : null;
      const rec = { w: r.bb.w, h: r.bb.h, ar: r.bb.w / r.bb.h, canvas: [CANVAS, CANVAS] };
      const txt = JSON.stringify(rec, null, 2) + '\n';
      if (oldTxt === txt) {
        console.log('   ' + r.id.padEnd(LOGPAD) + '基线不变 ' + r.bb.w + 'x' + r.bb.h
          + '  比例 ' + rec.ar.toFixed(3));
      } else if (DRY || CHECK) {
        console.log('   ' + r.id.padEnd(LOGPAD) + '[--dry/--check] 基线需改写：'
          + (oldJson ? oldJson.w + 'x' + oldJson.h + ' 比例 ' + oldJson.ar.toFixed(3) + ' → ' : '（无）→ ')
          + r.bb.w + 'x' + r.bb.h + ' 比例 ' + rec.ar.toFixed(3));
        if (CHECK) changed++;
      } else {
        fs.writeFileSync(bp, txt);
        console.log('   ' + r.id.padEnd(LOGPAD) + '✎ 基线更新 '
          + (oldJson ? oldJson.w + 'x' + oldJson.h + ' 比例 ' + oldJson.ar.toFixed(3) + ' → ' : '（原无基线）→ ')
          + r.bb.w + 'x' + r.bb.h + ' 比例 ' + rec.ar.toFixed(3));
      }
    }
    const others = require('./fish-list.js').filter((x) => !FISH_IDS.includes(x));
    console.log('   （其余 ' + others.length + ' 条鱼的基线未触碰 —— 它们不是本脚本的产出）');
    console.log('');
  }
}

// ---------------------------------------------------------------- 预览图
if (PREVIEW && results.length) {
  const SC = 6, COLS = 4;
  const rows = Math.ceil(results.length / COLS);
  const CW = CANVAS * SC, CH = CANVAS * SC;
  const W = COLS * CW, H = rows * CH;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 24; buf[i * 4 + 1] = 24; buf[i * 4 + 2] = 28; buf[i * 4 + 3] = 255; }
  results.forEach((r, i) => {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const sx = Math.floor(x / SC), sy = Math.floor(y / SC);
        const s = (sy * CANVAS + sx) * 4;
        if (r.out[s + 3] === 0) continue;
        const d = ((cy + y) * W + (cx + x)) * 4;
        buf[d] = r.out[s]; buf[d + 1] = r.out[s + 1]; buf[d + 2] = r.out[s + 2]; buf[d + 3] = 255;
      }
    }
    // 每格左下角画一条分隔线
    for (let y = 0; y < CH; y++) for (const x of [0, 1]) {
      const d = ((cy + y) * W + (cx + x)) * 4;
      buf[d] = 90; buf[d + 1] = 90; buf[d + 2] = 100; buf[d + 3] = 255;
    }
    for (let x = 0; x < CW; x++) for (const y of [0, 1]) {
      const d = ((cy + y) * W + (cx + x)) * 4;
      buf[d] = 90; buf[d + 1] = 90; buf[d + 2] = 100; buf[d + 3] = 255;
    }
  });
  fs.writeFileSync(path.join(BUILDDIR, 'ref-icons-preview.png'), encodePng(W, H, buf));
  console.log('预览 → build/ref-icons-preview.png（' + SC + '×，顺序 ' + results.map((r) => r.id).join(', ') + '）');
  console.log('');
}

// ---------------------------------------------------------------- 收尾
if (bad) {
  console.error('❌ ' + bad + ' 张自检没过，别提交。');
  process.exit(1);
}
const n = results.length;
if (DRY) console.log('✅ [--dry] 算完 ' + n + ' 张，' + changed + ' 张与生成结果不同（没有写盘）');
else if (CHECK) {
  console.log(changed === 0
    ? '✅ ' + n + ' 张贴图与生成结果一致（含基线）'
    : '❌ 有 ' + changed + ' 处需要重新生成');
  process.exitCode = changed === 0 ? 0 : 1;
} else console.log('✅ ' + n + ' 张贴图：' + wrote + ' 个文件变更'
  + (n !== TARGETS.length ? '（本次只跑了 ' + n + '/' + TARGETS.length + ' 个 id）' : ''));
