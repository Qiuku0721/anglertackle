/*
 * check-sites.js —— 三个结构的**生成口径**守门人（docs/31）。
 *
 * 为什么需要它：2026-10-05 这一天里，"结构怎么摆"被改了四轮，每一轮都是用户看图报出来的：
 *   ① 小屋挂在崖壁上 → 我用了 `projection: terrain_matching`（它让部件各自贴地形，村庄能用是因为村庄只在平地）；
 *   ② 营地被土埋 → `beard_thin` **只加不减**（只在下面补方块，从不挖掉上面的土）；
 *   ③ 钓位漂在河中央 → 河流群系里 `WORLD_SURFACE_WG` 取的是**水面**高度；
 *   ④ 那圈沙台/土包 → `terrain_adaptation` 的本体行为就是"补一圈地形当裙边"，用户明确不要。
 *
 * 这四条**每一条都是"改了没事、看图才发现"的类型**，所以必须由机器守住 ——
 * 否则下次谁顺手把 `none` 改回 `beard_thin`，用户又得再截一张图。
 *
 * 断言：
 *   A. 三个结构的世界生成文件齐全（结构 / 结构集 / 模板池 / NBT）
 *   B. 投影一律 `rigid`（不许 terrain_matching）
 *   C. 地形修饰一律 `none`（不许 beard_thin / beard_box —— 那就是"一圈地形包住"）
 *   D. `start_height.absolute == 0`（补底关掉后抬高就是悬空）
 *   E. 起点贴 `WORLD_SURFACE_WG`
 *   F. 钓位群系**不含河流**；营地群系**只在平坦群系**；密度关系正确
 *   G. 四个容器（木桶/装饰罐）都挂了对应战利品表，且 NBT 里**没有残留 Items**
 *   H. 四条带的实测概率 = 71.5 / 25 / 3 / 0.5，且一箱至多 2 件 mod 物品；鱼的每条都写了 tier
 *
 * 用法：node tools/check-sites.js
 */
