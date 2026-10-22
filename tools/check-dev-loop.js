const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿// 锁定"调参值可运行时改"这条。
//
// 背景：原先调参值是 `static final double X = Config.INSTANCE.y.get();` ——
// 静态常量只在类加载时求值一次，改配置必须重启整个游戏。
// 对手感调参来说"改数值 → 重启 → 抛竿 → 观察"一轮几分钟，根本试不动。
// 现在统一走 Tuning 运行时读取，配 `/atl config reload` 实现热重载。
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8')
  .replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

// 1) Tuning 存在且 getter 齐全
const T='src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java';
if(!fs.existsSync(path.join(ROOT,T))) no('Tuning.java 不存在');
else {
  const s=read(T);
  const need=['reelGain','releaseLoss','idleLoss','whiteZoneRatio','yellowZoneRatio',
              'pullIdle','staminaDrainPerTick','wLineOnTension','capTensionCeiling',
              'baseRecover','hookWindowBase','biteMinWait','lineDurabilityPerBite'];
  const miss=need.filter(n=>!new RegExp('public static double '+n+'\\(').test(s)
                          &&!new RegExp('public static int '+n+'\\(').test(s));
  if(miss.length) no('Tuning 缺少 getter: '+miss.join(', '));
  else ok('Tuning 提供 '+need.length+' 个运行时 getter');
  if(/public static int reload\(\)/.test(s)) ok('Tuning 提供 reload()');
  else no('Tuning 缺少 reload()');
}

// 2) 关键类不许再把配置值缓存成 static final
const checks=[
  ['FishingSession.java','src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java',
   ['REEL_GAIN','RELEASE_LOSS','IDLE_LOSS','PULL_IDLE','WHITE_ZONE_RATIO','YELLOW_ZONE_RATIO','BASE_DRAIN_PER_TICK']],
  ['PartComposer.java','src/main/java/com/whitecobalt/anglertackle/fishing/PartComposer.java',
   ['W_LINE_ON_TENSION','CAP_TENSION_CEILING','CAP_STAMINA_DRAIN','BASE_TENSION_RECOVER']],
];
for(const [name,p,consts] of checks){
  const s=read(p);
  const cached=consts.filter(c=>new RegExp('static final double '+c+'\\s*=').test(s));
  if(cached.length) no(name+' 仍把配置值缓存成 static final: '+cached.join(', '));
  else ok(name+' 不再缓存调参常量');
}

// 3) 命令入口存在
//
// ⚠ 2026-10-11：`/atl` 的子指令改成统一走 `lit("…")`（权限只有一处真源，见 AGENTS.md §六）
//   ⇒ 判据要同时认 `lit("x")` 与老的 `literal("x")`，否则这条断言会因为**改名**而报假红。
const cmd=read('src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java');
const cmdHas=(name)=>new RegExp('(?:lit|literal)\\("'+name+'"').test(cmd);
if(cmdHas('config')&&cmdHas('reload')) ok('/atl config reload 命令存在');
else no('缺少 /atl config reload 命令');
if(cmdHas('list')) ok('/atl config list 命令存在');
else no('缺少 /atl config list 命令');

// 4) 一键入口
if(fs.existsSync(path.join(ROOT,'调参器.bat'))) ok('调参器.bat 存在（开发迭代入口）');
else no('缺少 调参器.bat');
const bat=fs.readFileSync(path.join(ROOT,'调参器.bat'),'utf8');
if(/^@echo off/.test(bat)) ok('调参器.bat 是批处理语法');
else no('调参器.bat 首行不是 @echo off（可能写成了别的语法）');
if(/[\r\n]\s*\$[A-Za-z]/.test(bat)) no('调参器.bat 里混进了 PowerShell 语法（$ 变量）');
else ok('调参器.bat 没有混入 PowerShell 语法');

console.log(bad===0?'\n✅ 调参迭代闭环完整（改数值 → 游戏内热重载）':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
