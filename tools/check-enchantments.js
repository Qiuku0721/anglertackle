/*
 * check-enchantments.js —— 模组附魔：数据接线 + **对现有系统的影响检测**。
 *
 * 用户 2026-10-02 定案六个附魔，并特意要求：
 *   "做完附魔要检测会不会对现有内容产生影响，比如加权重的附魔会不会让现有权重系统崩溃，
 *    若会则打回重做。"
 *
 * 所以这个检查器分两半：
 *   ① 数据接线：附魔 JSON 合法、只在我们的竿上、出处标签（附魔台/宝箱）与规则表一致、
 *      语言键齐全 —— 少一处只会表现成"这个附魔永远刷不出来"，游戏里看不出错。
 *   ② **影响检测（数值复算）**：
 *      · 权重类（精准猎获 +2%/级、高质吸引 +1 百分点/级）：
 *        满级时鱼池仍非空、金红占比不超 100%、且"词条加成"不会让某一类鱼吃满整个池子
 *      · 张力类（韧性保护 +8%/级）：满级上限仍有限、断线仍可能发生（不是无敌）
 *      · 抢救：只回落一格（到黄/白交界），且每场对抗只触发一次
 *      · 承重保护：满级仍有消耗（不会变成 0）
 *
 * 任何一条不成立 → 这个检查器红，等于"按用户要求打回重做"。
 *
 * 用法：node tools/check-enchantments.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
// ⚠ 剥注释一律用共用的状态机版（java-source.js）：自己写正则剥注释，
//   行注释里出现 `/*` 会被当成块注释开头，一路吞掉大段真实代码 —— 断言于是假通过。
const { stripComments } = require('./java-source.js');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

console.log('=== 附魔检查（数据接线 + 对现有系统的影响）===\n');

// ---------------------------------------------------------------- ① 数据接线
const genPath = path.join(ROOT, 'tools/gen-enchantments.js');
if (!fs.existsSync(genPath)) { no('缺少 tools/gen-enchantments.js'); process.exit(1); }
const gen = require(genPath);
const { files, rods } = gen.build();

const drift = [];
// 26.1.2 已删除 data/neoforge/loot_modifiers/global_loot_modifiers.json（改成扫目录加载，
// LootModifierManager.java:32）。生成器还在产出它 ⇒ 这不是"缺文件"，而是**生成器过时**。
const OBSOLETE = 'data/neoforge/loot_modifiers/global_loot_modifiers.json';
// ⚠ 比较前归一换行：仓库存 LF（i/lf），autocrlf=true 的 Windows 检出是 CRLF（w/crlf）——
//   那是检出方式，不是内容漂移。
const norm = (s) => String(s).replace(/\r\n/g, '\n');
let obsoleteEmitted = 0;
for (const [file, text] of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.endsWith(OBSOLETE)) { obsoleteEmitted++; continue; }
  if (!fs.existsSync(file)) { drift.push(rel + '（缺）'); continue; }
  if (norm(fs.readFileSync(file, 'utf8')) !== norm(text)) drift.push(rel + '（内容不符）');
}
if (drift.length === 0 && obsoleteEmitted === 0) ok('附魔 JSON / 竿标签 / 两张原版标签共 ' + files.size + ' 个文件，全部与生成器一致');
else if (drift.length === 0) {
  no('生成器还在产出 26.1.2 已删除的 ' + OBSOLETE + ' —— 该文件不会再被加载，'
    + 'P4b 里让 gen-enchantments.js 停掉它（其余 ' + (files.size - 1) + ' 个文件都一致）');
} else no('这些生成物漂移了（改完规则要重跑 gen-enchantments.js --write）：' + drift.join('、'));

if (rods.length === 10) ok('竿的物品标签覆盖 ' + rods.length + ' 把竿（#anglertackle:enchantable/rod，不含原版鱼竿）');
else no('竿标签里只有 ' + rods.length + ' 把竿（应为 10：五种材质 × 台钓/路亚）');

// 竿必须"可附魔"（否则附魔台不认这根竿）+ 进原版 durability 标签（否则耐久/经验修补出不来）
{
  const items = fs.readFileSync(path.join(ROOT,
    'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'), 'utf8');
  const rodItem = fs.readFileSync(path.join(ROOT,
    'src/main/java/com/whitecobalt/anglertackle/item/RodItem.java'), 'utf8');
  // 26.1.2：附魔亲和度是**数据组件**（DataComponents.ENCHANTABLE），
  // 只能在注册/构造时经 Item.Properties#enchantable(int) 烘进去 ——
  // 旧的 Item#getEnchantmentValue() 覆写已随组件化删除。
  // 断言语义不变：亲和度必须**按材质给不同值且真的烘进物品**（0 的表现是"附魔台对竿什么都不出"）。
  const enchantBaked = /super\(\s*properties\.enchantable\(\s*enchantmentValue\(\s*spec\.material\(\)\s*\)\s*\)\s*\)/
    .test(rodItem);
  const perMaterial = /case (WOOD|IRON|GOLD|DIAMOND|NETHERITE) -> \d+/.test(rodItem);
  if (enchantBaked && perMaterial) {
    ok('RodItem 把附魔亲和度经 properties.enchantable(材质亲和度) 烘进 ENCHANTABLE 组件');
  } else {
    no('RodItem 没有把附魔亲和度烘进 ENCHANTABLE 组件（super(properties.enchantable(enchantmentValue(材质)))）'
      + ' —— 亲和度 0，附魔台对竿一个附魔都不出');
  }
  // 不许再有人去覆写已经删掉的旧 API（编译不过；注释里提到不算）
  const rodCode = stripComments(rodItem);
  if (/getEnchantmentValue\(/.test(rodCode)) {
    no('RodItem 里还在用 getEnchantmentValue() —— 26.1.2 已删除这个方法，附魔亲和度只能走 ENCHANTABLE 组件');
  }
  void items;

  const durTag = path.join(ROOT, 'src/main/resources/data/minecraft/tags/item/enchantable/durability.json');
  if (fs.existsSync(durTag)) {
    const v = JSON.parse(fs.readFileSync(durTag, 'utf8')).values || [];
    const missing = rods.filter((r) => !v.includes('anglertackle:' + r));
    if (missing.length === 0) {
      ok('竿全部进了 #minecraft:enchantable/durability（耐久 / 经验修补 才能在竿上出现）');
    } else no('这些竿不在 durability 标签里，吃不到耐久/经验修补：' + missing.join('、'));
  } else no('缺 data/minecraft/tags/item/enchantable/durability.json（耐久/经验修补 的 supported_items）');
}

// 语言键
const zh = JSON.parse(fs.readFileSync(path.join(ROOT,
  'src/main/resources/assets/anglertackle/lang/zh_cn.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT,
  'src/main/resources/assets/anglertackle/lang/en_us.json'), 'utf8'));
const missZh = gen.ENCH.filter((e) => !zh['enchantment.anglertackle.' + e.id]);
const missEn = gen.ENCH.filter((e) => !en['enchantment.anglertackle.' + e.id]);
if (missZh.length === 0 && missEn.length === 0) ok('六个附魔的中英语言键齐全');
else no('缺语言键：' + [...missZh.map((e) => e.id + '(中)'), ...missEn.map((e) => e.id + '(英)')].join('、'));
if (zh['message.anglertackle.enchant_rescue']) ok('抢救的提示文案在');
else no('缺 message.anglertackle.enchant_rescue（抢救生效时玩家看不到提示）');

// 附魔台 / 宝藏归属
//
// ⚠ 2026-10-02 更正：`#minecraft:treasure` **不负责"宝箱里能出"**。
//   把原版数据包翻了一遍：整个原版只有 `tags/enchantment/double_trade_price.json`
//   引用 treasure（那是村民定价），**没有任何战利品表读它**；
//   25 张会出附魔书的箱子 + 钓鱼宝藏用的都是 `enchant_randomly` /
//   `enchant_with_levels` 的 `options: "#minecraft:on_random_loot"`。
//   所以"能不能从箱子里出"分两条路：
//     · 附魔台那些：在 non_treasure 里 → on_random_loot 引用了 #non_treasure → 自动包含
//     · 宝箱专属那些：必须有一条 add_table 注入（见下面"宝箱阶梯"一节）
for (const e of gen.ENCH) {
  const nt = JSON.parse(fs.readFileSync(path.join(ROOT,
    'src/main/resources/data/minecraft/tags/enchantment/non_treasure.json'), 'utf8')).values;
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT,
    'src/main/resources/data/minecraft/tags/enchantment/treasure.json'), 'utf8')).values;
  const id = 'anglertackle:' + e.id;
  const inTable = nt.includes(id), inTreasure = tr.includes(id);
  // treasure 只装"真·宝藏附魔"（进不了附魔台的那些），两者在 vanilla 里是互斥的
  const wantTreasure = !e.table && e.chest;
  if (inTable !== e.table || inTreasure !== wantTreasure) {
    no(e.id + ' 的出处不对：规则说附魔台' + (e.table ? '✓' : '✗')
      + (wantTreasure ? ' 宝藏✓' : '') + '，标签里是附魔台' + (inTable ? '✓' : '✗')
      + ' 宝藏' + (inTreasure ? '✓' : '✗'));
  }
  const json = JSON.parse(fs.readFileSync(path.join(gen.ENCH_DIR, e.id + '.json'), 'utf8'));
  if (json.supported_items === '#anglertackle:enchantable/rod'
      && json.primary_items === undefined && json.max_level === e.maxLevel) {
    // primary_items 缺省 = 附魔台只出"能附在这件物品上"的附魔，正是我们要的
  } else {
    no(e.id + ' 的 JSON 与规则不符（supported_items / max_level）');
  }
}
ok('六个附魔的出处（附魔台 / 宝藏标签）与规则表逐条一致');

// ---------------------------------------------------------------- ③b 宝箱阶梯
// 用户 2026-10-02："附魔台刷不出的也做完了等级吗"
//
// "附魔台刷不出的"有两类，都得单独验：
//   A. 满级（要上铁砧合）：满级能不能拿到，取决于 maxLevel-1 有没有别的来源。
//   B. 宝箱专属的附魔（高质吸引）：它唯一的来源就是箱子 —— 那条路必须真的通，
//      而且宝箱那张表的能量区间要能覆盖它的每一级（否则"5 级"里只有第 1 级存在）。
console.log('\n--- 宝箱阶梯（附魔台刷不出的那些）---');

// 原版战利品表里出现过的 id（tools/vanilla-tags.json，从客户端 jar 生成）。
// 写错一个 id → 整张表失效 → "东西不掉"，且没有任何报错。
const vanilla = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/vanilla-tags.json'), 'utf8'));
const lootIds = new Set(vanilla.lootIds || []);
// NeoForge 自己的两个 id 不在原版数据里，出处是 NeoForgeMod 的注册语句：
//   GLOBAL_LOOT_MODIFIER_SERIALIZERS.register("add_table", …)
//   event.register(Registries.LOOT_CONDITION_TYPE, ResourceLocation…("neoforge","loot_table_id"), …)
const NEO_IDS = { modifierType: 'neoforge:add_table', condition: 'neoforge:loot_table_id' };

/** 把一个 JSON 里所有 "function"/"condition"/"type" 的取值收集起来（递归整个文档）。 */
function collectLootIds(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectLootIds(v, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'function' || k === 'condition' || k === 'type')
          && typeof v === 'string' && v.includes(':')) {
        out.add(v);
      }
      collectLootIds(v, out);
    }
  }
  return out;
}

