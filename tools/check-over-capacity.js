// 守住「超承重鱼 = 烧竿」这条玩法规则。
//
// ── 背景（用户两次报同一个现象）──────────────────────────────
// 第一次："标承重 8 千克的杆能钓出 11kg 的鱼" —— 当时的修法是按承重**夹取体重**。
// 第二次（2026-09-30）："依然存在鱼超承重不断杆的情况"。日志里清清楚楚：
//
//     抽取输入：竿档位上限=1 竿型=LURE 承重=8
//     上鱼：atlantic_salmon 体重 21.10kg      ← 承重 8kg 的木竿
//     上鱼：striped_bass   体重 11.51kg
//
// 根因：夹取那版**根本没接上**。buildPool 只按 `kgMin() > 承重` 过滤鱼种
// （大西洋鲑 kgMin=2 ≤ 8，进池），而个体是在 [2, 22] 里抽的，
// FishingSession 调的又是**不带承重**的 rollIndividual 重载。
// 也就是说：承重只在"鱼种"那一层挡，从没在"个体"这一层生效过。
//
// 用户随后定案不再夹取，改惩罚：
//   "不用做筛选，只要上超承重鱼就清空钓上它的鱼竿的耐久，
//    或者说如果上鱼检测是超承重鱼就飞快消耗当前鱼竿耐久，不用等钓上来。"
//
// 所以下面守的是这套新规则，而不是"体重不超承重"——后者已经不是目标了。
const fs = require('fs'), path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');
const { stripComments: strip } = require('./java-source.js');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };
const read = (rel) => strip(fs.readFileSync(path.join(JAVA, rel), 'utf8'));

const SESSION = read('fishing/FishingSession.java');
const SPECIES = read('fishing/FishSpecies.java');

// ---------------------------------------------------------------- 1. 不再按承重筛选
{
  if (/s\.kgMin\(\)\s*>\s*maxWeightKg/.test(SPECIES)) {
    no('buildPool 又按承重过滤鱼种了 —— 用户定案是"不用做筛选"，靠烧竿惩罚');
  } else ok('buildPool 不按承重筛选（超重鱼会真的咬钩）');

  // 也不该改回去夹取体重
  if (/maxWeightKg[\s\S]{0,200}?weight\s*=\s*Math\.min\(\s*weight/.test(SPECIES)) {
    no('个体体重又被夹取了 —— 那会让所有超重鱼都堆在承重值上，且惩罚永远不会触发');
  } else ok('个体体重没有被夹取');
}

// ---------------------------------------------------------------- 2. 咬钩即判定
{
  if (/private void checkOverCapacity\(\)/.test(SESSION)) ok('有 checkOverCapacity()');
  else no('没有 checkOverCapacity —— 超重判定无从谈起');

  // 必须在 rollIndividual 之后、且在同一次咬钩里调用
  const roll = SESSION.indexOf('rollIndividual(');
  const check = SESSION.indexOf('checkOverCapacity();');
  if (roll > 0 && check > roll) ok('咬钩定下鱼之后立刻判定（不是等到上鱼才算）');
  else no('没有在咬钩那一刻调用 checkOverCapacity');

  if (/private boolean overCapacity;/.test(SESSION) && /overCapacityRatio/.test(SESSION)) {
    ok('判定结果存在字段里（钉死，中途换手不能白嫖）');
  } else no('没有把判定结果存成字段 —— 每 tick 现算的话换手就能躲过惩罚');
}

// ---------------------------------------------------------------- 3. 每 tick 烧竿
{
  if (/private boolean tickOverCapacityBurn\(\)/.test(SESSION)) ok('有 tickOverCapacityBurn()');
  else no('没有每 tick 烧竿的方法');

  const tickFight = SESSION.indexOf('private void tickFight(');
  const burnCall = SESSION.indexOf('tickOverCapacityBurn()', tickFight);
  const firstLogic = SESSION.indexOf('struggleSwitchTicks', tickFight);
  if (tickFight > 0 && burnCall > tickFight && (firstLogic < 0 || burnCall < firstLogic)) {
    ok('烧竿放在 tickFight 最前面（断竿后本 tick 其余逻辑不再跑）');
  } else no('烧竿没放在 tickFight 开头 —— 断竿那一 tick 还会继续算对抗');

  if (/OVER_CAPACITY_BURN_PER_TICK\s*=\s*1\.0\s*\/\s*80\.0/.test(SESSION)) {
    ok('烧速 = 1/80 每 tick（约 4 秒烧完整根，留得出放线保竿的时间）');
  } else no('烧速常量变了或没了 —— 4 秒是刻意选的（够反应、不够犹豫）');

  if (/rod\.setDamageValue\(now\)/.test(SESSION) && /rod\.getMaxDamage\(\)/.test(SESSION)) {
    ok('按耐久**比例**烧，而不是固定点数（木竿 2000 与合金竿 8000 一样致命）');
  } else no('烧竿不是按比例算的 —— 固定点数会让合金竿几乎免疫');
}

// ---------------------------------------------------------------- 4. 断了要收场
{
  if (/rod_broken_over_capacity/.test(SESSION)) ok('断竿有专门提示（不是默默结束）');
  else no('断竿没有提示 —— 玩家只会觉得"莫名其妙竿没了"');
  if (/abort\(this,\s*"message\.anglertackle\.escaped"\)/.test(SESSION)) {
    ok('断竿后走 abort 结束会话（鱼跑掉，不会卡在对抗里）');
  } else no('断竿后没有结束会话 —— 会卡在 FIGHT 状态');
  if (/over_capacity/.test(SESSION)) ok('超重瞬间就提示玩家（给放线的机会）');
  else no('超重没有即时提示 —— 玩家来不及反应');
}

// ---------------------------------------------------------------- 5. 语言键
{
  const zh = fs.readFileSync(
    path.join(ROOT, 'src/main/resources/assets/anglertackle/lang/zh_cn.json'), 'utf8');
  for (const k of ['message.anglertackle.over_capacity',
                   'message.anglertackle.rod_broken_over_capacity']) {
    if (zh.includes(k)) ok('语言键存在：' + k);
    else no('缺少语言键：' + k);
  }
}

console.log(bad === 0 ? '\n✅ 超承重鱼会烧竿（不再做筛选）' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
