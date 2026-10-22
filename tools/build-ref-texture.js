// ============================================================================
//  build-ref-texture.js -- 参考图 → 成品贴图（抠图 + 换色 + 整数倍放大）
//
//  用户给的参考图已经是在线工具打好的 5px 马赛克（或某一档马赛克），
//  所以这些方块就是"目标像素"，绝对不能再降采样，否则方块会被破坏。
//  本工具只做三件事：
//    1. 抠图：按格子取代表色，和背景接近的格子置透明
//    2. 换色：可选，把整体色相/明度迁移到目标色（用于做品质变体）
//    3. 放大：整数倍最近邻，把方块原样放大到 64×64
//
//  用法:
//    node tools/build-ref-texture.js <参考图> <输出png> [选项]
//      --grid=5        马赛克块边长（预览图里的像素大小；5px工具+2倍预览=10）
//      --bgtol=40      背景容差
//      --hue=270       目标色相（0-360）；给了就做换色
//      --sat=1.0       饱和度倍率
//      --val=1.0       明度倍率
//      --zoom=2        整数放大倍数（默认自动选到 64）
//      --anchor=      none
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

function opt(name, def) {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('用法: node tools/build-ref-texture.js <参考图> <输出png> [--grid=5] [--hue=270] [--zoom=2] [--size=64]');
  process.exit(2);
}

const img = decodePng(fs.readFileSync(inFile));
const { w, h, rgba } = img;
const cell = Number(opt('grid', 5));
const bgTol = Number(opt('bgtol', 40));
const zoomArg = opt('zoom', null);

