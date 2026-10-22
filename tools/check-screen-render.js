/*
 * check-screen-render.js —— 界面**不能自己调 renderBackground 又调 super.render()**。
 *
 * ── 这个 bug 的根因 ────────────────────────────────────────────
 * Screen.render() 的默认实现是：
 *     public void render(GuiGraphics g, int mx, int my, float pt) {
 *         this.renderBackground(g, mx, my, pt);          // ← 它自己会调！
 *         for (Renderable r : this.renderables) r.render(g, mx, my, pt);
 *     }
 *
 * 子类如果写成"先 renderBackground 画面板文字 → 最后 super.render()"，
 * 就等于**调了两次 renderBackground**。第二次是**全屏**的半透明暗化
 * （renderTransparentBackground → fillGradient(0,0,W,H,半透明黑)），
 * 它盖在刚画好的面板和文字上 —— 表现就是**整个界面朦胧、白字发灰**。
 *
 * 最迷惑人的一点：**tooltip 是清晰的**。因为它在 renderWithTooltip 里
 * 最后才画，那层暗化盖不到它。于是现象变成"文字看不清、鼠标悬浮的说明却很清楚"，
 * 很容易被当成字体或颜色的问题去查。
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

console.log('=== 界面渲染顺序检查（防「朦胧」）===\n');

if (!fs.existsSync(DIR)) {
  bad('找不到 ' + path.relative(ROOT, DIR));
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.java'));
let checked = 0;

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  // ⚠ 必须去注释再判断 —— 上面那段说明本身就在注释里写着 super.render()，
  //   不去注释的话每个文件都会被自己人判红（这个坑本项目踩过好几次：
  //   检查器在注释里搜到关键字就放行/报错）。
  const code = stripComments(raw);

  const hasBg = /this\.renderBackground\s*\(|\brenderBackground\s*\(/.test(code);
  const hasSuper = /super\.render\s*\(/.test(code);
  if (!hasBg) {
    continue;   // 不调 renderBackground 的界面（纯 widget 容器）不受影响
  }
  checked++;

  if (hasSuper) {
    bad(f + ' 同时调了 renderBackground() 和 super.render() —— '
      + '后者内部会**再调一次** renderBackground()，那层全屏暗化盖在面板和文字上，'
      + '表现就是"界面朦胧、白字发灰"，而 tooltip 清晰（它最后才画）');
    console.log('     修法：把 super.render(...) 换成只渲染 widgets 的循环 ——');
    console.log('       for (net.minecraft.client.gui.components.Renderable r : this.renderables) {');
    console.log('           r.render(g, mouseX, mouseY, partialTick);');
    console.log('       }');
    console.log('     （不能简单地把 super.render 提到最前面：那样按钮会被面板盖住）');
  } else if (/for\s*\(\s*net\.minecraft\.client\.gui\.components\.Renderable/.test(code)
      || /for\s*\(\s*Renderable/.test(code)) {
    ok(f + '：自己画背景 + 手动渲染 widgets（背景只画一次）');
  } else {
    // 没有 super.render 也没有手动渲染 —— 如果这个界面有按钮，按钮会不显示
    if (/addRenderableWidget/.test(code)) {
      bad(f + ' 注册了 widget 却没有渲染它们（既不调 super.render 也不手动遍历 renderables）'
        + ' —— 按钮会**不显示**');
    } else {
      ok(f + '：自己画背景，没有 widget（纯手绘）');
    }
  }
}

if (checked === 0) {
  bad('一个调 renderBackground 的界面都没有？目录或写法变了，这个检查已经失效');
} else {
  ok('检查了 ' + checked + ' 个界面');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  为什么值得单独守：');
console.log('    两次 renderBackground 的表现是"整个界面朦胧"，而 tooltip 清晰 ——');
console.log('    很容易被当成字体/颜色问题去调，而真正的原因是渲染顺序。');
console.log('    用户说过"这个朦胧问题出现了很多次"，4 个界面全中，靠记是记不住的。');
process.exitCode = fail === 0 ? 0 : 1;
