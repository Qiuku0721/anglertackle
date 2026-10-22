/*
 * check-config-sync.js —— 补进 toml 的新键必须落在**它自己那张表**里。
 *
 * 真实事故（2026-10-02，加 bite 的 8 个新配置项时）：
 *   sync-config-file.js 对"已存在的分组"把键**追加到文件末尾却没写表头**，
 *   于是那 8 个键落进了当时最后一个分组 `[render]`。
 *   症状完全是静默的：
 *     · toml 里 `render.floorSeconds` 有了、`bite.floorSeconds` 没有；
 *     · NeoForge 只读 `bite.*`，所以游戏里那 8 项永远按默认值走
 *       （调参器改了没反应，玩家会以为工具坏了）；
 *     · check-live-config-matches-defaults.js 只报"多出 8 项"，
 *       看上去像个无害的小毛病。
 *   而且"同名表出现两次"在 TOML 规范里本来就非法，所以正确做法是插进原表。
 *
 * 做法：**真的跑一遍** tools/sync-config-file.js（在临时副本上、--out 到 build/），
 * 再断言：
 *   ① 新键落在 [bite] 表内；
 *   ② 文件里没有重复表头（尤其没有第二张 [bite]）；
 *   ③ 尾巴那张表（模拟"文件最后一个分组"）里没有多出目标键 —— 就是事故本身；
 *   ④ 原有的键值一个字没动。
 *
 * ⚠ 不用管道捕获子进程输出：本机沙箱禁止进程开命名管道（EPERM），
 *   所以 stdio 用 'ignore'，只看它写出来的文件。
 *
 * 用法：node tools/check-config-sync.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

console.log('=== 配置文件同步检查（新键必须补进自己的表）===\n');

const SYNC = 'tools/sync-config-file.js';
const SCHEMA = 'tools/tuning-schema.json';
for (const f of [SYNC, SCHEMA]) {
  if (!exists(f)) { no('找不到 ' + f); }
}
if (bad) { process.exit(1); }

const schema = JSON.parse(read(SCHEMA));
const bite = schema.groups.find((g) => g.id === 'bite');
if (!bite || bite.fields.length < 3) {
  no('tuning-schema.json 里的 bite 分组不对（项数 ' + (bite ? bite.fields.length : '无') + '）—— 这条断言失效了');
  process.exit(1);
}

// 造一个"已有 [bite] 但少了最后两项"的 toml，并在它后面再放一张表 ——
// 有那张尾巴表，才能复现"键被追加到最后一个分组"这个事故。
const keep = bite.fields.slice(0, bite.fields.length - 2);
const lack = bite.fields.slice(-2).map((f) => f.key);
const TMP = path.join(ROOT, 'build', 'check-config-sync');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const inToml = path.join(TMP, 'in.toml');
const outToml = path.join(TMP, 'out.toml');

let text = '[bite]\n';
for (const f of keep) text += '\t' + f.key + ' = ' + f.def + '\n';
text += '\n[zzz_tail]\n\tsomeKey = 1\n';
fs.writeFileSync(inToml, text, 'utf8');

const r = spawnSync(process.execPath,
  [path.join(ROOT, SYNC), inToml, '--out', outToml, '--write'],
  { stdio: 'ignore' });
if (r.error) {
  no('跑不动 ' + SYNC + '：' + r.error.message);
  process.exit(1);
}
if (r.status !== 0) {
  no(SYNC + ' 退出码 ' + r.status + '（这一组输入应当能被正常处理）—— 下面的断言没法做了');
  process.exit(1);
}
if (!fs.existsSync(outToml)) {
  no(SYNC + ' 没有写出 --out 指定的文件');
  process.exit(1);
}
ok('sync-config-file.js 跑通，写出了合并结果（缺的正是 ' + lack.join(' / ') + '）');

const lines = fs.readFileSync(outToml, 'utf8').split(/\r?\n/);
const isHead = (l) => /^\s*\[[^\]]+\]\s*$/.test(l);
const headAt = (id) => lines.findIndex((l) => l.trim() === '[' + id + ']');
const sectionEnd = (start) => {
  for (let i = start + 1; i < lines.length; i++) if (isHead(lines[i])) return i;
  return lines.length;
};
const hasKey = (body, k) => new RegExp('^[ \\t]*' + k + '\\s*=', 'm').test(body);

// ① 表头不许重复（TOML 规范里同名表只能出现一次）
{
  const heads = lines.filter(isHead).map((l) => l.trim());
  const dup = heads.filter((h, i) => heads.indexOf(h) !== i);
  if (dup.length) no('输出里有重复表头：' + [...new Set(dup)].join(' / ') + '（TOML 不允许同名表出现两次）');
  else ok('没有重复表头（' + heads.length + ' 张表）');
}

// ② 新键落在 [bite] 表内
const bStart = headAt('bite');
if (bStart < 0) {
  no('输出里找不到 [bite] 表头');
} else {
  const body = lines.slice(bStart, sectionEnd(bStart)).join('\n');
  for (const k of lack) {
    if (hasKey(body, k)) ok('新键 ' + k + ' 落在 [bite] 表内');
    else no('新键 ' + k + ' 没落在 [bite] 表内 —— NeoForge 只读 bite.*，这一项在游戏里永远不会生效');
  }
  // ④ 原有键值没被动过
  const changed = keep.filter((f) => !new RegExp('^[ \\t]*' + f.key + '\\s*=\\s*' + f.def + '\\s*$', 'm').test(body));
  if (changed.length) no('原有的键被改动了：' + changed.map((f) => f.key).join(' / '));
  else ok('原有 ' + keep.length + ' 个键的值一个字没动');
}

// ③ 尾巴那张表里不许出现目标键（这就是事故本身）
const tStart = headAt('zzz_tail');
if (tStart < 0) {
  no('输出里找不到 [zzz_tail]（它不该消失）');
} else {
  const body = lines.slice(tStart, sectionEnd(tStart)).join('\n');
  const leaked = lack.filter((k) => hasKey(body, k));
  if (leaked.length) {
    no('新键被写进了文件最后一个分组 [zzz_tail]：' + leaked.join(' / ')
      + ' —— 这正是 2026-10-02 那次（bite 的项落进了 [render]）');
  } else {
    ok('[zzz_tail] 里没有被漏进来的键');
  }
}

// ④ NeoForge 自己加的注释行必须原样留着
//
// 游戏每次启动写回 toml 时，会在我们的注释下面补两行：
//     # Default: 1.6
//     # Range: 0.2 ~ 10.0
// 脚本的注释比对如果把它们也算成"我们的注释"，就会永远判"不一致"，
// `--write` 时还会把它们删掉 —— 游戏下次启动又加回来，来回折腾。
// 2026-10-02 真实发生：本机 519 条噪音（几乎每一项），文件白写一遍。
{
  const inToml2 = path.join(TMP, 'in2.toml');
  const outToml2 = path.join(TMP, 'out2.toml');
  const f0 = bite.fields[0];
  const wanted = '\t# ' + f0.comment + '\n'
    + '\t# Default: ' + f0.def + '\n'
    + '\t# Range: 0 ~ 100\n'
    + '\t' + f0.key + ' = ' + f0.def + '\n';
  fs.writeFileSync(inToml2, '[bite]\n' + wanted, 'utf8');

  const r2 = spawnSync(process.execPath,
    [path.join(ROOT, SYNC), inToml2, '--out', outToml2, '--write'], { stdio: 'ignore' });
  if (r2.error || r2.status !== 0 || !fs.existsSync(outToml2)) {
    no('第二组输入（带 Default/Range 注释）跑不起来：' + (r2.error ? r2.error.message : '退出码 ' + r2.status));
  } else {
    const out2 = fs.readFileSync(outToml2, 'utf8');
    const lines2 = out2.split(/\r?\n/);
    const hasOurs = lines2.some((l) => l.trim() === '# ' + f0.comment);
    const hasDefault = lines2.some((l) => /^[ \t]*#\s*Default\s*:/.test(l));
    const hasRange = lines2.some((l) => /^[ \t]*#\s*Range\s*:/.test(l));
    if (hasOurs && hasDefault && hasRange) {
      ok('我们的注释与 NeoForge 自动加的 Default/Range 行都原样留着（不再来回折腾）');
    } else {
      no('注释块被改写了（我们的注释 ' + hasOurs + ' / Default ' + hasDefault
        + ' / Range ' + hasRange + '）—— 把游戏自动加的行当成自己的注释删掉了，'
        + '下次启动游戏又会加回来，每次构建都白写一遍');
    }
  }
}

// ⑤ 护栏：不许拿"游戏里那份（调过参的）"当基底去覆盖**发布用默认配置**（2026-10-11 真踩过）
//
// 仓库根那份 `anglertackle-common.toml` 是直接覆盖给玩家的**默认**配置 ⇒ 必须与代码默认值一致。
// 而不带位置参数时本工具的基底是游戏目录那份（被调参器改过）⇒ 那一次把 104 个键写成了调参值，
// 发布包发出去的默认值全是错的，**而且每一步都打印成功** ✗。
// 现在工具里加了硬护栏，这里守"护栏还在"。
{
  const r3 = spawnSync(process.execPath,
    [path.join(ROOT, SYNC), '--out', path.join(ROOT, 'anglertackle-common.toml'), '--write'],
    { stdio: 'ignore' });
  if (r3.error) {
    no('护栏那条命令跑不起来：' + r3.error.message);
  } else if (r3.status !== 2) {
    no('拿"游戏那份 toml"当基底去覆盖发布用默认配置，退出码是 ' + r3.status
      + '（应当被拒：2）—— 护栏没了，下一次就会把调参值写进发布默认配置 ✗');
  } else {
    ok('护栏在：用游戏那份当基底覆盖发布用默认配置会被拒（退出码 2）');
  }
}

// ⑥ 发布用默认配置的**修法**必须真的能修（2026-10-11 真踩过第二次）
//
// `sync-config-file.js` 的纪律是"已有键一律不动"（玩家的调参值要留住）⇒ 它**从不改已有键的值**，
// 所以对"值漂移"这一类一点用都没有 ✗。那天检查器报"发布用默认配置与默认值不同"，
// 提示却指的是它 —— 照着敲一遍，错误原样还在。
// 现在修法是 tools/reset-release-defaults.js（把值刷回代码默认值），这里守"它在、且它自认一致"。
{
  const fixer = path.join(ROOT, 'tools', 'reset-release-defaults.js');
  const releaseToml = path.join(ROOT, 'anglertackle-common.toml');
  if (!fs.existsSync(fixer)) {
    no('缺少 tools/reset-release-defaults.js —— 发布用默认配置的"值漂移"就没有修法了'
      + '（sync-config-file.js 只补缺项，改不了已有值）');
  } else if (process.env.ATL_ROOT) {
    // ⚠ 负例副本里**不能**跑 `--check`：副本里那份 toml 是 createFiles 造的**小样本**
    //   （只有几个键），拿它去和 863 项默认值比当然"不一致" ⇒ 对照组假失败 ✗
    //   （2026-10-11 真踩过：cfgsync-ok / livecfg-ok 两条对照组因此变红）。
    console.log('  ℹ 负例副本里跳过"修法自检"（副本里的 toml 是合成样本，不是发布用默认配置）');
  } else if (!fs.existsSync(releaseToml)) {
    console.log('  ℹ 仓库根没有 anglertackle-common.toml ⇒ 跳过"修法自检"（只提示、不失败）');
  } else {
    const r4 = spawnSync(process.execPath, [fixer, '--check'], { stdio: 'ignore' });
    if (r4.error) no('reset-release-defaults.js --check 跑不起来：' + r4.error.message);
    else if (r4.status !== 0) {
      no('reset-release-defaults.js --check 报"与代码默认值不一致" —— '
        + '要么发布用默认配置真的漂了（跑一次不带 --check 的它），要么工具自己坏了');
    } else {
      ok('发布用默认配置此刻与代码默认值一致（由 reset-release-defaults.js --check 独立复核 ✓）');
    }
  }
}

console.log('');
console.log(bad === 0
  ? '✅ 新增配置项会被补进正确的表里'
  : '❌ 配置文件同步有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
