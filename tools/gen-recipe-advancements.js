/*
 * gen-recipe-advancements.js —— 把模组的每个配方接进**原版配方书**。
 *
 * 为什么需要它：MC 的配方书只显示"玩家已经解锁的配方"，而解锁的唯一途径是
 * **带 rewards.recipes 的进度（advancement）**。原来模组一个进度都没有，
 * 所以合成过的配方在配方书里根本不出现 —— 玩家只能自己背配方。
 *
 * 做法照抄原版（data/minecraft/advancement/recipes/**）：
 *   · parent = minecraft:recipes/root
 *   · 两个判据：has_the_recipe（recipe_unlocked）+ has_ingredient（inventory_changed，材料之一）
 *   · rewards.recipes = 这个配方
 *   · **不写 display** —— 原版的配方解锁进度全都没有 display，所以不会弹提示、
 *     不进进度界面，也就不需要语言键（写 display 反而会满屏弹"新配方"提示）
 *
 * 输入：src/main/resources/data/anglertackle/recipe/*.json
 * 输出：src/main/resources/data/anglertackle/advancement/recipes/<配方名>.json
 *
 * 用法：
 *   node tools/gen-recipe-advancements.js           # 只预览（打印会写什么）
 *   node tools/gen-recipe-advancements.js --write   # 真正写盘
 *
 * ⚠ 认不出的配方一律**抛异常**，不静默跳过：跳过的表现是"这条配方永远解锁不了"，
 *   而界面上完全看不出来。新增配方类型时先来这里补一条分支。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NS = 'anglertackle';
const RECIPE_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'recipe');
const OUT_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'advancement/recipes');

/**
 * **不进配方书**的配方（原版机制决定的，不是偷懒）。
 *
 * <p>`anglertackle:rod_assembly` 是 special 配方：JSON 里没有 ingredients，
 * 产出物是**动态的**（取决于放进去的是哪根竿、哪件配件），而且**产出和输入是同一件物品**
 * （鱼竿 + 配件 → 还是那根竿），配方书里画出来就是"鱼竿 → 鱼竿"，没有意义。
 * 原版对 special 配方的处理是 {@code Recipe#isSpecial() == true} →
 * {@code ClientRecipeBook} 直接把它们排除在配方书之外，而且
 * {@code CustomRecipe#getResultItem()} 默认就是 {@code ItemStack.EMPTY}，
 * 硬塞进去也显示不出东西。
 *
 * <p>⚠ 这份名单**只留它一个**。2026-10-03 用户说"内容写进原版配方书"，
 * 于是切块 / 榨油 / 菜配方（一条鱼 × 一道菜）都改成**非 special** 了：
 * 配方类里覆写 {@code isSpecial() → false} + {@code getIngredients()} + {@code getResultItem()}，
 * 解锁材料写进下面的 {@link BOOK_UNLOCK}。
 * `tools/check-recipe-book.js` 会守住"这三件事都在"以及"这张表和 Java 对得上"。
 */
const RECIPE_BOOK_EXEMPT = new Set(['rod_assembly']);

/**
 * **非 special 但 JSON 里没有材料**的配方 → 配方书解锁材料（玩家拿到它就解锁）。
 *
 * <p>为什么要有这张表：配方书只显示"已解锁的配方"，解锁的唯一途径是带
 * `rewards.recipes` 的进度；而进度的判据要么是 `recipe_unlocked`（鸡生蛋），
 * 要么是 `inventory_changed`（手里有了某个材料）—— 后者需要一个物品/标签 id，
 * 这几条配方的 JSON 里偏偏没有材料字段可读。
 *
 * <p>⚠ 菜配方（`<菜型>/<鱼种>`，共 31 条）**不在这张表里**：它们的解锁材料由**名字**推出来
 * —— 就是**那条鱼本身**（钓到草鱼 → 解锁"红烧草鱼"）。规则见 {@link unlockItem}。
 *
 * <p>⚠ 这张表是 Java 的镜像：`CuttingRecipe#getIngredients` /
 * `OilPressingRecipe#getIngredients` 才是真源，两边对不上时
 * `tools/check-recipe-book.js` 会红（它去解析 Java 再逐条比）。
 * 取的是配方书上**第一条**材料（主料），不是全部。
 */
