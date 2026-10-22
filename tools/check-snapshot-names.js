/*
 * 源码快照目录名必须是 14 位纯数字（`YYYYMMDDHHmmss`），且快照必须是**真的有内容**的。
 *
 * 为什么值得单独立一个检查（两个都真实踩过）：
 *
 * ① **目录名带结尾点号 → 整个仓库搜不了。**
 *    `tools/snapshot-src.js` 原来写 `.slice(0, 15)`，而 ISO 串去掉 `-` `:` `T` 后
 *    第 15 个字符是毫秒前的那个**点**，于是目录名成了 `20260930121539.`。
 *    Node 走 verbatim 路径照样能读能写（所以 `--list`、`--restore` 全正常，看不出病），
 *    但 `rg` 一进仓库就对这些目录报「系统找不到指定的路径」，
 *    **glob / grep 工具全废**，而报错指向仓库根，完全指不到快照目录名上。
 *    2026-10-01 排查了很久才发现。
 *
 * ② **快照可能是空的。**
 *    这个脚本存在的唯一理由就是"改坏了能还原"。曾经有一次 `build-deploy.ps1`
 *    被写坏（整文件 NUL）而没有任何可用快照，只能凭记忆重写 ——
 *    所以"有目录"不等于"有备份"，必须**数文件**。
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 供 tools/negtest.ps1 指向临时副本；不给就是仓库根目录 ✓
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const SNAP_DIR = path.join(ROOT, '参考资料', '_snapshots');
const GEN = path.join(ROOT, 'tools', 'snapshot-src.js');

let bad = 0;

/** 去掉 // 行注释与块注释，免得"注释里写的反面例子"被当成代码断言。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ---- 检查一：生成器只准切 14 位 ----
const gen = stripComments(fs.readFileSync(GEN, 'utf8'));
const slices = [...gen.matchAll(/\.slice\(0,\s*(\d+)\)/g)].map((m) => Number(m[1]));
if (slices.length === 0) {
  console.error('❌ tools/snapshot-src.js 里找不到时间戳的 .slice(0, N) —— 生成逻辑被改过了？');
  bad++;
}
for (const n of slices) {
  if (n !== 14) {
    console.error('❌ tools/snapshot-src.js 的时间戳切了 ' + n + ' 位（必须 14 位）' +
      '：ISO 串去掉 -:T 后第 15 个字符是毫秒前的点号，会让快照目录名带结尾点号，' +
      '从而让 rg / glob / grep 对整个仓库报「系统找不到指定的路径」');
    bad++;
  }
}
if (!/\^\\d\{14\}\$/.test(gen)) {
  console.error('❌ tools/snapshot-src.js 缺少 14 位格式断言（/^\\d{14}$/）—— ' +
    '没有它就只能靠人眼看目录名');
  bad++;
}

// ---- 检查二：已有快照目录名必须合法 ----
const NAME_OK = /^\d{14}(-beforeRestore)?$/;
let snaps = [];
if (!fs.existsSync(SNAP_DIR)) {
  console.log('  （还没有 _snapshots 目录，跳过目录名与内容检查）');
} else {
  snaps = fs.readdirSync(SNAP_DIR).sort();
  for (const n of snaps) {
    if (!fs.statSync(path.join(SNAP_DIR, n)).isDirectory()) continue;
    if (!NAME_OK.test(n)) {
      console.error('❌ 快照目录名不合法：' + n + '（应为 14 位数字，可带 -beforeRestore 后缀）' +
        (n.endsWith('.') ? ' —— 结尾点号会让 rg 报「系统找不到指定的路径」，把整个仓库的搜索弄坏' : ''));
      bad++;
    }
  }
}

// ---- 检查三：最新的那份快照必须有内容（src + tools 都要在）----
function countFiles(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(d, e.name));
    else n++;
  }
  return n;
}
const realSnaps = snaps.filter((n) => NAME_OK.test(n) && fs.statSync(path.join(SNAP_DIR, n)).isDirectory());
if (realSnaps.length) {
  const newest = realSnaps[realSnaps.length - 1];
  const files = countFiles(path.join(SNAP_DIR, newest));
  const missing = ['src', 'tools'].filter((r) => !fs.existsSync(path.join(SNAP_DIR, newest, r)));
  if (missing.length) {
    console.error('❌ 最新快照 ' + newest + ' 缺少 ' + missing.join(' + ') +
      ' —— 快照存在的唯一意义就是"改坏了能还原"，缺树的快照等于没有');
    bad++;
  } else if (files === 0) {
    console.error('❌ 最新快照 ' + newest + ' 是空的（0 个文件）—— 备份不能是空壳');
    bad++;
  } else {
    console.log('  ✅ 最新快照 ' + newest + '：' + files + ' 个文件，含 src + tools');
  }
}

console.log('检查 ' + realSnaps.length + ' 份快照的目录名与内容：' +
  (bad === 0 ? '全部合格' : bad + ' 处不合格'));
process.exit(bad === 0 ? 0 : 1);
