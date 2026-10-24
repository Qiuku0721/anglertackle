/*
 * check-screen-render.js —— 界面**不能自己再一次抽背景**，且注册了 widget 就必须渲染它们。
 *
 * ── 26.1.2 的渲染管线（换过一次，断言也随之迁移）──────────────
 * 旧版（1.21.1）的 bug：`Screen.render()` 自己会调 `renderBackground()`，
 * 子类如果"先 renderBackground 画面板文字 → 最后 super.render()"，就等于
 * **调了两次** → 那层全屏半透明暗化盖在刚画好的面板和文字上，
 * 表现是"整个界面朦胧、白字发灰"，而 tooltip 清晰（它最后才画）。
 *
 * 26.1.2 把管线拆成了 `extractBackground` + `extractRenderState`
 * （`build/refs/mc2612-src/net/minecraft/client/gui/screens/Screen.java`）：
 *
 *   public final void extractRenderStateWithTooltipAndSubtitles(...) {   // :107
 *       graphics.nextStratum();
 *       this.extractBackground(g, mx, my, a);        // :109  ← 框架**只调这一次**
 *       graphics.nextStratum();
 *       this.extractRenderState(g, mx, my, a);       // :112
 *       graphics.extractDeferredElements(mx, my, a);
 *   }
 *   public void extractRenderState(...) {            // :120  ← 只画 renderables，不画背景
 *       for (Renderable r : this.renderables) r.extractRenderState(g, mx, my, a);
 *   }
 *
 * ⇒ 断言的**语义没变**（"背景只能画一次，第二次那层暗化会把界面弄朦胧"），
 *   但**踩法变了**：现在只有"屏幕自己再调一次背景抽取"才会重复画。
 *   所以这里守三件事：
 *
 *   A. 屏幕必须实现 `extractRenderState(GuiGraphicsExtractor, int, int, float)`
 *      （26.1.2 的绘制入口；还写成旧的 render/renderBackground 就是没画）。
 *   B. 屏幕**不得自己再调背景抽取**（`extractBackground` / `extractTransparentBackground`
 *      / `extractBlurredBackground` / `extractMenuBackground`）—— 框架在 :109 已经调过一次，
 *      再调一次就是旧的"两次背景 ⇒ 朦胧"。**覆写** `extractBackground`（方法声明）是允许的。
 *   C. 注册了 widget（`addRenderableWidget`）的屏幕必须真的渲染它们
 *      （`super.extractRenderState(...)` 或手动遍历 `this.renderables`）—— 否则按钮不显示。
 *
 * 用户原话："这个朦胧问题出现了很多次，严查" —— 4 个界面全中，
 * 而且各自的面板色/文字色不同，所以严重程度不一样，更难联想到同一个根因。
 * 所以必须自动守住，不能靠记得。
 *
 * 用法：node tools/check-screen-render.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOOLS = process.env.ATL_ROOT ? path.join(ROOT, 'tools') : __dirname;
const DIR = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/client/screen');
const { stripComments } = require(path.join(TOOLS, 'java-source.js'));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 界面渲染顺序检查（防「朦胧」，26.1.2 extractBackground / extractRenderState）===\n');

if (!fs.existsSync(DIR)) {
  bad('找不到 ' + path.relative(ROOT, DIR));
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.java'));
let checked = 0;

/** 背景抽取的四个入口（都在 Screen 里；任何一个被屏幕自己再调一次 = 第二次暗化）。 */
/** 背景抽取的四个入口（都在 Screen 里；任何一个被屏幕自己再调一次 = 第二次暗化）。 */
const BG_NAMES = ['extractBackground', 'extractTransparentBackground', 'extractBlurredBackground', 'extractMenuBackground'];
/** 方法**声明**（public/protected void extractBackground(...)）—— 覆写是允许的。 */
const BG_DECL = /(?:public|protected|private)\s+void\s+(?:extractBackground|extractTransparentBackground|extractBlurredBackground|extractMenuBackground)\s*\(/;

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  // ⚠ 必须去注释再判断 —— 上面那段说明本身就在注释里写着这些方法名，
  //   不去注释的话每个文件都会被自己人判红（这个坑本项目踩过好几次：
  //   检查器在注释里搜到关键字就放行/报错）。
  const code = stripComments(raw);

  // 只查**屏幕**（TextWidget 这类 widget、UiLayout 这类纯工具不是 Screen，不走这条管线）
  if (!/class\s+\w+\s+extends\s+[\w.]*Screen\b/.test(code)) {
    continue;
  }

  // A. 26.1.2 的绘制入口
  const hasEntry = /public\s+void\s+extractRenderState\s*\(\s*GuiGraphicsExtractor\s/.test(code);
  if (!hasEntry) {
    if (/public\s+void\s+render\s*\(\s*GuiGraphics\s/.test(code)) {
      bad(f + ' 用的是旧的 render(GuiGraphics, ...) 入口 —— 26.1.2 已改成 extractRenderState(GuiGraphicsExtractor, ...)，'
        + '这个界面在游戏里不会画出任何东西');
    } else {
      bad(f + ' 没有 extractRenderState(GuiGraphicsExtractor, ...) —— 26.1.2 的绘制入口，缺了就是空白界面');
    }
    continue;
  }
  checked++;

  // B. 背景只能由框架（Screen.extractRenderStateWithTooltipAndSubtitles :109）抽一次
  //
  // ⚠ 必须能抓到 `this.extractBackground(...)`：第一版的正则用 [^\w.] 排除点号，
  //   结果"自己再抽一次背景"这种**最该抓的写法**反而匹配不上（变异测试当场漏抓 ✗）。
  const decl = BG_DECL.test(code);
  const calls = [];
  for (const name of BG_NAMES) {
    const re = new RegExp('\\b' + name + '\\s*\\(', 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const before = code.slice(Math.max(0, m.index - 16), m.index);
      if (/super\s*\.\s*$/.test(before)) continue;                              // 覆写里转调父类：合法
      if (/(?:public|protected|private)\s+void\s+$/.test(before)) continue;      // 方法声明本身
      calls.push(name);
    }
  }
  if (calls.length > 0 && !decl) {
    bad(f + ' 自己调了 ' + [...new Set(calls)].join(' / ')
      + '() —— 框架已经抽过一次背景（Screen.java:109），再抽一次就是那层**全屏暗化**'
      + '盖在面板和文字上（"界面朦胧、白字发灰"，而 tooltip 清晰）');
  } else if (calls.length > 0 && decl) {
    ok(f + '：自己覆写了 extractBackground，并在里面调 super（背景仍只抽一次）');
  }


  // C. 有 widget 就必须渲染它们
  const hasWidget = /addRenderableWidget\s*\(/.test(code);
  const superState = /super\.extractRenderState\s*\(/.test(code);
  const manualLoop = /for\s*\(\s*(?:[\w.]*\.)?Renderable\s+\w+\s*:\s*this\.renderables\s*\)/.test(code);
  if (hasWidget && !superState && !manualLoop) {
    bad(f + ' 注册了 widget 却既不调 super.extractRenderState(...) 也不手动遍历 renderables'
      + ' —— 按钮会**不显示**');
  } else if (hasWidget && manualLoop) {
    ok(f + '：自己画内容 + 手动渲染 widgets（背景只抽一次，widget 也画到了）');
  } else if (hasWidget && superState) {
    ok(f + '：内容自己画 + super.extractRenderState(...) 渲染 widgets（26.1.2 的 super 只画 renderables，不重抽背景）');
  } else {
    ok(f + '：没有 widget（纯手绘）');
  }
}

if (checked === 0) {
  bad('一个实现 extractRenderState 的界面都没有？目录或写法变了，这个检查已经失效');
} else {
  ok('检查了 ' + checked + ' 个界面');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  为什么值得单独守：');
console.log('    两次背景抽取的表现是"整个界面朦胧"，而 tooltip 清晰 ——');
console.log('    很容易被当成字体/颜色问题去调，而真正的原因是背景被画了两遍。');
console.log('    用户说过"这个朦胧问题出现了很多次"，4 个界面全中，靠记是记不住的。');
process.exitCode = fail === 0 ? 0 : 1;
