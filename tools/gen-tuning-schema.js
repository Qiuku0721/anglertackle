// 从 Config.java 生成调参工具的数据（字段表 + 分组 + 上下限 + 中文说明）。
//
// 为什么自动生成而不是手写字段表：
//   手写的表一旦 Config.java 增删项目就会漂移，工具会显示"不存在的选项"
//   或者漏掉新选项 —— 那种工具比没有更坏（改了没反应，还以为改上了）。
//
// ── Config.java 的分组写法（本脚本依赖这个结构）──────────────
//     b.comment("""组说明...""").push("groupId");   ← 开场白，紧接字段
//     fieldA = b.comment("...").defineInRange("fieldA", 1.0, 0.0, 10.0);
//     fieldB = b.comment("...").define("fieldB", true);
//     b.pop();
//   所以字段体 = push("id") 之后 到 配对 b.pop() 之前。
//
// ── 两个踩过的坑 ────────────────────────────────────────────
// 1) 逐行正则匹配 .defineInRange(...)：要求整条链写在一行。后来
//    tools/gen-part-config.js 生成的 79 个配件项是多行链式调用，一条都匹配不到，
//    整个 parts_stats 组**静默消失** —— 工具照样打开能用，只是少了 79 个选项，
//    没有任何报错。现改为按 `;` 切块，与书写格式无关。
// 2) 用"上一个 push 到本 push"来划分字段：方向反了，会把上一个组的字段算进
//    本组，导致同一个 key 出现在两个组里（调参器会各自算一份，导出两份冲突值）。
//
// 输出：tools/tuning-schema.json（供 调参器.html 内嵌使用）
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const cfgPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java');
const src = fs.readFileSync(cfgPath, 'utf8');

const NUM = '([-+*/(). \\t0-9]+?)';   // 默认值/边界可能是算式，如 35.0 / 30.0

// 解析器一旦跟 Config.java 的写法脱节，症状是"某些组一个字段都解析不到"。
// 但不能对每个空组都报错：rarityGate 是源码里**故意留空**的占位组
// （注释写着"这一组还没有实现"）。所以改成整体计数守卫 —— 只要解析到的
// 字段总数比已知基线少，就说明有东西没解析出来，必须停下。
const BASELINE = 109;   // 2026-09 更新：原有 35 项（8 组）+ 配件数值 74 项 = 109。
                        // 注意 74 不是 79：5 个鱼线 length 项是 5 条线而不是 6 条，
                        // 配件注册项里的哪几个不产配置项以实际解析结果为准，
                        // 这个数字只在"明显变少"时用来报警。

const groups = [];

// ------------------------------------------------------------------ 1. 按 push → 配对 pop 取字段体
// 必须跟踪嵌套深度：parts_stats 里每个配件自己也有 push/pop（子分组），
// 用 indexOf('b.pop()') 会停在**第一个内层 pop**，字段被截断。
// 踩过：这样写出来 74 项而不是 79 项，调参器少 5 个选项且没有任何提示。
const TOK = /\.push\("(\w+)"\)|b\.pop\(\)/g;
const pushRe = /\.push\("(\w+)"\)/g;
let pm;
while ((pm = pushRe.exec(src))) {
  const id = pm[1];
  const bodyStart = pm.index + pm[0].length;

  TOK.lastIndex = bodyStart;
  let depth = 1, end = src.length, t;
  while ((t = TOK.exec(src))) {
    if (t[0] === 'b.pop()') { if (--depth === 0) { end = t.index; break; } }
    else depth++;
  }
  if (depth !== 0) {
    console.error('❌ 分组 ' + id + ' 的 b.pop() 没配对 —— Config.java 括号结构坏了');
    process.exit(1);
  }

  const body = src.slice(bodyStart, end);
  const g = { id, comment: groupComment(src.slice(0, pm.index)), fields: [] };
  parseFields(body, g);
  pushRe.lastIndex = Math.max(pushRe.lastIndex, end);   // 跳过本组内部的子 push
  if (!g.fields.length) continue;                        // 空组（如 rarityGate）不进 schema
  groups.push(g);
}
if (!groups.length) { console.error('❌ 没找到任何 .push("组名")'); process.exit(1); }

/** 组说明 = 紧贴 push 之前的那段注释（去掉开场白里最后的 .push 调用再取）。 */
function groupComment(before) {
  const head = before.slice(-1200);
  const multi = [...head.matchAll(/b\.comment\("""([\s\S]*?)"""\)/g)];
  if (multi.length) {
    return multi[multi.length - 1][1].split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  }
  const one = [...head.matchAll(/b\.comment\("((?:[^"\\]|\\.)*)"\)/g)];
  return one.length ? unescapeJava(one[one.length - 1][1]) : '';
}

/**
 * 还原 Java 字符串里的转义。
 *
 * <p>⚠ 这里踩过一个很隐蔽的坑（2026-10-06 用户报"调参器的中文说明"）：
 * 注释提取的正则原来写的是 {@code "([^"]*)"} —— 而**中文说明里到处是英文双引号**
 * （如 {@code 渔轮阻尼中\"能折算进张力上限\"的那部分}）。那个 {@code \"} 会把
 * {@code [^"]*} 截断，整条 {@code .comment(...)} 匹配失败 → schema 里 comment 成了空串
 * → 调参器那一行**只剩数字、没有说明**。585 项里坏了 17 项，清一色是"说明里带引号"的。
 *
 * <p>现在正则接受转义序列，提取后再把 {@code \"} 还原成 {@code "}。
 */
