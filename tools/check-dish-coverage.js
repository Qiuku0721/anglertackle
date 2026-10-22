/*
 * check-dish-coverage.js —— 守住"每道菜都落到一张贴图上，且没有白画的贴图"。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * `docs/25 §13.5` 是**逐鱼菜谱表**（23 条鱼 × ≤2 道 = 44 道菜），
 * 而贴图只有 12 张 + 三档熟鱼块。这中间靠一条规则连起来：
 *
 *   用户 2026-10-03：**"如果一条鱼的做法不止等同于生肉放熔炉的清烤就需要做贴图，
 *   清烤可以直接用对应档位熟鱼块的贴图。"**
 *
 * 这条规则一旦被破坏，**两边都不会报错**：
 *   ① 表里加了一道新做法的菜（比如"盐烤"） → 游戏里它只能借用别的菜的图，
 *      玩家看到"盐烤鲫鱼"长得像"红烧鲫鱼"；
 *   ② 画了新图却没人用（或者表里的菜名改了、分类词对不上） → 那张 png 白画，
 *      而且没有任何地方会提示。
 *
 * 断言：
 *   A. §13.5 的**每一道菜**都能归类到某张贴图（做法关键词 → 贴图 id）
 *   B. 生成器 `tools/gen-dish-icons.js` 声明的每一张菜图**都在磁盘上**
 *      （草案在 `参考资料/菜品贴图/`，注册物品后并入 `textures/item/`，两处都认）
 *   C. 每一张菜图**至少被一道菜用到**（没人用的图 = 白画）
 *   D. 清烤是个例外：它必须没有自己的菜图（复用 `*_cooked`），
 *      并且 §13.5 里确实有菜用的是"熔炉清烤"
 *
 * 用法：node tools/check-dish-coverage.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const { classify } = require('./dish-name.js');
const DOC = 'docs/25-鱼料理与配料方案.md';
const GEN = 'tools/gen-dish-icons.js';
const DRAFT_DIR = '参考资料/菜品贴图';
const TEX_DIR = 'src/main/resources/assets/anglertackle/textures/item';

console.log('=== 菜品贴图覆盖检查（每道菜都有图 / 每张图都有人用）===\n');

for (const p of [DOC, GEN]) {
  if (!exists(p)) { bad('缺文件：' + p); console.log('\n❌ 检查失败（缺文件）'); process.exit(1); }
}

// ---------------------------------------------------------------- 生成器声明了哪些图
const genSrc = read(GEN);
const drawn = [];
{
  // 生成器里的 ITEMS 数组：[ ['sashimi', '刺身', drawSashimi], ... ]
  const block = genSrc.split('const ITEMS = [')[1];
  if (!block) { bad('读不到 ' + GEN + ' 的 ITEMS 数组'); }
  else {
    const re = /\['([a-z_]+)',\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(block.split('\n];')[0])) !== null) drawn.push({ id: m[1], zh: m[2] });
  }
}
if (drawn.length === 0) bad('生成器里一张菜图都没读到');
else ok('生成器声明 ' + drawn.length + ' 张菜图：' + drawn.map((d) => d.zh).join(' / '));

// ---------------------------------------------------------------- B. 图在不在
// 清烤是例外：它复用熟鱼块，**故意**没有自己的菜图
const PASTRY_EXEMPT = new Set();
{
  const missing = [];
  for (const d of drawn) {
    if (PASTRY_EXEMPT.has(d.id)) continue;
    const inDraft = exists(DRAFT_DIR + '/' + d.id + '.png');
    const inTex = exists(TEX_DIR + '/' + d.id + '.png');
    if (!inDraft && !inTex) missing.push(d.id + '(' + d.zh + ')');
  }
  missing.length
    ? bad('菜图在磁盘上找不到（草案和 textures/item 都没有）：' + missing.join(', '))
    : ok('每张菜图都在磁盘上（草案目录或 textures/item）');
}

// ---------------------------------------------------------------- 解析 §13.5
const lines = read(DOC).split(/\r?\n/);
let start = -1;
for (let i = 0; i < lines.length; i++) if (/^#{2,4}\s*13\.5(\s|$)/.test(lines[i])) { start = i; break; }
if (start < 0) { bad('docs/25 里找不到 §13.5 逐鱼菜谱表'); }
else {
  // 菜名 → 菜图 id：从语言文件的名字模板现推（唯一真源，见 tools/dish-name.js）。
  // ⚠ 这里原来抄着一份手写正则表（`/油炸(横纹鱼|白条)/` `/炸鲇鱼|炸泥鳅/` `/鲫鱼汤|鲻鱼汤/`
  //    `/鲇鱼炖|泥鳅炖|慢炖/` …），与 check-dish-recipes.js 那份是**两个真源**。
  //    2026-10-10 补第二批 19 条鱼时两份同时认不出新菜名（假红），所以合并成一个模块：
  //    每加一条鱼，只要语言文件的模板在，这里就自动认得。
  const byName = classify;
  const dishes = [];
  let seenSep = false;
  for (let i = start + 1; i < lines.length; i++) {
    const ln = lines[i];
    if (/^#{2,4}\s/.test(ln)) break;
    if (!ln.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(ln)) { seenSep = true; continue; }
    if (!seenSep) continue;
    const c = ln.split('|').map((s) => s.trim());
    if (!/^\d+$/.test(c[1] || '')) continue;
    for (const [dishIdx, recIdx] of [[4, 5], [6, 7]]) {
      const dish = c[dishIdx] || '', rec = c[recIdx] || '';
      if (!dish || dish === '—' || !rec || rec === '—') continue;
      const name = dish.replace(/\*\*/g, '').replace(/（[^）]*）/g, '');
      const tex = byName(name);
      dishes.push({ fish: c[2], name, tex: tex || null });
    }
  }

  if (dishes.length === 0) bad('§13.5 里一道菜都没解析出来（表格结构变了？）');
  else ok('§13.5 解析出 ' + dishes.length + ' 道菜');

  // A. 每道菜都要归类
  const unknown = dishes.filter((d) => !d.tex);
  unknown.length
    ? bad('这些菜归不到任何贴图（新做法？菜名改了？）：\n       '
      + unknown.map((d) => d.fish + ' · ' + d.name).join('\n       '))
    : ok('每道菜都能归到一张贴图上（清烤并入熟鱼块）');

  // C. 每张图都要有人用
  const used = new Set(dishes.map((d) => d.tex));
  const unused = drawn.filter((d) => !used.has(d.id));
  unused.length
    ? bad('画了但没有菜用它（白画）：' + unused.map((d) => d.id + '(' + d.zh + ')').join(', '))
    : ok('每张菜图都至少被一道菜用到');

  // D. 清烤必须是"复用熟鱼块"，不能有独立菜图
  const grilled = dishes.filter((d) => d.tex === '熟鱼块');
  if (grilled.length === 0) bad('§13.5 里没有一道菜走"熔炉清烤"—— 用户定的例外条款没被执行');
  else ok('清烤走熟鱼块（' + grilled.length + ' 道：' + grilled.map((d) => d.name).join(' / ') + '）');
  if (drawn.some((d) => d.id.includes('cooked') || d.id === 'roast_fish')) {
    bad('生成器里出现了"清烤"的独立菜图 —— 用户定的是复用熟鱼块贴图');
  } else {
    ok('生成器里没有"清烤"的独立菜图（符合用户定的例外）');
  }

  // 归类分布（打印出来便于人工核对，也顺便证明分类不是"一个正则吃掉所有菜"）
  const tally = new Map();
  for (const d of dishes) tally.set(d.tex, (tally.get(d.tex) || 0) + 1);
  console.log('     归类分布：' + [...tally.entries()].sort((a, b) => b[1] - a[1])
    .map(([t, n]) => t + '×' + n).join(' · '));
}

console.log('');
if (fail === 0) {
  console.log('✅ 菜品贴图覆盖检查通过（' + drawn.length + ' 张菜图，清烤复用熟鱼块）');
  process.exitCode = 0;
} else {
  console.log('❌ 菜品贴图覆盖检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
