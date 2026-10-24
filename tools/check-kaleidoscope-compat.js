/*
 * check-kaleidoscope-compat.js —— 森罗物语（Kaleidoscope）联动的守门人（docs/30）。
 *
 * 用户 2026-10-03 定案的两条红线：
 *   ① **不改森罗 mod 的任何一行代码/资源**（他们的 jar 一个字节都不碰）；
 *   ② **不装森罗时我们完全照旧**。
 *
 * 而"适配"能做的只有两件官方认可的事：往**通用/他们的标签**里加我们的物品（data 包是合并、
 * 不是覆盖），以及**我们自己的**配方/代码用标签收料。这一层的错法全都不报错：
 *   · 标签里引用了他们的物品却没写 `required:false` → **没装森罗时整个标签加载失败**，
 *     连带我们的配方全废（原版 TagLoader 会直接判这个标签为"缺失引用"）；
 *   · 反过来把入口写成 `required:true`（默认）也一样；
 *   · 把我们的鱼挂进 `c:foods/raw_salmon` 这种**具体鱼种**标签 → 他们的"鲑鱼刺身"配方
 *     会接受鲫鱼，语义错还骗玩家；
 *   · 在 `data/kaleidoscope_cookery/recipe/**` 放文件 → 那是**覆盖他们的配方**；
 *   · 替代标签里漏掉我们自己的原物品 → 玩家没装森罗时反而做不出菜；
 *   · 主 jar 里出现他们的类名 → 变成**硬依赖**，没装森罗直接崩。
 *
 * 断言：
 *   A. 不越界：我们的 data 下不存在 data/kaleidoscope_cookery/recipe/**
 *   B. 可选条目：引用他们物品 id 的标签条目必须 required:false
 *   C. 替代不丢原件：每个替代标签必须含我们自己的原物品
 *   D. 语义不串味：我们的整鱼不在具体鱼种标签（raw_salmon/raw_cod/tropical_fish）里
 *   E. 无硬依赖：主 jar 源码里不出现 kalidoscope 相关类名
 *   F. 需求走标签：DishRecipe 的油/盐/刀必须走 ModTags，不许写回死物品
 *   G. 文案对账：界面/悬浮的替代文案由 Dish#substituteNames 从标签现算
 *
 * 用法：node tools/check-kaleidoscope-compat.js
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

console.log('=== 森罗物语联动检查（docs/30）===\n');

const THEIR_NS = 'kaleidoscope';          // 他们所有 jar 的命名空间前缀
const OUR_TAGS = 'src/main/resources/data/anglertackle/tags/item';
const OURS = {
  cooking_oil: ['anglertackle:fish_oil'],
  salt: ['anglertackle:salt'],
  kitchen_knife: ['anglertackle:fish_knife'],
  cooked_fish_chunk: ['anglertackle:fish_chunk_cooked', 'anglertackle:fine_fish_meat_cooked',
    'anglertackle:supreme_fish_steak_cooked', 'anglertackle:smoked_fish', 'anglertackle:charred_fish'],
  raw_fish_chunk: ['anglertackle:fish_chunk', 'anglertackle:fine_fish_meat', 'anglertackle:supreme_fish_steak'],
};
const DISH_RECIPE = 'src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java';
const SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/CookbookScreen.java';
const DISH_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/DishItem.java';

for (const p of [DISH_RECIPE, SCREEN, DISH_ITEM, 'docs/30-森罗物语联动策划.md']) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}

// 收集仓库里所有 data/*/tags/item/**.json
const tagFiles = [];
const walkTags = (dir) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walkTags(rel);
    else if (e.name.endsWith('.json')) tagFiles.push(rel);
  }
};
walkTags('src/main/resources/data');

// ---------------------------------------------------------------- A 不越界
{
  const overreach = tagFiles.filter((f) => f.includes('/data/kaleidoscope') && f.includes('/recipe/'))
    .concat(fs.existsSync(path.join(ROOT, 'src/main/resources/data/kaleidoscope_cookery/recipe'))
      ? ['src/main/resources/data/kaleidoscope_cookery/recipe/**'] : []);
  if (overreach.length) {
    bad('我们的 data 包里有 ' + overreach.join('、') + ' —— 那是**覆盖他们的配方**，踩红线');
  } else {
    ok('没有覆盖他们的配方（我们的 data 里只有 tags 合并）');
  }
}

// ---------------------------------------------------------------- B 可选条目
{
  const problems = [];
  for (const f of tagFiles) {
    const doc = JSON.parse(read(f));
    for (const v of doc.values || []) {
      const id = typeof v === 'string' ? v : v.id;
      const required = typeof v === 'string' ? true : v.required !== false;
      // 只看引用**他们命名空间**的条目（我们自己的物品必须 required，缺了才该报错）
      if (typeof id === 'string' && id.includes(THEIR_NS) && required) {
        problems.push(f + ' 里的 ' + id + ' 没写 "required": false');
      }
    }
    // 引用他们命名空间的条目：字符串写法也等于 required:true
    for (const v of doc.values || []) {
      if (typeof v === 'string' && v.includes(THEIR_NS)) {
        problems.push(f + ' 里的 ' + v + ' 用了字符串写法（等于 required:true）');
      }
    }
  }
  if (problems.length) {
    bad('引用他们物品的标签条目必须 required:false —— 否则**没装森罗时整个标签加载失败**：\n       '
      + [...new Set(problems)].join('\n       '));
  } else {
    ok('所有引用他们物品的标签条目都带 required:false（没装森罗时标签照常加载）');
  }
}

// ---------------------------------------------------------------- C 替代不丢原件
{
  const missing = [];
  for (const [tag, want] of Object.entries(OURS)) {
    const rel = OUR_TAGS + '/' + tag + '.json';
    if (!exists(rel)) { missing.push('缺标签文件 ' + rel); continue; }
    const doc = JSON.parse(read(rel));
    const ids = (doc.values || []).map((v) => (typeof v === 'string' ? v : v.id));
    for (const w of want) {
      if (!ids.includes(w)) missing.push(rel + ' 里少了我们自己的 ' + w);
    }
  }
  if (missing.length) bad('替代标签内容不对：\n       ' + missing.join('\n       '));
  else ok('五个替代标签都在，且都含我们自己的原物品（没装森罗时照样能玩）');
}

// ---------------------------------------------------------------- D 语义不串味
{
  const badTags = ['raw_salmon', 'raw_cod', 'tropical_fish'];
  const problems = [];
  for (const f of tagFiles) {
    if (!/\/data\/c\/tags\/item\//.test(f)) continue;
    const name = f.split('/').pop().replace('.json', '');
    if (!badTags.includes(name)) continue;
    const doc = JSON.parse(read(f));
    const ids = (doc.values || []).map((v) => (typeof v === 'string' ? v : v.id));
    if (ids.some((i) => String(i).includes('anglertackle'))) {
      problems.push(f + ' 里有我们的物品 —— 那是"这条是' + name + '"的具体鱼种标签');
    }
  }
  if (problems.length) {
    bad('我们的鱼不许进具体鱼种标签（会让"鲑鱼刺身"配方接受鲫鱼）：\n       ' + problems.join('\n       '));
  } else ok('我们的鱼没有混进具体鱼种标签（只进 c:raw_fishes 这类"鱼的集合"）');
}

// ---------------------------------------------------------------- E 无硬依赖
{
  const hits = [];
  const walkJava = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walkJava(rel);
      else if (e.name.endsWith('.java')) {
        const src = stripComments(read(rel));
        if (src.includes(THEIR_NS)) hits.push(rel);
      }
    }
  };
  walkJava('src/main/java');
  if (hits.length) {
    bad('主 jar 的源码里出现了他们的类名（' + hits.join('、') + '）—— 那会变成**硬依赖**，'
      + '没装森罗直接崩。要碰他们的 API 只能放进扩展包（compat-kaleidoscope，docs/30 §3）');
  } else ok('主 jar 源码里没有任何他们的类名（无编译依赖；扩展包另开一个 jar）');
}

// ---------------------------------------------------------------- F 需求走标签
{
  const src = stripComments(read(DISH_RECIPE));
  const want = [
    ['OIL', /private static final Need OIL = mat\(ModTags\.COOKING_OIL,/],
    ['SALT', /private static final Need SALT = mat\(ModTags\.SALT,/],
    ['FISH_KNIFE', /private static final Need FISH_KNIFE = knife\(ModTags\.KITCHEN_KNIFE,/],
  ];
  const problems = want.filter(([, re]) => !re.test(src)).map(([n]) => n + ' 没有走标签');
  if (problems.length) {
    bad('这些配料又写回死物品了（那样别的模组的同类物品就顶不了）：' + problems.join('、'));
  } else ok('油/盐/厨刀三样配料都走标签（别的模组的同类物品能顶）');
}

// ---------------------------------------------------------------- G 文案对账
{
  const dish = stripComments(read(DISH_ITEM));
  const screen = stripComments(read(SCREEN));
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
  if (!/dish_substitute/.test(dish) || !/substituteNames\(/.test(dish)) {
    bad('菜的悬浮显示没有"配料可用同类替代"那一行（或不是从标签现算的）');
  } else if (!/substituteNames\(/.test(screen)) {
    bad('菜谱界面的配料行不是从标签现算的 —— 会出现"界面写着能替代、实际不行"');
  } else if (!zh['tooltip.anglertackle.dish_substitute'] || !en['tooltip.anglertackle.dish_substitute']) {
    bad('缺 dish_substitute 的中英语言键');
  } else if (!/%s/.test(zh['tooltip.anglertackle.dish_substitute'])) {
    bad('dish_substitute 里没有 %s —— 替代物名字没地方显示');
  } else {
    const recipe = stripComments(read(DISH_RECIPE));
    // 26.1.2：Ingredient.of(TagKey) 已删除（改用 Ingredient.of(HolderSet<Item>)，由
    // BuiltInRegistries.ITEM.getOrThrow(tag) 现取），getItems() 改名 items()（Stream<Holder<Item>>）。
    // 断言语义不变：这一行的名字必须**从标签现算**，而不是手抄一份列表。
    if (!/tagIngredient\(n\.tag\(\)\)\.items\(\)/.test(recipe)
        || !/Ingredient\.of\(\s*BuiltInRegistries\.ITEM\.getOrThrow\(\s*tag\s*\)\s*\)/.test(recipe)) {
      bad('substituteNames 不是从标签取名字的（应为 tagIngredient(n.tag()).items()，'
        + '且 tagIngredient 走 Ingredient.of(BuiltInRegistries.ITEM.getOrThrow(tag))）—— 那就不是"现算"');
    } else ok('替代文案由 Dish#substituteNames 从标签现算，中英语言键齐');
  }
}

// ---------------------------------------------------------------- H 兼容配方（用他们的厨具做我们的菜）
{
  const DIR = 'src/main/resources/data/anglertackle/recipe/kaleidoscope';
  if (!exists(DIR)) {
    bad('缺 ' + DIR + ' —— 那些"用森罗厨具做我们的菜"的配方没地方放');
  } else {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir + '/' + e.name;
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith('.json')) files.push(rel);
      }
    };
    walk(DIR);
    const problems = [];
    for (const f of files) {
      const doc = JSON.parse(read(f));
      // ① 必须包 mod_loaded：没装森罗时这些配方不能存在（否则加载器找不到他们的配方类型会报错）
      const conds = doc['neoforge:conditions'] || [];
      if (!conds.some((c) => c.type === 'neoforge:mod_loaded' && c.modid === 'kaleidoscope_cookery')) {
        problems.push(f + ' 没有 neoforge:mod_loaded 条件（没装森罗时会加载失败）');
      }
      // ② 类型必须是他们的
      if (!String(doc.type || '').includes(THEIR_NS)) {
        problems.push(f + ' 的类型不是他们的厨具：' + doc.type);
      }
      // ③ 产物必须是**我们的**菜（不然就是在替他们做菜）
      const rid = (doc.result && doc.result.id) || '';
      if (!rid.startsWith('anglertackle:')) {
        problems.push(f + ' 的产物不是我们的物品：' + rid);
      }
      // ④ 配料只许引用我们的物品/标签或原版（引用他们物品时用标签，避免硬编码他们的 id）
      const ing = doc.ingredients || (doc.ingredient ? [doc.ingredient] : []);
      // 26.1.2 的配方材料是新语法：普通物品写字符串（"minecraft:sugar_cane"），
      // 标签写 "#c:xxx"。旧的 {"item":…} / {"tag":…} 对象也照样认。
      const norm = (x) => {
        if (typeof x === 'string') return x.startsWith('#') ? { tag: x.slice(1) } : { item: x };
        return x && typeof x === 'object' ? x : {};
      };
      for (const one of ing.flat().map(norm)) {
        const ref = one.item || one.tag;
        if (!ref) { problems.push(f + ' 有一条空配料'); continue; }
        const bare = String(ref).replace(/^#/, '');
        if (!/^(anglertackle|minecraft|c):/.test(bare) && !bare.startsWith('#')) {
          problems.push(f + ' 的配料引用了第三方 id：' + ref + '（该走标签）');
        }
      }
    }
    if (!files.length) bad(DIR + ' 里一条配方都没有 —— "用他们的锅做我们的菜"就没落地');
    else if (problems.length) bad('兼容配方有问题：\n       ' + problems.join('\n       '));
    else ok(files.length + ' 条"用他们的厨具做我们的菜"的配方都合规（带 mod_loaded / 类型是他们的 / 产物是我们的）');
  }
}

// ---------------------------------------------------------------- H 扩展包（src/compat）
// 扩展包是**唯一**允许出现他们类名的地方（主 jar 那条断言 E 在守另一边）。
// 它必须：① 只用公开 API/事件签名碰得到的类型；② 只放 META-INF（不覆盖他们的 data/assets）；
// ③ 声明 required 依赖他们与我们（不装就整包不加载）；④ 产物是 thin jar（不许把他们的类打进去）。
{
  const SRC = 'src/compat/java';
  const RES = 'src/compat/resources';
  const TOML = RES + '/META-INF/neoforge.mods.toml';
  /**
   * 允许 import 的他们的包 —— **白名单闸门**：多一个包就得有人改这份清单。
   * · api.**                 他们公开给第三方用的（事件、方块实体接口、物品接口）
   * · crafting.recipe.*      事件签名里就有 StockpotRecipe，绕不开
   * · crafting.container.*   事件签名里就有 StockpotInput
   * · blockentity.kitchen.ChoppingBoardBlockEntity  只有它暴露"板上是哪一个物品"
   *   （IChoppingBoard 接口没有读板内容的访问器），而我们要按那个物品算份数
   * · blockentity.kitchen.PotBlockEntity  炒锅没有事件，读 status/inputs/result 只能走具体类
   * · blockentity.kitchen.SteamerBlockEntity  蒸笼同理（它连"里面是什么"都没有公开读取口，
   *   只有进度/时间的 int[]，所以我们改成"放料时自己记账、取出时按坐标取回"）
   * · init.ModRecipes        汤锅 Pre 事件里 getOutput() 是空的，必须自己按他们的
   *   RecipeType 匹配一遍（见 StockpotTakeover 的类注释），而类型常量就在这个类里
   */
  const ALLOWED = [
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.api\./,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.crafting\.recipe\.StockpotRecipe$/,
    // ⚠ FlexStockpotRecipe **不是** StockpotRecipe 的子类（都只 implements BaseRecipe），
    //   匹配到 flex 配方时要分别 instanceof 取字段再拼一个 StockpotRecipe —— 强转会崩服务端
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.crafting\.recipe\.FlexStockpotRecipe$/,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.crafting\.recipe\.StockpotVisuals$/,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.crafting\.container\./,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.blockentity\.kitchen\.ChoppingBoardBlockEntity$/,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.init\.ModRecipes$/,
    // 炒锅"出锅"那一下要判手里是不是他们的锅铲（KITCHEN_SHOVEL 标签就在这个类里）
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.init\.tag\.TagMod$/,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.blockentity\.kitchen\.PotBlockEntity$/,
    /^com\.github\.ysbbbbbb\.kaleidoscopecookery\.blockentity\.kitchen\.SteamerBlockEntity$/,
  ];
  /** 他们 jar 的 sha256 —— **冻结值**：证明我们从来没写过他们的文件（只读红线）。 */
  const THEIR_JAR = 'libs/kaleidoscope_cookery-1.4.1.jar';
  const THEIR_SHA = '04dd114f975df57fb8bb3f09e8c96d6de18587838ab5a019271b51a2aec24f74';

  if (!exists(SRC) || !exists(TOML)) {
    bad('扩展包不见了：' + SRC + ' / ' + TOML + '（P3–P6 的产物，别整个删掉）');
  } else {
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = dir + '/' + e.name;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.java')) files.push(p);
      }
    })(SRC);

    // ① 只用允许的包
    const illegal = [];
    for (const f of files) {
      for (const m of stripComments(read(f)).matchAll(/^import\s+(com\.github\.ysbbbbbb\.kaleidoscopecookery[\w.]*)\s*;/gm)) {
        if (!ALLOWED.some((re) => re.test(m[1]))) illegal.push(f + ' → ' + m[1]);
      }
    }
    if (illegal.length) {
      bad('扩展包 import 了允许清单以外的他们的类（要新增就得有人来改这份清单）：\n       ' + illegal.join('\n       '));
    }

    // ② 资源只许是 META-INF
    const stray = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = dir + '/' + e.name;
        if (e.isDirectory()) walk(p);
        else stray.push(p);
      }
    })(RES);
    const strayBad = stray.filter((p) => !p.startsWith(RES + '/META-INF/'));
    if (strayBad.length) bad('扩展包的资源里出现了 META-INF 之外的东西（那是往他们/我们的 data 里塞文件）：' + strayBad.join(', '));

    // ③ mods.toml：自己的 modId + 两个 required 依赖
    const toml = read(TOML);
    const id = (toml.match(/^\s*modId\s*=\s*"([^"]+)"/m) || [])[1];
    if (id !== 'anglertackle_kaleidoscope') {
      bad('扩展包的 modId 是 ' + JSON.stringify(id) + '，必须是与主 jar 不同的 anglertackle_kaleidoscope（同 id 两个 jar 会被 FML 判重）');
    }
    for (const dep of ['anglertackle', 'kaleidoscope_cookery']) {
      const re = new RegExp('modId\\s*=\\s*"' + dep + '"[\\s\\S]{0,200}?type\\s*=\\s*"required"');
      if (!re.test(toml)) bad('扩展包没有把 ' + dep + ' 声明成 required 依赖 —— 不装它时这个包会照常加载然后崩');
    }
    if (!/modId\s*=\s*"anglertackle"[\s\S]{0,200}?ordering\s*=\s*"AFTER"/.test(toml)) {
      bad('扩展包对 anglertackle 没有 ordering="AFTER" —— 我们的物品/数据组件可能还没注册好');
    }

    // ④ 产物是 thin jar：不许把他们的类打进去
    // ⚠ 判据是**条目名**，不是裸字节搜索：zip 条目内容是压缩的，搜字符串会漏判（这次踩了）
    const entryNames = (p) => {
      const buf = fs.readFileSync(p);
      let eocd = buf.length - 22;
      while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
      if (eocd < 0) return null;
      let off = buf.readUInt32LE(eocd + 16);
      const count = buf.readUInt16LE(eocd + 10);
      const names = [];
      for (let i = 0; i < count; i++) {
        if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
        off += 46 + nameLen + extraLen + commentLen;
      }
      return names;
    };
    const compatJar = 'build/libs/anglertackle-kaleidoscope-1.0.0.jar';
    const libsDir = path.join(ROOT, 'build/libs');
    const mainJar = fs.existsSync(libsDir)
      ? fs.readdirSync(libsDir).filter((f) => /^anglertackle-[\d.]+\.jar$/.test(f))
      : [];
    if (exists(compatJar)) {
      const names = entryNames(path.join(ROOT, compatJar));
      if (!names) {
        bad('读不出扩展包的条目表：' + compatJar);
      } else {
        if (names.some((n) => n.startsWith('com/github/ysbbbbbb/'))) {
          bad('扩展包里打进了他们的类 —— 那既越界，也让"卸掉森罗"失效');
        }
        if (!names.includes('META-INF/neoforge.mods.toml')) {
          bad('扩展包里没有 META-INF/neoforge.mods.toml —— NeoForge 不会加载它');
        }
        if (!names.some((n) => n.startsWith('com/whitecobalt/anglertackle/compat/kaleidoscope/'))) {
          bad('扩展包里没有我们自己的类 —— 源集没编进去？');
        }
      }
    } else {
      console.log('  ℹ 扩展包产物还没有（libs/ 里没放他们的 jar 时这是正常的）：跳过 jar 内容检查');
    }
    for (const f of mainJar) {
      const names = entryNames(path.join(libsDir, f)) || [];
      if (names.some((n) => n.startsWith('com/github/ysbbbbbb/') || n.startsWith('com/whitecobalt/anglertackle/compat/'))) {
        bad('主 jar ' + f + ' 里混进了扩展包/他们的东西 —— 说明源集隔离漏了');
      }
    }

    // ⑤ 他们的 jar 只读证明
    if (exists(THEIR_JAR)) {
      const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, THEIR_JAR))).digest('hex');
      if (sha !== THEIR_SHA) {
        bad('他们的 jar 变了（' + THEIR_JAR + '）\n       期望 ' + THEIR_SHA + '\n       实际 ' + sha
          + '\n       如果你是有意换版本，就同时更新这条冻结值；如果是无意 —— 我们违背了"只读"红线');
      }
    } else {
      console.log('  ℹ libs/ 里没有他们的 jar：扩展包不参与构建（主 jar 不受影响）');
    }

    if (fail === 0) {
      ok('扩展包 ' + files.length + ' 个源文件只用公开 API（白名单内）、资源只有 META-INF、mods.toml 依赖正确、产物是 thin jar');
    }
  }
}

