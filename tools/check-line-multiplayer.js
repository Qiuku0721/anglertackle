#!/usr/bin/env node
/**
 * check-line-multiplayer.js —— 守住「别人也能看到你的鱼线」这条修复（2026-10-10 多人实测 ✓）。
 *
 * 背景 ✓：单人时一切正常，但联机后**对方的鱼线完全不渲染** ✗。
 *   原因：本地那条线走 {@code RodTipAnchor}（订阅原版手持渲染、照抄 firstperson 显示变换 ✓），
 *   那是**本地手持渲染的产物** ✗ —— 别人客户端上没有这份数据 ✓。
 *   修法：在 `FishingLineRenderer` 里加一圈"画别人的线" ✓，
 *   起点用**实体手部位置**估算 ✓，配对用**同步过来的主人 UUID** ✓。
 *
 * 断言（每条都能证伪 ✓）：
 *   ① `renderOtherPlayersLines(event)` 必须在 `state.inSession()` 早退**之前**调用 ✗ ——
 *      那个判断问的是"**我**在不在钓"✓，跟别人钓不钓毫无关系 ✓；
 *      一旦挪到早退之后，多人下**又看不见线**了 ✗（这是最容易回归的一处 ✓）
 *   ② 配对必须走 `bobber.ownerId()`（同步字段 ✓），**不许**再用"就近的握竿玩家"✗ ——
 *      用户提出的反例：A 抛得远、B 站得更近 ⇒ 就近会把线画成「B 的手 → A 的浮漂」✗✗
 *   ③ `BobberEntity` 必须真的把 ownerId 暴露出来（读同步数据 `DATA_OWNER` ✓）
 *   ④ 本地第一人称那条线**必须还在**（走 `RodTipAnchor.worldTip` ✓）——
 *      防止有人"顺手把本地那条也改成估算"✗，那会把"线接在竿尖上"这个已修好的体验弄坏 ✗
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const LINE = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/client/render/FishingLineRenderer.java');
const BOBBER = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/entity/BobberEntity.java');

let fail = 0;
const ok = (m) => console.log('  [OK]   ' + m);
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
console.log('check-line-multiplayer：别人的鱼线要能渲染（联机修复的守卫）');

const line = fs.existsSync(LINE) ? fs.readFileSync(LINE, 'utf8') : null;
const bobber = fs.existsSync(BOBBER) ? fs.readFileSync(BOBBER, 'utf8') : null;
if (line === null) bad('找不到 ' + LINE);
if (bobber === null) bad('找不到 ' + BOBBER);

if (line !== null) {
  // ① 调用点必须在 inSession 早退之前
  const callIdx = line.indexOf('renderOtherPlayersLines(event)');
  const guardIdx = line.indexOf('ClientFishingState state = ClientFishingState.get();');
  if (callIdx < 0) bad('① 没有调用 renderOtherPlayersLines(event) ✗ ⇒ 多人下别人的线又不会渲染了');
  else if (guardIdx < 0) bad('① 找不到 inSession 早退的锚点（结构变了，本检查器需更新）');
  else if (callIdx < guardIdx) ok('① renderOtherPlayersLines 在 inSession 早退**之前**调用 ✓');
  else bad('① renderOtherPlayersLines 被挪到了 inSession 早退**之后** ✗ ⇒ 别人在钓时你这边不会画线 ✗');

  // ② 配对方式
  const byOwner = /bobber\.ownerId\(\)/.test(line);
  const byNearest = /distanceToSqr\(bobber\)/.test(line);
  byOwner ? ok('② 按同步的主人 UUID 配对（bobber.ownerId()）✓') : bad('② 没有按主人 UUID 配对 ✗');
  byNearest ? bad('② 又用回了"就近的握竿玩家"✗ ⇒ A 抛远、B 站近时会把线画到 B 手上 ✗✗') : ok('② 没有残留"就近配对"的写法 ✓');

  // ④ 本地那条线必须还在（精确竿尖）
  /RodTipAnchor\.worldTip\(/.test(line)
    ? ok('④ 本地第一人称那条线仍在走 RodTipAnchor.worldTip ✓（精确接在竿尖上 ✓）')
    : bad('④ 本地那条线的精确竿尖锚点被删了 ✗ ⇒ 线头会离竿尖大半个屏幕 ✗');
}

if (bobber !== null) {
  // ③ ownerId 必须存在、且读的是同步数据
  const hasMethod = /public UUID ownerId\(\)/.test(bobber);
  const readsSynced = /entityData\.get\(DATA_OWNER\)/.test(bobber);
  hasMethod ? ok('③ BobberEntity 暴露了 ownerId() ✓') : bad('③ BobberEntity 没有 public ownerId() ✗ ⇒ 客户端无法配对 ✗');
  readsSynced ? ok('③ ownerId() 读的是同步数据 DATA_OWNER ✓') : bad('③ ownerId() 没读同步数据 ✗（客户端拿不到主人 ✓）');
}

console.log(fail === 0 ? '\n全部通过：别人的鱼线能画、且配对精确（本地那条仍走真实竿尖 ✓）' : '\n失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
