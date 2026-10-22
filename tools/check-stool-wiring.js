// 板凳接线检查器 —— 把 2026-10-09 一天之内踩过的坑**全部变成断言** ✓
//
// 那一天板凳出了这些事，每一条都是"少配一件 ⇒ 崩 / 看不见 / 紫黑方块"：
//   1. 方块注册了但没上报状态属性 ⇒ blockstate 的变体全匹配不上 ⇒ **缺失模型**（紫黑方块）
//   2. 没注册实体渲染器 ⇒ 一坐上去 EntityRenderDispatcher NPE ⇒ **客户端崩**
//   3. 漏掉落表 ⇒ 挖掉什么都不掉
//   4. 漏创造页签 ⇒ 玩家根本看不见
//   5. 面贴图写成**直接路径**而不是 #变量 ⇒ 模型加载失败 ⇒ 紫黑方块
//   6. 漏 useItemOn ⇒ 拿着地毯右击变成"坐下"
//   7. 漏 getShape ⇒ 碰撞箱还是整格 ⇒ 站在空气上浮空
//   8. 漏 onPassengerTurned ⇒ 坐着时腿只能朝一个方向摆
// 判据全部**读源码/资源**，不看运行结果 —— 因为这些都是"编译得过、进游戏才炸"的问题 ✓
const fs = require('fs');
const path = require('path');
// ATL_ROOT 供 tools/negtest.ps1 把检查器指向临时副本（新检查器一律要支持 ✓）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const J = 'src/main/java/com/whitecobalt/anglertackle/';
const R = 'src/main/resources/assets/anglertackle/';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 板凳接线检查 ===\n');

// ① 状态属性必须上报（漏 ⇒ 紫黑方块）
{
  const cush = read(J + 'block/CushionedStoolBlock.java');
  const stool = read(J + 'block/StoolBlock.java');
  if (/EnumProperty<DyeColor>\s+COLOR/.test(cush) && /builder\.add\([^)]*COLOR[^)]*\)/.test(cush)) {
    ok('CushionedStoolBlock 有 COLOR 属性**且**在 createBlockStateDefinition 里上报');
  } else {
    bad('CushionedStoolBlock 的 COLOR 没在 createBlockStateDefinition 里上报 ⇒ blockstate 变体全匹配不上 ⇒ 缺失模型（紫黑方块）');
  }
  if (/DirectionProperty\s+FACING/.test(stool) && /builder\.add\([^)]*FACING[^)]*\)/.test(stool)) {
    ok('StoolBlock 有 FACING 属性且已上报');
  } else {
    bad('StoolBlock 的 FACING 没上报 ⇒ 四向 blockstate 匹配不上');
  }
}

// ② 座位实体必须有渲染器（漏 ⇒ 一坐就崩）
{
  const client = read(J + 'client/ClientSetup.java');
  if (/STOOL_SEAT/.test(client) && /registerEntityRenderer\([^)]*STOOL_SEAT/.test(client)) {
    ok('ClientSetup 注册了 STOOL_SEAT 的渲染器（否则一坐就 NPE 崩客户端）');
  } else {
    bad('ClientSetup 没给 STOOL_SEAT 注册渲染器 ⇒ 玩家一坐上就崩');
  }
}

// ③ 两个方块必须有掉落表
{
  const missing = ['stool', 'cushioned_stool'].filter((n) => !has(`src/main/resources/data/anglertackle/loot_table/blocks/${n}.json`));
  if (missing.length === 0) ok('两个板凳方块都有掉落表');
  else bad('缺掉落表（挖掉不掉落）：' + missing.join(', '));
}

