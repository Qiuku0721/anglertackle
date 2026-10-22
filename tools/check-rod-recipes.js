/*
 * check-rod-recipes.js —— 守住"只有木路亚竿有合成配方"这条用户定案。
 *
 * 用户 2026-10-01 原话：
 *   「3木棍2线1鳕鱼或鲑鱼或河豚或小丑鱼，合成木路亚。其他等级杆子不需要加配方。」
 *
 * 三件事容易在以后被无声破坏，所以都写成断言：
 *
 *   A. **配料必须全是原版物品**。这条配方存在的唯一意义是"还没有任何本模组物品时
 *      也能合出来"：原版钓竿钓到鳕鱼/鲑鱼/河豚/小丑鱼 → 合出木路亚竿。
 *      一旦有人把鱼改成模组鱼、或把线改成模组鱼线（那要先有鱼币去渔具铺买），
 *      配方就变成死循环，而 JSON 照样合法、游戏里照样不报错。
 *   B. **只有木路亚竿有配方**。其余竿子（木台钓/铁/金/钻/下界合金）都不该有 ——
 *      多一条就是"别的等级偷偷有了配方"，与用户口径不符。
 *   C. **手册不能和游戏打架**。手册原本写着"本版本还没有合成配方"，
 *      加了这条配方以后那句话就成了假话；这里要求"有配方的竿，手册里必须提到它"。
 *
 * 用法：node tools/check-rod-recipes.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RECIPE_DIR = 'src/main/resources/data/anglertackle/recipe';
const GUIDE = 'src/main/resources/data/anglertackle/guide/guide.json';
const LANG = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 钓竿配方检查 ===\n');

// 配料的口径：原版四种生鱼（**不含熟鱼** —— 用户点名的是"鳕鱼或鲑鱼或河豚或小丑鱼"）
const FISH = ['minecraft:cod', 'minecraft:salmon', 'minecraft:pufferfish', 'minecraft:tropical_fish'];
const WANT_STICK = 3;
const WANT_STRING = 2;

// ---------------------------------------------------------------- 收集所有配方产物
const dir = path.join(ROOT, RECIPE_DIR);
if (!fs.existsSync(dir)) {
  fail('没有 ' + RECIPE_DIR + ' 目录');
  process.exit(1);
}
if (fs.existsSync(path.join(ROOT, 'src/main/resources/data/anglertackle/recipes'))) {
  fail('配方放进了 recipes/（1.21.1 是**单数** recipe/）—— 游戏里会静默合不出来');
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
// 产物 id → 产出它的配方文件**列表**。
// ⚠ 一个产物对应多条配方是**合法的**：追踪罗盘就故意有两条（吃原版鱼 / 吃模组鱼，
//   check-tracking-compass.js 在守）。所以这里收集成列表，别写成"重复就是错"——
//   第一版就是那么写的，然后对着罗盘误报了一条。
const outputs = new Map();
for (const f of files) {
  let j;
  try {
    j = JSON.parse(read(RECIPE_DIR + '/' + f));
  } catch (e) {
    fail(f + ' 不是合法 JSON：' + e.message);
    continue;
  }
  const id = j.result && j.result.id;
  if (!id) continue;
  if (!outputs.has(id)) outputs.set(id, []);
  outputs.get(id).push(f);
}

// ---------------------------------------------------------------- A 木路亚竿的配料
{
  const rel = 'wood_lure_rod.json';
  if (!outputs.has('anglertackle:wood_lure_rod')) {
    fail('缺少木路亚竿的配方（' + RECIPE_DIR + '/' + rel + '）');
  } else {
    const j = JSON.parse(read(RECIPE_DIR + '/' + rel));
    let n = 0;
    if (j.type !== 'minecraft:crafting_shapeless') { fail('配方类型不是 crafting_shapeless：' + j.type); n++; }
    if (j.result.id !== 'anglertackle:wood_lure_rod' || j.result.count !== 1) {
      fail('产物不是 1 个 wood_lure_rod：' + JSON.stringify(j.result)); n++;
    }
    const ing = (j.ingredients || []).flat();
    const items = ing.filter((x) => x.item).map((x) => x.item);
    const tags = ing.filter((x) => x.tag).map((x) => x.tag);
    const sticks = items.filter((x) => x === 'minecraft:stick').length;
    const strings = items.filter((x) => x === 'minecraft:string').length;
    if (sticks !== WANT_STICK) { fail('木棍数量是 ' + sticks + '，用户口径是 ' + WANT_STICK); n++; }
    if (strings !== WANT_STRING) { fail('线（minecraft:string）数量是 ' + strings + '，用户口径是 ' + WANT_STRING); n++; }
    if (tags.length) { fail('配料里出现了标签 ' + tags.join(', ') + ' —— 应该逐项写清（见本文件顶部 A）'); n++; }

    // 鱼那一格：必须正好是四种原版生鱼
    const groups = (j.ingredients || []).filter(Array.isArray);
    if (groups.length !== 1) {
      fail('"任意一种鱼"那一格的写法不对：期望 1 个候选数组，实际 ' + groups.length + ' 个');
      n++;
    } else {
      const got = groups[0].map((x) => x.item).sort();
      if (JSON.stringify(got) !== JSON.stringify([...FISH].sort())) {
        fail('鱼的候选是 ' + got.join('/') + '，期望 ' + FISH.join('/') +
          '（不要熟鱼、不要模组鱼）');
        n++;
      }
    }
    // 配料里不该出现任何模组物品（那是死循环：要有鱼币先买模组物品）
    const modItems = items.filter((x) => x.startsWith('anglertackle:'));
    if (modItems.length) {
      fail('配料里出现了本模组物品 ' + modItems.join(', ') +
        ' —— 这条配方必须能在"还没有任何本模组物品"时合出来（原版钓竿钓原版鱼）');
      n++;
    }
    if (n === 0) {
      ok('木路亚竿：3 木棍 + 2 线(minecraft:string) + 1 任意原版生鱼（鳕/鲑/河豚/小丑），产物 1');
    }
  }
}

// ---------------------------------------------------------------- B 其余竿子不许有配方
{
  const rods = [...outputs.keys()].filter((id) => /_rod$/.test(id) && id !== 'anglertackle:wood_lure_rod');
  if (rods.length) {
    fail('这些竿子也有配方，但用户明确说"其他等级杆子不需要加配方"：' +
      rods.map((r) => r + '（' + outputs.get(r).join(' / ') + '）').join(', '));
  } else {
    ok('除木路亚竿外没有任何竿子有配方（台钓/铁/金/钻/下界合金都不加）');
  }
  // 顺带：木台钓竿也不该有（用户只点了木路亚）
  if (outputs.has('anglertackle:wood_float_rod')) {
    fail('木台钓竿也有配方 —— 用户只要求木路亚竿有');
  } else {
    ok('木台钓竿没有配方（用户只点了木路亚竿）');
  }
  // 木路亚竿自己有且只有一条
  const own = outputs.get('anglertackle:wood_lure_rod') || [];
  if (own.length > 1) fail('木路亚竿有 ' + own.length + ' 条配方（' + own.join(' / ') + '），只该有一条');
}

// ---------------------------------------------------------------- C 手册不许和游戏打架
{
  const guide = read(GUIDE);
  const zh = JSON.parse(read(LANG));
  // 每个"有配方的竿"都必须能在手册里找到它的中文名
  for (const id of outputs.keys()) {
    if (!/_rod$/.test(id)) continue;
    const name = zh['item.' + id.replace('anglertackle:', 'anglertackle.')];
    if (!name) { fail('语言文件里没有 ' + id + ' 的中文名，查不了手册'); continue; }
    if (guide.includes(name)) {
      ok('手册里提到了有配方的竿：' + name);
    } else {
      fail('手册（guide.json）里没有提到 ' + name + ' —— 玩家会不知道它能合成');
    }
  }
  if (/还没有合成配方|都没有合成配方|连鱼竿和配件都还没有/.test(guide)) {
    fail('手册里还留着"还没有合成配方"这类说法 —— 木路亚竿已经有配方了，手册和游戏打架');
  } else {
    ok('手册里没有"还没有合成配方"这类过时说法');
  }
}

console.log('');
console.log(bad === 0 ? '✅ 钓竿配方符合用户口径（只有木路亚竿、配料全是原版物品）' : '❌ 钓竿配方检查未通过（' + bad + ' 项）');
process.exitCode = bad === 0 ? 0 : 1;
