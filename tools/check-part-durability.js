/*
 * check-part-durability.js —— 配件耐久必须能**活着走完一圈**。
 *
 * 用户 2026-10-02（砂轮那轮之后）：
 *   "可以看到拆下来的配件确实有耐久，但装回去就满了。"
 *
 * 根因：拆的路径已经改成"退回存着的那一份"，**装的路径还在按物品 id 重造堆栈** ——
 * `RodModManager.setSlot(..., String id)` 走 `stackFromId(id)` → `new ItemStack(item)`，
 * 新造出来的堆栈耐久是满的。于是三处全在洗耐久：
 *   · 改装界面装上去的配件             （equip）
 *   · 改装界面换下来的旧配件           （equip 里退回旧件那一段）
 *   · 改装界面【卸下】按钮             （unequip）
 *   · 铁砧右槽装上去的配件             （applyPart）
 * 玩家只要"拆下 → 装上"就能把一件磨损的配件刷成全新，砂轮那边修得再对也没用。
 *
 * 现在一律改成**传物品栈**：`setSlot(..., ItemStack part)` 存 `part.copyWithCount(1)`，
 * 退回旧件时读竿上存着的那一份（`slotStackOf`）。数量固定 1，其余组件（耐久/自定义名/附魔）原样带走。
 *
 * 用法：node tools/check-part-durability.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 剥注释后再匹配 —— 本文件的注释里就写着"按 id 重造"这些反面教材，不剥会自己把自己判红。 */
// ⚠ 用**共用的**状态机剥离器（tools/java-source.js）：自己写正则剥注释，
//   行注释里出现 `/*` 会吞掉大段真实代码，断言于是"通过"。
const { stripComments } = require('./java-source.js');
const code = (p) => stripComments(read(p));

console.log('=== 配件耐久：装上/换下/卸下/铁砧 四条路都不能翻新 ===\n');

const RM = 'src/main/java/com/whitecobalt/anglertackle/fishing/RodModManager.java';
if (!fs.existsSync(path.join(ROOT, RM))) { no('找不到 ' + RM); process.exit(1); }
const rm = code(RM);

/** 取某个方法体（从签名到下一个方法的签名之前）。分区域是必须的：
 *  全文搜 "copyWithCount" 会被别的方法满足，等于没守住。 */
function region(sig) {
  const i = rm.indexOf(sig);
  if (i < 0) return null;
  const rest = rm.slice(i + sig.length);
  const m = rest.search(/\n    (?:private|public|protected)[\w <>,\[\].]*\(/);
  return m < 0 ? rm.slice(i) : rm.slice(i, i + sig.length + m);
}

const setSlot = region('private static void setSlot(');
const equip = region('private static void equip(');
const unequip = region('private static void unequip(');
const applyPart = region('public static boolean applyPart(');
for (const [n, r] of [['setSlot', setSlot], ['equip', equip], ['unequip', unequip], ['applyPart', applyPart]]) {
  if (r === null) { no('源文件里找不到 ' + n + '（方法被改名/删掉了？断言要跟着改）'); }
}
if (bad) { process.exit(1); }

// ① setSlot 收物品栈，不收 id
if (/private static void setSlot\(ItemStack rodStack, ModDataComponents\.RodParts p, int slot,\s*ItemStack part\)/
    .test(rm)) {
  ok('setSlot 收的是 ItemStack（收 id 就必然要重造堆栈，耐久一定是满的）');
} else no('setSlot 的形参不再是 ItemStack —— 又回到"按 id 重造"，配件一装就翻新');
// ② 存进去的是传入那一件的副本，数量 1
if (/part\.copyWithCount\(1\)/.test(setSlot)) {
  ok('setSlot 存的是传入那一件的副本（copyWithCount(1)：耐久/自定义名/附魔一起带走）');
} else no('setSlot 没有存 part.copyWithCount(1) —— 要么丢了耐久，要么把整叠都塞进了竿里');

// ③ 装上去的配件 = 背包里那一件的副本
if (/candidate\.copyWithCount\(1\)/.test(equip)) {
  ok('equip 存的是背包里那一件的副本（不是 new ItemStack(candidate.getItem())）');
} else no('equip 没有存 candidate 的副本 —— 装上去的配件会变成全新满耐久');
if (/setSlot\(rodStack, parts, slot, newPart\)/.test(equip)) {
  ok('equip 把那一份副本交给 setSlot（链路接上了）');
} else no('equip 交给 setSlot 的不是那一份副本');

// ④ 换下来的旧配件 = 竿上存着的那一份
if (/slotStackOf\(parts, slot\)/.test(equip)) {
  ok('equip 换下来的旧配件取自竿上存着的那一份（磨损不会被洗掉）');
} else no('equip 退旧配件时没有读竿上存着的那一份 —— 换下来就变全新');

// ⑤ 卸下按钮 = 竿上存着的那一份
if (/slotStackOf\(parts, slot\)/.test(unequip)) {
  ok('unequip（卸下按钮）退回的是竿上存着的那一份');
} else no('unequip 退回的不是竿上存着的那一份 —— 卸下来就变全新');

// ⑥ 铁砧走的是同一个入口，而且传真栈
if (/setSlot\(rodStack, currentParts\(rodStack\), slot, part\)/.test(applyPart)) {
  ok('applyPart（铁砧）把右槽那一件真栈传进去（不是 id、不是重造件）');
} else no('applyPart 没有传真栈 —— 铁砧装上去的配件同样会翻新');

// ⑦ 这四条路里不许再出现任何"按 id 重造 / 写死满耐久"的写法
const rebuild = [
  ['new ItemStack(BuiltInRegistries.ITEM.get(', '按物品 id 重造堆栈（耐久满）'],
  ['new ItemStack(part.getItem()', '按物品类型重造堆栈（耐久满）'],
  ['new ItemStack(candidate.getItem()', '按物品类型重造堆栈（耐久满）'],
  ['stackFromId(', '从 id 还原堆栈（只允许出现在老存档解码那一侧）'],
  ['setDamageValue(0)', '把耐久写死成 0 损耗'],
];
for (const [needle, why] of rebuild) {
  const hit = [['equip', equip], ['unequip', unequip], ['applyPart', applyPart], ['setSlot', setSlot]]
    .filter(([, r]) => r.includes(needle)).map(([n]) => n);
  if (hit.length) no(hit.join('/') + ' 里又出现了 ' + needle + ' —— ' + why + '（配件会翻新）');
}
if (!rebuild.some(([n]) => [equip, unequip, applyPart, setSlot].some((r) => r.includes(n)))) {
  ok('四条路里都没有"重造堆栈 / 写死满耐久"的写法');
}

console.log('');
console.log(bad === 0
  ? '✅ 配件耐久：装上 / 换下 / 卸下 / 铁砧 都保留用过的耐久'
  : '❌ 配件耐久检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
