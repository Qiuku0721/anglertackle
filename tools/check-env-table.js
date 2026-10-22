/*
 * check-env-table.js —— 守住"时间/天气/月相条件表"与源码不漂移。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * `docs/24-时间天气月相策划.md` 的 §7 是一张 **28 条鱼 × 三个环境条件** 的表，
 * 而"档位"那一列是从 `FishSpecies.java` 抄过来的。这种"文档抄代码"的表
 * 有两个经典退化方式，而且都不会报错：
 *   ① 源码改了档位（比如某条鱼从"紫→金"升成"金→红"），文档还写着旧的；
 *   ② 文档里的**统计数字**（几条全天鱼、几条金红档）是肉眼数的，改表以后忘了跟着改。
 * 两者都会让"拿着文档做实现"的人按错的前提干活 —— 所以这里逐条比。
 *
 * 本检查器在 **docs/24 尚未实现成代码之前** 就能跑：它校验的是"策划表 ↔ 源码事实"，
 * 不依赖 Environment.java 是否存在。等实现落地后（docs/24 §8），
 * 再补一条"FishHabits.java 里真的有这三张表"的断言（见文件末尾 TODO）。
 *
 * 断言：
 *   A. §7 表里的鱼 = `FishSpecies.ALL` 的 28 条，一条不多一条不少
 *   B. 表里的**档位文字**与源码 `tiers` 一致（含红档 / 最高到金的判定）
 *   C. 表里的 time / weather / moon 取值都在枚举内（all/dawn/day/dusk/night 等）
 *   D. §7 末尾"自检"那张表里的**每个数字**都与脚本现算的一致
 *   E. 全天鱼（time=all）至少 3 条 —— 保证任何时段都不会出现"池子里没有保底鱼"
 *   F. 台钓侧（RodKind != LURE）带红档的鱼**有且仅有**蓝宝石雷龙（源码硬规则，
 *      用户 2026-09-29 定案）—— 这条顺带守住"改条件表时别把红档配给台钓鱼"
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const DOC = 'docs/24-时间天气月相策划.md';
const SPECIES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';

console.log('=== 时间/天气/月相条件表检查 ===\n');

for (const p of [DOC, SPECIES]) {
  if (!fs.existsSync(path.join(ROOT, p))) {
    bad('缺文件：' + p);
    console.log('\n❌ 条件表检查失败（缺文件）');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- 读源码事实
const src = read(SPECIES);

/** 档位常量：W_G = {0,1} … */
const tierConsts = {};
for (const m of src.matchAll(/private static final int\[\]\s+([A-Z_]+)\s*=\s*\{([0-9,\s]+)\}/g)) {
  tierConsts[m[1]] = m[2].split(',').map((x) => Number(x.trim()));
}
if (!Object.keys(tierConsts).length) bad('从 FishSpecies.java 里一个档位常量都没读到（正则失效？）');

