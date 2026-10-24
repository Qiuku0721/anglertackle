/*
 * check-recipe-book.js —— 料理线的自定义配方必须**真的进得了原版配方书**，
 * 而且**看到的和定义的一致**。
 *
 * ── 为什么要它 ────────────────────────────────────────────────
 * ① 这些配方（切块 / 榨油 / 一条鱼一道菜）匹配与产出全在 Java 里，JSON 只有 type。
 *    它们原本是 **special 配方**，而原版 `ClientRecipeBook` 的第一句话就是
 *
 *        if (!recipe.isSpecial() && !recipe.isIncomplete()) { ……收进配方书…… }
 *
 *    —— special 配方**一条都进不了配方书**（玩家 2026-10-03："内容写进原版配方书"）。
 *    要让它们出现，三个条件缺一不可，而且**都不会报错**：
 *      · `isSpecial()` 必须覆写成 false；
 *      · `getIngredients()` 必须给出真实材料（返回空 → `isIncomplete()` → 照样不显示；
 *        条数与真实消耗不一致 → "显示能做、点下去做不出来"）；
 *      · `getResultItem()` 必须给出代表产物（默认 `ItemStack.EMPTY` → 那一格是空的）。
 *
 * ② 显示还必须与**定义**一致（用户 2026-10-03 第二次反馈）：
 *    "配方必须完全与定义一致。现在出现的问题是**配方显示模糊，什么鱼都可以做菜**。"
 *    —— 所以配方是「一条鱼 × 一道菜」一条（31 条），JSON 由 Java 的逐鱼表生成，
 *    产物名字带鱼种（`dish.anglertackle.<菜型>` 模板 + 鱼名），本检查器守着这三件事。
 *
 * 断言：
 *   A. 三个配方类都覆写 `isSpecial() → false`、`getIngredients()`、`getResultItem()`
 *   B. 配方清单 = 切块 + 榨油 + **Java 逐鱼表展开的 31 对**，磁盘上一条不多一条不少
 *   C. 解锁材料：切块/榨油读 Java 的 `getIngredients()`，菜配方 = **那条鱼本身**
 *   D. 解锁材料都存在（物品注册过 / 标签文件在）
 *   E. `RECIPE_BOOK_EXEMPT` 只剩 `rod_assembly`（special：产出入同物，配方书画不出东西）
 *   F. 生成器跑过了：磁盘上的解锁进度与算出来的一致
 *   G. **产物名字带鱼种**：每个菜型都有 `dish.anglertackle.<菜型>` 模板（中英各一条，
 *      且正好一个 `%s`）—— 没有它，配方书 / JEI 里就还是笼统的"红烧鱼"
 *   H. **展示的鱼块必须是这条鱼真能切出来的**：档位按 `FishSpecies.tiers()` 算，
 *      不许写死；且 docs/25 §13.5 的"材料"列必须等于"该鱼最高档对应的那一档"。
 *      用户 2026-10-03 抓到的就是这条："刺身需要大西洋鲑的普通鱼块，但显然
 *      普通鱼块不可能被大西洋鲑做出来"。
 *
 * 用法：node tools/check-recipe-book.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const NS = 'anglertackle';
const RECIPE_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'recipe');
const ADV_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'advancement/recipes');
const JAVA_DIR = 'src/main/java/com/whitecobalt/anglertackle/recipe';
const MOD_ITEMS = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';
const LANG_DIR = 'src/main/resources/assets/anglertackle/lang';

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 原版配方书检查（进得去 · 且看到的与定义一致）===\n');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

for (const rel of ['tools/gen-recipe-advancements.js', 'tools/gen-dish-recipes.js', MOD_ITEMS,
  JAVA_DIR + '/DishRecipe.java', JAVA_DIR + '/CuttingRecipe.java', JAVA_DIR + '/OilPressingRecipe.java']) {
  if (!exists(rel)) { no('缺文件：' + rel); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}

const genMod = require(path.join(ROOT, 'tools/gen-recipe-advancements.js'));
const dishGen = require(path.join(ROOT, 'tools/gen-dish-recipes.js'));
const BOOK_UNLOCK = genMod.BOOK_UNLOCK || {};
const EXEMPT = genMod.RECIPE_BOOK_EXEMPT || new Set();

const pairs = dishGen.readPairs();                       // [{dish, species}] ← Java 逐鱼表
const DISH_IDS = [...new Set(pairs.map((p) => p.dish))];
const DISH_RECIPES = pairs.map((p) => p.dish + '/' + p.species);
const RECIPES = ['cutting', 'oil_pressing', ...DISH_RECIPES];

// ---------------------------------------------------------------- ModItems 的常量 → 物品 id
const modItemsSrc = read(MOD_ITEMS);
const ITEM_ID = new Map();          // 'SOY_SAUCE' → 'anglertackle:soy_sauce'
for (const m of modItemsSrc.matchAll(/DeferredItem<[^>]*>\s+([A-Z_0-9]+)\s*=\s*ITEMS\.register\("([a-z_0-9]+)"/g)) {
  ITEM_ID.set(m[1], NS + ':' + m[2]);
}
if (ITEM_ID.size < 50) no('从 ModItems 里只解析出 ' + ITEM_ID.size + ' 个物品（结构变了？）');

/**
 * 鱼物品的 id 集合。
 *
 * <p>⚠ 鱼不是一个个字面量注册的，而是走 `fish("crucian_carp")` 这个助手方法 ——
 * 上面那条正则（要求 `ITEMS.register("字面量"`）**抓不到它们**，第一次跑就误报了
 * 22 条"引用了没注册的物品"。真正的名单在标签文件里（`#anglertackle:fishes`）。
 */
