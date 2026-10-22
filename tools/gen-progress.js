const fs = require('fs');
const path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
const exists = (p) => fs.existsSync(path.join(ROOT, p));
// ⚠ 闸日志不是 UTF-8：PowerShell 5.1 的 Tee-Object 写的是 **UTF-16LE（FF FE BOM）**。
//   按 BOM 自适应：FF FE → utf16le，EF BB BF → utf8，其余按 gbk 兜底 ✓
const readLog = (p) => {
  try {
    const b = fs.readFileSync(path.join(ROOT, p));
    if (b[0] === 0xFF && b[1] === 0xFE) return b.toString('utf16le');
    if (b[0] === 0xEF && b[1] === 0xBB) return b.toString('utf8');
    try { return new TextDecoder('gbk').decode(b); } catch { return b.toString('latin1'); }
  } catch { return ''; }
};
const ver = (read('gradle.properties').match(/mod_version=([\d.]+)/) || [, '?'])[1];
const libs = exists('build/libs') ? fs.readdirSync(path.join(ROOT, 'build/libs'))
  .filter((f) => /^anglertackle-[\d.]+\.jar$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(ROOT, 'build/libs', f)).mtimeMs }))
  .sort((a, b) => b.t - a.t) : [];
const gates = exists('build') ? fs.readdirSync(path.join(ROOT, 'build'))
  .filter((f) => /^gate-.*\.log$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(ROOT, 'build', f)).mtimeMs }))
  .sort((a, b) => b.t - a.t).slice(0, 5) : [];
const gateRow = (f) => {
  const c = readLog('build/' + f);
  const chk = /全部 \d+ 个检查脚本通过/.test(c);
  const neg = /全部通过：\d+ 个用例/.test(c);
  const ran = /负向测试/.test(c);
  const cases = (c.match(/\[OK\]/g) || []).length;
  const v = !ran ? '（未跑到负例）' : (chk && neg ? '✅ 通过' : '❌ 失败');
  return '| `' + f + '` | ' + (chk ? '✅' : '❌') + ' | ' + (neg ? '✅（' + cases + ' 例）' : '❌') + ' | ' + v + ' |';
};
// 检查器数量**必须从仓库数出来**，不许写死。
// ⚠ 2026-10-11 实测：这里原先写死 `119 检查器`，而当时闸门里跑的是 **130** 个 ——
//   看板是"进度"给人的第一眼，写死的数字会一直撒谎（与 make-release.ps1 里
//   写死"21 种鱼"是同一类事故，见 tools/check-build-scripts.js 的 B2 段）。
//   守卫：tools/check-progress-doc.js（含 3 条负例）。
const checkerCount = exists('tools')
  ? fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => /^check-.*\.js$/.test(f)).length
  : 0;
const ledger = read('docs/进行中.md');
const seg = ledger.slice(ledger.indexOf('用户 2026-10-09 指令批'));
const rows = [...seg.matchAll(/^\|\s*(\d)\s*\|([^|]+)\|([^|]+)\|/gm)]
  .map((m) => '| ' + m[1] + ' |' + m[2].trim() + ' |' + m[3].trim() + ' |');
const out = [
  '# 进度看板（自动生成，勿手改）', '',
  '> 生成：`node tools/gen-progress.js`　数据现读仓库 ✓',
  '> 闸日志是 **UTF-16LE**（PowerShell Tee-Object 的默认），本脚本按 BOM 自适应解码 ✓', '',
  '## 版本', '', '| 项 | 值 |', '|---|---|',
  '| 工作区版本 | **' + ver + '** |',
  '| 最近构建的 jar | ' + (libs[0] ? '`' + libs[0].f + '`' : '（无）') + ' |', '',
  '## 最近几次总闸', '', '| 日志 | ' + checkerCount + ' 检查器 | 负例 | 判定 |', '|---|---|---|---|',
  ...gates.map((g) => gateRow(g.f)), '',
  '## 用户指令批（来源：docs/进行中.md）', '', '| # | 事项 | 状态 |', '|---|---|---|',
  ...rows, '',
  '## 常用命令', '', '| 命令 | 用途 |', '|---|---|',
  '| `node tools/gen-progress.js` | 刷新本文件 |',
  '| `powershell -File tools\\build-deploy.ps1 -NoDeploy` | 全链自检 |',
  '| `node tools/preflight.js <文件>` | 改之前先查：谁读它、是不是生成物 |', '',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'docs/进度.md'), out);
console.log('OK docs/进度.md');
