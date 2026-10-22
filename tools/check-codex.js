const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 守住"鱼类图鉴"这条链：记账 → 界面 → 完成度奖励。
//
// 为什么每一条都值得单独断言 —— 它们全是**编译能过、游戏能跑、
// 只是数据或体验悄悄不对**的类型：
//   · 记账多写一处 → 同一条鱼被记两次（次数翻倍、完成度虚高），而图鉴看起来完全正常
//   · 奖励不幂等 → 每次上鱼把已达成的里程碑重发一遍：余额只涨不跌，没人会怀疑钱变多
//   · bestTier 从 SizeGrade 反推 → 金(4) 和红(5) 都落在 RECORD，金鱼被记成红鱼
//   · 界面用 drawString → 本环境里画出来是糊的（见 GuideScreen 的类注释）
//   · 列表"装不下就 break" → 21 条里有几条永远看不到，界面也不提示"下面还有"
//   · 漏注册包 / 漏清缓存 → 界面打不开、换存档闪上一个档的完成度
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');
const RES = path.join(ROOT, 'src/main/resources');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };
const read = (rel) => fs.readFileSync(path.join(JAVA, rel), 'utf8');
// 剥注释走共用实现（各写一份踩过坑：见 tools/java-source.js 顶部）。
// ⚠ 这一层尤其必须剥：图鉴的代码里到处都在**注释里解释坏写法**
//（"不能从 SizeGrade 反推"、"不能用 drawString"、"不能 break 丢行"），
// 不剥的话检查器会被自己的说明文字触发，报出"因为解释得太清楚"而失败的红灯。
const { stripComments: strip } = require('./java-source.js');
const code = (rel) => strip(read(rel));
const exists = (rel) => fs.existsSync(path.join(JAVA, rel));

function walkJava(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJava(p, out);
    else if (e.name.endsWith('.java')) out.push(p);
  }
  return out;
}
const REL = (p) => path.relative(JAVA, p).split(path.sep).join('/');
const ALL_JAVA = walkJava(JAVA, []);
const ALL_CODE = new Map(ALL_JAVA.map((p) => [REL(p), strip(fs.readFileSync(p, 'utf8'))]));

