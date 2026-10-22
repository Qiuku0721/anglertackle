/*
 * gen-sites.js —— 野外营地 / 钓位 两个结构（用户 2026-10-05 保存的成品）
 *                 + 它们的战利品表 + 世界生成三件套。设计见 docs/31。
 *
 * 用户要求（原话）：
 *   · 营地"必须与生成地形合为一体，不能出现凹陷下去排开泥土，需要镶嵌的感觉"
 *   · 钓位"一个台阶方块必须处于水面上，其他区域处于陆地"
 *   · 营地密度比村庄大一丢丢；钓位刷新在水边、密度可以稍微大点
 *   · 木桶刷鱼竿/鱼线等配件物资：白绿 70% / 蓝紫 25% / 金 4.5% / 红 0.5%
 *   · 瓦罐随机一条鱼，概率同上
 *   · ⚠ 一个容器至多刷 **2 个 mod 物品**
 *
 * ── 三条容易写错的规矩（都写成断言，跑完会自己报）────────────────
 * ① **档位两套刻度**：鱼饵 `BaitItem.tier` 是 0 起算，配件 `PartStats.partTier` 是 1 起算。
 *    这里统一换算成"白=0 … 红=5"再分带 —— 混着用不会报错，只是"某些档的分布不对"。
 * ② **至多 2 件 mod 物品**：木桶/瓦罐各自**只有一个池子**、`rolls = uniform(1,2)`。
 *    老柯小屋那张表是多池模型（一箱能出 4~5 件），这个新口径不能照抄。
 * ③ **没有档位标记的物品不许猜**：鱼钩/渔轮（`PartStats.hook(...)`/`reel(...)` 不带档位）
 *    与解析不出档位的鱼竿一律**不进池子**，只打印出来 —— 要它们进池子，先在代码里给档位。
 */
const fs = require('fs');
const path = require('path');
const nbt = require('./lib-nbt');
const { N } = nbt;

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, '参考资料/结构');
const STRUCT_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/structure');
const TABLE_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/loot_table/chests');
const WG_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/worldgen');

// ---------------------------------------------------------------- 目标概率
const BANDS = [
  // 金 4.5% → 3%（用户 2026-10-05："没红的东西就把金爆率调到 3%"），差额给白绿。
  // ⚠ 权重量级取 1000（而不是 10）：红带 0.5% 摊到十几条鱼上，量级太小会摊出 **weight: 0**
  //   的废条目（战利品表里 weight 0 = 永远抽不到），实测就是这么漏掉红鱼的。
  { id: 'low', label: '白绿', tiers: [0, 1], pct: 71.5, weight: 71500 },
  { id: 'mid', label: '蓝紫', tiers: [2, 3], pct: 25, weight: 25000 },
  { id: 'gold', label: '金', tiers: [4], pct: 3, weight: 3000 },
  { id: 'red', label: '红', tiers: [5], pct: 0.5, weight: 500 },
];
const bandOfTier = (t) => BANDS.find((b) => b.tiers.includes(t));
const MOD_ITEMS_PER_CONTAINER_MAX = 2;

const SITES = [
  {
    id: 'wild_camp', src: 'yewaiyingdi.nbt', name: '野外营地',
    spacing: 26, separation: 6, salt: 1283002,
    startHeight: 0,
    biomes: '#anglertackle:has_wild_camp',
  },
  {
    id: 'fishing_spot', src: 'diaowei.nbt', name: '钓位',
    spacing: 6, separation: 2, salt: 1283003,
    // 用户 2026-10-05："把钓位的生成抬一格" —— 抬 1 格让平台与台阶整体露出水面
    // （地形修饰是 none，所以不会自己找平；抬这一格纯粹是位置上移）。
    startHeight: 1,
    biomes: '#anglertackle:has_fishing_spot',
    // ⚠ 生物群系标签里**不能放 #minecraft:is_river**：河流大半是水面，
    //   而 WORLD_SURFACE_WG 在水里取的就是**水面**高度 → 结构落在河中央漂着
    //   （用户 2026-10-05 截图：钓位四周全是水）。只留"地表就在水边"的群系：
    //   沙滩 / 石岸 / 沼泽 / 红树林沼泽。
    biomeNote: '不含河流',
  },
];

// ---------------------------------------------------------------- ① 道具档位（代码是真源）
const itemSrc = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'), 'utf8');
const lines = itemSrc.split('\n');

