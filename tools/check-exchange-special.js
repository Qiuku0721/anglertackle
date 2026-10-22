'use strict';
/**
 * 兑换里的两处**特殊行为**检查（用户 2026-10-11 拍板）：
 *
 *   A3 **熏鱼兑换必须数据一致才能堆叠** —— "兑换16个起步的熏鱼，品质金，具体种类随你，
 *      但**需要数据一致保证可堆叠性**，上线兑换一次一组"。
 *      ⇒ 兑换表里带 `fixedChunk` 的条目，产出时要用**固定组件**构造（`FishChunkData(species,tier,kg)`）✗
 *        否则 16 个各带一份不同数据 ⇒ 会分成 16 摞 ✗。
 *
 *   A4 **鳄雀鳝顶替红鱼** —— "不做专门兑换但**可以替换任意其他兑换所需红鱼**，例如金轮的兑换"。
 *      ⇒ `ShopMaterials.matches` 里多一条出口 ✓ 但**必须带门槛**：
 *        ① 只对"索要红档（minTier >= 5）"的兑换生效 ✗ 否则变成**万能鱼**（要绿档的也能拿红鱼顶 ✗）；
 *        ② 它自己也得是红档 ✗（鳄雀鳝是 P_G_R={紫,金,红}，紫/金档不算红鱼 ✗）。
 *
 * 这两条都**不查数值**（价位带与档位由 gen-shop-prices.js 逐条核 ✓ 这里不抄第二份 ✗），
 * 只查"接线有没有、门槛在不在"。
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const RULES = 'tools/shop-rules.js';
const MATERIALS = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopMaterials.java';
const GEN = 'tools/gen-shop-prices.js';
const CATALOG = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopCatalog.java';

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 兑换特殊行为检查（熏鱼固定组件 / 鳄雀鳝顶替红鱼）===\n');

const rules = read(RULES);
const materials = read(MATERIALS);
const gen = read(GEN);
const catalog = read(CATALOG);

// ── A3 固定组件 ────────────────────────────────────────────────────────────
{
  // ⚠ 只在 **EXCHANGES 那一段**里数 `fixedChunk`（2026-10-13）：
  //   联赛商店（`docs/39` P4）的 `LEAGUE_OFFERS` 也给红品质鱼带 fixedChunk，
  //   但它们**不是"用鱼换熏鱼"那类兑换**（是花积分买），混进来会把这条对账数错 ✗
  //   —— 判据不变（每条产出熏鱼的兑换都必须带 fixedChunk），只是把统计范围收窄到该收的地方 ✓
  const exBlock = /const EXCHANGES = \[([\s\S]*?)\n\];/.exec(rules);
  const exSrc = exBlock ? exBlock[1] : rules;
  const fixed = [...exSrc.matchAll(/fixedChunk:\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const smokedCount = (exSrc.match(/item:\s*'anglertackle:smoked_fish'/g) || []).length;
  if (fixed.length === 0) {
    fail('shop-rules.js 里没有带 `fixedChunk` 的兑换 —— A3 的熏鱼兑换丢了（16 个会分成 16 摞）');
  } else if (smokedCount === 0) {
    fail('shop-rules.js 里没有 smoked_fish 产出 —— A3 那条兑换没了');
  } else if (fixed.length !== smokedCount) {
    // ⚠ 逐条对应：**每一条**产出熏鱼的兑换都必须带 fixedChunk。
    //   （第一版只查"有没有"，于是"删掉其中一条的 fixedChunk"这个变异抓不到 ✗ —— 负例当场把它揭出来 ✓）
    fail('产出熏鱼的兑换有 ' + smokedCount + ' 条，但只有 ' + fixed.length
      + ' 条带 `fixedChunk` —— 缺的那条产出的 16 个组件各不相同 ⇒ **堆不起来** ✗');
  } else {
    for (const f of fixed) {
      for (const key of ['species', 'tier', 'weightKg']) {
        if (!new RegExp(key + '\\s*:').test(f)) {
          fail('`fixedChunk` 缺 `' + key + '` —— 三件套必须齐全，少一项就不保证堆叠');
        }
      }
    }
    ok('shop-rules.js 有 ' + fixed.length + ' 条带 fixedChunk 的兑换（与 ' + smokedCount
      + ' 条熏鱼产出逐条对应，鱼种/档位/重量三件套齐）');
  }
  if (!/fixedFishData\(\)/.test(gen)) {
    fail('生成器没有把 fixedChunk 输出成 Java（ShopCatalog 里那三个字段就永远是空/0）');
  }
  if (!/fixedSpecies,\s*int fixedTier,\s*float fixedWeightKg/.test(gen.replace(/\s+/g, ' '))) {
    fail('生成器 emit 的 Exchange 记录里没有 (fixedSpecies, fixedTier, fixedWeightKg) 三个字段');
  }
  if (!/set\(com\.whitecobalt\.anglertackle\.registry\.ModDataComponents\.FISH_CHUNK\.get\(\)/.test(materials)
    || !/x\.fixedSpecies\(\)/.test(materials)) {
    fail('ShopMaterials.resultStack 没有用固定值写 FISH_CHUNK —— '
      + '那样 16 个熏鱼的组件各不相同，**堆不起来**（A3 的原话就是"需要数据一致保证可堆叠性"）');
  } else {
    ok('ShopMaterials.resultStack 用 fixedSpecies/fixedTier/fixedWeightKg 写 FISH_CHUNK');
  }
  if (!/fixedFishData\(\)/.test(catalog)) fail('生成的 ShopCatalog 里没有 fixedFishData()（生成器没跑？）');
}

// ── A4 鳄雀鳝顶替红鱼（含两个门槛）──────────────────────────────────────────
{
  if (!/GAR_ID\s*=\s*"alligator_gar"/.test(materials)) {
    fail('ShopMaterials 里没有 alligator_gar 的顶替出口 —— A4 的"替换任意兑换所需红鱼"没实现');
  } else {
    ok('ShopMaterials 里有鳄雀鳝顶替出口（GAR_ID = alligator_gar）');
  }
  // 门槛①：只对红档兑换生效
  if (!/x\.minTier\(\)\s*>=\s*5/.test(materials)) {
    fail('鳄雀鳝顶替**没有"只对索要红档的兑换生效"这个门槛** —— 它就成了万能鱼：'
      + '要绿档的兑换也能拿它顶（A4 的原话是"替换…所需**红鱼**"，不是"什么都能换"）');
  } else {
    ok('门槛①在：只对 minTier >= 5（索要红档）的兑换生效');
  }
  // 门槛②：它自己也得是红档
  if (!/GAR_ID\.equals\(path\)\s*&&\s*d\.effectiveTier\(\)\s*>=\s*5/.test(materials)) {
    fail('鳄雀鳝顶替**没有要求"它自己也是红档"** —— 鳄雀鳝是 P_G_R={紫,金,红}，'
      + '紫档/金档的它不算"红鱼"，不该顶');
  } else {
    ok('门槛②在：顶替的那条鳄雀鳝自己也必须是红档（effectiveTier >= 5）');
  }
  // 原物种那条路不许被改坏：同名鱼仍然只看 minTier
  if (!/path\.equals\(x\.fishId\(\)\)/.test(materials)) {
    fail('ShopMaterials.matches 里"同名鱼照旧按 minTier 判"那条路被改掉了');
  }
}

console.log(bad === 0
  ? '\n✅ 兑换特殊行为接线正确（熏鱼固定组件可堆叠 / 鳄雀鳝只顶红鱼且自己也得是红档）'
  : '\n❌ 兑换特殊行为检查未通过（' + bad + ' 项）');
process.exit(bad === 0 ? 0 : 1);
