/*
 * check-tooltip-colors.js —— "档位文字必须带品质色"的守门人。
 *
 * 用户 2026-10-03："自查所有悬浮显示，如出现顶级鱼等该显示颜色的文本却是白色，就改一下。"
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * 本模组有一条**贯穿全部界面**的约定：**颜色 = 品质**（白绿蓝紫金红），
 * 图鉴那一列就是这么做的。但悬浮显示是**一个个物品类各写各的**，
 * 于是同一条约定在几个地方各自漏了一点，而且都不报错、不崩，只是"看起来一样"：
 *   · FishChunkItem：按 group 手写了一张表（0 白 / 1 蓝 / 2 紫）——
 *     于是**绿档鱼块显示成白色**、**金红档的顶级鱼排显示成紫色**；
 *   · DishItem：档次那一段写死 GRAY —— "顶级"和"普通"长得一模一样；
 *   · FishItem：尺寸评级整行 GRAY —— "纪录级"与"幼体"差 3.5 倍售价却同一个颜色；
 *   · RodItem：档位上限那一行的档位名是 AQUA 的——那一行的全部意义就是那个字；
 *   · ChumItem：自己抄了一份 tierName/tierColor 表（与 Quality 重复）。
 *
 * 断言（都盯着**那一段组件**的颜色，而不是"文件里出现过 Quality"）：
 *   A. Quality 是唯一颜色源：color() + argb()（界面用）都在，argb 由 color 派生
 *   B. chunk_group.* 的两个消费点（DishItem / FishChunkItem）都按 data.tier() 上色
 *   C. FishItem 的尺寸评级值按档位上色
 *   D. RodItem 的"档位上限：金"里那个档位名按档位上色
 *   E. ChumItem / BaitItem 不再自己维护档位颜色表，一律走 Quality.of
 *   F. 菜谱界面的三档标签走 Quality.argb()（界面与 tooltip 同一个色源）
 *   G. docs/29 写下了这条约定与它踩过的坑
 *
 * 用法：node tools/check-tooltip-colors.js
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

console.log('=== 档位文字颜色检查（颜色 = 品质）===\n');

const ITEM = (n) => 'src/main/java/com/whitecobalt/anglertackle/item/' + n;
const QUALITY = ITEM('Quality.java');
const DISH = ITEM('DishItem.java');
const CHUNK = ITEM('FishChunkItem.java');
const FISH = ITEM('FishItem.java');
const ROD = ITEM('RodItem.java');
const CHUM = ITEM('ChumItem.java');
const BAIT = ITEM('BaitItem.java');
const COOKBOOK = 'src/main/java/com/whitecobalt/anglertackle/client/screen/CookbookScreen.java';
const DOC = 'docs/29-菜谱与悬浮显示.md';

for (const p of [QUALITY, DISH, CHUNK, FISH, ROD, CHUM, BAIT, COOKBOOK, DOC]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}
const quality = stripComments(read(QUALITY));
const dish = stripComments(read(DISH));
const chunk = stripComments(read(CHUNK));
const fish = stripComments(read(FISH));
const rod = stripComments(read(ROD));
const chum = stripComments(read(CHUM));
const bait = stripComments(read(BAIT));
const cookbook = stripComments(read(COOKBOOK));

/**
 * 取出"某段文字组件挂了什么颜色"。
 *
 * <p>这是本检查器的核心手法：**不能只断言"文件里出现过 Quality.of"** ——
 * 那样把颜色改回 GRAY、只要别处还留着一处 Quality.of 就会绿（负例抓过这种漏检）。
 * 所以这里定位到那个组件本身，看它紧跟的 withStyle(...) 用的是什么。
 */
function styleOf(src, anchor, label) {
  const m = new RegExp(anchor + '[\\s\\S]{0,200}?\\.withStyle\\(').exec(src);
  if (!m) {
    bad(label + '：找不到那个组件（锚点过时了？）');
    return null;
  }
  // 取 withStyle( 之后的一小段：够看到 Quality.of(...)/q.color()，又不会跨到下一个组件
  return src.slice(m.index + m[0].length, m.index + m[0].length + 120);
}

