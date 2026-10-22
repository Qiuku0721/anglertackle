const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 鱼种表的**唯一**解析口径（供 gen-fish-config.js 与各校验脚本共用）。
//
// ── 为什么单独一个模块 ───────────────────────────────────────
// 配件那边踩过一次：两个脚本各自用正则解析同一份源码，规则不同 → 整体错位，
// 每个物品拿到前一个的数值，而"默认值比对"因为两边同源而恒等通过。
// 鱼这边同样是"读源码字面量 → 生成配置 → 再按配置读回来"，风险一模一样，
// 所以从一开始就共用一份解析。
//
// 解析对象是 FishSpecies.java 里的：
//     new FishSpecies("id", ModItems.XXX, 0.10, 1.20, W_G,
//             steady(0.80, 90, 0.95), RodKind.FLOAT),
// 以及四种策略构造函数里的常量（steady/sluggish/burst/erratic）。
const fs = require('fs');
const path = require('path');

/** 四种策略构造函数里写死的参数（与 FishSpecies 里的实现一一对应）。 */
const ARCHETYPE_FIXED = {
  steady:   { sprintDurationSec: 0.8, sprintIntervalSec: 4.5, turnIntervalSec: 3.5,
              fakeOutChance: 0.0,  fatigueThreshold: 0.30, fatigueDurationSec: 2.0, staminaRegen: 0.02 },
  sluggish: { sprintDurationSec: 0.4, sprintIntervalSec: 8.0, turnIntervalSec: 5.5,
              fakeOutChance: 0.0,  fatigueThreshold: 0.28, fatigueDurationSec: 2.6, staminaRegen: 0.015 },
  burst:    { sprintDurationSec: 1.6, sprintIntervalSec: 2.6, turnIntervalSec: 3.0,
              fakeOutChance: 0.10, fatigueThreshold: 0.34, fatigueDurationSec: 2.4, staminaRegen: 0.02 },
  erratic:  { sprintDurationSec: 0.9, sprintIntervalSec: 3.0, turnIntervalSec: 1.3,
              fakeOutChance: 0.35, fatigueThreshold: 0.32, fatigueDurationSec: 2.0, staminaRegen: 0.02 },
};

/**
 * 疲劳期游速倍率（每条鱼的 fatiguedPullSpeed = 正常拉力 × 本值）。
 *
 * <p>⚠ 2026-10-07 修正：以前这里是**硬编码 0.5**，而 gameplay 里的
 * {@code fatiguePullMultiplier} 是另一个数（当时被调成 0.85）—— 两者不一致，
 * 结果"调那个旋钮"根本不影响力竭期拉力（配置项一旦存在，Java 侧的兜底值就被盖掉）。
 * 现在直接读配置默认值，**结构上不可能再漂移**；读不到（首次生成、Config.java
 * 还没有玩法块）就退回 0.5。
 */
let FATIGUE_PULL = 0.42;

// ⚠⚠ 2026-10-17：**不能**再读 Config.java 的默认值（原来那条路）——
//   闸里的生成顺序是 part → fish → gameplay（见 tools/build-deploy.ps1），
//   而 gen-part-config 会先把「玩法」生成区**整块剥掉**再重写别的块。
//   于是跑 gen-fish-config 时 Config.java 里根本没有 gameplay.fatiguePullMultiplier，
//   tuning.js 读不到 ⇒ 静默退回兜底值 ⇒ 疲劳期拉力被算成**旧的**倍率。
//   （注释原来写着"结构上不可能再漂移"，实际上链条顺序就把它漂了。）
//   ⇒ 直接读**生成器里的声明表**：那是这个数的唯一真源，且与链条顺序无关。
{
  const own = fs.readFileSync(path.join(__dirname, 'gen-gameplay-config.js'), 'utf8');
  // ⚠ 这个正则要**带反斜杠**（`\s` → `\\s` 写进文件才是一次转义）：
  //   上一次用 heredoc 生成时被吃成了 `s*`，于是永远匹配不到、静默走兜底值。
  const m = /key:\s*'fatiguePullMultiplier'[^}]*?def:\s*([0-9.]+)/.exec(own);
  if (m) FATIGUE_PULL = parseFloat(m[1]);
  else console.warn('⚠ 读不到 gen-gameplay-config.js 里的 fatiguePullMultiplier 默认值，沿用 ' + FATIGUE_PULL);
}

