// 读 Minecraft 结构文件（.nbt）—— 结构方块存的、以及数据包里的结构都是这个格式。
//
// 用途：你用结构方块搭好渔夫小屋存成 .nbt，我用这个工具把它读出来，
//       转成 mod 的世界生成结构（data/anglertackle/structure/xxx.nbt）。
//
// 解析器本身在 lib-nbt.js —— 抽出去还有一个很实际的理由：
// 这个沙箱**禁止 node 用管道捕获子进程输出**（spawnSync 会 EPERM），
// 所以"调用另一个脚本再读它的 stdout"这条路走不通，
// 要做回读校验只能在同一个进程里 require。
const fs = require('fs');
const { summarize, buildGrid, makeSymbols } = require('./lib-nbt');

// ---------------------------------------------------------------- 布局可视化
//
// 光看"用了 179 个橡木木板"是没法判断这个结构长什么样的 ——
// 要把它变成世界生成结构，必须知道：门朝哪边、码头伸向哪个方向、
// 地板在第几层、老柯该站在哪个坐标。所以补上"把它画出来"。

/** 俯视图：每列取"最高的非空气方块"，像看卫星图。 */
function topDown(root) {
  const { grid, size } = buildGrid(root);
  const [sx, sy, sz] = size;
  const counts = new Map();
  const top = [];
  for (let x = 0; x < sx; x++) {
    top.push([]);
    for (let z = 0; z < sz; z++) {
      let name = null, h = -1;
      for (let y = sy - 1; y >= 0; y--) {
        if (grid[x][y][z]) { name = grid[x][y][z]; h = y; break; }
      }
      top[x].push({ name, h });
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const ordered = [...counts].sort((a, b) => b[1] - a[1]);
  const { sym, legend } = makeSymbols(ordered);

  // 坐标轴：x 向右、z 向下。为了让屋顶那层不至于遮住内部，
  // 同时再画一张"只到第 3 层"的（y ≤ 3），两张对照着看就能找到地板和门。
  //
  // ⚠ 两张图**各自算图例**：第一版共用了全高那次的 symbol 表，
  //   结果低层图里出现了 '?' —— 因为只在低层露面的方块当时不在计数里。
  const render = (maxY) => {
    const c2 = new Map();
    const pick = (x, z) => {
      for (let y = Math.min(maxY, sy - 1); y >= 0; y--) if (grid[x][y][z]) return grid[x][y][z];
      return null;
    };
    for (let x = 0; x < sx; x++) for (let z = 0; z < sz; z++) {
      const n = pick(x, z);
      if (n) c2.set(n, (c2.get(n) || 0) + 1);
    }
    const s2 = makeSymbols([...c2].sort((a, b) => b[1] - a[1]));
    const lines = [];
    let header = '     ';
    for (let x = 0; x < sx; x++) header += (x % 10);
    lines.push(header);
    for (let z = 0; z < sz; z++) {
      let row = String(z).padStart(3, ' ') + '  ';
      for (let x = 0; x < sx; x++) {
        const n = pick(x, z);
        row += n ? (s2.sym.get(n) || '?') : ' ';
      }
      lines.push(row);
    }
    return { text: lines.join('\n'), legend: s2.legend };
  };

  const full = render(sy - 1);
  const low = render(3);
  console.log('\n--- 俯视图（每列取最高的方块）---');
  console.log('    x →   z ↓            （数字是列号，个位）');
  console.log(full.text);
  console.log('\n图例：');
  for (const [c, name, n] of full.legend) console.log('  ' + c + ' = ' + name + '  ×' + n);

  console.log('\n--- 俯视图 · 只看 y ≤ 3（去掉屋顶/墙，看得见内部与门口）---');
  console.log(low.text);
  console.log('\n图例：');
  for (const [c, name, n] of low.legend) console.log('  ' + c + ' = ' + name + '  ×' + n);
}

/** 纵剖面：固定一个轴，画出另一个水平轴 × y 的切面。 */
function elevation(root, axis, value) {
  const { grid, size } = buildGrid(root);
  const [sx, sy, sz] = size;
  const counts = new Map();
  const cell = (a, y, b) => {
    const [x, z] = axis === 'z' ? [a, b] : [b, a];
    if (x < 0 || x >= sx || z < 0 || z >= sz) return null;
    return grid[x][y][z];
  };
  const span = axis === 'z' ? sx : sz;
  for (let a = 0; a < span; a++) for (let y = 0; y < sy; y++) {
    const n = cell(a, y, value);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  const { sym, legend } = makeSymbols([...counts].sort((p, q) => q[1] - p[1]));
  console.log('\n--- 纵剖面 ' + axis + '=' + value + ' ---');
  let header = '      ';
  for (let a = 0; a < span; a++) header += (a % 10);
  console.log(header);
  for (let y = sy - 1; y >= 0; y--) {
    let row = 'y' + String(y).padStart(3, ' ') + '  ';
    for (let a = 0; a < span; a++) {
      const n = cell(a, y, value);
      row += n ? (sym.get(n) || '?') : ' ';
    }
    console.log(row);
  }
  console.log('图例：' + legend.map(([c, n]) => c + '=' + n).join('  '));
}

/** 找出所有名字里含某个子串的方块，打印坐标。 */
function find(root, needle) {
  const palette = (root.palette || []).map((p) => String(p.Name).replace(/^minecraft:/, ''));
  const hits = [];
  for (const b of root.blocks || []) {
    const n = palette[b.state] || '?';
    if (n.includes(needle)) hits.push([n, b.pos, b.nbt]);
  }
  console.log('\n--- 含 "' + needle + '" 的方块：' + hits.length + ' 个 ---');
  for (const [n, pos, nbt] of hits.slice(0, 40)) {
    console.log('  ' + n + '  @ [' + pos.join(', ') + ']'
      + (nbt ? '  nbt=' + JSON.stringify(nbt).slice(0, 120) : ''));
  }
  if (hits.length > 40) console.log('  …（还有 ' + (hits.length - 40) + ' 个）');
  // 顺便给出这些方块的坐标范围 —— 用来判断"码头在哪一侧"最直接
  if (hits.length) {
    const xs = hits.map((h) => h[1][0]), ys = hits.map((h) => h[1][1]), zs = hits.map((h) => h[1][2]);
    const rng = (a) => Math.min(...a) + '…' + Math.max(...a);
    console.log('  坐标范围: x ' + rng(xs) + '   y ' + rng(ys) + '   z ' + rng(zs));
  }
}

/** 打印指定坐标的方块。 */
function at(root, pos) {
  const palette = (root.palette || []).map((p) => String(p.Name).replace(/^minecraft:/, ''));
  const [x, y, z] = pos;
  for (const b of root.blocks || []) {
    if (b.pos[0] === x && b.pos[1] === y && b.pos[2] === z) {
      console.log('\n[' + pos.join(', ') + '] = ' + (palette[b.state] || '?')
        + (b.nbt ? '\n  nbt=' + JSON.stringify(b.nbt) : ''));
      return;
    }
  }
  console.log('\n[' + pos.join(', ') + '] = （空气）');
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (!argv.length) {
  console.error(`用法: node tools/read-structure.js <.nbt> [选项]

  不带选项        只打印概况（尺寸 / 方块数 / 种类 / 前 10 名）
  --map           俯视图 + 去掉屋顶的内部俯视图 + 图例
  --elev z=7      纵剖面（固定 z=7，画 x × y 切面）
  --elev x=2      纵剖面（固定 x=2，画 z × y 切面）
  --find water    列出名字里含 "water" 的方块及坐标范围
  --at 3,4,5      打印某个坐标上的方块`);
  process.exit(1);
}
/** 解析命令行：文件与选项混着写，文件按顺序收集。 */
function parseArgs(argv) {
  const out = { files: [], map: false, elev: [], find: [], at: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') { out.map = true; continue; }
    if (a === '--elev') {
      const v = argv[++i] || '';
      const m = /^([xz])\s*=\s*(\d+)$/.exec(v);
      if (!m) { console.error('--elev 需要形如 z=7（收到 "' + v + '"）'); process.exit(1); }
      out.elev.push({ axis: m[1], value: Number(m[2]) });
      continue;
    }
    if (a === '--find') { out.find.push(argv[++i] || ''); continue; }
    if (a === '--at') {
      const m = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(argv[++i] || '');
      if (!m) { console.error('--at 需要形如 3,4,5'); process.exit(1); }
      out.at.push([Number(m[1]), Number(m[2]), Number(m[3])]);
      continue;
    }
    if (a.startsWith('--')) { console.error('未知选项 ' + a); process.exit(1); }
    out.files.push(a);
  }
  if (!out.files.length) { console.error('至少要给一个 .nbt 文件'); process.exit(1); }
  return out;
}

const opts = parseArgs(argv);
for (const f of opts.files) {
  if (!fs.existsSync(f)) { console.log('❌ 找不到 ' + f); continue; }
  try {
    const s = summarize(f);
    console.log('\n=== ' + f);
    console.log('  尺寸    : ' + s.size.join(' × ') + '  （' + (s.size[0] * s.size[1] * s.size[2]) + ' 格体积）');
    console.log('  方块数  : ' + s.blocks + '   实体内: ' + s.entities);
    console.log('  方块种类: ' + s.paletteSize);
    console.log('  用得最多的 10 种：');
    for (const [n, c] of s.counts.slice(0, 10)) {
      console.log('    ' + String(c).padStart(5) + '  ' + n);
    }
    if (opts.map) topDown(s.root);
    for (const e of opts.elev) elevation(s.root, e.axis, e.value);
    for (const q of opts.find) find(s.root, q);
    for (const p of opts.at) at(s.root, p);
  } catch (e) {
    console.log('❌ ' + f + ' 解析失败: ' + e.message);
  }
}
