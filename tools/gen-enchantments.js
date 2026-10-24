/*
 * gen-enchantments.js —— 生成模组附魔（用户 2026-10-02 定案）。
 *
 * 为什么生成而不是手写：附魔的"规则"分散在四处（附魔 JSON / 物品标签 / 两张原版标签 /
 * 语言键），少写一处不会报错，只会表现成"这个附魔永远刷不出来"。
 * 生成 + 漂移检查能把这一类问题离线卡住。
 *
 * 出处规则（照原版机制，用户已确认）：
 *   · `#minecraft:non_treasure` → 附魔台能刷出（再按 min_cost 门控等级）
 *   · `#minecraft:treasure`     → 只在战利品箱出（古城那一档箱子用的就是它）
 *   · 两者都进 = 附魔台能刷 + 宝箱也有
 *
 * 用法：
 *   node tools/gen-enchantments.js           # 预览
 *   node tools/gen-enchantments.js --write   # 写盘
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NS = 'anglertackle';
// 比较前归一换行：仓库存 LF，`core.autocrlf=true` 的 Windows 检出是 CRLF —— 那是检出方式，
// 不是内容漂移。不归一的话，--write 会把 12 个文件的行尾全改成 LF（git diff 里看不见，
// 但工作区确实被重写了一遍）。check-enchantments.js 用的是同一个归一规则。
const norm = (s) => (s == null ? null : String(s).replace(/\r\n/g, '\n'));
const ENCH_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'enchantment');
const ROD_TAG = path.join(ROOT, 'src/main/resources/data', NS, 'tags/item/enchantable/rod.json');
const MC_TAGS = path.join(ROOT, 'src/main/resources/data/minecraft/tags/enchantment');
/**
 * 原版的"有耐久就能附魔"物品标签。
 *
 * <p>用户 2026-10-02："让所有类型杆子除了 mod 附魔外还能附魔**耐久 3 和经验修补**。"
 * 这两个原版附魔的 `supported_items` 是 `#minecraft:enchantable/durability` ——
 * 竿有 durability 组件**不等于**在这个标签里，所以必须显式加进去，
 * 否则附魔台会把它们从候选里筛掉（表现就是"只有模组附魔能出"）。
 */
const MC_DURABILITY_TAG = path.join(ROOT,
  'src/main/resources/data/minecraft/tags/item/enchantable/durability.json');

/** 我们那 10 把竿（生成器从 ModItems 里读，加竿不会漏）。 */
function rodItems() {
  const src = fs.readFileSync(path.join(ROOT,
    'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'), 'utf8');
  const ids = new Set();
  for (const m of src.matchAll(/=\s*rod\(\s*"([a-z_]+)"/g)) ids.add(m[1]);
  for (const m of src.matchAll(/ITEMS\.register\(\s*"((?:wood|iron|gold|diamond|netherite)_(?:float|lure)_rod)"/g)) {
    ids.add(m[1]);
  }
  return [...ids].sort();
}

/**
 * 允许注入的"超高价值战利品箱"白名单。
 *
 * 用户口径："仅在类似古城这样的超高价值战利品箱刷新"。
 * 加新箱子要同时想清楚两件事：它算不算"超高价值"，以及它的上下文参数够不够
 * （`add_table` 只是把我们的表滚一遍，箱子本身没有的参数我们拿不到）。
 */
const HIGH_VALUE_CHESTS = [
  'minecraft:chests/ancient_city',
  'minecraft:chests/end_city_treasure',
  'minecraft:chests/trial_chambers/reward_ominous_rare',
];

/*
 * 战利品表注入：修饰符目录。
 *
 * ⚠ 26.1.2 起 NeoForge 的 `LootModifierManager` 改成**扫目录**加载
 *   （`FileToIdConverter.registry(…, "loot_modifiers")`，见 LootModifierManager.java:26/32），
 *   `data/neoforge/loot_modifiers/global_loot_modifiers.json` 这份索引已随版本删除
 *   （universal jar 里也没有它）。所以本生成器**不再产出**那个文件 ——
 *   它会不会被加载，等价于文件在不在 `data/<ns>/loot_modifiers/` 里。
 */
const MODIFIER_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'loot_modifiers');
const INJECT_TABLE_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'loot_table/inject');