/** 把源码里写着的档位解析成"白=0 … 红=5"。 */
/** 调试物品**一律不进战利品**（老柯小屋那张表同样处理；不然红带一半是测试饵）。 */
const LOOT_BLOCKLIST = new Set(['lure_test_red', 'fisherman_spawn_egg']);

const bandTier = {};      // 物品 id → 0..5
const unbanded = [];      // 解析不出档位的（只打印，不进池子）

for (let i = 0; i < lines.length; i++) {
  const reg = /ITEMS\.register\("([a-z0-9_]+)"/.exec(lines[i]);
  if (!reg) continue;
  const id = reg[1];
  if (LOOT_BLOCKLIST.has(id)) continue;
  const chunk = lines.slice(i, i + 6).join(' ');
  let tier = null;
  let m;
  if ((m = /PartStats\.line\([^)]*?,\s*(\d+)\s*\)/.exec(chunk))) tier = Number(m[1]) - 1;      // 1 起算
  else if ((m = /PartStats\.lure\((\d+)\)/.exec(chunk))) tier = Number(m[1]) - 1;               // 1 起算
  else if ((m = /new BaitItem\(\s*(\d+)\s*,/.exec(chunk))) tier = Number(m[1]);                 // 0 起算
  // 渔轮：2026-10-05 起 PartStats.reel(...) 带第 5 个参数 = 档位（1 起算）
  else if ((m = /PartStats\.reel\([^)]*?,\s*(\d+)\s*\)/.exec(chunk))) tier = Number(m[1]) - 1;
  // 鱼钩**不进池子**（用户 2026-10-05："鱼钩不弄"）
  else if (/PartStats\.hook\(/.test(chunk)) { unbanded.push(id + '（鱼钩：按用户口径不进池子）'); continue; }
  // 鱼竿：走 rod("wood_lure_rod", …) 辅助函数，档位由**材质**决定（id 里就写着）
  else if (/^(.+)_(lure|float)_rod$/.test(id)) {
    const mat = /^(.+)_(lure|float)_rod$/.exec(id)[1];
    const ladder = { wood: 1, iron: 2, gold: 3, diamond: 4, netherite: 5 };
    if (ladder[mat]) tier = ladder[mat] - 1;
    else { unbanded.push(id + '（材质 ' + mat + ' 不在阶梯里）'); continue; }
  }
  else continue;
  if (tier < 0 || tier > 5) { unbanded.push(id + '（档位越界 ' + tier + '）'); continue; }
  bandTier[id] = tier;
}
const byBand = {};
for (const [id, t] of Object.entries(bandTier)) {
  const b = bandOfTier(t);
  if (!b) { unbanded.push(id + '（档位 ' + t + ' 不属于任何带）'); continue; }
  (byBand[b.id] = byBand[b.id] || []).push(id);
}
console.log('=== 能进池子的配件（按带）===');
for (const b of BANDS) console.log('  ' + b.label + '（' + b.pct + '%）：' + ((byBand[b.id] || []).join(', ') || '（空）'));
console.log('  ⚠ 不进池子的：' + unbanded.join('；'));

// ---------------------------------------------------------------- ② 鱼（档位范围 + 体长/体重）
const speciesSrc = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java'), 'utf8');
const ranges = {};
for (const m of speciesSrc.matchAll(/private static final int\[\] (\w+) = \{([\d,\s]+)\}/g)) {
  ranges[m[1]] = m[2].split(',').map((s) => Number(s.trim()));
}
const fish = [];
for (const m of speciesSrc.matchAll(/new FishSpecies\("([a-z_]+)",\s*ModItems\.\w+,\s*([\d.]+),\s*([\d.]+),\s*(\w+),/g)) {
  const tiers = ranges[m[4]];
  if (!tiers) { unbanded.push(m[1] + '（档位常量 ' + m[4] + ' 解析不出）'); continue; }
  fish.push({ id: m[1], minKg: Number(m[2]), maxKg: Number(m[3]), tiers });
}
// 体长：docs/03 的鱼种表（数值真源），按中文名 → id
const zh = JSON.parse(fs.readFileSync(path.join(ROOT,
  'src/main/resources/assets/anglertackle/lang/zh_cn.json'), 'utf8'));
const nameToId = {};
for (const [k, v] of Object.entries(zh)) {
  const mm = /^item\.anglertackle\.([a-z_]+)$/.exec(k);
  if (mm) nameToId[v] = mm[1];
}
// 体长真源：fish_research/<id>.json 的 typicalLengthCm / giantLengthCm
// （那些是带出处的调研数据；docs/03 的鱼种表排版不规整，正则不可靠 —— 踩过）
const cmOf = {};
for (const f of fs.readdirSync(path.join(ROOT, 'fish_research'))) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'fish_research', f), 'utf8'));
  if (!j.id || j.typicalLengthCm === undefined) continue;
  // ⚠ fish_research 里的体长**不一定是数字**：有的是 "10~17"、有的是 "常见 20~25cm"、有的 null。
  //   直接 Number() → NaN → JSON 里变成 null → 战利品表解析失败 → 容器全空（2026-10-05 实测）。
  const num = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const m = String(v).match(/\d+(?:\.\d+)?/);   // 取第一个数字
    return m ? Number(m[0]) : null;
  };
  const typ = num(j.typicalLengthCm);
  const giant = num(j.giantLengthCm);
  if (typ === null && giant === null) continue;     // 交给下面的"缺体长"统一报错
  const lo = typ === null ? giant : typ;
  const hi = giant === null ? lo : Math.max(lo, giant);
  cmOf[j.id] = [lo, hi];
}
const mid = (a, b) => Math.round((a + b) / 2 * 100) / 100;
console.log('\n=== 鱼（按带，档位范围与带相交者入选）===');
const fishByBand = {};
for (const b of BANDS) {
  fishByBand[b.id] = fish.filter((f) => f.tiers.some((t) => b.tiers.includes(t)));
  console.log('  ' + b.label + '：' + fishByBand[b.id].map((f) => f.id).join(', '));
}
const cmMissing = fish.filter((f) => !cmOf[f.id]).map((f) => f.id);
if (cmMissing.length) {
  console.error('❌ 这些鱼在 fish_research 里没有 typicalLengthCm，不许编体长：' + cmMissing.join(', '));
  process.exit(1);
}

