'use strict';
/**
 * check-progress-doc.js —— 守住**进度看板里的检查器数量不是写死的**。
 *
 * ── 为什么值得单独守（有实测，不是假想） ──────────────────────
 * 2026-10-11：`tools/gen-progress.js` 的表头写死 `| 日志 | 119 检查器 | 负例 | 判定 |`，
 * 而同一时刻闸门里跑的是 **130** 个检查脚本（闸日志原文："✅ 全部 130 个检查脚本通过"）。
 * 看板是"这个仓库现在什么状态"给人的**第一眼**，写死的数字会一直撒谎 ✗。
 *
 * 这与 `tools/check-build-scripts.js` 的 B2 段是**同一类事故**（发布说明里写死
 * "21 种鱼 / v1.0.1"）—— 所以判据也照抄那一段：**数字必须从仓库数出来**。
 *
 * ── 四条断言 ───────────────────────────────────────────────
 *   ① `tools/gen-progress.js` 里**不许出现写死的检查器数量**（剥注释后扫 `\d+ 检查器`）；
 *   ② 它必须**真的去数**（读 `tools/` 目录 + 过滤 `check-*.js`），而且表头用的是那个变量
 *      —— 只断言 ① 不够：把数字删掉换成常量同样会撒谎，只是撒得更隐蔽 ✗；
 *   ③ `docs/进度.md` 必须带"自动生成，勿手改"标记（否则下一个人会去手改生成物）；
 *   ④（**只在真仓库跑**）看板表头的数量 == 磁盘上 `tools/check-*.js` 的真实条数 ⇒
 *      "加了检查器但忘了重跑生成器"当场红。
 *
 * ⚠ ④ 在负例副本里**必须跳过**：副本只拷了几个检查器，而 `docs/进度.md` 是从真仓库
 *   原样拷过去的（写着 130）—— 不跳过就是"对照组假失败"（AGENTS.md 里记过这类坑：
 *   看着像抓到了变异，其实什么都没验证）。所以 ④ 的证伪是**手工**做的：
 *   把 `docs/进度.md` 表头的数字改掉 → 本检查器红 → 改回来（已实测过，见 docs/进行中.md）。
 *   ⚠ 别为了让它能在副本里跑而把 ④ 改成"只比大小/只报不断言"—— 那就成了永远绿的检查器。
 *
 * 用法：node tools/check-progress-doc.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ⚠ 剥注释：本仓库的注释里**恰恰在解释那个坏写法**（"原先写死 119 检查器"），
//   不剥就会拿自己的说明文字把自己判红（check-big-catch-announce 的注释里记过同类）。
const { stripComments: strip } = require('./java-source.js');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const GEN = 'tools/gen-progress.js';
const DOC = 'docs/进度.md';

console.log('=== 进度看板检查（检查器数量必须从仓库数出来，不许写死） ===\n');

// ---------------------------------------------------------------- ① 源码里没有写死的数量
if (!exists(GEN)) {
  bad('缺 ' + GEN);
} else {
  const code = strip(read(GEN));
  const hard = /\d+\s*(?:个)?\s*检查(?:器|脚本)/.exec(code);
  if (hard) {
    bad(GEN + ' 里写死了检查器数量（' + hard[0].trim() + '）—— '
      + '检查器只会越加越多，写死一次就一直撒谎；应当数 tools/check-*.js');
  } else ok(GEN + ' 里没有写死的检查器数量（剥注释后扫过）');
}

// ---------------------------------------------------------------- ② 必须真的去数
if (!exists(GEN)) {
  // 上面已经报过，这里不重复
} else {
  const code = strip(read(GEN));
  const countsDir = /readdirSync\([^)]*['"]tools['"]/.test(code) || /readdirSync\([^)]*tools/.test(code);
  const filters = /\^check-.*\\\.js\$/.test(code) || /check-\*\.js/.test(code);
  // 表头那一行必须**拼**出来（变量参与），而不是一个完整字面量
  const headerLine = code.split('\n').find((l) => /检查器/.test(l) && /\|/.test(l)) || '';
  const interpolated = /'[^']*\|[^']*'\s*\+/.test(headerLine) || /\$\{/.test(headerLine);

  if (!countsDir) bad(GEN + ' 没有读 tools/ 目录 —— 检查器数量从哪来？');
  else if (!filters) bad(GEN + ' 没有按 check-*.js 过滤 —— 数出来的不是检查器条数');
  else if (!interpolated) {
    bad(GEN + ' 的表头那一行是个完整字面量（变量没参与）—— 数量是写死的：'
      + JSON.stringify(headerLine.trim()));
  } else ok(GEN + ' 的检查器数量是从 tools/check-*.js 数出来并拼进表头的');
}

// ---------------------------------------------------------------- ③ 生成物必须带"勿手改"
let doc = '';
if (!exists(DOC)) {
  bad('缺 ' + DOC + ' —— 跑 node tools/gen-progress.js 生成它');
} else {
  doc = read(DOC);
  if (/自动生成[，,]?\s*勿手改/.test(doc)) ok(DOC + ' 带"自动生成，勿手改"标记（挡住手改生成物）');
  else bad(DOC + ' 没有"自动生成，勿手改"标记 —— 它会被当成手写文档改，而下次生成就覆盖 ✗');
}

// ---------------------------------------------------------------- ④ 看板数量 == 真实条数
{
  // ⚠ 副本里跳过：副本只有几个检查器，而这份文档是从真仓库拷来的（见文件头 ⚠）
  if (process.env.ATL_ROOT) {
    console.log('  ⏭  副本里跳过"看板数量 == 真实条数"（副本不含全部 tools/check-*.js；'
      + '该条只在真仓库跑，证伪是手工做的）');
  } else {
    const real = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => /^check-.*\.js$/.test(f)).length;
    const m = /\|\s*日志\s*\|\s*(\d+)\s*检查器\s*\|/.exec(doc);
    if (!m) bad(DOC + ' 里找不到"| 日志 | N 检查器 |"表头 —— 生成器改了结构？本检查器要跟着改');
    else if (Number(m[1]) !== real) {
      bad('看板写着 ' + m[1] + ' 个检查器，磁盘上实际有 ' + real + ' 个 —— '
        + '跑一次 node tools/gen-progress.js 刷新它（看板的数字不能撒谎）');
    } else ok('看板的检查器数量与磁盘一致（' + real + ' 个）');
  }
}

console.log('');
if (fail) {
  console.log('❌ 进度看板检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 进度看板检查通过');
