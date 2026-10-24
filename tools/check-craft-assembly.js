/*
 * check-craft-assembly.js —— 工作台 / 随身 2×2 合成栏装配件。
 *
 * 用户 2026-10-02："加一个工作台装配件和自身合成栏装配件功能。"
 *
 * 这条链路有三处**不报错的**坏法，所以每一处都写成断言：
 *   ① **配方类型**：JSON 的 "type"（序列化器）与配方进哪张表（RecipeType）是两件事。
 *      两个合成栏都是拿 `RecipeType.CRAFTING` 去查配方的，所以这条配方必须报告自己是
 *      CRAFTING（CraftingRecipe 的默认实现）。有人给它建一个自己的 RecipeType 的话，
 *      配方会被塞进 byType[自己的类型]，两个合成栏都找不到它 —— 没有报错，就是合不出来。
 *   ② **产出物**：必须复制放进去的那根竿（耐久 / 已有配件 / 附魔 / 名字都跟着走），
 *      再 applyPart。写成 new ItemStack(item) 的话换一次件就把竿洗成全新的。
 *   ③ **换下来的旧件**：必须用 partAt（竿上存着的那一份，带耐久）放进合成剩余物。
 *      重造的话耐久回满（用户 2026-10-02 反复强调过这一条）。
 *
 * 另外两件容易漏的：
 *   · 只认**正好两格**。原版取走产出物时会从每一个非空格子各扣 1 个
 *     （ResultSlot#onTake），配方却"忽略了"多放的东西 = 白白吃掉玩家的物品。
 *   · special 配方进不了原版配方书（isSpecial → ClientRecipeBook 直接排除），
 *     所以玩家的发现途径只有手册 —— 手册里必须写这三种装配方式。
 *
 * 用法：node tools/check-craft-assembly.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 剥注释再匹配 —— 这些文件的注释里正写着各种反面教材，不剥会自己把自己判红。 */
// ⚠ 用**共用的**状态机剥离器（tools/java-source.js）：自己写正则剥注释，
//   行注释里出现 `/*` 会吞掉大段真实代码，断言于是"通过"。
const { stripComments } = require('./java-source.js');
const code = (p) => stripComments(read(p));

console.log('=== 合成栏装配件检查（工作台 + 随身 2×2）===\n');

const RECIPE = 'src/main/java/com/whitecobalt/anglertackle/recipe/RodAssemblyRecipe.java';
const REG = 'src/main/java/com/whitecobalt/anglertackle/registry/ModRecipes.java';
const MAIN = 'src/main/java/com/whitecobalt/anglertackle/AnglersTackle.java';
const JSONRE = 'src/main/resources/data/anglertackle/recipe/rod_assembly.json';
const GUIDE = 'src/main/resources/data/anglertackle/guide/guide.json';
for (const f of [RECIPE, REG, MAIN, JSONRE, GUIDE]) {
  if (!fs.existsSync(path.join(ROOT, f))) { no('找不到 ' + f); process.exit(1); }
}
const recipe = code(RECIPE), reg = code(REG), main = code(MAIN);

