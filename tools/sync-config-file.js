// 把 Config.java 里**新增**的配置项补进已有的 toml，其余内容一字不动。
//
// ── 为什么需要它 ─────────────────────────────────────────────
// NeoForge 从不用新默认值覆盖已有配置（这是对的：玩家调过的值必须留下），
// 但它同时也**不会**把新加的分组补进老文件 —— 只有游戏启动那次写回才会。
// 于是"我加了 79 个配件配置项"这件事，在玩家启动游戏之前是看不见的：
// 调参器打开会说这 79 项在文件里找不到，而玩家会以为是工具坏了。
//
// 这个脚本把缺的部分补上，让配置文件和代码当场就一致。
//
// ── 安全性 ──────────────────────────────────────────────────
// · 已存在的键一律不动（玩家调过的值必须原样保留）
// · 已存在的分组也不动，只往里补缺的键
// · 只加不删：代码里删掉的项留在文件里也无害（NeoForge 会忽略）
// · 默认值取 Config.java 的真实默认值，不是脚本里另外写一份
// · --write 之前先打印将要新增的清单
//
// 用法：
//   node tools/sync-config-file.js            # 预览（不改文件）
//   node tools/sync-config-file.js --write    # 真的写入
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'tuning-schema.json'), 'utf8'));

// 配置文件位置：优先命令行传入，否则用 PCL 那个安装
const DEFAULT_CFG = 'D:\\mc\\PCL 正式版 2.13.1.1\\.minecraft\\versions\\' +
                    '1.21.1-NeoForge_21.1.250\\config\\anglertackle-common.toml';
// --out <路径>：不改原文件，把合并结果写到别处。
// 需要一个"--我改不到游戏目录"的出口：开发环境的沙箱对 D: 盘只读，
// 而游戏装在那里。这样仍然能产出可用的文件让玩家自己替换。
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null;
if (outIdx >= 0 && !OUT) { console.error('❌ --out 后面要给路径'); process.exit(1); }

// 位置参数 = 第一个 .toml，但要跳过 --out 的值（它也可能是 .toml 结尾）
const cfgPath = process.argv.slice(2).find((a, i, arr) =>
  a.endsWith('.toml') && arr[i - 1] !== '--out') || DEFAULT_CFG;

// ★ 2026-10-11 加的护栏（**真踩过**）：
//   仓库根那份 `anglertackle-common.toml` 是**发布用默认配置**（直接覆盖给没跑过游戏的玩家），
//   必须与代码默认值逐项一致。而本脚本不带位置参数时，基底是**游戏目录里那份**
//   （早被调参器改过）⇒ 「拿游戏那份当基底 + --out 指向发布用默认配置」= 把玩家调过的值
//   写进"默认配置"，发布出去的默认值全是错的，而每一步都打印成功 ✗。
//   那一天就是这么把 104 个键写成了调参值（`check-live-config-matches-defaults` 当场报红）。
//   ⇒ 这里直接拒掉，并把正确命令打出来。
{
  const RELEASE_TOML = path.join(ROOT, 'anglertackle-common.toml');
  const samePath = (a, b) => !!a && !!b
    && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (WRITE && OUT && samePath(OUT, RELEASE_TOML) && !samePath(cfgPath, RELEASE_TOML)) {
    console.error('❌ --out 指向仓库根的「发布用默认配置」，但基底是另一份 toml：');
    console.error('     ' + cfgPath);
    console.error('   那会把你调过的值写进"要给玩家覆盖的默认配置"里 ⇒ 发出去的默认值是错的。');
    console.error('   要更新它（以它自己为基底，只补代码里新增的键）：');
    console.error('     node tools/sync-config-file.js anglertackle-common.toml'
      + ' --out anglertackle-common.toml --write');
    process.exit(2);
  }
}