function px(x, y) {
  const i = (y * w + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

// ---------- 1. 背景色 ----------
// 两种判定方式：
//   corner（默认）——取四角中位数。适合背景纯色的图（大多数网图打完马赛克后都是）。
//   auto          ——四角不一致时（背景有渐变/纹理），改用"出现次数最多的颜色"。
const bgMode = opt('bgmode', 'corner');
function cornerBg() {
  const corners = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
  return [0, 1, 2].map(c => {
    const v = corners.map(p => p[c]).sort((a, b) => a - b);
    return Math.round((v[1] + v[2]) / 2);
  });
}
function dominantBg() {
  // 把颜色量化到 16 级后统计众数，取出现最多的那一桶的中心
  const tally = new Map();
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const p = px(x, y);
    if (p[3] < 24) continue;
    const k = (p[0] >> 4) + ',' + (p[1] >> 4) + ',' + (p[2] >> 4);
    const e = tally.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += p[0]; e.g += p[1]; e.b += p[2];
    tally.set(k, e);
  }
  let best = null;
  for (const e of tally.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [0, 0, 0];
}
const bg = bgMode === 'auto' ? dominantBg() : cornerBg();
const bgDist = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);

// ---------- 2. 按格子取代表色（中位数，抗噪）----------
const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
function cellColor(gx, gy) {
  const bx = gx * cell, by = gy * cell;
  const rs = [], gs = [], bs = [];
  for (let y = 1; y < cell - 1; y++) {
    for (let x = 1; x < cell - 1; x++) {
      const p = px(bx + x, by + y);
      rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
    }
  }
  if (!rs.length) { const p = px(bx + ((cell / 2) | 0), by + ((cell / 2) | 0)); return p; }
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

// ---------- 3. 抠图：判定哪些格子是背景 ----------
// 三种方式：
//   corner（默认）——按与四角背景色的距离阈值，简单快
//   auto          ——背景色取全图众数
//   flood         ——**从图像边缘泛洪**：只有"和边缘连通且颜色接近背景"的格子才算背景。
//                    渐变背景、银白色主体（和背景颜色接近）都只能靠这个办法，
//                    因为主体虽然颜色像背景，但它被前景围住、与边缘不连通。
//                    缺点：每格都跟**全局背景色**比，背景渐变一大就失效
//                    （下方背景离角点色太远 -> 判成前景，留一片脏底）。
//   floodstep     ——泛洪 + **逐格传递容差**：每格只跟**带它进来的父格**比颜色。
//                    这样能顺着渐变一路走下去（相邻格差一点点没关系，累积起来可以差很多），
//                    而鱼身的深色轮廓和相邻背景差得远，扩散会在这里截断 —— 鱼肚得以保留。
//                    渐变背景 + 浅色鱼肚的组合只能用这个模式。
const fgMode = opt('fg', 'tol');
const grid = [];
for (let gy = 0; gy < gh; gy++) {
  const row = [];
  for (let gx = 0; gx < gw; gx++) row.push({ rgb: cellColor(gx, gy), fg: true });
  grid.push(row);
}

// 局部背景基准：收集四条边上的格子当参考点
// （马赛克图主体一般不贴边，边缘基本是背景；即使贴边也只影响那一列）。
const edgeRefs = [];
for (let x = 0; x < gw; x++) {
  edgeRefs.push({ x, y: 0, rgb: grid[0][x].rgb });
  edgeRefs.push({ x, y: gh - 1, rgb: grid[gh - 1][x].rgb });
}
for (let y = 1; y < gh - 1; y++) {
  edgeRefs.push({ x: 0, y, rgb: grid[y][0].rgb });
  edgeRefs.push({ x: gw - 1, y, rgb: grid[y][gw - 1].rgb });
}
function localBg(gx, gy) {
  let best = null, bestD = Infinity;
  for (const e of edgeRefs) {
    const d = (e.x - gx) * (e.x - gx) + (e.y - gy) * (e.y - gy);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best ? best.rgb : bg;
}

// 用"就近边缘色"判定背景（比全局背景色更抗渐变）
for (let gy = 0; gy < gh; gy++) {
  for (let gx = 0; gx < gw; gx++) {
    const c = grid[gy][gx].rgb;
    const ref = fgMode === 'local' ? localBg(gx, gy) : bg;
    grid[gy][gx].fg = Math.hypot(c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]) > bgTol;
  }
}

if (fgMode === 'flood' || fgMode === 'floodstep') {
  // BFS：从四条边的"背景色格子"出发，把它能连到的同色格子全标成背景。
  // floodstep 模式下，比较基准是**父格颜色**（传递），不是全局角点色。
  const stepMode = fgMode === 'floodstep';
  const visited = Array.from({ length: gh }, () => new Array(gw).fill(false));
  const colorAt = (x, y) => grid[y][x].rgb;
  // floodstep 用**步长容差**：单步允许的颜色差（比整体容差小得多）
  const stepTol = Number(opt('steptol', 12));
  const queue = [];
  const push = (x, y, fromRgb) => {
    if (x < 0 || y < 0 || x >= gw || y >= gh) return;
    if (visited[y][x]) return;
    const c = colorAt(x, y);
    if (stepMode && fromRgb) {
      // 只跟父格比：渐变可以一路传递，突变（鱼轮廓）会截断
      if (Math.hypot(c[0] - fromRgb[0], c[1] - fromRgb[1], c[2] - fromRgb[2]) > stepTol) return;
    } else if (bgDist(c) > bgTol) {
      return;
    }
    visited[y][x] = true;
    grid[y][x].fg = false;
    queue.push([x, y, c]);
  };
  for (let x = 0; x < gw; x++) { push(x, 0, null); push(x, gh - 1, null); }
  for (let y = 0; y < gh; y++) { push(0, y, null); push(gw - 1, y, null); }
  const step = stepMode ? 1 : Math.max(1, Math.round(bgTol / 25));
  let guard = gh * gw * 4;
  while (queue.length && guard-- > 0) {
    const [x, y, c] = queue.pop();
    for (let d = 1; d <= step; d++) {
      push(x - d, y, c); push(x + d, y, c); push(x, y - d, c); push(x, y + d, c);
    }
  }
}

// 抠图时额外往内收一圈：马赛克边缘常有一圈半透明/抗锯齿的"晕"，
// 不收掉会留下一圈脏边。
const shrink = Number(opt('shrink', 1));
for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
  if (!grid[y][x].fg) continue;
  if (x < shrink || y < shrink || x >= gw - shrink || y >= gh - shrink) {
    grid[y][x].fg = false;
  }
}

// 去孤立：四邻全背景的实心格判为背景
const fgAt = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh) ? false : grid[y][x].fg;
let dropped = 0;
for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
  if (!grid[y][x].fg) continue;
  if (!fgAt(x - 1, y) && !fgAt(x + 1, y) && !fgAt(x, y - 1) && !fgAt(x, y + 1)) { grid[y][x].fg = false; dropped++; }
}

