const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿// 锁定"扣耐久必须组件先改、鱼竿后改、最后统一同步"这个顺序。
//
// 背景：曾经写成「先 hurtAndBreak（会立刻广播）→ 再改配件组件」，
// 广播带的是旧组件，服务端改了客户端不知道。玩家反馈：
// "上鱼后耐久确实会消耗，但打开背包又回满了"——开容器时服务端重推权威状态，
// 客户端的本地预测被覆盖回去。
//
// 这里做静态检查：
//   1) applyBiteDurabilityCost / refundBiteDurabilityCost 里不许再出现 hurtAndBreak
//   2) 两个方法里 RodParts 的 set 必须出现在鱼竿 setDamageValue 之前
//   3) 两个方法都必须调用 syncHeldItem()
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const file=path.join(ROOT,'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java');
let src=fs.readFileSync(file,'utf8');
// 去掉注释，避免匹配到历史注释里的旧代码
src=src.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');

function body(name){
  const m=src.match(new RegExp('private void '+name+'\\(\\)\\s*\\{([\\s\\S]*?)\\n    \\}'));
  if(!m){console.log('❌ 找不到方法 '+name);return null;}
  return m[1];
}
let bad=0;
for(const name of ['applyBiteDurabilityCost','refundBiteDurabilityCost']){
  const b=body(name);
  if(!b){bad++;continue;}
  // 1) 不许有 hurtAndBreak
  if(/hurtAndBreak/.test(b)){console.log('❌ '+name+' 里仍在使用 hurtAndBreak（会中途广播旧组件）');bad++;}
  else console.log('✅ '+name+'：没有 hurtAndBreak');
  // 2) 组件 set 必须在鱼竿 setDamageValue 之前
  const iParts=b.indexOf('ROD_PARTS.get(), next');
  const iRod=b.indexOf('rod.setDamageValue');
  if(iParts<0){console.log('❌ '+name+'：找不到配件组件写入');bad++;}
  else if(iRod<0){console.log('❌ '+name+'：找不到鱼竿耐久写入');bad++;}
  else if(iParts>iRod){console.log('❌ '+name+'：配件写入在鱼竿之后（顺序反了）');bad++;}
  else console.log('✅ '+name+'：配件先改，鱼竿后改');
  // 3) 必须同步
  if(!/syncHeldItem\(\)/.test(b)){console.log('❌ '+name+'：没有调用 syncHeldItem()');bad++;}
  else console.log('✅ '+name+'：调用了 syncHeldItem()');
}
// 鱼竿本体必须走 setDamageValue（而不是 hurtAndBreak）
const ab=body('applyBiteDurabilityCost')||'';
if(/setDamageValue/.test(ab)) console.log('✅ 鱼竿用 setDamageValue 直接扣点');
else {console.log('❌ 鱼竿没有用 setDamageValue');bad++;}

console.log(bad===0?'\n✅ 扣耐久顺序正确（组件→鱼竿→同步）':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
