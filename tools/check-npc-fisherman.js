/*
 * check-npc-fisherman.js —— 老柯（渔人 NPC）的四条硬约束。
 *
 * 每一条都是**踩过或读源码确认过的**，不是风格偏好：
 *
 *  ① `AbstractVillager` **没有**覆写 `mobInteract`（`javap` 确认）。
 *     只继承它 → 右键 NPC 完全没反应：不开界面、不报错、日志里一行都没有。
 *     这是最难查的一类问题：代码"看起来装好了"，实际点不动。
 *
 *  ② `AbstractVillager.getOffers()` 在客户端会
 *     `throw new IllegalStateException("Cannot load Villager offers on the client")`
 *     —— 它是**抛异常**，不是返回空表。任何没被 `!isClientSide` 包住的
 *     `getOffers()` 都会在单人游戏里直接崩客户端。
 *
 *  ③ `AbstractVillager` 有两个 abstract 方法，少实现一个就编译不过：
 *     `updateTrades()` 和 `rewardTradeXp(MerchantOffer)`。
 *     （`rewardTradeXp` 特别容易漏 —— 名字看着像可选的钩子，其实是必须实现的。）
 *
 *  ④ 实体四件套：实体类型注册 / 属性注册（EntityAttributeCreationEvent）/
 *     渲染器注册 / 语言键。少任何一项的表现都不一样，且都不指向"你漏了什么"。
 *
 * 用法：node tools/check-npc-fisherman.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许指向改坏的临时副本，用于负向测试（见 tools/negtest-*.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const J = 'src/main/java/com/whitecobalt/anglertackle/';
const entitySrc = read(J + 'entity/FishermanEntity.java');
const entReg = read(J + 'registry/ModEntities.java');
const mainSrc = read(J + 'AnglersTackle.java');
const clientSrc = read(J + 'client/ClientSetup.java');
const itemSrc = read(J + 'registry/ModItems.java');
const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const warn = (m) => console.log('  ⚠  ' + m);

/** 去掉注释与字符串字面量，避免"注释里写了 mobInteract"被当成实现。 */
function stripCommentsAndStrings(src) {
  return strip(src, true);
}

/** 只去注释、保留字符串字面量（NBT 键名之类的断言要用原始串）。 */
function stripComments(src) {
  return strip(src, false);
}

function strip(src, dropStrings) {
  let out = '', i = 0, state = 'code';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (dropStrings && c === '"') { state = 'str'; out += '""'; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += '\n'; } i++; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; continue; } if (c === '\n') out += '\n'; i++; continue; }
    if (state === 'str') { if (c === '\\') { i += 2; continue; } if (c === '"') state = 'code'; i++; continue; }
  }
  return out;
}

const code = stripCommentsAndStrings(entitySrc);   // 结构断言用：连字符串一起去掉
const codeNoComment = stripComments(entitySrc);    // 有字符串、无注释
const clientCode = stripComments(clientSrc);       // 渲染器注册断言用

console.log('=== 老柯（渔人 NPC）检查 ===\n');

// ---------------------------------------------------------------- ① mobInteract
if (/protected\s+InteractionResult\s+mobInteract\s*\(/.test(code)) {
  ok('覆写了 mobInteract（否则右键 NPC 什么都不会发生）');
} else {
  bad('没有覆写 mobInteract —— AbstractVillager 自己**没有**这个交互，'
    + '右键老柯会完全没反应（不开界面、不报错、日志无输出）');
}

// ---------------------------------------------------------------- ② getOffers 必须服务端调用
//
// ⚠ 判据必须用**括号配对**精确圈出守卫块的范围，不能用"往上 N 行里有没有
//   isClientSide"这种窗口启发式。第一版就是窗口（12 行），加商店代码把
//   if(!isClientSide) 推到窗口外之后，它就对着一段正确的代码报红 ——
//   而**假问题比漏检更费时间**，它会让人去改本来对的东西。
{
  // 用括号配对找出所有 `if (!level().isClientSide) { ... }` 的范围
  const guardRanges = [];
  // 26.1.2：isClientSide 是方法 —— level().isClientSide()
  const guardRe = /if\s*\(\s*!\s*(?:this\.)?level\(\)\.isClientSide\(\)\s*\)\s*\{/g;
  let gm;
  while ((gm = guardRe.exec(code)) !== null) {
    const start = gm.index + gm[0].length;
    let depth = 1;
    let k = start;
    while (k < code.length && depth > 0) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}') depth--;
      k++;
    }
    guardRanges.push([start, k]);
  }

  // updateTrades() 里那次调用是安全的：AbstractVillager 先赋值 offers 再回调，
  // 而且它只在服务端分支里被调用。用括号配对精确圈出这个方法体。
  const ownRanges = [];
  const ownRe = /protected\s+void\s+(updateTrades|rewardTradeXp)\s*\([^)]*\)\s*\{/g;
  let om;
  while ((om = ownRe.exec(code)) !== null) {
    const start = om.index + om[0].length;
    let depth = 1;
    let k = start;
    while (k < code.length && depth > 0) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}') depth--;
      k++;
    }
    ownRanges.push([start, k]);
  }

  const inAny = (ranges, pos) => ranges.some(([a, b]) => pos >= a && pos < b);

  const offenders = [];
  const callRe = /getOffers\s*\(/g;
  let cm;
  while ((cm = callRe.exec(code)) !== null) {
    const pos = cm.index;
    if (inAny(guardRanges, pos)) continue;   // 在 !isClientSide 块里，安全
    if (inAny(ownRanges, pos)) continue;     // 在自己的 updateTrades 里，安全
    const line = code.slice(0, pos).split('\n').length;
    offenders.push(line);
  }

  if (guardRanges.length === 0) {
    bad('一个 `if (!level().isClientSide)` 守卫都没找到 —— mobInteract 里的商品逻辑没有服务端守卫');
  } else if (offenders.length === 0) {
    ok('所有 getOffers() 都在服务端分支里（' + guardRanges.length + ' 个守卫块，'
      + '括号配对判定，不是行窗口）');
  } else {
    for (const line of offenders) {
      bad('FishermanEntity.java:' + line + ' 的 getOffers() 不在 !isClientSide 块里 —— '
        + 'AbstractVillager.getOffers() 在客户端是 '
        + 'throw new IllegalStateException("Cannot load Villager offers on the client")，不是返回空表');
    }
  }
}

