// 守住水体判定这一层。
//
// 用户定案："水体是判断当前是什么群系会出什么鱼，自己判断查习性。"
//
// 这一层最容易出的两类错都是**静默**的：
//   ① 某个水域 × 某种竿型**一个鱼种都没有** → 玩家在那里钓一天不出鱼，
//      而代码、日志、编译全都正常。玩家只会以为"这片水没鱼"。
//   ② 归属表与 FishSpecies.ALL 脱节（加鱼时漏登记 / 改名后表里还是旧 id）
//      → 那种鱼**永远不会出现**，同样没有任何报错。
const fs = require('fs'), path = require('path');
// ⚠ 必须认 ATL_ROOT：负向测试是在**副本**上跑检查器的。不认它的话，
//   负例读的还是真实仓库 —— 期望失败的用例照样绿，看起来像"检查器漏检"，
//   其实是它根本没看那份被改坏的文件（2026-10-02 加 water-cave-* 负例时踩到：
//   三条变异全部"通过"，一查才发现这个检查器从来没接过 ATL_ROOT）。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');
const { stripComments: strip } = require('./java-source.js');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

// ---------------------------------------------------------------- 1. 解析归属表
const watersSrc = fs.readFileSync(path.join(JAVA, 'fishing/FishWaters.java'), 'utf8');
// 位值直接给定，再回头**断言 Java 里的声明与之相符**。
// 不动态解析：一个拼出来的正则去猜 `1 << n` 的写法，失败了只会得到
// 一堆静默的 null（本次就踩了：六个常量全读不到，于是所有水域都算成"没鱼"）。
// 给定值 + 反向断言，坏了会明确报在哪一行。
const BIT = { RIVER: 1, LAKE: 2, SWAMP: 4, OCEAN: 8, DEEP: 16, CAVE: 32 };
{
  const expect = {
    RIVER: 'M_RIVER = 1', LAKE: 'M_LAKE = 1 << 1', SWAMP: 'M_SWAMP = 1 << 2',
    OCEAN: 'M_OCEAN = 1 << 3', DEEP: 'M_DEEP = 1 << 4', CAVE: 'M_CAVE = 1 << 5',
  };
  // ⚠ 位常量声明在 **WaterBody**（FishWaters 只是 `import static ...WaterBody.*` 拿去用）。
  //   第一版拿 FishWaters 当靶子 → 那里根本没有声明 → **每次构建都打一句
  //   "位常量的字面写法与检查器登记的不同（RIVER, LAKE, …）"** 的提示。
  //   提示本身不报红，但它会让人以为"位值可能对不上"，白白消耗注意力。
  //   现在改成读真正的声明处，并且**对不上就报红**（位值错了，下面那张表会整片失效）。
  const bitSrc = strip(fs.readFileSync(path.join(JAVA, 'fishing/WaterBody.java'), 'utf8'))
    .replace(/\s+/g, ' ');
  const wrong = Object.entries(expect).filter(([, s]) => !bitSrc.includes(s.replace(/\s+/g, ' ')));
  if (wrong.length) {
    no('WaterBody 里的位常量与检查器登记的不一致：' + wrong.map(([k]) => k).join(', ')
      + ' —— 位值一改，下面那张「水体 × 竿型」表会整片失效');
  } else ok('水体位常量在 WaterBody 里声明、值一致：' + JSON.stringify(BIT));
}

const table = new Map();
for (const m of watersSrc.matchAll(/put\("([^"]+)",([^;]+)\);/g)) {
  let mask = 0;
  for (const part of m[2].split('|')) {
    const k = part.trim().replace(/^M_/, '');
    if (BIT[k] != null) mask |= BIT[k];
  }
  table.set(m[1], mask);
}

// 深海继承海洋（与 WaterBody.matches 的规则一致）
const matches = (mask, water) => {
  if ((mask & BIT[water]) !== 0) return true;
  return water === 'DEEP' && (mask & BIT.OCEAN) !== 0;
};

// ---------------------------------------------------------------- 2. 表必须覆盖全部鱼种
const specSrc = strip(fs.readFileSync(path.join(JAVA, 'fishing/FishSpecies.java'), 'utf8'));
const allIds = [...specSrc.matchAll(/new FishSpecies\("([^"]+)"/g)].map((m) => m[1]).map((id) => id
  // 上面按源码顺序取到的就是 id 本身，这里不必再处理
);
if (allIds.length < 20) no('从 FishSpecies 只解析出 ' + allIds.length + ' 个鱼种 —— 解析规则可能脱节');
else {
  const missing = allIds.filter((id) => !table.has(id));
  const extra = [...table.keys()].filter((id) => !allIds.includes(id));
  if (missing.length) no('这些鱼种没登记水体（永远不会出现）：' + missing.join(', '));
  else ok('归属表覆盖全部 ' + allIds.length + ' 个鱼种');
  if (extra.length) no('表里有 FishSpecies 中不存在的 id：' + extra.join(', '));
  else ok('表里没有多余的 id');
}

