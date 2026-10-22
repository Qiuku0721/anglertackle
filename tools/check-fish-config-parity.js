const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 校验 Config.java 里生成的鱼种默认值，与**冻结基线快照**逐位一致。
//
// 与 check-part-config-parity.js 同构：从 FishSpecies.java 的**字面量备份**解析出
// 每条鱼的真实数值，与 Config.java 里生成的默认值逐项比对。
//
// ── 这份快照的两个阶段（别把它当成"永远不该动"）──────────────────
// ① 2026-09：把鱼种数值搬进配置文件时的**改动前基线** ——
//    那时它是"证明没偷改数值"的证据。
// ② 2026-10-17：用户定案「把我调好的数值设为出厂默认」，于是数值**有意**变了
//    （拉力整体 ×1.5、疲劳倍率 0.5→0.42、另有 9 项单独调过的体力/张力）。
//    快照因此**重新取样**成当天的值 —— 它的角色从"改动前基线"变成
//    "**调参冻结基线**"：以后任何一次生成若把疲劳倍率解析断了、或把某条鱼拉平了，
//    这里会立刻报红（这正是它现在唯一还要保证的事）。
//
// ⚠ 所以：**改鱼种数值 = 有意改手感**，必须同时重新取样快照并在 docs 留记录；
//   别为了让这条变绿而直接改期望值（那就等于删掉这条闸）。
//
// 用法：node tools/check-fish-config-parity.js
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const { parseFish, FIELDS } = require('./fish-source.js');

const bakPath = path.join(ROOT, '参考资料/_before_fishcfg/FishSpecies.java.bak');
const cfgPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java');
if (!fs.existsSync(bakPath)) { console.error('❌ 找不到字面量版备份：' + bakPath); process.exit(1); }

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const fieldName = (id, key) => camel(id) + key.charAt(0).toUpperCase() + key.slice(1);

// ---- 期望值：从字面量备份里算出来
const truth = new Map();
for (const f of parseFish(fs.readFileSync(bakPath, 'utf8'))) {
  for (const fd of FIELDS) {
    truth.set(fieldName(f.id, fd.key), f.values[fd.key]);
  }
}

// ---- 实际值：从 Config.java 的鱼种数值段里读
const cfg = fs.readFileSync(cfgPath, 'utf8');
const i0 = cfg.indexOf('// ==== BEGIN 鱼种数值定义 ====');
const i1 = cfg.indexOf('// ==== END 鱼种数值定义 ====');
if (i0 < 0 || i1 < 0) { console.error('❌ Config.java 里找不到鱼种数值定义段'); process.exit(1); }
const block = cfg.slice(i0, i1);

const got = new Map();
for (const m of block.matchAll(/(\w+)\s*=\s*b([^;]*);/g)) {
  const name = m[1];
  const chain = m[2].replace(/(\d)[DdFfLl](?![0-9A-Za-z_])/g, '$1');   // 剥 Java 后缀
  const d = /\.defineInRange\("(\w+)",\s*([-+*/(). 0-9]+?)\s*,/.exec(chain);
  if (!d) continue;
  got.set(name, Function('"use strict";return (' + d[2] + ')')());
}

let bad = 0, ok = 0;
for (const [name, want] of truth) {
  if (!got.has(name)) { console.error('❌ 缺少配置项：' + name + '（原值 ' + want + '）'); bad++; continue; }
  const have = got.get(name);
  // 浮点比较：源码里的算式（如 pull * 0.5）与生成的十进制字面量可能有末位差异
  if (Math.abs(have - want) > 1e-9) {
    console.error('❌ 默认值漂移 ' + name + '：原 ' + want + ' → 生成 ' + have);
    bad++;
  } else ok++;
}
for (const name of got.keys()) {
  if (!truth.has(name)) { console.error('❌ 多出配置项：' + name); bad++; }
}

console.log('比对 ' + ok + ' / ' + truth.size + ' 项鱼种数值');
if (bad) { console.error('\n默认值不一致 ' + bad + ' 处 —— 手感会静默改变'); process.exit(1); }
console.log('✅ 全部默认值与冻结基线快照一致（' + (truth.size / 13) + ' 条鱼 × 13 项 —— 2026-10-17 按用户冻结的调参重新取样）');