// ---------------------------------------------------------------- ③ 两个 abstract 方法
for (const [name, sig, why] of [
  // 26.1.2：updateTrades 多了 ServerLevel 参数（基类在 getOffers 里传入）
  ['updateTrades', /protected\s+void\s+updateTrades\s*\(\s*ServerLevel\s+\w+\s*\)/,
    'AbstractVillager 的 abstract 方法（26.1.2 签名带 ServerLevel），不实现编译不过'],
  ['rewardTradeXp', /protected\s+void\s+rewardTradeXp\s*\(\s*MerchantOffer\s+\w+\s*\)/,
    'AbstractVillager 的 abstract 方法（名字像可选钩子，其实必须实现）'],
]) {
  if (sig.test(code)) ok('实现了 ' + name + '()');
  else bad('缺少 ' + name + '() —— ' + why);
}

// ---------------------------------------------------------------- ④ 实体四件套
{
  if (/FISHERMAN\s*=\s*[\s\S]*?ENTITIES\.register\("fisherman"/.test(entReg)) {
    ok('实体类型 anglertackle:fisherman 已注册');
  } else {
    bad('ModEntities.java 里找不到 fisherman 实体类型注册');
  }

  if (/EntityAttributeCreationEvent[\s\S]{0,400}?ModEntities\.FISHERMAN\.get\(\)/.test(mainSrc)) {
    ok('属性已在 EntityAttributeCreationEvent 注册');
  } else {
    bad('属性没注册 —— 症状是"能生成但 NaN 血/立刻倒地"，报错里不会提"属性"');
  }

  // ⚠ 必须在**去注释**的源码上匹配：第一版用了原始源码，
  //   于是把 `// event.registerEntityRenderer(ModEntities.FISHERMAN.get(),` 这种
  //   被注释掉的行也当成"注册过了"，负例 npc-no-renderer 因此假通过。
  if (/ModEntities\.FISHERMAN\.get\(\)[\s\S]{0,160}?FishermanRenderer::new/.test(clientCode)) {
    ok('渲染器已注册');
  } else {
    bad('ClientSetup.java 里没有注册 FishermanRenderer —— 实体会隐形（但碰撞箱还在）');
  }

  if (exists(J + 'client/render/FishermanRenderer.java')) ok('FishermanRenderer 文件存在');
  else bad('缺 client/render/FishermanRenderer.java');

  for (const [lang, name, tbl] of [['zh_cn', '中文', zh], ['en_us', '英文', en]]) {
    if ('entity.anglertackle.fisherman' in tbl) ok(lang + ' 实体名（' + name + '）已配：' + tbl['entity.anglertackle.fisherman']);
    else bad(lang + '.json 缺 entity.anglertackle.fisherman —— 名字会显示成键名');
  }
}

// ---------------------------------------------------------------- ⑤ 不可伤害 / 家 / 不消失
{
  const checks = [
    [/isInvulnerableTo\s*\(/, 'isInvulnerableTo（策划案：不可被玩家伤害）', code],
    [/BYPASSES_INVULNERABILITY/, '放行 BYPASSES_INVULNERABILITY（否则 /kill 删不掉他，测试很痛苦）', code],
    [/setPersistenceRequired\s*\(/, 'setPersistenceRequired（不加会在玩家走远后消失，且结构不会重新生成他）', code],
    [/isPushable\s*\(\s*\)\s*\{[\s\S]{0,80}?false/, 'isPushable 返回 false（不被推进河里）', code],
    // ⚠ 这一条必须查**原始源码**而不是去掉字符串的版本：NBT 的键名本身就是字符串
    //   字面量，stripCommentsAndStrings 会把它一起抹掉，导致永远误报"缺少"。
    //   （第一次跑就是这么误报的。）
    [/AtlHome/, '家的坐标进 NBT（AtlHome）', entitySrc],

    // 家的默认值：结构生成的老柯没有 AtlHome，必须自己认领落脚点。
    // 不能指望 finalizeSpawn —— StructurePlaceSettings.shouldFinalizeEntities() 默认 false。
    [/adoptSpawnAsHome\s*\(\)/, '第一 tick 自己认领落脚点为家（adoptSpawnAsHome）', code],
    [/if\s*\(\s*this\.onGround\(\)\s*\|\|/, '认领家的时机是"落地"（不是凭空第一 tick，否则会把悬空坐标记成家）', code],
  ];
  for (const [re, why, src] of checks) {
    if (re.test(src)) ok(why);
    else bad('缺少：' + why);
  }
}

// ---------------------------------------------------------------- ⑥ 正文键（空商品时的回应）
{
  const keys = [...entitySrc.matchAll(/translatable\("([\w.]+)"\)/g)].map((m) => m[1]);
  const missing = keys.filter((k) => !(k in zh) || !(k in en));
  if (missing.length === 0) {
    ok('代码里用到的语言键都存在' + (keys.length ? '（' + keys.join(', ') + '）' : ''));
  } else {
    bad('这些语言键在 lang 文件里不存在：' + missing.join(', '));
  }
}

// ---------------------------------------------------------------- ⑦ 台词池
//
// 用户的原话是"那 NPC 只有这一句话" —— 台词量是"活人还是告示牌"的分界线，
// 所以把它当硬约束守住，而不是当成文案细节。
{
  // ⚠ 必须用**保留字符串**的版本（codeNoComment）：stripCommentsAndStrings 会把
  //   字符串字面量一起抹掉，那样台词池数出来永远是 0。
  const m = /private\s+static\s+final\s+String\[\]\s+LINES\s*=\s*\{([\s\S]*?)\};/.exec(codeNoComment);
  if (!m) {
    bad('找不到台词池 LINES —— 老柯会退化成"只有一句话"的告示牌');
  } else {
    const lines = m[1].match(/"[^"]*"/g) || [];
    const MIN = 6;
    if (lines.length >= MIN) ok('台词池有 ' + lines.length + ' 句（下限 ' + MIN + '）');
    else bad('台词池只有 ' + lines.length + ' 句（至少要 ' + MIN + ' 句）—— '
      + '反复右键同一个人却永远同一句话，NPC 立刻就"死"了');

    // 每句都必须有中英语言键，否则聊天栏里显示成键名
    const missing = [];
    for (let i = 0; i < lines.length; i++) {
      const k = 'msg.anglertackle.fisherman.line.' + i;
      if (!(k in zh)) missing.push('zh_cn:' + k);
      if (!(k in en)) missing.push('en_us:' + k);
    }
    if (missing.length === 0) ok('台词的中英语言键齐全（0…' + (lines.length - 1) + '）');
    else bad('缺台词语言键（会显示成键名）：' + missing.join(', '));

    // 多余的键（Java 里删了台词但语言文件没删）—— 不算错误，但要看得见
    const extra = Object.keys(zh).filter((k) => {
      const mm = /^msg\.anglertackle\.fisherman\.line\.(\d+)$/.exec(k);
      return mm && Number(mm[1]) >= lines.length;
    });
    if (extra.length) console.log('  ⚠ 语言文件里有超出台词池的键：' + extra.join(', '));
    else ok('语言文件里没有超出池子的多余台词键');
  }

  // 轮流而不是随机：随机连着撞同一句的概率不低，玩家感受和"只有一句"一样
  if (/%\s*LINES\.length/.test(code)) ok('台词是**轮流**取的（每句都会被听到，不会连撞同一句）');
  else bad('取台词没用取模轮转 —— 随机抽取连着撞同一句的概率不低，'
    + '玩家的感受和"只有一句话"是一样的');
  if (/random\.nextInt\(LINES\.length\)/.test(code)) ok('起点随机（多个小屋的老柯不会一字不差同步开口）');
  else console.log('  ℹ  没有随机起点，多个老柯会从同一句开始');
}

// ---------------------------------------------------------------- ⑧ 刷怪蛋（可选，但若存在必须一致）
{
  const hasEgg = /FISHERMAN_SPAWN_EGG/.test(itemSrc);
  if (hasEgg) {
    warn('存在老柯刷怪蛋（调试用）。公开发布前需要决定：留着还是改用 /summon（记在 docs/13）');
  } else {
    ok('没有刷怪蛋，老柯只能随结构生成');
  }
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  为什么单独给 NPC 写一份检查：');
console.log('    "实体做好了"这件事没有单一的成功标志 —— 它由五六个互不相干的注册组成，');
console.log('    少任何一个的表现都不同（隐形 / NaN 血 / 点不动 / 名字是键名 / 走远就消失），');
console.log('    而且没有一条报错会告诉你"你漏了哪一步"。');
process.exitCode = fail === 0 ? 0 : 1;
