'use strict';
/**
 * 菜名（docs/25 §13.5 表格里那一列）→ 菜型 / 贴图 id —— **唯一真源**。
 *
 * <h2>为什么会有这个模块（2026-10-10）</h2>
 * 补第二批 19 条鱼的时候，`check-dish-recipes.js` 与 `check-dish-coverage.js`
 * **各抄了一份手写的菜名正则表**：
 * <pre>
 *   [/丸/, 'fish_ball'],
 *   [/油炸(横纹鱼|白条)/, 'deep_fried_fish'],     ← 把鱼名写进正则里
 *   [/炸鲇鱼|炸泥鳅/, 'fried_fish_chunk'],
 *   [/鲫鱼汤|鲻鱼汤/, 'fish_soup'],
 *   [/鲇鱼炖|泥鳅炖|慢炖/, 'fish_stew'],
 * </pre>
 * 于是新加的"油炸毛鳞鱼 / 炸鳕鱼块 / 狼鱼汤 / 格陵兰鲨炖"**一个都认不出来** ——
 * 两条检查器同时红，报"这些菜归不到任何贴图（新做法？菜名改了？）"。
 * 补正则能让它变绿，但那是**把抄表抄得更长**：每加一条鱼就要记得改两处正则，
 * 忘一处就是一次假红/假绿。所以改成**从语言文件的名字模板现推**：
 * <pre>
 *   dish.anglertackle.braised_fish = 红烧%s
 *   dish.anglertackle.fish_soup    = %s汤
 *   dish.anglertackle.creamy_fish_soup = 奶白%s汤
 * </pre>
 * 模板本来就是"菜名怎么拼出来"的**唯一权威**（配方书 / JEI 都用它），
 * 于是"文档里写的菜名"与"游戏里真显示的名字"对不上时，这里必然报红 —— 正是我们要的。
 *
 * <p>⚠ 只保留**一条**手写别名：文档把"慢炖雷龙"写成了做法词前置（模板是 `%s炖`），
 * 那是文档的行文习惯，不是游戏里的名字 —— 这条别名必须在注释里说明，不许再长。
 */

const fs = require('fs');
const path = require('path');

// ⚠⚠ 必须和别的检查器**用同一套 ROOT 解析**（`ATL_ROOT` 优先）。
// 负向测试（tools/negtest.ps1）会把工程复制到临时目录、用 ATL_ROOT 指向副本，
// 然后在副本里做变异。如果这里自己算 `path.join(__dirname, '..')`，
// 它读到的就永远是**真仓库**的语言文件 —— 变异落空、负例变成假绿，
// 而且症状是"检查器明明该红却是绿的"，极难查（2026-10-10 踩着一次：
// 负例 dish-name-template-gone 期望退出码 1，实际 0）。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const LANG = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';

/** 设备菜（不是 Dish 枚举里的工作台菜型），在"逐鱼许可表"比对里要忽略。 */
const DEVICE_IDS = new Set(['smoked_fish', 'charred_fish']);

/** 文档里的手写别名。**只允许这一条**，加新的必须写清理由。 */
const ALIAS = [
  // docs/25 §13.5 第 12 行写作"慢炖雷龙"（做法词前置），而模板是 `%s炖`（"雷龙炖"）。
  // 这是文档行文习惯，不是游戏内的名字，所以在这里认一次。
  [/慢炖/, 'fish_stew'],
  // 清烤没有独立菜图（用户定的例外），它显示的就是"熟鱼块"。
  [/清烤/, '熟鱼块'],
];

let cache = null;

/** 读出全部 `dish.anglertackle.<id>` 名字模板，**更具体的排在前面**。 */
function loadTemplates() {
  if (cache) return cache;
  const lang = JSON.parse(fs.readFileSync(path.join(ROOT, LANG), 'utf8'));
  const list = [];
  for (const [k, v] of Object.entries(lang)) {
    const m = /^dish\.anglertackle\.([a-z_]+)$/.exec(k);
    if (!m || typeof v !== 'string' || !v.includes('%s')) continue;
    const parts = v.split('%s');
    const pre = parts[0];
    const suf = parts.slice(1).join('%s');
    list.push({ id: m[1], pre, suf, spec: pre.length + suf.length });
  }
  // ⚠ 顺序有意义："奶白%s汤"（spec 3）必须赢过 "%s汤"（spec 1），
  //    否则"奶白鲫鱼汤"会被判成普通鱼汤。
  list.sort((a, b) => b.spec - a.spec || a.id.localeCompare(b.id));
  cache = list;
  return list;
}

/**
 * 菜名 → 菜型 id（认不出返回 null）。
 * 传入的字符串可以带 Markdown 的 `**` 与 （工作台·生料）这类括号注。
 */
function classify(name) {
  const n = String(name == null ? '' : name).replace(/\*\*/g, '').replace(/（[^）]*）/g, '').trim();
  if (!n) return null;
  for (const [re, id] of ALIAS) if (re.test(n)) return id;
  for (const t of loadTemplates()) {
    if (t.pre && t.suf) {
      if (n.startsWith(t.pre) && n.endsWith(t.suf)) return t.id;
    } else if (t.pre) {
      if (n.startsWith(t.pre)) return t.id;
    } else if (t.suf) {
      if (n.endsWith(t.suf)) return t.id;
    }
  }
  return null;
}

/** 只认**工作台**菜型（设备菜与清烤返回 null）—— 给逐鱼许可表比对用。 */
function classifyWorkbench(name) {
  const id = classify(name);
  return id && !DEVICE_IDS.has(id) && id !== '熟鱼块' ? id : null;
}

module.exports = { classify, classifyWorkbench, loadTemplates, DEVICE_IDS, LANG };
