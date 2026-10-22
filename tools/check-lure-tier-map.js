/*
 * check-lure-tier-map.js —— "档位 → 效果"的映射必须完整、且与注释里的档位名对得上。
 *
 * 为什么单独立这个检查（2026-10-01 用户实测 + 代码复核）：
 *   `FishingSession.targetHighValuePct()` 原来写的是
 *       case 4 -> 3.0;    // 金饵：3%
 *       case 5 -> 10.0;   // 红饵：10%
 *       default -> -1.0;
 *   入参是**拟饵档位（1 起算：1白 2绿 3蓝 4紫 5金 6红）**，而 case 是按 0 起算写的 ——
 *   于是紫饵拿了金饵的数、金饵拿了红饵的数，**红饵（镀金竞技，700 鱼币）落进 default，
 *   一点加成都没有**。同一根源今天还废掉过两个兑换（门槛写成 tier >= 6，永不满足）。
 *
 *   ⚠ 改成 1 起算（4/5/6）之后**又错了另一半**：鱼饵本来就是 0 起算，
 *   于是台钓整条链错一档（活虾=紫 落进 default 没加成、秘制香饵=红 只拿到 4.5%）。
 *   最终方案：`FishingSession.equippedBaitTier()` 作为**唯一汇合点**，
 *   把拟饵的 1 起算值 −1 归一，下游一律只认 **0 起算的品质档（白0…红5）**。
 *   本检查的档位表也跟着改成 0 起算 —— 它守的东西没变：
 *   **case 的编号必须和注释里的档位名对得上，好饵不许倒挂，红档不许靠 default 吃掉。**
 *
 * 判据（读源码，不重算业务逻辑）：
 *   A. `targetHighValuePct` 的 case 编号必须落在 0..5（品质档表），注释里的档位名必须一致；
 *      红档（5）**必须显式有 case**；且不许出现 6（归一之后不存在这一档）。
 *   B. 各档数值必须递增（越好的饵越该提升金红占比）—— 档位与效果不许倒挂。
 *   C. `baitMinTier` 返回的是**鱼品质档位（0 起）**，其 case 编号同样是归一后的品质档，
 *      取值必须落在 0..5。
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 供 tools/negtest.ps1 指向临时副本；不给就是仓库根目录 ✓
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const SESS = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java');

// 品质档表（**0 起算**）—— 与 item/Quality.java 的枚举顺序、与 Q 起算的鱼档位同源
const QUALITY_TIER = { 0: '白', 1: '绿', 2: '蓝', 3: '紫', 4: '金', 5: '红' };
/** 归一之后"红档"就是 5；出现 6 说明旧的 1 起算刻度又长回来了。 */
const RED_TIER = 5;

let bad = 0;
const fail = (m) => { console.error('❌ ' + m); bad++; };

// ⚠ 注释里带着档位名，所以这里**不能**剥注释 —— 要和注释对账
const raw = fs.readFileSync(SESS, 'utf8');

// ---------------------------------------------------------------- A/B
const fn = /public static double targetHighValuePct\(int baitTier\)\s*\{([\s\S]*?)\n    \}/.exec(raw);
if (!fn) {
  fail('FishingSession 里找不到 targetHighValuePct()');
} else {
  const body = fn[1];
  const cases = [];
  for (const m of body.matchAll(/case\s+([\d,\s]+?)\s*->\s*([\d.]+)\s*;([^\n]*)/g)) {
    const tiers = m[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    const val = Number(m[2]);
    const comment = m[3] || '';
    for (const t of tiers) {
      // 注释里如果点了档位名（"紫：2%" 或 "紫饵 2%" 都算），必须与档位表一致
      const zh = comment.match(/(白|绿|蓝|紫|金|红)(?:饵|[：:])/);
      if (QUALITY_TIER[t] === undefined) {
        fail(`targetHighValuePct 的 case ${t} 不在品质档表（0白…5红）里 —— ` +
             `多半是又按拟饵的 1 起算刻度写了（那会让台钓整条链错一档）`);
      } else if (zh && zh[1] !== QUALITY_TIER[t]) {
        fail(`targetHighValuePct 的 case ${t} 注释写"${zh[1]}"，但归一后的品质档里 ${t} 是` +
             `${QUALITY_TIER[t]} —— case 编号与注释对不上（这一处错过两次：` +
             `一次是紫拿金的数、红落 default；一次是台钓整体错一档）`);
      }
      cases.push({ tier: t, val });
    }
  }
  if (!cases.length) { fail('targetHighValuePct 里一个 case 都没解析到'); }
  // 红档必须显式列出
  if (!cases.some((c) => c.tier === RED_TIER)) {
    fail(`targetHighValuePct 缺 case ${RED_TIER}（红档）—— 红饵/红拟饵是 700 鱼币的顶配，` +
         '不许靠 default 吃掉它的加成');
  }
  if (cases.some((c) => c.tier > RED_TIER)) {
    fail('targetHighValuePct 里还有大于 ' + RED_TIER + ' 的 case —— ' +
         '归一之后不存在这一档，它只会让"红档掉进 default"再长回来');
  }
  // 数值必须随档位递增（不许倒挂）
  const sorted = [...cases].sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].val <= sorted[i - 1].val) {
      fail(`金红占比倒挂：档位 ${sorted[i - 1].tier}(${sorted[i - 1].val}%) 不高于 ` +
           `档位 ${sorted[i].tier}(${sorted[i].val}%) —— 越好的饵越该提升金红占比`);
    }
  }
  if (bad === 0) {
    console.log('  ✅ targetHighValuePct：' +
      sorted.map((c) => `${c.tier}${QUALITY_TIER[c.tier]}=${c.val}%`).join('  ') +
      '（0 起算、递增、红档显式）');
  }
}

// ---------------------------------------------------------------- C
const minFn = /public int baitMinTier\(\)\s*\{([\s\S]*?)\n    \}/.exec(raw);
if (!minFn) {
  fail('FishingSession 里找不到 baitMinTier()');
} else {
  const body = minFn[1];
  let checked = 0;
  for (const m of body.matchAll(/case\s+([\d,\s]+?)\s*->\s*(\d+)\s*;([^\n]*)/g)) {
    const tiers = m[1].split(',').map((s) => Number(s.trim()));
    const floor = Number(m[2]);
    for (const t of tiers) {
      checked++;
      if (QUALITY_TIER[t] === undefined) {
        fail(`baitMinTier 的 case ${t} 不在品质档表（0白…5红）里 —— ` +
             `它是归一后的档位，不该出现 6`);
      }
      if (floor < 0 || floor > 5) {
        fail(`baitMinTier 的 case ${t} 返回 ${floor}，但它是**鱼品质档位（0白…5红）**，` +
             `超出范围`);
      }
    }
  }
  if (checked === 0) { fail('baitMinTier 里一个 case 都没解析到'); }
  else if (bad === 0) { console.log(`  ✅ baitMinTier：${checked} 个档位的下限都在鱼品质 0..5 内`); }
}

console.log(bad === 0
  ? '\n✅ 档位映射完整、与注释一致、且随档位递增（统一 0 起算）'
  : `\n档位映射检查：${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
