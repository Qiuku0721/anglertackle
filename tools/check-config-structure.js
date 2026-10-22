/*
 * check-config-structure.js —— Config.java / Tuning.java 的**生成块结构**是否完整。
 *
 * 触发理由：写追踪罗盘时加了一个配置项，跑 `rebuild-config.js --check` 发现
 * `push/pop 深度结束时为 1` —— Config.java 里有 **13 个 `push("...")` 却只有 12 个 `b.pop()`**。
 *
 * 根因是 `gen-gameplay-config.js` 会**累积**：它剥掉「玩法数值定义」块主体，
 * 却没剥块前面那段页眉（分组注释 + `push("gameplay")`），重新注入时又写了一遍。
 * 于是每跑一次 `--write` 就多留一份孤立的页眉，而 pop 只有一个。
 *
 * 这个 bug 最坏的地方是**它不报错**：
 *   - 游戏照常启动、配置照常读；
 *   - TOML 里分组层级悄悄错位（后面的分组被挤到下一层），玩家只会觉得"分组怪怪的"；
 *   - 原有的守卫只断言"BEGIN 标记有 1 份"，而标记数一直是 1 —— 一路绿灯。
 *
 * 而 `rebuild-config.js --check` **能**发现它，但那一步当时不在构建闸门里
 * （它不叫 check-*.js，所以不在"全跑一遍"的名单里）。
 * 所以这个脚本的作用就是把那条判据接进闸门。
 *
 * 用法：node tools/check-config-structure.js
 */
const fs = require('fs');
const path = require('path');
const G = require('./generated-blocks.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const J = 'src/main/java/com/whitecobalt/anglertackle/';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 配置生成块结构检查 ===\n');

// ---------------------------------------------------------------- ① 每个生成块恰好 1 份
const cfg = read(J + 'Config.java');
for (const b of G.BLOCKS) {
  let n;
  try { n = G.countBlock(cfg, b.name); } catch (e) { bad('数不了块 ' + b.name + '：' + e.message); continue; }
  if (n === 1) ok('块「' + b.name + '」恰好 1 份');
  else bad('块「' + b.name + '」出现 ' + n + ' 次（应为 1）—— 生成器重复注入或没剥干净');
}

