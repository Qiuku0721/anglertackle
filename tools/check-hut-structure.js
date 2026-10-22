/*
 * check-hut-structure.js —— 渔夫小屋结构能不能真的被世界生成用起来。
 *
 * 触发理由：结构文件坏掉的表现是**静默不生成**，不是报错。
 * 数据包路径写错（structures 写成复数）、NBT 被编辑器改坏、
 * 群系标签漏了、结构 JSON 引用了不存在的模板池 —— 这四件事在游戏里
 * 全都表现为"走了半天没找到小屋"，日志里一个字都没有。
 *
 * 所以这里把"能离线断言的部分"全部断言掉，把游戏内验证压缩到
 * "河边到底长没长出来"这一件只能靠眼睛的事。
 *
 * 用法：node tools/check-hut-structure.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const J = path.join(ROOT, 'src/main/resources');
const exists = (p) => fs.existsSync(path.join(J, p));
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(J, p), 'utf8'));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const info = (m) => console.log('  ℹ  ' + m);

console.log('=== 渔夫小屋结构检查 ===\n');

// ---------------------------------------------------------------- ① 路径
const NBT = 'data/anglertackle/structure/fisherman_hut.nbt';
if (exists(NBT)) {
  ok('结构文件在 ' + NBT + '（注意 structure 是**单数**）');
} else {
  bad('缺 ' + NBT + ' —— 路径写成 structures（复数）不会报错，但结构永远不生成');
}
// 反向：不许出现复数目录
if (exists('data/anglertackle/structures')) {
  bad('存在 data/anglertackle/structures 目录（复数）—— 1.21 不认，删掉或改名');
}

// ---------------------------------------------------------------- ② NBT 能被解析
let summary = null;
if (exists(NBT)) {
  try {
    const { summarize } = require('./lib-nbt');
    summary = summarize(path.join(J, NBT));
    ok('NBT 可解析：' + summary.size.join('×') + '，' + summary.blocks + ' 方块，'
      + summary.paletteSize + ' 种，' + summary.entities + ' 实体');
    if (summary.blocks > 0 && summary.size.every((v) => v > 0)) ok('尺寸与方块数都非零');
    else bad('结构是空的（尺寸或方块数为 0）—— 多半是文件被截断了');
  } catch (e) {
    bad('NBT 解析失败：' + e.message + '（结构文件坏掉在游戏里只表现为"不生成"）');
  }
}

// ---------------------------------------------------------------- ③ 群系标签
const TAG = 'data/anglertackle/tags/worldgen/biome/has_fisherman_hut.json';
if (exists(TAG)) {
  const t = readJson(TAG);
  if (Array.isArray(t.values) && t.values.length) {
    ok('群系标签存在：' + t.values.join(' / '));
    if (t.values.includes('#minecraft:is_river')) ok('包含河流群系（策划案要求"河边"）');
    else bad('标签里没有河流群系 —— 小屋不会长在河边');
  } else {
    bad(TAG + ' 的 values 是空的 —— 空标签 = 任何群系都不生成');
  }
} else {
  bad('缺 ' + TAG);
}

// ---------------------------------------------------------------- ④ 结构 JSON + 模板池
const STRUCT = 'data/anglertackle/worldgen/structure/fisherman_hut.json';
const POOL = 'data/anglertackle/worldgen/template_pool/fisherman_hut.json';
const ENTITY_ID = 'anglertackle:fisherman';

if (!exists(STRUCT)) {
  bad('缺 ' + STRUCT + ' —— 没有它小屋永远不生成');
} else {
  const s = readJson(STRUCT);
  if (s.type === 'minecraft:jigsaw') ok('结构类型 minecraft:jigsaw');
  else bad('结构类型是 ' + s.type + '，本方案用 minecraft:jigsaw（单体结构 + 单元素模板池）');

  // biomes 必须指向真实存在的标签
  const bis = String(s.biomes || '');
  if (bis.startsWith('#')) {
    const [ns, p] = bis.slice(1).split(':');
    const tagPath = ns === 'minecraft' ? null : 'data/' + ns + '/tags/worldgen/biome/' + p + '.json';
    if (!tagPath) info('biomes 用的是原版标签 ' + bis + '（不检查原版内容）');
    else if (exists(tagPath)) ok('biomes → ' + bis + '（标签存在）');
    else bad('biomes 指向 ' + bis + '，但 ' + tagPath + ' 不存在');
  } else {
    bad('biomes 应当写成标签（#' + '...），写具体群系 id 的话以后加群系要改结构文件');
  }

  // start_pool 必须指向真实存在的模板池
  const poolRef = String(s.start_pool || '');
  const poolFile = poolRef ? 'data/' + poolRef.replace(':', '/worldgen/template_pool/') + '.json' : '';
  if (poolRef && exists(poolFile)) ok('start_pool → ' + poolRef + '（模板池存在）');
  else bad('start_pool 指向 ' + (poolRef || '(空)') + '，但 ' + poolFile + ' 不存在');

  // size：单体结构必须是 1。写成 >1 会去找 jigsaw 接口继续拼，我们没放接口，
  // 表现是"只生成一个碎片"或者干脆拼不出东西
  if (s.size === 1) ok('size = 1（单体结构，不拼图）');
  else bad('size = ' + s.size + '，单体结构应当写 1');

  // 高度：project_start_to_heightmap 一定要有，否则小屋会生成在 y=0 的虚空里
  if (s.project_start_to_heightmap) ok('project_start_to_heightmap = ' + s.project_start_to_heightmap
    + '（在河流群系里落到**水面之上第一格**）');
  else bad('缺 project_start_to_heightmap —— 结构会落到 start_height 的绝对值上');
  // 把 start_height 的**含义**打出来：它加在高度图之上，是唯一"凭手感调"的值。
  // 用户 2026-07-01 反馈"生成高度需要抬高一格"时，就是从 -1 调到 0 的这一格。
  {
    const abs = s.start_height && typeof s.start_height.absolute === 'number' ? s.start_height.absolute : null;
    if (abs === null) {
      bad('start_height 不是 {absolute: N} —— 调高度会变得很难');
    } else {
      const where = abs === 0 ? '地基正好落在水面线上'
        : abs < 0 ? '整体沉到水面线以下 ' + (-abs) + ' 格（小屋会泡在水里）'
                  : '整体浮在水面线上方 ' + abs + ' 格';
      console.log('  ℹ  start_height = ' + abs + ' → ' + where
        + '（高度图给的是水面之上第一格，这个值直接加减在它上面）');
    }
  }

  // ⚠ placement **不在**结构 JSON 里，在 structure_set 里。
  //
  //   之前这里断言的是"结构 JSON 必须有 placement"—— 那个断言是**错的**：
  //   1.21.1 的结构 JSON 根本没有 placement 字段（Structure.StructureSettings.CODEC
  //   只有 biomes/spawn_overrides/step/terrain_adaptation），写了会被 RecordCodecBuilder
  //   **静默忽略**。而 placement 的真正归属是 data/<ns>/worldgen/structure_set/<名字>.json。
  //
  //   这个错误断言让一个"结构永远不会生成"的 bug 一路绿着通过了所有检查 ——
  //   用户跑了好久没找到小屋，日志里却一个字都没有。
  //   教训：断言的方向错了，比没有断言更坏，因为它会给人"这块已经守住了"的错觉。
  if (s.placement !== undefined) {
    bad('结构 JSON 里有 placement —— 1.21.1 **不认**这个字段（会被静默忽略），'
      + 'placement 必须写在 worldgen/structure_set/ 里。留着它只会让人以为它生效了');
  } else {
    ok('结构 JSON 里没有 placement（它属于 structure_set，不属于结构）');
  }
}

// ---------------------------------------------------------------- ④b structure_set
//
// ★ 这是"小屋到底会不会生成"的**决定性**文件。少了它，结构 JSON 再正确也不生成，
//   而且**不报错、日志里什么都没有**。
const SET = 'data/anglertackle/worldgen/structure_set/fisherman_hut.json';
if (!exists(SET)) {
  bad('缺 ' + SET + ' —— **没有它小屋永远不会自然生成**（表现是"跑了很远也没看到"，'
    + '而且日志里一个字都没有）。placement 属于 structure_set，不属于结构 JSON');
} else {
  const st = readJson(SET);
  if (!Array.isArray(st.structures) || st.structures.length === 0) {
    bad('structure_set 的 structures 是空的 —— 等于没登记');
  } else {
    const hit = st.structures.some((x) => x.structure === 'anglertackle:fisherman_hut');
    if (hit) ok('structure_set 里登记了 anglertackle:fisherman_hut');
    else bad('structure_set 里没有 anglertackle:fisherman_hut（列的是 '
      + st.structures.map((x) => x.structure).join(', ') + '）');
    // 登记的结构必须真实存在
    for (const x of st.structures) {
      const f = 'data/' + String(x.structure).replace(':', '/worldgen/structure/') + '.json';
      if (exists(f)) ok('structure_set 里的 ' + x.structure + ' 有对应的结构定义');
      else bad('structure_set 里列了 ' + x.structure + '，但 ' + f + ' 不存在');
    }
  }
  const pl = st.placement;
  if (!pl) {
    bad('structure_set 缺 placement —— 结构没有分布规则，还是不生成');
  } else {
    if (pl.type === 'minecraft:random_spread') ok('placement: random_spread');
    else bad('placement.type = ' + pl.type + '，本方案用 minecraft:random_spread');
    if (typeof pl.spacing === 'number' && typeof pl.separation === 'number') {
      if (pl.separation < pl.spacing) ok('spacing = ' + pl.spacing + ' 区块，separation = ' + pl.separation + ' 区块');
      else bad('separation(' + pl.separation + ') 必须小于 spacing(' + pl.spacing + ')，否则永远排不下');
      // ⚠ 这一项被改过两次，两次都是用户口径，别再"顺手调密/调稀"：
      //   · 2026-09-30：spacing=34 被嫌"跑了好久没看到"，调密到 10；
      //   · 2026-10-02：用户反过来说"**调低**老柯小屋刷新，调到和村庄差不多"，
      //     于是改回 **34 / 8** —— 这两个数就是原版村庄
      //     （data/minecraft/worldgen/structure_set/villages_*.json）的 spacing/separation。
      //   配套的是新的「渔夫小屋定位线索」物品：小屋变稀之后，找不找得到取决于道具，
      //   而不是靠把结构撒满地图。
      const VILLAGE_SPACING = 34, VILLAGE_SEPARATION = 8;
      if (pl.spacing === VILLAGE_SPACING && pl.separation === VILLAGE_SEPARATION) {
        ok('刷新率 = 原版村庄（spacing ' + VILLAGE_SPACING + ' / separation ' + VILLAGE_SEPARATION + '）');
      } else {
        bad('spacing/separation = ' + pl.spacing + '/' + pl.separation + '，用户口径是'
          + '"和村庄差不多"（原版村庄 ' + VILLAGE_SPACING + '/' + VILLAGE_SEPARATION + '）');
      }
      if (pl.spacing < 4) bad('spacing = ' + pl.spacing + ' 太小，小屋会挤成一片');
      // 把预期距离**打出来**：以后调 spacing 时能直接看到后果，不用重新推一遍
      const P_BIOME = 0.05;   // 河流群系占比的粗估
      const expect = Math.round(pl.spacing * 16 / Math.sqrt(P_BIOME));
      console.log('  ℹ  预期寻找距离 ≈ ' + expect + ' 格'
        + '（spacing ' + pl.spacing + ' 区块 × 16 ÷ √' + P_BIOME + '，按河流群系占比估算）'
        + '　→ 这个距离就是「渔夫小屋定位线索」存在的理由');
    } else {
      bad('placement 缺 spacing/separation');
    }
    if (Number.isInteger(pl.salt)) ok('salt = ' + pl.salt + '（结构分布的随机盐，各结构必须不同）');
    else bad('placement 缺 salt（非负整数）');
  }
}

if (!exists(POOL)) {
  bad('缺 ' + POOL);
} else {
  const p = readJson(POOL);
  if (!Array.isArray(p.elements) || !p.elements.length) {
    bad('模板池 elements 是空的 —— 结构不会生成');
  } else {
    for (const el of p.elements) {
      const loc = el.element && el.element.location;
      if (!loc) { bad('模板池里有元素没写 element.location'); continue; }
      const f = 'data/' + loc.replace(':', '/structure/') + '.nbt';
      if (exists(f)) ok('模板池元素 ' + loc + ' → ' + f);
      else bad('模板池元素 ' + loc + ' 指向的 ' + f + ' 不存在（结构不会生成，且不报错）');
      if (loc !== 'anglertackle:fisherman_hut') {
        info('模板池元素是 ' + loc + '（与结构文件名不同，确认是有意的）');
      }
    }
    if (p.fallback === undefined) bad('模板池缺 fallback 字段');
    else ok('fallback = ' + p.fallback);
  }
}

// ---------------------------------------------------------------- ⑤ 关键坐标与实体（结构被改动时报警）
if (summary) {
  const { buildGrid } = require('./lib-nbt');
  const { grid, size } = buildGrid(summary.root);
  const [sx, sy, sz] = size;
  const at = (x, y, z) => (x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz ? grid[x][y][z] : null);

  // 门：朝 +x 的两格高门
  const doors = [];
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    if (/_door$/.test(grid[x][y][z] || '')) doors.push([x, y, z]);
  }
  if (doors.length >= 2) ok('门存在且为 ' + doors.length + ' 格（' + doors.map((d) => d.join(',')).join(' / ') + '）');
  else bad('找不到门（_door 方块）—— 老柯的"回家"方向要按门来定，门没了逻辑就没依据');

  // 结构里必须恰好有 1 个实体，而且必须是我们注入的老柯。
  // 断言从"必须 0 个"翻成"必须是我们那一个"，两件事都要守：
  //   * 少一个 → 老柯不会出现（tools/inject-npc.js 没跑或跑失败了）
  //   * 多出来 → 存结构时把生物也框进去了，会跟着一起刷一堆东西
  if (summary.entities !== 1) {
    bad('结构里有 ' + summary.entities + ' 个实体，应当是**恰好 1 个**（老柯）。'
      + (summary.entities === 0
        ? ' 少一个 → 跑 node tools/inject-npc.js'
        : ' 多出来 → 存结构时把生物也框进去了，重存时关掉"包含实体"'));
  } else {
    try {
      const typed = require('./lib-nbt').readNbtTyped(path.join(J, NBT));
      const ents = typed.root.v.entities;
      if (!ents || ents.t !== 9) { bad('entities 不是 List'); }
      else {
        if (ents.v.et !== 10) bad('entities 的元素类型是 ' + ents.v.et + '，应当是 10（List<Compound>）');
        const e0 = ents.v.items[0];
        const idNode = e0.t === 10 && e0.v.nbt && e0.v.nbt.t === 10 ? e0.v.nbt.v.id : null;
        if (idNode && idNode.t === 8 && idNode.v === ENTITY_ID) ok('结构自带实体就是 ' + ENTITY_ID);
        else bad('结构自带的实体 id 是 ' + (idNode ? idNode.v : '(缺失)') + '，应当是 ' + ENTITY_ID);

        // 游戏读取时的真实方式：pos 必须是 List<Double>、blockPos 必须是 List<Int>。
        // 类型写错的表现是"结构照常生成，就是没有那个实体"。
        const p = e0.v.pos, bp = e0.v.blockPos;
        if (p && p.t === 9 && p.v.et === 6) ok('pos 是 List<Double>（元素类型 6）');
        else bad('pos 不是 List<Double> —— 游戏会读出垃圾坐标或读不到实体');
        if (bp && bp.t === 9 && bp.v.et === 3) ok('blockPos 是 List<Int>（元素类型 3，缺了它会直接抛异常）');
        else bad('blockPos 不是 List<Int>');
        // 站位必须落在包围盒里，否则 addEntitiesToWorld 会因为
        // boundingBox.isInside(blockPos) 为假而**静默跳过**
        if (bp && bp.t === 9 && bp.v.et === 3) {
          const [bx, by, bz] = bp.v.items.map((x) => x.v);
          if (bx >= 0 && bx < sx && by >= 0 && by < sy && bz >= 0 && bz < sz) {
            ok('站位 [' + [bx, by, bz].join(', ') + '] 在包围盒内，且脚下是 ' + at(bx, by, bz)
              + '、头顶两格空 —— 老柯不会卡在方块里');
            const foot = at(bx, by, bz);
            if (!foot || /_slab$|_stairs$|_fence$|_pane$|_trapdoor$/.test(foot)) {
              bad('站位脚下是 ' + foot + ' —— 不是整块，老柯会悬空或被卡住');
            }
          } else {
            bad('站位 [' + [bx, by, bz].join(', ') + '] 在包围盒外 —— 实体会被静默跳过，老柯不会出现');
          }
        }
      }
    } catch (e) {
      bad('读 entities 失败：' + e.message);
    }
  }

  // 码头必须伸出去（最外侧两列有方块），否则"码头到底在哪一侧"无从判断
  const outer = [];
  for (let x = sx - 1; x >= 0 && outer.length < 2; x--) {
    let n = 0;
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) if (grid[x][y][z]) n++;
    if (n > 0) outer.push(x + '(' + n + ')');
  }
  ok('最外侧两列（列号(方块数)）：' + outer.join('  ') + ' → 码头朝 +x，水域应该在 x > ' + Math.max(sx - 1, 0) + ' 那一侧');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  为什么这些断言值得写：结构出问题的表现**全都是"不生成"**，');
console.log('  没有一条报错会告诉你原因。能在离线断言的就不要留给游戏内试。');
process.exitCode = fail === 0 ? 0 : 1;
