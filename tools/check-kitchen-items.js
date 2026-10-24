/*
 * check-kitchen-items.js —— 守住"料理线上参与配方的物品"这几条硬约束。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * 这 5 件东西（盐 / 酱油 / 芥末 / 鱼油 / 鱼刀）是新玩法线的**入口材料**，
 * 它们的错误方式全都**不会报错、只会让玩家吃亏**：
 *   ① 鱼刀配方改了（用户 2026-10-03 逐字指定："一铁锭一任意木头按钮加一木棍"）；
 *   ② 盐的配方里**没有水桶** —— 水桶是 player 的 3 个铁锭，丢了没人发现；
 *   ③ 调料的 tooltip 语言键漏了 —— 游戏里显示的是一串 `tooltip.anglertackle.salt`；
 *   ④ 图标被某个生成器覆盖（本仓库**真出过**：21 张手绘鱼图标被渲染图顶掉，
 *      而且当时守护脚本还把顶掉的图当成了新基线，检查器一路绿）；
 *   ⑤ 文档里的耐久写着 64、代码里改成 32（"文档抄代码"的经典漂移）。
 *
 * 所以这里逐条比：源码 ↔ 配方 JSON ↔ 语言文件 ↔ 图标指纹表 ↔ 策划文档。
 *
 * 断言：
 *   A. 5 件都注册了，且"注册 / 上架 / 语言键 / 贴图 / 模型"五样齐全
 *   B. 鱼刀配方**逐项**等于 铁锭 + #minecraft:wooden_buttons + 木棍（与顺序无关）
 *   C. 盐配方里必须有 `minecraft:water_bucket`（返还空桶靠原版 craftingRemainingItem，
 *      不是我们写的代码 —— 所以"配方里有没有水桶"就是这条规则唯一的落点）
 *   D. 芥末的配方要用**本模组的盐**（盐 → 芥末的加工链）
 *   E. 所有配方的材料都必须是"原版命名空间"或"本模组确实注册过的物品/标签"
 *   F. 鱼刀耐久：代码常量 == ModItems 里写进属性的值 == docs/25 §14.6.3 表里的值
 *   G. 5 张贴图都在 参考资料/图标指纹.json 里（没进指纹表 = 被生成器覆盖也没人知道）
 *
 * 用法：node tools/check-kitchen-items.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

/** 料理线上参与配方的物品（id 顺序 = 创造页签里的顺序）。 */
const KITCHEN = ['fish_knife', 'salt', 'soy_sauce', 'mustard', 'fish_oil'];
/** 其中是"可堆叠消耗品"的（鱼刀不是：有耐久）。 */
const STACKABLE = ['salt', 'soy_sauce', 'mustard', 'fish_oil'];
/** 必须画了贴图的（全部）。 */
const RECIPES = ['fish_knife', 'salt', 'soy_sauce', 'mustard'];

const ITEMS_JAVA = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';
const KNIFE_JAVA = 'src/main/java/com/whitecobalt/anglertackle/item/FishKnifeItem.java';
const SEASON_JAVA = 'src/main/java/com/whitecobalt/anglertackle/item/SeasoningItem.java';
const FINGERPRINTS = '参考资料/图标指纹.json';
const DOC = 'docs/25-鱼料理与配料方案.md';

console.log('=== 料理物品（调料 / 工具 / 油）检查 ===\n');

// ---------------------------------------------------------------- A. 五样齐全
const itemsSrc = exists(ITEMS_JAVA) ? read(ITEMS_JAVA) : '';
if (!itemsSrc) { bad('缺 ' + ITEMS_JAVA); }

