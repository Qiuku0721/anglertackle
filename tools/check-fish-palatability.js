'use strict';
/**
 * 食用适宜度（L0~L5）检查 —— 用户 2026-10-10 定案："**根据描述做分级，越难吃 debuff 越强**。
 * **有些不进菜单**"（依据与逐条出处：docs/料理适配策划案.md）。
 *
 * 这个检查器守的是**"叠加层"这个承诺**（用户原话："你是在做老功能，别连代码都不会兼容"）：
 *
 *   A. 表里出现的鱼 id **必须真实存在**（FishSpecies 里数得出来）—— 写错一个字母就是"这条鱼永远 L0"，
 *      不崩不报错，只是那条鱼白写了。
 *   B. **L0 不许出现在表里**：这张表的设计是"没有记录 = L0"，
 *      一旦有人把 L0 显式写进去，"老鱼种行为逐字不变"这条兼容性承诺就靠不住了
 *      （下一个人会以为"必须写全"）。
 *   C. 每条鱼**只能出现一次**（Java 里 put() 会抛，但那是运行期；静态也要守）。
 *   D. **L5 = docs/25 §13.5.3 那五条，双向相等**：文档说不可食用、代码说进不了菜单，
 *      两边一旦分叉，玩家就会看到"图鉴说不能吃、锅里能做出来"。
 *   E. **L1~L4 的每条都必须已经在菜品菜单里**（DishRecipe 的逐鱼表）——
 *      否则就是"分了级却做不出菜"，等于白分级。
 *   F. **L5 一条都不许在菜品菜单里** —— 这是"有些不进菜单"的直接断言，
 *      也是"零删除"的证据（它们本来就不在）。
 *   G. **接线**：DishItem 吃完菜要调 apply；"生"只判刺身（Dish.SASHIMI 是唯一 Base.RAW 的菜型）。
 *   H. **默认 L0**：of() 必须走 getOrDefault —— 老鱼种全部落在默认分支上。
 *   I. **L2 只在生食时出事**（煮熟就正常）；L3 生熟都反胃；L4 生熟都凋零。
 *   J. apply() **整段包在 try/catch 里**（吃一口菜绝不能因为这张表抛异常。
 *      与 LeaderboardHooks.onLanded 同一条纪律）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PALAT = 'src/main/java/com/whitecobalt/anglertackle/recipe/FishPalatability.java';
const DISH_RECIPE = 'src/main/java/com/whitecobalt/anglertackle/recipe/DishRecipe.java';
const DISH_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/DishItem.java';
const CHUNK_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/FishChunkItem.java';
const COOKBOOK = 'src/main/java/com/whitecobalt/anglertackle/client/screen/CookbookScreen.java';
const LEDGER = 'src/main/java/com/whitecobalt/anglertackle/recipe/PalatabilityLedger.java';
const SPECIES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';
const DOC = 'docs/25-鱼料理与配料方案.md';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 食用适宜度（L0~L5）检查：分级、进不进菜单、接线、兼容性默认值 ===\n');

const java = read(PALAT);
const speciesJava = read(SPECIES);

// ── 真实鱼种 id（从 FishSpecies 数出来，不手抄）──────────────────────────────
const realFish = new Set([...speciesJava.matchAll(/new FishSpecies\("([a-z_]+)"/g)].map((m) => m[1]));
if (realFish.size < 40) bad('从 FishSpecies 只数出 ' + realFish.size + ' 条鱼（预期 47），鱼种表是不是换写法了？');
else ok('FishSpecies 里数出 ' + realFish.size + ' 条鱼');

// ── 解析等级表：put(m, L<k>, "id", "id", …) ────────────────────────────────
// ⚠ 先剥掉 // 行注释再取引号：注释里也会出现引号（FishBase 原文），
//   不剥就会把 "Flesh is tasty but a little dry" 当成鱼 id。
const table = new Map();      // id -> level
const levelsSeen = new Map(); // level -> [ids]
for (const m of java.matchAll(/put\(m,\s*L(\d),([\s\S]*?)\);/g)) {
  const level = Number(m[1]);
  const body = m[2].replace(/\/\/[^\n]*/g, '');
  const ids = [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (ids.length === 0) bad('L' + level + ' 那一行一个鱼 id 都没有');
  for (const id of ids) {
    if (!/^[a-z_]+$/.test(id)) { bad('等级表里的 id 不像鱼种：' + id); continue; }
    if (!realFish.has(id)) { bad('等级表里的鱼种不存在：' + id + '（写错一个字母 = 这条鱼永远 L0，且不报错）'); continue; }
    if (table.has(id)) { bad(id + ' 在等级表里写了两次（' + table.get(id) + ' / ' + level + '）'); continue; }
    table.set(id, level);
    if (!levelsSeen.has(level)) levelsSeen.set(level, []);
    levelsSeen.get(level).push(id);
  }
}
if (table.size === 0) bad('等级表一条都没解析出来');
else {
  const dist = ['L1', 'L2', 'L3', 'L4', 'L5'].map((n, i) => n + '×' + (levelsSeen.get(i + 1) || []).length).join(' · ');
  ok('等级表解析出 ' + table.size + ' 条鱼：' + dist);
}

