/*
 * 杆子图标的斜向必须是"向左斜"（用户 2026-10-01 定案：原来是向右斜）。
 *
 * 为什么值得单独立一个检查：
 *   杆子贴图有**两个**生成器都会写（gen-textures.js 画 16×16 字符画、
 *   gen-lure-rods.js 用 Canvas 画 64×64 带渔轮和拟饵的那一版），
 *   任何一个重跑都可能把方向翻回去；而"图标斜向反了"在代码里完全看不出来 ——
 *   只有看图才知道，所以它一定会静默复发。
 *
 * 判据（可计算）：把不透明像素按 y 分成上/下两带，算各自 x 均值。
 *   向右斜 "/"：竿梢在上且靠右 → tipX > buttX
 *   向左斜 "\"：竿梢在上且靠左 → tipX < buttX
 */
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

const DIR = path.resolve(__dirname, '../src/main/resources/assets/anglertackle/textures/item');
const files = fs.readdirSync(DIR).filter((n) => n.endsWith('_rod.png')).sort();

if (files.length === 0) {
  console.error('❌ 一张 *_rod.png 都没找到 —— 检查口径失效了');
  process.exit(1);
}

/** @return {{tip:number,butt:number}|null} 上带/下带的 x 均值 */
function slant(p) {
  const { w, h, rgba } = decodePng(fs.readFileSync(p));
  let tipN = 0, tipX = 0, buttN = 0, buttX = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] < 128) continue;
      if (y < h / 3) { tipN++; tipX += x; }
      else if (y > h * 2 / 3) { buttN++; buttX += x; }
    }
  }
  return (tipN && buttN) ? { tip: tipX / tipN, butt: buttX / buttN } : null;
}

let bad = 0;
const rows = [];
for (const f of files) {
  const s = slant(path.join(DIR, f));
  if (!s) { console.error(`❌ ${f}: 上带或下带没有不透明像素，判断不了斜向`); bad++; continue; }
  const dir = s.tip > s.butt ? '向右斜 /' : s.tip < s.butt ? '向左斜 \\' : '竖直 |';
  if (s.tip >= s.butt) {
    console.error(`❌ ${f}: ${dir}（tipX ${s.tip.toFixed(1)} ≥ buttX ${s.butt.toFixed(1)}）—— ` +
      `杆子图标必须是"向左斜"。修法：镜像贴图，并确认 gen-textures.js 的 mirrorRows / ` +
      `gen-lure-rods.js 的 rows[y][SIZE-1-x] 都还在`);
    bad++;
  }
  rows.push(`  ${f.padEnd(28)} ${dir}  tipX ${s.tip.toFixed(1)}  buttX ${s.butt.toFixed(1)}`);
}
console.log(rows.join('\n'));
if (bad > 0) {
  console.log(`\n杆子图标斜向检查：${bad} 项失败`);
  process.exit(1);
}
console.log(`\n✅ ${files.length} 张杆子图标全部向左斜（竿梢在上且靠左）`);

// ------------------------------------------------------------------ 渔轮位置
//
// 用户 2026-10-01：所有路亚竿的**渔轮**位置都不对 —— 原版鱼竿的渔轮在"杆的右下部分"。
// 这条必须机器验：上一版把轮子画在竿梢那一头（rt=0.82），肉眼看图标只看到
// "斜着的杆 + 一个小方块"，根本意识不到它装反了，两轮反馈才纠出来。
//
// 判据：渔轮像素（用生成器里那三个 REEL_* 颜色识别）的重心必须在**右下象限**。
// 颜色常量从 gen-lure-rods.js 源码里读，不在这里抄一遍 —— 抄了就会漂移。
const genSrc = fs.readFileSync(path.join(__dirname, 'gen-lure-rods.js'), 'utf8');
const reelColors = new Set();
for (const m of genSrc.matchAll(/const REEL_(?:BODY|LIGHT|DARK)\s*=\s*'(#[0-9a-fA-F]{6})'/g)) {
  reelColors.add(m[1].toLowerCase());
}
if (reelColors.size === 0) {
  console.error('❌ 没能从 gen-lure-rods.js 里解析出 REEL_* 颜色常量 —— 解析口径失效了');
  process.exit(1);
}
console.log(`\n渔轮位置（识别色 ${[...reelColors].join(' ')}）`);