// ---------------------------------------------------------------- ③ 战利品表
const item = (id, weight) => ({ type: 'minecraft:item', name: 'anglertackle:' + id, weight });

/**
 * 把"一整带的权重"**精确**摊到该带的每件上：整数分配 + 余数给前几件，和恰好等于带权重。
 *
 * ⚠ 这里踩过一次：第一版给每件都写 `weight = 整带权重`，于是带占比变成"按种类数分配"
 *   —— 白绿 7 件、蓝紫 8 件时实测 69.01% / 28.17% / 2.54%，而生成的表"看着完全正常"。
 *   所以摊完必须反算百分比（脚本末尾那段自检就是为它存在的）。
 */
function spread(band, ids) {
  const n = ids.length;
  if (!n) return [];
  const base = Math.floor(band.weight / n);
  let rest = band.weight - base * n;
  const out = ids.map((id) => item(id, base + (rest-- > 0 ? 1 : 0)));
  // 兜底断言：weight 0 的条目在战利品表里**永远抽不到**，等于静默丢了那一档的鱼
  const zero = out.filter((e) => !e.weight);
  if (zero.length) throw new Error(band.label + ' 带有 ' + zero.length + ' 个 weight:0 的废条目 —— 带权重量级太小');
  return out;
}
const FISH_COMPONENT = 'anglertackle:fish_data';

/** 配件表：**一个池子**、rolls 1~2 → 最多 2 件 mod 物品。 */
function tackleTable(site) {
  return {
    type: 'minecraft:chest',
    pools: [{
      rolls: { type: 'minecraft:uniform', min: 1, max: MOD_ITEMS_PER_CONTAINER_MAX },
      bonus_rolls: 0,
      entries: BANDS.flatMap((b) => spread(b, byBand[b.id] || [])),
    }],
    random_sequence: 'anglertackle:chests/' + site.id + '_tackle',
  };
}

/** 鱼表：**一个池子**、rolls 1 → 固定一条鱼，档位由 set_components 写死。 */
function fishTable(site) {
  return {
    type: 'minecraft:chest',
    pools: [{
      rolls: 1,
      bonus_rolls: 0,
      entries: BANDS.flatMap((b) => spread(b, (fishByBand[b.id] || []).map((f) => f.id)).map((e) => {
        const f = fishByBand[b.id].find((x) => 'anglertackle:' + x.id === e.name);
        const cm = cmOf[f.id];
        if (!Array.isArray(cm) || !Number.isFinite(cm[0]) || !Number.isFinite(cm[1])) {
          throw new Error(f.id + ' 的体长不是有限数字：' + JSON.stringify(cm)
            + ' —— 战利品表里出现 null 会让**整张表解析失败**，容器全空');
        }
        return {
          type: 'minecraft:item',
          name: 'anglertackle:' + f.id,
          weight: e.weight,
          functions: [{
            function: 'minecraft:set_components',
            components: {
              [FISH_COMPONENT]: {
                species: f.id,
                length_cm: mid(cm[0], cm[1]),
                weight_kg: mid(f.minKg, f.maxKg),
                tier: b.tiers[b.tiers.length - 1],   // 取该带最高档（白绿→绿、蓝紫→紫…）
              },
            },
          }],
        };
      })),
    }],
    random_sequence: 'anglertackle:chests/' + site.id + '_fish',
  };
}

