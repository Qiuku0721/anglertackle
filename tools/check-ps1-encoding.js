/*
 * PowerShell 脚本必须是 UTF-8 **带 BOM**。
 *
 * 为什么值得单独立一个检查：
 *   Windows PowerShell 5.1 读无 BOM 的文件时按系统 ANSI 代码页（简中 = GBK）解码。
 *   本仓库的 .ps1 里全是中文注释和中文错误消息，一旦 BOM 丢失，PowerShell 会把
 *   UTF-8 字节按 GBK 解成乱码，而乱码里出现的 '?' '{' 会破坏字符串/语句结构 ——
 *   报错长得像"脚本语法错了"，真正的原因却是**编码**。
 *   2026-10-01 就发生过两次：has been 补上 BOM 又被编辑器/补丁工具写回无 BOM，
 *   每次都伪装成 "Unexpected token '}'"，很费时间。
 *
 *   另一个真实后果：用户平时用 pwsh 7（默认按 UTF-8 读，无 BOM 也正常），
 *   所以这个坑在 pwsh 7 下完全不显形，只在用 powershell 5.1 跑时才炸 ——
 *   而 tools/build-deploy.ps1 内部恰恰是用 `powershell` 起 negtest.ps1 的。
 */
const fs = require('fs');
const path = require('path');

// ⚠ 认 ATL_ROOT：负向测试（tools/negtest.ps1）是在**副本**上跑检查器的。
//   不认它的话负例永远读真实仓库 —— 期望失败的用例照样绿，看着像"检查器漏检"，
//   其实是它**根本没看那份被改坏的文件**（这个坑在 check-guide-sync 上踩过一次）。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// 只查**本仓库自己跑**的脚本：tools/ 下的 .ps1。
//   · 参考资料/_snapshots/** —— 历史快照，是"改动前的样子"，一个字都不该动；
//   · fish_research/_tools/** —— 抓鱼资料用的一次性脚本，不属于构建闸门；
//   · tools/get-toolchain.ps1 —— 从 ModDevGradle 下载的第三方引导脚本，
//     改了会在升级时被覆盖，而且它不参与我们的闸门，BOM 与否无所谓。
const SKIP = new Set(['get-toolchain.ps1']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === '.gradle' || e.name === '.gradle-home' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.ps1') && !SKIP.has(e.name)) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'tools')).sort();
let bad = 0;
for (const f of files) {
  const buf = fs.readFileSync(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (buf.length < 3 || !buf.subarray(0, 3).equals(BOM)) {
    console.error('❌ 缺少 UTF-8 BOM：' + rel +
      '（powershell 5.1 会按 GBK 解码，中文注释和消息变成乱码并导致语法错误）');
    bad++;
    continue;
  }
  const text = buf.subarray(3).toString('utf8');
  if (text.includes('\uFFFD')) {
    console.error('❌ 含替换字符 U+FFFD（文件已损坏）：' + rel);
    bad++;
    continue;
  }
  // 顺带守住"声明 UTF-8 又写 UTF-16"这类事故：UTF-16 文本里会大量出现 \u0000
  if (text.includes('\u0000')) { console.error('❌ 含 NUL 字节（可能是 UTF-16）：' + rel); bad++; }
}
// ---- 全仓库的 .bat 必须是纯 ASCII、且不能带 BOM ----
//
// 为什么：cmd.exe 按 **OEM 代码页** 读批处理文件。里面混进中文会被解码成乱码，
// 而那些坏字节还可能把**下一行的开头吃掉** —— 2026-10-01 真实踩到：
// game-ime.bat 里的中文注释让下一行的 "powershell" 变成 "werShell"，
// 于是双击就报"'werShell' 不是内部或外部命令"，而脚本本体其实没问题。
// 路径一律用 %~dp0 展开，所以就算项目路径含中文，.bat 里也一个字都不用写中文。
//
// ⚠ 2026-10-02 起改成**全仓库递归**：原来只扫 tools/，而"输入法锁定"那个小工具
//   跑到 工具\输入法锁定\ 去了，那里同样有双击运行的 .bat（编译.bat / 开机自启.bat）
//   —— 只扫 tools/ 等于把新工具漏在闸门外面。快照与调研目录照旧排除。
const BAT_SKIP_DIRS = new Set([
  'build', '.gradle', '.gradle-home', 'node_modules',
  '参考资料', 'fish_research',   // 历史快照与一次性调研脚本，不是我们要守的东西
]);
function walkBats(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const e of entries) {
    if (BAT_SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkBats(p, out);
    else if (e.name.toLowerCase().endsWith('.bat')) out.push(p);
  }
  return out;
}
const bats = walkBats(ROOT, []).sort();
let batBad = 0;
for (const f of bats) {
  const buf = fs.readFileSync(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    console.error('❌ .bat 不能带 UTF-8 BOM（会在第一条命令之前留下多余字节）：' + rel);
    batBad++;
    continue;
  }
  const at = buf.findIndex((v) => v > 127);
  if (at >= 0) {
    console.error('❌ .bat 里有非 ASCII 字节（偏移 ' + at + '，值 0x' + buf[at].toString(16) + '）：' + rel +
      ' —— cmd 按 OEM 代码页解码，中文注释会把下一行的命令读错位');
    batBad++;
  }
}
if (batBad === 0) { console.log('  ✅ ' + bats.length + ' 个 .bat 都是纯 ASCII、无 BOM（全仓库递归）'); }

console.log('检查 ' + files.length + ' 个 .ps1：' + (files.length - bad) + ' 个带 BOM' +
            (bad ? '，' + bad + ' 个不合格' : '，全部合格'));
process.exit(bad === 0 && batBad === 0 ? 0 : 1);