const FISH_IDS = new Set();
{
  const rel = 'src/main/resources/data/' + NS + '/tags/item/fishes.json';
  if (exists(rel)) {
    for (const v of JSON.parse(read(rel)).values || []) FISH_IDS.add(v);
  }
}
const ALL_ITEM_IDS = new Set([...ITEM_ID.values(), ...FISH_IDS]);
if (FISH_IDS.size === 0) no('读不到整鱼标签（' + NS + ':fishes）里的鱼物品名单');

/** `ModItems.X` / `Items.Y` → 物品 id。解析不出来返回 null。 */
function itemIdOf(expr) {
  const mod = /^ModItems\.([A-Z_0-9]+)$/.exec(expr);
  if (mod) return ITEM_ID.get(mod[1]) || null;
  const van = /^Items\.([A-Z_0-9]+)$/.exec(expr);
  if (van) return 'minecraft:' + van[1].toLowerCase();
  return null;
}

/** 从 `TagKey.create(…Registries.ITEM, …ResourceLocation.fromNamespaceAndPath(MOD_ID, "fishes"))` 取标签 id。
 *  ⚠ 源码里这两个类是**全限定名**（`net.minecraft.core.registries.Registries.ITEM`），
 *    所以前缀要写成 `[\w.]*` —— 第一次按短名写，正则一条都匹配不上。 */
function tagOfFishConstant(src) {
  const m = /TagKey\.create\([\w.]*Registries\.ITEM,\s*[\w.]*ResourceLocation\.fromNamespaceAndPath\(\s*[^,]+,\s*"([a-z_]+)"\)\)/.exec(src);
  return m ? '#' + NS + ':' + m[1] : null;
}

console.log('  （逐鱼表展开：' + DISH_RECIPES.length + ' 条菜配方，' + DISH_IDS.length + ' 种做法）\n');

