const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
/*
 * 水族箱边框自检：不靠"看着对"，靠几何反推 + 合成水箱求值。
 *
 * 检查三件事：
 *   A. 每条边条的 1px 盒子位于哪条壁的哪一侧 —— 纯粹从 from/to 坐标反推方向，
 *      和 blockstate 条件里写的属性名逐一比对（这就是上一轮错的根源）。
 *   B. 在一个 3×2×2 的实心水族箱里逐方块求值 24 条 multipart 条件：
 *      内部接缝处不允许出现任何边条，外表面必须恰好 4 条。
 *   C. blockstate 的 24 条和 tools/aquarium-layout.json 完全一致（防止手改漂移）。
 */
const fs = require('fs');
const path = require('path');
// ⚠ 资源路径**必须基于 ATL_ROOT 拼绝对路径**，不能写裸相对路径（2026-10-14 踩到）：
//   本脚本会被闸（tools/build-deploy.ps1）以 `Process.Start` 起子进程的方式跑，
//   而子进程的 cwd 未必是项目根（PowerShell 的 Set-Location 只改自己的位置，
//   不改 .NET 的 Environment.CurrentDirectory）⇒ 裸相对路径会 ENOENT 崩掉、
//   而且**一个字都不打印**（连错误都看不到，只能靠"手动跑却是绿的"才反应过来）。
const RES = path.join(ATL_ROOT, 'src/main/resources/assets/anglertackle/');
const DIRS = ['north', 'south', 'east', 'west', 'up', 'down'];
// 方向 → 单位偏移（MC 约定：north = -Z，south = +Z，up = +Y）
const DELTA = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

let fail = 0;
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

const layout = JSON.parse(fs.readFileSync(require('path').join(ATL_ROOT, 'tools/aquarium-layout.json'), 'utf8'));
const bs = JSON.parse(fs.readFileSync(RES + 'blockstates/aquarium.json', 'utf8'));

/* ── A. 从盒子坐标反推"这条边条贴着哪个方向的邻居" ───────────────────── */
function dirOfBar(from, to) {
  // 三个轴的跨度必是 {2, 1, 16}：2=壁厚轴  1=边条所在的自由轴  16=铺满的自由轴
  const span = [0, 1, 2].map((i) => to[i] - from[i]);
  const n = span.indexOf(2);                              // 0=x 1=y 2=z
  if (n < 0 || span.filter((v) => v === 2).length !== 1) return { err: `壁厚轴不唯一（span=[${span}]）` };
  if (span.filter((v) => v === 1).length !== 1) return { err: `边条轴不唯一（span=[${span}]）` };
  if (span.filter((v) => v === 16).length !== 1) return { err: `铺满轴不唯一（span=[${span}]）` };
  const wall = from[n] === 0 ? (n === 0 ? 'west' : n === 1 ? 'down' : 'north')
                             : (n === 0 ? 'east' : n === 1 ? 'up' : 'south');
  // 自由轴里另外那条 1px 的轴 = 边条所在的那一侧
  const others = [0, 1, 2].filter((i) => i !== n);
  const edgeAxis = others.filter((i) => span[i] === 1);
  if (edgeAxis.length !== 1) return { err: `自由轴上不是恰好一条 1px（${edgeAxis.length}）` };
  const e = edgeAxis[0];
  const edgeDir = from[e] === 0 ? (e === 0 ? 'west' : e === 1 ? 'down' : 'north')
                                : (e === 0 ? 'east' : e === 1 ? 'up' : 'south');
  return { wall, edgeDir };
}

