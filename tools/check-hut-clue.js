/*
 * check-hut-clue.js —— 「渔夫小屋定位线索」：替代罗盘的一次性定位道具。
 *
 * 用户 2026-10-02：
 *   "清楚罗盘物品，改为「渔夫小屋定位线索」，使用8张纸与一条mod鱼合成，
 *    使用后直接告诉距离玩家最近的小屋坐标。无论你怎么做，反正必须实现这种功能。
 *    我有一个参考想法，反正这玩意已经进结构了，那就借一下原版查找结构指令的原理，
 *    让玩家没权限也可以通过这个物品寻找。"
 *
 * 这条链路上每一环坏掉都是静默的：
 *   · 没接 `findNearestMapStructure` → 右键什么都没发生；
 *   · 结构标签写错 → 永远"线索断了"（而这是最像"附近真没有"的假象）；
 *   · 半径忘了 /16 → 把"格"当"区块"传，搜索范围小 16 倍；
 *   · 配方里用了不存在的标签 → 合不出来，配方书里也不显示；
 *   · 罗盘没删干净 → 界面/语言/创造页签里留着一件点不动的死物品。
 *
 * 用法：node tools/check-hut-clue.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const { stripComments } = require('./java-source.js');
const code = (p) => stripComments(read(p));

console.log('=== 渔夫小屋定位线索检查 ===\n');

const ITEM = 'src/main/java/com/whitecobalt/anglertackle/item/HutClueItem.java';
const ITEMS = 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java';
const RECIPE = 'src/main/resources/data/anglertackle/recipe/hut_clue.json';
const MODEL = 'src/main/resources/assets/anglertackle/models/item/hut_clue.json';
const TEX = 'src/main/resources/assets/anglertackle/textures/item/hut_clue.png';
const ZH = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';
const EN = 'src/main/resources/assets/anglertackle/lang/en_us.json';
const GUIDE = 'src/main/resources/data/anglertackle/guide/guide.json';
for (const f of [ITEM, ITEMS, RECIPE, MODEL, TEX, ZH, EN]) {
  if (!exists(f)) { no('找不到 ' + f); }
}
if (bad) { process.exit(1); }

const item = code(ITEM);

// ---------------------------------------------------------------- ① 用原版查找结构的原理
// ⚠ 断言必须**连"结果被用上了"一起**要求：只 grep `findNearestMapStructure(` 的话，
//   把它挪到 `if (false)` 后面、或者算完丢掉，检查器照样绿 —— 这一版就是这样被
//   负例测试（clue-no-search）当场抓出来的。所以要求"调用结果赋给 target"。
if (/BlockPos target = serverLevel\.findNearestMapStructure\(/.test(item)) {
  ok('调用的是 ServerLevel.findNearestMapStructure，并把结果赋给 target —— ' +
    '和原版 /locate structure 同一套');
} else {
  no('没有把 findNearestMapStructure 的结果真的用起来（调用名在、结果丢掉也算）—— ' +
    '用户明确要求"借原版查找结构指令的原理"');
}
if (/ModTags\.FISHERMAN_HUT/.test(item)) {
  ok('用的是模组的 #anglertackle:fisherman_hut 结构标签（不自己拼 TagKey）');
} else {
  no('没有用 ModTags.FISHERMAN_HUT —— 标签写错的表现是"永远说附近没有小屋"');
}
if (/Tuning\.compassSearchRadius\(\) \/ 16/.test(item)) {
  ok('搜索半径按"格 → 区块"换算（配置是格，findNearestMapStructure 要区块）');
} else {
  no('没有把配置的"格"除以 16 —— 半径会小 16 倍，几乎永远找不到');
}
if (/radiusChunks/.test(item)) ok('传进去的是区块数'); else no('半径参数看不出单位换算');
// 不需要权限：这条断言是"读代码里没有任何权限判断"（原版查找本身不看权限）
if (!/hasPermission|Permission|isOp|opLevel/.test(item)) {
  ok('没有任何权限判断（普通玩家也能用 —— 用户明确要求"没权限也可以通过这个物品寻找"）');
} else {
  no('出现了权限判断 —— 用户要的是没 OP 也能用');
}

// ---------------------------------------------------------------- ② 使用后报坐标
if (/hut_clue_found/.test(item) && /getX\(\)/.test(item)) {
  ok('报出了小屋的坐标（x/y/z）');
} else {
  no('没有报坐标 —— 用户要的是"直接告诉距离玩家最近的小屋坐标"');
}
if (/distance/.test(item) && /Math\.sqrt/.test(item)) ok('同时报了直线距离'); else no('没有报距离');
if (/shrink\(1\)/.test(item)) ok('用掉一张（一次性道具）'); else no('没有消耗 —— 8 张纸 + 一条鱼可以无限用');
if (/target == null[\s\S]{0,300}?return InteractionResultHolder\.success\(stack\)/.test(item)) {
  ok('找不到时不消耗（否则玩家连点几次就白扔了）');
} else {
  no('"找不到"那条路径的行为不明确 —— 应当不消耗并把原因说清楚');
}

// ---------------------------------------------------------------- ③ 数据：配方 / 模型 / 贴图 / 语言
{
  const j = JSON.parse(read(RECIPE));
  const paper = (j.ingredients || []).filter((i) => i.item === 'minecraft:paper').length;
  const tag = (j.ingredients || []).filter((i) => i.tag === 'anglertackle:fishes').length;
  const out = j.result && j.result.id;
  if (paper === 8 && tag === 1 && out === 'anglertackle:hut_clue') {
    ok('配方：纸 ×8 + #anglertackle:fishes ×1 → hut_clue ×1（与用户口径一致）');
  } else {
    no('配方不对：纸 ' + paper + ' 张、模组鱼标签 ' + tag + ' 个、产出 ' + out +
      '（应为 8 张纸 + 1 条任意模组鱼）');
  }
  // 标签文件必须存在（引用不存在的标签会让配方整条失效，而且界面上看不出来）
  const tagFile = 'src/main/resources/data/anglertackle/tags/item/fishes.json';
  if (exists(tagFile)) ok('#anglertackle:fishes 标签文件在');
  else no('缺 ' + tagFile + ' —— 配方引用了不存在的标签，合不出来');
  const m = JSON.parse(read(MODEL));
  if (m.parent === 'minecraft:item/generated' && m.textures && m.textures.layer0 === 'anglertackle:item/hut_clue') {
    ok('模型是 item/generated 且指向我们自己的贴图');
  } else {
    no('模型不对（' + JSON.stringify(m) + '）—— 会显示成紫黑格或原版指南针');
  }
  const zh = JSON.parse(read(ZH));
  const en = JSON.parse(read(EN));
  const need = ['item.anglertackle.hut_clue', 'item.anglertackle.hut_clue.desc',
    'message.anglertackle.hut_clue_found', 'message.anglertackle.hut_clue_none',
    'message.anglertackle.hut_clue_dir'];
  const missZh = need.filter((k) => !zh[k]);
  const missEn = need.filter((k) => !en[k]);
  if (!missZh.length && !missEn.length) ok('中英语言键齐全（' + need.length + ' 个）');
  else no('缺语言键：中 ' + missZh.join('/') + ' 英 ' + missEn.join('/'));
  // 报坐标那条文案必须真的有 4 个占位符（x/y/z/距离），否则 %s 会少一个显示成占位符
  const found = zh['message.anglertackle.hut_clue_found'] || '';
  if ((found.match(/%s/g) || []).length === 4) ok('坐标文案有 4 个参数位（x / y / z / 距离）');
  else no('坐标文案的参数位不是 4 个：' + JSON.stringify(found));
}

// ---------------------------------------------------------------- ⑤ 制作方法必须说出来
//
// 用户 2026-10-02："教程里没透露钓鱼小屋线索的制作方法。"
// 当时物品种类里**没有 appendHoverText**（desc / cost 两个语言键写好了却没人用，
// 成了孤儿键），而手册里那页又埋在第八章末尾的【怎么找到渔夫小屋】里 ——
// 结果是：玩家把鼠标放在线索上只看到一个名字，翻手册也未必翻到那一页。
//
// 所以这条断言把"必须说出来"钉在三个地方，缺一个就红：
//   ① 物品 tooltip（appendHoverText 真的要画那一行）
//   ② 中英语言键（缺了 tooltip 会显示成键名）
//   ③ 手册正文（配方 + 无序 + 要用工作台）
{
  const guide = JSON.parse(read(GUIDE));
  const glines = [];
  for (const c of guide.chapters) for (const p of c.pages || []) for (const l of p) glines.push(l);
  const gtext = glines.join('\n');

  // ① tooltip
  //
  // ⚠ 语言键必须连着引号一起匹配：只写 `hut_clue.craft` 的话，
  //   把它改成 `hut_clue.craft_gone` 这种变异照样命中（子串），
  //   负例 clue-no-tooltip 第一次就是**没抓到**的。
  if (/appendHoverText/.test(item) && /"item\.anglertackle\.hut_clue\.craft"/.test(item)) {
    ok('物品 tooltip 里写了制作方法（appendHoverText + item.anglertackle.hut_clue.craft）');
  } else {
    no('物品 tooltip 没有写制作方法 —— 玩家把鼠标放到线索上只会看到一个名字，'
      + '而"怎么做"只躺在手册第八章的某一页里');
  }
  // ② 语言键
  const zhLang = JSON.parse(read(ZH));
  const enLang = JSON.parse(read(EN));
  for (const [lang, name] of [[zhLang, '中'], [enLang, '英']]) {
    if (lang['item.anglertackle.hut_clue.craft']) ok(name + '文有 hut_clue.craft 这一行');
    else no(name + '文缺 item.anglertackle.hut_clue.craft —— tooltip 那一行会显示成键名');
  }

  // ③ 手册正文
  const recipeLine = glines.find((l) => /纸\s*×\s*8/.test(l) && /鱼/.test(l));
  if (recipeLine) ok('手册写了配方：' + JSON.stringify(recipeLine.trim()));
  else no('手册里没有"纸 ×8 + 任意模组鱼 ×1"这一句 —— 用户就是找不到它才报的');

  // ⚠ 还必须在**第一章（开局教程）**里就有：用户报的正是"教程里没透露"，
  //   而它原来只写在第八章末尾的【怎么找到渔夫小屋】那一页里。
  //   只要求"手册里某处有"是不够的 —— 那样把第一章那一处删掉，断言照样绿。
  const ch1 = (guide.chapters.find((c) => c.id === 'basics') || { pages: [] });
  const ch1Lines = [];
  for (const p of ch1.pages || []) for (const l of p) ch1Lines.push(l);
  const ch1Line = ch1Lines.find((l) => /纸\s*×\s*8/.test(l) && /鱼/.test(l));
  if (ch1Line) {
    ok('第一章（开局教程）里就写了配方：' + JSON.stringify(ch1Line.trim()));
  } else {
    no('第一章里没有线索的配方 —— 玩家读开局教程时根本看不到它（用户报的就是这个）');
  }
  // 顺着"怎么拿到它"这一句：第一章要把它和手册/图鉴并列写出来
  if (ch1Lines.some((l) => /渔夫小屋定位线索/.test(l))) {
    ok('第一章把它和手册 / 图鉴并列写出来了（开局三样东西）');
  } else {
    no('第一章没有提「渔夫小屋定位线索」这个东西 —— 新玩家不知道它存在');
  }

  if (/crafting_shapeless/.test(read(RECIPE))) {
    if (/无序/.test(gtext)) ok('配方是无序的，手册也写了「无序合成」');
    else no('配方是 shapeless（无序），但手册没写"无序合成" —— 玩家会去摆形状');
  } else {
    no('配方不再是无序的了 —— 手册里"无序合成"那句要跟着改，这条断言也要改');
  }

  if (/9 个格子|3×3/.test(gtext)) {
    if (/2×2/.test(gtext)) {
      ok('手册说明了它要 9 个格子、随身 2×2 合成栏放不下（得用工作台）');
    } else {
      no('手册写了"9 个格子"但没说"2×2 放不下" —— 玩家在随身合成栏里摆不出来会以为配方错了');
    }
  } else {
    no('手册没写它是 9 个格子的配方（8 张纸 + 1 条鱼）—— 随身 2×2 根本摆不下');
  }
}

// ---------------------------------------------------------------- ④ 罗盘必须删干净
{
  const leftovers = [];
  const walk = (dir) => {
    for (const n of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = dir + '/' + n;
      const st = fs.statSync(path.join(ROOT, rel));
      if (st.isDirectory()) { walk(rel); continue; }
      if (/tracking_compass|TrackingCompass|HutLocator|ClientHutLocator/.test(n)) leftovers.push(rel);
    }
  };
  walk('src/main');
  if (leftovers.length) {
    no('追踪罗盘的文件还留着：' + leftovers.join('、') + ' —— 用户要求"清楚罗盘物品"');
  } else {
    ok('罗盘相关文件已清空（物品类 / 客户端属性 / 网络包 / 模型 / 配方）');
  }
  const items = code(ITEMS);
  if (/TRACKING_COMPASS|tracking_compass/.test(items)) {
    no('ModItems 里还注册着 tracking_compass');
  } else {
    ok('ModItems 里不再注册罗盘');
  }
  if (!/TRACKING_COMPASS/.test(items) && /HUT_CLUE/.test(items)) ok('注册的是 HUT_CLUE');
  else no('ModItems 里找不到 HUT_CLUE');
  // 语言键也不许留
  const zh = read(ZH);
  if (/tracking_compass/.test(zh)) no('语言文件里还留着罗盘的键');
  else ok('语言文件里没有罗盘的残留键');
}

console.log('');
console.log(bad === 0
  ? '✅ 定位线索：原版查找原理 + 报坐标 + 配方/模型/语言齐全 + 罗盘已清'
  : '❌ 定位线索检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
