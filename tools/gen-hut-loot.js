/*
 * gen-hut-loot.js —— 渔人小屋战利品表（含**按档位分层的高级物品概率**）。
 *
 * 用户 2026-07-01 的要求："高级物品刷新概率可以低，如紫以上的物品刷新，
 * 紫10%，金5%，红1.5%"（日期以仓库为准）。
 *
 * ── 两个不同的概率模型，必须分清 ──────────────────────────────
 *
 * ① **饵料是"每箱一个一种"，所以档位概率要在池内互斥地分配**（用 weight）。
 *    换成"独立概率池"的话，一个箱子会同时出紫饵+金饵+红饵 —— 那不是"一个一种"。
 *    做法：权重 = round(目标百分比 × SCALE / 该档种类数)，
 *    让各档占比精确落在 83.5% / 10% / 5% / 1.5%。
 *    SCALE=20 是为了让 1.5% 也能用整数表达（1.5×20 = 30）。
 *
 * ② **鱼线和红鱼是"额外掉落"，用独立概率池**（random_chance）。
 *    用户给的 10%/5%/1.5% 是**每次开箱的绝对概率**，独立池正好表达这个。
 *
 * ⚠ 这两件事用错模型的表现都是"概率不对但看着合理"，只能靠算出来核对 ——
 *   所以脚本末尾会把**实测百分比**打出来。
 */
const fs = require('fs');
const path = require('path');
const nbt = require('./lib-nbt');
const { N } = nbt;

const ROOT = path.join(__dirname, '..');
const STRUCT = path.join(ROOT,
  'src/main/resources/data/anglertackle/structure/fisherman_hut.nbt');
const TABLE_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/loot_table/chests');
const TABLE_ID = 'anglertackle:chests/fisherman_hut';

// ---------------------------------------------------------------- 目标概率
const P_EPIC = 10.0;
const P_LEGEND = 5.0;
const P_RED = 1.5;
const P_LOW = 100 - P_EPIC - P_LEGEND - P_RED;
const SCALE = 20;

