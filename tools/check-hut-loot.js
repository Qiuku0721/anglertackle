/*
 * check-hut-loot.js —— 渔人小屋的战利品表 + 箱子挂表是否完好。
 *
 * 这几件事出错的表现**全都是"箱子里空着"**，不报错、日志里也没有：
 *   · 战利品表文件没进 jar / 路径写成 loot_tables（复数，1.21 是单数 loot_table）
 *   · 结构 NBT 里的箱子没挂 LootTable
 *   · LootTable 的 id 拼错
 *   · 表里引用的物品 id 不存在
 *
 * 所以全部离线断言掉，别留给游戏里试。
 *
 * 用法：node tools/check-hut-loot.js
 */
const fs = require('fs');
const path = require('path');
const nbt = require('./lib-nbt');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 小屋战利品检查 ===\n');

const TABLE = 'src/main/resources/data/anglertackle/loot_table/chests/fisherman_hut.json';
const STRUCT = 'src/main/resources/data/anglertackle/structure/fisherman_hut.nbt';
const TABLE_ID = 'anglertackle:chests/fisherman_hut';

// ---------------------------------------------------------------- ① 路径（单数！）
if (exists('src/main/resources/data/anglertackle/loot_tables')) {
  bad('存在 loot_tables（复数）目录 —— 1.21 只认单数 loot_table，'
    + '写成复数不会报错，箱子就是永远空的');
} else if (!exists(TABLE)) {
  bad('缺 ' + TABLE + ' —— 箱子会是空的');
} else {
  ok('战利品表在 loot_table（**单数**）下');
}

let table = null;
if (exists(TABLE)) {
  try {
    table = JSON.parse(read(TABLE));
    ok('战利品表 JSON 合法（' + table.pools.length + ' 个池子）');
  } catch (e) {
    bad('战利品表 JSON 非法：' + e.message);
  }
}

// ---------------------------------------------------------------- ② 箱子挂表
if (exists(STRUCT)) {
  const typed = nbt.readNbtTyped(path.join(ROOT, STRUCT));
  const pal = nbt.get(typed.root, 'palette').v.items
    .map((p) => String(nbt.get(p, 'Name').v));
  let chests = 0, tagged = 0, wrongId = 0;
  for (const b of typed.root.v.blocks.v.items) {
    if (pal[Number(nbt.get(b, 'state').v)] !== 'minecraft:chest') continue;
    chests++;
    const t = nbt.get(b, 'nbt');
    const lt = t ? nbt.get(t, 'LootTable') : null;
    if (!lt) continue;
    if (lt.v === TABLE_ID) tagged++;
    else wrongId++;
  }
  if (chests === 0) bad('结构里一个箱子都没有？结构变了');
  else if (tagged === chests) ok(chests + ' 个箱子全部挂上了 ' + TABLE_ID);
  else bad('只有 ' + tagged + '/' + chests + ' 个箱子挂了战利品表'
    + (wrongId ? '（另有 ' + wrongId + ' 个挂的是别的 id）' : '')
    + ' —— 没挂的箱子打开是空的');
}

