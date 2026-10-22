'use strict';
/**
 * 部署前**新鲜度**检查 —— 补上 2026-10-11 暴露的那个缺口。
 *
 * <h2>为什么需要它</h2>
 * 仓库里"jar 必须是本次构建产出"这条断言**写在 `build-deploy.ps1` 的闸里**。
 * 但当天闸**半路死了四次**（日志停在某个检查器中间、进程消失、没有结论行），
 * 于是那句断言**根本没被走到** ✗ —— 而我为了不耽误用户，是"手工核对构建时间 + 双向 sha256"补的 ✓。
 * 手工的东西迟早会漏 ⇒ 抽成这个**独立、不依赖闸**的检查器：什么时候都能单独跑一遍 ✓。
 *
 * <h2>它守三件事</h2>
 *   ① `build/libs/anglertackle-<mod_version>.jar` **存在**，且**比每一个源文件都新**
 *      （源 = `src/main/java/**`（.java）+ `src/main/resources/**`（.json/.png/.toml…）+ 构建脚本）。
 *      ⚠ 这是"我改完代码忘了重新构建就部署"的直接守卫 —— 也是当天真正没人守的那件事 ✗。
 *   ② 文件名里的版本 **= `gradle.properties` 的 `mod_version`**。
 *      ⚠ jar **内部**的版本（`META-INF/neoforge.mods.toml`）**不在**这里查 ——
 *        那已经由 `check-build-scripts.js`（"gradle 展开后的 mods.toml 版本 = mod_version"）
 *        与 `verify-jar.js` 守着 ✓ 这里**不抄第二份**（抄了就会漂移）。
 *   ③ 游戏 `mods` 目录里那份与本 jar 的 **sha256 一致**（= 部署过）；
 *      目录里没有/不一致时**如实报出来**，但那**不算失败** ✓（"没部署"是合法状态，不是错 ✓）。
 *
 * <h2>⚠ 它没有负例（说清楚，不装）</h2>
 * 负例副本是"复制源码树"造出来的，**里面没有真 jar** ⇒ 这条检查器**没法用副本证伪** ✗。
 * 所以它做了两件事来保证自己不是"永远绿"：
 *   1. `ATL_ROOT`（负例模式）下**明确打印"跳过"并 exit 0**，绝不假装通过 ✓；
 *   2. 它的**证伪是手工做过的**（2026-10-11）：把 `gradle.properties` 的时间戳改成比 jar 新
 *      ⇒ 它当场报红 ✓；改回去 ⇒ 绿 ✓。
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const NEGTEST = !!process.env.ATL_ROOT;
const MODS_DIR = 'D:\\mc\\PCL 正式版 2.13.1.1\\.minecraft\\versions\\1.21.1-NeoForge_21.1.250\\mods';

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const warn = (m) => console.log('  ℹ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 部署前新鲜度检查（jar 是否比所有源文件新 / 版本对不对 / 部署了没）===\n');

if (NEGTEST) {
  console.log('  ⏭ 跳过（负例副本里没有真 jar —— 这条检查器靠真实构建产物，无法用副本证伪）');
  console.log('\n（跳过。它自己的证伪是手工做的：把 gradle.properties 改成比 jar 新 ⇒ 必红）');
  process.exit(0);
}

// ── 版本 ──────────────────────────────────────────────────────────────────
const propsPath = path.join(ROOT, 'gradle.properties');
let version = '';
try {
  const m = /^\s*mod_version\s*=\s*(\d+\.\d+\.\d+)\s*$/m.exec(fs.readFileSync(propsPath, 'utf8'));
  version = m ? m[1] : '';
} catch (e) {
  fail('读不到 gradle.properties：' + e.message);
}
if (!version) fail('gradle.properties 里没有 mod_version=x.y.z');

// ── ① jar 存在 + 比所有源文件新 ────────────────────────────────────────────
const jar = path.join(ROOT, 'build', 'libs', 'anglertackle-' + version + '.jar');
if (!version) {
  console.log('\n❌ 版本读不出来，后面的检查没法做');
  process.exit(1);
}
if (!fs.existsSync(jar)) {
  fail('构建产物不存在：build/libs/anglertackle-' + version + '.jar（先跑一次构建）');
} else {
  const jarMs = fs.statSync(jar).mtimeMs;
  // ── 谁和 jar 比时间：分两类，判据不同（2026-10-11 试出来的）────────────────
  // ⚠ 为什么资源要给容差：**闸的顺序是"构建(1/6) → 生成器(2/6)"** ⇒ 生成器在构建**之后**
  //   重写 `src/main/resources` 下的生成物（worldgen/data/语言文件…）⇒ 它们的**时间戳**
  //   永远比 jar 新 1~N 秒 ✗，但内容通常一字不差 ✓ ⇒ 不给容差就会**次次假红** ✗
  //   （第一版就是这样：刚跑完闸，它立刻报 `fishing_spot.json 比 jar 新`）。
  //   ⇒ 代码（src/main/java）**严判**（生成器不动它 ✓，改了没重建就是真问题 ✓）；
  //     资源给 **120 秒容差**（只挡"真的改了资源又忘了重建"，不挡生成器的正常重写 ✓）。
  const CODE_GRACE_MS = 0;
  const RES_GRACE_MS = 120 * 1000;
  const inCode = (p) => path.relative(ROOT, p).replace(/\\/g, '/').startsWith('src/main/java/');
  const srcRoots = ['src/main/java', 'src/main/resources'];
  const exts = new Set(['.java', '.json', '.png', '.toml', '.mcmeta', '.nbt']);
  // ⚠ 只把**真正决定 jar 内容**的东西算进来：src/main/java 与 src/main/resources。
  //   第一版把 `tools/**` 也算上了 ⇒ 我新建一个**检查器**就当场报"jar 比源文件旧" ✗
  //   —— **检查器与生成器不进 jar** ✗，那是**假红**（今天已经因为假红栽过几次，不能留 ✗）。
  let newest = null;   // [路径, 时间, 是否代码]
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!exts.has(path.extname(e.name).toLowerCase())) continue;
      const ms = fs.statSync(p).mtimeMs;
      if (!newest || ms > newest[1]) newest = [p, ms, inCode(p)];
    }
  };
  for (const r of srcRoots) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs)) walk(abs);
  }
  if (!newest) {
    warn('没找到任何源文件（目录结构变了吗？）—— 新鲜度这条跳过');
  } else {
    const grace = newest[2] ? CODE_GRACE_MS : RES_GRACE_MS;
    if (newest[1] > jarMs + grace) {
      fail('jar 比源文件旧 —— 改了源码但没重新构建（"部署一份旧构建"的经典路径）：\n'
        + '        jar      ' + new Date(jarMs).toLocaleString() + '\n'
        + '        更新的源 ' + path.relative(ROOT, newest[0]).replace(/\\/g, '/')
        + '  ' + new Date(newest[1]).toLocaleString()
        + (grace > 0 ? '\n        （资源容差 ' + (grace / 1000) + ' 秒：闸的生成器阶段在构建之后跑，'
          + '它会重写 src/main/resources 下的生成物 ⇒ 那部分时间戳天然比 jar 新）' : ''));
    } else {
      ok('jar 比全部源文件都新（最新源：'
        + path.relative(ROOT, newest[0]).replace(/\\/g, '/')
        + (grace > 0 ? '，资源容差 ' + (grace / 1000) + ' 秒' : '') + '）');
    }
  }

  // ── ② 文件名版本可以信（内部版本另有检查器守）────────────────────────────
  ok('文件名版本 = mod_version = ' + version
    + '（jar **内部**的 mods.toml 版本由 check-build-scripts.js 与 verify-jar.js 守）');

  // ── ③ 部署了没（不算失败）──────────────────────────────────────────────
  const deployed = path.join(MODS_DIR, path.basename(jar));
  try {
    if (!fs.existsSync(deployed)) {
      warn('mods 目录里没有这一版（还没部署）—— 这不是失败，只是如实说');
    } else {
      const sha = (p) => fs.readFileSync(p);
      const a = sha(jar), b = sha(deployed);
      const crypto = require('crypto');
      const h = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
      if (h(a) === h(b)) {
        ok('mods 目录里那份与 build/libs 逐字节一致（sha256 ' + h(a).slice(0, 12) + '…）');
      } else {
        warn('mods 目录里那份与本 jar **不一致**（改动后没重新部署）'
          + ' —— build/libs ' + h(a).slice(0, 12) + '… vs mods ' + h(b).slice(0, 12) + '…');
      }
    }
  } catch (e) {
    warn('读不到 mods 目录（' + e.message + '）—— 跳过"部署了没"这条');
  }
}

console.log(bad === 0
  ? '\n✅ 新鲜度检查通过（构建产物存在且是最新的）'
  : '\n❌ 新鲜度检查未通过（' + bad + ' 项）—— 别把旧构建当成新构建部署');
process.exit(bad === 0 ? 0 : 1);