// ---------------------------------------------------------------- ④ 结构 NBT（挂表 + 清残留）
const CONTAINERS = { 'minecraft:barrel': '_tackle', 'minecraft:decorated_pot': '_fish' };

function buildStructure(site) {
  const srcPath = path.join(SRC_DIR, site.src);
  const typed = nbt.readNbtTyped(srcPath);
  const pal = nbt.get(typed.root, 'palette').v.items.map((p) => String(nbt.get(p, 'Name').v));
  const counts = {};
  let tagged = 0;
  for (const b of typed.root.v.blocks.v.items) {
    const name = pal[Number(nbt.get(b, 'state').v)];
    const suffix = CONTAINERS[name];
    if (!suffix) continue;
    counts[name] = (counts[name] || 0) + 1;
    let tag = nbt.get(b, 'nbt');
    if (!tag) { tag = N.compound({}); b.v.nbt = tag; }
    // ⚠ 必须清掉结构方块存下来的 Items：不清的话玩家开箱会先看到造物清单，
    //   再被 LootTable 覆盖（表现是"箱子里有东西但一拿就变"）。
    delete tag.v.Items;
    tag.v.LootTable = N.str('anglertackle:chests/' + site.id + suffix);
    tagged++;
  }
  fs.mkdirSync(STRUCT_DIR, { recursive: true });
  const out = path.join(STRUCT_DIR, site.id + '.nbt');
  nbt.writeNbtFile(out, typed.name, typed.root);
  return { tagged, counts, size: nbt.get(typed.root, 'size').v.items.map((x) => Number(x.v)) };
}

// ---------------------------------------------------------------- ⑤ 世界生成三件套
function writeJson(p, obj, what) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log('  ✓ ' + what + ' → ' + path.relative(ROOT, p).replace(/\\/g, '/'));
}

function writeWorldgen(site) {
  writeJson(path.join(WG_DIR, 'template_pool', site.id + '.json'), {
    fallback: 'minecraft:empty',
    elements: [{
      weight: 1,
      element: {
        element_type: 'minecraft:single_pool_element',
        location: 'anglertackle:' + site.id,
        processors: 'minecraft:empty',
        // ⚠ 2026-10-05 实测教训：**不能用 terrain_matching**。
        //   它让每个部件各自贴合地形（村庄房子用它，是因为村庄只在平地生成）；
        //   放到缓坡/崖壁上，整栋房子会被"摊"在坡面上、一半埋进石头（用户截图：
        //   小屋挂在石岸崖壁上，太抽象）。营地也同理 —— 上坡那侧的土直接把营地吞了。
        //   正解：**rigid 保持结构形状** + terrain_adaptation 补底 + 只生成在平坦群系。
        projection: 'rigid',
      },
    }],
  }, site.name + ' 模板池');
  writeJson(path.join(WG_DIR, 'structure', site.id + '.json'), {
    type: 'minecraft:jigsaw',
    biomes: site.biomes,
    step: 'surface_structures',
    // ⚠ 用户 2026-10-05 定案：**不要任何地形修饰**（"无论怎样总有一圈地形包住，我不想要"）。
    //   beard_thin/beard_box 的本体行为就是"在结构周围补一圈地形方块当裙边/台座" ——
    //   沙滩上那圈沙台、平原上的土包都是它。所以用 none：结构与地形零交互。
    //   代价：坡地上可能出现"上坡侧的土压住结构"或"下坡侧露空"——用**只生成在平坦群系**来兜。
    terrain_adaptation: 'none',
    start_pool: 'anglertackle:' + site.id,
    size: 1,
    // 各站点自己的抬升量（钓位 1、其余 0）。补底关掉后（none），抬升就是纯粹的位置上移；
    // 抬多了会悬空，所以只有钓位抬 1 格（让平台和台阶露出水面）。
    start_height: { absolute: site.startHeight || 0 },
    project_start_to_heightmap: 'WORLD_SURFACE_WG',
    max_distance_from_center: 80,
    use_expansion_hack: false,
    spawn_overrides: {},
  }, site.name + ' 结构');
  writeJson(path.join(WG_DIR, 'structure_set', site.id + '.json'), {
    placement: {
      type: 'minecraft:random_spread',
      spacing: site.spacing,
      separation: site.separation,
      salt: site.salt,
      spread_type: 'linear',
    },
    structures: [{ structure: 'anglertackle:' + site.id, weight: 1 }],
  }, site.name + ' 结构集（spacing ' + site.spacing + '/' + site.separation + '）');
}

