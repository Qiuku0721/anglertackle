package com.whitecobalt.anglertackle.quest;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.Environment;
import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.mail.MailActions;
import com.whitecobalt.anglertackle.mail.MailService;
import com.whitecobalt.anglertackle.player.FishermanData;
import com.whitecobalt.anglertackle.player.MailBox;
import com.whitecobalt.anglertackle.player.MailEntry;
import com.whitecobalt.anglertackle.player.PlayerData;
import com.whitecobalt.anglertackle.player.QuestData;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

import java.util.List;
import java.util.Map;

/**
 * 委托的**服务端流程**（老柯的每日 / 周常；用户 2026-10-14 定案，策划 `docs/40` §3/§5）。
 *
 * <h2>刷新的两条纪律（`docs/40` §3，用户原话："不然如果有一天睡觉一天不睡就乱套了"）</h2>
 * <ol>
 *   <li><b>按游戏内时刻</b>：日序号 = {@code floor(getDayTime() / 24000)}
 *       ⇒ 日界落在**游戏内天明**，玩家感知是"天亮了老柯派新活" ✓。
 *       ⚠ **不用 {@code getGameTime()}** —— 那只是纯 tick 计数、与昼夜无关，
 *       它的"一天"边界会落在半夜，正是用户说的"乱套" ✗；</li>
 *   <li><b>幂等</b>：每位玩家的 {@code QuestData.lastDailyDay} / {@code lastWeeklyWeek} 是刷新位
 *       —— 反复触发同一天的日界也**只发一次** ✓。</li>
 * </ol>
 *
 * <h2>抽池是**纯函数**（这一点很关键）</h2>
 * "今天有哪些委托"由 {@code (玩家 UUID, 日序号, 池)} **确定性地**算出来（{@link #offerFor}）——
 * 所以邮件只需要告诉玩家"有几个活"，接取时**用同一个种子再算一遍**即可，不必把清单存进附件 ✓
 * （也就不会有"存的清单和池子对不上"这种第二真源 ✗）。
 *
 * <h2>顺序纪律</h2>
 * <b>先投递、再置位</b>（抄 `MailService.deliver` 的三条政策）：邮箱满 ⇒
 * {@link MailService.Result#BOX_FULL} ⇒ **不写刷新位** ⇒ 下次登录/下一天再试，委托不会永久丢失 ✓。
 */
public final class QuestService {

    /** 每日委托信的模板 id（语言键 {@code mail.anglertackle.quest_daily.*}）。 */
    public static final String MAIL_DAILY = "quest_daily";
    /** 周常委托信的模板 id（语言键 {@code mail.anglertackle.quest_weekly.*}）。 */
    public static final String MAIL_WEEKLY = "quest_weekly";

    /** 一周 = 7 游戏日。 */
    public static final long DAYS_PER_WEEK = 7L;

    /**
     * 上一个"见过"的日序号 —— 只有它**变了**才跑日界广播。
     *
     * <p>纯性能闸：不加它就要每 tick 遍历全部在线玩家。**它不承担正确性** ——
     * 真正防重复的是每位玩家自己的 {@code lastDailyDay}（所以服务器重启后
     * 这里回到 {@code Long.MIN_VALUE} 也不会多发一份 ✓）。
     */
    private static long lastSeenDay = Long.MIN_VALUE;

    private QuestService() {
    }

    /** 接取结果（给 {@code MailActions} 映射成人话）。 */
    public enum Accept {
        /** 接下了（至少新接了一条）。 */
        OK,
        /** 今天/本周的已经接过了（**幂等**：再点一次不会重复计）。 */
        ALREADY,
        /** 系统被关掉了。 */
        DISABLED,
        /** 还没有可接的委托（委托信还没到）。 */
        NO_OFFER
    }

    // ---------------------------------------------------------------- 日 / 周序号
    /** 游戏日序号（**按游戏内时刻**，见类注释）。 */
    public static long dayOf(ServerLevel level) {
        return Math.floorDiv(level.getDayTime(), Environment.DAY_LENGTH);
    }

