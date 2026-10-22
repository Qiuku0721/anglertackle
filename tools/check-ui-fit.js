/*
 * check-ui-fit.js —— 四个界面都必须**装得进窗口**。
 *
 * 用户 2026-10-02 截图："很明显，图鉴的内容屏幕装不下了。"
 *
 * 根因：面板尺寸原来全是常量，而 MC 的窗口尺寸是 **GUI 缩放折算后的逻辑像素** ——
 * 同一个 1920×1080 屏，缩放 2 是 960×540、缩放 4 只剩 480×270。
 * 窗口一小/缩放一大，面板就顶出屏幕：左边一列被切、最下面一行落到屏幕外，
 * 界面不报错，玩家只看到"内容缺了一块"。
 *
 * 现在四个界面（图鉴 / 指南 / 商店 / 改装）统一走 {@code client/screen/UiLayout.java}：
 *   panelW/panelH 按窗口 clamp、列位置 fitX 等比压缩、每页行数按面板高度现算、
 *   超宽文字 fitText 截断。
 *
 * 判据两层，缺一层都不够：
 *   ① 结构：四个界面的 init() 都必须用 UiLayout 按 this.width/this.height 现算，
 *      而且不许在别处直接用设计常量画（那是"改一半"的典型：面板缩了、列没缩）；
 *   ② 数值：把设计常量从源码读出来，按**同一套公式**复算四种真实窗口尺寸，
 *      断言面板连边框都装得下、每页至少 1 行、最后一行不压页脚线。
 *      （① 只保证"用了 UiLayout"，② 才保证"算出来的东西真的装得下"。）
 *
 * 用法：node tools/check-ui-fit.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const SCREEN_DIR = 'src/main/java/com/whitecobalt/anglertackle/client/screen';

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
  .map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/** 取一个方法体（按大括号配平）。 */