// ---------- 补内部空洞 ----------
// 为什么需要：马赛克里有些主体像素颜色和背景很接近（例如银白色的翘嘴、
// 大西洋鲑身上的浅蓝），阈值法或泛洪都会把它们误判成背景，
// 结果鱼身上出现一个个"透明窟窿"。
//
// 判断方法很可靠：**从图像边缘泛洪标记"外部背景"，
// 剩下所有没被标记的透明格就是被主体包围的内部空洞**，直接填成不透明。
// 填色用邻居的中位色（避免空洞边缘出现生硬的色块）。
//
// ⚠️ 有个常见反例：**参考图用白色画鱼肚，背景也是白色**。此时鱼肚和外部背景
// 是连通的（鱼嘴/鳃盖处有开口），泛洪会一路灌进肚子里，于是鱼肚被判成外部背景
// —— 成品就"镂空"了。容差法更糟，它直接把白肚当背景删掉。
//
// 解法 --seal=N：先把前景**膨胀 N 格**得到一张"封口掩膜"，在掩膜上泛洪。
// 开口被膨胀堵住后，白肚就成了被包围的内部区域，从而被正确补上。
// 膨胀掩膜只用于**判定**，不会让成品变胖（填色时仍按真实前景算）。
{
  const seal = Math.max(0, Math.round(Number(opt('seal', 0))));
  // 膨胀后的前景掩膜（seal=0 时就是原样）
  const dil = Array.from({ length: gh }, () => new Array(gw).fill(false));
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!grid[y][x].fg) continue;
    for (let dy = -seal; dy <= seal; dy++) for (let dx = -seal; dx <= seal; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      dil[ny][nx] = true;
    }
  }
  const outside = Array.from({ length: gh }, () => new Array(gw).fill(false));
  const stack = [];
  const pushOut = (x, y) => {
    if (x < 0 || y < 0 || x >= gw || y >= gh) return;
    if (outside[y][x] || dil[y][x]) return;   // 膨胀前景挡住泛洪
    outside[y][x] = true;
    stack.push([x, y]);
  };
  for (let x = 0; x < gw; x++) { pushOut(x, 0); pushOut(x, gh - 1); }
  for (let y = 0; y < gh; y++) { pushOut(0, y); pushOut(gw - 1, y); }
  while (stack.length) {
    const [x, y] = stack.pop();
    pushOut(x - 1, y); pushOut(x + 1, y); pushOut(x, y - 1); pushOut(x, y + 1);
  }

  let filled = 0;
  // seal 模式下白肚可能很大，所以 maxhole 自动放宽（除非用户显式指定）
  const maxHole = opt('maxhole', null) === null
    ? (seal > 0 ? 1e9 : 60)
    : Number(opt('maxhole'));
  const seen = Array.from({ length: gh }, () => new Array(gw).fill(false));
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (grid[y][x].fg || outside[y][x] || seen[y][x]) continue;

    // 把这个空洞整块找出来，先看它有多大
    const cells = [];
    const st = [[x, y]];
    seen[y][x] = true;
    while (st.length) {
      const [cx, cy] = st.pop();
      cells.push([cx, cy]);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        if (seen[ny][nx] || grid[ny][nx].fg || outside[ny][nx]) continue;
        seen[ny][nx] = true;
        st.push([nx, ny]);
      }
    }

    // ⚠️ 太大的一律视作真背景，不能补。
    // 典型反例：鱼背上方那块三角形的天空——它在像素上是"被主体包住"的，
    // 但其实是外部背景凹进来的一块。补上就会变成一大块白斑。
    // 真正的内部小孔（鳞片间隙、浅色花纹）通常只有几格到几十格。
    if (cells.length > maxHole) {
      continue;
    }

    for (const [cx, cy] of cells) {
      const rs = [], gs = [], bs = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        if (!grid[ny][nx].fg) continue;
        const c = grid[ny][nx].rgb;
        rs.push(c[0]); gs.push(c[1]); bs.push(c[2]);
      }
      if (!rs.length) continue;
      const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
      grid[cy][cx] = { rgb: [med(rs), med(gs), med(bs)], fg: true };
      filled++;
    }
  }
  if (filled > 0) {
    console.log('  补内部空洞 ' + filled + ' 格');
  }
}

