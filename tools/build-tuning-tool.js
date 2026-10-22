// 从 Config.java 生成调参工具（调参器.html）。
//
// 为什么字段表自动生成而不是手写：
//   手写的表一旦 Config.java 增删项目就会漂移 —— 工具会显示不存在的选项、
//   或者漏掉新选项。那种工具比没有更坏（改了没反应，还以为改上了）。
//
// 模板在 tools/tuning-tool.template.html，含 __SCHEMA__ / __GROUP_META__
// 两个占位符，这里替换成从 Config.java 抽出来的真实数据。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

const schemaPath = path.join(__dirname, 'tuning-schema.json');
if (!fs.existsSync(schemaPath)) {
  console.error('缺少 tools/tuning-schema.json，先跑 node tools/gen-tuning-schema.js');
  process.exit(1);
}
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// 界面分组标题与说明（工具侧文案，不是 mod 配置）
const GROUP_META = {
  cast: { title: '抛投', desc: '蓄力条显示节奏。抛投距离已改为视角控制（低头近 / 平视中 / 抬头远），不在这里调。' },
  hookWindow: { title: '提竿窗口', desc: '浮漂沉下去之后，你有多久时间按左键提竿。' },
  tension: { title: '张力模型', desc: '核心手感。收线涨多快、放线落多快、白黄红三区在哪。whiteMax / yellowMax 是相对「基准 100」的百分比。' },
  bite: { title: '咬钩等待', desc: '抛出去到鱼咬钩要等多久。' },
  environment: {
    title: '时间 / 天气 / 月相',
    desc: '环境只改「水里此刻有哪些鱼愿意咬钩」，不改咬钩节奏（唯一例外是夜里台钓那 10%）。'
      + '三个 delta 是**上限**：受加成那一组鱼的占比最多提升这么多个百分点，倍率由池子反解得出'
      + '（不是固定倍率 —— 写死倍率对不上"50/50 → 40/60"这个基线）。'
      + '只加不减：组外鱼的权重一个都不动，它们占比下降只是归一化的结果。',
  },
  parts: { title: '配件属性合成', desc: '六槽配件的属性怎么合成。权重决定「某项属性由谁主导」，上限防止数值失控。' },
  chum: { title: '打窝', desc: '窝子的半径（就是白圈的半径）与粒子表现。' },
  titles: {
    title: '称号门槛',
    desc: '称号的获得门槛与聊天后缀模式（用户 2026-10-11：「这些数字全部进配置，不写死在代码里」）。'
        + '⚠ 有一类数字**不在这里**，因为它们不该被调：「金鳞全录」要求「所有能出金的鱼种都出过金」，'
        + '那个种数是从 FishSpecies 当场数出来的（47 种里有 17 种的档位上限只到紫），'
        + '写死就会出现永远拿不到的条件。',
  },
  durability: { title: '耐久', desc: '每次咬钩扣多少。渔轮和鱼钩没有耐久上限，天然不参与扣除。' },
  mail: {
    title: '邮件箱',
    desc: '保管期 / 条数上限 / 服主正文长度 / 未读提示（用户 2026-10-11 点名要的邮件系统，docs/36）。'
        + '⚠ 保管期是**现实天**；过期只作废附件、正文保留；到上限是**拒绝投递**，不是挤掉最旧的。',
  },
  league: {
    title: '联赛',
    desc: '周期与奖励（用户 2026-10-11 定案的联赛，docs/37）。'
        + '⚠ 三条别调错：**硬截止与每人窗口永远是游戏时间**（服务器停机期间不走表）；'
        + '三级间隔只决定「多久推一次邀请」，一期永远是「推送 + 硬截止」；'
        + '可刷的两项（最短上鱼 / 连击）**不在计分口径里**。'
        + '⚠ 改了 clockMode 或 rule 只影响**下一期**（本期口径在开期时钉死在存档里）。',
  },
  contest: {
    title: '比赛',
    desc: '一场 30 分钟的限时赛（用户 2026-10-11 定案，docs/35）。'
        + '⚠ 三条别调错：时长按**服务器运行时间**算（停机不走表）；'
        + '赛制与时长在**开赛时钉死**（中途改只影响下一场）；'
        + '奖励只发前三名、**没有参加奖**（防开小号挂着）。'
        + '自动开赛默认关闭（autoEveryMinutes = 0，只手动）。',
  },
  quest: {
    title: '委托（老柯的每日 / 周常）',
    desc: '每日 / 周常委托（用户 2026-10-14 定案，docs/40）。'
        + '⚠ 三条别调错：**日界按游戏内时刻**（getDayTime 的日序号，天明换天 —— 不是 tick 计数，'
        + '否则会在半夜刷委托）；**周常的难度上限压在金色**（红档一概不出现：玩家可能还没升等级、'
        + '连钻石竿都没有）；做完一条的活跃度**在寄出奖励信那一刻就记**（不等玩家点领取，'
        + '否则奖励信过期作废后活跃度就再也补不回来）。'
        + '另外「每天可接几条」与「池子有几种」是两件事：可接 5 条、池子至少 8 种才有随机感'
        + '（池子掉到 8 以下 check-quest.js 会判红）。',
  },
  partsStats: {
    title: '配件数值（逐件）',
    // ⚠️ 这一组是**只读记录**，不是可调项。原因见下面 desc，也见
    // tools/check-no-config-at-registration.js 顶部的完整说明。
    readonly: true,
    desc: '⚠ 这一组只用来**查看**，改了不会有任何效果 —— 所以界面里做成了灰色不可调。'
        + '原因：配件属性是物品注册时（RegisterEvent 阶段）烘进 PART_STATS 数据组件的，'
        + '而那一刻配置还没加载（在物品定义里读配置会让游戏启动直接崩溃，已经踩过）。'
        + '运行期 RodStats 读的是物品上的组件，不是配置文件，所以这 79 项改不动。'
        + '想调配件手感请用上面的「配件属性合成」那一组 —— 它是 PartComposer 在运行期读的，'
        + '改完 /atl config reload 立刻生效。',
  },
  fishStats: {
    title: '鱼种数值（逐条）',
    desc: '每条鱼自己的 13 个数值：体重上下限、拉力（不挣扎 / 疲劳期）、体力上限、张力涨速、'
        + '冲刺时长与间隔、变向间隔、假动作概率、进疲劳的体力比例、疲劳持续、不挣扎时回气。'
        + '改完 /atl config reload 即生效，且**只影响之后咬钩的鱼**——正在遛的那条用的是'
        + '咬钩瞬间的快照，不会中途变手感。'
        + '这一组由 tools/gen-fish-config.js 从 FishSpecies.java 生成，勿手改 Config.java 对应段落。',
  },
  gameplay: {
    title: '玩法数值（全局）',
    desc: '决胜手感的那些系数，原本写死在代码里，现在都能调：'
        + '① 鱼竿五种材质的承重 / 提竿窗口加成 / 张力上限与回复 / 体力削减 / 耐久损耗 / 品质档位上限；'
        + '② 张力模型（张力上限基准、冲刺拉拽、反向控杆奖惩、收线保底涨势、阻尼折算、拉干阈值、近岸距离）；'
        + '③ 档位曲面（每档游速与体力抗性的底数、疲劳期倍率、挣扎与休息秒数）；'
        + '④ 抛投蓄力与窝料滞空；⑤ 超重鱼的处理方式。'
        + '改完 /atl config reload 即生效。⚠ 这些是全局系数，动一项全表手感都会跟着变，建议一次只调一项。',
  },
  render: { title: '渲染', desc: '远处鱼线的简化阈值。' },
};