// ---------------------------------------------------------------- A 三个类该覆写的都覆写了
{
  const problems = [];
  for (const c of [JAVA_DIR + '/DishRecipe.java', JAVA_DIR + '/CuttingRecipe.java',
    JAVA_DIR + '/OilPressingRecipe.java']) {
    const src = read(c);
    const name = path.basename(c);
    if (!/public boolean isSpecial\(\) \{\s*return false;\s*\}/.test(src)) {
      problems.push(name + ' 没有把 isSpecial() 覆写成 false —— 原版 ClientRecipeBook 会整条跳过它');
    }
    // 26.1.2：Recipe 接口删掉了 getIngredients() / getResultItem()。
    // 配方书与 JEI 现在看两样东西：
    //   · placementInfo() —— 真实摆料（默认/占位写法会让"做不做得出来"判不出来）；
    //   · display()       —— 画什么（返回空列表 = 配方书里那一格是空的）。
    // 断言语义不变（甚至更直接）：材料与产物都必须**真的给出来**。
    const place = /public PlacementInfo placementInfo\(\) \{([\s\S]*?)\n    \}/.exec(src);
    if (!place) {
      problems.push(name + ' 没有覆写 placementInfo() —— 配方书/JEI 拿不到真实摆料（等于空材料表）');
    } else if (!/PlacementInfo\.create\(/.test(place[1])) {
      problems.push(name + ' 的 placementInfo() 没有给出真实材料（不是 PlacementInfo.create(...)）'
        + ' —— 配方书会认为这条配方摆不出来');
    }
    const disp = /public List<RecipeDisplay> display\(\) \{([\s\S]*?)\n    \}/.exec(src);
    if (!disp) {
      problems.push(name + ' 没有覆写 display() —— 配方书里那一格会是空的');
    } else if (!/\w*CraftingRecipeDisplay\(|\w*SmeltingRecipeDisplay\(|\w*RecipeDisplay\(/.test(disp[1])
        || !/ItemStackSlotDisplay|ItemSlotDisplay/.test(disp[1])) {
      problems.push(name + ' 的 display() 没有给出产物格 —— 配方书那一格还是空的');
    }
  }
  if (problems.length) problems.forEach(no);
  else ok('三个配方类都覆写了 isSpecial()→false / placementInfo()（真实材料）/ display()（产物格）');
}

// ---------------------------------------------------------------- B 配方清单 = 逐鱼表展开
{
  const missing = [];
  for (const name of RECIPES) {
    const rel = path.join('src/main/resources/data', NS, 'recipe', name + '.json');
    if (!exists(rel)) { missing.push(name); continue; }
    const doc = JSON.parse(read(rel));
    const want = NS + ':' + name;
    if (doc.type !== want) missing.push(name + '（type=' + doc.type + '）');
  }
  if (missing.length) {
    no('这些配方 JSON 找不到或 type 不对（跑 node tools/gen-dish-recipes.js --write）：\n       '
      + missing.join('\n       '));
  } else {
    ok('配方清单与 Java 逐鱼表一致：切块 + 榨油 + ' + DISH_RECIPES.length + ' 条菜配方（一条鱼 × 一道菜）');
  }
  // 反向：磁盘上不该有"表里没有的"菜配方（旧的 10 条一层文件、或逐鱼表里删掉的组合）
  // —— 多出来的那些，玩家照着 JEI 摆材料一定做不出来，正是"显示与定义不一致"。
  //
  // ⚠ 要扫**所有子目录**，不能只扫"当前表里出现的菜型"：把某道菜的最后一条鱼删掉时，
  //  那个菜型会整个从表里消失，只扫已知菜型的话，它连着磁盘上那份 JSON 一起被跳过 ——
  //  负例 book-pair-drift 第一次就是这么"绿"过去的。
  const expected = new Set(DISH_RECIPES.map((n) => n + '.json'));
  const extra = [];
  const base = path.join('src/main/resources/data', NS, 'recipe');
  const walk = (relDir) => {
    const abs = path.join(ROOT, base, relDir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = relDir ? relDir + '/' + e.name : e.name;
      if (e.isDirectory()) walk(rel);
      // ⚠ 排除 recipe/kaleidoscope/**（森罗物语联动的兼容配方，docs/30）：
      //   那一层是"用他们的厨具做我们的菜"，不是"一条鱼一道菜"的逐鱼配方，
      //   不参与"逐鱼表"比对（它们由 check-kaleidoscope-compat.js 守）。
      else if (e.name.endsWith('.json') && relDir && !rel.startsWith('kaleidoscope/')
          && !expected.has(rel)) extra.push(rel);
    }
  };
  walk('');
  if (extra.length) {
    no('磁盘上有"定义里没有"的菜配方（玩家照着它摆材料会做不出来）：\n       ' + extra.join('\n       '));
  } else ok('没有多余的菜配方（显示清单 = 逐鱼表，一条不多一条不少）');
}

// ---------------------------------------------------------------- C 解锁材料
{
  const wrong = [];
  // 切块：`list.add(Ingredient.of(FISHES));`
  const cutSrc = read(JAVA_DIR + '/CuttingRecipe.java');
  {
    const want = /list\.add\(Ingredient\.of\(FISHES\)\);/.test(cutSrc) ? tagOfFishConstant(cutSrc) : null;
    if (!want) wrong.push('cutting（CuttingRecipe.getIngredients() 里的整鱼标签解析不出来）');
    else if (BOOK_UNLOCK.cutting !== want) wrong.push('cutting：Java [' + want + '] vs 生成器 [' + BOOK_UNLOCK.cutting + ']');
  }
  // 榨油：`Ingredient.of(ModItems.FISH_CHUNK.get(), …)` 的第一个
  {
    const m = /Ingredient \w+ = Ingredient\.of\(([\s\S]*?)\);/.exec(read(JAVA_DIR + '/OilPressingRecipe.java'));
    const first = m && /ModItems\.([A-Z_0-9]+)\.get\(\)/.exec(m[1]);
    const want = first ? ITEM_ID.get(first[1]) : null;
    if (!want) wrong.push('oil_pressing（OilPressingRecipe.getIngredients() 里的第一个生块解析不出来）');
    else if (BOOK_UNLOCK.oil_pressing !== want) wrong.push('oil_pressing：Java [' + want + '] vs 生成器 [' + BOOK_UNLOCK.oil_pressing + ']');
  }
  // 菜配方：解锁材料就是**那条鱼**（钓到它 → 解锁它的那道菜）
  const adv = genMod.build();
  for (const name of DISH_RECIPES) {
    const species = name.split('/')[1];
    const text = adv.get(name);
    if (!text) { wrong.push(name + '（生成器没给它做进度）'); continue; }
    const ing = JSON.parse(text).criteria.has_ingredient.conditions.items[0].items;
    if (ing !== NS + ':' + species) {
      wrong.push(name + '：解锁材料是 [' + ing + ']，应当是那条鱼 ' + NS + ':' + species);
    }
  }
  if (wrong.length) no('解锁材料与定义对不上：\n       ' + wrong.join('\n       '));
  else ok('解锁材料对得上：切块=整鱼标签、榨油=生块、菜配方=**那条鱼本身**（钓到才解锁）');
}

// ---------------------------------------------------------------- D 材料本身要存在
{
  const problems = [];
  const values = new Set([...Object.values(BOOK_UNLOCK), ...DISH_RECIPES.map((n) => NS + ':' + n.split('/')[1])]);
  for (const id of values) {
    if (id.startsWith('#' + NS + ':')) {
      const rel = 'src/main/resources/data/' + NS + '/tags/item/' + id.slice(NS.length + 2) + '.json';
      if (!exists(rel)) problems.push('引用了不存在的标签 ' + id);
    } else if (id.startsWith(NS + ':')) {
      if (!ALL_ITEM_IDS.has(id)) problems.push('引用了 ModItems 里没注册的物品 ' + id);
    } else if (!/^#?[a-z_]+:[a-z_/]+$/.test(id)) {
      problems.push('材料 id 格式不对：' + id);
    }
  }
  if (problems.length) no('解锁材料有问题（判据永远不成立 → 配方解锁不了）：' + problems.join('、'));
  else ok('解锁材料都存在（' + values.size + ' 个物品/标签）');
}

// ---------------------------------------------------------------- E 不许再被豁免
{
  const wrong = [...EXEMPT].filter((n) => RECIPES.includes(n));
  if (wrong.length) no('这些配方又被塞回 RECIPE_BOOK_EXEMPT（豁免 = 配方书里永远看不到）：' + wrong.join('、'));
  else if (EXEMPT.size !== 1 || !EXEMPT.has('rod_assembly')) {
    no('RECIPE_BOOK_EXEMPT 不该有 ' + [...EXEMPT].join('、') +
      '（只该剩 rod_assembly：产出入同物，配方书画不出东西）');
  } else ok('配方书豁免名单只剩 rod_assembly（special 且产出入同物）');
}

// ---------------------------------------------------------------- F 生成器跑过了
{
  const stale = [];
  for (const [name, text] of genMod.build()) {
    const rel = path.join('src/main/resources/data', NS, 'advancement/recipes', name + '.json');
    if (!exists(rel)) { stale.push(name + '（没有进度文件）'); continue; }
    if (read(rel) !== text) stale.push(name + '（内容与生成器不一致）');
  }
  if (stale.length) {
    no('磁盘上的解锁进度与生成器不一致（改完配方忘了重跑生成器？）：\n       ' + stale.join('\n       '));
  } else ok('磁盘上的 55 份解锁进度与生成器逐字节一致');
}

// ---------------------------------------------------------------- G 产物名字带鱼种
{
  const problems = [];
  for (const id of DISH_IDS) {
    const key = 'dish.anglertackle.' + id;
    for (const lang of ['zh_cn', 'en_us']) {
      const rel = LANG_DIR + '/' + lang + '.json';
      if (!exists(rel)) { problems.push('缺 ' + rel); break; }
      const doc = JSON.parse(read(rel));
      const v = doc[key];
      if (typeof v !== 'string') { problems.push(lang + ' 缺 ' + key); continue; }
      const n = (v.match(/%s/g) || []).length;
      if (n !== 1) problems.push(lang + ' 的 ' + key + ' 里 %s 有 ' + n + ' 个（应当正好 1 个）：' + v);
    }
  }
  if (problems.length) {
    no('产物名字模板有问题（配方书 / JEI 里会退回笼统的"红烧鱼"）：\n       ' + problems.join('\n       '));
  } else ok('12 个菜型都有带鱼种的名字模板（中英各一条、正好一个 %s）：配方书里显示"红烧草鱼"');
}

// ---------------------------------------------------------------- H 展示的鱼块必须是这条鱼真能切出来的
// 用户 2026-10-03："刺身需要大西洋鲑的**普通鱼块**，但显然普通鱼块不可能被大西洋鲑做出来"
// —— 第一版把展示用的档位写死成 tier 0 了。鲑鱼是 {4,5} 档，只会切出顶级鱼排。
{
  const FISH_SPECIES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';
  const spSrc = read(FISH_SPECIES);
  const TABLES = {};
  for (const m of spSrc.matchAll(/private static final int\[\] ([A-Z_]+) = \{([0-9,\s]+)\};/g)) {
    TABLES[m[1]] = m[2].split(',').map((x) => Number(x.trim()));
  }
  const SPECIES = new Map();
  for (const m of spSrc.matchAll(/new FishSpecies\("([a-z_]+)",[\s\S]*?,\s*([A-Z_]+),\s*\n/g)) {
    SPECIES.set(m[1], TABLES[m[2]] || []);
  }
  const groupOf = (t) => (t <= 1 ? 0 : t <= 3 ? 1 : 2);      // 与 FishChunkData.groupOfTier 同规则
  const GROUP_ZH = { 0: '普通鱼块', 1: '优质鱼肉', 2: '顶级鱼排' };

  const problems = [];
  if (SPECIES.size === 0) problems.push('读不到 FishSpecies.ALL（结构变了？）');

  // ① docs/25 §13.5 的"材料"列 == 该鱼档位表最高档对应的那一档
  //    （那一列就是"这条鱼用什么块做菜"的定义，展示必须照它来）
  {
    const doc = read('docs/25-鱼料理与配料方案.md').split(/\r?\n/);
    const zh = JSON.parse(read(LANG_DIR + '/zh_cn.json'));
    const zhToId = {};
    for (const [k, v] of Object.entries(zh)) {
      const m = /^item\.anglertackle\.([a-z_]+)$/.exec(k);
      if (m && typeof v === 'string') zhToId[v] = m[1];
    }
    let start = -1;
    for (let i = 0; i < doc.length; i++) if (/^#{2,4}\s*13\.5(\s|$)/.test(doc[i])) { start = i; break; }
    if (start < 0) problems.push('docs/25 里找不到 §13.5');
    else {
      let seenSep = false, rows = 0;
      for (let i = start + 1; i < doc.length; i++) {
        const ln = doc[i];
        if (/^#{2,4}\s/.test(ln)) break;
        if (!ln.startsWith('|')) continue;
        if (/^\|[\s:|-]+\|$/.test(ln)) { seenSep = true; continue; }
        if (!seenSep) continue;
        const c = ln.split('|').map((s) => s.trim());
        if (!/^\d+$/.test(c[1] || '')) continue;
        const id = zhToId[c[2]];
        const mat = (c[3] || '').replace(/\*\*/g, '');
        if (!id) { problems.push('§13.5 的鱼名查不到 id：' + c[2]); continue; }
        rows++;
        const tiers = SPECIES.get(id);
        if (!tiers || tiers.length === 0) { problems.push(id + ' 在 FishSpecies 里查不到（§13.5 有它）'); continue; }
        if (/整鱼/.test(mat)) continue;                      // 整鱼下锅的鱼没有块
        const want = GROUP_ZH[groupOf(tiers[tiers.length - 1])];
        if (!mat.includes(want)) {
          problems.push(id + '：§13.5 材料列写 [' + mat + ']，而它的档位表 '
            + JSON.stringify(tiers) + ' 最高档给的是 [' + want + ']');
        }
      }
      if (rows === 0) problems.push('§13.5 一行都没解析出来');
    }
  }

  // ② Java 必须**按鱼的档位表**算展示用的块，不许写死档位
  {
    const javaSrc = read(JAVA_DIR + '/DishRecipe.java');
    if (!/FishSpecies\.byId\(/.test(javaSrc) || !/chunkGroups\(/.test(javaSrc)) {
      problems.push('DishRecipe 的展示材料没有按 FishSpecies 的档位表算'
        + '（红档鱼会被显示成普通鱼块 —— 2026-10-03 的 bug）');
    }
    const literal = /new FishChunkData\(species,\s*\d/.exec(javaSrc);
    if (literal) {
      problems.push('DishRecipe 里把展示档位写死成 ' + literal[0] + ' —— 红档鱼不可能有普通鱼块');
    }
  }

  if (problems.length) {
    no('展示的鱼块与"这条鱼真能切出什么"对不上：\n       ' + problems.join('\n       '));
  } else {
    ok('展示的鱼块 = 这条鱼档位表能给的那些（§13.5 的"材料"列也与档位表逐条一致）');
  }
}

console.log('');
if (bad === 0) {
  console.log('✅ 料理配方都在原版配方书里，且显示的鱼种与定义一致');
  process.exitCode = 0;
} else {
  console.log('❌ 配方书检查失败：' + bad + ' 项');
  process.exitCode = 1;
}
