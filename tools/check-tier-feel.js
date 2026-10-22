/*
 * check-tier-feel.js —— 金/红档**手感**修正（用户 2026-10-05 定案）。
 *
 * 用户原话：
 *   "发现金档和红手感可能没有差距，游速体力都一样。
 *    现有金游速降 16%、体力不变；红移速加 5%、体力加 50%。"
 *
 * ── 为什么要有这个检查器 ────────────────────────────────────
 * 起因是一个**看起来没问题**的结构：FightProfile（手感档案）是**按鱼种**存的，
 * 而档位是**这一条个体**的事。于是同一条鱼抽到金档还是红档，除体重与经济价值外
 * 手感完全一样 —— 不崩、不报错、日志也正常，玩家要连钓几十条才感觉得出来。
 * 底数曲线（1.12^档）本身只把金红拉开 12%，等于没有。
 *
 * 这个检查器守四件事：
 *   ① 四个旋钮就是用户点名的数（0.84 / 1.0 / 1.05 / 1.5），并且**真的把金红拉开**；
 *   ② 修正乘在**唯一**的档位→游速映射（FishSpecies.tierSpeed）上，
 *      不在消费点另乘一次（双重计算会让金档变成 1.32×0.84=1.11，白改）；
 *   ③ 只有 4 / 5 两档被改 —— 白绿蓝紫一字不动（档位 0 起算，见 AGENTS.md §2）；
 *   ④ 体力池按档位修正，而且**档位只算一次**（体力池与挣扎节奏必须同源）。
 *
 * 用法：node tools/check-tier-feel.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const NEGTEST = !!process.env.ATL_ROOT; // 负例副本里可能没有生成物，见下面 Config.java 的处理
const { stripComments } = require('./java-source.js');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 金/红档手感修正检查 ===\n');

// 用户点名的口径。改这几个数 = 改用户定的玩法，必须同时改这里（有意为之的硬编码）。
const WANT = {
  tierGoldSpeedScale: 0.84,
  tierGoldStaminaScale: 1.0,
  tierRedSpeedScale: 1.05,
  tierRedStaminaScale: 1.5,
};

// ---------------------------------------------------------------- ① 旋钮数值
const GEN = 'tools/gen-gameplay-config.js';
if (!exists(GEN)) {
  bad('缺少 ' + GEN + '（玩法配置项的**数据源**；gameplay-config.json 是它导出的）');
} else {
  const src = read(GEN);
  const got = {};
  for (const k of Object.keys(WANT)) {
    const m = src.match(new RegExp("key:\\s*'" + k + "'[^}]*?def:\\s*([0-9.]+)"));
    got[k] = m ? Number(m[1]) : null;
  }
  const wrong = Object.keys(WANT).filter((k) => got[k] !== WANT[k]);
  if (wrong.length) {
    bad('档位手感旋钮与用户口径不符：' +
      wrong.map((k) => k + ' = ' + (got[k] === null ? '未声明' : got[k]) + '（应为 ' + WANT[k] + '）').join('；'));
  } else {
    ok('四个旋钮 = 用户口径：金游速 ×0.84、金体力 ×1.0（不变）、红游速 ×1.05、红体力 ×1.5');
  }

  // ② 把差距真的拉开：底数曲线 × 手感修正之后，红/金 游速比必须 ≥ 35%
  const tierSpeedBase = (() => {
    const m = src.match(/key:\s*'tierSpeedBase'[^}]*?def:\s*([0-9.]+)/);
    return m ? Number(m[1]) : null;
  })();
  if (tierSpeedBase === null) {
    bad('读不到 tierSpeedBase（底数曲线没了？）');
  } else if (got.tierGoldSpeedScale === null || got.tierRedSpeedScale === null) {
    bad('读不到金/红游速旋钮，无法验算金红差距');
  } else {
    const gold = Math.pow(tierSpeedBase, 4) * got.tierGoldSpeedScale;
    const red = Math.pow(tierSpeedBase, 5) * got.tierRedSpeedScale;
    const gap = red / gold - 1;
    const oldGap = tierSpeedBase - 1; // 只靠底数曲线时的差距 = 1.12 − 1 = 12%
    if (gap < 0.35) {
      bad('金红游速差只有 ' + (gap * 100).toFixed(1) + '%（金 ' + gold.toFixed(3) +
        ' / 红 ' + red.toFixed(3) + '）—— 用户要的是"感觉得出差距"，底数曲线本来就只有 ' +
        (oldGap * 100).toFixed(1) + '%');
    } else {
      ok('金 ' + gold.toFixed(3) + ' ×、红 ' + red.toFixed(3) +
        ' × —— 差距 ' + (gap * 100).toFixed(1) + '%（改动前只有 ' + (oldGap * 100).toFixed(1) + '%）');
    }
  }
}

// ---------------------------------------------------------------- ② 落进 Config.java 的默认值
const CFG = 'src/main/java/com/whitecobalt/anglertackle/Config.java';
if (!exists(CFG)) {
  if (NEGTEST) console.log('  ⏳ 负例副本里没有 Config.java，跳过默认值比对');
  else bad('缺少 ' + CFG + '（生成链没跑？）');
} else {
  const cfg = read(CFG);
  const miss = Object.keys(WANT).filter((k) => !cfg.includes(k));
  if (miss.length) bad('Config.java 里没有这些配置项：' + miss.join(', ') + '（生成链只跑了 part/fish？）');
  else ok('Config.java 已生成四个配置项（生成链跑过）');
}

// ---------------------------------------------------------------- ③ FishSpecies：唯一映射 + 只动 4/5 档
const FSP = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';
if (!exists(FSP)) {
  bad('缺少 ' + FSP);
} else {
  const s = stripComments(read(FSP));

  // ③a tierSpeed 必须带手感修正（底数曲线 × 修正）
  const tsBody = (s.match(/static double tierSpeed\(int tier\)\s*\{([^}]*)\}/) || [])[1];
  if (!tsBody) {
    bad('找不到 tierSpeed(int tier) 的方法体');
  } else if (!/Tuning\.tierSpeedBase\(\)/.test(tsBody)) {
    bad('tierSpeed 不再读 Tuning.tierSpeedBase()（底数曲线被拆了）');
  } else if (!/tierFeelSpeedScale\s*\(\s*tier\s*\)/.test(tsBody)) {
    bad('tierSpeed **没有**乘 tierFeelSpeedScale(tier) —— 金红档手感还是和以前一样');
  } else {
    ok('tierSpeed = 底数曲线 × tierFeelSpeedScale(档位)');
  }

  // ③b 两个修正函数的分支：只有 4 / 5 两档，且各读各的旋钮
  const branchOf = (fn) => {
    const m = s.match(new RegExp('static double ' + fn + '\\(int tier\\)\\s*\\{([\\s\\S]*?)\\n    \\}'));
    return m ? m[1] : null;
  };
  const checks = [
    ['tierFeelSpeedScale', 'tierGoldSpeedScale', 'tierRedSpeedScale'],
    ['tierFeelStaminaScale', 'tierGoldStaminaScale', 'tierRedStaminaScale'],
  ];
  for (const [fn, goldKey, redKey] of checks) {
    const body = branchOf(fn);
    if (!body) { bad('找不到 ' + fn + '(int tier)'); continue; }
    const goldRe = new RegExp('if\\s*\\(\\s*tier\\s*==\\s*4\\s*\\)[\\s\\S]*?Tuning\\.' + goldKey + '\\(\\)');
    const redRe = new RegExp('if\\s*\\(\\s*tier\\s*==\\s*5\\s*\\)[\\s\\S]*?Tuning\\.' + redKey + '\\(\\)');
    if (!goldRe.test(body)) {
      bad(fn + ' 里金档分支不是"tier == 4 → Tuning.' + goldKey + '()"（⚠ 档位 0 起算：金=4）');
    } else if (!redRe.test(body)) {
      bad(fn + ' 里红档分支不是"tier == 5 → Tuning.' + redKey + '()"（⚠ 档位 0 起算：红=5）');
    } else {
      const tiers = [...body.matchAll(/tier\s*==\s*(\d)/g)].map((m) => Number(m[1])).sort();
      if (tiers.join(',') !== '4,5') {
        bad(fn + ' 动了不该动的档位：' + tiers.join(',') + '（只许 4 和 5，白绿蓝紫必须原样）');
      } else {
        ok(fn + ' 只对档位 4 / 5 生效，各读自己的旋钮');
      }
    }
  }
}

// ---------------------------------------------------------------- ④ FishingSession：体力池 + 档位只算一次
const SES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java';
if (!exists(SES)) {
  bad('缺少 ' + SES);
} else {
  const s = stripComments(read(SES));

  const assigns = [...s.matchAll(/this\.fishStaminaMax\s*=/g)].length;
  if (assigns !== 1) {
    bad('fishStaminaMax 有 ' + assigns + ' 处赋值 —— 多出来的那处会把档位修正覆盖掉（必须只有组装手感档案这一处）');
  } else if (!/this\.fishStaminaMax\s*=\s*baseStamina\s*\*\s*FishSpecies\.tierFeelStaminaScale\(hookedTier\)/.test(s)
      || !/double\s+baseStamina\s*=\s*FishSpecies\.redStaminaFloor\(hookedTier,\s*rawStamina\)/.test(s)) {
    bad('体力池 ≠ **红档下限抬过的基准** × tierFeelStaminaScale(hookedTier) —— 红档 +50% 或下限没生效');
  } else {
    ok('体力池 = redStaminaFloor(档, 原始基准) × tierFeelStaminaScale(档)，全程只有这一处赋值');
  }

  const decls = [...s.matchAll(/int\s+hookedTier\s*=/g)].length;
  if (decls !== 1) bad('hookedTier 声明了 ' + decls + ' 次（应恰好 1 次）');
  else if (!/this\.fishTier\s*=\s*hookedTier\s*;/.test(s)) {
    bad('this.fishTier 不是复用 hookedTier —— 两处各算一遍的话，体力池与挣扎节奏可能对不上');
  } else {
    ok('档位只算一次：hookedTier 同时喂给体力池与 fishTier（挣扎节奏）');
  }

  // ④b 不许在消费点再乘一次（双层修正）
  if (/this\.tierSpeed\s*=[^;]*tierFeelSpeedScale/.test(s)) {
    bad('tierSpeed 在 FishingSession 里又乘了一次 tierFeelSpeedScale —— 金档会变成 1.32×0.84 = 1.11');
  } else if (/this\.fishStaminaMax\s*=[^;]*tierFeelStaminaScale[^;]*tierFeelStaminaScale/.test(s)) {
    bad('tierFeelStaminaScale 被乘了两次');
  } else {
    ok('消费点没有重复乘修正（无双重计算）');
  }
}

// ---------------------------------------------------------------- ⑤ 红档体力基准下限
// 用户 2026-10-06："有些红鱼似乎体力基准连 200 都没到。" → 定案"给所有红档鱼设体力池下限：基准至少 200"。
//
// 事实（这个检查器自己从源码里数出来，不靠人记）：能出红档的 12 种鱼里有三种基准不到 200 ——
// 蓝宝石雷龙鱼 130（台钓**唯一**的红鱼，且体重区间 100% 是红档）、虎鱼 120、孔雀鱼 60。
// 而"遛多久"看的是 体力池 ÷ tierStaminaResist：雷龙红档 (130×1.5)÷2.29 ≈ 85，
// 比一条普通草鱼（蓝档 220÷1.39 ≈ 158）还软 —— 红档只剩个名头。
//
// 守三件事：旋钮数值、只对红档生效、以及"至少真有一条红档鱼低于下限"（否则下限是装饰）。
const FLOOR_KEY = 'tierRedStaminaMin';
const FLOOR_WANT = 200;
{
  const genSrc = exists(GEN) ? read(GEN) : '';
  const m = genSrc.match(new RegExp("key:\\s*'" + FLOOR_KEY + "'[^}]*?def:\\s*([0-9.]+)"));
  const got = m ? Number(m[1]) : null;
  if (got !== FLOOR_WANT) {
    bad('红档体力下限 ' + FLOOR_KEY + ' = ' + (got === null ? '未声明' : got) + '（应为 ' + FLOOR_WANT + '）');
  } else {
    ok('红档体力基准下限 = ' + FLOOR_WANT + '（调参器可热改）');
  }

  // FishSpecies.redStaminaFloor：只对 tier == 5 生效，且是 Math.max(base, 下限)
  const floorBody = (stripComments(read(FSP)).match(
    /static double redStaminaFloor\(int tier, double baseStamina\)\s*\{([\s\S]*?)\n    \}/) || [])[1];
  if (!floorBody) {
    bad('找不到 FishSpecies.redStaminaFloor(int, double)');
  } else if (!/if\s*\(\s*tier\s*!=\s*5\s*\)\s*\{\s*return baseStamina;/.test(floorBody)) {
    bad('redStaminaFloor 没有"非红档原样返回"—— 会把金档/低档鱼一起抬高');
  } else if (!/Math\.max\(baseStamina,\s*Tuning\.tierRedStaminaMin\(\)\)/.test(floorBody)) {
    bad('redStaminaFloor 不是 max(基准, Tuning.tierRedStaminaMin())');
  } else {
    ok('redStaminaFloor：只对红档抬到 max(基准, 下限)，其余档位原样返回');
  }

  // 数据面：从源码里数出"能出红档"的鱼和它们的基准体力
  const tierArrays = {};
  for (const mm of stripComments(read(FSP)).matchAll(/int\[\]\s+(\w+)\s*=\s*\{([\d,\s]+)\}/g)) {
    tierArrays[mm[1]] = mm[2].split(',').map((x) => Number(x.trim()));
  }
  const species = [...stripComments(read(FSP)).matchAll(
    /new FishSpecies\(\s*"(\w+)",[\s\S]{0,60}?,\s*([\d.]+),\s*([\d.]+),\s*(\w+),\s*(?:steady|sluggish|burst|erratic)\(\s*([\d.]+)\s*,\s*([\d.]+)/g)]
    .map((mm) => ({
      id: mm[1], minKg: Number(mm[2]), maxKg: Number(mm[3]), tiers: tierArrays[mm[4]],
      pull: Number(mm[5]), stamina: Number(mm[6]),
    }));
  if (species.length < 25) {
    bad('只解析出 ' + species.length + ' 条鱼（应 28 条）—— 这个检查器的正则要更新');
  } else {
    const red = species.filter((s) => Array.isArray(s.tiers) && s.tiers.includes(5));
    const low = red.filter((s) => s.stamina < FLOOR_WANT);
    if (!red.length) {
      bad('一条能出红档的鱼都没解析出来 —— 档位数组解析坏了');
    } else if (!low.length) {
      bad('没有一条红档鱼的基准低于下限 ' + FLOOR_WANT
        + ' —— 这条下限现在没有作用对象了，要么删掉它，要么确认鱼种数值被改过');
    } else {
      ok('能出红档的 ' + red.length + ' 种鱼里，有 ' + low.length + ' 种基准低于下限：'
        + low.map((s) => s.id + ' ' + s.stamina).join('、'));
    }
    // 抬过之后，红档实际池子 = max(基准, 下限) × 1.5，且必须 ≥ 下限 × 倍率
    const RED_SCALE = WANT.tierRedStaminaScale;
    const short = red.filter((s) => Math.max(s.stamina, FLOOR_WANT) * RED_SCALE < FLOOR_WANT * RED_SCALE - 1e-9);
    if (short.length) bad('这些红档鱼抬过下限后仍然低于 ' + (FLOOR_WANT * RED_SCALE) + '：'
      + short.map((s) => s.id).join('、'));
    else ok('全部 ' + red.length + ' 种红档鱼的实际体力池都 ≥ ' + (FLOOR_WANT * RED_SCALE)
      + '（下限 × 红档倍率）');
    // 金档不受影响：虎鱼这类"够得到红档但基准低"的鱼，金档时还是原值
    const goldExample = low.find((s) => Array.isArray(s.tiers) && s.tiers.includes(4));
    if (goldExample) {
      ok('同一批鱼的金档不受影响（例：' + goldExample.id + ' 金档仍是基准 '
        + goldExample.stamina + ' × ' + WANT.tierGoldStaminaScale + '）');
    }
  }
}

console.log('');
if (fail === 0) {
  console.log('✅ 金/红档手感修正检查通过：金游速 ×0.84、金体力不变、红游速 ×1.05、红体力 ×1.5，');
  console.log('   修正只落在档位 4/5，白绿蓝紫不动，体力池与挣扎节奏同源');
} else {
  console.log('❌ 金/红档手感修正检查失败：' + fail + ' 项');
}
process.exitCode = fail === 0 ? 0 : 1;