// ---------------------------------------------------------------- 3. 每种 水体 × 竿型 都必须非空
// 竿型：FLOAT 能钓 FLOAT/BOTH，LURE 能钓 LURE/BOTH。从源码里取每条鱼的竿型。
//
// ⚠ 这条正则的窗口和前缀不能省：`new FishSpecies("id", ITEM, min, max, TIERS,`
//   这一串必须逐个匹配上，否则 `[\s\S]{0,n}` 会从**别的地方**滑过去、
//   匹配到相邻鱼种的 RodKind —— 那样竿型会整体错位一格，
//   而检查结果看起来只是"某些水域没鱼"，根因极难反推。
//   下面这条是本次会话里实测能正确解析出 21 条鱼的那一版。
const rodOf = new Map();
for (const m of specSrc.matchAll(
    /new FishSpecies\("([^"]+)",\s*[\w.]+,\s*[\d.]+,\s*[\d.]+,\s*\w+,[\s\S]{0,140}?RodKind\.(\w+)\)/g)) {
  rodOf.set(m[1], m[2]);
}
if (rodOf.size !== allIds.length) {
  no('竿型只解析出 ' + rodOf.size + ' 条，鱼种有 ' + allIds.length +
     ' 条 —— 解析规则与源码写法脱节了，下面的水域非空断言不可信');
}
const canCatch = (rodKind, speciesRod) =>
  speciesRod === 'BOTH' || speciesRod === rodKind;

const WATERS = ['RIVER', 'LAKE', 'SWAMP', 'OCEAN', 'DEEP', 'CAVE'];
const CN = { RIVER: '河流', LAKE: '湖泊', SWAMP: '沼泽', OCEAN: '海洋', DEEP: '深海', CAVE: '洞穴' };
console.log('\n   水体 × 竿型 可用鱼种数：');
for (const w of WATERS) {
  const row = [];
  for (const rod of ['FLOAT', 'LURE']) {
    const n = allIds.filter((id) => matches(table.get(id) ?? 0, w)
      && canCatch(rod, rodOf.get(id))).length;
    row.push(rod + '=' + n);
    if (n === 0) no(CN[w] + ' 用 ' + rod + ' 竿一个鱼种都没有 —— 那里会完全钓不到鱼');
  }
  console.log('     ' + CN[w].padEnd(6) + row.join('   '));
}

