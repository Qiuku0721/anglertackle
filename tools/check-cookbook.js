/*
 * check-cookbook.js —— 【菜谱 + 悬浮显示效果】的守门人（用户 2026-10-03 定案，1.2.1）。
 *
 * 用户原话：
 *   "现在的问题是玩家不知道烹饪成品有什么效果持续时间多久。把悬浮显示完善，
 *    制作菜谱，菜谱合成方式（原版任意熟鱼加书），完善教程内容可以变为1.2.1版本"
 *
 * 为什么需要它：这一层的错法**全都不报错**，只是玩家看不到或看到假的：
 *   ① 悬浮显示另抄一份策划数字 → 与真正发的效果分叉（数字都很合理，只是不一样）；
 *   ② 菜谱界面自己算效果 → 同上（必须调 DishEffects.grantsFor）；
 *   ③ 材料清单另抄一张表 → 菜谱上说能做、实际做不出来；
 *   ④ 配方/进度/图标/语言键缺一件 → 物品做不出来、显示成生键、或紫黑格；
 *   ⑤ 教程里写的档位数值与 FoodValues 对不上 → 玩家按手册做，吃到的不是那个数。
 *
 * 断言：
 *   A. 悬浮显示：DishItem 调 DishEffects.grantsFor + EffectText；无数据也说得清
 *   B. 效果文案只有一份（EffectText），时长格式与菜谱界面共用
 *   C. 菜谱物品：注册 / 创造页签 / 模型 / 贴图 / 中英语言键 / 右键走请求包
 *   D. 菜谱界面：材料来自 allowedPairs、效果来自 grantsFor、饱食度来自 FoodValues，
 *      且文字走 TextWidget（本机环境下 drawString 是糊的）
 *   E. 合成：任意熟鱼（#c:foods/cooked_fish）+ 书 → 菜谱，且进度已生成
 *   F. 教程：新增的"做菜、菜谱与效果"章里，六档数值与 FoodValues 逐条一致
 *   G. 策划文档 docs/29 在，且写清了"数字只从真源来"这条纪律
 *   H. **12 道菜一道不少**（用户 2026-10-03 第二轮："12道菜只介绍10道"）：
 *      菜谱清单 = ModItems 里注册的全部成品菜（10 道工作台菜 + 2 道设备菜）
 *   I. **配方说全**（同一轮："不提怎么加工、需要什么额外的配料，配料又怎么合成"）：
 *      界面给出 基础/配料/步骤/配料来源，且配料**不是手抄的**（现场问配方管理器）
 *   J. 每道菜的 tooltip 必须提到它**真实的**配料（漏一个就红 —— 抓过"整条油炸"漏小麦）
 *
 * 用法：node tools/check-cookbook.js
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./java-source.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 菜谱与悬浮显示检查（1.2.1）===\n');

const DISH_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/DishItem.java';
const COOKBOOK_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/CookbookItem.java';
const SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/CookbookScreen.java';
const EFFECT_TEXT = 'src/main/java/com/whitecobalt/anglertackle/effect/EffectText.java';
const MOD_ITEMS = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';
const MOD_NETWORK = 'src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java';
const CLIENT_HANDLERS = 'src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java';
const RECIPE = 'src/main/resources/data/anglertackle/recipe/cookbook.json';
const ADV = 'src/main/resources/data/anglertackle/advancement/recipes/cookbook.json';
const MODEL = 'src/main/resources/assets/anglertackle/models/item/cookbook.json';
const TEX = 'src/main/resources/assets/anglertackle/textures/item/cookbook.png';
const ZH = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';
const EN = 'src/main/resources/assets/anglertackle/lang/en_us.json';
const GUIDE = 'src/main/resources/data/anglertackle/guide/guide.json';
const FOOD = 'src/main/java/com/whitecobalt/anglertackle/fishing/FoodValues.java';

for (const p of [DISH_ITEM, COOKBOOK_ITEM, SCREEN, EFFECT_TEXT, MOD_ITEMS, MOD_NETWORK,
  CLIENT_HANDLERS, RECIPE, ADV, MODEL, TEX, ZH, EN, GUIDE, FOOD]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}
const dish = read(DISH_ITEM);
const book = read(COOKBOOK_ITEM);
const screen = read(SCREEN);
const effect = read(EFFECT_TEXT);
const items = read(MOD_ITEMS);
const network = read(MOD_NETWORK);
const handlers = read(CLIENT_HANDLERS);
const zh = JSON.parse(read(ZH));
const en = JSON.parse(read(EN));
const guide = JSON.parse(read(GUIDE));
const food = read(FOOD);

// ---------------------------------------------------------------- A 悬浮显示
{
  // appendHoverText 是悬浮显示的唯一入口 —— 必须直接问 DishEffects（吃菜时用的也是它）
  const hover = dish.slice(dish.indexOf('appendHoverText'));
  if (!/DishEffects\.grantsFor\(id, data\.tier\(\)\)/.test(hover)) {
    bad('DishItem 的悬浮显示没有调 DishEffects.grantsFor(id, 档位) —— '
      + '另抄一份数值就会和真正发的效果分叉（玩家看到的 6 分钟，实际 3 分钟）');
  } else if (!/DishEffects\.grantsFor\(id, DishEffects\.SUPREME_TIER\)/.test(hover)) {
    bad('悬浮显示没有"金/红档还会多给什么"的提示 —— '
      + '玩家看不出"换条好鱼还能多拿一个效果"');
  } else if (!/EffectText\.line\(/.test(hover)) {
    bad('悬浮显示没有用 EffectText.line（等级 + 时长的统一格式）');
  } else if (!/dish_no_data/.test(hover) || !/dish_no_effect/.test(hover)) {
    bad('悬浮显示没有处理"没有鱼数据"与"这个档位没有效果"两种空状态');
  } else ok('悬浮显示直接问 DishEffects（当前档位 + 顶级额外），两种空状态都说了');
}

// ---------------------------------------------------------------- B 文案只有一份
{
  if (!/public static MutableComponent line\(DishEffects\.Grant/.test(effect)) {
    bad('EffectText.line 的入参不是 DishEffects.Grant —— 那就说明它自带一套数值');
  } else if (!/ROMAN/.test(stripComments(effect)) || /enchantment\.level/.test(stripComments(effect))) {
    // 原版 enchantment.level.N 会让 check-lang 的拼接键检查红（前缀下 0 个键），
    // 所以等级名自己维护一张罗马数字表 —— 见 EffectText 的类注释
    bad('EffectText 的等级名又改回原版 enchantment.level.N 了 —— '
      + '那会让 check-lang 的拼接键检查报红（我们语言文件里没有这个前缀）');
  } else if (!/minutes > 0/.test(effect)) {
    bad('EffectText.duration 没有"不足 1 分钟写秒"的分支 —— 20s 会显示成 0:20，像 20 分钟');
  } else if (!/EffectText\.line\(/.test(screen)) {
    bad('菜谱界面没有复用 EffectText —— 同一句话两个出口就必须是一份实现');
  } else ok('效果文案只有一份实现（EffectText），悬浮与菜谱共用，短效果写成 20s');
}

// ---------------------------------------------------------------- C 菜谱物品
{
  if (!/ITEMS\.register\("cookbook"/.test(items)) {
    bad('ModItems 里没有注册 cookbook');
  } else if (!/output\.accept\(COOKBOOK\.get\(\)\)/.test(items)) {
    bad('菜谱没进创造页签 —— 创造模式拿不到（而配方要一本书，前期很难试）');
  } else if (/Minecraft|setScreen|CookbookScreen/.test(stripComments(book))) {
    // ⚠ 必须剥掉注释再看：这个类的**注释里**就写着"不能在这里开界面"，
    //   不剥的话它自己会把正确代码判成错的（负例 cookbook-item-client-class 抓过这一点）
    bad('CookbookItem（common 侧）里出现了客户端类 —— 专用服务器会因此装不进模组'
      + '（2026-10-03 的真实事故，见 ClientPayloadHandlers 的类注释）');
  } else if (!/PacketDistributor\.sendToServer\(CookbookRequestPayload\.INSTANCE\)/.test(book)) {
    bad('CookbookItem 右键没有发请求包 —— 界面打不开');
  } else if (!/level\.isClientSide\(\)/.test(book)) {
    bad('CookbookItem 没有把发包限制在客户端 —— 服务端会往反方向发（变成 S→C 请求）');
  } else if (!/playToServer\(CookbookRequestPayload\.TYPE/.test(network)
      || !/playToClient\(CookbookPayload\.TYPE/.test(handlers)) {
    bad('菜谱的请求/下发没有成对注册（C→S 在 ModNetwork、S→C 在 ClientPayloadHandlers）');
  } else if (!/new CookbookScreen\(\)/.test(handlers)) {
    bad('ClientPayloadHandlers 收到包之后没开菜谱界面');
  } else ok('菜谱物品接的是"请求 → 下发 → 客户端专用类开界面"，common 侧没有客户端类');

  const model = JSON.parse(read(MODEL));
  if (model.textures?.layer0 !== 'anglertackle:item/cookbook') {
    bad('菜谱的模型没有指向自己的贴图：' + JSON.stringify(model.textures));
  } else if (!/item.anglertackle.cookbook/.test(zh['item.anglertackle.cookbook'] ? 'item.anglertackle.cookbook' : '')
      || zh['item.anglertackle.cookbook'] !== '菜谱') {
    bad('中英语言键不对：zh=' + zh['item.anglertackle.cookbook'] + ' en=' + en['item.anglertackle.cookbook']);
  } else if (!en['item.anglertackle.cookbook']) {
    bad('缺英文名 item.anglertackle.cookbook');
  } else if (!/tooltip\.anglertackle\.cookbook_hint/.test(book)) {
    bad('菜谱没有悬浮提示（玩家不知道右键能看什么）');
  } else ok('菜谱：模型指自己的贴图、中英名字齐、有右键提示');
}

// ---------------------------------------------------------------- D 菜谱界面的数据来源
{
  // ⚠ 剥掉注释再判：界面注释里就写着"材料来自 allowedPairs()"，
  //   在带注释的原文上匹配等于自己证明自己（负例 cookbook-screen-own-table 抓过这一点）
  const code = stripComments(screen);
  if (!/DishRecipe\.allowedPairs\(\)/.test(code)) {
    bad('菜谱界面的"材料"不是从 DishRecipe.allowedPairs() 来的 —— '
      + '另抄一张表就会写出"菜谱说能做、实际做不出来"');
  } else if (!/DishEffects\.grantsFor\(/.test(code)) {
    bad('菜谱界面的"效果"不是从 DishEffects.grantsFor() 来的');
  } else if (!/FoodValues\.dishHunger\(/.test(code)) {
    bad('菜谱界面没有从 FoodValues 取饱食度');
  } else if (!/new TextWidget\(/.test(code) || !/UiLayout\.fitText\(/.test(code)) {
    bad('菜谱界面直接用 graphics.drawString 画字（本机环境里会糊）或没有截断 —— '
      + '必须走 TextWidget + UiLayout，与图鉴/指南一致');
  } else if (!/isPauseScreen/.test(code)) {
    bad('菜谱界面没有覆写 isPauseScreen —— 单人游戏里开菜谱会把世界暂停');
  } else ok('菜谱界面：材料/效果/饱食度三个来源都是真源，文字走 TextWidget');
}

// ---------------------------------------------------------------- E 合成与进度
{
  const recipe = JSON.parse(read(RECIPE));
  // 26.1.2 的配方材料是新语法：普通物品写字符串，标签写 "#namespace:path"。
  const ings = (recipe.ingredients || []).flat().map((i) => {
    if (typeof i === 'string') return i.startsWith('#') ? { tag: i.slice(1) } : { item: i };
    return i && typeof i === 'object' ? i : {};
  });
  const hasBook = ings.some((i) => i.item === 'minecraft:book');
  const hasFish = ings.some((i) => i.tag === 'c:foods/cooked_fish');
  if (recipe.type !== 'minecraft:crafting_shapeless') {
    bad('菜谱配方不是无序合成（用户："原版任意熟鱼加书"）：' + recipe.type);
  } else if (!hasBook || !hasFish) {
    bad('菜谱配方的材料不是「一本书 + 任意熟鱼」：' + JSON.stringify(ings));
  } else if (recipe.result?.id !== 'anglertackle:cookbook') {
    bad('菜谱配方的产物不对：' + JSON.stringify(recipe.result));
  } else {
    const adv = JSON.parse(read(ADV));
    const target = adv.rewards?.recipes || [];
    if (!target.includes('anglertackle:cookbook')) {
      bad('解锁进度里没有这条配方 —— 配方书里永远看不到它（也就永远解锁不了）');
    } else ok('合成 = 无序：一本书 + #c:foods/cooked_fish（原版任意熟鱼），进度已生成');
  }
}

// ---------------------------------------------------------------- F 教程里的数字 ↔ FoodValues
{
  const chapter = (guide.chapters || []).find((c) => c.id === 'cook');
  if (!chapter) {
    bad('教程书里没有"做菜"那一章（id=cook）—— 用户要求"完善教程内容"');
  } else {
    const text = chapter.pages.flat().join('\n');
    const want = [];
    for (let t = 0; t <= 5; t++) {
      want.push('菜 ' + t + ' 档 = ' + matchHunger(food, 'dishHunger', t));
    }
    // 手册里那两列数字必须与 FoodValues 一致（逐档复算，不靠人眼）
    const missing = [];
    for (let t = 0; t <= 5; t++) {
      const dishN = matchHunger(food, 'dishHunger', t);
      const cookedN = matchHunger(food, 'cookedHunger', t);
      const row = new RegExp('^\\s*' + ['白', '绿', '蓝', '紫', '金', '红'][t] +
        '\\s+' + dishN + ' 点\\s+' + cookedN + ' 点\\s*$', 'm');
      if (!row.test(text)) {
        missing.push(['白', '绿', '蓝', '紫', '金', '红'][t] + '（应为 ' + dishN + ' / ' + cookedN + '）');
      }
    }
    if (missing.length) {
      bad('教程里"饱食度按鱼的档位走"那张表与 FoodValues 对不上：' + missing.join('、'));
    } else if (!/任意熟鱼/.test(text) || !/菜谱/.test(text)) {
      bad('教程里没有写菜谱的合成方式（"任意熟鱼 + 书"）');
    } else if (!/悬浮/.test(text)) {
      bad('教程里没有告诉玩家"把鼠标停在菜上看效果与时长" —— 新功能没人知道等于没做');
    } else ok('教程第 12 章的六档数值与 FoodValues 逐档一致，并写了菜谱与悬浮显示');
  }
}

// ---------------------------------------------------------------- G 策划文档
{
  const DOC29 = 'docs/29-菜谱与悬浮显示.md';
  if (!exists(DOC29)) {
    bad('缺策划文档 docs/29-菜谱与悬浮显示.md —— 这一层"为什么这么做"就没地方写了');
  } else {
    const doc = read(DOC29);
    const needs = [
      ['DishEffects.grantsFor', '悬浮显示的数字来源'],
      ['DishRecipe.allowedPairs', '菜谱材料来自配方表本身'],
      ['c:foods/cooked_fish', '合成用的是通用熟鱼标签'],
      ['getRecipeManager', '配料来源是现场问配方管理器、不是手抄的表'],
    ];
    const missing = needs.filter(([token]) => !doc.includes(token)).map(([, why]) => why);
    if (missing.length) {
      bad('docs/29 没写清这些事：' + missing.join('、'));
    } else if (!/用户原话/.test(doc)) {
      bad('docs/29 没有引用用户原话 —— 策划文档的规矩是"用户定的"与"我补的"分开写');
    } else ok('docs/29 在，且把四条数据来源与用户的定案都写清了');
  }
}

// ---------------------------------------------------------------- H 12 道菜一道不少
{
  // 游戏里到底有几道成品菜？以 ModItems 里 new DishItem("…") 为准
  const itemIds = [...items.matchAll(/new DishItem\("([a-z_]+)"/g)].map((m) => m[1]);
  // 菜谱界面列出哪些：DishRecipe.Dish 的 id + DEVICE_DISHES
  const dishEnumIds = [...read('src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java')
    .matchAll(/^\s{8}[A-Z_]+\(\s*"([a-z_]+)"/gm)].map((m) => m[1]);
  const deviceBlock = /DEVICE_DISHES = List\.of\(([^)]*)\)/.exec(screen);
  const deviceIds = deviceBlock
    ? [...deviceBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  const listed = new Set([...dishEnumIds, ...deviceIds]);
  const missing = itemIds.filter((id) => !listed.has(id));
  if (itemIds.length < 12) {
    bad('ModItems 里只解析出 ' + itemIds.length + ' 道成品菜（结构变了？）—— 这条断言失效了');
  } else if (missing.length) {
    bad('菜谱里少了这些菜（用户报过"12道菜只介绍10道"）：' + missing.join('、')
      + ' —— 工作台菜要在 DishRecipe.Dish 里、设备菜要进 CookbookScreen.DEVICE_DISHES');
  } else ok('菜谱列全 ' + itemIds.length + ' 道菜：' + itemIds.join('、'));
}

// ---------------------------------------------------------------- I 配方说全（基础/配料/步骤/来源）
{
  const code = stripComments(screen);
  if (!/dish\.base\(\)/.test(code) || !/dish\.baseCount\(\)/.test(code)
      || !/dish\.extraItems\(\)/.test(code)) {
    bad('「做法」页没有用 Dish 的基础/数量/配料（base/baseCount/extraItems）—— '
      + '那它显示的配料就是另抄的一份');
  } else if (!/section\("base"\)[\s\S]{0,200}?baseCount\(\)/.test(code)) {
    bad('「做法」页的"基础"那一行不是由 dish.base()/baseCount() 拼出来的');
  } else if (!/section\("extra"\)[\s\S]{0,200}?extraItems\(\)/.test(code)) {
    // ⚠ 必须盯着**那一行**：extraItems() 在别处（合成式、配料来源）也用了，
    //   只断言"文件里出现过"的话，把配料那一行换成空表也照样绿（负例抓过）
    bad('「做法」页的"配料"那一行不是由 dish.extraItems() 拼出来的 —— '
      + '配料清单会被写空或另抄');
  } else if (!/getRecipeBook\(\)\.getCollections\(\)/.test(code)
      || !/entry\.craftingRequirements\(\)/.test(code)) {
    // 26.1.2：客户端不再持有整张配方的 RecipeManager 表（改由 ClientboundRecipeBookAddPacket
    // 下发 RecipeDisplay），所以"现场问配方数据"的正确入口是玩家的配方书集合
    // （getRecipeBook().getCollections() → RecipeDisplayEntry.craftingRequirements()）。
    // 断言语义不变：配料必须**从真实配方数据现算**，不许手抄一份合成式（配方一改就会撒谎）。
    bad('「配料怎么来」不是现场问配方数据（getRecipeBook().getCollections() + '
      + 'entry.craftingRequirements()）—— 手抄的合成式会在配方改动后撒谎');
  } else if (!/screen\.anglertackle\.cookbook\.section\./.test(code)
      || !/screen\.anglertackle\.cookbook\.step\./.test(code)) {
    bad('「做法」页没有分节（基础/配料/步骤/来源）或没有加工步骤');
  } else {
    const keys = ['section.fish', 'section.base', 'section.extra', 'section.steps', 'section.source',
      'base.cooked', 'base.raw', 'base.whole_fish', 'step.cut', 'step.heat', 'step.craft',
      'step.whole', 'step.device', 'source', 'source_none', 'note.smoked_fish', 'note.charred_fish',
      'station.crafting', 'station.oil_pressing', 'device.smoker', 'device.campfire'];
    const lack = keys.filter((k) => !zh['screen.anglertackle.cookbook.' + k]
      || !en['screen.anglertackle.cookbook.' + k]);
    if (lack.length) {
      bad('菜谱界面的语言键缺中英：' + lack.join('、'));
    } else if (/[\u4e00-\u9fa5]/.test(code)) {
      // 界面代码里不许出现中文字面量：英文客户端会看到中文
      bad('菜谱界面的代码里出现了中文字面量 —— 一律走语言键（中英都要有）');
    } else ok('「做法」页：基础/配料/步骤/来源齐全，配料来源现场查配方，文案全走语言键');
  }
}

// ---------------------------------------------------------------- J tooltip 必须提到真实配料
{
  const dishSrc = read('src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java');
  const needOf = new Map();   // Need 常量 → 物品常量名
  // ⚠ 三种写法都要认（1.3.0 加了"配料走标签"那一种）：
  //   mat(() -> ModItems.X.get())          —— 写死我们的物品
  //   mat(ModTags.TAG, () -> ModItems.X.get()) —— 走标签，X 是**配方书展示用**的那个物品
  //   mat(() -> Items.X)                    —— 原版物品
  // 断言本身没放松：仍然要求"每个配料的中文名出现在 tooltip 里"。
  for (const m of dishSrc.matchAll(/Need ([A-Z_]+) = \w+\(ModTags\.\w+, \(\) -> ModItems\.(\w+)\.get\(\)\)/g)) {
    needOf.set(m[1], m[2]);
  }
  for (const m of dishSrc.matchAll(/Need ([A-Z_]+) = \w+\(\(\) -> ModItems\.(\w+)\.get\(\)\)/g)) {
    needOf.set(m[1], m[2]);
  }
  for (const m of dishSrc.matchAll(/Need ([A-Z_]+) = \w+\(\(\) -> Items\.(\w+)\)/g)) {
    needOf.set(m[1], m[2]);
  }
  const VANILLA_CN = { SUGAR: '糖', WHEAT: '小麦', SUGAR_CANE: '甘蔗', WATER_BUCKET: '水桶' };
  const cnOf = (sym) => {
    if (VANILLA_CN[sym]) return VANILLA_CN[sym];
    const reg = new RegExp('\\b' + sym + ' = ITEMS\\.register\\("([a-z_]+)"');
    const hit = reg.exec(items);
    return hit ? zh['item.anglertackle.' + hit[1]] : null;
  };
  const problems = [];
  for (const m of dishSrc.matchAll(/^\s{8}[A-Z_]+\("([a-z_]+)", Base\.(\w+), (\d+), List\.of\(([^)]*)\)\)/gm)) {
    const [, dishId, , , needsRaw] = m;
    const tip = zh['tooltip.anglertackle.' + dishId];
    if (!tip) { problems.push(dishId + '（没有 tooltip）'); continue; }
    for (const need of needsRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const sym = needOf.get(need);
      const cn = sym ? cnOf(sym) : null;
      if (!cn) { problems.push(dishId + ' 的配料 ' + need + ' 查不到中文名'); continue; }
      if (!tip.includes(cn)) problems.push(dishId + ' 的 tooltip 没提「' + cn + '」');
    }
  }
  // 设备菜：tooltip 必须说清用什么设备做的
  for (const [id, word] of [['smoked_fish', '烟熏炉'], ['charred_fish', '营火']]) {
    const tip = zh['tooltip.anglertackle.' + id];
    if (!tip || !tip.includes(word)) problems.push(id + ' 的 tooltip 没提「' + word + '」');
  }
  if (problems.length) {
    bad('悬浮显示与真实配料对不上：\n       ' + problems.join('\n       '));
  } else ok('12 道菜的 tooltip 都提到了自己真实的配料与设备（逐条对着 DishRecipe 表复算）');
}

// ---------------------------------------------------------------- K 加工步骤必须与真实配方一致
// 用户 2026-10-03（截图）："很明显，鱼块的做法不是这样的。"
// 第一版写的是"整鱼 --鱼刀右键--> 鱼块"，而**切块是工作台配方**（recipe/cutting.json，
// 材料就是整鱼标签）；鱼刀压根没有右键功能，它只是刺身配方里不消耗的工具。
// 同一处还写错了加热："熔炉 / 营火 / 烟熏炉 --> 熟鱼块" —— 只有熔炉出熟块，
// 营火出的是炭烤鱼、烟熏炉出的是熏鱼（三个独立物品）。
{
  const cut = zh['screen.anglertackle.cookbook.step.cut'] || '';
  const heat = zh['screen.anglertackle.cookbook.step.heat'] || '';
  const enCut = en['screen.anglertackle.cookbook.step.cut'] || '';
  const enHeat = en['screen.anglertackle.cookbook.step.heat'] || '';
  const problems = [];
  // ① 切块：必须说"工作台"，且不许再出现"鱼刀右键"
  if (!/工作台/.test(cut)) problems.push('切块那句没写"工作台"（切块是工作台配方：recipe/cutting.json）');
  if (/鱼刀/.test(cut)) {
    problems.push('切块那句又提到鱼刀了 —— 鱼刀没有右键功能，它只是刺身配方里不消耗的工具');
  }
  // ② 份数范围必须来自 CuttingRecipe 的常量，不许写死在文案里
  if (!/%s/.test(cut) || !/CuttingRecipe\.MIN_CHUNKS/.test(stripComments(screen))
      || !/CuttingRecipe\.MAX_CHUNKS/.test(stripComments(screen))) {
    problems.push('切块的份数范围没有从 CuttingRecipe.MIN_CHUNKS/MAX_CHUNKS 现取');
  }
  // ③ 加热：只有熔炉出熟块
  if (!/熔炉/.test(heat)) problems.push('加热那句没写"熔炉"');
  if (/营火|烟熏炉/.test(heat)) {
    problems.push('加热那句把营火/烟熏炉也算成"出熟块"了 —— 营火出炭烤鱼、烟熏炉出熏鱼');
  }
  if (!/furnace/.test(enHeat)) problems.push('英文的加热那句没写 furnace');
  if (!/crafting table/.test(enCut)) problems.push('英文的切块那句没写 crafting table');
  // ④ 教程第一章讲的同一条链也要一致（同一处错误在手册里也有一份）
  const guideText = ((guide.chapters || []).find((c) => c.id === 'cook') || { pages: [] })
    .pages.flat().join('\n');
  if (/鱼刀-->/.test(guideText) || /拿鱼刀/.test(guideText)) {
    problems.push('教程第十二章还写着"拿鱼刀切块"');
  }
  if (!/工作台/.test(guideText)) problems.push('教程第十二章没写切块在工作台');
  if (!/熔炉/.test(guideText)) problems.push('教程第十二章没写熟块来自熔炉');
  if (problems.length) {
    bad('加工步骤与真实配方对不上：\n       ' + problems.join('\n       '));
  } else ok('切块（工作台）/ 熟块（熔炉）/ 熏鱼（烟熏炉）/ 炭烤鱼（营火）四处说法都与配方一致');
}

/** 从 FoodValues 源码里读某个方法在某个档位返回的数字（不执行 Java，只解析公式调用）。 */
function matchHunger(src, method, tier) {
  const m = new RegExp('public static int ' + method + '\\(int tier\\)[\\s\\S]{0,400}?return ([^;]+);')
    .exec(src);
  if (!m) throw new Error('读不出 ' + method + ' 的返回式');
  // 公式形如 3 + clampTier(tier) / cookedHunger(tier) + 1 —— 用同样的公式算
  const expr = m[1].trim();
  const base = /^(\d+)\s*\+\s*clampTier\(tier\)$/.exec(expr);
  if (base) return Number(base[1]) + tier;
  const plus1 = /^cookedHunger\(tier\)\s*\+\s*(\d+)$/.exec(expr);
  if (plus1) return matchHunger(src, 'cookedHunger', tier) + Number(plus1[1]);
  throw new Error(method + ' 的公式变了，检查器要跟着改：' + expr);
}

console.log('');
if (fail === 0) {
  console.log('✅ 菜谱与悬浮显示检查通过：效果文案单一真源、配方/进度/图标/语言键齐全、教程数字对账');
  process.exitCode = 0;
} else {
  console.log('❌ 菜谱与悬浮显示检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
