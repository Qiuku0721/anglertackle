// ============================================================================
//  源码快照：把 src/ **和 tools/** 一起拷到 参考资料/_snapshots/<时间戳>/
//
//  ── 为什么必须连 tools/ 一起备份 ────────────────────────────
//  第一版只备份了 src/，结果踩了坑：那批"脚本化改写"的生成器本身也在改
//（wire-gameplay / gen-*-config / tuning-source…），改坏一个工具脚本之后
//  想还原，发现快照里根本没有 tools/ —— 只能凭记忆重写，绕了很久。
//  工具链和源码是同一批改动的一部分，必须一起进快照。
//
//  做法尽量简单：整树拷贝。src/ + tools/ 只有几百 KB，不值得搞增量。
//  自留最近 20 份，更早的自动删掉。
//
//  用法：
//    node tools/snapshot-src.js                    # 存一份快照
//    node tools/snapshot-src.js --list             # 列出所有快照
//    node tools/snapshot-src.js --restore <名字>   # 还原到某一份
// ============================================================================
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '参考资料/_snapshots');
const KEEP = 20;

/** 一起进快照的目录（相对项目根）。 */
const TREES = ['src', 'tools'];

const args = process.argv.slice(2);
const listMode = args.includes('--list');
const ri = args.indexOf('--restore');

/**
 * 快照目录名：`YYYYMMDDHHmmss`，**必须正好 14 位**。
 *
 * ⚠ 踩过的坑（2026-10-01）：这里原来写的是 `.slice(0, 15)`。
 *   `new Date().toISOString()` = `2026-09-30T12:15:39.123Z`，去掉 `-` `:` `T` 之后
 *   第 15 个字符正好是**毫秒前面那个点** —— 于是目录名变成 `20260930121539.`。
 *   结尾带点号的目录名 Win32 解析不了（Node 自己用 verbatim 路径能读能写，所以快照
 *   本身是好的、`--list` 也正常），但 `rg` 一进仓库就对着它报
 *   「系统找不到指定的路径」，**整个仓库的 glob/grep 全废**，而报错指向的是仓库根，
 *   完全看不出是快照目录名的锅。
 *   修法：切 14 位 + 下面这条格式断言，别让下一个人再摸一遍。
 */
function stampName() {
  const s = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  if (!/^\d{14}$/.test(s)) throw new Error('快照时间戳格式不对（应为 14 位数字）：' + s);
  return s;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stamps() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((n) => fs.statSync(path.join(DIR, n)).isDirectory()).sort();
}

/** 把 TREES 里的每个目录都拷进 dst（各自一个子目录，保持相对结构）。 */
function copyAll(dst) {
  for (const rel of TREES) {
    const from = path.join(ROOT, rel);
    if (fs.existsSync(from)) copyTree(from, path.join(dst, rel));
  }
}

if (listMode) {
  const all = stamps();
  if (!all.length) { console.log('（还没有任何快照）'); process.exit(0); }
  console.log('共 ' + all.length + ' 份快照：');
  for (const s of all) {
    const trees = TREES.filter((r) => fs.existsSync(path.join(DIR, s, r)));
    console.log('  ' + s + '   含 ' + (trees.join(' + ') || '(空)'));
  }
  process.exit(0);
}

if (ri >= 0) {
  const name = args[ri + 1];
  if (!name) { console.error('用法：--restore <快照名>（先跑 --list 看名字）'); process.exit(1); }
  const from = path.join(DIR, name);
  if (!fs.existsSync(from)) { console.error('❌ 找不到快照 ' + name); process.exit(1); }
  // 还原前先给"当前状态"留一份，免得还原本身把有用的东西冲掉
  const safe = stampName() + '-beforeRestore';
  copyAll(path.join(DIR, safe));
  for (const rel of TREES) {
    const dst = path.join(ROOT, rel);
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) {
      console.log('   （快照里没有 ' + rel + '/ —— 可能是旧版快照，跳过）');
      continue;
    }
    fs.rmSync(dst, { recursive: true, force: true });
    copyTree(src, dst);
  }
  console.log('✅ 已还原到 ' + name + '（还原前的状态另存为 ' + safe + '）');
  process.exit(0);
}

// ---- 存快照
const stamp = stampName();
const dst = path.join(DIR, stamp);
if (fs.existsSync(dst)) { console.log('（本秒已有快照 ' + stamp + '，跳过）'); process.exit(0); }
copyAll(dst);

let files = 0;
(function count(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) count(path.join(d, e.name)); else files++;
  }
})(dst);
console.log('✅ 快照已存：' + stamp + '（' + files + ' 个文件，含 ' + TREES.join(' + ') + '）');
console.log('   还原：node tools/snapshot-src.js --restore ' + stamp);

// 只留最近 KEEP 份
const all = stamps();
if (all.length > KEEP) {
  for (const old of all.slice(0, all.length - KEEP)) {
    fs.rmSync(path.join(DIR, old), { recursive: true, force: true });
    console.log('   （清理旧快照 ' + old + '）');
  }
}