/**
 * 六个附魔。数值与效果口径全部来自用户原话，注释里标了"哪一句对应哪一条"。
 *
 * <h2>★ 等级阶梯（成本表）怎么定 —— 用户 2026-10-02 报的问题</h2>
 * 用户："你自创附魔时只做了等级最高的，比如韧性保护只有 4 级，没有 1,2,3 级。"
 *
 * 附魔台给几级，**完全由 min_cost / max_cost 决定**（数值表就是等级阶梯本身）。
 * 原版的选法（`EnchantmentHelper#getAvailableEnchantmentResults`，逐字照抄）：
 * <pre>
 *   for (int i = maxLevel; i >= 1; i--)
 *       if (power >= getMinCost(i) && power <= getMaxCost(i)) { 选中 i; break; }   // 取"出得起的最高级"
 * </pre>
 * 而 `power` 就是附魔台那一格的报价，**上限 30**
 * （`getEnchantmentCost`：书架数封顶 15，第三格 = max(j, 书架数×2) = 30；
 *  第一格 ≤10、第二格 ≤21）。所以：
 *
 * <ul>
 *   <li><b>最高级必须排在 30 之外</b>（`minCost(maxLevel) > 30`）——满级要上铁砧合。
 *       这正是原版的做法：时运 III(33)、饵钓 III(33)、锋利 V(45)、效率 V(41) 全都刷不出来。
 *       我第一版把韧性保护写成 min 10+8/级 → III 只要 26，于是**满级台子永远只出满级**，
 *       1、2 级在实战里根本不存在（就是上面那句抱怨）。</li>
 *   <li><b>每一级都要有自己的能量档</b>：等级 k 的档位是
 *       `[minCost(k), minCost(k+1) - 1]`（因为"取最高的那个匹配"），
 *       所以 `minCost` 的级差 = 档宽。级差太大会让中间等级只在一个很窄的能量区间里出现，
 *       级差把 minCost(maxLevel) 顶到 30 以内又会让满级变成台子货。</li>
 *   <li><b>常见附魔的第一级要能在小台子上出</b>（报价 ≤10 = 书架很少）——不然新手裸台子
 *       一个本模组附魔都看不到。</li>
 * </ul>
 *
 * 照着这三条定的表（括号里是各级 minCost，台子档位 = 到下一级之前）：
 * <pre>
 *   韧性保护 3 级  5/18/31     → 台子 I(5-17) II(18-30)，III 上铁砧
 *   精准猎获 5 级  5/13/21/29/37 → 台子 I II III IV(29-30)，V 上铁砧
 *   承重保护 4 级  6/15/24/33  → 台子 I II III(24-30)，IV 上铁砧
 *   拉扯     3 级  15/24/33    → 台子 I(15-23) II(24-30)，III 上铁砧（稀有，和原版时运同档）
 *   抢救     1 级  30          → 只有一级，用户指定"30 级附魔台可以产出"
 *   高质吸引 5 级  40/60/80/100/120 → 不进附魔台（只在宝箱）
 * </pre>
 * 守着这套阶梯的是 `tools/check-enchantments.js` 的"等级阶梯"一节（它把原版那段选法
 * 在 JS 里复算一遍，逐级核对"1..满级-1 都能刷到、满级刷不到"）。
 *
 * @field id      附魔 id（`anglertackle:<id>`）
 * @field name    中文名（写进语言文件的键值，检查器会核对键存在）
 * @field maxLevel / weight / minCost / maxCost / anvilCost
 * @field table   true = 附魔台能刷（进 non_treasure）；false = 只从宝箱出
 * @field chest   true = 进 treasure（战利品箱）
 */