if (!fs.existsSync(cfgPath)) {
  console.error('❌ 找不到配置文件：' + cfgPath);
  console.error('   （游戏还没跑过？先启动一次让它生成，或把路径作为参数传进来）');
  process.exit(1);
}

const original = fs.readFileSync(cfgPath, 'utf8');
const lines = original.split(/\r?\n/);

// ---------------------------------------------------------------- 1. 读出文件里已有的键
// 只认 `[分组]` 头与 `键 = ...`，注释/空行跳过 —— 与 Tuning.parseFlatToml 同口径。
const have = new Map();   // 分组 -> Set(键)
let group = null;
const groupOrder = [];
for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith('[') && line.endsWith(']')) {
    group = line.slice(1, -1).trim();
    if (!have.has(group)) { have.set(group, new Set()); groupOrder.push(group); }
    continue;
  }
  if (!group || line.startsWith('#') || !line) continue;
  const eq = line.indexOf('=');
  if (eq > 0) have.get(group).add(line.slice(0, eq).trim());
}

// ---------------------------------------------------------------- 2. 算出缺什么、以及注释要不要刷新
const missingGroups = [];
let missingCount = 0;
for (const g of schema.groups) {
  const existing = have.get(g.id);
  const lack = g.fields.filter((f) => !existing || !existing.has(f.key));
  if (!lack.length) continue;
  missingGroups.push({ group: g, lack, isNew: !existing });
  missingCount += lack.length;
}

// 注释刷新：NeoForge 把配置项的注释原样写在键的**上一行**（以 # 开头）。
// 键齐全不代表注释是新的 —— 改过注释文案之后，文件里留的还是旧的那句
// （踩过：中文标签加好了，游戏里的 toml 还是 "hemp_line 的 tensionCeiling"）。
// 所以这里逐项比对"键上一行"的注释，不一致就换掉。
const wantComment = new Map();
for (const g of schema.groups) for (const f of g.fields) if (f.comment) wantComment.set(f.key, f.comment);

