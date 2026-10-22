/*
 * 配件**见底之后不得再提供加成**。
 *
 * 为什么单独立这个检查（2026-10-01 用户实测反馈）：
 *   "即使耐久用光配件加成貌似还会生效且显示不变"。
 *   根因是装配信息里虽然存着**真实的 ItemStack**（磨损就在里面），
 *   读属性时却按**物品 id 新建了一个满耐久的堆栈**：
 *     RodStats.statsOf(String itemId) → new ItemStack(item) → PART_STATS
 *   于是磨损完全不参与计算；拟饵/鱼饵那条链（FishingSession.equippedBaitTier）
 *   更是只读 id，0/20 的拟饵照样把鱼种池往高档拉。
 *
 *   这种 bug 在代码上完全看不出来：类型对、编译过、数值"合理"，
 *   只有把"HUD 显示 0/20"和"实际还在加成"两件事对起来才会露馅。
 *
 * 判据（读源码结构，不重算业务逻辑）：
 *   A. RodStats.of() 必须用 parts.*Stack()（真堆栈），不能用 parts.line() 这类只有 id 的访问器。
 *   B. RodStats 里必须存在 isWornOut()，且 statsOf 用它把见底配件降级成 NEUTRAL。
 *   C. isWornOut 必须先判 isDamageableItem()（否则 getMaxDamage()==0 会把无耐久配件的加成整片抹掉）。
 *   D. FishingSession.equippedBaitTier 也必须挡住见底的拟饵/鱼饵。
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./java-source.js');

// ATL_ROOT 供 tools/negtest.ps1 指向临时副本；不给就是仓库根目录 ✓
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const J = (p) => path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle', p);

let bad = 0;
const fail = (m) => { console.error('❌ ' + m); bad++; };
const ok = (m) => console.log('  ✅ ' + m);

// ---------------------------------------------------------------- A / B / C
const rod = stripComments(fs.readFileSync(J('fishing/RodStats.java'), 'utf8'));
const ofBody = /public static RodStats of\(ItemStack[\s\S]*?\n    \}/.exec(rod);
if (!ofBody) {
  fail('RodStats.java 里找不到 of(ItemStack) 方法体');
} else {
  const body = ofBody[0];
  const withId = [...body.matchAll(/statsOf\(\s*parts\.(line|reel|hook)\(\)\s*\)/g)].map((m) => m[1]);
  const withStack = [...body.matchAll(/statsOf\(\s*parts\.(lineStack|reelStack|hookStack)\(\)\s*\)/g)].map((m) => m[1]);
  if (withId.length) {
    fail('RodStats.of() 还在用只含物品 id 的访问器（parts.' + withId.join('/') + '()）—— ' +
         '那样读到的是满耐久属性，配件用光了加成还在');
  }
  if (withStack.length < 3) {
    fail('RodStats.of() 没有按真实堆栈读三个配件（只看到 ' + withStack.length + ' 个 *Stack()）');
  } else if (!withId.length) {
    ok('RodStats.of() 用真实堆栈读配件（磨损才参与计算）');
  }
}

if (!/static\s+boolean\s+isWornOut\s*\(/.test(rod)) {
  fail('RodStats 里没有 isWornOut()');
} else {
  const worn = /static\s+boolean\s+isWornOut\s*\(ItemStack[^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(rod);
  if (!worn || !/isDamageableItem\(\)/.test(worn[1])) {
    fail('isWornOut() 没有先判 isDamageableItem() —— getMaxDamage() 对无耐久物品返回 0，' +
         '会得出"0 >= 0 已见底"，把那些配件的加成整片抹掉');
  } else if (!/getDamageValue\(\)\s*>=\s*[^;]*getMaxDamage\(\)/.test(worn[1])) {
    fail('isWornOut() 的判据不是 damage >= maxDamage');
  } else {
    ok('isWornOut() = damage >= maxDamage，且有无耐久保护');
  }
  const statsOf = /private static PartStats statsOf\([\s\S]*?\n    \}/.exec(rod);
  if (!statsOf || !/isWornOut\(/.test(statsOf[0])) {
    fail('statsOf() 没调用 isWornOut() —— 见底的配件仍然会返回它自己的加成');
  } else {
    ok('statsOf() 把见底配件降级成 NEUTRAL');
  }
}

// ---------------------------------------------------------------- D
const sess = stripComments(fs.readFileSync(J('fishing/FishingSession.java'), 'utf8'));
const baitTier = /public int equippedBaitTier\(\)\s*\{([\s\S]*?)\n    \}/.exec(sess);
if (!baitTier) {
  fail('FishingSession.java 里找不到 equippedBaitTier()');
} else if (!/isWornOut\(/.test(baitTier[1])) {
  fail('equippedBaitTier() 没有挡见底的拟饵/鱼饵 —— 0/20 的拟饵照样会把鱼种池往高档拉');
} else {
  ok('equippedBaitTier() 挡住了见底的拟饵/鱼饵');
}

console.log(bad === 0
  ? '\n✅ 配件见底后不再提供加成（合成属性 + 拟饵/鱼饵两条链都挡住了）'
  : `\n配件耐久生效检查：${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
