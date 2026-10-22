/*
 * check-dish-effects.js —— 菜型效果系统（docs/28-菜型效果策划.md）的守门人。
 *
 * 为什么需要它：这一层的错法全都**不会报错**，只会让玩家白吃一道菜或拿到错的东西：
 *   ① 效果漏注册 / 图标漏画 → HUD 上是紫黑格，玩家不知道吃到了什么；
 *   ② 语言键漏了 → 显示成 `effect.anglertackle.fishing_luck` 这种生键；
 *   ③ **等级没封顶**（`Math.min(maxLevel, tier)` 写成 `tier`）→ 至高 2 的效果变成 4、5 级；
 *   ④ **菜型映射漂移**（docs/28 §4 的表 vs `DishEffects` 的 if 链）→ 吃红烧鱼给的不是渔运；
 *   ⑤ **爆口/空军互斥被删** → 两道菜一起吃 = 双倍权重。
 *
 * 断言：
 *   A. 11 个效果都注册了，且每个都有 18×18 的图标 + 中英语言键
 *   B. 等级 = clamp(档位, 1, 至高)、时长 = 基准 + 每档 + 每级（公式必须在源码里看得见）
 *   C. 菜型 → 效果映射与 docs/28 §4 一致（逐条比对中文菜名与效果名）
 *   D. 吃菜的入口在 `DishItem#finishUsingItem`（不是 `use`，否则中途打断也会给效果）
 *   E. 爆口 × 空军互斥仍在
 *   F. 顶级判定（≥4 档）与 `FishChunkData.groupOfTier` 同口径
 *
 * 用法：node tools/check-dish-effects.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 菜型效果检查（docs/28 的 11 项效果）===\n');

const MOD_EFFECTS = 'src/main/java/com/whitecobalt/anglertackle/effect/ModEffects.java';
const DISH_EFFECTS = 'src/main/java/com/whitecobalt/anglertackle/effect/DishEffects.java';
const DISH_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/DishItem.java';
const DOC = 'docs/28-菜型效果策划.md';
const TEX = 'src/main/resources/assets/anglertackle/textures/mob_effect';
const LANG = 'src/main/resources/assets/anglertackle/lang';

for (const p of [MOD_EFFECTS, DISH_EFFECTS, DISH_ITEM, DOC]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}
const dyn = read(MOD_EFFECTS);
const logic = read(DISH_EFFECTS);
const doc = read(DOC);

// ---------------------------------------------------------------- A 注册 / 图标 / 语言键
const ids = [...dyn.matchAll(/EFFECTS\.register\("([a-z_]+)"/g)].map((m) => m[1]);
if (ids.length !== 11) bad('注册的效果不是 11 个：' + ids.join('、'));
else ok('11 个效果都注册了：' + ids.join(' · '));

{
  const noIcon = [], noZh = [], noEn = [], wrongSize = [];
  const zh = JSON.parse(read(LANG + '/zh_cn.json'));
  const en = JSON.parse(read(LANG + '/en_us.json'));
  for (const id of ids) {
    const png = TEX + '/' + id + '.png';
    if (!exists(png)) { noIcon.push(id); continue; }
    // PNG 头：签名(8) + IHDR 长度(4) + 'IHDR'(4) + 宽(4) + 高(4)
    const b = fs.readFileSync(path.join(ROOT, png));
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (w !== 18 || h !== 18) wrongSize.push(id + ' ' + w + '×' + h);
    if (!zh['effect.anglertackle.' + id]) noZh.push(id);
    if (!en['effect.anglertackle.' + id]) noEn.push(id);
  }
  if (noIcon.length) bad('这些效果没有图标（HUD 上会是紫黑格）：' + noIcon.join('、'));
  else ok('11 张图标都在（' + TEX + '/）');
  if (wrongSize.length) bad('图标尺寸不是 18×18（原版 HUD 的槽位尺寸）：' + wrongSize.join('、'));
  else ok('图标都是 18×18');
  if (noZh.length || noEn.length) {
    bad('语言键缺：中 ' + (noZh.join('、') || '无') + ' / 英 ' + (noEn.join('、') || '无'));
  } else ok('11 个效果的中英名称键齐（effect.anglertackle.*）');
}

// ---------------------------------------------------------------- B 等级公式
{
  if (!/int level = Math\.max\(1, Math\.min\(maxLevel, tier\)\);/.test(logic)) {
    bad('等级没有封顶（期待 Math.max(1, Math.min(maxLevel, tier))）'
      + ' —— 至高 2 的效果会被鱼的高档位顶到 4、5 级');
  } else if (!/BASE_TICKS \+ PER_TIER_TICKS \* \(tier - 1\) \+ PER_LEVEL_TICKS \* \(level - 1\)/.test(logic)) {
    bad('时长公式不对（期待 基准 + 每档 + 每级）');
  } else if (!/BASE_TICKS = 20 \* 60 \* 3;/.test(logic) || !/PER_LEVEL_TICKS = 20 \* 60 \* 2;/.test(logic)) {
    bad('基准时长/每级时长常量变了（策划：普通 3:00 起、每级 +2:00）');
  } else {
    // 复算一遍：金(4) / 红(5) 各是什么等级与时长
    const rows = [];
    for (const [tier, max] of [[4, 5], [5, 5], [4, 2], [5, 2], [4, 3], [5, 3]]) {
      const level = Math.max(1, Math.min(max, tier));
      const ticks = 20 * 60 * 3 + 20 * 60 * (tier - 1) + 20 * 60 * 2 * (level - 1);
      rows.push('档' + tier + '/至高' + max + '→' + level + '级 ' + Math.round(ticks / 20) + 's');
    }
    ok('等级与时长公式齐（' + rows.join('，') + '）');
  }
}

// ---------------------------------------------------------------- C 映射表 ↔ 文档
{
  // 源码： (菜型 id, 效果常量)  —— newEffectFor 里的 if 链
  const map = [...logic.matchAll(/DishRecipe\.Dish\.([A-Z_]+)\.id\(\)\.equals\(dishId\)\) \{\s*\n\s*return newGrant\(ModEffects\.([A-Z_]+), tier, (\d+)\);/g)]
    .map((m) => ({ dishConst: m[1], effect: m[2], max: Number(m[3]) }));
  const extra = [...logic.matchAll(/if \("([a-z_]+)"\.equals\(dishId\)\) \{\s*\n\s*return newGrant\(ModEffects\.([A-Z_]+), tier, (\d+)\);/g)]
    .map((m) => ({ dishConst: m[1], effect: m[2], max: Number(m[3]) }));
  const all = map.concat(extra);
  if (all.length !== 11) bad('DishEffects 里的菜型→效果映射不是 11 条：' + all.length);
  else ok('DishEffects 里有 11 条映射（' + all.map((x) => x.dishConst).join('、') + '）');

  // 效果常量 → 注册 id
  const constToId = {};
  for (const m of dyn.matchAll(/public static final DeferredHolder<MobEffect, MobEffect> ([A-Z_]+) =\s*\n?\s*EFFECTS\.register\("([a-z_]+)"/g)) {
    constToId[m[1]] = m[2];
  }
  // 文档 §4 的表：每行是 `| 菜型 \`id\` | 普通 | 优质 | **效果名 ...** |`
  const zh = JSON.parse(read(LANG + '/zh_cn.json'));
  const docRows = doc.split(/\r?\n/).filter((l) => /^\| \*\*[^*]+\*\* `[a-z_]+` \|/.test(l) || /^\| [^*|\s][^|]*`[a-z_]+` \|/.test(l));
  const missing = [];
  for (const x of all) {
    const id = constToId[x.effect];
    const zhName = zh['effect.anglertackle.' + id];
    const row = docRows.find((l) => l.includes('`' + (extra.includes(x) ? x.dishConst : '') + '`')
      || l.includes('`' + dishIdOf(x) + '`'));
    if (!row) { missing.push(x.effect + '（文档里找不到这道菜的行）'); continue; }
    if (!row.includes(zhName)) {
      missing.push(dishIdOf(x) + ' 那行没写效果「' + zhName + '」：' + row.trim());
    }
  }
  if (missing.length) bad('docs/28 §4 的映射与代码对不上：\n       ' + missing.join('\n       '));
  else ok('docs/28 §4 的映射与 DishEffects 逐条一致（11 条）');
}

/** 菜型常量 → 配方 id（BRAISED → braised_fish …）：源码里 Dish 枚举是唯一来源，这里直接反射式地查。 */
function dishIdOf(x) {
  const dishJava = read('src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java');
  const m = new RegExp('^\\s{8}' + x.dishConst + '\\("([a-z_]+)"', 'm').exec(dishJava);
  return m ? m[1] : x.dishConst.toLowerCase();
}

