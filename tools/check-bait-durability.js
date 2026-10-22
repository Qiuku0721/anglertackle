/*
 * check-bait-durability.js —— 台钓饵和路亚饵的耐久必须**对称**。
 *
 * ── 这个 bug 长什么样 ─────────────────────────────────────────
 * 用户在游戏里发现："路亚饵料的耐久是可以被消耗的"（他没说错，我在上一轮说
 * "饵料耐久不会被消耗"是**错的** —— 我只 grep 了 hurtAndBreak/shrink，
 * 而扣耐久实际用的是 setDamageValue，所以漏了）。
 *
 * 真正的 bug 是：`applyBiteDurabilityCost()` 里**无条件扣 lure 槽**，
 * 根本没有 bait 槽。于是：
 *   · 路亚竿（用 lure 槽）→ 拟饵耐久正常掉
 *   · 台钓竿（用 bait 槽）→ 鱼饵耐久**永远不掉**
 *
 * 更隐蔽的一层：**tier 的取法是分竿型的**（`equippedBaitTier()` 里
 * `floatRod ? bait : lure`），而扣耐久不分 —— 于是台钓竿"用了 bait 的加成、
 * 扣的却是 lure 的耐久"。两处不一致，表现只是"某个槽的耐久莫名其妙在掉"。
 *
 * ── 判据 ──────────────────────────────────────────────────────
 * 三处必须都按竿型区分：取槽、写回、退耐久。少任何一处都会让两个体系不对称。
 *
 * 用法：node tools/check-bait-durability.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOOLS = process.env.ATL_ROOT ? path.join(ROOT, 'tools') : __dirname;
const { stripComments } = require(path.join(TOOLS, 'java-source.js'));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 饵料耐久对称性检查 ===\n');

const SES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java';
const code = stripComments(fs.readFileSync(path.join(ROOT, SES), 'utf8'));

// ---------------------------------------------------------------- ① 扣耐久：按竿型取槽
{
  if (/ItemStack lure = floatRod \? parts\.baitStack\(\) : parts\.lureStack\(\);/.test(code)) {
    ok('扣耐久时按竿型取槽（floatRod ? baitStack : lureStack）');
  } else if (/ItemStack lure = parts\.lureStack\(\);/.test(code)) {
    bad('扣耐久时**无条件**取 lure 槽 —— 台钓饵的耐久永远不会掉，'
      + '而路亚饵正常掉。用户报的就是这个');
  } else {
    bad('找不到取饵料槽的语句（写法变了，这个检查需要跟着改）');
  }
}

// ---------------------------------------------------------------- ② 写回：也按竿型
{
  const writeBack = [...code.matchAll(/next = (floatRod \? next\.withBait\(copy\) : next\.withLure\(copy\)|next\.withLure\(copy\))/g)]
    .map((m) => m[1]);
  if (writeBack.length === 0) {
    bad('找不到写回饵料槽的语句');
  } else {
    const badOnes = writeBack.filter((s) => !s.startsWith('floatRod'));
    if (badOnes.length === 0) {
      ok('写回时也按竿型（' + writeBack.length + ' 处都区分了 bait/lure）');
    } else {
      bad(writeBack.length + ' 处写回里有 ' + badOnes.length + ' 处无条件写 lure —— '
        + '扣在 bait 上、写回 lure 上，改动会**丢失**（耐久看着不变）');
    }
  }
}

// ---------------------------------------------------------------- ③ 退耐久也要对称
{
  // 退耐久在 refundBiteDurabilityCost 里，必须也用 floatRod 判断
  const i = code.indexOf('refundBiteDurabilityCost');
  if (i < 0) {
    bad('找不到 refundBiteDurabilityCost');
  } else {
    const body = code.slice(i, i + 2000);
    if (/floatRod \? parts\.baitStack\(\) : parts\.lureStack\(\)/.test(body)
        && /floatRod \? next\.withBait\(copy\) : next\.withLure\(copy\)/.test(body)) {
      ok('退耐久按竿型（和扣耐久对称）');
    } else {
      bad('退耐久没有按竿型 —— 台钓饵会"只增不减"（扣在 bait、退在 lure，而 lure 槽是空的）');
    }
  }
}

// ---------------------------------------------------------------- ④ 配置项只该有一个（共用一个步长）
{
  const cfg = stripComments(fs.readFileSync(path.join(ROOT,
    'src/main/java/com/whitecobalt/anglertackle/Config.java'), 'utf8'));
  if (/lureDurabilityPerBite/.test(cfg)) {
    ok('配置项 lureDurabilityPerBite 存在（名字只有 lure 是历史原因，实际台钓/路亚共用）');
  } else {
    bad('缺 lureDurabilityPerBite');
  }
  if (/baitDurabilityPerBite/.test(cfg)) {
    bad('同时存在 baitDurabilityPerBite 和 lureDurabilityPerBite —— '
      + '两个步长会让"台钓和路亚消耗速度不同"，而用户要的是"和路亚一样"');
  } else {
    ok('没有第二个步长配置（台钓和路亚共用同一个值 = 用户要的"一样"）');
  }
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  这个 bug 的教训：');
console.log('    "饵料耐久不会被消耗"是我上一轮的**错误结论** —— 我只 grep 了');
console.log('    hurtAndBreak/shrink，而扣耐久用的是 setDamageValue。');
console.log('    搜"谁改了这个值"要按**赋值点**搜，不能按 API 名字猜。');
process.exitCode = fail === 0 ? 0 : 1;
