/*
 * check-cutting.js —— 守住"切块"这条配方的两条映射与公式（docs/25 §2.1 / §2.3）。
 *
 * 为什么需要它：切块是整条烹饪链的**入口**，它的错法全都不会报错、只会让玩家吃亏：
 *   ① 档位映射写反（白绿鱼切出顶级鱼排）→ 便宜鱼直接变最贵材料；
 *   ② 份数公式的上下限丢了 → 一条 0.1kg 的小鱼出 0 块（白干）或一条巨物出 200 块；
 *   ③ 配方 JSON 的 type 写成别的 / 序列化器 id 对不上 → **合不出来，且没有任何报错**；
 *   ④ 忘了给它在 gen-recipe-advancements 的 `BOOK_UNLOCK` 里写解锁材料 →
 *      生成器直接抛异常（切块 JSON 里没有 ingredients，生成器读不到材料）。
 *
 * 断言：
 *   A. `CuttingRecipe.chunkCount()` 的公式：保底 1、上限 12、三档"每块重量"0.25/1/3
 *      —— 用源码里的常量复算一串边界值（0.05 / 0.25 / 1 / 12 / 100 kg）
 *   B. 档位映射：白绿(0,1)→普通、蓝紫(2,3)→优质、金红(4,5)→顶级，且**只在
 *      FishChunkData.groupOfTier 里定义一套**（CuttingRecipe 不许再写一套 if）
 *   C. 配方 JSON：`data/anglertackle/recipe/cutting.json` 存在且 type = anglertackle:cutting
 *   D. 序列化器注册：ModRecipes 里 register("cutting") 且用 SimpleCraftingRecipeSerializer
 *   E. 配方书：`tools/gen-recipe-advancements.js` 的豁免名单里**不该**有 'cutting'，
 *      且 `BOOK_UNLOCK` 里有它的解锁材料（用户 2026-10-03："内容写进原版配方书"；详见 check-recipe-book.js）
 *   F. 返还：CuttingRecipe 覆写了 getRemainingItems（原版只对容器自动返还）
 *
 * 用法：node tools/check-cutting.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const RECIPE = 'src/main/java/com/whitecobalt/anglertackle/recipe/CuttingRecipe.java';
const CHUNK_DATA = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishChunkData.java';
const MOD_RECIPES = 'src/main/java/com/whitecobalt/anglertackle/registry/ModRecipes.java';
const RECIPE_JSON = 'src/main/resources/data/anglertackle/recipe/cutting.json';
const GEN = 'tools/gen-recipe-advancements.js';

console.log('=== 切块配方检查（整鱼 → 三档鱼块）===\n');
for (const p of [RECIPE, CHUNK_DATA, MOD_RECIPES, RECIPE_JSON, GEN]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}

const recipeSrc = read(RECIPE);
const chunkSrc = read(CHUNK_DATA);

// A. 份数公式：从源码里读常量再复算，避免检查器自己抄一遍公式
{
  const per = [...recipeSrc.matchAll(/KG_PER_CHUNK\s*=\s*\{([^}]*)\}/g)][0];
  const min = /MIN_CHUNKS\s*=\s*(\d+)/.exec(recipeSrc);
  const max = /MAX_CHUNKS\s*=\s*(\d+)/.exec(recipeSrc);
  if (!per || !min || !max) bad('读不到 KG_PER_CHUNK / MIN_CHUNKS / MAX_CHUNKS');
  else {
    const kg = per[1].split(',').map((s) => Number(s.trim().replace(/f$/, '')));
    const lo = Number(min[1]), hi = Number(max[1]);
    const want = [[0.25, 1, 3], 1, 12];
    if (JSON.stringify(kg) !== JSON.stringify(want[0])) bad('每块重量不是 0.25/1/3：' + kg.join('/'));
    else if (lo !== want[1] || hi !== want[2]) bad('份数上下限不是 1/12：' + lo + '/' + hi);
    else {
      // 复算：与 Java 的 Math.round(重量/每块) 再 clamp 一致
      const calc = (w, g) => Math.max(lo, Math.min(hi, Math.round(w / kg[g])));
      const cases = [[0.05, 0, 1], [0.25, 0, 1], [1, 0, 4], [3, 0, 12], [100, 0, 12],
        [1, 1, 1], [3, 2, 1], [30, 2, 10]];
      const wrong = cases.filter(([w, g, expect]) => calc(w, g) !== expect);
      if (wrong.length) {
        bad('份数复算与预期不符：' + wrong.map(([w, g, e]) => w + 'kg/档' + g + ' 期望' + e + ' 实得' + calc(w, g)).join('、'));
      } else {
        ok('份数公式：保底 ' + lo + '、上限 ' + hi + '、每块 ' + kg.join('/') + ' kg（8 组边界值复算一致）');
      }
    }
  }
}

// B. 档位映射只有一套，且边界正确
{
  const m = /groupOfTier\(int tier\)\s*\{([\s\S]*?)\n    \}/.exec(chunkSrc);
  if (!m) bad('FishChunkData.groupOfTier 读不到');
  else {
    const body = m[1];
    const okCommon = /tier\s*<=\s*1/.test(body) && /GROUP_COMMON/.test(body);
    const okFine = /tier\s*<=\s*3/.test(body) && /GROUP_FINE/.test(body);
    const okSupreme = /GROUP_SUPREME/.test(body);
    if (!(okCommon && okFine && okSupreme)) bad('档位映射的边界不对（应为 ≤1 普通 / ≤3 优质 / 其余顶级）');
    else ok('档位映射：白绿(0,1)→普通 · 蓝紫(2,3)→优质 · 金红(4,5)→顶级');
  }
  // CuttingRecipe 不许自己再写一套映射
  if (/tier\s*<=\s*1|tier\s*<\s*2/.test(recipeSrc)) bad('CuttingRecipe 里又写了一套档位判断（应只调 groupOfTier）');
  else ok('档位映射只有一套（CuttingRecipe 调 FishChunkData.groupOfTier）');
}

// C. 配方 JSON
{
  const json = JSON.parse(read(RECIPE_JSON));
  if (json.type !== 'anglertackle:cutting') bad('配方 JSON 的 type 不是 anglertackle:cutting：' + json.type);
  else ok('配方 JSON：' + RECIPE_JSON + '（type = anglertackle:cutting）');
}

// D. 序列化器注册
{
  const src = read(MOD_RECIPES);
  if (!/SERIALIZERS\.register\("cutting"/.test(src)) bad('ModRecipes 里没有 register("cutting")');
  else if (!/SimpleCraftingRecipeSerializer/.test(src)) bad('cutting 没用 SimpleCraftingRecipeSerializer');
  else ok('序列化器已注册（"cutting" + SimpleCraftingRecipeSerializer）');
}

// E. 配方书：切块**必须能进配方书**（用户 2026-10-03："内容写进原版配方书"）
//    ⚠ 这条断言 2026-10-03 反过来了：原来断言"cutting 在 RECIPE_BOOK_EXEMPT 里"
//      （那时它是 special 配方，原版 ClientRecipeBook 直接跳过）。用户要求进配方书之后，
//      正确的期望是"**不在**豁免名单里、且在 BOOK_UNLOCK 里有解锁材料"。
//      以后谁把它改回 special，这里和 tools/check-recipe-book.js 都会红。
{
  const src = read(GEN);
  const m = /RECIPE_BOOK_EXEMPT\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src);
  const u = /const BOOK_UNLOCK = \{([\s\S]*?)\n\};/.exec(src);
  if (!m) bad('读不到 RECIPE_BOOK_EXEMPT');
  else if (/'cutting'/.test(m[1])) {
    bad("cutting 又被塞回 RECIPE_BOOK_EXEMPT —— 豁免 = 配方书里永远看不到（用户要求进配方书）");
  } else if (!u || !/\bcutting:\s*'#[a-z_]+:[a-z_]+'/.test(u[1])) {
    bad("BOOK_UNLOCK 里没有 cutting 的解锁材料（整鱼标签）—— 玩家永远解锁不了这条配方");
  } else ok('切块在配方书里：不在豁免名单、BOOK_UNLOCK 用整鱼标签解锁');
}

// F. 返还
// ⚠ 只判子串会被"改名成 getRemainingItems_unused"骗过去（负例 cut-no-remaining 抓到的假绿）——
//   这里要求是真覆写：返回类型 + getRemainingItems + 紧跟左括号。
if (!/public\s+NonNullList<ItemStack>\s+getRemainingItems\s*\(\s*CraftingInput/.test(recipeSrc)) {
    bad('CuttingRecipe 没有覆写 getRemainingItems（必须是 public NonNullList<ItemStack> getRemainingItems(CraftingInput ...)）');
}
else ok('覆写了 getRemainingItems（显式返回全空，留给以后加鱼刀那类材料）');

console.log('');
if (fail === 0) {
  console.log('✅ 切块配方检查全部通过');
  process.exitCode = 0;
} else {
  console.log('❌ 切块配方检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
