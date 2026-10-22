/*
 * check-build-scripts.js —— 构建 / 发布脚本里的**版本号只有一个来源**。
 *
 * ── 为什么需要它（2026-10-03 真踩了一次，而且每一步都打印"成功"）──────
 * `tools/build-deploy.ps1` 与 `tools/make-release.ps1` 原来各自**写死**了 jar 名
 * `anglertackle-1.1.7.jar`。把 `gradle.properties` 的 `mod_version` 改成 1.1.8 之后：
 *   ① gradle 产出的是 `anglertackle-1.1.8.jar`；
 *   ② 两个脚本照旧去找 `anglertackle-1.1.7.jar` —— 而 `build\libs` 里**恰好还留着上一版**
 *      的同名文件（gradle 从不清理旧产物）；
 *   ③ 于是"构建成功 → 部署成功 → 打包成功"，发出去的却全是**上一版**，
 *      连 jar 内部的 `version = "1.1.7"` 都还是旧的。
 * 这类事故没有任何报错，只能靠断言守。
 *
 * 断言：
 *   A. `gradle.properties` 里有 `mod_version=x.y.z`
 *   B. 两个脚本里**不许**出现写死的 `anglertackle-<数字>.<数字>.<数字>.jar`
 *   C. 两个脚本都从 `gradle.properties` 读 `mod_version`（版本不许有第二个来源）
 *   D. `build-deploy.ps1` 必须断言"这个 jar 是**本次构建**产出的"
 *      （只 `Test-Path` 是不够的，旧文件会让它照旧通过）
 *   E. gradle 展开后的 `build/resources/main/META-INF/neoforge.mods.toml` 里
 *       `version` 必须等于 `mod_version` —— 也就是"要发出去的 jar 真的装着这个版本"
 *   F. 发布包里只该有**一个** mod jar；名字对不上当前版本时给警告
 *      （发布包是 make-release.ps1 单独一步做的，构建链里天然可能还停在上一个版本）
 *
 * 用法：node tools/check-build-scripts.js
 */
const fs = require('fs');
const path = require('path');

// ATL_ROOT 允许把检查指向一棵**改坏的临时副本**（见 tools/negtest.ps1）
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const rel = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(rel(p));
const read = (p) => fs.readFileSync(rel(p), 'utf8');

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => { console.log('  ❌ ' + m); bad++; };

console.log('=== 构建/发布脚本检查（版本号只有一个来源）===\n');

const SCRIPTS = ['tools/build-deploy.ps1', 'tools/make-release.ps1'];
const PROPS = 'gradle.properties';
const EXPANDED = 'build/resources/main/META-INF/neoforge.mods.toml';
const RELEASE = '发布包';

// ---------------------------------------------------------------- A 版本号来源
let version = null;
if (!exists(PROPS)) no('缺 ' + PROPS);
else {
  const m = /^\s*mod_version\s*=\s*(\d+\.\d+\.\d+)\s*$/m.exec(read(PROPS));
  if (!m) no(PROPS + ' 里没有 mod_version=x.y.z');
  else { version = m[1]; ok('mod_version = ' + version + '（唯一的版本来源）'); }
}

