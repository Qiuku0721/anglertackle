/*
 * check-grindstone.js —— 砂轮拆配件：必须**退得回、且耐久不翻新**，同时洗掉附魔。
 *
 * 用户 2026-10-02："砂轮卸载鱼竿配件时不会返还物品，现在需要砂轮能在洗掉杆子附魔时
 * 拆除配件，并且配件保留使用过的耐久数据，在下一次装上时不会出现耐久回满的情况。"
 *
 * 这一轮修好之前，"退不回"其实有**两个**独立原因，只修一个照样一件配件都拿不到：
 *   ① 待退配件放在 {@code HashMap<ItemStack, …>} 里 —— ItemStack **不按内容比相等**，
 *      取走时 key 永远对不上。
 *   ② 取走时用 {@code OnTakeItem.getNewTopItem()} 拿"被取走的产出物" —— 它不是产出物。
 *      NeoForge 的 {@code CommonHooks.onGrindstoneTake} 里写得很清楚：
 *        new OnTakeItem(access, player, inputSlots.getItem(0), inputSlots.getItem(1), xp)
 *        ... inputSlots.setItem(0, e.getNewTopItem())
 *      即 getTopItem()/getBottomItem() 是**输入槽里的原件**，
 *      而 getNewTopItem()/getNewBottomItem() 是"取完之后留在输入槽里的残余"（默认 EMPTY）。
 *      读后者 → 空栈 → 静默 return → 配件从来没退回过，而且日志里一个字都没有。
 *      （2026-10-02 实测：修好 ① 之后仍然退不回，就是 ② 还在。）
 *
 * 正确做法：取走时从**输入槽里那根竿**上真拆（stripAllParts），拆出来的就是存下来的那几份
 * ItemStack 的副本，耐久自然保留。
 *
 * 用法：node tools/check-grindstone.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ⚠ 用**共用的**状态机剥离器（tools/java-source.js）。自己写正则剥注释是个坑：
//   行注释里出现 `/*` 会被当成块注释开头，一路吞掉大段真实代码 —— 断言于是"通过"。
const { stripComments } = require('./java-source.js');
const code = (p) => stripComments(read(p));

console.log('=== 砂轮拆配件检查 ===\n');

const EV = 'src/main/java/com/whitecobalt/anglertackle/event/GrindstoneEvents.java';
const RM = 'src/main/java/com/whitecobalt/anglertackle/fishing/RodModManager.java';
for (const f of [EV, RM]) {
  if (!fs.existsSync(path.join(ROOT, f))) { no('找不到 ' + f); process.exit(1); }
}
const ev = code(EV), rm = code(RM);

// 断言要分区域看：这两个方法各自只能干一半的活，
// 全文搜 getTopItem() 会被 onPlaceItem 那边满足 —— 变异测试会当场戳穿这种"看着对"的检查。
const takeAt = ev.indexOf('public static void onTakeItem');
if (takeAt < 0) { no('GrindstoneEvents 里找不到 onTakeItem —— 取走时没人退配件'); process.exit(1); }
const place = ev.slice(0, takeAt), take = ev.slice(takeAt);

// ① 取走时从**输入槽里的竿**上拆，不是从"产出物"或某个缓存里找
if (/getTopItem\(\)/.test(take) && /getBottomItem\(\)/.test(take)) {
  ok('取走事件里从输入槽（getTopItem()/getBottomItem()）取那根竿');
} else no('取走时没有读 getTopItem()/getBottomItem() —— 配件没有来源，退不回');
if (/stripAllParts\(rod\)/.test(take)) {
  ok('取走时对输入槽那根竿真拆一次（stripAllParts(rod)）');
} else no('取走时没有对输入槽的竿调用 stripAllParts(rod) —— 配件退不出来');

// ② 绝对不许读"事件之后输入槽的残余"（原件就是踩了这个坑，静默退回 0 个）
if (/getNewTopItem|getNewBottomItem/.test(ev)) {
  no('又读了 getNewTopItem()/getNewBottomItem() —— 那是"取完之后留在输入槽里的残余"（默认 EMPTY），' +
    '不是被取走的产出物；读它会静默退回 0 个配件（这就是"不返还物品"的第二个根因）');
} else {
  ok('没有把 getNewTopItem()/getNewBottomItem() 当成产出物（那正是配件退不回的第二个根因）');
}

// ③ 不许再引入"待退配件缓存"（内存 Map / 挂在产出物上的中间组件都算）
if (/Map<\s*ItemStack/.test(ev) || /HashMap<\s*ItemStack/.test(ev)) {
  no('GrindstoneEvents 又用 ItemStack 当 Map 的键了 —— ItemStack 不按内容比相等，' +
    '取走时会对不上，配件根本退不回来（这就是用户报的"不返还物品"）');
} else {
  ok('没有把 ItemStack 当 Map 键（那正是配件退不回来的第一个根因）');
}
if (/PENDING_PARTS|pending_parts/.test(ev)) {
  no('取走时又去读"暂存的配件"了 —— 配件不用暂存，输入槽里那根竿就是来源');
} else {
  ok('没有"暂存配件再取回"这条路（不需要暂存，也就没有"找不回来"的可能）');
}

// ④ 拆下来的配件必须是"存下来的那几份"，不能重造（耐久不许翻新）
if (/p\.lineStack\(\)/.test(rm) && /p\.lureStack\(\)/.test(rm)) {
  ok('stripAllParts 返回存下来的 ItemStack（耐久随配件一起保留）');
} else no('stripAllParts 没有用 lineStack()/lureStack() —— 配件耐久会丢');
if (/new ItemStack\(item\)/.test(rm) && /stripAllParts/.test(rm)) {
  // 只有在 stripAllParts 里出现才算违规
  const i = rm.indexOf('stripAllParts');
  const body = rm.slice(i, i + 1200);
  if (/new ItemStack\(item\)/.test(body)) {
    no('stripAllParts 里又出现 new ItemStack(item) —— 重造的耐久是满的，' +
      '配件一装回去就"翻新"（用户明确要求不能回满）');
  } else ok('stripAllParts 里没有按 id 重造物品栈');
} else ok('stripAllParts 里没有按 id 重造物品栈');
if (/out\.add\(part\.copy\(\)\)/.test(rm)) ok('返回的是副本（不动竿上那份记录）');
else no('返回的不是副本 —— 竿上的记录和退回来的物品会互相影响');

// ⑤ 产出物要显式清附魔（"洗掉附魔时拆除配件"是同一件事）
if (/setEnchantments\([\s\S]{0,120}ItemEnchantments\.EMPTY\)/.test(place)) {
  ok('产出物显式清空附魔（"洗掉竿子附魔时拆除配件"两件事都做到）');
} else no('产出物没有清附魔 —— 整份替换产出物会绕过砂轮原本的剥附魔逻辑');

// ⑥ 退回的东西一件都不能丢（2026-10-12 M4 改造：**先寄信，邮箱也满才掉在脚下**）
//
// ⚠ 同 check-anvil-return ⑦：兜底搬进了 MailReturns，"掉在脚下"那句在那里 ——
//   只搜本文件会把"兜底被删掉"放过去 ✗。
{
  const MR = 'src/main/java/com/whitecobalt/anglertackle/mail/MailReturns.java';
  const helper = fs.existsSync(path.join(ROOT, MR)) ? read(MR) : '';
  if (!/getInventory\(\)\.add\(p\)/.test(take) || !/MailReturns\.toMailboxOrDrop\(player, p/.test(take)) {
    no('背包满时没有走 MailReturns.toMailboxOrDrop —— 配件既不寄信、也没有兜底');
  } else if (!/player\.drop\(stack, false\)/.test(helper)) {
    no('MailReturns 里没有"掉在脚下"的兜底 —— **邮箱也满时**配件会凭空消失 ✗'
      + '（比改造前更糟：原来至少会掉在地上）');
  } else {
    ok('背包满 ⇒ 先寄信；邮箱也满 ⇒ 掉在脚下（与铁砧那条共用同一个兜底）');
  }
}

// ⑦ 客户端不能给东西（Slot#onTake 客户端也跑一遍做预测），只有服务端能真给
if (/isClientSide\(\)/.test(take)) ok('只在服务端退配件（客户端预测不会刷出幽灵物品）');
else no('没有 isClientSide() 守卫 —— 客户端预测也会"退回"一份，会出现幽灵配件');

console.log('');
console.log(bad === 0
  ? '✅ 砂轮：洗附魔 + 拆配件 + 配件带回原耐久'
  : '❌ 砂轮检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
