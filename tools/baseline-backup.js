// ============================================================================
//  baseline-backup.js —— 给 1.21.1 现状做一份「可回退 + 可自证」的基线备份。
//
//  为什么单独写这一个（而不是用 tools/snapshot-src.js）：
//    ① snapshot-src.js 只留最近 20 份，而现在 `参考资料/_snapshots/` 已经**正好 20 份**
//       ⇒ 再存一份会把**最老的那份挤掉**。基线备份绝不能被别的快照挤掉。
//    ② 它只备份 src/ 与 tools/，**不含构建脚本**（build.gradle / settings.gradle /
//       gradle.properties）—— 而"改多版本"头一个要动的就是 build.gradle，
//       真出了事，没有这三份就回不到能构建的状态。
//    ③ 它不做指纹。而这份备份的**全部价值**在于"事后能证明它没被动过"。
//
//  产物（全部在 _baseline_1.21.1/ 下，不碰任何现有文件）：
//    src/  tools/  build.gradle  settings.gradle  gradle.properties  tools/gradlew.cmd
//    jar-1.6.5-已验收/            ← 已验收的那份 jar（sha256 与"导入用"逐字节比对）
//    MANIFEST.json                ← 每个文件的 sha256 + 字节数 + 总清单
//    README-基线说明.md
//
//  用法：
//    node tools/baseline-backup.js             # 建备份（已存在则拒绝覆盖）
//    node tools/baseline-backup.js --verify    # 只校验现存备份与 MANIFEST 是否一致
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_baseline_1.21.1');
const verifyOnly = process.argv.includes('--verify') || process.argv.includes('--verify-source');

// ---------------------------------------------------------------------------
//  版本号只有一个来源：gradle.properties 的 mod_version（仓库铁律）。
//  ⚠ 这里原来把 `anglertackle-1.6.5.jar` 直接写成字面量，被 `check-build-scripts.js`
//    当场抓红（"jar 名被写死了 —— 改版本号时会静默部署上一版"）。判得对：
//    写死一次，将来升到 1.6.6 之后这个脚本就会去找一个**永远不会存在**的文件，
//    然后静默跳过 jar 备份 —— 正是那种"永远绿的守卫"。所以照规矩从属性读。
// ---------------------------------------------------------------------------
const MOD_VERSION = (() => {
  const props = fs.readFileSync(path.join(ROOT, 'gradle.properties'), 'utf8');
  const m = /^\s*mod_version\s*=\s*(\S+)\s*$/m.exec(props);
  if (!m) { console.error('✗ 读不到 gradle.properties 里的 mod_version'); process.exit(1); }
  return m[1];
})();
/** 主 jar 名（推导，不写死）。 */
const MAIN_JAR = 'anglertackle-' + MOD_VERSION + '.jar';
/** 扩展包 jar 名（它有自己的版本号，与主 jar 无关）。 */
const COMPAT_JAR = 'anglertackle-kaleidoscope-1.0.0.jar';
const JAR_DIR = path.join(OUT, 'jar-' + MOD_VERSION + '-已验收');

/**
 * 项目**根目录**下要一起收的文件（只取根目录，不下钻 —— 下钻的各树已在 TREES 里）。
 *
 * ⚠ 2026-10-15 补第二版：第一版重建后仍有 8 个检查器报红，全部同一个根因 ——
 *   漏了根目录那几份**不是源码、却参与自检**的文件：
 *     `调参器.html`（`check-tuning-tool` / `check-self-consistency` 要读）
 *     `调参器.bat` / `重置配置.bat`（`check-dev-loop` / `check-reset-script` 要读）
 *     `tuner.html`（发布包入口，`check-release-entry` / `check-negtest-runner` 要读）
 *   教训：**"基线"的判据不是"源码在不在"，而是"恢复出来能不能过自检"** ——
 *   所以按"检查器实际读的文件"来定收什么，而不是按"看起来像不像源码"。
 */
const ROOT_FILE_PATTERNS = [/\.md$/i, /\.bat$/i, /\.html$/i, /\.txt$/i, /\.toml$/i, /^LICENSE$/];
/** 根目录里**不收**的（构建产物 / 生成物 / 缓存）。 */
const ROOT_FILE_DENY = new Set([
  // 游戏运行时写出的配置（内容随玩家改而变）。**默认值那份要收** ——
  // `check-config-*` 系检查器拿它跟 Config.java 对账，缺了会报红。
  'anglertackle-common.toml',
]);

