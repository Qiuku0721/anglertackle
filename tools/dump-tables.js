// ============================================================================
//  dump-tables.js -- 从源码里抽出所有数值表，打成便于查看的表格
//
//  数值散落在 ModItems（物品定义）、PartComposer（合成与上限）、
//  FishSpecies（鱼种）、RodItem（竿）、FishingSession（对抗常量）里。
//  这个脚本把它们统一读出来，避免"文档和代码不一致"。
//
//  用法: node tools/dump-tables.js
// ============================================================================
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt', 'anglertackle');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

// ---------------------------------------------------------------- 工具
function pad(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }
function title(t) { console.log('\n' + '='.repeat(78) + '\n  ' + t + '\n' + '='.repeat(78)); }

const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

const LINE_CN = {
  HEMP_LINE: '麻线', COTTON_LINE: '棉线', NYLON_LINE: '尼龙线',
  FLUORO_LINE: '碳氟线', PE_LINE: 'PE线', TITANIUM_LINE: '钛合金记忆线',
};
/** 档位 0–5 → 中文（上面那个 TIER_NAME 数组，索引即档位） */
const REEL_CN = {
  HAND_REEL: '手线轮', SPINNING_REEL: '纺车轮', DRUM_REEL: '鼓轮',
  BAITCAST_REEL: '水滴轮', HEAVY_REEL: '大型纺车轮',
};

const itemSrc = read('registry/ModItems.java');

// ---------------------------------------------------------------- 鱼竿
const rodSrc = read('item/RodItem.java');
title('一、鱼竿（5 材质 × 2 竿型 = 10 根）');
console.log('  材质      耐久    承重(kg)  品质上限  提竿窗口  张力上限  张力回复  体力削减  耐久损耗');
console.log('  ' + '-'.repeat(88));
// RodSpec 有 8 个参数：耐久, 承重, 提竿窗口, 张力上限, 张力回复, 体力削减, 耐久损耗, 档位
// ⚠ 加字段时这里必须同步——少一个参数整条正则就静默匹配不上，表格会变空
const rodRe = /public static final RodSpec (\w+) = new RodSpec\((\d+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)\)/g;
const ROD_CN = { WOOD: '木', IRON: '铁', GOLD: '金', DIAMOND: '钻石', NETHERITE: '下界合金' };
const TIER_CN = ['白', '绿', '蓝', '紫', '金', '红'];
let m;
let rodCount = 0;
while ((m = rodRe.exec(rodSrc)) !== null) {
  rodCount++;
  const tier = Number(m[9]);
  console.log('  ' + pad(ROD_CN[m[1]] || m[1], 9)
    + pad(m[2], 8) + pad(m[3], 10)
    + pad(tier + TIER_CN[tier], 10)
    + pad('+' + m[4] + 's', 10) + pad('×' + m[5], 10)
    + pad('×' + m[6], 10) + pad('×' + m[7], 10) + '×' + m[8]);
}
if (rodCount === 0) {
  console.log('  ⚠ 没解析到任何 RodSpec —— 正则和 RodItem.java 的字段数对不上了');
}
console.log('\n  品质上限 = 这根竿最高能出到几档的鱼（木1绿 铁2蓝 金3紫 钻4金 合金5红）。');
console.log('  它由**材质显式声明**，不再从承重推导——早先按承重推导时档位 4 永远取不到，');
console.log('  金竿还掉到"到蓝"比铁竿差，玩家反馈"几十杆没一条金以上"就是这个原因。');
console.log('  承重是**另一道独立闸门**（这根竿扛不扛得住这种体型），两件事不耦合。');
console.log('\n  竿型差异：台钓竿 射程×0.85、提竿窗口 +0.05s（看漂，只吃饵料、免对抗）');
console.log('            路亚竿 射程×1.00（拟饵，进张力对抗）');