// ④ 两个物品必须在创造页签里 + 在 ModItems 里注册
{
  const items = read(J + 'registry/ModItems.java');
  const inTab = /output\.accept\(STOOL\.get\(\)\)/.test(items) && /output\.accept\(CUSHIONED_STOOL\.get\(\)\)/.test(items);
  const registered = /ITEMS\.register\("stool"/.test(items) && /ITEMS\.register\("cushioned_stool"/.test(items);
  if (inTab && registered) ok('两个板凳物品已在 ModItems 注册且进了创造页签');
  else bad('板凳物品' + (registered ? '' : '没在 ModItems 注册 ') + (inTab ? '' : '没进创造页签 ') + '⇒ 玩家找不到');
}

// ⑤ 交互/形状/朝向三个方法必须存在
{
  const stool = read(J + 'block/StoolBlock.java');
  const seat = read(J + 'entity/SeatEntity.java');
  const need = [
    ['useItemOn', /protected ItemInteractionResult useItemOn\(/, '没覆写 useItemOn ⇒ 拿地毯右击变成坐下'],
    ['getShape', /protected VoxelShape getShape\(/, '没覆写 getShape ⇒ 碰撞箱整格 ⇒ 站在空气上浮空'],
    ['onPassengerTurned', /public void onPassengerTurned\(/, '没实现 onPassengerTurned ⇒ 坐着时腿只能朝一个方向'],
  ];
  for (const [name, re, why] of need) {
    const src = name === 'onPassengerTurned' ? seat : stool;
    if (re.test(src)) ok('StoolBlock/SeatEntity 有 ' + name + '()');
    else bad(why);
  }
}

// ⑥ 回拉加成必须真的接到钓鱼逻辑（不是躺在方块里没人读）
{
  const sess = read(J + 'fishing/FishingSession.java');
  const seat = read(J + 'entity/SeatEntity.java');
  const stool = read(J + 'block/StoolBlock.java');
  if (/pullMult \*= seatReelMultiplier\(\);/.test(sess) && /seatReelMultiplier\(\)\s*\{/.test(sess)) {
    ok('FishingSession 把板凳加成乘进了 pullMult（收线速率）');
  } else {
    bad('板凳的 reelBonus() 没接进 FishingSession ⇒ 坐着钓鱼没有加成（方块里的数值是死代码）');
  }
  if (/private double reelBonus/.test(seat) && /seat\.reelBonus = .*reelBonus\(\)/.test(seat)) {
    ok('SeatEntity 在上座时从脚下方块读走 reelBonus');
  } else {
    bad('SeatEntity 没记住脚下方块的 reelBonus ⇒ 加成永远是 0');
  }
  if (/return 0\.01;/.test(stool)) ok('木板凳加成 = 1%');
  else bad('木板凳加成不是 1%（用户定案 +1%）');
}

// ⑦ 板凳模型的面贴图必须全是 #变量，且变量都有定义（漏 ⇒ 紫黑方块）
{
  const MB = R + 'models/block/';
  const DYE = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'light_gray', 'pink', 'gray', 'lime', 'blue', 'brown', 'green', 'red', 'black', 'purple', 'cyan'];
  const files = ['stool.json', ...DYE.map((c) => 'cushioned_stool_' + c + '.json')];
  let nonVar = 0, undef = 0, badJson = 0, absent = 0;
  for (const f of files) {
    if (!has(MB + f)) { absent++; continue; }
    const t = read(MB + f);
    try { JSON.parse(t); } catch { badJson++; }
    const vars = new Set([...t.matchAll(/"([a-z_]+)"\s*:\s*"anglertackle:block/g)].map((m) => '#' + m[1]));
    for (const m of t.matchAll(/"texture"\s*:\s*"([^"]+)"/g)) {
      if (!m[1].startsWith('#')) nonVar++;
      else if (!vars.has(m[1])) undef++;
    }
  }
  if (absent) bad('缺 ' + absent + ' 个板凳模型文件');
  if (nonVar) bad(nonVar + ' 处面贴图用了直接路径（必须 #变量）⇒ 模型加载失败 ⇒ 紫黑方块');
  if (undef) bad(undef + ' 处 #变量没有在 textures 块里定义 ⇒ 紫黑方块');
  if (badJson) bad(badJson + ' 个模型 JSON 非法');
  if (!absent && !nonVar && !undef && !badJson) ok('木板凳 + 16 色坐垫凳模型：面贴图全是 #变量且有定义，JSON 合法');
}

// ⑧ blockstate 变体数要对得上（16 色 × 4 向 = 64）
{
  const bs = JSON.parse(read(R + 'blockstates/cushioned_stool.json'));
  const n = Object.keys(bs.variants).length;
  if (n === 64) ok('cushioned_stool blockstate 有 64 个变体（16 色 × 4 向）');
  else bad('cushioned_stool blockstate 只有 ' + n + ' 个变体（应为 64）');
  const bs2 = JSON.parse(read(R + 'blockstates/stool.json'));
  const n2 = Object.keys(bs2.variants).length;
  if (n2 === 4) ok('stool blockstate 有 4 个朝向变体');
  else bad('stool blockstate 只有 ' + n2 + ' 个变体（应为 4）');
}

console.log('\n检查完毕：' + (fail ? '❌ ' + fail + ' 项未通过' : '✅ 全部通过'));
process.exit(fail ? 1 : 0);
