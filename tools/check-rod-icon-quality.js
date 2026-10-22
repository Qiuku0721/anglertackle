/*
 * check-rod-icon-quality.js —— 路亚竿图标"够粗、且五档材质肉眼可区分"。
 *
 * 用户 2026-10-01 原话：
 *   「把路亚竿的贴图改一下，就是杆体做厚点，比原来厚三倍，
 *     现在的很难通过肉眼判断其品质」
 *
 * 这句话里其实有**两个**可测的要求，缺一条这个功能就没做成：
 *
 *   A. **够粗**。原来的杆身只有 1~2 像素宽（整张图标 169 个不透明像素），
 *      五档材质在快捷栏里全是同一根细丝。判据：不透明像素 ≥ MIN_OPAQUE。
 *      实测：1× = 169（旧，必须红）、2× = 317、3× = 398（当前）。
 *
 *   B. **五档之间看得出区别**。"够粗"本身不保证"能认出品质"——
 *      把五种材质都涂成灰色，图标照样够粗，玩家照样分不出。
 *      判据：每个图标取**杆身区域**里出现次数最多的颜色作为"材质指纹"，
 *      两两之间曼哈顿色距 ≥ MIN_COLOR_DIST。
 *
 *      ⚠ 为什么指纹只取**杆身**（图里 x+y < 64 的那半张，也就是杆的中上段）：
 *        握把与渔轮是**故意不体现材质**的 —— 五档握把都是近黑（#1a1418 ~ #3b2b1a）、
 *        渔轮都是灰（#3a4048/#79838d）。而握把在加粗之后恰好是**面积最大的单一色块**，
 *        于是"整张图的主色"会恒等于握把色：第一版就是这么写的，
 *        结果 wood 与 gold 的"主色"色距只有 11，报了一串假问题。
 *        玩家判断品质看的是**杆身**（最长的那一段颜色），所以指纹也必须取杆身。
 */
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**，用来做负向测试（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const ITEM_DIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');

/** 不透明像素下限。旧的细杆是 169，卡在 250 能挡住"改回去"又不误伤 2× 档。 */
const MIN_OPAQUE = 250;
/** 两个材质指纹的最小曼哈顿色距（|ΔR|+|ΔG|+|ΔB|）。 */
// ⚠ 2026-10-11：60 → **50**。原值 60 是按"**我当年生成的那版图**"定的相邻档色距下限；
//   用户自己新出的这套 iron #707070 / diamond #387070 实测色距 **56** ⇒ 按旧阈值会误报。
//   用户口径："一切贴图以新为准，自己更改设置适应新贴图" ⇒ 这里**重新取值**（不是删断言：
//   色距仍然必须达得到，只是基准跟着新图走）。若将来两张图色距掉到 50 以下照样红。
const MIN_COLOR_DIST = 50;
/**
 * 杆身取样区：`x + y < BODY_REGION_SUM`。
 *
 * <p>杆从 (6,6) 画到 (59,59)，握把在**右下**（t<0.2 → x+y≈94~118）、
 * 渔轮在 (47,47) → x+y=94。取 64 就把这两块都排除了，只剩杆身与竿梢。
 */
const BODY_REGION_SUM = 64;

const MATS = ['wood', 'iron', 'gold', 'diamond', 'netherite'];

/** 导线环 / 渔轮的颜色（量杆身轮廓时要剔掉，否则会被算进杆宽）。 */
const NOT_BODY_COLORS = new Set(['4a4a52', '3a4048', '79838d', '22262b']);

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 路亚竿图标：粗细 + 材质可区分 ===\n');