const ENCH = [
  {
    id: 'reinforced', name: '韧性保护', maxLevel: 3, weight: 10,
    minCost: [5, 13], maxCost: [45, 13], anvilCost: 4, table: true, chest: true,
    // 用户："每级使得路亚竿的鱼线张力上限在实际生效时提升8%"，"特定杆子的默认仅对该类型竿子生效"
    effect: '每级 路亚竿实际生效的线张力上限 +8%（台钓竿无效）',
  },
  {
    id: 'precise_hunt', name: '精准猎获', maxLevel: 5, weight: 10,
    minCost: [5, 8], maxCost: [50, 8], anvilCost: 4, table: true, chest: true,
    // 用户："每级使得鱼饵的上鱼类型权重（不影响稀有度的那种）额外提升2%（加算）"
    effect: '每级 鱼饵的上鱼类型权重 +2%（加算；不动稀有度那一条）',
  },
  {
    id: 'load_bearing', name: '承重保护', maxLevel: 4, weight: 8,
    minCost: [6, 9], maxCost: [55, 9], anvilCost: 4, table: true, chest: true,
    // 用户："每级使得路亚钓获超承重鱼时，耐久削减速度降低20%"，"承重保护归属普通级附魔"
    effect: '每级 路亚钓获超承重鱼时耐久削减 −20%',
  },
  {
    id: 'rescue', name: '抢救', maxLevel: 1, weight: 2,
    // 用户："稀有附魔，30级附魔台可以产出。可见于较高级及以上战利品箱"
    // 只有一级，不存在"等级阶梯"问题；30 = 满配台子（15 书架）刚好够得到
    minCost: [30, 0], maxCost: [80, 0], anvilCost: 8, table: true, chest: true,
    effect: '路亚即将红条断线时，张力强制退回黄/白交界（每场对抗一次）',
  },
  {
    id: 'drag', name: '拉扯', maxLevel: 3, weight: 2,
    // 稀有档（和原版时运/饵钓同一条曲线：15 + 9/级 → III 要 33，台子刷不出来）
    minCost: [15, 9], maxCost: [90, 9], anvilCost: 8, table: true, chest: true,
    // 用户："每级使得路亚的双回拉速度提升5%"，"刷新与上一种附魔相同"
    effect: '每级 路亚双回拉速度 +5%',
  },
  {
    id: 'high_quality_lure', name: '高质吸引', maxLevel: 5, weight: 1,
    // 用户："稀有附魔，仅在类似古城这样的超高价值战利品箱刷新" → 不进附魔台，只从宝箱出
    //
    // ⚠ 成本表要按**宝箱的能量区间**来定，不是附魔台的 30：注入表用的是
    //   `enchant_with_levels`，能量 = 表里写的 levels（我们给它 20..50，见 LOOT_INJECT）。
    //   第一版写成 40/60/80/100/120 → 在 20..50 里只有 1 级够得着（40 以上），
    //   2..5 级等于不存在。改成 15 + 7/级 → 15/22/29/36/43，
    //   1 级(20-21) 2 级(22-28) 3 级(29-35) 4 级(36-42) 5 级(43-50) 五档全在区间里。
    minCost: [15, 7], maxCost: [60, 7], anvilCost: 10, table: false, chest: true,
    loot: { chests: HIGH_VALUE_CHESTS, levels: [20, 50], chance: 0.35 },
    effect: '每级 金/红品质鱼上鱼概率 +1%',
  },
];

const cost = (c) => ({ base: c[0], per_level_above_first: c[1] });

