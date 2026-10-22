const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 校验"接上 config"没有改动任何默认手感。
//
// 做法：把 Config.java 里每个配置项的**默认值**抽出来，
// 与代码里原本的硬编码值逐一比对。任何一项不等，就说明接线时
// 静默改了平衡（这个风险很实在：config 是早期设计稿，代码是后来调过的）。
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const cfg=fs.readFileSync(path.join(ROOT,'src/main/java/com/whitecobalt/anglertackle/Config.java'),'utf8');

// 抽出 defineInRange("name", default, min, max) 与 define("name", bool)
const defaults={};
let m;
const reNum=new RegExp('(\\w+)\\s*=\\s*b\\s*\\.comment\\([\\s\\S]*?\\)\\s*\\.defineInRange\\("([^"]+)",\\s*([0-9.]+)D?\\s*,','g');
while((m=reNum.exec(cfg))) defaults[m[2]]=parseFloat(m[3]);
const reBool=new RegExp('(\\w+)\\s*=\\s*b\\s*\\.comment\\([\\s\\S]*?\\)\\s*\\.define\\("([^"]+)",\\s*(true|false)\\)','g');
while((m=reBool.exec(cfg))) defaults[m[2]]=m[3]==='true';

// 代码里原本的硬编码值（接线前的实际生效值）
const EXPECT={
  // 张力
  reelGain:0.9, releaseLoss:1.6, idleLoss:0.35,
  whiteMax:55.0, yellowMax:82.0, criticalFlash:98.0, baseRecover:1.6,
  // 提竿窗口（用户定案 2.0 秒）
  base:2.0, min:1.0,
  // 咬钩等待
  //
  // ⚠ 2026-09-30 **有意**改动：2/6/20 → 10/14/30。这不是静默漂移。
  //   用户定案原话："反映上鱼过快，我这边建议没打窝前上鱼速度是 10 到 24 秒，
  //   打窝后是 6 到 12 秒。"
  //   实际等待 = min + rand×max → 10 + rand×14 = 10~24 秒。
  //   打窝后由 FishingSession.CHUM_WAIT_* 把区间**整体换成** 6~12，
  //   而不是乘倍率 —— 10→6 是 0.6 倍、24→12 是 0.5 倍，没有单个倍率能同时对上两端。
  //   硬上限必须跟着抬到 30：留在 20 会把 24 秒的上界直接砍掉，新的上界永远出不来。
  //
  //   改这几个数**必须同时改这里**，否则本脚本会拦下来 —— 这正是它存在的意义
  //   （它的职责就是"默认值不许悄悄变"，有意变更就得显式登记一次）。
  minWaitSeconds:10.0, maxWaitSeconds:14.0, hardCapSeconds:30.0,
  // 配件合成
  lineOnTension:0.60, rodOnTension:0.40,
  lineOnRecover:0.60, rodOnRecover:0.40,
  reelOnDrain:0.60, rodOnDrain:0.40,
  capTensionCeiling:3.00, capTensionRecover:2.20, capStaminaDrain:2.60,
  capPull:2.30, capDamping:2.70,
  pullIdleBase:0.15, pullStruggleBase:0.35, staminaDrainBase:0.20,
  // 窝料（serverCap = 全服同时存在的窝料上限，用户 2026-10-11 定案 40）
  particleIntervalTicks:6, particlesPerBurst:6, radius:10.0, serverCap:40,
  // 耐久
  rodPerBite:2, linePerBite:1, lurePerBite:1,
};
let bad=0;
console.log('配置项'.padEnd(26)+'代码原值'.padEnd(12)+'config 默认'.padEnd(13)+'判定');
for(const [k,want] of Object.entries(EXPECT)){
  const got=defaults[k];
  if(got===undefined){ console.log(k.padEnd(26)+String(want).padEnd(12)+'(缺失)'.padEnd(13)+'❌ 配置项没找到'); bad++; continue;}
  const ok=Math.abs(got-want)<1e-9;
  if(!ok) bad++;
  console.log(k.padEnd(26)+String(want).padEnd(12)+String(got).padEnd(13)+(ok?'✅':'❌ 不等'));
}
console.log();
console.log(bad===0
  ? '✅ 全部一致 —— 接线后默认手感与之前完全相同'
  : '❌ 有 '+bad+' 项不等，接线静默改了平衡');
process.exit(bad?1:0);
