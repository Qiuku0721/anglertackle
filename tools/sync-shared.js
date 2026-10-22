// ============================================================================
//  sync-shared.js —— "每个版本一个独立包体"方案的**防漏改**机制。
//
//  用户 2026-10-15 定的方向原话：
//    "我的设想是每个版本一个mod包体，别人想玩哪个版本就安哪个，
//      我觉得这应该是复制代码后进行修改的问题。"
//  ⇒ 每个 MC 版本一份完整源码（versions/<版本>/），互不影响。这是对的、也是最稳的。
//
//  ⚠ 但这个方案有一个**必然会发生、而且不会自己报警**的风险：
//    你在 1.21.1 修了一个 bug，忘了同步到 1.21.4 —— 1.21.4 就带着旧 bug 继续发布，
//    而**没有任何东西会告诉你**。版本越多、时间越久，漏改越多。
//    这正是本仓库最忌讳的那类问题（"不崩不报错，只是悄悄不对"）。
//
//  本脚本就是那道闸。它做三件事：
//    ① `--status`  列出每个版本相对 1.21.1 改了哪些文件（区分"版本适配"与"从未同步"）
//    ② `--check`   判断某个版本**是不是落后于 1.21.1**（1.21.1 改了、它没跟上）⇒ 报红
//    ③ `--diff`    显示具体差异，方便你决定"这条改动该不该同步过去"
//
//  怎么区分"版本适配导致的必要差异"和"漏同步的落后"？
//  答案：**记账**。每次同步后把当时的 1.21.1 指纹记进
//    `versions/<版本>/.sync-state.json`
//  之后如果 1.21.1 的文件变了、而该版本还停在旧指纹上 ⇒ 就是落后。
//
//  用法：
//    node tools/sync-shared.js --status
//    node tools/sync-shared.js --check 1.21.4
//    node tools/sync-shared.js --diff 1.21.4 src/main/java/...某文件.java
//    node tools/sync-shared.js --accept 1.21.4        # 人工确认"这个版本已跟上"，更新记账
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const VERSIONS_DIR = path.join(ROOT, 'versions');
/** 与 1.21.1 比对的范围：只看**会被同步的**代码，不看各版本自己的构建脚本/文档。 */
const SYNC_ROOTS = ['src'];
const STATE_FILE = '.sync-state.json';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const flagArg = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

/** 收一份"相对路径 → sha256"的指纹表（只覆盖 SYNC_ROOTS）。 */
function fingerprint(baseDir) {
  const out = {};
  for (const r of SYNC_ROOTS) {
    for (const p of walk(path.join(baseDir, r))) {
      out[path.relative(baseDir, p).split(path.sep).join('/')] = sha256(p);
    }
  }
  return out;
}

function listVersions() {
  if (!fs.existsSync(VERSIONS_DIR)) return [];
  return fs.readdirSync(VERSIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(VERSIONS_DIR, e.name, 'gradle.properties')))
    .map(e => e.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1] || (pa[2] || 0) - (pb[2] || 0);
    });
}

// ---------------------------------------------------------------- 基线指纹
const baseFp = fingerprint(ROOT);
const baseTotal = Object.keys(baseFp).length;

// ---------------------------------------------------------------- 逐版本比对
function compare(v) {
  const dir = path.join(VERSIONS_DIR, v);
  const fp = fingerprint(dir);
  const changed = [], missing = [], added = [];
  for (const [rel, h] of Object.entries(baseFp)) {
    if (!(rel in fp)) missing.push(rel);
    else if (fp[rel] !== h) changed.push(rel);
  }
  for (const rel of Object.keys(fp)) if (!(rel in baseFp)) added.push(rel);

  // 记账：上次同步时记下的 1.21.1 指纹
  const statePath = path.join(dir, STATE_FILE);
  let state = null;
  if (fs.existsSync(statePath)) { try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { state = null; } }

  // "落后" = 1.21.1 里这些文件自上次同步后又变了（或新增了）
  let behind = [];
  if (state && state.base) {
    for (const [rel, h] of Object.entries(baseFp)) {
      if (state.base[rel] !== h) behind.push(rel);
    }
    for (const rel of Object.keys(state.base)) if (!(rel in baseFp)) behind.push(rel + '（1.21.1 里已删除）');
  }
  return { dir, fp, changed, missing, added, state, behind, tracked: !!state };
}

