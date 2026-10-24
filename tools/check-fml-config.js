/*
 * check-fml-config.js —— TOML 体检：**编码 / BOM / 乱码 / 控制字符 / 段内重复键 / 关键项**。
 *
 * ── 这个检查守的是什么 ──────────────────────────────────────
 * 这些都是"文件看起来没问题、nightconfig 却静默返回 null"的成因：
 *   · 带 UTF-8/UTF-16 BOM     → 第一个键名带 \uFEFF，整项读不到
 *   · 出现 U+FFFD 替换字符     → 文件被按错编码转过一次，键名已经坏了
 *   · 夹了控制字符             → 解析器在那一行放弃
 *   · 同一张表里重复写同名键   → 后一个覆盖前一个（`[[数组表]]` 各自独立，不算）
 *
 * ── 它以前是坏的（2026-10-08 修）────────────────────────────
 * 旧版本**只 printf、从不断言**（永远退出 0），而且必须手动传文件路径 ——
 * 于是 build-deploy.ps1 直接把它放进了 $SkipChecks，**它一次都没跑过**。
 * "永远绿的检查器比没有检查器更坏"，所以这次改成：默认自己找文件 + 真的有断言 + 进闸门。
 *
 * 用法：
 *   node tools/check-fml-config.js                       # 检查默认的那几个 toml
 *   node tools/check-fml-config.js <某个.toml> [...]      # 指定文件
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

/** 不给参数时检查这些（存在几个查几个）。 */
const DEFAULT_FILES = [
  path.join(ROOT, 'run', 'config', 'fml.toml'),           // 开发环境里 NeoForge 自己写的
  path.join(ROOT, 'anglertackle-common.toml'),            // 发布包要带的那份默认配置
];

/** 只有 fml.toml 才要求这些键（它是 NeoForge 的引导配置）。 */
// 26.1.2 生成的 fml.toml 里已经**没有** earlyWindowSquir / earlyWindowFBScale
// （1.21.1 的那两个开关被早期窗口提供者设置取代：earlyWindowProvider / Width / Height），
// 所以关键项清单跟着版本走，别把"这个版本根本不存在的键"当成缺项。
const FML_KEYS = ['earlyWindowControl', 'disableConfigWatcher', 'maxThreads', 'versionCheck',
  'disableOptimizedDFU', 'earlyWindowProvider'];

const args = process.argv.slice(2).filter((a) => a.endsWith('.toml'));
const files = args.length ? args : DEFAULT_FILES.filter((p) => fs.existsSync(p));

if (!files.length) {
  console.log('⚠ 没有可检查的 toml（都不是命令行给的，默认清单里也一个都不存在）：');
  for (const p of DEFAULT_FILES) console.log('    · ' + p);
  console.log('  这条检查本轮**没有生效** —— 先跑一次开发环境或生成默认配置再来。');
  process.exit(0);
}

let fails = 0;
const bad = (msg) => { console.error('  ❌ ' + msg); fails++; };
const ok = (msg) => console.log('  ✅ ' + msg);

for (const file of files) {
  console.log('=== ' + path.relative(ROOT, file) + ' ===');
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    bad('读不到文件：' + e.message);
    continue;
  }

  // ---- 编码层 ----
  const utf8Bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const utf16Bom = buf[0] === 0xFF || buf[0] === 0xFE;
  const text = buf.toString('utf8');

  if (utf8Bom) bad('带 UTF-8 BOM —— 第一个键名会带 \\uFEFF，nightconfig 会静默读不到它');
  else if (utf16Bom) bad('带 UTF-16 BOM —— 这个文件必须是 UTF-8');
  else ok('无 BOM（' + buf.length + ' 字节，换行 ' + (buf.includes(Buffer.from('\r\n')) ? 'CRLF' : 'LF') + '）');

  const repl = (text.match(/\uFFFD/g) || []).length;
  if (repl) bad('有 ' + repl + ' 个替换字符 U+FFFD —— 这个文件被按错编码转过一次（键名已经坏了）');
  else ok('无乱码（U+FFFD）');

  const weird = [...text].filter((c) => {
    const n = c.charCodeAt(0);
    return (n < 9) || (n > 13 && n < 32);
  });
  if (weird.length) {
    bad('有 ' + weird.length + ' 个控制字符（前几个：'
      + [...new Set(weird)].slice(0, 5).map((c) => 'U+' + c.charCodeAt(0).toString(16)).join(' ') + '）');
  } else ok('无可疑控制字符');

  if (text && !/\n$/.test(text)) bad('文件末尾没有换行（追加写入时会把最后一行和下一行粘在一起）');
  else ok('以换行结尾');

  // ---- 结构层：段内重复键 ----
  // ⚠ 必须**按表分段**统计：`[[dependencies.x]]` 是数组表，每个元素里都能各自有
  //   modId/type/versionRange，全局去重会全是误报。只有同一张表内出现两次才是真错误。
  const seen = new Map();
  const tables = new Set();
  let curLabel = '(顶层)';
  let dup = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (t) {
      const n = [...tables].filter((x) => x === t[1]).length + 1;
      tables.add(t[1]);
      curLabel = t[1] + (n > 1 ? ' #' + n : '');
      seen.clear();
      return;
    }
    const m = line.match(/^\s*([A-Za-z_][\w.-]*)\s*=/);
    if (!m) return;
    if (seen.has(m[1])) {
      bad('第 ' + (i + 1) + ' 行段内重复键：' + curLabel + '.' + m[1] + '（首次在第 ' + seen.get(m[1]) + ' 行）');
      dup++;
    } else seen.set(m[1], i + 1);
  });
  if (!dup) ok('无段内重复键（' + tables.size + ' 张表）');

  // ---- 关键项（只对 fml.toml 要求）----
  if (path.basename(file) === 'fml.toml') {
    const missing = FML_KEYS.filter((k) => !new RegExp('^\\s*' + k + '\\s*=', 'm').test(text));
    if (missing.length) bad('缺关键项：' + missing.join('、') + '（NeoForge 会退回内置默认值）');
    else ok('关键项齐全（' + FML_KEYS.length + ' 项）');
  }
  console.log('');
}

if (fails === 0) {
  console.log('✅ TOML 体检通过（' + files.length + ' 个文件：编码、乱码、控制字符、段内重复键都干净）');
  process.exit(0);
}
console.error('不一致 ' + fails + ' 处');
process.exit(1);
