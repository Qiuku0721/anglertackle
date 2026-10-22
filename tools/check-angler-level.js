/*
 * check-angler-level.js —— 垂纶等级（1–50）与突破评定。
 *
 * 用户 2026-10-02 定案：
 *   "每钓上来一条鱼，获得 10 经验。如果鱼是白/绿/蓝/紫/金/红品质，则额外加
 *    2/8/16/24/32/48 经验。随着等级越来越高，每级升级所需经验不断提高，
 *    从初始的 100 能升一级到 2000 一级。每 10 级解锁一次对应的评定界面，
 *    提交评定所需材料可以突破到下一级，不突破就卡在那一级，不积攒经验。
 *    到 40 级突破完后不会出现评定任务。"
 *
 * 这条链路上每一环坏掉的表现都是**静默的**：
 *   · 忘了接上鱼给经验        → 等级永远停在 1，谁也不报错；
 *   · 卡级时还在攒经验        → "不突破就卡住"这条规则失效，玩家白攒一堆；
 *   · 评定等级表少一个        → Lv.30 永远过不去（而且只有卡在那里的玩家才会发现）；
 *   · 老存档迁移丢了          → 老玩家一读档，商店全部锁回去；
 *   · 卖鱼不提示              → 把下一级要交的鱼默默卖掉，只能重新钓几十分钟。
 * 所以每一条都写成断言，并且真的用负例证伪过。
 *
 * 用法：node tools/check-angler-level.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ⚠ 必须用**共用的**那个状态机剥离器（tools/java-source.js），不要自己写正则：
//   FishingManager 里有一句行注释写着 `/**售价**的数据面板）`，其中的 `/*`
//   会被 `replace(/\/\*[\s\S]*?\*\//g)` 当成块注释开头，一路吞到很远的 `*/` ——
//   于是**上鱼给经验那段真实代码被删掉**，断言搜不到东西就"通过"了。
//   这一版就是这么踩的（java-source.js 的头部注释里正好记着同一个坑，是我没看）。
const { stripComments } = require('./java-source.js');
const code = (p) => stripComments(read(p));

console.log('=== 垂纶等级（1–50）检查 ===\n');

const LV = 'src/main/java/com/whitecobalt/anglertackle/player/AnglerLeveling.java';
const PR = 'src/main/java/com/whitecobalt/anglertackle/player/FishermanProgress.java';
const FM = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingManager.java';
const SM = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java';
const MAT = 'src/main/java/com/whitecobalt/anglertackle/shop/ShopMaterials.java';
const SCREEN = 'src/main/java/com/whitecobalt/anglertackle/client/screen/ShopScreen.java';
const GEN = 'tools/gen-gameplay-config.js';
for (const f of [LV, PR, FM, SM, MAT, SCREEN, GEN]) {
  if (!fs.existsSync(path.join(ROOT, f))) { no('找不到 ' + f); process.exit(1); }
}
const lv = code(LV), pr = code(PR), fm = code(FM), sm = code(SM), mat = code(MAT),
  screen = code(SCREEN), gen = read(GEN);

const intOf = (src, name) => {
  const m = new RegExp(name + '\\s*=\\s*(-?\\d+)').exec(src);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------- ① 数值（用户点名的那几个）
const MAX = intOf(lv, 'MAX_LEVEL');
const PER = intOf(lv, 'XP_PER_CATCH');
const FIRST = intOf(lv, 'XP_FIRST');
const LAST = intOf(lv, 'XP_LAST');
if (MAX === 50) ok('满级 50 级');
else no('MAX_LEVEL = ' + MAX + '，用户要的是 50 级');

if (PER === 10) ok('每条鱼基础经验 10');
else no('XP_PER_CATCH = ' + PER + '，用户要的是 10');

const bonus = [...(new RegExp('TIER_BONUS\\s*=\\s*\\{([^}]*)\\}').exec(lv) || [, ''])[1]
  .matchAll(/-?\d+/g)].map(Number);
const wantBonus = [2, 8, 16, 24, 32, 48];
if (JSON.stringify(bonus) === JSON.stringify(wantBonus)) {
  ok('品质额外经验 = ' + wantBonus.join('/') + '（白→红，0 起算，与 Quality 同序）');
} else {
  no('TIER_BONUS = [' + bonus.join(', ') + ']，用户要的是 [' + wantBonus.join(', ') + ']');
}

// 曲线的两个端点（用户口径：1→2 要 100，49→50 要 1200；先在 2000，后改 1200）
const WANT_FIRST = 100;
const WANT_LAST = 1200;
if (FIRST === WANT_FIRST && LAST === WANT_LAST) {
  ok('升级经验曲线 ' + WANT_FIRST + '（1 级）→ ' + WANT_LAST + '（49 级）');
} else {
  no('曲线端点是 ' + FIRST + ' → ' + LAST + '，用户要的是 ' + WANT_FIRST + ' → ' + WANT_LAST);
}

// 复算一遍曲线（把 Java 里的公式在 JS 里重算，逐级核对单调 + 端点）
{
  const span = MAX - 2;
  const xpTo = (lvl) => (lvl >= MAX || lvl < 1 ? 0
    : FIRST + Math.round((LAST - FIRST) * (lvl - 1) / span));
  let mono = true;
  for (let l = 1; l < MAX - 1; l++) if (xpTo(l) > xpTo(l + 1)) mono = false;
  if (xpTo(1) === WANT_FIRST && xpTo(49) === WANT_LAST && xpTo(50) === 0 && mono) {
    ok('复算：每级所需经验随等级单调不降，1→2 要 ' + xpTo(1) + '，49→50 要 ' + xpTo(49));
  } else {
    no('升级曲线复算不对：' + xpTo(1) + ' / ' + xpTo(49) + ' / ' + xpTo(50) + ' 单调=' + mono);
  }
  let total = 0;
  for (let l = 1; l < MAX; l++) total += xpTo(l);
  const white = Math.ceil(total / (PER + wantBonus[0]));
  const red = Math.ceil(total / (PER + wantBonus[5]));
  console.log('   ℹ 1→50 共需 ' + total + ' 经验（约 ' + white + ' 条白鱼 / ' + red + ' 条红鱼）');
}

// ---------------------------------------------------------------- ② 评定点与材料
const gates = [...(new RegExp('GATE_LEVELS\\s*=\\s*\\{([^}]*)\\}').exec(lv) || [, ''])[1]
  .matchAll(/\d+/g)].map(Number).sort((a, b) => a - b);
if (JSON.stringify(gates) === JSON.stringify([10, 20, 30, 40])) {
  ok('评定点 = 10 / 20 / 30 / 40（每 10 级一次）');
} else {
  no('GATE_LEVELS = [' + gates.join(', ') + ']，应为 [10, 20, 30, 40] —— ' +
    '少一个都会让某个 10 级台阶永远过不去');
}
if (/nextGate[\s\S]{0,200}?return 0;/.test(lv)) {
  ok('nextGate 在 41 级及以上返回 0（"到 40 级突破完后不会出现评定任务"）');
} else {
  no('nextGate 没有"没有下一个评定"的返回 —— 41 级之后界面会一直显示还有评定');
}
// 材料表：用户逐条点名的四种组合
{
  const block = /GATES = Map\.of\(([\s\S]*?)\)\);/.exec(lv);
  if (!block) {
    no('找不到 GATES 材料表');
  } else {
    const parts = block[1].split(/(\d+)\s*,\s*List\.of\(/).slice(1);
    const got = new Map();
    for (let i = 0; i < parts.length; i += 2) {
      const lvl = Number(parts[i]);
      got.set(lvl, [...(parts[i + 1] || '').matchAll(
        /new Requirement\(\s*"([a-z_]+)"\s*,\s*([A-Z]+)\s*,\s*(\d+)\s*\)/g)]
        .map((m) => m[1] + '/' + m[2] + '/' + m[3]));
    }
    const want = new Map([
      [10, ['zander/GREEN/1']],
      [20, ['mullet/BLUE/1', 'zander/BLUE/1']],
      [30, ['zander/PURPLE/1', 'grass_carp/BLUE/1']],
      [40, ['juvenile_shark/GOLD/1', 'topmouth_culter/PURPLE/1']],
    ]);
    let same = got.size === want.size;
    for (const [lvl, rows] of want) {
      if (JSON.stringify(got.get(lvl)) !== JSON.stringify(rows)) {
        same = false;
        no('Lv.' + lvl + ' 的评定材料是 [' + (got.get(lvl) || []).join(', ') + ']，' +
          '用户要的是 [' + rows.join(', ') + ']');
      }
    }
    if (same) ok('四个评定点的材料与用户逐条点名的一致（绿梭鲈 / 蓝鲻鱼+蓝梭鲈 / 紫梭鲈+蓝草鱼 / 金幼鲨+紫翘嘴）');
  }
}

// ---------------------------------------------------------------- ③ 卡级不积攒经验
if (/gainXp\(int amount\)[\s\S]{0,200}?atGate\(\)[\s\S]{0,80}?return new Gain\(this, 0, 0\);/.test(pr)
    || /if \(amount <= 0 \|\| maxLevel\(\) \|\| atGate\(\)\)/.test(pr)) {
  ok('卡在评定点时 gainXp 直接返回（"不突破就卡在那一级，不积攒经验"）');
} else {
  no('gainXp 没有"卡级就一点经验都不收"的提前返回 —— 玩家会在 10 级白攒一堆经验');
}
if (/isGate\(lv\)/.test(pr) && /return new Gain\(new FishermanProgress\(lv, 0/.test(pr)) {
  ok('升级途中撞到评定点会停住，并**丢掉**多余经验（不留给突破之后）');
} else {
  no('升级循环里没有"撞到评定点就停住并清零"的分支 —— 多出来的经验会跨过评定点');
}
if (/while \(lv < AnglerLeveling\.MAX_LEVEL\)/.test(pr) && /cur -= need;/.test(pr)) {
  ok('一次给的经验可以连升多级（红鱼 58 点在 1 级能连跳几级）');
} else {
  no('gainXp 没有连升多级的循环 —— 低等级吃红鱼会白丢经验');
}
if (/breakthrough\(\)[\s\S]{0,200}?atGate\(\)[\s\S]{0,120}?level \+ 1/.test(pr)) {
  ok('突破只会从评定点推进一级（10→11 / 20→21 / 30→31 / 40→41）');
} else {
  no('breakthrough() 没有"只在评定点生效"的守卫 —— 可能被反复调用刷等级');
}
if (/stageFor\(int level\)[\s\S]{0,200}?1 \+ Math\.max\(0, level - 1\) \/ 10/.test(lv)) {
  ok('商店档位由等级推导（1+(level-1)/10：10 级仍是第 1 档，突破后才进第 2 档）');
} else {
  no('stageFor 不是 1+(level-1)/10 —— 档位和等级的对应关系变了，要同步检查器');
}

// ---------------------------------------------------------------- ④ 老存档迁移
if (/fieldOf\("stage"\)/.test(pr) && /levelFloorForStage\(legacyStage\)/.test(pr)) {
  ok('老存档迁移：读旧的 stage 并抬到对应等级（老玩家读档不会丢商店解锁）');
} else {
  no('CODEC 没有迁移旧的 stage 字段 —— 老存档读进来等级会是 1，商店全部锁回去');
}
if (/levelFloorForStage\(int stage\)[\s\S]{0,120}?\(Math\.max\(1, stage\) - 1\) \* 10 \+ 1/.test(lv)) {
  ok('迁移换算 = (档位-1)×10+1（档位 2 → 11 级，与 stageFor 互逆）');
} else {
  no('levelFloorForStage 的换算不是 (档位-1)×10+1 —— 迁移后档位会对不上');
}

// ---------------------------------------------------------------- ⑤ 接线：上鱼给经验
if (/FishermanData\.addXp\(player, gainedXp\)/.test(fm) && /xpForCatch\(tier\)/.test(fm)) {
  ok('上鱼时结算经验（FishingManager 调 AnglerData.addXp + AnglerLeveling.xpForCatch(tier)）');
} else {
  no('FishingManager 里没有接上经验结算 —— 等级永远停在 1 级（而且没有任何报错）');
}
if (/atGate\(\)/.test(fm) && /卡在 Lv\./.test(read(FM))) {
  ok('卡在评定时给玩家一句提示（否则会以为经验"钓了不涨"是 bug）');
} else {
  no('卡在评定时没有任何提示 —— 玩家会以为经验系统坏了');
}
if (/levelsUp > 0/.test(fm) && /垂纶等级提升/.test(read(FM))) {
  ok('升级时播报 + 音效');
} else {
  no('升级时没有任何反馈');
}

// ---------------------------------------------------------------- ⑥ 卖鱼提示（下一级突破任务）
if (/warningFor\(ItemStack stack, int level\)/.test(mat)) {
  ok('卖鱼提示按玩家等级判断（用户："卖鱼时提醒玩家下一级突破任务的鱼"）');
} else {
  no('ShopMaterials.warningFor 没有接收等级 —— 没法判断"下一级突破要什么鱼"');
}
if (/nextGate\(level\)/.test(mat) && /matchesGate\(/.test(mat)) {
  ok('提示看的是**下一次评定**的材料（并点名 Lv.N）');
} else {
  no('卖鱼提示没有用 nextGate/matchesGate —— 提示的不会是"下一级突破任务"的鱼');
}
if (/warningFor\(\s*s, ClientShopState\.level\(\)\)/.test(screen)) {
  ok('界面把玩家等级传进提示判断（用的是服务端同步过来的等级）');
} else {
  no('界面调 warningFor 时没传等级 —— 判断不了下一级要交什么');
}
if (/RED_TIER = [^;]*Quality\.RED\.ordinal\(\)/.test(mat)) {
  ok('红品质阈值由 Quality 推导（原来写死 6，红鱼提示从来没弹过）');
} else {
  no('红品质阈值又写成字面量了 —— 写 6 永远不会成立（品质只有 0~5）');
}

// ---------------------------------------------------------------- ⑦ 界面与服务端一致
if (/AnglerLeveling\.isGate\(ClientShopState\.level\(\)\)/.test(screen)) {
  ok('评定按钮只在"正好卡在评定点"时可点（和服务端判定同一条件）');
} else {
  no('界面没有用 isGate 判断按钮可点性 —— 会出现"点了没反应"');
}
if (/if \(gate == 0 \|\| !p\.atGate\(\)\)/.test(sm)) {
  ok('服务端在"不在评定点"时拒绝交付（客户端改包也交不了）');
} else {
  no('服务端没有"必须正好卡在评定点"的校验 —— 改个包就能提前突破');
}
if (/requirementsAt\(gate\)/.test(sm) && /describe\(r\)/.test(read(LV))) {
  ok('服务端收材料、界面显示要求都读同一张 GATES 表');
} else {
  no('服务端/界面的评定要求没有共用 GATES 表');
}

// ---------------------------------------------------------------- ⑧ 用户点名的两项数值
{
  const iron = /'iron:[^']*?'/.exec(gen);
  const diamond = /'diamond:[^']*?'/.exec(gen);
  const wt = (m) => (m ? Number(m[0].split(':')[3]) : null);
  // ⚠ 铁竿承重 25 → **30**（2026-10-08 用户改口）：他 10/06 调参时把铁竿改成 30 kg、
  //   档位上限改成 4，后来被一次配置重置冲掉；10/08 他明确要求"全部照搬"并烧进默认值。
  //   所以这里跟着改 —— 不是把断言删空，而是把"用户要的数"更新成他最后说的那个 ✗✗
  //   （旧断言写死 25，会让这次改动永远红着，久了就会有人来把它删掉）。
  if (wt(iron) === 30) ok('铁竿承重上限 = 30（用户 2026-10-08："我之前调参时把鱼竿数据改了…全部照搬"）');
  else no('铁竿承重是 ' + wt(iron) + '，用户 2026-10-08 定的是 30（原来是 25）');
  if (wt(diamond) === 50) ok('钻石竿承重上限 = 50（用户："钻石杆承重上限改到50"）');
  else no('钻石竿承重是 ' + wt(diamond) + '，用户要的是 50');
  const pct = intOf(sm, 'REPAIR_PERCENT');
  if (pct === 25 && /\* REPAIR_PERCENT \/ 100/.test(sm)) {
    ok('修竿收费 = 目录价 25%（用户："从 50% 变化为 25%"）');
  } else {
    no('修竿收费不是目录价的 25%（REPAIR_PERCENT = ' + pct + '）');
  }
}

// ---------------------------------------------------------------- ⑨ 加经验的指令（2026-10-12）
//
// 用户 2026-10-12："增加经验的指令"。
// 这一条最容易被写坏的地方**不是权限**，而是"绕开经验流水直接改等级"——
// 那样能造出正常游玩不可能出现的状态（例如跳过评定②却拿着 21 级、或者卡级时照样涨经验），
// 而且**不报错**，只会在很久以后被人发现"这个档的等级不对劲"。
{
  const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
  const cmd = code(CMD);
  const xp = /private static int giveXp\([\s\S]*?\n    \}/.exec(cmd);
  const fn = xp ? xp[0].replace(/\s+/g, ' ') : '';
  if (!/\.then\(lit\("xp"\)/.test(cmd)) {
    no('没有 `/atl xp` 指令 —— 用户 2026-10-12 要的"增加经验的指令"没落地');
  } else if (!xp) {
    no('找不到 giveXp(...) —— 加经验的实现不在');
  } else if (!/FishermanData\.addXp\(target, amount\)/.test(fn)) {
    no('加经验没有走 FishermanData.addXp ⇒ 它绕开了经验流水（可能直接改等级/跳过卡级规则）✗');
  } else if (/new FishermanProgress\(/.test(fn)) {
    no('加经验时直接 new FishermanProgress(...) 写回 ⇒ 绕开了 gainXp 的卡级与溢出规则 ✗');
  } else {
    ok('`/atl xp add` 走的是和钓鱼同一条经验流水（FishermanData.addXp ⇒ gainXp）✓');
  }
  // 卡评定点时必须说清"没吃下多少"，否则症状是"我加了 5000 经验怎么没动"
  //   ⚠ 判据要盯**那句计算**，不能只搜 `xpAccepted()`：文案里也调了它，
  //   把"没收下"整段短路掉之后（`boolean refused = false;`）名字还在 ⇒ 照样绿 ✗
  //   （负例 xp-silent-at-gate 第一次跑就是这么溜过去的 —— 第四次同一类：
  //    "文件里存在某字符串" ≠ "那件事真的在做"）。
  if (fn && /boolean refused = g\.xpAccepted\(\) < amount;/.test(fn)) {
    ok('回显里带**真正收下的点数**（卡在评定点时会明说没吃下多少）✓');
  } else {
    no('没有真的算"这一次收下了多少" —— 卡在评定点时玩家只会看到"加了经验却纹丝不动"✗');
  }
  // 改完等级/经验必须推客户端（FishermanProgress 没注册 .sync，不推就是"界面停在旧值"）
  if (fn && /ShopManager\.sync\(target\)/.test(fn)) {
    ok('改完经验把商店状态推给客户端（等级/经验显示不会停在旧值）✓');
  } else {
    no('改完经验没有 sync —— 界面上那个等级会停在旧值，而实际已经升了 ✗'
      + '（与鱼币那条同类的坑：数字看着一直很合理）');
  }
  // 权限：看数据（/atl xp）不加门槛，加经验（add）在 OP_ONLY 里
  const opBlock = /OP_ONLY\s*=\s*java\.util\.Set\.of\(([\s\S]*?)\);/.exec(cmd);
  const opListed = opBlock ? [...opBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  if (opListed.includes('add') && !opListed.includes('xp')) {
    ok('`add`（加经验）在 OP_ONLY 里，而 `/atl xp`（看进度）不加门槛 ✓');
  } else {
    no('经验指令的权限不对：加经验该要 OP，看进度不该要（AGENTS §六）');
  }
}

console.log('');
console.log(bad === 0
  ? '✅ 垂纶等级：经验/曲线/评定点/卡级/迁移/提示 全部就位'
  : '❌ 垂纶等级检查未通过（' + bad + ' 项）');
process.exit(bad ? 1 : 0);