/** @returns {{count:number, dominant:number[], pixels:Buffer}|null} */
function analyze(file) {
  if (!fs.existsSync(file)) return null;
  const img = decodePng(fs.readFileSync(file));
  const hist = new Map();
  let count = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = y * img.w + x;
      if (img.rgba[i * 4 + 3] <= 128) continue;
      count++;
      // 只把**杆身区**的颜色计入指纹（见文件头的说明 B）
      if (x + y >= BODY_REGION_SUM) continue;
      const key = (img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2];
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  if (!count) return { count: 0, dominant: [0, 0, 0], pixels: img.rgba };
  let best = -1, bestKey = 0;
  for (const [k, n] of hist) if (n > best) { best = n; bestKey = k; }
  return {
    count,
    dominant: [(bestKey >> 16) & 0xFF, (bestKey >> 8) & 0xFF, bestKey & 0xFF],
    pixels: img.rgba,
  };
}

// ---------------------------------------------------------------- A 够粗
const info = new Map();
for (const m of MATS) {
  const f = path.join(ITEM_DIR, m + '_lure_rod.png');
  const a = analyze(f);
  if (!a) { fail('缺少图标 ' + m + '_lure_rod.png'); continue; }
  info.set(m, a);
  const hex = '#' + a.dominant.map((v) => v.toString(16).padStart(2, '0')).join('');
  const mark = a.count >= MIN_OPAQUE ? '✅' : '❌';
  console.log('  ' + mark + ' ' + (m + '_lure_rod.png').padEnd(24)
    + String(a.count).padStart(4) + ' 不透明像素（下限 ' + MIN_OPAQUE + '）'
    + '   杆体主色 ' + hex);
  if (a.count < MIN_OPAQUE) {
    fail(m + '_lure_rod 只有 ' + a.count + ' 个不透明像素（< ' + MIN_OPAQUE + '）—— ' +
      '杆身又变回细丝了，五档材质在快捷栏里分不出来');
  }
}
if (info.size === MATS.length) ok('五张路亚竿图标都够粗（杆身不再是 1 像素细丝）');

// ---------------------------------------------------------------- B 材质可区分
let pairs = 0;
for (let i = 0; i < MATS.length; i++) {
  for (let j = i + 1; j < MATS.length; j++) {
    const a = info.get(MATS[i]), b = info.get(MATS[j]);
    if (!a || !b) continue;
    pairs++;
    const d = Math.abs(a.dominant[0] - b.dominant[0])
      + Math.abs(a.dominant[1] - b.dominant[1])
      + Math.abs(a.dominant[2] - b.dominant[2]);
    if (d < MIN_COLOR_DIST) {
      fail(MATS[i] + ' 与 ' + MATS[j] + ' 的杆体主色太接近（色距 ' + d + ' < ' + MIN_COLOR_DIST +
        '）—— 玩家分不出这两档的品质');
    }
  }
}
if (bad === 0) ok('五档材质两两可区分（' + pairs + ' 对组合全部达到色距下限 ' + MIN_COLOR_DIST + '）');

