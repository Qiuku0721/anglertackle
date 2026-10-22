// 复现 ChumEntity 的抛投弹道。
//
// ⚠️ 发射角 = clamp(-视线俯仰, 0, 45)，**不是**直接用视线俯仰角。
//    原因见 ChumEntity.throwBy 的长注释：抛竿的约定是"抬头 = 远"
//    （低头 8m / 平视 16m / 抬头 24m），固定初速的抛物线必须反过来才能对齐。
//    这个脚本同时验证"抬头打得远、低头打得近"，就是当初写反的那条。
const MIN_AIR_TICKS=10, DRAG=0.99, G=0.03, SPEED=0.75;

function throwArc(pitchDeg, groundTop, waterTop){
  // 与 throwBy 完全一致的映射
  const launchDeg=Math.max(0.0,Math.min(45.0,-pitchDeg));
  const rad=launchDeg*Math.PI/180;
  let x=0,z=0;
  let y=groundTop+1.62-0.1;
  let vx=0, vy=Math.sin(rad)*SPEED, vz=Math.cos(rad)*SPEED;
  for(let t=1;t<=400;t++){
    x+=vx; y+=vy; z+=vz;
    vx*=DRAG; vy=vy*DRAG-G; vz*=DRAG;
    if(vy<=0 && t>=MIN_AIR_TICKS && y<=waterTop){
      return {t,horiz:Math.hypot(x,z),water:true};
    }
    if(y<waterTop-30) return {t,horiz:Math.hypot(x,z),water:false};
  }
  return {t:0,horiz:0,water:false};
}

console.log('场景：岸边地面 y=63，水面顶面 63');
console.log('视线      发射角   滞空   水平距离   与抛竿对照');
// MC 约定：xRot(pitch) **向下为正**。所以 pitch<0 = 抬头，pitch>0 = 低头。
const rodMap={'-30':'抬头 → 24m 档','-20':'抬头','-10':'略抬头','0':'平视 → 16m 档',
              '10':'略低头','20':'低头','30':'低头 → 8m 档','45':'低头看水面'};
let prev=-1, monotonic=true;
// 从"最抬头"到"最低头"遍历：抬头远、低头近，所以距离应当**单调不增**。
for(const pitch of [-30,-20,-10,0,10,20,30,45]){
  const r=throwArc(pitch,63,63);
  const key=String(pitch);
  console.log(String(pitch).padStart(5)+'°   '
    +String(Math.max(0,Math.min(45,-pitch))).padStart(5)+'°   '
    +String(r.t).padStart(4)+'   '+r.horiz.toFixed(1).padStart(8)+'   '
    +(rodMap[key]||''));
  if(prev>=0 && r.horiz>prev+0.01) monotonic=false;   // 越低头反而越远 = 写反了
  prev=r.horiz;
}
console.log();
console.log(monotonic
  ? '✅ 抬得越高 → 打得越远（与抛竿"抬头=远"一致）'
  : '❌ 单调性不对：低头反而更远（就是写反的那个 bug）');
process.exit(monotonic?0:1);
