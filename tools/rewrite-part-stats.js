// ⛔ 这个脚本**已被废弃，永远不要启用**。
//
// ── 为什么 ──────────────────────────────────────────────────
// 它当初的意图是：把 ModItems.java 里配件数值的字面量换成 `Tuning.xxx()` 调用，
// 让"每个配件的属性"能跟着配置文件走。
//
// 那个意图**从根上就是错的**，而且代价是一次真实的启动崩溃：
//
//   java.lang.IllegalStateException: Cannot get config value before config is loaded.
//       at Tuning.hempTensionCeiling(Tuning.java:177)
//       at ModItems.lambda$static$1(ModItems.java:117)
//       at DeferredRegister$Items.lambda$register$0
//
// 原因是 NeoForge 的时序：`container.registerConfig(...)` 只是**登记**，
// 配置真正加载发生在**所有 mod 构造完成之后**。而 DeferredRegister 的 supplier
// 在 RegisterEvent 里执行 —— 也就是"配置还没加载"的时刻。
// 于是任何在物品定义里读配置的代码都必然崩，且是启动即崩（连主界面都进不去）。
//
// 更深一层：**逐件配件数值本来就不该做成配置**。
// 配件属性是靠 `partProps(..., PartStats.xxx(...))` 在注册期烘进物品的
// `PART_STATS` 数据组件的；运行期 RodStats.statsOf() 读的是那个组件，
// 不是配置。所以就算能读配置，也只是"把当时的配置值烤进物品"——
// 改配置对已经注册的物品没有任何作用，热重载更不可能生效。
//
// 真正生效的是 `[parts]` 那一组（合成权重与上限）：PartComposer 在运行期
// 合成属性时读它，所以 /atl config reload 对它有效。`[partsStats]` 那 79 项
// 只是"记录当前数值"，改了不会有任何效果。
//
// 用法：node tools/rewrite-part-stats.js   → 只打印这段说明，不做任何事。
const fs = require('fs');

console.log('⛔ rewrite-part-stats 已废弃，未做任何改动。');
console.log('');
console.log('原因：在物品定义里读配置会在 RegisterEvent 阶段抛');
console.log('      "Cannot get config value before config is loaded."，游戏启动即崩。');
console.log('      NeoForge 的配置加载晚于 mod 构造，而 DeferredRegister 的 supplier');
console.log('      正是在那之前执行的。');
console.log('');
console.log('配件属性由 partProps() 在注册期烘进 PART_STATS 数据组件，运行期读的是组件，');
console.log('不是配置。所以逐件数值无法热重载 —— 这是引擎时序决定的，不是实现问题。');
console.log('');
console.log('生效的配件配置是 [parts] 那组（合成权重与上限，PartComposer 运行期读取）。');

if (process.argv.includes('--force')) {
  console.error('\n❌ 即使加 --force 也不执行：这会让游戏启动崩溃。');
  console.error('   如果你确实想恢复这个行为，请先重新设计（例如把数值放到数据包 / 数据组件），');
  console.error('   而不是在注册期读配置。');
  process.exit(1);
}
process.exit(0);

