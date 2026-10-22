/*
 * check-fish-habits.js —— 守住"鱼的习性词条"这条链的四端一致。
 *
 * 这条链有四个端，任何一端漏了，表现都是**权重悄悄不对**或**界面上冒出一串原始 key**，
 * 没有报错、没有崩溃，只有玩家觉得"这饵好像没用"：
 *   ① tools/fish-habits.json      —— 唯一真相（鱼有哪些词条、拟饵认哪些词条）
 *   ② FishHabits.java             —— 生成物（鱼池权重、图鉴、tooltip 都用它）
 *   ③ 语言文件 zh_cn / en_us      —— 词条名、图鉴列名、每个拟饵的一句说明
 *   ④ ModItems.java 里真实存在的拟饵 —— 新加了拟饵却忘了给词条 = 它永远拿不到加成
 *
 * 断言（每条都真的证伪过）：
 *   A. 词条表本身合法：id 唯一、ASCII、中英 + 短名齐全
 *   B. 鱼：覆盖 = fish-appearance.json 的 26 条，一条不多一条不少，**每条至少一个词条**
 *   C. 拟饵：覆盖 = ModItems 里注册的全部 lure_*（调试饵 lure_test_red 显式豁免）
 *   D. 语言文件四条 key 逐条等于 json 里的值（防漂移），列名/说明 key 齐全
 *      —— 说明 key 覆盖 **9 个拟饵 + 6 个鱼饵**（用户 2026-10-01 选了初版未删减那 15 条），
 *      并断言说明文字里**不含数字**（门槛/上限/占比都由代码现算，写进文案必然漂移）
 *   E. FishHabits.java 与生成器输出**逐字节**一致（防手改生成物）
 *   F. 生成物里保底 +1 的写法还在（{"3 × 1.10 取整还是 3"} 那个坑）
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 鱼习性词条检查 ===\n');

const data = JSON.parse(read('tools/fish-habits.json'));
const habitIds = data.habits.map((h) => h.id);

/** 显式豁免：调试拟饵故意不认任何词条（见 json 的 _lures_no_habit）。 */
const LURE_EXEMPT = new Set(['lure_test_red']);

// ---------------------------------------------------------------- A 词条表
{
  let a = 0;
  if (!Array.isArray(data.habits) || data.habits.length < 2) { bad('habits 表为空'); a++; }
  const seen = new Set();
  for (const h of data.habits) {
    if (!/^[a-z][a-z0-9_]*$/.test(h.id)) { bad('词条 id 不是 ASCII 小写标识符：' + h.id); a++; }
    if (seen.has(h.id)) { bad('词条 id 重复：' + h.id); a++; }
    seen.add(h.id);
    for (const k of ['zh', 'zhShort', 'en', 'enShort']) {
      if (!h[k] || !String(h[k]).trim()) { bad('词条 ' + h.id + ' 缺 ' + k); a++; }
    }
  }
  if (a === 0) ok(data.habits.length + ' 个词条定义完整（id + 中英全名 + 中英短名）');
}

// ---------------------------------------------------------------- B 鱼
{
  let b = 0;
  const appear = JSON.parse(read('tools/fish-appearance.json'));
  const realFish = Object.keys(appear.fish).sort();
  const tableFish = Object.keys(data.fish).sort();
  if (JSON.stringify(realFish) !== JSON.stringify(tableFish)) {
    bad('鱼的清单对不上 fish-appearance.json\n      外形独有：' +
      realFish.filter((x) => !tableFish.includes(x)).join(', ') +
      '\n      词条独有：' + tableFish.filter((x) => !realFish.includes(x)).join(', '));
    b++;
  } else ok(tableFish.length + ' 条鱼与 fish-appearance.json 完全一致');

  // ⚠ fish 里每条鱼现在是 { habits, time, weather, moon }（2026-10-02 加了环境条件）。
  //   这里统一用 habitsOf() 取值 —— 直接 Object.values(...).includes(h) 会拿对象去比字符串，
  //   永远为假，于是"词条没有鱼"会误报一片。
  const habitsOf = (v) => (Array.isArray(v) ? v : v.habits);

  for (const [id, entry] of Object.entries(data.fish)) {
    const list = habitsOf(entry);
    if (!Array.isArray(list) || list.length === 0) {
      bad(id + ' 没有任何词条 —— 用户 2026-10-01 明确要求"不许有鱼是空白"');
      b++;
      continue;
    }
    for (const h of list) {
      if (!habitIds.includes(h)) { bad(id + ' 引用了不存在的词条 ' + h); b++; }
    }
    const dup = list.filter((x, i) => list.indexOf(x) !== i);
    if (dup.length) { bad(id + ' 的词条重复了：' + dup.join(', ')); b++; }
  }
  // 每条词条都要有鱼，否则那条词条在所有拟饵上都是死的
  for (const h of habitIds) {
    const n = Object.values(data.fish).filter((v) => habitsOf(v).includes(h)).length;
    if (n === 0) { bad('词条 ' + h + ' 没有任何鱼 —— 它永远不可能被命中'); b++; }
  }
  if (b === 0) ok('每条鱼至少一个词条、每条词条至少一条鱼');
}

