/*
 * check-cooking.js —— 守住"加热三件套 + 榨油"这条链（docs/25 §14.2 / §13.4）。
 *
 * 为什么需要它：这几条配方的错法全都**不会报错**，只会让玩家吃亏或卡住：
 *   ① 少写一条配方（比如漏了顶级鱼排的烟熏）→ 那种材料拿去烟熏炉**什么都不出**；
 *   ② 熔炉那条的产物写成了熏鱼 → 三个设备产出撞车，"三设备三产出"的设计当场失效；
 *   ③ `DataCookingRecipe.assemble` 被"顺手优化"掉 → 烤完的块丢掉鱼种，
 *      后面所有菜都变成"没有名字的鱼"（而且 tooltip 只是变短，不报错）；
 *   ④ 多脂鱼名单与 docs/25 §13.4 不一致 → 某条鱼榨油时突然要两块。
 *
 * 断言：
 *   A. 9 条加热配方齐：3 档 × 3 设备，且**产物正确**（熔炉→对应档位的熟块、
 *      烟熏炉/营火→同一个 smoked_fish / charred_fish）
 *   B. 每个 JSON 的 type 与设备对应（chunk_smelting / chunk_smoking / chunk_campfire）
 *   C. 序列化器注册齐 4 个（cutting / chunk_smelting / chunk_smoking / chunk_campfire / oil_pressing）
 *   D. `DataCookingRecipe` 覆写了 assemble 且写入了 FISH_CHUNK（数据继承的保险丝）
 *   E. 榨油：多脂鱼名单与 docs/25 §13.4 的名单逐条一致；块数 1 / 2 与文档一致
 *   F. 配方书进度：每条配方都有对应的 advancement（生成器会读 ingredient 单数）
 *
 * 用法：node tools/check-cooking.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const RECIPE_JAVA = 'src/main/java/com/whitecobalt/anglertackle/recipe/DataCookingRecipe.java';
const OIL_JAVA = 'src/main/java/com/whitecobalt/anglertackle/recipe/OilPressingRecipe.java';
const MOD_RECIPES = 'src/main/java/com/whitecobalt/anglertackle/registry/ModRecipes.java';
const RDIR = 'src/main/resources/data/anglertackle/recipe';
const ADIR = 'src/main/resources/data/anglertackle/advancement/recipes';
const DOC = 'docs/25-鱼料理与配料方案.md';

console.log('=== 加热三件套 + 榨油 检查 ===\n');
for (const p of [RECIPE_JAVA, OIL_JAVA, MOD_RECIPES, DOC]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}

/** 三档材料 → 熔炉产物（烟熏/炭烤共用同一个成品菜物品）。 */
const TIERS = [
  ['fish_chunk', 'fish_chunk_cooked'],
  ['fine_fish_meat', 'fine_fish_meat_cooked'],
  ['supreme_fish_steak', 'supreme_fish_steak_cooked'],
];
const DEVICES = [
  ['chunk_smelting', null],                 // 产物按档位
  ['chunk_smoking', 'smoked_fish'],         // 三档都出熏鱼
  ['chunk_campfire', 'charred_fish'],       // 三档都出炭烤鱼
];

// A + B. 9 条配方
{
  const missing = [], wrongType = [], wrongResult = [];
  let n = 0;
  for (const [type, fixedOut] of DEVICES) {
    for (const [raw, cooked] of TIERS) {
      const out = fixedOut || cooked;
      const file = path.join(RDIR, raw + '_to_' + out + '.json');
      if (!exists(file)) { missing.push(raw + '→' + out); continue; }
      n++;
      const json = JSON.parse(read(file));
      if (json.type !== 'anglertackle:' + type) wrongType.push(file + ' 的 type=' + json.type);
      const gotIn = json.ingredient && json.ingredient.item;
      const gotOut = json.result && json.result.id;
      if (gotIn !== 'anglertackle:' + raw) wrongResult.push(file + ' 的输入=' + gotIn);
      if (gotOut !== 'anglertackle:' + out) wrongResult.push(file + ' 的产物=' + gotOut);
    }
  }
  missing.length ? bad('缺配方：' + missing.join('、')) : ok('9 条加热配方齐（3 档 × 熔炉/烟熏炉/营火）');
  wrongType.length ? bad('type 写错：' + wrongType.join('；')) : ok('每条配方的 type 与设备对应');
  wrongResult.length ? bad('输入/产物写错：' + wrongResult.join('；')) : ok('输入与产物逐条正确（熔炉按档位、熏/炭烤出同一成品菜物品）');
  if (n !== 9) bad('配方条数不是 9：' + n);
}

