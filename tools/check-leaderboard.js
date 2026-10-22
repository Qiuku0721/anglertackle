#!/usr/bin/env node
/**
 * check-leaderboard.js —— 守着 M1 排行榜（2026-10-10 开做 ✓）。
 *
 * 为什么需要它 ✓：排行榜最容易错的地方**都不是崩溃**，而是"悄悄错"✗：
 *   · {@code betterThan} 的方向搞反 ⇒ 榜变成**倒数榜** ✗
 *   · 「最短上鱼时间」忘记"越小越好" ⇒ 永远记第一尾 ✗
 *   · 「金红尾数」把档位写成 1 起算 ⇒ 金档鱼一个都数不进去 ✗（仓库铁律：**档位 0 起算** ✓）
 *   · 尺寸评级的名字凭印象写 ⇒ 与 {@code FishData.SizeGrade} 对不上 ✗（**我第一版就错在这里** ✗）
 *   · 接线只插在"拉干"分支 ⇒ 遛翻上鱼的成绩全丢 ✗
 *
 * 断言（每条都能证伪 ✓）：
 *   ① 每个维度的"越大越好/越小越好"方向与榜单语义一致 ✓
 *   ② 尺寸评级的五档名字与 {@code FishData.SizeGrade} **逐字一致**（跨文件核对 ✓，不抄第二份表 ✗）
 *   ③ 金红判定用的是 `tier >= 4`（4 金 / 5 红 ✓，0 起算 ✓）
 *   ④ 接线**两个上鱼分支都有**（拉干 ✓ + 遛翻 ✓ —— 少一个就丢一半成绩 ✗）
 *   ⑤ 存档层是 {@code SavedData} ✓、文件 id 写死不许改名 ✓
 *   ⑥ 纪律：结算只在服务端（入参是 ServerPlayer ✓、类里没有客户端类型 ✗）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const LB = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/leaderboard/Leaderboard.java');
const LD = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/leaderboard/LeaderboardData.java');
const HK = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/leaderboard/LeaderboardHooks.java');
const SESSION = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java');
const FISHDATA = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishData.java');

let fail = 0;
const ok = (m) => console.log('  [OK]   ' + m);
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
console.log('check-leaderboard：M1 排行榜（方向 / 口径 / 接线 / 存档）');

const lb = read(LB);
const ld = read(LD);
const hk = read(HK);
const session = read(SESSION);
const fishData = read(FISHDATA);
if (lb === null) bad('找不到 ' + LB);
if (ld === null) bad('找不到 ' + LD);
if (hk === null) bad('找不到 ' + HK);

// ① 方向：唯一"越小越好"的必须是 FASTEST_CATCH ✓
if (lb !== null) {
  const lower = [...lb.matchAll(/([A-Z_]+)\("([a-z_]+)", "[^"]+", (true|false), (true|false)\)/g)]
    .filter((m) => m[4] === 'true').map((m) => m[1]);
  lower.length === 1 && lower[0] === 'FASTEST_CATCH'
    ? ok('① 唯一"越小越好"的是 FASTEST_CATCH ✓（其余都是越大越好 ✓）')
    : bad('① "越小越好"的维度应当**只有** FASTEST_CATCH ✗，实际：[' + lower.join(', ') + ']');

  // ② 尺寸评级五档与 FishData 逐字一致 ✓（跨文件核对 ✓）
  if (fishData !== null) {
    const enumBody = /enum SizeGrade\s*\{([\s\S]*?)\n\s*\}/.exec(fishData);
    const consts = enumBody ? [...enumBody[1].matchAll(/^\s*([A-Z_]+)\s*\(/gm)].map((m) => m[1]) : [];
    const missing = consts.filter((c) => !lb.includes('"' + c + '"'));
    const expected = ['JUVENILE', 'NORMAL', 'QUALITY', 'EXCELLENT', 'RECORD'];   // 2026-10-10 去 FishData.java 核对过的真实常量 ✓（我第一版凭印象写错 ✗）
    if (consts.length === 0) bad('② 解析不出 FishData.SizeGrade 的常量（结构变了，本检查器需更新）');
    else if (missing.length) bad('② gradeRank 漏了/写错了这些评级常量 ✗：' + missing.join(', ')
      + '（FishData 里是 ' + consts.join('/') + ' ✓）');
    else if (consts.join('/') !== expected.join('/')) bad('② FishData.SizeGrade 的档位与预期不同：' + consts.join('/'));
    else ok('② 尺寸评级五档与 FishData.SizeGrade 逐字一致 ✓（' + consts.join('/') + ' ✓）');
  }

  // ③ 金红判定：tier >= 4 ✓
  /HIGH_TIER_COUNT\s*->\s*c\.tier\(\)\s*>=\s*4/.test(lb)
    ? ok('③ 金红尾数按 `tier >= 4` 判定 ✓（4 金 / 5 红 ✓，档位 0 起算 ✓）')
    : bad('③ 金红尾数的档位判据不见了或被改小 ✗（必须 `tier >= 4` ✓；写过 1 起算就会把金档漏掉 ✗）');
}

// ④ 接线：两个上鱼分支都要有 ✓
if (session !== null) {
  const hits = (session.match(/LeaderboardHooks\.onLanded\(/g) || []).length;
  const hasPullDry = /dumpTensionTrace\("拉干上鱼"\);[\s\S]{0,400}?LeaderboardHooks\.onLanded\(/.test(session);
  const hasTired = /dumpTensionTrace\("遛翻上鱼"\);[\s\S]{0,400}?LeaderboardHooks\.onLanded\(/.test(session);
  hits >= 2 && hasPullDry && hasTired
    ? ok('④ 两个上鱼分支（拉干 ✓ / 遛翻 ✓）都接了排行榜 ✓')
    : bad('④ 接线不全 ✗：找到 ' + hits + ' 处（拉干分支 ' + hasPullDry + ' / 遛翻分支 ' + hasTired
      + '）⇒ 少一个分支就丢一半成绩 ✗');
  /leaderboard\.LeaderboardHooks/.test(session)
    ? ok('④ 用的是全限定名 ✓（不新增 import ⇒ 摘功能时只删那一行 ✓）')
    : bad('④ FishingSession 里引用了排行榜但写法变了（摘功能会变麻烦，请保持全限定名 ✓）');
}

// ⑤ 存档层 ✓
if (ld !== null) {
  /extends SavedData/.test(ld) ? ok('⑤ 存档层是 SavedData ✓（世界级 ⇒ 三环境一套代码 ✓）')
    : bad('⑤ LeaderboardData 不再继承 SavedData ✗（榜就不会跟着存档走了 ✗）');
  /FILE_ID\s*=\s*"anglertackle_leaderboard"/.test(ld)
    ? ok('⑤ 存档文件名写死为 anglertackle_leaderboard ✓（改名 = 老存档的榜全丢 ✗，注释里已写明 ✓）')
    : bad('⑤ FILE_ID 被改了 ✗ —— 改名会让老存档的榜全部读不出来 ✗');
}

// ⑥ 服务端纪律 ✓
if (hk !== null) {
  /ServerPlayer/.test(hk) && !/net\.minecraft\.client/.test(hk)
    ? ok('⑥ 接线口只认 ServerPlayer ✓、不碰客户端类型 ✓（客户端根本调不到 ✓）')
    : bad('⑥ 接线口里出现了客户端类型或不再要求 ServerPlayer ✗（会破坏"服务端权威" ✗）');
  /catch \(Throwable/.test(hk)
    ? ok('⑥ 整段有 try/catch ✓（排行榜坏了也绝不让鱼跑掉 ✓）')
    : bad('⑥ try/catch 不见了 ✗ ⇒ 排行榜一异常就会影响上鱼 ✗');
}

// ⑦ 联赛板块（`docs/39` §6.1，2026-10-13）：数据源 = 历届档案，默认视图 = 最近联赛
const SNAP = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/leaderboard/RankSnapshot.java');
const LEAGUEDATA = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/league/LeagueData.java');
const LEAGUESVC = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/league/LeagueService.java');
{
  const snap = read(SNAP);
  const ldata = read(LEAGUEDATA);
  const lsvc = read(LEAGUESVC);
  if (snap === null || ldata === null || lsvc === null) {
    bad('⑦ 读不到联赛板块的源文件（RankSnapshot / LeagueData / LeagueService）');
  } else {
    // 默认视图：联赛板块必须**加在经典板块之前**（客户端默认选中第一位）
    const iLeague = snap.indexOf('out.addAll(leagueBoards(data, me))');
    const iClassic = snap.indexOf('out.add(board(b, data, me))');
    if (iLeague >= 0 && iClassic > iLeague) {
      ok('⑦ 联赛板块排在经典板块之前 ⇒ 打开排行榜**默认就是最近联赛** ✓');
    } else {
      bad('⑦ 联赛板块没有排在最前 —— 默认视图还会是"单鱼最重"，不是用户要的"最近联赛"');
    }
    // 联赛板块**无条件出现**（用户 2026-10-13："即使没开一届联赛也要有对应板块"）
    //   ⚠ 与比赛"本场"那条纪律故意相反，别"顺手统一"回去
    if (/new RankPayload\.Board\(LEAGUE_ID, "最近联赛", List\.of\(\)/.test(snap)
        && /还没有开过联赛/.test(snap)) {
      ok('⑦ 一届都没开过时**仍然出「最近联赛」板块**（带说明的空板块）✓ 玩家能看到入口');
    } else {
      bad('⑦ 没有联赛数据就不出联赛板块了 —— 用户要的是"即使没开过也要有板块"，否则他找不到入口');
    }
    if (/out\.addAll\(tierBoards\(data, me\)\)/.test(snap)
        && /for \(League\.Tier t : League\.Tier\.values\(\)\)[\s\S]{0,600}?out\.add\(tierBoard\(/.test(snap)) {
      ok('⑦ 总联赛榜**无条件出全部规模**（哪怕还没有成绩）✓');
    } else {
      bad('⑦ 总联赛榜被条件过滤了 —— 没成绩的规模在目录里会消失');
    }
    // 历史名次照搬、不重排
    const sb = (/private static RankPayload\.Board seasonBoard\([\s\S]*?\n    \}/.exec(snap) || [''])[0];
    if (sb && !/\.sort\(/.test(sb)) {
      ok('⑦ 一届的板块**照档案顺序搬、不重排** ✓（历史名次不会被现在的口径改写）');
    } else {
      bad('⑦ seasonBoard 里出现了排序 —— 历史名次会被改写，"当时第 2 名"可能变成"现在第 3 名"');
    }
    // 档案写入幂等
    if (/for \(Season s : this\.archive\) \{\s*if \(s\.seasonNo == seasonNo\) \{\s*return;/.test(ldata)) {
      ok('⑦ 档案写入是幂等的（同届号跳过）✓ 结算重跑不会写两条');
    } else {
      bad('⑦ archiveSeason 不是幂等的 —— 结算一旦重跑，档案里会出现两条同一届');
    }
    // 结算必须真的写档案，否则联赛板块永远是空的
    if (/d\.archiveSeason\(d\.seasonNo, d\.tierId, ranked\)/.test(lsvc)) {
      ok('⑦ 结算是档案**唯一的写入口** ✓（不写就永远没有联赛榜）');
    } else {
      bad('⑦ 结算没有写档案 —— 联赛板块永远是空的');
    }
    // 存/读成对
    const hasSave = /tag\.put\("archive", arch\)/.test(ldata);
    const hasLoad = /tag\.getList\("archive", Tag\.TAG_COMPOUND\)/.test(ldata);
    if (hasSave && hasLoad) {
      ok('⑦ 档案存/读成对 ✓（重启后历届还在）');
    } else {
      bad('⑦ 档案的 save/load 不成对（存了读不回 / 读了没存）—— 重启后历届会丢');
    }
  }
}

// ⑧ 总联赛榜 + 分目录（`docs/39` §6.1；用户 2026-10-13："全要，分目录"）
const SCREEN = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/client/screen/LeaderboardScreen.java');
const PAYLOAD = path.join(ATL_ROOT, 'src/main/java/com/whitecobalt/anglertackle/network/RankPayload.java');
{
  const snap = read(SNAP);
  // ⚠ 注意两个文件名字极像，别读错：
  //   LD          = leaderboard/LeaderboardData.java（排行库存档：submit / top / 键前缀）
  //   LEAGUEDATA  = league/LeagueData.java（联赛存档：历届档案 archive）
  const lbData = read(LD);
  const ldata = read(LEAGUEDATA);
  const hooks = read(HK);
  const screen = read(SCREEN);
  const payload = read(PAYLOAD);
  if (snap === null || ldata === null || lbData === null || hooks === null
      || screen === null || payload === null) {
    bad('⑧ 读不到分目录/总联赛榜相关的源文件');
  } else {
    // 联赛成绩与常规成绩**共用一套写入规则**（口径只有一处），只是键不同
    if (/public boolean submitLeague\([\s\S]{0,200}?write\(board, leagueKey\(/.test(lbData)
        && /public boolean submit\([\s\S]{0,200}?write\(board, keyOf\(/.test(lbData)) {
      ok('⑧ 联赛榜与常规榜**共用同一个写入规则**（write 一份实现）✓ 不会两套口径');
    } else {
      bad('⑧ 联赛成绩的写入没有复用 write(...) —— 等于又抄了一份更新规则，迟早走散');
    }
    // 总榜必须排除联赛键（否则总榜数字被联赛成绩污染）
    if (/public List<Record> top\(Leaderboard\.Board board, int limit\) \{[\s\S]{0,80}?top\(board, limit, null\)/.test(lbData)
        && /boolean isLeague = e\.getKey\(\)\.startsWith\(LEAGUE_PREFIX\)/.test(lbData)) {
      ok('⑧ 常规榜 top(...) **排除联赛键** ✓（总榜数字不会被联赛成绩污染）');
    } else {
      bad('⑧ 常规榜没有排除联赛键 —— 联赛成绩会混进总榜，数字变味');
    }
    // 页脚也不能把联赛条数算进去
    if (/data\.count\(board\)/.test(snap)) {
      ok('⑧ 总榜页脚用 count(...)（只数常规记录）✓');
    } else {
      bad('⑧ 总榜页脚还在用整张表的条数 —— 会把联赛成绩也算进"共 N 条"');
    }
    // 挂钩点：联赛期间另记一份，且资格由 LeagueService 那两道闸决定
    if (/submitLeague\(leagueTier, b, c\)/.test(hooks)
        && /LeagueService[\s\S]{0,120}?activeTierFor\(/.test(hooks)) {
      ok('⑧ 上鱼时另记一份"联赛期间的成绩"，资格走 LeagueService.activeTierFor ✓（与联赛积分同一套闸）');
    } else {
      bad('⑧ 没有把联赛期间的成绩记进联赛榜（或没走 activeTierFor）—— 联赛榜会永远是空的/资格不一致');
    }
    // 三个规模各一套，id 前缀是客户端分目录的依据
    if (/case SMALL -> "lts_"/.test(snap) && /case MEDIUM -> "ltm_"/.test(snap)
        && /case LARGE -> "ltl_"/.test(snap)) {
      ok('⑧ 总联赛榜按规模出三套，id 前缀 lts_/ltm_/ltl_ ✓（客户端据此分目录）');
    } else {
      bad('⑧ 三个规模的前缀不全 —— 客户端会分不出目录');
    }
    // 客户端：分目录 + 空目录不画 + 默认落第一个非空目录
    if (/GROUP_NAMES/.test(screen) && /private static int groupOf\(String id\)/.test(screen)) {
      ok('⑧ 客户端按 id 前缀**分目录** ✓');
    } else {
      bad('⑧ 客户端没有分目录 —— 47 个板块会铺成一长条，最下面的点不到');
    }
    if (/private boolean tabVisible\(int g\)[\s\S]{0,120}?isEmpty\(\)/.test(screen)) {
      ok('⑧ 空目录不画标签 ✓（没有联赛数据时看不到"联赛"那一栏）');
    } else {
      bad('⑧ 没有"空目录不画"的判断 —— 目录里会出现点开是空的标签');
    }
    if (/this\.group = 0;[\s\S]{0,200}?groups\.get\(this\.group\)\.isEmpty\(\)[\s\S]{0,80}?this\.group\+\+/.test(screen)) {
      ok('⑧ 默认落到**第一个非空目录**（有联赛就是"最近联赛"，没有就是"总榜"）✓');
    } else {
      bad('⑧ 默认目录的挑选逻辑不在 —— 没有联赛数据时可能停在空目录上');
    }
    // 包长上限：板块变多之后 32767 已经贴边，超了会 writeUtf 抛异常（表现是掉线）
    if (/writeUtf\(p\.blob\(\) == null \? "" : p\.blob\(\), (\d+)\)/.test(payload)) {
      const lim = Number(/writeUtf\(p\.blob\(\) == null \? "" : p\.blob\(\), (\d+)\)/.exec(payload)[1]);
      if (lim > 32767) {
        ok('⑧ 榜单包长上限 = ' + lim + '（> 32767）✓ 板块变多也不会撑爆');
      } else {
        bad('⑧ 榜单包长上限还是 ' + lim + ' —— 47 个板块会撑爆它，表现是"打开排行榜掉线"');
      }
    } else {
      bad('⑧ 读不出榜单包长上限');
    }
  }
}

// ⑨ 「最近联赛」必须**带届号**（用户 2026-10-13 反馈："不会显示是哪一届，比如 S1 这样的显示"）
{
  const snap = read(SNAP);
  if (snap === null) {
    bad('⑨ 读不到 RankSnapshot');
  } else {
    if (/String title = "S" \+ d\.seasonNo \+ tierCn\(d\.tierId\) \+ "联赛（进行中）"/.test(snap)) {
      ok('⑨ 进行中的那一届带届号（如 "S3大型联赛（进行中）"）✓');
    } else {
      bad('⑨ 进行中的联赛没有带届号 —— 玩家打完整期也不知道这是第几届');
    }
    if (/if \(d != null && d\.seasonId > 0 && !d\.settled\)/.test(snap)) {
      ok('⑨ 进行中优先（名次实时、判据与结算同一套）✓');
    } else {
      bad('⑨ 没有"进行中优先"的分支 —— 只会在结算之后才有东西看');
    }
    if (/"S" \+ s\.seasonNo \+ tierCn\(s\.tierId\) \+ "联赛（最近结算）"/.test(snap)) {
      ok('⑨ 已结算的那届也带届号 ✓');
    } else {
      bad('⑨ 已结算的板块没带届号');
    }
  }
}

console.log(fail === 0 ? '\n全部通过：排行榜方向 / 口径 / 接线 / 存档都正确' : '\n失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
