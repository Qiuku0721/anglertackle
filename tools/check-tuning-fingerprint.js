#!/usr/bin/env node
/**
 * check-tuning-fingerprint.js —— 守住用户那句「**调参不能被版本更新改回去**」✗（#7 的消费端 ✓）。
 *
 * 背景（用户原话）：
 *   "调参不能被版本更新改回去；且调参变更记录不许互相覆盖（原来每次替换旧记录 ⇒ 部分调参不进记录 ✗）"
 *
 * 生产端 ✓：调参器保存时，会在「调参变更记录」里写一段机器可读的指纹 ✓：
 *   ```
 *   <!-- atl-tuning-fingerprint
 *   saved=2026-10-10T19:xx:xx.xxxZ
 *   crucianCarpPullSpeed=1.05
 *   -->
 *   ```
 *   只记**玩家真的改过**的项（数据源是调参器的 values / original ✓）。
 *
 * 本检查器做三件事 ✓：
 *   ① 收集工程目录里的 `调参变更记录*.md` ✓，抠出所有指纹段 ✓
 *   ② 同一个键**以 saved= 时间最新的那条为准** ✓（用户后来又调过 ⇒ 用新值 ✓，不是拿旧记录打新值 ✗）
 *   ③ 逐条到**游戏里实际生效的 `anglertackle-common.toml`** 里核对 ✓ ⇒
 *      键没了（改名/挪组 ✗）/ 值被改（被夹回范围 ✗ / 被冲成默认 ✗）⇒ **当场红** ✓✓
 *
 * 没记录、没 toml 时**如实说明并跳过** ✓ —— 不假装通过 ✗（永远绿的检查器比没有更坏 ✓）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

let fail = 0;
const ok = (m) => console.log('  [OK]   ' + m);
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [--]   ' + m);
console.log('check-tuning-fingerprint：调参不能被版本更新改回去（调参指纹核对）');

// ---------- ① 收集记录文件（工程根目录 + docs/，按 mtime 排序无所谓 —— 关键是段内 saved= 时间 ✓）
const files = [];
for (const dir of [ATL_ROOT, path.join(ATL_ROOT, 'docs')]) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (/^调参变更记录.*\.md$/.test(name)) files.push(path.join(dir, name));
    if (/^tuning-changelog.*\.md$/i.test(name)) files.push(path.join(dir, name));
  }
}

/** 从一份记录里抠出 {key: {value, saved}}（同一份里后写覆盖先写 ✓）。 */
function fingerprintsOf(text) {
  const out = new Map();
  const blockRe = /<!--\s*atl-tuning-fingerprint([\s\S]*?)-->/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    let saved = '';
    const pairs = [];
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k === 'saved') { saved = v; continue; }
      pairs.push([k, v]);
    }
    for (const [k, v] of pairs) {
      const prev = out.get(k);
      if (!prev || String(saved) >= String(prev.saved)) out.set(k, { value: v, saved });
    }
  }
  return out;
}

const recorded = new Map();      // key -> {value, saved, from}
for (const f of files) {
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  for (const [k, rec] of fingerprintsOf(text)) {
    const prev = recorded.get(k);
    if (!prev || String(rec.saved) >= String(prev.saved)) {
      recorded.set(k, { value: rec.value, saved: rec.saved, from: path.basename(f) });
    }
  }
}

if (recorded.size === 0) {
  info('还没找到「调参指纹」✗（在调参器里点一次保存 ✓，把生成的《调参变更记录》存到工程根目录 ✓，');
  info('  从那以后本检查器就会开始守着你调过的每一个值 ✓）');
  console.log('\n跳过（尚无调参记录）—— 不是通过，是还没开始 ✓');
  process.exit(0);
}

// ---------- ② 找游戏里实际生效的 toml
//
// ⚠ 顺序有讲究（2026-10-11 实测踩到）：**显式设了 ATL_ROOT 时，副本自己的 toml 优先**。
//   负例副本（tools/_negtest.js 造的）里我们必须核对的是**夹具** toml；而本机的
//   `D:\mc\...\anglertackle-common.toml` 是**真实存在**的 ⇒ 如果它排在前面，
//   夹具就被顶掉，于是负例**永远红**（红的原因还是"真配置里的值不是夹具里的值"）
//   ⇒ 这条检查器实际上**没法被证伪** ✗，而"没法证伪的守卫"正是本仓库最忌讳的东西。
//   真实跑闸时 ATL_ROOT 不设 ⇒ 仍然优先 D:\mc 那份真配置 ✓（语义一字不变）。
const IN_COPY = !!process.env.ATL_ROOT;
const copyToml = [
  path.join(ATL_ROOT, 'config', 'anglertackle-common.toml'),
  path.join(ATL_ROOT, 'run', 'config', 'anglertackle-common.toml'),
];
const liveToml = 'D:\\mc\\PCL 正式版 2.13.1.1\\.minecraft\\versions\\1.21.1-NeoForge_21.1.250\\config\\anglertackle-common.toml';
const candidates = [
  process.env.ATL_LIVE_TOML,
  ...(IN_COPY ? copyToml : [liveToml, ...copyToml]),
].filter(Boolean);
const tomlPath = candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

if (!tomlPath) {
  info('找了这些位置都没有游戏配置 ✗：');
  for (const p of candidates) info('  ' + p);
  info('⇒ 本机没装/路径不同是正常的 ✓；可用环境变量 ATL_LIVE_TOML 指过去 ✓');
  console.log('\n跳过（读不到游戏 toml）—— 不是通过，是没法核对 ✓');
  process.exit(0);
}

const toml = fs.readFileSync(tomlPath, 'utf8');
ok('指纹 ' + recorded.size + ' 项（来自 ' + files.length + ' 份记录 ✓）· 核对 ' + tomlPath);

// ---------- ③ 逐条核对
const sameNum = (a, b) => {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a === b;
};

let checked = 0, missing = 0, changed = 0;
for (const [key, rec] of [...recorded.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const m = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.+?)\\s*(?:#.*)?$', 'm').exec(toml);
  if (!m) {
    bad('✗ 键不见了：' + key + '（记录里是 ' + rec.value + ' ✓，来自 ' + rec.from + '）'
      + ' ⇒ 多半是**键改名/挪了分组** ✗ ⇒ 你调的值无处可迁 ✓');
    missing++;
    continue;
  }
  const live = m[1].trim().replace(/^"|"$/g, '');
  checked++;
  if (!sameNum(live, rec.value)) {
    bad('✗ 值被改了：' + key + '　你的 ' + rec.value + ' ⇒ 现在 ' + live
      + '（可能被夹回范围 ✗ 或被冲成默认 ✗）');
    changed++;
  }
}
if (checked > 0 && missing === 0 && changed === 0) {
  ok('全部 ' + checked + ' 项都还在、且值一字未变 ✓（版本更新没有动你的调参 ✓）');
}

console.log(fail === 0
  ? '\n全部通过：你调过的值原样健在（' + checked + ' 项）✓'
  : '\n失败 ' + fail + ' 项：有调参被改回去了 ✗（键不见了 ' + missing + ' / 值变了 ' + changed + '）');
process.exit(fail === 0 ? 0 : 1);
