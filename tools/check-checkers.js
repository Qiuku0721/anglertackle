/*
 * check-checkers.js —— **检查器自己的体检**：哪些检查器从来没被证伪过。
 *
 * ── 为什么需要它（2026-10-03 自查）──────────────────────────────
 * 用户指出"随着 mod 内容变多，你出错和思考时长都变多了"，我拉了一遍数据：
 *
 *   · 101 个检查器 / 567 个配置项 / 196KB 的 Config.java / 22.7 千行 Java
 *   · **其中只有 30 个检查器有负例（被证伪过），71 个从来没有**
 *
 * 最后那条是最要命的：一个没被证伪过的检查器，**绿不绿跟对不对没有关系**。
 * 这次会话撞到的"检查器骗人"全在这个名单里 ——
 *   · `verify-jar.js` 硬编码 `1.0.1`，从 1.1.0 起两个月一直在查**旧 jar**，
 *     真正的新 jar 从没被检查过（而它每次都"报红"，掩盖了这一点）；
 *   · `check-env-table.js` 写死 §7，文档改版后它实际读到的是 JSON 代码块，
 *     28 条鱼全报"缺"，而档位那条断言照样绿。
 *
 * 所以本脚本不校验代码，只回答一个问题：**这张网有没有被撕开过？**
 * 它输出三档清单：
 *   ① 有负例 = 可信（至少被证伪过一次）
 *   ② 无负例 + 守用户验收物（贴图 / 语言 / 手册 / 数值）= **高风险**
 *   ③ 无负例 + 只守内部结构 = 待补
 *
 * ── 自检（本脚本自己也可能骗人）────────────────────────────────
 * 它的结论建立在"能从 _negtest.js 里正确解析出 checker 名"之上。
 * 一旦正则失效（比如 _negtest.js 换了写法），它会把**全部**检查器都报成"无负例"。
 * 所以这里断言：解析出的"有负例"数量必须 ≥ 25 —— 低于这个数说明解析本身出了问题，
 * 而不是"大家突然都没负例了"。这条断言是它唯一的自我保护。
 *
 * 用法：
 *   node tools/check-checkers.js           # 打印清单（永不失败，除自检）
 *   node tools/check-checkers.js --strict  # 有高风险项就退出码非零（给"要不要补负例"当闸门）
 *   node tools/check-checkers.js --json    # 输出 JSON（给 preflight.js 复用）
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

let fail = 0;
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const toolsDir = path.join(ROOT, 'tools');
const checkers = fs.readdirSync(toolsDir).filter((f) => /^check-.*\.js$/.test(f)).sort();
const negtestPath = path.join(toolsDir, '_negtest.js');
if (!fs.existsSync(negtestPath)) {
  console.error('❌ 找不到 tools/_negtest.js —— 没有它就无法判断谁有负例');
  process.exit(2);
}
const negtest = fs.readFileSync(negtestPath, 'utf8');

// ------------------------------------------------ 谁有负例
// _negtest.js 里的写法：{ dir: 'xxx', checker: 'check-yyy.js', expect: 0|1, ... }
const withNeg = new Set();
for (const m of negtest.matchAll(/checker:\s*'([^']+)'/g)) withNeg.add(m[1]);

// 自检：解析数量必须合理，否则说明 _negtest.js 换了写法而本脚本没跟上
const MIN_EXPECTED = 25;
if (withNeg.size < MIN_EXPECTED) {
  bad('只从 _negtest.js 解析出 ' + withNeg.size + ' 个 checker（期望 ≥ ' + MIN_EXPECTED + '）'
    + ' —— 多半是 _negtest.js 换了写法，本脚本的解析失效了，清单不可信');
}

// ------------------------------------------------ 每个检查器"守什么"
/** 风险分级：守用户验收物的最要紧（它们错了玩家会直接看到）。 */
const RISK_RULES = [
  // 高：用户能直接看到的东西 —— 贴图 / 名字 / 手册文案 / 商店价 / 界面
  ['高', /textures\/|lang\/|guide|docs\/1[0-9]|手册|贴图|图标|tooltip/i],
  // 中：玩法数值与生成物
  ['中', /Config\.java|Tuning\.java|ShopCatalog|生成物|配置项|数值/],
  // 低：内部结构、元信息、构建产物
  ['低', /jar|BOM|编码|class|import|结构/],
];