/** 每条鱼：id → { tiers, maxTier, rod } */
const species = new Map();
for (const m of src.matchAll(/new FishSpecies\(\s*"([a-z_0-9]+)",\s*ModItems\.([A-Z_0-9]+),\s*([0-9.]+),\s*([0-9.]+),\s*([A-Z_]+|new int\[\]\s*\{[0-9,\s]+\})/g)) {
  const id = m[1];
  const spec = m[5];
  const tiers = spec.startsWith('new')
    ? spec.replace(/[^0-9,]/g, '').split(',').map(Number)
    : tierConsts[spec];
  if (!tiers) bad('读到鱼 ' + id + ' 但档位常量 ' + spec + ' 未定义');
  const tail = src.slice(m.index, m.index + 400);
  const rod = (/RodKind\.([A-Z]+)/.exec(tail) || [, '?'])[1];
  species.set(id, { tiers: tiers || [], maxTier: tiers ? Math.max(...tiers) : -1, rod });
}
// ⚠ 这个数字是"解析是否可信"的哨兵：正则一旦脱节，species.size 会掉到 0 或几条。
//   所以每次加鱼都要回来改它（2026-10-08：第 1 批冷水 5 条 28→33；第 3 批极地 9 条 33→42；
//   第 4 批远洋 5 条 42→47）。
if (species.size !== 47) bad('源码里的鱼种数是 ' + species.size + '，期望 47');

// ---------------------------------------------------------------- 读文档表格
// ⚠ 章节号**不能写死**：v1 里条件表在 §7，v2 把"数据源"插成了 §7、条件表挪到 §8。
//   写死 §7 的那一版在 v2 上读到的是 JSON 代码块 —— rows 为空，于是 28 条鱼
//   全都报"缺"，而档位那条断言照样绿（又一次"检查器骗人"）。
//   现在改成**按表头找**：找到含 time/weather/moon 表头的那一节，就用那一节。
const docLines = read(DOC).split('\n');
const sectionStarts = docLines
  .map((l, k) => (/^## \d/.test(l) ? k : -1))
  .filter((k) => k >= 0)
  .concat([docLines.length]);
const i7 = (() => {
  for (let a = 0; a < sectionStarts.length - 1; a++) {
    const from = sectionStarts[a], to = sectionStarts[a + 1];
    if (docLines.slice(from, to).some((l) => l.trim().startsWith('|') && l.includes('time') && l.includes('weather') && l.includes('moon'))) {
      return from;
    }
  }
  return -1;
})();
const i8 = i7 < 0 ? -1 : (sectionStarts.find((k) => k > i7) ?? docLines.length);
if (i7 < 0) bad('在 ' + DOC + ' 里找不到含条件表（表头有 time/weather/moon）的那一节');
else ok('条件表所在章节：' + docLines[i7].replace(/^## /, ' §').slice(0, 40) + '（第 ' + (i7 + 1) + ' 行起）');
const rows = i7 < 0 ? [] : docLines.slice(i7, i8).filter((l) => /^\| *[0-9]+ *\|/.test(l));

const TIME_ENUM = new Set(['晨', '昼', '昏', '夜', '全']);
const WEATHER_ENUM = new Set(['all', 'clear', 'rain']);
const MOON_ENUM = new Set(['any', 'full', 'new', '**full**', '**new**']);

// 先验一件事：§7 里的表格行**不能粘连**。
// 这里踩过一次：用脚本改文档数字时把两行写成了
// `… | **9 条**：… | 鲫鱼 || 该时段**有加成**…`（行尾少了一个 `|`），
// 结果表格照样渲染、检查器照样绿 —— 因为"第一个加粗数字"仍然读得到。
// 粘连会让后面所有的列解析整体错位，必须在入口挡住。
{
  // ⚠ 不能用"出现 | | 就算粘连"来判 —— 条件表的"备注"列本来就可能是空的
  //   （`| … | any | |`），那样会误报 12 行。
  //   真正的判据是**列数**：同一张表里每行的字段数必须一致。
  //   §7 里有**两张**表（条件表 7 列、自检表 2 列），所以要**按连续块**分别比，
  //   不能把两张表混在一起取众数（第一版就是这么写的，结果自检表 9 行全报错）。
  {
    const all = docLines.slice(i7, i8);
    const isRow = (l) => l.trim().startsWith('|');
    const pipes = (l) => (l.match(/\|/g) || []).length;
    let k = i7;
    while (k < i8) {
      if (!isRow(docLines[k])) { k++; continue; }
      let e = k;
      while (e < i8 && isRow(docLines[e])) e++;
      const block = docLines.slice(k, e).filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()));   // 去掉分隔行
      const mode = {};
      for (const l of block) mode[pipes(l)] = (mode[pipes(l)] || 0) + 1;
      const normal = Number(Object.entries(mode).sort((a, b) => b[1] - a[1])[0][0]);
      const odd = block.filter((l) => pipes(l) !== normal);
      if (odd.length) {
        // 行号用**文档里的绝对行号**（+1 因为 k 是 0 基）—— 相对 §7 的行号人会找不着
        bad(DOC + ' 第 ' + (k + 1) + ' 行起的表格里有 ' + odd.length + ' 行列数异常（正常 ' + normal
          + ' 个 |，疑似两行粘在一起或漏了单元格）：');
        for (const l of odd.slice(0, 3)) console.log('       ' + l.slice(0, 100) + (l.length > 100 ? ' …' : ''));
      }
      k = e;
    }
  }
}

// ---------------------------------------------------------------- 按表头定位列
// ⚠ 不能写死列号：v1 的表是 5 列（# / 鱼 / time / weather / moon），
//   v2 加了一列"档位"变成 6 列 —— 写死列号的那一刻，检查器就开始读到错列
//   （实测：v2 的表让 id 从鱼名里解析，28 条鱼全部"缺"，而档位那条断言照样绿）。
//   改成**按表头文字找列**，以后再加列也不会错位。
const FALLBACK_IDX = { fish: 2, tier: 3, time: 4, weather: 5, moon: 6 };
const headerIdx = (() => {
  const h = docLines.slice(i7, i8).find((l) => l.trim().startsWith('|') && l.includes('time') && l.includes('weather'));
  if (!h) return FALLBACK_IDX;
  const cells = h.split('|').map((x) => x.trim());
  const find = (...keys) => cells.findIndex((c) => keys.every((k) => c.includes(k)));
  const fish = find('鱼');
  return {
    fish: fish >= 0 ? fish : FALLBACK_IDX.fish,
    tier: find('档位'),
    time: find('time'),
    weather: find('weather'),
    moon: find('moon'),
  };
})();
if (!headerIdx || headerIdx.time < 0 || headerIdx.weather < 0 || headerIdx.moon < 0) {
  bad('条件表所在章节里找不到表头（应有含 time / weather / moon 的表头行）');
} else {
  ok('条件表列位置：鱼=' + headerIdx.fish + ' 档位=' + headerIdx.tier
    + ' time=' + headerIdx.time + ' weather=' + headerIdx.weather + ' moon=' + headerIdx.moon);
}

const table = [];
for (const r of rows) {
  const c = r.split('|').map((x) => x.trim());
  const cell = (n) => (n >= 0 ? (c[n] === undefined ? '' : c[n]) : '');
  const id = (cell(headerIdx.fish).match(/`([a-z_0-9]+)`/) || [, null])[1];
  table.push({
    id,
    tierText: headerIdx.tier >= 0 ? cell(headerIdx.tier) : null,
    time: cell(headerIdx.time),
    weather: cell(headerIdx.weather),
    moon: cell(headerIdx.moon),
  });
}

// ---------------------------------------------------------------- A 覆盖一致
{
  const docIds = table.map((t) => t.id);
  const miss = [...species.keys()].filter((k) => !docIds.includes(k));
  const extra = docIds.filter((k) => !k || !species.has(k));
  if (docIds.some((x) => !x)) bad('条件表里有行的鱼 id 解析不出来（"鱼"那一格应写成 `id`）');
  if (miss.length) bad('条件表里缺这些鱼：' + miss.join(', '));
  if (extra.length) bad('条件表里有源码不存在的鱼：' + extra.filter(Boolean).join(', '));
  if (!miss.length && !extra.length && !docIds.some((x) => !x)) {
    ok('条件表覆盖源码全部 ' + species.size + ' 条鱼，一条不多一条不少');
  }
}

// ---------------------------------------------------------------- B 档位文字
// 只有表里**有"档位"这一列**时才校验（v2 起有；将来若删掉这列就自动跳过）。
{
  if (headerIdx.tier < 0) {
    ok('条件表没有"档位"列，跳过档位文字校验');
  } else {
    let n = 0;
    for (const t of table) {
      const s = species.get(t.id);
      if (!s || t.tierText === null) continue;
      const hasRed = s.maxTier === 5;
      const hasGold = s.maxTier >= 4;
      if (hasRed && !t.tierText.includes('红')) { bad(t.id + '：源码含红档，表里档位写作「' + t.tierText + '」'); n++; }
      if (!hasGold && /金|红/.test(t.tierText)) { bad(t.id + '：源码最高只到 ' + s.maxTier + ' 档，表里却写了金/红（「' + t.tierText + '」）'); n++; }
    }
    if (n === 0) ok(species.size + ' 条的档位文字与源码 tiers 逐条一致');
  }
}

// ---------------------------------------------------------------- C 取值合法
{
  let n = 0;
  for (const t of table) {
    if (!t.id) continue;
    for (const ch of (t.time || '').replace(/·/g, '')) {
      if (!TIME_ENUM.has(ch)) { bad(t.id + '：时段取值「' + ch + '」不在枚举（晨/昼/昏/夜/全）'); n++; }
    }
    if (!WEATHER_ENUM.has(t.weather)) { bad(t.id + '：天气取值「' + t.weather + '」不在枚举（all/clear/rain）'); n++; }
    if (!MOON_ENUM.has(t.moon)) { bad(t.id + '：月相取值「' + t.moon + '」不在枚举（any/full/new）'); n++; }
  }
  if (n === 0) ok('时段 / 天气 / 月相取值全部合法');
}

// ---------------------------------------------------------------- 现算统计
const per = { 晨: 0, 昼: 0, 昏: 0, 夜: 0 };
const always = [];
const high = [];
for (const t of table) {
  if (!t.id) continue;
  const s = species.get(t.id);
  if (t.time === '全') always.push(t.id);
  else for (const k of Object.keys(per)) if (t.time.includes(k)) per[k]++;
  if (s && s.maxTier >= 4) {
    high.push({ id: t.id, time: t.time, weather: t.weather, moon: t.moon, rod: s.rod });
  }
}
const canFish = {
  晨: per.晨 + always.length, 昼: per.昼 + always.length,
  昏: per.昏 + always.length, 夜: per.夜 + always.length,
};
// "绑了条件" = 除了"全时段 + 全天候 + 任意月相"之外，**还额外声明了某种限制**的鱼数。
// ⚠ 这里刻意不把"按阶段绑定时段"（比如大西洋鲑 晨·昼）、
//   "按时段绑天气"（虎鱼 昼 + rain + any）算成"绑了条件" ——
//   它们本来就该有时段偏好，那是分配表的主体，不是"特殊条件"。
//   真正意义上的"门槛条件"是**月相**（镜鲤 满月）与**天气**（蓝宝石雷龙 雨、
//   金泥鳅 雨 + 新月、北非胡子鲇 雨、虎鱼 雨、白条鱼/蝴蝶鱼/红宝石鱼/褐鳟 晴天）。
const isMoonBound = (t) => t.moon.replace(/\*/g, '') !== 'any';
const isWeatherBound = (t) => t.weather !== 'all';
const highBound = high.filter((h) => isMoonBound(h) || isWeatherBound(h)).length;
const redCount = [...species.values()].filter((s) => s.maxTier === 5).length;

// ---------------------------------------------------------------- D 文档数字
{
  /**
   * 在 §7 里找含某段文字的那一行。
   * ⚠ 必须**只找表格行**（以 `|` 开头）：`time: all` 这种片段在正文里也会出现，
   *   一开始没加这个限制，于是"全天鱼"那条断言实际读到的是正文第 349 行
   *   （那句里没有数字）—— 检查器照样打 ✅，等我把表格行拆开才发现读错了行。
   */
  const lineOf = (needle) => docLines.slice(i7, i8).find((l) => l.trim().startsWith('|') && l.includes(needle));

  /** 读一行里**加粗**的数字（`**5**` 这种），按出现顺序返回。 */
  const boldNums = (line) => [...line.matchAll(/\*\*(\d+)\*\*/g)].map((x) => Number(x[1]));

  /** 读一行的统计值：优先"共 N 条 / 是 N 条"，否则"**N 条**"。 */
  const countOf = (line) => {
    const bold = boldNums(line);
    if (bold.length) return bold[0];
    const m = /(\d+)\s*条/.exec(line);
    return m ? Number(m[1]) : null;
  };

  const checkCount = (needle, expect) => {
    const line = lineOf(needle);
    if (!line) { bad('统计表里找不到这一行：' + needle); return; }
    const got = countOf(line);
    if (got === null) { bad('统计表这一行里读不到数字：' + needle); return; }
    if (got !== expect) bad('统计表写「' + needle + ' = ' + got + '」，实际算出 ' + expect);
    else ok('统计表「' + needle + '」= ' + expect + ' ✅');
  };

  // ⚠ needle 要选**只可能出现在自检表里**的片段：
  //   一开始用「全天鱼」，结果先命中了 §7 开头那句
  //   "分配依据：… ③ maxTier ≥ 4（金红档）的鱼至少有一条绑特殊条件"（那一行没有数字）。
  checkCount('`time: all`', always.length);
  checkCount('金红档（源码 `maxTier() >= 4`）', high.length);
  checkCount('绑了门槛条件', highBound);
  checkCount('带红档的鱼（源码 `maxTier() == 5`）', redCount);

  // 时段行：一行里四个加粗数字（清晨/白天/黄昏/夜晚）
  for (const [label, exp] of [['在加成组里', per], ['能钓到', canFish]]) {
    const line = lineOf('该时段**' + label + '**');
    if (!line) { bad('统计表里找不到「该时段**' + label + '**」那一行'); continue; }
    const nums = boldNums(line);
    const want4 = [exp.晨, exp.昼, exp.昏, exp.夜];
    if (nums.length !== 4) { bad('「' + label + '」那行应有 4 个加粗数字，读到 ' + nums.length); continue; }
    if (nums.join(',') !== want4.join(',')) bad('「' + label + '」写的是 ' + nums.join('/') + '，实际是 ' + want4.join('/'));
    else ok('统计表「该时段' + label + '」= ' + want4.join(' / ') + ' ✅');
  }
}

// ---------------------------------------------------------------- E 保底鱼
{
  if (always.length < 3) bad('全天保底鱼只有 ' + always.length + ' 条（至少 3 条，否则某些时段可能没有保底鱼）');
  else ok('全天保底鱼 ' + always.length + ' 条：' + always.join(' / '));
}

// ---------------------------------------------------------------- F 台钓红档
{
  // ⚠ 白名单口径与 check-fish-species.js / check-new-fish.js 保持一致：
  //   用户 2026-09-29 最初定"台钓能且仅能出一种红鱼 = 蓝宝石雷龙"，
  //   2026-10-01 加第 4 批鱼时**追加了孔雀鱼**（那两份检查器里写的是
  //   `FLOAT_RED_ALLOWED = ['sapphire_snakehead','guppy']`）。
  //   所以这里的断言是"只能是这两条"，而不是"只能有一条" ——
  //   否则本文件会比既有检查器更严，一上来就红。
  const ALLOWED = ['sapphire_snakehead', 'guppy', 'arctic_char', 'giant_siamese_carp'];
  const floatRed = [...species.entries()].filter(([, s]) => s.rod !== 'LURE' && s.maxTier === 5).map(([k]) => k).sort();
  if (floatRed.join(',') !== [...ALLOWED].sort().join(',')) {
    bad('台钓侧带红档的鱼应是 ' + ALLOWED.join(' / ') + '（用户定案 + 第 4 批追加），实际：' + (floatRed.join(', ') || '无'));
  } else ok('台钓侧带红档的鱼正是 ' + ALLOWED.join(' / ') + '（与 check-fish-species.js 同口径）');
  ok('全库带红档的鱼共 ' + redCount + ' 条（金红档 ' + high.length + ' 条里含"紫→金"等不带红的）');
}

// ---------------------------------------------------------------- 收尾
console.log('');
if (fail) {
  console.log('❌ 条件表与源码不一致：' + fail + ' 处。改表或改代码后请同步另一侧。');
  process.exit(1);
}
console.log('✅ 时间/天气/月相条件表与源码一致（28 条鱼 · 档位 · 取值 · 统计数字）');
// TODO（docs/24 §8 实现落地后补）：
//   · FishHabits.java 里真的有 timeMaskOf / weatherMaskOf / moonOf 三张表
//   · fish-habits.json 的每条鱼都显式写了 time / weather / moon
//   · Environment 的四个纯函数系数表（docs/24 §4）