const fs = require('fs');
const path = require('path');
const nbt = require('./lib-nbt');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const json = (p) => JSON.parse(read(p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 结构生成口径检查（docs/31）===\n');

const WG = 'src/main/resources/data/anglertackle/worldgen/';
const SITES = [
  { id: 'fisherman_hut', name: '钓鱼小屋', tag: 'has_fisherman_hut', spacing: 34 },
  { id: 'fishing_spot', name: '钓位', tag: 'has_fishing_spot', spacing: 6, startHeight: 1 },
  { id: 'wild_camp', name: '野外营地', tag: 'has_wild_camp', spacing: 26, startHeight: 0 },
];
const TABLES = 'src/main/resources/data/anglertackle/loot_table/chests/';

// ---------------------------------------------------------------- A~E 文件与三项参数
for (const s of SITES) {
  const st = json(WG + 'structure/' + s.id + '.json');
  const pool = json(WG + 'template_pool/' + s.id + '.json');
  const set = json(WG + 'structure_set/' + s.id + '.json');
  const nbtPath = 'src/main/resources/data/anglertackle/structure/' + s.id + '.nbt';
  const missing = [WG + 'structure/' + s.id + '.json', WG + 'template_pool/' + s.id + '.json',
    WG + 'structure_set/' + s.id + '.json', nbtPath].filter((p) => !exists(p));
  if (missing.length) { bad(s.name + ' 缺文件：' + missing.join('、')); continue; }

  const proj = pool.elements[0].element.projection;
  if (proj === 'rigid') ok(s.name + ' 投影 rigid（结构保持形状）');
  else bad(s.name + ' 投影是 ' + proj + ' —— terrain_matching 会让部件各自贴地形，坡地上摊开/被吞（用户报过）');

  if (st.terrain_adaptation === 'none') ok(s.name + ' 地形修饰 none（不会有一圈地形包住它）');
  else bad(s.name + ' 地形修饰是 ' + st.terrain_adaptation + ' —— beard_* 会在结构周围补一圈地形当裙边（用户明确不要）');

  const sh = st.start_height && st.start_height.absolute;
  const wantSh = s.startHeight || 0;
  if (sh === wantSh) ok(s.name + ' start_height ' + sh + '（站点自己的口径）');
  else bad(s.name + ' start_height 是 ' + JSON.stringify(st.start_height) + '，期望 ' + wantSh
    + '（补底关掉后抬升=纯位置上移，抬多了会悬空；钓位抬 1 格是为了让平台露出水面）');

  if (st.project_start_to_heightmap === 'WORLD_SURFACE_WG') ok(s.name + ' 起点贴 WORLD_SURFACE_WG');
  else bad(s.name + ' 起点高度图是 ' + st.project_start_to_heightmap);

  if (st.biomes === '#anglertackle:' + s.tag) ok(s.name + ' 群系指向 #anglertackle:' + s.tag);
  else bad(s.name + ' 的 biomes 是 ' + st.biomes + '，应为 #anglertackle:' + s.tag);

  const sp = set.placement.spacing;
  if (sp === s.spacing) ok(s.name + ' 密度 spacing ' + sp + '/' + set.placement.separation);
  else bad(s.name + ' spacing 是 ' + sp + '，期望 ' + s.spacing);
  console.log('');
}

// ---------------------------------------------------------------- F 群系与密度关系
{
  const tagDir = 'src/main/resources/data/anglertackle/tags/worldgen/biome/';
  const spot = json(tagDir + 'has_fishing_spot.json').values;
  if (spot.some((v) => /is_river|river/.test(v))) {
    bad('钓位群系含河流：河流大半是水面，WORLD_SURFACE_WG 在水里取的是**水面**高度 → 结构漂在河心（用户截图过）');
  } else ok('钓位群系不含河流（' + spot.join('、') + '）');

  const FLAT = ['minecraft:plains', 'minecraft:sunflower_plains', 'minecraft:meadow',
    'minecraft:snowy_plains', 'minecraft:cherry_grove'];
  const camp = json(tagDir + 'has_wild_camp.json').values;
  const notFlat = camp.filter((v) => !FLAT.includes(v));
  if (notFlat.length) bad('营地群系列表里有非平坦群系：' + notFlat.join('、') + ' —— 关掉补底后就靠"只在平地生成"兜底');
  else ok('营地只生成在平坦群系（' + camp.length + ' 个）');

  const spotSpacing = json(WG + 'structure_set/fishing_spot.json').placement.spacing;
  const campSpacing = json(WG + 'structure_set/wild_camp.json').placement.spacing;
  if (spotSpacing <= 8 && spotSpacing < campSpacing && campSpacing < 34) {
    ok('密度关系正确：钓位 ' + spotSpacing + ' < 营地 ' + campSpacing + ' < 村庄 34');
  } else {
    bad('密度关系不对：钓位 ' + spotSpacing + ' / 营地 ' + campSpacing + '（应 钓位≤8 < 营地 < 34）');
  }
}

// ---------------------------------------------------------------- G 容器挂表
console.log('');
for (const s of SITES) {
  const typed = nbt.readNbtTyped(path.join(ROOT, 'src/main/resources/data/anglertackle/structure/' + s.id + '.nbt'));
  const pal = nbt.get(typed.root, 'palette').v.items.map((p) => String(nbt.get(p, 'Name').v));
  // 小屋的容器是**箱子**（它那张表由 check-hut-loot.js 守），营地和钓位是木桶/装饰罐
  const want = s.id === 'fisherman_hut'
    ? { 'minecraft:chest': 'anglertackle:chests/fisherman_hut' }
    : { 'minecraft:barrel': 'anglertackle:chests/' + s.id + '_tackle',
        'minecraft:decorated_pot': 'anglertackle:chests/' + s.id + '_fish' };
  let total = 0, tagged = 0, leftovers = 0;
  for (const b of typed.root.v.blocks.v.items) {
    const name = pal[Number(nbt.get(b, 'state').v)];
    if (!want[name]) continue;
    total++;
    const tag = nbt.get(b, 'nbt');
    const lt = tag && nbt.get(tag, 'LootTable');
    const id = lt ? String(lt.v) : null;
    if (id === want[name]) tagged++;
    if (tag && nbt.get(tag, 'Items')) leftovers++;
  }
  if (!total) bad(s.name + ' 里一个容器都没有？结构被换了');
  else if (tagged !== total) bad(s.name + ' 只有 ' + tagged + '/' + total + ' 个容器挂了正确的战利品表');
  else ok(s.name + ' 的 ' + total + ' 个容器都挂了表');
  if (leftovers) bad(s.name + ' 有 ' + leftovers + ' 个容器残留 Items（开箱会先看到造物清单再被表覆盖）');
}

// ---------------------------------------------------------------- H 战利品概率
console.log('');
const BANDS = [
  { label: '白绿', tiers: [0, 1], pct: 71.5 },
  { label: '蓝紫', tiers: [2, 3], pct: 25 },
  { label: '金', tiers: [4], pct: 3 },
  { label: '红', tiers: [5], pct: 0.5 },
];
const FISH_COMPONENT = 'anglertackle:fish_data';
for (const s of SITES.filter((x) => x.id !== 'fisherman_hut')) {
  const tackle = json(TABLES + s.id + '_tackle.json');
  const cap = tackle.pools.reduce((a, p) => a + (typeof p.rolls === 'number' ? p.rolls : p.rolls.max), 0);
  if (cap <= 2) ok(s.name + ' 配件表最多 ' + cap + ' 件 mod 物品（用户定的上限 2）');
  else bad(s.name + ' 配件表最多 ' + cap + ' 件 mod 物品，超了上限 2');
  const entries = tackle.pools.flatMap((p) => p.entries);
  const totalW = entries.reduce((a, e) => a + (e.weight ?? 1), 0);
  for (const b of BANDS) {
    const w = entries.filter((e) => b.tiers.some((t) => {
      const id = e.name.replace('anglertackle:', '');
      return (tackleBandOf(id) === t);
    })).reduce((a, e) => a + (e.weight ?? 1), 0);
    const got = w / totalW * 100;
    if (Math.abs(got - b.pct) < 0.3) ok(s.name + ' 配件 ' + b.label + ' ' + got.toFixed(2) + '%（目标 ' + b.pct + '%）');
    else bad(s.name + ' 配件 ' + b.label + ' ' + got.toFixed(2) + '%，目标 ' + b.pct + '%');
  }
  const fish = json(TABLES + s.id + '_fish.json');
  if (fish.pools.length === 1 && fish.pools[0].rolls === 1) ok(s.name + ' 鱼表单池、固定一条');
  else bad(s.name + ' 鱼表不是"单池 rolls 1"');
  const fEntries = fish.pools[0].entries;
  const fTotal = fEntries.reduce((a, e) => a + (e.weight ?? 1), 0);
  const noTier = fEntries.filter((e) => {
    const c = e.functions && e.functions[0] && e.functions[0].components;
    return !c || !c[FISH_COMPONENT] || c[FISH_COMPONENT].tier === undefined;
  });
  if (noTier.length) bad(s.name + ' 有 ' + noTier.length + ' 条鱼没写 tier（不写就是普通品质鱼）');
  else ok(s.name + ' 鱼表 ' + fEntries.length + ' 条鱼都写了 tier');
  for (const b of BANDS) {
    const w = fEntries.filter((e) => b.tiers.includes(e.functions[0].components[FISH_COMPONENT].tier))
      .reduce((a, e) => a + (e.weight ?? 1), 0);
    const got = w / fTotal * 100;
    if (Math.abs(got - b.pct) < 0.3) ok(s.name + ' 鱼 ' + b.label + ' ' + got.toFixed(2) + '%（目标 ' + b.pct + '%）');
    else bad(s.name + ' 鱼 ' + b.label + ' ' + got.toFixed(2) + '%，目标 ' + b.pct + '%');
  }
  console.log('');
}

/** 从 id 反推配件所属档带（与 gen-sites.js 同一套口径）。 */
function tackleBandOf(id) {
  const lineTier = { hemp_line: 1, cotton_line: 2, nylon_line: 3, fluoro_line: 4, pe_line: 5, titanium_line: 6 };
  if (lineTier[id]) return lineTier[id] - 1;
  const reelTier = { hand_reel: 1, spinning_reel: 2, drum_reel: 3, baitcast_reel: 4, heavy_reel: 5 };
  if (reelTier[id]) return reelTier[id] - 1;
  const mat = /^(wood|iron|gold|diamond|netherite)_(lure|float)_rod$/.exec(id);
  if (mat) return { wood: 0, iron: 1, gold: 2, diamond: 3, netherite: 4 }[mat[1]];
  const lureTier = { lure_spoon: 2, lure_glowspoon: 2, lure_minnow: 3, lure_soft: 3, lure_deep: 4,
    lure_depthfinder: 3, lure_paddletail: 4, lure_vibration: 5, lure_rattle: 5, lure_gilded: 6 };
  if (lureTier[id]) return lureTier[id] - 1;
  const baitTier = { bait_bread: 0, bait_worm: 0, bait_corn: 1, bait_shrimp: 2, bait_glow: 4, bait_secret: 5 };
  if (baitTier[id] !== undefined) return baitTier[id];
  return -1;
}

// ---------------------------------------------------------------- I 表本身必须能被游戏解析
// ⚠ 2026-10-05 实测：这两类错误会让**整张表解析失败 → 容器全空**，而在游戏里完全没有提示感
//   （玩家只会说"木桶没物品"）。日志里才有 "Couldn't parse element ... loot_table"。
for (const s of SITES.filter((x) => x.id !== 'fisherman_hut')) {
  for (const [suffix, kind] of [['_tackle', '配件表'], ['_fish', '鱼表']]) {
    const rel = TABLES + s.id + suffix + '.json';
    const raw = read(rel);
    if (raw.includes("[object Object]")) bad(s.name + ' 的' + kind + '里有 [object Object] —— 字符串拼错了对象，表会被拒');
    if (raw.includes('null') || raw.includes('NaN')) bad(s.name + ' 的' + kind + '里有 null/NaN —— 表会被拒（容器会全空）');
    const seq = json(rel).random_sequence;
    if (seq === 'anglertackle:chests/' + s.id + suffix) ok(s.name + ' ' + kind + ' 的 random_sequence 正确');
    else bad(s.name + ' ' + kind + ' 的 random_sequence 是 ' + seq + '（应为 anglertackle:chests/' + s.id + suffix + '）');
  }
}

console.log('');
if (fail === 0) {
  console.log('✅ 结构生成口径检查通过：投影 rigid / 无地形修饰 / 贴地表 / 群系与密度正确 / 容器挂表且无残留 / 四条带概率命中');
} else {
  console.log('❌ 结构生成口径检查失败：' + fail + ' 项');
}
process.exitCode = fail === 0 ? 0 : 1;