/** 每个鱼种可调的数值字段，以及配置项/中文标签/范围。 */
const FIELDS = [
  { key: 'minKg',              cn: '体重下限',       unit: 'kg',   min: 0.001, max: 500,   decimals: 3 },
  { key: 'maxKg',              cn: '体重上限',       unit: 'kg',   min: 0.001, max: 500,   decimals: 3 },
  { key: 'pullSpeed',          cn: '拉力（不挣扎）', unit: '',     min: 0,     max: 20,    decimals: 3 },
  { key: 'fatiguedPullSpeed',  cn: '拉力（疲劳期）', unit: '',     min: 0,     max: 20,    decimals: 3 },
  { key: 'stamina',            cn: '体力上限',       unit: '',     min: 1,     max: 5000,  decimals: 1 },
  { key: 'tensionGain',        cn: '张力涨速',       unit: '',     min: 0,     max: 5,     decimals: 3 },
  { key: 'sprintDurationSec',  cn: '冲刺时长',       unit: '秒',   min: 0,     max: 60,    decimals: 2 },
  { key: 'sprintIntervalSec',  cn: '冲刺间隔',       unit: '秒',   min: 0.1,   max: 60,    decimals: 2 },
  { key: 'turnIntervalSec',    cn: '变向间隔',       unit: '秒',   min: 0.2,   max: 60,    decimals: 2 },
  { key: 'fakeOutChance',      cn: '假动作概率',     unit: '0~1',  min: 0,     max: 1,     decimals: 3 },
  { key: 'fatigueThreshold',   cn: '进疲劳的体力比例', unit: '0~1', min: 0.01, max: 1,     decimals: 3 },
  { key: 'fatigueDurationSec', cn: '疲劳持续',       unit: '秒',   min: 0,     max: 120,   decimals: 2 },
  { key: 'staminaRegen',       cn: '不挣扎时回气',   unit: '/s',   min: 0,     max: 1,     decimals: 4 },
];

/** 每个字段的中文作用说明 —— 调参器直接显示这段。 */
const DESC = {
  minKg: '这种鱼最小能有多重。⚠ 它和体重上限一起决定档位怎么分——改小了会让低档鱼变少',
  maxKg: '这种鱼最大能有多重。线长/承重不够时会钓不上来（见 buildPool 的承重过滤）',
  pullSpeed: '挣扎时把线拽出去的速度。越大越拉不动。这是「上钩两秒就能感觉出多大」的主要来源'
    + '。⚠ 这是**基准值**：实际游速 = 本值 × 档位曲线 1.12^档 × 金/红手感修正（金 ×0.84、红 ×1.05）',
  fatiguedPullSpeed: '遛到疲劳后的拉拽速度。默认 = 正常拉力 × gameplay.fatiguePullMultiplier（当前 '
    + FATIGUE_PULL + '）'
    + '—— 改大就等于「疲劳期反而不划算」',
  stamina: '鱼有多少体力。越大越耐磨，要遛更久。它是「持久战」强度的总开关'
    + '。⚠ 这是**基准值**（按鱼种）：实际体力池 = 本值 × 档位倍率（金档 ×1.0、红档 ×1.5）。'
    + '红档还有一条**基准下限**（gameplay.tierRedStaminaMin，默认 200）：基准低于它的红档鱼先被抬到下限，'
    + '再乘倍率 —— 否则台钓唯一的红鱼（蓝宝石雷龙鱼 130）比一条普通草鱼还好遛。'
    + '咬钩时日志里会打一行「体力池：X = 基准 Y × 档位倍率 Z」——对账看那一行，别看这里的基准',
  tensionGain: '这条鱼让线涨得多快。>1 = 线黄得快（黏液型鱼的味道），<1 = 宽容',
  sprintDurationSec: '每次冲刺持续几秒。0 = 这条鱼不冲刺',
  sprintIntervalSec: '每隔几秒冲一次。越小越凶（爆发型 2.6，黏液型 8.0 几乎不冲）',
  turnIntervalSec: '每隔几秒变一次向。越小越神经质（神经质型 1.3，黏液型 5.5 方向很稳）',
  fakeOutChance: '假动作概率：预告一个方向、实际往反方向跑。0~1（神经质型 0.35）',
  fatigueThreshold: '体力降到这个比例以下就进疲劳期（0.3 = 剩 30% 时）',
  fatigueDurationSec: '疲劳期持续几秒。这段时间是反拉的最佳窗口',
  staminaRegen: '不挣扎时每秒回多少体力（会被渔轮阻尼压制）。越大越难遛翻',
};