/** 本模组注册的全部物品 id（顺便给断言 E 当白名单用）。 */
const registered = new Set();
{
  let m;
  const re = /ITEMS\.register\("([a-z_]+)"/g;
  while ((m = re.exec(itemsSrc)) !== null) registered.add(m[1]);
}

const missingReg = KITCHEN.filter((id) => !registered.has(id));
if (missingReg.length) bad('没注册的物品：' + missingReg.join(', '));
else ok('5 件都已注册（' + KITCHEN.join(' / ') + '）');

// 创造页签：常量名 → id，再看有没有 output.accept
{
  const nameToId = {};
  let m;
  const re = /DeferredItem<[^>]+>\s+(\w+)\s*=\s*ITEMS\.register\("([a-z_]+)"/g;
  while ((m = re.exec(itemsSrc)) !== null) nameToId[m[1]] = m[2];
  const accepted = new Set();
  const re2 = /output\.accept\((\w+)\.get\(\)\)/g;
  while ((m = re2.exec(itemsSrc)) !== null) if (nameToId[m[1]]) accepted.add(nameToId[m[1]]);
  const miss = KITCHEN.filter((id) => !accepted.has(id));
  if (miss.length) bad('注册了但没进创造页签（游戏里拿不到）：' + miss.join(', '));
  else ok('5 件都在创造页签里（「料理」页签）');
  if (!/TABS\.register\("cooking"/.test(itemsSrc)) {
    bad('没有「料理」创造页签（TABS.register("cooking")）');
  } else {
    ok('「料理」创造页签存在');
  }
}

// 贴图 / 模型 / 语言键
{
  const noTex = [], noMod = [], noZh = [], noEn = [];
  const zh = exists('src/main/resources/assets/anglertackle/lang/zh_cn.json')
    ? JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json')) : {};
  const en = exists('src/main/resources/assets/anglertackle/lang/en_us.json')
    ? JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json')) : {};
  for (const id of KITCHEN) {
    if (!exists('src/main/resources/assets/anglertackle/textures/item/' + id + '.png')) noTex.push(id);
    if (!exists('src/main/resources/assets/anglertackle/models/item/' + id + '.json')) noMod.push(id);
    if (!('item.anglertackle.' + id in zh)) noZh.push(id);
    if (!('item.anglertackle.' + id in en)) noEn.push(id);
  }
  noTex.length ? bad('缺贴图：' + noTex.join(', ')) : ok('5 张贴图齐全（tools/gen-kitchen-icons.js 可复现）');
  noMod.length ? bad('缺模型：' + noMod.join(', ')) : ok('5 个模型齐全');
  (noZh.length || noEn.length)
    ? bad('缺名字语言键：中 ' + (noZh.join(', ') || '无') + ' / 英 ' + (noEn.join(', ') || '无'))
    : ok('中英名字齐全');

  // tooltip 键：SeasoningItem 读 tooltip.anglertackle.<id>，FishKnifeItem 读
  // tooltip.anglertackle.fish_knife (+ _durability)。缺了游戏里显示的就是键名本身。
  const seasonIds = STACKABLE;
  const missingTip = [];
  for (const id of seasonIds) {
    for (const [lang, table] of [['中', zh], ['英', en]]) {
      if (!('tooltip.anglertackle.' + id in table)) missingTip.push(id + '(' + lang + ')');
    }
  }
  for (const [lang, table] of [['中', zh], ['英', en]]) {
    for (const k of ['fish_knife', 'fish_knife_durability']) {
      if (!('tooltip.anglertackle.' + k in table)) missingTip.push(k + '(' + lang + ')');
    }
  }
  missingTip.length
    ? bad('缺 tooltip 语言键（游戏里会显示成一串键名）：' + missingTip.join(', '))
    : ok('tooltip 语言键齐全（中英各 ' + (seasonIds.length + 2) + ' 条）');

  // tooltip 键的**拼法**也要守住：SeasoningItem 必须是 "tooltip.anglertackle." + id，
  // 上面那些断言才知道该去语言文件里找哪个键。
  const seasonSrc = exists(SEASON_JAVA) ? read(SEASON_JAVA) : '';
  if (!seasonSrc.includes('"tooltip.anglertackle." + id')) {
    bad('SeasoningItem 不是按 "tooltip.anglertackle." + id 拼键（上面那几行就白守了）');
  } else {
    ok('SeasoningItem 的 tooltip 键拼法正确（tooltip.anglertackle.<id>）');
  }
}

// ---------------------------------------------------------------- 配方
/** 读一条配方；顺便把材料归一成 "item:xxx" / "tag:xxx" 的字符串数组。 */
function loadRecipe(id) {
  const p = 'src/main/resources/data/anglertackle/recipe/' + id + '.json';
  if (!exists(p)) return null;
  const json = JSON.parse(read(p));
  // 26.1.2 的配方材料改成新语法：普通物品写字符串，标签写 "#namespace:path"，
  // "任选其一"写嵌套数组（这里 flat 掉）。旧的 {"item":…} / {"tag":…} 对象也照样认。
  const ingredients = (json.ingredients || []).flat().map((ing) => {
    if (typeof ing === 'string') return ing.startsWith('#') ? 'tag:' + ing.slice(1) : 'item:' + ing;
    if (ing.item) return 'item:' + ing.item;
    if (ing.tag) return 'tag:' + ing.tag;
    return '???:' + JSON.stringify(ing);
  });
  return { json, ingredients };
}

const wanted = {
  fish_knife: ['item:minecraft:iron_ingot', 'item:minecraft:stick', 'tag:minecraft:wooden_buttons'],
  salt: ['item:minecraft:water_bucket', 'item:minecraft:dried_kelp'],
  soy_sauce: ['item:minecraft:wheat', 'item:minecraft:wheat', 'item:minecraft:dried_kelp', 'item:minecraft:sugar'],
  mustard: ['item:minecraft:cactus', 'item:minecraft:sugar', 'item:anglertackle:salt'],
};

const loaded = {};
for (const id of RECIPES) loaded[id] = loadRecipe(id);

// A/B. 鱼刀：用户逐字指定的配方
{
  const r = loaded.fish_knife;
  if (!r) bad('缺配方 fish_knife.json');
  else {
    const got = [...r.ingredients].sort().join(' + ');
    const want = [...wanted.fish_knife].sort().join(' + ');
    if (got !== want) {
      bad('鱼刀配方与用户指定不符\n       期望：' + want + '\n       实际：' + got);
    } else {
      ok('鱼刀配方 = 铁锭 + 木棍 + #minecraft:wooden_buttons（任意木头按钮，用户 2026-10-03 指定）');
    }
    if (r.json.result && r.json.result.id === 'anglertackle:fish_knife') ok('鱼刀配方产物正确');
    else bad('鱼刀配方产物不是 anglertackle:fish_knife');
  }
}

// C. 盐：必须用水桶（这是"空桶返还"唯一的落点）
{
  const r = loaded.salt;
  if (!r) bad('缺配方 salt.json');
  else {
    if (!r.ingredients.includes('item:minecraft:water_bucket')) {
      bad('盐的配方里没有水桶 —— 用户定的"水桶参与制作理应返还水桶"就落空了'
        + '（本模组没有覆写水桶的返还逻辑，返还完全靠原版的 craftingRemainingItem）');
    } else {
      ok('盐配方用到水桶（空桶由原版 craftingRemainingItem 自动返还，不需要我们写代码）');
    }
    if ((r.json.result || {}).id === 'anglertackle:salt') ok('盐配方产物正确，数量 '
      + (r.json.result.count || 1));
    else bad('盐配方产物不是 anglertackle:salt');
  }
}

// D. 芥末要用本模组的盐
{
  const r = loaded.mustard;
  if (!r) bad('缺配方 mustard.json');
  else if (!r.ingredients.includes('item:anglertackle:salt')) bad('芥末配方没用到本模组的盐（盐 → 芥末这条链断了）');
  else ok('芥末配方用本模组的盐（盐 → 芥末）');
}

// E. 材料白名单：原版命名空间，或本模组确实注册过的东西
{
  const tagExists = (tag) => {
    const [ns, name] = tag.split(':');
    if (ns !== 'anglertackle') return true;   // 原版标签不在这里校验（有 check-vanilla-tags.js）
    for (const kind of ['item', 'block']) {
      if (exists('src/main/resources/data/anglertackle/tags/' + kind + '/' + name + '.json')) return true;
    }
    return false;
  };
  const problems = [];
  for (const id of RECIPES) {
    const r = loaded[id];
    if (!r) continue;
    r.ingredients.forEach((ing, i) => {
      const [kind, value] = ing.split(':').length === 3
        ? [ing.slice(0, ing.indexOf(':')), ing.slice(ing.indexOf(':') + 1)]
        : [null, null];
      if (!kind || !value) { problems.push(id + '[' + i + '] 材料写法不认识：' + ing); return; }
      const [ns, name] = value.split(':');
      if (ns === 'minecraft') return;                       // 原版物品/标签
      if (ns !== 'anglertackle') { problems.push(id + '[' + i + '] 命名空间不是原版也不是本模组：' + value); return; }
      if (kind === 'tag') { if (!tagExists(value)) problems.push(id + '[' + i + '] 标签不存在：' + value); return; }
      if (!registered.has(name)) problems.push(id + '[' + i + '] 本模组没有这个物品：' + value);
    });
  }
  problems.length
    ? bad('配方材料有问题：\n       ' + problems.join('\n       '))
    : ok('4 条配方的材料全部落在"原版 / 本模组已注册"范围内（' +
        RECIPES.reduce((n, id) => n + (loaded[id] ? loaded[id].ingredients.length : 0), 0) + ' 项）');
}

// 顺带守住"调料是可堆叠消耗品、鱼刀不是"
{
  const badStack = [];
  for (const id of STACKABLE) {
    const re = new RegExp('register\\("' + id + '"[\\s\\S]{0,240}?stacksTo\\(64\\)');
    if (!re.test(itemsSrc)) badStack.push(id);
  }
  badStack.length ? bad('调料没写成 stacksTo(64)：' + badStack.join(', ')) : ok('4 种调料都是 64 堆叠');
  const knifeOk = /register\("fish_knife"[\s\S]{0,240}?stacksTo\(1\)[\s\S]{0,120}?durability\(/.test(itemsSrc);
  knifeOk ? ok('鱼刀是 stacksTo(1) + 有耐久') : bad('鱼刀没写成 stacksTo(1).durability(...)');
}

// ---------------------------------------------------------------- F. 鱼刀耐久：代码 ↔ 文档
{
  const knifeSrc = exists(KNIFE_JAVA) ? read(KNIFE_JAVA) : '';
  const m = /DURABILITY\s*=\s*(\d+)/.exec(knifeSrc);
  const codeDurability = m ? Number(m[1]) : null;
  const attrDurability = (() => {
    const mm = /register\("fish_knife"[\s\S]{0,240}?durability\(([^)]*)\)/.exec(itemsSrc);
    return mm ? mm[1].trim() : null;
  })();

  let docDurability = null;
  if (exists(DOC)) {
    const doc = read(DOC);
    // §14.6.3 的表：| 耐久 | **64**（够切 64 次…） |
    const sec = doc.split(/^#### 14\.6\.3/m)[1] || '';
    const line = sec.split('\n').find((l) => l.startsWith('|') && l.includes('耐久'))
      || sec.split('\n').find((l) => l.trim().startsWith('|') && /\d/.test(l));
    if (line) {
      const digits = line.replace(/\*\*/g, '').match(/\d+/g);
      if (digits) docDurability = Number(digits[0]);
    }
  }

  if (codeDurability === null) bad('FishKnifeItem 里没有 DURABILITY 常量');
  else if (!(attrDurability || '').includes('DURABILITY')) bad('ModItems 里的耐久没引用 FishKnifeItem.DURABILITY（写死了第二个数字）');
  else if (docDurability === null) bad('docs/25 §14.6.3 里没读到耐久数字（表格被改过？）');
  else if (docDurability !== codeDurability) {
    bad('鱼刀耐久文档与代码不一致：docs/25 §14.6.3 写 ' + docDurability
      + '，代码是 ' + codeDurability);
  } else {
    ok('鱼刀耐久一处定义、三处一致：代码常量 ' + codeDurability
      + ' = 物品属性 = docs/25 §14.6.3');
  }
}

// ---------------------------------------------------------------- G. 图标进指纹表
{
  if (!exists(FINGERPRINTS)) bad('缺 ' + FINGERPRINTS);
  else {
    const rec = JSON.parse(read(FINGERPRINTS));
    const unguarded = KITCHEN.filter((id) => !(id in rec));
    unguarded.length
      ? bad('贴图没进指纹表（被生成器覆盖也不会有人知道）：' + unguarded.join(', ')
        + '\n       确认图标是对的之后跑：node tools/check-item-icons.js --write')
      : ok('5 张图标都在指纹表里（逐个 sha256 守着）');
  }
}

console.log('');
if (fail === 0) {
  console.log('✅ 料理物品检查全部通过（' + KITCHEN.length + ' 件物品 / ' + RECIPES.length + ' 条配方）');
  process.exitCode = 0;
} else {
  console.log('❌ 料理物品检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
