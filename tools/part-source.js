// 配件注册项的**唯一**解析口径（供 gen-part-config.js 与 rewrite-part-stats.js 共用）。
//
// ── 为什么必须共用 ───────────────────────────────────────────
// 这两个脚本是"读字面量 → 生成配置项"和"把字面量换成 Tuning 调用"的两半，
// 它们必须对"每个物品的属性是什么"得出完全一致的结论。
// 一旦两边的作用域规则不同，就会**错位**：A 脚本跳过一个物品，B 脚本没跳，
// 于是从被跳过的那一项开始，每个物品都拿到前一个物品的数值。
// 这个 bug 已经真实发生过：
//   · 亮片拟饵（lure_spoon：单行 `PartStats.lure(2)` 写法）被两边的
//     `[^)]*` 正则跳过 —— 那个字符类跨不过它自己的收尾括号，
//     正则于是继续往后吃，吃到了下一个物品（guide_book）；
//   · 两边都跳过它，于是 20 个位置里挤进了错误的成员，耐久/档位整体错位一格；
//   · check-part-config-parity.js 抓不到：它只比对"配置默认值 == 源码字面量"，
//     两边是同一份错位数据，恒等成立。
// 现在的做法：先把注册块按 `ITEMS.register("id"` 切好，再在块内找 partProps，
// 并用括号配对取参数 —— 与书写格式（单行/多行）无关。
const fs = require('fs');
const path = require('path');

const KEYS = {
  line: ['tensionCeiling', 'tensionGen', 'tensionRecover', 'lineLength', 'tier'],
  // 渔轮 2026-10-05 起带档位（用户："渔轮有品质记得不要乱"）——
  // 第 5 个参数就是 PartStats.reel(..., tier)，1 起算（1白…6红），0 仍是"没有档位"。
  // ⚠ 少了这个 'tier'，gen-part-config 的参数个数闸门会直接报
  //   "hand_reel 参数个数 5 与预期 4 不符" 并中止整条链（这就是那次参数错位事故留下的守卫）。
  reel: ['pullIdle', 'pullStruggle', 'staminaDrain', 'damping', 'tier'],
  hook: ['windowBonus'],
  lure: ['tier'],
};

// ------------------------------------------------------------------ 中文名
// 从 lang 文件读配件的中文名，而不是在脚本里另抄一份。
// 抄一份的话：改名后调参器还显示旧名字，玩家按名字找不到东西，
// 而这种偏差没有任何检查能发现（两边都"自洽"）。
const LANG = path.join(__dirname, '..',
  'src/main/resources/assets/anglertackle/lang/zh_cn.json');
let zhNames = null;
try {
  const j = JSON.parse(fs.readFileSync(LANG, 'utf8'));
  zhNames = {};
  for (const [k, v] of Object.entries(j)) {
    const m = /^item\.anglertackle\.(.+)$/.exec(k);
    if (m) zhNames[m[1]] = v;
  }
} catch (e) {
  zhNames = null;   // 读不到就退回用 id，不该因此让生成器整个挂掉
}

/** 物品 id → 中文名（读不到 lang 时退回 id 本身）。 */
function zhName(id) {
  return (zhNames && zhNames[id]) || id;
}

/**
 * 解析一份 ModItems.java，返回按**文件出现顺序**排列的配件列表。
 * @param {string} src ModItems.java 内容
 * @param {{literals:boolean}} opts literals=true 时要求参数是数字字面量/算式；
 *        false 时接受 Tuning.xxx() 调用（用于校验改写结果）
 */
function parseParts(src, opts = {}) {
  const parts = [];
  // 逐个注册块：从 ITEMS.register("id" 开始，到下一个 register 之前
  const regRe = /ITEMS\.register\("([a-z_0-9]+)"/g;
  const marks = [];
  let m;
  while ((m = regRe.exec(src))) marks.push({ id: m[1], at: m.index });

  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const block = src.slice(marks[i].at, end);

    const call = /partProps\(\s*(\d+)\s*,\s*Rarity\.\w+\s*,\s*PartStats\.(\w+)\(/.exec(block);
    if (!call) continue;   // 不是六槽配件（如 chum_grain）

    const kind = call[2];
    const keys = KEYS[kind];
    if (!keys) continue;

    const argsStart = call.index + call[0].length;
    const args = splitArgs(block, argsStart);

    // ⚠️ evalNumOrThrow(...) 要**先调用一次**拿到求值函数，再 map。
    // 写成 args.map(evalNumOrThrow.bind(null, id)) 会把 bind 的结果当成元素存起来，
    // values 里就是一串函数而不是数字 —— 于是 `values[i] < 1` 恒为 false，
    // 所有"数值范围"断言全部**假通过**。（真实踩到：自检脚本打印 values 才发现。）
    const evalOne = opts.literals ? evalNumOrThrow(marks[i].id) : null;

    parts.push({
      id: marks[i].id,
      /** 中文名（来自 lang 文件），用于调参器显示 */
      name: zhName(marks[i].id),
      durability: Number(call[1]),
      kind,
      keys,
      args,
      /** 该配件的属性默认值（仅字面量模式可用） */
      values: evalOne ? args.map(evalOne) : null,
    });
  }
  return parts;
}

/** 从 argsStart 起按括号配对取顶层逗号分隔的参数。 */
function splitArgs(block, argsStart) {
  const out = [];
  let depth = 0, cur = '';
  for (let p = argsStart; p < block.length; p++) {
    const ch = block[p];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) { out.push(cur.trim()); return out.filter((s) => s !== ''); }
      depth--;
    } else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  throw new Error('参数括号没配对（从偏移 ' + argsStart + ' 起）');
}

function evalNumOrThrow(id) {
  return (s) => {
    const t = String(s).trim();
    if (!/^[-+*/(). 0-9]+$/.test(t)) {
      throw new Error(id + ' 的参数不是数字字面量：' + t +
        '（literals 模式要求源码里是原始数字；若已被 rewrite 改写成 Tuning 调用，' +
        '请先从备份还原）');
    }
    const v = Function('"use strict";return (' + t + ')')();
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(id + ' 的参数求值失败：' + t);
    }
    return v;
  };
}

module.exports = { parseParts, KEYS, splitArgs, zhName };
