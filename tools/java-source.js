// Java 源码注释剥离 —— **所有检查脚本共用这一份**。
//
// ── 为什么要单独成模块 ──────────────────────────────────────
// 检查脚本经常要断言"代码里没有出现某个坏名字"。而注释里**恰恰在解释
// 那个坏名字为什么不能用**，所以不剥注释就会误报。
//
// 但"剥注释"这件事本身有坑，而且坑的后果比误报严重得多：
//
//   早先各个检查器里各写一份，**先剥块注释**：
//       s.replace(块注释正则, '')          // ← 先用这个
//        .replace(行注释正则, '');          // ← 再用这个（顺序就是病根）
//   而源码里有一行 `//` 注释中含有 `/*`（`/**售价**的数据面板）` 这种写法），
//   它被当成块注释的开头，于是从那里开始**一路吞到很远处的 `*/`** ——
//   中间大段真实代码被删掉。断言于是搜不到东西，"没有坏名字"轻松成立。
//
//   **误报会让人去改断言；空过会让人以为代码是对的。**后者才是灾难。
//   实测：CoinPricing.priceFor 明明在 FishingManager 里，剥完却消失了。
//
// 所以这里用**一遍扫描 + 状态机**，正确处理：
//   · 行注释 //       （含注释里出现 /* 的情况 —— 不再误开块注释）
//   · 块注释 /* */    （含跨行；剥掉内容但**保留换行**，行号不变）
//   · 字符串 "..."    （含 \" 转义；里面的 // 不当注释）
//   · 字符 '...'
//
// 局限：Java 文本块（""" ... """）没有单独处理，会被当成连续的普通字符串。
// 文本块里出现 `//` 时可能漏剥。本项目暂未使用文本块；真用到时在这里补。
'use strict';

/**
 * 剥掉 Java 源码里的注释，**保留行数与换行**（报错行号才对得上）。
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  const s = String(src);
  const n = s.length;
  let out = '';
  let state = 'code';   // code | line | block | str | char

  for (let i = 0; i < n; i++) {
    const c = s[i];
    const c2 = s.substr(i, 2);

    if (state === 'code') {
      if (c2 === '//') { state = 'line'; i++; continue; }
      if (c2 === '/*') { state = 'block'; i++; continue; }
      if (c === '"') { state = 'str'; out += c; continue; }
      if (c === "'") { state = 'char'; out += c; continue; }
      out += c;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      continue;
    }

    if (state === 'block') {
      if (c2 === '*/') { state = 'code'; i++; continue; }
      if (c === '\n') out += c;   // 保留换行，行号不乱
      continue;
    }

    // str / char：整段原样保留（里面的 // 和 /* 都不是注释）
    if (c === '\\') { out += c + (s[i + 1] || ''); i++; continue; }
    if ((state === 'str' && c === '"') || (state === 'char' && c === "'")) {
      state = 'code';
    }
    out += c;
  }
  return out;
}

module.exports = { stripComments };
