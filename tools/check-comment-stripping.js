/*
 * check-comment-stripping.js —— 守住"剥 Java 注释"的**顺序**。
 *
 * ── 为什么要单独一条闸（2026-10-16 事故）──────────────────────
 * 我在 check-fishing-camera.js 里手写了一份剥注释工具，而且顺序写反了：
 * 先剥**块**注释、再剥**行**注释。
 *
 * 病根：**行注释里可以安全地出现块注释开头那两个字符**，而本仓库大量这么写
 * （例如"带着品质/体长/重量/**售价**的数据面板"这种加粗写法）。
 * 先剥块注释时，那两个字符被当成块注释开头，于是**一路吞到很远的块注释结尾**：
 * 实测 FishingManager.java 被吞掉 **6 千多字符**（约 200 行真实代码）。
 *
 * 后果比"误报"严重得多：断言搜不到东西 ⇒ **该红的照样绿**。
 * 它正是仓库里 AGENTS.md 与 docs/CONVENTIONS.md 反复强调的那一类
 * （"永远绿的检查器比没有检查器更坏"）。而这次它是**被另一条新断言当场逼出来的**：
 * 新断言要求"上鱼结算在 end(session) 之前推最终快照"，被吞掉的正好是那一段。
 *
 * ── 判据 ────────────────────────────────────────────────────
 * ① 不许"先块后行"：任何 tools/*.js 里出现
 *      块注释正则 …… 行注释正则
 *    相邻（< 200 字符）且块在前 ⇒ 报红。这是**朴素字符串判据**，好懂、不易失效。
 * ② 正确的东西只有一份：tools/java-source.js 的 stripComments()（状态机）；
 *    必须仍然导出它、并仍然正确处理"行注释里的块注释开头"这个 case（这里真跑一遍）。
 * ③ 反过来也要守：字符串里的双斜线不该被当成行注释吃掉（同一台状态机的另一个方向）。
 *
 * ⚠ 负例：comment-strip-order（把某个检查器改回"先块后行"）⇒ 本脚本必须红。
 *
 * 用法：node tools/check-comment-stripping.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

// 危险写法 = 块注释正则紧跟着（200 字符内）行注释正则
const BLOCK_RE = String.raw`/\/\*[\s\S]*?\*\//`;
const LINE_RE = String.raw`/\/\/[^\n]*/`;

console.log('=== 剥注释的顺序检查 ===\n');

// ---------------------------------------------------------------- ① 不许"先块后行"
{
  // ⚠ 本文件自己**故意**同时写着那两个正则（它就是这个判据的实现）⇒ 必须排除自己；
  //   tools/java-source.js 是共享状态机，它的说明注释里也会提到这两个模式。
  //   排除名单只有这两个，别扩大 —— 扩大了这条闸就开始漏检。
  const SELF = new Set(['check-comment-stripping.js', 'java-source.js']);
  const files = fs.readdirSync(TOOLS).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    if (SELF.has(f)) continue;
    const t = fs.readFileSync(path.join(TOOLS, f), 'utf8');
    const ib = t.indexOf(BLOCK_RE);
    const il = t.indexOf(LINE_RE);
    if (ib >= 0 && il >= 0 && ib < il && il - ib < 200) offenders.push(f);
  }
  if (offenders.length === 0) {
    ok('没有任何工具/检查器写成"先剥块注释、再剥行注释"（扫过 ' + (files.length - SELF.size) + ' 个文件，'
      + '排除了本文件与共享工具）');
  } else {
    fail('这些文件是"先块后行"的危险顺序：' + offenders.join('、')
      + ' —— 行注释里的块注释开头会把后面一大段真实代码吞掉，断言于是**该红也绿**'
      + '（2026-10-16 实测吞掉 FishingManager 约 200 行）。改成"先剥行、再剥块"。');
  }
}

// ---------------------------------------------------------------- ② 共享工具必须还在、且行为正确
{
  let shared = null;
  try {
    shared = require(path.join(TOOLS, 'java-source.js'));
  } catch (e) {
    fail('tools/java-source.js 加载不了：' + e.message);
  }
  if (shared && typeof shared.stripComments === 'function') {
    ok('共享的 stripComments() 还在（所有检查器应该用它，而不是各写一份）');

    // 行注释里出现块注释开头 —— 不许被当成块注释
    const srcA = ['int a = 1; // 注释里有 ' + '/* 这个', 'int b = 2;'].join('\n');
    const a = shared.stripComments(srcA);
    if (a.includes('int b = 2;')) {
      ok('行注释里的块注释开头不会吞掉后面的代码（事故的正面 case）');
    } else {
      fail('stripComments 被行注释里的块注释开头带跑偏了 —— 后面的代码被吞：' + JSON.stringify(a));
    }

    // 字符串里的双斜线 —— 不许被当成行注释
    const b = shared.stripComments('String u = "http://x/y"; int c = 3;');
    if (b.includes('"http://x/y"') && b.includes('int c = 3;')) {
      ok('字符串里的双斜线不会被当成注释（反方向的 case）');
    } else {
      fail('stripComments 把字符串里的双斜线当注释了：' + JSON.stringify(b));
    }

    // 块注释要真的被剥掉（别为了上面两条把功能删了）
    const c = shared.stripComments('int d = 4; ' + '/* 注释 */' + ' int e = 5;');
    if (!c.includes('注释') && c.includes('int d = 4;') && c.includes('int e = 5;')) {
      ok('块注释本身仍然被正确剥掉（没有为了过前两条而把功能删空）');
    } else {
      fail('块注释没被剥掉：' + JSON.stringify(c));
    }
  } else if (shared) {
    fail('tools/java-source.js 没有导出 stripComments —— 共享工具被改名/删了？');
  }
}

console.log('');
console.log(bad === 0
  ? '✅ 剥注释的顺序正确（只有一处实现，且两个方向的陷阱都躲开了）'
  : '❌ 剥注释检查未通过（' + bad + ' 项）');
process.exitCode = bad === 0 ? 0 : 1;