/** 鱼种中文名（从 lang 文件读，读不到就退回 id）。 */
let zhNames = null;
function loadNames() {
  if (zhNames) return zhNames;
  zhNames = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ATL_ROOT,
      'src/main/resources/assets/anglertackle/lang/zh_cn.json'), 'utf8'));
    for (const [k, v] of Object.entries(j)) {
      const m = /^item\.anglertackle\.(.+)$/.exec(k);
      if (m) zhNames[m[1]] = v;
    }
  } catch (e) { /* 读不到就退回 id */ }
  return zhNames;
}

/** 按括号配对取顶层逗号分隔的参数。`start` 必须指向左括号**之后**第一个字符。 */
function splitArgs(text, start) {
  const out = [];
  let depth = 0, cur = '';
  for (let p = start; p < text.length; p++) {
    const ch = text[p];
    // 注释在括号配对之前就要处理掉：注释里的括号和逗号会带偏计数
    if (ch === '/' && text[p + 1] === '/') {
      while (p < text.length && text[p] !== '\n') p++;
      cur += ' ';
      continue;
    }
    if (ch === '/' && text[p + 1] === '*') {
      p += 2;
      while (p < text.length && !(text[p] === '*' && text[p + 1] === '/')) p++;
      p++;
      cur += ' ';
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) { out.push(cur.trim()); return out.filter((s) => s !== ''); }
      depth--;
    } else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  throw new Error('参数括号没配对（偏移 ' + start + '）');
}

function evalNum(id, what, raw) {
  const t = String(raw).trim();
  if (!/^[-+*/(). 0-9]+$/.test(t)) {
    throw new Error(id + ' 的 ' + what + ' 不是数字字面量：' + t);
  }
  const v = Function('"use strict";return (' + t + ')')();
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(id + ' 的 ' + what + ' 求值失败：' + t);
  }
  return v;
}

