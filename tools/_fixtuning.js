// 一次性：把三个生成器的 Tuning 写入改成"登记 + 统一提交"。
//
// 各生成器只登记自己那几块内容；最后由 gen-gameplay-config（链上最后一个）
// 调 commitBlocks 统一落盘 —— 那时三组内容都已在 pending 里，可以按
// SECTIONS 顺序写，位置不再依赖调用先后。
const fs = require('fs'), path = require('path');
const T = path.join(__dirname, '..', 'tools');

/** 把 src 里 [from, to) 之间的内容替换成 repl。 */
function cut(src, marker, repl) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('找不到标记：' + marker);
  return { head: src.slice(0, i), tail: src.slice(i), i };
}

const FIXES = [
  {
    file: 'gen-part-config.js',
    // 把"peelAll + 三个 writeSection + 校验 + 写盘"整段换成"登记"
    from: '// ---------------------------------------------------------------- Tuning.java',
    to: '// ---------------------------------------------------------------- FishTuning.js 之后',
    repl: `// ---------------------------------------------------------------- Tuning.java
//
// 只**登记**内容，不写盘：位置由 tools/tuning-source.js 按 SECTIONS 顺序统一决定。
// 早先这里直接 writeSection，而块的位置靠"前一个块的 END"决定 ——
// partsGetter 的前一个是 gameReload（属于玩法生成器），那时还没写，
// 于是"怎么排顺序都会有人报错"。改成登记 + 统一提交后，顺序不再重要。
const TS = require('./tuning-source.js');
TS.stageBlock('partsReload', apply);
TS.stageBlock('partsGetter', getters);
TS.stageBlock('partsHelper', [
  '/** double 专用：ConfigValue<Double>.set 要 Double 而不是 Number。 */',
  'private static void putDoubleValue(java.util.Map<String, Object> flat, String path,',
  '                                   net.neoforged.neoforge.common.ModConfigSpec.ConfigValue<Double> value,',
  '                                   int[] counter) {',
  '    Object v = flat.get(path);',
  '    if (!(v instanceof Number num)) { return; }',
  '    try { value.set(num.doubleValue()); value.clearCache(); counter[0]++; }',
  '    catch (Throwable t) { AnglersTackle.LOGGER.debug("[垂纶] 热重载跳过 {}：{}", path, t.toString()); }',
  '}',
  '',
  '/** int 专用（配件档位 tier）。 */',
  'private static void putIntValue(java.util.Map<String, Object> flat, String path,',
  '                                net.neoforged.neoforge.common.ModConfigSpec.ConfigValue<Integer> value,',
  '                                int[] counter) {',
  '    Object v = flat.get(path);',
  '    if (!(v instanceof Number num)) { return; }',
  '    try { value.set(num.intValue()); value.clearCache(); counter[0]++; }',
  '    catch (Throwable t) { AnglersTackle.LOGGER.debug("[垂纶] 热重载跳过 {}：{}", path, t.toString()); }',
  '}',
]);
console.log('  已登记配件 Tuning 块（等统一提交）');

`,
  },
  {
    file: 'gen-fish-config.js',
    from: '// ---------------------------------------------------------------- Tuning.java',
    to: '// ---------------------------------------------------------------- FishTuning.java',
    repl: `// ---------------------------------------------------------------- Tuning.java
//
// 同 gen-part-config：只登记，不写盘（见那边的注释）。
const TS = require('./tuning-source.js');
TS.stageBlock('fishReload', apply);
TS.stageBlock('fishGetter', getters);
console.log('  已登记鱼种 Tuning 块（等统一提交）');

`,
  },
];

for (const f of FIXES) {
  const p = path.join(T, f.file);
  let src = fs.readFileSync(p, 'utf8');
  const i = src.indexOf(f.from);
  const j = src.indexOf(f.to);
  if (i < 0 || j < 0 || j <= i) { console.log('  ❌ ' + f.file + ' 找不到替换区间'); continue; }
  src = src.slice(0, i) + f.repl + src.slice(j);
  fs.writeFileSync(p, src, 'utf8');
  console.log('  ✔ ' + f.file + ' 已改为登记模式');
}