// ---------------------------------------------------------------- B/C 脚本里不许写死
{
  const hard = [], noRead = [];
  // ⚠ 2026-10-11：扫描范围从"两个 .ps1"扩到**全部 tools/*.js**。
  //   同一天发现 tools/check-live-config-matches-defaults.js 里写死了
  //   `...\mods\anglertackle-1.1.5.jar` —— 那个路径从 1.5.x 起**永远不存在**，
  //   于是它每次都走"jar 尚未部署"的宽松分支 ⇒ **这条守卫静默瞎了几个月，症状是全绿**
  //   （正是"永远绿的检查器比没有检查器更坏"）。
  //   写死 jar 名这件事**不分 .ps1 还是 .js**，扫描范围就不该分。
  //   ⚠ `mod_version` 那条要求仍然只对 SCRIPTS —— 大多数 .js 工具根本不需要读版本。
  const scanned = [...SCRIPTS,
    ...fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.js')).map((f) => 'tools/' + f)]
    // 豁免：**负例的变异载荷**里必须出现一个字面量 jar 名 —— 那个用例模拟的就是
    // "有人把名字写死"，字面量本身就是被扫的对象。豁免写明白，且只豁免这一个文件
    // （不许"整个目录跳过"：那样真写死也就漏了）。
    .filter((f) => f !== 'tools/_negtest.js');
  for (const s of scanned) {
    if (!exists(s)) { no('缺 ' + s); continue; }
    // ⚠⚠ 先**剥掉注释**再扫 —— 这一条是踩出来的：
    //   第一版直接扫全文，一上来就报了 7 处"写死的 jar 名"，其中 6 处根本是**注释里的历史说明**
    //   （check-build-scripts.js 自己的文件头就在讲当年 1.1.7 那次事故，check-live-config 里
    //   也留着"这里原来是 1.1.5"的记录）—— 那种假红比没有守卫更坏：下一个人会直接把整条断言删掉。
    //   剥的是块注释与整行 `//` 注释；行尾 `//` 不动（正则字面量里的 `//` 会被误伤）。
    const src = read(s)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const m = /anglertackle-\d+\.\d+\.\d+\.jar/.exec(src);
    if (m) hard.push(s + ' 里写死了 ' + m[0]);
    if (SCRIPTS.includes(s) && !/mod_version/.test(read(s))) noRead.push(s);
  }
  if (hard.length) {
    no('jar 名被写死了（改版本号时会**静默部署上一版 / 看错文件**）：\n       ' + hard.join('\n       '));
  } else ok('两个 .ps1 与 tools/*.js 里都没有写死的 jar 名');
  if (noRead.length) no('这些脚本没有从 gradle.properties 读 mod_version：' + noRead.join('、'));
  else ok('两个脚本都从 gradle.properties 读 mod_version');
}

// ---------------------------------------------------------------- B2 发布说明里不许写死数字
//
// ⚠ 2026-10-08 实测：`make-release.ps1` 生成的《安装说明.txt》里写着
//   "《垂纶》Angler's Tackle  v1.0.1" 和 "21 种鱼" —— 而当时实际是 1.5.42 / 47 种。
//   发布说明是**唯一直接给玩家看的东西**，写死一次就会一直撒谎；
//   而它以前没有任何检查在看（B/C 那一条只管 jar 名）。
{
  const s = 'tools/make-release.ps1';
  if (!exists(s)) no('缺 ' + s);
  else {
    const src = read(s);
    // ⚠ 只检查**给玩家看的那块说明正文**（$readme 的 here-string），不扫整个脚本 ——
    //   否则注释里为了记录事故而引用的旧值（"当时写着 21 种鱼 / v1.0.1"）会把检查撑红，
    //   那种红是假红，久了人就会去把断言删掉。
    const m = /\$readme\s*=\s*@"([\s\S]*?)"@/.exec(src);
    if (!m) {
      no(s + ' 里找不到 $readme 的 here-string —— 说明正文变了结构？检查器需要跟着改');
    } else {
      const readme = m[1];

      const ver = /v\d+\.\d+\.\d+/.exec(readme);
      if (ver) {
        no(s + ' 的发布说明里写死了版本号 ' + ver[0] + ' —— 应当用 $ModVersion（版本只有一个来源）');
      } else if (!/v\$ModVersion/.test(readme)) {
        no(s + ' 的发布说明里没有 $ModVersion —— 说明的版本号从哪来？');
      } else ok('发布说明的版本号来自 gradle.properties（$ModVersion）');

      const fish = /(\d+)\s*种鱼/.exec(readme);
      if (fish) {
        no(s + ' 的发布说明里写死了鱼种数（' + fish[1] + ' 种）—— 应当从 FishSpecies.java 数出来');
      } else if (!/\$FishCount/.test(readme)) {
        no(s + ' 的发布说明里没有 $FishCount —— 鱼种数没有从源码数（写死就会随鱼种增加而撒谎）');
      } else ok('发布说明的鱼种数是从 FishSpecies.java 数出来的（$FishCount）');
    }
  }
}

// ---------------------------------------------------------------- D 必须断言 jar 是新的
{
  const s = 'tools/build-deploy.ps1';
  if (!exists(s)) no('缺 ' + s);
  else {
    const src = read(s);
    if (!/LastWriteTime\s*-lt\s*\$BuildStart/.test(src)) {
      no(s + ' 没有断言"jar 是本次构建产出的" —— 只 Test-Path 的话，'
        + 'build\\libs 里的旧文件会让它照旧通过（2026-10-03 的事故就是这条）');
    } else ok('部署前会核对 jar 的产出时间（挡住"部署了上一版"）');
  }
}

// ---------------------------------------------------------------- E jar 里的版本
if (!version) {
  // 版本号都没读到，后面的比对没有意义（上面已经报过一次）
} else if (!exists(EXPANDED)) {
  console.log('  ⚠ 还没构建过（找不到 ' + EXPANDED + '），跳过"jar 里的版本"这条');
} else {
  const m = /^version\s*=\s*"([^"]+)"/m.exec(read(EXPANDED));
  if (!m) no('读不到 ' + EXPANDED + ' 里的 version');
  else if (m[1] !== version) {
    no('要发出去的 jar 里写的是版本 ' + m[1] + '，而 gradle.properties 是 ' + version
      + ' —— 这就是"部署/发布了上一版"的样子');
  } else ok('gradle 展开后的 mods.toml 版本 = ' + version + '（jar 里装的就是这一版）');
}

