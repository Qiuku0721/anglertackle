/*
 * check-spawn-egg.js —— 刷怪蛋的三条硬约束。
 *
 * 触发理由：做老柯（渔人 NPC）的刷怪蛋时踩到两件事，都不是"风格问题"，
 * 而是**会在别人机器上炸、且报错完全指错方向**的问题：
 *
 *   ① 原版 `new SpawnEggItem(EntityType, int, int, Properties)` 在 NeoForge 里
 *      被标了 @Deprecated，注释原话：
 *        "Forge: Use net.neoforged.neoforge.common.DeferredSpawnEggItem instead for suppliers"
 *      坑在于它收的是**已解析好的** EntityType，于是必须写 `ModEntities.X.get()`。
 *      而"物品"和"实体类型"是两个 DeferredRegister、两次独立的 RegisterEvent，
 *      **先后顺序不受"我在主类里先调用谁"控制**。物品先解析时 get() 就会炸，
 *      报错只说 registry 不存在，看不出是刷怪蛋干的。
 *      DeferredSpawnEggItem 收 Supplier，把取值推迟到真正使用那一刻。
 *
 *   ② 实体类型注册了、**属性忘了注册**（EntityAttributeCreationEvent），
 *      症状是"实体能生成，但一出现就 NaN 血 / 立刻倒地"，同样完全不提属性二字。
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

const itemSrc = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
const entSrc = read('src/main/java/com/whitecobalt/anglertackle/registry/ModEntities.java');
const mainSrc = read('src/main/java/com/whitecobalt/anglertackle/AnglersTackle.java');
const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 刷怪蛋检查 ===\n');

// ---------------------------------------------------------------- ① 不许用被弃用的原版构造器
// 只在**真的 new** 的时候才算，import / 注释里提到不算。
{
  const hits = [...itemSrc.matchAll(/new\s+(?:net\.minecraft\.world\.item\.)?SpawnEggItem\s*\(/g)];
  if (hits.length === 0) {
    ok('没有直接 new 原版 SpawnEggItem（那个构造器已弃用且要求已解析的 EntityType）');
  } else {
    for (const h of hits) {
      const line = itemSrc.slice(0, h.index).split('\n').length;
      bad('ModItems.java:' + line + ' 用了被弃用的 new SpawnEggItem(...)，'
        + '改用 net.neoforged.neoforge.common.DeferredSpawnEggItem（收 Supplier）');
    }
  }
}

// ---------------------------------------------------------------- ② 蛋一律走 Deferred，且传 Supplier 而非 .get()
{
  const re = /DeferredItem<\s*([\w.]+)\s*>\s+(\w+)\s*=\s*ITEMS\.register\(\s*"([a-z_]+)"\s*,\s*\(\)\s*->\s*new\s+([\w.]+)\s*\(([\s\S]*?)\)\);/g;
  const eggs = [];
  let m;
  while ((m = re.exec(itemSrc)) !== null) {
    const cls = m[4];
    if (!/SpawnEggItem$/.test(cls)) continue;
    eggs.push({ name: m[2], id: m[3], cls, args: m[5], line: itemSrc.slice(0, m.index).split('\n').length });
  }

  if (eggs.length === 0) {
    console.log('  ℹ 目前没有任何刷怪蛋物品（老柯的蛋如果删了，这段自然跳过）');
  }

  for (const e of eggs) {
    // 本模组自己的子类也算合格 —— 但必须**读源码证明**它确实 extends DeferredSpawnEggItem。
    // 不能简单地"名字以 SpawnEggItem 结尾就放行"：原版的 net.minecraft...SpawnEggItem
    // 也满足这个形状，而它正是要禁止的那一个。
    const own = e.cls.startsWith('com.whitecobalt.anglertackle.');
    if (e.cls === 'DeferredSpawnEggItem' || e.cls === 'net.neoforged.neoforge.common.DeferredSpawnEggItem') {
      ok(e.id + ' 用的是 DeferredSpawnEggItem');
    } else if (own) {
      const rel = 'src/main/java/' + e.cls.replace(/\./g, '/') + '.java';
      if (!fs.existsSync(path.join(ROOT, rel))) {
        bad(e.id + '（ModItems.java:' + e.line + '）用了本模组的 ' + e.cls + '，但 ' + rel + ' 不存在');
      } else {
        const ownSrc = read(rel);
        if (/extends\s+(net\.neoforged\.neoforge\.common\.)?DeferredSpawnEggItem\b/.test(ownSrc)) {
          ok(e.id + ' 用的是本模组子类 ' + e.cls.split('.').pop() + '（已确认 extends DeferredSpawnEggItem）');
        } else {
          bad(e.id + ' 的子类 ' + e.cls + ' 没有 extends DeferredSpawnEggItem —— '
            + '它是原版 SpawnEggItem 那一系的话就踩回第 ① 条了');
        }
      }
    } else {
      bad(e.id + '（ModItems.java:' + e.line + '）用的是 ' + e.cls + '，应当用 DeferredSpawnEggItem');
    }

    // 第一个实参必须是 supplier 本身：形如 com.x.y.ModEntities.XXX，
    // **结尾不能有 .get()** —— 有 .get() 就是把第 ① 条的坑又踩回来了。
    //
    // ⚠ 鱼的蛋走的是另一条路：实体类型在 ModEntities.FISHES 这张 Map 里，
    //   只能写 ModEntities.FISHES.get("pike")。这是 **Map 查表**，
    //   不是 DeferredHolder.get()，不涉及"注册有没有解析完"，是安全的；
    //   但必须单独认出来，否则 ^[\w.]+$ 会把它判成"看不懂"。
    const first = (e.args.split(',')[0] || '').trim();
    const fishForm = first.match(/^(?:[\w.]+\.)?FISHES\.get\("([a-z_]+)"\)$/);
    if (fishForm) {
      ok(e.id + ' 的实体参数是 FISHES 表查表（Map 查表，不依赖注册顺序）：' + first);
      if (!new RegExp('"' + fishForm[1] + '"').test(entSrc)) {
        bad(e.id + ' 查的鱼种 ' + fishForm[1] + ' 不在 ModEntities 里');
      }
      // 鱼的属性是在 AnglersTackle 里**循环**注册的，没有逐个 e.put(...) 可查
      if (/for\s*\(\s*var\s+\w+\s*:\s*ModEntities\.FISHES\.values\(\)\s*\)/.test(mainSrc)
          && /e\.put\(\s*\w+\.get\(\)/.test(mainSrc)) {
        ok('鱼的属性已在 EntityAttributeCreationEvent 里循环注册（覆盖全部 21 种）');
      } else {
        bad('鱼的属性没有注册 —— 实体能生成但会是 NaN 血/立刻倒地，'
          + '报错里不会提"属性"两个字。去 AnglersTackle 加 EntityAttributeCreationEvent 监听');
      }
    } else if (/\.get\(\)\s*$/.test(first)) {
      bad(e.id + ' 的实体参数写了 ' + first + ' —— 去掉 .get()，直接传 DeferredHolder（它就是 Supplier）');
    } else if (!/^[\w.]+$/.test(first)) {
      bad(e.id + ' 的实体参数看不懂：' + first);
    } else {
      ok(e.id + ' 的实体参数是 Supplier（' + first + '），不依赖注册顺序');
    }

    // 语言键 + 模型
    if (('item.anglertackle.' + e.id) in zh && ('item.anglertackle.' + e.id) in en) {
      ok(e.id + ' 中英文名齐全');
    } else {
      bad(e.id + ' 缺语言键（item.anglertackle.' + e.id + '）');
    }
    const modelPath = 'src/main/resources/assets/anglertackle/models/item/' + e.id + '.json';
    if (fs.existsSync(path.join(ROOT, modelPath))) {
      ok(e.id + ' 有模型 json');
    } else {
      bad(e.id + ' 缺模型 ' + modelPath);
    }

    // 实体类型 + 属性，缺一不可。
    // 鱼的蛋在上面单独判过了（holder 不在 ModEntities 里，是 Map 查表）。
    if (fishForm) continue;
    const holder = first.split('.').pop();
    if (new RegExp('"' + holder.toLowerCase().replace(/_/g, '_') + '"').test(entSrc) === false
        && !entSrc.includes(holder + ' =')) {
      bad(e.id + ' 指向的 ' + holder + ' 在 ModEntities.java 里找不到');
    }
    if (new RegExp('e\\.put\\(\\s*ModEntities\\.' + holder + '\\.get\\(\\)').test(mainSrc)) {
      ok(holder + ' 的属性已在 EntityAttributeCreationEvent 里注册');
    } else {
      bad(holder + ' 的属性**没有**注册 —— 实体能生成但会是 NaN 血/立刻倒地，'
        + '报错里不会提"属性"两个字。去 AnglersTackle 加 EntityAttributeCreationEvent 监听');
    }
  }
}

// ---------------------------------------------------------------- ③ 反向：实体有蛋但没进创造页签
{
  const accepted = new Set([...itemSrc.matchAll(/output\.accept\((\w+)\.get\(\)\)/g)].map((x) => x[1]));
  const eggNames = [...itemSrc.matchAll(/DeferredItem<\s*[\w.]*SpawnEggItem\s*>\s+(\w+)\s*=/g)].map((x) => x[1]);
  const missing = eggNames.filter((n) => !accepted.has(n));
  if (missing.length === 0) {
    ok('所有刷怪蛋都进了创造页签（' + eggNames.length + ' 个）');
  } else {
    bad('这些刷怪蛋没进创造页签，游戏里拿不到：' + missing.join(', '));
  }

  // 鱼种 id → 蛋常量名，用来核对"每个鱼种都有一个蛋、且上架了"
  const eggOf = {};
  for (const m of itemSrc.matchAll(
    /DeferredItem<\s*[\w.]*SpawnEggItem\s*>\s+(\w+)\s*=\s*\n?\s*ITEMS\.register\(\s*"([a-z_]+)_spawn_egg"/g)) {
    eggOf[m[1]] = m[2];
  }
  const fishIds = [...entSrc.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  const declared = [...entSrc.matchAll(/FISH_IDS\s*=\s*\{([\s\S]*?)\}/g)]
    .flatMap((x) => [...x[1].matchAll(/"([a-z_]+)"/g)].map((y) => y[1]));
  const noEgg = declared.filter((id) => !Object.values(eggOf).includes(id));
  if (declared.length === 0) {
    bad('读不出 ModEntities.FISH_IDS');
  } else if (noEgg.length === 0) {
    ok('21 个鱼种每个都有刷怪蛋（' + declared.length + ' 个）');
  } else {
    bad('这些鱼种没有刷怪蛋：' + noEgg.join(', '));
  }
  void fishIds;
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  背景：刷怪蛋看着是"一行物品注册"，实际牵扯三个注册表——');
console.log('    物品 / 实体类型 / 实体属性。三者在不同事件里解析，顺序不保证。');
console.log('    任何一处用了 .get() 提前取值，就会变成"某些机器上才炸"的偶发问题。');
process.exitCode = fail === 0 ? 0 : 1;