// ---------------------------------------------------------------- 4. 判定与接线
const wb = strip(fs.readFileSync(path.join(JAVA, 'fishing/WaterBody.java'), 'utf8'));
for (const [name, tag] of [['河流', 'is_river'], ['海洋', 'is_ocean'], ['深海', 'is_deep_ocean'],
                           ['沼泽', 'is_swamp'], ['沙滩', 'is_beach']]) {
  if (wb.includes('"' + tag + '"')) ok('判定了 ' + name + '（#' + tag + '）');
  else no('没有判定 ' + name + '（#' + tag + '）');
}
// ★ 反向断言：判定必须**只看群系**。
//
// 用户定案："你应该直接根据我的世界中的群系判定做这个，比你自己弄还少一道程序。"
// 先前我额外加了一层"没天光 + 水深≥4 → 洞穴"，那是**引入 bug 的那一层**：
// canSeeSky 用 MOTION_BLOCKING 高度图，而流体也算遮挡 —— 浮漂浮在水面上时
// 它所在那格就是水，canSeeSky(水面) 恒为 false，于是任何水深≥4 的开阔水域
// 都被判成洞穴。实测：海洋里用测试拟饵钓出一堆绿鲫鱼。
if (/canSeeSky/.test(wb)) {
  no('WaterBody 里又出现 canSeeSky —— 水面方块自己就"看不见天"，' +
     '这会让所有深水都判成洞穴（海洋出绿鲫鱼那个事故）');
} else ok('判定不依赖 canSeeSky（不会把开阔水域误判成洞穴）');
// ★★ 2026-10-02 用户改口径了（实测："我在溶洞拿台钓红饵紫窝半天全是草鱼青鱼"）：
//    洞穴是**地形**不是群系，所以加了"地下判定"——
//      "y55 以下只要水纵向上下延伸 20 格内存在洞穴里有的方块就算洞穴"。
//    下面几条守住这个新口径：阈值、扫描半径、标志方块、以及"顺序在群系之前"。
{
  const mY = /CAVE_MAX_Y\s*=\s*(\d+)/.exec(wb);
  if (mY && Number(mY[1]) === 55) ok('地下判定的高度阈值是 y<55（用户定案）');
  else no('地下判定的高度阈值不是 55（读到 ' + (mY ? mY[1] : '没有这个常量') + '）—— 用户定的是 y55 以下');

  const mS = /CAVE_SCAN\s*=\s*(\d+)/.exec(wb);
  if (mS && Number(mS[1]) === 20) ok('扫描半径是上下各 20 格（用户定案）');
  else no('扫描半径不是 20（读到 ' + (mS ? mS[1] : '没有这个常量') + '）');

  if (/public static boolean looksLikeCave\(/.test(wb)) ok('提供了 looksLikeCave（地下判定）');
  else no('没有 looksLikeCave —— 地下判定没实现');

  // 三类洞穴群系的标志方块都要在（少一类就等于那类洞穴判不出来）
  const groups = [
    ['繁茂洞穴', ['MOSS_BLOCK', 'AZALEA', 'CAVE_VINES', 'SPORE_BLOSSOM']],
    ['溶洞', ['DRIPSTONE_BLOCK', 'POINTED_DRIPSTONE']],
    ['深暗之域', ['SCULK', 'SCULK_SHRIEKER']],
  ];
  for (const [name, blocks] of groups) {
    const miss = blocks.filter((b) => !new RegExp('Blocks\\.' + b + '\\b').test(wb));
    if (miss.length) no(name + '的标志方块漏了：' + miss.join(', ') + ' —— 那类洞穴会判不出来');
    else ok(name + '的标志方块都在（' + blocks.join(' / ') + '）');
  }
  // ⚠ 反向：石头/深板岩/凝灰岩是**任何**地下都有的东西，拿它们当标志
  //   等于"y<55 的水一律是洞穴"，会把地下湖里的地表鱼全砍掉。
  const tooCommon = ['STONE', 'DEEPSLATE', 'TUFF', 'COBBLESTONE', 'DIRT', 'GRAVEL', 'ANDESITE',
    'GRANITE', 'DIORITE', 'WATER', 'LAVA', 'BEDROCK', 'CLAY', 'SAND'];
  const used = tooCommon.filter((b) => new RegExp('Blocks\\.' + b + '\\b').test(wb));
  if (used.length) {
    no('CAVE_BLOCKS 里混进了"任何地下都有"的方块：' + used.join(', ')
      + ' —— 那等于"y<55 的水一律算洞穴"，会把地下湖的地表鱼全砍掉');
  } else ok('标志方块全是洞穴专属装饰（没有石头/深板岩这类满地下都是的东西）');

  // 顺序：地下判定必须在群系判定**之前**，否则地下暗河永远走群系那一支
  const iCave = wb.indexOf('looksLikeCave(level, pos)');
  const iBiome = wb.indexOf('level.getBiome(pos)');
  if (iCave >= 0 && iBiome >= 0 && iCave < iBiome) ok('地下判定排在群系判定之前');
  else no('地下判定没有排在群系判定之前 —— 地下暗河会先被判成河流/湖泊，洞穴永远出不来');
}
if (/depth\s*>=\s*\d/.test(wb) || /CAVE_MIN_DEPTH/.test(wb)) {
  no('WaterBody 里又按"水深"分支了 —— 判据应当是"有没有洞穴标志方块"，不是水有多深');
} else ok('判定不看水深（不会被"深水=洞穴"那条老路带回去）');
// 洞穴必须按**群系 id** 判：1.21.1 没有 is_cave 标签（已从游戏 jar 里核实过）。
for (const b of ['lush_caves', 'dripstone_caves', 'deep_dark']) {
  if (wb.includes('"' + b + '"')) ok('洞穴群系已收录：' + b);
  else no('洞穴群系漏了：' + b);
}
if (/this == DEEP_OCEAN && \(speciesMask & M_OCEAN\) != 0/.test(wb)) {
  ok('深海继承海洋鱼种（否则深海用台钓竿会一条鱼都没有）');
} else no('深海没有继承海洋 —— 深海会变成只有金枪鱼/鲨鱼的单点池');
// ⚠ 这条断言 2026-10-08 更新过一次：过滤从"只看本体"扩成"本体 **或** 修饰"，
//   正则必须跟着改 —— 但**不许删**（当年真出过"归属表写了却没人读"这种事）。
if (/if \(water != null\) \{[\s\S]{0,320}?FishWaters\.modsOf\(s\.id\)/.test(specSrc)) {
  ok('buildPool 里接了水体过滤（本体 + 修饰，同一段代码里）');
} else no('buildPool 没有接水体过滤 —— 归属表写了也不生效');

// ---------------------------------------------------------------- 5. 档位覆盖：不许出现空池
//
// 2026-10-02 那次塌方（用户："我在溶洞拿台钓红饵紫窝半天全是草鱼青鱼"）：
// 水体过滤本身是对的，但"铁竿（上限蓝 2）+ 秘制窝（下限蓝 2）"在洞穴里
// 一条鱼都不满足 —— 洞穴的台钓鱼是横纹鱼[0,1]（太低）、
// 长吻象鼻鱼[3,4] 与蓝宝石雷龙鱼[5]（太高），中间没有蓝档。
// 池子空了 → FishSpecies.roll 的兜底"退回不限水体" → 洞里抽出河湖鱼。
//
// 所以真正的判据不是"每个水域有鱼"，而是：
//   **每种水体 × 竿型 × 竿的档位上限 × 咬钩下限，都必须至少有一种鱼能进池。**
// 用户 2026-10-02 定案取消台钓的档位上限（台钓恒为 5 档），
// 所以台钓只算上限 5，路亚按五根竿的材质上限 1~5 逐个算。
{
  // 鱼种档位表：源码里的常量名 → [最低档, 最高档]
  const TIER = {
    W_G: [0, 1], G_B: [1, 2], B_P: [2, 3], G_B_P: [1, 2, 3],
    G_R: [4, 5], R: [5], P_G: [3, 4], P_G_R: [3, 4, 5],
    // 2026-10-08 用户点名"裸盖鱼 = 蓝紫金"时新增的组合 —— 少了这一条，
    // 这个鱼种会被报成"档位表解析不出来"，而那张 96 组合的覆盖断言就不可信了 ✗
    B_P_G: [2, 3, 4],
  };
  const tierOf = new Map();
  for (const m of specSrc.matchAll(
      /new FishSpecies\("([^"]+)",\s*[\w.]+,\s*[\d.]+,\s*[\d.]+,\s*(\w+),/g)) {
    if (TIER[m[2]]) tierOf.set(m[1], TIER[m[2]]);
  }
  const unknownTier = allIds.filter((id) => !tierOf.has(id));
  if (unknownTier.length) {
    no('这些鱼种的档位表解析不出来：' + unknownTier.join(', ')
      + ' —— 下面的空池断言不可信（新加了档位常量就要登记到 TIER 里）');
  } else {
    const inPool = (id, rod, cap, floor, water) => {
      const sr = rodOf.get(id);
      if (sr !== 'BOTH' && sr !== rod) return false;
      const t = tierOf.get(id);
      // ⚠ 档位表是**数组**（W_G=[0,1]、G_B_P=[1,2,3]、R=[5]），
      //   最低档是 t[0]、最高档是**最后一个元素** —— 写成 t[1] 会：
      //     ① 把 [1,2,3] 的最高档当成 2（梭鲈被误判成"够不到下限3"）；
      //     ② 对单元素表 [5] 得到 undefined（比较结果全 false）。
      //   第一版就是这么写的，于是冒出一堆并不存在的"空池"（55/216 组）。
      const tmin = t[0];
      const tmax = t[t.length - 1];
      if (tmin > cap) return false;      // 鱼的最低档都超过竿上限 → 钓不到
      if (tmax < floor) return false;    // 鱼的最高档低于咬钩下限 → 它不咬这个饵/窝
      return matches(table.get(id) ?? 0, water);
    };
    // 参数范围必须**照着代码取**，不能凭想象铺满 0~5：
    //   · 台钓的咬钩下限恒为 0 —— FishingSession.baitMinTier() 第一句就是
    //     "台钓：不设下限"（用户定案"台钓饵料不提升下限"）；
    //   · 路亚的下限来自拟饵档位：紫拟饵→1、金/红拟饵→2，其余→0。
    // 铺满 0~5 会造出一堆**永远配不出来**的组合（比如"台钓 + 下限5"），
    // 第一版就是这么冒出来 55 组假空池的。
    const sessSrc = strip(fs.readFileSync(path.join(JAVA, 'fishing/FishingSession.java'), 'utf8'));
    if (!/if \(rodType\(\) == [^)]*RodType\.FLOAT\) \{\s*return 0;/.test(sessSrc)
        || !/case 4, 5 -> 2;/.test(sessSrc)) {
      no('解析不出 baitMinTier 的下限范围（台钓恒 0 / 金红拟饵 2）—— 下面的覆盖断言不可信');
    }
    const CAPS = [
      ['FLOAT', [5], [0]],                 // 台钓：无上限（用户取消）、饵不设下限
      ['LURE', [1, 2, 3, 4, 5], [0, 1, 2]], // 路亚：五根竿 × 拟饵下限
    ];
    const empty = [];      // 连"放宽下限"都救不回来 → 会退回不限水体，抽出别的物种
    const loosened = [];   // 初始空、放宽下限后有鱼 → 出该水域的低档鱼（可接受）
    let combos = 0;
    for (const w of WATERS) {
      for (const [rod, caps, floors] of CAPS) {
        for (const cap of caps) {
          for (const floor of floors) {
            combos++;
            // ★ 两层判据，和 FishSpecies.roll 的退回顺序一一对应：
            //   ① 初始池（竿上限 + 咬钩下限）空 → 放宽下限到 0（**水体照旧**）；
            //   ② 放宽后仍空 → 才退回"不限水体"，那时钓上来的就不是这片水里的鱼了。
            //   所以"会放宽下限"只是提示，"放宽后还空"才是真问题。
            const first = allIds.filter((id) => inPool(id, rod, cap, floor, w)).length;
            const second = allIds.filter((id) => inPool(id, rod, cap, 0, w)).length;
            const tag = CN[w] + '+' + rod + '(上限' + cap + ',下限' + floor + ')';
            if (second === 0) empty.push(tag);
            else if (first === 0) loosened.push(tag);
          }
        }
      }
    }
    // 一处都不许"放宽后还空"：那会触发"退回不限水体"，玩家钓到的是别的物种
    const shown = empty.slice(0, 8);
    if (empty.length) {
      no('这些组合**放宽下限后仍然没有鱼**（会退回不限水体，抽出根本不在这里的鱼）：'
        + shown.join('、') + (empty.length > shown.length ? ' …共 ' + empty.length + ' / ' + combos + ' 组' : ''));
    } else {
      ok('档位覆盖完整：' + combos + ' 种「水体 × 竿型 × 竿上限 × 咬钩下限」组合，'
        + '放宽下限后都有鱼（其中 ' + loosened.length + ' 组需要放宽，属正常）');
    }
  }
}

const sess = strip(fs.readFileSync(path.join(JAVA, 'fishing/FishingSession.java'), 'utf8'));
if (/WaterBody\.detect\(/.test(sess)) ok('会话里调用了 WaterBody.detect');
else no('会话没有判定水体');
// ⚠ 不要写成 `/this\.water\)/`：那样一加参数就误报（2026-10-01 加习性词条
//   habitMask 时就是这么红的）。判据是"this.water 作为实参出现在 roll 调用里"，
//   逗号或右括号都可以 —— 它是不是最后一个参数与"水体有没有传下去"无关。
if (/FishSpecies\.roll\([\s\S]{0,600}?this\.water[\s,)]/.test(sess)) {
  ok('roll 时把水体传下去了');
} else no('roll 时没传水体 —— 判定白做');
if (/private WaterBody water;/.test(sess)) ok('水体在落水时算好并钉死（不是每 tick 现算）');
else no('水体没有存成字段 —— 同一次抛投会算出不同水体');

// ---------------------------------------------------------------- 6. 水域修饰（用户 2026-10-08）
//
// 极地 / 高寒湖 / 冷水溪流是**叠加修饰**，不是新的水体值（理由见 docs/33 §9.1：
// 做成新枚举值会破坏"深海继承海洋"那条特判，还会让上面那 96 组覆盖判据整片失效）。
//
// 这一节守的全是**静默失败**：
//   · 群系标签里写错一个 id → 那个群系永远不算极地，游戏**不报错**（标签里的未知项只是 warning）；
//   · 阈值写死成字面量 → 调参器里改了没反应（这条吃过亏：damping_bonus 曾经"三个数全写死"）；
//   · 标签名和代码里的 `modTag("…")` 对不上 → 标签永远为空，判定恒 false；
//   · 修饰位混进 FishWaters → 那张表是按位解析的，普通鱼种的掩码会跟着串位。
{
  // ① 三个位必须在 WaterBody 里声明，且**不与本体六位重叠**（本体只用到 1<<5）
  const MOD_BITS = { M_POLAR: 6, M_ALPINE_LAKE: 7, M_COLD_STREAM: 8 };
  let bitBad = 0;
  for (const [k, shift] of Object.entries(MOD_BITS)) {
    const m = new RegExp(k + '\\s*=\\s*1\\s*<<\\s*(\\d+)').exec(wb);
    if (!m) { no('WaterBody 里没有声明修饰位 ' + k); bitBad++; continue; }
    if (Number(m[1]) !== shift) {
      no(k + ' 的位号是 ' + m[1] + '，检查器登记的是 ' + shift + ' —— 位号一改，下面的断言全部对不上');
      bitBad++;
    }
  }
  if (!bitBad) {
    ok('三个修饰位都声明了且不与本体重叠（极地 1<<6 / 高寒湖 1<<7 / 冷水溪流 1<<8）');
  }
  // 修饰位**不许**混进本体归属表：FishWaters 是 `put(id, M_X|M_Y)` 的位表，
  // 多一个位会让"水体 × 竿型"那张表整体串位，症状是"某些鱼突然出现在别的海域"。
  //
  // ⚠ 判据必须**只看 `put(...)` 那张本体表**。第一版拿整个文件当靶子，于是
  //   `putMods("rainbow_trout", M_COLD_STREAM)` 一落地就误报 —— 而修饰位正是
  //   **该**出现在 putMods 里的。这种"检查器比代码更严"的假红会挤掉真红的注意力。
  const bodyMasks = [...watersSrc.matchAll(/put\("([^"]+)",([^;]+)\);/g)].map((m) => m[2]);
  const leaked = Object.keys(MOD_BITS).filter((k) => bodyMasks.some((v) => new RegExp(k + '\\b').test(v)));
  if (leaked.length) {
    no('修饰位混进了 FishWaters 的**本体**表：' + leaked.join(', ')
      + ' —— 修饰是叠加的，不是第七种水体；混进去等于给这些鱼开了个新海域');
  } else ok('修饰位没有混进本体表（修饰只出现在 putMods 那张表里）');

  // ★ 修饰鱼种的三条覆盖断言（第 1 批的真验收：两种修饰水域都能钓到对应鱼）
  const modFish = [...watersSrc.matchAll(/putMods\("([^"]+)",\s*([^);]+)\);/g)]
    .map((m) => ({ id: m[1], mask: m[2].trim() }));
  if (!modFish.length) {
    no('FishWaters 里一条修饰鱼都没有 —— 第 1 批的冷水 5 条没接上（判得出修饰却没人用）');
  } else {
    const unknown = modFish.filter((f) => !allIds.includes(f.id)).map((f) => f.id);
    if (unknown.length) no('putMods 里的 id 在 FishSpecies 里不存在：' + unknown.join(', ')
      + ' —— 打错一个字符就是"这条鱼永远不出现"，而且没有任何报错');
    else ok('修饰鱼种 ' + modFish.length + ' 条，id 全部存在：' + modFish.map((f) => f.id).join(', '));

    // 每条修饰鱼都必须在本体表里**出现**（本体掩码给 0）：
    // 少了它，check-water-body 第 ② 节会报"没登记水体"，而那份表也是
    // "第 1 批覆盖完整"那条断言的数据来源。
    const notInBody = modFish.filter((f) => !table.has(f.id)).map((f) => f.id);
    if (notInBody.length) no('这些修饰鱼没有在本体表里登记（本体给 0 即可）：' + notInBody.join(', '));
    else ok('每条修饰鱼都在本体表里登记过（本体掩码 0 = 只认修饰）');

    // 本体掩码必须是 0：给了 M_RIVER 之类的话它们会在**所有**河里出现
    const wrongBody = modFish.filter((f) => (table.get(f.id) ?? 0) !== 0).map((f) => f.id);
    if (wrongBody.length) no('这些修饰鱼的**本体**掩码不是 0：' + wrongBody.join(', ')
      + ' —— 它们会出现在所有符合本体的水域里（比如所有河流），不再是"冷水溪流专属"');
    else ok('修饰鱼的本体掩码都是 0（只在命中的修饰水域出现，不会污染普通水域）');

    // 每个修饰 × 每种竿型都必须有鱼 —— 与第 ③ 节同一个道理：
    // 一个"完全钓不到东西"的水域，玩家只会以为这里没鱼。
    for (const [bitName, cn] of [['M_POLAR', '极地水'], ['M_ALPINE_LAKE', '高寒湖'],
                                 ['M_COLD_STREAM', '冷水溪流']]) {
      const list = modFish.filter((f) => f.mask.includes(bitName));
      if (!list.length) { console.log('   （提示：' + cn + ' 还没有专属鱼种）'); continue; }
      for (const rod of ['FLOAT', 'LURE']) {
        const n = list.filter((f) => canCatch(rod, rodOf.get(f.id))).length;
        if (n === 0) no(cn + ' 用 ' + rod + ' 竿一条专属鱼都没有 —— 那里只能钓到普通鱼'
          + '（第 1 批的目标是"两种水域 × 两种竿型都能钓到对应鱼"）');
        else ok(cn + ' · ' + rod + ' 竿可钓 ' + n + ' 条专属鱼（'
          + list.filter((f) => canCatch(rod, rodOf.get(f.id))).map((f) => f.id).join(', ') + '）');
      }
    }
  }

  // ⑪ 极地水：**判据和上面两条完全不同**。
  //
  // ⚠⚠ 2026-10-08 用户一句话把方向纠回来了："**极地群系要是极地鱼不多钓什么鱼**"。
  //    极地水本来就该以极地鱼为主 —— 那不是"稀释"，那就是那片水域的身份 ✓。
  //    拿"老鱼占比 ≥75%"去量极地，是拿普通水域的尺子量另一个环境 ✗
  //    （第一版就是这么写的：跑出来"冻洋老鱼只剩 35.7%"，然后我把它当成问题报上去了）。
  //
  // 所以这里只问两件真正要紧的事：
  //   ① 每个本体（冻河/冻洋/雪原湖…）在极地里都**有足够的鱼可钓**（老鱼 + 极地 ≥ 6 种）；
  //   ② **常见档保底**：至少有一条极地鱼的最高档 ≤ 蓝 —— 否则新手拿着木竿/铁竿
  //      在极地只能干瞪眼（高档竿不到手，那片水域等于空的 ✗）。
  {
    const polar = modFish.filter((f) => f.mask.includes('M_POLAR'));
    if (!polar.length) {
      console.log('   （提示：M_POLAR 还没有专属鱼种）');
    } else {
      const ids = polar.map((f) => f.id);
      // ⚠ 不能复用第 ⑤ 节的 `tierOf`（它声明在那一节的大括号里，这里引用会 ReferenceError）
      const tierConstOf = (id) => {
        const m = new RegExp('new FishSpecies\\("' + id + '",[\\s\\S]{0,140}?,\\s*([A-Z_]+),').exec(specSrc);
        return m ? m[1] : '(?)';
      };
      const COMMON = ['W_G', 'G_B', 'B_P'];   // 最高档 ≤ 蓝 = 常见档
      const hist = {};
      for (const id of ids) {
        const c = tierConstOf(id);
        hist[c] = (hist[c] || 0) + 1;
      }
      console.log('     极地专属 ' + ids.length + ' 条，档位常量分布：'
        + Object.entries(hist).map(([k, v]) => k + '×' + v).join('  '));

      // ① 每个本体都要有足够的鱼
      const thin = [];
      for (const body of WATERS) {
        const oldN = allIds.filter((id) => matches(table.get(id) ?? 0, body)).length;
        const total = oldN + ids.length;
        if (total < 6) thin.push(CN[body] + ' ' + total + ' 种');
      }
      if (thin.length) no('极地水里这些本体的鱼太少：' + thin.join('、') + '（少于 6 种，玩家会觉得"这里没鱼"）');
      else ok('极地水里每个本体都有 ≥6 种鱼可钓（老鱼 + 极地 ' + ids.length + ' 条）');

      // ② 常见档保底
      const common = ids.filter((id) => COMMON.includes(tierConstOf(id)));
      if (!common.length) {
        no('极地专属鱼里**一条常见档都没有**（最高档全 ≥ 紫）—— 新手拿木竿/铁竿在极地钓不到东西 ✗');
      } else {
        ok('极地专属鱼里有 ' + common.length + ' 条常见档保底（' + common.join(', ')
          + '）：低档竿也有东西上钩 ✓');
      }
    }
  }

  // 出鱼过滤里必须真的用上修饰位（否则表登记了也白搭）
  if (/FishWaters\.modsOf\(s\.id\)/.test(specSrc)) {
    ok('buildPool 按「本体匹配 或 修饰命中」过滤（与 docs/33 §9.1 的公式一致）');
  } else no('buildPool 没有用 FishWaters.modsOf —— 修饰鱼永远进不了池子');
  if (/public static int modsOf\(/.test(watersSrc)) ok('FishWaters 提供了 modsOf 查询');
  else no('FishWaters 没有 modsOf —— 修饰表登记了也没人读');

  // ⑩ 稀释上限（docs/33 §9.4 的验收：新鱼进来后，**老鱼在同一片水里的占比不低于 75%**）
  //
  // ⚠ 修饰是**叠加**的 ⇒ 稀释只发生在**命中修饰的水域**里：普通河流/湖泊一条新鱼都没多、
  //   老鱼占比一点没变。这正是"修饰"相对"另开一种水体值"的额外好处（后者会污染所有水域）。
  //   所以这条只算修饰水域：老鱼 = 本体能进这片水的鱼，新鱼 = 只认这个修饰的鱼。
  //   用**种类数**而不是权重：权重那条链要复现 FishingSession 的算法，那就成了"自己证明自己"
  //   （仓库里出过这种事故，见 negtest.ps1 的开头）。种类数是 §9.4 那张表用的同一口径 ✓
  for (const [bitName, cn, body] of [['M_ALPINE_LAKE', '高寒湖', 'LAKE'],
                                     ['M_COLD_STREAM', '冷水溪流', 'RIVER']]) {
    const oldFish = allIds.filter((id) => matches(table.get(id) ?? 0, body));
    const newFish = modFish.filter((f) => f.mask.includes(bitName)).map((f) => f.id);
    const total = oldFish.length + newFish.length;
    const pct = total ? (oldFish.length / total) * 100 : 100;
    if (pct < 75) {
      no(cn + ' 里老鱼只剩 ' + pct.toFixed(1) + '%（' + oldFish.length + '/' + total
        + '）—— 低于 docs/33 §9.4 定的 75% 下限，玩家会感觉"原来的鱼变少了"（专属鱼要减或改稀有）');
    } else {
      ok(cn + '：老鱼 ' + oldFish.length + ' / 总 ' + total + ' = ' + pct.toFixed(1)
        + '%（≥75% ✓；专属鱼 ' + newFish.length + ' 条：' + newFish.join(', ') + '）');
    }
  }

  // ② 判定函数本身
  if (/public static int modifiers\(ServerLevel level, BlockPos pos, WaterBody body\)/.test(wb)) {
    ok('WaterBody.modifiers(level, pos, body) 存在（返回修饰位掩码）');
  } else no('没有 WaterBody.modifiers(level, pos, body) —— 三个修饰没实现');

  // 代码里的标签名必须和磁盘上的文件名一一对应；用字符串拼出来的话标签恒空。
  for (const t of ['ice_fishing', 'alpine', 'cold_streams']) {
    if (new RegExp('modTag\\("' + t + '"\\)').test(wb)) ok('代码里登记了标签 ' + t);
    else no('代码里没有 modTag("' + t + '") —— 这个名字必须和 data/…/biome/' + t + '.json 完全一致');
  }
  // 26.1.2：ResourceLocation 改名为 Identifier（ResourceLocation.parse → Identifier.parse）
  if (/(?:ResourceLocation|Identifier)\.parse\("anglertackle:" \+ path\)/.test(wb)) {
    ok('标签走 anglertackle 命名空间（标签 id = 文件名）');
  } else no('标签的命名空间拼法变了 —— 拼错就是空标签，判定恒 false 且没有任何报错');

  // ③ 三个标签文件的内容：钉死群系名单
  // ⚠ 钉死是**有意**的：数据包给同名标签加群系时是**合并**（replace:false），
  //   不需要玩家改这里的文件；钉死是为了让"手滑删掉一行/写错一个 id"当场变红。
  const TAG_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/tags/worldgen/biome');
  const EXPECT_TAGS = {
    ice_fishing: ['deep_frozen_ocean', 'frozen_ocean', 'frozen_river', 'ice_spikes',
      'snowy_beach', 'snowy_plains', 'snowy_taiga'],
    alpine: ['cherry_grove', 'frozen_peaks', 'grove', 'jagged_peaks', 'meadow',
      'snowy_slopes', 'stony_peaks'],
    cold_streams: ['old_growth_pine_taiga', 'old_growth_spruce_taiga', 'snowy_taiga', 'taiga'],
  };
  for (const [name, want] of Object.entries(EXPECT_TAGS)) {
    const file = path.join(TAG_DIR, name + '.json');
    if (!fs.existsSync(file)) { no('缺群系标签文件：' + name + '.json'); continue; }
    let json;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { no(name + '.json 不是合法 JSON（' + e.message + '）—— 标签解析失败时游戏只 warning'); continue; }
    if (json.replace !== false) {
      no(name + '.json 的 replace 不是 false —— true 会把数据包加进来的群系**顶掉**，'
        + '玩家自己的群系就失效了');
    }
    const got = (json.values || []).map((v) => String(v).replace(/^minecraft:/, '')).sort();
    const miss = want.filter((b) => !got.includes(b));
    const extra = got.filter((b) => !want.includes(b));
    if (miss.length) no(name + ' 标签少了群系：' + miss.join(', ') + '（写错一个 id 就是"那片水永远不算' + name + '"）');
    if (extra.length) no(name + ' 标签多了群系：' + extra.join(', ') + '（要么是有意的，要么是 id 写错成了别的群系）');
    if (!miss.length && !extra.length) ok(name + ' 标签：' + got.length + ' 个群系，与检查器登记一致');
  }

  // ④ 用户明确要求的那条排除规则必须**写在代码里**
  //    （JSON 标签表达不了"不在某个标签里"，所以这条只能靠代码，最容易被后来的人删掉）
  if (/IS_ICE_FISHING\)\s*&&\s*!\s*alpine/.test(wb)) {
    ok('极地排除了高山群系（用户："仅适用于非高山且常年覆冰群系"）');
  } else no('极地没有排除高山群系 —— 雪山/冰峰也会算成极地水，用户明确要求"非高山"');

  // ⑤ 修饰的适用范围与阈值来源
  const modFn = /public static int modifiers\([\s\S]*?\n    \}/.exec(wb);
  if (!modFn) no('解析不出 modifiers() 的函数体 —— 下面的阈值断言不可信');
  else {
    const body = modFn[0];
    if (/body == LAKE &&/.test(body)) ok('高寒湖只在**湖泊**上生效（溪流/海不算）');
    else no('高寒湖没有限定"水体是湖泊" —— 高山上的河也会变成高寒湖');
    if (/body == RIVER &&/.test(body)) ok('冷水溪流只在**河流**上生效');
    else no('冷水溪流没有限定"水体是河流"');
    // 阈值必须来自 Tuning：写死字面量 = 调参器里改了没反应（这条有前科）
    for (const [k, cn] of [['alpineLakeMinY', '高寒湖最低高度'], ['coldWaterMaxTemp', '冷水溪流最高温度']]) {
      if (new RegExp('Tuning\\.' + k + '\\(\\)').test(body)) ok(cn + '取自 Tuning.' + k + '()（调参器可改）');
      else no(cn + '没有读 Tuning.' + k + '() —— 写死的话在调参器里改了没反应');
    }
    if (/getBaseTemperature\(\)/.test(body)) ok('冷水溪流用的是群系**基础温度**');
    else no('冷水溪流没有读群系基础温度 —— 只剩标签名单，数据包加群系就没用了');
    const hardY = /getY\(\)\s*>=\s*\d/.exec(body);
    const hardT = /getBaseTemperature\(\)\s*<=\s*[\d.]/.exec(body);
    if (hardY || hardT) {
      no('modifiers() 里出现了写死的阈值：' + [hardY && hardY[0], hardT && hardT[0]].filter(Boolean).join(' / ')
        + ' —— 这两个数必须是配置项');
    } else ok('modifiers() 里没有写死的阈值');
  }
}

// ---------------------------------------------------------------- 7. 调试命令（第 0 批的验收手段）
//
// 用户 2026-10-08 定的验收："调试命令能打印'这片水判成了什么'。"
//
// 这一节守的核心是**两处必须同源**：指令打印的取样点 与 buildPool 实际用的取样点。
// 不同源的症状是"指令说这是高寒湖、池子里却没有高寒湖的鱼"—— 两边各说一套，
// 而玩家只会认为"鱼没加进去"。
{
  const cmd = strip(fs.readFileSync(path.join(JAVA, 'command/AnglerCommands.java'), 'utf8'));
  // ⚠ 2026-10-11：子指令统一走 `lit("…")`（权限一处真源）⇒ 两种写法都要认，
  //   否则会报"没有 /atl water"这种假红（而它明明在）。
  if (/(?:lit|literal)\("water"\)/.test(cmd)) ok('/atl water 存在（打印水体 + 三个修饰 + 判定依据）');
  else no('没有 /atl water —— 第 0 批的验收手段（"打印这片水判成了什么"）缺失');

  if (/WaterBody\.detect\(level, pos\)/.test(cmd) && /WaterBody\.modifiers\(level, pos, body\)/.test(cmd)) {
    ok('/atl water 同时打了水体本体与修饰掩码');
  } else no('/atl water 没有同时调用 detect 与 modifiers —— 玩家看不到命中的是哪一条修饰');

  if (/describeModifiers\(/.test(cmd)) ok('/atl water 把修饰说成中文（不是打一个数字让玩家猜）');
  else no('/atl water 没有调 WaterBody.describeModifiers');

  if (/public static BlockPos waterProbe\(ServerPlayer player\)/.test(cmd)) {
    ok('取样点收敛到 waterProbe（指令与鱼池同源）');
  } else no('没有 waterProbe —— 指令和 buildPool 各算一套取样点，迟早对不上');

  if (/s\.bobber\(\)\.blockPosition\(\)/.test(cmd)) {
    ok('取样点优先用浮漂落点（与实际判定是同一个方块）');
  } else no('取样点没有优先用浮漂落点 —— 指令说的和实际判的可能不是同一片水');

  if (/buildPool\([\s\S]{0,240}?water, habitMask\)/.test(cmd)) {
    ok('/atl pool 按**真实水体**筛（以前传 null，池子比实际能钓到的大一圈）');
  } else no('/atl pool 没有把水体传进 buildPool —— 体检报告会列出这片水里根本没有的鱼');
}

console.log(bad === 0 ? '\n✅ 水体判定接线正确，每个水域每种竿型都有鱼，三个修饰判定无误'
  : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
