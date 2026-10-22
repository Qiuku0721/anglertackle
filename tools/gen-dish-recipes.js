/*
 * gen-dish-recipes.js —— 把 §13.5 那张逐鱼表**展开成配方 JSON**（一条鱼 × 一道菜 = 一条配方）。
 *
 * ── 为什么要有它（用户 2026-10-03）─────────────────────────────────
 * 原话："**配方必须完全与定义一致。现在出现的问题是配方显示模糊，什么鱼都可以做菜。**"
 *
 * 原来 10 条"菜型"配方（`braised_fish.json` 一条管所有能做红烧的鱼）在 JEI / 配方书里
 * 显示成"红烧鱼 ← 熟块 + 酱油 + 糖"，看上去**哪条鱼都能做**；而真实规则是
 * `DishRecipe.AllowedTable`（= docs/25 §13.5 逐鱼表）**按鱼种**匹配。
 * 于是玩家照着 JEI 摆材料，做不出来，还不知道为什么。
 *
 * 现在：`DishRecipe.allowedPairs()` 把那张表展开成 44 对（菜型 × 鱼种），
 * 本脚本把它们写成 44 个 JSON（`recipe/<菜型>/<鱼种>.json`），
 * 配方书 / JEI 里显示的就是"**红烧草鱼** ← 它的那块熟块 + 酱油 + 糖"。
 *
 * ⚠ 单一真源是 **Java 的逐鱼表**（它自己又被 `check-dish-recipes.js` 与 docs/25 §13.5 对账），
 *   所以这条链是：docs/25 §13.5 →（检查器）→ Java 表 →（本生成器）→ 44 个 JSON。
 *   生成物**不许手改**：`check-dish-recipes.js` 会逐字节比对。
 *
 * 用法：
 *   node tools/gen-dish-recipes.js           # 预览
 *   node tools/gen-dish-recipes.js --write   # 写盘（并删掉不再需要的旧配方）
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const NS = 'anglertackle';
const JAVA = 'src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java';
const RECIPE_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'recipe');

/** 读 Java 的逐鱼表，返回 `[{ dish, species }]`（顺序与 DishRecipe.allowedPairs() 一致）。 */
function readPairs() {
  const src = fs.readFileSync(path.join(ROOT, JAVA), 'utf8');
  // Dish 枚举的 id（顺序 = 枚举顺序）
  const dishIds = [...src.matchAll(/^\s{8}[A-Z_]+\(\s*"([a-z_]+)"/gm)].map((m) => m[1]);
  if (dishIds.length === 0) throw new Error('读不到 Dish 枚举的 id');
  // put(m, "species", Dish.A, Dish.B);
  const byFish = new Map();
  for (const m of src.matchAll(/put\(m, "([a-z_]+)"([^)]*)\)/g)) {
    byFish.set(m[1], [...m[2].matchAll(/Dish\.([A-Z_]+)/g)].map((x) => x[1]));
  }
  if (byFish.size === 0) throw new Error('读不到逐鱼许可表（put(m, ...)）');
  const nameOf = {};
  for (const m of src.matchAll(/^\s{8}([A-Z_]+)\(\s*"([a-z_]+)"/gm)) nameOf[m[1]] = m[2];

  const pairs = [];
  for (const dishId of dishIds) {                       // 先菜型、后鱼种（与 Java 同序）
    const constName = Object.keys(nameOf).find((k) => nameOf[k] === dishId);
    const species = [...byFish.keys()].sort();
    for (const sp of species) {
      if (byFish.get(sp).includes(constName)) pairs.push({ dish: dishId, species: sp });
    }
  }
  if (pairs.length === 0) throw new Error('逐鱼表展开后一条配方都没有');
  return pairs;
}

/** 相对 recipe 目录的路径 → 文件内容。 */
function build() {
  const out = new Map();
  for (const { dish, species } of readPairs()) {
    const doc = { type: NS + ':' + dish + '/' + species, category: 'misc' };
    out.set(dish + '/' + species + '.json', JSON.stringify(doc, null, 2) + '\n');
  }
  return out;
}

/** 磁盘上所有"菜配方"（旧的一层文件 + 新的目录），用于找多余/过期的。 */
function dishFilesOnDisk() {
  const found = [];
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.name.endsWith('.json')) found.push(r);
    }
  };
  walk(RECIPE_DIR, '');
  return found;
}

module.exports = { build, readPairs, RECIPE_DIR, NS, JAVA, dishFilesOnDisk };

if (require.main === module) {
  const generated = build();
  const write = process.argv.includes('--write');
  console.log('=== 菜配方：' + generated.size + ' 条（菜型 × 鱼种，来自 DishRecipe 的逐鱼表）===');
  const byDish = new Map();
  for (const rel of generated.keys()) {
    const dish = rel.split('/')[0];
    byDish.set(dish, (byDish.get(dish) || 0) + 1);
  }
  for (const [dish, n] of byDish) console.log('  ' + dish.padEnd(20) + n + ' 条');
  if (!write) {
    console.log('\n（预览模式。加 --write 写入）');
  } else {
    // 删掉不再需要的：旧的 `recipe/<菜型>.json`、以及表里已经没有的组合
    let removed = 0;
    const dishIds = new Set([...generated.keys()].map((r) => r.split('/')[0]));
    for (const rel of dishFilesOnDisk()) {
      const top = rel.split('/')[0];
      const isDishFile = generated.has(rel)
        || (rel.split('/').length === 1 && dishIds.has(rel.replace(/\.json$/, '')));
      if (isDishFile && !generated.has(rel)) {
        fs.rmSync(path.join(RECIPE_DIR, rel));
        console.log('  删除多余配方 ' + rel);
        removed++;
      }
    }
    let n = 0;
    for (const [rel, text] of generated) {
      const file = path.join(RECIPE_DIR, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (old === text) continue;
      fs.writeFileSync(file, text);
      n++;
    }
    console.log('\n写出 ' + n + ' 个文件，删除 ' + removed + ' 个，共 ' + generated.size + ' 条');
  }
}