function enchantmentJson(e) {
  // 键顺序照原版（字母序），便于和原版对照
  const doc = {
    anvil_cost: e.anvilCost,
    description: { translate: 'enchantment.' + NS + '.' + e.id },
    effects: {},                       // 效果由我们自己的代码读等级实现（不是原版 effect 组件）
    max_cost: cost(e.maxCost),
    max_level: e.maxLevel,
    min_cost: cost(e.minCost),
    slots: ['mainhand'],               // 竿是手持的
    supported_items: '#' + NS + ':enchantable/rod',
    weight: e.weight,
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * 战利品表注入：给"只在宝箱出"的附魔造一条**真的能掉**的路。
 *
 * <h2>为什么非要注入，不能只挂个标签</h2>
 * 我第一版把高质吸引放进 `#minecraft:treasure`，以为那就是"宝箱里能出"。
 * 把原版数据包翻了一遍才发现：**`#minecraft:treasure` 没有任何战利品表读它**
 * （整个原版只有 `tags/enchantment/double_trade_price.json` 引用它，那是村民定价）。
 * 25 张会出附魔书的箱子 + 钓鱼宝藏用的都是
 * `enchant_randomly` / `enchant_with_levels` 的 `options: "#minecraft:on_random_loot"`。
 * 于是那条附魔**一件都不会掉** —— 没有报错、没有日志，就是永远见不到。
 *
 * 而 `on_random_loot` = `#minecraft:non_treasure` + 诅咒 + 冰霜行者 + 经验修补，
 * 走那条路的话它会出现在 25 张箱子里的每一张（矿道、沉船都有），
 * 和用户"仅在类似古城这样的超高价值战利品箱刷新"对不上。
 *
 * 所以：用 NeoForge 的 `add_table` 修饰符，把我们自己的一张表**只**注入到
 * {@link HIGH_VALUE_CHESTS} 那几张箱子里。等级由注入表里的 `enchant_with_levels`
 * 决定 —— 它的 levels 区间就是那张表的"能量"，成本表（min_cost/max_cost）按它来配。
 *
 * <h2>三处 id 写错都是静默失效</h2>
 * `neoforge:add_table`（修饰符类型）、`neoforge:loot_table_id`（条件类型）、
 * `table` 指向的注入表 —— 任何一处写错，表现都是"这件附魔永远不掉"。
 * 守着它们的是 `tools/check-enchantments.js` 的"宝箱阶梯"一节
 * （它逐字核对类型 id、目标箱子白名单、以及 levels 区间覆盖每一级）。
 */
function lootFiles(out) {
  // ⚠ 清单是**共享**的（tools/glm-entries.js）—— 别的生成器（村庄箱子那份）也会往里加条目。
  //   这里只**读**它、不要改它（改它会把别的生成器的条目重复追加进来）。
  //   26.1.2 不再有全局索引文件，这份清单现在的作用是"跨生成器的登记表"：
  //   下面逐条核对"登记过的 id 都真的有修饰符文件"（写错一个字母不会报错，只会永远不掉）。
  const shared = require('./glm-entries.js').ENTRIES;
  for (const e of ENCH) {
    if (!e.loot) {
      continue;
    }
    const modName = e.id + '_book';
    const tableId = NS + ':inject/' + modName;
    // 注入表：一本书，等级按成本表在这段能量里选
    out.set(path.join(INJECT_TABLE_DIR, modName + '.json'), JSON.stringify({
      pools: [{
        rolls: 1,
        conditions: [{ condition: 'minecraft:random_chance', chance: e.loot.chance }],
        entries: [{
          type: 'minecraft:item',
          name: 'minecraft:book',
          functions: [{
            function: 'minecraft:enchant_with_levels',
            // 均匀取这段能量值，再由 min_cost/max_cost 决定出几级
            levels: { type: 'minecraft:uniform', min: e.loot.levels[0], max: e.loot.levels[1] },
            options: NS + ':' + e.id,
          }],
        }],
      }],
    }, null, 2) + '\n');
    // 修饰符：只在白名单里的箱子上滚这张表
    out.set(path.join(MODIFIER_DIR, modName + '.json'), JSON.stringify({
      type: 'neoforge:add_table',
      conditions: [{
        condition: 'minecraft:any_of',
        terms: e.loot.chests.map((c) => ({
          condition: 'neoforge:loot_table_id',
          loot_table_id: c,
        })),
      }],
      table: tableId,
    }, null, 2) + '\n');
  }
  // 清单里的每一条都必须真的有对应的修饰符文件 —— 写错一个字母的表现是
  // "这个修饰符根本不会被加载 → 东西永远不掉"，没有报错也没有日志。
  for (const id of shared) {
    const [ns, name] = id.split(':');
    const rel = path.join(ROOT, 'src/main/resources/data', ns, 'loot_modifiers', name + '.json');
    if (!fs.existsSync(rel)) {
      throw new Error('tools/glm-entries.js 里的 ' + id + ' 没有对应的修饰符文件：' +
        path.relative(ROOT, rel).replace(/\\/g, '/') + '（清单和文件必须一一对应）');
    }
  }
  // ⚠ 不写 data/neoforge/loot_modifiers/global_loot_modifiers.json：26.1.2 已删除这份索引，
  //   写入它不会报错，但也不会被加载 —— 属于"看着生成了、其实没接线"的假产物。
}

function build() {
  const rods = rodItems();
  if (rods.length === 0) throw new Error('读不出竿的物品 id（ModItems 的 rod(...) 格式变了？）');
  const out = new Map();
  for (const e of ENCH) out.set(path.join(ENCH_DIR, e.id + '.json'), enchantmentJson(e));
  out.set(ROD_TAG, JSON.stringify({
    replace: false,
    values: rods.map((r) => NS + ':' + r),
  }, null, 2) + '\n');
  // 竿也要进原版"有耐久就能附魔"标签 → 耐久 / 经验修补 才能在竿上出现
  out.set(MC_DURABILITY_TAG, JSON.stringify({
    replace: false,
    values: rods.map((r) => NS + ':' + r),
  }, null, 2) + '\n');
  // non_treasure = 附魔台能刷；treasure = 真·宝藏附魔（进不了附魔台的那些）。
  // ⚠ treasure **不负责**"宝箱能掉" —— 能掉靠两条：
  //   · 附魔台那些：在 non_treasure 里，而 on_random_loot 引用了 #non_treasure，
  //     于是箱子/钓鱼宝藏的 enchant_* 自动包含它们（vanilla 也是这么连起来的）；
  //   · 宝箱专属那些：靠 lootFiles() 注入的战利品表。
  for (const [tag, pick] of [
    ['non_treasure', (e) => e.table],
    ['treasure', (e) => !e.table && e.chest],
  ]) {
    const values = ENCH.filter(pick).map((e) => NS + ':' + e.id).sort();
    out.set(path.join(MC_TAGS, tag + '.json'),
      JSON.stringify({ replace: false, values }, null, 2) + '\n');
  }
  lootFiles(out);
  return { files: out, rods };
}

module.exports = {
  build, ENCH, ENCH_DIR, ROD_TAG, MC_TAGS, NS,
  MODIFIER_DIR, INJECT_TABLE_DIR, HIGH_VALUE_CHESTS,
};

if (require.main === module) {
  const { files, rods } = build();
  const write = process.argv.includes('--write');
  console.log('竿的物品标签：' + rods.length + ' 把 → #' + NS + ':enchantable/rod');
  console.log('附魔 ' + ENCH.length + ' 个：');
  for (const e of ENCH) {
    console.log('  ' + (NS + ':' + e.id).padEnd(28) + e.name + '（上限 ' + e.maxLevel +
      '）' + (e.table ? ' 附魔台✓' : ' 附魔台✗') + (e.chest ? ' 宝箱✓' : '') +
      '  最小成本 ' + e.minCost[0]);
  }
  console.log('\n需要的中文键（检查器会核对）：');
  for (const e of ENCH) console.log('  "enchantment.' + NS + '.' + e.id + '": "' + e.name + '"');
  if (!write) {
    console.log('\n（预览模式。加 --write 写入 ' + files.size + ' 个文件）');
  } else {
    for (const [file, text] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      // 只差行尾 ⇒ 不重写（见 norm 的说明）。
      if (norm(old) !== norm(text)) fs.writeFileSync(file, text);
    }
    console.log('\n✅ 已写出 ' + files.size + ' 个文件（附魔 JSON + 竿标签 + 两张原版标签）');
  }
}
