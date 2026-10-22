const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿// 锁定"发布包双击入口真的能用"。
//
// 这一类坑踩过四次，每次都只在"双击"时才暴露：
//   1) .bat 里写中文 + UTF-8 存 → cmd 按 GBK 错切成命令
//   2) .bat 用 Set-Content -Encoding ASCII 存 → 中文变 '?'，
//      ps1 里 Join-Path 拿到 '???.html'，报"参数为空字符串"
//   3) ps1 只用 $PSScriptRoot 找页面 → 那等于只在 tools\ 里找
//   4) .bat 引用了发布包里不存在的脚本（tools\dev-menu.ps1）
//
// 所以这里逐条静态校验，并且核对发布包的文件真的齐。
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

// ---- .bat 侧 ----
const bat=path.join(ROOT,'tools/release-entry.bat');
if(!fs.existsSync(bat)) no('缺少 tools/release-entry.bat');
else{
  const b=fs.readFileSync(bat);
  const nonAscii=[...b].filter(x=>x>127).length;
  if(nonAscii===0) ok('release-entry.bat 纯 ASCII');
  else no('release-entry.bat 含 '+nonAscii+' 个非 ASCII 字节（cmd 会错切）');
  const s=b.toString('ascii');
  if(/\?\?\?/.test(s)) no('release-entry.bat 里有 ???（中文被 ASCII 化的痕迹）');
  else ok('release-entry.bat 没有 ??? 残留');
  // 引用的脚本文件名必须是纯 ASCII
  const refs=[...s.matchAll(/-File\s+"%[^"]*?\\([^"\\]+)"/g)].map(m=>m[1]);
  const cnRefs=refs.filter(r=>[...r].some(c=>c.charCodeAt(0)>127));
  if(cnRefs.length) no('.bat 引用了中文文件名: '+cnRefs.join(', '));
  else ok('.bat 引用的脚本名都是 ASCII（'+(refs.join(', ')||'无')+'）');
}

// ---- ps1 侧 ----
const ps=path.join(ROOT,'tools/tuner-launcher.ps1');
if(!fs.existsSync(ps)) no('缺少 tools/tuner-launcher.ps1');
else{
  const b=fs.readFileSync(ps);
  if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF) ok('tuner-launcher.ps1 带 UTF-8 BOM');
  else no('tuner-launcher.ps1 缺 BOM（中文乱码）');
  const s=b.toString('utf8');
  if(/Split-Path -Parent \$PSScriptRoot/.test(s)) ok('ps1 会往上找一级（发布包结构：页面在根、脚本在 tools\）');
  else no('ps1 只找 $PSScriptRoot —— 发布包里会找不到页面（踩过）');
  if(/tuner\.html/.test(s)) ok('ps1 找 tuner.html（ASCII 名）');
  else no('ps1 没找 tuner.html');
}

// ---- 原名别名 ----
if(fs.existsSync(path.join(ROOT,'tuner.html'))) ok('工作区有 tuner.html（ASCII 别名）');
else no('缺少 tuner.html —— 构建时应从 调参器.html 生成');

// ---- 发布包齐不齐（有发布包就查） ----
const rel=path.join(ROOT,'发布包_new');
if(fs.existsSync(rel)){
  // ⚠ jar 名不许写死（2026-10-11）：写死成 1.1.5 之后，这里会去找一个**永不存在的文件**，
  //   于是"发布包齐不齐"这条断言静默失效（症状：每次都说缺 jar，而其实只是名字对不上）。
  //   版本只有一个来源：gradle.properties 的 mod_version。
  const modVersion=(/^\s*mod_version\s*=\s*(\d+\.\d+\.\d+)\s*$/m
    .exec(fs.readFileSync(path.join(ROOT,'gradle.properties'),'utf8'))||[])[1]||'';
  if(!modVersion) no('读不到 gradle.properties 的 mod_version —— 发布包检查会失效');
  const need=['anglertackle-'+modVersion+'.jar','tuner.html','安装说明.txt','调参入口.bat',
              path.join('tools','tuner-launcher.ps1')];
  const miss=need.filter(f=>!fs.existsSync(path.join(rel,f)));
  miss.length?no('发布包缺: '+miss.join(', ')):ok('发布包文件齐（'+need.length+' 项）');
  // 不该出现中文名的重复页面
  if(fs.existsSync(path.join(rel,'调参器.html'))) no('发布包里多了一份 调参器.html（重复，且中文名 .bat 引用不了）');
  else ok('发布包里没有重复的中文名页面');
} else console.log('ℹ 没有 发布包_new，跳过发布包检查');

console.log(bad===0?'\n✅ 双击入口可用':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
