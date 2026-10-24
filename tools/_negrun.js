'use strict';
/**
 * _negrun.js —— **负例的并行执行器**（2026-10-12 新增，把闸里最慢的一段压下来）。
 *
 * ── 它替掉了什么 ─────────────────────────────────────────────
 * 以前这段跑在 `negtest.ps1` 里：PowerShell 逐个 `& node <checker>`，449 个用例串行，
 * 光断言就 ~345 秒（一次完整闸 ~20 分钟，这是最大的一块）。
 * 现在由这个脚本并发跑（默认 4 路），墙钟降到 ~1/3。
 *
 * ── ⚠ 为什么可以并发，以及为什么必须这样并发 ────────────────────
 * `AGENTS.md` §三写着"负例不许并发" —— 那条规则针对的是**两个 negtest 进程同时跑**：
 * 它们都要清空并重建同一个 `build\negtest`，于是互相拆台（真踩过）。
 * 这里的并发**不会**发生那件事，因为：
 *   ① 建副本那一步仍然是**单进程**（`_negtest.js`，在 PS 里先跑完）；
 *   ② 每个用例只**读**自己那棵副本（`ATL_ROOT=<build\negtest\<dir>>`），互不写；
 *   ③ 本进程**不碰** `build\negtest` 之外的任何东西。
 * ⇒ 不变式是"**同一时刻只有一个进程在写 build\negtest**"，本脚本全程只读它 ✓。
 *
 * ── ⚠ 为什么可以直接用 node 起 node（以前说不行） ────────────────
 * `negtest.ps1` 的老注释说"沙箱禁止 node 用管道捕获子进程输出（EPERM）"。
 * 那条依然成立 —— 所以这里**不用管道**：`stdio: 'ignore'`（丢弃）或 `'inherit'`
 * （只在复现失败用例时才用）。这两种 stdio 在沙箱下是允许的，被禁的只有 `'pipe'` ✓。
 *
 * ── 三条不许省的自检（都来自踩过的坑）────────────────────────────
 *   ① **没跑起来的用例绝不算通过**：`exitCode === null`（被信号杀）或 spawn `error`
 *      一律算"跑测器故障"，计入失败并打印原因 —— 否则就会重现
 *      "把根本没跑起来的用例报成变异被抓到"那种自欺 ✗；
 *   ② 对照组必须仍然存在且通过（`expect: 0`）—— 数量为 0 时直接报错，不静默放过；
 *   ③ 过滤后一个用例都没有 ⇒ **退出码 2**（不是 0）：这不是"通过"，是"没跑"。
 *
 * 用法：
 *   node tools/_negrun.js                    # 全部用例，默认 4 路并发
 *   node tools/_negrun.js --jobs 8           # 8 路
 *   node tools/_negrun.js --filter titles    # 只跑 dir/checker 含 "titles" 的
 *   node tools/_negrun.js --filter x --force-root build/negtest/titles-no-copy-on-death
 *                                            # 把所有用例都指向同一棵副本（**用来验证失败路径**）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const SCRATCH = path.join(ROOT, 'build', 'negtest');
const MANIFEST = path.join(SCRATCH, 'manifest.json');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const JOBS = Math.max(1, Number(argOf('--jobs', '4')) || 4);
const FILTER = argOf('--filter', '');
const FORCE_ROOT = argOf('--force-root', '');

if (!fs.existsSync(MANIFEST)) {
  console.error('❌ 找不到 ' + MANIFEST + ' —— 先跑 node tools/_negtest.js 造副本');
  process.exit(2);
}
let all = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
all = all.filter((c) => !FILTER || c.dir.includes(FILTER) || c.checker.includes(FILTER));

if (all.length === 0) {
  console.error("❌ 过滤条件 '" + FILTER + "' 一个用例都没匹配上 —— 这不是通过，是没跑");
  process.exit(2);
}
const controls = all.filter((c) => c.expect === 0).length;
if (controls === 0) {
  console.error('❌ 这批用例里一棵对照组都没有（expect=0）—— 检查器可能自己写错了，先别跑');
  process.exit(2);
}

const rootOf = (c) => (FORCE_ROOT ? path.resolve(ROOT, FORCE_ROOT) : path.join(SCRATCH, c.dir));

/**
 * 跑一个用例，返回 { code, error }。不捕获输出（管道在沙箱里被禁）。
 *
 * <p>⚠⚠ 2026-10-16 加了一条**兜底**，原因是一个真实且极难查的环境问题：
 * 在某些宿主里（实测：DSH 的沙箱化 shell 里跑 `negtest.ps1`），
 * `stdio: 'ignore'` 起出来的 node **根本起不来** —— 退出码是
 * `3221225794`（= `0xC0000142` STATUS_DLL_INIT_FAILED），
 * 而**同一份检查器**改写成 `stdio: 'inherit'`、或者把 stdout/stderr 重定向到**文件**就一切正常。
 * （已实测：`ignore` ✗ / `inherit` ✓ / 文件句柄 ✓ / `pipe` = EPERM 沙箱禁。）
 *
 * <p>为什么必须兜底：那一刻 626 条用例**全军覆没**，而闸报出来的样子是
 * "18 个用例不符合预期 —— 其余是检查脚本漏检或误报"，看起来像"检查器抓不到变异" ✗
 * —— 与 AGENTS.md 里记的 `rmSync` 那条事故**同一个误导形状**（整段没跑起来，却像漏检）。
 *
 * <p>兜底判据用**退出码**而不是猜环境：这个 NTSTATUS 只可能来自"进程没起来"，
 * 而检查器自己的约定退出码只有 0 / 1（见各检查器的 `process.exitCode = bad === 0 ? 0 : 1`）。
 * 所以"看到 0xC0000142 ⇒ 换文件句柄重跑一次"不会掩盖任何真实失败：
 * 真失败会以 1 返回，走不到这条分支。
 */