// ---------------------------------------------------------------- ② push/pop 收支
{
  const nPush = (cfg.match(/\.push\("/g) || []).length;
  const nPop = (cfg.match(/^\s*b\.pop\(\);\s*$/gm) || []).length;
  if (nPush === nPop) {
    ok('push/pop 收支平衡（各 ' + nPush + ' 次）');
  } else {
    bad('push/pop 收支不平：' + nPush + ' 推 / ' + nPop + ' 弹（差 ' + (nPush - nPop) + '）—— '
      + '多出来的 push 会让它**后面所有分组**都嵌到下一层。游戏不报错，只是 TOML 层级错位');
  }
  // 每个 push 的分组名都必须唯一 —— 重复的分组名正是"页眉被重复注入"的指纹
  const names = [...cfg.matchAll(/\.push\("([\w]+)"\)/g)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length === 0) ok('分组名无重复（' + names.length + ' 个分组）');
  else bad('分组名重复：' + [...new Set(dup)].join(', ')
    + ' —— 生成器的页眉没剥干净（每次 --write 都会多留一份）');
}

// ---------------------------------------------------------------- ③ 文本块必须成对
//
// ★ 2026-10-01 补这条的**直接原因**：两个进程同时写 Config.java，把几处页眉的
//   `b.comment("""` 开头删掉了，只剩下 `""").push("xxx");` 收尾。
//   后果**不是** push/pop 不平（收尾里的 push 还在，②照样全绿），而是：
//     · 某个中文说明段变成了裸在方法体里的代码 → javac 一口气报 100 个
//       `非法字符: '\u3002'` / `文本块起始分隔符序列非法，缺少行终止符`；
//     · 逐块看都很"合法"（19 个三引号、9 个收尾），只有**成对性**能一眼看出来。
//
// 判据：`"""` 的总数必须是偶数；每个文本块的收尾后面只能跟两种东西之一 ——
//   · `""").push("分组")`   → 分组页眉（有几组就该有几个）
//   · `""")` + `.define/…`  → 单个配置项的说明（2026-10-01 起允许，见下）
//
// ⚠ 曾经这里写的是「q/2 == `""").push("` 的个数」，前提是"Config.java 里每个文本块
//   都是分组页眉"。加了对抗期相机那 3 个配置项之后这个前提不成立了 ——
//   它们的 `.comment("""…""")` 后面跟的是 `.define(...)` 而不是 `.push(`，
//   于是检查器开始**误报**"3 处页眉被拆散"。
//   那次是**断言的前提过期**，不是代码坏了：所以改判据（按收尾分类），
//   而不是把配置项的说明改成单行字符串去迁就检查器 —— 后者是让代码为检查器让路。
{
  const q = (cfg.match(/"""/g) || []).length;
  if (q % 2 !== 0) {
    bad('Config.java 的文本块三引号是奇数个（' + q + '）—— 有一处 `b.comment("""` 或 `""")` 被删掉了。'
      + 'javac 会报一串"非法字符: \\uXXXX"，而那些字符其实是中文说明');
  } else {
    // 每个收尾 `""")` 的**下一行**长什么样，决定了它是页眉还是配置项说明
    const closes = [...cfg.matchAll(/"""\)\s*\n?\s*(\.\w+)/g)].map((m) => m[1]);
    const headers = closes.filter((x) => x === '.push').length;
    const valueComments = closes.filter((x) => x === '.define' || x === '.defineInRange').length;
    const groups = (cfg.match(/"""?\)\.push\("/g) || []).length;
    if (closes.length !== q / 2) {
      bad('Config.java 有 ' + (q / 2) + ' 个文本块，但只认出 ' + closes.length +
        ' 个收尾 —— 有 ' + (q / 2 - closes.length) + ' 处文本块的 `""")` 收尾被拆散了'
        + '（收尾后面必须是 `.push(` 或 `.define(` / `.defineInRange(`）');
    } else if (headers !== groups) {
      bad('页眉数（' + headers + '）与 push 分组数（' + groups + '）不一致 —— ' +
        '生成器的页眉没剥干净，或有一处页眉的开头/收尾被拆散了');
    } else if (headers + valueComments !== q / 2) {
      bad('有 ' + (q / 2 - headers - valueComments) + ' 个文本块的收尾既不是 `.push(` ' +
        '也不是 `.define(`/`.defineInRange(` —— 这类收尾长什么样要看清楚再判断');
    } else {
      ok('文本块成对（' + (q / 2) + ' 个：' + headers + ' 个分组页眉 + ' +
        valueComments + ' 个配置项说明）');
    }
  }
  // 同一判据也用在 Tuning.java 上（它也由生成器拼装）
  const t = read(J + 'fishing/Tuning.java');
  const tq = (t.match(/"""/g) || []).length;
  if (tq % 2 !== 0) bad('Tuning.java 的文本块三引号是奇数个（' + tq + '）—— 同上');
  else ok('Tuning.java 文本块三引号成对（' + tq + ' 个）');
}

// ---------------------------------------------------------------- ④ checkStructure 的原始判据
for (const [label, rel] of [['Config.java', J + 'Config.java'], ['Tuning.java', J + 'fishing/Tuning.java']]) {
  const s = G.checkStructure(read(rel));
  if (s.ok) ok(label + ' 结构自检通过（push/pop 深度收在 0）');
  else bad(label + ' 结构自检失败：' + s.problems.join('；'));
  if (s.nDefine > 0) ok(label + ' 有 ' + s.nDefine + ' 个 defineInRange');
}

// ---------------------------------------------------------------- ④ Tuning 的分段
{
  const TS = require('./tuning-source.js');
  const problems = TS.checkSections(read(J + 'fishing/Tuning.java'));
  if (problems.length === 0) ok('Tuning.java 的分段标记（BEGIN/END 对）都成对');
  else bad('Tuning.java 分段异常：' + problems.join('；'));
}

// ---------------------------------------------------------------- ⑤ 项数
{
  const s = G.checkStructure(cfg);
  const n = s.nDefine + s.nDefineBool;
  const itemSrc = read(J + 'registry/ModItems.java');
  // 只做粗略的下界断言。精确数量在 rebuild-config.js 的 EXPECT_DEFINE 里守 ——
  // 这里重复一份数字只会带来"两处都要改"的维护负担。
  if (n >= 400) ok('Config.java 里 defineInRange/define 共 ' + n + ' 处（量级正常）');
  else bad('Config.java 只有 ' + n + ' 个 define —— 生成块多半被剥掉了没注入回来');
  if (/ITEMS\.register/.test(itemSrc)) ok('ModItems.java 可读，物品注册表正常');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  为什么值得单独一个检查：');
console.log('    这类"生成块结构坏掉"的问题**在游戏里全都不报错** ——');
console.log('    启动正常、配置能读、改值也生效，坏的只是 TOML 的分组层级。');
console.log('    唯一能挡住它的是结构自检，而结构自检必须在闸门里才会被执行。');
process.exitCode = fail === 0 ? 0 : 1;