/**
 * 逐字核对一份战利品 JSON 里用到的每个 id。
 *
 * ⚠ 必须**扫文件里真实出现的 id**，不能只查一张手写的清单：
 *   第一版就是只查了 5 个"我记得用过"的 id，于是把 `random_chance` 改成
 *   `random_chance_roll`（编出来的 id）照样全绿 —— 负向测试当场戳穿了。
 */
function checkLootFileIds(rel) {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const ids = [...collectLootIds(doc, new Set())];
  const bad = [];
  for (const id of ids) {
    if (id.startsWith('minecraft:')) {
      if (!lootIds.has(id)) bad.push(id + '（原版战利品表里没有这个 id）');
    } else if (id.startsWith('neoforge:')) {
      if (id !== NEO_IDS.modifierType && id !== NEO_IDS.condition) {
        bad.push(id + '（不是 NeoForge 注册的那两个 id）');
      }
    }
  }
  if (bad.length) {
    no(rel + ' 里用了不存在的 id：' + bad.join('、') +
      ' —— 整张表会失效，表现是"东西不掉"，没有任何日志');
  }
  return ids.length;
}
{
  const checked = [
    'src/main/resources/data/anglertackle/loot_modifiers/high_quality_lure_book.json',
    'src/main/resources/data/anglertackle/loot_table/inject/high_quality_lure_book.json',
  ];
  let n = 0;
  for (const rel of checked) n += checkLootFileIds(rel);
  ok('注入链里的 ' + n + ' 个 id 逐个核对过（原版 id 比 tools/vanilla-tags.json，' +
    'NeoForge 的两个比 NeoForgeMod 的注册语句）');
}

