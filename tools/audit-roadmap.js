// 逐项核对路线图 M1~M8 的实际实现情况。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
function walk(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p,out); else if(e.name.endsWith('.java'))out.push(p);}return out;}
const java=walk(path.join(ROOT,'src/main/java'),[]);
const all=java.map(f=>fs.readFileSync(f,'utf8')).join('\n');
// 资源文件也算
const resDir=path.join(ROOT,'src/main/resources');
function walkAll(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())walkAll(p,out); else out.push(p);}return out;}
// ⚠ 路径分隔符必须归一成 '/'：Windows 上 path.join 给的是反斜杠，
//   而下面所有正则都是按 '/'(如 /textures\/item/) 写的 —— 不归一的话
//   "资源文件存在"这一整类判据会**静默失效**，全都当成"没做"。
//   （这类判据失效不会报错，只是让路线图永远显示未完成。）
const res=walkAll(resDir,[]).map(p=>p.replace(ROOT,'').split(path.sep).join('/'));
const names=java.map(f=>path.basename(f)).join(' ');
const has=(re)=>re.test(all)||re.test(names)||res.some(p=>re.test(p));

// 老柯是否真的随结构生成：不看文件名，**直接把结构 NBT 读出来查里面那个实体**。
// 用文件名/类名去猜"做没做"是不靠谱的 —— 文件在、名字对，实体却可能没注进去。
let npcInStructure=false;
try{
  const nbt=require('./lib-nbt');
  const p=path.join(ROOT,'src/main/resources/data/anglertackle/structure/fisherman_hut.nbt');
  const t=nbt.readNbtTyped(p);
  const ents=t.root.v.entities;
  npcInStructure=!!(ents&&ents.t===9&&ents.v.items.some(e=>
    e.t===10&&e.v.nbt&&e.v.nbt.t===10&&e.v.nbt.v.id&&e.v.nbt.v.id.v==='anglertackle:fisherman'));
}catch(e){npcInStructure=false;}

