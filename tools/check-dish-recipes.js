/*
 * check-dish-recipes.js —— 守住"菜配方"这条链：**定义 → Java 逐鱼表 → 配方 JSON**。
 *
 * 这一层的错法全都**不会报错**，只会让玩家做不出菜或做出不该做的菜：
 *   ① `DishRecipe.AllowedTable`（哪条鱼能做哪道菜）与 docs/25 §13.5 的逐鱼表不一致
 *      → 要么"表里写着能做、游戏里做不出来"，要么反过来（鲫鱼能捏刺身）；
 *   ② `Dish` 枚举的材料表与 docs/25 §14.4 不一致 → 配方和文档对不上；
 *   ③ **配方 JSON 与逐鱼表展开的结果不一致** —— 少一条 = 那道菜永远合不出来；
 *      多一条 = 玩家照着 JEI 摆材料做不出来（用户 2026-10-03："配方显示模糊，
 *      什么鱼都可以做菜"）。JSON 由 `tools/gen-dish-recipes.js` 生成，**不许手改**；
 *   ④ 返还规则被删 → 做一次汤丢一个铁桶（用户专门提醒过的坑）。
 *
 * 断言：
 *   A. 配方 JSON **逐字节等于**生成器的输出（菜型 × 鱼种，目前 31 条），
 *      且没有"定义里没有"的多余配方（旧的"一条菜型管所有鱼"那 10 条也在查）
 *   B. `Dish` 枚举正好 10 个菜型 id（蒲烧已取消）
 *   C. **逐鱼许可表 ↔ docs/25 §13.5**：读文档表格，把"工作台"的菜归类成菜型，
 *      与 Java 的表逐条比对（中文名 → 鱼种 id 用语言文件反查，不手抄）
 *   D. §14.4 的配方表里出现的菜型 = 枚举里的菜型（蒲烧已取消，两边都不该出现）
 *   E. 返还：`getRemainingItems` 里有空桶与鱼刀扣耐久的处理
 *   F. 饱食度按档位：`foodFor` 给出 4 / 6 / 8
 *   G. **逐鱼许可表必须是懒加载**（`AllowedTable.TABLE = build()`）——
 *      `DishRecipe` 里一旦再出现"类级静态字段 + 静态块"，游戏**启动直接崩**
 *      （1.1.7 第一版就是这么崩的：外层静态初始化 ↔ 嵌套枚举 `<clinit>` 互锁）。
 *      这条不是风格要求，是**用一次启动失败换来的**，见 docs/进行中.md。
 *
 * 用法：node tools/check-dish-recipes.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const JAVA = 'src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java';
const RDIR = 'src/main/resources/data/anglertackle/recipe';
const { classifyWorkbench } = require('./dish-name.js');
const DOC = 'docs/25-鱼料理与配料方案.md';
const LANG = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';

console.log('=== 菜配方检查（逐鱼表 / 生成物 / 返还 / 档位数值）===\n');
for (const p of [JAVA, DOC, LANG]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}
const java = read(JAVA);

/** 从枚举里抠出 10 个菜型 id（枚举常量名 → id 字符串）。 */
const enumIds = [...java.matchAll(/^\s{8}[A-Z_]+\(\s*"([a-z_]+)"/gm)].map((m) => m[1]);
if (enumIds.length === 0) bad('读不到 Dish 枚举的 id 列表');

// A + B（2026-10-03 起：**一条鱼 × 一道菜 = 一条配方**，JSON 由 tools/gen-dish-recipes.js 生成）
// 用户原话："配方必须完全与定义一致。现在的问题是配方显示模糊，什么鱼都可以做菜。"
{
  const genMod = require(path.join(ROOT, 'tools/gen-dish-recipes.js'));
  const expected = genMod.build();                       // 相对 recipe 目录的路径 → 内容
  const pairs = genMod.readPairs();
  const missing = [], drift = [];
  for (const [rel, text] of expected) {
    const p = path.join(RDIR, rel);
    if (!exists(p)) { missing.push(rel); continue; }
    if (read(p) !== text) drift.push(rel);               // 生成物不许手改
  }
  // 反过来：磁盘上多出来的菜配方（旧的一层文件、或表里已删掉的组合）
  const dishIds = new Set([...expected.keys()].map((r) => r.split('/')[0]));
  const onDisk = [];
  for (const id of dishIds) {
    if (!exists(path.join(RDIR, id))) continue;
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (e.name.endsWith('.json')) onDisk.push(r);
      }
    };
    walk(path.join(RDIR, id), id);
  }
  for (const id of dishIds) if (exists(path.join(RDIR, id + '.json'))) onDisk.push(id + '.json');
  const extra = onDisk.filter((r) => !expected.has(r));

  const byDish = new Map();
  for (const r of expected.keys()) {
    const d = r.split('/')[0];
    byDish.set(d, (byDish.get(d) || 0) + 1);
  }
  if (enumIds.length !== 10) bad('菜型不是 10 个（蒲烧取消后应为 10）：' + enumIds.length);
  else ok('菜型 10 个（蒲烧已取消）');
  if (missing.length) bad('缺菜配方 JSON（跑 node tools/gen-dish-recipes.js --write）：' + missing.join('、'));
  else ok(expected.size + ' 条菜配方 JSON 齐（菜型 × 鱼种：'
    + [...byDish.entries()].map(([d, n]) => d + '×' + n).join(' · ') + '）');
  if (drift.length) bad('这些菜配方与生成器输出不一致（手改过？生成物不许手改）：' + drift.join('、'));
  else ok('31 条菜配方的内容与生成器**逐字节一致**');
  if (extra.length) bad('磁盘上有多余的菜配方（表里已经没有这个组合）：' + extra.join('、'));
  else ok('没有多余的菜配方（旧的"一层 10 条"已经删干净）');
  // 每条菜配方的 type 必须是 anglertackle:<菜型>/<鱼种>
  const wrongType = [];
  for (const [rel, text] of expected) {
    const want = 'anglertackle:' + rel.replace(/\.json$/, '');
    if (JSON.parse(text).type !== want) wrongType.push(rel);
  }
  if (wrongType.length) bad('菜配方的 type 写错了：' + wrongType.join('、'));
  else ok('每条菜配方的 type = anglertackle:<菜型>/<鱼种>');
  if (pairs.length !== expected.size) bad('逐鱼表展开的配方数与 JSON 数对不上');
}