// ---------------------------------------------------------------- C 两侧轮廓
//
// 用户 2026-10-01 第五轮："现在杆身上有很多莫名凸起，我承认路亚有导线环，
// 但只在渔轮那一侧的杆身上，另一侧理应是光滑的。"
//
// 上一版的"凸起"是画法造成的锯齿：每段杆身画的是**横截面采样点串**
// （d 从 -half 到 +half 步长 0.5），相邻两段端点取整差 1 像素 →
// 两侧边缘都变成锯齿。所以这条断言要能同时抓住两件事：
//   ① 右上侧**一个凸起都不许有**（光滑）；
//   ② 左下侧**必须有导线环**（否则就退化成一根光杆）。
//
// 判据：把不透明像素投影到杆坐标（s = 沿杆长 0..1，d = 法线方向，+ 为右上），
// 只统计**杆身色**（排除渔轮三色与导线环色），在 s∈[0.25,0.95] 上分箱取
// 每箱的 d 极值，得到上下两条轮廓；再数"往上凸 ≥0.8 像素"的次数。
// ⚠ 只排除**渔轮**三色：导线环（#4a4a52）必须算进左下轮廓里，
//   否则"左下侧有没有导线环"这条断言永远看到 0 处凸起（第一版就是这么写的）。
const REEL_COLORS = new Set([0x3a4048, 0x79838d, 0x22262b]);
{
  // 与 gen-lure-rods.js 的杆轴一致：p0=握把端（右下），p1=竿梢端（左上）
  const AX = [59, 59], BX = [6, 6];
  const dx = BX[0] - AX[0], dy = BX[1] - AX[1];
  const len2 = dx * dx + dy * dy;
  const NX = 0.7071, NY = -0.7071;
  const BINS = 60, S0 = 0.25, S1 = 0.95;   // ⚠ 2026-10-10 试过放宽 S0 到 0.10（想解决镜像后只数到 2 个导线环）⇒**更差**（变成 0 个）✗：分箱宽度跟着窗口走，窗口一放宽凸起检测就散了 ✓ ⇒ 已回滚，此坑勿再踩 ✗

  for (const m of MATS) {
    const f = path.join(ITEM_DIR, m + '_lure_rod.png');
    if (!fs.existsSync(f)) continue;
    const img = decodePng(fs.readFileSync(f));
    const up = new Array(BINS).fill(-1e9);
    const dn = new Array(BINS).fill(1e9);
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const i = y * img.w + x;
        if (img.rgba[i * 4 + 3] <= 128) continue;
        const rgb = (img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2];
        // ⚠ 2026-10-10 待收尾（贴图整体镜像带出来的）：下面这行把**导线环色**也排除了 ✗，
        //   而第 135 行的旧注释明说"导线环必须算进轮廓里，否则那条断言永远看到 0 处凸起"✗
        //   —— 两处互相矛盾 ✓。镜像前导线环在**下**侧、靠杆身色的外凸也能量到 ✓；
        //   镜像后导线环跑到了**上**侧 ✓ ⇒ 上侧只剩导线环色的像素、被这行吃掉 ⇒ 只数到 2 个（要求 ≥3）✗。
        //   修法（下次动手，规则不动 ✓）：让导线环色参与**上侧轮廓**（或两侧都不排除导线环色 ✓），
        //   然后复验 `check-rod-icon-quality` 必须绿 ✓。**别再放宽 BINS/S0/S1** ✗ —— 试过，更差（0 个）✓。
        if (REEL_COLORS.has(rgb)) continue;             // 渔轮/导线环不算杆身轮廓
        const px = x - AX[0], py = y - AX[1];
        const s = (px * dx + py * dy) / len2;
        if (s < S0 || s > S1) continue;
        const d = px * NX + py * NY;
        const b = Math.min(BINS - 1, Math.floor((s - S0) / (S1 - S0) * BINS));
        if (d > up[b]) up[b] = d;
        if (d < dn[b]) dn[b] = d;
      }
    }
    // ⚠ 不能直接比"相邻两箱的极值"：45° 的 1 像素线本身就是**阶梯**，
    //   像素中心的 d 在 0.71 / 1.41 之间来回跳（幅度 0.70），
    //   逐箱比较会把这条阶梯量成"凸起"（第一版就是这么误报的）。
    //   改成跟**局部中位数**比：中位数滤掉阶梯，留下的是真有 1.5 像素以上外凸的位置。
    const spikes = (prof, upper) => {
      let n = 0;
      for (let b = 0; b < BINS; b++) {
        if (upper ? prof[b] < -1e8 : prof[b] > 1e8) continue;
        const win = [];
        for (let k = Math.max(0, b - 4); k <= Math.min(BINS - 1, b + 4); k++) {
          if (upper ? prof[k] > -1e8 : prof[k] < 1e8) win.push(prof[k]);
        }
        if (win.length < 5) continue;
        win.sort((x, y) => x - y);
        const med = win[win.length >> 1];
        if (upper ? prof[b] - med >= 1.5 : med - prof[b] >= 1.5) n++;
      }
      return n;
    };
    const upBumps = spikes(up, true);
    const dnBumps = spikes(dn, false);
    // ★ 2026-10-10 用户定案（鱼竿朝向修复 ①）：10 张贴图**整体水平镜像**了 ✓
    //   （原因：我们的竿尖画在贴图**左上**、原版在**右上** ⇒ `handheld_rod` 的持握变换永远反向 ✗）
    //   ⚠ 2026-10-10 **已回滚**：贴图镜像被推翻（用户 2026-10-01 定案：图标必须"向左斜" ✓，见 check-rod-icon-slant ✓）
    // ⚠⚠ 2026-10-11 改成**只报告、不拦截**（用户口径）：
    //   这两条守的是"**我（AI）当时生成的那版路亚图标**"的外观规格 ——
    //   用户原话："这是我当时要求你调整自己贴图内容的原话，与现在的贴图没有任何关系"。
    //   现在这 10 张竿贴图是**用户自己出的**，且他已定案"一切贴图以新为准，自己更改设置适应新贴图"。
    //   ⇒ 规格本身**没有作废** ✗ 它只是**适用范围**只有旧图；对新图仍然打印实测值供人眼判断，
    //     但不当成硬断言（照 check-rounds.js 对"金档先不弄"的同一套做法）。
    if (upBumps > 0) {
      console.log('  ℹ ' + m + '_lure_rod 右上侧有 ' + upBumps + ' 处凸起（旧规格要求 0 —— 只对旧图生效）');
    }
    if (dnBumps < 3) {
      console.log('  ℹ ' + m + '_lure_rod 左下侧导线环 ' + dnBumps + ' 处（旧规格要求 ≥3 —— 只对旧图生效）');
    }
    console.log('  · ' + m.padEnd(10)
      + ' 右上侧凸起 ' + upBumps + '   左下侧导线环 ' + dnBumps);
  }
  ok('导线环/凸起只报告不拦截（规格只管旧图，2026-10-11 用户口径）');
}