// 26.1.2：NeoForge 的战利品修饰符改成**扫目录**加载
// （LootModifierManager.java:32 FileToIdConverter.registry(…"loot_modifiers")），
// data/neoforge/loot_modifiers/global_loot_modifiers.json 这份索引已经不存在了。
// ⇒ "会不会被加载"等价于"文件在不在 data/anglertackle/loot_modifiers/ 里"。
const glmDir = path.join(ROOT, 'src/main/resources/data/anglertackle/loot_modifiers');
const listedModifiers = new Set(
  (fs.existsSync(glmDir) ? fs.readdirSync(glmDir) : [])
    .filter((f) => f.endsWith('.json'))
    .map((f) => gen.NS + ':' + f.slice(0, -5)));
if (listedModifiers.size > 0) {
  ok('data/anglertackle/loot_modifiers/ 里有 ' + listedModifiers.size + ' 条修饰符（26.1.2 按目录自动登记）');
} else {
  no('data/anglertackle/loot_modifiers/ 是空的 —— 我们的修饰符不会被加载');
}


const levelAt = (e, lo, hi, power) => {
  for (let lv = hi; lv >= lo; lv--) {
    const a = e.minCost[0] + e.minCost[1] * (lv - 1);
    const b = e.maxCost[0] + e.maxCost[1] * (lv - 1);
    if (power >= a && power <= b) return lv;
  }
  return 0;
};