// ---------------------------------------------------------------- ③ 引用的物品必须存在
if (table) {
  const itemSrc = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
  // ⚠ 物品有四种注册写法，少收一种就会把存在的物品误报成"不存在"，
  //   而误报和漏报一样费时间 —— 它会让人去改本来正确的东西。
  const ids = new Set([
    ...[...itemSrc.matchAll(/ITEMS\.register\("([a-z_]+)"/g)].map((x) => x[1]),
    ...[...itemSrc.matchAll(/=\s*rod\("([a-z_]+)"/g)].map((x) => x[1]),
    ...[...itemSrc.matchAll(/=\s*fish\("([a-z_]+)"\)/g)].map((x) => x[1]),
  ]);
  const missing = [];
  for (const pool of table.pools) {
    for (const e of pool.entries || []) {
      if (!e.name || String(e.name).startsWith('minecraft:')) continue;
      if (!ids.has(String(e.name).replace('anglertackle:', ''))) missing.push(e.name);
    }
  }
  if (missing.length === 0) ok('表里引用的模组物品都存在');
  else bad('引用了不存在的物品：' + missing.join(', ') + '（那一格会空着，不报错）');
}

// ---------------------------------------------------------------- ④ 用户要的内容对不对
if (table) {
  const all = table.pools.flatMap((p) => (p.entries || []).map((e) => String(e.name)));
  const lures = all.filter((n) => n.includes('lure_') && !n.includes('test'));
  const baits = all.filter((n) => n.includes('bait_'));
  if (lures.length === 6 && baits.length === 6) {
    ok('饵料 12 种（6 拟饵 + 6 鱼饵）—— 用户要的"每个箱子一个一种"');
  } else {
    bad('饵料池里拟饵 ' + lures.length + ' 种 / 鱼饵 ' + baits.length + ' 种，应为 6 + 6');
  }
  if (all.filter((n) => /_line$/.test(n)).length === 6) ok('鱼线 6 种（小概率池）');
  else bad('鱼线不是 6 种');
  // 红鱼：必须带 tier=6 的组件，否则拿到的是普通品质
  const reds = table.pools.flatMap((p) => p.entries || [])
    .filter((e) => (e.functions || []).some((f) => f.function === 'minecraft:set_components'));
  if (reds.length >= 1) {
    const tiers = reds.map((e) => e.functions
      .find((f) => f.function === 'minecraft:set_components')
      .components[Object.keys(e.functions.find((f) => f.function === 'minecraft:set_components').components)[0]]
      .tier);
    if (tiers.every((x) => x === 6)) {
      ok('红鱼带 tier=6 组件（' + reds.length + ' 种）—— 不写的话拿到的是普通品质鱼');
    } else {
      bad('红鱼的 tier 不是 6：' + tiers.join(', '));
    }
  } else {
    bad('没有任何带 set_components 的条目 —— "极小概率红鱼"没有实现');
  }
  // ── 档位分层概率（用户 2026-07-01："紫10%，金5%，红1.5%"）──
  //
  // 饵料是"每箱一个一种"，所以档位概率在**池内用权重**分配。
  // 权重 = 目标百分比 × 20 / 该档种类数，所以每种紫饵的权重必然 > 金 > 红。
  // 这里断言这三层的**相对关系**，而不是硬编码具体数字 —— 以后加一种紫饵，
  // 单个权重会变，但"紫 > 金 > 红"必须一直成立。
  {
    const pool = table.pools.find((p) => (p.entries || []).some((e) =>
      String(e.name).includes('lure_gilded')));
    if (!pool) {
      bad('找不到含红饵（lure_gilded）的池子');
    } else {
      const wOf = (name) => {
        const e = pool.entries.find((x) => String(x.name).endsWith(name));
        return e ? (e.weight || 1) : null;
      };
      const epic = wOf('lure_deep');      // 紫
      const legend = wOf('lure_rattle');  // 金
      const red = wOf('lure_gilded');     // 红
      if (epic && legend && red && epic > legend && legend > red) {
        ok('饵料档位权重分层正确：紫 ' + epic + ' > 金 ' + legend + ' > 红 ' + red
          + '（权重 = 目标% × 20 ÷ 该档种类数）');
      } else {
        bad('饵料档位权重没分层（紫 ' + epic + ' / 金 ' + legend + ' / 红 ' + red
          + '）—— 必须紫 > 金 > 红，否则高级饵料不比低级的稀有');
      }
      // 4 个层级：低档 / 紫 / 金 / 红
      const levels = [...new Set(pool.entries.map((e) => e.weight || 1))].sort((a, b) => a - b);
      if (levels.length === 4) ok('饵料分成 4 个权重层级：' + levels.join(' / '));
      else bad('饵料的权重层级是 ' + levels.length + ' 个（应为 4：低档/紫/金/红）');
    }
  }

  // 鱼线的档位概率必须是**绝对概率**（独立池），不是池内权重
  {
    const want = { fluoro_line: 10, pe_line: 5, titanium_line: 1.5 };
    for (const [id, pct] of Object.entries(want)) {
      const pool = table.pools.find((p) => (p.entries || []).some((e) =>
        String(e.name).endsWith(id)));
      if (!pool) { bad('找不到 ' + id + ' 的池子'); continue; }
      const c = (pool.conditions || []).find((x) => x.condition === 'minecraft:random_chance');
      if (!c) { bad(id + ' 所在的池子没有随机概率条件 —— 会 100% 出'); continue; }
      const got = c.chance * 100;
      if (Math.abs(got - pct) < 0.01) ok(id + ' ' + got + '%（目标 ' + pct + '%）');
      else bad(id + ' ' + got + '%，目标 ' + pct + '%');
    }
  }

  // 概率：红鱼必须比鱼线更低（"极小概率" < "小概率"）
  const chanceOf = (pool) => {
    const c = (pool.conditions || []).find((x) => x.condition === 'minecraft:random_chance');
    return c ? c.chance : 1;
  };
  const chances = table.pools.map(chanceOf);
  const line = chances.find((c) => c > 0 && c < 0.5);
  const red = Math.min(...chances.filter((c) => c > 0));
  if (line !== undefined && red < line) {
    ok('概率层级正确：鱼线 ' + (line * 100) + '%，红鱼 ' + (red * 100) + '%（红鱼更稀有）');
  } else {
    bad('红鱼概率没有低于鱼线 —— 用户要的是"小概率鱼线 / **极小**概率红鱼"');
  }
}

// ---------------------------------------------------------------- ⑤ 原版村庄渔夫小屋
//
// 用户 2026-10-02："村庄结构中的原版渔人小屋结构中的容器可能刷新 mod 鱼，
// 品质概率等数值与老柯小屋相关刷新相同。"
//
// 做法：我们自己的一张表（内容 = 老柯小屋的红鱼池，同一个生成函数写的）
// + `neoforge:add_table` 修饰符，只注入 `minecraft:chests/village/village_fisher`。
// 三处 id 写错都是"箱子永远刷不出 mod 鱼"，没有报错，所以逐条断言。
{
  const INJ = 'src/main/resources/data/anglertackle/loot_table/inject/village_fisher_fish.json';
  const MOD = 'src/main/resources/data/anglertackle/loot_modifiers/village_fisher_fish.json';
  // 26.1.2：NeoForge 的 LootModifierManager 改成**扫目录**加载
  // （LootModifierManager.java:32 FileToIdConverter.registry(…"loot_modifiers")），
  // data/neoforge/loot_modifiers/global_loot_modifiers.json 这份索引已不存在。
  // ⇒ "会不会被加载"等价于"文件在不在 data/anglertackle/loot_modifiers/ 里"（下面直接查 MOD）。
  const TARGET = 'minecraft:chests/village/village_fisher';
  if (!exists(INJ) || !exists(MOD)) {
    bad('缺村庄渔夫小屋的注入表/修饰符（' + INJ + ' / ' + MOD + '）—— 村庄箱子里永远没有 mod 鱼');
  } else {
    const inj = JSON.parse(read(INJ));
    const mod = JSON.parse(read(MOD));

    if (mod.type === 'neoforge:add_table') ok('修饰符类型是 neoforge:add_table');
    else bad('修饰符类型是 ' + mod.type + '（写错 = 修饰符解析不了 → 永远不掉，且没有日志）');

    const ids = [];
    const walk = (c) => {
      if (!c || typeof c !== 'object') return;
      if (c.condition === 'neoforge:loot_table_id') ids.push(c.loot_table_id);
      for (const t of c.terms || []) walk(t);
    };
    for (const c of mod.conditions || []) walk(c);
    if (ids.length === 1 && ids[0] === TARGET) ok('只注入 ' + TARGET + '（原版渔夫小屋的箱子）');
    else bad('注入目标是 ' + JSON.stringify(ids) + '，应当只有 ' + TARGET);

    if (mod.table === 'anglertackle:inject/village_fisher_fish') ok('指向我们自己的注入表');
    else bad('mod.table = ' + mod.table + '（id 不对，箱子会静默空着）');

    // 26.1.2 按目录自动登记：文件名就是 id（anglertackle:village_fisher_fish）
    if (fs.existsSync(path.join(ROOT, MOD))) {
      ok('修饰符在 data/anglertackle/loot_modifiers/ 里（26.1.2 按目录自动登记，不需要索引文件）');
    } else {
      bad('修饰符不在 data/anglertackle/loot_modifiers/ 里 —— 不会被加载');
    }

    // 数值必须和"老柯小屋"那一池**完全一致**（用户口径："品质概率等数值相同"）
    const hutPool = (table.pools || []).find((p) =>
      (p.conditions || []).some((c) => c.condition === 'minecraft:random_chance'
        && Math.abs(c.chance * 100 - 1.5) < 0.01)
      && (p.entries || []).some((e) => /bluefin_tuna|juvenile_shark|oxeye_tarpon/.test(e.name || '')));
    const villagePool = (inj.pools || [])[0];
    if (!hutPool) {
      bad('在小屋战利品表里找不到"红鱼那一池" —— 这条比对失效了，需要跟着改');
    } else if (JSON.stringify(hutPool) === JSON.stringify(villagePool)) {
      ok('村庄那一池与小屋的红鱼池**逐字节相同**（概率 ' +
        (hutPool.conditions[0].chance * 100) + '%，同样的 ' + hutPool.entries.length + ' 种鱼）');
    } else {
      bad('村庄那一池与小屋的红鱼池不一致 —— 用户要的是"品质概率等数值与老柯小屋相同"');
    }
  }
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  这些错的表现**全都是"箱子里空着"**，不报错、日志里也没有：');
console.log('    目录名写成 loot_tables（复数）、箱子没挂 LootTable、id 拼错、物品 id 不存在。');
process.exitCode = fail === 0 ? 0 : 1;