/**
 * 解析一个"物品定义块"：按 `ITEMS.register("name"` 定位，再在**同一个块**里
 * 找 `Rarity.XXX`、`partProps(耐久,`、以及 `PartStats.xxx(...)` 的参数。
 *
 * <p>踩过两次坑，所以这里刻意不用"一个大正则"：
 * <ol>
 *   <li>参数用 {@code [\d.]+} 限死时，遇到 {@code 35.0 / 30.0} 这种算式
 *       整张鱼线表**静默变空**（脚本照样退出 0）；</li>
 *   <li>用 {@code PartStats\.(\w+)\(([^)]*)\)} 抓参数时，
 *       {@code partProps(50, Rarity.X, PartStats.line(...))} 里的
 *       {@code Rarity.X} 会被 {@code [^)]*} 吃进"参数体"，
 *       于是第 5 个参数永远抓不到、档位整列错位。</li>
 * </ol>
 * 现在改成按 id 边界切片 + 显式括号配对，逻辑直白、出错也能一眼看出来。
 *
 * @param kind PartStats 的方法名（line / reel / hook / floatPart / lure）
 */
function parsePartBlocks(src, kind) {
  const out = [];
  const re = /ITEMS\.register\("([a-z_]+)"/g;
  const marks = [];
  let m;
  while ((m = re.exec(src)) !== null) marks.push({ id: m[1], at: m.index });
  // 每个块的范围：本 register 到下一个 register
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].at;
    const to = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const block = src.slice(from, to);

    const call = `PartStats.${kind}(`;
    const at = block.indexOf(call);
    if (at < 0) continue;
    // 显式括号配对取出参数体
    let depth = 0, end = -1;
    for (let p = at + call.length - 1; p < block.length; p++) {
      if (block[p] === '(') depth++;
      else if (block[p] === ')') { depth--; if (depth === 0) { end = p; break; } }
    }
    if (end < 0) continue;
    const argSrc = block.slice(at + call.length, end);
    const args = argSrc.split(',').map((a) => a.trim());

    const val = (s) => {
      if (s === undefined || s === '') return 0;
      const n = Number(s);
      if (Number.isFinite(n)) return n;
      if (!/^[\d.\s*+\-/()]+$/.test(s)) {
        throw new Error('参数无法求值: "' + s + '"（物品 ' + marks[i].id + '）');
      }
      return Function('"use strict";return (' + s + ')')();
    };

    const rar = block.match(/Rarity\.(\w+)/);
    const dur = block.match(/partProps\(\s*(\d+)\s*,/);
    out.push({
      id: marks[i].id,
      rarity: rar ? rar[1] : 'COMMON',
      durability: dur ? Number(dur[1]) : 0,
      v: args.slice(0, 4).map((a) => String(val(a))),
      // 档位是最后一个参数；4 参数签名（reel/hook/floatPart）没有档位 → 0。
      // ⚠ ModItems 里写的档位是 **1–6（白=1）**，而 Quality/TIER_NAME 是 **0–5**。
      //   统一减 1 存成 0-based，否则 TIER_NAME[1] 会给出"绿"（白被跳过），
      //   而且 6 会越界变成 undefined、回退显示原版 Rarity（又看到"紫/EPIC"）。
      tier: args.length > 4 ? val(args[args.length - 1]) - 1 : 0,
    });
  }
  return out;
}

const RARITY_CN = { COMMON: '白', UNCOMMON: '绿', RARE: '蓝', EPIC: '紫', LEGENDARY: '金' };

