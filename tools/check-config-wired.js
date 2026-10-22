const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿// 锁定"配置项真的被读取"。
//
// 背景：Config.java 曾声明 44 个配置项并注册成功 —— 游戏会正常生成配置文件，
// 玩家打开能看到一堆选项 —— 但**全项目零引用**，改了一点效果都没有。
// 这比"功能不存在"更糟：玩家以为改了有用，白折腾。
//
// 检测方式：扫 Config.java 之外的所有 java 代码里有没有出现
// {@code <字段名>.get()} / {@code .<字段名>}。用"字段名"而不是
// "Config.INSTANCE.字段名"，因为读的地方常常先取个别名（如 var cfg = Config.INSTANCE）。
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
function walk(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p,out); else if(e.name.endsWith('.java'))out.push(p);}return out;}
const files=walk(path.join(ROOT,'src/main/java'),[]);
const cfgPath=files.find(f=>f.endsWith('Config.java'));
const cfgSrc=fs.readFileSync(cfgPath,'utf8');
const decls=[...cfgSrc.matchAll(/public final ModConfigSpec\.\w+ (\w+);/g)].map(m=>m[1]);
const others=files.filter(f=>f!==cfgPath).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const unused=decls.filter(n=>!new RegExp('\\.'+n+'\\b').test(others));
console.log('配置项总数: '+decls.length+'   已被读取: '+(decls.length-unused.length));
if(unused.length){
  console.log('❌ 以下 '+unused.length+' 项声明了但没人读（改文件没用）：');
  unused.forEach(n=>console.log('   - '+n));
} else {
  console.log('✅ 全部配置项都被读取');
}
const main=fs.readFileSync(path.join(ROOT,'src/main/java/com/whitecobalt/anglertackle/AnglersTackle.java'),'utf8');
if(/registerConfig\(ModConfig\.Type\.\w+, Config\.SPEC\)/.test(main)) console.log('✅ Config.SPEC 已注册到 mod 总线');
else { console.log('❌ Config.SPEC 没有注册（配置文件不会生成）'); unused.push('__spec__'); }
process.exit(unused.length?1:0);