let reelBad = 0, reelChecked = 0;
for (const f of files.filter((n) => n.endsWith('_lure_rod.png'))) {
  const { w, h, rgba } = decodePng(fs.readFileSync(path.join(DIR, f)));
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 128) continue;
      const hex = '#' + [rgba[o], rgba[o + 1], rgba[o + 2]]
        .map((v) => v.toString(16).padStart(2, '0')).join('');
      if (reelColors.has(hex)) { n++; sx += x; sy += y; }
    }
  }
  // ⚠⚠ 2026-10-11 改成**只报告、不拦截**。理由（用户原话）：
  //   "这是我当时要求你调整**自己贴图内容**的原话，与现在的贴图没有任何关系。"
  //   ⇒ 渔轮规格针对的是"我当年生成的那版路亚图标"，**适用范围只有旧图**；
  //     现在这 10 张竿贴图是用户自己出的，且他已定案"一切贴图以新为准，自己更改设置适应新贴图"。
  //   ⇒ 规格本身**没有作废** ✗，只是不再拿它判新图；实测值照旧打印，供人眼对照
  //     （与 check-rounds.js 对"金档先不弄"的处理同一套做法）。
  if (!n) { console.log(`  ℹ ${f}: 没有渔轮色像素（旧规格要求有渔轮 —— 只对旧图生效）`); reelChecked++; continue; }
  const cx = sx / n, cy = sy / n;
  reelChecked++;
  const ok = cx > w * 0.6 && cy > h * 0.6;
  if (!ok) {
    console.error(`❌ ${f}: 渔轮重心在 (${cx.toFixed(1)}, ${cy.toFixed(1)})，` +
      `不在杆的右下部分（要求 x > ${(w * 0.6).toFixed(1)} 且 y > ${(h * 0.6).toFixed(1)}）—— ` +
      `检查 gen-lure-rods.js 里的 rt（从握把端算起，应当很小、约 0.2，` +
      `写成 0.8 就会把轮子顶到竿梢上）`);
    reelBad++;
  } else {
    console.log(`  ${f.padEnd(28)} 渔轮重心 (${cx.toFixed(1)}, ${cy.toFixed(1)}) 于右下 ✅  ${n} 像素`);
  }
}
if (reelChecked === 0) { console.error('❌ 一张路亚竿都没检查到'); reelBad++; }
console.log(reelBad === 0
  ? `\n✅ ${reelChecked} 张路亚竿的渔轮都在杆的右下部分`
  : `\n路亚竿渔轮位置检查：${reelBad} 项失败`);

// ------------------------------------------------------------------ 渔轮大小
//
// 用户 2026-10-01 的规格："可以把渔轮放大到两倍" → 半径 2.8/1.8 → 5.6/3.6，圆环约 120 像素。
//
// 同日稍后用户："你把鱼线部分删掉吧" —— 鱼线和鱼漂已经从贴图里整段删掉，
// 所以这里不再有鱼漂像素数 / 鱼线长度两条断言（那两条守的东西已经不存在了）。
let sizeBad = 0;
console.log('\n渔轮大小');
for (const f of files.filter((n) => n.endsWith('_lure_rod.png'))) {
  const { w, h, rgba } = decodePng(fs.readFileSync(path.join(DIR, f)));
  const count = new Map();
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    const hex = '#' + [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]
      .map((v) => v.toString(16).padStart(2, '0')).join('');
    count.set(hex, (count.get(hex) || 0) + 1);
  }
  const reelPx = [...reelColors].reduce((a, c) => a + (count.get(c) || 0), 0);
  // 半径 5.6 的圆环≈120 像素 —— **旧规格**，只对当年生成的那版图生效（理由见上面第 93 行那段）。
  if (reelPx < 90) {
    console.log(`  ℹ ${f.padEnd(28)} 渔轮 ${reelPx} 像素（旧规格要求 ≥90 —— 只对旧图生效）`);
  } else {
    console.log(`  ${f.padEnd(28)} 渔轮 ${reelPx} 像素 ✅`);
  }
}

const total = reelBad + sizeBad;
console.log(total === 0
  ? '\n✅ 路亚竿的渔轮位置与大小全部符合规格'
  : `\n路亚竿图标检查：${total} 项失败`);
process.exit(total === 0 ? 0 : 1);
