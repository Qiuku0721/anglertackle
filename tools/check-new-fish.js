const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 汇总当前所有鱼种：竿型 / 档位 / 是否红档，并校验几条硬规则：
//   1) 台钓（FLOAT/BOTH）的红鱼里必须有蓝宝石雷龙，且只有用户点名的两种
//      〔2026-10-01 修订〕原来写的是"能且仅能出一种红鱼 = 蓝宝石雷龙"。
//      第三批 5 种里用户逐条点名"孔雀鱼 = 金~红 + 台钓"，这条"有且仅有"被用户推翻。
//      现在断言：①蓝宝石雷龙仍在；②除用户点名的两种外没有别的台钓红鱼。
//   2) 每种鱼的 tiers 必须升序去重，且都在 0..5
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const src=fs.readFileSync(path.join(ROOT,'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java'),'utf8');
// 档位数组定义
const arrDefs={};
for(const m of src.matchAll(/private static final int\[\] ([A-Z_]+) = \{([^}]*)\};/g)){
  arrDefs[m[1]]=m[2].split(',').map(s=>parseInt(s.trim(),10));
}
const re=/new FishSpecies\("([a-z_]+)",\s*ModItems\.([A-Z_]+),\s*([\d.]+),\s*([\d.]+),\s*([A-Z_]+),\s*(steady|sluggish|burst|erratic|FightProfile\.CRUCIAN_CARP)\(?([^)]*)\)?,\s*RodKind\.([A-Z]+)/g;
const rows=[];
for(const m of src.matchAll(re)){
  const tiers=arrDefs[m[5]];
  if(!tiers){console.log('⚠ 未知档位数组 '+m[5]+' @'+m[1]);continue;}
  rows.push({id:m[1],minKg:+m[3],maxKg:+m[4],tiers,kind:m[8],prof:m[6]});
}
console.log('id'.padEnd(20)+'竿型'.padEnd(7)+'档位'.padEnd(14)+'重量(kg)'.padEnd(16)+'策略');
for(const r of rows){
  console.log(r.id.padEnd(20)+r.kind.padEnd(7)+('['+r.tiers.join(',')+']').padEnd(14)
    +(r.minKg+'~'+r.maxKg).padEnd(16)+r.prof);
}
console.log('\n共 '+rows.length+' 种');
// 规则 1
const floatRed=rows.filter(r=>(r.kind==='FLOAT'||r.kind==='BOTH')&&r.tiers.includes(5));
console.log('\n台钓/BOTH 里的红档鱼: '+(floatRed.length?floatRed.map(r=>r.id).join(', '):'(无)'));
// 用户 2026-10-08 批准 docs/33 §9.2 那份名单后，白名单多了**北极红点鲑**
// （策划案里它是"高寒湖 · 通用竿 · 金~红"，而 G_R 里含红档 5）。
// 断言本身不变：白名单**之外**的红档台钓鱼一律报错 —— 名单是用户点名的，
// 不是"谁会红就放谁进来"。
const FLOAT_RED_ALLOWED=['sapphire_snakehead','guppy','arctic_char','giant_siamese_carp'];
const hasSnakehead=floatRed.some(r=>r.id==='sapphire_snakehead');
const strayRed=floatRed.filter(r=>!FLOAT_RED_ALLOWED.includes(r.id)).map(r=>r.id);
const ok1=hasSnakehead&&strayRed.length===0;
console.log(ok1
  ?'✅ 规则1：蓝宝石雷龙仍是台钓红鱼，且没有用户点名之外的红档台钓鱼'
  :'❌ 规则1 被破坏'+(hasSnakehead?'':'（蓝宝石雷龙被挤出台钓红鱼！）')
    +(strayRed.length?'（多出未点名的红档台钓鱼：'+strayRed.join(', ')+'）':''));
// 规则 2
let ok2=true;
for(const r of rows){
  const t=r.tiers;
  for(let i=1;i<t.length;i++) if(t[i]<=t[i-1]){ok2=false;console.log('❌ '+r.id+' tiers 非升序: '+t);}
  for(const v of t) if(v<0||v>5){ok2=false;console.log('❌ '+r.id+' tier 越界: '+v);}
}
console.log(ok2?'✅ 规则2：所有 tiers 升序去重且在 0..5':'❌ 规则2 被破坏');
// 新增 6 种必须全部 LURE
const need=['tigerfish','pike','brown_trout','mirror_carp','striped_bass','arapaima'];
const bad=need.filter(id=>{const r=rows.find(x=>x.id===id);return !r||r.kind!=='LURE';});
console.log(bad.length===0?'✅ 第二批 6 种全部为 LURE':'❌ 非 LURE: '+bad.join(', '));
// 第三批 5 种（用户 2026-10-01）：4 台钓 + 1 路亚，竿型与档位逐条点名
const third=[['african_butterflyfish','FLOAT',[3,4]],['north_african_catfish','LURE',[3,4]],
  ['jewel_cichlid','FLOAT',[3,4]],['guppy','FLOAT',[4,5]],['elephantnose','FLOAT',[3,4]]];
const bad3=third.filter(([id,kind,tiers])=>{
  const r=rows.find(x=>x.id===id);
  return !r||r.kind!==kind||JSON.stringify(r.tiers)!==JSON.stringify(tiers);
}).map(([id])=>id);
console.log(bad3.length===0
  ?'✅ 第三批 5 种竿型与档位都符合用户指定（4 台钓 + 1 路亚；紫~金=3,4 / 金~红=4,5）'
  :'❌ 第三批竿型/档位不符: '+bad3.join(', '));
