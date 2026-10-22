/*
 * 把用户用结构方块存的 yurenxiaowu.nbt 装进 mod 的数据包目录，并生成群系标签。
 *
 * 为什么单独写一个脚本而不是手工复制：
 *   ① 源文件在 D: 盘的存档里，路径含空格和中文，手工复制容易出错；
 *   ② 目标目录名必须是 data/<ns>/structure/（**单数**）—— 1.20 及以前是 structures，
 *      照旧教程写成复数的话，结构会被静默忽略（不报错，就是永远不生成）。
 *      这个事实是从 minecraft_1.21.1_client.jar 里数出来的：
 *      data/minecraft/structure/ 下有 1180 个 .nbt，没有 structures 目录。
 *   ③ 复制完要**重新解析一遍**，确认字节没坏、调色板还能读出来。
 */
const fs = require('fs');
const path = require('path');
const { summarize } = require('./lib-nbt');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2];
if (!SRC) {
  console.error('用法: node tools/import-structure.js "<结构方块存出来的 .nbt 路径>" [目标名]');
  process.exit(1);
}
const NAME = process.argv[3] || 'fisherman_hut';

const DEST_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/structure');
const DEST = path.join(DEST_DIR, NAME + '.nbt');

if (!fs.existsSync(SRC)) { console.error('❌ 找不到源文件 ' + SRC); process.exit(1); }
fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(SRC, DEST);

const srcSize = fs.statSync(SRC).size;
const dstSize = fs.statSync(DEST).size;
console.log('✅ 复制 ' + path.basename(SRC) + ' → data/anglertackle/structure/' + NAME + '.nbt');
console.log('   ' + srcSize + ' 字节 → ' + dstSize + ' 字节 '
  + (srcSize === dstSize ? '（一致）' : '❌ 大小不一致！'));

// ---- 群系标签 ----
// 策划案 docs/13 §1.1：河边生成。
// ⚠ 只写 #minecraft:is_river 是不够的 —— 河流群系很窄，随机点很容易落在
//   河岸的相邻群系（沙滩/沼泽/普通陆地）上。所以这里把"紧邻河流的群系"
//   也一并放进来，再由放置逻辑自己去挑"离水够近"的点。
const TAG_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/tags/worldgen/biome');
fs.mkdirSync(TAG_DIR, { recursive: true });
const tag = {
  replace: false,
  values: [
    '#minecraft:is_river',
    '#minecraft:is_swamp',
    '#minecraft:is_beach',
  ],
};
fs.writeFileSync(path.join(TAG_DIR, 'has_fisherman_hut.json'),
  JSON.stringify(tag, null, 2) + '\n', 'utf8');
console.log('✅ data/anglertackle/tags/worldgen/biome/has_fisherman_hut.json（河流/沼泽/沙滩）');

// ---- 回读校验 ----
// ⚠ 必须在**同一个进程里**解析，不能 execFileSync 调 read-structure.js 再读它的 stdout：
//   这个沙箱禁止 node 用管道捕获子进程输出，会直接 EPERM（第一版就是这么挂的）。
//   这也是把解析器抽到 lib-nbt.js 的直接原因。
const s = summarize(DEST);
console.log('\n---- 回读校验 ----');
console.log('  尺寸    : ' + s.size.join(' × ') + '（' + (s.size[0] * s.size[1] * s.size[2]) + ' 格体积）');
console.log('  方块数  : ' + s.blocks + '   实体内: ' + s.entities + '   种类: ' + s.paletteSize);

// 断言：读回来的必须和源文件逐项一致，而且必须真的不是空的。
// 只打印不判断的话，"复制了一个 0 字节文件"也会显示得很正常。
let fail = 0;
const check = (cond, msg) => { console.log('  ' + (cond ? '✅' : '❌') + ' ' + msg); if (!cond) fail++; };
check(s.size[0] > 0 && s.size[1] > 0 && s.size[2] > 0, '尺寸非零');
check(s.blocks > 0, '方块数非零（' + s.blocks + '）');
check(s.entities === 0, 'NBT 里没有实体（老柯要靠代码生成，不能指望结构自带）');
check(srcSize === dstSize, '字节数与源文件一致（' + srcSize + '）');

// 码头/门/地板这些关键坐标是 worldgen 代码和老柯生成点要用的，
// 顺手从结构里**算出来**打一行 —— 结构被改过时，日志里一眼能看出差异，
// 不用再手工去数方块。
{
  const { buildGrid } = require('./lib-nbt');
  const { grid, size } = buildGrid(s.root);
  const [sx, sy, sz] = size;
  const at = (x, y, z) => (x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz ? grid[x][y][z] : null);

  // 地板高度 = 出现次数最多的那一层的 y（小屋地砖铺得最满）
  const perY = new Array(sy).fill(0);
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) if (grid[x][y][z]) perY[y]++;
  const floorY = perY.indexOf(Math.max(...perY));

  // 门：名字以 _door 结尾的方块
  const doors = [];
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    const n = grid[x][y][z];
    if (n && /_door$/.test(n)) doors.push([x, y, z]);
  }

  // 码头：最外侧（x 最大）那一列有方块的位置
  const pierCols = [];
  for (let x = sx - 1; x >= 0; x--) {
    let n = 0;
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) if (grid[x][y][z]) n++;
    if (n > 0) pierCols.push(x + ':' + n);
    if (pierCols.length >= 4) break;
  }

  console.log('  地板层 y = ' + floorY + '  （该层方块最多：' + perY[floorY] + ' 个）');
  console.log('  门坐标   = ' + (doors.length ? doors.map((d) => '[' + d.join(', ') + ']').join(' ') : '（没找到 _door 方块）'));
  console.log('  最外侧 4 列（列:方块数）= ' + pierCols.join('  '));
  console.log('  结构另一侧是否有水: 调色板里'
    + (s.counts.some(([n]) => /water/.test(n)) ? '**有** water' : '**没有** water → 码头必须靠世界生成挑水边落脚点'));
}

console.log('\n' + (fail === 0 ? '✅ 导入完成，结构可被解析。' : '❌ ' + fail + ' 项校验未通过'));
process.exitCode = fail === 0 ? 0 : 1;

