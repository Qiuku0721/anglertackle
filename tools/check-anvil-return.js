/*
 * check-anvil-return.js —— 铁砧换配件：旧的那件必须**退回背包**，而且带回原耐久。
 *
 * 用户 2026-10-02："那就再做退回背包。"
 * （上一轮修的是"拆下来带耐久"，但铁砧上换件时旧件是被原版吃掉的 —— 同样属于吞配件。）
 *
 * 这件事有一个**必须踩对**的时机问题：
 *   · AnvilUpdateEvent 是**预览**：玩家每动一下槽位就触发一次（换件、改名字、取出再放回）。
 *     在那里发货 = 每次预览都刷一个旧件出来（刷件）。
 *   · AnvilRepairEvent 才是"取走产出物"那一刻，NeoForge 从 AnvilMenu.onTake 里发出来，
 *     而且**左槽在钩子返回之后才被清空**（原文：CommonHooks.onAnvilRepair(...);
 *     this.inputSlots.setItem(0, ItemStack.EMPTY);），所以旧件这时还读得到。
 * 这和砂轮是同一课：给东西只能在"取走"这一刻，而且要读**输入槽里那件原件**。
 *
 * 用法：node tools/check-anvil-return.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 剥注释再匹配：本文件的注释里就写着"按 id 重造"这些反面教材，不剥会自己把自己判红。 */
// ⚠ 用**共用的**状态机剥离器（tools/java-source.js）：自己写正则剥注释，
//   行注释里出现 `/*` 会吞掉大段真实代码，断言于是"通过"。
const { stripComments } = require('./java-source.js');
const code = (p) => stripComments(read(p));

console.log('=== 铁砧换件：旧配件退回背包 ===\n');

const AV = 'src/main/java/com/whitecobalt/anglertackle/event/AnvilEvents.java';
const RM = 'src/main/java/com/whitecobalt/anglertackle/fishing/RodModManager.java';
for (const f of [AV, RM]) {
  if (!fs.existsSync(path.join(ROOT, f))) { no('找不到 ' + f); process.exit(1); }
}
const av = code(AV), rm = code(RM);

// 分区域：onAnvilUpdate 是"预览"，onAnvilRepair 是"取走"，两者的规矩正好相反
const repAt = av.indexOf('public static void onAnvilRepair');
if (repAt < 0) { no('AnvilEvents 里找不到 onAnvilRepair —— 取走时没人退旧件'); process.exit(1); }
const upd = av.slice(0, repAt), rep = av.slice(repAt);

// ① 发货点在"取走"事件里
if (/AnvilRepairEvent/.test(rep)) ok('退旧件挂在 AnvilRepairEvent（取走产出物那一刻）上');
else no('没有监听 AnvilRepairEvent —— 旧件没有发货时机');

// ② 预览事件里绝不许发货（那里的触发频率是"每动一下槽位"）
if (/getInventory\(\)\.add\(|\.drop\(/.test(upd)) {
  no('onAnvilUpdate（预览事件）里在发货 —— 玩家每动一下槽位就触发一次，会刷出无数旧件');
} else ok('预览事件（AnvilUpdateEvent）里不发任何东西（那里每动一下槽位就会触发）');

// ③ 读的是左槽那根**原来的**竿，不是产出物
if (/event\.getLeft\(\)/.test(rep)) ok('读的是左槽里那根原来的竿（旧件还在它上面）');
else no('没有读 event.getLeft() —— 旧件没有来源');
if (/event\.getOutput\(\)/.test(rep)) {
  no('读的是 getOutput() —— 产出物是**换好之后**的竿，旧件在上面已经没有了');
} else ok('没有把产出物当成旧件的来源（旧件只在左槽那根竿上）');

// ④ 槽位判定和"装上去"是同一个方法（否则可能退错槽位的那一件）
if (/RodModManager\.partSlotOf\(right,/.test(rep)) {
  ok('槽位判定和安装走同一个 partSlotOf（不会退错槽位）');
} else no('退旧件时没有用 partSlotOf 定槽位 —— 可能把别的槽位的配件退给玩家');

// ⑤ 退的是带耐久的那一份
if (/RodModManager\.partAt\(left, slot\)/.test(rep)) {
  ok('退的是竿上存着的那一份（RodModManager.partAt —— 带耐久，不是按 id 重造）');
} else no('没有用 RodModManager.partAt(left, slot) 取旧件 —— 退回来的耐久会是满的');
for (const needle of ['new ItemStack(', 'stackFromId(', 'setDamageValue(0)']) {
  if (rep.includes(needle)) {
    no('退旧件那段里出现了 ' + needle + ' —— 按 id 重造/写死满耐久，磨损会被洗掉');
  }
}
if (!['new ItemStack(', 'stackFromId(', 'setDamageValue(0)'].some((n) => rep.includes(n))) {
  ok('退旧件那段里没有"重造堆栈 / 写死满耐久"的写法');
}

// ⑥ 服务端守卫（客户端也会跑一遍容器点击做预测）
if (/isClientSide\(\)/.test(rep)) ok('只在服务端退旧件（客户端预测不会刷出幽灵配件）');
else no('没有 isClientSide() 守卫 —— 客户端预测也会"退回"一份');

// ⑦ 背包满时不许丢（2026-10-12 M4 改造：**先寄信，邮箱也满才掉在脚下**）
//
// ⚠ 判据从"本文件里有没有 player.drop(old, false)"升级成**看共享兜底**：
//   现在这一条走 MailReturns.toMailboxOrDrop()，"掉在脚下"那句搬进了 MailReturns。
//   只搜本文件的话，把 MailReturns 的兜底删掉照样绿 ✗（"字符串在 ≠ 事情在做"，今天第 N 次）。
{
  const MR = 'src/main/java/com/whitecobalt/anglertackle/mail/MailReturns.java';
  const helper = fs.existsSync(path.join(ROOT, MR)) ? read(MR) : '';
  if (!/MailReturns\.toMailboxOrDrop\(player, old/.test(rep)) {
    no('背包满时没有走 MailReturns.toMailboxOrDrop —— 旧件既不寄信、也没有兜底');
  } else if (!/player\.drop\(stack, false\)/.test(helper)) {
    no('MailReturns 里没有"掉在脚下"的兜底 —— **邮箱也满时**旧件会凭空消失 ✗'
      + '（比改造前更糟：原来至少会掉在地上）');
  } else {
    ok('背包满 ⇒ 先寄信；邮箱也满 ⇒ 掉在脚下（兜底在 MailReturns，铁砧与砂轮共用）');
  }
}

// ⑧ partAt 本身必须是"带耐久的那一份"
if (/public static ItemStack partAt\(ItemStack rodStack, int slot\)/.test(rm)
    && /slotStackOf\(currentParts\(rodStack\), slot\)/.test(rm)) {
  ok('RodModManager.partAt 返回的是竿上存着的那一件（转发 slotStackOf）');
} else no('partAt 没有转发 slotStackOf —— 它可能又去按 id 重造了');

console.log('');
console.log(bad === 0
  ? '✅ 铁砧换件：旧配件退回背包，且带回原耐久'
  : '❌ 铁砧退件检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
