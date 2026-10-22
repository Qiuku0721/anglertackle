/*
 * check-bite-time.js —— 咬钩等待的减时链（台钓竿 −30% + 饵料 −5%~−21%，加算，下限 3 秒）。
 *
 * 用户 2026-10-02：
 *   "台钓的咬钩时间单独下降 30%，台钓饵料对咬钩时间也进行下降，具体数值：
 *    白 5% 绿 8% 蓝 12% 紫 16% 金 18.5% 红 21%，以上提到的数值属于**加算**，
 *    但配合打窝至多做到 3 秒一条鱼。记得同步文本显示与教程。"
 *
 * 这条链上每一环坏掉都是**静默**的：
 *   · 加算写成连乘 → 每个数字单独看都对，实得时间却对不上（只在叠满时露馅）；
 *   · 档位错一档 → 和 AGENTS.md 里那两次事故同源，不崩不报错，只是"某档饵不对"；
 *   · 空槽按白档算 → 把饵拿下来反而更快（−5%），玩家只会觉得加成坏了；
 *   · 漏了下限 → 越堆越快、没有尽头，用户要的"至多 3 秒"永远达不到；
 *   · 档位表改了、tooltip / 手册没跟着改 → 玩家按旧的百分比去选饵。
 *   所以下面每一条都用**同一份数值**（Config 的默认值）现算再对账，
 *   而不是把 5/8/12/16/18.5/21 在检查器里再抄一遍。
 *
 * 用法：node tools/check-bite-time.js
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

const CONFIG = 'src/main/java/com/whitecobalt/anglertackle/Config.java';
const TIMING = 'src/main/java/com/whitecobalt/anglertackle/fishing/BiteTiming.java';
const SESSION = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java';
const BAIT = 'src/main/java/com/whitecobalt/anglertackle/item/BaitItem.java';
const ROD = 'src/main/java/com/whitecobalt/anglertackle/item/RodItem.java';
const GUIDE = 'src/main/resources/data/anglertackle/guide/guide.json';
const ZH = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';
const EN = 'src/main/resources/assets/anglertackle/lang/en_us.json';

console.log('=== 咬钩减时链检查（台钓 −30% + 饵料档位，加算，下限 3 秒）===\n');

for (const f of [CONFIG, TIMING, SESSION, BAIT, ROD, GUIDE, ZH, EN]) {
  if (!exists(f)) { no('找不到 ' + f); }
}
if (bad) { process.exit(1); }

const code = (p) => stripComments(read(p));

/** 取某个方法（按签名里的片段定位）的大括号体。 */
function bodyOf(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const s = src.indexOf('{', i);
  if (s < 0) return '';
  let depth = 0;
  for (let k = s; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(s, k + 1); }
  }
  return '';
}

/** Config.java 里 defineInRange 的默认值。 */
function cfgDefault(key) {
  const m = new RegExp('\\.defineInRange\\("' + key + '",\\s*([0-9.]+)D').exec(configSrc);
  return m ? Number(m[1]) : null;
}

const configSrc = read(CONFIG);

// ---------------------------------------------------------------- ① 数值本体
// 用户定案的那 8 个数。改它们必须用户点头 —— 这里就是把这句话变成断言。
const TIERS = [
  [0, '白', 'White', 5.0],
  [1, '绿', 'Green', 8.0],
  [2, '蓝', 'Blue', 12.0],
  [3, '紫', 'Purple', 16.0],
  [4, '金', 'Gold', 18.5],
  [5, '红', 'Red', 21.0],
];
const WANT = {
  floatRodCutPercent: 30.0,
  floorSeconds: 3.0,
};
const VALUE = {};   // 从 Config 实际读出来的值（后面所有对账都用它）
{
  // 先确认这些键都落在 push("bite") … pop() 之间（配置路径 = bite.*，
  // 挪到别的段里玩家的 toml 位置会变，属于"悄悄改了配置结构"）。
  const i = configSrc.indexOf('.push("bite")');
  const j = configSrc.indexOf('b.pop()', i);
  const block = i >= 0 && j > i ? configSrc.slice(i, j) : '';
  if (!block) {
    no('Config.java 里找不到 bite 配置段（push("bite") … pop()）—— 这条断言失效了');
  }

  for (const [key, want] of Object.entries(WANT)) {
    const got = cfgDefault(key);
    if (got === null) {
      no('Config.java 里没有 bite.' + key + '（用户定案的数值必须落在这里）');
      continue;
    }
    if (Math.abs(got - want) > 1e-9) {
      no('bite.' + key + ' = ' + got + '，用户定的是 ' + want + '（改它要用户点头）');
    } else if (block && !block.includes('"' + key + '"')) {
      no('bite.' + key + ' 不在 bite 配置段里（配置路径会变，玩家的 toml 会错位）');
    } else {
      ok('bite.' + key + ' = ' + want + '（在 bite 段内）');
    }
    VALUE[key] = got === null ? want : got;
  }

  for (const [tier, cn, en, want] of TIERS) {
    const key = 'baitCut' + en + 'Percent';
    const got = cfgDefault(key);
    if (got === null) {
      no('Config.java 里没有 bite.' + key + '（' + cn + '档饵料）');
      continue;
    }
    if (Math.abs(got - want) > 1e-9) {
      no('bite.' + key + ' = ' + got + '，用户定的是 ' + want + '（' + cn + '档）');
    } else if (block && !block.includes('"' + key + '"')) {
      no('bite.' + key + ' 不在 bite 配置段里');
    } else {
      ok('bite.' + key + ' = ' + want + '（' + cn + '档，档位 ' + tier + '）');
    }
    VALUE[key] = got === null ? want : got;
  }
}