// ---------------------------------------------------------------- C 拟饵
/** 注册的鱼饵 id（D 段要用，所以在块外声明）。 */
let BAITS = [];
{
  let c = 0;
  const { stripComments } = require('./java-source.js');
  const items = stripComments(read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'));
  const registered = [...items.matchAll(/ITEMS\.register\("(lure_[a-z0-9_]+)"/g)].map((m) => m[1]);
  BAITS = [...items.matchAll(/ITEMS\.register\("(bait_[a-z0-9_]+)"/g)].map((m) => m[1]);
  const inTable = Object.keys(data.lures);
  const missing = registered.filter((id) => !inTable.includes(id) && !LURE_EXEMPT.has(id));
  const extra = inTable.filter((id) => !registered.includes(id));
  if (missing.length) {
    bad('这些拟饵在 ModItems 里注册了、却没有词条：' + missing.join(', ') +
      '\n      → 它们永远拿不到"命中词条 ×1.10"（新加拟饵必须同时加进 tools/fish-habits.json）');
    c++;
  }
  if (extra.length) { bad('词条表里的拟饵在 ModItems 里不存在：' + extra.join(', ')); c++; }
  if (registered.length === 0) { bad('在 ModItems 里一个 lure_* 都没解析到 —— 解析器与源码写法脱节了'); c++; }
  for (const [id, list] of Object.entries(data.lures)) {
    if (!Array.isArray(list)) { bad(id + ' 的词条不是数组'); c++; continue; }
    if (list.length === 0) { bad(id + ' 认的词条是空的 —— 要么给词条，要么进 _lures_no_habit 说清楚'); c++; }
    for (const h of list) {
      if (!habitIds.includes(h)) { bad(id + ' 引用了不存在的词条 ' + h); c++; }
    }
  }
  if (c === 0) {
    ok(registered.length + ' 个注册拟饵全部有词条（豁免：' +
      [...LURE_EXEMPT].filter((x) => registered.includes(x)).join(', ') + '）');
  }
}

// ---------------------------------------------------------------- D 语言文件
{
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
  let d = 0;
  for (const h of data.habits) {
    const keys = [['habit.anglertackle.' + h.id, h.zh, h.en],
      ['habit.anglertackle.' + h.id + '.short', h.zhShort, h.enShort]];
    for (const [k, wantZh, wantEn] of keys) {
      if (zh[k] !== wantZh) {
        bad('zh_cn 的 ' + k + ' = ' + JSON.stringify(zh[k]) + '，json 里写的是 ' + JSON.stringify(wantZh));
        d++;
      }
      if (en[k] !== wantEn) {
        bad('en_us 的 ' + k + ' = ' + JSON.stringify(en[k]) + '，json 里写的是 ' + JSON.stringify(wantEn));
        d++;
      }
    }
  }
  for (const id of Object.keys(data.lures)) {
    for (const [lang, tbl] of [['zh_cn', zh], ['en_us', en]]) {
      const k = 'tooltip.anglertackle.' + id + '.desc';
      if (!tbl[k] || !String(tbl[k]).trim()) {
        bad(lang + ' 缺拟饵说明 ' + k + ' —— tooltip 上会显示成一串原始 key');
        d++;
      }
    }
  }
  // ★ 鱼饵说明（用户 2026-10-01 定案：初版未删减那 15 条 = 9 拟饵 + 6 鱼饵）。
  //
  //   为什么必须在这里守：BaitItem 是用 `"tooltip.anglertackle." + id + ".desc"`
  //   **拼**出来的键，而 check-lang.js 对拼接键只能按前缀模糊匹配
  //   （只要求"该前缀下至少有一个键"）—— 少一条它不会报，游戏里却会显示成键名。
  for (const id of BAITS) {
    for (const [lang, tbl] of [['zh_cn', zh], ['en_us', en]]) {
      const k = 'tooltip.anglertackle.' + id + '.desc';
      if (!tbl[k] || !String(tbl[k]).trim()) {
        bad(lang + ' 缺鱼饵说明 ' + k + ' —— tooltip 上会显示成一串原始 key');
        d++;
      }
    }
  }
  // 说明文字里不许写数字：体型门槛/上限、金红占比都是代码现算并单独显示的，
  // 手写一份进语言文件就会出现"两处同样的数字、其中一处永不更新"。
  for (const tbl of [zh, en]) {
    for (const [k, v] of Object.entries(tbl)) {
      if (!/^tooltip\.anglertackle\.(lure|bait)_[a-z0-9_]+\.desc$/.test(k)) continue;
      if (/\d/.test(String(v))) {
        bad(k + ' 的说明里出现了数字（' + JSON.stringify(v) + '）—— ' +
          '门槛/上限/金红占比都由代码按配置现算并单独成行，写进文案就会漂移');
        d++;
      }
    }
  }
  for (const [lang, tbl] of [['zh_cn', zh], ['en_us', en]]) {
    for (const k of ['gui.anglertackle.codex_col_habit', 'tooltip.anglertackle.lure_habit']) {
      if (!tbl[k] || !String(tbl[k]).trim()) { bad(lang + ' 缺 ' + k); d++; }
    }
  }
  if (d === 0) {
    ok('语言文件：' + (data.habits.length * 4) + ' 条词条 key + ' +
      Object.keys(data.lures).length + ' 条拟饵说明 + ' + BAITS.length + ' 条鱼饵说明' +
      ' + 图鉴列名/专攻行，中英全部对得上、且说明里没有数字');
  }
}

// ---------------------------------------------------------------- E 生成物一致
{
  const gen = require('./gen-fish-habits.js');
  const expect = gen.render(data);
  const rel = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishHabits.java';
  if (!exists(rel)) {
    bad('缺少生成物 ' + rel + '（跑 node tools/gen-fish-habits.js --write）');
  } else {
    const actual = read(rel);
    if (actual.replace(/\r\n/g, '\n') !== expect.replace(/\r\n/g, '\n')) {
      bad(rel + ' 与 tools/fish-habits.json 生成的内容不一致 —— ' +
        '要么手改了生成物，要么改了 json 没重跑生成器');
    } else ok('FishHabits.java 与 fish-habits.json 逐字节一致（' +
      Buffer.byteLength(actual, 'utf8') + ' 字节）');
  }
}

// ---------------------------------------------------------------- F 保底 +1
{
  const { stripComments } = require('./java-source.js');
  const src = stripComments(read('src/main/java/com/whitecobalt/anglertackle/fishing/FishHabits.java'));
  if (/Math\.max\(weight \+ 1,\s*weight \* BONUS_PERCENT \/ 100\)/.test(src)) {
    ok('权重加成里保底 +1 的写法还在（否则权重 3 的鱼乘 1.10 取整还是 3 = 零加成）');
  } else {
    bad('FishHabits.java 里的加成丢了保底 +1：' +
      '鱼池权重是整数、最小档位权重就是 3，光乘 110/100 会让那批鱼**一点加成都没有**');
  }
  if (!/BONUS_PERCENT = 110/.test(src)) {
    bad('BONUS_PERCENT 不是 110 —— 用户定案是"命中词条 ×1.10、不叠加"');
  }
}

console.log('');
console.log(fail === 0 ? '✅ 鱼习性词条检查通过' : '❌ 鱼习性词条检查未通过（' + fail + ' 项）');
process.exitCode = fail === 0 ? 0 : 1;
