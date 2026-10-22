/*
 * fix-ps1-encoding.js —— 把 .ps1 的编码修回"恰好一个 UTF-8 BOM"。
 *
 * ── 为什么必须有这个工具 ────────────────────────────────────
 * Windows PowerShell 5.1 **没有 BOM 的 .ps1 会按 ANSI/GBK 解码**：
 * 中文注释和消息全变乱码，而且乱码里可能出现引号/反引号，直接把脚本**解析崩**。
 * （真踩过两次：一次是 BOM 让 `param(...)` 不再是第一行、命令行开关被静默吃掉；
 *   一次是 2026-10-08 用 edit 工具改完 make-release.ps1 / build-deploy.ps1 之后
 *   BOM 被顺手丢掉 —— 跑发布脚本时直接语法错误。）
 *
 * `tools/check-ps1-encoding.js` 负责**发现**；这个脚本负责**修**。
 * 两者是配套的：只有检查器没有修复器，人就会去手改字节（那正是被禁止的做法）。
 *
 * 用法：
 *   node tools/fix-ps1-encoding.js            # 预览（哪些文件缺 BOM / 行尾混了）
 *   node tools/fix-ps1-encoding.js --write    # 真的修（补 BOM + 统一成 CRLF）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const BOM = '\uFEFF';

const files = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter((f) => f.endsWith('.ps1'))
  .map((f) => path.join('tools', f))
  .concat(fs.readdirSync(ROOT).filter((f) => f.endsWith('.ps1')));

let fixed = 0, bad = 0;
for (const rel of files) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const raw = fs.readFileSync(full, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  const body = hasBom ? raw.slice(1) : raw;

  // 行尾：这个仓库的 .ps1 都是 CRLF；edit 工具写进来的行是 LF，会混在一起。
  const crlf = (body.match(/\r\n/g) || []).length;
  const loneLf = (body.match(/(?<!\r)\n/g) || []).length;
  const mixed = crlf > 0 && loneLf > 0;

  if (hasBom && !mixed) continue;                       // 合格
  bad++;
  console.log((hasBom ? '  · ' : '  ✗ ') + rel
    + (hasBom ? '' : '  缺 UTF-8 BOM')
    + (mixed ? '  行尾混杂（CRLF ' + crlf + ' / 裸 LF ' + loneLf + '）' : ''));
  if (!WRITE) continue;

  const normalized = body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  fs.writeFileSync(full, BOM + normalized, 'utf8');
  fixed++;
  console.log('      → 已修（BOM + CRLF）');
}

if (!bad) {
  console.log('✅ 全部 .ps1 都合格：恰好一个 UTF-8 BOM、行尾统一 CRLF');
  process.exit(0);
}
if (!WRITE) {
  console.log('\n（预览模式。加 --write 修复）');
  process.exit(1);
}
console.log('\n已修 ' + fixed + ' 个文件 —— 再跑 node tools/check-ps1-encoding.js 复核');
process.exit(0);