/** 解析 FishSpecies.java，返回按文件出现顺序排列的鱼种。 */
function parseFish(src) {
  const names = loadNames();
  const fish = [];

  // 从 `new FishSpecies(` 的**开括号之后**开始解析，不要从正则匹配末尾开始 ——
  // 参数是 7 个：id、物品、体重下限、体重上限、档位表、手感档案、竿型。
  // （一开始按 6 个写，忘了 id 也算一个。解析器一律报"参数个数不符"而不是
  //   将错就错，所以这里立刻暴露了。）
  const re = /new FishSpecies\(/g;
  let m;
  while ((m = re.exec(src))) {
    const from = m.index + m[0].length;
    const idM = /^\s*"([a-z_0-9]+)"\s*,/.exec(src.slice(from));
    if (!idM) continue;   // 不是鱼种定义（比如别处的调用）
    const id = idM[1];
    const args = splitArgs(src, from);
    if (args.length !== 7) {
      throw new Error(id + ' 的 FishSpecies 参数有 ' + args.length + ' 个，预期 7 个' +
                      '（id / 物品 / 下限 / 上限 / 档位表 / 手感档案 / 竿型）');
    }
    const [, item, minKgRaw, maxKgRaw, tiersRaw, profileRaw, rodsRaw] = args;
    const rods = /RodKind\.(\w+)/.exec(rodsRaw);
    if (!rods) throw new Error(id + ' 的竿型解析失败：' + rodsRaw);

    // 手感档案：四种策略函数之一，或者具名常量（鲫鱼用 FightProfile.CRUCIAN_CARP）
    let archetype, pull, stamina, tensionGain, fixed, explicitFatigueRatio = null;
    const helper = /^(steady|sluggish|burst|erratic)\(\s*([^)]*)\)$/.exec(profileRaw.replace(/\s+/g, ' '));
    const named = /FightProfile\.(\w+)/.exec(profileRaw);
    if (helper) {
      const kind = helper[1];
      // splitArgs 的约定是"左括号**之后**的位置"，所以要 +1。
      // 传左括号本身会立刻报"括号没配对"（踩过一次）。
      const a = splitArgs(profileRaw, profileRaw.indexOf('(') + 1);
      // 3 参 = 用全局 fatiguePullMultiplier；4 参 = 该鱼**显式**的疲劳比值
      // （2026-10-17：鲻鱼/鲯鳅这两条是玩家单独调过的，比值与全局不同）
      if (a.length !== 3 && a.length !== 4) {
        throw new Error(id + ' 的 ' + kind + '() 参数有 ' + a.length + ' 个，预期 3 或 4 个');
      }
      archetype = kind.toUpperCase();
      pull = evalNum(id, '拉力', a[0]);
      stamina = evalNum(id, '体力', a[1]);
      tensionGain = evalNum(id, '张力系数', a[2]);
      explicitFatigueRatio = a.length === 4 ? evalNum(id, '疲劳比值', a[3]) : null;
      fixed = ARCHETYPE_FIXED[kind];
    } else if (named) {
      // 具名常量目前只有 CRUCIAN_CARP，数值写在 FightProfile.java 里。
      // 这里**不去猜**：直接把它的数值读出来，读不到就报错让人来看。
      const c = readNamedProfile(named[1]);
      if (!c) {
        throw new Error(id + ' 用的是 FightProfile.' + named[1] + '，但读不到它的数值 —— ' +
                        '请在 tools/fish-source.js 的 readNamedProfile 里补上');
      }
      archetype = c.archetype;
      pull = c.pullSpeed;
      stamina = c.stamina;
      tensionGain = c.tensionGain;
      fixed = c.fixed;
    } else {
      throw new Error(id + ' 的手感档案无法解析：' + profileRaw);
    }

    fish.push({
      id,
      name: names[id] || id,
      item,
      minKg: evalNum(id, '体重下限', minKgRaw),
      maxKg: evalNum(id, '体重上限', maxKgRaw),
      tiers: tiersRaw.trim(),
      rods: rods[1],
      archetype,
      /** 13 个可调数值，键与 FIELDS 一致 */
      values: {
        minKg: evalNum(id, '体重下限', minKgRaw),
        maxKg: evalNum(id, '体重上限', maxKgRaw),
        pullSpeed: pull,
        fatiguedPullSpeed: pull * (explicitFatigueRatio === null ? FATIGUE_PULL : explicitFatigueRatio),
        stamina,
        tensionGain,
        ...fixed,
      },
    });
  }
  return fish;
}

/** 从 FightProfile.java 里读具名档案的数值。 */
function readNamedProfile(name) {
  const p = path.join(ATL_ROOT,
    'src/main/java/com/whitecobalt/anglertackle/fishing/FightProfile.java');
  let src;
  try { src = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
  const m = new RegExp('FightProfile\\s+' + name + '\\s*=\\s*new FightProfile\\(').exec(src);
  if (!m) return null;
  const args = splitArgs(src, m.index + m[0].length);
  if (args.length !== 12) return null;
  const num = (i) => evalNum(name, '参数 ' + i, args[i].replace(/FATIGUE_PULL/g, String(FATIGUE_PULL)));
  return {
    archetype: (/Archetype\.(\w+)/.exec(args[0]) || [, 'STEADY'])[1],
    pullSpeed: num(1),
    stamina: num(8),
    tensionGain: num(7),
    fixed: {
      sprintDurationSec: num(3),
      sprintIntervalSec: num(4),
      turnIntervalSec: num(5),
      fakeOutChance: num(6),
      fatigueThreshold: num(9),
      fatigueDurationSec: num(10),
      staminaRegen: num(11),
    },
  };
}

module.exports = { parseFish, FIELDS, DESC, FATIGUE_PULL, ARCHETYPE_FIXED };
