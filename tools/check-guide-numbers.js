/*
 * check-guide-numbers.js —— 手册里**写死的数字**必须和代码里的真值一致。
 *
 * 用户 2026-10-02（看到铁竿 tooltip 还是 20kg 的那张图）：
 *   "以后数值改动后记得改文本。"
 *
 * 这句话本身不能当机制用 —— "记得"是靠不住的。所以把它变成检查：
 * 手册（guide.json）里凡是复述了配置/常量数字的地方，都在这里逐条对账。
 *
 * 为什么这些数字特别容易漏：
 *   · 竿的承重来自 `tools/gen-gameplay-config.js` 的 ITEMS 表（→ Config.java），
 *     改了那里，手册里的"承重 20 kg"不会跟着变 —— 而**手册是玩家唯一的说明书**；
 *   · 等级/经验/评定材料在 `player/AnglerLeveling.java`；
 *   · 修竿收费比例在 `shop/ShopManager.java` 的 REPAIR_PERCENT。
 * 三处都是"改了一边、另一边静静地说着旧话"，而玩家会信手册。
 *
 * 用法：node tools/check-guide-numbers.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { stripComments } = require('./java-source.js');

console.log('=== 手册数字对账（改数值必须改文本）===\n');

const guideRaw = read('src/main/resources/data/anglertackle/guide/guide.json');
let guide;
try {
  guide = JSON.parse(guideRaw);
} catch (e) {
  no('guide.json 不是合法 JSON：' + e.message);
  process.exit(1);
}
/** 手册全文（用来做"某句话还在不在"的判断）。 */
const text = JSON.stringify(guide);
/** 一行行拆开，便于按行找数字。 */
const lines = [];
for (const c of guide.chapters) {
  for (const p of c.pages || []) {
    for (const l of p) lines.push(l);
  }
}

// ---------------------------------------------------------------- ① 五种竿的承重上限 + 路亚档位上限
{
  const gen = read('tools/gen-gameplay-config.js');
  // 'iron:铁竿:3500:30:0.10:...' —— 第 4 个数是承重，第 10 个是档位上限
  //
  // ⚠ 两套刻度的换算（踩过一次，所以写在断言里）：**档位上限是 1 起算**，
  //   而品质是 **0 起算**（白0…红5）—— 上限 3 显示出来是**紫**（Quality.of(3)），
  //   不是蓝。口径与 tools/dump-rods.js 的"档 3紫 → GOLD"、以及竿 tooltip
  //   里的 `Quality.of(spec.tier())` 完全一致。上限 6 = 不限，钳到红。
  const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];
  const rows = [...gen.matchAll(/'(\w+):([\u4e00-\u9fa5]+):(\d+):([\d.]+):([\d.]+):([\d.]+):([\d.]+):([\d.]+):([\d.]+):(\d+)'/g)]
    .map((m) => ({ id: m[1], cn: m[2], weight: Number(m[4]), tier: Number(m[10]) }));
  if (rows.length < 5) {
    no('解析不出 gen-gameplay-config.js 里的五档竿（' + rows.length + ' 条）—— 这条断言失效了');
  }
  // 手册里的写法："  铁竿    承重 30 kg    路亚上限 金档"
  const CN = { wood: '木竿', iron: '铁竿', gold: '金竿', diamond: '钻石竿', netherite: '合金竿' };
  for (const r of rows) {
    const cn = CN[r.id];
    if (!cn) { continue; }
    const line = lines.find((l) => l.includes(cn) && l.includes('承重'));
    if (!line) {
      no('手册里找不到「' + cn + ' … 承重」那一行 —— 竿的承重是玩家最需要知道的数字之一');
      continue;
    }
    const m = /承重\s*([\d.]+)\s*kg/.exec(line);
    if (!m) { no('手册里「' + cn + '」那行读不出承重：' + JSON.stringify(line)); continue; }
    const inGuide = Number(m[1]);
    if (inGuide === r.weight) {
      ok(cn + '：手册写 ' + inGuide + ' kg，配置真值 ' + r.weight + ' kg');
    } else {
      no(cn + '：手册写 ' + inGuide + ' kg，而配置里是 ' + r.weight + ' kg —— ' +
        '玩家会按手册的旧数字判断"这根竿能不能拉上来"');
    }

    // 路亚档位上限（用户 2026-10-08 把木/铁/金的上限一起改了：3 / 4 / 6）
    const tm = /路亚上限\s*([\u4e00-\u9fa5])档/.exec(line);
    const wantTier = TIER_NAME[Math.min(TIER_NAME.length - 1, Math.max(1, Math.round(r.tier)))];
    if (!tm) {
      no('手册里「' + cn + '」那行读不出路亚档位上限：' + JSON.stringify(line));
    } else if (tm[1] !== wantTier) {
      no(cn + '：手册写「路亚上限 ' + tm[1] + '档」，而配置里上限 ' + r.tier
        + ' = ' + wantTier + '档（档位上限 1 起算、品质 0 起算，别数错一格）');
    } else {
      ok(cn + '：手册写「路亚上限 ' + tm[1] + '档」，配置上限 ' + r.tier + ' 也对得上');
    }
  }
}