// ---------------------------------------------------------------- 鱼线
title('二、鱼线（6 档）');
console.log('  鱼线        档位  耐久   张力上限  张力生成  张力回复   线长(米)  合成后上限');
console.log('  ' + '-'.repeat(84));
// 张力上限合成：100 × [1+(线-1)×0.60] × [1+(竿-1)×0.40]，这里按"木竿"（竿倍率 1.0）算
const BASE_TENSION_CEILING = 100.0;
for (const b of parsePartBlocks(itemSrc, 'line')) {
  const ceiling = Number(b.v[0]);
  const len = (30.0 * Number(b.v[3])).toFixed(0);
  const composed = (BASE_TENSION_CEILING * (1 + (ceiling - 1) * 0.60)).toFixed(0);
  console.log('  ' + pad(LINE_CN[b.id.toUpperCase()] || b.id, 12)
    // 显示**档位**而不是原版 Rarity —— 后者只有四档，PE 和钛合金线都会显示"紫"，
    // 看不出金/红的区别（这正是要修的问题）
    + pad(TIER_NAME[b.tier] || b.rarity, 6)
    + pad(b.durability, 7)
    + pad('×' + b.v[0], 10) + pad('×' + b.v[1], 10)
    + pad('×' + b.v[2], 10) + pad(len + ' 米', 10)
    + composed + ' 点（木竿）');
}
console.log('\n  张力上限/回复是**加权合成**（线 60% + 竿 40%），不是直接取线的值；');
console.log('  张力生成**直接取线的值**（越低越安全）。');
console.log('  ⚠ 名字颜色由配件档位决定，不看原版 Rarity');
console.log('    （Rarity 只有四档，紫/金/红会全挤在 EPIC 变成同一个紫色）。');

// ---------------------------------------------------------------- 渔轮
title('三、渔轮（5 档）');
console.log('  渔轮          品质  不挣扎回拉  挣扎回拉  体力削减  压制阻尼  阻尼转化');
console.log('  ' + '-'.repeat(84));
for (const b of parsePartBlocks(itemSrc, 'reel')) {
  // 压制阻尼的第二重收益（用户定案）：高于 1.0 的部分 × 50% 转成单轮扣力上限
  const damping = Number(b.v[3]);
  const bonus = Math.min(0.85, Math.max(0, damping - 1.0) * 0.50);
  console.log('  ' + pad(REEL_CN[b.id.toUpperCase()] || b.id, 13)
    + pad(RARITY_CN[b.rarity] || b.rarity, 6)
    + pad('×' + b.v[0], 12) + pad('×' + b.v[1], 10)
    + pad('×' + b.v[2], 10) + pad('×' + b.v[3], 10)
    + (bonus > 0 ? '+' + (bonus * 100).toFixed(1) + '%' : '—'));
}
console.log('\n  渔轮四属性的作用（FishingSession 里被消费的位置）：');
console.log('    不挣扎回拉 pullIdle     → 收线速度 = 0.22 × pullIdle 格/tick');
console.log('    挣扎回拉   pullStruggle → ⚠ 目前**没有任何地方使用**（死字段）');
console.log('    体力削减   staminaDrain → 每 tick 扣力 × staminaDrain（渔轮 60% + 鱼竿 40%）');
console.log('    压制阻尼   damping      → ① 鱼回气 ÷ max(0.5, damping)');
console.log('                              ② 高于 1.0 的部分 × 50% → 单轮扣力上限加成');
console.log('  阻尼转化举例：手线轮 1.00 → +0；鼓轮 1.45 → +22.5%；大型纺车轮 2.50 → +75%');

// ---------------------------------------------------------------- 上限
const compSrc = read('fishing/PartComposer.java');
title('四、属性合成与硬上限');
const capRe = /CAP_(\w+) = ([\d.]+)/g;
const CAP_CN = {
  TENSION_CEILING: '张力上限', TENSION_RECOVER: '张力回复',
  STAMINA_DRAIN: '体力削减', PULL: '回拉速度', DAMPING: '压制阻尼',
};
while ((m = capRe.exec(compSrc)) !== null) {
  console.log('  ' + pad(CAP_CN[m[1]] || m[1], 12) + '上限 ×' + m[2]);
}
console.log('\n  权重：张力上限/回复 = 鱼线 60% + 鱼竿 40%');
console.log('        体力削减       = 渔轮 60% + 鱼竿 40%');
console.log('        回拉/阻尼      = 只由渔轮决定');

