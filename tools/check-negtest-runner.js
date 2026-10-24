'use strict';
/**
 * check-negtest-runner.js —— 守住**负例执行器**本身（2026-10-12 新增）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * `tools/_negrun.js` 现在是"检查器能否被证伪"这条链上的**执行者**。它自己坏掉的症状
 * 全都**看起来像全绿**：
 *   ① 用 `stdio: 'pipe'` 抓输出 ⇒ 沙箱下 EPERM，子进程根本没跑起来，`exitCode` 是 `null`；
 *      若把 `null` 当"非零退出"，就会把**没跑的用例报成"变异被抓到"** ✗（本仓库踩过）；
 *   ② 没了"对照组为 0 就报错" ⇒ 检查器写错时整批用例静默放行；
 *   ③ 没了"过滤后为空退出码 2" ⇒ `--filter` 打错一个字，输出"全部通过" ✗；
 *   ④ `negtest.ps1` 不再调用它 ⇒ 那段断言悄悄退回从来没跑过（等于没有负例）。
 *
 * ── 判据（六条）──────────────────────────────────────────────
 *   A. `tools/_negrun.js` 存在，且 `tools/negtest.ps1` **真的调用**它（不是留个孤儿文件）
 *   B. **不许出现 `stdio: 'pipe'`**（沙箱会 EPERM）；只允许 `ignore` / `inherit`
 *   C. "没跑起来"必须被识别：源码里要有 `signal` / `exitCode === null` 这类判断，
 *      且**不能**写成 `code !== 0 就算抓到`
 *   D. 三条自检都在：对照组为 0 ⇒ exit 2；过滤为空 ⇒ exit 2；返回码 = 不符用例数
 *   E. 并发度可配（`--jobs`），且**建副本那一步仍是单进程**（不变式：同一时刻只有一个
 *      进程在写 build\negtest）—— `negtest.ps1` 里不许并行起两个 `_negtest.js`
 *   F. `.ps1` 的 BOM 检查仍然覆盖 negtest.ps1（由 check-ps1-encoding.js 负责，这里只做交叉引用断言）
 *
 * 用法：node tools/check-negtest-runner.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const RUNNER = 'tools/_negrun.js';
const PS1 = 'tools/negtest.ps1';

console.log('=== 负例执行器检查（_negrun.js / negtest.ps1） ===\n');

if (!exists(RUNNER)) {
  console.error('❌ 缺 ' + RUNNER + ' —— 负例执行器没了');
  process.exit(1);
}
const runner = read(RUNNER);
// ⚠ 扫 negtest.ps1 之前**必须剥掉整行注释**：头部注释里就写着"做法：node tools\_negtest.js 先造副本…"
//   —— 不剥的话"调用了几次"会数成 2 次（假红）。本仓库的老教训：注释里恰恰在解释那件事。
const ps1 = read(PS1)
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

// ---------------------------------------------------------------- A. 接线
//
// ⚠ 判据必须**盯住调用本身**，不能只搜 "_negrun.js 这个名字在不在文件里"：
//   第一次写这条时只搜名字，结果负例 `negrun-unwired`（把 `& node @runnerArgs` 换成一句
//   Write-Host）**照样通过** —— 因为上面组装参数那一行 `@((Join-Path $PSScriptRoot '_negrun.js'), …)`
//   还在，名字仍在文件里 ✗。这与今天早些时候 `copyOnDeath` 那次是**同一个错误**：
//   "文件里存在某字符串"不等于"那件事真的在做"。
{
  const buildsArgs = /_negrun\.js/.test(ps1);
  const invokes = /&\s*node\s+@runnerArgs/.test(ps1);
  if (buildsArgs && invokes) {
    ok('negtest.ps1 真的把执行器**调起来**了（`& node @runnerArgs`）');
  } else if (buildsArgs) {
    bad('negtest.ps1 里出现了 _negrun.js，但**没有任何地方真的调用它** —— '
      + '那段断言等于没跑（负例 negrun-unwired 就是抓这个）');
  } else {
    bad('negtest.ps1 没有调用 _negrun.js —— 那段断言等于没跑');
  }
}

// ---------------------------------------------------------------- B. 不许用管道
{
  const pipe = /stdio:\s*'pipe'/.test(runner) || /stdio:\s*"pipe"/.test(runner);
  const ignore = /stdio:\s*capture\s*\?\s*'inherit'\s*:\s*'ignore'/.test(runner)
    || (/stdio:\s*'ignore'/.test(runner) && /stdio:\s*'inherit'/.test(runner));
  if (pipe) {
    bad("_negrun.js 里出现了 stdio: 'pipe' —— 沙箱下子进程会 EPERM，"
      + '而"没跑起来"会被误报成"变异被抓到" ✗');
  } else if (!ignore) {
    bad("_negrun.js 里找不到 stdio 'ignore'/'inherit' —— 它到底怎么起子进程的？");
  } else {
    ok("只用 stdio 'ignore' / 'inherit'（不用管道，沙箱允许）");
  }
}

// ---------------------------------------------------------------- C. "没跑起来"必须被识别
{
  const hasSignal = /signal/.test(runner) && /exitCode|code === null|code\s*===\s*null/.test(runner);
  const hasErrorHook = /on\('error'/.test(runner);
  if (hasSignal && hasErrorHook) {
    ok('"没跑起来"（信号终止 / spawn error）被单独识别，不当作"抓到了"');
  } else {
    bad('_negrun.js 没把"没跑起来"与"检查器失败"分开 —— 这正是最危险的自欺路径 ✗');
  }
  if (/实际 .*（没跑起来/.test(runner) || /没跑起来/.test(runner)) {
    ok('报错文案里明确写了"没跑起来"（看日志的人不用猜）');
  } else bad('报错文案没区分"没跑起来"');
}

// ---------------------------------------------------------------- D. 三条自检
{
  const guards = [
    ['对照组为 0 时直接报错', /controls === 0/.test(runner) && /process\.exit\(2\)/.test(runner)],
    ['过滤后为空退出码 2', /all\.length === 0/.test(runner) && /process\.exit\(2\)/.test(runner)],
    ['返回码 = 不符合预期的用例数', /process\.exit\(fail\)/.test(runner)],
  ];
  for (const [name, present] of guards) {
    if (present) ok('自检在：' + name);
    else bad('缺自检：' + name);
  }
}

// ---------------------------------------------------------------- E. 并发只加在断言阶段
//
// ⚠ `neCalls` / `buildCalls` 提到块外：G 段（锚点预检的接线与顺序）也要用它们。
//   块内 `const` 在块外不可见 —— 第一版就因此在 G 段抛了 ReferenceError
//   （而那不是"检查器报红"，是检查器自己崩了 ⇒ 整条闸会以"未预期的异常"收场 ✗）。
const neCalls = [...ps1.matchAll(/^.*_negtest\.js.*$/gm)].map((m) => m[0]);
const buildCalls = neCalls.filter((l) => !/--check-anchors/.test(l));
{
  if (/--jobs/.test(runner) && /JOBS/.test(runner)) ok('并发度可配（--jobs，默认 4）');
  else bad('_negrun.js 没有可配的并发度');
  // ⚠ **同一个检查器的多个用例不许并发**：检查器脚本里可能有"共享临时文件"（check-environment.js
  //   就会写一个自检结果文件，而那个路径在所有副本里是同一个）—— 并发跑同一个检查器的两条用例
  //   会互相删文件 ⇒ **对照组假失败**（2026-10-12 闸里真红过，见那份日志）。
  const grouped = /groups\.set\(k,\s*\[\]\)/.test(runner) && /for \(const i of g\[1\]\)/.test(runner);
  if (grouped) ok('按 checker 分组、**组内串行**（同一检查器的用例永不并发）✓');
  else bad('_negrun.js 没有"按 checker 分组、组内串行" —— 共享临时文件的检查器会互相踩 ✗');
  // 建副本必须是单进程：negtest.ps1 里对 _negtest.js 的**建副本**调用只能有一次
  // （⚠ 2026-10-12 加锚点预检后，文件里 `_negtest.js` 会出现**两次** ——
  //  一次是 `--check-anchors` 预检、一次才是建副本。所以判据必须按"有没有 --check-anchors"
  //  分开数，不能数全文件出现次数：那样一加预检就假红 ✗）
  const parallelBuild = /Start-Process[\s\S]{0,200}_negtest\.js/.test(ps1);
  if (parallelBuild) {
    bad('negtest.ps1 用 Start-Process 并行起 _negtest.js —— 两个进程同时清空/重建副本目录会互相拆台 ✗'
      + '（AGENTS.md §三 那条规则针对的就是这个）');
  } else if (buildCalls.length !== 1) {
    bad('negtest.ps1 里**建副本**（不带 --check-anchors 的调用）出现了 ' + buildCalls.length
      + ' 次 —— 建副本必须只有一处、单进程');
  } else {
    ok('建副本只有一处入口（negtest.ps1 只调一次）✓');
  }

  // ---------------------------------------------------------------- 建副本的"内部并发"（2026-10-12）
  //
  // 上面那条不变式的**准确表述**是"同一时刻只有一个进程在**清空/重建**副本目录"。
  // 2026-10-12 提速时把"建副本"这一步在**同一个父进程**内部切成 N 片并发（--shard k/N），
  // 清目录也只由父进程调度一次（--purge k/N 只删自己那一片的顶层条目）——
  // 这不违反不变式（仍然是"一次构建"，子进程互不写对方的树），但**必须守住四条**：
  //   ① 分片模式不许碰 manifest.json（各写分片，父进程合并，顺序按 CASES）；
  //   ② 子进程不许自己清目录；
  //   ③ 子进程只能用 stdio inherit/ignore（沙箱禁管道）；
  //   ④ 硬链接写穿防护必须在：writeInCopy 先 unlink 再写 + 建完复核真源码指纹。
  // 为什么最后一条最要紧：硬链接与真源码共享 inode，直接 writeFileSync 会**改坏真仓库**
  // 且不报错 —— 那是这条链上最贵的错误。
  {
    // ⚠ 必须**剥注释**再判"有没有用管道"：`_negtest.js` 的注释里**正是在解释**
    //   "沙箱禁 pipe、所以用 inherit/ignore" —— 不剥就会拿自己的说明文字把自己判红 ✗
    //   （这个仓库为"注释里提到某个名字"误报过好多次，最近一次是 ClientEvents 的 Z 键）。
    const { stripComments } = require('./java-source.js');
    const ne = stripComments(read('tools/_negtest.js'));
    const shard = /--shard/.test(ne) && /manifest-shard-/.test(ne) && /--purge/.test(ne);
    const order = /CASES\.map\(\(c\) => byDir\.get\(c\.dir\)\)/.test(ne);
    // ⚠ 判据要盯**真的 spawn 调用**，不能全文件搜 `stdio: 'pipe'`：
    //   `_negtest.js` 里有一个负例用例，它的**替换文本**正是 `"stdio: 'pipe',"`（用来把
    //   _negrun.js 改坏）—— 全文件搜就会拿那句字符串把自己判红 ✗。
    //   （这是"注释/字符串里提到坏写法"的第 N 次：判据必须限定在**调用点**附近。）
    const spawnPipes = [...ne.matchAll(/spawn\([\s\S]{0,220}?stdio:\s*'([a-z]+)'/g)].map((m) => m[1]);
    const inherit = spawnPipes.length > 0 && spawnPipes.every((s) => s === 'inherit' || s === 'ignore');
    // ⚠ 判据要盯**函数体的第一条语句**，不能只搜"文件里有没有 rmSync"：
    //   把它套进 `if (false) { ... }` 之后字符串还在 ⇒ 只搜字符串照样绿 ✗
    //   （负例 link-write-through 第一次跑就是这么溜过去的 —— 同一天里第 N 次
    //    "文件里存在某字符串" ≠ "那件事真的在做"）。
    const wic = /function writeInCopy\(dst, data\)\s*\{([\s\S]*?)\n\}/.exec(ne);
    const wicBody = wic ? wic[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')) : [];
    // ⚠ 指纹名单必须覆盖 FILES **和** EXTRA **和** BIN_FILES：
    //   2026-10-12 只盖 FILES 的那一版漏掉了 EXTRA 里的贴图，结果真 `pike.png`
    //   被硬链接写穿涂成全透明而**没人发现**（是 check-fish-model 的对照组红的）。
    const fp = /function sourceFingerprint\(\)\s*\{([\s\S]*?)\n\}/.exec(ne);
    const fpBody = fp ? fp[1] : '';
    const fpWide = /new Set\(FILES\)/.test(fpBody)
      && /Object\.values\(EXTRA\)\.flat\(\)/.test(fpBody)
      && /BIN_FILES/.test(fpBody);
    const pngWriter = /writeInCopy\(file, Buffer\.concat\(\[/.test(ne);
    const guard = wic
      && /^fs\.rmSync\(dst, \{ force: true \}\);/.test(wicBody[0] || '')
      && fpWide
      && pngWriter
      && /function assertSourceIntact/.test(ne)
      && /assertSourceIntact\(srcBefore\)/.test(ne);
    const noBareWrite = !/fs\.writeFileSync\(p, buf\.subArray|fs\.writeFileSync\(p, buf\.subarray/.test(ne);
    const shardNoPurge = !/if \(IS_SHARD\)\s*purgeDir/.test(ne);
    if (!shard) {
      bad('_negtest.js 里没有分片建副本（--shard / manifest-shard / --purge 三样缺一）'
        + ' —— 这条断言要跟着改；建副本现在应该能在**同一个父进程**下并发');
    } else if (!order) {
      bad('合并分片清单时没有按 CASES 顺序重排 —— 日志与实际用例顺序会对不上');
    } else if (!inherit) {
      bad('_negtest.js 用了 stdio: \'pipe\' —— 沙箱会直接 EPERM（子进程根本没跑起来）');
    } else if (!guard) {
      bad('缺"硬链接写穿"防护：必须 writeInCopy() 先 unlink 再写，并在建完复核真源码指纹 ✗'
        + '（穿透了就是把真仓库改坏，而且不报错）');
    } else if (!noBareWrite || !shardNoPurge) {
      bad('还有绕过 writeInCopy 的裸写 / 分片进程自己清目录 —— 两者都会毁掉不变式');
    } else {
      ok('建副本可并发（分片各自成树、父进程按 CASES 顺序合并、stdio 不开管道、'
        + '硬链接写穿有防护 + 真源码指纹复核）✓');
    }
  }
}

// ---------------------------------------------------------------- G. 锚点预检（2026-10-12）
//
// 为什么要守它：预检是**负例自己的守门人** —— 锚点失配时它是唯一能在两秒内说出
// "哪几条的锚点没了"的东西。它一旦被摘掉（或挪到建副本之后），症状会退回
// "造副本阶段一句「负例构造失败」+ 闸报「存在漏检的检查脚本」"那种误导现场 ✗
// （2026-10-12 为此栽了三次：`"send");`、`**签收那一刻起…**`、改写邮件短句那次）。
//
// 两条判据：
//   ① **接线与顺序**：`negtest.ps1` 里要有一次 `--check-anchors` 调用，且必须**在建副本之前**；
//   ② **真的跑得起来**（行为判据，不是搜字符串）：在副本里实跑一次
//      `node tools/_negtest.js --check-anchors`，退出码 0 且报出"500+ 条锚点全解析"。
//      为什么非要有②：预检**自己**也会写错 —— 第一版访问器直接摊平 `[...FILES, ...EXTRA]` 数组，
//      而 FILES 里同一路径列了多次（对象键天然去重，数组不会）⇒ 388 条用例被误报成
//      "文件名有歧义" ✗。只搜"--check-anchors 在不在脚本里"是抓不到这种错的
//      （本仓库的老教训：文件里存在某字符串 ≠ 那件事真的在做）。
//      ⚠ 副本里预检**可能**报"负例构造失败"若干条：改 `negtest.ps1` 的负例会让"以 ps1 那行
//      为锚点"的另一条用例串扰（实测 2 条）。那是预期内的，所以判据落在
//      "有没有'有歧义 / 找不到文件'"与"失败条数是否多到不可能是串扰"上（细节见下面那段注释）。
{
  const preLines = neCalls.filter((l) => /--check-anchors/.test(l));
  // ⚠ 顺序必须按**行号**比，不能 `ps1.indexOf(那一行)`：
  //   预检那行是 `& node (Join-Path $PSScriptRoot '_negtest.js') --check-anchors`，
  //   它**以建副本那一行为前缀** ⇒ indexOf(建副本行) 会先命中预检那行，
  //   于是"预检在建副本之前"被误判成"之后"（这条断言第一次跑就假红了）。
  const ps1Lines = ps1.split('\n');
  const preIdx = ps1Lines.findIndex((l) => /_negtest\.js/.test(l) && /--check-anchors/.test(l));
  const buildIdx = ps1Lines.findIndex((l) => /_negtest\.js/.test(l) && !/--check-anchors/.test(l));
  if (preLines.length !== 1) {
    bad('negtest.ps1 里 `--check-anchors` 预检调用了 ' + preLines.length + ' 次 —— 应当恰好一次'
      + '（它的作用就是在建副本之前先指名道姓地报出"哪几条负例的锚点没了"）');
  } else if (!(preIdx >= 0 && buildIdx >= 0 && preIdx < buildIdx)) {
    bad('锚点预检排在**建副本之后**（预检在第 ' + (preIdx + 1) + ' 行、建副本在第 '
      + (buildIdx + 1) + ' 行）—— 那它就只能事后报到，白等三四分钟才看到同一句话 ✗');
  } else {
    ok('锚点预检接在闸上，且在**建副本之前**（第 ' + (preIdx + 1) + ' 行 vs 第 '
      + (buildIdx + 1) + ' 行）✓');
  }

  // 行为判据：在**副本里**实跑一次预检（副本的 _negtest.js 就是本条负例改过的那份）。
  // ⚠ 输出**收进文件**而不是走管道：沙箱禁的是 `stdio: 'pipe'`（命名管道 EPERM），
  //   把 stdout/stderr 指到一个文件描述符是允许的 ✓
  const { spawnSync } = require('child_process');
  const outDir = path.join(ROOT, 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'anchor-preflight.log');
  const fd = fs.openSync(outFile, 'w');
  let r;
  try {
    r = spawnSync(process.execPath, [path.join(ROOT, 'tools', '_negtest.js'), '--check-anchors'],
      { cwd: ROOT, stdio: ['ignore', fd, fd], windowsHide: true });
  } finally {
    fs.closeSync(fd);
  }
  const log = fs.readFileSync(outFile, 'utf8');
  // ⚠ 跳过行也带「←」，必须先摘出来：它们是**可选文件缺失**的说明，不是锚点失配。
  //   （P4b 的规则：允许缺失的可选文件 —— 不静默、不判红；见下面那一节。）
  const logLines = log.split('\n');
  const skipLines = logLines.filter((l) => /⊘/.test(l));
  if (r.error) {
    bad('预检根本起不来（spawn 失败：' + r.error.message + '）—— 注意要抛出来，不许当成"跑过了"');
  } else if (r.status === 0) {
    const m = /✅ 负例锚点预检通过（(\d+) 条/.exec(log);
    if (!m) {
      bad('预检退出码 0，但输出里没有"✅ 负例锚点预检通过（N 条）"—— 它可能一条都没查就退出了 ✗');
    } else if (Number(m[1]) < 300) {
      bad('预检只查了 ' + m[1] + ' 条锚点（全仓 500+ 条）—— 用例集合被谁掏空了 ✗');
    } else {
      ok('预检在副本里真的跑通了（' + m[1] + ' 条锚点全解析、退出码 0）✓');
    }
  } else {
    // ⚠ 非零退出**不能一律报红** —— 这里有个真实的串扰，写清楚免得下一个人误判：
    //   预检查的是**全仓 500+ 条**用例的锚点，而副本里 `negtest.ps1`（或别的源码）已经被
    //   **这一条负例**改过了。于是"以 ps1 那行为锚点"的另一条用例会在这里报
    //   「负例构造失败」—— 那是**预期内**的串扰（实测：改 ps1 的两条用例各串扰 2 条），
    //   不是预检坏了。真正不能容忍的是**预检自己**的解析错：
    //   · "文件名 X 有歧义" —— 重复路径没去重（见负例 negrun-anchor-no-dedupe，实测 118 条）；
    //   · "找不到文件"     —— 键集合与建副本时不一致。
    //   所以判据是：**出现这两类就报红**，或者失败条数多到不可能是串扰（> 5 条）也报红。
    const wrong = logLines.filter((l) => /有歧义|找不到文件/.test(l) && !/⊘/.test(l));
    const fails = logLines.filter((l) => l.includes('←') && !/⊘/.test(l));
    if (wrong.length) {
      bad('预检在副本里报「' + wrong[0].trim().slice(0, 90) + '」等 ' + wrong.length
        + ' 条 —— 这是预检**自己**的解析错（重复路径没去重 / 路径找不到）✗');
    } else if (fails.length > 5) {
      bad('预检在副本里报了 ' + fails.length + ' 条锚点失配 —— 这已经不像"本条负例改了一处"的串扰，'
        + '更像预检自己坏了 ✗');
    } else {
      ok('预检在副本里报了 ' + fails.length + ' 条「负例构造失败」—— 那是本条负例改了 negtest.ps1 '
        + '造成的**预期内串扰**（其余锚点全解析）；没有"有歧义/找不到文件"这类预检自身的错 ✓');
    }
  }

  // ---- 允许缺失的可选文件（2026-10-24 P4b）--------------------------------
  //
  // 规则（用户口径）：FILES 里可以列**本机才有的**夹具 —— .gitignore 的
  // 工具/输入法锁定/*.bat、参考资料/鱼图/_baseline、fish_research/，以及构建产物 tuner.html。
  // 缺失时：
  //   · copier 跳过并打印「以下 FILES 在本机不存在…」；
  //   · 用例用 at.skip() 主动声明"这条跑不了"，预检打「⊘ … 跳过」并**不计入失败**；
  //   · 父进程按「清单 + 跳过 == 全部用例」核对，丢用例/分片崩掉仍然报错。
  // 这里做行为判据：本机缺哪个夹具，预检日志里就必须有对应用例的「⊘ … 跳过」。
  {
    const OPTIONAL = [
      ['工具/输入法锁定/编译.bat', 'ps1enc-bat-chinese'],
      ['工具/输入法锁定/开机自启.bat', 'ps1enc-bat-bom'],
      ['tuner.html', 'tuner-revert-broken'],
      ['参考资料/鱼图/_baseline/arapaima.json', 'fishtex-baseline-drift'],
      ['fish_research/jewel_cichlid.json', 'fishnames-jewel-old'],
      ['fish_research/electric_eel.json', 'fishnames-electric-naked'],
    ];
    const missingHere = OPTIONAL.filter(([rel]) => !exists(rel));
    if (missingHere.length === 0) {
      ok('本机可选夹具齐全（' + OPTIONAL.length + ' 个）—— 这一节没有需要跳过的用例');
    } else {
      const notSkipped = missingHere.filter(([rel, dir]) => !skipLines.some((l) => l.includes(dir)));
      if (notSkipped.length) {
        bad('这些用例的夹具本机不存在，但预检没有报「跳过」：'
          + notSkipped.map(([rel, dir]) => dir + '（缺 ' + rel + '）').join('、')
          + ' —— 应当 at.skip() 跳过并说明，不许静默、也不许判红');
      } else {
        ok('可选文件缺失的 ' + missingHere.length + ' 条用例被**跳过并说明**'
          + '（⊘ 行，不计入失败）');
      }
    }
  }
}


// ---------------------------------------------------------------- F. 文档要说清"现在为什么能并发"
{
  if (/AGENTS\.md/.test(runner) || /AGENTS\.md/.test(ps1)) {
    ok('执行器/脚本里写明了与 AGENTS.md §三 那条并发规则的关系');
  } else {
    bad('没写清它与"负例不许并发"那条规则的关系 —— 下一个人会以为规则被违反了 ✗');
  }
}

// ---------------------------------------------------------------- H. "可选文件跳过"的实现（P4b）
//
// 只靠上面那条**行为**判据不够：本机夹具齐全时它是空转的（vacuously true）。
// 这里再盯一遍实现本身，确保规则不是"这台机器恰好没触发"才通过的。
{
  const { stripComments } = require('./java-source.js');
  const ne2 = stripComments(read('tools/_negtest.js'));
  const parts = [
    ['跳过信号 skipCase(reason, kind)/caseSkipped',
      /function skipCase\(reason,\s*kind\)/.test(ne2) && /caseSkipped/.test(ne2)],
    ['访问器暴露 at.skip(reason, kind)',
      /skip:\s*\(reason,\s*kind\)\s*=>\s*skipCase\(reason,\s*kind\)/.test(ne2)],
    ['跳过按三类记录（optional / env / invalid）',
      /caseSkipKind/.test(ne2) && /'optional'/.test(ne2) && /'env'/.test(ne2) && /'invalid'/.test(ne2)],
    ['夹具探测 at.exists（缺才跳，不看副本）',
      /exists:\s*\(rel\)\s*=>\s*fs\.existsSync\(path\.join\(ROOT,\s*rel\)\)/.test(ne2)],
    ['预检把"跳过"与"构造失败"分开', /err\.caseSkipped\)\s*skipped\.push/.test(ne2)
      && /caseSkipKind/.test(ne2)],
    ['建副本把"跳过"与"构造失败"分开', /err\.caseSkipped\)\s*\{[\s\S]{0,900}?continue;/.test(ne2)],
    ['父进程按「清单 + 跳过 == 全部用例」核对', /merged\.length \+ skipped\.length !== CASES\.length/.test(ne2)],
    ['copier 缺文件时打印说明（不静默）', /以下 FILES 在本机不存在，建副本时跳过/.test(ne2)],
    ['分片也写跳过清单', /skipped-shard-/.test(ne2)],
    ['父进程持久化 skipped.json（最终汇总据此分类）', /skipped\.json/.test(ne2)],
  ];
  const missingParts = parts.filter(([, present]) => !present).map(([name]) => name);
  if (missingParts.length) {
    bad('可选文件跳过机制缺了：' + missingParts.join('、')
      + '（缺一样就会退回"静默跳过"或"缺文件就当失败"）');
  } else {
    ok('可选文件跳过机制完整（' + parts.length + ' 项：信号/分类/探测/预检/建副本/合并核对/说明/分片清单/持久化）');
  }

  // 最终汇总（P5b）：_negrun.js 必须把 skipped.json 按 kind 分桶，并**单列失效跳过**。
  // 这条守的是用户口径"不能混进普通跳过"——只写三行打印、不分类也算没做到。
  {
    const runner2 = stripComments(read(RUNNER));
    const sumParts = [
      ['最终汇总读 skipped.json', /skipped\.json/.test(runner2)],
      ['按 kind 分桶（env / invalid / optional）',
        /buckets\s*=\s*\{\s*env:\s*\[\],\s*invalid:\s*\[\],\s*optional:\s*\[\]\s*\}/.test(runner2)],
      ['单列失效跳过', /失效跳过/.test(runner2)],
      ['单列环境跳过', /环境跳过/.test(runner2)],
      ['普通跳过单独列出', /普通跳过/.test(runner2)],
    ];
    const missingSum = sumParts.filter(([, present]) => !present).map(([name]) => name);
    if (missingSum.length) {
      bad('最终跳过汇总缺了：' + missingSum.join('、')
        + ' —— 用户要求"因失效而跳过的条数单列，不能混进普通跳过"');
    } else {
      ok('最终汇总按 kind 分桶并单列"失效跳过"（' + sumParts.length + ' 项）✓');
    }
  }
}

console.log('');
if (fail) {
  console.log('❌ 负例执行器检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 负例执行器检查通过');