const zh = JSON.parse(fs.readFileSync(path.join(RES, 'assets/anglertackle/lang/zh_cn.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(RES, 'assets/anglertackle/lang/en_us.json'), 'utf8'));

// ---------------------------------------------------------------- 1. 记账只有一个写入口
//
// 图鉴数据只有一条写入路径：上鱼时 onCatch 里那一次 recordCatch。
// 多一处写入（比如"打开界面时顺手修一下数据"、指令补记）都会让同一件事有两个出处，
// 而两个出处的口径迟早分叉 —— 表现是"次数偶尔不对"，几乎无法复现。
{
  const writers = [...ALL_CODE.entries()]
    .filter(([, s]) => /\.recordCatch\(/.test(s))
    .map(([rel]) => rel);
  if (writers.length === 1 && writers[0] === 'fishing/FishingManager.java') {
    ok('图鉴记账只有一个写入点（fishing/FishingManager.java）');
  } else {
    no('图鉴记账的写入点不是唯一一处：[' + writers.join(', ') +
       '] —— 应为 fishing/FishingManager.java 一处');
  }

  const fm = ALL_CODE.get('fishing/FishingManager.java') || '';
  const calls = (fm.match(/\.recordCatch\(/g) || []).length;
  if (calls === 1) ok('FishingManager 里 recordCatch 只调了一次');
  else no('FishingManager 调用了 ' + calls + ' 次 recordCatch（同一条鱼会被记多次）');

  const onCatch = fm.indexOf('public void onCatch(');
  const at = fm.indexOf('.recordCatch(');
  if (onCatch >= 0 && at > onCatch) ok('记账确实在 onCatch 里');
  else no('记账不在 onCatch 里 —— 上鱼路径没有记账');

  // 绕过 recordCatch 直接改 codex 表：更隐蔽的第二种写入口
  const direct = [...ALL_CODE.entries()]
    .filter(([, s]) => /codex\(\)\.(put|remove|clear|replaceAll)/.test(s))
    .map(([rel]) => rel);
  if (direct.length === 0) ok('没有绕过 recordCatch 直接改 codex 表的地方');
  else no('这些文件直接改了 codex 表：' + direct.join(', ') + '（应统一走 recordCatch）');
}

// ---------------------------------------------------------------- 2. 完成度奖励必须幂等
{
  const f = 'economy/CodexRewards.java';
  if (!exists(f)) {
    no('缺少 ' + f + ' —— 图鉴完成度奖励没有实现');
  } else {
    const s = code(f);
    if (/hasClaimed\(/.test(s)) ok('奖励用 hasClaimed 查重（发过的里程碑不再发）');
    else no('CodexRewards 没有查重 —— 完成度只增不减，每次上鱼都会把已达成的里程碑重发一遍');
    if (/markClaimed\(/.test(s)) ok('奖励用 markClaimed 置位（位掩码记的是"哪几个发过"）');
    else no('CodexRewards 没有置位 —— 同一档奖励会被无限重发');
    if (/PlayerData\.update\(/.test(s)) ok('奖励走 PlayerData.update（读改写一次完成，不会漏保存）');
    else no('奖励没有走 PlayerData.update —— 加币可能没写回附件，重启就变回去');
    // 2026-10-12 M4 改造：奖励从"直接加币"改成"**寄信**"（`docs/36` §4.1 第 3 条：
    // "玩家**知道**这 50 币是哪来的"）。⇒ syncCoins 不再需要（**没有改币**），
    // 但换来两条**更要紧**的约束：
    //   ① 必须**先投递、后置位**（满箱时若已置位，那笔钱永久拿不到且不报错）；
    //   ② 满箱分支里**不许** markClaimed（否则同样是静默丢失）。
    if (/MailService\.deliver\(player, "codex_milestone"/.test(s)) {
      ok('里程碑奖励已改成寄信（MailService.deliver(codex_milestone)）');
      // ⚠ 用**下标顺序**判"先投递后置位"，不用 `[\s\S]{0,N}` 的距离窗：
      //   满箱分支有几十行，窗口给小了会假红（第一版 900 字就撞上了）。
      const deliverAt = s.indexOf('MailService.deliver(player, "codex_milestone"');
      const markAt = s.indexOf('markClaimed(');
      const beforeMark = deliverAt >= 0 && markAt > deliverAt;
      const fullGuard = /sent != MailService\.Result\.OK[\s\S]{0,600}?return 0L;/.test(s);
      const markInFull = /sent != MailService\.Result\.OK[\s\S]{0,600}?markClaimed\(/.test(s);
      if (!beforeMark) no('里程碑奖励没有"先投递、后置位" —— 满箱时会先把位标上，钱却永远发不出去 ✗');
      else if (!fullGuard) no('没有处理"邮箱满"（没看到 BOX_FULL 分支就 return）—— 奖励会静默丢失 ✗');
      else if (markInFull) no('满箱分支里居然置了位 —— 那笔钱永久拿不到，而且不报错 ✗');
      else ok('先投递、后置位：满箱时不置位、下次上鱼自动重试（奖励不会丢）');
    } else if (/syncCoins\(/.test(s)) {
      ok('发完同步余额（syncCoins），HUD 不会停在旧值');
    } else {
      no('里程碑奖励既没走寄信、也没调 syncCoins —— 奖励去哪了？');
    }
    if (/MAX_MILESTONES/.test(s)) ok('里程碑数量有上界（int 位掩码只可用低 30 位）');
    else no('里程碑没有上界 —— 位移越界会写成负数，表现是"奖励再也不发"');

    // 口径锁：docs/16 §④ 每点亮 2 种发 50 鱼币（数字采 docs/03 §9.1）
    if (/SPECIES_PER_MILESTONE\s*=\s*2\s*;/.test(s)) ok('口径：每点亮 2 种算一个里程碑');
    else no('SPECIES_PER_MILESTONE 不是 2 —— 与 docs/16 §④ 的口径不符');
    if (/COINS_PER_MILESTONE\s*=\s*50L\s*;/.test(s)) ok('口径：每个里程碑 50 鱼币');
    else no('COINS_PER_MILESTONE 不是 50 —— 与 docs/03 §9.1 的数字不符');

    // 完成度的分母必须现算：写死 21 的话，加第 22 种鱼的那一刻完成度就永久算错
    if (!/\b21\b/.test(s)) ok('没有把鱼种总数写死（分母来自 codexCount()）');
    else no('CodexRewards 里写死了 21 —— 应该用 codexCount() 现算');

    // 顺序：奖励必须在图鉴记账之后。反了的话完成度还是上一条鱼的，
    // 表现是"点亮第 20 种时只发到第 9 个里程碑"，永远晚一步。
    const fm = ALL_CODE.get('fishing/FishingManager.java') || '';
    const grant = fm.indexOf('grantMilestones(');
    const record = fm.indexOf('.recordCatch(');
    if (grant < 0) no('onCatch 里没有调 CodexRewards.grantMilestones —— 完成度奖励永远发不出去');
    else if (grant > record) ok('奖励在记账之后调用（顺序反了里程碑会永远晚一条鱼）');
    else no('奖励调用在记账之前 —— 读到的是上一条鱼时的完成度');

    // 上鱼路径本身仍然不给钱（用户定案靠 NPC 商店卖鱼拿钱，check-player-data 也守着这条）
    if (!/addCoins|withCoins/.test(fm)) ok('上鱼路径没有直接加币（只有图鉴里程碑走 CodexRewards）');
    else no('FishingManager 里出现了 addCoins/withCoins —— 用户定案上鱼不给钱，只有里程碑奖励');
  }
}

// ---------------------------------------------------------------- 3. 最高档位必须来自 effectiveTier()
//
// 鱼身上的 FishData 只存 SizeGrade，而 gold(4) 和 red(5) 都映射到 RECORD，
// 从 SizeGrade 反推会把金鱼记成红鱼。图鉴要显示"这条鱼我钓到过的最高品质"，
// 记错了就**再也纠正不回来**（数据已经落盘）。
{
  const fm = ALL_CODE.get('fishing/FishingManager.java') || '';
  if (/int tier\s*=\s*data\.effectiveTier\(\)\s*;/.test(fm)) {
    ok('记账用的档位取自 data.effectiveTier()（存下来的真实档）');
  } else {
    no('没看到 tier = data.effectiveTier() —— 记账的档位来源变了？');
  }
  if (/tierOfGrade|gradeOfTier/.test(fm)) {
    no('FishingManager 里出现了 tierOfGrade/gradeOfTier —— 金(4)红(5)都落在 RECORD，' +
       '金鱼会被记成红鱼');
  } else ok('FishingManager 里没有从 SizeGrade 反推档位的代码');

  const entry = ALL_CODE.get('player/CodexEntry.java') || '';
  if (/bestTier/.test(entry) && /gradesSeen/.test(entry)) ok('CodexEntry 存 bestTier + gradesSeen');
  else no('CodexEntry 缺 bestTier/gradesSeen —— 详情面板画不出最高品质');
}

// ---------------------------------------------------------------- 4. 两个包注册齐全 + 界面接线
{
  // ⚠ 把两个文件**接起来**看：C→S 的注册在 ModNetwork（common），
  //   S→C 的注册与处理在 client/ClientPayloadHandlers（客户端专用类）——
  //   拆开是因为专用服务器加载 ModNetwork 时不能碰到客户端类（Screen），
  //   见 ClientPayloadHandlers 的类注释。断言本身一条都没放松。
  const net = (ALL_CODE.get('network/ModNetwork.java') || '')
    + '\n' + (ALL_CODE.get('client/ClientPayloadHandlers.java') || '');
  if (/playToServer\(CodexRequestPayload\.TYPE/.test(net)) ok('CodexRequestPayload 注册为 C→S 包');
  else no('CodexRequestPayload 没有注册 —— 书右键之后服务端收不到请求');
  if (/playToClient\(CodexPayload\.TYPE/.test(net)) ok('CodexPayload 注册为 S→C 包');
  else no('CodexPayload 没有注册 —— 图鉴界面永远拿不到数据');

  if (/handleCodexRequest[\s\S]{0,400}?CodexSnapshot\.of\(player\)/.test(net)) {
    ok('handleCodexRequest 现读玩家附件下发（服务端权威）');
  } else no('handleCodexRequest 没有从附件现读 —— 客户端报什么就显示什么？');

  if (/handleCodex\([\s\S]{0,600}?enqueueWork/.test(net)) ok('handleCodex 走 enqueueWork（不在网络线程上碰客户端对象）');
  else no('handleCodex 没走 enqueueWork —— 多人下会偶发并发问题');
  if (/ClientCodex\.accept\(payload\)/.test(net)) ok('handleCodex 先把快照落进客户端缓存');
  else no('handleCodex 没有把快照落进 ClientCodex');
  if (/instanceof CodexScreen/.test(net) && /acceptNewData\(payload\)/.test(net)) {
    ok('已经开着图鉴时原地刷新（不重新开窗，页码不丢）');
  } else no('handleCodex 没有做"已开着界面就原地刷新" —— 每次回包都会重新开窗闪一下');
  if (/setScreen\(new CodexScreen\(/.test(net)) ok('handleCodex 会打开 CodexScreen');
  else no('handleCodex 没有开界面 —— 包里数据到位了但玩家什么也看不到');

  const book = ALL_CODE.get('item/CodexBookItem.java') || '';
  if (/PacketDistributor\.sendToServer\(CodexRequestPayload\.INSTANCE\)/.test(book)) {
    ok('书右键时发请求（客户端发起，服务端不回推就没数据）');
  } else no('CodexBookItem 右键没有发 CodexRequestPayload');

  const ev = ALL_CODE.get('event/CoinSyncEvents.java') || '';
  if (/LoggingOut[\s\S]{0,400}?ClientCodex\.reset/.test(ev)) {
    ok('退出世界时清掉图鉴缓存（否则换档会先闪上一个档的完成度）');
  } else no('退出世界时没有 ClientCodex.reset() —— 换存档会闪上一个档的图鉴');
}

// ---------------------------------------------------------------- 5. 界面本身的硬要求
{
  const f = 'client/screen/CodexScreen.java';
  if (!exists(f)) {
    no('缺少 ' + f);
  } else {
    const s = code(f);
    if (/extends Screen/.test(s)) ok('CodexScreen 是 Screen 子类');
    else no('CodexScreen 不是 Screen 子类');
    if (/isPauseScreen\(\)\s*\{[\s\S]{0,160}?return false/.test(s)) {
      ok('isPauseScreen() 返回 false（开着图鉴时游戏继续跑）');
    } else no('isPauseScreen() 没有返回 false —— 钓鱼时翻图鉴会把鱼停下来');

    if (/new TextWidget\(/.test(s)) ok('文字走 TextWidget（和按钮同一条渲染路径）');
    else no('没有用 TextWidget —— 本环境里 drawString 画出来的字是糊的');
    if (!/\bg\.drawString\(|\bgraphics\.drawString\(/.test(s)) {
      ok('没有直接 drawString（底色/进度条只用 fill）');
    } else no('CodexScreen 里有 drawString —— 文字会是糊的（GuideScreen 的类注释写了原因）');

    if (/ClientCodex\.known\(\)/.test(s)) ok('没收到同步时画"读取中"，不画空列表');
    else no('没有判断是否已同步 —— 会先画一个空列表，看起来像"刚钓的鱼没记上"');

    // 21 条必须能全部看完。GuideScreen 的正文循环是"装不下就 break"，
    // 在图鉴这里那是**静默丢行**：玩家永远看不到那几种鱼，界面也不提示。
    // （2026-10-02：每页行数从常量 ROWS_PER_PAGE 改成按面板高度现算的 rowsPerPage）
    if (/rowsPerPage\s*=/.test(s) && /Math\.min\(rows\.size\(\),\s*from \+ rowsPerPage\)/.test(s)) {
      ok('列表按每页行数取窗口，21 条一定翻得完（不是"装不下就 break"）');
    } else no('列表没有分页/滚动窗口 —— 装不下的行会被静默丢掉，玩家看不到那几种鱼');
    if (/pageCount\(/.test(s)) ok('有页数计算');
    else no('没有页数计算 —— 翻页按钮的边界会算错');

    // 未收集不隐藏（docs/16 §③）
    if (/"\?"/.test(s) && /count <= 0/.test(s)) ok('未收集的鱼显示 ? 且不隐藏（让玩家知道还有什么在等）');
    else no('未收集的鱼被隐藏了 —— 图鉴就失去了"还差几种"的目标感');

    // 5b. 装得进窗口 —— **已移到 tools/check-ui-fit.js**（2026-10-02）
    //
    // 用户截图报"图鉴装不下"之后，四个界面（图鉴/指南/商店/改装）统一改成走
    // UiLayout 自适应，版面断言也就抽成了一支通用检查器：结构上要求四个界面的
    // init() 用 UiLayout 按 this.width/this.height 现算，数值上按源码常量复算
    // 四种真实窗口尺寸、断言面板连同边框都装得下。
    // （留在这里会变成"只覆盖图鉴一个界面"的第二份真源，而且它引用的
    //   CodexScreen 内联公式已经搬进 UiLayout 了。）
  }
}

// ---------------------------------------------------------------- 6. 书物品 + 语言键
{
  const items = ALL_CODE.get('registry/ModItems.java') || '';
  if (/ITEMS\.register\("codex_book"/.test(items)) ok('codex_book 在 ModItems 里注册了');
  else no('ModItems 里没有注册 codex_book');
  if (/output\.accept\(CODEX_BOOK\.get\(\)\)/.test(items)) ok('codex_book 进了创造页签');
  else no('codex_book 没进创造页签 —— 游戏里根本拿不到（check-creative-tab 也守着这条）');

  // 界面上真正会去取的键：把 tr("...") / translatable("...") 的字面量都收进来。
  // 为什么不用 check-lang 那一套：CodexScreen 里的文字大多走 tr(key) 这个薄封装，
  // check-lang 只扫字面量 translatable("...")，会漏掉它们。
  const keys = new Set();
  for (const f of ['client/screen/CodexScreen.java', 'item/CodexBookItem.java']) {
    if (!exists(f)) continue;
    const raw = read(f);
    const re = /(?:\btr|translatable)\(\s*"([a-z0-9_.]+)"/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      if (!m[1].endsWith('.')) keys.add(m[1]);   // 结尾带点的是拼接前缀，不是完整键
    }
  }
  keys.add('item.anglertackle.codex_book');
  // 档位名是拼出来的：tooltip.anglertackle.quality.<key>
  for (const k of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) {
    keys.add('tooltip.anglertackle.quality.' + k);
  }
  const missZh = [...keys].filter((k) => !(k in zh));
  const missEn = [...keys].filter((k) => !(k in en));
  if (missZh.length) no('这些键缺中文：' + missZh.join(', '));
  else ok('界面/物品用到的 ' + keys.size + ' 个键中文齐全');
  if (missEn.length) no('这些键缺英文：' + missEn.join(', '));
  else ok('同一批键英文齐全');

  // 中文名得真的是中文：只填了键但值是英文占位的话，中文客户端上会看到英文
  if (/[\u4e00-\u9fff]/.test(zh['item.anglertackle.codex_book'] || '')) {
    ok('item.anglertackle.codex_book = "' + zh['item.anglertackle.codex_book'] + '"');
  } else no('item.anglertackle.codex_book 的中文值不对：' + JSON.stringify(zh['item.anglertackle.codex_book']));

  // 进度条标题里的 %s%% 是**必须**的：Component.translatable 走 String.format，
  // 单个 % 会被当成格式符，运行期直接抛异常（表现为"一打开图鉴就崩"）。
  const title = zh['gui.anglertackle.codex_title'] || '';
  if (/%s%%/.test(title)) ok('标题里的百分号转义正确（%s%%）');
  else no('gui.anglertackle.codex_title 里没有 %s%% —— String.format 会把单个 % 当格式符，打开界面即崩');
}

// ---------------------------------------------------------------- 7. 资源：模型 / 贴图 / 配方 / 标签
{
  const model = path.join(RES, 'assets/anglertackle/models/item/codex_book.json');
  const tex = path.join(RES, 'assets/anglertackle/textures/item/codex_book.png');
  if (fs.existsSync(model)) {
    const j = JSON.parse(fs.readFileSync(model, 'utf8'));
    const layer = j.textures && j.textures.layer0;
    const texName = layer ? String(layer).split('/').pop() : null;
    if (texName && fs.existsSync(path.join(RES, 'assets/anglertackle/textures/item', texName + '.png'))) {
      ok('模型声明了存在的贴图：' + layer);
    } else no('codex_book 的模型 layer0 指向不存在的贴图：' + layer);
  } else no('缺 assets/anglertackle/models/item/codex_book.json');

  // ⚠ 1.21.1 的数据包目录是**单数** recipe/（不是 1.21.2 之前那种复数）。
  //   核对过 1.21.1 原版客户端 jar：data/minecraft/recipe/ 下有 1290 个配方，
  //   而 data/minecraft/recipes/ 一个都没有。写错目录的表现是"配方静默不存在"：
  //   日志里只有一行 recipe 解析失败，游戏里就是"合不出来"。
  const recipe = path.join(RES, 'data/anglertackle/recipe/codex_book.json');
  const wrongDir = path.join(RES, 'data/anglertackle/recipes/codex_book.json');
  if (fs.existsSync(wrongDir)) no('配方放进了 recipes/（1.21.1 是单数 recipe/），游戏里合不出来');
  if (fs.existsSync(recipe)) {
    const r = JSON.parse(fs.readFileSync(recipe, 'utf8'));
    if (r.result && r.result.id === 'anglertackle:codex_book') ok('配方产出 anglertackle:codex_book');
    else no('配方产物不对：' + JSON.stringify(r.result));
    const useTag = JSON.stringify(r.ingredients || []).includes('anglertackle:fishes');
    if (useTag) ok('配方用 anglertackle:fishes 标签吃"任意鱼"');
    else no('配方没有用到 anglertackle:fishes 标签');
  } else no('缺 ' + path.relative(ROOT, recipe).replace(/\\/g, '/'));

  // 标签必须和 ModItems 里的鱼**逐个对齐**：
  // 加第 22 种鱼时忘了加标签，表现是"新鱼做不出图鉴书"，而别的都正常。
  const tagPath = path.join(RES, 'data/anglertackle/tags/item/fishes.json');
  const items = read('registry/ModItems.java');
  const fishIds = [...items.matchAll(/=\s*fish\("([a-z_]+)"\)/g)].map((m) => m[1]);
  if (fs.existsSync(tagPath)) {
    const values = (JSON.parse(fs.readFileSync(tagPath, 'utf8')).values || [])
      .map((v) => String(v).replace(/^anglertackle:/, ''));
    const missing = fishIds.filter((id) => !values.includes(id));
    const extra = values.filter((id) => !fishIds.includes(id));
    if (missing.length || extra.length) {
      no('fishes 标签与 ModItems 的鱼对不上' +
         (missing.length ? '；缺 ' + missing.join(', ') : '') +
         (extra.length ? '；多了 ' + extra.join(', ') : ''));
    } else ok('fishes 标签覆盖全部 ' + fishIds.length + ' 种鱼（和 ModItems 逐个对齐）');
  } else no('缺 data/anglertackle/tags/item/fishes.json');
}

// ---------------------------------------------------------------- 8. 图鉴数据不许挂在维度/全局上
//
// 附件挂在**玩家**身上才是"每档一份 + 按玩家分"（玩家 NBT 落在
// <存档>/playerdata/<uuid>.dat）。改成 Level 附件 → 主世界和下界各算一份图鉴；
// 改成全局 SavedData → 得自己按 UUID 索引，还多出"删号了数据还留着"。
// 这条改动编译能过、单档测试也正常，只有换存档/进传送门才会露馅。
{
  const scopeFiles = [
    'player/PlayerFishingData.java', 'player/PlayerData.java', 'player/CodexEntry.java',
    'fishing/CodexSnapshot.java', 'network/ModNetwork.java', 'registry/ModAttachments.java',
    // S→C 的处理搬到这里了（见上面的注释），扫"客户端状态"的文件清单也要带上
    'client/ClientPayloadHandlers.java',
  ];
  const wrong = [];
  for (const f of scopeFiles) {
    const s = ALL_CODE.get(f);
    if (s === undefined) { wrong.push(f + '(缺失)'); continue; }
    if (/SavedData/.test(s) || /ServerLevel|LevelChunk/.test(s)) wrong.push(f);
  }
  if (wrong.length) no('这些文件把图鉴数据往维度/全局上挂：' + wrong.join(', '));
  else ok('图鉴数据只走玩家附件（没有 Level / SavedData 迹象）');

  const att = ALL_CODE.get('registry/ModAttachments.java') || '';
  if (/PlayerFishingData/.test(att) && /\.serialize\(/.test(att) && /\.copyOnDeath\(\)/.test(att)) {
    ok('附件注册仍是 玩家级 + serialize + copyOnDeath');
  } else no('附件注册三件套缺了 —— 图鉴会退出即清零 / 死一次清零');
}

// ---------------------------------------------------------------- 9. 图鉴里的排行榜入口（2026-10-11）
//
// 用户 2026-10-11 定案："**排行榜可以通过图鉴打开**，类似点击那个按钮执行打开排行榜的指令，
// **无需权限**"。这条守着三件事，每件坏掉的症状都不一样：
//   ① 按钮没了 ⇒ 排行榜只剩 `/atl rank` 这个调试口 —— 而用户的标准是"界面才是交付形态"✗；
//   ② 按钮改成客户端自己造一份榜 ⇒ 客户端能显示**自己编的名次**（服务端权威那条原则破了）✗；
//   ③ 按钮直接 `setScreen(new LeaderboardScreen(...))` ⇒ 手上没有 `RankPayload`，
//      打开是一张空榜，看起来像"排行榜没数据"（最难查的那一种）✗。
{
  const s = ALL_CODE.get('client/screen/CodexScreen.java') || '';
  if (!s) no('读不到 CodexScreen.java');
  else {
    const hasButton = /Button\.builder\([\s\S]{0,240}?codex_rank/.test(s);
    const sendsRequest = /RankRequestPayload/.test(s);
    if (!hasButton) {
      no('图鉴里没有排行榜按钮（gui.anglertackle.codex_rank）—— 用户要求"排行榜可以通过图鉴打开"');
    } else if (!sendsRequest) {
      no('图鉴的排行榜按钮没有发 RankRequestPayload —— 那它要么什么都没干，'
        + '要么是客户端自己造了一份榜（服务端权威原则 ✗）');
    } else if (/new LeaderboardScreen\(/.test(s)) {
      no('图鉴里直接 new LeaderboardScreen(...) 了 —— 手上没有 RankPayload，'
        + '打开的是一张空榜（症状是"排行榜没数据"，最难查）');
    } else {
      ok('图鉴里有排行榜按钮，且只发 RankRequestPayload（与 /atl rank 同一条路）');
    }
    if (hasButton && /addRenderableWidget\(rank\)/.test(s)) ok('按钮真的挂上了（addRenderableWidget）');
    else if (hasButton) no('按钮建了但没挂上（addRenderableWidget 里不是它）');
  }
  // 按钮文案两个语言都要有（漏了游戏里显示的是一串键名）
  if (!('gui.anglertackle.codex_rank' in zh)) no('缺 gui.anglertackle.codex_rank 中文');
  else if (!('gui.anglertackle.codex_rank' in en)) no('缺 gui.anglertackle.codex_rank 英文');
  else ok('排行榜按钮文案中英齐全（"' + zh['gui.anglertackle.codex_rank'] + '"）');
  // 服务端那条路必须仍然"纯读"：不接受客户端上报的任何成绩字段
  const net = ALL_CODE.get('network/ModNetwork.java') || '';
  const handler = /handleRankRequest\(RankRequestPayload payload[\s\S]{0,900}?\n    \}/.exec(net);
  if (!handler) no('ModNetwork 里找不到 handleRankRequest');
  else if (!/RankSnapshot\.sendAll\(/.test(handler[0])) {
    no('handleRankRequest 没有走 RankSnapshot.sendAll —— 排行榜的数据来源变了');
  } else if (/\.add\(|recordCatch|putCatch/.test(handler[0])) {
    no('handleRankRequest 里出现了写入动作（它必须是**纯读**：只读榜、只拼文本、只发回去）');
  } else {
    ok('handleRankRequest 仍是纯读（不接受客户端上报的成绩）');
  }
}

// ---------------------------------------------------------------- 10. 页脚不许再叠按钮（2026-10-12）
//
// 用户 2026-10-12："称号佩戴在哪，很难发现。" ⇒ 图鉴页脚要加第三个按钮（称号）。
// 加之前先去量了一遍，发现**原来就已经叠了**：
//   翻页 `[>]` 在 `left + panelW - 34`（26 宽 ⇒ 到 panelW-8），
//   而「排行榜」按钮在 `left + panelW - 74`（66 宽 ⇒ 也到 panelW-8）——
//   两个矩形几乎完全重合，**谁接到点击取决于加入顺序**（后加的画在上面）。
// 症状是"那个按钮点了没反应"，而它在单人存档里**永远测不出来**（翻页时才发现）。
//
// 所以这条判据不是"某一行必须长这样"，而是**页脚所有 widget 的 x 必须同源**：
//   右边按钮组从 `groupX` 派生、翻页条从 `groupX` 往左让出来、提示文字只在有空位时画。
// 只要有人再写一个"锚在面板右缘"的控件，这条就红 —— 那正是当初叠上去的方式。
{
  const s = ALL_CODE.get('client/screen/CodexScreen.java') || '';
  if (!s) no('读不到 CodexScreen.java（页脚重叠检查）');
  else {
    const anchors = {
      groupX: /int groupX = left \+ panelW - 6 - groupW;/.test(s),
      pager: /int pagerRight = groupX - 8;/.test(s),
      prev: /int prevX = nextX - 4 - navW;/.test(s),
      next: /int nextX = pagerRight - navW;/.test(s),
    };
    const missAnchor = Object.keys(anchors).filter((k) => !anchors[k]);
    // 页脚里所有控件的 x 表达式（y 一律是 top + panelH - 22，正是页脚那一行）
    const xs = [...s.matchAll(/\.bounds\(([^,]+),\s*top \+ panelH - 22[^)]*\)/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim());
    const stray = xs.filter((x) => !/(groupX|prevX|nextX)/.test(x));
    if (missAnchor.length) {
      no('图鉴页脚的锚点不见了（' + missAnchor.join('、') + '）—— '
        + '这条检查靠"所有控件同源"成立，锚点没了它就失效了，请更新判据');
    } else if (xs.length < 5) {
      no('页脚只认出 ' + xs.length + ' 个控件（应有 3 个入口按钮 + 翻页 2 个）—— '
        + 'x 的写法变了，这条检查已失效');
    } else if (stray.length) {
      no('图鉴页脚里有**锚在别处**的控件：' + [...new Set(stray)].join('、')
        + ' —— 它们会和按钮组/翻页条抢同一块地方（2026-10-12 就是这么叠出'
        + '"点了没反应的按钮"的）。请改成从 groupX 派生');
    } else {
      ok('图鉴页脚 5 个控件（3 入口 + 翻页 2）的 x 全部同源派生，不会互相压住 ✓');
    }
  }
}

console.log(bad === 0
  ? '\n✅ 图鉴链（记账 → 界面 → 完成度奖励 → 排行榜入口）接线正确'
  : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
