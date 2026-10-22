/*
 * check-shop-ui.js —— 商店的界面 + 接线 + **规则一致性**。
 *
 * 商店这块有一类特别隐蔽的错：**同一份规则被写在两个地方**。
 *   · 等级评定的交付要求：tools/shop-rules.js（文档）和 ShopManager.RATINGS（游戏逻辑）
 *   · 那一页显示的文案：ShopScreen.requirementText（界面）
 * 三处只要有一处对不上，表现就是"文档说要交梭鲈、游戏里却收别的"或者
 * "界面写着×2、实际只收1条" —— 这种错**没有任何报错**，只能靠人肉核对 5 档 × 3 个字段。
 * 所以这里把它们逐条比出来。
 *
 * 另一类是**安全**：客户端绝不能决定价格。判据是"客户端只发 entryId"，
 * 一旦有人在 ShopScreen 里算价格再发过去，就必须在这里变红。
 *
 * 用法：node tools/check-shop-ui.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOOLS = process.env.ATL_ROOT ? path.join(ROOT, 'tools') : __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 商店界面与接线检查 ===\n');

const SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/ShopScreen.java';
const MGR = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java';
const NET = 'src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java';
// S→C 的注册与处理在这个客户端专用类里（专用服务器不能加载客户端类型，
// 见它的类注释）。下面把两份源码接起来查 —— 断言一条都没放松。
const NET_CLIENT = 'src/main/java/com/whitecobalt/anglertackle/client/ClientPayloadHandlers.java';
const NPC = 'src/main/java/com/whitecobalt/anglertackle/entity/FishermanEntity.java';
const CATALOG = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopCatalog.java';

const { stripComments } = require(path.join(TOOLS, 'java-source.js'));
for (const f of [SCREEN, MGR, NET, NET_CLIENT, NPC, CATALOG]) {
  if (!exists(f)) { bad('缺文件 ' + f); }
}
if (fail) { console.log('\n缺文件，后面的检查没意义'); process.exit(1); }

const screen = stripComments(read(SCREEN));
const mgr = stripComments(read(MGR));
const net = stripComments(read(NET)) + '\n' + stripComments(read(NET_CLIENT));
const npc = stripComments(read(NPC));
const catalog = read(CATALOG);

// ---------------------------------------------------------------- ① 接线
if (/ShopActionPayload\.TYPE/.test(net) && /ShopSyncPayload\.TYPE/.test(net)) {
  ok('两个包都注册了（ShopAction C→S / ShopSync S→C）');
} else {
  bad('包没注册全 —— 界面点了没反应，而且不报错');
}
if (/ShopManager\.handle/.test(net)) ok('服务端 handler 接了 ShopManager');
else bad('ModNetwork 没把 ShopAction 交给 ShopManager');
if (/ShopManager\.(open|onFirstTalk)/.test(npc)) ok('老柯右键接了商店');
else bad('老柯右键没接商店 —— 说了第一句话之后右键还是只有台词');
if (/FishermanData\.shopOpen/.test(npc)) ok('开店条件看的是"说过第一句话"（幂等）');
else bad('老柯没判"说没说过话" —— 会每次都送两根竿');

// ---------------------------------------------------------------- ② 安全：客户端不能定价
{
  // 客户端只允许发 entryId / rate()，不允许出现价格相关的字段
  const sendLines = screen.split('\n').filter((l) => /PacketDistributor\.sendToServer/.test(l));
  if (sendLines.length === 0) bad('界面里找不到发送购买请求的代码');
  else {
    const suspicious = sendLines.filter((l) => /price|cost|amount|count/i.test(l));
    if (suspicious.length === 0) ok('客户端只发商品 id，不发价格/数量（' + sendLines.length + ' 处发送）');
    else bad('客户端发送里出现了价格/数量字段 —— 服务端一旦采信就等于可以一块钱买合金竿：'
      + suspicious.join(' | '));
  }
  if (/ShopCatalog/.test(mgr) && /e\.price\(\)/.test(mgr)) ok('服务端价格现查 ShopCatalog（不采信客户端）');
  else bad('服务端没有从 ShopCatalog 现查价格');
}

// ---------------------------------------------------------------- ③ 分页覆盖所有分类
{
  const cats = [...catalog.matchAll(/Category\.([A-Z]+)/g)].map((m) => m[1]);
  const used = new Set(cats);
  const tabs = /String\[\] TABS = \{([^}]*)\}/.exec(screen);
  if (!tabs) bad('ShopScreen 里找不到 TABS 分类标签数组');
  else {
    const n = tabs[1].split(',').length;
    // 7 个物品分类 + 「等级评定」+「卖鱼」+「修杆」+「兑换」+「联赛」五个非商品页
    // （修杆页是用户 2026-10-01 要求加的；兑换页是 2026-10-02；**联赛页是 2026-10-13（docs/39 P4）**）
    if (n === used.size + 5) {
      ok('分类标签 ' + n + ' 个 = ' + used.size + ' 个物品分类 + 等级评定 + 卖鱼 + 修杆 + 兑换 + 联赛');
    } else {
      bad('分类标签 ' + n + ' 个，但目录里有 ' + used.size + ' 个分类（应当 +5：评定 + 卖鱼 + 修杆 + 兑换 + 联赛）'
        + ' —— 少一个分类的表现是"整类商品看不到"');
    }
    // 五个非商品页的常量必须存在且指向正确下标（写错的话点"卖鱼"会打出评定页）
    const rIdx = /TAB_RATING = (\d+)/.exec(screen);
    const sIdx = /TAB_SELL = (\d+)/.exec(screen);
    const pIdx = /TAB_REPAIR = (\d+)/.exec(screen);
    const xIdx = /TAB_EXCHANGE = (\d+)/.exec(screen);
    const lIdx = /TAB_LEAGUE = (\d+)/.exec(screen);
    if (rIdx && sIdx && pIdx && xIdx && lIdx && Number(rIdx[1]) === used.size
        && Number(sIdx[1]) === used.size + 1 && Number(pIdx[1]) === used.size + 2
        && Number(xIdx[1]) === used.size + 3 && Number(lIdx[1]) === used.size + 4) {
      ok('TAB_RATING=' + rIdx[1] + ' / TAB_SELL=' + sIdx[1] + ' / TAB_REPAIR=' + pIdx[1]
        + ' / TAB_EXCHANGE=' + xIdx[1] + ' / TAB_LEAGUE=' + lIdx[1] + ' 紧跟 ' + used.size + ' 个分类之后');
    } else {
      bad('TAB_RATING/TAB_SELL/TAB_REPAIR/TAB_EXCHANGE/TAB_LEAGUE 的下标不对（应当是 ' + used.size + ' / '
        + (used.size + 1) + ' / ' + (used.size + 2) + ' / ' + (used.size + 3) + ' / ' + (used.size + 4) + '）'
        + ' —— 下标错位会让"卖鱼"页显示评定的内容');
    }
  }
  if (/Category\.values\(\)\[tab\]/.test(screen)) ok('标签和分类是按下标对齐的（不是手写映射，不会错位）');
  else bad('标签没有按 Category.values() 下标取 —— 手写映射容易和枚举顺序错位');
}

// ---------------------------------------------------------------- ③b 兑换页（鱼 → 原版物品）
//
// 用户 2026-10-02："加一个兑换，用特定品质鱼兑换原版物品……至少给我20种兑换表。"
// 表本身由 tools/gen-shop-prices.js 生成（那边会核对：鱼种存在、品质落在该鱼种区间内、
// ≥20 条、用户点名的三条在）。这里只管**界面与服务端的接线**：
//   界面画的是同一份表、灰不灰走 ShopMaterials.has()（与服务端扣鱼同一判据）、
//   点击发 @exch:、服务端认得这个前缀。
{
  const JS = require(path.join(TOOLS, 'shop-rules.js'));
  const n = (JS.EXCHANGES || []).length;
  if (n >= 20) ok('兑换表 ' + n + ' 条（用户要求 ≥20）');
  else bad('兑换表只有 ' + n + ' 条，用户要的是**至少 20 种**');

  const catalog = read('src/main/java/com/whitecobalt/anglertackle/shop/ShopCatalog.java');
  const records = (catalog.match(/new Exchange\(/g) || []).length;
  if (records === n) ok('ShopCatalog 里的 Exchange 条目数与规则表一致（' + n + ' 条）');
  else bad('ShopCatalog 里 ' + records + ' 条 Exchange，规则表 ' + n + ' 条 —— 生成物漂移，重跑 gen-shop-prices.js');

  if (/ShopCatalog\.EXCHANGES/.test(screen)) ok('兑换页画的是 ShopCatalog.EXCHANGES（同一份表）');
  else bad('兑换页没有读 ShopCatalog.EXCHANGES —— 界面和服务端会是两份数据');
  if (/ShopMaterials\.has\(/.test(screen)) {
    ok('那一行灰不灰走 ShopMaterials.has()（与服务端扣鱼同一判据，不会"显示能换却换不了"）');
  } else bad('兑换页没有用 ShopMaterials.has() 判材料 —— 界面与服务端会各判一套');
  if (/ShopActionPayload\.exchange\(/.test(screen)) ok('点击发 @exch: 动作');
  else bad('兑换页点击没有发 ShopActionPayload.exchange(…)');
  if (/OP_EXCHANGE_PREFIX/.test(read('src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java'))) {
    ok('服务端认得 @exch: 前缀并现查兑换表');
  } else bad('服务端没有处理 @exch: —— 界面点了没反应');
  if (/ShopMaterials\.resultStack\(/.test(read('src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java'))) {
    ok('发货走 ShopMaterials.resultStack()（含附魔书那种带组件的产出）');
  } else bad('服务端没有用 ShopMaterials.resultStack() 构造产出 —— 附魔书会变成白书');

  // ⚠ 品质颜色必须走模组自己的 Quality 配色。用户 2026-10-02："字体颜色金用的蓝色
  //   很不符常理" + "不止金品的颜色有问题" —— 手写颜色码表（"§" + "789abc".charAt(t)）
  //   把白=灰、绿=深灰、紫=绿、金=青，六档里错了四档，而且看图鉴/tooltip 都对不上。
  // ⚠ 必须**剥掉注释**再判：这条断言的说明文字里就写着那个坏写法
  //   （"§" + "789abc".charAt(t)），在裸文本上匹配会自己把自己判红。
  const materials = stripComments(read('src/main/java/com/whitecobalt/anglertackle/shop/ShopMaterials.java'));
  if (/Quality\.of\([^)]*\)\.color\(\)/.test(materials)) {
    ok('品质颜色走 Quality.of(t).color()（和图鉴 / 鱼获 tooltip 同一份配色）');
  } else bad('兑换行的品质颜色没有用 Quality 配色 —— 手写颜色码会和白绿蓝紫金红的实际颜色对不上');
  if (/"§"\s*\+\s*"/.test(materials)) {
    bad('ShopMaterials 里又出现了手写的颜色码表（"§" + "…".charAt(…)）—— 六档颜色会再次错位');
  } else ok('没有手写颜色码表');
}

// ---------------------------------------------------------------- ④ 等级评定：文档与游戏必须一致
//
// 2026-10-02：等级改成 1–50 + 每 10 级一次突破，评定表搬到了
// player/AnglerLeveling.java 的 GATES（键 = 等级 10/20/30/40，一级可要好几条鱼）。
// 这里拿 shop-rules.js 的镜像逐条比对 —— 两边不一致的表现是
// "文档说交绿梭鲈、游戏里却要别的"，没人查得出来。
{
  const JS = require(path.join(TOOLS, 'shop-rules.js'));
  const req = JS.RATING_RULES.requirements;

  // 品质序号的唯一真源是 Quality.java 的枚举顺序，这里读它，不另抄一份。
  const qualitySrc = stripComments(read(
    'src/main/java/com/whitecobalt/anglertackle/item/Quality.java'));
  const qualityNames = [...((/enum\s+Quality\s*\{([\s\S]*?)\n\}/.exec(qualitySrc) || ['', ''])[1])
    .matchAll(/^\s{4}([A-Z_]+)\s*\(/gm)].map((m) => m[1]);
  const leveling = stripComments(read(
    'src/main/java/com/whitecobalt/anglertackle/player/AnglerLeveling.java'));
  const lConst = new Map();   // GREEN → Quality 名
  for (const m of leveling.matchAll(/static\s+final\s+int\s+([A-Z]+)\s*=\s*[^;]*?Quality\.([A-Z_]+)\.ordinal\(\)/g)) {
    lConst.set(m[1], m[2]);
  }
  const gateBlock = /GATES = Map\.of\(([\s\S]*?)\)\);/.exec(leveling);
  if (!gateBlock) {
    bad('AnglerLeveling 里找不到 GATES 表');
  } else {
    const parts = gateBlock[1].split(/(\d+)\s*,\s*List\.of\(/).slice(1);
    const gates = new Map();
    for (let i = 0; i < parts.length; i += 2) {
      const level = Number(parts[i]);
      const rows = [...(parts[i + 1] || '').matchAll(
        /new Requirement\(\s*"([a-z_]+)"\s*,\s*([A-Za-z_0-9]+)\s*,\s*(\d+)\s*\)/g)]
        .map((m) => ({ fish: m[1], constName: m[2], quality: lConst.get(m[2]), count: Number(m[3]) }));
      gates.set(level, rows);
    }
    // 文档用原版稀有度名，游戏用 Quality 常量，这里做映射校验。
    // ⚠ 这张表以前写的是 { UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5 } ——
    //   也就是**检查器自己编码了那套 1 起算的错口径**，于是它和同样错的数字"对上了"，
    //   一路放行。现在序号从 Quality.java 的枚举顺序取，不再手抄。
    const NAME = {
      UNCOMMON: 'GREEN', RARE: 'BLUE', EPIC: 'PURPLE', LEGENDARY: 'GOLD',
    };
    const docLevels = Object.keys(req).map(Number).sort((a, b) => a - b);
    const gotLevels = [...gates.keys()].sort((a, b) => a - b);
    if (JSON.stringify(docLevels) !== JSON.stringify(gotLevels)) {
      bad('评定点对不上：文档 ' + docLevels.join('/') + ' / 游戏 ' + gotLevels.join('/'));
    }
    for (const level of gotLevels) {
      const jRows = req[level] || [];
      const aRows = gates.get(level) || [];
      if (jRows.length !== aRows.length) {
        bad('Lv.' + level + ' 评定材料条数对不上：文档 ' + jRows.length + ' / 游戏 ' + aRows.length);
        continue;
      }
      let good = true;
      for (let k = 0; k < aRows.length; k++) {
        const j = jRows[k];
        const a = aRows[k];
        const wantQ = NAME[j.minGrade];
        const wantTier = qualityNames.indexOf(wantQ);
        if (j.fish !== a.fish) {
          bad('Lv.' + level + ' 第 ' + (k + 1) + ' 条鱼对不上：文档 ' + j.fish + ' / 游戏 ' + a.fish);
          good = false;
        } else if (a.constName !== wantQ) {
          bad('Lv.' + level + ' 第 ' + (k + 1) + ' 条品质对不上：文档 ' + j.minGrade + '(' + wantQ
            + ') / 游戏 ' + a.constName);
          good = false;
        } else if (a.count !== (j.count || 1)) {
          bad('Lv.' + level + ' 第 ' + (k + 1) + ' 条数量对不上：文档 ' + (j.count || 1) + ' / 游戏 ' + a.count);
          good = false;
        }
        // 常量必须真的指向那一档（Quality 枚举序号）
        if (qualityNames.indexOf(a.quality) !== wantTier) {
          bad('Lv.' + level + ' 第 ' + (k + 1) + ' 条：' + a.constName + ' 实际是 '
            + qualityNames.indexOf(a.quality) + ' 档，文档要的是 ' + wantTier + ' 档');
          good = false;
        }
      }
      if (good) {
        ok('Lv.' + level + ' 评定一致（' + aRows.map((r) => r.quality + ' ' + r.fish + '×' + r.count).join(' + ') + '）');
      }
    }
  }
}

// ---------------------------------------------------------------- ④b 卖鱼确认：材料清单必须和规则一致
//
// 用户在卖鱼页点"材料鱼"时会弹确认框（ShopMaterials.warningFor）。
// 判定用的三个集合是**手写**在 ShopMaterials 里的，而真正的规则在
// ShopManager.RATINGS（评定）和 ShopCatalog（兑换）里 —— 又是一份规则写两处。
//
// 漏同步的表现特别坏：**那条鱼被默默地卖掉了，没有任何提示**。
// 而"一个没有弹出来的提示框"是没人会去检查的东西。
{
  const MAT = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopMaterials.java';
  if (!exists(MAT)) {
    bad('缺 ShopMaterials.java —— 卖材料鱼不会弹确认框');
  } else {
    const mat = stripComments(read(MAT));
    const levelingForMaterials = stripComments(read(
      'src/main/java/com/whitecobalt/anglertackle/player/AnglerLeveling.java'));

    // ① 评定材料：ShopMaterials.RATING_FISH 必须覆盖 AnglerLeveling.GATES 里所有 fishId
    const gateBlock2 = /GATES = Map\.of\(([\s\S]*?)\)\);/.exec(levelingForMaterials);
    const ratingFish = new Set();
    if (gateBlock2) {
      for (const m of gateBlock2[1].matchAll(/new Requirement\(\s*"([a-z_]+)"/g)) ratingFish.add(m[1]);
    }
    const matRating = new Set(
      [...(/RATING_FISH = Set\.of\(([^)]*)\)/.exec(mat) || [, ''])[1].matchAll(/"([a-z_]+)"/g)]
        .map((m) => m[1]));
    const missRating = [...ratingFish].filter((f) => !matRating.has(f));
    if (ratingFish.size === 0) {
      bad('解析不出 AnglerLeveling.GATES 里的鱼 id —— 这条断言失效了，需要跟着改');
    } else if (missRating.length === 0) {
      ok('评定材料清单和 GATES 一致（' + [...ratingFish].join(', ') + '）');
    } else {
      bad('这些鱼是等级评定要交的，但 ShopMaterials.RATING_FISH 里没有：' + missRating.join(', ')
        + ' —— 玩家会把评定材料默默卖掉，而且**不会弹任何提示**');
    }

    // ② 兑换材料：ShopMaterials.EXCHANGE_FISH 必须覆盖 ShopCatalog 里所有兑换物
    const exFish = new Set();
    for (const m of catalog.matchAll(/Kind\.EXCHANGE[^)]*"(\w+@[A-Z]+x\d+(?:@each)?)"/g)) {
      for (const f of m[1].split('@')[0].split('+')) if (f !== 'anyRed') exFish.add(f);
    }
    // ShopCatalog 的 exchange 字段形如 "atlantic_salmon+brown_trout+tigerfish@REDx1@each"
    for (const m of catalog.matchAll(/"([a-z_]+(?:\+[a-z_]+)+)@[A-Z]/g)) {
      for (const f of m[1].split('+')) exFish.add(f);
    }
    const matEx = new Set(
      [...(/EXCHANGE_FISH = Set\.of\(([\s\S]*?)\)/.exec(mat) || [, ''])[1].matchAll(/"([a-z_]+)"/g)]
        .map((m) => m[1]));
    const missEx = [...exFish].filter((f) => !matEx.has(f));
    if (exFish.size === 0) {
      bad('解析不出 ShopCatalog 里的兑换鱼 —— 这条断言失效了，需要跟着改');
    } else if (missEx.length === 0) {
      ok('兑换材料清单和 ShopCatalog 一致（' + [...exFish].join(', ') + '）');
    } else {
      bad('这些鱼是兑换要用的，但 ShopMaterials.EXCHANGE_FISH 里没有：' + missEx.join(', ')
        + ' —— 会被默默卖掉');
    }

    // ③ 红品质鱼也算材料（红线要"任意两条红品质鱼"），阈值不能写错
    // ⚠ 这里原本断言的是 `RED_TIER = 6` —— 也就是**检查器自己编码了那套 1 起算的错口径**
    //   （"档位 1–6"），而品质只有 0~5。于是 ShopMaterials 里那句
    //   `tier >= 6` 永远不会成立，红品质鱼的提示从来没弹过，检查器却一路绿灯。
    //   现在要求它由 Quality.RED.ordinal() 推导，**不许写字面量**。
    if (/RED_TIER = [^;]*Quality\.RED\.ordinal\(\)/.test(mat)) {
      ok('红品质阈值由 Quality.RED.ordinal() 推导（红线兑换不限种类，任何红鱼都算材料）');
    } else {
      bad('ShopMaterials 里的红品质阈值不是从 Quality.RED.ordinal() 推导的 —— ' +
        '写死 6 会让"红鱼可以兑红鱼线"这条提示永远不弹（品质只有 0~5）');
    }
  }

  // ④ 确认框：渲染和点击必须共用同一组布局常量，各写一遍坐标必然错位
  const cfmConst = /CFM_W = (\d+)/.test(screen) && /CFM_H = (\d+)/.test(screen)
    && /CFM_BTN_Y = (\d+)/.test(screen) && /CFM_BTN_H = (\d+)/.test(screen);
  if (cfmConst) ok('确认框布局用的是常量（不是散落的字面量）');
  else bad('确认框布局没有抽成常量 —— 渲染和命中区各写一遍坐标，改一处就会点不中');
  if (/confirmButtonAt\(/.test(screen)) ok('点击用 confirmButtonAt(mouseX, mouseY) 复用渲染的坐标');
  else bad('没有 confirmButtonAt —— 点击判定和渲染坐标是两套，必然错位');
  // ⚠ 2026-10-02：确认框改成自适应后，三个按钮的位置/宽度必须走**同一对**辅助方法。
  //   早先是渲染里写 [8,108,186]/[92,70,96]、命中区里再抄一遍 —— 那种"两套坐标"
  //   正是上面那条断言想防的东西，但它只查了"常量在不在"，抄一遍也能过。
  const btnShared = /cfmBtnX\(/.test(screen) && /cfmBtnW\(/.test(screen)
    && /confirmButtonAt[\s\S]{0,600}?cfmBtnX\(/.test(screen)
    && /renderConfirm[\s\S]{0,1600}?cfmBtnX\(/.test(screen);
  if (btnShared) ok('渲染与命中区共用 cfmBtnX()/cfmBtnW()（按钮随框宽缩放）');
  else bad('确认框按钮的坐标/宽度没有共用辅助方法 —— 渲染和点击会各算一套，改一处就点不中');

  // ⑤ 「本局不再提示」必须是内存态：不能进存档，也不能在退出世界时被重置
  const state = stripComments(read('src/main/java/com/whitecobalt/anglertackle/client/ClientShopState.java'));
  if (/suppressSellWarningForever/.test(state)) ok('有「本局不再提示」开关');
  else bad('没有「本局不再提示」开关 —— 用户明确要求要有临时关闭的办法');
  const resetBody = /public static void reset\(\)\s*\{([\s\S]*?)\n    \}/.exec(state);
  if (resetBody && /suppressSellWarning\s*=/.test(resetBody[1])) {
    bad('reset() 把「本局不再提示」也重置了 —— 退出世界时会被清掉，'
      + '而用户要的是"本局游戏"（换世界仍算同一局）');
  } else {
    ok('reset() 不会重置「本局不再提示」（换世界仍算同一局）');
  }
  // 进了存档就是持久化了 —— 用户要的是"本局"
  if (/suppressSellWarning/.test(read('src/main/java/com/whitecobalt/anglertackle/player/FishermanProgress.java'))) {
    bad('「本局不再提示」被写进了玩家附件（会进存档）—— 用户要的是"本局游戏不再出现"');
  } else {
    ok('「本局不再提示」只活在内存里，不进存档');
  }
}

// ---------------------------------------------------------------- ⑤ 拒绝文案
{
  if (/品质或种类不满足要求/.test(mgr)) ok('评定失败用的是用户定的文案（原话照抄）');
  else bad('评定失败文案不是用户定的那句 —— 他明确写了「品质或种类不满足要求」');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  这里防的是"同一份规则写在两处"：评定要求在 shop-rules.js、ShopManager、');
console.log('  ShopScreen 里各有一份。三处只要有一处对不上，表现就是');
console.log('  "文档说要交梭鲈、游戏里却收别的"或者"界面写×2、实际只收1条"——没有任何报错。');
process.exitCode = fail === 0 ? 0 : 1;
