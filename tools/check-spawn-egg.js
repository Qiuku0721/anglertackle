/*
 * check-spawn-egg.js —— 刷怪蛋的三条硬约束（26.1.2 形态）。
 *
 * 触发理由：做老柯（渔人 NPC）的刷怪蛋时踩到两件事，都不是"风格问题"，
 * 而是**会在别人机器上炸、且报错完全指错方向**的问题：
 *
 *   ① 实体类型**不能靠构造器传**。
 *      旧版（1.21.1）原版 `new SpawnEggItem(EntityType, int, int, Properties)` 收的是
 *      已解析好的 EntityType，NeoForge 为此提供了 `DeferredSpawnEggItem`（收 Supplier）。
 *      **26.1.2 把 DeferredSpawnEggItem 删了**（universal jar 与 sources 里都没有），
 *      原版 SpawnEggItem 也只剩 `SpawnEggItem(Item.Properties)` 一个构造器：
 *      实体类型改由 `Item.Properties.spawnEgg(type)` 写进 `DataComponents.ENTITY_DATA`，
 *      `SpawnEggItem.getType(ItemStack)` 读它。
 *      ⇒ 断言：**每个蛋都必须经 `Properties.spawnEgg(...)` 注入实体类型**
 *        （原版 SpawnEggItem 直接写在参数里；本模组子类写在传给 super 的 properties 里）。
 *      颜色同样不在构造器里了：26.1.2 每个蛋**一张自己的贴图**（不再有染色模板）。
 *
 *   ② 实体类型注册了、**属性忘了注册**（EntityAttributeCreationEvent），
 *      症状是"实体能生成，但一出现就 NaN 血 / 立刻倒地"，同样完全不提属性二字。
 *
 *   ③ 有蛋就必须有**物品模型定义 + 每蛋贴图 + 语言键 + 创造页签**（缺一样就看不见/拿不到）。
 *
 * 用法：node tools/check-spawn-egg.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**，用来做负向测试 ——
// 证明这个脚本真的会失败，而不是"永远通过"。
// 本仓库出过"检查脚本自己证明自己"的事故（check-gameplay-parity.js 曾在 JS 里
// 重新实现一遍 Java 的算法），所以每个新检查器都必须能被证伪。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const itemSrc = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
const entSrc = read('src/main/java/com/whitecobalt/anglertackle/registry/ModEntities.java');
const mainSrc = read('src/main/java/com/whitecobalt/anglertackle/AnglersTackle.java');
const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 刷怪蛋检查（26.1.2：Properties.spawnEgg + 每蛋贴图）===\n');

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * 抠出所有 `DeferredItem<...> NAME = ITEMS.register("id", () -> new CLS( ... ))`，
 * 只保留 CLS 以 SpawnEggItem 结尾的（刷怪蛋）。
 * 用**括号配平**扫参数，避免旧版"非贪婪正则被内层 ) 截断"导致的解析错
 * （上一次它把参数截成 `...get()`，再由它拼正则会直接抛 Invalid regular expression）。
 */
function spawnEggRegistrations(src) {
  const out = [];
  const re = /ITEMS\.register\s*\(\s*"([a-z0-9_]+)"\s*,\s*\(\s*\)\s*->\s*new\s+([\w.]+)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!/SpawnEggItem$/.test(m[2])) continue;
    const open = re.lastIndex - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '"') {                       // 跳过字符串字面量里的括号
        i++;
        while (i < src.length && src[i] !== '"') { if (src[i] === '\\') i++; i++; }
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const names = [...before.matchAll(/DeferredItem\s*<[^;]*?>\s+(\w+)\s*=\s*$/g)];
    out.push({
      id: m[1],
      cls: m[2],
      args: src.slice(open + 1, end),
      name: names.length ? names[names.length - 1][1] : '(?)',
      line: lineOf(src, m.index),
    });
  }
  return out;
}

/** 顶层逗号个数（不数括号/字符串里的）。用来识别"老的 4 参构造器"。 */
function topLevelCommas(s) {
  let depth = 0, n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return n;
}

