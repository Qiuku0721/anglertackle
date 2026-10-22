/*
 * check-line-anchor.js —— 鱼线的**上端必须接在竿尖上**。
 *
 * 用户 2026-10-02 截图反馈："鱼线实际上没有连接到杆子上，影响沉浸感，
 * 这是端点位置的问题，需要调整。"
 *
 * 这个坑踩了两次，值得记牢：
 *   ① 最早那个端点是**估**出来的：eye + 视线×1.1 + 右×0.35 − 上×0.25。
 *      竿是按**手持变换**渲染的，竿尖在屏幕上的位置跟"视线前方 1.1 格"毫无关系。
 *   ② 改成照抄原版 `FishingHookRenderer.getPlayerHandPos` 之后**仍然没接上**。
 *      原因是原版那两个数 `getPointOnPlane(±0.525, −0.1)` 是对着**原版自己那根竿**
 *      调出来的：模型父级 `item/handheld_rod`（firstperson 变换 rotation [0,90,25]、
 *      translation [0,1.6,0.8]）、竿尖在贴图**右上**角；
 *      而我们的模型是 `item/generated`（rotation [0,−90,25]、translation [1.13,3.2,1.13]）、
 *      竿尖在贴图**左上**角。变换差 180°，贴图也是镜像的，于是线头仍然差大半个屏幕。
 *
 * 现在的做法（`client/render/RodTipAnchor.java`）：订阅 `RenderHandEvent`
 * （由 `ClientHooks.renderSpecificFirstPersonHand` 在 `renderArmWithItem` **之前**触发），
 * 在事件给的、已经在相机空间里的 PoseStack 副本上照抄那两步变换
 * （手持 / BOW 使用动画 → 物品自己的 firstperson 显示变换 → `translate(−0.5,−0.5,−0.5)`），
 * 再把"竿尖在图标上的那个像素"乘进去。这样 FOV、视角、左右手、蓄力进度全部自动一致，
 * 也与我们的贴图朝向无关。
 *
 * 断言（每条都对应一种"改回去就坏、而且看不出来"）：
 *   A. 第一人称优先用 RodTipAnchor.worldTip()，且必须**排在**原版近平面兜底之前。
 *   B. 不许出现旧估算公式的特征量（视线方向的 1.1 / 右向 0.35）。
 *   C. 左右侧必须由"我的竿在哪只手"决定（RodItem + getMainArm），
 *      不许照抄原版的 `FISHING_ROD_CAST` 取反。
 *   D. 第三人称分支要在（按身体朝向摆到身前）。
 *   E. rodTipPosition 真的**调用**了 rodHandSide()（不是把一侧写死）。
 *   F. 兜底不能用 getPointOnPlane 冒充精确解：只有 worldTip 返回 null 时才允许走它。
 *   G. RodTipAnchor 必须真的复刻了那两步变换：
 *      G1 订阅 RenderHandEvent / G2 只认 RodItem / G3 双手都有竿时主手优先
 *      G4 手持变换与 BOW 使用动画的常量一个不少 / G5 用物品自己的显示变换
 *      G6 模型空间居中 / G7 相机空间→世界用相机正交基 / G8 从事件给的矩阵出发
 *   H. 竿尖像素常量必须与**图标 PNG 里量出来的**一致：改了图标没改常量 → 红。
 *
 * 用法：node tools/check-line-anchor.js
 */