// C. 序列化器注册
{
  const src = read(MOD_RECIPES);
  const want = ['cutting', 'chunk_smelting', 'chunk_smoking', 'chunk_campfire', 'oil_pressing'];
  const miss = want.filter((id) => !src.includes('SERIALIZERS.register("' + id + '"'));
  miss.length ? bad('没注册的序列化器：' + miss.join('、')) : ok('5 个序列化器都注册了（切块/清烤/熏制/炭烤/榨油）');
}

// D. 数据继承的保险丝
{
  const src = read(RECIPE_JAVA);
  if (!/assemble\s*\(/.test(src)) bad('DataCookingRecipe 没有覆写 assemble');
  // ⚠ 只判 `FISH_CHUNK.get()` 会被"只有读、没有写"骗过去（负例 cook-no-data-copy 抓到的假绿）——
//   这里要求出现 **out.set(ModDataComponents.FISH_CHUNK.get(), ...)** 这个写入动作。
else if (!/out\.set\(\s*ModDataComponents\.FISH_CHUNK\.get\(\)/.test(src)) bad('DataCookingRecipe 的 assemble 里没有把 FISH_CHUNK 写到产物上（数据会丢）');
  else ok('DataCookingRecipe 覆写 assemble 并写入 FISH_CHUNK（鱼种/档位/重量继承）');
}

// D2. 营火那条必须继承**原版** CampfireCookingRecipe（JEI 会强转，2026-10-03 实机踩到）
{
  const CAMPFIRE = 'src/main/java/com/whitecobalt/anglertackle/recipe/ChunkCampfireRecipe.java';
  if (!exists(CAMPFIRE)) bad('缺文件：' + CAMPFIRE);
  else {
    const src = read(CAMPFIRE);
    if (!/class\s+ChunkCampfireRecipe\s+extends\s+CampfireCookingRecipe/.test(src)) {
      bad('ChunkCampfireRecipe 没有继承原版 CampfireCookingRecipe —— JEI 的营火分类里有一句'
        + ' `(CampfireCookingRecipe) recipe` 强转，会把三条营火配方全判成 broken recipe'
        + '（日志里报 ClassCastException，游戏里只表现为"查不到这几条配方"）');
    } else if (!/inheritChunkData\s*\(/.test(src)) {
      bad('ChunkCampfireRecipe 的 assemble 没有走 DataCookingRecipe.inheritChunkData（数据会丢）');
    } else ok('营火配方继承原版 CampfireCookingRecipe（JEI 不再 ClassCastException），数据继承仍走同一段逻辑');
  }
}

// D3. 创造模式 / JEI 直接拿到的鱼块与整鱼**必须带默认数据**
//     —— 否则它们永远做不了菜（用户 2026-10-03："即使显示能做也弄不了"）
//     ⚠ 这些默认值必须是**常数**：注册期去查 FishSpecies 会触发 FightProfile 的静态初始化
//       读配置 → "Cannot get config value before config is loaded"，专用服务器直接装不进去
//       （2026-10-03 起了一次专用服务器体检，第一轮就撞上）。所以这里同时核对常数与鱼种数据。
{
  const src = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
  // ⚠ 先剥注释再找"有没有查鱼种表"：那段 javadoc 里就写着 FishSpecies.byId（"不许查"），
  //   不剥注释的话会把警告文字当成违规代码 —— 第一次就是这么误报的。
  const { stripComments } = require('./java-source');
  const code = stripComments(src);
  const body = code.slice(code.indexOf('defaultFishData'),
      code.indexOf('private static final String[] SAMPLE_CHUNK_SPECIES'));
  const hasChunkDefault = /\.component\(ModDataComponents\.FISH_CHUNK\.get\(\),\s*sampleChunkData\(group\)\)/.test(code);
  const hasFishDefault = /\.component\(ModDataComponents\.FISH_DATA\.get\(\),\s*defaultFishData\(name\)\)/.test(code);

  if (!hasChunkDefault) {
    bad('生/熟鱼块的注册属性里没有默认 FISH_CHUNK 组件 —— 创造模式 / JEI 拿到的块做不出任何菜');
  } else if (!hasFishDefault) {
    bad('整鱼物品的注册属性里没有默认 FISH_DATA 组件 —— 创造模式 / JEI 拿到的鱼切不出块');
  } else if (/FishSpecies\.byId|\.tiers\(\)|\.specMinKg\(\)/.test(body)) {
    bad('默认数据里查了 FishSpecies —— 物品注册期配置还没加载，专用服务器会直接崩'
      + '（Cannot get config value before config is loaded）');
  } else {
    // 常数与鱼种数据对不对得上：档位必须在它的档位表里、体重必须在规格区间里
    const species = /SAMPLE_CHUNK_SPECIES = \{([^}]*)\}/.exec(src);
    const tiers = /SAMPLE_CHUNK_TIER = \{([^}]*)\}/.exec(src);
    const kgs = /SAMPLE_CHUNK_KG = \{([^}]*)\}/.exec(src);
    if (!species || !tiers || !kgs) {
      bad('读不到 SAMPLE_CHUNK_SPECIES / SAMPLE_CHUNK_TIER / SAMPLE_CHUNK_KG 三个常数表');
    } else {
      const ids = species[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
      const ts = tiers[1].split(',').map((s) => Number(s.trim()));
      const ks = kgs[1].split(',').map((s) => Number(s.trim().replace('f', '')));
      const spSrc = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
      const TABLES = {};
      for (const m of spSrc.matchAll(/private static final int\[\] ([A-Z_]+) = \{([0-9,\s]+)\};/g)) {
        TABLES[m[1]] = m[2].split(',').map((x) => Number(x.trim()));
      }
      const SPEC = new Map();
      for (const m of spSrc.matchAll(/new FishSpecies\("([a-z_]+)",[\s\S]*?,\s*([0-9.]+),\s*([0-9.]+),\s*([A-Z_]+),/g)) {
        SPEC.set(m[1], { minKg: Number(m[2]), maxKg: Number(m[3]), tiers: TABLES[m[4]] || [] });
      }
      const problems = [];
      for (let i = 0; i < ids.length; i++) {
        const sp = SPEC.get(ids[i]);
        if (!sp) { problems.push(ids[i] + ' 不在 FishSpecies.ALL 里'); continue; }
        if (!sp.tiers.includes(ts[i])) {
          problems.push(ids[i] + ' 的默认档位 ' + ts[i] + ' 不在它的档位表 ' + JSON.stringify(sp.tiers) + ' 里');
        }
        if (ks[i] < sp.minKg || ks[i] > sp.maxKg) {
          problems.push(ids[i] + ' 的默认体重 ' + ks[i] + 'kg 不在规格区间 ' + sp.minKg + '~' + sp.maxKg + ' 里');
        }
      }
      if (problems.length) bad('鱼块默认数据与鱼种数据对不上：' + problems.join('；'));
      else ok('鱼块与整鱼都带默认数据组件（常数版，且与鱼种的档位表/体重区间对得上）');
    }
  }
}

// E. 榨油名单与文档一致
{
  const src = read(OIL_JAVA);
  const m = /OILY_SPECIES\s*=\s*Set\.of\(([\s\S]*?)\);/.exec(src);
  if (!m) bad('读不到 OILY_SPECIES');
  else {
    const ids = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    // 文档里点名的 5 条多脂鱼（docs/25 §13.4）
    const wantIds = ['atlantic_salmon', 'bluefin_tuna', 'brown_trout', 'juvenile_shark', 'mullet'];
    if (JSON.stringify(ids) !== JSON.stringify(wantIds)) {
      bad('多脂鱼名单与文档不符：代码 ' + ids.join('/') + ' vs 文档 ' + wantIds.join('/'));
    } else ok('多脂鱼名单 5 条与 docs/25 §13.4 一致');
    const lean = /LEAN_CHUNKS\s*=\s*(\d+)/.exec(src);
    const oily = /OILY_CHUNKS\s*=\s*(\d+)/.exec(src);
    if (!lean || !oily) bad('读不到 LEAN_CHUNKS / OILY_CHUNKS');
    else if (Number(lean[1]) !== 2 || Number(oily[1]) !== 1) bad('块数与文档不符：普通 ' + lean[1] + ' / 多脂 ' + oily[1]);
    else ok('榨油块数：多脂 1 块、普通 2 块（用户指定）');
  }
}

// F. 配方书进度
{
  const missing = [];
  for (const [type, fixedOut] of DEVICES) {
    for (const [raw, cooked] of TIERS) {
      const name = raw + '_to_' + (fixedOut || cooked);
      if (!exists(path.join(ADIR, name + '.json'))) missing.push(name);
    }
  }
  // ⚠ 榨油以前是 special 配方（进不了配方书，所以可以没有进度）；
  //   2026-10-03 用户要求"内容写进原版配方书"之后它是非 special 了 → **必须有进度**，
  //   否则玩家永远解锁不了这条配方（配方书里看不到）。
  if (exists(path.join(RDIR, 'oil_pressing.json')) && !exists(path.join(ADIR, 'oil_pressing.json'))) {
    bad('oil_pressing 没有配方书解锁进度（它已改成非 special，配方书里要能解锁）');
  }
  missing.length ? bad('缺配方书进度：' + missing.join('、')) : ok('9 条加热配方都有配方书解锁进度');
}

console.log('');
if (fail === 0) {
  console.log('✅ 加热三件套 + 榨油 检查全部通过');
  process.exitCode = 0;
} else {
  console.log('❌ 加热三件套 + 榨油 检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
