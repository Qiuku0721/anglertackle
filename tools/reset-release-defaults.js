#!/usr/bin/env node
/**
 * reset-release-defaults.js —— 把**仓库根**那份「发布用默认配置」刷成**代码默认值**。
 *
 * ── 为什么需要它（它和 sync-config-file.js 是两件事）────────────────
 * `sync-config-file.js` 的纪律是"**已有键一律不动**"（玩家调过参的值必须留住 ✓）——
 * 所以它只会**补缺失的键**，**永远不会**把某个已经存在的键改回默认值。
 * 而仓库根那份 `anglertackle-common.toml` 是**直接覆盖给玩家的默认配置**：
 * 它必须与代码默认值**逐项一致** ⇒ 两者需求相反，得有两个工具。
 *
 * ⚠ 真踩过（2026-10-11）：改了某个玩法默认值（大鱼公告门槛 50 → 5050）之后，
 *   跑 `sync-config-file.js --out anglertackle-common.toml --write` 什么也不会发生
 *   （它认为那个键"已经有了"），于是 `check-live-config-matches-defaults.js` 报
 *   "发布用默认配置与默认值不同"，而报错信息里给的命令**修不好它** ✗。
 *
 * 做法：默认值只认一个来源 —— `tools/tuning-schema.json`（它由 gen-tuning-schema.js
 * 从 `Config.java` 生成 ⇒ 与代码同源）。保留原有的分组头与注释，只改 `键 = 值` 里的值；
 * 代码里新增的键会补进对应分组（找不到分组就新开一张表并**明说**）。
 *
 * 用法：node tools/reset-release-defaults.js [--check]
 *   --check：只看哪些键与默认值不同，**不写文件**（退出码 1 = 有漂移）
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOML = path.join(ROOT, 'anglertackle-common.toml');
const SCHEMA = path.join(ROOT, 'tools', 'tuning-schema.json');
const CHECK_ONLY = process.argv.includes('--check');

if (!fs.existsSync(TOML)) {
  console.error('❌ 找不到发布用默认配置：' + TOML);
  process.exit(1);
}
if (!fs.existsSync(SCHEMA)) {
  console.error('❌ 找不到 tools/tuning-schema.json（先跑 node tools/gen-tuning-schema.js）');
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
const defs = new Map();                 // "group.key" -> { def, comment }
for (const g of schema.groups) {
  for (const f of g.fields) defs.set(g.id + '.' + f.key, f);
}

const render = (v) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

const lines = fs.readFileSync(TOML, 'utf8').split(/\r?\n/);
let group = null;
const seen = new Set();
const drifted = [];
const out = lines.map((line) => {
  const head = /^\s*\[([A-Za-z_][A-Za-z0-9_]*)\]\s*$/.exec(line);
  if (head) { group = head[1]; return line; }
  const kv = /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.+?)(\s*(?:#.*)?)$/.exec(line);
  if (!kv || !group) return line;
  const key = group + '.' + kv[2];
  const f = defs.get(key);
  if (!f) return line;                  // 代码里没有的键：留给检查器去报，这里不擅自删
  seen.add(key);
  const want = render(f.def);
  const got = String(kv[4]).trim();
  if (got === want) return line;
  drifted.push(key + '：' + got + ' → ' + want);
  return kv[1] + kv[2] + ' = ' + want + (kv[5] || '');
});

// 代码里新增、文件里还没有的键
const missing = [...defs.keys()].filter((k) => !seen.has(k));

if (CHECK_ONLY) {
  if (drifted.length) {
    console.error('❌ 发布用默认配置有 ' + drifted.length + ' 项与代码默认值不同：');
    for (const d of drifted) console.error('   ' + d);
  }
  if (missing.length) {
    console.error('❌ 还缺 ' + missing.length + ' 项：' + missing.join(', '));
  }
  if (!drifted.length && !missing.length) {
    console.log('✅ 发布用默认配置与代码默认值逐项一致（' + defs.size + ' 项）');
  }
  process.exit(drifted.length || missing.length ? 1 : 0);
}

let text = out.join('\n');
if (missing.length) {
  const byGroup = new Map();
  for (const k of missing) {
    const [g, key] = k.split('.');
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(key);
  }
  let block = '\n# ==========================================================================\n'
    + '#  以下由 tools/reset-release-defaults.js 补入：代码里新增的配置项（取代码默认值）。\n'
    + '# ==========================================================================\n';
  for (const [g, keys] of byGroup) {
    block += '\n[' + g + ']\n';
    for (const key of keys) {
      const f = defs.get(g + '.' + key);
      if (f.comment) {
        for (const para of String(f.comment).split(/\r?\n/)) block += '\t# ' + para + '\n';
      }
      block += '\t' + key + ' = ' + render(f.def) + '\n';
    }
  }
  text = text.replace(/\s*$/, '') + '\n' + block;
}

fs.writeFileSync(TOML, text.replace(/\s*$/, '') + '\n', 'utf8');
console.log('✅ 已刷新 ' + path.relative(ROOT, TOML).replace(/\\/g, '/')
  + '：改回默认 ' + drifted.length + ' 项，补入缺失 ' + missing.length + ' 项，共 ' + defs.size + ' 项');
if (drifted.length) {
  for (const d of drifted) console.log('   ' + d);
}