// ---------------------------------------------------------------- F 发布包里不许有旧包
// ⚠ 这里"还是上一版"只**警告**不判失败：发布包是 `tools/make-release.ps1` 单独一步做的，
//   而本检查器在构建链里跑 —— 那一刻发布包天然还停在上一个版本。真正的判失败留给
//   "多个 mod jar 并存"这种必然是打包事故的情况。
if (!exists(RELEASE)) {
  console.log('  ⚠ 还没有发布包目录，跳过');
} else {
  // 1.4.0 起发布包里**故意**有两个 jar：主 jar + 森罗扩展包（可选安装）。
  // 判据因此从"只有一个"改成：主 jar 恰好一个（版本要对）+ 扩展包名字固定、不许重复。
  const COMPAT = 'anglertackle-kaleidoscope-1.0.0.jar';
  const all = fs.readdirSync(rel(RELEASE)).filter((f) => /^anglertackle-.*\.jar$/.test(f));
  const jars = all.filter((f) => f !== COMPAT);
  const want = version ? 'anglertackle-' + version + '.jar' : null;
  if (jars.length === 0) console.log('  ⚠ 发布包里还没有 mod jar（跑 tools\\make-release.ps1）');
  else if (jars.length > 1) no('发布包里有多个主 jar（旧包残留）：' + jars.join('、'));
  else if (all.filter((f) => f === COMPAT).length > 1) no('发布包里有多个扩展包 jar：' + COMPAT);
  else if (want && jars[0] !== want) {
    console.log('  ⚠ 发布包里还是 ' + jars[0] + '（当前版本 ' + (version || '?')
      + '）—— 跑 tools\\make-release.ps1 刷新');
  } else {
    ok('发布包里是 ' + jars[0] + (all.includes(COMPAT) ? ' + ' + COMPAT + '（扩展包）' : '')
      + '（没有旧包残留）');
  }
}

// ---------------------------------------------------------------- G 版本档位（跨档要经用户允许）
// 用户 2026-10-04 原话："以后没经过我允许版本号不可以往前跨一个档，就算是 1.5.100 都得给我忍着。"
// 所以档位写在 tools/version-policy.json 里 —— 改那一行就是"他同意了"的书面记录，
// 光改 gradle.properties 会被这里拦住（我 1.4→1.5 就是这么越界的）。
{
  const pol = JSON.parse(read('tools/version-policy.json'));
  const mm = /^(\d+)\.(\d+)\./.exec(version);
  const now = mm ? mm[1] + '.' + mm[2] : null;
  if (!now) {
    no('版本号 ' + version + ' 不是 x.y.z 形式，判不了档位');
  } else if (now !== pol.minor) {
    no('版本档位跨了：现在是 ' + now + '，而 tools/version-policy.json 只允许到 ' + pol.minor
      + '（' + pol.since + ' 定）\n       用户原话：没经过允许不许跨档，哪怕是 1.5.100 也得忍着。'
      + '\n       要跨档：先问用户，再把 tools/version-policy.json 的 minor 改成新档位。');
  } else {
    ok('版本 ' + version + ' 还在允许的档位内（' + pol.minor + '.x，跨档要经用户允许）');
  }
}

console.log('');
if (bad === 0) {
  console.log('✅ 构建/发布脚本的版本号一致（单一来源，且发出去的 jar 就是这一版）');
  process.exitCode = 0;
} else {
  console.log('❌ 构建/发布脚本检查失败：' + bad + ' 项');
  process.exitCode = 1;
}