// ---------------------------------------------------------------- ② 等级 / 经验 / 评定点
{
  const lv = read('src/main/java/com/whitecobalt/anglertackle/player/AnglerLeveling.java');
  const num = (n) => {
    const m = new RegExp(n + '\\s*=\\s*(\\d+)').exec(lv);
    return m ? Number(m[1]) : null;
  };
  const MAX = num('MAX_LEVEL'), PER = num('XP_PER_CATCH');
  const FIRST = num('XP_FIRST'), LAST = num('XP_LAST');
  const bonus = [...(new RegExp('TIER_BONUS\\s*=\\s*\\{([^}]*)\\}').exec(lv) || [, ''])[1]
    .matchAll(/\d+/g)].map(Number);
  const gates = [...(new RegExp('GATE_LEVELS\\s*=\\s*\\{([^}]*)\\}').exec(lv) || [, ''])[1]
    .matchAll(/\d+/g)].map(Number);

  const check = (label, want, re) => {
    const line = lines.find((l) => re.test(l));
    if (!line) { no('手册里找不到「' + label + '」那一句（' + re + '）'); return; }
    const got = [...line.matchAll(/\d+/g)].map(Number);
    const hit = got.includes(want);
    if (hit) ok(label + '：手册写 ' + want + '（与 AnglerLeveling 一致）');
    else no(label + '：手册那句是 ' + JSON.stringify(line) + '，里面没有 ' + want
      + ' —— 数值改过之后手册没跟上');
  };
  check('满级 50', MAX, /等级 1 到/);
  check('每条鱼基础经验 10', PER, /基础 10 点|基础 10/);
  check('1 级升级经验 100', FIRST, /1 级只要/);
  check('49 级升级经验 1200', LAST, /49 级要/);
  // 品质额外经验（那一页写的是"白 +2 绿 +8 …"）
  {
    const page = lines.filter((l) => /白 \+/.test(l) || /紫 \+/.test(l)).join(' ');
    const got = [...page.matchAll(/\+\s*(\d+)/g)].map((m) => Number(m[1]));
    if (JSON.stringify(got) === JSON.stringify(bonus)) {
      ok('品质额外经验：手册 ' + got.join('/') + ' = 代码 ' + bonus.join('/'));
    } else {
      no('品质额外经验对不上：手册 [' + got.join('/') + ']，代码 [' + bonus.join('/') + ']');
    }
  }
  // 四个评定点与材料（手册里写 Lv.10 / Lv.20 …）
  for (const g of gates) {
    if (new RegExp('Lv\\.' + g + '\\b').test(text)) ok('手册写了评定点 Lv.' + g);
    else no('手册里没有 Lv.' + g + ' 这个评定点 —— 玩家不知道该在几级去交鱼');
  }
  // ⚠ 这里必须用 `(?!\d)` 卡住数字边界：「等级 1 到 5」是「等级 1 到 **50**」的前缀，
  //   不加这一条，正确的新标题会被判成旧说法（同一类"子串匹配误报"在这个仓库里
  //   已经出现过好几次 —— 误报会让人去改本来正确的文本）。
  if (/等级 1 到 5(?!\d)|2 级：绿品质/.test(text)) {
    no('手册里还留着旧的"等级 1 到 5"那套说法 —— 现在是 1–50 级');
  } else {
    ok('手册没有残留"等级 1 到 5"的旧说法');
  }
}

// ---------------------------------------------------------------- ③ 修竿收费比例
{
  const sm = read('src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java');
  const m = /REPAIR_PERCENT\s*=\s*(\d+)/.exec(sm);
  const pct = m ? Number(m[1]) : null;
  const line = lines.find((l) => /目录价的/.test(l));
  if (!line) {
    no('手册里没写修竿收费比例');
  } else if (new RegExp(pct + '\\s*%').test(line)) {
    ok('修竿收费：手册与 ShopManager.REPAIR_PERCENT 都是 ' + pct + '%');
  } else {
    no('修竿收费对不上：手册 ' + JSON.stringify(line) + '，代码是 ' + pct + '%');
  }
}