function runCase(c, capture) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, c.checker)], {
      env: { ...process.env, ATL_ROOT: rootOf(c) },
      stdio: capture ? 'inherit' : 'ignore',
      windowsHide: true,
    });
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    child.on('error', (e) => finish({ code: null, error: e.message }));
    child.on('exit', (code, signal) => finish({ code, error: signal ? '被信号 ' + signal + ' 终止' : null }));
  });
}

/** `0xC0000142`（有符号十进制 3221225794）= 子进程没能初始化 ⇒ 判为"没跑起来"。 */
const SPAWN_FAILED = 3221225794;

/**
 * 带兜底的执行：先按老办法（忽略输出）跑；只有拿到"没起来"那个退出码时，
 * 才把 stdout/stderr 接到临时文件上重跑一次（见 {@link runCase} 的说明）。
 *
 * @param quietFile 临时文件路径（每个用例一个，互不覆盖）
 */
async function runCaseFallback(c, quietFile) {
  const first = await runCase(c, false);
  if (first.code !== SPAWN_FAILED) return first;

  const fd = fs.openSync(quietFile, 'w');
  try {
    const second = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, c.checker)], {
        env: { ...process.env, ATL_ROOT: rootOf(c) },
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      });
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      child.on('error', (e) => finish({ code: null, error: e.message }));
      child.on('exit', (code, signal) => finish({ code, error: signal ? '被信号 ' + signal + ' 终止' : null }));
    });
    retried++;
    return second;
  } finally {
    try { fs.closeSync(fd); } catch { /* 关不掉就算了，文件留在 build/negtest 里 */ }
  }
}
let retried = 0;


