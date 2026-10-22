// 一次性：把 gen-part-config.js 的 Tuning 段改成"登记模式"。
const fs = require('fs'), path = require('path');
const p = path.join(__dirname, '..', 'tools/gen-part-config.js');
let src = fs.readFileSync(p, 'utf8');

const MARK = '// ---------------------------------------------------------------- Tuning.java';
const NEXT = "\nconsole.log('\\n下一步（顺序不能反）：node tools/rewrite-part-stats.js --write');";
const i = src.indexOf(MARK);
const j = src.indexOf(NEXT);
if (i < 0 || j < 0 || j <= i) { console.error('❌ 找不到替换区间'); process.exit(1); }

const repl = `// ---------------------------------------------------------------- Tuning.java
//
// 只**登记**内容，不写盘：块的位置由 tools/tuning-source.js 按 SECTIONS 顺序统一决定。
//
// 为什么不能在这里直接写：块的位置靠"前一个块的 END 标记"决定，而
// partsGetter 的前一个块是 gameReload（属于玩法生成器）—— 跑本脚本时它还不存在，
// 于是"怎么排顺序都会有某个生成器报错"。改成登记 + 统一提交后，顺序不再重要。
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
console.log('  已登记配件 Tuning 块（' + (apply.length + getters.length) + ' 行，等统一提交）');
`;

src = src.slice(0, i) + repl + src.slice(j);
fs.writeFileSync(p, src, 'utf8');
console.log('✔ gen-part-config.js 已改为登记模式');