const BOOK_UNLOCK = {
  // 切块：一条整鱼（标签）
  cutting: '#anglertackle:fishes',
  // 榨油：两块生鱼块（普通鱼；多脂鱼 1 块）
  oil_pressing: 'anglertackle:fish_chunk',
};

/**
 * 这条配方**解锁条件**用哪个物品/标签。
 *
 * <p>菜配方的名字就是 `<菜型>/<鱼种>`（`tools/gen-dish-recipes.js` 从 Java 的逐鱼表生成），
 * 所以这里不需要再抄一张 31 行的表：**鱼种 id 就是鱼物品的 id**。
 */
function unlockItem(name, recipe) {
  const dish = /^[a-z_]+\/([a-z_]+)$/.exec(name);
  if (dish) return NS + ':' + dish[1];        // 钓到这条鱼 → 解锁它的那道菜
  if (BOOK_UNLOCK[name] !== undefined) return BOOK_UNLOCK[name];
  return pickIngredient(recipe, name);
}

/** 把材料项归一成进度判据里的 items 值（原版：字符串，标签带 #）。 */
function normalizeIngredient(ing) {
  if (ing === null || typeof ing !== 'object') {
    return null;
  }
  if (Array.isArray(ing)) {
    // 一个槽位的多种可选材料：取第一个
    for (const sub of ing) {
      const v = normalizeIngredient(sub);
      if (v) return v;
    }
    return null;
  }
  if (typeof ing.item === 'string') return ing.item;              // {"item": "minecraft:stick"}
  if (typeof ing.tag === 'string') return '#' + ing.tag;          // {"tag": "minecraft:planks"}
  if (ing.items !== undefined) {                                  // 1.21 的写法 {"items": ...}
    if (typeof ing.items === 'string') return ing.items;
    if (Array.isArray(ing.items)) {
      for (const sub of ing.items) {
        const v = normalizeIngredient(sub);
        if (v) return v;
      }
    }
  }
  return null;
}

/** 从配方里挑一个"代表材料"：玩家拿到它就该解锁这条配方。 */
function pickIngredient(recipe, name) {
  const slots = [];
  if (Array.isArray(recipe.ingredients)) {
    slots.push(...recipe.ingredients);
  }
  // 加热类配方（熔炉/烟熏炉/营火）的材料字段是**单数 ingredient**，
  // 不是工作台那种 ingredients 数组 —— 原版熔炉 JSON 一直是这个形状。
  // ⚠ 少了这一条，`anglertackle:chunk_smelting/smoking/campfire` 这 9 条配方
  //   会让生成器抛异常（表现是构建在"生成配方书进度"那一步红掉）。
  if (recipe.ingredient !== undefined) {
    slots.push(recipe.ingredient);
  }
  if (recipe.key && typeof recipe.key === 'object') {
    slots.push(...Object.values(recipe.key));
  }
  for (const slot of slots) {
    const v = normalizeIngredient(slot);
    if (v) return v;
  }
  throw new Error('配方 ' + name + ' 里找不到可用作解锁判据的材料（type=' + recipe.type +
    '）。如果是 crafting_special_* 这类无材料配方，请在 gen-recipe-advancements.js 里补一条分支。');
}

