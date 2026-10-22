const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 打窝链路检查。
//
// 背景：ChumManager.findChumAt() 早就写好了，但**从来没有任何地方调用** ——
// 打窝除了冒泡之外毫无作用。玩家反馈"打窝前后不知道有没有效果"，
// 根因不是视觉，是这个功能压根没接上。
// 所以这里必须逐段确认整条链路存在，而不是只看有没有那个方法。
const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8')
  .replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
const has=(p,re)=>re.test(read(p));

let bad=0;
const ok=m=>console.log('✅ '+m);
const no=m=>{console.log('❌ '+m);bad++;};

const CM='src/main/java/com/whitecobalt/anglertackle/fishing/ChumManager.java';
const CI='src/main/java/com/whitecobalt/anglertackle/item/ChumItem.java';
const CE='src/main/java/com/whitecobalt/anglertackle/entity/ChumEntity.java';
const FS='src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java';
const CR='src/main/java/com/whitecobalt/anglertackle/client/render/ChumRenderer.java';
const ME='src/main/java/com/whitecobalt/anglertackle/registry/ModEntities.java';
const CS='src/main/java/com/whitecobalt/anglertackle/client/ClientSetup.java';

// 1) 半径必须**现读配置**，而且不能是 static 常量。
//
// 这条断言在 2026-09-30 之后改过。原先写的是"必须有 public static final double RADIUS"——
// 那正是启动崩溃的写法：`static final` 在类初始化时求值，一旦 ChumManager 在配置加载前
// 被碰到就 `IllegalStateException: Cannot get config value before config is loaded.`。
// 所以现在断言的是相反的东西：**不许有静态常量，必须是走 Tuning 的方法**。
{
  const s=read(CM);
  if(/static\s+final\s+double\s+RADIUS/.test(s)) {
    no('ChumManager 又把半径写回 static 常量了 —— 那是潜伏的启动崩溃（见 RodItem$RodSpec 那次）');
  } else ok('ChumManager 没有把半径存成 static 常量');

  const hasMethod=/public static double radius\(\)/.test(s);
  const viaTuning=/public static double radius\(\)[\s\S]{0,160}?Tuning\.chumRadius\(\)/.test(s);
  if(!hasMethod) no('ChumManager 没有 public static double radius()');
  else if(!viaTuning) no('radius() 没有走 Tuning.chumRadius()（改配置不生效 / 或又读了 Config.INSTANCE）');
  else ok('radius() 每次现读 Tuning.chumRadius()（改完 /atl config reload 即生效）');

  // Tuning 侧必须真的有这个 getter，否则上面那条只是"看起来走对了"
  const t=read('src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java');
  if(/public static double chumRadius\(\)/.test(t) && /cfg\(\)\.chumRadius\.get\(\)/.test(t)) {
    ok('Tuning.chumRadius() 存在且读的是 [chum] radius');
  } else no('Tuning 里没有 chumRadius() getter');
}

// 2) 白圈必须读同一个来源（不能各写一份）
if(has(CR,/ChumManager\.radius\(\)/)) ok('渲染器读 ChumManager.radius()（圈与生效范围同源）');
else no('渲染器没读 ChumManager.radius()（半径会漂移）');
if(has(CR,/ChumManager\.RADIUS/)) no('渲染器还引用着已经删掉的 ChumManager.RADIUS（编译不过）');
else ok('渲染器没有残留 ChumManager.RADIUS 引用');