// 少写一个分组的文案不会报错，只会让调参器里那一组没有标题和说明 ——
// 玩家会以为"这组是坏的"。这里直接拦下。
const missing = schema.groups.filter((g) => !GROUP_META[g.id]).map((g) => g.id);
if (missing.length) {
  console.error('❌ 分组缺文案: ' + missing.join(', '));
  console.error('   在 tools/build-tuning-tool.js 的 GROUP_META 里补上 title / desc');
  process.exit(1);
}

// ★ 2026-10-10 用户要求：调参界面里每条鱼要能看到它的**全部品质档**（判断数值时的依据 ✓）。
//
//   做法：把品质写进标签的**对象括号内** —— `鲫鱼（crucian_carp，品质 白~绿） · 拉力（不挣扎）`。
//   ⚠ 绝不能新增一个 " · " 分隔符：调参器的「同对象 / 同属性」批量选择是按 " · " 切分标签的
//     （见下面 LABEL_REQUIRED 那段说明），多一个分隔符会让两个下拉**变空且不报错** ✗。
//   信息源是 FishSpecies.java 自己（经 simulate-fight.loadFish() 的 tierList），不是第二份手抄表 ✓。
let tierAdded = 0;
try {
  const S = require(path.join(__dirname, 'simulate-fight.js'));
  const CN = ['白', '绿', '蓝', '紫', '金', '红'];
  const qualityOf = new Map(S.loadFish().map((f) => [
    f.id,
    f.tierList.slice().sort((a, b) => a - b).map((t) => CN[t]).join('~'),
  ]));
  for (const g of schema.groups) {
    for (const f of g.fields) {
      const m = /（([a-z0-9_]+)）/.exec(f.label || '');
      if (!m || !qualityOf.has(m[1])) continue;
      // ⚠ 绝对不能改 label：调参器按 " · " 切标签，而且"同对象"索引要求**前半段刚好是鱼名** ✗
      //   （第一版我写进括号里 ⇒ check-tuning-tool.js 当场红："同对象索引有误: 鲫鱼 0 项"✗）
      //   ⇒ 放在**说明开头**：那一列本来就是给人读的 ✓，两个索引完全不受影响 ✓
      f.comment = '【品质 ' + qualityOf.get(m[1]) + '】' + (f.comment || '');
      f.quality = qualityOf.get(m[1]);
      tierAdded++;
    }
  }
} catch (e) {
  console.error('⚠ 品质注入失败（调参器仍会生成，但看不到品质）：' + e.message);
}
console.log('  品质注入：' + tierAdded + ' 个鱼字段的**说明**开头已带品质（例：【品质 白~绿】）；标签与两个批量索引都没动 ✓');