/** 这段颜色表达式里有没有出现"按档位取色"。 */
function hasQualityColor(style) {
  return /Quality\.of\(/.test(style);
}

/** 这段颜色表达式是不是写死的原版颜色（白/灰/紫/青 —— 档位文字最容易被写死的那几个）。 */
function hardcoded(style) {
  const m = /ChatFormatting\.(WHITE|GRAY|DARK_GRAY|LIGHT_PURPLE|AQUA)/.exec(style);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- A 唯一色源
{
  if (!/public ChatFormatting color\(\)/.test(quality) || !/public int argb\(\)/.test(quality)) {
    bad('Quality 没有 color()/argb() 两个出口 —— 界面与 tooltip 会各写一套颜色');
  } else if (!/argb\(\)[\s\S]{0,200}?color\.getColor\(\)/.test(quality)) {
    bad('Quality.argb() 不是从 color() 派生的（自己又写了一份十六进制色值）');
  } else if (/0xFF(?!000000)[0-9A-Fa-f]{6}/.test(quality)) {
    bad('Quality 里出现了手写的十六进制颜色（0xFF000000 的位掩码不算）—— 颜色只能来自 ChatFormatting');
  } else ok('Quality 是唯一色源：tooltip 用 color()、界面用 argb()，且 argb 由 color 派生');
}

// ---------------------------------------------------------------- B 鱼块 / 菜的档次
{
  const consumers = [];
  for (const rel of [DISH, CHUNK]) {
    if (/tooltip\.anglertackle\.chunk_group\./.test(stripComments(read(rel)))) consumers.push(rel);
  }
  if (consumers.length !== 2) {
    bad('chunk_group.* 的消费点不是 2 个（DishItem + FishChunkItem）：' + consumers.length + ' 个');
  } else {
    const dishStyle = styleOf(dish, 'Component\\.translatable\\("tooltip\\.anglertackle\\.chunk_group\\.', 'DishItem 的档次段');
    const chunkStyle = styleOf(chunk, 'Component\\.translatable\\("tooltip\\.anglertackle\\.chunk_group\\.', 'FishChunkItem 的档次段');
    const problems = [];
    for (const [name, style] of [['DishItem', dishStyle], ['FishChunkItem', chunkStyle]]) {
      if (style === null) continue;
      if (!hasQualityColor(style)) {
        const hard = hardcoded(style);
        problems.push(name + ' 的档次段' + (hard ? '写死成 ChatFormatting.' + hard : '没上品质色')
          + ' —— 按 group 手写表会让绿档显白、金红档的顶级显紫');
      }
    }
    if (problems.length) bad(problems.join('；'));
    else ok('鱼块与菜的档次段都按 data.tier() 取色（绿档绿、顶级金/红，不再一律白/紫）');
  }
}

// ---------------------------------------------------------------- C 鱼的尺寸评级
{
  const style = styleOf(fish, '"grade\\.anglertackle\\." \\+ data\\.grade\\(\\)\\.key\\(\\)', 'FishItem 的尺寸评级');
  if (style !== null) {
    if (!/Quality\.of\(/.test(style)) {
      bad('鱼的"尺寸评级"值没按档位上色（现在是 ' + style.trim() + '）—— '
        + '纪录级与幼体差 3.5 倍售价，却会显示成同一个颜色');
    } else ok('鱼的尺寸评级值按档位上色（Quality.of(data.effectiveTier())）');
  }
}

// ---------------------------------------------------------------- D 竿的档位上限
{
  // 这一行的颜色来自局部变量 q（= Quality.of(spec.tier())），所以不能只盯着 withStyle 里有没有
  // "Quality.of" —— 要连带把"那个变量是从 Quality 来的"一起断言（改成写死颜色就会红）
  if (!/Quality q = Quality\.of\(spec\.tier\(\)\);/.test(rod)) {
    bad('竿的档位没有从 Quality.of(spec.tier()) 取品质 —— 那一行的全部意义就是那个字');
  } else if (!/quality\." \+ q\.key\(\)\)[\s\S]{0,80}?\.withStyle\(q\.color\(\)\)/.test(rod)) {
    bad('竿的"档位上限：X"里那个档位名没带自己的品质色（整行 AQUA）');
  } else ok('竿的"档位上限：金"里那个字带自己的品质色（外层 AQUA 被盖住）');
}

// ---------------------------------------------------------------- E 不许自己抄颜色表
{
  const problems = [];
  for (const [name, src] of [['ChumItem', chum], ['BaitItem', bait]]) {
    if (!/Quality\.of\(/.test(src)) {
      problems.push(name + ' 没有用 Quality.of');
    }
  }
  if (problems.length) bad(problems.join('；') + ' —— 档位颜色只能有一份（Quality）');
  else ok('ChumItem / BaitItem 都走 Quality.of（转发式的 tierColor() 允许，表不允许）');

  // 档次名与颜色必须同源：**带回 switch 的**私有 tierName/tierColor 才是最典型的漂移点。
  // （BaitItem 保留了一个 tierColor()，但它只是 Quality.of(tier).color() 的转发 —— 转发不算表）
  const dupTables = [['ChumItem', chum], ['BaitItem', bait], ['FishChunkItem', chunk], ['DishItem', dish]]
    .filter(([, src]) => /private static (String|ChatFormatting) tier(Name|Color)\(int tier\) \{[\s\S]{0,120}?switch/.test(src));
  if (dupTables.length) {
    bad('这些类里还有私有的"档位名/颜色"表：' + dupTables.map(([n]) => n).join('、')
      + ' —— 它们会和 Quality 分叉（绿档显白就是这么来的）');
  } else ok('没有任何类再私藏"档位名/颜色"表（唯一真源是 Quality；转发式包装不算表）');
}

// ---------------------------------------------------------------- F 菜谱界面的三档标签
{
  if (!/Quality\.of\(tier\)\.argb\(\)/.test(cookbook)) {
    bad('菜谱界面的三档标签没用 Quality.argb() —— 界面与 tooltip 会出现两套颜色');
  } else ok('菜谱界面的三档标签走 Quality.argb()（与 tooltip 同一个色源）');
}

// ---------------------------------------------------------------- G 文档
{
  const doc = read(DOC);
  const needs = ['Quality.of', 'argb()', '颜色 = 品质'];
  const missing = needs.filter((t) => !doc.includes(t));
  if (missing.length) {
    bad('docs/29 没写清"档位文字必须带品质色"这条约定（缺：' + missing.join('、') + '）');
  } else ok('docs/29 记下了这条约定与它踩过的坑');
}

console.log('');
if (fail === 0) {
  console.log('✅ 档位文字颜色检查通过：所有档位/品质文字都带自己的品质色，色源只有 Quality 一处');
  process.exitCode = 0;
} else {
  console.log('❌ 档位文字颜色检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
