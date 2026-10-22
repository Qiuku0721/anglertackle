// 复现 rollIndividualOnce 的体重分布，统计**实际**品质档占比，
// 与 baseWeightByTier(){40,26,16,12,12,6} 的"标称"占比对比。
// tierSplit(): tier5->2, tier4->5, 其他->6
function tierSplit(tiers){return tiers.map(t=>t===5?2:(t===4?5:6));}
function tierForWeight(minKg,maxKg,tiers,weightKg){
  const n=tiers.length, split=tierSplit(tiers);
  let total=0; for(const w of split) total+=w;
  const span=Math.max(1e-6,maxKg-minKg);
  const ratio=Math.max(0,Math.min(0.9999999,(weightKg-minKg)/span));
  const target=ratio*total;
  let cum=0;
  for(let i=0;i<n;i++){cum+=split[i];if(target<cum-1e-9)return tiers[i];}
  return tiers[n-1];
}
// Java 的 Math.max(random.nextDouble(), random.nextDouble()*0.85)
function rollWeight(minKg,maxKg,rnd){
  const raw=Math.max(rnd(),rnd()*0.85);
  const sizeFactor=0.35+raw*0.65;
  let weight=minKg+(maxKg-minKg)*Math.pow(sizeFactor,3.0);
  return Math.round(weight*100)/100;
}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// 各鱼种 [id, tiers, minKg, maxKg]
const SPECIES=[
  ['crucian_carp',[0,1],0.1,1.8],['tilapia',[0,1],0.15,1.2],['mullet',[1,2],0.3,2.5],
  ['grass_carp',[1,2],1.0,15.0],['black_carp',[1,2,3],2.0,25.0],['topmouth_culter',[2,3],0.3,4.0],
  ['zander',[1,2,3],0.5,8.0],['atlantic_salmon',[4,5],2.0,25.0],['bluefin_tuna',[4,5],30.0,400.0],
  ['juvenile_shark',[4,5],5.0,60.0],['banded_loach',[0,1],0.003,0.03],['hemiculter',[0,1],0.02,0.232],
  ['platinum_arowana',[4,5],1.5,6.0],['sapphire_snakehead',[5],0.15,0.35],['oxeye_tarpon',[5],0.5,18.0],
];
const N=400000;
console.log('鱼种'.padEnd(20)+'标称(档0..5)'.padEnd(30)+'实际(档0..5)');
const agg=new Array(6).fill(0); let aggN=0;
for(const [id,tiers,minKg,maxKg] of SPECIES){
  const rnd=mulberry32(12345);
  const cnt=new Array(6).fill(0);
  for(let i=0;i<N;i++){
    const w=rollWeight(minKg,maxKg,rnd);
    cnt[tierForWeight(minKg,maxKg,tiers,w)]++;
  }
  // 标称：tierSplit 权重
  const split=tierSplit(tiers); let tot=0; for(const s of split) tot+=s;
  const nominal=new Array(6).fill(0);
  tiers.forEach((t,i)=>{nominal[t]+=split[i]/tot;});
  for(let t=0;t<6;t++){agg[t]+=cnt[t];aggN+=cnt[t];}
  const f=(arr)=>arr.map(v=>(v*100).toFixed(1).padStart(5)).join(' ');
  console.log(id.padEnd(20)+f(nominal).padEnd(30)+f(cnt.map(c=>c/N)));
}
console.log();
console.log('全部鱼种合计实际分布: '+agg.map((v,i)=>'档'+i+'='+(v/aggN*100).toFixed(1)+'%').join('  '));
console.log('标称 baseWeightByTier {40,26,16,12,12,6} => 档0=40% 档1=26% 档2=16% 档3=12% 档4=12% 档5=6%');