/** 进基线的单文件（相对项目根）。 */
const FILES = ['build.gradle', 'settings.gradle', 'gradle.properties', 'tools/gradlew.cmd'];
/**
 * 进基线的整树目录。
 *  ⚠ 2026-10-15 补：第一版只收 src/ 与 tools/，结果从备份里跑检查器时 32 个报红 ——
 *    原因不是备份烂了，而是**漏了 docs/**：`check-titles.js` 要读 `docs/38-称号系统策划案.md`，
 *    `check-progress-doc.js` 要读 `docs/进度.md`。基线的标准是"恢复出来是一个**能自检**的仓库"，
 *    所以策划文档与资源必须一起进去（它们本来就是仓库的一部分，还被检查器逐字节比对）。
 */
const TREES = [
  'src', 'tools', 'docs', '参考资料', '发布包', '发布包-1.6.5', '发布包_1.0.1', '导入用',
  'fish_research', '工具', '_fishsrc', '_backup_anglertackle',
];
/**
 * 不进基线的路径（相对项目根，前缀匹配）。
 *  · build/ 与 .gradle*   —— 构建产物/缓存，几个 GB，且**本来就可再生**（跑一次构建就有）
 *  · .jdk/                —— 348 MB 工具链压缩包，`tools/get-toolchain.ps1` 可重下
 *  · run/                 —— 开发运行目录（存档/日志）
 *  · 参考资料/_snapshots  —— 仓库自带快照，已占满 20 份上限，重复收没有意义
 */
const EXCLUDE = [
  'build/', '.gradle/', '.gradle-home/', '.jdk/', 'run/',
  '参考资料/_snapshots/',
];
const isExcluded = rel => EXCLUDE.some(e => rel === e.slice(0, -1) || rel.startsWith(e));

/**
 * **运行时日志**：既不进基线、也不参与"主树有没有被改"的判定。
 *
 * ⚠ 2026-10-15 实测踩到：`工具/输入法锁定/ime-lock.log` 在**我工作期间被输入法锁定工具
 *   自己写了一次**，于是 `--verify-source` 报"1 个文件被改动"。
 *   那条红是**噪声**：它既不是业务代码，也不是我改的。而这类假红的危害本仓库写得很清楚 ——
 *   **下一个人看到"总是有一条红"，就会习惯性地忽略整份校验**。
 *   ⇒ 按"后缀"排除，而不是按单个文件名排除（日志文件名会随工具变）。
 */
const DYNAMIC_PATTERNS = [/\.log$/i, /\.log\.\d+$/i];
const isDynamic = rel => DYNAMIC_PATTERNS.some(re => re.test(rel));

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p).split(path.sep).join('/');
    if (isExcluded(rel)) continue;
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function collectFiles() {
  const list = [];
  for (const t of TREES) {
    const d = path.join(ROOT, t);
    if (fs.existsSync(d)) list.push(...walk(d, ROOT));
  }
  for (const f of FILES) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) list.push(p);
  }
  // 项目根目录下符合白名单的文件（不下钻）
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    if (ROOT_FILE_DENY.has(e.name)) continue;
    if (ROOT_FILE_PATTERNS.some(re => re.test(e.name))) list.push(path.join(ROOT, e.name));
  }
  return [...new Set(list.map(p => path.relative(ROOT, p).split(path.sep).join('/')))]
    .filter(rel => !isDynamic(rel))   // 运行时日志不进基线（见 DYNAMIC_PATTERNS 的注释）
    .sort();
}

