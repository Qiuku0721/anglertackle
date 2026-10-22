// Tuning.java 的生成块边界与注入 —— **唯一**的读写口径，供三个生成器共用。
//
// ── 为什么必须共用（踩过的坑）────────────────────────────────
// 三个生成器（配件 / 鱼种 / 玩法）都往同一个 Tuning.java 里插 getter 与热重载映射。
// 早先每个脚本各自挑"锚点"：
//   · gen-fish-config 用 `// ==== 热重载` 这行当 getter 锚点
//   · gen-gameplay-config 也用它，而且**把这行连同自己的块一起插回去**
// 结果两边的锚点互相干扰：一个插完，另一个下次就找不到干净锚点，
// 于是重复插入、越跑越长 —— 实测 Tuning.java 涨到 5301 行、同一个块有 7 份。
//
// 现在改成：**模板里预置每个块的落点**（下面 anchorOf 那行注释），
// 各生成器插到自己那个锚点后面即可，与别的块无关。
const fs = require('fs');

/**
 * 各块的标记 + **插入锚点**。
 *
 * ── 为什么改成"锚点行"而不是"插在前一个块之后"────────────────
 * 三个生成器是**三个独立进程**（node gen-part-config.js / gen-fish-config.js / …），
 * 内存状态跨进程就丢了。早先靠"前一个块的 END 标记"定位，就要求前面的块已经存在 ——
 * 而 partsGetter 的前一个块（gameReload）属于另一个生成器，跑本脚本时还没写，
 * 于是"怎么排顺序都会有人报错"。也试过"登记表 + 统一提交"，同样因为跨进程失效。
 *
 * 现在：**模板里预置每个块的落点**（`// @tuning-slot: <id>` 这行注释），
 * 各生成器插到自己锚点之后，与别的块完全无关。模板由
 * tools/make-tuning-template.js 生成，缺哪个锚点它会自动补。
 */
const ANCHOR_PREFIX = '    // @tuning-slot: ';

/** 某个块的锚点行文本。 */
function anchorOf(id) {
  return ANCHOR_PREFIX + id;
}

