/*
 * gen-lure-icons.js —— 把用户给的拟饵成图（32×64，内容只在上半）截上半 → ×2 最近邻 → 64×64。
 *
 * ── 为什么单独一个脚本，而不是并进 gen-ref-icons.js ──────────────
 * gen-ref-icons.js 走的是"大图（275~331px、5px 格、渐变背景、右下有水印）→
 * 按格还原 → 背景曲面拟合抠图 → 1:1 居中"那条路，它假设参考图里有背景要抠、
 * 格边长在 2~8px 之间（probeCell 的候选只探 2..8）。
 * 用户 2026-10-04 给的这批是**已经做好的成图**：1:1 的 32×32 内容、透明底、
 * 没有水印、没有背景可抠。塞进那条路只会被啃（格边长探不出来 / 抠图把主体外圈当背景）。
 * 所以这些图的**唯一**出处就是这里，并且 gen-ref-icons.js 的 SOURCES 里
 * 已经把这 4 个 id **删掉**了 —— 否则构建时那条链会把这里写好的贴图盖回旧图。
 *
 * ── 规格 ──────────────────────────────────────────────────────
 *   输入  参考资料/拟饵新图/<n>_<名字>.png   32×64（只有上半 32×32 有内容）或 64×64 成品
 *   输出  src/main/resources/assets/anglertackle/textures/item/lure_<id>.png  64×64
 *   做法  32×64 → 取 y<32 的 32×32 → 每像素 2×2 复制（最近邻，不插值、不糊）；
 *         64×64 成品 → **原样用**
 *   ⚠ 目标尺寸就是 64×64，所以源图**必须是**这两种规格之一：
 *     拿一张 512×512 的大图进来会被 cropTopHalf 当成 32×64 处理（裁左上角 32×32）——
 *     要放大图请先缩到 64×64。
 *
 * ── 软虫拟饵（lure_soft）───────────────────────────────────────
 * 它原来**不在**这批成图里（check-item-icons.js 的备注写着"别顺手统一风格"）。
 * 用户 2026-10-06 亲自给了一张新的软虫成图（64×64 成品，斜放的灰白软虫 + 荧光黄头），
 * 于是它作为第 10 张加进来：数据源 `参考资料/拟饵新图/10_软虫.png`。
 * 换它是**用户点名**的，指纹表随这次改动一起重采（见 check-item-icons.js 的更新流程）。
 *
 * 用法：node tools/gen-lure-icons.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const SRCDIR = path.join(ROOT, '参考资料/拟饵新图');
const TEXDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const DRY = process.argv.slice(2).includes('--dry');

/** 用户成图文件 → 拟饵 id。顺序 = 用户编号顺序。 */
const MAP = {
  '1_荧光亮片': 'lure_glowspoon',
  '2_深潜胖子': 'lure_deep',
  '3_高频摆尾': 'lure_paddletail',
  '4_深潜巨物': 'lure_vibration',
  '5_钢珠声诱': 'lure_rattle',
  '6_米诺': 'lure_minnow',
  '7_深水探测': 'lure_depthfinder',
  '8_镀金竞技': 'lure_gilded',
  '9_亮片': 'lure_spoon',
  // 2026-10-06 用户点名换掉的那张（64×64 成品，原样用）
  '10_软虫': 'lure_soft',
};

const HALF = 32;   // 内容区：上半
const SCALE = 2;   // 32 → 64

/**
 * 源图 → 贴图。
 *
 * ⚠ 两种规格都要认（用户 2026-10-05 又给了一张**成品尺寸**的图，直接 64×64）：
 *   · 32×64（内容只在上半）→ 截上半 32×32 → ×2 最近邻
 *   · 已经是对外尺寸（正方形 64×64）→ **原样用**，不裁不缩
 * 早先只有第一条，第二张图塞进来会被砍掉下半（实测砍出 212 字节的半个鱼）——
 * 所以先判尺寸，别把两种规格硬套同一条路。
 */
function toIcon(img) {
  if (img.w === HALF * SCALE && img.h === HALF * SCALE) {
    return { w: img.w, h: img.h, rgba: Buffer.from(img.rgba), final: true };
  }
  const r = cropTopHalf(img);
  r.final = false;
  return r;
}

/** 截上半并按 SCALE 最近邻放大。 */
function cropTopHalf(img) {
  const side = Math.min(HALF, img.w, img.h);
  const { w, rgba } = img;
  const out = Buffer.alloc(side * SCALE * side * SCALE * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const s = (y * w + x) * 4;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const d = ((y * SCALE + dy) * side * SCALE + (x * SCALE + dx)) * 4;
          out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
        }
      }
    }
  }
  return { w: side * SCALE, h: side * SCALE, rgba: out };
}

let wrote = 0, bad = 0;
for (const [file, id] of Object.entries(MAP)) {
  const src = path.join(SRCDIR, file + '.png');
  if (!fs.existsSync(src)) { console.error('❌ ' + id + '：找不到成图 ' + path.relative(ROOT, src)); bad++; continue; }
  const img = decodePng(fs.readFileSync(src));
  const out = toIcon(img);
  const dest = path.join(TEXDIR, id + '.png');
  const before = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  const png = encodePng(out.w, out.h, out.rgba);
  const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(png);
  if (!DRY) fs.writeFileSync(dest, png);
  if (!same) wrote++;
  console.log((DRY ? '[dry] ' : '') + id.padEnd(18)
    + ' ← ' + file + '.png  ' + img.w + 'x' + img.h
    + (out.final ? ' 已是成品尺寸，原样用 → ' : (' 截上半 ' + HALF + 'x' + HALF + ' ×' + SCALE + ' → '))
    + out.w + 'x' + out.h
    + '  ' + png.length + ' 字节' + (same ? '（与现有相同）' : '（更新）')
    + (before && same ? '' : ''));
}
console.log('\n' + (DRY ? '（dry：未写盘）' : '写盘 ' + wrote + ' 张，共 ' + Object.keys(MAP).length + ' 张')
  + (bad ? '，失败 ' + bad + ' 张' : ''));
process.exit(bad ? 1 : 0);