// ---------------------------------------------------------------- ② 档位映射
// 0 起算的刻度（白0 … 红5），与 BaitItem.tier() / equippedBaitTier() 同一套。
{
  const bt = code(TIMING);
  const body = bodyOf(bt, 'baitCutPercent(');
  if (!body) {
    no('BiteTiming 里找不到 baitCutPercent(int)');
  } else {
    for (const [tier, cn, en] of TIERS) {
      const re = new RegExp('case\\s+' + tier + '\\s*->\\s*c\\.biteBaitCut' + en + 'Percent\\.get\\(\\)');
      if (re.test(body)) ok('档位 ' + tier + '（' + cn + '）→ biteBaitCut' + en + 'Percent');
      else no('BiteTiming.baitCutPercent 里档位 ' + tier + '（' + cn + '档）没有映射到 biteBaitCut' + en + 'Percent');
    }
    // ⚠ 1 起算的拟饵刻度混进来就会是 case 6（AGENTS.md 第二条：两套刻度）
    if (/case\s+6\s*->/.test(body)) {
      no('BiteTiming 里出现了 case 6 —— 档位是 0 起算（白0…红5），'
        + '6 是 1 起算的拟饵刻度混进来了（见 AGENTS.md 第二条）');
    }
    if (/default\s*->\s*0\.0/.test(body)) {
      ok('档位越界返回 0（不按最高档算，错误不会被藏起来）');
    } else {
      no('BiteTiming.baitCutPercent 的 default 必须返回 0.0：越界时按最高档算会把"拿错刻度"藏起来');
    }
    if (/case\s+6\s*->/.test(body) || /case\s+-\d/.test(body)) {
      no('BiteTiming 的 case 编号超出了 0~5');
    }
  }

  // ⚠ 2026-10-02：环境系统给 totalCut 加了第三个参数（夜间台钓 −10%，见 docs/24）。
  //   两参的那个重载现在只是一行 `return totalCut(floatRod, baitCut, false);`（纯粹的兼容壳），
  //   断言必须打在**三参的真实实现**上 —— 一开始还用 `'totalCut('` 当锚点，
  //   于是 bodyOf 抓到的是那个壳，四条断言全红（而实现其实是对的）。
  const total = bodyOf(bt, 'totalCut(boolean floatRod, double baitCutPercent, boolean night)');
  if (!total) {
    no('BiteTiming 里找不到三参的 totalCut（环境系统需要的那个真实实现）');
  } else {
    if (/rodCutPercent\(\)\s*\+\s*Math\.max\(0\.0,\s*baitCutPercent\)/.test(total)) {
      ok('totalCut 是**加算**（竿% + 饵% + 夜%），不是连乘');
    } else {
      no('totalCut 里没有看到"竿% + 饵%"的加算式 —— 连乘会让实得时间对不上用户定的数值');
    }
    // 夜间减免也必须以加算进总减时（不许另开一条乘法链）
    if (/nightCutPercent\(\s*true\s*,\s*night\s*\)\s*\*\s*100\.0/.test(total)) {
      ok('夜间台钓减免以加算进总减时（+ nightCutPercent × 100）');
    } else {
      no('totalCut 里没有把夜间减免按百分点加进总减时');
    }
    if (/if\s*\(!floatRod\)\s*\{\s*return 0\.0;\s*\}/.test(total)) {
      ok('totalCut 先挡掉非台钓竿（路亚竿不吃这一项）');
    } else {
      no('totalCut 里没有"非台钓竿直接返回 0"—— 路亚竿会白吃台钓的减时');
    }
    if (/Math\.min\(1\.0,/.test(total)) ok('总减时封顶 100%（配置各自拉满时不会变成负数等待）');
    else no('totalCut 没有封顶：配置拉满时 (1 − cut) 会是负数');
  }

  // 夜间减免本身：只作用于"夜晚 + 台钓"
  const nightCut = bodyOf(bt, 'nightCutPercent(');
  if (!nightCut) {
    no('BiteTiming 里找不到 nightCutPercent');
  } else if (/if\s*\(!floatRod\s*\|\|\s*!night\)\s*\{\s*return 0\.0;\s*\}/.test(nightCut)) {
    ok('夜间减免只作用于"夜晚 + 台钓"（路亚竿与白天都不吃）');
  } else {
    no('nightCutPercent 缺少"非台钓或非夜晚 → 0"的短路');
  }
}

// ---------------------------------------------------------------- ③ 消费点
{
  const fs1 = code(SESSION);
  const bw = bodyOf(fs1, 'public void beginWaiting(');
  if (!bw) {
    no('FishingSession 里找不到 beginWaiting');
  } else {
    const need = [
      // 2026-10-02：totalCut 多了第三个参数（night，环境系统的夜间台钓 −10%）
      ['BiteTiming.totalCut(floatRod, baitCut, night)', '总减时走 BiteTiming.totalCut'],
      ['base *= (1.0 - cut)', '实得 = 基础 × (1 − 减时)'],
      ['base *= chumTime', '打窝倍率仍然相乘（用户："配合打窝"）'],
      ['base = Math.max(base, BiteTiming.floorSeconds())', '下限走 BiteTiming.floorSeconds（3 秒地板）'],
      ['base = Math.min(base, cfg.biteHardCap.get())', '上限仍然生效'],
    ];
    for (const [needle, label] of need) {
      if (bw.includes(needle)) ok('beginWaiting：' + label);
      else no('beginWaiting 里没有「' + label + '」（找不到 `' + needle + '`）');
    }
    // 顺序：减时 → 打窝 → 流动 → **下限 → 上限**（下限必须在下最后一道 clamp 里，
    // 否则被上限压完还可能低于地板 —— 也可能反过来，总之"哪个在后"必须有意义）
    const iCut = bw.indexOf('base *= (1.0 - cut)');
    const iChum = bw.indexOf('base *= chumTime');
    const iFlow = bw.indexOf('if (flowing)');
    const iFloor = bw.indexOf('base = Math.max(base, BiteTiming.floorSeconds())');
    const iCap = bw.indexOf('base = Math.min(base, cfg.biteHardCap.get())');
    if (iCut >= 0 && iChum >= 0 && iFlow >= 0 && iFloor >= 0 && iCap >= 0) {
      if (iCut < iChum && iChum < iFlow) ok('顺序：减时 → 打窝 → 流动');
      else no('减时 / 打窝 / 流动 的顺序不对（应当是 减时 → 打窝 → 流动）');
      if (iFlow < iFloor && iFloor < iCap) ok('顺序：…… 最后才夹到 [下限, 上限]');
      else no('下限 / 上限的收尾顺序不对：两道 clamp 必须在所有乘法之后');
    }
    // 台钓限定：路亚竿不许调用 equippedBaitCutPercent()
    if (/double baitCut = floatRod \? this\.equippedBaitCutPercent\(\) : 0\.0/.test(bw)) {
      ok('饵料减时只在台钓竿上取（路亚竿的拟饵不参与）');
    } else {
      no('beginWaiting 里 baitCut 没有用 floatRod 门控 —— 路亚竿会吃到饵料减时');
    }
  }

  const eb = bodyOf(fs1, 'equippedBaitCutPercent()');
  if (!eb) {
    no('FishingSession 里找不到 equippedBaitCutPercent');
  } else {
    if (/rodType\(\)\s*!=\s*com\.whitecobalt\.anglertackle\.item\.RodItem\.RodType\.FLOAT/.test(eb)) {
      ok('equippedBaitCutPercent 只认台钓竿');
    } else {
      no('equippedBaitCutPercent 没有"非台钓竿返回 0"的早退');
    }
    if (/RodStats\.isWornOut\(parts\.baitStack\(\)\)/.test(eb)) {
      ok('饵料耗尽 → 不给减时（与 equippedBaitTier 同一套判据）');
    } else {
      no('equippedBaitCutPercent 没判 isWornOut(parts.baitStack())：'
        + '见底的饵照样给减时，正是"耐久用光了加成还在"那次事故');
    }
    // ⚠ 空槽：equippedBaitTier() 把"没装饵"和"白档"都记作 0，
    //   不单独问一句的话空槽会白拿"白饵 −5%"。
    if (/parts\.bait\(\)/.test(eb) && /id == null \|\| id\.isEmpty\(\)/.test(eb)) {
      ok('空槽 → 不给减时（不会白拿白饵的 −5%）');
    } else {
      no('equippedBaitCutPercent 没有"空槽返回 0"的判断 —— '
        + 'equippedBaitTier() 把空槽和白档都记作 0，空槽会白拿白饵的减时');
    }
    if (/parts\.lure\(\)|parts\.lureStack\(\)/.test(eb)) {
      no('equippedBaitCutPercent 读了 lure 槽 —— 台钓要用 bait 槽（两处取法必须一致）');
    } else {
      ok('取的是 bait 槽，没有混进 lure 槽');
    }
    if (/BiteTiming\.baitCutPercent\(this\.equippedBaitTier\(\)\)/.test(eb)) {
      ok('档位回去问 equippedBaitTier()（唯一汇合点，不自己数刻度）');
    } else {
      no('equippedBaitCutPercent 没有走 equippedBaitTier() —— 档位不许有第二处取法');
    }
  }
}

// ---------------------------------------------------------------- ④ 文本同源
{
  const bait = code(BAIT);
  if (/BiteTiming\.baitCutPercent\(this\.tier\)/.test(bait)) ok('BaitItem 的减时走 BiteTiming（与生效值同源）');
  else no('BaitItem 的减时没走 BiteTiming —— tooltip 会和实际生效的数值漂移');
  // ⚠ 语言键必须连着**两边的引号**一起匹配：只写 `bait_cut_time` 的话，
  //   把它改成 `bait_cut_time_removed` 这种变异照样能命中（子串），
  //   负例 bite-no-tooltip 就是这么漏过去的 —— 第一版真漏了，补引号才抓到。
  if (/"tooltip\.anglertackle\.bait_cut_time"/.test(bait)) ok('饵料 tooltip 有减时那一行');
  else no('饵料 tooltip 没有减时那一行（用户要求"同步文本显示"）');
  if (/floatRodAllowed && cut > 0/.test(bait)) ok('饵料只在台钓可用时显示减时');
  else no('饵料 tooltip 没按 floatRodAllowed 门控（路亚专用饵会显示台钓的减时）');

  const rod = code(ROD);
  if (/BiteTiming\.rodCutPercent\(\)/.test(rod)) ok('RodItem 的减时走 BiteTiming（现算，不手抄）');
  else no('RodItem 没读 BiteTiming.rodCutPercent()');
  if (/"tooltip\.anglertackle\.rod_cut_time"/.test(rod)) ok('鱼竿 tooltip 有减时那一行');
  else no('鱼竿 tooltip 没有减时那一行（用户要求"同步文本显示"）');
  if (/if \(type == RodType\.FLOAT\)/.test(rod)) ok('鱼竿只在台钓竿上显示减时');
  else no('RodItem 没按竿型门控（路亚竿会显示一个不存在的 −30%）');

  // 语言键：两个语言文件都要有，且必须带一个 %s 占位、字面 % 已转义成 %%
  for (const [file, label] of [[ZH, '中文'], [EN, '英文']]) {
    let lang;
    try {
      lang = JSON.parse(read(file));
    } catch (e) {
      no(label + '语言文件不是合法 JSON：' + e.message);
      continue;
    }
    for (const key of ['tooltip.anglertackle.bait_cut_time', 'tooltip.anglertackle.rod_cut_time']) {
      const v = lang[key];
      if (typeof v !== 'string') {
        no(label + '语言文件缺少 ' + key + '（界面会显示成键名）');
        continue;
      }
      if (!v.includes('%s')) no(key + '（' + label + '）里没有 %s 占位符，数字显示不出来');
      else if (!/%%/.test(v)) no(key + '（' + label + '）里的字面百分号没写成 %% —— 会被当成格式符，显示成乱码或直接抛异常');
      else ok(key + '（' + label + '）= ' + JSON.stringify(v));
    }
  }
}

// ---------------------------------------------------------------- ⑤ 手册同步
// ⚠ 手册里写的是**加算后的总数**（−35% = 竿 30 + 白饵 5），
//   所以这里用 Config 的值现算，而不是把 35/38/… 再抄一份。
{
  let guide = null;
  try {
    guide = JSON.parse(read(GUIDE));
  } catch (e) {
    no('guide.json 不是合法 JSON：' + e.message);
  }
  if (guide) {
    const lines = [];
    for (const c of guide.chapters) for (const p of c.pages || []) for (const l of p) lines.push(l);
    const text = lines.join('\n');

    const pctText = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const rodCut = VALUE.floatRodCutPercent;
    for (const [tier, cn, en] of TIERS) {
      const total = rodCut + VALUE['baitCut' + en + 'Percent'];
      // 手册里写的是全角减号 −（U+2212），和游戏字体一致
      const want = '\u2212' + pctText(total) + '%';
      if (lines.some((l) => l.includes(want))) {
        ok('手册写了「' + cn + '饵 ' + want + '」（竿 ' + rodCut + ' + 饵 ' + VALUE['baitCut' + en + 'Percent'] + '）');
      } else {
        no('手册里没有「' + cn + '饵 ' + want + '」—— 数值改了手册要一起改'
          + '（竿 ' + rodCut + '% + ' + cn + '饵 ' + VALUE['baitCut' + en + 'Percent'] + '%）');
      }
    }

    const floor = VALUE.floorSeconds;
    if (lines.some((l) => l.includes(floor + ' 秒是地板'))) {
      ok('手册写了「' + floor + ' 秒是地板」（= bite.floorSeconds）');
    } else {
      no('手册里没有「' + floor + ' 秒是地板」—— 下限改了手册要一起改');
    }
    if (text.includes('打了窝最快 ' + floor + ' 秒一条')) {
      ok('手册第二章也写了「打了窝最快 ' + floor + ' 秒一条」');
    } else {
      no('手册第二章没有「打了窝最快 ' + floor + ' 秒一条」（那一页还停在旧数字上）');
    }

    // 基准区间也要对账：手册第二章写的是"路亚竿 10~24 秒"
    const min = cfgDefault('minWaitSeconds');
    const max = cfgDefault('maxWaitSeconds');
    const lo = Number(min), hi = Number(min) + Number(max);
    if (text.includes('路亚竿 ' + lo + '~' + hi + ' 秒')) {
      ok('手册第二章的基准区间「路亚竿 ' + lo + '~' + hi + ' 秒」与 Config 一致');
    } else {
      no('手册里没有「路亚竿 ' + lo + '~' + hi + ' 秒」—— 基准等待改了手册要一起改');
    }
    // 打窝倍率四档（窝料自己的数值，见 ChumEntity）
    for (const [cn2, mult] of [['谷物', 0.75], ['腥味', 0.65], ['甜香', 0.55], ['秘制', 0.45]]) {
      if (text.includes(cn2 + ' ×' + mult)) ok('手册写了打窝倍率「' + cn2 + ' ×' + mult + '」');
      else no('手册里没有「' + cn2 + ' ×' + mult + '」这一档打窝倍率');
    }
  }
}

// ---------------------------------------------------------------- ⑥ 端到端复算
// 用 Config 的默认值把公式重跑一遍（这就是"用户定案"的算术版本）：
//   基础 = min + rand × max
//   实得 = clamp(基础 × (1 − 竿% − 饵%) × 打窝倍率 × (流动 1.3), 下限, 上限)
{
  const min = Number(cfgDefault('minWaitSeconds'));
  const max = Number(cfgDefault('maxWaitSeconds'));
  const cap = Number(cfgDefault('hardCapSeconds'));
  const floor = VALUE.floorSeconds;
  const rodCut = VALUE.floatRodCutPercent;
  const baitCut = (tier) => VALUE['baitCut' + TIERS[tier][2] + 'Percent'];
  const redTotal = rodCut + baitCut(5);

  const raw = (cuts, chum, flowing, r) =>
    (min + r * max) * (1 - Math.min(1, Math.max(0, cuts / 100))) * chum * (flowing ? 1.3 : 1.0);
  const sim = (cuts, chum, flowing, r) => Math.max(floor, Math.min(raw(cuts, chum, flowing, r), cap));
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  // ① 路亚竿完全不受影响
  if (near(sim(0, 1.0, false, 0.5), min + 0.5 * max)) {
    ok('路亚竿：' + (min + 0.5 * max) + ' 秒（与改动前一致，减时为 0）');
  } else {
    no('路亚竿被改到了：期望 ' + (min + 0.5 * max) + '，复算是 ' + sim(0, 1.0, false, 0.5));
  }

  // ② 台钓竿 + 红饵：加算 −51%（连乘会得到 −44.7%，两者差得很明显）
  const addUp = sim(redTotal, 1.0, false, 0.0);
  const multiply = sim(100 * (1 - (1 - rodCut / 100) * (1 - baitCut(5) / 100)), 1.0, false, 0.0);
  if (near(addUp, min * (1 - redTotal / 100))) {
    ok('台钓 + 红饵：最短 ' + addUp.toFixed(1) + ' 秒（加算 ' + redTotal + '%）');
  } else {
    no('台钓 + 红饵的复算对不上加算：得到 ' + addUp.toFixed(3));
  }
  if (!near(addUp, multiply)) {
    ok('加算与连乘结果不同（' + addUp.toFixed(2) + ' vs ' + multiply.toFixed(2) + '）—— 这条断言能抓住"改成连乘"');
  } else {
    no('加算与连乘算出了同一个数，这条断言失去意义（检查器写法要改）');
  }

  // ③ 下限真的在起作用：红饵 + 秘制窝的最短那一杆算到 2.2 秒，被地板抬到 3 秒
  const rawShortest = raw(redTotal, 0.45, false, 0.0);
  if (rawShortest < floor - 1e-6) {
    ok('红饵 + 秘制窝未夹下限时是 ' + rawShortest.toFixed(2) + ' 秒 → 被 ' + floor + ' 秒地板抬住');
  } else {
    no('红饵 + 秘制窝即使不夹下限也不会低于 ' + floor + ' 秒（算出 ' + rawShortest.toFixed(2) + '）'
      + '—— 下限成了摆设，这条断言抓不到"下限被删掉"');
  }
  if (near(sim(redTotal, 0.45, false, 0.0), floor)) {
    ok('用户要的"配合打窝至多 ' + floor + ' 秒一条鱼"成立（最短 ' + floor + ' 秒）');
  } else {
    no('"配合打窝至多 ' + floor + ' 秒一条鱼"不成立：最短是 ' + sim(redTotal, 0.45, false, 0.0).toFixed(2));
  }
  // 最长那一杆不能被地板压平（否则"最多 3 秒"就成了"永远 3 秒"）
  const longest = sim(redTotal, 0.45, false, 1.0);
  if (longest > floor + 0.5) {
    ok('同一套配置的最长一杆是 ' + longest.toFixed(1) + ' 秒（区间没被地板压平）');
  } else {
    no('最长一杆也只有 ' + longest.toFixed(2) + ' 秒 —— 整个区间被下限吃掉了，等待变成了定值');
  }

  // ④ 各档位（不打窝）落在什么区间，打印出来方便核对
  console.log('\n  不打窝时的等待区间（台钓竿，min~max）：');
  for (const [tier, cn, en] of TIERS) {
    const total = rodCut + VALUE['baitCut' + en + 'Percent'];
    console.log('    ' + cn + '饵 −' + (Number.isInteger(total) ? total : total.toFixed(1)) + '%  →  '
      + sim(total, 1.0, false, 0.0).toFixed(1) + '~' + sim(total, 1.0, false, 1.0).toFixed(1) + ' 秒');
  }
  console.log('    （路亚竿 −0%    →  ' + sim(0, 1.0, false, 0.0).toFixed(1) + '~'
    + sim(0, 1.0, false, 1.0).toFixed(1) + ' 秒）');
  console.log('');
}

console.log(bad === 0
  ? '✅ 咬钩减时链完整：数值、加算、台钓限定、下限、tooltip 与手册全部对得上'
  : '❌ 咬钩减时链有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