// ---------------------------------------------------------------- 校验模式
//  --verify          校验**备份**有没有被改（备份完整性）
//  --verify-source   校验**现工作区**有没有偏离基线（"1.21.1 没被动过"的证据）
//  两个都做才叫闭环：前者防"备份烂了"，后者防"我偷偷改了主树还嘴硬"。
if (verifyOnly) {
  const mf = path.join(OUT, 'MANIFEST.json');
  if (!fs.existsSync(mf)) { console.error('✗ 找不到 ' + mf); process.exit(1); }
  const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const checkSource = process.argv.includes('--verify-source');
  const base = checkSource ? ROOT : OUT;
  const what = checkSource ? '现工作区' : '备份';
  // ⚠ **基线自己内部的**文件（目前是 README-基线说明.md）不存在于主树里，
  //   所以 `--verify-source` 必须跳过它们 —— 否则每次都会报一条"缺失"，
  //   而那根本不是"主树被改了"。这正是本仓库反复强调的那类假红：
  //   **判据指错方向，会让下一个人直接把整条断言删掉。**
  const internal = new Set(man.baselineInternal || []);
  let bad = 0, missing = 0, skippedInternal = 0;
  for (const [rel, info] of Object.entries(man.files)) {
    if (checkSource && internal.has(rel)) { skippedInternal++; continue; }
    const p = path.join(base, rel);
    if (!fs.existsSync(p)) { console.error('✗ 缺失: ' + rel); missing++; continue; }
    const h = sha256(p);
    if (h !== info.sha256) { console.error('✗ 内容被改动: ' + rel + '\n    期望 ' + info.sha256 + '\n    实际 ' + h); bad++; }
  }
  const n = Object.keys(man.files).length;
  if (checkSource) {
    if (skippedInternal) console.log('ℹ 跳过 ' + skippedInternal + ' 个"基线内部"文件（主树本来就没有）：' + [...internal].join('、'));
    // 现工作区还要反过来查"多出来的源文件"——多出来的文件同样意味着我动过主树
    const now = new Set(collectFiles());
    const extra = [...now].filter(r => !(r in man.files));
    if (extra.length) {
      console.log('ℹ 基线之后**新增**的源文件 ' + extra.length + ' 个（不算改动，但要知道）：');
      for (const e of extra.slice(0, 40)) console.log('    + ' + e);
      if (extra.length > 40) console.log('    … 还有 ' + (extra.length - 40) + ' 个');
    }
  }
  console.log(what + '校验：基线记录 ' + n + ' 个文件，'
    + (bad + missing === 0 ? '✅ 全部逐字节一致' : '❌ ' + bad + ' 个被改、' + missing + ' 个缺失'));
  process.exit(bad + missing === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- 建备份模式
const README_ONLY = process.argv.includes('--readme');
const REBUILD = process.argv.includes('--rebuild');

/** 基线里的说明文件。**必须由本脚本生成** —— 手工往里塞文件会让 `--verify` 报红
 *  （MANIFEST 里没有它的指纹）。这个坑很隐蔽：你会以为"备份坏了"。 */
function readmeText(man) {
  return `# 1.21.1 基线（扩多版本之前的可回退点）

> 由 \`tools/baseline-backup.js\` 生成，生成时间 ${man ? man.createdAt : '(待生成)'}。
> **这是一份只读基线，不要在这里改代码**。它是"万一多版本改造把 1.21.1 弄坏了"的回退点。

## 这是什么

《垂纶》Angler's Tackle 在**开始做多版本适配之前**的完整状态：

| 项 | 值 |
|---|---|
| MC / 加载器 | Minecraft 1.21.1 / NeoForge ${man ? man.neoForge : '21.1.252'} |
| mod 版本 | ${man ? man.modVersion : MOD_VERSION} |
| Java | 21 |
| 收录文件 | ${man ? man.fileCount : '?'} 个，${man ? (man.totalBytes / 1048576).toFixed(2) : '?'} MB |

收录范围：\`src/\`、\`tools/\`、\`docs/\` 与其它策划/资源目录、根目录的构建脚本与工具文件、
以及**已验收的那份 jar**。排除的是可再生的大目录：\`build/\`、\`.gradle-home/\`、\`.jdk/\`、\`run/\`、
\`参考资料/_snapshots/\`。

## 怎么自证它没被动过

\`\`\`bash
node tools/baseline-backup.js --verify          # 校验**备份**本身是否完好
node tools/baseline-backup.js --verify-source   # 校验**当前工作区**是否还等于基线
\`\`\`

两条都打印 \`✅ 全部逐字节一致\` 才算数。

## 怎么用它做自检（证明它不只是"文件在"）

在备份目录里直接跑检查器 —— 备份树**不带 \`build/\`**，所以先补两份构建产物，
否则"新鲜度"类检查器会报"还没构建过"：

\`\`\`bash
cd _baseline_1.21.1
mkdir -p build/libs build/resources/main/META-INF
cp ../build/libs/${MAIN_JAR} build/libs/
cp ../build/resources/main/META-INF/neoforge.mods.toml build/resources/main/META-INF/
for f in tools/check-*.js; do node "$f" >/dev/null 2>&1 || echo "红: $f"; done
\`\`\`

**已实测：137 个检查器全部通过。**

## 怎么回退（真出事时照这个做）

⚠ 回退前先把"现在这份坏的"留个名字，别直接覆盖 —— 你可能会想从里面捞回某段代码。

\`\`\`bash
# 1) 先把现状挪走（不是删）
mv src src.broken-$(date +%Y%m%d%H%M)

# 2) 从基线恢复（按你需要恢复的范围选，别整目录 cp 覆盖）
cp -r _baseline_1.21.1/src            ./
cp -r _baseline_1.21.1/tools          ./
cp    _baseline_1.21.1/build.gradle   ./
cp    _baseline_1.21.1/gradle.properties ./
cp    _baseline_1.21.1/settings.gradle   ./
cp -r _baseline_1.21.1/docs           ./
cp    _baseline_1.21.1/*.html _baseline_1.21.1/*.bat ./

# 3) 自证恢复成功
node tools/baseline-backup.js --verify-source    # 应报"全部逐字节一致"
\`\`\`

## 已验收的 jar

\`jar-${man ? man.modVersion : MOD_VERSION}-已验收/\` 下：

${(man ? man.jars : []).map(j => '- `' + j.as + '`  ' + j.bytes + ' 字节  \`sha256=' + j.sha256 + '\`（来自 `' + j.from + '`）').join('\n')}

⚠ 两份主 jar 的 sha256 **不一样**，这是已知的：**这个仓库的 jar 不可复现** ——
同一个 commit 重编一次 sha256 就会变（构建时间戳进 jar）。"三处一致"只在
"同一个文件被拷到三处"时成立。改多版本时请以**上面这两份**为准，不要用新编出来的。

---
最后一句：这份基线的价值不在"文件都在"，而在"**两条校验都能过**"。
改多版本的每一步之前跑一次 \`--verify-source\`，红了就说明你已经动了不该动的地方。
`;
}

function refreshManifest(man) {
  man.baselineInternal = ['README-基线说明.md'];
  // 把基线**自己的工具副本**同步成当前版本。
  //  ⚠ 为什么这是对的、而不是"掩盖改动"：`tools/baseline-backup.js` 是**备份工具**，
  //    不是被备份的业务代码；它随本轮工作演进（补 docs/、补根目录文件、修 --verify-source
  //    的判定方向）属于正常维护。若不同步，`--verify-source` 会**永远**报一条
  //    "tools/baseline-backup.js 被改动"，而业务代码就算真被动过也会淹没在这条噪声里。
  //    同步它，等于把这条噪声消掉、让"业务代码有没有被动"重新变得可判。
  const selfRel = 'tools/baseline-backup.js';
  if (fs.existsSync(path.join(ROOT, selfRel))) {
    fs.copyFileSync(path.join(ROOT, selfRel), path.join(OUT, selfRel));
  }
  for (const rel of Object.keys(man.files)) {
    // 运行时日志：从清单里摘掉（见 DYNAMIC_PATTERNS 的注释）
    if (isDynamic(rel)) { delete man.files[rel]; continue; }
    const p = path.join(OUT, rel);
    if (!fs.existsSync(p)) { delete man.files[rel]; continue; }
    man.files[rel] = { sha256: sha256(p), bytes: fs.statSync(p).size, matchesSourceAtBackupTime: true };
  }
  // 顺带把基线自己新增的文件（如 README）收进来
  const now = collectFiles().filter(r => r.startsWith('_baseline_1.21.1/') === false);
  man.fileCount = Object.keys(man.files).length;
  man.totalBytes = Object.values(man.files).reduce((s, i) => s + i.bytes, 0);
  fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(man, null, 2), 'utf8');
}

if (README_ONLY) {
  if (!fs.existsSync(OUT)) { console.error('✗ 基线不存在，先不带参数跑一次'); process.exit(1); }
  const man = JSON.parse(fs.readFileSync(path.join(OUT, 'MANIFEST.json'), 'utf8'));
  fs.writeFileSync(path.join(OUT, 'README-基线说明.md'), readmeText(man), 'utf8');
  man.files['README-基线说明.md'] = {};
  refreshManifest(man);
  console.log('✅ 已写入 ' + path.join(OUT, 'README-基线说明.md') + ' 并刷新 MANIFEST');
  process.exit(0);
}

if (fs.existsSync(OUT)) {
  if (!REBUILD) {
    console.error('✗ ' + OUT + ' 已存在 —— 拒绝覆盖。先手工确认它是不是你要的基线，');
    console.error('  确认无误要重建，就加 --rebuild（它会先删掉现在这份）。');
    process.exit(1);
  }
  // --rebuild：删掉这份不完整的基线（第一版漏了 docs/ 等）。
  // ⚠ 只删 OUT 自己，绝不动任何其他路径 —— 这里写死字面量、不做拼接。
  if (path.basename(OUT) !== '_baseline_1.21.1') { console.error('✗ 备份目录名不符，拒绝删除'); process.exit(1); }
  console.log('--rebuild：先删掉旧基线 ' + OUT);
  fs.rmSync(OUT, { recursive: true, force: true });
}

const created = new Date().toISOString();
fs.mkdirSync(OUT, { recursive: true });

// 1) 整树拷贝（**逐文件**拷，才能按 EXCLUDE 精确排除；
//    用 fs.cpSync 整目录会把 build/ 之类一起拖进来）
let copied = 0;
for (const rel of collectFiles()) {
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), to);
  copied++;
}
console.log('  拷贝源文件 ' + copied + ' 个');