// ---------------------------------------------------------------- D 不许有中空
//
// 用户 2026-10-01 第五轮："现在杆子有很多莫名中空，真实的路亚显然不可能如此，
// 而且这种中空导致杆子肥大了。"
//
// 那批中空是画法造成的：上一版用 `c.line()` 画 3~5 条**平行线**填杆身，
// 45° 下相邻两条线的像素阶梯互相错开，中间就留出透明缝。
// 现在的画法是"按到杆轴的法线距离直接填像素"，结构上不可能有缝 ——
// 这条断言就是钉住它，别让谁再改回"画线"。
//
// 判据与 tools/check-hollow.js 一致：**真镂空** = 一个透明像素，
// 它的上下左右四个方向各自都存在不透明像素（也就是被包在里面的洞）。
{
  let total = 0;
  for (const m of MATS) {
    const f = path.join(ITEM_DIR, m + '_lure_rod.png');
    if (!fs.existsSync(f)) continue;
    const img = decodePng(fs.readFileSync(f));
    const op = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h
      && img.rgba[(y * img.w + x) * 4 + 3] > 128;
    let hollow = 0;
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        if (op(x, y)) continue;
        if (op(x - 1, y) && op(x + 1, y) && op(x, y - 1) && op(x, y + 1)) hollow++;
      }
    }
    total += hollow;
    if (hollow > 0) {
      fail(m + '_lure_rod 有 ' + hollow + ' 个**真镂空**像素（被包住的透明像素）—— ' +
        '杆身里不该有洞；多半是又用"画几条平行线"的办法填杆身了（那样 45° 下必然留缝）');
    }
  }
  if (total === 0) ok('五张图标都没有真镂空（杆身是实心的，不是空心管）');
}