// ---------------------------------------------------------------- 对抗常量
const sessSrc = read('fishing/FishingSession.java');
title('五、对抗常量（遛鱼手感）');
const C_CN = {
  REEL_GAIN: '收线张力增长', RELEASE_LOSS: '放线张力回落', IDLE_LOSS: '中立张力回落',
  PULL_IDLE: '鱼的常驻拉力', PULL_SPRINT: '冲刺时拉力',
  BASE_DRAIN_PER_SEC: '收线扣鱼力速率(占满体力/秒)',
  NEAR_SHORE_BASE: '近岸基准距离(米)',
};
for (const [k, cn] of Object.entries(C_CN)) {
  const re = new RegExp('double ' + k + ' = ([\\d.]+)');
  const mm = sessSrc.match(re);
  if (mm) console.log('  ' + pad(cn, 30) + mm[1]);
}

// ---------------------------------------------------------------- 鱼种
// ⚠ 鱼种表**不在这里手算**：品质分界必须按 FishSpecies.tierSplit() 的**权重划分**算
//   （金:红 = 5:2），而不是按体重等分。
//   这里原来写的是等分算法，导致表里每个分界点都是错的 ——
//   玩家照它推"多大算金鱼"会全错（比如大西洋鲑的等分分界是 12.0kg，实际是 16.3kg）。
//   现在直接指向 tools/dump-fish.js，那边从源码读权重、按真实算法算，
//   并且连"实际出品质概率"（按偏小中的体重分布）一起给出。
const fishSrc = read('fishing/FishSpecies.java');
title('六、鱼种（10 种）—— 完整表见 tools/dump-fish.js');
console.log('  跑 `node tools/dump-fish.js` 输出四张表：');
console.log('    一、鱼种总表（体重区间 / 竿型 / 手感 / 基础游速 / 体力 / 张力）');
console.log('    二、品质分界（按 tierSplit 权重划分，附各档体重区间占比）');
console.log('    三、实际出品质概率（按真实的偏小中体重分布，不是线性）');
console.log('    四、体长范围');
console.log('');
console.log('  品质阶梯：白 → 绿 → 蓝 → 紫 → 金 → 红（颜色直接作用在鱼名上）');
console.log('  ⚠ 分界是**按权重划分**的，不是等分：金:红 = '
  + (function () {
    const body = /public int\[\] tierSplit\(\)\s*\{([\s\S]*?)\n    \}/.exec(fishSrc);
    const rules = {};
    if (body) {
      const re = /case (\d+) -> (\d+);/g;
      let mm;
      while ((mm = re.exec(body[1])) !== null) rules[Number(mm[1])] = Number(mm[2]);
    }
    return (rules[4] || '?') + ':' + (rules[5] || '?');
  })()
  + '（红鱼真比金鱼稀有）');

// ---------------------------------------------------------------- 品质系数
title('七、品质系数（鱼 vs 装备的对冲）');
console.log('  档位   游动速度倍率   体力抗性倍率   说明');
console.log('  ' + '-'.repeat(66));
const SPEED_NOTE = [
  '基准', '略快', '明显更快', '快', '很快', '最快（1.76×）',
];
for (let t = 0; t <= 5; t++) {
  const sp = Math.pow(1.12, t);
  const sr = Math.pow(1.18, t);
  console.log('  ' + pad(TIER_NAME[t], 7)
    + pad('×' + sp.toFixed(2), 15) + pad('×' + sr.toFixed(2), 15) + SPEED_NOTE[t]);
}
console.log('\n  游动速度倍率 ×1.12/档 —— 同时作用于：');
console.log('    张力上涨 = 收线/放线基准 × 控杆关系 × 线.tensionGen × 鱼.tierSpeed × 鱼.tensionGain');
console.log('    线被拽远 = 鱼.tierSpeed × 鱼.pullSpeed  −  竿.pullIdle × 轮.pullIdle');
console.log('  体力抗性倍率 ×1.18/档 —— 除在扣力公式里：');
console.log('    鱼力扣除 = 0.20/秒 × 张力效率 × 控杆关系 × 轮.staminaDrain × 竿.staminaDrain ÷ 鱼.tierStaminaResist');
console.log('  张力上限 = 100 × 线.tensionCeiling(60%) × 竿.tensionCeiling(40%)  ← 鱼不参与');

