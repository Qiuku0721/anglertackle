const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 锁定"调参入口不会乱码"这条。
//
// 踩过的坑：把中文写进 .bat 并用 UTF-8 存 —— cmd 按 GBK 解析 .bat，
// UTF-8 的中文字节被错切成命令，于是满屏
//   'Config' 不是内部或外部命令
//   'ldDeploy' 不是内部或外部命令
// chcp 65001 也救不了：它在第 2 行才执行，而文件在那之前已经被解析了。
//
// 现在约定：.bat 纯 ASCII 只做启动器，中文交互放 tools\dev-menu.ps1（UTF-8 BOM）。
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

const batPath=path.join(ROOT,'调参器.bat');
if(!fs.existsSync(batPath)) no('缺少 调参器.bat');
else {
  const b=fs.readFileSync(batPath);
  const nonAscii=[...b].filter(x=>x>127).length;
  if(nonAscii===0) ok('调参器.bat 是纯 ASCII（'+b.length+'B）');
  else no('调参器.bat 含 '+nonAscii+' 个非 ASCII 字节 —— cmd 会错切，必然乱码');
  if(/^@echo off/.test(b.toString('ascii'))) ok('调参器.bat 首行是 @echo off');
  else no('调参器.bat 首行不是 @echo off');
  if(/dev-menu\.ps1/.test(b.toString('ascii'))) ok('调参器.bat 调用 tools\dev-menu.ps1');
  else no('调参器.bat 没有调用 dev-menu.ps1');
  if(/[\r\n]\s*\$/.test(b.toString('ascii'))) no('调参器.bat 里混进了 PowerShell 语法');
  else ok('调参器.bat 没有混入 PowerShell 语法');
}

// 所有会输出中文的 .ps1 都必须带 UTF-8 BOM。
//
// 另一个踩过的坑：.ps1 原来是带 BOM 的，但被某个编辑器/生成工具重写后
// BOM 就没了 —— 文件本身没坏，可 Windows PowerShell 5.1 会按系统 ANSI 代码页
// （中文机器上是 GBK）去读，于是所有 Write-Host 的中文变成乱码，
// 而且**只在双击 .bat 启动时**出现，在 pwsh 里手敲命令跑却完全正常，
// 极难复现。所以对每个含中文的 .ps1 都直接断言 BOM。
//
// ⚠️ 这里**扫目录**而不是维护一张手写清单。
//    2026-09-30 又踩了一次：编辑 build-deploy.ps1 时 BOM 被工具吃掉，
//    而当时的清单恰好靠"人记得加进去"来覆盖文件 —— 清单本身是好的，
//    但这类检查一旦依赖人工维护，就会在某个时刻漏掉一个文件，
//    然后以"脚本突然语法错乱、报一堆乱码 token"的形式炸出来，根因极难反推。
//    顺带一提：那种崩溃出现时，连 build-deploy.ps1 自己都跑不起来，
//    所以这个检查必须能被**单独**跑（node tools/check-dev-entry-encoding.js），
//    修法是一行：node tools/ensure-bom.js tools/*.ps1
const ps1Files = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter((f) => f.endsWith('.ps1'))
  .sort()
  .map((f) => 'tools/' + f);
if (!ps1Files.length) no('tools/ 下一个 .ps1 都没有 —— 路径写错了？');
for (const rel of ps1Files) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { no('缺少 ' + rel); continue; }
  const b = fs.readFileSync(p);
  const hasBom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  const hasChinese = /[\u4e00-\u9fa5]/.test(b.toString('utf8'));
  if (!hasChinese) { ok(rel + ' 无中文（不需要 BOM）'); continue; }
  if (hasBom) ok(rel + ' 带 UTF-8 BOM');
  else no(rel + ' 含中文却缺 UTF-8 BOM —— 用 .bat 启动时中文会乱码（pwsh 里手动跑却正常）');
}

const menuPath = path.join(ROOT, 'tools/dev-menu.ps1');
if (!fs.existsSync(menuPath)) no('缺少 tools/dev-menu.ps1');
else {
  const s = fs.readFileSync(menuPath, 'utf8');
  if (/config reload/.test(s)) ok('dev-menu.ps1 提示了游戏内热重载路径');
  else no('dev-menu.ps1 没提 /atl config reload');
  if (/build-deploy\.ps1/.test(s)) ok('dev-menu.ps1 调用了构建脚本');
  else no('dev-menu.ps1 没有调用构建脚本');
}

console.log(bad===0?'\n✅ 调参入口编码正确，不会乱码':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