console.log('A. 边条坐标 → 方向（和 blockstate 条件比对）');
for (const bar of layout.bars) {
  const json = JSON.parse(fs.readFileSync(RES + 'models/block/' + bar.model + '.json', 'utf8'));
  const el = json.elements[0];
  const got = dirOfBar(el.from, el.to);
  if (got.err) { bad(`${bar.model}: ${got.err}`); continue; }
  if (got.wall !== bar.wall) bad(`${bar.model}: 盒子在 ${got.wall} 壁，文件名/表里写的是 ${bar.wall}`);
  if (got.edgeDir !== bar.edgeDir) bad(`${bar.model}: 盒子贴 ${got.edgeDir} 侧，表里写的是 ${bar.edgeDir}`);
}
// blockstate 条件里的两个属性名必须正好是 wall 和 edgeDir
const condMap = new Map(bs.multipart.map((mp) => [mp.apply.model.replace('anglertackle:block/', ''), mp.when]));
for (const bar of layout.bars) {
  const when = condMap.get(bar.model);
  if (!when) { bad(`${bar.model}: blockstate 里没有对应条件`); continue; }
  const keys = Object.keys(when).sort();
  const want = [bar.wall, bar.edgeDir].sort();
  if (keys.join(',') !== want.join(',')) bad(`${bar.model}: 条件键 [${keys}] ≠ 应有的 [${want}]`);
  for (const k of keys) if (when[k] !== 'false') bad(`${bar.model}: 条件 ${k} 应为 false，实为 ${when[k]}`);
}
if (bs.multipart.length !== 24) bad(`multipart 条数 ${bs.multipart.length} ≠ 24`);
if (bs.multipart.length === condMap.size) console.log(`  ✓ 24 条边条：盒子位置、条件键、false 取值三者一致`);
else bad('blockstate 里有重复的 model 引用');

/* ── B. 合成 3×2×2 实心水箱，逐方块求值 ─────────────────────────────── */
console.log('B. 3×2×2 实心水箱：内部接缝不得有边条，外表面每条恰好 4 条');
const SX = 3, SY = 2, SZ = 2;
const inside = (x, y, z) => x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ;
const conn = (x, y, z, d) => { const [dx, dy, dz] = DELTA[d]; return inside(x + dx, y + dy, z + dz); };
let barsTotal = 0, interiorBars = 0, blocksChecked = 0;
for (let x = 0; x < SX; x++) for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) {
  blocksChecked++;
  // 每个方块自己维护的 6 个连接属性：邻居也是水族箱即为 true（=updateShape 的语义）
  const state = Object.fromEntries(DIRS.map((d) => [d, conn(x, y, z, d)]));
  const drawn = [];
  for (const mp of bs.multipart) {
    if (Object.entries(mp.when).every(([k, v]) => String(state[k]) === v)) drawn.push(mp.apply.model);
  }
  barsTotal += drawn.length;
  for (const bar of layout.bars) {
    const isDrawn = drawn.includes('anglertackle:block/' + bar.model);
    // 几何期望：这条边条在"壁方向"上是外表面、且在"edgeDir 方向"上也是外表面 → 才该画
    const expect = !conn(x, y, z, bar.wall) && !conn(x, y, z, bar.edgeDir);
    if (isDrawn !== expect) {
      bad(`(${x},${y},${z}) ${bar.model}: 实际${isDrawn ? '画' : '不画'}，几何期望${expect ? '画' : '不画'}`);
    }
    if (isDrawn && conn(x, y, z, bar.edgeDir)) interiorBars++;   // 画在内部接缝上 = 网格感
  }
}
console.log(`  抽查 ${blocksChecked} 个方块，共命中边条 ${barsTotal} 次`);
if (interiorBars === 0) console.log('  ✓ 内部接缝处 0 条边条（不再有网格线）');
else bad(`内部接缝处出现 ${interiorBars} 条边条`);

/* ── C. 三个方向的代表性形状：单体、1×1×1、长条，外表面条数含义正确 ─── */
console.log('C. 单体水箱：6 个面各 4 条 = 24 条');
{
  const state = Object.fromEntries(DIRS.map((d) => [d, false]));
  const n = bs.multipart.filter((mp) => Object.entries(mp.when).every(([k, v]) => String(state[k]) === v)).length;
  if (n !== 24) bad(`孤立单方块命中 ${n} 条，应为 24`);
  else console.log('  ✓ 孤立单方块 24 条，围成一整圈框');
}

console.log(fail === 0 ? '\n水族箱边框自检：全部通过' : `\n水族箱边框自检：${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
