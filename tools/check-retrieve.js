const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿// 锁定"提前收回不会再抛一杆"这条修复。
//
// 背景：服务端在 use() 里收回时会调 stopUsingItem()，客户端随之把
// "正在使用物品"从 true 翻成 false —— 而客户端的松手检测正是靠这个下降沿
// （ClientEvents 里的 wasUsingItem && !usingNow），于是同一次右键
// 又发了一个 CastPayload，表现为"收回的瞬间又抛了一杆"。
//
// 修复由三块组成，缺一不可，这里逐条静态校验：
//   1) 客户端的松手下降沿必须带"已有会话就不抛"的守卫
//   2) 提前收回改走输入包的 BIT_RETRIEVE，不再在 RodItem.use() 里做
//   3) 客户端的右键边沿采样必须早于 inSession() 判断
const fs=require('fs'),path=require('path');
// 玩法数值现在住在配置文件里（[gameplay] 组），源码里没有对应常量了。
// 统一从 tools/tuning.js 的 cfg 取"游戏里实际生效的默认值"。
const __gameplayCfg = require('./tuning.js').cfg;
function __gameplay(key, fallback) {
  if (key in __gameplayCfg) return __gameplayCfg[key];
  throw new Error('配置里没有 ' + key + ' —— 检查 Config.java 的 [gameplay] 组');
}

const ROOT=ATL_ROOT;
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8')
  .replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');

let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

// 1) ClientEvents 的下降沿守卫
{
  const s=read('src/main/java/com/whitecobalt/anglertackle/client/ClientEvents.java');
  const i=s.indexOf('wasUsingItem && !usingNow');
  if(i<0) no('ClientEvents 找不到松手下降沿');
  else{
    const seg=s.slice(i,i+600);
    if(/inSession\(\)/.test(seg)) ok('ClientEvents 松手下降沿有 inSession 守卫');
    else no('ClientEvents 松手下降沿没有守卫（会重复抛竿）');
    if(/sendToServer\(new CastPayload/.test(seg)) ok('ClientEvents 仍在守卫之后才发 CastPayload');
    else no('ClientEvents 找不到 CastPayload 发送');
  }
}

// 2) RodItem.use() 里不该再有 retrieveEarly
{
  const s=read('src/main/java/com/whitecobalt/anglertackle/item/RodItem.java');
  if(/retrieveEarly/.test(s)) no('RodItem.use() 里仍在调 retrieveEarly（会触发下降沿）');
  else ok('RodItem.use() 不再处理提前收回');
}

// 3) 输入包有 BIT_RETRIEVE 且服务端处理它
{
  const p=read('src/main/java/com/whitecobalt/anglertackle/network/FishingInputPayload.java');
  if(/BIT_RETRIEVE/.test(p)&&/retrieveRequested/.test(p)) ok('FishingInputPayload 有 BIT_RETRIEVE');
  else no('FishingInputPayload 缺少提前收回位');
  const n=read('src/main/java/com/whitecobalt/anglertackle/network/ModNetwork.java');
  if(/retrieveRequested\(\)/.test(n)&&/retrieveEarly\(\)/.test(n)) ok('ModNetwork 收到请求后调 retrieveEarly');
  else no('ModNetwork 没处理提前收回请求');
}

// 4) 客户端边沿采样必须早于 inSession 判断
{
  const s=read('src/main/java/com/whitecobalt/anglertackle/client/ClientFishingState.java');
  const m=s.match(/public void sendInput\(Minecraft mc\)\s*\{([\s\S]*?)LocalPlayer player = mc\.player;/);
  if(!m) no('找不到 sendInput 主体');
  else{
    const head=m[1];
    if(/prevRightDown = rightDownNow/.test(head)) ok('右键边沿采样在 inSession 之前');
    else no('右键边沿采样被 inSession 挡住（收回请求发不出去）');
  }
}

console.log(bad===0?'\n✅ 提前收回不会再重复抛竿':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
