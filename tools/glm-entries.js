/*
 * glm-entries.js —— `data/neoforge/loot_modifiers/global_loot_modifiers.json`
 * 里要登记的修饰符**清单**（唯一真源）。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────
 * 那个全局清单只能有**一个写者**：两个生成器同时写它，后跑的那个会把前一个的
 * 条目整段覆盖掉（本仓库的 AGENTS.md 第三条就是为这类事写的：两个进程写同一个
 * 生成文件，症状是"另一处静默失效"）。
 *
 * 所以：清单在这里集中声明，由 `tools/gen-enchantments.js` 负责写盘
 * （它是第一个需要这个文件的生成器），其它生成器只**核对**自己那条在不在清单里。
 *
 * ⚠ 没登记的修饰符根本不会被 NeoForge 加载 —— 表现是"东西永远不掉"，
 *   没有报错、没有日志。检查器 `check-enchantments.js` / `check-hut-loot.js`
 *   会逐条核对"文件在 + 清单里有 + id 对得上"。
 */
const ENTRIES = [
  // 高质吸引附魔书：只注入超高价值箱子（古城 / 末地城 / 试炼密室凶兆）
  'anglertackle:high_quality_lure_book',
  // mod 鱼：注入原版村庄的渔夫小屋箱子，数值与老柯小屋相同
  'anglertackle:village_fisher_fish',
];

module.exports = { ENTRIES };
