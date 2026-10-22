const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 锁定"重置配置"脚本的健壮性。
//
// 踩过的坑：
//   1) $Root = Split-Path -Parent $PSScriptRoot —— 脚本被复制到别处运行时算错，
//      备份被丢到 %TEMP%\参考资料 下（测试时 New-Item 直接 Access denied）
//   2) .bat 里写中文 + UTF-8 → cmd 按 GBK 错切，满屏"不是内部或外部命令"
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

const ps=path.join(ROOT,'tools/reset-config.ps1');
if(!fs.existsSync(ps)) no('缺少 tools/reset-config.ps1');
else {
  const b=fs.readFileSync(ps);
  if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF) ok('reset-config.ps1 带 UTF-8 BOM');
  else no('reset-config.ps1 缺 BOM（中文会乱码）');
  const s=b.toString('utf8');
  if(/while\s*\(.*gradle\.properties/.test(s)||/Test-Path \(Join-Path \$Root 'gradle\.properties'\)/.test(s))
    ok('工程根按 gradle.properties 向上查找（不写死相对层级）');
  else no('工程根仍写死相对层级 —— 脚本被移动后会算错');
  if(/param\(\[switch\]\$Force\)/.test(s)) ok('支持 -Force');
  else no('缺少 -Force 开关');
  // param 必须是第一条可执行语句（PowerShell 要求）。
  // ⚠ 必须先剥掉块注释 —— 否则会把 <# ... #> 里的说明行当成代码。
  //   （这个检查器第一版就是这么误报的。）
  const noBlockComment = s.replace(/<#[\s\S]*?#>/g, '');
  const firstCode = noBlockComment.split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#'));
  if (/^param\(/.test(firstCode || '')) ok('param 是第一条可执行语句（PowerShell 要求）');
  else no('param 不在最前 —— PowerShell 会报 "param 不能在此处使用"。实际首条: ' + firstCode);
}

const bat=path.join(ROOT,'重置配置.bat');
if(!fs.existsSync(bat)) no('缺少 重置配置.bat');
else {
  const b=fs.readFileSync(bat);
  if([...b].filter(x=>x>127).length===0) ok('重置配置.bat 是纯 ASCII');
  else no('重置配置.bat 含非 ASCII 字节（cmd 会乱码）');
}

console.log(bad===0?'\n✅ 重置配置脚本健壮':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