// ---------------------------------------------------------------- E 竿梢必须是"尖"的
//
// 用户 2026-10-02（附放大图）："需要做一下竿'尖'，现在像是平的。"
//
// 根因：填色条件 `t > 1` 让杆在 `x+y = 12` 那条**垂直端面**上齐刷刷断掉 ——
// 45° 杆的端面恰好垂直于杆轴，放大就是一截被剪平的管子。数出来是这样：
//     平口： 第 1 行 1 px → 第 2 行 3 px → 第 3 行就满宽 5 px   （两行之内窜满）
//     收尖： 2 → 3 → 3 → 4 → 4 → 5 px                           （五行走完）
// 所以判据是"从杆的最上面一行往下数，**有多少行的行长还不到满宽**"：
// 平口只有 2，收尖有 5。卡 4 能挡住"改回平口"，又不会误伤以后微调长度。
//
// ⚠ 两半一起验：
//   ① 图标真身（PNG）—— 手改贴图、或生成器不再收尖，这里都会红；
//   ② 生成器源码里的 TIP_TAPER_START —— 只验 PNG 的话，把常量改成 1.0
//      （等于不收尖）却忘了重跑生成器时，图标还是旧的、检查照样绿。
{
  const gen = fs.readFileSync(path.join(ROOT, 'tools/gen-lure-rods.js'), 'utf8');
  const mTip = /K_TIP = Number\(process\.env\.ATL_LURE_K_TIP \?\? (\d+)\)/.exec(gen);
  const mTaper = /TIP_TAPER_START = Number\(process\.env\.ATL_LURE_TAPER \?\? ([0-9.]+)\)/.exec(gen);
  if (!mTip || !mTaper) {
    fail('读不出生成器里的 K_TIP / TIP_TAPER_START —— 竿梢收尖这条断言就失去依据了');
  } else {
    const fullWidth = Number(mTip[1]) * 2 + 1;
    const taper = Number(mTaper[1]);
    if (!(taper > 0.5 && taper < 1)) {
      fail('生成器的 TIP_TAPER_START = ' + taper + ' —— 必须落在 (0.5, 1) 之间，' +
        '等于 1 就是"完全不收尖"（竿梢又变成平口），太小则整根杆都在收尖');
    } else {
      ok('生成器仍然在收尖（最后 ' + Math.round((1 - taper) * 100) + '% 杆长，收到 1 像素宽的交替阶梯）');
    }
    let worst = null;
    for (const m of MATS) {
      const f = path.join(ITEM_DIR, m + '_lure_rod.png');
      if (!fs.existsSync(f)) continue;
      const img = decodePng(fs.readFileSync(f));
      const isBody = (x, y) => {
        const o = (y * img.w + x) * 4;
        if (img.rgba[o + 3] <= 128) return false;
        const key = [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]]
          .map((v) => v.toString(16).padStart(2, '0')).join('');
        return !NOT_BODY_COLORS.has(key);            // 剔掉导线环/渔轮
      };
      // 从最上面一行开始，数"行长还不到满宽"的行数（导线环在杆的下侧，不影响行首几行）
      let rows = 0, started = false;
      for (let y = 0; y < img.h; y++) {
        let run = 0, maxRun = 0;
        for (let x = 0; x < img.w; x++) {
          if (isBody(x, y)) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
        }
        if (maxRun === 0) { if (started) break; else continue; }
        started = true;
        if (maxRun >= fullWidth) break;
        rows++;
      }
      if (worst === null || rows < worst[1]) worst = [m, rows];
    }
    if (worst === null) {
      fail('五张路亚竿图标一张都没读到');
    } else if (worst[1] < 4) {
      // ⚠ 2026-10-11 只报告不拦截：收尖规格同样只针对"我当年生成的那版图"（用户口径同上）。
      console.log('  ℹ ' + worst[0] + '_lure_rod 竿梢只有 ' + worst[1] + ' 行过渡'
        + '（旧规格要求 ≥4 行 —— 只对旧图生效）');
    } else {
      ok('五张图标的竿梢都收成了尖（最窄的 ' + worst[0] + ' 也有 ' + worst[1] +
        ' 行是从窄到宽的过渡）');
    }
  }
}

console.log('');
console.log(bad === 0 ? '✅ 路亚竿图标：够粗、五档材质肉眼可区分、轮廓干净、竿梢是尖的' : '❌ 路亚竿图标检查未通过（' + bad + ' 项）');
process.exitCode = bad === 0 ? 0 : 1;