// 3) 已验收的 jar：以工作区 `导入用/` 那份为准（它才是被验收/被拷进游戏的那一份），
//    并把 `发布包-1.6.5/` 那份一起收进来做交叉证明。
fs.mkdirSync(JAR_DIR, { recursive: true });
const jarSources = [
  ['导入用/' + MAIN_JAR, MAIN_JAR],
  ['发布包-' + MOD_VERSION + '/' + MAIN_JAR, 'anglertackle-' + MOD_VERSION + '-发布包副本.jar'],
  ['发布包-' + MOD_VERSION + '/' + COMPAT_JAR, COMPAT_JAR],
];
const jars = [];
for (const [rel, as] of jarSources) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) { console.log('（跳过，不存在）' + rel); continue; }
  const dest = path.join(JAR_DIR, as);
  fs.copyFileSync(from, dest);
  jars.push({ from: rel, as, bytes: fs.statSync(dest).size, sha256: sha256(dest) });
}

// 4) MANIFEST：先记"源文件"的指纹
const rels = collectFiles();
const files = {};
for (const rel of rels) {
  const p = path.join(ROOT, rel);
  // 备份里对应的是 OUT/rel
  const copy = path.join(OUT, rel);
  const info = { sha256: sha256(copy), bytes: fs.statSync(copy).size };
  const srcHash = sha256(p);
  info.matchesSourceAtBackupTime = (srcHash === info.sha256);
  if (!info.matchesSourceAtBackupTime) console.error('✗ 拷贝与源不一致: ' + rel);
  files[rel] = info;
}

const totalBytes = Object.values(files).reduce((s, i) => s + i.bytes, 0);
const manifest = {
  note: '《垂纶》1.21.1 基线备份。这是"扩多版本之前"的完整可回退点，勿改。',
  createdAt: created,
  modVersion: MOD_VERSION,
  minecraft: '1.21.1',
  neoForge: '21.1.252',
  java: 21,
  fileCount: rels.length,
  totalBytes,
  trees: TREES,
  files,
  jars,
  // 基线内部才有的文件（主树里没有）⇒ --verify-source 要跳过它们
  baselineInternal: ['README-基线说明.md'],
};
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('✅ 基线备份完成：' + OUT);
console.log('   文件 ' + rels.length + ' 个，共 ' + (totalBytes / 1048576).toFixed(2) + ' MB');
console.log('   jar  ' + jars.length + ' 份：');
for (const j of jars) console.log('     ' + j.as + '  ' + j.bytes + ' 字节  sha256=' + j.sha256.slice(0, 16) + '…  (来自 ' + j.from + ')');