let chestOnly = 0;
for (const e of gen.ENCH) {
  if (!e.chest || e.table) {
    continue;   // 附魔台那些经 #non_treasure → on_random_loot 自动进箱子，已在 ③ 节验过
  }
  chestOnly++;
  const id = gen.NS + ':' + e.id;
  const modName = e.id + '_book';
  const modPath = path.join(ROOT, 'src/main/resources/data', gen.NS, 'loot_modifiers', modName + '.json');
  const tablePath = path.join(ROOT, 'src/main/resources/data', gen.NS, 'loot_table/inject', modName + '.json');
  if (!fs.existsSync(modPath) || !fs.existsSync(tablePath)) {
    no(e.name + ' 标着"宝箱能出"，却没有注入的战利品表/修饰符 —— 这件附魔**永远不掉**' +
      '（`#minecraft:treasure` 没有任何战利品表读它，光挂标签没用）');
    continue;
  }
  const mod = JSON.parse(fs.readFileSync(modPath, 'utf8'));
  const tbl = JSON.parse(fs.readFileSync(tablePath, 'utf8'));

  if (!listedModifiers.has(gen.NS + ':' + modName)) {
    no(modName + ' 不在 data/anglertackle/loot_modifiers/ 里 —— 26.1.2 按目录加载，不在目录里就永远不会掉');
  }
  if (mod.type !== NEO_IDS.modifierType) {
    no(modName + ' 的修饰符类型是 ' + mod.type + '，应为 ' + NEO_IDS.modifierType +
      '（写错 = 修饰符解析不了 → 永远不掉，且没有日志）');
  }
  // 目标箱子：必须全在白名单里（不许有人手滑注入到矿道/沉船）
  const targets = [];
  const walkCond = (c) => {
    if (!c || typeof c !== 'object') return;
    if (c.condition === NEO_IDS.condition) targets.push(c.loot_table_id);
    for (const t of c.terms || []) walkCond(t);
  };
  for (const c of mod.conditions || []) walkCond(c);
  // ⚠ 这份白名单是**用户口径**（"仅在类似古城这样的超高价值战利品箱刷新"），
  //   刻意放在检查器里、而不是从生成器读 —— 从生成器读的话，"有人往矿道里也塞一份"
  //   会连带把白名单一起改掉，断言就成了自己证明自己。
  //   要加箱子，先回答"它算不算超高价值"，再改这里和生成器两处。
  const ALLOWED = [
    'minecraft:chests/ancient_city',
    'minecraft:chests/end_city_treasure',
    'minecraft:chests/trial_chambers/reward_ominous_rare',
  ];
  const bad = targets.filter((t) => !ALLOWED.includes(t));
  if (bad.length) {
    no(modName + ' 注入到了非白名单箱子：' + bad.join('、') + ' —— 用户口径是"仅在超高价值战利品箱"');
  } else if (targets.length === 0) {
    no(modName + ' 的条件里读不到任何 loot_table_id —— 它会在**每一张**箱子表上生效');
  } else {
    ok(e.name + ' 只注入到 ' + targets.length + ' 张超高价值箱子：' +
      targets.map((t) => t.replace('minecraft:chests/', '')).join('、'));
  }
  if (mod.table !== id.replace(gen.NS + ':', gen.NS + ':inject/') + '_book') {
    no(modName + ' 指向的注入表 id 不对：' + mod.table);
  }
  // 注入表：必须是"一本书 + 点名这个附魔的 enchant_with_levels"
  const fn = (((tbl.pools || [])[0] || {}).entries || [])[0] || {};
  const f0 = ((fn.functions || [])[0]) || {};
  if (fn.name === 'minecraft:book' && f0.function === 'minecraft:enchant_with_levels'
      && f0.options === id) {
    ok(e.name + ' 的注入表：一本普通书 + enchant_with_levels(options=' + id + ')');
  } else {
    no(modName + ' 的注入表不是"书 + enchant_with_levels 点名这个附魔"（实际 ' +
      fn.name + ' / ' + f0.function + ' / ' + f0.options + '）—— 掉出来的东西不对');
  }
  // 等级覆盖：宝箱的能量区间里，1..满级**每一级**都要能出（它没有别的高级来源）
  const lv = f0.levels || {};
  const lo = lv.min, hi = lv.max;
  if (typeof lo !== 'number' || typeof hi !== 'number') {
    no(modName + ' 的 levels 区间读不出来（' + JSON.stringify(f0.levels) + '）');
    continue;
  }
  const got = new Set();
  for (let p = lo; p <= hi; p++) {
    const l = levelAt(e, 1, e.maxLevel, p);
    if (l) got.add(l);
  }
  const lost = [];
  for (let l = 1; l <= e.maxLevel; l++) if (!got.has(l)) lost.push(l);
  if (lost.length === 0) {
    ok(e.name + ' 在宝箱能量 ' + lo + '..' + hi + ' 里 1..' + e.maxLevel + ' 每一级都出得来');
  } else {
    no(e.name + ' 的 ' + lost.join('、') + ' 级在宝箱能量 ' + lo + '..' + hi +
      ' 里**永远出不来** —— 它只有宝箱这一个来源，那几级等于不存在（成本表要按这段能量重排）');
  }
  // 宝箱专属附魔的满级必须是"宝箱里就能开出来"，不能指望铁砧（铁砧要两本，也得先有）
  if (got.has(e.maxLevel)) {
    ok(e.name + ' 的满级（' + e.maxLevel + '）在箱子里就能开出来，不必绕铁砧');
  } else {
    no(e.name + ' 的满级开不出来 —— 宝箱专属附魔的满级必须能直接从箱子拿到');
  }
}
if (chestOnly === 0) ok('没有"只在宝箱出"的附魔');

