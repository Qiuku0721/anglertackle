'use strict';
/**
 * 台钓竿"抛竿换图"检查 —— 用户 2026-10-11：
 * "台钓竿没有跟随状态变化改变的贴图，需要做到**抛竿出去后明显是鱼线的部分消失，收回后还原**"。
 *
 * 做法照**原版鱼竿**的分派思路，但 26.1.2 换了写法：
 *   · 换图定义在 `assets/anglertackle/items/<竿>.json` 的 `minecraft:range_dispatch`
 *     （property = `anglertackle:cast`，threshold 1.0 → `_cast` 模型，fallback → 带线主模型）；
 *   · 判据是"按 id 注册的 range-select 属性类型"（`RegisterRangeSelectItemModelPropertyEvent`
 *     + `CastItemProperty`），不再是 `ItemProperties.register(物品, id, 函数)`。
 *   ⚠ 旧写法（主模型里写 `overrides` + `ItemProperties`）在 26.1.2 已不存在，检查器随之迁移。
 *
 * 这个检查器守五件事：
 *   A. 五把台钓竿的**物品模型定义都有 range_dispatch**，判据名对、threshold=1 指向自己的
 *      `_cast` 模型、fallback 指向带线主模型（漏一把 / 接反 = 那把不换图或永远无线）。
 *   B. `_cast` 的**模型与贴图都存在**（少一个 = 游戏里紫黑格）。
 *   C. 客户端**注册了判据**：物品、命名空间、以及两个关键条件 ——
 *      ① 用 `ClientFishingState.get().inSession()` 判"在抛竿"；
 *      ② 判**手上这根**（`getMainHandItem().getItem() == stack.getItem()`）。
 *      ⚠ ② 最容易漏：模型 overrides 是对**每个堆栈**求值的，只判"玩家在钓鱼"的话，
 *        背包里和另一只手上的台钓竿会一起变成无线的图。
 *   D. **`_cast` 图与主图同几何**：竿尖像素必须一致 —— 否则抛竿那一刻鱼线会接到别处。
 *   E. **`_cast` 图确实少了东西**（不透明像素严格少于主图）—— 防止有人把主图复制一份当 cast 交差。
 *
 * ⚠ 这 5 张 cast 图是**从用户给的主图里按几何规则切出来的**（杆轴 vs 鱼线轴，顶点=竿梢，
 *   离哪条轴近就归哪条），不是重画的 —— 见 docs 与提交说明。
 */

const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const ITEMS = 'src/main/resources/assets/anglertackle/items';
const MDL = 'src/main/resources/assets/anglertackle/models/item';
const TEX = 'src/main/resources/assets/anglertackle/textures/item';
const SETUP = 'src/main/java/com/whitecobalt/anglertackle/client/ClientSetup.java';
const PROP = 'src/main/java/com/whitecobalt/anglertackle/client/CastItemProperty.java';
const MATS = ['wood', 'iron', 'gold', 'diamond', 'netherite'];

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 台钓竿"抛竿换图"检查（overrides / 判据 / 同几何 / 确实少了鱼线）===\n');

const setup = read(SETUP);
const prop = read(PROP);

/** 量一张图：第一个不透明像素（竿尖）+ 不透明像素数。 */
function probe(rel) {
  const { w, h, rgba } = decodePng(fs.readFileSync(path.join(ROOT, rel)));
  let tip = null, opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 128) {
        opaque++;
        if (!tip) tip = { x, y };
      }
    }
  }
  return { w, h, tip, opaque };
}

