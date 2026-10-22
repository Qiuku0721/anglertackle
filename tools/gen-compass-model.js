/*
 * 生成追踪罗盘的物品模型（带动态指针）。
 *
 * ── 踩过的坑（用户原话："罗盘没贴图"）──────────────────────────
 * 第一版我写的是 `"layer0": "minecraft:item/compass"`，想着"引用原版指南针的图就行"。
 * 结果游戏里是**紫黑方块**。原因：**原版根本没有 `textures/item/compass.png` 这张图** ——
 * 它只有 `compass_00.png` ~ `compass_31.png` 共 32 帧，指针的转动就是在这 32 帧之间切。
 * `item/compass` 是一个**模型**（带 overrides 的模型），不是贴图。
 *
 * ── 现在怎么做 ────────────────────────────────────────────────
 * 33 条 overrides **逐字照抄**原版 `assets/minecraft/models/item/compass.json`：
 * 谓词名用 `angle`（原版的 `minecraft:angle`，我们按 (物品,属性) 对它单独注册了一份，
 * 见 ClientHutLocator.registerItemProperties），
 * 角度分档、帧号顺序、默认帧（compass_16）全部不动。
 *
 * 只改一处：overrides 里的 `"model"` 补上 `minecraft:` 命名空间。
 * 原版写的是相对路径 `item/compass_17`（在它自己的包内能解析），
 * 我们写在**另一个命名空间**的模型里，显式写全名才不会解析到 anglertackle 下。
 *
 * ── 合规 ──────────────────────────────────────────────────────
 * 这里只**引用** Mojang 的资源路径，没有把任何 png 复制进本模组的 jar
 * （docs/12 的红线是"不能打包再分发"，不是"不能引用"）。
 * 等美术出图，把 33 条 model 换成自己的帧即可，谓词和角度分档不用动。
 */
const fs = require('fs');
const path = require('path');

const OUT = 'src/main/resources/assets/anglertackle/models/item/tracking_compass.json';

// 角度分档（照抄原版，一个数字都不改）→ 帧号
// 原版：0.000000 用默认帧(compass_16)，之后每档 +1 帧，绕一圈到 compass_15。
const STEPS = [
  [0.000000, 16], [0.015625, 17], [0.046875, 18], [0.078125, 19],
  [0.109375, 20], [0.140625, 21], [0.171875, 22], [0.203125, 23],
  [0.234375, 24], [0.265625, 25], [0.296875, 26], [0.328125, 27],
  [0.359375, 28], [0.390625, 29], [0.421875, 30], [0.453125, 31],
  [0.484375, 0], [0.515625, 1], [0.546875, 2], [0.578125, 3],
  [0.609375, 4], [0.640625, 5], [0.671875, 6], [0.703125, 7],
  [0.734375, 8], [0.765625, 9], [0.796875, 10], [0.828125, 11],
  [0.859375, 12], [0.890625, 13], [0.921875, 14], [0.953125, 15],
  [0.984375, 16],   // 兜底：角度快要绕回 0 时回到默认帧
];

const frame = (n) => 'minecraft:item/compass_' + String(n).padStart(2, '0');

const model = {
  parent: 'minecraft:item/generated',
  textures: {
    // 默认层：和原版一样用 compass_16（"指针朝上"那一帧）
    layer0: frame(16),
  },
  overrides: STEPS.map(([angle, n]) => ({
    predicate: { angle: angle },
    model: frame(n),
  })),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(model, null, 2) + '\n', 'utf8');

// ---- 自检：容易写错的地方全部断言一遍 ----
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 追踪罗盘模型生成 ===\n');
ok('已写出 ' + OUT);
if (model.overrides.length === 33) ok('overrides 33 条（含兜底）');
else bad('overrides ' + model.overrides.length + ' 条，应为 33');
// 每一档都必须指向**原版**帧，不能落到本命名空间
const wrongNs = model.overrides.filter((o) => !o.model.startsWith('minecraft:'));
if (wrongNs.length === 0) ok('所有帧都显式写了 minecraft: 命名空间（漏了会解析到 anglertackle 下，变成紫黑方块）');
else bad(wrongNs.length + ' 条帧没写命名空间：' + wrongNs.map((o) => o.model).join(', '));
// 角度必须递增且都在 [0,1)
let sorted = true;
for (let i = 1; i < STEPS.length; i++) if (!(STEPS[i][0] > STEPS[i - 1][0])) sorted = false;
if (sorted && STEPS[0][0] === 0 && STEPS[STEPS.length - 1][0] < 1) ok('角度严格递增且落在 [0,1)');
else bad('角度分档不合法（必须严格递增、从 0 开始、最后一条 < 1）');
// 覆盖 0~31 全部 32 帧
const used = new Set(STEPS.map((s) => s[1]));
if (used.size === 32 && Math.min(...used) === 0 && Math.max(...used) === 31) ok('32 帧全部用到（0…31）');
else bad('用到的帧不是完整的 0…31：' + [...used].sort((a, b) => a - b).join(','));
// layer0 必须是存在的帧
if (/compass_\d\d/.test(model.textures.layer0)) ok('layer0 = ' + model.textures.layer0 + '（**不是** minecraft:item/compass —— 那张图不存在）');
else bad('layer0 写错了：' + model.textures.layer0);

console.log('\n' + (fail === 0 ? '✅ 模型就绪' : '❌ ' + fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