// ---------- 3.5 去残留孤块 ----------
// 为什么需要：容差法只能判"这个颜色像不像背景"。背景渐变、或主体颜色与背景
// 接近时，画面里会剩下一块**和主体不相连**的前景（例如鱼身旁边的一小片背景
// 被误判成前景）。四邻去孤立只能删 1 格大的，删不掉这种几十格的碎块。
//
// 鱼在画里必然是**一整块连通的主体**，所以可靠做法是：
// 找出所有前景连通块，只保留最大的那一块，其余全判为背景。
//   --blobs=largest  只留最大连通块（默认）
//   --blobs=keep     不去孤块，全部保留
//   --blobs=N        保留最大块，另外保留所有 ≥N 格的块
//   --conn=4|8       连通性。默认 4（上下左右）。
//                    ⚠️ 必须用 4：8 邻接下孤块常和主体**斜向**相连（只共一个角），
//                    会被当成同一块从而躲过清理。实测大眼海鲢的残留块就是这样：
//                    8 邻接 → 1 块（清不掉）；4 邻接 → 5 块（残留块 52 格，能清掉）。
{
  const blobMode = opt('blobs', 'largest');
  const conn = Number(opt('conn', 4));
  if (blobMode !== 'keep') {
    const DIRS = conn === 8
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];
    const label = Array.from({ length: gh }, () => new Array(gw).fill(-1));
    const blobs = [];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (!grid[y][x].fg || label[y][x] >= 0) continue;
      const id = blobs.length;
      const cells = [];
      const st = [[x, y]];
      label[y][x] = id;
      while (st.length) {
        const [cx, cy] = st.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          if (label[ny][nx] >= 0 || !grid[ny][nx].fg) continue;
          label[ny][nx] = id;
          st.push([nx, ny]);
        }
      }
      blobs.push(cells);
    }

    if (blobs.length > 1) {
      // 最大的那块当主体
      let main = 0;
      for (let i = 1; i < blobs.length; i++) {
        if (blobs[i].length > blobs[main].length) main = i;
      }
      const minKeep = blobMode === 'largest' ? Infinity : Number(blobMode);
      let removed = 0, removedBlobs = 0;
      for (let i = 0; i < blobs.length; i++) {
        if (i === main) continue;
        if (Number.isFinite(minKeep) && blobs[i].length >= minKeep) continue;
        for (const [cx, cy] of blobs[i]) { grid[cy][cx].fg = false; removed++; }
        removedBlobs++;
      }
      if (removed > 0) {
        console.log('  去孤块 ' + removed + ' 格（原有 ' + blobs.length + ' 块，'
          + '清掉 ' + removedBlobs + ' 块，保留最大 ' + blobs[main].length + ' 格，' + conn + ' 邻接）');
      }
    }
  }
}

// ---------- 4. 包围盒 ----------
let gx0 = gw, gy0 = gh, gx1 = -1, gy1 = -1;
for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
  if (grid[y][x].fg) {
    if (x < gx0) gx0 = x; if (y < gy0) gy0 = y;
    if (x > gx1) gx1 = x; if (y > gy1) gy1 = y;
  }
}
if (gx1 < 0) { console.error('没找到前景'); process.exit(1); }
const sw = gx1 - gx0 + 1, sh = gy1 - gy0 + 1;

