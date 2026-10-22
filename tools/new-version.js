// ============================================================================
//  new-version.js —— 为一个新的 MC 版本，从 1.21.1 复制出一个独立的 mod 包体。
//
//  用户 2026-10-15 定的方向（原话）：
//    "我的设想是每个版本一个mod包体，别人想玩哪个版本就安哪个，
//      我觉得这应该是复制代码后进行修改的问题。"
//  ⇒ 就是业界说的**分支法**：每个 MC 版本一份完整、独立的源码树，
//     互不影响、各出一个 jar。**不做** Stonecutter 那种"一份源码多版本"。
//
//  ⚠ 这个方案的**唯一真风险是"改漏"**：
//    以后修一个 bug 要改 N 遍，漏一个版本 ⇒ 那个版本悄悄带旧 bug、没人发现。
//    所以本脚本与 `sync-shared.js` 是配套的：新版本尽量别自己改，
//    改完 1.21.1 由 sync-shared.js 推过去并**报红**。
//
//  用法：
//    node tools/new-version.js 1.21.4                 # 建一个新版本（含全部源码）
//    node tools/new-version.js 1.21.4 --dry-run       # 只看会做什么，不落盘
//    node tools/new-version.js --list                 # 列出已有版本
//
//  产物：versions/<mcver>/  —— 一棵**自包含**的完整工程：
//    src/  tools/  docs/  build.gradle  settings.gradle  gradle.properties  tools/gradlew.cmd
//    版本差异只写在这三处（外加极少量 src 里的改动）：
//      ① gradle.properties  —— minecraft_version / neo_version / 版本区间
//      ② build.gradle       —— NFRT 编译器的绕法（见 docs/43）
//      ③ src 里那些 21.1 专属的 API 调用
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERSIONS_DIR = path.join(ROOT, 'versions');

/**
 * 每个 MC 版本对应的 NeoForge 版本（**实测得来**，不是猜的）。
 * 来源：https://neoforged.forgecdn.net/releases/net/neoforged/neoforge/maven-metadata.xml
 *  ⚠ 标 beta 的四个版本官方**没有正式版**（用户 2026-10-15 拍板：照做，用 beta）。
 *  ⚠ 加新版本先跑 `node tools/check-version-matrix.js` 核实，别手填。
 */
const NEOFORGE = {
  '1.21.1': { neo: '21.1.252', stable: true },
  '1.21.2': { neo: '21.2.1-beta', stable: false },
  '1.21.3': { neo: '21.3.100', stable: true },
  '1.21.4': { neo: '21.4.161', stable: true },
  '1.21.5': { neo: '21.5.101', stable: true },
  '1.21.6': { neo: '21.6.20-beta', stable: false },
  '1.21.7': { neo: '21.7.25-beta', stable: false },
  '1.21.8': { neo: '21.8.57', stable: true },
  '1.21.9': { neo: '21.9.16-beta', stable: false },
  '1.21.10': { neo: '21.10.64', stable: true },
  '1.21.11': { neo: '21.11.48', stable: true },
};

