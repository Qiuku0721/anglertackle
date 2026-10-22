// 校验调参器 schema 与 Tuning.reload() 的热重载映射逐项对齐。
//
// 为什么必须校验：这两个列表来自不同地方（schema 从 Config.java 解析，
// 映射写在 Tuning.java 里手写的方法调用中），一旦漂移就有两种静默故障：
//   · schema 有、映射没有 → 调参器里能改、能写进 toml、游戏里没反应
//     （玩家会以为"这个选项是坏的"）
//   · 映射有、schema 没有 → 改不了，只能手改 toml
// 两种都不会报错、不会崩，只能靠这个脚本发现。
//
// 用法：node tools/check-tuning-schema.js
const fs = require('fs'), path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/tuning-schema.json'), 'utf8'));
const tun = fs.readFileSync(
  path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java'), 'utf8');

// ---- schema 侧的 TOML 路径：组 id + 段内键
const inSchema = new Map();
for (const g of schema.groups) {
  for (const f of g.fields) inSchema.set(g.id + '.' + f.key, f);
}

// ---- Tuning.reload 侧：put/putDoubleValue/putIntValue(flat, "路径", c.字段, counter)
// 字段前可能有强制转型，如 (int) c.hempTier —— 不跳过它就会漏掉所有 int 项。
const inReload = new Map();
for (const m of tun.matchAll(/put(?:DoubleValue|IntValue)?\(\s*flat\s*,\s*"([^"]+)"\s*,\s*(?:\([A-Za-z]+\)\s*)?c\.(\w+)/g)) {
  if (inReload.has(m[1])) {
    console.error('❌ Tuning.reload 里 ' + m[1] + ' 出现了两次（后一次会覆盖前一次）');
    process.exit(1);
  }
  inReload.set(m[1], m[2]);
}

let bad = 0;
for (const [p, f] of inSchema) {
  if (!inReload.has(p)) {
    console.error('❌ 调参器有 ' + p + '，但 Tuning.reload 没映射它 —— 改了不会有反应');
    bad++;
  }
}
for (const [p, field] of inReload) {
  if (!inSchema.has(p)) {
    console.error('❌ Tuning.reload 映射了 ' + p + '（c.' + field + '），但调参器/schema 里没有');
    bad++;
  }
}

// ---- 顺带核对：映射引用的 Java 字段确实存在于 Config.java
const cfg = fs.readFileSync(
  path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java'), 'utf8');
const fields = new Set([...cfg.matchAll(/^\s+public final ModConfigSpec\.\w+Value (\w+);/gm)].map((m) => m[1]));
for (const [p, field] of inReload) {
  if (!fields.has(field)) {
    console.error('❌ Tuning.reload 里 ' + p + ' → c.' + field + '，但 Config.java 没有这个字段');
    bad++;
  }
}

// ---- 顺带核对：每一项都必须带**中文说明**（调参器上唯一的解释来源）
//
// 用户 2026-10-06 报"调参器里有几项没有中文说明"：585 项里 17 项 comment 是空串。
// 根因不在数据，而在 gen-tuning-schema.js 的注释正则 —— 说明里只要带一个英文双引号
// （`渔轮阻尼中\"能折算进张力上限\"的那部分`），`[^"]*` 就被截断、整条匹配失败。
// 所以这条断言守的是"**生成器不能再把说明吃掉**"：空说明 = 玩家只看到一个数字。
const totalFields = schema.groups.reduce((n, g) => n + g.fields.length, 0);
const noComment = [];
for (const g of schema.groups) {
  for (const f of g.fields) {
    if (!String(f.comment || '').trim()) noComment.push(g.id + '.' + f.key);
  }
}
if (noComment.length) {
  console.error('❌ 这些项在调参器里**没有中文说明**（玩家只看到一个数字）：' + noComment.join('、'));
  console.error('   多半是说明里带英文双引号把生成器的注释正则截断了（见 gen-tuning-schema.js 的 unescapeJava）');
  bad++;
} else {
  console.log('✅ 全部 ' + totalFields + ' 项都有中文说明');
}
// 组说明也一样：缺了的话整组在调参器上没有开场白
const noGroupComment = schema.groups.filter((g) => !String(g.comment || '').trim()).map((g) => g.id);
if (noGroupComment.length) {
  console.error('⚠ 这些组没有开场白（不影响使用，但调参器上会少一段解释）：' + noGroupComment.join('、'));
}

const n = inSchema.size;
console.log('schema ' + n + ' 项 / 热重载映射 ' + inReload.size + ' 项 / Config 字段 ' + fields.size + ' 个');
if (bad) { console.error('\n不一致 ' + bad + ' 处'); process.exit(1); }
if (inSchema.size !== inReload.size) { console.error('\n❌ 数量不等'); process.exit(1); }
if (fields.size !== inReload.size) {
  console.error('\n❌ Config 字段数(' + fields.size + ')与热重载映射数(' + inReload.size +
                ')不等 —— 有字段没接进热重载');
  process.exit(1);
}
console.log('✅ schema / 热重载映射 / Config 字段三者逐项一致');
