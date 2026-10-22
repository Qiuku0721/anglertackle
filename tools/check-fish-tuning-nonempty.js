const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 守住这条：**FishTuning 的生成区里必须真的有鱼种读取**。
//
// ── 为什么单独写一个检查 ─────────────────────────────────────
// 2026-09-30 事故。玩家反馈"鱼还是一下就拉过来"。日志里三种完全不同的鱼
// （巨骨舌鱼 / 蓝鳍金枪鱼 / 镜鲤）印出来的手感数值**一模一样**：
//
//   [垂纶] 手感来源：id=arapaima     拉力=0.7000 张力系数=0.9000 …
//   [垂纶] 手感来源：id=bluefin_tuna 拉力=0.7000 张力系数=0.9000 …
//   [垂纶] 手感来源：id=mirror_carp  拉力=0.7000 张力系数=0.9000 …
//   [垂纶] 鱼种数值装载 0 条，但鱼种表有 21 条
//
// 0.7 / 0.9 就是鲫鱼兜底值。根因是 FishTuning.java 的生成区是**空的**：
//
//   // ==== BEGIN 生成区（gen-fish-config.js，勿手改）====
//   // ==== END 生成区 ====
//
// 而 build-deploy.ps1 里调 `gen-fish-config.js` 时**漏了 `--write`**，
// 那个脚本默认是预览模式 —— 于是这一步"成功通过"，一个字节都没写。
//
// 为什么原有的检查全绿：check-fish-config-wired.js 验的是"FishSpecies 有没有走
// FishTuning"、check-runtime-tuning-loaded.js 验的是"配置事件里有没有调 build()"。
// 两个都在验**接线**，没有一个验**生成区里到底有没有内容**。
// 空生成区 = 接线全对但数据是空的，所有鱼静默退化成鲫鱼。
//
// 用法：node tools/check-fish-tuning-nonempty.js
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const FT = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishTuning.java');
const FS_ = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const ft = fs.readFileSync(FT, 'utf8');

// 1) 生成区标记必须在（否则连"生成区"这个概念都没了）
const BEGIN = '// ==== BEGIN 生成区（gen-fish-config.js，勿手改）====';
const END = '// ==== END 生成区 ====';
const i = ft.indexOf(BEGIN), j = ft.indexOf(END);
if (i < 0 || j < 0 || j < i) {
  no('FishTuning.java 里找不到成对的生成区标记 —— 生成器认不出结构，永远不会写入');
} else {
  const body = ft.slice(i + BEGIN.length, j);
  // 2) 生成区里必须有鱼种条数那么多的 next.put
  const puts = [...body.matchAll(/next\.put\("([^"]+)"/g)].map((m) => m[1]);
  if (puts.length === 0) {
    no('FishTuning 的生成区是**空的** —— 所有鱼会全部退化成鲫鱼兜底值，' +
       '表现为"所有鱼手感一样、一拉就过来、调参怎么改都没感觉"');
    console.log('     修法：node tools/rebuild-config.js     （里面会带 --write 跑生成器）');
  } else {
    ok('生成区里有 ' + puts.length + ' 段 next.put');
    // 3) 逐条对上 FishSpecies.ALL 的 id，别少了谁
    const ids = [...fs.readFileSync(FS_, 'utf8').matchAll(/new FishSpecies\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const missing = ids.filter((id) => !puts.includes(id));
    const extra = puts.filter((id) => !ids.includes(id));
    if (!ids.length) no('没从 FishSpecies.java 解析出任何鱼种 id —— 正则与源码写法脱节了');
    else if (missing.length || extra.length) {
      if (missing.length) no('这些鱼种在生成区里没有读取：' + missing.join(', '));
      if (extra.length) no('生成区里有 FishSpecies 里不存在的鱼种：' + extra.join(', '));
    } else ok('生成区覆盖全部 ' + ids.length + ' 个鱼种，id 逐一对应');
  }
  // 4) 每段必须有 13 个 c.xxx.get()，别只写了个壳
  const gets = (body.match(/c\.\w+\.get\(\)/g) || []).length;
  // 期望值**现算**：13 项/鱼 × 生成区里的鱼种条数。
  // 写死 273（=21×13）的话，加第 22 种鱼就会变成"数目对不上"的红灯。
  const wantGets = puts.length * 13;
  if (gets >= wantGets) ok('生成区里共 ' + gets + ' 处 c.xxx.get()（' + puts.length + ' × 13 = ' + wantGets + '）');
  else no('生成区里只有 ' + gets + ' 处 c.xxx.get()（应为 ' + wantGets + '）—— 有鱼种只写了半个壳');
}

// 5) 同时守住"生成了但没被用"：getter 必须从 VALUES 里取
if (/private static Values get\(String id\)/.test(ft) && /VALUES\.get\(id\)/.test(ft)) {
  ok('取值路径是 VALUES.get(id)（生成区填的就是这个表）');
} else no('FishTuning 的 get(id) 不再从 VALUES 取 —— 生成区填了也没人用');

console.log(bad === 0 ? '\n✅ 鱼种运行期数值表非空且覆盖完整' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