// ---------------------------------------------------------------- ④ 鱼种数量与图鉴奖励
//
// 用户 2026-10-02（截图）："本mod鱼类数量存在误报" —— 手册里写着"21 种"，
// 而 FishSpecies 里是 26 条。这条数字漂了整整 5 种，因为**没有任何断言守着它**：
// 承重、等级、修竿比例都有对账，鱼种数量漏了。
// 图鉴奖励同理：奖励是按"每 2 种 50 币"算的，鱼种数一变，
// "全部点亮共多少币"就跟着变 —— 手写的那一份必然过期。
{
  const sp = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
  const species = (sp.match(/new FishSpecies\("/g) || []).length;
  if (species < 10) {
    no('解析不出鱼种数量（只读到 ' + species + ' 条）—— 这条断言失效了，先修解析');
  } else {
    const cr = read('src/main/java/com/whitecobalt/anglertackle/economy/CodexRewards.java');
    const pick = (re) => { const m = re.exec(cr); return m ? Number(m[1]) : null; };
    const per = pick(/SPECIES_PER_MILESTONE\s*=\s*(\d+)/);
    const coins = pick(/COINS_PER_MILESTONE\s*=\s*(\d+)L?/);
    const maxM = pick(/MAX_MILESTONES\s*=\s*(\d+)/);
    if (!per || !coins || !maxM) {
      no('解析不出 CodexRewards 的里程碑参数（per=' + per + ' coins=' + coins + ' max=' + maxM + '）');
    } else {
      // 里程碑数封顶在 MAX_MILESTONES（int 位掩码放不下更多）
      const total = Math.min(maxM, Math.floor(species / per)) * coins;

      // ★ 2026-10-08 新增：鱼种数**不许超过位掩码能认的里程碑数**。
      //   真事：MAX_MILESTONES 原本是 15（= 30 种鱼），而第 1 批冷水鱼加完已经 33 种 ——
      //   第 31~33 种鱼点亮时**一个鱼币都不发**，没有报错、没有日志，
      //   玩家只会觉得"我图鉴都满了怎么没奖励"。这条把它变成一条会红的断言。
      //   另一半是位掩码本身的边界：claimedMilestones 是 int，第 31 位是符号位，
      //   所以 maxM 一旦 > 30 就会写成负数（表现同样是"奖励再也不发"）。
      const needM = Math.floor(species / per);
      if (needM > maxM) {
        no('鱼种 ' + species + ' 种需要 ' + needM + ' 个里程碑，而 MAX_MILESTONES 只有 ' + maxM
          + ' —— 第 ' + (maxM * per + 1) + ' 种以后点亮**不发鱼币**（静默故障：加鱼时必须一起抬这个上限）');
      } else if (maxM > 30) {
        no('MAX_MILESTONES = ' + maxM + ' 超过 30 —— claimedMilestones 是 int 位掩码，'
          + '第 31 位是符号位，会写成负数（表现是"奖励再也不发"）');
      } else {
        ok('里程碑上限够用：' + species + ' 种需要 ' + needM + ' 个，上限 ' + maxM
          + ' 个（覆盖 ' + (maxM * per) + ' 种）');
      }

      const want = [
        ['鱼的种数', '共 ' + species + ' 种鱼', /共\s*\d+\s*种鱼/],
        ['图鉴页的种数', '看 ' + species + ' 种的收集进度', /看\s*\d+\s*种的收集进度/],
        ['水族箱页的种数', species + ' 种鱼都能养', /\d+\s*种鱼都能养/],
      ];
      for (const [label, needle, re] of want) {
        if (text.includes(needle)) ok(label + '：手册写 ' + species + '（= FishSpecies 里 new FishSpecies 的条数）');
        else {
          const line = lines.find((l) => re.test(l));
          no(label + '对不上：手册那句是 ' + JSON.stringify(line || '（找不到）')
            + '，而 FishSpecies 里现在是 ' + species + ' 种');
        }
      }

      const coinNeedle = species + ' 种全部点亮共 ' + total + ' 鱼币';
      if (text.includes(coinNeedle)) {
        ok('图鉴满收集奖励：手册写 ' + total + ' 鱼币（' + species + ' ÷ ' + per + ' × ' + coins + '）');
      } else {
        const line = lines.find((l) => /全部点亮共/.test(l));
        no('图鉴满收集奖励对不上：手册那句是 ' + JSON.stringify(line || '（找不到）')
          + '，按现在的代码应当是 ' + coinNeedle);
      }
      const perNeedle = '每点亮 ' + per + ' 种发 ' + coins + ' 鱼币';
      if (text.includes(perNeedle)) ok('里程碑规则：手册写「' + perNeedle + '」= CodexRewards 的常量');
      else no('手册里没有「' + perNeedle + '」—— 里程碑参数改了要一起改');

      // 旧数字不许留：21 种 / 500 鱼币 都已经过期
      if (/21\s*种/.test(text)) no('手册里还留着「21 种」的旧说法 —— 现在是 ' + species + ' 种');
      else ok('手册里没有「21 种」的旧说法');
    }
  }
}

// ---------------------------------------------------------------- ⑤ 商店页签
//
// 页签是 ShopScreen.TABS 的**逐字复述**，加一个页签就容易漏（用户 2026-10-02
// 截图里那句"十个页签"就漏了「兑换」）。这里把 TABS 现读出来对账。
{
  const ss = read('src/main/java/com/whitecobalt/anglertackle/client/screen/ShopScreen.java');
  const m = /static final String\[\] TABS\s*=\s*\{([^}]*)\}/.exec(ss);
  if (!m) {
    no('解析不出 ShopScreen.TABS —— 这条断言失效了');
  } else {
    const tabs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const CN = { '竿': ['竿', '／竿'], '鱼线': ['鱼线'], '渔轮': ['渔轮'], '鱼钩': ['鱼钩'],
      '拟饵': ['拟饵'], '鱼饵': ['鱼饵'], '窝料': ['窝料'], '等级评定': ['等级评定'],
      '卖鱼': ['卖鱼'], '修杆': ['修杆'], '兑换': ['兑换'] };
    // 手册那一页把页签名按 "/" 连写，所以逐个找名字即可
    const page = lines.filter((l) => /页签/.test(l)).concat(
      lines.filter((l) => /^\/?\s*[竿鱼渔拟窝等卖修兑]/.test(l.trim()) && /[\/]/.test(l)));
    const pageText = page.join('\n');
    const missing = tabs.filter((t) => !pageText.includes(t));
    if (missing.length) {
      no('手册的页签说明少了这些页签：' + missing.join(' / ')
        + '（ShopScreen.TABS 里一共 ' + tabs.length + ' 个）');
    } else {
      ok('手册的页签说明覆盖了 ShopScreen.TABS 的全部 ' + tabs.length + ' 个页签');
    }
    // 数量词也要对：写"十个页签"而实际 11 个是这次被抓到的错
    const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五'];
    const wantWords = CN_NUM[tabs.length];
    const q = lines.find((l) => /个页签/.test(l));
    if (!q) no('手册里找不到"…个页签"那一句');
    else if (wantWords && q.includes(wantWords + '个页签')) ok('手册写「' + wantWords + '个页签」= TABS 的长度');
    else no('手册那句是 ' + JSON.stringify(q) + '，而 ShopScreen.TABS 有 ' + tabs.length + ' 个');
  }
}

// ---------------------------------------------------------------- ⑥ 卖鱼是"一条一条卖"
//
// 用户 2026-10-02（截图）："买鱼页其实只有点击要卖的鱼才会卖，不是说一次卖全背包。"
// 代码里 ShopManager.sell(player, slot) 的注释写得很清楚："一次只卖一条 …… 想全卖就多点几下"。
{
  const sm = read('src/main/java/com/whitecobalt/anglertackle/shop/ShopManager.java');
  const oneAtATime = /一次只卖一条/.test(sm);
  if (!oneAtATime) {
    no('ShopManager 里找不到"一次只卖一条"的说明 —— 卖鱼规则可能变了，这条断言要跟着改');
  } else {
    if (text.includes('一次卖光')) {
      const line = lines.find((l) => l.includes('一次卖光'));
      no('手册里还在说「一次卖光背包里的鱼」：' + JSON.stringify(line)
        + ' —— 实际是点哪一条卖哪一条，一次只卖一条');
    } else ok('手册没有"一次卖光"这个错说法（实际是点一条卖一条）');
    if (lines.some((l) => /点哪一条就卖哪一条|一次只卖一条/.test(l))) {
      ok('手册写清了"点哪一条卖哪一条"');
    } else {
      no('手册里没有写清卖鱼是"点哪一条卖哪一条"—— 玩家会以为一次全卖光');
    }
  }
}

// ---------------------------------------------------------------- ⑦ 鱼线耐久范围
{
  const mi = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
  // 鱼线段：register("xxx_line", () -> new TacklePartItem(Slot.LINE, partProps(耐久, ...)))
  const dur = [];
  for (const mm of mi.matchAll(/register\("(\w*line)",[\s\S]{0,220}?partProps\((\d+),/g)) {
    dur.push(Number(mm[2]));
  }
  if (dur.length < 5) {
    no('解析不出鱼线耐久（只读到 ' + dur.length + ' 条）—— 这条断言失效了');
  } else {
    const lo = Math.min(...dur), hi = Math.max(...dur);
    const line = lines.find((l) => /鱼线耐久只有/.test(l));
    if (!line) no('手册里找不到"鱼线耐久只有…"那一句');
    else if (new RegExp(lo + '~' + hi).test(line)) ok('鱼线耐久：手册写 ' + lo + '~' + hi + ' = ModItems 里的 ' + dur.join('/'));
    else no('鱼线耐久对不上：手册 ' + JSON.stringify(line) + '，代码里是 ' + lo + '~' + hi);
  }
}

// ---------------------------------------------------------------- ⑧ 高质吸引：宝箱专属 ⇄ 商店在售
//
// 老前提（2026-10-02）：它是**宝箱专属**，商店兑换表里没有它 ⇒ 手册不许说"能兑换"。
// ⚠ 2026-10-13 用户定了新口径（`docs/39` §4.1）：**联赛商店 500 积分换一本「高质吸引 III」**，
//   于是这条断言从"单向"变成"**两分支**"——判据跟着**库存事实**走，两边都不许写反 ✓：
//   · 商店**有** ⇒ 手册必须写明"联赛商店有售"，且**不许**再写"兑换不到/不在商店/宝箱专属"；
//   · 商店**没有** ⇒ 回到老判据（手册不许把它说成兑换物）。
{
  const rules = read('tools/shop-rules.js');
  const inShop = /LEAGUE_OFFERS[\s\S]*high_quality/i.test(rules);
  const hi = lines.find((l) => /高质吸引/.test(l));
  if (inShop) {
    if (!hi) {
      no('手册里找不到「高质吸引」那一句 —— 联赛商店已经能换了，手册必须写明（`docs/39` §4.1）');
    } else if (/兑换不到|不在商店|宝箱专属/.test(hi)) {
      no('手册还在说「高质吸引」兑换不到/宝箱专属：' + JSON.stringify(hi)
        + ' —— 联赛商店 500 积分已经能换（改动要连文本一起改）✗');
    } else {
      ok('「高质吸引」在联赛商店有售，手册那句也跟着改了 ✓');
    }
  } else if (lines.some((l) => /高质吸引/.test(l) && /红档|兑换|三件套/.test(l)
      && !/不在商店|宝箱|开箱|掉落/.test(l))) {
    no('手册把「高质吸引」说成能兑换/在红档里：'
      + JSON.stringify(lines.find((l) => /高质吸引/.test(l))) + ' —— 它是宝箱专属，商店里换不到');
  } else {
    ok('手册没有把「高质吸引」说成商店兑换物（它是宝箱专属）');
  }
}

// ---------------------------------------------------------------- ⑨ 改装界面怎么打开
//
// 用户 2026-10-02："按 z 其实不能改装，干脆删了这个功能"。
// 现在唯一的入口是"潜行 + 松开右键"，而它**必须**和 ClientEvents 里的检测一致 ——
// 手册写了一个玩家按不出来的键，比不写还糟。
{
  // ⚠ 必须剥注释再查：ClientEvents 里正留着一段"这里原来有个按 Z 的入口"的说明
  //   （解释为什么删的），不剥注释会把它自己判成"Z 键还在"。
  //   这个仓库已经为"注释里提到某个名字"误报过好几次了。
  const ce = stripComments(read('src/main/java/com/whitecobalt/anglertackle/client/ClientEvents.java'));
  const hasSneak = /isShiftKeyDown\(\)\s*&&\s*wasUsingItem\s*&&\s*!usingNow/.test(ce);
  const hasKey = /OPEN_ROD_MOD|consumeClick\(\)/.test(ce);
  const modKeysExists = fs.existsSync(path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/client/ModKeys.java'));

  if (hasSneak) ok('ClientEvents 里"潜行 + 松开右键"的检测在（这是现在唯一的入口）');
  else no('ClientEvents 里找不到"潜行 + 松开右键"的检测 —— 手册写的入口就没了');

  if (!hasKey && !modKeysExists) ok('Z 键入口已经删干净（ClientEvents 里没有按键检测，ModKeys.java 也不在了）');
  else no('Z 键没删干净：' + (hasKey ? 'ClientEvents 里还有按键检测 ' : '')
    + (modKeysExists ? 'ModKeys.java 还在' : ''));

  if (/按\s*Z|按Z|Z\s*键/.test(text)) {
    const line = lines.find((l) => /按\s*Z|按Z|Z\s*键/.test(l));
    no('手册里还在教玩家"按 Z"：' + JSON.stringify(line) + ' —— 那个入口已经删了，按了没反应');
  } else ok('手册里没有"按 Z"这个已经不存在的操作');

  if (lines.some((l) => /潜行/.test(l) && /松开右键|松手/.test(l))) {
    ok('手册写清了开六槽界面的方法（潜行 + 松开右键）');
  } else {
    no('手册里没有"潜行 + 松开右键"的说明 —— 那玩家就不知道怎么打开六槽界面了');
  }

  // 卸载配件：RodModScreen 每行有「卸」按钮，手册必须说清"点它会取下来、回背包"
  const rms = read('src/main/java/com/whitecobalt/anglertackle/client/screen/RodModScreen.java');
  if (/ACTION_UNEQUIP/.test(rms) && /"卸"/.test(rms)) {
    // ⚠ 断言要具体到"卸 = 取下来，回背包"这个意思。只查"手册里有没有『卸』字"
    //   太松：那句"想让竿空着就用六槽界面的「卸」"也含"卸"，
    //   于是把说明整段删掉、只留这一句，断言照样绿（负例就是这么发现它的）。
    if (lines.some((l) => /卸/.test(l) && /回背包|取下来/.test(l))) {
      ok('手册写清了怎么卸载配件（六槽界面的「卸」→ 取下来、回背包）');
    } else {
      no('手册没写清怎么把配件从竿上卸下来（要点名「卸」按钮 + 配件回背包）—— 用户点名要补这一条');
    }
  } else {
    no('RodModScreen 里找不到「卸」按钮（ACTION_UNEQUIP）—— 这条断言要跟着改');
  }
}

// ---------------------------------------------------------------- ⑩ 鱼名错字
//
// 用户 2026-10-02 查文本漏洞时发现的：mullet = **鲻鱼**（Mugil cephalus），
// 而语言文件里一直写着「淄鱼」（淄 = 淄博的淄），手册第六章跟着错，
// 可手册第九章与 FishWaters 的习性表里写的又是对的 —— 同一个包里两种写法。
// 语言文件是鱼名的**唯一数据源**（生成器从它读中文名灌进 Config 的注释），
// 所以盯住这一处就够。
{
  const zh = read('src/main/resources/assets/anglertackle/lang/zh_cn.json');
  if (zh.includes('淄鱼')) {
    no('语言文件里还有错字「淄鱼」—— mullet 的正名是「鲻鱼」，'
      + '它同时会灌进 Config 的注释与调参器（生成器从语言文件读中文名）');
  } else ok('语言文件里的鱼名是「鲻鱼」（不是错字「淄鱼」）');
  if (text.includes('淄鱼')) {
    const line = lines.find((l) => l.includes('淄鱼'));
    no('手册里还有错字「淄鱼」：' + JSON.stringify(line));
  } else ok('手册里没有错字「淄鱼」');
}

// ---------------------------------------------------------------- ⑫ 台钓竿没有品质上限
//
// 用户 2026-10-02："取消台钓的档位上限机制并同步文本。"
// 起因是洞穴水域那次塌方：铁竿（上限蓝 2）+ 秘制窝（下限蓝 2）时，
// 洞穴的台钓鱼是"白绿 / 紫红"两个极端，中间没有蓝档 → 池子空了 →
// 退回不限水体 → 在洞里钓出草鱼青鱼。
// 取消之后：台钓竿能钓到什么只看水体与饵/窝；路亚竿**保留**上限
// （它的材质阶梯与拟饵档位是配套的一条进度线）。
{
  const sess = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java');
  const rod = read('src/main/java/com/whitecobalt/anglertackle/item/RodItem.java');
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));

  // ① 代码：台钓竿放开到 5
  if (/RodType\.FLOAT\)\s*\{\s*return 5;/.test(sess)) {
    ok('台钓竿的档位上限已取消（FishingSession.maxTier 对台钓恒返回 5）');
  } else {
    no('FishingSession.maxTier 里没有把台钓竿放开到 5 —— 台钓竿仍然受材质上限限制');
  }
  // ② 路亚竿必须**保留**（用户只说取消台钓的）
  if (/return rodItem\.spec\(\)\.tier\(\);/.test(sess)) {
    ok('路亚竿仍按材质限制档位（保留上限）');
  } else {
    no('路亚竿的档位上限也没了 —— 用户只要求取消台钓的');
  }

  // ③ 手册必须说清这件事
  if (lines.some((l) => /台钓竿没有品质上限|台钓竿没有这个上限/.test(l))) {
    ok('手册说明了「台钓竿没有品质上限」');
  } else {
    no('手册没说台钓竿没有品质上限 —— 玩家还会拿材质上限当"我钓不到红鱼"的依据');
  }
  if (lines.some((l) => /路亚上限|路亚竿.*上限/.test(l))) {
    ok('手册说明了品质上限只对路亚竿生效');
  } else {
    no('手册没说"品质上限只限路亚竿" —— 取消范围会被误解成"所有竿都没上限"');
  }
  // ④ 旧写法不许留：以前那张表写的是"上限绿档"（无空格）
  if (/上限(绿|蓝|紫|金|红)档/.test(text)) {
    const line = lines.find((l) => /上限(绿|蓝|紫|金|红)档/.test(l));
    no('手册里还留着"上限X档"的老写法：' + JSON.stringify(line)
      + ' —— 那是"所有竿都有上限"时代的说法，现在只限路亚');
  } else {
    ok('手册里没有"上限X档"的旧写法');
  }

  // ⑤ tooltip 也要分竿型
  if (/tooltip\.anglertackle\.no_tier_cap/.test(rod) && /type == RodType\.LURE/.test(rod)) {
    ok('台钓竿 tooltip 走 no_tier_cap、路亚竿才显示品质上限');
  } else {
    no('RodItem 的 tooltip 没按竿型分开 —— 台钓竿会显示一个已经不存在的上限');
  }
  for (const [lang, name] of [[zh, '中'], [en, '英']]) {
    if (lang['tooltip.anglertackle.no_tier_cap']) ok(name + '文有 no_tier_cap 这一行');
    else no(name + '文缺 tooltip.anglertackle.no_tier_cap —— tooltip 会显示成键名');
  }
}

// ---------------------------------------------------------------- ⑪ 不许再提已经删掉的东西
for (const [word, why] of [
  ['追踪罗盘', '追踪罗盘已经删了，改成一次性的「渔夫小屋定位线索」'],
  ['指南针', '手册里让玩家"配个指南针"找小屋 —— 现在是定位线索'],
  ['认证与晋级', '旧说法，现在叫垂纶等级与评定'],
]) {
  if (text.includes(word)) no('手册里还在说「' + word + '」—— ' + why);
}
if (!/追踪罗盘|指南针|认证与晋级/.test(text)) ok('手册里没有已删除/已改名的旧说法');

// ---------------------------------------------------------------- ⑨ 环境（时段/天气/月相）那一章
//
// 2026-10-03 新增第十三章「什么时候去钓」—— 它告诉玩家"什么时候去"，
// 里面的每个数字都能在 Config 里找到出处，所以照样逐条对账。
{
  const when = (guide.chapters || []).find((c) => c.id === 'when');
  if (!when) {
    no('手册里没有「什么时候去钓」那一章（id=when）—— 图鉴刚加了「出没」列，手册得讲它');
  } else {
    const whenText = when.pages.flat().join('\n');
    const configSrc = stripComments(read('src/main/java/com/whitecobalt/anglertackle/Config.java'));
    const caps = [
      ['时段 +10', /时段加成上限[\s\S]{0,40}?\+(\d+)/, 'envTimeDeltaPct'],
      ['天气 +10', /天气加成上限[：:]\s*\+(\d+)/, 'envWeatherDeltaPct'],
      ['月相 金红 +5', /金红鱼合计 ≤ \+(\d+)/, 'envMoonGoldRedDeltaPct'],
      ['月相 紫 +15', /紫鱼合计\s*≤ \+(\d+)/, 'envMoonPurpleDeltaPct'],
    ];
    for (const [label, re, key] of caps) {
      const m = re.exec(whenText);
      const cm = new RegExp(key + ' = b\\.comment\\([\\s\\S]{0,220}?\\.defineInRange\\("[^"]+", ([0-9.]+)D')
        .exec(configSrc);
      if (!cm) { no('Config 里读不出 ' + key + ' 的默认值 —— 这条断言失效了'); continue; }
      if (!m) { no('手册「什么时候去钓」里找不到「' + label + '」那一句'); continue; }
      const inGuide = Number(m[1]);
      const inCode = Number(cm[1]);
      if (inGuide !== inCode) {
        no('手册写「' + label + '」= ' + inGuide + '，而 Config 的 ' + key + ' 默认是 ' + inCode);
      } else ok('手册「' + label + '」与 Config.' + key + ' 一致（' + inCode + ' 点）');
    }
    const slots = ['清晨', '白天', '黄昏', '夜晚'];
    const lack = slots.filter((s) => !whenText.includes(s));
    if (lack.length) no('手册「什么时候去钓」缺时段：' + lack.join('、'));
    else ok('手册写全了四个时段（清晨/白天/黄昏/夜晚）');
    if (!/雷暴[\s\S]{0,20}按雨天算/.test(whenText)) {
      no('手册没写「雷暴按雨天算」—— 玩家会以为打雷时那些鱼不咬钩');
    } else ok('手册写清了「雷暴按雨天算」');
    if (!/出没/.test(whenText)) no('手册没提图鉴的「出没」列 —— 两处要互相指路');
    else ok('手册指向了图鉴的「出没」列');
  }
}

// ---------------------------------------------------------------- ⑩ 手册里提到的 /atl 命令必须真的存在
//
// 这一条是**自己踩出来的**：写第十三章时我随手写了 `/atl env` 与 `/atl fish`，
// 而这两个子命令压根不存在（真实的只有 shop/talk/stage/resetstock/rod/pool/config/coins/codex/repair）。
// 手册里写一条敲不出来的命令，比不写更糟 —— 玩家会以为是自己打错了。
{
  const cmdSrc = read('src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java');
  // ⚠ 2026-10-11：子指令改成统一走 `lit("…")` ⇒ 收名单要同时认两种写法，
  //   否则"真实的有：atl"这种假红会把整条断言变成噪音（手册明明是对的）。
  const real = new Set([...cmdSrc.matchAll(/(?:lit|Commands\.literal)\("([a-z]+)"\)/g)].map((m) => m[1]));
  const mentioned = new Set([...text.matchAll(/\/atl\s+([a-z]+)/g)].map((m) => m[1]));
  const fake = [...mentioned].filter((c) => !real.has(c));
  if (mentioned.size === 0) {
    no('手册里一条 /atl 命令都没提 —— 这条断言失效了（本该有几条）');
  } else if (fake.length) {
    no('手册里提到了不存在的 /atl 子命令：' + fake.map((c) => '/atl ' + c).join('、')
      + '（真实的有：' + [...real].sort().join('/') + '）');
  } else {
    ok('手册提到的 ' + mentioned.size + ' 个 /atl 子命令都存在（' + [...mentioned].sort().join('/') + '）');
  }
}

// ---------------------------------------------------------------- ⑬ 新增三章：称号 / 联赛 / 比赛
//
// 2026-10-12 加的三章（`docs/38` T5、`docs/37` L5、`docs/35` M2-4 都要的那一章）。
// 它们的共同点：**讲的全是配置里的数字** ⇒ 数字改一次、手册就必须跟着改一次，
// 所以每一条都从源码/配置里现读出来对账，而不是"我抄一遍数字"。
{
  const titleDefs = read('src/main/java/com/whitecobalt/anglertackle/title/TitleDefs.java');
  const ids = [...stripComments(titleDefs).matchAll(/new Def\("([a-z_0-9]+)"/g)].map((m) => m[1]);
  const cfgSrc = stripComments(read('src/main/java/com/whitecobalt/anglertackle/Config.java'));
  // 配置默认值：`defineInRange("键", 默认, …)` / `define("键", 默认)`
  const def = (key) => {
    const m = new RegExp('\\.(?:defineInRange|define)\\("' + key + '",\\s*([0-9.]+)').exec(cfgSrc);
    return m ? Number(m[1]) : null;
  };
  const chapterText = (id) => {
    const c = (guide.chapters || []).find((x) => x.id === id);
    return c ? c.pages.flat().join('\n') : null;
  };

  const titles = chapterText('titles');
  const league = chapterText('league');
  const contest = chapterText('contest');
  for (const [id, txt] of [['titles', titles], ['league', league], ['contest', contest]]) {
    if (!txt) no('手册里缺「' + id + '」这一章 —— 新系统上线就要有对应的那一章');
  }

  // ① 称号：个数与代码现数
  if (titles && ids.length) {
    if (titles.includes('共 ' + ids.length + ' 个称号')) {
      ok('手册「称号」章的个数 = TitleDefs 里现数的 ' + ids.length + ' 个');
    } else {
      const line = titles.split('\n').find((l) => /个称号/.test(l));
      no('手册「称号」章的个数对不上：那句是 ' + JSON.stringify(line)
        + '，而 TitleDefs 里是 ' + ids.length + ' 个');
    }
    // 佩戴入口：界面 + 指令（两条都要有 —— 用户当初就是"找不到在哪戴"）
    for (const [label, re] of [['界面入口', /\/atl title\b(?!\s)/], ['图鉴按钮', /图鉴[\s\S]{0,20}称号/],
      ['摘下来', /use none|摘掉/]]) {
      if (re.test(titles)) ok('手册「称号」章写了' + label);
      else no('手册「称号」章没写' + label + ' —— 用户当初的原话就是"称号佩戴在哪，很难发现"');
    }
    if (!/没佩戴[\s\S]{0,20}逐字不变|逐字不变/.test(titles)) {
      no('手册没说"没佩戴的人聊天逐字不变"—— 玩家会担心这个功能动了所有人的聊天');
    } else ok('手册说明了"没佩戴称号的人聊天逐字不变"（纯加法）');
  }

  // ② 联赛：资格线 / 窗口 / 硬截止 / 推送间隔 / 冠军奖励
  if (league) {
    const want = [
      ['资格线 Lv.21', 'minLevel', (v) => new RegExp('Lv\\.' + v + '\\b').test(league)],
      ['每人窗口 30 游戏分钟', 'playerWindowMinutes', (v) => new RegExp(v + ' 游戏分钟').test(league)],
      ['硬截止 5 游戏日', 'periodGameDays', (v) => new RegExp(v + ' 游戏日').test(league)],
      ['小型间隔 7 天', 'smallDays', (v) => new RegExp('每 ' + v + ' 天').test(league)],
      ['冠军 10000 鱼币', 'rewardCoins1st', (v) => new RegExp(' ' + v + ' \\+').test(league)],
      ['冠军 1200 经验', 'rewardXp1st', (v) => league.includes(String(v) + ' 经验')],
      ['签收礼 500 币', 'rewardCoinsParticipant', (v) => league.includes(String(v) + ' 鱼币')],
    ];
    for (const [label, key, check] of want) {
      const v = def(key);
      if (v === null) { no('Config 里读不出 ' + key + ' 的默认值 —— 这条断言失效了'); continue; }
      if (check(v)) ok('手册「联赛」章的' + label + '与配置一致（' + v + '）');
      else no('手册「联赛」章的' + label + '对不上（配置默认 ' + v + '）—— 数字改了要连文本一起改');
    }
    if (!/一尾都没上[\s\S]{0,20}没有名次奖|没有名次奖/.test(league)) {
      no('手册没写"一尾都没上就没有名次奖"—— 玩家会以为签收保底');
    } else ok('手册写清了"一尾都没上就没有名次奖"（防只签收不参赛）');
  }

  // ③ 比赛：默认时长 / 三名奖励 / 无参加奖 / 界面页
  if (contest) {
    const want = [
      ['默认 30 分钟', 'defaultMinutes', (v) => new RegExp('默认 ' + v + ' 分钟|' + v + ' 分钟、最重一尾').test(contest)],
      ['第 1 名 300 鱼币', 'rewardFirst', (v) => new RegExp('第 1 名 ' + v + ' 鱼币').test(contest)],
      ['第 2 名 150 鱼币', 'rewardSecond', (v) => new RegExp('第 2 名 ' + v + ' 鱼币').test(contest)],
      ['第 3 名 80 鱼币', 'rewardThird', (v) => new RegExp('第 3 名\\s*' + v + ' 鱼币').test(contest)],
      // ⚠ 这一条**不许**写成 `contest.includes(String(v))`：默认值是 0，
      //   任何一句"30 分钟"里都含 "0" ⇒ 断言永远成立、等于没写 ✗
      //   （同一天里第 N 次栽在"太松的判据"上，所以这里盯**整句话**）。
      ['自动开赛默认值', 'autoEveryMinutes', (v) => new RegExp('默认是 ' + v + ' = 只手动开').test(contest)],
      ['自动开赛示例 1440', null, () => /1440/.test(contest)],
    ];
    for (const [label, key, check] of want) {
      const v = key === null ? null : def(key);
      if (key !== null && v === null) { no('Config 里读不出 ' + key + ' 的默认值 —— 这条断言失效了'); continue; }
      if (check(v)) ok('手册「比赛」章的' + label + '与配置一致（' + (key === null ? '示例值' : v) + '）');
      else no('手册「比赛」章的' + label + '对不上（配置默认 ' + v + '）');
    }
    if (!/没有参加奖/.test(contest)) no('手册没说"没有参加奖"—— 玩家会问为什么第四名没钱');
    else ok('手册写明了"没有参加奖"（防小号挂着）');
    if (!/全员自动参加/.test(contest)) no('手册没写"全员自动参加"—— 玩家会到处找报名按钮');
    else ok('手册写明了"全员自动参加，不用报名"');
    if (!/本场比赛/.test(contest)) no('手册没提排行榜界面的「本场比赛」页');
    else ok('手册指向了排行榜界面的「本场比赛」页');
  }
}

console.log('');
console.log(bad === 0
  ? '✅ 手册里复述的每个数字都与代码一致'
  : '❌ 手册与代码不一致（' + bad + ' 项）—— 改数值的时候要连文本一起改');
process.exit(bad ? 1 : 0);