// ---------- 5. 换色（可选）----------
const hueArg = opt('hue', null);
const satMul = Number(opt('sat', 1));
const valMul = Number(opt('val', 1));

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 0) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return [hh, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgb(hh, s, v) {
  hh = ((hh % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; } else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// 找参考图的主色调，用于判断"这个像素算不算有彩色"
let hueShift = 0, refHue = null;
if (hueArg !== null) {
  // 主色 = 前景里饱和度最高的那批像素的平均色相
  let bestS = 0, accH = 0, n = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const c = grid[gy0 + y][gx0 + x];
    if (!c.fg) continue;
    const [hh, ss] = rgb2hsv(...c.rgb);
    if (ss > bestS) bestS = ss;
    if (ss > 0.15) { accH += hh; n++; }
  }
  refHue = n ? accH / n : null;
  hueShift = refHue === null ? 0 : (Number(hueArg) - refHue);
}

const sprite = { w: sw, h: sh, rgba: Buffer.alloc(sw * sh * 4) };
let recolored = 0;
for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
  const c = grid[gy0 + y][gx0 + x];
  const o = (y * sw + x) * 4;
  if (!c.fg) { sprite.rgba[o + 3] = 0; continue; }
  let [r, g, b] = c.rgb;
  if (hueArg !== null) {
    let [hh, ss, vv] = rgb2hsv(r, g, b);
    // 三种策略，按饱和度分区：
    //   饱和 > satKeep（默认 0.25）——**原样保留**（例如黄头、红头这类彩色部件）
    //   饱和 ≤ 0.40 的灰白件        —— 正片化染色（往目标色相染，保留明暗结构）
    //   其余彩色像素                —— 直接转色相
    // 只转色相对白色物品完全无效（饱和度太低），必须走正片化。
    const satKeep = Number(opt('satkeep', 0.25));
    const pureTint = Number(opt('tint', 0.55));
    if (ss > satKeep) {
      // 彩色部件保留（浅水米诺的黄头、红头都靠这条保住）
      recolored++;
    } else if (ss <= 0.40) {
      const [tr, tg, tb] = hsv2rgb(Number(hueArg), 0.85, 1.0);
      const k = pureTint;
      r = Math.round(r * (1 - k) + ((r * tr) / 255) * k);
      g = Math.round(g * (1 - k) + ((g * tg) / 255) * k);
      b = Math.round(b * (1 - k) + ((b * tb) / 255) * k);
      if (valMul !== 1) {
        r = Math.min(255, Math.round(r * valMul));
        g = Math.min(255, Math.round(g * valMul));
        b = Math.min(255, Math.round(b * valMul));
      }
      recolored++;
    } else {
      hh += hueShift;
      ss = Math.min(1, ss * satMul);
      vv = Math.min(1, vv * valMul);
      [r, g, b] = hsv2rgb(hh, ss, vv);
      recolored++;
    }
  }
  sprite.rgba[o] = r; sprite.rgba[o + 1] = g; sprite.rgba[o + 2] = b; sprite.rgba[o + 3] = 255;
}

// ---------- 6. 缩放 ----------
// 用户的要求是"只抠图"——所以默认**保持原始像素**，
// 只有放不进 64×64 时才缩，且优先整数倍。
//   --scale=none   原样居中（放不下时按比例缩到刚好放进）
//   --scale=fit    一律缩放到最长边贴满 64
//   --scale=stretch 非等比拉伸填满 64×64（细长物体如鱼竿用这个才不会变成一根线）
//   --zoom=N       强制指定缩放倍数
//   --size=N       画布边长（必须是 2 的幂）。默认 64。
//                  放不下主体时**不要裁也不要缩**，直接把这个数调大：
//                  能容纳的格数 = size ÷ 格边长，所以 79 格×4px 至少要 316px。
const TARGET = Number(opt('size', 64));
if (!Number.isInteger(TARGET) || TARGET < 4 || (TARGET & (TARGET - 1)) !== 0) {
  console.error('❌ --size 必须是 2 的幂且 ≥4（如 64 / 128 / 256 / 512），当前 ' + opt('size', 64));
  process.exit(2);
}
const scaleMode = opt('scale', 'none');
const stretch = scaleMode === 'stretch';
let zoom;
if (zoomArg !== null) {
  zoom = Number(zoomArg);
} else if (scaleMode === 'fit') {
  zoom = TARGET / Math.max(sw, sh);
} else {
  const fit = Math.min(TARGET / sw, TARGET / sh);
  zoom = fit >= 1 ? 1 : fit;   // 放得下就 1:1 不缩放
}
const rw = stretch ? TARGET : Math.min(TARGET, Math.max(1, Math.round(sw * zoom)));
const rh = stretch ? TARGET : Math.min(TARGET, Math.max(1, Math.round(sh * zoom)));
const zoomX = stretch ? TARGET / sw : zoom;
const zoomY = stretch ? TARGET / sh : zoom;

// 旋转（最近邻，只支持 90 的整数倍，避免插值把方块糊掉）
const rot = ((Number(opt('rotate', 0)) % 360) + 360) % 360;
const rotated = (rot === 90 || rot === 270);

const canvasW = rotated ? rh : rw;
const canvasH = rotated ? rw : rh;
const canvas = Buffer.alloc(TARGET * TARGET * 4);
for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
  const sx = Math.min(sw - 1, Math.floor(x / zoomX));
  const sy = Math.min(sh - 1, Math.floor(y / zoomY));
  const s = (sy * sw + sx) * 4;
  if (sprite.rgba[s + 3] === 0) continue;
  let dx, dy;
  if (rot === 90) { dx = rh - 1 - y; dy = x; }
  else if (rot === 180) { dx = rw - 1 - x; dy = rh - 1 - y; }
  else if (rot === 270) { dx = y; dy = rw - 1 - x; }
  else { dx = x; dy = y; }
  const d = (dy * TARGET + dx) * 4;
  canvas[d] = sprite.rgba[s]; canvas[d + 1] = sprite.rgba[s + 1];
  canvas[d + 2] = sprite.rgba[s + 2]; canvas[d + 3] = 255;
}