// ---------------------------------------------------------------- --status
if (has('--status') || args.length === 0) {
  console.log('=== 多版本同步状态 ===');
  console.log('基线：1.21.1（主树，' + baseTotal + ' 个源文件参与比对，范围 ' + SYNC_ROOTS.join('/') + '）');
  const vs = listVersions();
  if (!vs.length) { console.log('\n（versions/ 下还没有任何版本包体 —— 用 node tools/new-version.js <MC版本> 建一个）'); process.exit(0); }
  console.log('');
  for (const v of vs) {
    const r = compare(v);
    console.log('  ── ' + v + ' ──');
    console.log('     与 1.21.1 不同的文件：' + r.changed.length + ' 个'
      + (r.changed.length ? '（这些**应该**是版本适配改的）' : ''));
    if (r.missing.length) console.log('     1.21.1 有、它没有：' + r.missing.length + ' 个');
    if (r.added.length) console.log('     它有、1.21.1 没有：' + r.added.length + ' 个');
    if (!r.tracked) {
      console.log('     ⚠ 还没记过账（' + STATE_FILE + ' 不存在）⇒ 无法判断有没有漏改。');
      console.log('       确认它已跟上 1.21.1 后跑：node tools/sync-shared.js --accept ' + v);
    } else if (r.behind.length) {
      console.log('     ❌ **落后了**：1.21.1 自上次同步后又改了 ' + r.behind.length + ' 个文件 —— 可能漏同步：');
      for (const f of r.behind.slice(0, 15)) console.log('          · ' + f);
      if (r.behind.length > 15) console.log('          … 还有 ' + (r.behind.length - 15) + ' 个');
    } else {
      console.log('     ✅ 与 1.21.1 已同步（记账时间 ' + (r.state.at || '?') + '）');
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------- 需要指定版本
const v = args.find(a => !a.startsWith('--') && listVersions().includes(a));
if (!v) {
  console.error('用法: node tools/sync-shared.js [--status | --check <版本> | --diff <版本> <文件> | --accept <版本>]');
  console.error('已有版本: ' + (listVersions().join(', ') || '（无）'));
  process.exit(2);
}
const r = compare(v);

// ---------------------------------------------------------------- --check
if (has('--check')) {
  const problems = [];
  if (r.missing.length) problems.push('1.21.1 有 ' + r.missing.length + ' 个文件它没有（新增文件没同步过去？）');
  if (!r.tracked) problems.push('没有 ' + STATE_FILE + '，无法判断是否漏改 ⇒ 先跑 --accept 记账');
  if (r.behind.length) problems.push('落后于 1.21.1 共 ' + r.behind.length + ' 个文件');
  console.log('=== 同步检查：' + v + ' ===');
  console.log('  与 1.21.1 不同的文件 ' + r.changed.length + ' 个（版本适配属正常）');
  for (const p of problems) console.log('  ❌ ' + p);
  if (problems.length) {
    console.log('\n❌ ' + v + ' 未通过同步检查。');
    console.log('   若这些差异是你故意为该版本做的适配，跑 --accept ' + v + ' 记账即可；');
    console.log('   若是 1.21.1 上新修的 bug 没跟过来，请把那几处改动同样应用到本版本。');
    process.exit(1);
  }
  console.log('  ✅ 通过（已记账，且未落后于 1.21.1）');
  process.exit(0);
}

// ---------------------------------------------------------------- --accept
if (has('--accept')) {
  const state = {
    note: '记录"本次确认：' + v + ' 已跟上 1.21.1"。此后 1.21.1 再改，--check 会报落后。',
    at: new Date().toISOString(),
    base: baseFp,
  };
  fs.writeFileSync(path.join(r.dir, STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
  console.log('✅ 已记账：' + path.join('versions', v, STATE_FILE));
  console.log('   记下 1.21.1 当时 ' + baseTotal + ' 个文件的指纹。');
  console.log('   以后 1.21.1 的源码再变，`node tools/sync-shared.js --check ' + v + '` 就会报红。');
  process.exit(0);
}

// ---------------------------------------------------------------- --diff
if (has('--diff')) {
  const file = args[args.indexOf('--diff') + 2];
  if (!file) { console.error('用法: node tools/sync-shared.js --diff ' + v + ' <相对路径>'); process.exit(2); }
  const a = path.join(ROOT, file), b = path.join(r.dir, file);
  console.log('=== 1.21.1 vs ' + v + ' : ' + file + ' ===');
  if (!fs.existsSync(a)) { console.log('（1.21.1 里没有这个文件）'); process.exit(0); }
  if (!fs.existsSync(b)) { console.log('（' + v + ' 里没有这个文件）'); process.exit(0); }
  const la = fs.readFileSync(a, 'utf8').split('\n');
  const lb = fs.readFileSync(b, 'utf8').split('\n');
  const n = Math.max(la.length, lb.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 200; i++) {
    if (la[i] !== lb[i]) {
      console.log('  ' + (i + 1) + ' 行:');
      console.log('    - ' + (la[i] ?? '(无)'));
      console.log('    + ' + (lb[i] ?? '(无)'));
      shown++;
    }
  }
  console.log(shown ? '\n（共 ' + shown + ' 处不同）' : '（逐行相同）');
  process.exit(0);
}

console.error('未知参数。用法见文件头注释。');
process.exit(2);
