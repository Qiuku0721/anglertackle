/*
 * check-environment.js —— 守住"时间 / 天气 / 月相"这套环境系统。
 *
 * 见 docs/24-时间天气月相策划.md（v2 · 占比约束版）。用户 2026-10-02 定案的三条硬约束：
 *   C1 时段组占比最多 +10 个百分点 · C2 天气组 +10 · C3 月相金红 +5 / 紫 +15
 *
 * 这个检查器盯五件事：
 *   A. **算例回归**：直接跑 `java EnvShare --selftest`，用户给的两个算例必须复现
 *      （2 种各 50%、1 种加成 → 60/40；4 种各 25%、2 种加成 → 30/30/20/20）。
 *      谁把"反解倍率"改回"固定倍率"（×1.2 只能得到 54.55/45.45），这一步立刻红。
 *   B. 数据源（tools/fish-habits.json）每条鱼都**显式**写了 time / weather / moon，
 *      取值都在枚举内 —— "忘了写"必须是报错，而不是静默变成全天鱼。
 *   C. 数据源的分布合理：每个时段都有人钓、全天保底鱼够、有鱼绑月相。
 *   D. 配置项的**上界**（改坏了会破坏用户定的口径）。
 *   E. 只加不减：源码里不许出现"给组外鱼减权"的写法。
 *
 * 负例（都真的证伪过）见文件末尾的注释。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 环境系统检查（时间 / 天气 / 月相）===\n');

// ---------------------------------------------------------------- A 算例回归
{
  // ⚠ JDK 与编译产物都要**向上找**：负例测试在副本目录（build/negtest/<用例>/）里跑检查，
  //   副本只包含源码与数据，不含 .jdk 与 build/classes ——
  //   只按 ATL_ROOT 找的话对照组会红（实测就是这么红的：找不到 java 可执行文件）。
  const up = (n) => path.join(__dirname, ...Array(n).fill('..'));
  const roots = [ROOT, up(2), up(3), path.join(__dirname, '..')];
  const jdk = roots
    .flatMap((r) => ['.jdk/jdk-21.0.12.1+1/bin/java.exe', '.jdk/jdk-21.0.12.1+1/bin/java'].map((p) => path.join(r, p)))
    .find((p) => fs.existsSync(p));
  const classesCandidates = [
    process.env.ATL_CLASSES,
    ...roots.map((r) => path.join(r, 'build/classes/java/main')),
  ].filter(Boolean);
  const classes = classesCandidates.find((p) => fs.existsSync(p));
  // ⚠ 结果文件**必须按进程区分**：副本里 `classes` 会找到真仓库的 build/classes（向上找是必须的），
  //   于是所有副本**共用同一个输出文件** —— 负例现在 4 路并发跑，一个进程 unlink/写入的同时
  //   另一个在读 ⇒ "没写出结果文件" ⇒ **对照组假失败**（2026-10-12 闸里就是这么红的 ✗）。
  //   加上 pid 之后每个进程各写各的，跑多少路都不打架 ✓；读完就删，不留垃圾。
  const outFile = path.join(classes || ROOT, 'envshare-selftest-' + process.pid + '.txt');
  if (!jdk) {
    bad('找不到便携 JDK（.jdk/jdk-21.0.12.1+1/bin/java）—— 无法跑算例回归');
  } else if (!classes) {
    bad('找不到编译产物（build/classes/java/main）—— 先跑一次构建再检查');
  } else {
    // ⚠ 结果走**文件**而不是 stdout 管道：本机沙箱禁止进程开命名管道，
    //   管道式 stdio 会 EPERM（见 AGENTS.md：变异测试必须用 stdio:'inherit'）。
    //   所以 java 自己把结果写文件，Node 读文件断言，控制台输出照常透传。
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    const r = spawnSync(jdk, ['-cp', classes, 'com.whitecobalt.anglertackle.fishing.EnvShare',
      '--selftest', '--out=' + outFile], { cwd: ROOT, stdio: 'inherit' });
    if (r.error) {
      bad('启动 java 失败：' + r.error.message);
    } else if (!fs.existsSync(outFile)) {
      bad('EnvShare --selftest 没写出结果文件（退出码 ' + r.status + '）');
    } else {
      const txt = fs.readFileSync(outFile, 'utf8');
      try {
        fs.unlinkSync(outFile);       // 用完就删（按 pid 命名，删的必然是自己那份）
      } catch (e) {
        // 删不掉不影响判据 —— 不留垃圾是附加目标，不是断言
      }
      const pass = (txt.match(/^PASS /gm) || []).length;
      const bads = (txt.match(/^FAIL /gm) || []).length;
      if (txt.includes('SELFTEST PASS') && bads === 0) {
        ok('算例回归通过（' + pass + ' 项：' + txt.split('\n').filter((l) => l.startsWith('PASS'))
          .map((l) => l.replace(/^PASS /, '').split(' →')[0]).join(' / ') + '）');
      } else {
        bad('算例回归失败：' + bads + ' 项 FAIL\n       ' + txt.split('\n')
          .filter((l) => l.startsWith('FAIL')).join('\n       '));
      }
    }
  }
}

// ---------------------------------------------------------------- B 数据源字段
const habitsPath = 'tools/fish-habits.json';
const SPECIES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';
const TIME_ENUM = ['all', 'dawn', 'day', 'dusk', 'night'];
const WEATHER_ENUM = ['all', 'clear', 'rain'];
const MOON_ENUM = ['any', 'full', 'new'];

if (!exists(habitsPath)) {
  bad('缺 ' + habitsPath);
} else {
  const data = JSON.parse(read(habitsPath));
  const fish = data.fish || {};
  const ids = Object.keys(fish);
  if (ids.length === 0) bad(habitsPath + ' 里一条鱼都没有');

  const missingField = [];
  const badValue = [];
  const perTime = { dawn: 0, day: 0, dusk: 0, night: 0, all: 0 };
  let rainBound = 0;
  let moonBound = 0;
  for (const [id, v] of Object.entries(fish)) {
    if (Array.isArray(v)) { missingField.push(id + '(还是旧格式)'); continue; }
    for (const k of ['habits', 'time', 'weather', 'moon']) {
      if (!(k in v)) missingField.push(id + '.' + k);
    }
    for (const t of (v.time || [])) if (!TIME_ENUM.includes(t)) badValue.push(id + '.time=' + t);
    for (const w of (v.weather || [])) if (!WEATHER_ENUM.includes(w)) badValue.push(id + '.weather=' + w);
    if (!MOON_ENUM.includes(v.moon)) badValue.push(id + '.moon=' + v.moon);
    for (const t of (v.time || [])) if (t in perTime) perTime[t]++;
    if ((v.weather || []).includes('rain')) rainBound++;
    if (v.moon && v.moon !== 'any') moonBound++;
  }
  if (missingField.length) {
    bad('这些鱼没把 time/weather/moon 写全（"忘了写"会静默变成全天鱼，必须显式）：\n       '
      + missingField.slice(0, 8).join(', ') + (missingField.length > 8 ? ' …' : ''));
  } else {
    ok(ids.length + ' 条鱼全部显式写了 habits / time / weather / moon');
  }
  if (badValue.length) {
    bad('取值不在枚举里：' + badValue.slice(0, 6).join(', '));
  } else {
    ok('time / weather / moon 取值全部合法（' + TIME_ENUM.length + ' / '
      + WEATHER_ENUM.length + ' / ' + MOON_ENUM.length + ' 个枚举值）');
  }

  // ---------------------------------------------------------------- C 分布合理
  if (missingField.length === 0) {
    const stations = ['dawn', 'day', 'dusk', 'night'];
    const empty = stations.filter((s) => perTime[s] + perTime.all < 3);
    if (empty.length) {
      bad('这些时段能钓到的鱼不足 3 条：' + empty.join(', ')
        + '（"某个时段来了没鱼可钓"是最伤的体验）');
    } else {
      ok('每个时段都有鱼：' + stations.map((s) => ({
        dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜晚',
      })[s] + ' ' + (perTime[s] + perTime.all)).join(' · ')
        + '（含全天鱼 ' + perTime.all + ' 条保底）');
    }
    if (perTime.all < 3) bad('全天保底鱼只有 ' + perTime.all + ' 条（至少 3 条）');
    else ok('全天保底鱼 ' + perTime.all + ' 条');
    if (moonBound < 1) bad('没有任何鱼绑月相 —— 月相系统等于没做');
    else ok('月相白名单 ' + moonBound + ' 条、雨天加成 ' + rainBound + ' 条');
  }
}

// ---------------------------------------------------------------- D 配置上界
{
  const cfg = read('src/main/java/com/whitecobalt/anglertackle/Config.java');
  const num = (key, field) => {
    const re = new RegExp(field + '\\s*=\\s*b\\.comment\\([\\s\\S]{0,200}?defineInRange\\(\"' + key
      + '\",\\s*([0-9.]+)D,\\s*([0-9.]+)D,\\s*([0-9.]+)D\\)');
    const m = re.exec(cfg);
    return m ? { def: Number(m[1]), min: Number(m[2]), max: Number(m[3]) } : null;
  };
  const checks = [
    ['timeDeltaPct', 'envTimeDeltaPct', 10, 20, '时段组占比（用户定案 10 个百分点）'],
    ['weatherDeltaPct', 'envWeatherDeltaPct', 10, 20, '天气组占比（用户定案 10）'],
    ['moonGoldRedDeltaPct', 'envMoonGoldRedDeltaPct', 5, 15, '金红爆率预算（用户定案 5）'],
    ['moonPurpleDeltaPct', 'envMoonPurpleDeltaPct', 15, 30, '紫爆率预算（用户定案 15）'],
  ];
  let n = 0;
  for (const [key, field, wantDef, maxAllowed, label] of checks) {
    const c = num(key, field);
    if (!c) { bad('Config 里找不到 ' + field + ' 的 defineInRange（键 ' + key + '）'); n++; continue; }
    if (c.def !== wantDef) { bad(field + ' 默认值应是 ' + wantDef + '，实际 ' + c.def + '（' + label + '）'); n++; }
    if (c.max > maxAllowed) {
      bad(field + ' 的上限 ' + c.max + ' 允许超出用户口径（最多 ' + maxAllowed + '）—— 调高上限等于把约束作废');
      n++;
    }
  }
  // 夜间减免必须有独立的配置项，且只作用于台钓（源码断言在 E 段）
  const night = num('nightCutPercent', 'biteNightCutPercent');
  if (!night) { bad('Config 里找不到 biteNightCutPercent'); n++; }
  else if (night.def !== 10) { bad('biteNightCutPercent 默认值应是 10，实际 ' + night.def); n++; }
  if (n === 0) ok('四个环境上限与夜间减免的默认值都符合用户定案，且上限没被放宽');
}

// ---------------------------------------------------------------- E 代码结构
{
  let n = 0;
  const env = read('src/main/java/com/whitecobalt/anglertackle/fishing/Environment.java');
  // 纯函数必须在（离线可测的判据）
  for (const fn of ['public static int slotOf(long', 'public static boolean isFullMoon(int',
    'public static boolean isNewMoon(int']) {
    if (!env.includes(fn)) { bad('Environment.java 里少了纯函数 ' + fn + '）'); n++; }
  }
  // 雷暴必须先判（顺序错了会让雷暴被当成普通降雨）
  if (!/isThundering\(\)\s*\?\s*THUNDER\s*:\s*\(?\s*level\.isRaining\(\)/.test(env)) {
    bad('Environment.now 里雷暴与降雨的判断顺序不对（必须先判 isThundering）');
    n++;
  }
  // 夜间减免只作用于台钓
  const bite = read('src/main/java/com/whitecobalt/anglertackle/fishing/BiteTiming.java');
  if (!/nightCutPercent\(boolean floatRod, boolean night\)[\s\S]{0,200}?!floatRod \|\| !night/.test(bite)) {
    bad('BiteTiming.nightCutPercent 没有"只作用于台钓 + 夜晚"的短路判断');
    n++;
  }
  // 环境必须由调用点显式传进去（不许从全局状态偷偷取）
  const fs2 = read(SPECIES);
  if (!/buildPool\([^)]*Environment env\)/s.test(fs2)) {
    bad('FishSpecies.buildPool 没有显式的 Environment 参数（环境必须能从调用点读出来）');
    n++;
  }
  // 只加不减：EnvShare 里对组外鱼不允许出现乘法
  const share = read('src/main/java/com/whitecobalt/anglertackle/fishing/EnvShare.java');
  if (/if \(!inGroup\.test\(i\)\)\s*\{\s*weights\.set\(/.test(share)) {
    bad('EnvShare 里出现了"给组外鱼改权重"的写法 —— 本系统只加不减');
    n++;
  }
  // 会话必须取样一次并复用（不许每 tick 现算）
  const sess = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java');
  if (!/this\.env = Environment\.now\(/.test(sess)) {
    bad('FishingSession 没有在会话开始时取样环境（Environment.now(...) 找不到）');
    n++;
  }
  if (n === 0) {
    ok('环境判定是纯函数、雷暴优先、夜间减免只给台钓、环境显式传参、只加不减、会话取样一次');
  }
}

// ---------------------------------------------------------------- 收尾
console.log('');
if (fail) {
  console.log('❌ 环境系统检查失败：' + fail + ' 处');
  process.exit(1);
}
console.log('✅ 环境系统检查通过（算例回归 · 数据字段 · 分布 · 配置上界 · 代码结构）');