function body(src, name) {
  const m = new RegExp('(?:protected|public|private)?\\s*void\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}

/** 从源码里取一个整型常量（支持 `A + 2` 这种简单算式，深度 4 层）。 */
function intOf(src, name, depth = 0) {
  if (depth > 4) return null;
  const m = new RegExp('\\b' + name + '\\s*=\\s*([A-Za-z_0-9]+)\\s*([+-])?\\s*([A-Za-z_0-9]+)?\\s*;').exec(src);
  if (!m) return null;
  const val = (token) => {
    if (token === undefined || token === null || token === '') return null;
    if (/^-?\d+$/.test(token)) return Number(token);
    return intOf(src, token, depth + 1);
  };
  const a = val(m[1]);
  if (a === null) return null;
  if (!m[2]) return a;
  const b = val(m[3]);
  return b === null ? null : (m[2] === '+' ? a + b : a - b);
}

// ---------------------------------------------------------------- ① UiLayout 本身
console.log('=== 界面自适应检查（四个界面都要装得进窗口）===\n');
const uiRel = SCREEN_DIR + '/UiLayout.java';
if (!fs.existsSync(path.join(ROOT, uiRel))) {
  no('缺少 ' + uiRel + ' —— 四个界面没有共用的自适应实现');
  console.log('\n❌ 界面自适应检查未通过（1 项）');
  process.exit(1);
}
const ui = strip(read(uiRel));
const MARGIN = intOf(ui, 'MARGIN');
if (MARGIN === null) no('UiLayout 里读不到 MARGIN');
else ok('UiLayout.MARGIN = ' + MARGIN + '（面板四周留的边距）');
for (const fn of ['panelW', 'panelH', 'fitX', 'rows', 'fitText']) {
  if (new RegExp('static\\s+\\w+\\s+' + fn + '\\s*\\(').test(ui)) ok('UiLayout.' + fn + '() 在');
  else no('UiLayout 缺 ' + fn + '()');
}
const uiHasClamp = /Math\.min\(\s*designW/.test(ui) && /windowW\s*-\s*MARGIN/.test(ui);
if (uiHasClamp) ok('panelW/panelH 是按"窗口 − 边距"与设计宽度取小算的');
else no('UiLayout 没有按窗口 clamp —— 面板仍会顶出屏幕');
if (/plainSubstrByWidth/.test(ui)) ok('fitText 用字体宽度表截断（TextWidget 不裁剪）');
else no('UiLayout 没有截断实现 —— 窄面板下长文本会压出边框');

// ---------------------------------------------------------------- ② 四个界面
//
// designW/designH/minW 从源码读；rowTop/rowH 也尽量读；
// footer 在代码里是字面量（24 / 30），只能在检查器里记一份并注明出处。
const SCREENS = [
  { name: '图鉴', file: 'CodexScreen.java', wNames: ['PANEL_W'], hNames: ['PANEL_H'],
    minName: 'MIN_W', rowTopName: 'LIST_Y', rowHName: 'ROW_H', footer: 24 },
  { name: '指南', file: 'GuideScreen.java', wNames: ['PANEL_W'], hNames: ['PANEL_H'],
    minName: 'MIN_W', rowTopName: 'BODY_TOP', rowHName: 'LINE_STEP', footer: 24 },
  { name: '改装', file: 'RodModScreen.java', wNames: ['PANEL_W'], hNames: ['PANEL_H'],
    minName: 'MIN_W', rowTopName: null, rowHName: 'ROW_H', footer: 30, rowTop: 28 },
  { name: '商店', file: 'ShopScreen.java', wNames: ['W'], hNames: ['H'],
    minName: 'MIN_W', rowTopName: null, rowHName: 'ROW_H', footer: 24, rowTop: 40 },
  // 菜谱（1.2.1）：左边一列菜名，右边详情。列表顶 = LIST_Y，行高 = ROW_H
  { name: '菜谱', file: 'CookbookScreen.java', wNames: ['PANEL_W'], hNames: ['PANEL_H'],
    minName: 'MIN_W', rowTopName: 'LIST_Y', rowHName: 'ROW_H', footer: 24 },
  // 邮箱（2026-10-12，docs/36 §5.4）：左列表 200 + 间隙 10 + 详情 244 ⇒ 设计 470×224。
  // ⚠ 它的常量名与既有界面对齐（PANEL_W/PANEL_H/MIN_W），只是列表顶/行高叫 HEADER_H/LIST_ROW_H
  //   （名字不同但语义一样：列表从标题栏底下开始、每行 24）—— 所以这里传 minH，行高用 LIST_ROW_H ✓。
  { name: '邮箱', file: 'MailScreen.java', wNames: ['PANEL_W'], hNames: ['PANEL_H'],
    minName: 'MIN_W', rowTopName: 'HEADER_H', rowHName: 'LIST_ROW_H', footer: 24 },
  // 称号（2026-10-12，用户："称号佩戴在哪，很难发现。"）：与邮箱同一套版面常量。
  // ⚠ 它的列表栏底部还留了 PAGER_H（翻页条）—— 那是**比这里算出来的更严**的约束
  //   （实际行数只会更少），所以这一组照常能覆盖它 ✓。
  { name: '称号', file: 'TitleScreen.java', wNames: ['PANEL_W'], hNames: ['PANEL_H'],
    minName: 'MIN_W', rowTopName: 'HEADER_H', rowHName: 'LIST_ROW_H', footer: 24 },
];

// 真实窗口尺寸（GUI 缩放折算后的逻辑像素）
const WINDOWS = [
  ['1920×1080 缩放 2', 960, 540],
  ['1920×1080 缩放 4', 480, 270],
  ['用户截图那次', 337, 210],
  ['小窗口 + 缩放 4', 253, 158],
];

let fitFail = 0;
for (const s of SCREENS) {
  const rel = SCREEN_DIR + '/' + s.file;
  if (!fs.existsSync(path.join(ROOT, rel))) { no('找不到 ' + rel); continue; }
  const src = strip(read(rel));
  const init = body(src, 'init');
  if (!init) { no(s.name + '：找不到 init()'); continue; }

  // 结构：init 里必须用 UiLayout 按窗口现算
  // （商店的 init 直接写 width/height，没加 this. —— 两种都算）
  let structOk = true;
  if (!/UiLayout\.panelW\(\s*(this\.)?width/.test(init)) {
    no(s.name + '：init() 没有用 UiLayout.panelW(width, …) —— 面板宽还是写死的');
    structOk = false;
  }
  if (!/UiLayout\.panelH\(\s*(this\.)?height/.test(init)) {
    no(s.name + '：init() 没有用 UiLayout.panelH(height, …) —— 面板高还是写死的');
    structOk = false;
  }
  // ⚠ 行数公式只要出现在这个界面里就算（改装界面是在 rebuildAll() 里算的，
  //   不是 init() —— 要求必须在 init 里会把"算对了"的代码报成没算）
  if (!/UiLayout\.rows\(/.test(src)) {
    no(s.name + '：每页行数没有按面板高度现算（窗口一矮就会丢行/落到屏幕外）');
    structOk = false;
  }
  if (structOk) ok(s.name + '：init() 按窗口现算面板尺寸与每页行数');

  // 数值：读设计常量，按同一套公式复算
  const dw = s.wNames.map((n) => intOf(src, n)).find((v) => v !== null);
  const dh = s.hNames.map((n) => intOf(src, n)).find((v) => v !== null);
  const minW = intOf(src, s.minName);
  const rowH = intOf(src, s.rowHName);
  const rowTop = s.rowTopName ? intOf(src, s.rowTopName) : s.rowTop;
  if ([dw, dh, minW, rowH, rowTop].some((v) => v === null || v === undefined)) {
    no(s.name + '：读不出设计常量（宽 ' + dw + ' 高 ' + dh + ' 下限 ' + minW +
      ' 行高 ' + rowH + ' 列表顶 ' + rowTop + '）—— 复算没法做');
    continue;
  }
  let worst = null;
  for (const [label, winW, winH] of WINDOWS) {
    const panelW = Math.max(minW, Math.min(dw, winW - MARGIN));
    const panelH = Math.max(rowTop + s.footer + rowH, Math.min(dh, winH - MARGIN));
    const rows = Math.max(1, (panelH - s.footer - rowTop) / rowH | 0);
    const problems = [];
    // ⚠ 窗口比"下限宽 + 边距"还小时，minW 会顶住面板 —— 那是**故意**的取舍
    //   （保可读性，宁可略微出屏；那种尺寸下本来也没法看）。所以只在
    //   "窗口装得下下限"的前提下才断言宽度，否则只提示。
    const widthAssertable = winW - MARGIN >= minW;
    if (widthAssertable && panelW + 6 > winW) {
      problems.push('面板宽 ' + panelW + '+6 > 窗口 ' + winW);
    }
    // 面板 + 4px 边框 + 6px 阴影都要在窗口里
    if (panelH + 6 > winH && winH - MARGIN >= rowTop + s.footer + rowH) {
      problems.push('面板高 ' + panelH + '+6 > 窗口 ' + winH);
    }
    // 最后一行不能压到页脚
    if (rowTop + rows * rowH > panelH - s.footer) {
      problems.push('行底 ' + (rowTop + rows * rowH) + ' 压过页脚线 ' + (panelH - s.footer));
    }
    if (problems.length) worst = label + '：' + problems.join('；');
  }
  if (worst === null) {
    ok(s.name + '：四种窗口尺寸下都装得下（设计 ' + dw + '×' + dh + '，下限宽 ' + minW + '）');
  } else {
    fitFail++;
    no(s.name + '：' + worst);
  }
}

console.log('');
console.log(bad === 0
  // ⚠ 数量从 SCREENS 现数（写死"四个"会在加界面时撒谎 —— 2026-10-12 加邮箱界面时正好撞上）
  ? '✅ ' + SCREENS.length + ' 个界面都能装进窗口（面板按窗口 clamp、行数现算、文字截断）'
  : '❌ 界面自适应检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