function unescapeJava(s) {
  return s.replace(/\\(["\\])/g, '$1').replace(/\\n/g, ' ').replace(/\\t/g, ' ');
}

// ------------------------------------------------------------------ 2. 段内按 `;` 分块逐个字段
function parseFields(body, group) {
  for (const stmt of body.split(';')) {
    // 去掉 Java 数值后缀：1.6D / 2f / 3L。不退掉的话数值正则会被
    // "10.0D" 这种写法带偏（非贪婪匹配会停在 "10."，导致整条匹配失败）。
    const s = stmt.replace(/(\d)[DdFfLl](?![0-9A-Za-z_])/g, '$1');

    const dr = new RegExp('\\.defineInRange\\("([^"]+)",\\s*' + NUM + ',\\s*' + NUM + ',\\s*' + NUM + '\\)').exec(s);
    if (dr) {
      const def = evalNum(dr[2]), min = evalNum(dr[3]), max = evalNum(dr[4]);
      if (def === null || min === null || max === null) continue;
      group.fields.push({
        key: dr[1], bind: bindName(s), def, min, max,
        type: /IntValue/.test(s) ? 'int' : 'double',
        comment: stmtComment(s),
        label: labelFrom(stmtComment(s)),
      });
      continue;
    }
    const bl = /\.define\("([^"]+)",\s*(true|false)\)/.exec(s);
    if (bl) {
      const cm = stmtComment(s);
      group.fields.push({
        key: bl[1], bind: bindName(s), def: bl[2] === 'true', type: 'bool',
        comment: cm, label: labelFrom(cm),
      });
    }
  }
}

/**
 * 从注释里抽出"中文名"部分。
 *
 * 配件数值那些字段的注释格式是 script 生成的：
 *     麻线（hemp_line） · 张力上限 —— 越高，线越不容易被拉崩
 * 前半段就是给人看的标签。调参器把它加粗显示在配置键上方，
 * 这样玩家既看得懂是什么，又看得到该手改哪个键。
 *
 * 拿不到这个格式就返回空 —— 手写的老注释没有分隔符，不该被硬切。
 */
function labelFrom(comment) {
  if (!comment) return '';
  const i = comment.indexOf(' · ');
  if (i <= 0) return '';
  const j = comment.indexOf(' —— ', i);
  return (j > 0 ? comment.slice(0, j) : comment).trim();
}

// 用函数声明而不是 const 箭头函数：parseFields 在模块顶层就会被调用，
// 那时 const 还在 TDZ 里，会报 "Cannot access 'bindName' before initialization"。
function bindName(stmt) {
  const b = /(\w+)\s*=\s*b\b/.exec(stmt);
  return b ? b[1] : null;
}

function stmtComment(stmt) {
  const one = /\.comment\("((?:[^"\\]|\\.)*)"\)/.exec(stmt);
  if (one) return unescapeJava(one[1]);
  const multi = /\.comment\("""([\s\S]*?)"""\)/.exec(stmt);
  return multi ? multi[1].split('\n').map((s) => s.trim()).filter(Boolean).join(' ') : '';
}

function evalNum(s) {
  const t = s.trim();
  if (!/^[-+*/(). 0-9]+$/.test(t)) return null;
  const v = Function('"use strict";return (' + t + ')')();
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ------------------------------------------------------------------ 3. 自检 + 输出
// 注意这里**不能**断言 key == Java 字段名：TOML 键和 Java 字段名本来就是两套命名，
// 例如字段 hookWindowBase 对应的 TOML 路径是 [hookWindow] base。
// （试过这个断言，25 个早已上线的项目全被误报——差点为了迁就它去改键名，
//   而那会让所有玩家已改过的配置失效。）
// 真正该校验的"schema 与热重载映射一致"在 tools/check-tuning-schema.js 里做。
let bad = 0;
const seen = new Map();
for (const g of groups) {
  for (const f of g.fields) {
    const prev = seen.get(f.key);
    if (prev) {
      console.error('❌ 配置键 ' + f.key + ' 同时出现在 [' + prev + '] 和 [' + g.id +
                    '] —— 调参器会算出两份冲突的值');
      bad++;
    } else seen.set(f.key, g.id);
  }
}
if (bad) process.exit(1);

// 解析到的字段总数是唯一可靠的"解析器没脱节"信号：某个组解析不到字段可能只是
// 它本来就空（rarityGate），但总数变少一定是漏了东西。
const total = groups.reduce((a, g) => a + g.fields.length, 0);
if (total < BASELINE) {
  console.error('❌ 只解析到 ' + total + ' 项，少于基线 ' + BASELINE +
                ' —— 解析器很可能漏掉了某些组/字段（调参器会静默缺选项）');
  process.exit(1);
}

const out = groups.map((g) => ({
  id: g.id, comment: g.comment,
  fields: g.fields.map(({ key, def, min, max, type, comment, label }) =>
    ({ key, def, min, max, type, comment, label })),
}));

fs.writeFileSync(path.join(__dirname, 'tuning-schema.json'),
  JSON.stringify({ generatedFrom: 'Config.java', groups: out }, null, 2) + '\n');
let n = 0;
for (const g of out) { console.log('[' + g.id + '] ' + g.fields.length + ' 项'); n += g.fields.length; }
console.log('\n共 ' + out.length + ' 组 / ' + n + ' 项 -> tools/tuning-schema.json');