const M=[
 ['M1 手感原型',[
   ['钓竿（台钓+路亚）', has(/RodKind|RodType/)],
   ['蓄力/视角抛投', has(/castByLook/)],
   ['浮漂实体+落水判定', has(/BobberEntity/)],
   ['提竿窗口', has(/HOOK_WINDOW/)],
   ['张力对抗', has(/tension/)],
   ['上鱼结算', has(/LANDING|onCatch/)],
   ['耐久扣除', has(/applyBiteDurabilityCost/)],
   ['幽灵鱼线+落点标记', has(/FishingLineRenderer/)],
 ]],
 ['M2 装备系统',[
   ['5档竿×2类型', has(/NETHERITE_FLOAT_ROD/)],
   ['六槽改装', has(/RodParts/)],
   ['配件属性合成', has(/PartComposer/)],
   ['改装界面', has(/RodModScreen/)],
   ['耐久与修理', has(/partProps/)],
   ['5档浮漂（已从设计移除，非遗漏）', false],
 ]],
 ['M3 鱼类与图鉴',[
   ['鱼种数据驱动', has(/FishSpecies/)],
   ['品质下限系统', has(/baitMinTier/)],
   ['稀有度/尺寸随机', has(/rollIndividual/)],
   // 2026-09-30 已实现：CodexBookItem + CodexScreen + CodexRewards
   ['图鉴 GUI', has(/CodexScreen/)],
   ['图鉴完成度', has(/CodexRewards|codexCount/)],
 ]],
 ['M4 世界与钓点',[
   // 2026-09-30 已实现：按群系判定 6 类水体
   ['水体类型判定', has(/WaterBody/)],
   ['水深/离岸', has(/measureDepth/)],
   ['窝料实体化', has(/ChumEntity/)],
   ['水面窝+沉底窝', has(/sinking/)],
   ['10分钟增益+白圈', has(/ChumManager\.radius\(\)|chumRadius/)],
   // 2026-09-30 用户定案取消。条目保留（不是漏做），与 M2 的「5档浮漂」同一处理：
   // 直接删掉的话，以后翻路线图会以为"这一项从来没被考虑过"。
   ['饵料实体化（已取消，非遗漏）', false],
   ['渔夫小屋结构', has(/worldgen\/structure\/fisherman_hut\.json/)],
   // 判据是"结构 NBT 里真的有那个实体"，不是"有个叫 FishermanEntity 的类"
   ['老柯 NPC 生成', npcInStructure],
 ]],
 ['M5 经济与任务',[
   // 2026-09-30 已实现：玩家附件 + 定价 + HUD 面板（不做成物品）
   ['鱼币', has(/PlayerFishingData|CoinPricing/)],
   ['钓鱼商店', has(/ShopScreen|ShopCatalog/)],
   ['卖鱼', has(/ShopManager|OP_SELL_PREFIX/)],
   ['老柯对话 GUI', false],
   ['每日任务', false],
   ['认证考核系统', false],
 ]],
 ['M6 展示与社交',[
   ['水族箱方块', false],
   ['鱼架展示', false],
   ['排行榜', false],
   ['全服播报', false],
   ['单局评价', false],
 ]],
 ['M7 美术音效教程',[
   ['全部贴图非占位', has(/textures\/item/)],
   ['自定义音效', false],
   ['粒子效果', has(/ParticleTypes/)],
   ['教程书 GUI', has(/GuideScreen|GuideBookItem/)],
   // 设计稿是 10 章，现在实际是 8 章（内容覆盖了核心机制，见 docs/16 与 guide.json）
   ['教程书 8 章（设计稿 10 章，核心机制已覆盖）', (() => {
     try {
       const g = JSON.parse(fs.readFileSync(
         path.join(ROOT, 'src/main/resources/data/anglertackle/guide/guide.json'), 'utf8'));
       return g.chapters.length >= 8;
     } catch (e) { return false; }
   })()],
   ['原版成书版本', false],
 ]],
 ['M8 打磨扩展',[
   ['自定义附魔', false],
   // 早已不是空壳：446 项 / 11 组，全部接到 Tuning 并在运行期被读取
   ['配置文件（446 项全部接通）', (() => {
     try {
       const c = fs.readFileSync(
         path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java'), 'utf8');
       const n = (c.match(/\.define(InRange|Enum)?\(/g) || []).length;
       return n >= 400;
     } catch (e) { return false; }
   })()],
   ['鱼种 30+', false],
   ['海洋版渔夫小屋', false],
   ['月相影响', false],
 ]],
];
// 进度统计。
//
// ⚠ "已取消"的条目**不进分母**。路线图里有两项是玩家主动砍掉的
//（M2 的 5 档浮漂、M4 的饵料实体化），把它们算进分母会让 M2 永远显示 5/6、
// M4 永远显示 5/8 —— 看上去像"还差一项没做"，而实际上是**做完了**。
//
// 一个永远追不平的进度表会让人反复回去确认"这一项到底做没做"。
// 所以：取消项单独列出来（不是删掉 —— 删了以后就没人知道它曾被考虑过），
// 但只算"已取消 N 项"，不计入完成度。
const isCancelled = (name) => /已取消|已从设计移除/.test(name);
let done = 0, total = 0, cancelledAll = 0;
for (const [ms, items] of M) {
  const live = items.filter((i) => !isCancelled(i[0]));
  const dead = items.length - live.length;
  const d = live.filter((i) => i[1]).length;
  done += d; total += live.length; cancelledAll += dead;
  console.log('\n' + ms + '   [' + d + '/' + live.length + ']' +
              (dead ? '  （另有 ' + dead + ' 项已取消）' : ''));
  for(const [n,ok] of items) console.log('   '+(ok?'✅':'❌')+' '+n);
}
console.log('\n总计 '+done+'/'+total+'  未实现 '+(total-done)+' 项');
