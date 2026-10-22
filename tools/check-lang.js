/*
 * check-lang.js —— 扫出"代码里用到、但语言文件里没有"的翻译键。
 *
 * 触发理由：玩家截图里 tooltip 直接显示成
 *   `tooltip.anglertackle.slot.lure`
 * 这类问题的表现是**游戏里看到一串键名**，但代码里完全正常，
 * 只有把"代码用到的键"和"语言文件有的键"对起来才查得出。
 *
 * 扫两种来源：
 *   ① Java 里字面量形式的 translatable("...") / literal("...")
 *   ② Java 里拼接出来的键：translatable("prefix." + 变量)
 *      —— 这类没法静态求值，只能收集前缀再模糊匹配（下面单独处理）
 *
 * 用法：node tools/check-lang.js
 */
const fs = require('fs');
const path = require('path');

const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const ROOT = ATL_ROOT;
const SRC = path.join(ROOT, 'src', 'main', 'java', 'com', 'whitecobalt', 'anglertackle');
const LANG = path.join(ROOT, 'src', 'main', 'resources', 'assets', 'anglertackle', 'lang');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.java')) out.push({ name: e.name, text: fs.readFileSync(p, 'utf8') });
  }
  return out;
}
const ALL = walk(SRC);
const zh = JSON.parse(fs.readFileSync(path.join(LANG, 'zh_cn.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(LANG, 'en_us.json'), 'utf8'));

// ---- ① 字面量键 ----
// ⚠ 必须排除 `translatable("foo." + 变量)` 这种**拼接型**：
//   正则 `translatable\("([a-z0-9_.]+)"` 会把前缀 "foo." 也当成完整键收进来，
//   于是报一堆"缺 foo. 这个键"的误报（踩过）。
//   拼接型在下面第 ② 段单独按前缀检查。
const literal = new Map();   // key -> [文件名]
for (const f of ALL) {
  const re = /translatable\(\s*"([a-z0-9_.]+)"\s*(?!\+)/g;
  let m;
  while ((m = re.exec(f.text)) !== null) {
    // 结尾带 '.' 的一律当拼接前缀，不当完整键
    if (m[1].endsWith('.')) continue;
    if (!literal.has(m[1])) literal.set(m[1], []);
    literal.get(m[1]).push(f.name);
  }
}

// ---- ② 拼接键：translatable("prefix." + expr) ----
// 只能收集前缀，然后检查"该前缀下至少有一个键存在"
const dynamic = new Map();   // prefix -> [文件名]
for (const f of ALL) {
  const re = /translatable\(\s*"([a-z0-9_.]+)\."\s*\+/g;
  let m;
  while ((m = re.exec(f.text)) !== null) {
    if (!dynamic.has(m[1])) dynamic.set(m[1], []);
    dynamic.get(m[1]).push(f.name);
  }
}

console.log('=== 字面量翻译键 ===\n');
console.log('  代码里用到的字面量键 ' + literal.size + ' 个');
const missingZh = [], missingEn = [];
for (const [k, files] of [...literal.entries()].sort()) {
  if (!(k in zh)) missingZh.push([k, files]);
  if (!(k in en)) missingEn.push([k, files]);
}
console.log('  ' + (missingZh.length ? '❌' : '✅') + ' 缺中文：' + missingZh.length + ' 个');
for (const [k, files] of missingZh) console.log('      ' + k + '   ← ' + files.join(', '));
console.log('  ' + (missingEn.length ? '❌' : '✅') + ' 缺英文：' + missingEn.length + ' 个');
for (const [k, files] of missingEn) console.log('      ' + k + '   ← ' + files.join(', '));

console.log('\n=== 拼接型翻译键（前缀）===\n');
console.log('  这类键的完整形式运行时才拼出来，只能检查"前缀下有没有键"');
console.log('  前缀                                   语言文件里的键数');
console.log('  ' + '-'.repeat(70));
let dynBad = 0;
for (const [prefix, files] of [...dynamic.entries()].sort()) {
  const n = Object.keys(zh).filter((k) => k.startsWith(prefix + '.')).length;
  if (n === 0) dynBad++;
  console.log('  ' + (n === 0 ? '❌ ' : '   ') + prefix.padEnd(38) + String(n).padEnd(8)
    + (n === 0 ? '← ' + files.join(', ') : ''));
}
if (dynBad) console.log('\n  ❌ 有 ' + dynBad + ' 个前缀下**一个键都没有** —— 游戏里会显示成原始键名');

// ---- 反向：语言文件里有、代码没用到的键（可能是残留） ----
console.log('\n=== 语言文件里有、代码里找不到的键 ===\n');
const allText = ALL.map((f) => f.text).join('\n');
const orphanZh = Object.keys(zh).filter((k) => {
  if (allText.includes('"' + k + '"')) return false;
  // 拼接型：只要前缀出现过就算用到
  const parts = k.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    if (allText.includes('"' + parts.slice(0, i).join('.') + '."')) return false;
  }
  return true;
});
console.log('  ' + (orphanZh.length ? 'ℹ' : '✅') + ' 未直接引用：' + orphanZh.length + ' 个'
  + (orphanZh.length ? '（可能是拼接型、或残留，逐个看）' : ''));
for (const k of orphanZh.slice(0, 25)) console.log('      ' + k);
if (orphanZh.length > 25) console.log('      …还有 ' + (orphanZh.length - 25) + ' 个');

const fail = missingZh.length + missingEn.length + (dynBad ? 1 : 0);
console.log('\n' + (fail === 0
  ? '全部通过：代码用到的键在语言文件里都有。'
  : fail + ' 项缺失（见上面 ❌）'));
process.exitCode = fail === 0 ? 0 : 1;
