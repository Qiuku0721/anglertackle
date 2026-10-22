// 守住"玩家数据（鱼币 + 图鉴）"这一层的几条硬要求。
//
// 为什么每条都值得单独断言 —— 它们全都是**编译能过、运行不报错、
// 只是数据悄悄不对**的类型：
//   · 少写 .serialize(...) → 数据只活在内存，退出游戏就没，而当下完全正常
//   · 少写 .copyOnDeath()  → 死一次鱼币和图鉴清零
//   · 忘了在 AnglersTackle 里 register → 附件类型根本没注册，取到的是默认值
//   · 绕过 PlayerData 直接 setData → 漏保存，表现为"改了但重启就变回去"
//   · 图鉴不单独存 tier → 金档鱼被记成红档（FishData 那条链的老毛病）
const fs = require('fs'), path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };
const read = (rel) => fs.readFileSync(path.join(JAVA, rel), 'utf8');
// 剥注释走共用实现（各写一份踩过坑：见 tools/java-source.js 顶部）
const { stripComments: strip } = require('./java-source.js');

/**
 * 剥掉 java 注释。
 *
 * ⚠ 必须剥：这一层的好几条断言都在找"某个坏名字有没有出现"，而**注释里
 * 恰恰在解释那个坏名字为什么不能用**（例如 CodexEntry 的类注释就在讲
 * FishData 的金红失真）。不剥注释的话，检查器会被自己的说明文字触发，
 * 报出一个"因为解释得太清楚"而失败的红灯 —— 然后人就会去把断言删掉。
 * （项目里踩过同款：别的检查器也被注释坑过。）
 */