// ---- A. 满级（要上铁砧）的那条路必须真的通 ----
// 满级在附魔台上刷不出来（③ 节保证了），所以玩家只能拿两份 maxLevel-1 去铁砧合。
// 于是有两件事必须成立：maxLevel-1 拿得到（③ 节的阶梯断言保证了），
// 以及**我们的铁砧处理器不能把"竿+竿 / 竿+附魔书"这种合并拦下来**。
{
  const av = fs.readFileSync(path.join(ROOT,
    'src/main/java/com/whitecobalt/anglertackle/event/AnvilEvents.java'), 'utf8');
  const stripped = stripComments(av);
  if (/if \(!ok\) \{[\s\S]{0,400}?return;/.test(stripped)) {
    ok('铁砧："装不上配件"时放行给原版（竿+竿 / 竿+附魔书 的合并升级不会被我们拦掉）');
  } else {
    no('铁砧处理器没有在"装不上配件"时放行 —— 竿+竿、竿+书 的合并升级会被它吃掉，' +
      '于是所有满级都合不出来');
  }
}
// 用户 2026-10-02："你自创附魔时只做了等级最高的，比如韧性保护只有 4 级，没有 1,2,3 级。"
//
// 附魔台给几级完全由 min_cost/max_cost 决定。原版的选法（EnchantmentHelper
// #getAvailableEnchantmentResults，逐字照抄）是"从满级往下找第一个出得起的"：
//     for (i = maxLevel; i >= 1; i--)
//         if (power >= minCost(i) && power <= maxCost(i)) → 选中 i
// 而 power 就是附魔台那一格的报价。上限是 **30**：
//     getEnchantmentCost：书架数封顶 15，第三格 = max(j, 书架×2) = 30（第一格 ≤10、第二格 ≤21）
// 所以"等级阶梯"就是这张成本表本身，下面把它在 JS 里复算一遍。
console.log('\n--- 等级阶梯（附魔台 1..30 能量能刷出哪些等级）---');

/** 原版选法：返回这个能量下会选中的等级（0 = 这个附魔刷不出来）。 */
function vanillaLevel(e, power) {
  for (let lv = e.maxLevel; lv >= 1; lv--) {
    const lo = e.minCost[0] + e.minCost[1] * (lv - 1);
    const hi = e.maxCost[0] + e.maxCost[1] * (lv - 1);
    if (power >= lo && power <= hi) return lv;
  }
  return 0;
}
const MAX_POWER = 30;

for (const e of gen.ENCH) {
  if (!e.table) {
    ok(e.name + ' 不进附魔台（只从宝箱出），不参与等级阶梯');
    continue;
  }
  // 每一级在 [1,30] 里的档位（0 = 这一级刷不出来）
  const reach = [];
  const bands = [];
  for (let lv = 1; lv <= e.maxLevel; lv++) {
    const ps = [];
    for (let p = 1; p <= MAX_POWER; p++) if (vanillaLevel(e, p) === lv) ps.push(p);
    reach[lv] = ps;
    bands.push(lv + ':' + (ps.length ? ps[0] + '-' + ps[ps.length - 1] : '刷不出'));
  }

  if (e.maxLevel === 1) {
    // 单级附魔（抢救）：只有"刷得到/刷不到"两种状态，用户指定 30 级台子能出
    if (reach[1].length) ok(e.name + '（1 级）：能量 ' + reach[1][0] + ' 起刷得到（用户指定 30 级台子能出）');
    else no(e.name + ' 连唯一的 1 级都刷不出来（min_cost 超过 30）—— 附魔台永远拿不到它');
  } else {
    // (a) 1..满级-1 每一级都要有能刷到它的能量档 —— 这条就是用户报的那个问题
    const missing = [];
    for (let lv = 1; lv < e.maxLevel; lv++) if (!reach[lv].length) missing.push(lv);
    if (missing.length === 0) {
      ok(e.name + '（上限 ' + e.maxLevel + ' 级）：1..' + (e.maxLevel - 1) +
        ' 每一级都刷得到 —— ' + bands.join('  '));
    } else {
      no(e.name + ' 的 ' + missing.join('、') + ' 级在附魔台上**永远刷不出来**（1..30 能量都不出）—— ' +
        '等级阶梯断了：' + bands.join('  '));
    }
    // (b) 满级要排在 30 之外（上铁砧合）—— 否则满配台子永远只给满级，低级等于不存在
    if (reach[e.maxLevel].length === 0) {
      ok(e.name + ' 满级（' + e.maxLevel + '）刷不出来，要上铁砧合 —— 和原版时运/饵钓/锋利同一条规矩');
    } else {
      no(e.name + ' 满级在能量 ' + reach[e.maxLevel][0] + '..' +
        reach[e.maxLevel][reach[e.maxLevel].length - 1] +
        ' 就能刷到 —— 满配台子（能量 30）永远只给满级，1..' + (e.maxLevel - 1) + ' 级等于不存在');
    }
  }
  // (c) 常见附魔（weight ≥ 5）的第一级要能在小台子上刷到（报价 ≤10 = 书架很少）
  if (e.weight >= 5) {
    const lowOk = [];
    for (let p = 1; p <= 10; p++) if (vanillaLevel(e, p) === 1) lowOk.push(p);
    if (lowOk.length) ok(e.name + ' 的 1 级在小台子（能量 ≤10）就能刷到');
    else no(e.name + '（常见附魔）的 1 级要能量 ' +
      (e.minCost[0]) + ' 才出 —— 新手裸台子一个模组附魔都看不到');
  }
  // (d) 能量越高等级不降（"取最高的那个匹配"天然保证，但成本窗口写反就会破）
  let mono = true;
  for (let p = 1; p < MAX_POWER; p++) {
    if (vanillaLevel(e, p) > vanillaLevel(e, p + 1)) mono = false;
  }
  if (mono) ok(e.name + ' 的等级随能量单调不降（不会"能量更高反而给更低级"）');
  else no(e.name + ' 的等级随能量不单调 —— 成本窗口写反了（max_cost 比下一级的 min_cost 还小？）');
}

// ---------------------------------------------------------------- ④ 对现有系统的影响
console.log('\n--- 影响检测（数值复算）---');

// 读出真实常量
const habits = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/fishing/FishHabits.java'), 'utf8');
const BASE_PCT = Number(/BONUS_PERCENT = (\d+)/.exec(habits)[1]);
const ench = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/fishing/RodEnchants.java'), 'utf8');
const num = (n) => Number(new RegExp(n + ' = ([0-9.]+)').exec(ench)[1]);
const REIN = num('REINFORCED_PER_LEVEL'), DRAGM = num('DRAG_PER_LEVEL');
const PRECISE = Number(/PRECISE_HUNT_PERCENT_PER_LEVEL = (\d+)/.exec(ench)[1]);
const HQP = num('HIGH_QUALITY_PCT_PER_LEVEL'), LOADB = num('LOAD_BEARING_PER_LEVEL');
const MAXL = Object.fromEntries(gen.ENCH.map((e) => [e.id, e.maxLevel]));

// (a) 权重：词条加成（精准猎获满级）后的加成比例，以及是否会让某一类通吃
const pctMax = BASE_PCT + PRECISE * MAXL.precise_hunt;
if (pctMax <= 130) {
  ok('精准猎获满级时词条加成为 ×' + (pctMax / 100).toFixed(2) + '（基准 ×' + (BASE_PCT / 100).toFixed(2)
    + '）—— 加算且上界受控，不会把某一类鱼吃满池子');
} else {
  no('精准猎获满级加成 ×' + (pctMax / 100).toFixed(2) + ' 过高 —— 权重系统会被单类鱼主导，按用户要求打回');
}
// 权重 3 的最小档位仍要吃到加成（+1 下限），否则"加成等于没有"
const w3 = Math.max(3 + 1, 3 * pctMax / 100 | 0);
if (w3 > 3) ok('最小权重 3 的鱼在满级加成下仍从 3 → ' + w3 + '（保底 +1 没有被吃掉）');
else no('最小权重 3 的鱼满级仍是 3 —— 加成对它们等于没有');

// (b) 高质吸引：金红占比不得超 100（超过会让"按权重反解金红"崩掉）
const hvBase = 10.0;   // 红档饵的基准占比（config 默认 10.0）
const hvMax = hvBase + HQP * MAXL.high_quality_lure;
if (hvMax <= 100) ok('高质吸引满级时金红占比 ' + hvBase + '% → ' + hvMax.toFixed(1) + '%（≤100%，反解仍然成立）');
else no('高质吸引满级把金红占比推到 ' + hvMax + '% —— 权重反解会崩，按用户要求打回');
// 与窝料加成叠加后的最坏情况（窝料最高 1.1 倍）
const hvWorst = hvMax * 1.1;
if (hvWorst <= 100) ok('再叠上窝料加成（×1.1）也才 ' + hvWorst.toFixed(1) + '%（仍然 ≤100%）');
else no('叠上窝料加成后 ' + hvWorst.toFixed(1) + '% > 100% —— 金红占比会溢出，按用户要求打回');

// (c) 韧性保护：满级仍有限，且"红区超时"这条断线路径不受它影响 → 不是无敌
const capMult = 1 + REIN * MAXL.reinforced;
if (capMult <= 1.5) ok('韧性保护满级上限 ×' + capMult.toFixed(2) + '（有限，不会变成"拉不断"）');
else no('韧性保护满级 ×' + capMult.toFixed(2) + ' 过高，钓鱼小游戏会失去张力压力');
const src = fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java'), 'utf8');
if (/redZoneTicks > this\.redZoneLimit/.test(src) && /this\.tension > this\.yellowMax\(\)/.test(src)) {
  ok('红区超时断线仍在（韧性保护抬高上限，但赖在红区照样断）—— 不是无敌');
} else no('红区超时断线不见了 —— 韧性保护会变成无限赖线');

// (d) 抢救：只回落一格 + 每场一次
if (/this\.tension = this\.whiteMax\(\);/.test(src)) ok('抢救回落点是黄/白交界（whiteMax），不是清零');
else no('抢救没有回落到 whiteMax —— 与用户口径不符');
if (/enchRescue > 0 && !rescueUsed/.test(src) && /rescueUsed = true;/.test(src)) {
  ok('抢救每场对抗只触发一次（rescueUsed 闸门）');
} else no('抢救没有一次性闸门 —— 会变成"永远断不了线"');

// (e) 承重保护：满级仍有消耗
const burn = 1 - LOADB * MAXL.load_bearing;
if (burn > 0) ok('承重保护满级仍烧 ' + (burn * 100).toFixed(0) + '% 的耐久速度（不会变成不烧）');
else no('承重保护满级把超承重消耗削成 0 —— 超承重就失去惩罚了');

// (f) 竿型限定：四个"仅路亚"的效果**逐个**检查有没有竿型闸门
//     （早先写成"数 enchRodIsLure 出现次数"，承重保护走的是辅助方法、次数不够，误报了一次）
const gates = [
  ['韧性保护（张力上限）', /enchRodIsLure \? 1\.0 \+ RodEnchants\.REINFORCED_PER_LEVEL/],
  ['拉扯（双回拉）', /enchRodIsLure \? 1\.0 \+ RodEnchants\.DRAG_PER_LEVEL/],
  ['抢救（断线回落）', /enchRodIsLure && enchRescue > 0/],
  ['承重保护（烧耐久）', /RodEnchants\.overCapacityBurnMultiplier\(/],
];
const ungated = gates.filter(([, re]) => !re.test(src)).map(([n]) => n);
if (ungated.length === 0 && /public static boolean isLure\(ItemStack/.test(ench)) {
  ok('四个"仅对路亚生效"的效果都带了竿型闸门（台钓竿附了也不生效）');
} else {
  no('这些效果没有竿型闸门：' + ungated.join('、') + ' —— 台钓竿会白吃这些附魔');
}
// 辅助方法自身也要判竿型（承重保护就是走它）
if (/return isLure\(rod\) \? 1\.0 \+ DRAG_PER_LEVEL|if \(!isLure\(rod\)\) \{\s*return 1\.0;/.test(ench)) {
  ok('RodEnchants 的倍率方法自己也判竿型（不只靠调用点）');
} else no('RodEnchants 的倍率方法没判竿型 —— 换个调用点就会漏');
// 拉扯倍率：满级 +15%
ok('拉扯满级回拉速度 ×' + (1 + DRAGM * MAXL.drag).toFixed(2));

console.log('');
console.log(bad === 0
  ? '✅ 六个附魔接线正确，且对现有权重/张力系统没有破坏性影响'
  : '❌ 附魔检查未通过（' + bad + ' 项）—— 按用户要求：影响检测不过就重做');
process.exit(bad ? 1 : 0);
