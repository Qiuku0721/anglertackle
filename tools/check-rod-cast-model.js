'use strict';
/**
 * 台钓竿"抛竿换图"检查 —— 用户 2026-10-11：
 * "台钓竿没有跟随状态变化改变的贴图，需要做到**抛竿出去后明显是鱼线的部分消失，收回后还原**"。
 *
 * 做法照**原版鱼竿**：主模型里写 `overrides`（判据 `anglertackle:cast`）+ 客户端注册那个判据。
 *
 * 这个检查器守五件事：
 *   A. 五把台钓竿的主模型里**都有 overrides**，判据名对、指向自己的 `_cast` 模型（漏一把 = 那把不换图）。
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

const MDL = 'src/main/resources/assets/anglertackle/models/item';
const TEX = 'src/main/resources/assets/anglertackle/textures/item';
const SETUP = 'src/main/java/com/whitecobalt/anglertackle/client/ClientSetup.java';
const MATS = ['wood', 'iron', 'gold', 'diamond', 'netherite'];

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 台钓竿"抛竿换图"检查（overrides / 判据 / 同几何 / 确实少了鱼线）===\n');

const setup = read(SETUP);

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
  const mainRel = `${MDL}/${m}_float_rod.json`;
  const castRel = `${MDL}/${m}_float_rod_cast.json`;
  const mainTex = `${TEX}/${m}_float_rod.png`;
  const castTex = `${TEX}/${m}_float_rod_cast.png`;

  // A. overrides
  if (!exists(mainRel)) { fail('缺主模型 ' + mainRel); continue; }
  const main = JSON.parse(read(mainRel));
  const ov = Array.isArray(main.overrides) ? main.overrides : [];
  if (ov.length === 0) {
    fail(m + '_float_rod.json 没有 overrides —— 这把竿抛竿后**不会**换成无线的那张');
    continue;
  }
  const hit = ov.find((o) => o && o.predicate && o.predicate['anglertackle:cast'] !== undefined);
  if (!hit) {
    fail(m + '_float_rod.json 的 overrides 里没有 `anglertackle:cast` 判据（判据名不对就永远不触发）');
  } else if (!String(hit.model).endsWith(m + '_float_rod_cast')) {
    fail(m + '_float_rod.json 的 overrides 指向了别的模型：' + hit.model);
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

  // C. 判据注册
  if (!/ItemProperties\.register\(/.test(setup)) {
    fail('ClientSetup 里没有 ItemProperties.register —— 判据没注册，overrides 永远不生效');
  } else if (!new RegExp('"cast"\\)').test(setup) && !/,\s*"cast"\)/.test(setup)) {
    fail('ClientSetup 注册的判据名不是 "cast"（与模型里的 anglertackle:cast 对不上）');
  }
  if (!/ClientFishingState\.get\(\)\.inSession\(\)/.test(setup)) {
    fail('判据没有用 ClientFishingState.inSession() 判"在抛竿"');
  }
  if (!/getMainHandItem\(\)\.getItem\(\)\s*==\s*stack\.getItem\(\)/.test(setup)) {
    fail('判据没有判"**手上这根**"（getMainHandItem() == stack）—— 模型 overrides 是对**每个堆栈**求值的，'
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
  ? '\n✅ 抛竿换图接线正确：五把台钓竿都有 overrides、判据按"手上这根"判断、cast 图同几何且确实少了鱼线'
  : '\n❌ 抛竿换图检查未通过（' + bad + ' 项）');
process.exit(bad === 0 ? 0 : 1);
