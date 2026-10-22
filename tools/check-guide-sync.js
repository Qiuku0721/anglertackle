// 教程书的守门脚本。
//
// ── 它守的是什么，为什么换了守法 ──────────────────────────────
//
// 【旧设计】教程内容有两份：Java 里硬编码的 GuideData.builtin() + 数据包版
//   guide.json。游戏优先读数据包，读不到才回退内置。于是"改了数据包忘了改内置"
//   就会让两份漂移 —— 这个脚本当初就是为盯住那件事而写的（比对两边的
//   章节 id / 标题 / 页数）。
//
// 【2026-09-30 改成】内置兜底**不再硬编码**，改成读 mod 自己 classpath 上的
//   同一份 guide.json（GuideData.BUILTIN_GUIDE_PATH）。内容从此只有一份，
//   **结构上不可能再漂移** —— 于是"比对两份"这个前提消失了，脚本必须跟着改，
//   否则它会一直报"两份不一致"，而实际上早就没有两份了。
//
//   ⚠ 这正是"检查脚本会过期"的典型样子：它报的错是真的（内容确实对不上），
//     但结论是错的（不是漏同步，是设计换了）。所以脚本断言的东西必须
//     跟着设计走 —— 设计换了而脚本没换，人就会去"修"一个不存在的问题。
//
// 【现在守】① 兜底确实是读资源的、且有最小兜底与日志（不能返回 null）
//          ② guide.json 本身结构完整
//          ③ 内容里不许出现已知写反/过期的说法
const fs = require('fs'), path = require('path');
// ⚠ 必须认 ATL_ROOT：负向测试（tools/negtest.ps1）就是在**副本**上跑检查器的，
//   不认它的话检查器永远读真实仓库的文件 —— 于是它对应的负例全都会"通过"，
//   看上去像"这个检查器抓不到问题"，其实是**它根本没看那份被改坏的文件**。
//   （2026-10-02 加 guidesync-md-stars 负例时就是这么假通过的。）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const jsonPath = path.join(ROOT, 'src/main/resources/data/anglertackle/guide/guide.json');
const javaPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/guide/GuideData.java');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };
/** 剥掉 java 注释再断言 —— 注释里正在解释这些坑，不剥会被自己的说明判红。 */
const { stripComments } = require('./java-source.js');

if (!fs.existsSync(jsonPath)) { no('数据包版教程缺失: ' + jsonPath); }
if (!fs.existsSync(javaPath)) { no('GuideData.java 缺失'); }

