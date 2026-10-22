// 给参考图选最佳抠图方案。逐个 (grid, fg模式, 容差) 试跑，量化打分：
//   残留背景：被判为前景、但颜色接近**局部边缘背景色**的像素（越少越好）
//   误删主体：被判为背景、但颜色明显偏离背景且被前景半包围的像素（越少越好）
// 参考图背景常常是**渐变**的（例如金枪鱼 248→165），所以按"就近边缘色"比较。
const fs = require('fs'), path = require('path');
const { decodePng } = require('./image-to-sprite.js');

function runCli(script, args) {
  const saved = process.argv;
  const saveLog = console.log, saveErr = console.error, saveExit = process.exit;
  let out = '', failed = false;
  process.argv = ['node', path.join(__dirname, script), ...args];
  console.log = (m) => { out += String(m) + '\n'; };
  console.error = (m) => { out += String(m) + '\n'; };
  process.exit = () => { failed = true; throw new Error('__exit__'); };
  try {
    delete require.cache[require.resolve(path.join(__dirname, script))];
    require(path.join(__dirname, script));
  } catch (e) {
    if (String(e.message) !== '__exit__') { failed = true; out += String(e.message) + '\n'; }
  } finally {
    process.argv = saved; console.log = saveLog; console.error = saveErr; process.exit = saveExit;
  }
  return { out, failed };
}

function analyze(refPath, outPath, grid) {
  const ref = decodePng(fs.readFileSync(refPath));
  const out = decodePng(fs.readFileSync(outPath));
  // 输出是 1:1（或整数倍）还原，故按格坐标对齐：输出前景 = 参考图对应格有前景
  // 用输出的包围盒把参考图裁成同尺寸
  let x0 = out.w, y0 = out.h, x1 = -1, y1 = -1;
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    if (out.rgba[(y * out.w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // 参考图局部背景基准
  const rw = ref.w, rh = ref.h;
  const rpx = (x, y) => { const i = (y * rw + x) * 4; return [ref.rgba[i], ref.rgba[i + 1], ref.rgba[i + 2]]; };
  const edge = [];
  for (let x = 0; x < rw; x += 2) { edge.push([x, 0]); edge.push([x, rh - 1]); }
  for (let y = 0; y < rh; y += 2) { edge.push([0, y]); edge.push([rw - 1, y]); }
  const localBg = (gx, gy) => {
    let best = null, bd = Infinity;
    for (const [ex, ey] of edge) {
      const d = (ex - gx) ** 2 + (ey - gy) ** 2;
      if (d < bd) { bd = d; best = [ex, ey]; }
    }
    return rpx(best[0], best[1]);
  };

  let leftover = 0, killed = 0, fg = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const fgOut = out.rgba[((y0 + y) * out.w + (x0 + x)) * 4 + 3] > 0;
    // 该输出像素对应的参考图格中心
    const rx = Math.min(rw - 1, Math.floor((x + 0.5) * rw / bw) * 0 + Math.round(x * grid));
    const ry = Math.min(rh - 1, Math.round(y * grid));
    // 只取该 grid×grid 块的平均色
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < grid; dy++) for (let dx = 0; dx < grid; dx++) {
      const sx = Math.min(rw - 1, Math.round(x * grid) + dx);
      const sy = Math.min(rh - 1, Math.round(y * grid) + dy);
      const c = rpx(sx, sy); r += c[0]; g += c[1]; b += c[2]; n++;
    }
    r /= n; g /= n; b /= n;
    const bg = localBg(Math.round(x * grid), Math.round(y * grid));
    const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
    if (fgOut) {
      fg++;
      if (dist < 45) leftover++;          // 判成前景但其实像背景
    } else {
      if (dist >= 100) killed++;          // 判成背景但明显不像背景
    }
  }
  return { bw, bh, fg, leftover, killed };
}

const CASES = [
  ['bluefin_tuna',   '参考资料/鱼图/03_蓝鳍金枪鱼.png'],
  ['crucian_carp',   '参考资料/鱼图/10_鲫鱼.png'],
  ['grass_carp',     '参考资料/鱼图/06_草鱼.png'],
  ['atlantic_salmon','参考资料/鱼图/14_大西洋鲑_新.png'],
];
const MODES = [['tol', 40], ['tol', 60], ['local', 40], ['local', 60], ['flood', 40], ['flood', 60]];

const TD = '参考资料/鱼图/_score';
fs.mkdirSync(TD, { recursive: true });
console.log('鱼'.padEnd(18) + '方案'.padEnd(12) + '尺寸'.padEnd(11) + '前景'.padEnd(7) + '残留'.padEnd(7) + '误删');
const totals = {};
for (const [id, ref] of CASES) {
  for (const [mode, tol] of MODES) {
    const outP = TD + '/' + id + '_' + mode + tol + '.png';
    const r = runCli('build-ref-texture.js', [ref, outP, '--grid=5', '--bgtol=' + tol, '--fg=' + mode, '--scale=none', '--size=512']);
    if (r.failed || !fs.existsSync(outP)) { console.log(id.padEnd(18) + (mode + tol).padEnd(12) + '失败'); continue; }
    const a = analyze(ref, outP, 5);
    const key = mode + tol;
    totals[key] = totals[key] || { leftover: 0, killed: 0 };
    totals[key].leftover += a.leftover;
    totals[key].killed += a.killed;
    console.log(id.padEnd(18) + (mode + tol).padEnd(12) + (a.bw + 'x' + a.bh).padEnd(11)
      + String(a.fg).padEnd(7) + String(a.leftover).padEnd(7) + a.killed);
  }
}
console.log('\n=== 各方案合计（残留/误删 越低越好）===');
for (const [k, v] of Object.entries(totals).sort((a, b) => (a[1].leftover + a[1].killed) - (b[1].leftover + b[1].killed))) {
  console.log('  ' + k.padEnd(12) + '残留 ' + String(v.leftover).padEnd(7) + '误删 ' + v.killed);
}