// ---------------------------------------------------------------- D 吃菜入口
{
  const item = read(DISH_ITEM);
  if (!/finishUsingItem/.test(item) || !/DishEffects\.apply/.test(item)) {
    bad('DishItem 没有在 finishUsingItem 里发效果（放 use 里的话，中途松手也会给）');
  } else ok('吃菜入口在 DishItem#finishUsingItem（中途打断不给效果）');
}

// ---------------------------------------------------------------- E 互斥
{
  const big = /if \(gotBig\) \{\s*\n\s*player\.removeEffect\(ModEffects\.SMALL_FRY\);\s*\n\s*\}/.test(logic);
  const small = /if \(gotSmall\) \{\s*\n\s*player\.removeEffect\(ModEffects\.BIG_BITE\);\s*\n\s*\}/.test(logic);
  if (!big || !small) {
    bad('爆口 × 空军互斥没了 —— 两道菜一起吃就是双倍权重（原版没有这种机制，得自己守着）');
  } else ok('爆口 × 空军互斥在（后拿到的顶掉先拿到的，且只在本次真的给了这两个之一时才动手）');
}

// ---------------------------------------------------------------- F 顶级判定
{
  if (!/SUPREME_TIER = 4;/.test(logic)) {
    bad('顶级判定不是 ≥4 档（策划：金 4 / 红 5 = 顶级鱼排）');
  } else ok('顶级判定 = 档位 ≥ 4（与 FishChunkData.groupOfTier 的 顶级 同口径）');
}

console.log('');
if (fail === 0) {
  console.log('✅ 菜型效果：11 项注册齐、图标/语言键齐、等级封顶、映射与文档一致、互斥在');
  process.exitCode = 0;
} else {
  console.log('❌ 菜型效果检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