/** 稳定的 JSON 文本（键顺序固定，便于逐字节比对）。 */
function renderAdvancement(recipeId, ingredient) {
  const doc = {
    parent: 'minecraft:recipes/root',
    criteria: {
      has_ingredient: {
        conditions: { items: [{ items: ingredient }] },
        trigger: 'minecraft:inventory_changed',
      },
      has_the_recipe: {
        conditions: { recipe: recipeId },
        trigger: 'minecraft:recipe_unlocked',
      },
    },
    requirements: [['has_the_recipe', 'has_ingredient']],
    rewards: { recipes: [recipeId] },
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * 生成全部进度：配方名 → 文件内容。
 *
 * <p>导出这个函数是给检查器用的（{@code tools/check-recipe-advancements.js} 要拿它
 * 和磁盘上的内容**逐字节比对**）。检查器必须只读 —— 早先那版检查器直接跑
 * `--write` 再数"改了几个文件"，那样会把漂移**顺手修好**，于是永远报"一致"，
 * 等于没有这条断言。
 */
/** 配方目录是**递归**的：菜配方在 `recipe/<菜型>/<鱼种>.json` 里，名字是 `<菜型>/<鱼种>`。 */
function listRecipes(dir, prefix) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listRecipes(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.json')) out.push({ rel, name: rel.replace(/\.json$/, '') });
  }
  return out;
}

function build() {
  if (!fs.existsSync(RECIPE_DIR)) {
    throw new Error('找不到配方目录：' + RECIPE_DIR);
  }
  const files = listRecipes(RECIPE_DIR, '').sort((a, b) => (a.rel < b.rel ? -1 : 1));
  // ⚠ 排除 recipe/kaleidoscope/**（森罗物语联动的兼容配方，docs/30）：
  //   那些是**他们的**厨具配方类型，压根不进原版配方书，也就不需要解锁进度；
  //   硬给它们写进度只会在配方书里露出一条空白条目。
  const skipped = files.filter((f) => f.rel.startsWith('kaleidoscope' + path.sep) || f.rel.startsWith('kaleidoscope/'));
  const kept = files.filter((f) => !skipped.includes(f));
  // 豁免名单里写了不存在的配方 → 直接报错。不报的话，配方改名/删掉之后
  // 这条豁免会一直躺在那里等着"接住"下一个同名配方。
  const known = new Set(kept.map((f) => f.name));
  for (const n of RECIPE_BOOK_EXEMPT) {
    if (!known.has(n)) {
      throw new Error('配方书豁免名单里的 ' + n + ' 没有对应的配方文件（删了配方就把它一起删掉）');
    }
  }
  // 解锁材料表同理：写了不存在的配方 → 报错，别让一张过期的表一直躺着
  for (const n of Object.keys(BOOK_UNLOCK)) {
    if (!known.has(n)) {
      throw new Error('BOOK_UNLOCK 里的 ' + n + ' 没有对应的配方文件（删了配方就把它一起删掉）');
    }
    if (RECIPE_BOOK_EXEMPT.has(n)) {
      throw new Error(n + ' 同时在 RECIPE_BOOK_EXEMPT 与 BOOK_UNLOCK 里：'
        + 'special 配方进不了配方书，给它写解锁材料没有意义');
    }
  }
  const out = new Map();
  for (const f of kept) {
    if (RECIPE_BOOK_EXEMPT.has(f.name)) {
      continue;   // special 配方：配方书里没有它的位置（见上面那份名单的说明）
    }
    const recipe = JSON.parse(fs.readFileSync(path.join(RECIPE_DIR, f.rel), 'utf8'));
    out.set(f.name, renderAdvancement(NS + ':' + f.name, unlockItem(f.name, recipe)));
  }
  return out;
}

module.exports = { build, RECIPE_DIR, OUT_DIR, NS, RECIPE_BOOK_EXEMPT, BOOK_UNLOCK };

if (require.main === module) {
  const generated = build();
  const write = process.argv.includes('--write');

  if (!write) {
    console.log('=== 预览：将为 ' + generated.size + ' 条配方生成解锁进度 ===');
    for (const [name, text] of generated) {
      const ing = JSON.parse(text).criteria.has_ingredient.conditions.items[0].items;
      console.log('  ' + name.padEnd(34) + ' 材料 ' + ing);
    }
    console.log('\n（预览模式。加 --write 写入）');
  } else {
    // 先清掉不再需要的（删过配方时留下的孤儿进度）
    // ⚠ 递归：菜配方在 advancement/recipes/<菜型>/<鱼种>.json
    for (const f of listRecipes(OUT_DIR, '')) {
      if (!generated.has(f.name)) {
        fs.rmSync(path.join(OUT_DIR, f.rel));
        console.log('删除多余进度 ' + f.rel);
      }
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    let n = 0;
    for (const [name, text] of generated) {
      const file = path.join(OUT_DIR, name + '.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (old === text) continue;
      fs.writeFileSync(file, text);
      n++;
    }
    console.log('写出 ' + n + ' 个进度（共 ' + generated.size + ' 条配方，其余已是最新）');
    console.log('目录：' + path.relative(ROOT, OUT_DIR).replace(/\\/g, '/'));
  }
}
