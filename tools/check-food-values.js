/*
 * check-food-values.js —— 饱食度必须**只跟鱼的档位走**，而且阶梯性质一条都不能破。
 *
 * 用户 2026-10-03 定案（原话）：
 *   "根据鱼品质做饱食度区分，即使同一道菜只要制作的鱼档次不同回复的饱食度就不同。
 *    即使一样的鱼品质不同饱食度回复也不同，根据品质每差一级饱和度与饱食度可以差半格
 *    （需要注意这个"格"的说法可能与数值表不大相似，比如原版是 10 格血的目标在显示中是 20 滴血）。
 *    每个档次再差半格（如优质鱼肉与顶级鱼排），但无论如何加工成的烹饪品
 *    至少比熟鱼块高半格饱食度与饱和度。"
 *
 * 单位：**1 格 = 一个鸡腿图标 = 2 点 nutrition；半格 = 1 点**。
 *
 * 断言：
 *   A. `FoodValues` 的公式：熟块 = 3 + 档位、菜 = 熟块 + 1、`saturationModifier = 0.5`
 *      （0.5 才能让"最终饱和度 = 饱食度"；写成 1.0 就是翻倍，第一版就是这么错的）
 *   B. 阶梯三条性质（逐档复算）：每级差 1 点 / 三段交界处也差 1 点 / 菜恰好比熟块高 1 点
 *   C. 落地路径：菜走 `FoodValues.dish(真实档位)`（不是按"三个材料档次"分桶）、
 *      加热三件套按档位写 FOOD、注册属性只是兜底
 *   D. `docs/27-食物数值表.md` 的每一行都与复算值一致（改了源码不改文档就红）
 *   E. 菜型额外效果仍然**没实现**这件事必须在文档里写着（免得被当成已修）
 *
 * 用法：node tools/check-food-values.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 食物数值表检查（按档位的阶梯 ↔ 源码 ↔ 文档）===\n');

const DOC = 'docs/27-食物数值表.md';
const VALUES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FoodValues.java';
const DISH = 'src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java';
const COOKING = 'src/main/java/com/whitecobalt/anglertackle/recipe/DataCookingRecipe.java';
const ITEMS = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';
const AUDIT = 'src/main/java/com/whitecobalt/anglertackle/debug/RecipeAudit.java';

for (const p of [DOC, VALUES, DISH, COOKING, ITEMS, AUDIT]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}
const doc = read(DOC);
const values = read(VALUES);

// ---------------------------------------------------------------- A 公式
let cookedBase = null, dishDelta = null, modifier = null;
{
  const c = /cookedHunger\(int tier\) \{\s*\n\s*return (\d+) \+ clampTier\(tier\);/.exec(values);
  const d = /dishHunger\(int tier\) \{\s*\n\s*return cookedHunger\(tier\) \+ (\d+);/.exec(values);
  const s = /saturationModifier\(\) \{\s*\n\s*return ([\d.]+)f;/.exec(values);
  if (!c) bad('读不到 FoodValues.cookedHunger 的公式（期待 "3 + clampTier(tier)"）');
  else cookedBase = Number(c[1]);
  if (!d) bad('读不到 FoodValues.dishHunger 的公式（期待 "cookedHunger(tier) + 1"）');
  else dishDelta = Number(d[1]);
  if (!s) bad('读不到 FoodValues.saturationModifier');
  else modifier = Number(s[1]);

  if (cookedBase !== null && dishDelta !== null && modifier !== null) {
    if (cookedBase !== 3) bad('熟块基数不是 3（0 档 = 3 点 = 1.5 格）：' + cookedBase);
    else if (dishDelta !== 1) bad('菜比熟块高的不是"半格"（1 点）：' + dishDelta);
    else if (modifier !== 0.5) {
      bad('saturationModifier 不是 0.5 —— 最终饱和度会变成饱食度的 ' + (modifier * 2)
        + ' 倍（设计要求两者同值）');
    } else ok('公式：熟块 = 3 + 档位、菜 = 熟块 + 1 点（半格）、saturationModifier = 0.5（饱和 = 饱食度）');
  }
}

// ---------------------------------------------------------------- B 阶梯三条性质
const TIERS = [0, 1, 2, 3, 4, 5];
const cooked = (t) => cookedBase + t;
const dish = (t) => cooked(t) + dishDelta;
if (cookedBase !== null && dishDelta !== null && modifier !== null) {
  const sat = (n) => Math.round(n * modifier * 2 * 10) / 10;
  const problems = [];
  for (let i = 1; i < TIERS.length; i++) {
    if (cooked(i) - cooked(i - 1) !== 1) problems.push('熟块 ' + (i - 1) + '→' + i + ' 差 ' + (cooked(i) - cooked(i - 1)) + ' 点（应当 1 点 = 半格）');
    if (dish(i) - dish(i - 1) !== 1) problems.push('菜 ' + (i - 1) + '→' + i + ' 差 ' + (dish(i) - dish(i - 1)) + ' 点（应当 1 点 = 半格）');
  }
  for (const t of TIERS) {
    if (dish(t) - cooked(t) !== 1) problems.push('档 ' + t + '：菜 - 熟块 = ' + (dish(t) - cooked(t)) + ' 点（用户要求至少半格 = 1 点）');
    if (sat(cooked(t)) !== cooked(t)) problems.push('档 ' + t + '：熟块饱和度 ' + sat(cooked(t)) + ' ≠ 饱食度 ' + cooked(t));
    if (sat(dish(t)) !== dish(t)) problems.push('档 ' + t + '：菜饱和度 ' + sat(dish(t)) + ' ≠ 饱食度 ' + dish(t));
  }
  // 三个材料档次的交界：普通(0,1) / 优质(2,3) / 顶级(4,5)
  for (const [a, b] of [[1, 2], [3, 4]]) {
    if (cooked(b) - cooked(a) !== 1) problems.push('材料档次交界 ' + a + '→' + b + ' 差 ' + (cooked(b) - cooked(a)) + ' 点（应当 1 点）');
  }
  if (problems.length) bad('阶梯性质被破坏：\n       ' + problems.join('\n       '));
  else {
    ok('阶梯：熟块 ' + TIERS.map(cooked).join('/') + '，菜 ' + TIERS.map(dish).join('/')
      + '（每级半格；三段交界也差半格；菜 = 熟块 + 半格；饱和 = 饱食度）');
  }
}

// ---------------------------------------------------------------- C 落地路径
{
  const problems = [];
  if (!/foodFor\(m\.data\(\)\.tier\(\)\)/.test(read(DISH))) {
    problems.push('DishRecipe.assemble 没有按**真实档位**写字数（期待 foodFor(m.data().tier())）'
      + ' —— 又退回"按三个材料档次分桶"的话，同档内的半格区分就没了');
  }
  if (!/FoodValues\.dish\(tier\)/.test(read(DISH))) {
    problems.push('DishRecipe.foodFor 没有走 FoodValues.dish(tier)');
  }
  const cooking = read(COOKING);
  if (!/FoodValues\.cooked\(data\.tier\(\)\)/.test(cooking) || !/FoodValues\.dish\(data\.tier\(\)\)/.test(cooking)) {
    problems.push('DataCookingRecipe 没有按档位写熟块/熏鱼/炭烤的 FOOD'
      + '（注册属性给不了"按鱼区分"，必须在这里写）');
  }
  if (!/FoodValues\.cooked\(SAMPLE_CHUNK_TIER/.test(read(ITEMS))) {
    problems.push('熟块的注册兜底值没有跟"默认鱼种档位"对齐（创造模式拿的那块数值会与 tooltip 对不上）');
  }
  if (problems.length) bad('落地路径有问题：\n       ' + problems.join('\n       '));
  else ok('数值路径齐：菜按真实档位、加热三件套按档位写、注册值只作兜底');
}

// ---------------------------------------------------------------- D 文档每一行都要对
if (cookedBase !== null && dishDelta !== null && modifier !== null) {
  const sat = (n) => Math.round(n * modifier * 2 * 10) / 10;
  const rows = [];
  for (const t of TIERS) rows.push(['熟鱼块 ' + t, cooked(t), sat(cooked(t))]);
  for (const t of TIERS) rows.push(['菜 ' + t, dish(t), sat(dish(t))]);
  const docLines = doc.split(/\r?\n/);
  const wrong = [];
  // 文档的两张表：表头带"| 0 白 |"这类行，按出现顺序取两段
  const tableRows = docLines.filter((l) => /^\|\s*\d\s*(白|绿|蓝|紫|金|红)\s*\|/.test(l));
  if (tableRows.length !== 12) {
    bad('docs/27 里的档位行不是 12 行（熟块 6 + 菜 6），实际 ' + tableRows.length + ' 行');
  } else {
    for (let i = 0; i < 12; i++) {
      const t = i % 6;
      const want = i < 6 ? cooked(t) : dish(t);
      const wantSat = String(sat(want).toFixed(1));
      const cells = tableRows[i].split('|').map((s) => s.trim());
      if (!cells[2].startsWith(String(want)) || !cells[3].startsWith(wantSat)) {
        wrong.push((i < 6 ? '熟块' : '菜') + ' 档 ' + t + '：文档写 [' + cells[2] + ' / ' + cells[3]
          + ']，复算是 [' + want + ' / ' + wantSat + ']');
      }
    }
    if (wrong.length) bad('docs/27 与复算值对不上：\n       ' + wrong.join('\n       '));
    else ok('docs/27 的 12 行（熟块 6 档 + 菜 6 档）与复算值逐行一致');
  }
}

// ---------------------------------------------------------------- E 效果系统的状态必须写在文档里
// 这条断言是**双向**的：代码里做到哪一步，docs/27 §5 就必须说哪一句。
// （2026-10-03 第一次跑就抓到了"框架已经落地、文档还写着没实现" —— 这正是它该做的。）
// 1.1.17 起有了**行为**层（effect/DishEffectHooks.java，靠 @SubscribeEvent 干活），
// 于是状态从两态变三态：没做 / 只有框架 / 框架 + 行为都要分开写清。
{
  const javaFiles = require('fs').readdirSync(path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle'), { recursive: true })
    .filter((f) => String(f).endsWith('.java'))
    .map((f) => read(path.join('src/main/java/com/whitecobalt/anglertackle', String(f))))
    .join('\n');
  const hooksPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/effect/DishEffectHooks.java');
  const hasEffects = /addEffect\s*\(/.test(javaFiles);
  // "行为"的判据不是"文件在不在"（空文件也能在），而是**真的挂了事件**：
  // 删掉 DishEffectHooks 里所有 @SubscribeEvent，就等于效果又变回"只有图标"。
  const hasBehaviour = require('fs').existsSync(hooksPath)
    && /@SubscribeEvent/.test(read('src/main/java/com/whitecobalt/anglertackle/effect/DishEffectHooks.java'));
  const saysImpl = /框架已实现|已经注册/.test(doc);
  const saysNotImpl = /还没实现/.test(doc);
  const saysBehaviour = /行为也已实现|行为已实现/.test(doc);
  if (hasEffects && !saysImpl) {
    bad('代码里已经在发效果了（addEffect），docs/27 §5 却还写着"没实现" —— '
      + '偏差被当成未做，别人会重复实现一遍');
  } else if (!hasEffects && !saysNotImpl) {
    bad('代码里一处 addEffect 都没有，docs/27 §5 却写着已实现');
  } else if (hasBehaviour && !saysBehaviour) {
    bad('效果行为已经落地（DishEffectHooks 里有 @SubscribeEvent），docs/27 §5 却没说清'
      + '"行为已实现" —— 状态表与代码脱节');
  } else if (!hasBehaviour && saysBehaviour) {
    bad('docs/27 §5 写着效果"行为已实现"，但 DishEffectHooks 里一个 @SubscribeEvent 都没有');
  } else if (hasEffects && !hasBehaviour && !saysNotImpl) {
    bad('docs/27 §5 说了"框架已实现"，但没写清"各效果的行为还没实现" —— '
      + '这两件事必须分开写，否则玩家/下一个人以为吃了菜就有效果了');
  } else ok('docs/27 §5 与代码一致：框架状态、行为状态都写明了');
}

// ---------------------------------------------------------------- F 体检工具
{
  const src = read(AUDIT);
  if (!/logFoodTable/.test(src) || !/FoodValues\.MAX_TIER/.test(src)) {
    bad('RecipeAudit 没有"六个档位各做一次"的数值表逻辑 —— docs/27 的数字就没有出处了');
  } else if (!/ATL_AUDIT/.test(doc)) {
    bad('docs/27 没写怎么复现（ATL_AUDIT=true gradlew runServer）');
  } else ok('体检会打印六个档位的实际数值（ATL_AUDIT=true gradlew runServer），文档里写了复现方式');
}

console.log('');
if (fail === 0) {
  console.log('✅ 食物数值：按档位、每级半格、菜比熟块高半格，文档与源码一致');
  process.exitCode = 0;
} else {
  console.log('❌ 食物数值检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