const outLines = [];
let staleComments = 0;
// ⚠ 比对前要把空白**规范化**：NeoForge 自己写的长注释会按宽度折成好几行
//   （每行都以 # 开头），而本脚本写的是**一行**长注释 —— 直接比字符串永远"不一致"。
const normComment = (s) => s.replace(/\s+/g, ' ').trim();
// ⚠⚠ 还要**忽略 NeoForge 自动加的两行**：游戏启动写回配置时，它会在我们的注释
//   下面补 `# Default: 1.6` 和 `# Range: 0.2 ~ 10.0`。不认这两行的话：
//     ① 每一项都判成"注释不一致"（本机实测 519 条，全是这种噪音）；
//     ② `--write` 时会把它们**删掉** —— 下次启动 NeoForge 又加回来，
//        于是"报不一致 → 重写 → 又被改写"来回折腾，文件白写一遍。
//   真正的文本变化（比如鱼名从「淄鱼」改成「鲻鱼」）照样抓得到。
const AUTO_COMMENT = /^(Default|Range)\s*:/;
const isAutoLine = (text) => AUTO_COMMENT.test(text.replace(/^\s*#\s?/, ''));

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  const want = m ? wantComment.get(m[2]) : undefined;
  if (want !== undefined) {
    // 往上吃掉紧邻的注释行（NeoForge 一个键可能写多行注释）
    let j = outLines.length;
    while (j > 0 && /^\s*#/.test(outLines[j - 1])) j--;
    const oldText = outLines.slice(j)
      .filter((s) => !isAutoLine(s))
      .map((s) => s.replace(/^\s*#\s?/, '')).join(' ').trim();
    if (normComment(oldText) !== normComment(want)) {
      staleComments++;
      // 只替换**我们那一行**，NeoForge 的 Default/Range 行原样留着
      const keep = [];
      let replaced = false;
      for (let k = j; k < outLines.length; k++) {
        if (isAutoLine(outLines[k])) { keep.push(outLines[k]); continue; }
        if (!replaced) { keep.push(m[1] + '# ' + want); replaced = true; }
        // 我们的多行注释续行：丢掉（want 是完整的一段）
      }
      if (!replaced) keep.unshift(m[1] + '# ' + want);
      outLines.length = j;
      for (const l of keep) outLines.push(l);
    }
  }
  outLines.push(line);
}

if (!missingCount && !staleComments) {
  // ⚠ 2026-10-08 修：这一支以前**直接 exit**，于是"输入无需改"时 `--out` 什么都不写 ✗
  //   —— 而 --out 的用途恰恰是"产出一份可以覆盖过去的完整配置"。
  //   实测后果：发布包里那份 `默认配置_anglertackle-common.toml` 一直停在 10/07 的旧值上
  //   （缺了新鱼的键、旧值也没跟上），而生成命令每次都打印"无需改"，看着完全正常。
  //   输入不需要改 ⇒ 输出就等于输入（复制一份）。
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.copyFileSync(cfgPath, OUT);
    console.log('✅ 输入无需改动；已按 --out 把当前内容写出：' + OUT);
    console.log('（' + path.basename(cfgPath) + ' 与代码默认值一致，所以这份就是最新的默认配置）');
    process.exit(0);
  }
  console.log('✅ 配置文件已经包含全部 ' +
              schema.groups.reduce((a, g) => a + g.fields.length, 0) + ' 项，注释也是最新的，无需改');
  process.exit(0);
}

console.log('配置文件：' + cfgPath);
console.log('文件里已有 ' + schema.groups.filter((g) => have.has(g.id)).length + ' 个分组');
if (missingCount) {
  console.log('缺 ' + missingGroups.length + ' 个分组里的 ' + missingCount + ' 项：');
  for (const m of missingGroups) {
    console.log((m.isNew ? '  [新增分组] ' : '  [补入已有分组] ') + m.group.id + '  ' + m.lack.length + ' 项');
  }
}
if (staleComments) console.log('有 ' + staleComments + ' 条注释与代码不一致，会一并刷新');
console.log('');

if (!WRITE) {
  console.log('\n（预览模式。加 --write 写入，写入前会备份）');
  process.exit(0);
}

// ---------------------------------------------------------------- 3. 生成要追加的 TOML/** 默认值渲染。NeoForge 对 double 写整数时喜欢带 d 后缀，这里统一带，读起来一致。 */
function render(f) {
  if (f.type === 'bool') return f.def ? 'true' : 'false';
  if (f.type === 'int') return String(f.def);
  return Number.isInteger(f.def) ? f.def + '.0' : String(f.def);
}
const wrap = (s, indent, width) => {
  const words = s.split('');
  const out = [];
  let cur = indent;
  for (const w of words) {
    if (cur.length >= width) { out.push(cur); cur = indent; }
    cur += w;
  }
  out.push(cur);
  return out;
};

// ⚠⚠ 这里踩过一个**静默**的坑（2026-10-02 加 bite 的 8 项时暴露）：
//   原实现对"已存在的分组"只把键追加到文件末尾，**不写表头** ——
//   注释里写着"这一组会以同名 [id] 再出现一次"，可代码里 head 对已有分组是 null，
//   于是这 8 个键落进了文件**最后一个**分组（当时是 [render]）。
//   症状：toml 里 `render.floorSeconds` 存在、`bite.floorSeconds` 不存在，
//   而 NeoForge 读的是 `bite.*` —— 游戏里那 8 项永远按默认值走，
//   同时 check-live-config-matches-defaults.js 报"多余 8 项"。
//   而且同名表出现两次在 TOML 规范里本来就**非法**（能不能读全看库的宽容度），
//   所以正确做法是把缺的键**插进它自己那张表里**，而不是再开一张同名表。
// ⚠⚠ 2026-10-08 修掉一个**静默**的坑：以前写注释用的是 `wrap('# ' + f.comment, '\t', 78)`，
//   `#` 只加在**整个字符串**前面 —— 一换行，后面每一行都是"tab + 中文"，**没有 `#`**。
//   于是 toml 里长出 28 行"看起来像键的注释碎片"（例如 `\t是**基准值**：实际游速 = …`），
//   而 check-live-config-matches-defaults.js 会把带 `=` 的碎片当成配置项 →
//   报"多余 13 项"，逐字列出 `fishStats.体力池：X = 基准 Y × 档位倍率 Z」…` 这种鬼键。
//   根因是**注释前缀必须逐行加**，不是加一次。
//   正确写法：把 `# ` 放进 wrap 的 indent（每一行都从 `\t# ` 开始）；
//   另外先按换行拆段，免得说明里本来就有换行时整段被当一段流式折行。
const extrasByGroup = new Map();
for (const m of missingGroups) {
  const ls = [];
  for (const f of m.lack) {
    // 缩进用 tab：NeoForge 自己写出来的 toml 就是 `\t键 = 值` / `\t# 注释`，
    // 追加块跟它保持一致，别让玩家看出"这两段不是一个程序写的"。
    if (f.comment) {
      for (const para of String(f.comment).split(/\r?\n/)) {
        for (const l of wrap(para, '\t# ', 78)) ls.push(l);
      }
    }
    ls.push('\t' + f.key + ' = ' + render(f));
  }
  extrasByGroup.set(m.group.id, ls);
}

// 已有分组 → 插进该表（最后一个键之后、下一个表头之前）
const insertAt = new Map();
for (const m of missingGroups) {
  if (m.isNew) continue;
  const esc = m.group.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headIdx = outLines.findIndex((l) => new RegExp('^\\s*\\[' + esc + '\\]\\s*$').test(l));
  if (headIdx < 0) {
    // 表头找不到（文件被手改过？）→ 退化成"末尾追加 + 带表头"，并且**说出来**，
    // 不要静默换一种写法 —— 静默正是上面那个坑的本质。
    console.log('⚠ toml 里找不到 [' + m.group.id + '] 表头，改为在文件末尾新开一张同名表');
    m.isNew = true;
    continue;
  }
  // ⚠ 插在"该表最后一个键之后"，而不是"下一个表头之前"：
  //   后者会把**下一张表的注释块**夹在中间（NeoForge 把 push 前的 b.comment
  //   写在表头上一行），新键就和本表原有的键隔开了，看着像另一段东西。
  let at = headIdx + 1;
  for (let i = headIdx + 1; i < outLines.length; i++) {
    if (/^\s*\[/.test(outLines[i])) break;
    if (/^[ \t]*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(outLines[i])) at = i + 1;
  }
  insertAt.set(at, (insertAt.get(at) || []).concat(extrasByGroup.get(m.group.id)));
}

const withInserts = [];
for (let i = 0; i <= outLines.length; i++) {
  if (insertAt.has(i)) withInserts.push(...insertAt.get(i));
  if (i < outLines.length) withInserts.push(outLines[i]);
}

let block = '\n# ==========================================================================\n' +
            '#  以下由 tools/sync-config-file.js 追加：代码里新增的配置项。\n' +
            '#  已存在的键一律没动 —— 你调过的值原样保留。\n' +
            '# ==========================================================================\n';

// 真正的新分组才追加到末尾（带表头，只写一次）
for (const m of missingGroups) {
  if (!m.isNew) continue;
  block += '\n[' + m.group.id + ']\n';
  for (const l of extrasByGroup.get(m.group.id)) block += l + '\n';
}

// ---------------------------------------------------------------- 4. 备份 + 写入
// 基底是**刷新过注释 + 插好缺项**的那版（withInserts），不是原始文本 ——
// 直接用 original 会把刚刷新的注释和插进去的键丢掉。
const base = withInserts.join('\n').replace(/\s*$/, '');
const merged = base + '\n' + block;

if (OUT) {
  // 只产出文件，不动游戏目录。玩家自己把它替换过去即可。
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, merged, 'utf8');
  console.log('\n已写出：' + OUT);
  console.log('（原文件未改动。把它复制到 config\\ 目录覆盖 anglertackle-common.toml 即可）');
} else {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  // ★ 备份**不再堆在 config\ 里**（用户 2026-10-06："现在发现一堆和配置文件堆在一个文件夹的
  //   相似长名文件，如果不需要这玩意可以打包到别处"）。
  //   以前是 `anglertackle-common.bak-<时间戳>.toml`，直接落在 config\ 里 ——
  //   每次同步 +1 个，跑十几次就是十几条长名文件糊在配置文件夹里，和真正的配置混在一起。
  //   现在：统一进 config\_backup_anglertackle\，并且**只留最近 3 份**（再多也没人翻）。
  const bakDir = path.join(path.dirname(cfgPath), '_backup_anglertackle');
  fs.mkdirSync(bakDir, { recursive: true });
  const bak = path.join(bakDir, path.basename(cfgPath).replace(/\.toml$/, '') + '.bak-' + stamp + '.toml');
  fs.copyFileSync(cfgPath, bak);
  console.log('\n已备份：' + path.join('_backup_anglertackle', path.basename(bak)));
  // 只留最近 3 份（文件名带时间戳，按名字排序就是按时间排）
  const kept = fs.readdirSync(bakDir).filter((f) => f.startsWith('anglertackle-common.bak-')).sort();
  for (const old of kept.slice(0, Math.max(0, kept.length - 3))) {
    try { fs.unlinkSync(path.join(bakDir, old)); } catch (e) { /* 删不掉就算了，不影响本次写入 */ }
  }
  fs.writeFileSync(cfgPath, merged, 'utf8');
  console.log('已补入 ' + missingCount + ' 项到 ' + path.basename(cfgPath)
    + (kept.length > 3 ? '（旧备份已清理，保留最近 3 份）' : ''));
}

// ---------------------------------------------------------------- 5. 复核
const target = OUT || cfgPath;

/** 解析 toml 成 Map<"分组.键", 值原文>。与 Tuning.parseFlatToml 同口径。 */
function readPairs(file) {
  const out = new Map();
  let g = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[') && line.endsWith(']')) { g = line.slice(1, -1).trim(); continue; }
    if (!g || line.startsWith('#') || !line) continue;
    const eq = line.indexOf('=');
    if (eq > 0) out.set(g + '.' + line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

const afterPairs = readPairs(target);
let still = 0;
for (const g of schema.groups) {
  for (const f of g.fields) if (!afterPairs.has(g.id + '.' + f.key)) still++;
}

// 复核"玩家原有的值没被动过"：**逐项按 分组.键 比对**，不能用全局正则找
// "键 = 值" —— 不同分组里有同名键（如各段都有 base），正则只会命中第一个，
// 于是报出一堆假的"丢了"（踩过：35 项全部误报）。
const beforePairs = readPairs(cfgPath);
let changed = 0;
for (const [k, v] of beforePairs) {
  if (!afterPairs.has(k)) {
    console.error('❌ 原有配置项丢失：' + k + ' = ' + v);
    changed++;
  } else if (afterPairs.get(k) !== v) {
    console.error('❌ 原有值被改动：' + k + '  ' + v + ' → ' + afterPairs.get(k));
    changed++;
  }
}

console.log(still ? '❌ 仍有 ' + still + ' 项缺失'
                  : '✅ 复核：全部 ' + schema.groups.reduce((a, g) => a + g.fields.length, 0) + ' 项都在文件里');
console.log(changed ? '❌ 有 ' + changed + ' 处原有配置被动过'
                    : '✅ 复核：原有 ' + beforePairs.size + ' 项逐项未变（含你手改的值）');
process.exit(still || changed ? 1 : 0);