// 第四批 2 种（用户 2026-10-02）：都是**洞穴专属台钓鱼**、**蓝~紫档**。
//
// 用户原话："金泥鳅 / 蓝，紫 / 盲鱼 / 蓝，紫 / 洞穴鱼，台钓"
// 为什么要加这两条：洞穴水域原本只有横纹鱼[0,1]、长吻象鼻鱼[3,4]、蓝宝石雷龙鱼[5]，
// **中间蓝紫档是空的** —— 玩家带秘制窝（咬钩下限抬到 2）时横纹鱼被下限挡掉，
// 池子只剩两种、且两种都是金红鱼种，"饵料把金红占比控制在 3%~10%"那条规则
// 因为"没有非金红鱼可稀释"整段跳过，体感就是"几竿三条雷龙"。
const fourth=[['golden_loach','FLOAT',[2,3]],['cave_blindfish','FLOAT',[2,3]]];
const bad4=fourth.filter(([id,kind,tiers])=>{
  const r=rows.find(x=>x.id===id);
  return !r||r.kind!==kind||JSON.stringify(r.tiers)!==JSON.stringify(tiers);
}).map(([id])=>id);
console.log(bad4.length===0
  ?'✅ 第四批 2 种竿型与档位都符合用户指定（仅台钓；蓝~紫=2,3）'
  :'❌ 第四批竿型/档位不符: '+bad4.join(', '));
// 第 1 批：冷水 5 条（用户 2026-10-08 批准 docs/33 §9.2 那份名单）。
// 档位口径 0 起算：紫~金 = [3,4]、金~红 = [4,5]、蓝~紫 = [2,3]、绿~蓝 = [1,2]。
const coldWater=[['arctic_char','BOTH',[4,5]],['whitefish','FLOAT',[1,2,3]],
  ['rainbow_trout','LURE',[3,4,5]],['burbot','FLOAT',[1,2,3]],['taimen','LURE',[4,5]]];
const bad5=coldWater.filter(([id,kind,tiers])=>{
  const r=rows.find(x=>x.id===id);
  return !r||r.kind!==kind||JSON.stringify(r.tiers)!==JSON.stringify(tiers);
}).map(([id])=>id);
console.log(bad5.length===0
  ?'✅ 第 1 批冷水 5 条竿型与档位都符合策划案（高寒湖 2 + 冷水溪流 3）'
  :'❌ 第 1 批竿型/档位不符: '+bad5.join(', '));
// 第 3 批：极地 9 条（用户 2026-10-08）。冰鱼明确不做 ✓ 不在名单里。
// ⚠ 本批**刻意不给台钓再添红鱼**：台钓/通用的最高档只到金（P_G = [3,4]），
//   红档（含 5）只有两条路亚鱼（格陵兰大比目鱼 / 格陵兰鲨）。
//   所以上面那张 FLOAT_RED_ALLOWED 白名单**不需要动** ✓ —— 动了就说明有人加了台钓红鱼。
const polar=[['arctic_cod','FLOAT',[1,2]],['capelin','FLOAT',[0,1]],
  ['atlantic_herring','FLOAT',[2,3]],['wolffish','FLOAT',[3,4]],
  ['redfish','LURE',[4,5]],['sablefish','LURE',[2,3,4]],['atlantic_cod','BOTH',[3,4]],
  ['greenland_halibut','LURE',[3,4]],['greenland_shark','LURE',[4,5]]];
const bad6=polar.filter(([id,kind,tiers])=>{
  const r=rows.find(x=>x.id===id);
  return !r||r.kind!==kind||JSON.stringify(r.tiers)!==JSON.stringify(tiers);
}).map(([id])=>id);
console.log(bad6.length===0
  ?'✅ 第 3 批极地 9 条竿型与档位都符合策划案（台钓 4 + 路亚 4 + 通用 1；冰鱼不在其中）'
  :'❌ 第 3 批竿型/档位不符: '+bad6.join(', '));
// 第 4 批：远洋 5 条（用户 2026-10-08 逐条定档）。
// 档位是用户对着"建议/备选"两列逐条点的：旗鱼不变(金红) / 鲯鳅取备选(金红) /
// 鳄雀鳝**紫金红** / 巨暹罗鲤不变(金红) / 电鳗不变(紫金)。
const pelagic=[['sailfish','LURE',[4,5]],['mahi_mahi','LURE',[4,5]],
  ['alligator_gar','LURE',[3,4,5]],['giant_siamese_carp','FLOAT',[4,5]],
  ['electric_eel','LURE',[3,4]]];
const bad7=pelagic.filter(([id,kind,tiers])=>{
  const r=rows.find(x=>x.id===id);
  return !r||r.kind!==kind||JSON.stringify(r.tiers)!==JSON.stringify(tiers);
}).map(([id])=>id);
console.log(bad7.length===0
  ?'✅ 第 4 批远洋 5 条竿型与档位都符合用户 2026-10-08 的定案（旗鱼/鲯鳅/巨暹罗鲤 金红、鳄雀鳝 紫金红、电鳗 紫金）'
  :'❌ 第 4 批竿型/档位不符: '+bad7.join(', '));
process.exit((ok1&&ok2&&bad.length===0&&bad3.length===0&&bad4.length===0&&bad5.length===0
  &&bad6.length===0&&bad7.length===0)?0:1);
