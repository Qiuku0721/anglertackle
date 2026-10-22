// 「静态初始化里读配置」扫描器。
//
// 独立成模块的原因：check-no-config-at-registration.js 需要它，
// 而**证明那条检查真的有效**的回归测试也需要它。
// 一开始回归测试是用 child_process 起子进程跑检查脚本、读它的输出 ——
// 结果被沙箱拦了（禁止命名管道，stdio:'pipe' 直接 EPERM），
// 于是"检查脚本失败"和"检查脚本正确报警"分不出来，回归测试等于没做。
// 抽成纯函数后，回归测试直接在内存里喂坏代码给同一个扫描器，不碰子进程。
'use strict';

/** 读配置的调用形态。要加新形态就往这里加。 */
const CONFIG_READ = /Tuning\.\w+\s*\(|Config\.INSTANCE\.\w+\.get\s*\(/;

/** 一眼就跳过的整行注释。 */
const isCommentLine = (t) =>
  t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');

/**
 * 扫描一份 java 源码里"静态初始化上下文中的配置读取"。
 *
 * 判定方式很朴素，但对"找 <clinit> 里的取值"够用：
 *   · 进入 `static {` 块 → 到配对 `}` 为止都算静态上下文
 *   · 进入 `static ... = ...` 声明 → 到该语句的 `;` 为止都算静态上下文
 *
 * ⚠️ 两个必须小心的地方（都实际写错过，是回归测试抓出来的）：
 *
 * 1) **先判定，后更新上下文。**
 *    `static final RodSpec WOOD = new RodSpec(2000, Tuning.rodWoodMaxWeightKg());`
 *    这种单行声明在同一行里"既开始又结束"。如果先按行尾的 `;` 把标志清掉再判定，
 *    这一行就被自己清没了 —— 而出事的那次正好就是这种写法，漏检 = 白检查。
 *
 * 2) **`static {` 那一行的 `{` 不能重复计数。**
 *    进入块时若把深度记成 0，下一行（块内第一行）的"深度<=0 即结束"判断会立刻
 *    把块关掉，块里所有取值全部漏检。
 *
 * 还有一点：单行匹配是不够的。真按 Java 惯例把构造参数一行一个地写时，
 * `Tuning.xxx()` 会落在**后续几行**上，所以字段右值必须跟踪到语句结束。
 *
 * @param {string} src  java 源码
 * @returns {Array<{line:number, text:string}>} 命中位置（1 起）
 */
function scanStaticInitConfigReads(src) {
  const hits = [];
  const lines = String(src).split('\n');

  let blockDepth = 0;   // >0 = 在 `static { ... }` 里
  let inField = false;  // true = 正在读一个 `static ... = ...` 的右值（可跨行）

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (isCommentLine(t)) continue;

    const opensBlock = /^(public\s+|private\s+|protected\s+)?static\s*\{/.test(t);
    // `static final Foo BAR = ...` / `static Foo BAR = ...` / `private static final Foo[] B = ...`
    const opensField = /(^|\s)static\s+(final\s+)?[\w<>\[\],.?\s]+\s+\w+\s*=/.test(t);

    // ① 先判定：行首已在静态上下文里，或者这一行自己开启了静态上下文
    if ((blockDepth > 0 || inField || opensBlock || opensField) && CONFIG_READ.test(raw)) {
      hits.push({ line: i + 1, text: t });
    }

    // ② 再更新上下文，给下一行用
    if (opensBlock) {
      blockDepth = 1;               // `{` 已经在本行消费掉，不要重复计数
    } else if (blockDepth > 0) {
      blockDepth += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length;
      if (blockDepth < 0) blockDepth = 0;
    }
    if (opensField) inField = true;
    if (inField && /;\s*$/.test(t)) inField = false;
  }

  return hits;
}

module.exports = { scanStaticInitConfigReads, CONFIG_READ };