// ---------------------------------------------------------------- 三种策略
title('八、三种对抗策略（参数刻意互补）');
console.log('  策略      挣扎游速  张力上涨  变向间隔  冲刺间隔  假动作  应对方式');
console.log('  ' + '-'.repeat(84));
console.log('  均衡型     中        中       3.5s     4.5s     0%    随便打');
console.log('  爆发型     极快      中       3.0s     2.6s    10%    趁疲劳期反拉');
console.log('  黏液型     慢        极快     5.5s     8.0s     0%    频繁松手，耐心磨');
console.log('  神经质     快        偏高     1.3s     3.0s    35%    紧跟预告，预判错就飙');
console.log('\n  张力上涨指数 = tensionGain × 鱼线 tensionGen（线越高级越小）');

// ---------------------------------------------------------------- 挣扎轮次
title('九、挣扎轮次与节奏');
console.log('  品质      最多挣扎轮数   单轮挣扎时长   单轮休息时长');
console.log('  ' + '-'.repeat(60));
const ROUNDS = ['固定 2 轮（无下限，竿好可一轮收）', '固定 2 轮（无下限）',
  '固定 2 轮（无下限）', '固定 2 轮（无下限）',
  '4~5 轮', '5~7 轮'];
for (let t = 0; t <= 5; t++) {
  const st = (2.0 + t * 1.6).toFixed(1);
  const rt = (5.0 - t * 0.4).toFixed(1);
  console.log('  ' + pad(TIER_NAME[t], 9) + pad(ROUNDS[t], 26) + pad(st + ' 秒', 15) + rt + ' 秒');
}
console.log('\n  轮次用尽后鱼永久停止挣扎，只剩收线。');

// ---------------------------------------------------------------- 抛投 × 稀有度
title('十、抛投距离 × 稀有度（用户定案）');
console.log('  抛投        距离      紫档权重   金档权重   红档权重');
console.log('  ' + '-'.repeat(58));
const RANGE_ROWS = [
  ['近抛', '8 米', 1 - 0.05 * 3, 1 - 0.03 * 3, 1 - 0.015 * 3],
  ['平抛', '16 米', 1.0, 1.0, 1.0],
  ['高抛', '24 米', 1 + 0.05 * 6, 1 + 0.03 * 6, 1 + 0.015 * 6],
];
for (const [name, dist, p, g, r] of RANGE_ROWS) {
  console.log('  ' + pad(name, 12) + pad(dist, 10)
    + pad('×' + p.toFixed(2), 11) + pad('×' + g.toFixed(2), 11) + '×' + r.toFixed(2));
}
console.log('\n  白/绿/蓝三档与抛投距离无关（小鱼到处都是，抛哪都一样）。');
console.log('  设计意图：高抛能打到深水，高级鱼概率上升——但距离远、线被拽出去的风险也大。');

// ---------------------------------------------------------------- 鱼种抽取权重
// ⚠ 这张表以前**根本没进文档**，结果"顶配路亚金以上只有 17%"这种问题
//    只能靠玩家反馈才发现。现在直接从 FishSpecies.java 读出来摊开。
// 注意 fishSrc / m 在上面已经声明过（模块作用域），这里用块作用域隔离变量。
{
  title('十之二、鱼种抽取基础权重（FishSpecies.baseWeightByTier）');
  const bwMatch = /public static int\[\] baseWeightByTier\(\)\s*\{\s*\/\/[\s\S]*?return new int\[\]\{([^}]*)\}/.exec(fishSrc)
    || /public static int\[\] baseWeightByTier\(\)\s*\{[\s\S]*?return new int\[\]\{([^}]*)\}/.exec(fishSrc);
  if (bwMatch) {
    const bw = bwMatch[1].split(',').map((v) => Number(v.trim()));
    const tw = { 0: '白', 1: '绿', 2: '蓝', 3: '紫', 4: '金', 5: '红' };
    console.log('  按鱼种的**最低档**索引——也就是"这个鱼种多久露一次面"：');
    console.log('');
    console.log('  鱼种最低档   权重   占总池比例（顶配路亚实测）');
    console.log('  ' + '-'.repeat(48));
    const total = bw.reduce((a, b) => a + b, 0);
    for (let t = 0; t < bw.length; t++) {
      const share = (bw[t] / total * 100).toFixed(1);
      console.log('  ' + pad(t + tw[t], 12) + pad(bw[t], 7) + share + '%');
    }
    console.log('\n  当前表 = [' + bw.join(', ') + ']');
    console.log('  三个金红鱼种（大西洋鲑 / 蓝鳍金枪鱼 / 幼鲨）的 minTier 都是 4，');
    console.log('  所以全都吃权重 ' + bw[4] + '，并且要跟权重 ' + bw[1] + '/' + bw[2] + ' 的一堆低档鱼抢。');
    console.log('  调这张表 = 调"多久见一次金红鱼"；调 tierSplit() = 调"见到之后是金还是红"。');
  } else {
    console.log('  ⚠ 没解析到 baseWeightByTier()，正则需要更新');
  }
}