    /** 游戏周序号。 */
    public static long weekOf(long day) {
        return Math.floorDiv(day, DAYS_PER_WEEK);
    }

    /**
     * 本游戏日还剩多少**分钟**（界面显示"今日还剩 8 分钟"）。
     *
     * <p>向上取整：还剩 1 秒也该显示"1 分钟"，显示"0 分钟"看着像已经过期了 ✓。
     */
    public static int dailyLeftMinutes(ServerLevel level) {
        long t = Math.floorMod(level.getDayTime(), Environment.DAY_LENGTH);
        return (int) ((Environment.DAY_LENGTH - t + 1199L) / 1200L);
    }

    /** 本游戏周还剩几个游戏日（**含今天** —— 今天是本周最后一天时给 1，不给 0）✓。 */
    public static int weeklyLeftDays(long day) {
        return (int) (DAYS_PER_WEEK - Math.floorMod(day, DAYS_PER_WEEK));
    }

    // ---------------------------------------------------------------- 日界推进
    /**
     * 每 tick 由 {@code QuestEvents} 调（**只在主世界**）。
     *
     * <p>日序号没变就直接返回 ⇒ 绝大多数 tick 是 O(1) ✓。
     */
    public static void tickDayBoundary(MinecraftServer server) {
        if (server == null) {
            return;
        }
        long day = dayOf(server.overworld());
        if (day == lastSeenDay) {
            return;
        }
        lastSeenDay = day;
        if (!Tuning.questEnabled()) {
            return;
        }
        long week = weekOf(day);
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            ensureDaily(p, day);
            ensureWeekly(p, week);
        }
    }

    /** 玩家登录时补发当天 / 本周的委托（离线跨过了日界也能收到，`docs/40` §3.4）。 */
    public static void onLogin(ServerPlayer player) {
        if (player == null || !Tuning.questEnabled()) {
            return;
        }
        long day = dayOf(player.serverLevel());
        ensureDaily(player, day);
        ensureWeekly(player, weekOf(day));
        // 顺带补发"上次达标时邮箱满、奖励没寄出去"的那些（否则永久丢失，见 flushPending）✓
        flushPending(player);
        upgradeLegacyLetters(player);
    }

    /**
     * **升级 1.6.2 之前寄出的旧委托信**：那时 {@code MailService.deliver} 还没有带
     * {@code action} 的重载 ⇒ 旧信在界面上没有【接下委托】按钮（2026-10-14 验收实测 ✗）。
     *
     * <p>只认 {@value #MAIL_DAILY} / {@value #MAIL_WEEKLY} 模板且 action 为空的信；
     * **幂等**（带 action 的一律跳过）。修完后**下一次登录**就生效，不用等刷新。
     */
    private static void upgradeLegacyLetters(ServerPlayer player) {
        MailBox box = PlayerData.getMails(player);
        MailBox cur = box;
        int n = 0;
        for (MailEntry m : box.mails()) {
            boolean questLetter = m.template().equals(MAIL_DAILY) || m.template().equals(MAIL_WEEKLY);
            if (questLetter && !m.hasAction()) {
                cur = cur.withReplaced(m.withAction(MailActions.QUEST_ACCEPT));
                n++;
            }
        }
        if (n > 0) {
            PlayerData.setMails(player, cur);
            AnglersTackle.LOGGER.info("[垂纶] 旧委托信升级：{} 的 {} 封补上了【接下委托】按钮",
                    player.getName().getString(), n);
        }
    }

    /**
     * 保证这位玩家**今天**的委托已经投递（幂等 + 先投递再置位）。
     *
     * <p>若这次是跨日（{@code lastDailyDay != day}），顺带**清掉昨天没做完的每日委托** ——
     * 只清每日，**周常留着**（两类共用 {@code active} 表，整表清会把周常进度抹掉 ✗）。
     */
    public static void ensureDaily(ServerPlayer player, long day) {
        QuestData q = PlayerData.getQuests(player);
        if (q.lastDailyDay() == day) {
            return;
        }
        int count = Tuning.questDailyCount();
        MailService.Result r = MailService.deliver(player, MAIL_DAILY,
                List.of(String.valueOf(count)), 0L, List.of(), MailActions.QUEST_ACCEPT);
        if (r != MailService.Result.OK) {
            // ⚠ 邮箱满 ⇒ **不置位** ⇒ 下次登录再试（绝不静默丢一天的委托 ✗）
            AnglersTackle.LOGGER.warn("[垂纶] 委托投递被拒（{}）：{} 的第 {} 游戏日每日委托推迟",
                    r, player.getName().getString(), day);
            return;
        }
        PlayerData.updateQuests(player, cur -> prunePeriod(cur, QuestDef.Period.DAILY).withDay(day));
    }

    /** 保证这位玩家**本周**的周常已经投递（幂等 + 先投递再置位；跨周清掉上周没做完的周常）。 */
    public static void ensureWeekly(ServerPlayer player, long week) {
        QuestData q = PlayerData.getQuests(player);
        if (q.lastWeeklyWeek() == week) {
            return;
        }
        int count = Tuning.questWeeklyCount();
        MailService.Result r = MailService.deliver(player, MAIL_WEEKLY,
                List.of(String.valueOf(count)), 0L, List.of(), MailActions.QUEST_ACCEPT);
        if (r != MailService.Result.OK) {
            AnglersTackle.LOGGER.warn("[垂纶] 委托投递被拒（{}）：{} 的第 {} 游戏周周常推迟",
                    r, player.getName().getString(), week);
            return;
        }
        PlayerData.updateQuests(player, cur -> prunePeriod(cur, QuestDef.Period.WEEKLY).withWeek(week));
    }

    /** 把某一周期的委托从 {@code active} 里全部摘掉（**另一周期的原样保留**）。 */
    public static QuestData prunePeriod(QuestData data, QuestDef.Period period) {
        QuestData out = data;
        for (String id : List.copyOf(data.active().keySet())) {
            QuestDef d = QuestPool.byId(id);
            if (d == null || d.period() == period) {
                out = out.withoutActive(id);
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- 抽池（纯函数）
    /**
     * "这一次该给哪些委托" —— **确定性**：同一个玩家 + 同一天（周），算出来永远一样 ✓。
     *
     * <p>种子来自 {@code UUID} 与日/周序号，所以：
     * <ul>
     *   <li>投递时算一遍（只为了告诉玩家"有几个活"）；</li>
     *   <li>接取时**再算一遍**，得到完全相同的清单 ⇒ 不需要把清单存进存档 ✓；</li>
     *   <li>别人拿不到你的清单（种子含 UUID）✓。</li>
     * </ul>
     *
     * @param index 日序号（DAILY）或周序号（WEEKLY）
     */
    public static List<QuestDef> offerFor(ServerPlayer player, QuestDef.Period period, long index) {
        int level = FishermanData.level(player);
        long seed = player.getUUID().getMostSignificantBits()
                ^ player.getUUID().getLeastSignificantBits()
                ^ (index * 0x9E3779B97F4A7C15L)
                ^ (period == QuestDef.Period.WEEKLY ? 0x5DEECE66DL : 0x2545F4914F6CDD1DL);
        int count = period == QuestDef.Period.WEEKLY
                ? Tuning.questWeeklyCount() : Tuning.questDailyCount();
        return QuestPool.draw(period, level, count, RandomSource.create(seed));
    }

    // ---------------------------------------------------------------- 接取
    /**
     * 接下"今天（和本周）老柯派的活" —— **幂等**：重复调用不会重复计数 ✓。
     *
     * <p>由 {@code MailActions} 的 {@code quest_accept} 动作调（点邮件里的【接下委托】）。
     */
    public static Accept acceptAll(ServerPlayer player) {
        if (!Tuning.questEnabled()) {
            return Accept.DISABLED;
        }
        long day = dayOf(player.serverLevel());
        long week = weekOf(day);
        QuestData q = PlayerData.getQuests(player);
        boolean hasDaily = q.lastDailyDay() == day;
        boolean hasWeekly = q.lastWeeklyWeek() == week;
        if (!hasDaily && !hasWeekly) {
            return Accept.NO_OFFER;
        }
        int before = q.activeCount();
        if (hasDaily) {
            for (QuestDef d : offerFor(player, QuestDef.Period.DAILY, day)) {
                q = q.withActive(d.id());
            }
        }
        if (hasWeekly) {
            for (QuestDef d : offerFor(player, QuestDef.Period.WEEKLY, week)) {
                q = q.withActive(d.id());
            }
        }
        if (q.activeCount() == before) {
            return Accept.ALREADY;
        }
        PlayerData.setQuests(player, q);
        AnglersTackle.LOGGER.info("[垂纶] 委托接取：{}({}) 接了 {} 条（当日 {}/周 {}）",
                player.getName().getString(), player.getUUID(), q.activeCount() - before, day, week);
        return Accept.OK;
    }

    /** 已接的委托定义（界面 / 进度判定用；认不出的 id 会被跳过）。 */
    public static List<QuestDef> activeDefs(ServerPlayer player) {
        List<QuestDef> out = new java.util.ArrayList<>();
        for (String id : PlayerData.getQuests(player).active().keySet()) {
            QuestDef d = QuestPool.byId(id);
            if (d != null) {
                out.add(d);
            }
        }
        return List.copyOf(out);
    }

    // ================================================================ Q2：上鱼推进 + 达标发奖
    /** 完成一条委托的奖励信模板（语言键 {@code mail.anglertackle.quest_done.*}）。 */
    public static final String MAIL_DONE = "quest_done";
    /** 活跃度档位奖励信模板（语言键 {@code mail.anglertackle.quest_activity.*}）。 */
    public static final String MAIL_ACTIVITY = "quest_activity";

    /**
     * 上鱼成功时调一次（由 {@code LeaderboardHooks.onLanded} 接线，**服务端**）✓。
     *
     * <h2>为什么走"推进 → 统一结算"两步，而不是"推到哪条就把哪条发了"</h2>
     * 因为**发奖这条路径必须只有一个入口**：玩家可能
     * ① 这次上鱼刚好达标；② 上次达标时邮箱满、奖励没发出去；
     * ③ 服务器重启后附件里躺着一条"已达标的行"。
     * 三条都要能补上 ⇒ 用 {@link #settleReached} 一处扫描"达标但还没寄出"的行 ✓
     * （两份逻辑迟早不一致，本仓库已经吃过这个亏）。
     *
     * @return 这一次真正结算掉的条数（给日志 / 调试用）
     */
    public static int onCatch(ServerPlayer player, String fishId, double kg, double cm, int tier) {
        if (player == null || !Tuning.questEnabled()) {
            return 0;
        }
        QuestData q = PlayerData.getQuests(player);
        if (q.active().isEmpty()) {
            return 0;
        }
        QuestGoal.Catch c = new QuestGoal.Catch(fishId, kg, cm, tier, rodTypeOf(player));

        // ① 推进：逐条推进"还没寄出奖励"的委托（已寄出的不用再推，省得白算）
        Map<String, QuestData.Row> snapshot = q.active();
        for (Map.Entry<String, QuestData.Row> e : snapshot.entrySet()) {
            QuestData.Row before = e.getValue();
            if (before.claimed()) {
                continue;
            }
            QuestDef def = QuestPool.byId(e.getKey());
            if (def == null) {
                continue;
            }
            q = q.withRow(def.id(), QuestGoal.advance(def, before, c));
        }

        // ② 结算：达标 ⇒ 寄奖励信 + 记活跃度 + 计数；活跃度到档 ⇒ 再寄一封 ✓
        int before = q.totalCompleted();
        q = settleReached(player, q);
        PlayerData.setQuests(player, q);
        return q.totalCompleted() - before;
    }

    /**
     * 补发：把"已达标但奖励还没寄出"的委托结算一遍（**登录 / 日界时调**）✓。
     *
     * <p>为什么必须有它：{@code GET_BIGGEST} 这类目标的进度**不会再涨**
     * （单条重量只取最大），所以"当时邮箱满、没发出去"的那条**下次上鱼不会再触发** ⇒
     * 不补发就等于**奖励永久丢失** ✗（这正是"先投递再置位"那条纪律要兜住的边界）。
     */
    public static void flushPending(ServerPlayer player) {
        if (player == null || !Tuning.questEnabled()) {
            return;
        }
        QuestData q = PlayerData.getQuests(player);
        if (q.active().isEmpty()) {
            return;
        }
        QuestData next = settleReached(player, q);
        if (!next.equals(q)) {
            PlayerData.setQuests(player, next);
        }
    }

    /**
     * **唯一的**结算点：扫描全部已接委托，把"达标且奖励还没寄出"的逐条寄出 ✓。
     *
     * <p>三条纪律：
     * <ol>
     *   <li><b>先投递、再置位</b>（与 {@link #ensureDaily} 同一条）：邮箱满 ⇒
     *       {@link MailService.Result#BOX_FULL} ⇒ **不置位** ⇒ 下次登录 {@link #flushPending} 再试 ✓；</li>
     *   <li><b>完成即记</b>：活跃度与累计完成数在**寄出奖励信那一刻**就记，
     *       **不等玩家点【领取】** —— 否则不点邮件的玩家永远拿不到活跃度，
     *       而"完成"这件事跟"有没有点开信"本来就无关 ✓（这一条与 `docs/40` §6 草图略有出入，
     *       以本条为准：见该文件 §17.8 的落地修正说明）；</li>
     *   <li><b>顺序固定</b>：先发完所有委托奖励、再统一查档位 —— 这样"最后一次上鱼同时推到 25 档"
     *       也能在同一轮里把档位奖发掉 ✓。</li>
     * </ol>
     */
    private static QuestData settleReached(ServerPlayer player, QuestData q) {
        // 活跃度按"当前这一周"对齐（跨周自动清零 + 清档位位掩码）✓
        q = q.withActivityWeek(weekOf(dayOf(player.serverLevel())));

        for (String id : List.copyOf(q.active().keySet())) {
            QuestData.Row row = q.rowOf(id);
            if (row == null || row.claimed()) {
                continue;
            }
            QuestDef def = QuestPool.byId(id);
            if (def == null || !QuestGoal.reached(def, row)) {
                continue;
            }
            // ⚠⚠ 2026-10-16 用户报："完成日常任务后邮件的奖励也没有显示出来"。
            //   真凶就在这一行原来的写法上：附件传的是 `0L, List.of()` —— **空**。
            //   于是那封信里既没有鱼币也没有物品，玩家点开只看到一句"你完成了 XX"，
            //   而 `docs/40` §6 写的是《委托完成》奖励信**带【领取】、鱼币或物品二选一**。
            //   ⇒ 现在把定义表里写的那份奖励**真的挂到信上**（鱼币 OR 物品，二选一，
            //     与面板上 `rewardText()` 显示的逐字一致 —— 界面说给什么，信里就得有什么）。
            List<ItemStack> reward = def.givesItem()
                    ? stackOf(def.itemId(), def.itemCount())
                    : List.of();
            if (MailService.deliver(player, MAIL_DONE, List.of(nameArg(def)),
                    def.givesCoins() ? def.coins() : 0L, reward) != MailService.Result.OK) {
                continue;                       // 邮箱满 ⇒ 留着，下次补发 ✓
            }
            q = q.withRowClaimed(id);
            int gain = def.period() == QuestDef.Period.WEEKLY
                    ? Tuning.questActivityPerWeekly() : Tuning.questActivityPerDaily();
            q = q.withActivityAdded(gain, Tuning.questActivityCapWeekly());
            q = q.withCompleted(1);
        }
        return settleTiers(player, q);
    }

    // ---------------------------------------------------------------- Q3：活跃度四档
    /**
     * 活跃度档位与四档奖励的**表**在 {@link QuestTiers}（纯表，客户端面板的悬浮提示也读它 ——
     * 1.6.4 用户验收"不知道各档给什么"之后从本类搬出去的）。这里只留结算逻辑。
     *
     * <p>⚠ 表**只写在 QuestTiers 一处**：位掩码 bit 顺序 = 表下标
     * （{@code QuestData.tierClaimed(bit)}）⇒ 加档位只改那张表 ✓。
     */

    /**
     * 挨个检查档位：够档且没领过 ⇒ 寄一封活跃度奖励信（**每档每周各一次**，位掩码挡住重复）✓。
     *
     * <p>循环**从低到高**且每次都重读 {@code activity}：这样一次到位（比如直接从 20 冲到 60）
     * 会把 25 与 50 两档都发掉，而不会漏 ✓。
     */
    private static QuestData settleTiers(ServerPlayer player, QuestData q) {
        for (int bit = 0; bit < QuestTiers.count(); bit++) {
            if (q.tierClaimed(bit) || q.activity() < QuestTiers.AT[bit]) {
                continue;
            }
            List<ItemStack> items = stackOf(QuestTiers.ITEM[bit], QuestTiers.ITEM_COUNT[bit]);
            if (MailService.deliver(player, MAIL_ACTIVITY,
                    List.of(String.valueOf(QuestTiers.AT[bit])), QuestTiers.COINS[bit], items) != MailService.Result.OK) {
                return q;                       // 邮箱满 ⇒ 停在这里，下次补发 ✓
            }
            q = q.withTierClaimed(bit);
        }
        return q;
    }

    // ---------------------------------------------------------------- 小工具
    /**
     * 奖励信里"是哪一条委托"的参数。
     *
     * <p>⚠ 服务端**没有语言表**（`MailEntry` 的纪律）⇒ 只能发**语言键**本身。
     * 以 {@code #} 开头告诉客户端"这一项要当语言键翻一下"
     * （{@code MailScreen.expandArgs} 认这个前缀），不发中文 ✗。
     */
    private static String nameArg(QuestDef def) {
        return "#quest.anglertackle." + def.id() + ".name";
    }

    /** 按物品 id 建栈（`minecraft:iron_ingot` / `anglertackle:bait_glow`）——认不出来给空列表 ✓。 */
    private static List<ItemStack> stackOf(String itemId, int count) {
        if (itemId == null || itemId.isEmpty() || count <= 0) {
            return List.of();
        }
        try {
            Identifier rl = Identifier.tryParse(itemId);
            if (rl == null) {
                return List.of();
            }
            Item item = BuiltInRegistries.ITEM.get(rl).map(Holder.Reference::value).orElse(null);
            if (item == null || item == net.minecraft.world.item.Items.AIR) {
                AnglersTackle.LOGGER.warn("[垂纶] 委托奖励物品 id 认不出来：{}（这一档先不给物品）", itemId);
                return List.of();
            }
            return List.of(new ItemStack(item, count));
        } catch (Throwable t) {
            return List.of();
        }
    }

    /**
     * 上鱼那一刻的竿型（{@code float} / {@code lure}；认不出来给空串）。
     *
     * <p>用**主手现查**而不是给上鱼事件加参数：{@code FishingSession} 是最不该动的地方
     * （排行榜当初的教训就是"别为了功能去动玩法"）；而钓鱼时玩家主手一定握着竿 ✓。
     */
    private static String rodTypeOf(ServerPlayer player) {
        try {
            net.minecraft.world.item.ItemStack held = player.getMainHandItem();
            if (held.getItem() instanceof com.whitecobalt.anglertackle.item.RodItem rod) {
                return rod.rodType() == com.whitecobalt.anglertackle.item.RodItem.RodType.FLOAT ? "float" : "lure";
            }
        } catch (Throwable ignored) {
            // 认不出来就空串 ⇒ 竿型类委托这次不推进（不猜、不给错的分）✓
        }
        return "";
    }
}
