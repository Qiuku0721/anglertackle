/*
 * check-recipe-advancements.js —— 模组配方必须**全部**接进原版配方书。
 *
 * 背景：MC 的配方书只显示"已解锁的配方"，解锁的唯一途径是带 rewards.recipes 的进度。
 * 用户 2026-10-02："把目前所有的合成配方接入原版配方书。"
 * 生成器是 tools/gen-recipe-advancements.js（改配方后必须重跑它）。
 *
 * 判据：
 *   A. 每条配方都有进度，且磁盘内容**逐字节等于生成器重新算出来的结果** ——
 *      手改进度、或加了配方忘了重跑生成器，这里都会红；
 *   B. 没有多余的（孤儿）进度 —— 删了配方却留着进度，玩家会解锁一条不存在的配方；
 *   C. 进度里**不许有 display** —— 原版的配方解锁进度全都没有 display，
 *      有 display 就会变成满屏弹"新配方"提示，还得配语言键；
 *   D. rewards.recipes 必须正好是这条配方、parent 必须是 recipes/root；
 *   E. 判据里的材料必须真的存在：anglertackle: 的物品要在 ModItems 里注册过，
 *      #anglertackle: 的标签文件要在。
 *
 * ⚠ 这个检查器**只读**：它 require 生成器的 build() 在内存里比对，
 *   绝不跑 `--write`（那样会把漂移顺手修好，于是永远报"一致"= 没有断言）。
 *
 * 用法：node tools/check-recipe-advancements.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const NS = 'anglertackle';
const RECIPE_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'recipe');
const ADV_DIR = path.join(ROOT, 'src/main/resources/data', NS, 'advancement/recipes');
const MOD_ITEMS = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

console.log('=== 配方书解锁进度检查（每个配方都要能解锁）===\n');

// 生成器：把目录常量重定向到本次检查的树（副本或真实树）
const genPath = path.join(ROOT, 'tools/gen-recipe-advancements.js');
if (!fs.existsSync(genPath)) {
  no('找不到生成器 ' + path.relative(ROOT, genPath));
  console.log('\n❌ 未通过（1 项）');
  process.exit(1);
}
const genMod = require(genPath);
let expected;
try {
  expected = genMod.build();
} catch (e) {
  no('生成器算不出进度：' + e.message);
  console.log('\n❌ 未通过（1 项）');
  process.exit(1);
}

// ---- A 每条配方都有进度，且逐字节一致 ----
const missing = [];
const drift = [];
for (const [name, text] of expected) {
  const file = path.join(ADV_DIR, name + '.json');
  if (!fs.existsSync(file)) {
    missing.push(name);
    continue;
  }
  if (fs.readFileSync(file, 'utf8') !== text) {
    drift.push(name);
  }
}
if (missing.length === 0) ok('每条配方都有解锁进度（' + expected.size + ' 条）');
else no('这些配方没有进度，玩家永远解锁不了：' + missing.join(', ') +
  '（重跑 node tools/gen-recipe-advancements.js --write）');
if (drift.length === 0) ok('磁盘上的进度与生成器输出**逐字节一致**');
else no('这些进度与生成器输出不一致（手改过？）：' + drift.join(', ') +
  ' —— 生成物不许手改，改配方后重跑生成器');

// ---- A2 豁免名单（special 配方：原版机制决定它进不了配方书）----
// 打出来是为了"有人把一条普通配方偷偷加进豁免名单"能被看见 ——
// 那份名单必须只包含真的 special 配方（JSON 里没有 ingredients）。
{
  const exempt = genMod.RECIPE_BOOK_EXEMPT || new Set();
  const wrong = [];
  for (const name of exempt) {
    const f = path.join(RECIPE_DIR, name + '.json');
    if (!fs.existsSync(f)) { wrong.push(name + '（配方文件不存在）'); continue; }
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      wrong.push(name + '（不是合法 JSON）');
      continue;
    }
    if (doc.ingredients !== undefined || doc.key !== undefined || doc.result !== undefined) {
      wrong.push(name + '（JSON 里有 ingredients/key/result —— 它其实是普通配方，' +
        '进不了配方书是漏了进度，不是原版机制）');
    }
  }
  if (wrong.length) no('配方书豁免名单有问题：' + wrong.join('、'));
  else if (exempt.size) {
    ok('不进配方书的 special 配方只有 ' + [...exempt].join('、') +
      '（JSON 里没有 ingredients —— special 配方的产出物是动态的，配方书表达不了）');
  } else ok('没有需要豁免的 special 配方');
}

// ---- B 孤儿进度 ----
// ⚠ 递归：菜配方在 advancement/recipes/<菜型>/<鱼种>.json（2026-10-03 起）。
//   只读一层的话，嵌套的那 31 个进度会被整段跳过 —— 包括下面 C/D/E 的逐条校验。
const walkAdv = (dir, prefix, out) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) walkAdv(path.join(dir, e.name), rel, out);
    else if (e.name.endsWith('.json')) out.push(rel.replace(/\.json$/, ''));
  }
  return out;
};
const onDisk = walkAdv(ADV_DIR, '', []).sort();
const orphan = onDisk.filter((n) => !expected.has(n));
if (orphan.length === 0) ok('没有多余的孤儿进度');
else no('这些进度没有对应的配方：' + orphan.join(', ') + '（删了配方要重跑生成器）');

// ---- C/D/E 逐条校验 ----
const modItems = fs.existsSync(path.join(ROOT, MOD_ITEMS)) ? fs.readFileSync(path.join(ROOT, MOD_ITEMS), 'utf8') : '';
let checked = 0;
for (const name of onDisk) {
  const file = path.join(ADV_DIR, name + '.json');
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    no(name + '.json 不是合法 JSON：' + e.message);
    continue;
  }
  checked++;
  if (doc.display !== undefined) {
    no(name + '.json 里有 display —— 配方解锁进度不该有它：会满屏弹"新配方"提示，还要配语言键');
  }
  if (doc.parent !== 'minecraft:recipes/root') {
    no(name + '.json 的 parent 不是 minecraft:recipes/root（实际 ' + doc.parent + '）');
  }
  const id = NS + ':' + name;
  const rewards = (doc.rewards && doc.rewards.recipes) || [];
  if (rewards.length !== 1 || rewards[0] !== id) {
    no(name + '.json 的 rewards.recipes 不是 [' + id + ']（实际 ' + JSON.stringify(rewards) + '）');
  }
  const items = doc.criteria && doc.criteria.has_ingredient
    && doc.criteria.has_ingredient.conditions
    && doc.criteria.has_ingredient.conditions.items;
  const ing = Array.isArray(items) && items[0] ? items[0].items : null;
  if (typeof ing !== 'string') {
    no(name + '.json 的 has_ingredient 判据读不出材料');
  } else if (ing.startsWith('#' + NS + ':')) {
    const tagRel = 'src/main/resources/data/' + NS + '/tags/item/' + ing.slice(NS.length + 2) + '.json';
    if (!fs.existsSync(path.join(ROOT, tagRel))) {
      no(name + '.json 引用了不存在的标签 ' + ing + '（缺 ' + tagRel + '）—— 判据永远不成立，配方解锁不了');
    }
  } else if (ing.startsWith(NS + ':')) {
    const item = ing.slice(NS.length + 1);
    // ⚠ 鱼物品不是字面量注册的，而是走 `fish("crucian_carp")` 助手方法 ——
    //   只认 `ITEMS.register("字面量"` 的话，菜配方的解锁材料（= 那条鱼）会全部误报。
    if (!new RegExp('register\\("' + item + '"').test(modItems)
        && !new RegExp('\\bfish\\("' + item + '"\\)').test(modItems)) {
      no(name + '.json 引用了未注册的物品 ' + ing + ' —— 判据永远不成立，配方解锁不了');
    }
  } else if (!/^#?[a-z_]+:[a-z_/]+$/.test(ing)) {
    // 原版的物品/标签（#minecraft:planks 这种）只查格式 ——
    // 有没有那个标签要问原版注册表，本地判不了（模组自己的标签上面已经查过文件了）
    no(name + '.json 的材料 id 格式不对：' + ing);
  }
  // 判据名与 requirements 必须对得上（对不上 = 进度永远不授予）
  const reqs = doc.requirements || [];
  const flat = reqs.flat ? reqs.flat() : [];
  if (!flat.includes('has_the_recipe') || !flat.includes('has_ingredient')) {
    no(name + '.json 的 requirements 没有同时要求 has_the_recipe 与 has_ingredient —— 进度永远不会授予');
  }
  if (!doc.criteria || !doc.criteria.has_the_recipe
      || doc.criteria.has_the_recipe.conditions.recipe !== id) {
    no(name + '.json 的 has_the_recipe 判据不是 ' + id);
  }
}
if (checked === onDisk.length && onDisk.length > 0) {
  ok('逐条校验了 ' + checked + ' 个进度的 rewards / parent / 判据 / 材料存在性');
}

console.log('');
console.log(bad === 0
  ? '✅ 全部 ' + expected.size + ' 条配方都接进了原版配方书'
  : '❌ 配方解锁检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