const eggs = spawnEggRegistrations(itemSrc);
if (eggs.length === 0) {
  console.log('  ℹ 目前没有任何刷怪蛋物品（老柯的蛋如果删了，这段自然跳过）');
}

// ---------------------------------------------------------------- ① 实体类型必须经 Properties.spawnEgg 注入
// ---------------------------------------------------------------- ② 属性必须注册
// ---------------------------------------------------------------- ③ 模型 / 贴图 / 语言键 / 创造页签
const accepted = new Set([...itemSrc.matchAll(/output\.accept\((\w+)\.get\(\)\)/g)].map((x) => x[1]));
const fishIds = [...entSrc.matchAll(/FISH_IDS\s*=\s*\{([\s\S]*?)\}/g)]
  .flatMap((x) => [...x[1].matchAll(/"([a-z_]+)"/g)].map((y) => y[1]));
const fishAttrLoop = /for\s*\(\s*var\s+\w+\s*:\s*ModEntities\.FISHES\.values\(\)\s*\)/.test(mainSrc)
  && /e\.put\(\s*\w+\.get\(\)/.test(mainSrc);

// ---------------------------------------------------------------- ⓪ 蛋数：47 条鱼各有且仅有一个 + 老柯 1 个 = 48
//
// ⚠ 2026-10-24（P5b）：负例 `egg-fish-missing-one` **真的**删掉了一个蛋，而旧检查器只逐蛋
// 检查、没有"每鱼一蛋 / 总数"的断言 ⇒ 它仍然全绿。这里补上（用户要求：保留该用例，不放宽、
// 反而更强）：
//   · 47 条 FISH_IDS 每条都必须有且只有一个 `<id>_spawn_egg`；
//   · 再加老柯的 `fisherman_spawn_egg` = 48；
//   · 每条鱼的蛋注册的实体参数必须是**它自己**的 `FISHES.get("<id>")`（不许张冠李戴）。
{
  const expected = fishIds.map((id) => id + '_spawn_egg');
  const counts = new Map();
  for (const e of eggs) counts.set(e.id, (counts.get(e.id) || 0) + 1);
  const dupes = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const missing = expected.filter((id) => !counts.has(id));
  const extras = [...counts.keys()].filter((id) => id !== 'fisherman_spawn_egg' && !expected.includes(id));
  const mismatched = [];
  for (const e of eggs) {
    if (!expected.includes(e.id)) continue;
    const fish = e.id.slice(0, -'_spawn_egg'.length);
    const first = (e.args.split(',')[0] || '').trim();
    const m = first.match(/^(?:[\w.]+\.)?FISHES\.get\("([a-z_]+)"\)$/);
    if (!m || m[1] !== fish) mismatched.push(e.id + ' → ' + (m ? m[1] : first));
  }
  if (eggs.length !== 48) {
    bad('刷怪蛋总数应为 48（47 条鱼各一个 + 老柯 1 个），实际 ' + eggs.length + ' 个');
  }
  if (dupes.length) bad('这些注册名出现了多个刷怪蛋：' + dupes.join('、'));
  if (missing.length) bad('这些鱼没有刷怪蛋：' + missing.join('、')
    + '（每种鱼必须有且仅有一个 <id>_spawn_egg）');
  if (extras.length) bad('这些刷怪蛋没有对应的鱼：' + extras.join('、'));
  if (!counts.has('fisherman_spawn_egg')) bad('缺老柯的刷怪蛋 fisherman_spawn_egg');
  if (mismatched.length) bad('这些鱼的蛋注册的实体不是自己：' + mismatched.join('、'));
  if (!dupes.length && !missing.length && !extras.length && counts.has('fisherman_spawn_egg')
      && eggs.length === 48 && !mismatched.length) {
    ok('47 条鱼各有且仅有一个 <id>_spawn_egg + 老柯 1 个 = 48 个刷怪蛋');
  }
}

for (const e of eggs) {
  const vanilla = e.cls === 'SpawnEggItem' || e.cls === 'net.minecraft.world.item.SpawnEggItem';
  const own = e.cls.startsWith('com.whitecobalt.anglertackle.');

  if (/DeferredSpawnEggItem$/.test(e.cls)) {
    bad(e.id + '（ModItems.java:' + e.line + '）还在用 ' + e.cls
      + ' —— 该类在 26.1.2 已被删除（编译都过不了）；实体类型改用 properties.spawnEgg(type)');
    continue;
  }
  if (!vanilla && !own) {
    bad(e.id + '（ModItems.java:' + e.line + '）用的 ' + e.cls + ' 不是原版 SpawnEggItem，也不是本模组子类');
    continue;
  }

  // ①-a 原版 SpawnEggItem：参数里必须直接有 .spawnEgg(...)，且不再有多参构造器
  if (vanilla) {
    if (!/\.spawnEgg\s*\(/.test(e.args)) {
      bad(e.id + '（ModItems.java:' + e.line + '）没有用 properties.spawnEgg(...) 注入实体类型'
        + ' —— 26.1.2 的 SpawnEggItem 只剩 SpawnEggItem(Item.Properties)，'
        + '实体类型只能经数据组件带进去；缺了它这个蛋生成不出任何东西');
    } else if (topLevelCommas(e.args) > 0) {
      bad(e.id + '（ModItems.java:' + e.line + '）的 SpawnEggItem 构造器还传了多个参数'
        + ' —— 26.1.2 只有 SpawnEggItem(Item.Properties) 一个构造器，颜色改成每蛋一张贴图');
    } else {
      ok(e.id + ' 的实体类型经 Item.Properties.spawnEgg(...) 注入（26.1.2 的唯一形态）');
    }
    // 实体类型从 spawnEgg(...) 里的 holder 取
    const holder = (e.args.match(/\.spawnEgg\s*\(\s*(?:[\w.]*\.)?([A-Z][A-Z0-9_]*)\.get\(\)\s*\)/) || [])[1];
    if (holder) {
      if (!new RegExp('\\b' + holder + '\\s*=').test(entSrc)) {
        bad(e.id + ' 注入的 ' + holder + ' 在 ModEntities.java 里找不到');
      } else if (new RegExp('e\\.put\\(\\s*ModEntities\\.' + holder + '\\.get\\(\\)').test(mainSrc)) {
        ok(holder + ' 的属性已在 EntityAttributeCreationEvent 里注册');
      } else {
        bad(holder + ' 的属性**没有**注册 —— 实体能生成但会是 NaN 血/立刻倒地，'
          + '报错里不会提"属性"两个字。去 AnglersTackle 加 EntityAttributeCreationEvent 监听');
      }
    } else {
      bad(e.id + ' 的 spawnEgg(...) 里读不出实体类型 holder（形如 ModEntities.X.get()）');
    }
  }

  // ①-b 本模组子类：必须 extends SpawnEggItem，且 super(properties.spawnEgg(...))
  let fishForm = null;
  if (own) {
    const rel = 'src/main/java/' + e.cls.replace(/\./g, '/') + '.java';
    if (!exists(rel)) {
      bad(e.id + '（ModItems.java:' + e.line + '）用了本模组的 ' + e.cls + '，但 ' + rel + ' 不存在');
      continue;
    }
    const ownSrc = read(rel);
    if (!/extends\s+(?:net\.minecraft\.world\.item\.)?SpawnEggItem\b/.test(ownSrc)) {
      bad(e.id + ' 的子类 ' + e.cls + ' 没有 extends SpawnEggItem');
    } else if (/extends\s+(?:net\.neoforged\.neoforge\.common\.)?DeferredSpawnEggItem\b/.test(ownSrc)) {
      bad(e.id + ' 的子类 ' + e.cls + ' 还 extends DeferredSpawnEggItem（该类在 26.1.2 已删除）');
    } else if (!/super\s*\(\s*properties\.spawnEgg\s*\(/.test(ownSrc)) {
      bad(e.id + ' 的子类 ' + e.cls + ' 的 super(...) 里没有 properties.spawnEgg(...)'
        + ' —— 实体类型没进数据组件，蛋生成不出东西');
    } else {
      ok(e.id + ' 用的是本模组子类 ' + e.cls.split('.').pop() + '（extends SpawnEggItem + super(properties.spawnEgg(...))）');
    }

    // 子类的第一个实参：鱼的蛋是 FISHES 表查表（Map 查表，不依赖注册顺序）
    const first = (e.args.split(',')[0] || '').trim();
    fishForm = first.match(/^(?:[\w.]+\.)?FISHES\.get\("([a-z_]+)"\)$/);
    if (fishForm) {
      if (!fishIds.includes(fishForm[1])) {
        bad(e.id + ' 查的鱼种 ' + fishForm[1] + ' 不在 ModEntities.FISH_IDS 里');
      } else if (!fishAttrLoop) {
        bad('鱼的属性没有注册 —— 实体能生成但会是 NaN 血/立刻倒地，'
          + '报错里不会提"属性"两个字。去 AnglersTackle 加 EntityAttributeCreationEvent 监听');
      } else {
        ok(e.id + ' 的实体参数是 FISHES 表查表（Map 查表，不依赖注册顺序）：' + first);
      }
    }
  }

  // ③-a 物品模型定义（26.1.2 的入口）+ 模型 + 每蛋贴图
  const defPath = 'src/main/resources/assets/anglertackle/items/' + e.id + '.json';
  if (!exists(defPath)) {
    bad(e.id + ' 缺物品模型定义 ' + defPath + '（26.1.2 的模型入口，缺了就是紫黑方块）');
  } else {
    const def = JSON.parse(read(defPath));
    const modelId = def && def.model && def.model.model;
    const rel = String(modelId || '').replace(/^anglertackle:/, '');
    const modelPath = 'src/main/resources/assets/anglertackle/models/' + rel + '.json';
    if (!modelId || !exists(modelPath)) {
      bad(e.id + ' 的物品模型定义指向了不存在的模型：' + modelId + '（' + modelPath + '）');
    } else {
      const model = JSON.parse(read(modelPath));
      const layer0 = model.textures && model.textures.layer0;
      const texRel = String(layer0 || '').replace(/^anglertackle:/, '');
      const texPath = 'src/main/resources/assets/anglertackle/textures/' + texRel + '.png';
      if (!layer0 || !exists(texPath)) {
        bad(e.id + ' 没有自己的贴图（layer0=' + layer0 + '，' + texPath + ' 不存在）'
          + ' —— 26.1.2 不再有染色模板，每个蛋必须有一张图');
      } else {
        ok(e.id + ' 有物品模型定义 + 自己的贴图（' + texPath.replace('src/main/resources/assets/anglertackle/', '') + '）');
      }
    }
  }

  // ③-b 语言键
  if (('item.anglertackle.' + e.id) in zh && ('item.anglertackle.' + e.id) in en) {
    ok(e.id + ' 中英文名齐全');
  } else {
    bad(e.id + ' 缺语言键（item.anglertackle.' + e.id + '）');
  }

  // ③-c 创造页签
  if (accepted.has(e.name)) {
    ok(e.id + ' 进了创造页签');
  } else {
    bad(e.id + '（常量 ' + e.name + '）没进创造页签，游戏里拿不到');
  }
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  背景：刷怪蛋看着是"一行物品注册"，实际牵扯四个地方——');
console.log('    物品 / 实体类型（数据组件）/ 实体属性 / 每蛋贴图。');
console.log('    26.1.2 起实体类型只能经 Properties.spawnEgg 注入，颜色只能靠贴图 ——');
console.log('    任何一处漏了，表现都是"蛋拿在手上是紫黑格"或"放出来立刻倒地"。');
process.exitCode = fail === 0 ? 0 : 1;
