const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 守住"配置化数值真的会在启动时装载"这条。
//
// ── 真实事故 ────────────────────────────────────────────────
// 鱼种数值（[fishStats] 273 项）做完之后，玩家反馈"改了没生效、手感很软"。
// 查下来是：`FishTuning.build()` **只在 /atl config reload 里被调用**，
// 启动路径上一次都没调 —— 于是 VALUES 一直是空 map，每条鱼都走兜底值
//（鲫鱼的 0.7 拉力 / 0.9 张力系数），所有鱼手感一模一样地软。
//
// 这个 bug 的隐蔽之处：
//   · 不崩、不报错，游戏正常运行
//   · 配置文件里数值正确、调参器显示正确、"默认值比对"全部通过
//   · 唯一症状是"手感不对"，而这种主观感受很容易被归因到别的地方
// 所以必须有一条机器检查：**每个"运行期读取配置"的数值层，都必须在配置加载时被装载。**
//
// 用法：node tools/check-runtime-tuning-loaded.js
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const main = fs.readFileSync(path.join(JAVA, 'AnglersTackle.java'), 'utf8');
const fishTuning = fs.readFileSync(path.join(JAVA, 'fishing/FishTuning.java'), 'utf8');

// ---------------------------------------------------------------- ① 必须监听配置加载事件
const listensLoading = /ModConfigEvent\.Loading/.test(main);
const listensReloading = /ModConfigEvent\.Reloading/.test(main);
if (listensLoading) ok('AnglersTackle 监听了 ModConfigEvent.Loading');
else no('AnglersTackle 没有监听 ModConfigEvent.Loading —— 启动时不会装载运行期数值');

if (listensReloading) ok('AnglersTackle 监听了 ModConfigEvent.Reloading');
else no('AnglersTackle 没有监听 ModConfigEvent.Reloading —— 改完配置回主菜单不会刷新');

// ---------------------------------------------------------------- ② 事件里必须真的调用 build()
if (listensLoading && /FishTuning\.build\(\)/.test(main)) {
  ok('配置加载事件里调用了 FishTuning.build()');
} else if (listensLoading) {
  no('监听了配置事件但没在里面调用 FishTuning.build() —— 数值仍然是空的');
}

// ---------------------------------------------------------------- ③ 不许在 mod 构造里直接调
// 那会在"配置还没加载"的时刻读配置 → 启动崩溃
//（同一个坑的另一面，见 check-no-config-at-registration.js）
//
// 判据：往上找**最近的语句边界**（`;` / `{` / `}`）。
// 如果"本行 + 之前那段"里有 `->`，说明它在一个 lambda 体内 —— 那是延迟执行，安全。
// ⚠️ 不能只看前几行：lambda 体经常换行写成
//       modBus.addListener((ModConfigEvent.Loading e) -> {
//           FishTuning.build();
//       });
//     `->` 在 4 行之前，只看前 1~6 行会漏掉（踩过这个误报）。
{
  const lines = main.split('\n');
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);
  let flagged = 0;
  lines.forEach((l, i) => {
    if (isComment(l)) return;                 // 注释里提到 build() 不算调用
    if (!/FishTuning\.build\(\)/.test(l)) return;
    // 拼接"本行 + 往上到最近语句边界"的片段。
    // ⚠️ 只把 `;` 当边界，**`{` / `}` 不截断** —— lambda 的写法是
    //       addListener((Event e) -> {      ← `->` 在这里
    //           FishTuning.build();         ← 调用在这里，中间隔着一个 `{`
    //       });
    //   如果遇到 `{` 就停，就永远看不到那个 `->`，会把所有正确的写法都误报成"同步调用"（踩过）。
    // 同时跳过注释行：注释里提到的代码不该参与判断。
    let back = '';
    for (let j = i - 1; j >= 0 && j > i - 40; j--) {
      if (isComment(lines[j])) continue;
      if (/;/.test(lines[j])) break;
      back = lines[j] + '\n' + back;
    }
    const inLambda = /->/.test(back) || /->/.test(l);
    if (!inLambda) {
      no('AnglersTackle:' + (i + 1) + ' 在非 lambda 位置直接调用了 FishTuning.build() —— ' +
         '那会在配置加载前执行并崩溃');
      flagged++;
    }
  });
  if (!flagged) ok('FishTuning.build() 只在延迟回调（lambda）里调用，不在构造阶段同步执行');
}

// ---------------------------------------------------------------- ④ 兜底必须留痕
if (/loadedOnce/.test(fishTuning) && /尚未装载/.test(fishTuning)) {
  ok('FishTuning 对"未装载"会打 WARN（不会静默用兜底值）');
} else {
  no('FishTuning 没装兜底日志 —— "没装载"会静默发生，只能靠手感发现');
}
if (/LOGGER\.info\("\[垂纶\] 鱼种数值已装载/.test(fishTuning)) {
  ok('装载成功用 INFO 级打印（默认可见）');
} else {
  no('装载成功日志不是 INFO 级 —— 默认看不到，排查时没有线索');
}

// ---------------------------------------------------------------- ⑤ 手感来源诊断行
{
  const session = fs.readFileSync(path.join(JAVA, 'fishing/FishingSession.java'), 'utf8');
  if (/手感来源：id=/.test(session)) {
    ok('中鱼时会打印"手感来源"对账行（可直接比对配置文件）');
  } else {
    no('没有"手感来源"日志 —— 玩家无法自行判断配置有没有生效');
  }
}

console.log(bad ? '\n❌ 有 ' + bad + ' 处问题 —— 配置可能改了不生效'
                : '\n✅ 运行期数值会在配置加载时装载，且失败会留痕');
process.exit(bad ? 1 : 0);
