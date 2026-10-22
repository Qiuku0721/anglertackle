'use strict';
/**
 * check-big-catch-announce.js —— 守住**大鱼公告**（用户 2026-10-11："**不加共享**，
 * **公告可以搞**"；配套 `docs/34-玩家设置界面策划案.md`）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * 公告是"锦上添花"的功能，它出问题的**每一种**症状都不会报错：
 *   ① 门槛写死（不读配置）⇒ 服主怎么调都没反应，而且公告照发 ✗；
 *   ② 只判了门槛、忘了玩家开关 ⇒ 关掉开关的玩家照样被公告（用户定案 6 明确要求能关）✗；
 *   ③ 忘了节流 ⇒ 一群人同时上鱼把聊天栏刷爆（从"调味品"变成"骚扰"）✗；
 *   ④ 价值口径与卖价**各算一份** ⇒ 公告里写 120 币、真卖出去 95 币，玩家一眼就发现 ✗；
 *   ⑤ 公告抛异常把上鱼结算带崩 ⇒ **丢鱼**（最贵的一种）✗；
 *   ⑥ 开关存成客户端临时字段（而不是玩家附件）⇒ 退出重进就忘，违背"持续生效" ✗。
 * 这里逐条钉住。
 *
 * 用法：node tools/check-big-catch-announce.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ⚠ 判源码前**必须剥注释**：这个文件里到处都在注释里写 `CoinPricing.priceFor(...)`、
//   "仅 OP 可见"这类说明文字 —— 不剥的话检查器会被自己的说明触发，报出
//   "公告里又定价了""公告里判权限了"这种**假红**（本仓库踩过同类，见 check-codex 的注释）。
const { stripComments: strip } = require('./java-source.js');
const readCode = (p) => strip(read(p));

const ANNOUNCE = 'src/main/java/com/whitecobalt/anglertackle/fishing/BigCatchAnnounce.java';
const MANAGER = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingManager.java';
const DATA = 'src/main/java/com/whitecobalt/anglertackle/player/PlayerFishingData.java';
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
const TUNING = 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java';
const GEN = 'tools/gen-gameplay-config.js';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 大鱼公告检查（门槛 / 玩家开关 / 节流 / 口径 / 不拖垮上鱼） ===\n');

const ann = readCode(ANNOUNCE);
const mgr = readCode(MANAGER);
const data = readCode(DATA);
const cmd = readCode(CMD);

// ---------------------------------------------------------------- A. 三道闸门都在
{
  const gates = [
    ['价值门槛（服务器级）', /Tuning\.bigCatchAnnounceValue\(\)/.test(ann)],
    ['玩家自己的开关', /PlayerData\.get\(player\)\.bigCatchAnnounce\(\)/.test(ann)],
    ['最小间隔（服务器级）', /Tuning\.bigCatchAnnounceMinIntervalSec\(\)/.test(ann)],
  ];
  for (const [name, present] of gates) {
    if (present) ok('闸门在：' + name);
    else bad('缺闸门：' + name + ' —— 缺了它公告要么不停、要么关不掉 ✗');
  }
  // 三个条件必须都是**早退**（不是"记个标记继续发"）
  const returns = (ann.match(/return;/g) || []).length;
  if (returns >= 3) ok('三道闸门都是早退（不满足就什么都不做）');
  else bad('闸门没有早退（只有 ' + returns + ' 个 return）—— 条件判了但照样公告 ✗');

  // ⚠ "闸门在文件里"不等于"闸门真的在拦"（2026-10-11 负例抓出来的）：
  //   把 `if (gap > 0 && …)` 改成 `if (false && gap > 0 && …)` 之后，
  //   Tuning 调用**还在文件里** ⇒ 只看"有没有出现"的断言会放行 ✗ ——
  //   而那一改动等于**节流被短路**（一群人同时上鱼照样刷屏）。
  //   所以这里再钉一层：闸门的条件里不许出现字面量 true/false 短路。
  const shorted = [...ann.matchAll(/if\s*\(\s*(?:false|true)\s*(?:&&|\|\|)/g)].map((m) => m[0]);
  if (shorted.length) {
    bad('闸门被短路写法废掉了（' + shorted.join(' / ') + '）—— 条件看着还在，实际不再拦 ✗');
  } else {
    ok('三道闸门都没有被 `if (false && …)` / `if (true || …)` 短路');
  }
  // 节流的比较必须真的拿"上次公告时刻"比（不是比了个常量）
  if (/now - lastAnnounceGameTime < gap \* 20L/.test(ann)) {
    ok('节流真的是"距上次公告不足 gap 秒就早退"（gap 秒 → tick 的换算也在）');
  } else {
    bad('节流的比较表达式不在了 —— 可能被改成了永假/永真');
  }
}

// ---------------------------------------------------------------- B. 价值口径与卖价同源
{
  // onCatch 里算出的 sellValue 必须**直接**传给公告（而不是在公告里再算一遍）
  if (/BigCatchAnnounce\.maybeAnnounce\([\s\S]{0,200}?sellValue\)/.test(mgr)) {
    ok('公告用的是 onCatch 里刚算出的 sellValue（与卖价同一个数）');
  } else {
    bad('公告没有直接用 onCatch 算出的 sellValue —— 自己再算一遍就会出现"公告 120 币、卖出 95 币" ✗');
  }
  if (/CoinPricing\.priceFor/.test(ann)) {
    bad('BigCatchAnnounce 里又出现了一次 priceFor —— 价值口径必须只有一处（onCatch）');
  } else {
    ok('BigCatchAnnounce 里没有第二处定价（口径唯一）');
  }
  if (/CoinPricing\.sizeFactor/.test(mgr) && /CoinPricing\.priceFor/.test(mgr)) {
    ok('onCatch 里仍是 sizeFactor + priceFor 那一套（公告与卖价同源）');
  } else {
    bad('onCatch 里的定价链路变了 —— 公告的价值口径要重新对一遍');
  }
}

// ---------------------------------------------------------------- C. 只在服务端 + 全服广播
{
  if (/broadcastSystemMessage\(/.test(ann)) ok('走 server.getPlayerList().broadcastSystemMessage（全服 ✓）');
  else bad('找不到全服广播 —— 公告发不出去');
  if (/getPlayerList\(\)/.test(ann)) ok('用的是服务端玩家列表（不是"附近玩家"—— 用户要的是全服公告）');
  else bad('广播目标不是服务端玩家列表');
  if (/senderIds|仅 OP|hasPermission/.test(ann)) {
    bad('公告里出现了权限判断 —— 公告是给所有人看的，不该按权限过滤');
  } else {
    ok('公告不按权限过滤（人人看得到）');
  }
}

// ---------------------------------------------------------------- D. 绝不拖垮上鱼结算
{
  if (/catch \(Throwable ignored\)/.test(ann)) {
    ok('整段包在 try/catch(Throwable) 里（公告出问题也绝不丢鱼 ✓）');
  } else {
    bad('没有整段 try/catch —— 公告抛异常会把"上鱼结算"带崩 ⇒ **丢鱼**（最贵的一种）✗');
  }
  // 调用点必须在"鱼已经进包"之后（end(session) 之前），不能拦住上鱼
  const iCall = mgr.indexOf('BigCatchAnnounce.maybeAnnounce');
  const iEnd = mgr.indexOf('end(session);', iCall);
  if (iCall > 0 && iEnd > iCall) ok('公告调用点在"鱼已进包"之后、会话结束之前（不拦截上鱼）');
  else bad('公告调用点位置不对（找不到，或跑到了会话结束之后）');
}

// ---------------------------------------------------------------- E. 玩家开关：附件 + 默认值 + Codec 可迁移
{
  if (/boolean bigCatchAnnounce/.test(data)) ok('开关是玩家数据里的字段（服务端附件 ⇒ 退出重进保留 ✓）');
  else bad('玩家数据里没有 bigCatchAnnounce 字段 —— 用户要求"持续生效"，客户端临时开关不满足 ✗');
  if (/optionalFieldOf\("big_catch_announce",\s*true\)/.test(data)) {
    ok('Codec 用 optionalFieldOf("big_catch_announce", true)（老存档零迁移，默认开）');
  } else {
    bad('Codec 不是 optionalFieldOf(默认值) —— 老存档会读不出这一项（读档失败/默认值丢失）✗');
  }
  if (/withBigCatchAnnounce\(/.test(data)) ok('有 withBigCatchAnnounce（改设置只走这一处）');
  else bad('没有 withBigCatchAnnounce —— 改设置会绕过统一入口（迟早漏字段）');
  // 构造点：加字段时最容易漏的地方（本类自己的注释就警告过）
  const ctors = (data.match(/new PlayerFishingData\(/g) || []).length;
  if (ctors >= 6) ok('5 处内部构造点 + EMPTY 都带上了新字段（共 ' + ctors + ' 处）');
  else bad('PlayerFishingData 的构造点只有 ' + ctors + ' 处 —— 加字段时漏了某个 withX，会**静默重置**设置 ✗');
}

// ---------------------------------------------------------------- F. 指令：无权限 + 只改自己
{
  if (/\.then\(lit\("announce"\)/.test(cmd)) ok('/atl announce 存在');
  else bad('没有 /atl announce（玩家没法自查/改这个开关）');
  if (/setAnnounce\(/.test(cmd) && /PlayerData\.update\(player,[\s\S]{0,120}?withBigCatchAnnounce/.test(cmd)) {
    ok('指令改的是**发起者自己**的附件（不带任何"改谁"的参数 ✓）');
  } else {
    bad('指令没有走 PlayerData.update(...withBigCatchAnnounce) —— 设置可能改不进去');
  }
  if (/OP_ONLY[\s\S]{0,400}?"announce"/.test(cmd)) {
    bad('announce 被加进了 OP 白名单 —— 改自己的公告开关不影响平衡，不该要权限（AGENTS.md §六）✗');
  } else {
    ok('announce 不在 OP 白名单里（改自己的设置无需权限 ✓）');
  }
}

// ---------------------------------------------------------------- G. 两个配置项走生成器 + 可热改
{
  for (const key of ['bigCatchAnnounceValue', 'bigCatchAnnounceMinIntervalSec']) {
    if (new RegExp("key: '" + key + "'").test(read(GEN))) ok('配置项 ' + key + ' 定义在生成器里（不是手写）');
    else bad('生成器里找不到 ' + key + ' —— 手写配置项会在下次生成时被剥掉');
    if (new RegExp('public static int ' + key + '\\(\\)').test(read(TUNING))) {
      ok('Tuning.' + key + '() 已生成（可热重载 ✓）');
    } else {
      bad('Tuning 里没有 ' + key + '() —— 改了配置不生效');
    }
  }
  // 阈值默认必须是用户亲口给的 **5050**（2026-10-11）
  if (new RegExp("bigCatchAnnounceValue', cn: '大鱼公告价值门槛', unit: '鱼币', def: 5050").test(read(GEN))) {
    ok('门槛默认 5050 鱼币（用户 2026-10-11 亲口给的数）');
  } else {
    bad('门槛默认值不是 5050 —— 与用户口径不一致');
  }

  // ★ "5050 是什么意思"必须**跟着定价一起**成立（这是这条断言真正的价值）：
  //   红档基准 4800、尺寸浮动 ±8% ⇒ 红鱼价格区间 [4416, 5184]。
  //   门槛必须落在**这个区间之内**（否则要么红鱼永远不够格 ✗、要么连小金鱼都能上电视 ✗），
  //   并且必须**高于金档的最高可能价**（1380 × 1.08 = 1490.4）⇒ "金档及以下永远够不到"。
  //   ⚠ 改任一档的基础价、或改尺寸浮动，都会让这里立刻变红 —— 那时要回来重新定门槛。
  {
    const pricing = read('src/main/java/com/whitecobalt/anglertackle/economy/CoinPricing.java');
    const m = /BASE_BY_TIER\s*=\s*\{([^}]*)\}/.exec(pricing);
    const spread = /SIZE_SPREAD\s*=\s*([\d.]+)/.exec(pricing);
    if (!m || !spread) {
      bad('读不到 CoinPricing 的基础价表 / 尺寸浮动 —— 下面这几条断言失效了');
    } else {
      const bases = m[1].split(',').map((s) => Number(s.trim().replace(/L$/, '')));
      const sp = Number(spread[1]);
      const red = bases[bases.length - 1];
      const gold = bases[bases.length - 2];
      const lo = Math.round(red * (1 - sp));
      const hi = Math.round(red * (1 + sp));
      const goldMax = gold * (1 + sp);
      const threshold = 5050;
      if (threshold <= goldMax) {
        bad('门槛 ' + threshold + ' ≤ 金档最高价 ' + Math.round(goldMax)
          + ' ⇒ 金档鱼也会被公告（那这条门就不是"特别大的红鱼"了）✗');
      } else if (threshold < lo || threshold > hi) {
        bad('门槛 ' + threshold + ' 落在红鱼价格区间 [' + lo + ', ' + hi + '] **之外** ⇒ '
          + (threshold > hi ? '连最大的红鱼都够不到，公告永远不会出现 ✗'
            : '红档普通个体也能上电视 ✗'));
      } else {
        const pos = (threshold / red - 1) / sp;      // 尺寸系数（-1~+1）
        ok('门槛 5050 落在红鱼区间 [' + lo + ', ' + hi + '] 内：尺寸系数 ≥ '
          + pos.toFixed(2) + '（红鱼的上游约 ' + Math.round((1 - pos) / 2 * 100) + '%），'
          + '金档最高 ' + Math.round(goldMax) + ' 永远够不到 ✓');
      }
    }
  }
}

// ---------------------------------------------------------------- H. 文案键齐（中英都要）
{
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
  const keys = ['message.anglertackle.big_catch', 'message.anglertackle.announce_on',
    'message.anglertackle.announce_off', 'message.anglertackle.announce_status',
    'message.anglertackle.announce_set'];
  const missZh = keys.filter((k) => !(k in zh));
  const missEn = keys.filter((k) => !(k in en));
  if (missZh.length) bad('缺中文文案：' + missZh.join(', '));
  else if (missEn.length) bad('缺英文文案：' + missEn.join(', '));
  else ok('公告/开关的 ' + keys.length + ' 个文案键中英齐全');
  // 公告正文的占位符数量必须固定（少一个 ⇒ String.format 抛异常 ⇒ 公告那一下崩）
  const body = zh['message.anglertackle.big_catch'] || '';
  const holders = (body.match(/%s/g) || []).length;
  if (holders === 4) ok('公告正文是 4 个 %s（玩家 / 鱼名 / 重量 / 价值）—— 与调用点逐项对齐');
  else bad('公告正文的 %s 有 ' + holders + ' 个（应为 4）—— 与传参数量对不上会运行期抛异常 ✗');
}

console.log('');
if (fail === 0) {
  console.log('✅ 大鱼公告检查通过：三道闸门齐、口径与卖价同源、只在服务端广播、不拖垮上鱼、开关可持久化');
  process.exitCode = 0;
} else {
  console.log('❌ 大鱼公告检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
