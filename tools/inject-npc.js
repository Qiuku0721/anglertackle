/*
 * inject-npc.js —— 把老柯写进渔夫小屋结构文件的 entities 列表。
 *
 * ## 为什么用"结构自带实体"而不是"结构生成后回调"
 *
 * NeoForge **没有**"结构生成完成"事件。想要代码感知结构生成，
 * 最后都要 mixin 进 StructureStart —— 那是这个项目里最不该引入的东西。
 * 而结构模板本来就支持自带实体，源码（StructureTemplate.java）写得很清楚：
 *
 *   - 加载：`getList("entities", 10)` → 每项读 `pos`(List<Double>)、
 *           `blockPos`(List<Int>)、`nbt`(Compound)。**blockPos 是必需的** ——
 *           读的时候直接 `getList("blockPos", 3).getInt(0)`，缺了就抛。
 *   - 放置：`addEntitiesToWorld` 里把 `nbt` 复制出来，
 *           **用 `pos` 算出来的世界坐标覆盖 `compoundtag.put("Pos", ...)`**，
 *           并 `remove("UUID")`，然后 `createEntityIgnoreException` 生成实体。
 *
 * 所以：**nbt 里不用写 Pos**（写了也会被覆盖），实体落在哪由 `pos` 决定。
 *
 * ## 站的位子和朝向不打字面量
 *
 * 位子是**算**出来的：在"码头那一半"里找"脚下是整块、头顶两格空"的格子，
 * 取离小屋重心最远的那个。朝向 = 从小屋重心指向那个位子（也就是"面朝水面"）。
 * 这样你把结构改了重新存一次，重跑本脚本就能自动跟上，不用回来改数字。
 *
 * 用法：node tools/inject-npc.js
 */
const fs = require('fs');
const path = require('path');
const nbt = require('./lib-nbt');
const { N, get, nums } = nbt;

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src/main/resources/data/anglertackle/structure/fisherman_hut.nbt');
const ENTITY_ID = 'anglertackle:fisherman';

if (!fs.existsSync(FILE)) { console.error('❌ 找不到结构文件 ' + FILE); process.exit(1); }

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 把老柯写进结构 ===\n');

const typed = nbt.readNbtTyped(FILE);
const root = typed.root;
const size = nums(get(root, 'size')).map(Number);
const [sx, sy, sz] = size;
console.log('  结构尺寸 ' + size.join(' × '));

// ---------------------------------------------------------------- ① 摆成网格
const grid = [];
for (let x = 0; x < sx; x++) {
  grid.push([]);
  for (let y = 0; y < sy; y++) grid[x].push(new Array(sz).fill(null));
}
{
  const pal = get(root, 'palette');
  const names = pal.v.items.map((p) => String(get(p, 'Name').v).replace(/^minecraft:/, ''));
  for (const b of get(root, 'blocks').v.items) {
    const [x, y, z] = nums(get(b, 'pos')).map(Number);
    const st = Number(get(b, 'state').v);
    const n = names[st] || '?';
    grid[x][y][z] = /(^|_)air$/.test(n) ? null : n;
  }
}

// ---------------------------------------------------------------- ② 算站位
// "结构里哪一半是小屋、哪一半是码头"用 x 轴切。这个结构的布局就是这样：
// 小屋在西边（x 小），码头向东伸出去。切在 70% 处。
const SPLIT = Math.floor(sx * 0.7);
const hutPts = [], pierPts = [];
for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
  if (!grid[x][y][z]) continue;
  (x < SPLIT ? hutPts : pierPts).push([x, y, z]);
}
if (!hutPts.length || !pierPts.length) {
  console.error('❌ 结构切不出"小屋"和"码头"两半（x<' + SPLIT + ' 有 ' + hutPts.length
    + ' 块，x>=' + SPLIT + ' 有 ' + pierPts.length + ' 块）—— 需要重新确认布局');
  process.exit(1);
}
const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / pts.length);
const hutC = centroid(hutPts);
console.log('  小屋重心 [' + hutC.map((v) => v.toFixed(1)).join(', ') + ']   （x < ' + SPLIT + '）');
console.log('  码头方块 ' + pierPts.length + ' 个（x >= ' + SPLIT + '）');

// 脚下必须是"整块"：台阶/半砖/栅栏/玻璃板/活板门都不算 —— 站上去要么悬空要么掉下去
const NOT_FULL = /_slab$|_stairs$|_fence$|_fence_gate$|_pane$|_trapdoor$|_carpet$|_wall$|^lantern$|_torch$/;
const cands = [];
for (const [x, y, z] of pierPts) {
  if (!grid[x][y][z] || NOT_FULL.test(grid[x][y][z])) continue;
  // 头顶两格必须空（老柯 1.95 高，需要 2 格）
  if (y + 2 >= sy) continue;
  if (grid[x][y + 1][z] || grid[x][y + 2][z]) continue;
  const d2 = (x - hutC[0]) ** 2 + (z - hutC[2]) ** 2;
  cands.push({ x, y, z, d2, below: grid[x][y][z] });
}
if (!cands.length) {
  console.error('❌ 码头上找不到"脚下整块、头顶两格空"的格子 —— 老柯会卡在方块里');
  process.exit(1);
}
cands.sort((a, b) => b.d2 - a.d2);
const spot = cands[0];
const px = spot.x + 0.5, py = spot.y + 1.0, pz = spot.z + 0.5;
console.log('  站位 [' + px + ', ' + py + ', ' + pz + ']  脚下是 ' + spot.below
  + '，离小屋重心 ' + Math.sqrt(spot.d2).toFixed(1) + ' 格（共 ' + cands.length + ' 个候选）');

