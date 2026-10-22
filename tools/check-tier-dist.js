// 校验 FishSpecies.rollIndividualOnce 的档位分布与体重合法性。
//
// 背景：旧实现"先摇体重、再看它落哪档"，体重却是三次方压向小值的偏态分布，
// 档位边界又是线性体重区间 —— 两者错配，红鱼实际爆率是标称 3 倍、紫鱼只有一半
// （玩家反馈"金钓不上、红反而多"）。新实现先按标称权重抽档，再在该档体重区间内取体重。
//
// 本脚本是 FishSpecies 相关方法的忠实移植，两边必须同步改。
function tierSplit(tiers){return tiers.map(t=>t===5?2:(t===4?5:6));}
function splitTotal(tiers){let t=0;for(const s of tierSplit(tiers))t+=s;return t;}
function weightWindowForTier(minKg,maxKg,tiers,wantTier){
  const n=tiers.length, split=tierSplit(tiers), total=splitTotal(tiers);
  const span=Math.max(1e-6,maxKg-minKg);
  if(total<=0){
    let idx=0;for(let i=0;i<n;i++)if(tiers[i]===wantTier){idx=i;break;}
    return [minKg+span*idx/n, minKg+span*(idx+1)/n];
  }
  let cum=0;
  for(let i=0;i<n;i++){
    const from=cum;cum+=split[i];
    if(tiers[i]===wantTier)return [minKg+span*(from/total), minKg+span*(cum/total)];
  }
  return [minKg,maxKg];
}
function rollTier(tiers,rndInt){
  const split=tierSplit(tiers), total=splitTotal(tiers);
  if(total<=0)return tiers[Math.min(tiers.length-1,rndInt(tiers.length))];
  const pick=rndInt(total);let cum=0;
  for(let i=0;i<tiers.length;i++){cum+=split[i];if(pick<cum)return tiers[i];}
  return tiers[tiers.length-1];
}
function tierForWeight(minKg,maxKg,tiers,weightKg){
  const n=tiers.length, split=tierSplit(tiers), total=splitTotal(tiers);
  const span=Math.max(1e-6,maxKg-minKg);
  if(total<=0){
    const r=(weightKg-minKg)/span;
    return tiers[Math.max(0,Math.min(n-1,Math.floor(r*n+1e-9)))];
  }
  const ratio=Math.max(0,Math.min(0.9999999,(weightKg-minKg)/span));
  const target=ratio*total;let cum=0;
  for(let i=0;i<n;i++){cum+=split[i];if(target<cum-1e-9)return tiers[i];}
  return tiers[n-1];
}
function snapToTierGrid(minKg,maxKg,tiers,weight,tier,win){
  const step=100;
  const lo=Math.ceil(win[0]*step-1e-9), hi=Math.floor(win[1]*step+1e-9);
  const want=Math.round(weight*step);
  for(let d=0;d<=Math.max(1,hi-lo+1);d++){
    for(const s of [-1,1]){
      const c=want+s*d;
      if(c<lo||c>hi)continue;
      const v=c/step;
      if(tierForWeight(minKg,maxKg,tiers,v)===tier)return v;
    }
  }
  const v=Math.min(Math.max(weight,win[0]),win[1]);
  return Math.round(v*step)/step;
}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function roll(minKg,maxKg,tiers,rnd){
  const tier=rollTier(tiers,function(n){return Math.floor(rnd()*n);});
  const win=weightWindowForTier(minKg,maxKg,tiers,tier);
  const raw=Math.max(rnd(),rnd()*0.85);
  const w=0.35+raw*0.65;
  let weight=win[0]+(win[1]-win[0])*(w*w*w);
  weight=snapToTierGrid(minKg,maxKg,tiers,weight,tier,win);
  return {weight,tier};
}
const SPECIES=[
  ['crucian_carp',[0,1],0.1,1.8],['tilapia',[0,1],0.15,1.2],['mullet',[1,2],0.3,2.5],
  ['grass_carp',[1,2],1.0,15.0],['black_carp',[1,2,3],2.0,25.0],['topmouth_culter',[2,3],0.3,4.0],
  ['zander',[1,2,3],0.5,8.0],['atlantic_salmon',[4,5],2.0,25.0],['bluefin_tuna',[4,5],30.0,400.0],
  ['juvenile_shark',[4,5],5.0,60.0],['banded_loach',[0,1],0.003,0.03],['hemiculter',[0,1],0.02,0.232],
  ['platinum_arowana',[4,5],1.5,6.0],['sapphire_snakehead',[5],0.15,0.35],['oxeye_tarpon',[5],0.5,18.0],
];
const N=400000;
let bad=0, badRange=0;
console.log('鱼种'.padEnd(20)+'标称(档0..5)'.padEnd(32)+'实际(档0..5)'.padEnd(32)+'判定');
for(const [id,tiers,minKg,maxKg] of SPECIES){
  const rnd=mulberry32(12345);
  const cnt=new Array(6).fill(0);
  let mismatch=0, outOfRange=0;
  for(let i=0;i<N;i++){
    const r=roll(minKg,maxKg,tiers,rnd);
    cnt[r.tier]++;
    if(tierForWeight(minKg,maxKg,tiers,r.weight)!==r.tier)mismatch++;
    if(r.weight<minKg||r.weight>maxKg)outOfRange++;
  }
  const split=tierSplit(tiers), tot=splitTotal(tiers);
  const nominal=new Array(6).fill(0);
  tiers.forEach((t,i)=>{nominal[t]+=split[i]/tot;});
  const f=(arr)=>arr.map(v=>(v*100).toFixed(1).padStart(5)).join(' ');
  const ok=(mismatch===0&&outOfRange===0);
  if(!ok)bad++;
  if(outOfRange)badRange++;
  console.log(id.padEnd(20)+f(nominal).padEnd(32)+f(cnt.map(c=>c/N)).padEnd(32)
    +(ok?'一致':('✗ 跨档'+mismatch+' 越界'+outOfRange)));
}
console.log();
console.log(bad===0
  ?'✅ 全部鱼种：档位分布 = 标称分布，取出的体重既不跨档也不越界'
  :'❌ '+bad+' 个鱼种有问题（越界 '+badRange+'）');
process.exit(bad?1:0);
