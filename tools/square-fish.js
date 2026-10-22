// 把鱼放进**能用整数倍完全包容它的 1:1 画布**，再按面积平均缩到目标尺寸（默认 64x64）。
//
// 为什么要先做 1:1 画布：
//   之前让"画布 = 前景包围盒"，于是每条鱼的画布比例都不一样（金龙 3.76、草鱼 1.19…），
//   缩放基准各算各的，细长鱼一缩就糊成一团、还容易被当成"拉肥"。
//   统一放进正方形画布后，所有鱼共享同一个缩放基准，且缩小倍数各向同性。
//
// 整数倍优先：先找能完全包容主体的最小整数倍正方形边（N×max(w,h)，N 取最小可行），
// 这样缩到目标尺寸时不会先丢一次像素。
const fs = require('fs'), path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(n, d) {
  const h = process.argv.find(a => a.startsWith('--' + n + '='));
  return h ? h.slice(n.length + 3) : d;
}
const outDir = opt('out', '参考资料/鱼图/_square');
const TARGET = Number(opt('size', 64));
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('用法: node tools/square-fish.js <输入png...> [--size=64] [--out=目录]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

for (const f of files) {
  const img = decodePng(fs.readFileSync(f));
  const { w, h, rgba } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { console.log(path.basename(f) + ' 全透明，跳过'); continue; }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // 1:1 画布边长 = "不小于目标尺寸的整数倍方形"里最小的那个。
  // ⚠️ 不能直接取 max(bw,bh)：老鱼主体 63x34 -> 63² 会被**放大** 1.016 倍再缩，
  //    先放大后缩小等于白糊一次。取 ≥ TARGET 的整数倍就只缩不放大。
  const need = Math.max(bw, bh);
  const C = Math.max(TARGET, Math.ceil(need / TARGET) * TARGET);
  {
    const oy0 = Math.floor((C - bh) / 2), ox0 = Math.floor((C - bw) / 2);
    console.log('    ' + path.basename(f) + ' 主体 ' + bw + 'x' + bh
      + ' → 1:1 画布 ' + C + '² (鱼居中于 ' + ox0 + ',' + oy0 + ')');
  }

  // 方形画布：主体居中，不缩放主体
  const sq = Buffer.alloc(C * C * 4);
  const ox = Math.floor((C - bw) / 2), oy = Math.floor((C - bh) / 2);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const s = ((y0 + y) * w + (x0 + x)) * 4;
    if (rgba[s + 3] === 0) continue;
    const d = ((oy + y) * C + (ox + x)) * 4;
    sq[d] = rgba[s]; sq[d + 1] = rgba[s + 1]; sq[d + 2] = rgba[s + 2]; sq[d + 3] = 255;
  }

  // 面积平均缩到 TARGET×TARGET
  const T = TARGET;
  const outBuf = Buffer.alloc(T * T * 4);
  for (let dy = 0; dy < T; dy++) for (let dx = 0; dx < T; dx++) {
    const sx0 = Math.floor(dx * C / T), sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * C / T));
    const sy0 = Math.floor(dy * C / T), sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * C / T));
    let r = 0, g = 0, b = 0, n = 0, tot = 0;
    for (let sy = sy0; sy < sy1 && sy < C; sy++) for (let sx = sx0; sx < sx1 && sx < C; sx++) {
      tot++;
      const i = (sy * C + sx) * 4;
      if (sq[i + 3] === 0) continue;
      r += sq[i]; g += sq[i + 1]; b += sq[i + 2]; n++;
    }
    if (n === 0 || n / tot < 0.5) continue;   // 覆盖率过半才算实体
    const d = (dy * T + dx) * 4;
    outBuf[d] = Math.round(r / n); outBuf[d + 1] = Math.round(g / n);
    outBuf[d + 2] = Math.round(b / n); outBuf[d + 3] = 255;
  }

  const outp = path.join(outDir, path.basename(f));
  fs.writeFileSync(outp, encodePng(T, T, outBuf));
  console.log(path.basename(f).padEnd(24) + '主体 ' + (bw + 'x' + bh).padEnd(11)
    + '→ 1:1 画布 ' + C + '²  → ' + T + 'x' + T
    + '  缩放 x' + (T / C).toFixed(3)
    + '  鱼占画布 ' + Math.round(bw * T / C) + 'x' + Math.round(bh * T / C));
}