// ---------------------------------------------------------------- I 部署护栏（2026-10-12 事故）
//
// ⚠ 那天用户**开不了游戏**，元凶就是部署脚本：
//   `build-deploy.ps1` 原来**无条件**把扩展包拷进 mods，注释还骗自己说"没装森罗时整包不加载"——
//   而扩展包把 kaleidoscope_cookery 声明成 `required`，FML 对 required 缺失的处理是
//   **判定 mod 加载失败并崩游戏**（crash-report 原文：
//   `Mod anglertackle_kaleidoscope requires kaleidoscope_cookery 1.4.0 or above`）。
//   更糟：用户早就用 PCL 禁用了它（`.jar.disabled`），无条件拷贝等于**把用户关掉的东西重新打开** ✗。
//
// 所以这里钉三条（都不看"注释怎么写"，只看代码怎么判）：
{
  const BD = 'tools/build-deploy.ps1';
  const bd = read(BD);
  const hasKaleido = /\$hasKaleido\s*=/.test(bd) && /Get-ChildItem\s+\$Mods\s+-Filter\s+'kaleidoscope\*\.jar'/.test(bd);
  // ⚠ 必须盯住**真的调了那个 cmdlet**，不能只搜"文件里有没有这个字符串"：
  //   脚本注释里就写着 `anglertackle-kaleidoscope-*.jar.disabled` 这句 —— 只搜字符串的话，
  //   把过滤器改成任何别的值、甚至删掉整段逻辑，断言照样通过（负例 kaleidoscope-ignore-disabled
  //   第一次跑就是这么溜过去的 ✗）。这是今天第四次同类：**"文件里存在某字符串" ≠ "那件事真的在做"**。
  const respectsDisabled = /Get-ChildItem[^\n]*Filter\s+'anglertackle-kaleidoscope-\*\.jar\.disabled'/.test(bd)
    && /\$compatDisabled\s*=/.test(bd);
  const guardedCopy = /if\s*\([^)]*\$hasKaleido[^)]*\$compatDisabled[^)]*\)\s*\{/.test(bd)
    || /if\s*\(\(Test-Path \$CompatJar\)\s*-and\s*\$hasKaleido\s*-and\s*-not\s*\$compatDisabled\)/.test(bd);
  const cleansStale = /已清掉之前误拷的/.test(bd);
  if (!hasKaleido) {
    bad(BD + ' 部署扩展包前没有检查"目标实例装了森罗" —— 没装森罗的实例会被它崩在加载阶段 ✗');
  } else if (!respectsDisabled) {
    bad(BD + ' 没有尊重 PCL 的 .jar.disabled 标记 —— 用户手动禁用的扩展包会被部署重新打开 ✗');
  } else if (!guardedCopy) {
    bad(BD + ' 拷贝扩展包那一步的条件里没有同时判"有森罗 + 没被禁用" ✗');
  } else if (!cleansStale) {
    bad(BD + ' 没有"顺手清掉之前误拷的启用副本" —— 踩过一次坑的实例下次启动照样崩 ✗');
  } else {
    ok('部署护栏在：只在"目标装了森罗且没被用户禁用"时才拷扩展包，并会清掉误拷的旧副本 ✓');
  }
  // 依赖必须仍是 required：改成 optional 只是把"明确的报错"换成"运行到一半 NoClassDefFoundError"
  //   ⚠ TOML 那个常量是在上面 H 块的**块级作用域**里定义的 ⇒ 这里要自己拼路径（第一次写就踩了 ✗）
  const tomlRel = 'src/compat/resources/META-INF/neoforge.mods.toml';
  if (/modId = "kaleidoscope_cookery"[\s\S]{0,120}?type = "required"/.test(read(tomlRel))) {
    ok('扩展包对森罗的依赖仍是 required（缺了就该明确报错，而不是运行到一半炸）✓');
  } else {
    bad('扩展包对森罗的依赖被改成非 required —— 那会把"加载期明确报错"换成"运行期随机炸" ✗');
  }
  // 那句错误的说法不许回来
  const cmd = read(tomlRel);
  if (/不装森罗时本包整包不加载/.test(cmd)) {
    bad('扩展包的 mods.toml 里又出现了"不装森罗时整包不加载"这句**错的**说法 —— '
      + '2026-10-12 就是它让用户开不了游戏 ✗');
  } else {
    ok('mods.toml 里没有那句错的说法（那条事故已写成实测纠正）✓');
  }
}

console.log('');
if (fail === 0) {
  console.log('✅ 森罗物语联动检查通过：不越界、可选项正确、替代不丢原件、无硬依赖、文案现算、部署有护栏');
  process.exitCode = 0;
} else {
  console.log('❌ 森罗物语联动检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