// ---------------------------------------------------------------- 档位内部分界
{
  title('十之三、鱼种内部档位分界（FishSpecies.tierSplit）');
  const tsBody = /public int\[\] tierSplit\(\)\s*\{([\s\S]*?)\n    \}/.exec(fishSrc);
  if (tsBody) {
    const rules = {};
    const caseRe = /case (\d+) -> (\d+);/g;
    let cm;
    while ((cm = caseRe.exec(tsBody[1])) !== null) rules[Number(cm[1])] = Number(cm[2]);
    const defM = /default -> (\d+);/.exec(tsBody[1]);
    const tw = { 0: '白', 1: '绿', 2: '蓝', 3: '紫', 4: '金', 5: '红' };
    console.log('  决定"同一种鱼里，大个体能大到哪一档"——权重越小该档越稀有：');
    console.log('');
    console.log('  档位   区间权重');
    console.log('  ' + '-'.repeat(22));
    for (const k of Object.keys(rules).sort((a, b) => a - b)) {
      console.log('  ' + pad(k + (tw[k] || ''), 8) + rules[k]);
    }
    if (defM) console.log('  ' + pad('其它', 8) + defM[1] + '（白/绿/蓝/紫）');
    console.log('\n  ⚠ 以前这里是**等分**（idx = floor(ratio * 档数)），');
    console.log('    对只有两档的鱼（金红鱼 {4,5}）意味着金和红永远五五开。');
    console.log('    现在按权重划分，金:红 ≈ 2.5:1，红鱼真正比金鱼稀有。');
  }
}

// ---------------------------------------------------------------- 鱼饵下限 / 拟饵
// 这两张表**不在这里手写**：它们随 ModItems 的注册参数变化，
// 手抄过一次就过期了（曾经还写着"面包屑/发光饵/秘制香饵"这些已改名的饵）。
// 现在由 tools/dump-baits.js 直接从 ModItems.java 读，永远和代码一致。
title('十一、鱼饵品质下限 + 十二、拟饵（见 tools/dump-baits.js）');
console.log('  跑 `node tools/dump-baits.js` 输出这两张表。');
console.log('');
console.log('  规则摘要：');
console.log('    紫饵 / 紫拟饵  → 绿档起（滤掉白档）');
console.log('    金饵 / 金拟饵  → 蓝档起（滤掉白绿）');
console.log('    红饵 / 红拟饵  → 蓝档起 + 金鱼 +5%、红鱼 +1.8%（鱼种抽取阶段的权重倍率）');
console.log('    白/绿/蓝档饵   → 不设下限');
console.log('');
console.log('  ⚠ 下限同时作用于【鱼种】和【个体】两层：');
console.log('    鱼种层：按鱼种的 maxTier 过滤（整个鱼种都低于下限 → 不咬钩）');
console.log('    个体层：按体重区间精确采样（同种鱼里体型小的那些也要挡掉）');
console.log('    只做鱼种层会漏——这是"金饵出绿鱼"的真正原因，见 tools/check-bait-filter.js');