/** 取方法体（签名 → 下一个方法签名之前）。分区域是必须的：全文搜会被别的分支满足。 */
function region(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  const rest = src.slice(i + sig.length);
  const m = rest.search(/\n    (?:private|public|protected)[\w <>,\[\].]*\(/);
  return m < 0 ? src.slice(i) : src.slice(i, i + sig.length + m);
}

// ---------------------------------------------------------------- 数据面
{
  const doc = JSON.parse(read(JSONRE));
  if (doc.type === 'anglertackle:rod_assembly') ok('配方 JSON 的 type 是 anglertackle:rod_assembly');
  else no('配方 JSON 的 type 不对：' + doc.type);
  if (doc.ingredients === undefined && doc.key === undefined && doc.result === undefined) {
    ok('JSON 里没有 ingredients/result（special 配方：产出物是动态的，写不进数据驱动配方）');
  } else no('JSON 里出现了 ingredients/key/result —— 那它就不是 special 配方了，' +
    '产出物会变成写死的那一个（耐久、已有配件都带不过去）');
  // 配方书的解锁进度：special 配方不该有（有的话是生成器漏了豁免）
  const adv = path.join(ROOT, 'src/main/resources/data/anglertackle/advancement/recipes/rod_assembly.json');
  if (fs.existsSync(adv)) {
    no('有 rod_assembly 的配方书解锁进度 —— special 配方进不了配方书，这份进度是孤儿');
  } else ok('没有给它生成配方书进度（special 配方进不了配方书，这是原版机制）');
}

// ---------------------------------------------------------------- ① 类型与注册
if (/class RodAssemblyRecipe extends CustomRecipe/.test(recipe)) {
  ok('RodAssemblyRecipe 继承 CustomRecipe（isSpecial → 不占配方书、不会被自动摆料）');
} else no('RodAssemblyRecipe 不是 CustomRecipe 子类 —— 无材料的配方会被配方书当成"不完整配方"');
if (!/isSpecial\s*\(/.test(recipe)) ok('没有把 isSpecial() 改回 false（它必须保持 special）');
else no('覆盖了 isSpecial() —— 改回 false 的话配方书会去摆一条没有材料的配方');
if (!/getType\s*\(/.test(recipe)) {
  ok('没有覆盖 getType()（继承 CraftingRecipe 的 RecipeType.CRAFTING —— 两个合成栏才找得到它）');
} else no('覆盖了 getType() —— 两个合成栏都是拿 RecipeType.CRAFTING 查配方的，' +
  '换成自己的类型就永远查不到，而且没有任何报错');
if (!/RecipeType/.test(reg)) {
  ok('ModRecipes 只注册序列化器，没有建自定义 RecipeType（建了就是上面那个静默失效）');
} else no('ModRecipes 里出现了 RecipeType —— JSON 的 type 只需要序列化器，' +
  '另外建一个类型会让配方进不了 CRAFTING 表');
// 26.1.2：SimpleCraftingRecipeSerializer 已删除，RecipeSerializer 变成 record(MapCodec, StreamCodec)，
// 所以自定义 special 配方的序列化器要自己 new（MapCodec + StreamCodec 两件套）。
if (/SERIALIZERS\.register\("rod_assembly"/.test(reg)
    && /new RecipeSerializer<>\(\s*MAP_CODEC\s*,\s*STREAM_CODEC\s*\)/.test(recipe)
    && /MapCodec<RodAssemblyRecipe> MAP_CODEC/.test(recipe)) {
  ok('序列化器注册在 anglertackle:rod_assembly（26.1.2 的 RecipeSerializer(MapCodec, StreamCodec)）');
} else no('rod_assembly 序列化器没有注册（JSON 解析不出来的话，游戏里只有一行日志）');
if (/ModRecipes\.register\(modBus\)/.test(main)) ok('主类里调了 ModRecipes.register（注册表真的挂上了）');
else no('主类里没有 ModRecipes.register(modBus) —— 序列化器根本没注册');

// ---------------------------------------------------------------- ② 匹配与产出
if (/@Override\s+public boolean matches\(CraftingInput/.test(recipe)) ok('实现了 matches(CraftingInput, Level)');
else no('没有实现 matches(CraftingInput, Level)');
if (/@Override\s+public ItemStack assemble\(CraftingInput/.test(recipe)) ok('实现了 assemble(CraftingInput, …)');
else no('没有实现 assemble(CraftingInput, …)');
// 26.1.2 删除了 Recipe#canCraftInDimensions（"这条配方要多大的格子"不再由配方申报）。
// 随身 2×2 能不能用，现在只取决于 matches() 是否**按格子遍历**、有没有偷偷要求 3×3。
// 断言语义不变（甚至更直接）：plan() 必须遍历 input.size() 的每个槽位，且不许读 width/height 卡尺寸。
{
  const planBody = /private static Plan plan\(CraftingInput input\) \{[\s\S]*?\n    \}/.exec(recipe);
  if (planBody && /for \(int i = 0; i < input\.size\(\); i\+\+\)/.test(planBody[0])
      && !/input\.width\(\)|input\.height\(\)/.test(planBody[0])) {
    ok('matches() 按格子遍历（input.size()）、不卡 3×3 ⇒ 随身 2×2 合成栏照样采纳');
  } else {
    no('matches() 没有按格子遍历（或读了 width/height 卡尺寸）—— 随身 2×2 合成栏里这条配方不会被采纳');
  }
}

const planReg = region(recipe, 'private static Plan plan(');
if (planReg === null) {
  no('找不到 plan(...)（匹配规则的唯一真源）—— 断言要跟着改');
} else {
  // 只认正好两格：第二根竿、第二件配件都直接不匹配。
  // （任何"多出来的格子"都会落进这两个分支之一 → 不匹配 → 不会被白白吃掉）
  const twoRod = /if \(!rod\.isEmpty\(\)\)\s*\{\s*return null;/.test(planReg);
  const twoPart = /if \(!part\.isEmpty\(\)\)\s*\{\s*return null;/.test(planReg);
  if (twoRod && twoPart) {
    ok('第二根竿 / 第二件配件都不匹配（多放的东西不会被原版"从每个非空格各扣 1 个"吃掉）');
  } else {
    no('plan() 没有挡住"多放的东西"（竿=' + twoRod + ' 配件=' + twoPart + '）—— ' +
      '原版取走产出物时会从每个非空格各扣 1 个，被忽略的那件就白没了');
  }
  if (/RodModManager\.partSlotOf\(part,/.test(planReg)) {
    ok('用 partSlotOf 判"这件配件装得到这根竿上吗"（台钓/路亚、鱼饵/拟饵的规则都在里面）');
  } else no('没有用 partSlotOf 判定 —— 什么配件都能往任何竿上装（或干脆全装不上）');
}
const asm = region(recipe, 'public ItemStack assemble(');
if (asm && /plan\.rod\.copy\(\)/.test(asm)) {
  ok('产出物是**放进去那根竿的副本**（耐久 / 已有配件 / 附魔 / 名字都跟着走）');
} else no('产出物不是那根竿的副本 —— 换件会把竿洗成全新的');
if (asm && /RodModManager\.applyPart\(/.test(asm)) ok('用 applyPart 装上配件（和铁砧/界面同一条装配路径）');
else no('没有走 RodModManager.applyPart —— 装配规则会和别处走散');

// ---------------------------------------------------------------- ③ 旧件退回
const rem = region(recipe, 'public NonNullList<ItemStack> getRemainingItems(');
if (rem === null) {
  no('没有实现 getRemainingItems —— 被替换掉的旧配件会被吞掉（用户明确要求退回）');
} else {
  if (/RodModManager\.partAt\(/.test(rem)) {
    ok('旧件用 partAt 取（竿上存着的那一份，带耐久）');
  } else no('旧件不是从竿上取的那一份 —— 退回来的耐久会是满的');
  if (!/new ItemStack\(|stackFromId\(|setDamageValue\(0\)/.test(rem)) {
    ok('旧件那段里没有"重造堆栈 / 写死满耐久"的写法');
  } else no('旧件那段里出现了重造堆栈/写死满耐久 —— 磨损会被洗掉');
  if (/out\.set\(plan\.rodIndex/.test(rem)) ok('旧件放回竿原来那一格（原版的合成剩余物机制）');
  else no('旧件没有放回竿那一格 —— 它可能根本回不到玩家手里');
}

// ---------------------------------------------------------------- 手册（唯一的发现途径）
// ⚠ 必须**按页**判，不能在整份文本上做子串匹配：手册别处就有"工作台"（讲两本书的
//   无序合成）和"2×2×2 的水里"（讲水体体积）—— 第一版就是全文匹配，
//   于是把这一页整段删掉它照样绿（负向测试当场戳穿了）。
{
  let guideDoc = null;
  try {
    guideDoc = JSON.parse(read(GUIDE));
  } catch (e) {
    no('手册 guide.json 不是合法 JSON：' + e.message);
  }
  const pages = [];
  for (const c of (guideDoc && guideDoc.chapters) || []) {
    for (const p of c.pages || []) pages.push((Array.isArray(p) ? p : [p]).join('\n'));
  }
  // ⚠ 判据里还必须带上"配件 / 装配"这个**语义**：只查"工作台/合成栏 + 2×2"的话，
  //   手册第一章讲"线索要 9 个格子、随身 2×2 合成栏放不下"那一页也会命中 ——
  //   它讲的是**线索配方**，跟"用合成栏装配件"毫无关系。2026-10-02 就是这样
  //   把 negtest 的 craftasm-no-guide 变成假通过的（删掉装配页，检查器照样绿，
  //   因为第一章那页替它满足了条件）。
  const hit = pages.filter((t) => /(工作台|合成栏)/.test(t) && /2×2|2x2/.test(t)
    && /(配件|装配)/.test(t));
  if (hit.length) {
    ok('手册里有 ' + hit.length + ' 页同时写了"工作台/合成栏"+"2×2"+"配件/装配"'
      + '（special 配方进不了配方书，手册是玩家唯一的发现途径）');
  } else {
    no('手册里没有"工作台 / 随身 2×2 合成栏"这条装配方式的说明 —— ' +
      'special 配方在配方书里根本不出现，玩家不会知道可以这样装配件');
  }
}

console.log('');
console.log(bad === 0
  ? '✅ 工作台与随身合成栏都能装配件：产出跟着竿走、旧件退回、带耐久'
  : '❌ 合成栏装配件检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