(async () => {
  // ⚠ **按 checker 分组、组内串行、组间并发**（2026-10-12 加固）。
  //   起因：`check-environment.js` 会把自检结果写到一个文件再读回来，而那个路径在两个副本里
  //   是**同一个**（它要向上找真仓库的 build/classes）⇒ 4 路并发跑同一个检查器的多个用例时，
  //   一个进程 unlink/写入、另一个在读 ⇒ "没写出结果文件" ⇒ **对照组假失败** ✗（闸里真红过）。
  //   修那一处之后，这里再加一层不变式：**同一个检查器的多个用例永远不并发** ——
  //   检查器脚本里的任何"共享临时文件/共享状态"都不会被自己撞上 ✓。
  //   （实测代价很小：464 条分布在 70+ 个检查器上，4 路并发的墙钟几乎不变。）
  const groups = new Map();
  for (let i = 0; i < all.length; i++) {
    const k = all[i].checker;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const groupList = [...groups.entries()];

  const results = new Array(all.length);
  let nextGroup = 0;
  let done = 0;
  const t0 = Date.now();

  async function worker() {
    for (;;) {
      const g = groupList[nextGroup++];
      if (!g) return;
      for (const i of g[1]) {          // ← 组内**串行**（同一检查器不许并发）
        const c = all[i];
        const r = await runCaseFallback(c, path.join(SCRATCH, 'quiet-' + c.dir + '.log'));
        results[i] = r;
        done++;
        const idx = '[' + String(done).padStart(3) + '/' + all.length + ']';
        if (r.code === c.expect) {
          const tag = c.expect === 0 ? '通过（对照组，符合预期）' : '失败（抓到了，符合预期）';
          console.log('  ' + idx + ' [OK]   ' + c.checker.padEnd(30) + ' ' + c.dir.padEnd(30) + ' ' + tag);
        } else {
          console.log('  ' + idx + ' [FAIL] ' + c.checker.padEnd(30) + ' ' + c.dir.padEnd(30)
            + ' 期望退出码 ' + c.expect + '，实际 ' + (r.code === null ? '（没跑起来：' + r.error + '）' : r.code));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, groupList.length) }, worker));

  // ---- 把失败的用例**重跑一遍并放行输出**（诊断信息只在需要时打，不污染日志）----
  const byChecker = new Map();
  let fail = 0;
  let harness = 0;
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    const r = results[i];
    if (!byChecker.has(c.checker)) byChecker.set(c.checker, { ok: 0, bad: 0 });
    const bucket = byChecker.get(c.checker);
    if (r && r.code === c.expect) { bucket.ok++; continue; }
    bucket.bad++;
    fail++;
    console.log('');
    console.log('  [FAIL] ' + c.checker + '  ' + c.dir
      + '  期望退出码 ' + c.expect + '，实际 ' + (r ? r.code : 'null'));
    console.log('         ' + c.desc);
    if (!r || r.code === null) {
      harness++;
      console.log('         ⚠ 这条**没跑起来**（' + (r && r.error ? r.error : '未知原因')
        + '）—— 按"跑测器故障"处理，不是"漏检"');
      continue;
    }
    console.log('         ---- 检查输出（重跑一次，放行 stdout/stderr）----');
    await runCase(c, true);
  }

  console.log('');
  if (retried > 0) {
    console.log('  ⚠ ' + retried + ' 条走了"换文件句柄重跑"的兜底（stdio: ignore 在本宿主下起不来，'
      + '见 tools/_negrun.js 的 runCase 注释）—— 这类重跑的判定与串行时完全相同。');
  }
  for (const [k, v] of [...byChecker.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log('  ' + k.padEnd(30) + ' ' + (v.ok + v.bad) + ' 个用例：' + v.ok + ' 符合预期，' + v.bad + ' 不符');
  }

  // ---- 跳过汇总（P5b）----------------------------------------------------
  //
  // 跳过用例不进 manifest（不跑检查器），但**必须说清楚**：用户口径是
  // "skip 必须带理由，且要在负例汇总里单列'因失效而跳过'的条数，不能混进普通跳过"。
  // 分类由 tools/_negtest.js 的 skipCase(reason, kind) 写入 build/negtest/skipped.json：
  //   env      = 本轮新增的环境夹具守卫（6 条）
  //   invalid  = 用例本身已失效（3 条）
  //   optional = P4b 已有的可选夹具跳过（6 条，单独列出，不混进上面两类）
  {
    let skippedCases = [];
    const skipFile = path.join(SCRATCH, 'skipped.json');
    if (fs.existsSync(skipFile)) {
      try {
        skippedCases = JSON.parse(fs.readFileSync(skipFile, 'utf8'));
      } catch (e) {
        console.log('  ⚠ 跳过清单解析失败（' + skipFile + '）：' + e.message);
      }
    }
    if (skippedCases.length) {
      const buckets = { env: [], invalid: [], optional: [] };
      for (const s of skippedCases) {
        const k = (s.kind === 'env' || s.kind === 'invalid') ? s.kind : 'optional';
        buckets[k].push(s);
      }
      console.log('');
      console.log('  ℹ 跳过 ' + skippedCases.length + ' 条：环境跳过 ' + buckets.env.length
        + ' + 失效跳过 ' + buckets.invalid.length + ' = ' + (buckets.env.length + buckets.invalid.length)
        + ' 条（本轮）；另有普通跳过 ' + buckets.optional.length + ' 条（P4b 可选夹具）');
      const LABEL = { env: '环境跳过', invalid: '失效跳过', optional: '普通跳过' };
      for (const k of ['env', 'invalid', 'optional']) {
        if (!buckets[k].length) continue;
        console.log('    ' + LABEL[k] + ' ' + buckets[k].length + ' 条：');
        for (const s of buckets[k]) {
          console.log('      ⊘ ' + (s.checker || '?').padEnd(24) + ' ' + s.dir.padEnd(28)
            + ' 跳过：' + s.reason);
        }
      }
    }
  }
  console.log('');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (fail === 0) {
    console.log('全部通过：' + all.length + ' 个用例全部符合预期（含 ' + controls + ' 棵对照组）。'
      + '　［' + JOBS + ' 路并发，用时 ' + secs + 's］');
  } else {
    console.log(fail + ' 个用例不符合预期 —— ' + (harness ? harness + ' 个是跑测器故障，' : '')
      + '其余是检查脚本漏检或误报。');
  }
  process.exit(fail);
})();
