'use strict';
/**
 * check-mail.js —— 守住**邮件箱**（用户 2026-10-11 点名要的系统；策划 `docs/36`）。
 *
 * ── 为什么值得单独守 ─────────────────────────────────────────
 * 邮件这里每一种做错的方式都**不报错、也不崩**，只是"玩家的东西悄悄没了/名次悄悄错了"：
 *   ① **"已读"当成"已领"** ⇒ 玩家点开看一眼就把奖励吞掉（背包满时东西去哪？无解）✗；
 *   ② 背包满时把物品**掉在脚下或直接销毁** ⇒ 玩家的奖励凭空消失（`AnvilEvents` 那个老问题）；
 *   ③ 到期**整封删掉** ⇒ 玩家觉得"我的邮件被人删了"（`docs/36` §3 纪律 3）；
 *   ④ 到上限**静默丢件** / 悄悄挤掉最旧的 ⇒ 最需要那封信的时候它没了 ✗；
 *   ⑤ 服务端**拼中文** ⇒ 英文客户端看到中文（服务端没有语言表，排行榜踩过）；
 *   ⑥ 另存一个"未读数"计数器 ⇒ 迟早和列表不一致（本仓库"两套刻度"那两次事故同一类）；
 *   ⑦ 领取动作能指定"替谁领" ⇒ 与"提交包不带 UUID"那条纪律冲突。
 *
 * ── 判据（八组）──────────────────────────────────────────────
 *   A. 数据面：`MailBox`/`MailEntry` 是附件（`copyOnDeath`）、字段全 `optionalFieldOf`、
 *      **没有** `unreadCount` 之类的计数器字段
 *   B. 已读 ≠ 已领：两个独立位；`read()` 只动 read；`claim()` 才动附件
 *   C. 领取是服务端动作、抢不动别人：`claim(player, id)` 没有 target 参数；指令里也没有
 *   D. 物品绝不丢：先塞、塞不下**回滚并整封拒绝**（不许 `player.drop`、不许静默销毁）
 *   E. 过期只清附件、正文保留（不是删掉整封）
 *   F. 上限：到 `maxMails` **拒绝投递** + WARN；不许静默丢、不许挤掉最旧
 *   G. 文案只走 `template + args`：服务端不出现拼中文的 `Component.literal("…中文…")`；
 *      每个模板的中英键齐全
 *   H. 配置：`[mail]` 四项在配置里、有 Tuning getter、也进了热重载映射（`check-tuning-schema` 交叉守）
 *   I. 界面（M2，docs/36 §5）
 *   J. **无附件的动作必须跑得起来**（2026-10-14 验收实测修复）：委托信 quest_accept 没有附件，
 *      "claimed 初始值 / claim 的无附件分支 / 界面 canClaim" 三处任何一处漏了，按钮就是个摆设 ✗
 *
 * 用法：node tools/check-mail.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const { stripComments: strip } = require('./java-source.js');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const BOX = 'src/main/java/com/whitecobalt/anglertackle/player/MailBox.java';
const ENTRY = 'src/main/java/com/whitecobalt/anglertackle/player/MailEntry.java';
const SVC = 'src/main/java/com/whitecobalt/anglertackle/mail/MailService.java';
const ATTR = 'src/main/java/com/whitecobalt/anglertackle/registry/ModAttachments.java';
const CMD = 'src/main/java/com/whitecobalt/anglertackle/command/AnglerCommands.java';
const CFG = 'src/main/java/com/whitecobalt/anglertackle/Config.java';
const TUN = 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java';

console.log('=== 邮件箱检查（已读≠已领 / 物品不丢 / 过期留正文 / 上限拒绝 / 文案不拼中文） ===\n');

for (const f of [BOX, ENTRY, SVC]) {
  if (!exists(f)) {
    console.error('❌ 缺 ' + f + ' —— 邮件系统还没落地');
    process.exit(1);
  }
}
const box = strip(read(BOX));
const entry = strip(read(ENTRY));
const svc = strip(read(SVC));
const attr = read(ATTR);
const cmd = strip(read(CMD));
const cfg = read(CFG);
const tun = strip(read(TUN));

// ---------------------------------------------------------------- A. 数据面
{
  const block = /PLAYER_MAILS\s*=[\s\S]*?\.build\(\)\)/.exec(attr);
  if (!block) {
    bad('ModAttachments 里找不到 PLAYER_MAILS 的注册块');
  } else if (!/\.copyOnDeath\(\)/.test(block[0])) {
    bad('邮箱附件那一块没有 copyOnDeath —— 死一次邮箱清空（里面可能正躺着没领的奖励）✗'
      + '（⚠ 注意别被同文件里别的附件的 copyOnDeath 蒙过去）');
  } else if (!/serialize\(asMap\(MailBox\.CODEC\)\)/.test(block[0])) {
    // 26.1.2：AttachmentType.Builder 的 serialize 只收 IAttachmentSerializer / MapCodec
    // （旧的 Codec 版重载已删除），Codec 必须经 ModAttachments.asMap（MapCodec.assumeMapUnsafe）
    // 适配。断言语义不变：这一块必须**真的把邮箱挂上持久化**，不能只剩 copyOnDeath。
    bad('邮箱附件的注册块里没有 serialize(asMap(MailBox.CODEC)) —— 邮件不会存盘'
      + '（26.1.2 的 serialize 只收 MapCodec）');
  } else if (!/private static <T> MapCodec<T> asMap\(Codec<T> codec\)/.test(attr)) {
    bad('ModAttachments 里的 asMap 助手不见了 —— serialize(asMap(...)) 就成了空壳');
  } else {
    ok('邮箱附件：copyOnDeath + serialize(asMap(...)) 都在**它自己那一块**里 ✓');
  }
  const opt = (box.match(/optionalFieldOf\(/g) || []).length
    + (entry.match(/optionalFieldOf\(/g) || []).length;
  if (opt >= 10) ok('MailBox/MailEntry 的字段全部 optionalFieldOf（老存档零迁移 ✓）');
  else bad('有字段没用 optionalFieldOf（老存档会读不进来）—— 只数到 ' + opt + ' 处');
  if (/unreadCount|unread_count|claimedCount/.test(box + entry)) {
    bad('邮箱里存了"未读数/待领数"计数器 —— 它必须是从列表**数出来的派生值**'
      + '（两个真源迟早不一致，本仓库"两套刻度"那两次事故同一类）✗');
  } else {
    ok('没有另存未读/待领计数器（都是从列表数出来的派生值 ✓）');
  }
}

// ---------------------------------------------------------------- B. 已读 ≠ 已领
{
  const hasBoth = /boolean read/.test(entry) && /boolean claimed/.test(entry);
  if (hasBoth) ok('MailEntry 有**两个独立位**：read 与 claimed');
  else bad('MailEntry 没有把"已读"与"已领"分成两个位 ✗（最容易做错的一处）');
  const readFn = /public static boolean read\(ServerPlayer[^)]*\)[\s\S]*?\n    \}/.exec(svc);
  if (!readFn) {
    bad('找不到 MailService.read(...)');
  } else if (/withClaimed\(/.test(readFn[0]) || /coins/.test(readFn[0])) {
    bad('read() 里动了附件/领取状态 —— "点开看一眼"不能等于"领了" ✗');
  } else if (/withRead\(/.test(readFn[0])) {
    ok('read() 只动 read 位（不碰附件）✓');
  } else {
    bad('read() 没有标记已读');
  }
  // 未读提示只提示一次：登录事件里，且不在 tick 里
  const join = read('src/main/java/com/whitecobalt/anglertackle/event/FirstJoinEvents.java');
  if (/mail_unread_notice/.test(join) && /PlayerLoggedInEvent/.test(join)) {
    ok('未读提示挂在**登录事件**里（只提示一次，不是每 tick 弹）✓');
  } else {
    bad('未读提示不在登录事件里 —— "只提示一次"这条守不住 ✗');
  }
}

// ---------------------------------------------------------------- C. 领取只作用于发起者
{
  const claimSig = /public static Claim claim\(([^)]*)\)/.exec(svc);
  if (!claimSig) {
    bad('找不到 MailService.claim(...)');
  } else if (/UUID|target|other/i.test(claimSig[1])) {
    bad('claim() 的签名里出现了"替谁领"的参数（' + claimSig[1].trim() + '）—— '
      + '领取只能作用于发起者自己（与"提交包不带 UUID"同一条纪律）✗');
  } else {
    ok('claim() 只接受发起者本人 + 邮件 id（没有 targetUuid 这种口子）✓');
  }
  if (/targetUuid|target_uuid/.test(cmd)) bad('指令里出现了 targetUuid 参数 ✗');
  else ok('指令里没有 targetUuid ✓');
}

// ---------------------------------------------------------------- D. 物品绝不丢
{
  if (/player\.drop\(|\.drop\(stack/.test(svc)) {
    bad('领取路径里出现 player.drop —— 背包满时奖励会掉在脚下（`docs/36` §2.2 明确不许）✗');
  } else {
    ok('领取路径不 drop（物品要么进背包、要么留在邮件里）✓');
  }
  if (/getInventory\(\)\.add\(/.test(svc) && /removeItem\(/.test(svc)) {
    ok('背包满的处理：先塞 → 塞不下**把已塞进去的拿回来**并整封拒绝（一件不丢）✓');
  } else {
    bad('找不到"塞不下就回滚"的处理 —— 部分成功会让玩家的物品凭空少一件 ✗');
  }
  if (/BAG_FULL/.test(svc)) ok('有 BAG_FULL 这个明确结果（界面/指令能告诉玩家"清格子再来"）✓');
  else bad('没有"背包满"这个独立结果');
}

// ---------------------------------------------------------------- E. 过期只清附件
{
  if (/withVoidedAttachments/.test(entry) && /expireAttachments/.test(svc)) {
    ok('过期走 withVoidedAttachments（只作废附件）✓');
  } else {
    bad('找不到"过期只作废附件"的实现');
  }
  // ⚠ 判据要盯住 expireAttachments **自己那一段**：早先只搜整个文件有没有 remove，
  //   容易被别处（或注释）满足 ⇒ 那等于没断言（今天已经栽过两次同类）。
  const exp = /public static int expireAttachments\([\s\S]*?\n    \}/.exec(svc);
  if (!exp) {
    bad('找不到 expireAttachments(...) 的方法体');
  } else if (/remove\(|removeIf|withoutId/.test(exp[0])) {
    bad('过期路径里把整封邮件删掉了 —— 正文必须留着当记录（`docs/36` §3 纪律 3）✗');
  } else {
    ok('过期不删整封（正文保留）✓');
  }
  // ⚠ 更强的一条：`MailBox` **结构上就没有删除能力**（第一版没有"删除邮件"功能，
  //   见 `docs/36` §8 与 §9 #5）。加一条"从别处绕过去删"的路（比如 mapAll 里 removeIf）
  //   会被这条抓住 —— 负例 mail-expire-deletes 第一次跑就是从这个口子溜过去的 ✗。
  if (/remove\(|removeIf|removeAll|withoutId|clear\(\)/.test(box)) {
    bad('MailBox 里出现了删除类操作（remove/removeIf/clear…）—— 第一版**没有删除邮件这个功能**，'
      + '过期只作废附件；要删也得先有策划与断言（`docs/36` §8/§9 #5）✗');
  } else {
    ok('MailBox 结构上没有删除能力（过期只作废附件，正文一定留得住）✓');
  }
  if (/mapAll\(/.test(box)) ok('过期是"逐封 map 一遍"（幂等、不清列表）✓');
  else bad('过期没有走 mapAll');
}

// ---------------------------------------------------------------- F. 上限拒绝投递
{
  // ⚠ 必须匹配**六参那个** send(...)：三参重载在它前面，不写全参数就会断言到错的方法上
  //   （第一次跑就撞上了：捕获到的是 `return send(to, template, args, 0L, …)` 那个壳）。
  const send = /public static Result send\(ServerPlayer to,\s*String template,\s*List<String> args,\s*long coins[\s\S]*?\n    \}/.exec(svc);
  if (!send) {
    bad('找不到 MailService.send(ServerPlayer, template, args, coins, items, action)');
  } else if (!/if\s*\([^\n]*mailMaxMails\(\)[^\n]*\)/.test(send[0])) {
    // ⚠ 两个细节都踩过：
    //   ① 必须要求"上限判断出现在 **if 的条件**里"：只要求"这段里有 mailMaxMails()"的话，
    //      把守卫改成 `if (false)` 之后，**拒绝提示那行里的 `Tuning.mailMaxMails()` 仍然在** ⇒
    //      检查器照样绿（负例 mail-cap-silent-drop 第一次跑就是这么溜过去的 ✗）；
    //   ② 条件里**自带括号**（`mailMaxMails()`），所以不能用 `[^)]*` 去跨它 ——
    //      那样连**没改动的真代码**都匹配不上（对照组假失败，第二次跑撞上的就是这条 ✗）。
    //      改成"同一行内允许括号、不许跨行" ✓。
    bad('send() 里没有"到上限就分支"的守卫（条件里必须出现 mailMaxMails()）—— '
      + '邮箱会无限堆积，或者守卫被人改成恒假而没人发现 ✗');
  } else if (!/BOX_FULL/.test(send[0])) {
    bad('send() 到上限时没有拒绝');
  } else if (/remove\(|removeIf\(|removeLast|subList/.test(send[0])) {
    bad('send() 到上限时**挤掉了旧邮件** —— 用户要的是"拒绝投递并提示"，不是悄悄删 ✗');
  } else if (!/LOGGER\.warn/.test(send[0])) {
    bad('拒绝投递时没有写 WARN 日志（服主查不到"为什么没收到"）✗');
  } else {
    ok('到 maxMails 时拒绝投递 + WARN（不静默丢、不挤掉旧的）✓');
  }
}

// ---------------------------------------------------------------- G. 文案只走 template + args
{
  // 服务端不许拼中文：找 literal("...中文...") 或 literal("第 xx 期")
  const han = /Component\.literal\("[^"]*[\u4e00-\u9fa5][^"]*"\)/.exec(svc);
  if (han) {
    bad('MailService 里出现了拼中文的 Component.literal（' + han[0] + '）—— '
      + '服务端没有语言表，英文客户端会看到中文 ✗；应该只发 template + args');
  } else {
    ok('服务端不拼中文（只发 template + args）✓');
  }
  if (/send\([\s\S]{0,200}?new MailEntry\(/.test(svc) || /new MailEntry\(/.test(svc)) {
    ok('投递走 new MailEntry(template, args, …)（文案在语言文件里）✓');
  } else bad('投递没有构造 MailEntry');
  // 中英键齐全：扫描当前用到/登记的模板
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
  const templates = new Set();
  for (const m of svc.matchAll(/send(?:Admin)?\([^,]+, "([a-z_]+)"/g)) templates.add(m[1]);
  templates.add('admin');
  if (/"admin"/.test(svc)) templates.add('admin');
  const missing = [];
  for (const t of templates) {
    for (const [lang, j] of [['zh', zh], ['en', en]]) {
      for (const part of ['title', 'body', 'button']) {
        if (!String(j['mail.anglertackle.' + t + '.' + part] || '').trim()) {
          missing.push(lang + ':' + t + '.' + part);
        }
      }
    }
  }
  if (missing.length) bad('这些模板文案缺键：' + missing.join('、'));
  else ok('模板 ' + [...templates].sort().join('/') + ' 的 title/body/button 中英齐全（' + (templates.size * 6) + ' 个键）');
}

// ---------------------------------------------------------------- H. 配置
{
  const keys = ['keepDays', 'maxMails', 'bodyMaxChars', 'unreadLoginNotice'];
  const missCfg = keys.filter((k) => !new RegExp('"' + k + '"').test(cfg));
  const missGet = keys.filter((k) => !new RegExp('mail' + k.charAt(0).toUpperCase() + k.slice(1) + '\\(\\)').test(tun));
  const missReload = keys.filter((k) => !new RegExp('"mail\\.' + k + '"').test(tun));
  if (missCfg.length || missGet.length || missReload.length) {
    bad('配置没接全 —— 缺定义：' + (missCfg.join(',') || '无')
      + '；缺 getter：' + (missGet.join(',') || '无')
      + '；缺热重载映射：' + (missReload.join(',') || '无'));
  } else {
    ok('`[mail]` 四项：配置定义 / Tuning getter / 热重载映射 都在 ✓');
  }
  if (/mailBodyMaxChars\(\)/.test(svc) && /mailKeepDays\(\)/.test(svc)) {
    ok('保管期与正文上限都从配置读（没有写死的 30 / 500）✓');
  } else bad('保管期或正文上限没走配置');
}

// ---------------------------------------------------------------- I. 界面（M2，docs/36 §5）
//
// 这一组守的都是"看起来能用、其实状态悄悄错了"的行为：
//   · 划过行就标已读 ⇒ 未读数莫名归零（《死亡搁浅》的反例，docs §5.3 第一条）；
//   · 点行就顺手把附件领了 ⇒ 背包满时玩家的东西没了着落（§3 纪律 1）；
//   · 空邮箱画一个空列表 ⇒ 和"加载失败"长得一模一样（§5.3 空状态）；
//   · 面板尺寸写死 ⇒ 小窗口切内容（§5.4；check-ui-fit.js 也会验四种窗口）。
{
  const SCR = 'src/main/java/com/whitecobalt/anglertackle/client/screen/MailScreen.java';
  if (!exists(SCR)) {
    bad('缺少邮箱界面 ' + SCR + '（docs/36 M2）');
  } else {
    const scr = strip(read(SCR));
    // ① 划过什么都不做：mouseMoved 里不许出现"标已读"
    const moved = /(?:public\s+)?void\s+mouseMoved\([\s\S]*?\n    \}/.exec(scr);
    if (moved && /withRead|MailActionPayload\.READ|\.read\(/.test(moved[0])) {
      bad('mouseMoved（划过）里改了已读状态 —— 用户划过列表就把未读数清零了（docs/36 §5.3 明令禁止）✗');
    } else {
      ok('鼠标划过行不改变已读状态（未读数不会被"看一眼"清零）✓');
    }
    // ② 点行 = 选中 + 已读，但**不自动领取**
    //   ⚠ 判据要跟着**调用链**走：点行现在调共用的 selectIndex()（点击/键盘同一条路），
    //   READ 落在那个方法里 —— 只盯 mouseClicked 的方法体会变成"假失败"（改完就撞上 ✗）。
    const clicked = /(?:public\s+)?boolean\s+mouseClicked\([\s\S]*?\n    \}/.exec(scr);
    const selFn = /private void selectIndex\([\s\S]*?\n    \}/.exec(scr);
    if (!clicked) {
      bad('找不到 mouseClicked —— 列表行点不动？');
    } else if (/MailActionPayload\.CLAIM/.test(clicked[0])) {
      bad('mouseClicked（点行）里直接领取了附件 —— "点开看一眼"不能等于"领了"'
        + '（背包满时物品留在哪？无解；docs/36 §3 纪律 1）✗');
    } else if (!/MailActionPayload\.READ/.test(clicked[0]) && !/selectIndex\(/.test(clicked[0])) {
      bad('mouseClicked 既没标已读、也没走共用的选中方法 —— 点开详情却没读过，未读数不会消');
    } else if (!selFn) {
      bad('找不到 selectIndex(...) —— 点击与键盘的"选中"没有共用实现（两套逻辑迟早分叉）');
    } else if (!/MailActionPayload\.READ/.test(selFn[0])) {
      bad('selectIndex 里没有标已读 —— 点行/键盘选中都不会消未读');
    } else if (/MailActionPayload\.CLAIM/.test(selFn[0])) {
      bad('selectIndex（选中）里顺手领取了附件 —— 选中 ≠ 领取（docs/36 §3 纪律 1）✗');
    } else {
      ok('点行 = 选中 + 标已读，且**不自动领取**（点击与键盘共用 selectIndex）✓');
    }
    // ②b 交互要齐：滚轮翻页 / ↑↓ 选择 / Enter 领取（Esc 关是父类默认）
    //   ⚠ 判据必须盯住**覆写签名**、而且按键要**在 keyPressed 的方法体里**
    //   （2026-10-12 负例 `mail-no-scroll` / `mail-no-keys` 抓出来的洞）：
    //   原来只搜 `mouseScrolled(` / `keyPressed(`，而把签名改成 `_removed(` 之后
    //   方法体里的 `super.mouseScrolled(...)` / `super.keyPressed(...)` **还在** ⇒
    //   检查器照样绿 ✗。这已经是第四次同一类：
    //   **"文件里存在某字符串" ≠ "那件事真的在做"**（copyOnDeath / _negrun 名字 /
    //   空状态 / 这一条），所以这里连方法体一起限定。
    const scrollFn = /public boolean mouseScrolled\([\s\S]*?\n    \}/.exec(scr);
    const keyFn = /public boolean keyPressed\([\s\S]*?\n    \}/.exec(scr);
    if (!scrollFn) {
      bad('找不到 mouseScrolled 覆写 —— 滚轮翻不了页（用户要求"所有功能做到点击交互"）');
    } else if (!keyFn) {
      bad('找不到 keyPressed 覆写 —— 键盘导航没了，只能拿鼠标逐行点（用户点名要的）');
    } else {
      const up = /case 265/.test(keyFn[0]);
      const down = /case 264/.test(keyFn[0]);
      const enter = /case 257/.test(keyFn[0]) || /case 335/.test(keyFn[0]);
      if (up && down && enter) {
        ok('交互齐：滚轮翻页 / ↑↓ 选行 / Enter 领取 / Esc 关闭 ✓'
          + '（判据限定在 mouseScrolled / keyPressed 的方法体里）');
      } else {
        bad('keyPressed 里缺键位 —— ↑:' + up + ' ↓:' + down + ' Enter:' + enter);
      }
    }
    // ②d 悬浮提示（列表行 / 附件格 / 快捷键说明）
    //   （编号沿用旧注释里的 ②c，别被这里的顺序绕晕：下一条才是图鉴入口）
    // 26.1.2：GuiGraphics 的 renderTooltip / renderComponentTooltip 改名为
    // setTooltipForNextFrame / setComponentTooltipForNextFrame（画在下一帧的 tooltip 槽里）。
    if (/setComponentTooltipForNextFrame\(/.test(scr) || /setTooltipForNextFrame\(/.test(scr)) {
      ok('有悬浮提示（列表行 / 附件格 / 快捷键说明）✓');
    } else {
      bad('没有任何悬浮提示 —— 附件格里的物品看不出是什么');
    }
    // ②d 图鉴里那个入口（docs/36 §5.7 的第三个入口）
    const codexSrc = read('src/main/java/com/whitecobalt/anglertackle/client/screen/CodexScreen.java');
    if (/MailActionPayload\.OPEN/.test(codexSrc)) {
      ok('图鉴里也有邮箱入口（与排行榜按钮同一行）✓');
    } else {
      bad('图鉴里没有邮箱入口 —— docs/36 §5.7 要的三个入口只做了两个');
    }
    // ②e 正文**看得全**（用户 2026-10-12 实测报的 bug，配截图）：
    //   "右侧文本区域显示不全，而且没有类似滚轮或翻页的设计用来查看后续内容"。
    //   三条都要在：① 行数按可用高度现算（写死 6 行时正文被附件区拦腰截断）；
    //   ② 滚动有入口（鼠标在详情栏用滚轮 / PgUp·PgDn 键盘）；
    //   ③ **有滚动指示**（还有内容时必须画出来 —— 不然玩家根本不知道下面还有字，
    //      这正是用户那次没意识到"能滚"的原因）。
    {
      const hardMax = /int maxLines = 6;/.test(scr);
      const computed = /int maxLines = Math\.max\(1, \(bodyBottom - ty\) \/ LINE_STEP\)/.test(scr);
      const bodyScroll = /private int bodyScroll = 0;/.test(scr);
      const wheelOverDetail = /if \(mx >= detX && mx <= detX \+ detW && selected\(\) != null\)/.test(scr)
        && /bodyScroll = next;/.test(scr);
      const keys = /case 266, 267/.test(scr);
      const indicator = /maxScroll > 0/.test(scr) && /int barX = x \+ w - 6;/.test(scr)
        && /g\.fill\(barX, thumbY, barX \+ 2, thumbY \+ thumbH, C_LABEL\);/.test(scr);
      const noTextCounter = !/mail_body_scroll/.test(scr);
      // ⚠ 正文区**不许**把任何东西画到"附件"那一行上（用户 2026-10-12 第二次实测：
      //   "很明显有文字重叠了"—— 上一版的行数提示正好压在 attachY() - 10 的"附件"上）✗
      const attachOverlap = /bodyBottom \+ 1/.test(scr) || /attachY\(\) - 11/.test(scr);
      const resetOnSwitch = /bodyScroll = 0;/.test(scr);
      const miss = [];
      if (!computed || hardMax) miss.push('正文行数没有按可用高度现算');
      if (!bodyScroll) miss.push('没有滚动状态');
      if (!wheelOverDetail) miss.push('鼠标在详情栏滚轮不滚正文');
      if (!keys) miss.push('PgUp/PgDn 不能翻正文');
      if (!indicator) miss.push('没有滚动条（玩家不知道下面还有字）');
      if (!noTextCounter) miss.push('又画了"行数"文字（占地方且压住"附件"）');
      if (attachOverlap) miss.push('有东西画在"附件"那一行上（文字会重叠）');
      if (!resetOnSwitch) miss.push('换邮件时正文不回到顶部');
      if (miss.length) {
        bad('正文看不全 / 没法翻 / 压字：' + miss.join('、')
          + '（用户 2026-10-12 两次截图："显示不全，也没有滚轮或翻页"、"文字重叠了"）✗');
      } else {
        ok('正文按可用高度现算 + 滚轮/PgUp·PgDn 可翻 + **细滚动条**（不写字、不压"附件"）+ 换信归零 ✓');
      }
    }
    // ②f 附件区/正文的位置只有一处定义（三处各算一遍迟早漂）
    if (/private int attachY\(\)/.test(scr) && (scr.match(/int sy = attachY\(\);/g) || []).length >= 2) {
      ok('附件区 y 只有一处定义（attachY()，渲染与命中判定共用）✓');
    } else {
      bad('附件区的 y 在多处各写了一遍 —— 判定与绘制迟早对不上（"点得到但看不出来"）');
    }
    // ②g 服务端只发 id，翻译在客户端：联赛邮件的档位参数必须翻成中文
    //   （用户截图里就是「第 1 期small联赛邀请」—— 服务端发的是 id，客户端没翻）
    if (/expandArgs\(Row r\)/.test(scr) && /league\.anglertackle\.tier\./.test(scr)
        && /r\.template\.startsWith\("league"\)/.test(scr)) {
      ok('邮件参数的枚举 id 在客户端翻成本地化文本（档位不再显示成 small/medium/large）✓');
    } else {
      bad('邮件标题/正文里的档位参数没有本地化 —— 玩家会看到「第 1 期small联赛邀请」'
        + '（服务端没有语言表，只能发 id，翻译必须在客户端做）✗');
    }
    // ②h 正文里不许有 Markdown（游戏不渲染，只会多出星号）
    {
      const zhAll = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
      const enAll = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));
      const mdBad = [];
      for (const [name, j] of [['zh_cn', zhAll], ['en_us', enAll]]) {
        for (const [k, v] of Object.entries(j)) {
          if (typeof v === 'string' && v.includes('**') && !k.startsWith('_comment')) {
            mdBad.push(name + ' ' + k);
          }
        }
      }
      if (mdBad.length) {
        bad('语言文件里有 Markdown 的 **（游戏不渲染，玩家看到的是多出来的星号）：'
          + mdBad.slice(0, 5).join('、') + (mdBad.length > 5 ? ' 等 ' + mdBad.length + ' 处' : '') + ' ✗');
      } else {
        ok('语言文件里没有 Markdown 的 **（邮件正文/标题在游戏里是纯文本）✓');
      }
      // ②i 正文必须**短句手写**（用户 2026-10-12：折行折在"5 / 游戏日"之间，
      //     "让人读起来戛然而止"）。
      //     两条一起守：① 正文用 UiLayout.wrapCjk（不在拉丁词与中文之间断）；
      //     ② 每条正文的**最长一行 ≤ 24 字**（写长了必然要折，折了就一截一截）。
      // ⚠ 判据要**数调用点**（渲染 + 行数计算两处都要），不能只搜"文件里有没有 wrapCjk"：
      //   把渲染那处换回 font.split、而 bodyLineCount 里那句还在 ⇒ 只搜字符串照样绿 ✗
      //   （负例 no-wrapcjk 第一次跑就是这么溜过去的 —— 今天同一类陷阱第 N 次）。
      const wrapCalls = (scr.match(/UiLayout\.wrapCjk\(/g) || []).length;
      const noFontSplit = !/font\.split\(/.test(scr);
      if (!noFontSplit || wrapCalls < 2) {
        bad('正文折行没有全部走 UiLayout.wrapCjk（渲染共 ' + wrapCalls + ' 处调用'
          + (noFontSplit ? '' : '、并且还在用 font.split')
          + '）—— font.split 逐字符填，"5 游戏日"会被从中间劈开 ✗');
      } else if (!/public static java\.util\.List<String> wrapCjk/.test(read(
          'src/main/java/com/whitecobalt/anglertackle/client/screen/UiLayout.java'))) {
        bad('UiLayout 里没有 wrapCjk 实现 —— 这条断言要跟着改');
      } else {
        const longBodies = [];
        for (const [name, j] of [['zh_cn', zhAll], ['en_us', enAll]]) {
          for (const [k, v] of Object.entries(j)) {
            if (!/^mail\.anglertackle\..*\.body$/.test(k) || typeof v !== 'string') continue;
            const longest = Math.max(...v.split('\n').map((l) => [...l].length));
            // 英文一行能放的字更多（字母窄），阈值给宽一点
            const limit = name === 'zh_cn' ? 24 : 40;
            if (longest > limit) longBodies.push(name + ' ' + k.replace('mail.anglertackle.', '')
              + '（最长 ' + longest + ' 字）');
          }
        }
        if (longBodies.length) {
          bad('这些邮件正文写得太长（折行后会一截一截，用户原话"读起来戛然而止"）：'
            + longBodies.slice(0, 4).join('、'));
        } else {
          ok('正文都是短句手写（中文每行 ≤ 24 字）+ 用 wrapCjk 折行（"5 游戏日"不会被劈开）✓');
        }
      }
    }
    // ③ 空状态：两行字（不是空列表）
    //   ⚠ 判据必须盯住"**drawString 调用里**真的画了这两个键"：只搜整个文件有没有
    //   `mail_empty` 的话，把第一行改成 `drawString("")` 之后，第二行的 `mail_empty_hint`
    //   仍然在文件里 ⇒ 检查器照样绿（负例 mail-empty-list 第一次跑就是这么溜过去的 ✗，
    //   今天第三次同类：**"文件里存在某字符串" ≠ "那件事真的在做"**）。
    const drawn = new Set();
    // 26.1.2：drawString 改名为 text(font, …)，判据两种写法都认（旧写法留在副本里时也要能抓到）
    for (const m of scr.matchAll(
      /\b(?:drawString|text)\([\s\S]{0,300}?"(gui\.anglertackle\.mail_(?:empty|empty_hint|loading))"/g)) {
      drawn.add(m[1]);
    }
    const needEmpty = ['gui.anglertackle.mail_empty', 'gui.anglertackle.mail_empty_hint'];
    const missEmpty = needEmpty.filter((k) => !drawn.has(k));
    if (missEmpty.length) {
      bad('空状态没有在 text(...) 里画出这几行字：' + missEmpty.join('、')
        + ' —— 空列表与"加载失败"长得一模一样 ✗');
    } else {
      ok('空状态真的画了两行字（正文 + 提示），不是空列表 ✓');
    }
    // ④ 尺寸走 UiLayout（面板按窗口 clamp、行数现算、文字截断）
    const uses = ['UiLayout.panelW(', 'UiLayout.panelH(', 'UiLayout.rows(', 'UiLayout.fitText(']
      .filter((k) => !scr.includes(k));
    if (uses.length) bad('界面没用 ' + uses.join(' / ') + ' —— 小窗口会切内容（check-ui-fit.js 也会红）');
    else ok('面板尺寸/行数/截断都走 UiLayout（四种窗口尺寸都装得下）✓');
    // ⑤ 附件格 18×18、按钮高 18（与既有 5 个界面一致）
    if (/SLOT\s*=\s*18/.test(scr)) ok('附件格 18×18（与背包格视觉一致）✓');
    else bad('附件格尺寸不是 18（`SLOT = 18`）—— 与既有界面不一致');
    const btnHeights = [...scr.matchAll(/\.bounds\([^)]*?,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    const oddBtn = btnHeights.filter((h) => h !== 18 && h !== 11 && h !== 24);
    if (btnHeights.filter((h) => h === 18).length >= 3) {
      ok('按钮高 18（与既有 5 个界面一致；内部一致优先于原版惯例 20）✓');
    } else {
      bad('找不到三个高 18 的按钮（全部读到的高度：' + btnHeights.join(',') + '）');
    }
    // ⑥ 配色复用既有常量，不新起色板
    const KNOWN = ['0xFFFFD050', '0xFF8FCBF5', '0xFFE8E8E8', '0xFFB0B0B0', '0xFF909090',
      '0xFF243028', '0xF0000000', '0xFF5A6A60', '0xFF3A4A40', '0xFFFF5555', '0x40FFFFFF', '0x30000000'];
    const unknown = [...new Set([...scr.matchAll(/0x[0-9A-Fa-f]{8}/g)].map((m) => m[0]))]
      .filter((c) => !KNOWN.includes(c));
    if (unknown.length) {
      bad('界面里出现了既有色板之外的颜色的码：' + unknown.join('、')
        + '（`docs/36` §5.4：颜色必须复用既有常量，品质色走 Quality）✗');
    } else {
      ok('配色全部落在既有常量里（没另起一套色板）✓');
    }
  }
}

// ---------------------------------------------------------------- J. 无附件的动作必须跑得起来
//
// 2026-10-14 用户验收实测：委托信（quest_accept）**没有附件**，而当时
//   ① deliver 没有带 action 的重载 ⇒ 信上根本没挂动作；
//   ② 就算挂了，claimed 初始为 true + claim 的无附件分支提前 return + 界面 canClaim 要求有附件
//      ⇒ 按钮恒灰，玩家点了没反应。
// 这三处必须在结构上保证"没附件的动作也跑得起来" —— 每一处都配了负例（见 _negtest.js 的
// mail-claimed-init-noaction / mail-claim-noattachment-action / mail-canclaim-no-action）。
{
  const SCR = 'src/main/java/com/whitecobalt/anglertackle/client/screen/MailScreen.java';
  // ① send() 六参方法里：claimed 初始值必须把 action 算进去（有动作 = 还没执行过 ≠ 已办完）
  const send6 = /public static Result send\(ServerPlayer to,\s*String template,\s*List<String> args,\s*long coins[\s\S]*?\n    \}/.exec(svc);
  if (!send6) {
    bad('找不到 MailService.send(ServerPlayer, template, args, coins, items, action)');
  } else if (!/!\(hasAttachment\s*\|\|\s*hasAction\)/.test(send6[0])) {
    bad('send() 里 claimed 初始值没算上 action（`!(hasAttachment || hasAction)`）—— '
      + '带动作的信一寄出来就是"已办完"，界面按钮恒灰 ✗');
  } else {
    ok('send()：有动作的信初始 claimed=false（按钮可点）✓');
  }
  // ② claim() 的无附件分支里必须执行动作（否则 quest_accept 永远跑不起来）
  //    ⚠ 用 indexOf 定序 + 窗口，不用宽松通配（A1 的教训）：后面的"附件领完再跑动作"
  //    那一处隔着整个发物品循环，窗口外的匹配等于没守。
  const iNA = svc.indexOf('if (!m.hasAttachment())');
  const iRun = svc.indexOf('MailActions.run(', iNA);
  if (iNA < 0) {
    bad('claim() 里找不到无附件分支');
  } else if (iRun < 0 || iRun - iNA > 300) {
    bad('claim() 的无附件分支没有执行动作（MailActions.run）—— 委托按钮就是个摆设 ✗');
  } else {
    ok('claim()：无附件的信也执行动作 ✓');
  }
  // ③ 界面 canClaim() 必须放行"只有动作"的信
  if (!exists(SCR)) {
    bad('缺少邮箱界面 ' + SCR);
  } else {
    const scr = strip(read(SCR));
    const cc = /boolean canClaim\(\)\s*\{[\s\S]{0,260}?\n    \}/.exec(scr);
    if (!cc) {
      bad('MailScreen 里找不到 canClaim()');
    } else if (!/!action\.isEmpty\(\)/.test(cc[0])) {
      bad('canClaim() 没放行"只有动作没有附件"的信 —— 委托按钮恒灰 ✗');
    } else {
      ok('canClaim()：只有动作的信也可点 ✓');
    }
  }
  // ④ MailEntry.withAction：升级旧信用它补按钮，且 claimed 必须打回 false
  const wa = /public MailEntry withAction\(String action\)\s*\{[\s\S]{0,260}?\n    \}/.exec(entry);
  if (!wa) {
    bad('MailEntry 没有 withAction(...)（旧委托信升级补按钮要用它）');
  } else if (!/\bfalse\b/.test(wa[0])) {
    bad('withAction() 没有把 claimed 打回 false —— 升级完按钮还是灰的 ✗');
  } else {
    ok('MailEntry.withAction：补按钮 + claimed 回 false ✓');
  }
}


// ---------------------------------------------------------------- 新信到达：两条路都要有（2026-10-16）
//
// 用户复验："上了鱼也没有第一时间弹，只在后续测试时再次登录后弹出"。
// 服务端当场发了（日志里「投递」与「新信提示」同一毫秒），但**只发动作栏** ——
// 那行两秒后淡出、不进聊天记录，刚上鱼时必然错过 ✗。
{
  const mail = read(SVC);
  const ann = /private static void announce\(ServerPlayer to, MailEntry entry\)[\s\S]*?\n    \}/.exec(mail);
  if (!ann) {
    bad("MailService 里找不到 announce()");
  } else {
    const a = strip(ann[0]);
    // 26.1.2：Player#displayClientMessage(msg, actionBar) 已拆成
    // sendSystemMessage(msg)（聊天栏，留在记录里）/ sendOverlayMessage(msg)（动作栏，两秒淡出）。
    // 断言语义不变：**聊天栏那行必须有**（不然玩家错过就再也看不到），动作栏那行也必须发。
    const chat = /sendSystemMessage\(\s*Component\.translatable\(\s*"message\.anglertackle\.mail_arrived"/.test(a);
    const toast = /sendOverlayMessage\(\s*Component\.translatable\(\s*"message\.anglertackle\.mail_arrived"/.test(a);
    if (chat) ok("新信会往**聊天栏**发一行（留在记录里，不会两秒就消失）");
    else bad("新信只发动作栏 —— 玩家刚上鱼时必然错过，然后以为「要等下次登录」");
    if (toast) ok("同时也弹一次**动作栏**（一眼就能看到）");
    else bad("新信没有动作栏提示");
    if (/MAIL_TOAST_GAP_TICKS/.test(a)) ok("动作栏**节流**（一次上鱼连发几封时不刷屏）");
    else bad("动作栏没节流 —— 完成委托+到档一次寄 3 封时会连弹 3 次");
  }
}

console.log('');
if (fail) {
  console.log('❌ 邮件箱检查未通过（' + fail + ' 项）');
  process.exit(1);
}
console.log('✅ 邮件箱检查通过');
