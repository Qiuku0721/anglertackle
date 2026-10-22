/*
 * _update-fish-baseline.js —— 把所有鱼种补进
 * 参考资料/_before_fishcfg/FishSpecies.java.bak（"配置化之前的源码字面量"参照物）。
 *
 * 为什么必须补：check-fish-config-parity.js 拿这份 bak 当**真值**，逐项比对
 * Config.java 里生成的默认值。加鱼之后 Config 多了 N×13 项，而 bak 里没有 →
 * 它会把新鱼报成"多出配置项"，而那条报错会把真正的"老鱼数值被悄悄改了"淹掉。
 *
 * 做法刻意保守：**只追加当前源码里有、而 bak 里没有的 new FishSpecies(...) 块**
 * （原样切出来），已经在那儿的鱼一行都不动 —— 那份参照物对老鱼仍然是
 * "改动前"的快照，比对仍然能抓到"老鱼数值被悄悄改了"。
 *
 * ⚠ 2026-10-08 改成**自动识别缺哪几条**：以前 NEW_IDS / 插入锚点 / "预期 26 条"
 *   三处都是写死的（只服务第三批），第四次加鱼时三处全要手改，而任何一处忘了改
 *   都会以"基线仍与源码不一致"或"注入后条数是 X"这种**看起来像别的问题**的报错收场。
 *   现在只需要跑一次，缺几条补几条，条数与逐项一致都由脚本自查。
 *
 * 用法：node tools/_update-fish-baseline.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CUR = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
const BAK = path.join(ROOT, '参考资料/_before_fishcfg/FishSpecies.java.bak');

/** 取出 `new FishSpecies("<id>", ... )` 的完整源码块（到匹配的右括号为止）。 */
function blockOf(src, id) {
  const head = 'new FishSpecies("' + id + '",';
  const at = src.indexOf(head);
  if (at < 0) throw new Error('源码里找不到 ' + id);
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(id + ' 的括号没配对');
}

const { parseFish } = require('./fish-source.js');
let bak = fs.readFileSync(BAK, 'utf8');
const cur = fs.readFileSync(CUR, 'utf8');

const ids = [...cur.matchAll(/new FishSpecies\("([a-z_0-9]+)"/g)].map((m) => m[1]);
const missing = ids.filter((id) => !bak.includes('new FishSpecies("' + id + '"'));

if (!missing.length) {
  console.log('基线里已经有全部 ' + ids.length + ' 种鱼，无需改动。');
  process.exit(0);
}

// 插入点：bak 里 ALL 列表收尾的那个 `\n    );`。
// ⚠ 用**最后一次**出现的位置，不写死"某条鱼之后" —— 写死的锚点每次加鱼都要改，
//   而且锚点失效时会抛"找不到锚点"，看起来像基线文件坏了。
const cut = bak.lastIndexOf('\n    );');
if (cut < 0) throw new Error('基线里找不到 ALL 列表的收尾 `\\n    );`');
const blocks = missing.map((id) => blockOf(cur, id));
bak = bak.slice(0, cut)
  + ',\n\n            // ---- 追加（_update-fish-baseline.js 注入，与当前源码逐字一致）----\n'
  + blocks.map((b) => '            ' + b).join(',\n\n')
  + bak.slice(cut);

// 写回前自检①：条数必须正好等于当前源码的条数
const n = [...bak.matchAll(/new FishSpecies\(/g)].length;
if (n !== ids.length) throw new Error('注入后条数是 ' + n + '，当前源码是 ' + ids.length + ' —— 没有写回');

// 写回前自检②：解析出来的每一条数值必须与当前源码逐项一致
const a = new Set(parseFish(bak).map((f) => f.id + '|' + f.rods + '|' + JSON.stringify(f.values)));
const bad = parseFish(cur).filter((f) => !a.has(f.id + '|' + f.rods + '|' + JSON.stringify(f.values)));
if (bad.length) throw new Error('基线仍与源码不一致：' + bad.map((f) => f.id).join(', ') + ' —— 没有写回');

fs.writeFileSync(BAK, bak, 'utf8');
console.log('✅ 基线已追加 ' + missing.join(' / ') + '，现在共 ' + n + ' 条');
console.log('✅ 自查：基线与当前源码 ' + n + ' 条鱼的数值逐项一致');