for (const m of MATS) {
  const itemRel = `${ITEMS}/${m}_float_rod.json`;
  const mainRel = `${MDL}/${m}_float_rod.json`;
  const castRel = `${MDL}/${m}_float_rod_cast.json`;
  const mainTex = `${TEX}/${m}_float_rod.png`;
  const castTex = `${TEX}/${m}_float_rod_cast.png`;

  // A. 物品模型定义里的 range_dispatch（26.1.2 的换图写法）
  //
  // 旧写法是主模型 JSON 里的 `overrides` + `ItemProperties` 注册的判据；
  // 26.1.2 两样都换了：定义搬到 `assets/<ns>/items/<物品>.json`，换图靠
  // `minecraft:range_dispatch` 引用一个"按 id 注册的 range-select 属性"。
  // 断言的**语义**不变：这把竿必须有一个条目（threshold 1.0）指向自己的 _cast 模型，
  // 且默认（fallback）指向带鱼线的主模型。
  if (!exists(mainRel)) { fail('缺主模型 ' + mainRel); continue; }
  if (!exists(itemRel)) {
    fail('缺物品模型定义 ' + itemRel + ' —— 这把竿抛竿后**不会**换成无线的那张');
    continue;
  }
  const def = JSON.parse(read(itemRel));
  const dm = def && def.model;
  if (!dm || dm.type !== 'minecraft:range_dispatch') {
    fail(itemRel + ' 的 model.type 不是 minecraft:range_dispatch（当前 ' + (dm && dm.type) + '）'
      + ' —— 没有分派就没有"抛竿换图"');
    continue;
  }
  if (dm.property !== 'anglertackle:cast') {
    fail(itemRel + ' 的 range_dispatch 判据是 ' + dm.property
      + '，不是 anglertackle:cast（判据名不对就永远不触发）');
  }
  const entries = Array.isArray(dm.entries) ? dm.entries : [];
  const hit = entries.find((e) => e && Number(e.threshold) === 1);
  if (!hit) {
    fail(itemRel + ' 的 range_dispatch 里没有 threshold=1 的条目 —— 判据返回 1.0 时不会切到无线图');
  } else if (!String(hit.model && hit.model.model).endsWith('item/' + m + '_float_rod_cast')) {
    fail(itemRel + ' 的 threshold=1 条目指向了别的模型：' + (hit.model && hit.model.model));
  }
  if (!dm.fallback || !String(dm.fallback.model).endsWith('item/' + m + '_float_rod')) {
    fail(itemRel + ' 的 fallback 不是 ' + m + '_float_rod（' + (dm.fallback && dm.fallback.model)
      + '）—— 没抛竿时就不显示带鱼线的那张了');
  }

  // B. cast 模型 + 贴图存在
  if (!exists(castRel)) fail('缺 ' + castRel);
  if (!exists(castTex)) fail('缺 ' + castTex);
  if (!exists(castRel) || !exists(castTex)) continue;
  // ⚠ cast 模型必须**指向 cast 贴图**：指向主贴图的话模型换是换了，画面上一点变化都没有 ✗
  const castModel = JSON.parse(read(castRel));
  const layer = castModel.textures && castModel.textures.layer0;
  if (!layer || !String(layer).endsWith(m + '_float_rod_cast')) {
    fail(castRel + ' 的 layer0 指向 ' + layer + '，不是 ' + m + '_float_rod_cast');
  }

  // C. 判据注册（26.1.2：register(属性 id, MapCodec) 一次注册一个**属性类型**，不按物品）
  if (!/RegisterRangeSelectItemModelPropertyEvent/.test(setup)) {
    fail('ClientSetup 里没有 RegisterRangeSelectItemModelPropertyEvent 的订阅 —— 属性没注册，range_dispatch 永远求不到值');
  } else if (!/fromNamespaceAndPath\(\s*AnglersTackle\.MOD_ID\s*,\s*"cast"\s*\)/.test(setup)) {
    fail('ClientSetup 注册的属性 id 不是 "<modid>:cast"（与模型 JSON 里的 anglertackle:cast 对不上）');
  } else if (!/CastItemProperty\.MAP_CODEC/.test(setup)) {
    fail('ClientSetup 注册的不是 CastItemProperty.MAP_CODEC —— 注册了 id 却没有判据实现');
  }
  // 判据本体在 CastItemProperty（一根属性覆盖五根竿 ⇒ 在这里只检查一次）
  if (!/ClientFishingState\.get\(\)\.inSession\(\)/.test(prop)) {
    fail('判据没有用 ClientFishingState.inSession() 判"在抛竿"');
  }
  if (!/getMainHandItem\(\)\.getItem\(\)\s*==\s*\w+\.getItem\(\)/.test(prop)) {
    fail('判据没有判"**手上这根**"（getMainHandItem() == stack）—— range_dispatch 是**对每个堆栈**求值的，'
      + '只判"玩家在钓鱼"的话，背包里与另一只手上的台钓竿会一起变成无线的图');
  }


  // D/E. 同几何 + 确实少了东西
  const a = probe(mainTex), b = probe(castTex);
  if (!a.tip || !b.tip) { fail(m + '：有一张整图透明'); continue; }
  if (a.tip.x !== b.tip.x || a.tip.y !== b.tip.y) {
    fail(m + '：cast 图的竿尖 (' + b.tip.x + ',' + b.tip.y + ') 与主图 (' + a.tip.x + ',' + a.tip.y
      + ') 不一致 —— 抛竿那一刻鱼线会接到别处');
  }
  if (b.opaque >= a.opaque) {
    fail(m + '：cast 图的不透明像素 ' + b.opaque + ' 不少于主图 ' + a.opaque
      + ' —— 它看起来就是主图复制了一份，鱼线根本没被去掉');
  }
  if (a.w !== 128 || b.w !== 128) fail(m + '：图不是 128×128（' + a.w + ' / ' + b.w + '）');
  if (bad === 0 || true) {
    console.log('  · ' + m.padEnd(10) + ' 主图 ' + a.opaque + ' px → cast ' + b.opaque
      + ' px（少 ' + (a.opaque - b.opaque) + '）  竿尖同为 (' + a.tip.x + ',' + a.tip.y + ')');
  }
}

console.log(bad === 0
  ? '\n✅ 抛竿换图接线正确：五把台钓竿都有 range_dispatch、判据按"手上这根"判断、cast 图同几何且确实少了鱼线'
  : '\n❌ 抛竿换图检查未通过（' + bad + ' 项）');
process.exit(bad === 0 ? 0 : 1);
