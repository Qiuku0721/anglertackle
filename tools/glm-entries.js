/*
 * glm-entries.js —— 本模组战利品修饰符的**登记表**（跨生成器的唯一真源）。
 *
 * ── 26.1.2 起它不再是"索引文件的内容" ─────────────────────
 * 1.21.1 时 NeoForge 要一份 `data/neoforge/loot_modifiers/global_loot_modifiers.json`
 * 来列出所有修饰符；26.1.2 的 `LootModifierManager` 改成**扫目录**加载
 * （`FileToIdConverter.registry(…, "loot_modifiers")`），那份索引已从版本里删除，
 * 所以 `tools/gen-enchantments.js` **不再产出它**。
 *
 * 这份清单保留下来做两件事：
 *   ① 每个生成器（附魔书 / 村庄箱子）声明自己产出的修饰符 id；
 *   ② 由 `tools/gen-enchantments.js` 逐条核对"登记过的 id 都真的有对应的
 *      `data/<ns>/loot_modifiers/<name>.json`"（清单和文件必须一一对应）。
 *
 * ⚠ 26.1.2 里"会不会被加载"只看文件在不在 `data/<ns>/loot_modifiers/` 目录里；
 *   登记表漏一条不会让游戏不加载，但会让上面那条交叉核对失效 ——
 *   表现同样是"东西永远不掉"，没有报错、没有日志。
 */
const ENTRIES = [
  // 高质吸引附魔书：只注入超高价值箱子（古城 / 末地城 / 试炼密室凶兆）
  'anglertackle:high_quality_lure_book',
  // mod 鱼：注入原版村庄的渔夫小屋箱子，数值与老柯小屋相同
  'anglertackle:village_fisher_fish',
];

module.exports = { ENTRIES };