// 朝向：从小屋重心指向站位 = 面朝水面。用原版 lookAt 的公式。
const dx = px - hutC[0], dz = pz - hutC[2];
const yaw = (Math.atan2(dz, dx) * 180 / Math.PI) - 90;
console.log('  朝向 yaw = ' + yaw.toFixed(1) + '°（从屋里往外看，面朝开阔水面）');

// ---------------------------------------------------------------- ③ 写 entities
const nbtNode = N.compound({
  id: N.str(ENTITY_ID),
  // ⚠ 不写 Pos：placeInWorld 会用 pos 算出来的世界坐标覆盖它（源码里是
  //   `compoundtag.put("Pos", listtag)`，无条件覆盖）。写了纯属误导。
  // Rotation 会被保留：moveTo 时只改 yaw 的旋转量，最终 yaw = nbt 里的 + 结构旋转。
  Rotation: N.list(5, [N.float(yaw), N.float(0)]),
  // 别被"走远就卸载"清掉。虽然实体代码里也调了 setPersistenceRequired()，
  // 但结构生成走的是 NBT 反序列化路径，两条都写上最稳。
  PersistenceRequired: N.byte(1),
});

const entry = N.compound({
  pos: N.list(6, [N.double(px), N.double(py), N.double(pz)]),
  blockPos: N.list(3, [N.int(spot.x), N.int(spot.y), N.int(spot.z)]),
  nbt: nbtNode,
});

// 幂等：已经注入过就先删掉旧的，重跑不会越加越多
const ents = get(root, 'entities');
let removed = 0;
if (ents && ents.t === 9) {
  const kept = ents.v.items.filter((e) => {
    const id = get(get(e, 'nbt'), 'id');
    if (id && id.v === ENTITY_ID) { removed++; return false; }
    return true;
  });
  ents.v.items = kept;
  // 元素类型：现在一定有 Compound 了
  ents.v.et = 10;
}
if (removed) console.log('  ℹ  清掉了 ' + removed + ' 个旧的 ' + ENTITY_ID + ' 条目（幂等重跑）');
ents.v.items.push(entry);
ok('已写入 entities（现在共 ' + ents.v.items.length + ' 项）');

// ---------------------------------------------------------------- ④ 写回 + 回读
nbt.writeNbtFile(FILE, typed.name, root);
ok('已写回 ' + path.relative(ROOT, FILE) + '（' + fs.statSync(FILE).size + ' 字节）');

{
  const s = nbt.summarize(FILE);   // 用**普通**读取器（不是 typed），复现游戏侧的读法
  const [rx, ry, rz] = s.size;
  check3(rx === sx && ry === sy && rz === sz, '回读尺寸不变（' + s.size.join('×') + '）');
  check3(s.blocks === sx * sy * sz, '方块数不变（' + s.blocks + '）');
  check3(s.entities === 1, '回读实体数 = 1（实际 ' + s.entities + '）');

  const back = nbt.readNbtTyped(FILE);
  const list = get(back.root, 'entities');
  check3(list && list.t === 9 && list.v.et === 10, 'entities 是 List<Compound>（元素类型 10）');
  const e0 = list.v.items[0];
  const id = get(get(e0, 'nbt'), 'id');
  check3(id && id.v === ENTITY_ID, '实体 id = ' + (id ? id.v : '(缺失)'));

  // 这是游戏读取时的真实取值方式：pos 必须是 List<Double>、blockPos 必须是 List<Int>
  const p = get(e0, 'pos');
  const bp = get(e0, 'blockPos');
  check3(p && p.t === 9 && p.v.et === 6, 'pos 是 List<Double>（元素类型 6）—— 写成 List<Int> 会读出垃圾坐标');
  check3(bp && bp.t === 9 && bp.v.et === 3, 'blockPos 是 List<Int>（元素类型 3）—— 缺了它会直接抛异常，结构不生成');
  const pv = nums(p), bpv = nums(bp);
  check3(pv && Math.abs(pv[0] - px) < 1e-9 && Math.abs(pv[1] - py) < 1e-9 && Math.abs(pv[2] - pz) < 1e-9,
    'pos = [' + pv.join(', ') + ']');
  check3(bpv[0] === spot.x && bpv[1] === spot.y && bpv[2] === spot.z,
    'blockPos = [' + bpv.join(', ') + ']');
  const rot = get(get(e0, 'nbt'), 'Rotation');
  check3(rot && rot.t === 9 && rot.v.et === 5, 'Rotation 是 List<Float>（元素类型 5）');

  // 站位必须落在结构包围盒里 —— 否则 addEntitiesToWorld 会因为
  // boundingBox.isInside(blockPos) 为假而**静默不生成**
  check3(bpv[0] >= 0 && bpv[0] < sx && bpv[1] >= 0 && bpv[1] < sy && bpv[2] >= 0 && bpv[2] < sz,
    '站位在结构包围盒内（否则实体会被静默跳过）');
}

function check3(cond, msg) { console.log('  ' + (cond ? '✅' : '❌') + ' ' + msg); if (!cond) fail++; }

console.log('\n' + (fail === 0 ? '✅ 注入完成。' : '❌ ' + fail + ' 项校验未通过'));
console.log('\n  注意：站位和朝向是**算**出来的，不是写死的。你改了结构重新存一次，');
console.log('  重跑这个脚本就会自动跟上（且幂等，不会越加越多）。');
process.exitCode = fail === 0 ? 0 : 1;