// ---------------------------------------------------------------- 跑
fs.mkdirSync(TABLE_DIR, { recursive: true });
let fail = 0;
const ok = (s) => console.log('  ✅ ' + s);
const bad = (s) => { console.log('  ❌ ' + s); fail++; };

for (const site of SITES) {
  console.log('\n=== ' + site.name + '（' + site.id + '）===');
  const info = buildStructure(site);
  ok(info.tagged + ' 个容器挂了表：' + Object.entries(info.counts).map(([k, v]) => k.replace('minecraft:', '') + '×' + v).join('，')
    + '；尺寸 ' + info.size.join('×'));
  writeJson(path.join(TABLE_DIR, site.id + '_tackle.json'), tackleTable(site), '配件表');
  writeJson(path.join(TABLE_DIR, site.id + '_fish.json'), fishTable(site), '鱼表');
  writeWorldgen(site);
}

// ---------------------------------------------------------------- 自检
console.log('\n=== 自检 ===');
for (const site of SITES) {
  const tackle = tackleTable(site);
  const cap = tackle.pools.length * tackle.pools[0].rolls.max;
  if (cap <= MOD_ITEMS_PER_CONTAINER_MAX) ok(site.id + ' 配件表最多 ' + cap + ' 件 mod 物品（上限 ' + MOD_ITEMS_PER_CONTAINER_MAX + '）');
  else bad(site.id + ' 配件表最多 ' + cap + ' 件 mod 物品，超上限');
  const total = tackle.pools[0].entries.reduce((a, e) => a + e.weight, 0);
  for (const b of BANDS) {
    const w = tackle.pools[0].entries.filter((e) => (byBand[b.id] || []).includes(e.name.replace('anglertackle:', '')))
      .reduce((a, e) => a + e.weight, 0);
    const got = w / total * 100;
    if (Math.abs(got - b.pct) < 0.3) ok(site.id + ' 配件 ' + b.label + ' ' + got.toFixed(2) + '%（目标 ' + b.pct + '%）');
    else bad(site.id + ' 配件 ' + b.label + ' ' + got.toFixed(2) + '%，目标 ' + b.pct + '%');
  }
  const ft = fishTable(site);
  const ftotal = ft.pools[0].entries.reduce((a, e) => a + e.weight, 0);
  if (ft.pools[0].rolls === 1) ok(site.id + ' 鱼表固定一条（rolls 1）');
  else bad(site.id + ' 鱼表 rolls 不是 1');
  for (const b of BANDS) {
    // ⚠ 按"entry 自己写的 tier"归属，不能按"鱼 id 在不在这个带"——
    //   同一条鱼可能同时出现在多个带（它的档位范围与多个带相交），那样会把一条鱼重复计进多个带，
    //   实测就出现过 79% / 65.6% 这种"每带都超"的假失败。
    const w = ft.pools[0].entries.filter((e) => b.tiers.includes(e.functions[0].components[FISH_COMPONENT].tier))
      .reduce((a, e) => a + e.weight, 0);
    const got = w / ftotal * 100;
    if (Math.abs(got - b.pct) < 0.3) ok(site.id + ' 鱼 ' + b.label + ' ' + got.toFixed(2) + '%（目标 ' + b.pct + '%）');
    else bad(site.id + ' 鱼 ' + b.label + ' ' + got.toFixed(2) + '%，目标 ' + b.pct + '%');
  }
  const noTier = ft.pools[0].entries.filter((e) => !e.functions?.[0]?.components?.[FISH_COMPONENT]?.tier && e.functions?.[0]?.components?.[FISH_COMPONENT]?.tier !== 0);
  if (!noTier.length) ok(site.id + ' 每条鱼都写了 tier（不写就是普通品质鱼）');
  else bad(site.id + ' 有 ' + noTier.length + ' 条鱼没写 tier');
}
console.log('\n' + (fail === 0 ? '✅ 就绪' : '❌ ' + fail + ' 项'));
process.exitCode = fail === 0 ? 0 : 1;
