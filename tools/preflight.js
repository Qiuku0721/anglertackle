/*
 * preflight.js —— "改这个文件之前，先看清会牵动什么"。
 *
 * ── 为什么需要它（2026-10-03 自查）───────────────────────────────
 * 用户指出"随着 mod 内容变多，你出错和思考时长都变多了"。拉数据后原因很清楚：
 *
 *   · 111 个 Java 文件 / 22.7 千行、102 个检查器、567 个配置项、196KB 的 Config.java
 *   · 这些约束**不在我的工作记忆里**，于是每次改动前我不是"想"，而是"搜"——
 *     搜有哪些检查器会碰这个文件、它是不是生成物、要不要同步别的地方。
 *     **大量时间花在重新发现约束，而不是解决问题。**
 *
 * 这个脚本把那件事变成一条命令：
 *
 *   node tools/preflight.js src/main/java/.../FishSpecies.java
 *   node tools/preflight.js docs/24-时间天气月相策划.md
 *   node tools/preflight.js --list              # 列出所有生成物与它们的数据源
 *
 * 它回答三个问题：
 *   ① **谁在读它** —— 哪些检查器会因为它的变化而报红（改完要跑这些）
 *   ② **谁在写它** —— 它是不是生成物；是的话**别手改**，去改数据源再跑生成器
 *   ③ **别处要不要同步** —— 它是不是被别的检查器当作"另一端"引用（如文档 ↔ 源码）
 *
 * ⚠ 索引是**从源码扫出来的**，不是维护的表：检查器读什么由它代码里的路径字符串决定，
 *   生成器写什么由它的输出常量决定。所以索引不会漂移 —— 但反过来说，
 *   写路径的方式太花哨（模板拼接）时可能扫不到，那种情况会在输出里标注"未识别"。
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const wantList = process.argv.includes('--list');
const target = process.argv.slice(2).find((a) => !a.startsWith('--'));

// ---------------------------------------------------------------- 索引：谁读什么
const readIndex = new Map();   // 相对路径（或目录前缀） → [检查器名]
const PATH_RE = /['"`]((?:src|tools|docs|参考资料)\/[^'"`\n]+)['"`]/g;

function note(rel, checker) {
  const key = rel.replace(/\\/g, '/');
  if (!readIndex.has(key)) readIndex.set(key, []);
  if (!readIndex.get(key).includes(checker)) readIndex.get(key).push(checker);
}

for (const f of fs.readdirSync(TOOLS)) {
  if (!/^check-.*\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(TOOLS, f), 'utf8');
  for (const m of src.matchAll(PATH_RE)) note(m[1], f);
}

// ---------------------------------------------------------------- 索引：谁写什么（生成物）
// ⚠ 第一版只认 `const OUT = path.join(ROOT, ...)` 这种命名，结果**漏报了 Config.java** ——
//   而它恰恰是绝对不能手改的文件之一（生成器用的是 `cfgPath` / `tunPath` / `modItemsPath`）。
//   漏报的后果比误报严重得多：它会告诉人"可以手改"。
//   现在的判定分两步：① 收集所有 `const X = path.join(ROOT, '...')`；② 只把**被
//   writeFileSync 用到**的 X 算作输出（同一个文件里），这样"只读"的路径不会误判。
const writeIndex = new Map();  // 生成物路径 → [生成器名]
const ASSIGN_RE = /(?:const|let)\s+(\w+)\s*=\s*path\.join\(\s*ROOT\s*,\s*([^)]+)\)/g;
const DIRECT_WRITE_RE = /writeFileSync\(\s*path\.join\(\s*ROOT\s*,\s*([^)]+)\)/g;

const grabParts = (raw) => {
  const parts = [...raw.matchAll(/'([^']*)'/g)].map((x) => x[1]);
  return parts.length ? parts.join('/').replace(/\\/g, '/') : null;
};

for (const f of fs.readdirSync(TOOLS)) {
  if (!/^gen-.*\.js$/.test(f) && !/^(build-tuning-tool|sync-config-file|freeze-fish-baseline|gen-selfcheck-doc)\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(TOOLS, f), 'utf8');
  const put = (rel) => {
    if (!rel) return;
    if (!writeIndex.has(rel)) writeIndex.set(rel, []);
    if (!writeIndex.get(rel).includes(f)) writeIndex.get(rel).push(f);
  };
  // ① 变量 → 路径，再用"这个变量有没有出现在 writeFileSync(...) 里"筛一遍
  const vars = new Map();
  for (const m of src.matchAll(ASSIGN_RE)) {
    const rel = grabParts(m[2]);
    if (rel) vars.set(m[1], rel);
  }
  for (const [name, rel] of vars) {
    // writeFileSync(name, ...) / writeFileSync(\n name, ...) 都算
    if (new RegExp('writeFileSync\\(\\s*' + name + '\\b').test(src)) put(rel);
  }
  // ② 直接写盘的写法
  for (const m of src.matchAll(DIRECT_WRITE_RE)) put(grabParts(m[1]));
}

// 已知的"生成物 → 数据源"关系（这些关系写在生成器的头注释里，扫不出来，所以显式列出）
const SOURCE_OF = [
  [/^src\/main\/java\/com\/whitecobalt\/anglertackle\/Config\.java$/, 'tools/part-config.json + tools/fish-config.json + tools/gameplay-config.json（生成器：gen-*-config.js，**必须按 part → fish → gameplay 的顺序跑**）'],
  [/^src\/main\/java\/com\/whitecobalt\/anglertackle\/fishing\/Tuning\.java$/, 'tools/*-config.json（同上，走 gen-*-config.js）'],
  [/^src\/main\/java\/com\/whitecobalt\/anglertackle\/fishing\/FishHabits\.java$/, 'tools/fish-habits.json（gen-fish-habits.js --write）'],
  [/^src\/main\/java\/com\/whitecobalt\/anglertackle\/shop\/ShopCatalog\.java$/, 'tools/shop-*.json（gen-shop-*.js）'],
  [/^src\/main\/resources\/assets\/anglertackle\/textures\/entity\/fish\//, 'tools/fish-appearance.json（gen-fish-textures.js）'],
  [/^src\/main\/resources\/assets\/anglertackle\/textures\/item\/.*\.png$/, '**手绘或按参考图生成**：21 张手绘图标没有任何脚本能重现（见 tools/check-item-icons.js）；鱼获见 tools/gen-ref-icons.js 的白名单；9 张拟饵见 tools/gen-lure-icons.js（用户成图截上半）'],
  [/^src\/main\/resources\/assets\/anglertackle\/models\/item\//, 'tools/fish-appearance.json / tools/fish-model.js（gen-fish-model.js、gen-fish-item.js）'],
  [/^src\/main\/resources\/data\/anglertackle\/enchantment\//, 'tools/enchantments.json（gen-enchantments.js）'],
  [/^docs\/18-/, 'tools/shop-*.json（gen-shop-doc.js）'],
  [/^docs\/22-/, 'tools/fish-appearance.json（gen-selfcheck-doc.js）'],
  [/^tools\/tuning-schema\.json$/, 'Config.java（gen-tuning-schema.js 反向抽取）'],
  [/^src\/main\/resources\/assets\/anglertackle\/lang\/(zh_cn|en_us)\.json$/, '各生成器会往语言文件里注入 key（鱼名、附魔、商店…），**手改前先确认没有生成器管这一段**'],
];

// ---------------------------------------------------------------- 相关约定（按路径关键词给提示）
const CONVENTIONS = [
  [/FishSpecies\.java|FishingSession\.java|BiteTiming\.java/, [
    '档位是 **0 起算**（白 0 … 红 5）；配件那套是 1 起算，唯一的汇合点是 FishingSession.equippedBaitTier()',
    '咬钩节奏的数值只在 BiteTiming 一处真相，展示端（tooltip）回来问它，不许各算一遍',
  ]],
  [/Config\.java|Tuning\.java|config\.json/, [
    '配置项**不许在注册期读**（类初始化时配置还没加载 → 启动即崩，见 check-no-config-at-registration.js）',
    '改了默认值要同步核对 tools/tuning-schema.json 与默认 toml（check-live-config-matches-defaults.js 会比对）',
  ]],
  [/textures\/item|_baseline|图标指纹/, [
    '21 张手绘图标**没有任何脚本能重现**，改它们之前先确认不是覆盖（check-item-icons.js 逐个 sha256 守着）',
    '改贴图后要重新冻结比例基线，否则 check-fish-textures.js 会红',
  ]],
  [/fish-habits\.json|FishHabits\.java/, [
    'FishHabits.java 是**生成物**，改数据源再跑 node tools/gen-fish-habits.js --write',
    '每条鱼的 time/weather/moon 必须显式写全（"忘了写"会静默变成全天鱼）',
  ]],
  [/docs\//, [
    '文档里的数字如果被检查器守着（如 docs/24 §8 的条件表），改文档要一起改数据源或反之',
  ]],
  [/recipe|advancement/, [
    '⚠ 多个同名文件很常见（如 fish_rack.json 在 recipe/advancement/loot_table 三处），引用时用完整路径',
  ]],
];

// ---------------------------------------------------------------- 输出
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

if (wantList) {
  console.log('=== 生成物清单（这些文件**不要手改**，改数据源再跑生成器）===\n');
  const keys = [...writeIndex.keys()].sort();
  for (const k of keys) {
    console.log('  ' + k);
    console.log('      生成器：' + writeIndex.get(k).join(', '));
    const src = SOURCE_OF.find(([re]) => re.test(k));
    if (src) console.log('      数据源：' + src[1]);
  }
  console.log('\n（共 ' + keys.length + ' 条。扫不到的模板拼接路径不会出现在这里。）');
  process.exit(0);
}

if (!target) {
  console.error('用法：node tools/preflight.js <要改的文件路径>');
  console.error('      node tools/preflight.js --list     # 生成物清单');
  process.exit(2);
}

const t = norm(target);
const exists = fs.existsSync(path.join(ROOT, t));
console.log('=== 改动前检查：' + t + (exists ? '' : '  ⚠（这个路径当前不存在）') + ' ===\n');

// ① 谁读它
const readers = new Set();
for (const [rel, list] of readIndex) {
  if (rel === t || t.startsWith(rel) || rel.startsWith(t)) for (const c of list) readers.add(c);
}
console.log('① 谁会读它（改完**必须**跑这些检查器）：');
if (readers.size === 0) {
  console.log('   （没有检查器显式引用这个路径 —— 要么它确实是纯内部文件，要么引用方式是模板拼接）');
} else {
  for (const c of [...readers].sort()) console.log('   · ' + c);
}

// ② 谁写它
const writers = new Set();
for (const [rel, list] of writeIndex) {
  if (rel === t || t.startsWith(rel) || rel.startsWith(t)) for (const g of list) writers.add(g);
}
console.log('\n② 它是不是生成物（是的话**别手改**）：');
if (writers.size === 0) {
  console.log('   （没扫到生成器写它 —— 可以手改）');
} else {
  for (const g of [...writers].sort()) console.log('   ⚠ ' + g + ' 会写它');
  const src = SOURCE_OF.find(([re]) => re.test(t));
  if (src) console.log('   → 正确做法：改数据源【' + src[1] + '】，再跑生成器');
}

// ③ 别处要不要同步
if (readers.size || writers.size) {
  console.log('\n③ 同步提示：');
  const src = SOURCE_OF.find(([re]) => re.test(t));
  if (src) console.log('   · 数据源：' + src[1]);
  console.log('   · 改完跑一次全链最省事：powershell -NoProfile -ExecutionPolicy Bypass -File tools\\build-deploy.ps1 -NoDeploy');
}

// 相关约定
const conv = CONVENTIONS.filter(([re]) => re.test(t));
if (conv.length) {
  console.log('\n④ 这个位置的既有约定（本仓库踩过的坑）：');
  for (const [, lines] of conv) for (const l of lines) console.log('   · ' + l);
}