const tplPath = path.join(__dirname, 'tuning-tool.template.html');
let html = fs.readFileSync(tplPath, 'utf8');
html = html.replace('__SCHEMA_JSON__', JSON.stringify(schema));
html = html.replace('__GROUP_META_JSON__', JSON.stringify(GROUP_META));

// 同时写两份：中文名给人看/双击，纯 ASCII 名给 .bat 引用。
//
// 为什么必须有 ASCII 别名：.bat 里只敢引用纯 ASCII 文件名 ——
//   · 写中文 + UTF-8 存 → cmd 按 GBK 错切成命令
//   · 用 -Encoding ASCII 存 → 中文变 '?'，ps1 里 Join-Path 拿到 '???.html'
// 两份由这里统一生成，避免手工维护漏掉一份。
//
// ⚠️ 两份**都要保留**，别看到"重复"就删掉中文那份：
//   · 调参器.html  ← tools/dev-menu.ps1（调参器.bat 的菜单项 1）直接用
//   · tuner.html   ← 发布包的 调参入口.bat + tuner-launcher.ps1 用
//   曾经删过一次中文那份想"去重"，结果工作区的调参器.bat 菜单项直接找不到页面。
//   真正要防的是"两份不同步"，而这里每次都是同源写入，不存在这个问题。
fs.writeFileSync(path.join(ROOT, '调参器.html'), html, 'utf8');
fs.writeFileSync(path.join(ROOT, 'tuner.html'), html, 'utf8');

// 批量选择靠的是标签里的 "对象 · 属性" 结构（调参器把 " · " 当分隔符，
// 前半是对象、后半是属性）。所以生成时必须确认这份结构还在 ——
// 一旦某个生成器改了注释格式，标签会整体变空，调参器那边**不会报错**，
// 只会让「同属性 / 同对象」两个下拉变成空的，玩家以为功能坏了。
//
// 这里只守"靠它吃饭的三组"，不守全局：cast/tension 这些手写组本来就没有标签，
// 它们是单件项，用不上批量选择。
const LABEL_REQUIRED = { fishStats: 'all', partsStats: 'all', gameplay: 30 };
let kindBad = 0;
for (const [gid, need] of Object.entries(LABEL_REQUIRED)) {
  const g = schema.groups.find((x) => x.id === gid);
  if (!g) { console.error('❌ schema 里没有 [' + gid + '] 组'); kindBad++; continue; }
  const labeled = g.fields.filter((f) => f.label).length;
  const enough = need === 'all' ? labeled === g.fields.length : labeled >= need;
  if (!enough) {
    console.error('❌ [' + gid + '] 只有 ' + labeled + '/' + g.fields.length + ' 项带中文标签' +
                  '（需要 ' + (need === 'all' ? '全部' : '≥' + need) + '）');
    console.error('   标签是「同属性 / 同对象」批量选择的唯一依据，缺了对应项就选不到。');
    console.error('   检查生成 Config.java 注释的那几个脚本是否还在写 "对象 · 属性 —— 说明" 这个格式。');
    kindBad++;
  }
}
if (kindBad) process.exit(1);

// 顺便把批量选择能覆盖多少打出来 —— 这是每次生成都该看见的一个数字。
{
  const attrs = new Map(), objs = new Map();
  let labeled = 0;
  for (const g of schema.groups) for (const f of g.fields) {
    if (!f.label) continue;
    labeled++;
    const i = f.label.indexOf(' · ');
    if (i <= 0) continue;
    const o = f.label.slice(0, i).trim(), a = f.label.slice(i + 3).trim();
    if (o && a) {
      attrs.set(a, (attrs.get(a) || 0) + 1);
      objs.set(o, (objs.get(o) || 0) + 1);
    }
  }
  console.log('  批量选择可用：同属性 ' + attrs.size + ' 种 / 同对象 ' + objs.size + ' 种' +
              '（覆盖 ' + labeled + '/' + schema.groups.reduce((a, g) => a + g.fields.length, 0) + ' 项）');
}

let n = 0;
for (const g of schema.groups) n += g.fields.length;
console.log('已生成 调参器.html + tuner.html   ' + Math.round(Buffer.byteLength(html) / 1024) + 'KB');
console.log('  内嵌 ' + schema.groups.length + ' 组 / ' + n + ' 项（来自 Config.java）');