// ── B. L0 不许显式写 ─────────────────────────────────────────────────────
if (levelsSeen.has(0)) {
  bad('等级表里出现了 L0（' + levelsSeen.get(0).join(', ') + '）—— 这张表的设计是"没有记录 = L0"，'
    + '显式写 L0 会让下一个人以为"必须写全"，老鱼种"行为逐字不变"这条承诺就靠不住了');
} else {
  ok('L0 没有出现在表里（没记录的鱼 = L0 ⇒ 老 23 条食用鱼行为不变）');
}

// ── D. L5 ↔ docs/25 §13.5.3 双向相等 ─────────────────────────────────────
const lang = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
const zhToId = {};
for (const [k, v] of Object.entries(lang)) {
  const m = /^item\.anglertackle\.([a-z_]+)$/.exec(k);
  if (m && typeof v === 'string') zhToId[v] = m[1];
}
const docLines = read(DOC).split(/\r?\n/);
let h = docLines.findIndex((l) => /^#{2,4}\s*13\.5\.3/.test(l));
let listLine = null;
for (let j = h + 1; h >= 0 && j < docLines.length && j < h + 20; j++) {
  const l = docLines[j].trim();
  if (!l) continue;
  if (/^#{2,4}\s/.test(l)) break;
  if (l.startsWith('**') && l.includes('·')) { listLine = l; break; }
}
const docL5 = new Set();
if (!listLine) bad('docs/25 里找不到 §13.5.3 的"不可食用"清单那一行');
else {
  for (const name of listLine.replace(/\*\*/g, '').split(/[·、,，]/).map((s) => s.trim()).filter(Boolean)) {
    const id = zhToId[name];
    if (!id) bad('§13.5.3 里的鱼名在语言文件里查不到：' + name);
    else docL5.add(id);
  }
}
const codeL5 = new Set(levelsSeen.get(5) || []);
const onlyDoc = [...docL5].filter((x) => !codeL5.has(x));
const onlyCode = [...codeL5].filter((x) => !docL5.has(x));
if (onlyDoc.length || onlyCode.length) {
  bad('L5 与 docs/25 §13.5.3 不一致：只有文档说不可食用的 [' + onlyDoc.join(', ')
    + ']，只有代码说 L5 的 [' + onlyCode.join(', ') + ']');
} else if (docL5.size > 0) {
  ok('L5 = docs/25 §13.5.3 的 ' + docL5.size + ' 条，双向一致：' + [...codeL5].join(', '));
}

// ── E/F. 与菜品菜单的关系 ────────────────────────────────────────────────
const dishJava = read(DISH_RECIPE);
const allowBlock = /private static Map<String, Set<Dish>> build\(\) \{([\s\S]*?)\n        return m;/.exec(dishJava);
const inMenu = new Set();
if (!allowBlock) bad('读不到 DishRecipe.build() 里的逐鱼许可表');
else for (const m of allowBlock[1].matchAll(/put\(m, "([a-z_]+)"/g)) inMenu.add(m[1]);

const shouldBeInMenu = [...table.entries()].filter(([, lv]) => lv >= 1 && lv <= 4).map(([id]) => id);
const missing = shouldBeInMenu.filter((id) => !inMenu.has(id));
if (missing.length) bad('这些鱼分了 L1~L4 却不在菜品菜单里（分了级却做不出菜）：' + missing.join(', '));
else ok('L1~L4 的 ' + shouldBeInMenu.length + ' 条全部在菜品菜单里');

const l5InMenu = [...codeL5].filter((id) => inMenu.has(id));
if (l5InMenu.length) bad('L5 不该进菜品菜单，却有这些：' + l5InMenu.join(', '));
else ok('L5 一条都不在菜品菜单里（"有些不进菜单"成立，且它们本来就不在 ⇒ 零删除）');

// ── G. 接线 ──────────────────────────────────────────────────────────────
const itemJava = read(DISH_ITEM);
const fin = /finishUsingItem\(ItemStack stack[\s\S]*?\n    \}/.exec(itemJava);
if (!fin) bad('DishItem 里找不到 finishUsingItem');
else {
  const body = fin[0];
  if (!/FishPalatability\.apply\(/.test(body)) {
    bad('DishItem.finishUsingItem 没有调 FishPalatability.apply —— 分了级却没人执行（吃了没反应，且不报错）');
  } else if (!/"sashimi"\.equals\(dishId\(\)\)/.test(body)) {
    bad('"生"的判据不是"这道菜是不是刺身" —— 写死 true 会让所有熟菜也吃出生食惩罚，'
      + '写死 false 会让 L2 的寄生虫永远不生效');
  } else {
    ok('DishItem 吃完菜调 apply，且"生"只判刺身（Dish.SASHIMI 是唯一 Base.RAW 的菜型）');
  }
}

// ── G2. 生块那条路（2026-10-11 补）────────────────────────────────────────
// L2 的规则是"生食才有事、煮熟就正常"。只挂菜那条路的话，它**只在刺身上生效** ——
// 而生鱼块是更常见的那条路（钓上来直接咬一口）。所以两块都要接，且"生"必须读真源。
const chunkJava = read(CHUNK_ITEM);
if (!/class FishChunkItem extends Item/.test(chunkJava)) {
  bad('读不到 FishChunkItem');
} else {
  const cfin = /finishUsingItem\(ItemStack stack[\s\S]*?\n    \}/.exec(chunkJava);
  if (!cfin) {
    bad('FishChunkItem 没有 finishUsingItem —— 生块吃下去不判食用适宜度 ⇒ '
      + 'L2 的"生食有寄生虫"只在刺身上生效，而生块是更常见的那条路');
  } else if (!/FishPalatability\.apply\(player, stack, !cooked\)/.test(cfin[0])) {
    bad('FishChunkItem 的"生"不是读 cooked 字段（写死 true/false 会让熟块也中招，或者生块永远不中招）');
  } else {
    ok('FishChunkItem 生块咬一口也判，"生"读的是真源 cooked 字段');
  }
}

// ── G3. 悬浮文本（用户 2026-10-11："加 debuff 提示在悬浮文本"）──────────────
// ⚠ 界面**不许自己抄一张"哪条鱼有什么负面"的表** —— docs/29 的纪律，
//   check-cookbook.js 的 cookbook-hover-own-numbers 就是守它的（"悬浮显示自己算效果 = 分叉"）。
const hover = /appendHoverText\(ItemStack stack[\s\S]*?\n    \}/.exec(itemJava);
if (!hover) bad('DishItem 里找不到 appendHoverText');
else {
  const h = hover[0];
  if (!/FishPalatability\.warningKey\(/.test(h)) {
    bad('DishItem 的悬浮文本没有调 FishPalatability.warningKey —— 界面自己写死或自己查表，'
      + '迟早会出现"悬浮写着没事、吃了反胃"');
  } else if (!/"sashimi"\.equals\(id\)/.test(h)) {
    bad('悬浮文本里"生"的判据与真正发效果的那处不一致（熟菜会被标上生食风险）');
  } else {
    ok('DishItem 悬浮文本走 FishPalatability.warningKey（与发效果同一个 biteOf，生熟判据一致）');
  }
}
// 文案键必须真的存在 —— 写出一个不存在的键，游戏里悬浮会显示成一串键名
const PALAT_KEYS = ['tooltip.anglertackle.palat.raw_parasite', 'tooltip.anglertackle.palat.nausea',
  'tooltip.anglertackle.palat.wither', 'tooltip.anglertackle.palat.inedible'];
const missingKeys = PALAT_KEYS.filter((k) => !lang[k]);
if (missingKeys.length) bad('语言文件里没有这些味道文案键（悬浮会显示成键名）：' + missingKeys.join(', '));
else ok('4 条味道文案的中文键都在');

// ── G4. 菜谱界面（用户 2026-10-11："加 debuff 提示在…菜谱"）────────────────
// 与悬浮文本同一条纪律：菜谱**不许**自己抄一份"哪条鱼有什么负面"，
// 否则会出现"菜谱说没事、吃了反胃"。鱼清单也必须来自 allowedPairs()（与「做法」页同源）。
const cookbookJava = read(COOKBOOK);
if (!/class CookbookScreen/.test(cookbookJava)) {
  bad('读不到 CookbookScreen');
} else {
  const palat = /private List<Line> palatabilityLines\(String dishId\) \{[\s\S]*?\n    \}/.exec(cookbookJava);
  if (!palat) {
    bad('CookbookScreen 没有 palatabilityLines —— 菜谱里看不到味道/负面提示（用户要求"加在菜谱"）');
  } else {
    const p = palat[0];
    if (!/FishPalatability\.warningKey\(/.test(p)) {
      bad('菜谱的味道提示没调 FishPalatability.warningKey —— 界面自己查表 = 与机制分叉');
    } else if (!/DishRecipe\.allowedPairs\(\)/.test(p)) {
      bad('菜谱的鱼清单不是从 allowedPairs() 现取的（另抄一份 ⇒ 加了鱼以后菜谱会漏）');
    } else if (!/"sashimi"\.equals\(dishId\)/.test(p)) {
      bad('菜谱里"生"的判据与真正发效果那处不一致（熟菜会被标上生食风险）');
    } else {
      ok('菜谱「效果」页的味道提示走 FishPalatability.warningKey + allowedPairs()（与悬浮、与机制同源）');
    }
    if (!/if \(byKey\.isEmpty\(\)\) \{\s*return out;/.test(p)) {
      bad('菜谱没有"没有任何负面就一行都不加"的早退 —— L0/L1 的菜也会多出一段空行（与改动前不一致）');
    }
  }
}

// ── G5. 整鱼悬浮文本（"不可食用"唯一能看到的地方）─────────────────────────
const FISH_ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/FishItem.java';
const fishJava = read(FISH_ITEM);
const fhover = /appendHoverText\(ItemStack stack[\s\S]*?\n    \}/.exec(fishJava);
if (!fhover) {
  bad('FishItem 里找不到 appendHoverText');
} else {
  const f = fhover[0];
  if (!/FishPalatability\.inDishMenu\(/.test(f) || !/FishPalatability\.INEDIBLE_KEY/.test(f)) {
    bad('整鱼悬浮文本没有用 FishPalatability 判"能不能吃" —— L5 那五条鱼在菜谱里**永远看不到**，'
      + '这里再不写，玩家就彻底不知道该鱼为什么什么菜都做不了');
  } else if (!/\.warningKey\(data\.speciesId\(\), true\)/.test(f)) {
    bad('整鱼悬浮文本没有给 L2~L4 提示（整鱼是生的，正该说"生食有几率反胃"）');
  } else {
    ok('整鱼悬浮文本：L5 写"不可食用"、L2~L4 写生食提示，文案全部来自 FishPalatability');
  }
}

// ── G6. 菜谱里的"不可食用"说明 ─────────────────────────────────────────────
if (!/FishPalatability\.inedibleSpecies\(\)/.test(cookbookJava)) {
  bad('菜谱没有用 FishPalatability.inedibleSpecies() 列出不可食用的鱼 —— 界面自己抄名单，'
    + '以后动等级表时那一行就成了谎话');
} else {
  ok('菜谱的"不可食用"说明走 FishPalatability.inedibleSpecies()（不抄第二份名单）');
}

// ── K. 慢性风险（汞 / 雪卡 / 二噁英）：累积型（用户 2026-10-11 定案 C①）──────────
const ledgerJava = read(LEDGER);
if (!/class PalatabilityLedger extends SavedData/.test(ledgerJava)) {
  bad('读不到 PalatabilityLedger（慢性风险的计数层）');
} else {
  if (!/public static final String FILE_ID = "anglertackle_palatability";/.test(ledgerJava)) {
    bad('账本的 FILE_ID 被改名 —— 改名 = 老存档的累积计数全丢');
  } else {
    ok('累积计数走世界级 SavedData，FILE_ID 未改名（老存档没有这个文件 ⇒ 从 0 开始，天然兼容）');
  }
  if (!new RegExp('THRESHOLD\\s*=\\s*\\d+').test(ledgerJava)) bad('账本没有 THRESHOLD 常量');
  if (!/public boolean bump\(UUID player, String risk\)/.test(ledgerJava)) bad('账本没有 bump（没人计数）');
}

const applyBody2 = /public static void apply\(Player player[\s\S]*?\n    \}/.exec(java);
if (applyBody2) {
  const body = applyBody2[0];
  const iChronic = body.indexOf('applyChronic(player, species)');
  const iBite = body.indexOf('Bite bite = biteOf(species, raw)');
  if (iChronic < 0) {
    bad('apply 里没有记慢性风险 —— 汞/雪卡/二噁英永远不会累积（用户定的 C① 落不了地）');
  } else if (iBite >= 0 && iChronic > iBite) {
    bad('"记慢性"排在了"判即时负面"之后 —— 裸盖鱼是 L0（吃一口什么都不会发生）却有汞，'
      + '这样写它**永远不计数**，而那恰恰是慢性最该生效的那条鱼');
  } else {
    ok('apply 先记慢性、后判即时负面（L0 但有汞的裸盖鱼也会进账）');
  }
}
const chronicDoc = lang['tooltip.anglertackle.palat.chronic.mercury'] || '';
if (!chronicDoc) {
  bad('语言文件里没有慢性风险文案键（悬浮会显示成一串键名）');
} else if (!/%s/.test(chronicDoc)) {
  bad('慢性风险文案没用 %s 占位 —— "吃够几次"被写死在文案里 = 第二个真源，'
    + '调 PalatabilityLedger.THRESHOLD 时悬浮文本立刻开始撒谎');
} else {
  ok('慢性风险文案用 %s 占位，次数由 PalatabilityLedger.THRESHOLD 现传');
}

// ── L. 木桶发酵（用户 2026-10-11 定案的做法）──────────────────────────────
// 用户原话："发酵鱼可以通过把鱼放进原版木桶一天制取，成品直接出现替换该鱼，**但鱼的数据不变**"。
// 这条**替掉了**我先前用盐腌的配方 —— 那个是我编的（hákarl 传统是"埋 + 压 + 时间"，不用盐 ✗）。
const FERMENT_DATA = 'src/main/java/com/whitecobalt/anglertackle/recipe/FermentingData.java';
const FERMENT_HOOK = 'src/main/java/com/whitecobalt/anglertackle/event/BarrelFermenting.java';
const fdata = read(FERMENT_DATA);
const fhook = read(FERMENT_HOOK);

if (!/class FermentingData extends SavedData/.test(fdata)) bad('读不到 FermentingData');
else if (!/FILE_ID = "anglertackle_fermenting"/.test(fdata)) {
  bad('发酵清单的 FILE_ID 被改名 —— 老存档里正在发酵的桶全丢');
} else ok('发酵清单走世界级 SavedData，FILE_ID 未改名（老存档没有该文件 ⇒ 空清单，天然兼容）');

if (!/DURATION_TICKS\s*=\s*24000L/.test(fdata)) {
  bad('发酵时长不是 24000 tick（用户口径是"**一天**"）');
} else ok('发酵时长 = 24000 tick = 一天');

// ★★ 用户口径："鱼的数据不变" —— 靠 applyComponents 把整份组件搬过去
if (!/out\.applyComponents\(in\.getComponents\(\)\)/.test(fhook)) {
  bad('发酵产物没有把原鱼的组件搬过去 —— 用户明确要求"**鱼的数据不变**"'
    + '（丢了 FISH_DATA 就认不出是哪条鲨鱼、也进不了菜品系统）');
} else ok('发酵产物 applyComponents(in.getComponents()) —— 鱼种/重量/体长/档位/评级 全部保留');

// 性能：必须在"清单为空"时早退，且按间隔节流（仓库明令忌讳扫世界）
// ⚠ 这条断言第一版被我写成了要求源码里出现字面量 `$SCAN_INTERVAL`（正则写岔了）✗ ——
//   于是它对着**正确的**代码报假红。假红比没有守卫更坏：下一个人会直接把断言删掉。
if (!/% SCAN_INTERVAL != 0/.test(fhook)) {
  bad('tick 扫描没有按 SCAN_INTERVAL 节流 —— 那就是每 tick 全量遍历');
} else if (!/pending\.isEmpty\(\)\) \{\s*return;/.test(fhook)) {
  bad('清单为空时没有早退 —— 没人在发酵时也白跑');
} else ok('tick 扫描：按 20 tick 节流 + 清单为空时早退（代价只与"正在发酵的桶数"成正比）');

// 只认记下来的坐标；不许出现"扫世界/强加载区块"的写法
if (/getAllBlockEntities|getChunk\(|hasChunkAt|getLoadedChunks|for \(.*ChunkPos/.test(fhook)) {
  bad('发酵扫描里出现了"扫世界 / 强加载区块"的写法 —— 这正是 check-dish-effect-hooks 里'
    + '"会为了找矿强加载区块，卡服"那类事故');
} else ok('发酵扫描只查清单里记下的坐标，不扫世界、不强加载区块');

// ⚠⚠ 分类修正锁死：电鳗**不许**再回到 L4
if (/put\(m, L4,[^;]*electric_eel/.test(java)) {
  bad('电鳗又被写回 L4 —— 科普中国原文说它是"原产地著名的食用鱼 / 餐桌美味"，'
    + '危险是**电击**不是毒性；把"抓它危险"当成"吃它危险"是分类错误（2026-10-11 已修正）');
} else ok('电鳗没有被写回 L4（分类修正锁死）');
if (/put\(m, L4,[^;]*sailfish/.test(java)) {
  bad('雨伞旗鱼又被写回 L4 的**即时**负面 —— 汞是慢性蓄积，它只能走 chronicRisk 的累积型');
} else if (!/case "sailfish":/.test(java)) {
  bad('雨伞旗鱼既不在 L4、也不在 chronicRisk 里 —— 那条汞的风险整个丢了');
} else ok('雨伞旗鱼只在 chronicRisk（累积型汞），没有即时负面');

// 发酵名单只许有格陵兰鲨（别的鱼要加必须另找依据）
if (!/stack\.is\(ModItems\.GREENLAND_SHARK\.get\(\)\)/.test(fhook)) {
  bad('发酵名单里没有格陵兰鲨 —— 那条真实的"鲜食有毒、须发酵"就落不了地');
} else if (/electric_eel|sailfish|alligator_gar/.test(fhook)) {
  bad('发酵名单里混进了别的鱼（电鳗的危险是电击不是毒性，不该走发酵）');
} else ok('发酵名单只有格陵兰鲨（唯一有"鲜食有毒、须处理"依据的那条）');

// ── H/I/J. 默认值与分支 ──────────────────────────────────────────────────
if (!/return Table\.LEVEL\.getOrDefault\(speciesId, L0\);/.test(java)) {
  bad('of() 没有走 getOrDefault(…, L0) —— 老鱼种就没有默认等级了，一读就是 0 以外的值或直接抛异常');
} else ok('of() 走 getOrDefault(…, L0)：没记录的鱼 = L0');

const bite = /public static Bite biteOf\(String speciesId, boolean raw\) \{[\s\S]*?\n    \}/.exec(java);
if (!bite) bad('找不到 biteOf');
else {
  const b = bite[0];
  if (!/case L2: return raw \? Bite\.NAUSEA_CHANCE : Bite\.NONE;/.test(b)) {
    bad('L2 不是"只有生食才出事"：煮熟就正常的规则被破坏（虹鳟煮熟了还中寄生虫）');
  } else if (!/case L3: return Bite\.NAUSEA;/.test(b)) {
    bad('L3 不是必反胃（越难吃 debuff 越强这条断了）');
  } else if (!/case L4: return Bite\.WITHER;/.test(b)) {
    bad('L4 不是凋零（危险级没接上）');
  } else {
    ok('biteOf：L2 只生食有概率 / L3 必反胃 / L4 凋零');
  }
}

const applyBody = /public static void apply\(Player player[\s\S]*\n    \}/.exec(java);
if (!applyBody) bad('找不到 apply');
else if (!/try \{[\s\S]*\} catch \(Throwable ignored\)/.test(applyBody[0])) {
  bad('apply() 没有整段 try/catch —— 这张表一出问题就会让"吃东西"本身抛异常');
} else ok('apply() 整段包在 try/catch 里（吃一口菜绝不会因为这张表崩）');

if (!/import net\.minecraft\.world\.effect\.MobEffects;/.test(java)) bad('没导入 MobEffects');
// 26.1.2：MobEffects.CONFUSION 更名为 NAUSEA（同一个效果"反胃"；旧名已删除）。
if (!/MobEffects\.NAUSEA/.test(java)) bad('反胃用的是 MobEffects.NAUSEA（26.1.2 对旧 CONFUSION 的更名，就是原版"反胃"）');
if (!/MobEffects\.WITHER/.test(java)) bad('凋零用的是 MobEffects.WITHER');

// ── M. 加工品（处理过 = 安全）：安全不是靠表，是靠"它压根不走这张表" ✏ 2026-10-11 ──
// 用户定案的四件加工品：腌鲨鱼肉 / 冷冻刺身 / 处理过的电鳗 / 去卵鳄雀鳝肉。
// 它们的语义是"危险已经被**加工**消掉了"，所以有两条**互相咬合**的要求：
//   ① 必须是普通 Item —— 发酵产物走 applyComponents 保留了 FISH_DATA（见上文 L 段），
//      而 DishItem / FishChunkItem 会拿 speciesId 去查这张表 ⇒ 格陵兰鲨 L4 的腌鲨鱼肉
//      会当场把 L4 的凋零**还给你**，加工就白做了；
//   ② 必须**真的能吃**（.food(...)）—— 否则"处理完安全了"变成"处理完是个摆件"，
//      玩家拿着一块 64 堆叠的装饰品。这两条任缺一条，玩家都会以为自己在吃安全食品。
const ITEMS_JAVA = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';
const PROCESSED = ['hakarl', 'frozen_sashimi', 'shocked_eel', 'boneless_gar'];
{
  const itemsJava = read(ITEMS_JAVA);
  const notPlain = [], notFood = [], notStack = [];
  for (const id of PROCESSED) {
    const m = new RegExp('register\\("' + id + '"[\\s\\S]{0,420}?\\)\\);').exec(itemsJava);
    if (!m) { bad('ModItems 里找不到加工品 ' + id + '（改名了？）'); continue; }
    const block = m[0];
    if (!/new Item\(/.test(block) || /DishItem|FishChunkItem/.test(block)) notPlain.push(id);
    if (!/\.food\(/.test(block)) notFood.push(id);
    if (!/stacksTo\(64\)/.test(block)) notStack.push(id);
  }
  notPlain.length
    ? bad('加工品不是普通 Item（' + notPlain.join(', ') + '）—— DishItem/FishChunkItem 会按 speciesId 查这张表，'
      + '于是"加工去毒"的产物会把原本的 L2~L4 负面**原样还回来**（发酵产物保留 FISH_DATA，鲨鱼是 L4）')
    : ok('4 件加工品都是普通 Item（不走这张表 ⇒ 加工真的消掉了负面）');
  notFood.length
    ? bad('加工品不能吃（' + notFood.join(', ') + '，缺 .food(...)）—— "处理过就安全"变成了"处理过是个摆件"')
    : ok('4 件加工品都有 .food(...)（hakarl / 冷冻刺身 / 处理过的电鳗 / 去卵鳄雀鳝肉：处理过 = 安全食用）');
  notStack.length
    ? bad('加工品不是 64 堆叠：' + notStack.join(', '))
    : ok('4 件加工品都是 64 堆叠');
}

console.log(fail === 0
  ? '\n✅ 食用适宜度检查通过：分级齐全、L5 不进菜单、老鱼种默认 L0、接线正确'
  : '\n❌ 食用适宜度检查失败：' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
