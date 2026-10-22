/*
 * gen-fish-table.js —— 把"每条鱼的档位与出没条件"汇成一张表（docs/32）。
 *
 * 为什么要生成而不是手抄：这些数据散在三个真源里，手抄必漂移 ——
 *   · 档位范围 / kg 区间 / 竿型  → src/main/java/.../fishing/FishSpecies.java（注册行）
 *   · 习性词条 / 时段 / 天气 / 月相 → tools/fish-habits.json
 *   · 体长（常见/极限）           → fish_research/<id>.json
 *   · 中文名                     → 语言文件
 * 用户 2026-10-05 要求："把全水域鱼出没和所有鱼各档位详细数据列一列"。
 *
 * 用法：node tools/gen-fish-table.js [--write]      // 不加 --write 只打印
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const WRITE = process.argv.includes('--write');

// ---------------------------------------------------------------- 真源
const speciesSrc = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
const habits = JSON.parse(read('tools/fish-habits.json'));
const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));

// 档位范围常量（W_G = {0,1} …）
const ranges = {};
for (const m of speciesSrc.matchAll(/private static final int\[\] (\w+) = \{([\d,\s]+)\}/g)) {
  ranges[m[1]] = m[2].split(',').map((s) => Number(s.trim()));
}
const TIER_CN = ['白', '绿', '蓝', '紫', '金', '红'];

// 注册行：new FishSpecies("id", ModItems.X, minKg, maxKg, RANGE, profile, RodKind.K)
const fish = [];
for (const m of speciesSrc.matchAll(/new FishSpecies\("([a-z_]+)",\s*ModItems\.(\w+),\s*([\d.]+),\s*([\d.]+),\s*(\w+),([\s\S]{0,200}?RodKind\.(\w+)\))/g)) {
  fish.push({
    id: m[1], constName: m[2], minKg: Number(m[3]), maxKg: Number(m[4]),
    tiers: ranges[m[5]] || [], tierConst: m[5], rods: m[7],
  });
}
if (fish.length < 20) { console.error('❌ 只解析到 ' + fish.length + ' 条鱼 —— 解析器与源码写法脱节'); process.exit(1); }

// 体长
const cm = {};
for (const f of fs.readdirSync(path.join(ROOT, 'fish_research'))) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(read('fish_research/' + f));
  if (!j.id) continue;
  const num = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const a = num(j.typicalLengthCm), b = num(j.giantLengthCm);
  if (a !== null || b !== null) cm[j.id] = [a === null ? b : a, b === null ? (a === null ? null : a) : Math.max(a, b)];
}

// 水体归属：FishWaters.java 里现在是**两张表** ——
//   put("id", M_RIVER | M_LAKE | …)              本体掩码（**0 = 本体哪都不算**，只在修饰水域出现）
//   putMods("id", M_POLAR | M_ALPINE_LAKE | …)   修饰掩码（极地 / 高寒湖 / 冷水溪流）
//
// ⚠ 2026-10-08 修：以前只认 put(...)，而且 WATER_CN 里写的是 M_SEA —— 而代码里的常量叫
//   **M_OCEAN** ⇒ 表格里直接印出 `M_OCEAN/河` 这种常量名；只靠修饰的新鱼（本体 0）
//   则印成 `0` ✗。这种"看着像数据、其实是漏网的常量名"最容易被当成正常内容读过去，
//   所以现在**遇到没登记过的掩码直接抛错**，逼人来补表，而不是静默印出去。
const WATER_CN = { M_RIVER: '河', M_LAKE: '湖', M_SWAMP: '沼', M_OCEAN: '海', M_SEA: '海', M_DEEP: '深海', M_CAVE: '洞' };
const MOD_CN = { M_POLAR: '极地', M_ALPINE_LAKE: '高寒湖', M_COLD_STREAM: '冷水溪流' };
const waters = {};
{
  const src = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishWaters.java');
  const translate = (raw, table, what, id) => raw.split('|').map((s) => s.trim()).filter(Boolean).map((f) => {
    const cn = table[f];
    if (!cn) {
      throw new Error('没登记的水位掩码：' + id + ' 的' + what + '里有 ' + f
        + ' —— 请把它加进 tools/gen-fish-table.js 的 WATER_CN / MOD_CN');
    }
    return cn;
  });
  for (const m of src.matchAll(/\bput\("([a-z_0-9]+)",\s*([^)]+)\)/g)) {
    const raw = m[2].trim();
    waters[m[1]] = raw === '0' ? [] : translate(raw, WATER_CN, '本体掩码', m[1]);
  }
  for (const m of src.matchAll(/\bputMods\("([a-z_0-9]+)",\s*([^)]+)\)/g)) {
    waters[m[1]] = (waters[m[1]] || []).concat(translate(m[2].trim(), MOD_CN, '修饰掩码', m[1]));
  }
}

const TIME_CN = { all: '全天', dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜晚' };
const WEATHER_CN = { all: '任意', clear: '晴', rain: '雨' };
const MOON_CN = { any: '任意', full: '满月', new: '新月' };
const ROD_CN = { FLOAT: '台钓', LURE: '路亚', BOTH: '两者' };
const HABIT_CN = { deep: '深水', bottom: '贴底', surface: '表层', aggressive: '凶猛', timid: '胆小', territorial: '领地' };

// 反查"哪些拟饵认这条鱼"（fish-habits.json 的 lures 表）
const lureOf = {};
for (const [lure, tags] of Object.entries(habits.lures)) {
  for (const [id, f] of Object.entries(habits.fish)) {
    if ((f.habits || []).some((h) => tags.includes(h))) (lureOf[id] = lureOf[id] || []).push(lure);
  }
}

// ---------------------------------------------------------------- 组装
const rows = fish.map((f) => {
  const h = habits.fish[f.id] || {};
  const name = zh['item.anglertackle.' + f.id] || f.id;
  const tierRange = f.tiers.length ? f.tiers : [0];
  const tierTxt = tierRange.length === 1 ? TIER_CN[tierRange[0]]
    : TIER_CN[tierRange[0]] + '~' + TIER_CN[tierRange[tierRange.length - 1]];
  return {
    id: f.id, name, tierTxt, tierNums: tierRange,
    kg: `${f.minKg}–${f.maxKg}`, cm: cm[f.id] ? `${cm[f.id][0]}–${cm[f.id][1]}` : '—',
    rods: ROD_CN[f.rods] || f.rods,
    habits: (h.habits || []).map((x) => HABIT_CN[x] || x).join('·') || '—',
    time: (h.time || []).map((x) => TIME_CN[x] || x).join('/') || '全天',
    weather: (h.weather || []).map((x) => WEATHER_CN[x] || x).join('/') || '任意',
    moon: MOON_CN[h.moon] || h.moon || '任意',
    waters: (waters[f.id] || []).join('/') || '—',
    lures: (lureOf[f.id] || []).length,
  };
});

const line = (r) => `| ${r.name} | \`${r.id}\` | ${r.tierTxt} | ${r.waters} | ${r.kg} | ${r.cm} | ${r.rods} | ${r.habits} | ${r.time} | ${r.weather} | ${r.moon} |`;
const head = '| 鱼 | id | 档位 | 水域 | 体重 kg | 体长 cm | 竿型 | 习性词条 | 时段 | 天气 | 月相 |';
const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
const table = [head, sep, ...rows.map(line)].join('\n');

// ⚠ 2026-10-08：这个变量原来叫 byTier，而下面第 127 行的"按档位带分组"也叫 byTier ——
//   同一个作用域里 `const byTier` 声明两次 ⇒ 运行时 **SyntaxError**，
//   整个 docs/32 生成器**直接跑不起来**（而没有任何检查在跑它 ✗）。
//   现在改成 byTierNums（这是"每个档位各有几条鱼"的统计表，和分组那份不是一回事）。
const byTierNums = {};
for (const r of rows) for (const t of r.tierNums) (byTierNums[t] = byTierNums[t] || []).push(r.name);
const tierSummary = TIER_CN.map((cn, i) =>
  `| ${i} ${cn} | ${(byTierNums[i] || []).length} | ${(byTierNums[i] || []).slice(0, 8).join('、')}${(byTierNums[i] || []).length > 8 ? ' …' : ''} |`).join('\n');

// ---- 四套分组 ----
const layerOf = (r) => ['表层', '深水', '贴底'].find((x) => r.habits.includes(x)) || '无泳层词条';
const tierBandOf = (r) => {
  const lo = Math.min(...r.tierNums);
  return lo <= 1 ? '白绿（新手）' : lo <= 3 ? '蓝紫（进阶）' : '金红（顶级）';
};
const group = (keyFn, order) => {
  const g = {};
  for (const r of rows) { const k = keyFn(r); (g[k] = g[k] || []).push(r); }
  // ⚠ order 里没列到的键要**补在后面**，不能默默丢掉 —— 比如只靠修饰存在的鱼
  //   （"极地"）不在 order 里，以前会被整组丢掉，而文档看着照样完整 ✗。
  const keys = (order ? order.filter((k) => g[k]) : [])
    .concat(Object.keys(g).filter((k) => !order || !order.includes(k)).sort());
  return keys.map((k) => `\n### ${k}（${g[k].length} 种）\n\n` + [head, sep, ...g[k].map(line)].join('\n')).join('\n');
};
const byRod = group((r) => r.rods, ['台钓', '路亚', '两者']);
const byWater = group((r) => (r.waters === '—' ? '未登记' : r.waters), ['河', '湖', '沼', '海', '深海', '洞', '河/湖', '湖/沼', '河/湖/沼', '河/湖/洞', '海/深海', '河/海', '沼/河', '沼/洞', '湖/沼/洞']);
const byLayer = group(layerOf, ['表层', '深水', '贴底', '无泳层词条']);
const byTier = group(tierBandOf, ['白绿（新手）', '蓝紫（进阶）', '金红（顶级）']);

const doc = `# 32 · 鱼类档位与出没总表

> 📌 **开工必读** —— 本文件是《垂纶》策划族的一员。动手前先读 \`docs/CONVENTIONS.md\`（协作规则 + 每轮自我暗示）与 \`docs/接力.md\`（接手须知）；项目记忆只认 \`docs/\` 下的文件。

> ⚠ **本文件由 \`tools/gen-fish-table.js\` 生成，不要手改**（改数据源再跑生成器）。
> 数据真源：\`FishSpecies.java\`（档位范围 / kg 区间 / 竿型）、\`tools/fish-habits.json\`（习性·时段·天气·月相）、
> \`fish_research/<id>.json\`（体长）、语言文件（中文名）。
> 生成命令：\`node tools/gen-fish-table.js --write\`（用户 2026-10-05："把全水域鱼出没和所有鱼各档位详细数据列一列"）

## 1. 档位分布（一条鱼可跨多档，例如"绿蓝"表示它在绿档与蓝档都能出）

| 档位 | 鱼种数 | 鱼 |
|---|---|---|
${tierSummary}

## 2. 全部 ${rows.length} 种鱼

${table}

## 3. 按竿型分（台钓 / 路亚 / 两者）
${byRod}

## 4. 按水域分（一条鱼可属多个水体）
${byWater}

## 5. 按泳层分（由习性词条里的 表层/深水/贴底 决定）
${byLayer}

## 6. 按档位带分（按该鱼**最低**档归带：白绿 / 蓝紫 / 金红）
${byTier}

## 7. 读表须知

- **档位**是"这条鱼能落在哪些品质档"（在体重区间内按 \`tierSplit()\` 采样），
  白=0 绿=1 蓝=2 紫=3 金=4 红=5（\`Quality\` 枚举顺序）。
- **时段**：一天 24000 tick = 现实 20 分钟。清晨 23000→1000、白天 1000→11000、黄昏 11000→13000、夜晚 13000→23000。
- **天气**：雷暴按"雨"命中。**月相**：原版 0=满月、4=新月，其余为中间相（每 8 天各一次）。
- **水域**取自 \`FishWaters.java\`（一条鱼可属多个水体：河/湖/沼/海/深海/洞）。
- **习性词条**决定拟饵的"专攻"：拟饵认的词条命中这条鱼 → 该鱼种咬钩权重 ×1.10（不叠加、不影响金红占比）。
- **体长/体重**：体重是该鱼的采样区间（源码里的规格值）；体长取自 \`fish_research\`（常见~极限）。
`;

console.log(table);
console.log('\n（档位分布见文档 §1）');
if (WRITE) {
  fs.writeFileSync(path.join(ROOT, 'docs/32-鱼类档位与出没总表.md'), doc, 'utf8');
  console.log('✅ 已写出 docs/32-鱼类档位与出没总表.md（' + rows.length + ' 种鱼）');
} else {
  console.log('（预览模式：加 --write 写入 docs/32）');
}