// 3) 右键抛出实体，而不是传送到水面
if(has(CI,/new .*ChumEntity|ChumEntity\(/)) ok('ChumItem 抛出 ChumEntity');
else no('ChumItem 没有抛出实体');
if(has(CI,/addFreshEntity/)) ok('ChumItem 把实体加进世界');
else no('ChumItem 没有 addFreshEntity');
if(has(CI,/findWaterSurface/)) no('ChumItem 还留着旧的"传送到水面"代码');
else ok('旧的 findWaterSurface 已删除');

// 4) 实体注册 + 渲染器注册
if(has(ME,/CHUM\b/)&&/register\("chum"/.test(read(ME))) ok('ModEntities 注册了 chum');
else no('ModEntities 没注册 chum');
if(has(CS,/ModEntities\.CHUM\.get\(\)/)) ok('ClientSetup 注册了 ChumRenderer');
else no('ClientSetup 没有注册 ChumRenderer');

// 5) 实体：落水 + 寿命 + 粒子
if(has(CE,/DATA_LANDED/)&&has(CE,/isLanded/)) ok('实体有落水状态');
else no('实体缺少落水状态');
if(has(CE,/DATA_LIFE/)&&has(CE,/discard\(\)/)) ok('实体有寿命并会自行消亡');
else no('实体没有寿命');
if(has(CE,/PARTICLE|ParticleTypes/)) ok('实体有粒子表现');
else no('实体没有粒子');

// 6) ★ 关键：加成必须真的被调用（这就是当初漏掉的一环）
if(has(FS,/ChumManager\.get\(\)\.findChumAt/)) ok('FishingSession 调用了 findChumAt（加成已接线）');
else no('FishingSession 没有调用 findChumAt —— 打窝仍然不生效');
if(has(FS,/chumBoost|timeMultiplier/)) ok('加成读取了窝子的 timeMultiplier');
else no('加成没有读取 timeMultiplier');

// 7) ★★ 同水体/同圈**共享**（用户 2026-10-11 定案 4 前半）：加成判定只看**落点**，
//    不许看"这条窝子是谁打的"。
//
//    为什么值得单独守：ChumEntity 里确实存着 ownerUuid（"自己的窝子"提示用）——
//    顺手在筛选谓词里加一句 `&& e.ownerUuid().equals(player.getUUID())` 极其自然，
//    而那会把共享悄悄改回独享：**不崩、不报错**，只是别人站进白圈里没有加成 ✗。
{
  const cm=read(CM);
  if(/owner/i.test(cm)) {
    no('ChumManager 里出现了 owner —— 窝子加成是按**落点**判的，不是按"谁打的"'
      +'（用户定案："同一水体所有人共享"；一旦按主人过滤就变回独享，而且不报错）');
  } else ok('加成判定不看主人（findChumAt/chumsNear 里没有 owner）');

  const fsSrc=read(FS);
  const callRe=/findChumAt\(([^)]*)\)/g;
  let m=null, calls=0, withOwner=0;
  while((m=callRe.exec(fsSrc))!==null) {
    calls++;
    const around=fsSrc.slice(Math.max(0,m.index-400), m.index+400);
    if(/owner/i.test(around)) withOwner++;
    // 判据必须**只有落点**：传玩家进去就等于留了"按人判"的后门
    if(/player/i.test(m[1])) {
      no('findChumAt 的实参里出现了 player（'+m[1].trim()+'）—— 判据只该是落点');
    }
  }
  if(calls<2) no('FishingSession 里 findChumAt 只有 '+calls+' 处调用（咬钩时间 + 稀有度两处都要）');
  else if(withOwner>0) no('FishingSession 的 findChumAt 附近出现了 owner（'+withOwner+'/'+calls+' 处）—— 共享被改回独享');
  else ok('两处 findChumAt 都只凭落点判定（'+calls+' 处，附近没有 owner）');

  // 规则要说给玩家：tooltip 上必须写着"同一片水域"（EN 表里也有对应句）
  const zh=JSON.parse(fs.readFileSync(path.join(ROOT,'src/main/resources/assets/anglertackle/lang/zh_cn.json'),'utf8'));
  if('tooltip.anglertackle.chum_same_water' in zh) ok('tooltip 写明"同一片水域"（玩家知道别人也吃得到）');
  else no('tooltip 少了"同一片水域"那句 —— 共享规则没告诉玩家');
}

// 8) ★★ 全服上限（用户 2026-10-11 定案 4 后半："**全服至多存在 40 个窝料**"）
//
//    为什么不能用"数一数世界里的窝料实体"：窝料寿命是 30~300 **分钟**，
//    而 getEntities 只数已加载区块 ⇒ 玩家走远几十条窝子就查不到了，上限形同虚设。
//    所以走 ChumRegistry（世界级 SavedData，记"uuid → 到期时刻"）。
{
  const REG='src/main/java/com/whitecobalt/anglertackle/fishing/ChumRegistry.java';
  if(!fs.existsSync(path.join(ROOT,REG))) no('缺 ChumRegistry —— 全服窝料上限没有落点');
  else {
    const r=read(REG);
    if(/FILE_ID\s*=\s*"anglertackle_chum"/.test(r)) ok('ChumRegistry 的 FILE_ID 正常（改名 = 老存档名额全丢）');
    else no('ChumRegistry 的 FILE_ID 被改名');
    for(const need of ['reserve(','release(','prune(','count(']) {
      if(!r.includes(need)) no('ChumRegistry 缺 '+need+'）');
    }
    if(!/class ChumRegistry extends SavedData/.test(r)) no('ChumRegistry 不是 SavedData');
  }

  const ci=read(CI);
  // ⚠ 顺序：**先占名额、再生成实体**。反过来的话，满员时水面上已经先冒出一条窝子
  const iReserve=ci.indexOf('.reserve('), iAdd=ci.indexOf('addFreshEntity');
  if(iReserve<0) no('ChumItem 没有占名额 —— 上限没接上（谁都能无限打窝）');
  else if(iAdd<0) no('ChumItem 里找不到 addFreshEntity');
  else if(iReserve>iAdd) no('ChumItem 先 addFreshEntity 再 reserve —— 满员时实体已经出去了');
  else ok('ChumItem 先占名额再生成实体（满员时玩家连物品都不扣）');
  if(/InteractionResultHolder\.fail/.test(ci)) ok('满员时返回 fail（不扣物品）');
  else no('满员时没有返回 fail —— 窝料会被白吃掉');

  // 名额到期时刻与实体寿命**同源**：两边都必须走 ChumEntity.lifeTicksOf
  const ce=read(CE);
  if(/static int lifeTicksOf\(/.test(ce)) ok('寿命算式只在 ChumEntity.lifeTicksOf() 一处');
  else no('ChumEntity 里没有 lifeTicksOf() —— 名额与实体的到期时刻会各写一份');
  // ⚠ 判据要精确到"**只有一处**，且那一处就在 lifeTicksOf 里"：
  //   第一版写成"出现 durationMinutes() * 1200 就红" ✗ —— 那会把 lifeTicksOf 自己
  //   （唯一正确的那一处）也判红，是典型的"对着正确代码报假红"。
  const lifeHits=(ce.match(/durationMinutes\(\)\s*\*\s*1200/g)||[]).length;
  const inLife=/static int lifeTicksOf\([\s\S]{0,240}?durationMinutes\(\)\s*\*\s*1200/.test(ce);
  if(lifeHits===0) no('lifeTicksOf 里没有寿命算式（那它算的是什么？）');
  else if(lifeHits>1) no('寿命算式 durationMinutes() * 1200 出现了 '+lifeHits+' 次 —— 只该有 lifeTicksOf 里那一处');
  else if(!inLife) no('唯一的寿命算式不在 lifeTicksOf() 里 —— 名额与实体寿命会漂移');
  else ok('寿命算式全仓只有一处（lifeTicksOf 里），名额与实体同源');
  if(/lifeTicksOf\(/.test(ci)) ok('ChumItem 用同一个 lifeTicksOf 算名额到期');
  else no('ChumItem 自己算了到期时刻 —— 与实体寿命会漂移');

  // 释放规则：只有"真的没了"才还名额
  const iRel=ce.indexOf('release(');
  if(iRel<0) no('ChumEntity 没有释放名额 —— 被 /kill 掉的窝子会白占名额到自然到期');
  else {
    const win=ce.slice(Math.max(0,iRel-700), iRel+200);
    const okReasons=/RemovalReason\.KILLED/.test(win)&&/RemovalReason\.DISCARDED/.test(win);
    const badReasons=/UNLOADED_TO_CHUNK|UNLOADED_WITH_PLAYER|CHANGED_DIMENSION/.test(win);
    if(!okReasons) no('释放名额的条件里没有 KILLED/DISCARDED（那两种才是"真的没了"）');
    else if(badReasons) no('释放名额的条件里混进了卸载类原因 —— 那三种情况下窝子**还存在**'
      +'（在区块存档里 / 在别的维度），放了就等于"扔远处、回来再打 40 个"');
    else ok('只在 KILLED / DISCARDED 时释放名额（卸载/换维度都还占着）');
  }

  // 名额表要被定期扫到期的（否则没人打窝时表会一直满着）
  if(/ChumRegistry\.get\(level\)\.prune\(/.test(read(CM))) ok('ChumManager 每 tick 先扫掉到期名额');
  else no('没人扫到期名额 —— 表会停在满员状态，之后谁都打不出窝');

  // 上限值本身走调参器（用户口径 40）
  const t=read('src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java');
  if(/public static int chumServerCap\(\)/.test(t)&&/Math\.max\(1,\s*cfg\(\)\.chumServerCap\.get\(\)\)/.test(t)) {
    ok('Tuning.chumServerCap() 夹到 ≥1（配置里填 0 不会变成"一条都打不出"）');
  } else no('Tuning 里没有 chumServerCap()（或没夹下界）');
  const cfg=read('src/main/java/com/whitecobalt/anglertackle/Config.java');
  if(/chumServerCap\s*=\s*b\.comment\([\s\S]{0,400}?defineInRange\("serverCap",\s*40/.test(cfg)) {
    ok('[chum] serverCap 默认 40（用户 2026-10-11 定案的数字）');
  } else no('[chum] serverCap 的默认值不是 40 / 找不到这个配置项');
}

console.log(bad===0?'\n✅ 打窝链路完整（抛出→落水→白圈→加成生效→同水体共享→全服上限）':'\n❌ 有 '+bad+' 处问题');
process.exit(bad?1:0);
