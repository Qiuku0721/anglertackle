const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 守住"鱼种数值全都走配置"这条。
//
// ── 为什么需要它 ────────────────────────────────────────────
// FishSpecies 的 record 组件（specMinKg / specMaxKg / specProfile）是**源码里写死的规格值**，
// 运行期不该读。但 record 的字段访问就是裸标识符，编译器和肉眼都很难区分
// "读字段" 和 "调取值方法" —— 只要有一处漏改成 kgMin()，那处就会静默读到死值：
// 玩家改了配置、别的鱼都变了，就这一条鱼的某个数值不动，而且没有任何报错。
//
// 本检查做两件事：
//   ① FishSpecies 的实现里不许出现裸的 minKg / maxKg / profile
//   ② kgMin() / kgMax() / effectiveProfile() 确实指向 FishTuning（即配置文件）
//
// 用法：node tools/check-fish-config-wired.js
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const SPECIES = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
const TUNING = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishTuning.java');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const src = fs.readFileSync(SPECIES, 'utf8');
const lines = src.split('\n');

// ---------------------------------------------------------------- ① 不许有裸引用
// 只看方法体（record 头之后），并且跳过我们新加的那几个桥接方法本身。
const bodyStart = src.indexOf(') {\n');
const body = src.slice(bodyStart);
const bodyLines = body.split('\n');
const offenders = [];
bodyLines.forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
  // 桥接方法自己的实现要读 spec* 字段，那是合法的
  if (/return spec(Min|Max)Kg;|specProfile\.archetype\(\)/.test(l)) return;
  if (/spec(Min|Max)Kg|specProfile/.test(l)) return;   // spec* 是合法的规格值
  if (/(^|[^.\w])(minKg|maxKg|profile)(?![\w(])/.test(l)) {
    offenders.push((i + 1) + ': ' + t);
  }
});
if (offenders.length) {
  no('FishSpecies 里有 ' + offenders.length + ' 处裸引用（读的是源码死值，不跟配置）：');
  offenders.slice(0, 8).forEach((o) => console.log('     ' + o));
} else {
  ok('FishSpecies 里没有裸的 minKg / maxKg / profile 引用');
}

// ---------------------------------------------------------------- ② 三个取值方法必须指向 FishTuning
const mustWire = [
  ['public double kgMin()', 'FishTuning.minKg(id)'],
  ['public double kgMax()', 'FishTuning.maxKg(id)'],
  ['public FightProfile effectiveProfile()', 'FishTuning.profile(id'],
];
for (const [sig, call] of mustWire) {
  const i = src.indexOf(sig);
  if (i < 0) { no('找不到 ' + sig); continue; }
  const seg = src.slice(i, i + 220);
  if (seg.includes(call)) ok(sig.replace('public ', '').replace('()', '') + ' 走 FishTuning（读配置）');
  else no(sig + ' 没有调用 ' + call + ' —— 它可能读的是死值');
}

// ---------------------------------------------------------------- ③ FishTuning 的 getter 必须在
const tun = fs.readFileSync(TUNING, 'utf8');
for (const m of ['public static double minKg(String id)',
                 'public static double maxKg(String id)',
                 'public static FightProfile profile(String id']) {
  if (tun.includes(m)) ok('FishTuning 提供 ' + m.split('(')[0].replace('public static ', ''));
  else no('FishTuning 缺少 ' + m);
}

console.log(bad ? '\n❌ 有 ' + bad + ' 处问题 —— 鱼种数值可能没走配置' : '\n✅ 全部鱼种数值都通过 FishTuning 读配置');
process.exit(bad ? 1 : 0);