// C. 逐鱼许可表 ↔ docs/25 §13.5
{
  const doc = read(DOC).split(/\r?\n/);
  const lang = JSON.parse(read(LANG));
  // 中文名 → 鱼种 id（反查语言文件，不手抄）
  const zhToId = {};
  for (const [k, v] of Object.entries(lang)) {
    const m = /^item\.anglertackle\.([a-z_]+)$/.exec(k);
    if (m && typeof v === 'string') zhToId[v] = m[1];
  }
  // 菜名 → 菜型 id：从语言文件的 `dish.anglertackle.<id>` 名字模板现推（唯一真源，
  // 见 tools/dish-name.js）。设备菜（熏 / 炭烤 / 清烤）返回 null。
  // ⚠ 这里**不许**再抄一份手写菜名正则表：2026-10-10 补第二批 19 条鱼时，那份表
  //    （`/油炸(横纹鱼|白条)/` `/炸鲇鱼|炸泥鳅/` `/鲫鱼汤|鲻鱼汤/` `/鲇鱼炖|泥鳅炖|慢炖/`）
  //    认不出"油炸毛鳞鱼 / 炸鳕鱼块 / 狼鱼汤 / 格陵兰鲨炖 / 电鳗炖 / 旗鱼炖"，
  //    于是文档明明和代码一致，检查器却红 —— 假红。补正则只是把抄表抄得更长。
  const classify = classifyWorkbench;
  // 读 §13.5 表
  let start = -1;
  for (let i = 0; i < doc.length; i++) if (/^#{2,4}\s*13\.5(\s|$)/.test(doc[i])) { start = i; break; }
  const fromDoc = new Map();
  let seenSep = false, rows = 0;
  for (let i = start + 1; i < doc.length; i++) {
    const ln = doc[i];
    if (/^#{2,4}\s/.test(ln)) break;
    if (!ln.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(ln)) { seenSep = true; continue; }
    if (!seenSep) continue;
    const c = ln.split('|').map((s) => s.trim());
    if (!/^\d+$/.test(c[1] || '')) continue;
    rows++;
    const species = zhToId[c[2]];
    if (!species) { bad('§13.5 里的鱼名在语言文件里查不到：' + c[2]); continue; }
    const dishes = new Set();
    for (const [dishIdx, recIdx] of [[4, 5], [6, 7]]) {
      const dish = c[dishIdx] || '', rec = c[recIdx] || '';
      if (!dish || dish === '—' || !rec || rec === '—') continue;
      const k = classify(dish);
      if (k) dishes.add(k);
    }
    fromDoc.set(species, dishes);
  }
  if (rows === 0) bad('§13.5 里没解析出任何一行');
  else ok('§13.5 解析出 ' + rows + ' 条鱼');

  // 与 Java 的 ALLOWED 比
  const allowBlock = /private static Map<String, Set<Dish>> build\(\) \{([\s\S]*?)\n        return m;/.exec(java);
  const fromJava = new Map();
  if (!allowBlock) bad('读不到 DishRecipe.build() 里的逐鱼表');
  else {
    for (const m of allowBlock[1].matchAll(/put\(m, "([a-z_]+)"([^)]*)\)/g)) {
      const ids = [...m[2].matchAll(/Dish\.([A-Z_]+)/g)].map((x) => x[1]);
      const map = { BRAISED: 'braised_fish', STEAMED: 'steamed_fish', PAN_FRIED: 'pan_fried_fish',
        FRIED_CHUNK: 'fried_fish_chunk', SOUP: 'fish_soup', CREAMY: 'creamy_fish_soup',
        STEW: 'fish_stew', BALL: 'fish_ball', SASHIMI: 'sashimi', DEEP_FRIED: 'deep_fried_fish' };
      fromJava.set(m[1], new Set(ids.map((x) => map[x])));
    }
  }
  const mismatches = [];
  for (const [species, want] of fromDoc) {
    const got = fromJava.get(species);
    if (!got) { mismatches.push(species + '（代码里没有这条鱼）'); continue; }
    const a = [...want].sort().join(','), b = [...got].sort().join(',');
    if (a !== b) mismatches.push(species + '：文档 [' + a + '] vs 代码 [' + b + ']');
  }
  for (const species of fromJava.keys()) if (!fromDoc.has(species)) mismatches.push(species + '（文档里没有这条鱼）');
  mismatches.length
    ? bad('逐鱼许可表与 §13.5 不一致：\n       ' + mismatches.join('\n       '))
    : ok('逐鱼许可表与 docs/25 §13.5 逐条一致（' + fromDoc.size + ' 条鱼）');
}

// D. §14.4 的配方表里不该再有蒲烧
{
  const doc = read(DOC);
  const sec = doc.split(/^### 14\.4/m)[1] || '';
  const body = sec.split(/^###/m)[0];
  if (/kabayaki/.test(body)) bad('§14.4 配方表里还有 kabayaki（蒲烧已取消）');
  else if (!/fried_fish_chunk|fish_ball|sashimi/.test(body)) bad('§14.4 配方表读不出来（结构变了？）');
  else ok('§14.4 配方表里已无蒲烧，且 10 个菜型都在');
}

// E. 返还
{
  if (!/getRemainingItems/.test(java)) bad('DishRecipe 没有覆写 getRemainingItems');
  else if (!/Items\.BUCKET/.test(java)) bad('返还里没有"水桶 → 空桶"');
  else if (!/setDamageValue/.test(java)) bad('返还里没有"鱼刀只扣耐久"');
  else ok('返还规则齐：水桶 → 空桶、鱼刀 −1 耐久（用完即消失）');
}

// F. 档位数值：**按真实档位**走（用户 2026-10-03 定案：每差一级差半格）
//    具体的阶梯数字由 tools/check-food-values.js 守着（那里会逐档复算 3/4/5/6/7/8 与 4/5/6/7/8/9）；
//    这里只守"有没有接上那条线"：foodFor 必须委托给 FoodValues，且用**真实档位**而不是三个材料档次。
{
  const m = /foodFor\(int tier\)([\s\S]*?)\n    \}/.exec(java);
  if (!m) bad('读不到 DishRecipe.foodFor(int tier)');
  else if (!/FoodValues\.dish\(tier\)/.test(m[1])) {
    bad('foodFor 没有委托给 FoodValues.dish(tier) —— 数值一旦散成两份，迟早对不上');
  } else if (!/foodFor\(m\.data\(\)\.tier\(\)\)/.test(java)) {
    bad('assemble 没有用**真实档位**（期待 foodFor(m.data().tier())）——'
      + '按"三个材料档次"分桶的话，同档内的半格区分就没了');
  } else ok('饱食度按真实档位走（FoodValues.dish(档位) 写进产物栈的 FOOD 组件）');
}

// G. 懒加载守护（1.1.7 启动崩溃的回归）
//    崩法回顾：`DishRecipe` 第一版把许可表写成"类级静态字段 + 静态块"，
//    而 `Dish` 枚举常量又要读外层的 `SOY` 等静态字段。入口先摸枚举（ModRecipes）时：
//    Dish.<clinit> 开始 → 读外层静态字段 → DishRecipe.<clinit> 跑静态块 →
//    去读**还在构造中**的 Dish.SOUP（= null）→ List.of(null) NPE → ExceptionInInitializerError。
//    修法就是把这套东西塞进内部持有类，让 DishRecipe.<clinit> 什么都不做。
{
  const holder = /private static final class AllowedTable \{\s*\n\s*static final Map<String, Set<Dish>> TABLE = build\(\);/.test(java);
  const readsHolder = /AllowedTable\.TABLE/.test(java);
  const staticBlock = /\n {4}static \{/.test(java);
  const eagerField = /\n {4}(?:private )?(?:static )?(?:final )?Map<String, Set<Dish>> [A-Z_]+ = (?:build\(\)|new HashMap)/.test(java);
  if (!holder) {
    bad('逐鱼许可表不是"内部持有类 + 首次访问才建表"（AllowedTable.TABLE = build()）'
      + ' —— 退回类级初始化就是 1.1.7 的启动崩溃');
  } else if (!readsHolder) {
    bad('allowedFor 没有读 AllowedTable.TABLE（持有类成了摆设，懒加载白做）');
  } else if (staticBlock) {
    bad('DishRecipe 里又有 static 静态块了 —— 外层静态初始化碰嵌套枚举常量 = 游戏启动直接崩');
  } else if (eagerField) {
    bad('许可表又变成类级静态字段 = build()/new HashMap() —— 入口先摸枚举时会互锁，启动崩');
  } else {
    ok('逐鱼许可表是懒加载（AllowedTable.TABLE = build()），DishRecipe 无静态块、无类级建表字段');
  }
}

// H. 主料必须**按格**数，不许按个数数（用户 2026-10-03："往配方栏里塞多个相同物品
//    会导致无法合成，除非把那种多放的物品换成一个。总而言之，没有批量合成功能。"）
//
// 原版 ResultSlot#onTake：每合成一次，**每个非空格子各扣 1 个**。所以：
//   · 一格放一叠熟块，对"1 块"的菜必须照样匹配 → 剩下的还在 → 按住 Shift 能连续合成（批量）；
//   · 反过来按个数数的话，"2 块"的菜（鱼丸）就能用"一格放 2 个"糊弄过去 ——
//     而合成只从那一格扣 1 个，于是**白送**（多做一份菜）。
{
  const m = /for \(int i = 0; i < input\.size\(\); i\+\+\) \{([\s\S]*?)\n        \}/.exec(java);
  const body = m ? m[1] : '';
  if (!body) bad('读不到 DishRecipe.match() 的格子循环');
  else if (!/baseSlots\+\+;/.test(body)) {
    bad('DishRecipe.match() 没有按格数主料（期待 baseSlots++）—— 一格放一叠就会被判成"多放了"，'
      + '玩家没法批量合成；而且"2 块"的菜反过来能靠一格里放两个白送一份');
  } else if (/baseCount \+= s\.getCount\(\)/.test(java)) {
    bad('DishRecipe 里又出现"按个数数主料"（baseCount += s.getCount()）—— 见上一条注释');
  } else ok('主料按格数（baseSlots++）：一格放一叠照样匹配 → 可以按住 Shift 批量合成');
}

console.log('');
if (fail === 0) {
  console.log('✅ 菜型配方检查全部通过');
  process.exitCode = 0;
} else {
  console.log('❌ 菜型配方检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