// 居中到 64×64
const out = Buffer.alloc(TARGET * TARGET * 4);
const ox = Math.max(0, Math.floor((TARGET - canvasW) / 2));
const oy = Math.max(0, Math.floor((TARGET - canvasH) / 2));
for (let y = 0; y < Math.min(canvasH, TARGET); y++) for (let x = 0; x < Math.min(canvasW, TARGET); x++) {
  const s = (y * TARGET + x) * 4;
  if (canvas[s + 3] === 0) continue;
  const d = ((y + oy) * TARGET + (x + ox)) * 4;
  out[d] = canvas[s]; out[d + 1] = canvas[s + 1]; out[d + 2] = canvas[s + 2]; out[d + 3] = 255;
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, encodePng(TARGET, TARGET, out));

console.log(path.basename(inFile) + ' -> ' + outFile);
console.log('  格子 ' + cell + 'px, 背景 rgb(' + bg.join(',') + '), 容差 ' + bgTol + ', 抠图 ' + fgMode);
console.log('  还原像素 ' + sw + 'x' + sh + ' → 画布 ' + rw + 'x' + rh
  + '（缩放 x' + (Math.round(zoomX * 100) / 100) + (stretch ? ' 非等比' : '') + '）'
  + (rot ? '，旋转 ' + rot + '°' : '') + '，居中于 ' + TARGET + 'x' + TARGET);
console.log('  去孤立格 ' + dropped + '，换色像素 ' + recolored
  + (hueArg !== null ? '（色相→' + hueArg + '°，原主色 ' + (refHue === null ? '无' : Math.round(refHue) + '°') + '）' : ''));