// ---------------------------------------------------------------- 1. 附件注册三件套
{
  const f = 'registry/ModAttachments.java';
  if (!fs.existsSync(path.join(JAVA, f))) no('缺少 ' + f);
  else {
    const s = read(f);
    if (/\.serialize\(/.test(s)) ok('附件写了 .serialize(...)（否则数据不落盘，退出就没了）');
    else no('附件没有 .serialize(...) —— 鱼币和图鉴每次退出游戏都会清零');

    // ⚠ 2026-10-03 加固：这个文件里有**两个**附件（鱼币/图鉴 与 老柯进度），
    //   原来只判"文件里出现过 .copyOnDeath()" —— 其中一个掉了、另一个还在，就会绿。
    //   现在要求"每一个写了 .serialize() 的附件都必须配 .copyOnDeath()"（按出现次数对齐）。
    {
      const nSer = (s.match(/\.serialize\(/g) || []).length;
      const nCopy = (s.match(/\.copyOnDeath\(\)/g) || []).length;
      if (nCopy >= nSer && nSer > 0) {
        ok('每个附件都写了 .serialize() + .copyOnDeath()（' + nSer + ' 个）');
      } else {
        no('有附件没写 .copyOnDeath()（serialize ' + nSer + ' 处 / copyOnDeath ' + nCopy + ' 处）'
          + ' —— 玩家死一次，那个附件的数据全清空');
      }
    }

    if (/NeoForgeRegistries\.Keys\.ATTACHMENT_TYPES/.test(s)) ok('注册表用的是 ATTACHMENT_TYPES');
    else no('附件没有注册到 NeoForgeRegistries.Keys.ATTACHMENT_TYPES');

    if (/List\.of\(\)|Map\.of\(\)|EMPTY/.test(s)) ok('默认值供应器返回空数据（新玩家不会拿到 null）');
    else no('看不到默认值供应器 —— 新玩家首次取值可能拿到 null');

    // ---- 作用域：必须是"每个存档各自一份" ----
    //
    // 用户明确要求"鱼币做存档切割，每个档不同"。这一条**靠的是附件挂在玩家身上**
    // 这个事实（NeoForge 把附件写进宿主自己的 NBT，玩家 NBT 落在
    // <存档>/playerdata/<uuid>.dat），而不是靠某段专门的代码。
    // 所以这里要防的是"以后有人为了别的目的把它改成 Level 附件或全局 SavedData" ——
    // 那种改动编译能过、单档测试也正常，只有换存档才会露馅。
    // 只看代码：注释里正在解释"为什么不能用 Level 附件 / SavedData"，
    // 不剥掉的话检查器会被自己的说明文字判红。
    const code = strip(s);
    // ⚠ 不能用 /AttachmentType\.builder/ —— 源码里那两行是换行写的
    //（AttachmentType 后面换行再 .builder），正则不跨行就匹配不到。
    // 找方法名本身即可，不必连类名一起断言。
    if (/\.builder\(/.test(code) && /PlayerFishingData/.test(code)) {
      ok('鱼币挂在**玩家**附件上 → 每档一份（换存档余额就是另一份）');
    } else no('附件不再挂在玩家身上 —— 存档切割会失效');
    if (/SavedData/.test(code)) {
      no('引入了 SavedData —— 玩家级附件已经满足"每档一份 + 按玩家分"，多这层只会多状态');
    } else ok('没有多余的 SavedData 层');
    if (/ServerLevel|LevelChunk/.test(code)) {
      no('出现 Level/Chunk 附件迹象 —— 挂在维度上会让主世界/下界各算一份钱');
    } else ok('没有把附件挂到维度或区块上');
  }
}

// ---------------------------------------------------------------- 2. 真的被注册了
{
  const a = read('AnglersTackle.java');
  if (/ModAttachments\.register\(modBus\)/.test(a)) ok('AnglersTackle 里调用了 ModAttachments.register(modBus)');
  else no('AnglersTackle 没有注册附件 —— 附件类型不存在，取到的一直是默认值');
}

// ---------------------------------------------------------------- 3. 不可变 + Codec
{
  const s = read('player/PlayerFishingData.java');
  if (/public record PlayerFishingData\(/.test(s)) ok('PlayerFishingData 是不可变 record');
  else no('PlayerFishingData 不是 record —— 可变对象容易"改了忘保存"');
  if (/public static final Codec<PlayerFishingData> CODEC/.test(s)) ok('PlayerFishingData 有 CODEC');
  else no('PlayerFishingData 没有 CODEC，附件无法序列化');
  if (/claimedMilestones/.test(s) && /markClaimed/.test(s)) ok('有已领里程碑位掩码（里程碑奖励不会重复发）');
  else no('没有里程碑去重标记 —— 每次上鱼都会把已达成的里程碑重复发一遍');
}

// ---------------------------------------------------------------- 4. 图鉴必须单独存 tier
{
  const raw = read('player/CodexEntry.java');
  const s = strip(raw);   // 断言只看代码，注释里专门在讲这条坑
  if (/int bestTier/.test(s)) ok('CodexEntry 单独存 bestTier');
  else no('CodexEntry 没有 bestTier —— 只能从 SizeGrade 反推，金档会被记成红档');
  if (/FishData|SizeGrade|tierOfGrade|quality\s*\(/.test(s)) {
    no('CodexEntry 的**代码**里引用了 FishData/SizeGrade/quality —— 金红失真的那条链又会绕回来');
  } else ok('CodexEntry 的代码不依赖 FishData/SizeGrade（不踩金红失真的坑）');
  if (/gradesSeen/.test(s) && /seenGrade/.test(s)) ok('有尺寸评级位掩码（详情面板要显示 5 档勾选）');
  else no('没有 gradesSeen —— 详情面板画不出"幼体✓普通✓…"');
}

// ---------------------------------------------------------------- 5. 写入口唯一
{
  const walk = (dir, out) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith('.java')) out.push(p);
    }
    return out;
  };
  const direct = [];
  // 「唯一 setData 入口」这条规则要**按附件**分别成立，不是全局只有一个入口。
  //
  // 原本写的是"只有 player/PlayerData.java 能 setData"，那在只有一个附件时没问题；
  // 加了第二个附件（老柯进度）之后，它必须有自己的写入口，否则那一层封装就没了。
  // 所以规则改成：**每个附件有且只有一个入口**，
  // 入口文件名必须是 player/<附件常量名首字母大写>Data.java
  // （PLAYER_DATA → PlayerData.java，FISHERMAN → FishermanData.java）。
  //
  // 这样既保住了原意（不让人在别处随手 setData 导致漏保存），
  // 又不会因为"多了一个附件"就报假问题 —— 假问题比没有问题更坏，
  // 它会逼着人把检查关掉。
  const entryFiles = new Set(['player/PlayerData.java', 'player/FishermanData.java']);
  for (const p of walk(JAVA, [])) {
    const rel = path.relative(JAVA, p).split(path.sep).join('/');
    if (entryFiles.has(rel)) continue;   // 附件各自的唯一写入口
    const s = fs.readFileSync(p, 'utf8');
    if (/setData\(\s*(ModAttachments\.)?[A-Z_]+/.test(s)) {
      direct.push(rel);
    }
  }
  if (direct.length) {
    no('这些文件绕过入口类直接 setData：' + direct.join(', '));
    console.log('     请改用 PlayerData.update(...) / FishermanData.update(...)，'
      + '否则漏保存时只会表现为"改了但重启就变回去"');
  } else ok('所有附件写入都走各自的入口类（PlayerData / FishermanData）');
}

// ---------------------------------------------------------------- 6. 鱼币不是物品
{
  const items = read('registry/ModItems.java');
  if (/coin|COIN/.test(items)) no('ModItems 里出现了 coin —— 用户要求鱼币不做成物品');
  else ok('ModItems 里没有任何鱼币物品（鱼币是纯数据）');
  const lang = path.join(ROOT, 'src/main/resources/assets/anglertackle/lang/zh_cn.json');
  const l = fs.readFileSync(lang, 'utf8');
  if (/item\.anglertackle\.\w*coin/i.test(l)) no('语言文件里有鱼币物品名 —— 说明还是做成了物品');
  else ok('语言文件里没有鱼币物品名');
}

// ---------------------------------------------------------------- 7. 鱼币面板的同步链路
//
// HUD 只在客户端画，而余额是服务端权威的。这条链上少任何一环，表现都是
// **HUD 上的数字停在旧值不再动**，而实际余额是对的 —— 界面上那个数字看起来
// 一直很合理，所以这种偏差几乎不可能被发现。
{
  // ⚠ 两个文件接起来看：`syncCoins` 在 ModNetwork（common），
  //   `handleCoins` 在 client/ClientPayloadHandlers（客户端专用类，因为要碰 ClientCoins）——
  //   拆开是为了让专用服务器能装进这个模组，见那个类的注释。断言一条都没放松。
  const net = read('network/ModNetwork.java') + '\n' + read('client/ClientPayloadHandlers.java');
  if (/playToClient\(CoinsPayload\.TYPE/.test(net)) ok('CoinsPayload 注册为 S→C 包');
  else no('CoinsPayload 没有注册 —— 余额永远推不到客户端');
  if (/public static void syncCoins\(/.test(net)) ok('有统一的 syncCoins(player) 入口');
  else no('没有统一的 syncCoins 入口 —— 各处会各自发包，迟早漏一处');
  if (/handleCoins[\s\S]{0,200}?enqueueWork/.test(net)) {
    ok('handleCoins 走了 enqueueWork（不在网络线程上碰客户端状态）');
  } else no('handleCoins 没走 enqueueWork —— 多人下会偶发并发问题');

  const cmd = read('command/AnglerCommands.java');
  if ((cmd.match(/syncCoins\(/g) || []).length >= 2) ok('指令改币后也同步（set / add 两处）');
  else no('指令改币后没同步 —— 敲完 /atl coins add 面板上还是旧数字');

  // ★ 不变量：**凡是改余额的文件，都必须调 syncCoins**。
  //
  // 这里早先写的是"上鱼结算后要同步"。但用户后来定案："不要直接跳鱼币，
  // 而是将数据显示在鱼面板，到时候方便做 NPC 商店时卖出拿钱" —— 上鱼不再给钱，
  // 那条断言就过期了（而且它过期的方式很隐蔽：断言还在，只是永远不成立）。
  // 改成按"谁动了鱼币"来查：以后接商店、任务、任何新来源都自动被覆盖。
  {
    const walkJava = (dir, out) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkJava(p, out);
        else if (e.name.endsWith('.java')) out.push(p);
      }
      return out;
    };
    const mutators = [];
    for (const p of walkJava(JAVA, [])) {
      const rel = path.relative(JAVA, p).split(path.sep).join('/');
      if (rel.startsWith('player/')) continue;   // 数据类本身不算调用方
      const code = strip(fs.readFileSync(p, 'utf8'));
      if (/\.addCoins\(|\.withCoins\(/.test(code)) mutators.push({ rel, code });
    }
    if (mutators.length === 0) ok('当前没有任何代码改鱼币（等 NPC 商店接上）');
    else {
      const missing = mutators.filter((m) => !/syncCoins\(/.test(m.code)).map((m) => m.rel);
      if (missing.length) {
        no('这些文件改了鱼币却没同步给客户端：' + missing.join(', ') +
           '（HUD 上的数字会停在旧值，而实际余额是对的 —— 几乎发现不了）');
      } else ok('改鱼币的 ' + mutators.length + ' 个文件都调了 syncCoins');
    }
    // 反向：上鱼路径不该再给钱（用户定案）
    const fm = strip(read('fishing/FishingManager.java'));
    if (/addCoins|withCoins/.test(fm)) {
      no('上鱼路径又在给鱼币了 —— 用户定案是靠 NPC 商店卖鱼拿钱，' +
         '自动结算会让商店和鱼面板上的售价一起失去意义');
    } else ok('上鱼路径不给钱（鱼币来自将来的商店）');
  }

  const ev = read('event/CoinSyncEvents.java');
  if (/PlayerLoggedInEvent/.test(ev)) ok('进服主动推一次（否则要先钓到鱼才看得见面板）');
  else no('进服没推 —— 面板要等第一次上鱼才出现');
  if (/LoggingOut[\s\S]{0,200}?ClientCoins\.reset/.test(ev)) {
    ok('退出世界时清客户端缓存（否则下一个档会先闪上一个档的余额）');
  } else no('退出时没清缓存 —— 换档会闪现上一个存档的余额');

  const hud = read('client/hud/CoinsHud.java');
  if (/RegisterGuiLayersEvent/.test(hud) && /registerAbove/.test(hud)) ok('CoinsHud 注册成 GUI 图层');
  else no('CoinsHud 没有注册图层 —— 画不出来');
  if (/showDebugScreen/.test(hud)) ok('F3 调试屏打开时会隐藏（左上角会叠字）');
  else no('没处理 F3 —— 调试文字会和面板叠在一起');
  if (/ClientCoins\.known\(\)/.test(hud)) ok('没同步到就不画（不会闪一个假的 0）');
  else no('没判断是否已同步 —— 进服会先闪一个假的 0');
}

// ---------------------------------------------------------------- 联赛积分那条链（`docs/39`）
//
// 与鱼币**同形**的第二条货币线（用户 2026-10-13："积分我没看到在哪显示，
// 不像鱼币那样清晰明了"）。少任何一环的表现都一样：**HUD／商店标题上的积分停在旧值**，
// 而实际余额是对的 —— 看起来就像"这功能没做"。
{
  const net2 = read('network/ModNetwork.java') + '\n' + read('client/ClientPayloadHandlers.java');
  if (/playToClient\(LeaguePointsPayload\.TYPE/.test(net2)) ok('LeaguePointsPayload 注册为 S→C 包');
  else no('LeaguePointsPayload 没有注册 —— 积分永远推不到客户端');
  if (/public static void syncLeaguePoints\(/.test(net2)) ok('有统一的 syncLeaguePoints(player) 入口');
  else no('没有统一的 syncLeaguePoints 入口 —— 各处会各自发包，迟早漏一处');
  if (/handleLeaguePoints[\s\S]{0,200}?enqueueWork/.test(net2)) {
    ok('handleLeaguePoints 走了 enqueueWork（不在网络线程上碰客户端状态）');
  } else no('handleLeaguePoints 没走 enqueueWork —— 多人下会偶发并发问题');

  // 积分的变动入口**只有两个**（award 加分 / spend 扣分），两处都必须推。
  // 数得出来才守得住：多了说明有人绕开入口改数据，少了说明有地方改了却不刷新界面。
  const pts = read('league/LeaguePoints.java');
  const pushes = (pts.match(/syncLeaguePoints\(/g) || []).length;
  if (pushes === 2) {
    ok('加分与扣分两处都推了积分（award + spend，恰好 2 处）');
  } else {
    no('积分同步次数不对（应当恰好 2 处：award + spend，实为 ' + pushes + ' 处）'
      + ' —— 漏一处就会"HUD 上的积分停在旧值"');
  }
  if (/addLeaguePoints|withLeaguePoints/.test(pts)) ok('积分的写入口都在 LeaguePoints 里（没有旁路）');
  else no('LeaguePoints 里找不到积分写入口 —— 口径可能被搬到别处了');

  const ev2 = read('event/CoinSyncEvents.java');
  if (/syncLeaguePoints/.test(ev2)) {
    ok('进服/换维度也推一次积分（否则 HUD 那行要等第一次上鱼才出现）');
  } else no('进服没推积分 —— 面板上那一行会迟迟不出现');
  if (/ClientLeaguePoints\.reset/.test(ev2)) {
    ok('退出世界时清积分缓存（否则下一个档会先闪上一个档的积分）');
  } else no('退出时没清积分缓存 —— 换档会闪现上一个存档的积分');

  const hud2 = read('client/hud/CoinsHud.java');
  if (/ClientLeaguePoints\.known\(\)/.test(hud2)) ok('积分未同步时不画那一行（不会闪一个假的 0）');
  else no('积分那行没判断是否已同步 —— 进服会先闪一个假的 0');
  if (/hud\.anglertackle\.league_points/.test(hud2)) ok('积分那一行用可翻译键（不是写死中文）');
  else no('积分那一行写死了文案 —— 英文客户端会看到中文');

  const shop2 = read('client/screen/ShopScreen.java');
  if (/ClientLeaguePoints\.known\(\)/.test(shop2)) {
    ok('商店标题里也显示积分（花积分时看得见余额）');
  } else no('商店标题没显示积分 —— 在联赛页买不买得起看不出来');
}

console.log(bad === 0 ? '\n✅ 玩家数据层（鱼币 + 联赛积分 + 图鉴 + 面板同步）接线正确'
                      : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