const fs = require('fs');
const path = require('path');
const { decodePng } = require('./image-to-sprite.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const FILE = 'src/main/java/com/whitecobalt/anglertackle/client/render/FishingLineRenderer.java';
const ANCHOR = 'src/main/java/com/whitecobalt/anglertackle/client/render/RodTipAnchor.java';
const TEX_DIR = 'src/main/resources/assets/anglertackle/textures/item';

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 鱼线端点（竿尖锚点）检查 ===\n');

/** 读一份 Java 源码并剥掉注释（注释里会引用旧公式/常量当反面教材）。 */
function readCode(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

/** 取一个方法体（按大括号配平）。可见性随意（worldTip 是 public 的）。 */
function body(src, name) {
  const m = new RegExp('(?:public |private |protected )?static [\\w.<>\\[\\]]+ ' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}

// ================================================================= 一、鱼线渲染侧
const src = readCode(FILE);
if (src === null) {
  fail('找不到 ' + FILE);
} else {
  const tip = body(src, 'rodTipPosition');
  if (!tip) {
    fail('找不到 rodTipPosition()');
  } else {
    const iExact = tip.indexOf('RodTipAnchor.worldTip');
    const iFallback = tip.indexOf('getNearPlane()');

    // ---------------------------------------------------------- A 精确竿尖优先
    if (iExact >= 0 && iFallback >= 0 && iExact < iFallback) {
      ok('第一人称优先用 RodTipAnchor.worldTip()（屏幕上那根竿的真实竿尖）');
    } else if (iExact < 0) {
      fail('竿尖没有用 RodTipAnchor.worldTip() —— 一旦只剩"估算 / 照抄原版常数"，' +
        '线头就会离开竿尖（用户 2026-10-02 报的就是这个）');
    } else if (iFallback >= 0 && iExact > iFallback) {
      fail('worldTip() 排在近平面兜底**之后** —— 兜底永远先返回，精确竿尖根本用不到');
    } else {
      fail('第一人称分支缺少原版近平面兜底（getNearPlane/getPointOnPlane）—— ' +
        '第一帧还没渲染过手时会没有竿尖可用');
    }

    // ---------------------------------------------------------- B 不许回到旧公式
    if (/scale\(\s*1\.1\s*\)/.test(tip) || /right\.scale\(\s*0\.35\s*\)/.test(tip)) {
      fail('竿尖又用回了旧的"估算公式"（视线×1.1 / 右×0.35）—— 那正是线接不上竿的原因');
    } else {
      ok('没有旧估算公式的残留');
    }

    // ---------------------------------------------------------- D 第三人称分支
    if (/yBodyRot/.test(tip) && /0\.8\s*\*/.test(tip)) {
      ok('第三人称分支在（按身体朝向把锚点摆到身前）');
    } else {
      fail('缺第三人称分支 —— 第三人称下线头会飘在玩家头顶附近，而不是竿尖');
    }

    // ---------------------------------------------------------- E 真的用了左右手判定
    //
    // ⚠ 这条是补的：变异测试里把调用点写成 `int side = 1;`（rodHandSide() 还在、但没人调用）
    //   一开始**没有被抓到** —— 只验"方法存在"就会漏掉"根本没用它"。
    if (/rodHandSide\s*\(\s*player\s*\)/.test(tip)) {
      ok('竿尖函数真的调用了 rodHandSide()（不是把一侧写死）');
    } else {
      fail('rodTipPosition 没有调用 rodHandSide() —— 左右侧被写死了，' +
        '左手持竿或副手持竿时线头会挂到空手那一侧');
    }
  }

  // ---------------------------------------------------------------- C 左右手判定
  const side = body(src, 'rodHandSide');
  if (!side) {
    fail('找不到 rodHandSide() —— 左右侧必须按"我的竿在哪只手"判断');
  } else {
    if (/RodItem/.test(side) && /getMainArm\(\)/.test(side)) {
      ok('左右侧按"竿在哪只手"判断（RodItem + getMainArm）');
    } else {
      fail('rodHandSide() 没有按 RodItem / getMainArm 判断 —— ' +
        '会挂到错误的（可能是空手的）那一侧');
    }
    if (/FISHING_ROD_CAST/.test(src)) {
      fail('代码里出现了 FISHING_ROD_CAST —— 原版那句"拿的不是鱼竿就左右互换"是为了' +
        '"抛竿后换成别的物品"，我们的竿没声明那个能力，照抄会把线头放到空手一侧');
    } else {
      ok('没有照抄原版的 FISHING_ROD_CAST 取反（我们的竿不声明那个能力）');
    }
  }

  // ---------------------------------------------------------------- 端点真的被用上了
  if (/rodTipPosition\(\s*player\s*,/.test(src)) {
    ok('渲染时用的是这个竿尖坐标（不是另算一份）');
  } else {
    fail('渲染路径没有调用 rodTipPosition(player, …)');
  }
}

// ================================================================= 二、竿尖追踪器
console.log('');
console.log('--- RodTipAnchor（相机空间里的真实竿尖）---');
const anchor = readCode(ANCHOR);
if (anchor === null) {
  fail('找不到 ' + ANCHOR + ' —— 没有它就只能退回"照抄原版常数"，线接不上竿');
} else {
  // ---------------------------------------------------------- G1 订阅 RenderHandEvent
  if (/@SubscribeEvent\s+public static void onRenderHand\s*\(\s*RenderHandEvent/.test(anchor)) {
    ok('订阅了 RenderHandEvent（原版渲染手之前触发，PoseStack 已在相机空间）');
  } else {
    fail('没有订阅 RenderHandEvent —— 拿不到"相机空间 + 视角摆动"的那个 PoseStack');
  }

  // ---------------------------------------------------------- G8 从事件给的矩阵出发
  if (/getPoseStack\(\)\s*\.\s*last\(\)\s*\.\s*pose\(\)/.test(anchor)) {
    ok('从事件给的矩阵出发（继承了视角摆动），不是从单位矩阵从零搭');
  } else {
    fail('没有继承事件给的 PoseStack —— 视角摆动没算进去，转头时线头会偏');
  }

  // ---------------------------------------------------------- G2 只认 RodItem
  // 两条一起验：既要有 RodItem 过滤（模式变量），又要真的**用**了它拿竿型 ——
  // 否则"过滤还在、但竿型写死 / 根本没用"这种改法会漏过去。
  if (/instanceof RodItem rod\b/.test(anchor) && /rod\.rodType\(\)/.test(anchor)) {
    ok('只对 RodItem 记录竿尖，并按它的竿型取尖端像素（别的物品不会污染鱼线端点）');
  } else {
    fail('没有按 RodItem 过滤 / 没有按 rod.rodType() 取尖端像素 —— ' +
      '拿着任何东西都会覆盖竿尖记录，或两类竿共用一套常量');
  }

  // ---------------------------------------------------------- G3 双手都有竿时主手优先
  if (/InteractionHand\.OFF_HAND/.test(anchor) && /getMainHandItem\(\)/.test(anchor)
      && /instanceof RodItem/.test(anchor)) {
    ok('两只手都拿竿时跳过副手（主手优先，与 rodHandSide 一致）');
  } else {
    fail('没有"双手都拿竿时主手优先"的处理 —— 副手后渲染会覆盖，线会挂到另一只手的竿上');
  }

  // ---------------------------------------------------------- G4 复刻手持 / BOW 变换
  const handConsts = ['0.56F', '-0.52F', '-0.72F'];
  const bowConsts = ['-0.2785682F', '0.18344387F', '0.15731531F', '-13.935F', '35.3F', '-9.785F', '45.0F'];
  const missHand = handConsts.filter((c) => !anchor.includes(c));
  const missBow = bowConsts.filter((c) => !anchor.includes(c));
  if (missHand.length === 0) {
    ok('复刻了原版手持变换 applyItemArmTransform（0.56 / −0.52 / −0.72）');
  } else {
    fail('手持变换常量缺了：' + missHand.join(' '));
  }
  if (missBow.length === 0) {
    ok('复刻了 BOW 使用动画（我们右键蓄力走的就是它：拉开 + 转 45°）');
  } else {
    fail('BOW 使用动画常量缺了：' + missBow.join(' ') + ' —— 蓄力时竿的姿态和记下的竿尖会对不上');
  }

  // RodTipAnchor 只复刻了 BOW 那一条使用动画；竿要是换成别的动画，竿尖就会错位。
  const rodSrc = readCode('src/main/java/com/whitecobalt/anglertackle/item/RodItem.java');
  if (rodSrc !== null && /getUseAnimation\s*\([^)]*\)\s*\{[^}]*UseAnim\.BOW/.test(rodSrc)) {
    ok('RodItem 的使用动画仍然是 BOW（与追踪器复刻的那条分支一致）');
  } else {
    fail('RodItem 的 getUseAnimation 不是 UseAnim.BOW —— RodTipAnchor 只复刻了 BOW 分支，' +
      '换成 EAT/BLOCK/SPEAR 等动画后竿的姿态会变，竿尖立刻错位');
  }

  // ---------------------------------------------------------- G5 物品自己的显示变换
  if (/applyTransform\s*\(/.test(anchor)
      && /ItemDisplayContext\.FIRST_PERSON_RIGHT_HAND/.test(anchor)
      && /ItemDisplayContext\.FIRST_PERSON_LEFT_HAND/.test(anchor)) {
    ok('用了物品自己的 firstperson 显示变换（item/generated 与 item/handheld_rod 不一样，不能写死）');
  } else {
    fail('没有用物品模型自己的 firstperson 显示变换 —— 写死某个变换就会在换模型/换材质时错位');
  }

  // ---------------------------------------------------------- G6 模型空间居中
  if (/translate\(\s*-0\.5F\s*,\s*-0\.5F\s*,\s*-0\.5F\s*\)/.test(anchor)) {
    ok('照抄了 ItemRenderer 里把模型空间居中的 translate(−0.5,−0.5,−0.5)');
  } else {
    fail('缺少 translate(−0.5,−0.5,−0.5) —— 物品模型空间是 [0,1]³，不居中会整体偏半格');
  }

  // ---------------------------------------------------------- G7 相机空间 → 世界
  //
  // ⚠ 这条一开始写成"文件里出现 getLeftVector/getUpVector/getLookVector/getPosition 就算过"，
  //   变异测试里把 return 改成 `pos.add(tip)`（三个向量**声明还在、但根本没参与运算**）
  //   —— **没被抓到**。和之前 `int side = 1;` 那次是同一类漏洞：只验"出现过"，
  //   不验"用上了"。所以这里改成验**返回表达式本身**：三个正交基必须各自乘在 tip 上，
  //   而且相机空间的 +x 是"右"（= −left）、−z 是"前"（= −look），符号不能反。
  const world = body(anchor, 'worldTip');
  const basisDecl = ['getLeftVector', 'getUpVector', 'getLookVector', 'getPosition'];
  const missBasis = basisDecl.filter((m) => !anchor.includes(m));
  if (missBasis.length > 0) {
    fail('换算世界坐标时缺了相机的 ' + missBasis.join(' / ') +
      ' —— 用"眼睛 + 固定偏移"就又是估算，转头/换 FOV 立刻错位');
  } else if (!world) {
    fail('找不到 worldTip()');
  } else if (!/-\s*left\.\w\(\)\s*\*\s*tip\.\w/.test(world)
      || !/up\.\w\(\)\s*\*\s*tip\.\w/.test(world)
      || !/-\s*look\.\w\(\)\s*\*\s*tip\.\w/.test(world)) {
    fail('worldTip() 的返回值没有真的把相机正交基乘上去（−left·x + up·y − look·z）—— ' +
      '只是声明了 left/up/look 却不用，线头会随视角乱飞');
  } else if (/getPosition\(\)\s*\.\s*add\(\s*tip\s*\)/.test(world)) {
    fail('worldTip() 把相机空间偏移直接加在相机位置上 —— 相机空间不是世界空间，' +
      '转头时线头会跟着转');
  } else {
    ok('相机空间→世界用的是相机正交基（−left·x + up·y − look·z），三个向量都参与了运算');
  }

  // ---------------------------------------------------------- G9 乘回 modelview
  //
  // ⚠ 2026-10-02 用户第二次报："现在反而端点不固定了，摇动视角会跑到不同地方，
  //   还是跟摇动方向反着来的，那线端点落点都到玩家身体里了"。
  //   真凶：原版 GameRenderer.renderItemInHand 给手部 PoseStack 乘的是**相机旋转的逆**
  //   （posestack.mulPose(p_333953_.invert(...))），而 modelview 才是相机旋转。
  //   顶点按 `Projection × ModelView × PoseStack × v` 变换 —— 所以事件里的 PoseStack
  //   **不是相机空间**。只按它算出来的点，到相机的距离是对的、方向是反的：
  //   线头随视角反向乱跑，还常常落进玩家身体里（半径约 1 格）。
  //   下面 I 段用数值不变量把这件事钉死（转动视角时端点在屏幕上不许动）。
  const handler = body(anchor, 'onRenderHand');
  const appliesModelView = handler !== null && /getModelViewMatrix\s*\(\s*\)/.test(handler)
    && /tip\s*\.\s*mul\s*\(\s*RenderSystem\s*\.\s*getModelViewMatrix\s*\(\s*\)\s*\)/.test(handler);
  if (appliesModelView) {
    ok('把 PoseStack 算出的点乘回了 modelview（相机旋转）—— 它才是真正的相机空间坐标');
  } else {
    fail('没有把点乘回 RenderSystem.getModelViewMatrix() —— 手部 PoseStack 里乘的是' +
      '"相机旋转的逆"，只按它算出来的点会随视角反向乱跑、还落进玩家身体里' +
      '（用户 2026-10-02 报的第二次就是这个）');
  }

  // ---------------------------------------------------------- 退世界要清
  const events = readCode('src/main/java/com/whitecobalt/anglertackle/client/ClientEvents.java');
  if (events !== null && /RodTipAnchor\.clear\(\)/.test(events)) {
    ok('退出世界时清了竿尖记录（否则新世界第一帧会用上一个位置）');
  } else {
    fail('ClientEvents 退出世界时没有调 RodTipAnchor.clear()');
  }

  // ========================================================== I 数值不变量
  //
  // 这条是这次事故的**回归测试**，也是唯一能直接证明"端点钉在竿尖上"的东西：
  //
  //   手里那根竿在**屏幕上**的位置与相机朝向无关（手部渲染就是钉在屏幕上的），
  //   所以把"竿尖"换算成世界坐标之后，无论相机怎么转、绕哪个轴转，
  //   投影回屏幕都必须落在**同一个像素**上。
  //
  // 模拟的就是实际那条链（R = 世界→相机的旋转矩阵）：
  //   h      = 竿尖在"相机无关的手部空间"里的坐标（钉在屏幕上的那个点）
  //   PS·v   = R⁻¹·h            ← 事件里 PoseStack 算出来的点（含相机旋转的逆）
  //   p      = R·(PS·v)         ← 修好的代码乘回 modelview；没修就少这一步
  //   W      = C + R⁻¹·p        ← worldTip() 的换算（−left·x + up·y − look·z）
  //   view   = R·(W − C)        ← 游戏实际投影用的坐标
  //
  // 修好时 view 恒等于 h（与 R 无关）；少乘 modelview 时 view = R⁻¹·h，随视角反向转 ——
  // 与用户描述的现象逐字对应。
  {
    const apply = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
    const mul = (a, b) => {
      const r = new Array(16);
      for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
        r[c * 4 + row] = s;
      }
      return r;
    };
    const rot = (axis, deg) => {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      if (axis === 'x') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
      if (axis === 'y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
      return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    };
    const transpose = (m) => [0, 1, 2, 3].map((c) => [0, 1, 2, 3].map((r) => m[r * 4 + c])).flat();
    const perspective = (fovDeg, aspect, near, far) => {
      const f = 1 / Math.tan(fovDeg * Math.PI / 360);
      const m = new Array(16).fill(0);
      m[0] = f / aspect; m[5] = f;
      m[10] = (far + near) / (near - far); m[11] = -1;
      m[14] = 2 * far * near / (near - far);
      return m;
    };
    const P = perspective(70, 1207 / 633, 0.05, 1000);
    const screen = (v) => {
      const c = apply(P, [v[0], v[1], v[2], 1]);
      return [(c[0] / c[3] + 1) / 2 * 1207, (1 - c[1] / c[3]) / 2 * 633];
    };

    // 相机无关的手部点：约 0.8 格、偏右下前方（就是竿尖相对相机的大致位置）
    const h = [0.36, -0.26, -0.70];
    const rotations = [[0, 0], [37, -22], [-125, 61], [180, 0], [0, 55], [90, -89]];

    const ref = screen(h);              // R = 单位阵时，view 本来就等于 h
    let worst = 0, worstAt = null;
    for (const [yaw, pitch] of rotations) {
      const R = mul(rot('x', pitch), rot('y', yaw));   // 世界 → 相机
      const Rt = transpose(R);
      const psPoint = apply(Rt, [h[0], h[1], h[2], 1]).slice(0, 3);   // PoseStack 里的点（含 R⁻¹）
      const p = appliesModelView ? apply(R, [psPoint[0], psPoint[1], psPoint[2], 1]).slice(0, 3) : psPoint;
      // worldTip()：−left·x + up·y − look·z，其中三个向量是相机的**世界**向量：
      //   R 把世界转到相机 → 世界的"右/上/前" = Rᵀ 的第 0 / 1 / 2 列（前要取负号）
      const right = [Rt[0], Rt[1], Rt[2]];
      const up = [Rt[4], Rt[5], Rt[6]];
      const look = [-Rt[8], -Rt[9], -Rt[10]];
      const left = right.map((v) => -v);
      const W = [0, 1, 2].map((i) => -left[i] * p[0] + up[i] * p[1] - look[i] * p[2]);
      const view = apply(R, [W[0], W[1], W[2], 1]).slice(0, 3);
      const s = screen(view);
      const d = Math.hypot(s[0] - ref[0], s[1] - ref[1]);
      if (d > worst) { worst = d; worstAt = 'yaw ' + yaw + '° / pitch ' + pitch + '°'; }
    }

    if (worst < 0.01) {
      ok('数值不变量：视角转到 ' + rotations.length + ' 个方向，端点在屏幕上都不动（最大偏移 ' +
        worst.toFixed(4) + ' px）');
    } else {
      fail('端点在屏幕上**会随视角移动**：' + worstAt + ' 偏了 ' + worst.toFixed(1) +
        ' px —— 说明相机空间那一步错了（手部 PoseStack 里是"相机旋转的逆"，' +
        '必须乘回 RenderSystem.getModelViewMatrix() 才是相机空间）');
    }
  }
}

// ================================================================= 三、竿尖像素 ↔ 图标
console.log('');
console.log('--- 竿尖像素常量 ↔ 图标 PNG ---');

/**
 * 从图标里量竿尖：**最上面那一行不透明像素里最左那个像素的外角**
 * （连续坐标，贴图左上角为原点）。
 */
function measureTip(file) {
  const buf = fs.readFileSync(file);
  const img = decodePng(buf);
  const op = (x, y) => img.rgba[(y * img.w + x) * 4 + 3] > 128;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (op(x, y)) return { x, y, w: img.w, h: img.h };
    }
  }
  return null;
}

const families = [
  { type: 'FLOAT', files: ['wood', 'iron', 'gold', 'diamond', 'netherite'].map((m) => `${m}_float_rod.png`) },
  { type: 'LURE', files: ['wood', 'iron', 'gold', 'diamond', 'netherite'].map((m) => `${m}_lure_rod.png`) },
];

for (const fam of families) {
  const measured = [];
  for (const f of fam.files) {
    const p = path.join(ROOT, TEX_DIR, f);
    if (!fs.existsSync(p)) { fail('找不到图标 ' + f); continue; }
    const t = measureTip(p);
    if (!t) { fail(f + ' 整张图都是透明的'); continue; }
    // ⚠ 2026-10-11：贴图边长从 64 改成 **128**（用户给了全新一套竿贴图，口径是
    //   "一切贴图以新为准，自己更改设置适应新贴图"）。这是**重新取值**，不是删断言：
    //   边长 / ICON_SIZE / 两个竿尖常量仍然必须互相对得上，只是基准换成 128。
    if (t.w !== 128 || t.h !== 128) fail(f + ' 不是 128×128（' + t.w + '×' + t.h + '），竿尖换算会错');
    measured.push({ f, x: t.x, y: t.y });
  }
  if (measured.length === 0) continue;

  // H2/H1（2026-10-11 改）：**每把竿用自己的竿尖**。
  //   用户口径："**贴图别改，要改只能改鱼线位置，让每一把杆的鱼线显示有自己的位置**"。
  //   旧断言"同族五种材质必须量出同一个尖"是**当年生成器那版图**的要求（生成器把尖端画在同一处），
  //   适用范围只有旧图 —— 用户已澄清"与现在的贴图没有任何关系"。
  //   新判据**比旧的更强**：逐把核对 RodTipAnchor.TIP_BY_ITEM 里它自己那一项，一张都不许挂歪。
  let perItemBad = 0;
  for (const m of measured) {
    const key = m.f.replace(/\.png$/, '');
    // ⚠ 正则要宽松：Java 里是 `new double[]{9.0, 7.0}` —— 中间有 `[]`。
    //   （第一版写成 `new double\{` 漏了方括号 ⇒ 十张全部报"表里没有"，假红 ✗）
    const re = new RegExp('entry\\("' + key + '"[^\\n]*?([0-9.]+)\\s*,\\s*([0-9.]+)');
    const e = re.exec(anchor || '');
    if (!e) {
      fail('RodTipAnchor 的 TIP_BY_ITEM 里没有 ' + key
        + ' —— 这把竿会退回按竿型的默认常量，鱼线可能挂歪');
      perItemBad++;
    } else if (Number(e[1]) !== m.x || Number(e[2]) !== m.y) {
      fail(key + ' 的竿尖对不上：TIP_BY_ITEM 写 (' + e[1] + ', ' + e[2]
        + ')，图标量出来 (' + m.x + ', ' + m.y + ') —— 改了图标没改表，这把竿的线头会离竿尖几个像素');
      perItemBad++;
    }
  }
  if (perItemBad === 0) {
    ok(fam.type + ' 每把竿的竿尖都与 TIP_BY_ITEM 逐项一致（' + measured.length + ' 把）');
  }
}

if (anchor !== null && !/ICON_SIZE\s*=\s*128\.0/.test(anchor)) {
  fail('RodTipAnchor 的 ICON_SIZE 不是 128.0（贴图边长是 128，UV 换算要跟着改）');
}


// ================================================================= 四、竿的"握着"姿势
//
// 用户 2026-10-16：「我拿鱼竿的手持并不像工具类有专门建模一样的感觉，而是如同拿其他物品如木棍
//   那样的贴图感」→ 追问后确认：「握持要像工具类那样，如钻石剑，这才像是握持，
//   现在的手持鱼竿感觉更像端详，根本不是握着的」。
//
// ⚠ 一个**反直觉的实测结论**（别凭记忆推翻它）：原版 item/handheld（剑/镐）与
//   item/generated（木棍/苹果）的 **firstperson 两项逐字相同**
//   （rotation [0,−90,25] / translation [1.13,3.2,1.13] / scale 0.68）。
//   数字来源：.gradle-home/.../minecraft_1.21.1_client.jar 里
//   assets/minecraft/models/item/{handheld,handheld_rod,generated}.json（实测读出来的）。
//   ⇒「握着 vs 端详」在第一人称里**换父级解决不了**，必须自己调 firstperson；
//     而第三人称那一套（generated 是 [0,0,0] 平举、handheld 是 [0,−90,55] 斜插）才是"握着"的观感来源。
//
// 断言（每条都对应"改回去就退回端详感"）：
//   J1. 15 个竿模型都继承我们那两个父级（平时 rod_grip / 抛竿后 rod_grip_cast）；
//   J2. 父级的第一人称**确实与 generated/handheld 不同**（拉近、压低、放大）——
//       与它们逐字相同就等于没改（这条正是"换了父级却什么都没变"的守门员）；
//   J3. 父级的第三人称 = 原版 handheld 那一套（别人眼里的握姿不能被我们改歪）；
//   J4. 模型 JSON 不许出现未知顶层键（Minecraft 会拒绝这种模型，症状是"物品变紫黑方块"）。
{
  const MODEL_DIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/models/item');
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

  // ---- J1 竿模型都指到我们的父级
  //
  // ⚠⚠ 这里**必须**分成两半（2026-10-16 负例对照组当场红了两次才想明白）：
  //   负例副本是**按需拷贝**的 —— 它只带 FILES/EXTRA 里列到的文件（本检查器只登记了
  //   rod_grip.json / diamond_float_rod.json 两个模型）。
  //   所以"必须凑够 15 个"这种清点只能在**真树**上做；在副本里做就会让**对照组**假失败
  //   （读不到文件 ⇒ 数量不足 ⇒ 判红），而"对照组红了"意味着整条负例阶段失去意义 ✗。
  //   ⇒ 真树：清点齐全；副本：只管在场的那几个，逐个验父级。
  const ALL_ROD_MODELS = fs.readdirSync(MODEL_DIR).filter((f) => /_(float|lure)_rod\.json$/.test(f));
  const present = fs.readdirSync(MODEL_DIR).filter((f) => /_(float|lure)_rod(_cast)?\.json$/.test(f));
  const isCopy = ALL_ROD_MODELS.length < 15;
  const wrong = [];
  for (const f of present) {
    const o = readJson(path.join(MODEL_DIR, f));
    const want = f.endsWith('_cast.json') ? 'anglertackle:item/rod_grip_cast' : 'anglertackle:item/rod_grip';
    if (!o || o.parent !== want) wrong.push(f + ' → ' + (o ? o.parent : '（读不出）'));
  }
  if (!isCopy && ALL_ROD_MODELS.length < 15) {
    fail('竿模型只有 ' + ALL_ROD_MODELS.length + ' 个（应有 15）—— 少的那几把会退回 item/generated 的端详姿势');
  } else if (wrong.length === 0) {
    ok('「握着」父级：' + present.length + ' 个竿模型全部指到 rod_grip / rod_grip_cast'
      + (isCopy ? '（副本按需拷贝，只验在场的）' : ''));
  } else {
    fail('有竿模型没指到「握着」父级（' + wrong.join('；')
      + '）—— 回退到 item/generated 就是用户说的"像木棍那样端着"');
  }

  // ---- J2 第一人称必须与 generated/handheld 不同（否则等于没改）
  const VANILLA_FP = { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] };
  const grip = readJson(path.join(MODEL_DIR, 'rod_grip.json'));
  if (!grip) {
    // 副本里没有这个文件就跳过（真树一定有；J1 已经在真树上清点过）
    console.log('  · rod_grip.json 不在本副本里，跳过 J2/J3');
  } else if (!grip.display || !grip.display.firstperson_righthand) {
    fail('rod_grip.json 没有 firstperson_righthand —— 「握着」这套姿势整个丢了');
  } else {
    const fp = grip.display.firstperson_righthand;
    const same = JSON.stringify(fp.rotation) === JSON.stringify(VANILLA_FP.rotation)
      && JSON.stringify(fp.translation) === JSON.stringify(VANILLA_FP.translation)
      && JSON.stringify(fp.scale) === JSON.stringify(VANILLA_FP.scale);
    if (same) {
      fail('rod_grip 的第一人称与原版 generated/handheld **逐字相同** —— 那等于什么都没改'
        + '（这两套的第一人称本来就是同一个数），玩家看到的还是"端着"');
    } else if (!(fp.scale[0] > 0.68 && fp.translation[2] < 1.13 && fp.translation[1] > 3.2)) {
      fail('「握着」的方向不对：应当**放大**（scale>0.68）、**前移**（z<1.13）、**压低**（y>3.2）；'
        + '实测 scale=' + fp.scale[0] + ' y=' + fp.translation[1] + ' z=' + fp.translation[2]);
    } else {
      ok('「握着」的第一人称确实不同于原版：scale ' + fp.scale[0] + '（>0.68）、y '
        + fp.translation[1] + '（>3.2）、z ' + fp.translation[2] + '（<1.13）');
    }
  }

  // ---- J3 第三人称 = 原版 handheld（别人眼里的握姿不许改歪）
  const TP_HANDHELD = { rotation: [0, -90, 55], translation: [0, 4.0, 0.5], scale: [0.85, 0.85, 0.85] };
  const tp = grip && grip.display ? grip.display.thirdperson_righthand : null;
  // ⚠ 2026-10-16 晚：判据从「数字等于原版 handheld」改成「大小/位置沿用原版 + 左右手互为镜像」。
  //   原因：**照抄剑的 Z 角符号会把竿倒过来**（剑 hilt 在左下、我们握把在右下，两端相反），
  //   所以第三人称的 Z 角我们**故意**取反（+55 → −55）。方向对不对交给上面那条「竿到底朝哪」去算。
  const tpMirrorOk = tp && grip.display.thirdperson_lefthand
    && tp.rotation[1] === -grip.display.thirdperson_lefthand.rotation[1]
    // ⚠⚠ 只镜像 Y 角，**不能**镜像 Z 角：对"对角线贴图"来说 Z 决定哪头朝上，
    //    镜像 Z 就等于把竿倒过来（2026-10-16 实测：左手 [0,90,55] 会变成握把朝天，
    //    而 [0,90,-55] 竿尖朝上 Δy=0.070 ✓）。原版 item/generated 的左右手本来也只差 Y 角符号。
    && tp.rotation[2] === grip.display.thirdperson_lefthand.rotation[2];
  if (tp && JSON.stringify(tp.translation) === JSON.stringify(TP_HANDHELD.translation)
    && JSON.stringify(tp.scale) === JSON.stringify(TP_HANDHELD.scale)
    && Math.abs(Math.abs(tp.rotation[2]) - Math.abs(TP_HANDHELD.rotation[2])) < 0.001
    && tpMirrorOk) {
    ok('第三人称沿用原版 handheld 的位置与大小（[0,4,0.5] / 0.85），Z 角逐手镜像'
      + '（符号按竿贴图两端反向而取反 —— 见「竿到底朝哪」）');
  } else {
    fail('第三人称不是「原版 handheld 的位置/大小 + 左右手镜像」（' + JSON.stringify(tp) + '）—— '
      + '要么退回了 generated 的 [0,0,0] 平举（端详观感），要么左右手不成镜像');
  }

  // ---- J5 display 是**整体替换**：我们自己写 display 就必须把 gui/ground/head/fixed 一起写上
  //   ⚠ 这条是 2026-10-16 当场抓到的坑：只写 firstperson/thirdperson ⇒ 父级 item/generated
  //     的 gui 变换被顶掉 ⇒ **背包图标、掉落物、戴头上、展示框里的样子一起坏**（而且不一定报错）。
  {
    const NEED = ["gui", "ground", "head", "fixed"];
    for (const f of ["rod_grip.json", "rod_grip_cast.json"]) {
      const o = readJson(path.join(MODEL_DIR, f));
      if (!o) continue;                       // 副本里没有就跳过（真树在 J1 清点过）
      if (!o.display) { fail(f + " 没有 display"); continue; }
      const miss = NEED.filter((k) => !o.display[k]);
      if (miss.length) {
        fail(f + " 的 display 缺了 " + miss.join(" / ") + " —— 模型自带的 display 会**整体替换**父级那一份，缺的那几个场合（背包图标 / 掉落物 / 戴头上 / 展示框）会一起坏掉");
      }
    }
    const g = readJson(path.join(MODEL_DIR, "rod_grip.json"));
    if (g && g.display && g.display.gui
      && JSON.stringify(g.display.gui.scale) === JSON.stringify([1, 1, 1])) {
      ok("display 四个基础场合（gui/ground/head/fixed）都在，背包图标不会变形");
    }
  }

// ---------------------------------------------------------------- 四·补 竿到底朝哪（2026-10-16 晚加）
//
// 用户第二轮反馈：「第三人称视角下鱼竿方向错误，真正应该拿来握的杆柄甚至是朝天的」。
//
// ⚠⚠ 这一条是**补上前面 J3 的漏洞**：J3 只比"数字是不是等于原版 handheld 那一套"，
//   而"原版那一套"是给**剑**调的 —— 剑的 hilt 在贴图左下、竿的握把在贴图右下，
//   两端正好相反。所以照抄数字的结果是**竿被倒过来**，而 J3 照样绿 ✗（它就是绿的）。
//
// 这一条改成**算方向**：把 display 变换 + 居中平移(-0.5,-0.5,-0.5) + 1/16 全链套一遍，
// 看"竿尖（贴图左上那片）"与"握把（贴图右下那片）"落到相机空间的哪个高度。
// 竿尖必须在**上面** —— 这条与"抄了哪个数字"无关，只问"看上去对不对"。
{
  const D = Math.PI / 180;
  const mul3 = (A, B) => {
    const C = new Array(9).fill(0);
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += A[k * 3 + r] * B[c * 3 + k];
        C[c * 3 + r] = s;
      }
    }
    return C;
  };
  const rotX = (a) => { const c = Math.cos(a * D), s = Math.sin(a * D); return [1, 0, 0, 0, c, s, 0, -s, c]; };
  const rotY = (a) => { const c = Math.cos(a * D), s = Math.sin(a * D); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rotZ = (a) => { const c = Math.cos(a * D), s = Math.sin(a * D); return [c, s, 0, -s, c, 0, 0, 0, 1]; };
  const ap3 = (M, v) => [
    M[0] * v[0] + M[3] * v[1] + M[6] * v[2],
    M[1] * v[0] + M[4] * v[1] + M[7] * v[2],
    M[2] * v[0] + M[5] * v[1] + M[8] * v[2],
  ];

  /** 把模型空间一点按（rotationYZX → scale → 居中 → 1/16 → 平移）投到相机空间。 */
  const project = (disp, v) => {
    const rot = disp.rotation || [0, 0, 0];
    const trans = disp.translation || [0, 0, 0];
    const sc = (disp.scale || [1, 1, 1])[0];
    const R = mul3(rotY(rot[1]), mul3(rotZ(rot[2]), rotX(rot[0])));
    const c = [(v[0] - 0.5) * sc, (v[1] - 0.5) * sc, (v[2] - 0.5) * sc];
    const r = ap3(R, c);
    return [r[0] / 16 + trans[0] / 16, r[1] / 16 + trans[1] / 16, r[2] / 16 + trans[2] / 16];
  };
  // 贴图两端（模型空间 0..1；v 轴向下，故 y = 1 − v）：
  //   竿尖 = 贴图左上那片；握把 = 贴图右下那片（逐像素量过：上端 6.0px 粗、下端 9.6px 粗）
  const TIP = [0.03, 0.97, 0.5];
  const GRIP = [0.97, 0.03, 0.5];

  const grip = readJson(path.join(MODEL_DIR, 'rod_grip.json'));
  if (!grip || !grip.display) {
    fail('rod_grip.json 读不到 display —— 竿的持握姿势整块丢了');
  } else {
    for (const ctx of ['thirdperson_righthand', 'thirdperson_lefthand',
                       'firstperson_righthand', 'firstperson_lefthand']) {
      const disp = grip.display[ctx];
      if (!disp) { fail(ctx + ' 没有 display —— 这个视角会退回父级（端着）'); continue; }
      const t = project(disp, TIP);
      const g = project(disp, GRIP);
      const dy = t[1] - g[1];
      if (dy > 0.01) {
        ok(ctx + '：竿尖高于握把（Δy = ' + dy.toFixed(3) + '）—— 不是倒着的');
      } else {
        fail(ctx + '：**握把比竿尖高**（Δy = ' + dy.toFixed(3) + '）—— 竿是倒的，'
          + '玩家看到的就是「该握的杆柄朝天」（用户 2026-10-16 报的正是这个）。'
          + '⚠ 别照抄剑（item/handheld）的 Z 角符号：剑的 hilt 在贴图左下、我们的握把在右下，两端相反。');
      }
    }
    // 抛竿后那个变体也得对（上鱼后一秒看到的就是它）
    const cast = readJson(path.join(MODEL_DIR, 'rod_grip_cast.json'));
    if (cast && cast.display && cast.display.thirdperson_righthand) {
      const t = project(cast.display.thirdperson_righthand, TIP);
      const g = project(cast.display.thirdperson_righthand, GRIP);
      if (t[1] - g[1] > 0.01) ok('rod_grip_cast 的第三人称同样竿尖朝上');
      else fail('rod_grip_cast 的第三人称是倒的 —— 抛竿后竿会翻过来（两个变体必须一致）');
    }
  }
}


  // ---- J4 模型顶层键合法（未知键会让模型加载失败，症状是紫黑方块）
  const ALLOWED_KEYS = new Set([
    'parent', 'textures', 'elements', 'display', 'overrides',
    'ambientocclusion', 'gui_light', 'render_type', 'credit',
  ]);
  const unknown = [];
  for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.json'))) {
    const o = readJson(path.join(MODEL_DIR, f));
    if (!o) continue;
    for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k)) unknown.push(f + ' 的 "' + k + '"');
  }
  if (unknown.length === 0) ok('物品模型没有未知顶层键（不会出现"紫黑方块"那种加载失败）');
  else fail('模型里有非法的顶层键：' + unknown.join('、') + ' —— Minecraft 会拒绝整个模型');
}



console.log('');
console.log(bad === 0
  ? '✅ 鱼线上端接在竿尖上（精确计算手持变换后的竿尖，常量与图标一致）'
  : '❌ 鱼线端点检查未通过（' + bad + ' 项）');
process.exitCode = bad === 0 ? 0 : 1;