const SECTIONS = [
  { id: 'partsReload',  begin: '        // ==== BEGIN 配件数值热重载', end: '        // ==== END 配件数值热重载 ====' },
  { id: 'fishReload',   begin: '        // ==== BEGIN 鱼种数值热重载', end: '        // ==== END 鱼种数值热重载 ====' },
  { id: 'gameReload',   begin: '        // ==== BEGIN 玩法数值热重载', end: '        // ==== END 玩法数值热重载 ====' },
  { id: 'partsGetter',  begin: '    // ==== BEGIN 配件数值 getter',  end: '    // ==== END 配件数值 getter ====' },
  { id: 'fishGetter',   begin: '    // ==== BEGIN 鱼种数值 getter',  end: '    // ==== END 鱼种数值 getter ====' },
  { id: 'gameGetter',   begin: '    // ==== BEGIN 玩法数值 getter',  end: '    // ==== END 玩法数值 getter ====' },
  { id: 'partsHelper',  begin: '    // ==== BEGIN 配件数值工具',      end: '    // ==== END 配件数值工具 ====' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 删掉某个块（连标记行一起）。找不到就原样返回。
 *
 * ⚠️ BEGIN 只按**子串**匹配，不能加 `^` 行首锚定 —— 因为曾经出过这样的事故：
 * 插入时忘了在锚点前补换行，结果 BEGIN 标记和 `// ==== 热重载` 挤在同一行：
 *     // ============ 热重载    // ==== BEGIN 玩法数值 getter（…）====
 * 带 `^` 的正则就永远匹配不到 → 删不掉 → 每跑一次多插一份
 *（实测 Tuning.java 涨到 5301 行、同一个块 7 份）。用子串匹配就免疫这种脏格式。
 * END 本来就是独立一行，也一并用子串匹配即可。
 */
function stripSection(text, id) {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error('未登记的 Tuning 块：' + id);
  const re = new RegExp(esc(s.begin) + '[^\\n]*\\n[\\s\\S]*?' + esc(s.end) + '[^\\n]*\\n?');
  if (!re.test(text)) return text;
  return text.replace(re, '');
}

/** 把某个块的所有副本都删掉（历史事故可能留下多份）。 */
function stripAll(text, id) {
  let cur = text, n = 0;
  for (let i = 0; i < 50; i++) {
    const next = stripSection(cur, id);
    if (next === cur) break;
    cur = next; n++;
  }
  return { text: cur, removed: n };
}

/**
 * 写入某个块的内容。
 *
 * 插入位置：该块**自己的锚点行**（`// @tuning-slot: <id>`）之后。
 * 锚点由 tools/make-tuning-template.js 预置在模板里，所以各生成器互不依赖 ——
 * 谁先跑都行，跑几次都一样。
 *
 * 锚点缺失时怎么办：**自动补上**，插在 `// ==== 热重载` 那行之前，
 * 并把锚点写进文件（下次就有了）。这样即使拿到一份没有锚点的老模板也能自愈。
 */
function writeSection(text, id, lines) {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error('未登记的 Tuning 块：' + id);
  let cur = stripAll(text, id).text;

  const block = [s.begin + '（生成，勿手改）====', ...lines, s.end].join('\n') + '\n';
  const anchor = anchorOf(id);

  // 锚点不在就补一个：插在"热重载"那行之前
  if (!cur.includes(anchor)) {
    const hot = '    // ============================================================ 热重载';
    const at = cur.indexOf(hot);
    if (at < 0) throw new Error('Tuning.java 里既没有锚点 ' + anchor + '，也没有热重载标记，无法定位');
    cur = cur.slice(0, at) + anchor + '\n' + cur.slice(at);
  }

  const ai = cur.indexOf(anchor);
  const lineEnd = cur.indexOf('\n', ai) + 1;   // 锚点整行之后
  return cur.slice(0, lineEnd) + block + cur.slice(lineEnd);
}

/** 结构自检：每个块最多一份、BEGIN/END 数量一致、锚点不重复。 */
function checkSections(text) {
  const problems = [];
  for (const s of SECTIONS) {
    const n = text.split(s.begin).length - 1;
    if (n > 1) problems.push(s.id + ' 有 ' + n + ' 份');
    const m = text.split(s.end).length - 1;
    if (m !== n) problems.push(s.id + ' 的 BEGIN/END 数量不等（' + n + '/' + m + '）');
    const a = text.split(anchorOf(s.id)).length - 1;
    if (a > 1) problems.push(s.id + ' 的锚点有 ' + a + ' 个');
  }
  return problems;
}

/**
 * 清空**所有**生成块，只留手写部分。
 *
 * 用途：生成链的起点。历史事故会在 Tuning.java 里积压重复块
 *（实测涨到 5301 行、同块 7 份），光靠"各自删自己那块"清不干净 ——
 * 因为副本之间会互相遮挡。整树清一遍再从零插入，结果只取决于手写部分，
 * 与文件的历史状态无关（和 Config.java 的 peelAll 一个思路）。
 */
function peelAll(text) {
  let cur = text;
  const log = [];
  for (const s of SECTIONS) {
    let n = 0;
    for (let i = 0; i < 50; i++) {
      const next = stripSection(cur, s.id);
      if (next === cur) break;
      cur = next; n++;
    }
    if (n) log.push(s.id + ' ×' + n);
  }
  // 收敛连续空行：每剥一块都会留下它前面的空行
  cur = cur.replace(/\r?\n(?:[ \t]*\r?\n){3,}/g, '\n\n\n');
  return { text: cur, log };
}

module.exports = { SECTIONS, anchorOf, stripSection, stripAll, writeSection, checkSections, peelAll };

// ================================================================ 累积式写入
//
// ── 为什么改成"登记 + 统一提交"────────────────────────────────
// 三个生成器（配件 / 鱼种 / 玩法）各自往 Tuning.java 里写 2~3 个块。
// 而块的位置靠"前一个块的 END 标记"决定 —— 于是要求前面的块**已经存在**。
// 但各生成器只写自己那几块，不可能满足：
//   gen-part-config 想写 partsGetter，它的前一个是 gameReload，
//   而 gameReload 属于 gen-gameplay-config —— 那时还没写。
// 结果是"顺序怎么排都会有人报错"。
//
// 所以改成：各自只**登记**内容，最后由 rebuild-config 统一按 SECTIONS 顺序提交。
// 这样"写什么"和"写在哪"解耦，调用顺序不再重要。
const pending = new Map();

/** 登记某个块的内容（可重复调用，后一次覆盖前一次）。 */
function stageBlock(id, lines) {
  if (!SECTIONS.some((x) => x.id === id)) throw new Error('未登记的 Tuning 块：' + id);
  pending.set(id, lines);
}

/** 之前是否登记过（用于"生成器没跑"的提示）。 */
function stagedCount() {
  return pending.size;
}

/**
 * 把登记过的块按 SECTIONS 顺序写入 Tuning.java。
 *
 * @param text 当前 Tuning.java 内容（会先 peelAll 清空所有生成块）
 * @param opts.fishSpeciesOptional 允许缺少 fish* 块（某些路径不生成鱼种配置）
 */
function commitBlocks(text, opts = {}) {
  const r = peelAll(text);
  let cur = r.text;
  const missing = [];
  for (const s of SECTIONS) {
    const lines = pending.get(s.id);
    if (!lines) { missing.push(s.id); continue; }
    // 前面的块一定已写（按 SECTIONS 顺序遍历），所以这里不会退化
    cur = writeSection(cur, s.id, lines);
  }
  const problems = checkSections(cur);
  if (problems.length) throw new Error('Tuning.java 生成块结构异常：' + problems.join('；'));
  return { text: cur, peeled: r.log, missing };
}

module.exports.stageBlock = stageBlock;
module.exports.stagedCount = stagedCount;
module.exports.commitBlocks = commitBlocks;