/** 一起复制的目录（相对项目根）。⚠ 不含 build/ .gradle-home/ .jdk/ run/ —— 那些可再生产。 */
const COPY_DIRS = ['src', 'tools', 'docs'];
/** 一起复制的单文件。 */
const COPY_FILES = [
  'build.gradle', 'settings.gradle', 'gradle.properties', 'LICENSE', 'CREDITS.txt',
  '调参器.html', '调参器.bat', '重置配置.bat', 'tuner.html',
  '默认配置_anglertackle-common.toml',
];
/** 复制时跳过的子路径（相对被复制目录）。 */
const SKIP = ['_snapshots'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const mcver = args.find(a => !a.startsWith('--'));

/** MC 版本号比较（1.21.4 < 1.21.10，不能按字符串比）。 */
function cmpMc(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------- --list
if (args.includes('--list')) {
  if (!fs.existsSync(VERSIONS_DIR)) { console.log('（还没有任何多版本目录）'); process.exit(0); }
  const vs = fs.readdirSync(VERSIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+\.\d+(\.\d+)?$/.test(e.name)).map(e => e.name).sort(cmpMc);
  console.log('已有版本目录（versions/）：');
  for (const v of vs) {
    const gp = path.join(VERSIONS_DIR, v, 'gradle.properties');
    let neo = '?', ver = '?';
    if (fs.existsSync(gp)) {
      const s = fs.readFileSync(gp, 'utf8');
      neo = (/^\s*neo_version\s*=\s*(\S+)/m.exec(s) || [, '?'])[1];
      ver = (/^\s*mod_version\s*=\s*(\S+)/m.exec(s) || [, '?'])[1];
    }
    console.log('  ' + v.padEnd(9) + ' NeoForge ' + neo.padEnd(14) + ' mod ' + ver
      + (NEOFORGE[v] && !NEOFORGE[v].stable ? '   ⚠ 该 MC 版本只有 beta 加载器' : ''));
  }
  process.exit(0);
}

if (!mcver) {
  console.error('用法: node tools/new-version.js <MC版本> [--dry-run]');
  console.error('      node tools/new-version.js --list');
  console.error('已知版本: ' + Object.keys(NEOFORGE).join(', '));
  process.exit(2);
}
if (!NEOFORGE[mcver]) {
  console.error('✗ 不认识的 MC 版本: ' + mcver);
  console.error('  已知: ' + Object.keys(NEOFORGE).join(', '));
  console.error('  ⚠ 别手填 NeoForge 版本 —— 先用 tools/check-version-matrix.js 核实官方有没有发布。');
  process.exit(2);
}

const DEST = path.join(VERSIONS_DIR, mcver);
if (fs.existsSync(DEST)) {
  console.error('✗ ' + DEST + ' 已存在 —— 拒绝覆盖（那可能是一份已经在改的源码）。');
  process.exit(1);
}
// ⚠ 1.21.1 不在 versions/ 下：它就是主树本身（用户要求主树保持不动）。
if (mcver === '1.21.1') {
  console.error('✗ 1.21.1 就是主树本身（' + ROOT + '），不需要、也不应该在 versions/ 下再建一份。');
  console.error('  主树继续归现有那 138 个检查器管。');
  process.exit(1);
}

const { neo, stable } = NEOFORGE[mcver];
// minecraft_version_range：只允许这一版。1.21.8 → [1.21.8,1.21.9)
const nextMinor = (() => {
  const p = mcver.split('.').map(Number);
  return p[0] + '.' + p[1] + '.' + (p[2] + 1);
})();
const mcRange = '[' + mcver + ',' + nextMinor + ')';
const neoBranch = neo.split('.').slice(0, 2).join('.');   // 21.4.161 → 21.4
const neoRange = '[' + neoBranch + '.0,)';

console.log('════ 为 MC ' + mcver + ' 建独立包体 ════');
console.log('  NeoForge      ' + neo + (stable ? '' : '   ⚠ beta（该 MC 版本官方无正式版）'));
console.log('  MC 依赖区间    ' + mcRange);
console.log('  NeoForge 区间  ' + neoRange);
console.log('  目标目录       versions/' + mcver);
if (dryRun) console.log('\n（--dry-run：只看计划，不落盘）');

// ---------------------------------------------------------------- 复制
function walk(dir, base, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p).split(path.sep).join('/');
    if (SKIP.some(s => rel === s || rel.startsWith(s + '/'))) continue;
    if (e.isDirectory()) walk(p, base, acc);
    else acc.push(rel);
  }
  return acc;
}

let copied = 0;
for (const d of COPY_DIRS) {
  const from = path.join(ROOT, d);
  if (!fs.existsSync(from)) { console.log('  （跳过，不存在）' + d); continue; }
  for (const rel of walk(from, from, [])) {
    const to = path.join(DEST, d, rel);
    if (!dryRun) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(from, rel), to); }
    copied++;
  }
}
for (const f of COPY_FILES) {
  const from = path.join(ROOT, f);
  if (!fs.existsSync(from)) continue;
  const to = path.join(DEST, f);
  if (!dryRun) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  copied++;
}
console.log('  复制文件      ' + copied + ' 个');

// ---------------------------------------------------------------- 改版本号
if (!dryRun) {
  const gp = path.join(DEST, 'gradle.properties');
  let s = fs.readFileSync(gp, 'utf8');
  const before = s;
  s = s.replace(/^(\s*minecraft_version\s*=\s*).*$/m, '$1' + mcver);
  s = s.replace(/^(\s*minecraft_version_range\s*=\s*).*$/m, '$1' + mcRange);
  s = s.replace(/^(\s*neo_version\s*=\s*).*$/m, '$1' + neo);
  s = s.replace(/^(\s*neo_version_range\s*=\s*).*$/m, '$1' + neoRange);
  // 版本号加 MC 后缀，避免"三个包体同名 jar"在 mods 目录里互相覆盖、也便于玩家辨认
  s = s.replace(/^(\s*mod_version\s*=\s*)(\S+)\s*$/m, '$1$2-mc' + mcver);
  fs.writeFileSync(gp, s, 'utf8');
  if (s === before) { console.error('✗ gradle.properties 里四个版本字段一个都没替换成功 —— 格式变了？'); process.exit(1); }
  // 自证：逐个字段回读确认
  const got = fs.readFileSync(gp, 'utf8');
  for (const [k, want] of [['minecraft_version', mcver], ['minecraft_version_range', mcRange],
                           ['neo_version', neo], ['neo_version_range', neoRange]]) {
    const m = new RegExp('^\\s*' + k + '\\s*=\\s*(\\S+)\\s*$', 'm').exec(got);
    if (!m || m[1] !== want) { console.error('✗ ' + k + ' 没写对：期望 ' + want + '，实际 ' + (m ? m[1] : '(读不到)')); process.exit(1); }
  }
  console.log('  gradle.properties 四个版本字段已改并回读校验通过 ✓');
}

console.log('\n下一步：');
console.log('  ① 编译（首次要跑一遍完整 NeoForm，2~4 分钟）：');
console.log('       cd versions/' + mcver);
console.log('       ../../tools/gradlew.cmd compileJava');
console.log('  ② 编译错误就是"这个版本要适配的 API 差异"清单 —— 逐个改 src 里的代码');
console.log('  ③ 改完跑：node tools/sync-shared.js --check ' + mcver);
console.log('       （它会比对这个版本与 1.21.1 的差异，列出你改了什么、并挡住"漏改"）');