function describe(file) {
  const src = fs.readFileSync(path.join(toolsDir, file), 'utf8');
  // 注释头的第一行通常是 " * check-xxx.js —— 守……"
  const head = src.split('\n').slice(0, 40).join('\n');
  const title = (/check-[a-z-]+\.js\s*——\s*([^\n*]+)/.exec(head) || [, ''])[1].trim();
  // ⚠ 第二个维度：有没有 ATL_ROOT 支持。
  //   负例测试是在**副本目录**里跑检查的（ATL_ROOT 指向副本）。一个检查器如果不读
  //   ATL_ROOT，它在副本里就会去读**真实仓库** —— 于是"改坏副本里的数据"它根本看不见，
  //   负例只能"假通过"。所以"没有 ATL_ROOT"= **无法被证伪**，比"暂时没写负例"更严重。
  const hasRoot = /ATL_ROOT/.test(src);
  // 它读了哪些项目内文件（用于 preflight 复用 + 风险判断）
  const reads = new Set();
  for (const m of src.matchAll(/['"`](src\/[^'"`]+|tools\/[^'"`]+|docs\/[^'"`]+|参考资料\/[^'"`]+)['"`]/g)) {
    reads.add(m[1]);
  }
  // 风险：先看标题与源码里的可疑词，再看它读了什么路径
  const hay = title + '\n' + [...reads].join('\n');
  let risk = '低';
  for (const [lv, re] of RISK_RULES) {
    if (re.test(hay)) { risk = lv; break; }
  }
  return { title, reads: [...reads], risk, hasRoot };
}

const rows = checkers.map((f) => ({ file: f, neg: withNeg.has(f), ...describe(f) }));

// ------------------------------------------------ 输出
if (JSON_OUT) {
  console.log(JSON.stringify({ checkers: rows, negtestParsed: withNeg.size }, null, 1));
  process.exit(fail ? 1 : 0);
}

const noRoot = rows.filter((r) => !r.hasRoot);
const high = rows.filter((r) => !r.neg && r.risk === '高');
const mid = rows.filter((r) => !r.neg && r.risk === '中');
const low = rows.filter((r) => !r.neg && r.risk === '低');
const trusted = rows.filter((r) => r.neg);

console.log('=== 检查器体检（哪些网从没被撕开过）===\n');
console.log('  检查器总数 ' + rows.length + ' ｜ 有负例（可信）' + trusted.length
  + ' ｜ 从未被证伪 ' + (rows.length - trusted.length) + '\n');
console.log('  ⚠ **不支持 ATL_ROOT 的 ' + noRoot.length + ' 个** —— 它们在负例副本里会读真实仓库，');
console.log('     所以"改坏数据"它们看不见，**负例永远写不出来**（先修 ATL_ROOT 才能补负例）\n');

const show = (label, list, note) => {
  if (!list.length) return;
  console.log('【' + label + '】' + list.length + ' 个' + (note ? ' —— ' + note : ''));
  for (const r of list) {
    console.log('   ' + r.file.padEnd(36) + (r.hasRoot ? '' : '[无ATL_ROOT] ')
      + (r.title ? r.title.slice(0, 30) : '（注释头没有一句话说明）'));
  }
  console.log('');
};
show('高风险：守用户验收物，却没有负例', high, '这些一旦假绿，玩家直接看到错的东西');
show('中风险：守玩法数值 / 生成物', mid, '');
show('低风险：内部结构 / 元信息 / 构建产物', low, '');

console.log('【可信：有负例】' + trusted.length + ' 个');
console.log('   ' + trusted.map((r) => r.file.replace(/^check-|\.js$/g, '')).join(' · ') + '\n');

console.log('建议的补负例顺序：高风险 → 中风险 → 低风险；每一步都先确认它支持 ATL_ROOT。');
console.log('（补法见 tools/_negtest.js：加一条 { dir, checker, expect, desc, mutate }，');
console.log('  其中 expect:1 表示"故意改坏后这个检查器必须失败"。）');

if (fail) {
  console.log('');
  console.log('❌ 体检本身失败：' + fail + ' 处（见上）—— 清单不可信');
  process.exit(1);
}
if (STRICT && high.length) {
  console.log('');
  console.log('❌ --strict：还有 ' + high.length + ' 个高风险检查器从未被证伪');
  process.exit(1);
}
console.log('');
console.log('✅ 体检完成' + (high.length ? '（高风险 ' + high.length + ' 个待补负例）' : '（无高风险项）'));