// ---------------------------------------------------------------- 从代码解析档位
const itemSrc = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'), 'utf8');
const compSrc = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/registry/ModDataComponents.java'), 'utf8');
const cm = /FISH_DATA\s*=\s*COMPONENTS\.register\(\s*"([a-z_]+)"/.exec(compSrc);
if (!cm) { console.error('❌ 解析不出 FISH_DATA 的注册名'); process.exit(1); }
const FISH_COMPONENT = 'anglertackle:' + cm[1];

const lines = itemSrc.split('\n');
function tiersOf(prefixRe, tierRe) {
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const reg = /ITEMS\.register\("([a-z_]+)"/.exec(lines[i]);
    if (!reg || !prefixRe.test(reg[1])) continue;
    const chunk = lines.slice(i, i + 6).join(' ');
    const t = tierRe.exec(chunk);
    if (t) out[reg[1]] = Number(t[1]);
  }
  return out;
}
const TIER = Object.assign(
  tiersOf(/^lure_/, /PartStats\.lure\((\d+)\)/),
  tiersOf(/^bait_/, /new BaitItem\(\s*(\d+)\s*,/),
  tiersOf(/_line$/, /PartStats\.line\([^)]*?(\d+)\s*\)/),
);
delete TIER.lure_test_red;   // 调试拟饵不进战利品

function byTierOf(ids) {
  const g = {};
  for (const id of ids) {
    const t = TIER[id];
    if (t === undefined) { console.error('❌ 解析不出 ' + id + ' 的档位'); process.exit(1); }
    (g[t] = g[t] || []).push(id);
  }
  return g;
}

const LURES = ['lure_spoon', 'lure_minnow', 'lure_soft', 'lure_deep', 'lure_rattle', 'lure_gilded'];
const BAITS = ['bait_bread', 'bait_worm', 'bait_corn', 'bait_shrimp', 'bait_glow', 'bait_secret'];
const LINES = ['hemp_line', 'cotton_line', 'nylon_line', 'fluoro_line', 'pe_line', 'titanium_line'];

const baitTiers = byTierOf([...LURES, ...BAITS]);
const lineTiers = byTierOf(LINES);

console.log('饵料档位：' + Object.entries(baitTiers).map(([t, a]) => t + '档×' + a.length).join('，'));
console.log('鱼线档位：' + Object.entries(lineTiers).map(([t, a]) => t + '档×' + a.length).join('，'));

// ⚠ 低档（白/绿/蓝）要按**整个低档组的总种类数**分摊 83.5%，
//   不能按"每个档位各自分 83.5%"。
//   第一版写成按 countInTier 分摊，于是 0/1/2/3 四个档位**各拿了一份 83.5%**，
//   低档总权重膨胀成 4 倍，紫档被挤到 2.85%（目标 10%）——
//   而生成的表**看起来完全正常**，只有把权重反算成百分比才发现。
//   这就是脚本末尾那段"实测概率"存在的理由。
const lowCount = Object.entries(baitTiers)
  .filter(([k]) => Number(k) <= 3)
  .reduce((a, [, v]) => a + v.length, 0);
const weightFor = (tier, countInTier) => {
  if (tier >= 6) return Math.max(1, Math.round(P_RED * SCALE / countInTier));
  if (tier === 5) return Math.max(1, Math.round(P_LEGEND * SCALE / countInTier));
  if (tier === 4) return Math.max(1, Math.round(P_EPIC * SCALE / countInTier));
  return Math.max(1, Math.round(P_LOW * SCALE / lowCount));
};

const item = (id, count, weight) => {
  const e = { type: 'minecraft:item', name: 'anglertackle:' + id };
  if (weight) e.weight = weight;
  if (count) {
    e.functions = [{
      function: 'minecraft:set_count',
      count: { type: 'minecraft:uniform', min: count[0], max: count[1] },
    }];
  }
  return e;
};
const vanillaItem = (name, count) => ({
  type: 'minecraft:item',
  name,
  functions: [{
    function: 'minecraft:set_count',
    count: { type: 'minecraft:uniform', min: count[0], max: count[1] },
  }],
});

const baitEntries = [];
for (const [tier, ids] of Object.entries(baitTiers)) {
  for (const id of ids) baitEntries.push(item(id, null, weightFor(Number(tier), ids.length)));
}

// 鱼线分档，各自独立概率
const linePools = [];
{
  const low = ['1', '2', '3'].flatMap((t) => lineTiers[t] || []);
  if (low.length) {
    linePools.push({
      rolls: 1, bonus_rolls: 0,
      conditions: [{ condition: 'minecraft:random_chance', chance: 0.15 }],
      entries: low.map((id) => item(id, null, 0)),
    });
  }
  for (const [tier, chance] of [['4', P_EPIC], ['5', P_LEGEND], ['6', P_RED]]) {
    const ids = lineTiers[tier] || [];
    if (!ids.length) continue;
    linePools.push({
      rolls: 1, bonus_rolls: 0,
      conditions: [{ condition: 'minecraft:random_chance', chance: chance / 100 }],
      entries: ids.map((id) => item(id, null, 0)),
    });
  }
}

const RED_FISH = [
  { id: 'bluefin_tuna', cm: 210.0, kg: 180.0 },
  { id: 'juvenile_shark', cm: 140.0, kg: 95.0 },
  { id: 'oxeye_tarpon', cm: 175.0, kg: 70.0 },
];

/**
 * 红品质鱼那一个池子 —— **老柯小屋和原版村庄渔夫小屋共用同一份定义**。
 *
 * <p>用户 2026-10-02："战利品刷新优化：村庄结构中的原版渔人小屋结构中的容器
 * 可能刷新 mod 鱼，**品质概率等数值与老柯小屋相关刷新相同**。"
 * 所以这里抽成一个函数：两边都调它，概率与条目结构**结构上不可能走散**
 * （各自抄一份 JSON 的话，改了一处另一处只会静默地不一致）。
 */
function redFishPool() {
  return {
    rolls: 1,
    bonus_rolls: 0,
    conditions: [{ condition: 'minecraft:random_chance', chance: P_RED / 100 }],
    entries: RED_FISH.map((f) => ({
      type: 'minecraft:item',
      name: 'anglertackle:' + f.id,
      functions: [{
        function: 'minecraft:set_components',
        components: {
          [FISH_COMPONENT]: {
            species: f.id, length_cm: f.cm, weight_kg: f.kg, tier: 6,
          },
        },
      }],
    })),
  };
}

const table = {
  type: 'minecraft:chest',
  pools: [
    {
      rolls: { type: 'minecraft:uniform', min: 2, max: 4 },
      bonus_rolls: 0,
      entries: [vanillaItem('minecraft:string', [2, 6]),
                vanillaItem('minecraft:stick', [2, 8]),
                vanillaItem('minecraft:bread', [1, 4])],
    },
    { rolls: 1, bonus_rolls: 0, entries: baitEntries },
    ...linePools,
    redFishPool(),
  ],
  random_sequence: 'anglertackle:chests/fisherman_hut',
};

fs.mkdirSync(TABLE_DIR, { recursive: true });
fs.writeFileSync(path.join(TABLE_DIR, 'fisherman_hut.json'),
  JSON.stringify(table, null, 2) + '\n', 'utf8');
console.log('\n✅ 战利品表已写出（' + table.pools.length + ' 个池子）');

// ---------------------------------------------------------------- 原版村庄渔夫小屋
//
// 用户 2026-10-02："村庄结构中的原版渔人小屋结构中的容器可能刷新 mod 鱼，
// 品质概率等数值与老柯小屋相关刷新相同。"
//
// 做法和"附魔书注入"同一套（见 tools/gen-enchantments.js 的 lootFiles）：
// 我们自己的一张表 + `neoforge:add_table` 修饰符，**只**注入到
// `minecraft:chests/village/village_fisher`（原版渔夫小屋的箱子）。
// 鱼那一池直接复用上面的 redFishPool() —— 数值与老柯小屋一模一样。
const VILLAGE_FISHER_CHEST = 'minecraft:chests/village/village_fisher';
const VILLAGE_TABLE_ID = 'anglertackle:inject/village_fisher_fish';
{
  const injectDir = path.join(ROOT, 'src/main/resources/data/anglertackle/loot_table/inject');
  const modDir = path.join(ROOT, 'src/main/resources/data/anglertackle/loot_modifiers');
  fs.mkdirSync(injectDir, { recursive: true });
  fs.mkdirSync(modDir, { recursive: true });

  fs.writeFileSync(path.join(injectDir, 'village_fisher_fish.json'),
    JSON.stringify({
      // 这一池的内容 = 老柯小屋的红鱼池（同一个函数生成）
      pools: [redFishPool()],
    }, null, 2) + '\n', 'utf8');

  fs.writeFileSync(path.join(modDir, 'village_fisher_fish.json'),
    JSON.stringify({
      type: 'neoforge:add_table',
      conditions: [{
        condition: 'neoforge:loot_table_id',
        loot_table_id: VILLAGE_FISHER_CHEST,
      }],
      table: VILLAGE_TABLE_ID,
    }, null, 2) + '\n', 'utf8');

  // ⚠ 全局清单由 gen-enchantments.js 写（一个文件只能有一个写者）。
  //   这里只**核对**自己那条在清单里 —— 不在的话这个修饰符根本不会被加载，
  //   表现是"村庄箱子里永远没有 mod 鱼"，没有任何报错。
  const glm = require('./glm-entries.js');
  const myId = 'anglertackle:village_fisher_fish';
  if (!glm.ENTRIES.includes(myId)) {
    console.error('❌ ' + myId + ' 不在 tools/glm-entries.js 的清单里 —— ' +
      'global_loot_modifiers.json 不会列出它，村庄箱子里永远刷不出 mod 鱼');
    process.exit(1);
  }
  console.log('✅ 村庄渔夫小屋注入：' + VILLAGE_FISHER_CHEST + ' ← ' + VILLAGE_TABLE_ID
    + '（红鱼 ' + P_RED + '%，与老柯小屋同一份池子定义）');
}


// ---------------------------------------------------------------- 挂表
const typed = nbt.readNbtTyped(STRUCT);
const pal = nbt.get(typed.root, 'palette').v.items.map((p) => String(nbt.get(p, 'Name').v));
let chests = 0;
for (const b of typed.root.v.blocks.v.items) {
  if (pal[Number(nbt.get(b, 'state').v)] !== 'minecraft:chest') continue;
  chests++;
  let tag = nbt.get(b, 'nbt');
  if (!tag) { tag = N.compound({}); b.v.nbt = tag; }
  // ⚠ 必须清掉结构方块存下来的 Items（2026-10-05 check-sites.js 抓到 8 个箱子全都有）：
  //   留着的话玩家开箱会先看到那份造物清单，再被 LootTable 覆盖 —— 表现是"箱子里有东西但一拿就变"。
  delete tag.v.Items;
  tag.v.LootTable = N.str(TABLE_ID);
}
nbt.writeNbtFile(STRUCT, typed.name, typed.root);
console.log('✅ ' + chests + ' 个箱子已挂 ' + TABLE_ID);

// ---------------------------------------------------------------- 自检：把实测概率算出来
let fail = 0;
const ok = (s) => console.log('  ✅ ' + s);
const bad = (s) => { console.log('  ❌ ' + s); fail++; };
console.log('\n=== 实测概率（从生成的权重反算）===');
{
  const totalW = baitEntries.reduce((a, e) => a + e.weight, 0);
  const pctOfTier = (tier) => {
    const ids = (baitTiers[tier] || []);
    const w = baitEntries.filter((e) => ids.includes(e.name.replace('anglertackle:', '')))
      .reduce((a, e) => a + e.weight, 0);
    return w / totalW * 100;
  };
  let sum = 0;
  for (const [tier, label, want] of [['4', '紫', P_EPIC], ['5', '金', P_LEGEND], ['6', '红', P_RED]]) {
    if (!(baitTiers[tier] || []).length) continue;
    const got = pctOfTier(tier);
    sum += got;
    if (Math.abs(got - want) < 0.3) ok('饵料 ' + label + '档 ' + got.toFixed(2) + '%（目标 ' + want + '%）');
    else bad('饵料 ' + label + '档 ' + got.toFixed(2) + '%，目标 ' + want + '%');
  }
  ok('饵料 白/绿/蓝档合计 ' + (100 - sum).toFixed(2) + '%（目标 ' + P_LOW + '%）');
}
for (const [tier, label, want] of [['4', '紫', P_EPIC], ['5', '金', P_LEGEND], ['6', '红', P_RED]]) {
  const ids = lineTiers[tier] || [];
  if (!ids.length) continue;
  const pool = linePools.find((p) => p.entries.some((e) =>
    ids.includes(e.name.replace('anglertackle:', ''))));
  const c = pool.conditions[0].chance * 100;
  if (Math.abs(c - want) < 0.01) ok(label + '档鱼线 ' + c + '%（目标 ' + want + '%）');
  else bad(label + '档鱼线 ' + c + '%，目标 ' + want + '%');
}
{
  const redPool = table.pools[table.pools.length - 1];
  const c = redPool.conditions[0].chance * 100;
  if (Math.abs(c - P_RED) < 0.01) ok('红鱼 ' + c + '%（目标 ' + P_RED + '%）');
  else bad('红鱼 ' + c + '%，目标 ' + P_RED + '%');
}

console.log('\n' + (fail === 0 ? '✅ 就绪' : '❌ ' + fail + ' 项'));
process.exitCode = fail === 0 ? 0 : 1;