if (fs.existsSync(jsonPath) && fs.existsSync(javaPath)) {
  const raw = fs.readFileSync(javaPath, 'utf8');
  const src = stripComments(raw);
  const guide = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // ---------------------------------------------------------------- ① 兜底设计
  if (/BUILTIN_GUIDE_PATH\s*=\s*"\/data\/anglertackle\/guide\/guide\.json"/.test(src)) {
    ok('内置兜底读的是 classpath 上的 guide.json（内容只有一份，不会漂移）');
  } else {
    no('GuideData 的内置兜底不是读 guide.json —— 又变回硬编码的话，两份迟早漂移');
  }

  const hardcoded = [...src.matchAll(/new Chapter\("([^"]+)"/g)].map((m) => m[1]);
  const onlyMissing = hardcoded.every((id) => id === 'missing');
  if (onlyMissing) ok('没有硬编码章节内容（只留了 ID 为 missing 的最小兜底）');
  else no('GuideData 里又出现硬编码章节：' + hardcoded.join(', ') +
          '（内容只该存在于 guide.json 一份）');

  if (/MISSING_DATA/.test(src) && /getResourceAsStream/.test(src)) {
    ok('兜底路径存在（读资源 + 最小兜底常量）');
  } else no('缺少兜底路径 —— 资源读不到时可能返回 null');

  // 返回 null 会让调用方 NPE，而"教程缺失"绝不该让玩家进不去游戏
  if (/builtinCache\s*=\s*List\.of\(MISSING_DATA\)/.test(src)) {
    ok('资源读取失败时退到最小兜底（不会返回 null）');
  } else no('资源读取失败时没有退到最小兜底 —— 可能返回 null 或抛异常');

  if (/LOGGER\.warn/.test(src)) ok('兜底路径有 WARN 日志（排查时能看出走的是哪条路）');
  else no('兜底路径没有日志 —— 数据包失效时会静默降级');

  // ---------------------------------------------------------------- ② 内容结构
  if (!Array.isArray(guide.chapters) || guide.chapters.length === 0) {
    no('guide.json 里没有 chapters');
  } else {
    ok('guide.json 结构完整（' + guide.chapters.length + ' 章）');
    const noPages = guide.chapters.filter((c) => !Array.isArray(c.pages) || c.pages.length === 0);
    if (noPages.length) no('这些章没有 pages（界面上会是空白）：' + noPages.map((c) => c.id).join(', '));
    else ok('每章都有 pages');

    const emptyPage = [];
    for (const c of guide.chapters) {
      c.pages.forEach((p, i) => { if (!Array.isArray(p) || p.length === 0) emptyPage.push(c.id + ' 第' + (i + 1) + '页'); });
    }
    if (emptyPage.length) no('有空页：' + emptyPage.join(', '));
    else ok('没有空页');

    // 界面上一页能放的行数有限（见 GuideScreen 的分页常量）。
    // 这里给一个宽松上限：单页超过 40 行几乎一定是内容写错段落了。
    const tooLong = [];
    for (const c of guide.chapters) {
      c.pages.forEach((p, i) => { if (p.length > 40) tooLong.push(c.id + ' 第' + (i + 1) + '页 ' + p.length + ' 行'); });
    }
    if (tooLong.length) no('单页行数异常多：' + tooLong.join(', '));
    else ok('没有异常长的页');
  }

  // ---------------------------------------------------------------- ③ 内容不许写反/过期
  //
  // ⚠ 这里**必须按语义判，不能做子串匹配**。第一版就是子串匹配，结果把两句
  //   **正确**的话判成了错：
  //     · "按住左键 = 收线" —— 代码是「左键按住 = 收线」，这只是语序不同，意思一样；
  //     · "没有浮漂槽 —— 浮漂已从本模组移除" —— 这句恰恰是**最该有**的一句，
  //       它专门告诉玩家"别去找浮漂槽"。
  //   子串匹配的断言会拦住正确的内容，然后人就把它删掉 —— 那比没有断言更坏。
  //   所以下面逐行判断，并且用"两个词同时出现"这种语义组合来定位真正的错。
  const lines = [];
  for (const c of guide.chapters) {
    c.pages.forEach((p, i) => p.forEach((l) => lines.push({ c: c.id, p: i + 1, l })));
  }

  // 键位：错的写法是「右键…收线」或「左键…放线」。代码里
  // 右键 = 抛投/提前收回，左键 = 收线/提竿/放线（松开）。
  const keyBad = lines.filter(({ l }) =>
    (/右键/.test(l) && /收线/.test(l) && !/不是|别|而非/.test(l)) ||
    (/左键/.test(l) && /放线/.test(l) && !/松开|不是|别|而非/.test(l)));
  if (keyBad.length) {
    keyBad.forEach(({ c, p, l }) => no('键位写反 [' + c + ' 第' + p + '页]：' + JSON.stringify(l) +
      ' —— 代码是「左键按住 = 收线；松开 = 放线」，右键是抛投/提前收回'));
  } else ok('键位描述与代码一致（没有把收线安到右键上）');

  // 浮漂槽：只有在**宣称存在**浮漂槽时才算错。"没有浮漂槽""浮漂槽已移除"
  // 是正确且必要的说明，要放过。
  const slotBad = lines.filter(({ l }) =>
    /浮漂槽/.test(l) && !/没有|无|移除|已删|不存在|去掉/.test(l));
  if (slotBad.length) {
    slotBad.forEach(({ c, p, l }) => no('宣称存在浮漂槽 [' + c + ' 第' + p + '页]：' + JSON.stringify(l) +
      ' —— 六槽是 竿身/鱼线/渔轮/鱼钩/拟饵/鱼饵'));
  } else ok('没有宣称存在浮漂槽（提到"没有浮漂槽"是正确说明，已放过）');

  // 抛投：早就改成视角控制（FishingManager.castByLook），
  // 任何"蓄力决定落点/绿区最佳"的说法都是过期的。
  //
  // ⚠ 否定词表里必须有「只」和「仅」—— 教程里有一句
  //   "蓄力条只影响显示的节奏"，那**恰恰是正确的说明**（与代码一致），
  //   第一版漏了「只」，把它判成了过期描述。这已经是这个脚本里第三个
  //   由"只做子串匹配、不看语义"造成的误报了。
  const castBad = lines.filter(({ l }) =>
    /(蓄力|力度条|绿区|绿色区域)/.test(l)
    && /(决定|影响|最佳|最准|落点|距离)/.test(l)
    && !/只|仅|不|别|而非|已经/.test(l));
  if (castBad.length) {
    castBad.forEach(({ c, p, l }) => no('抛投描述过期 [' + c + ' 第' + p + '页]：' + JSON.stringify(l) +
      ' —— 距离由视角俯仰决定（低头8米/平视16米/抬头24米）'));
  } else ok('抛投描述没有过期说法（蓄力条只影响 HUD 节奏）');

  // "见第X章"必须指向真实存在的章（用整段文本扫，跨行引用也能抓到）
  const text = JSON.stringify(guide);
  const wantCh = [...text.matchAll(/见第([一二三四五六七八九十]+)章/g)].map((m) => m[1]);
  const hasCh = new Set(guide.chapters.map((c) => (c.title.match(/^第([一二三四五六七八九十]+)章/) || [])[1]).filter(Boolean));
  const dangling = wantCh.filter((n) => !hasCh.has(n));
  if (dangling.length) no('这些"见第X章"指向不存在的章：' + [...new Set(dangling)].join('、'));
  else ok(wantCh.length ? '所有"见第X章"都指向真实存在的章' : '没有跨章引用（或没有引用）');

  // Markdown 的 ** 在游戏里**不会被渲染**：GuideScreen 是一个字一个字画的，
  // 所以 `**经验不再积攒**` 到玩家眼里就是多出来的四个星号。
  // （2026-10-02 清掉了手册里仅有的三处 —— 其中两处是早期从 Markdown 草稿
  //   直接贴过来的。加了这条之后就不会再贴回来。）
  const mdBad = lines.filter(({ l }) => /\*\*/.test(l));
  if (mdBad.length) {
    mdBad.forEach(({ c, p, l }) => no('手册里出现了 Markdown 的 ** [' + c + ' 第' + p + '页]：'
      + JSON.stringify(l) + ' —— 游戏里不会渲染成粗体，只会多出几个星号，改成普通文字'));
  } else ok('手册里没有 Markdown 的 **（游戏里不渲染，只会多出星号）');
}

console.log(bad === 0 ? '\n✅ 教程内容与兜底设计都正确' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
