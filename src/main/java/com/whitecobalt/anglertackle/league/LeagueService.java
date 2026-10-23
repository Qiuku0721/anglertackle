package com.whitecobalt.anglertackle.league;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.leaderboard.Leaderboard;
import com.whitecobalt.anglertackle.mail.MailService;
import com.whitecobalt.anglertackle.player.FishermanData;
import com.whitecobalt.anglertackle.player.PlayerData;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 联赛的**服务端动作**：开期、邀请、签收、计分、结算、公示、离线兑付（`docs/37` L2–L4）。
 *
 * <h2>一期的时间轴（用户 2026-10-11 定案，`docs/37` §3.4）</h2>
 * <pre>
 * 推送邀请 T0（服务端统一时刻）
 *   │  全局硬截止 = T0 + 5 游戏日 = 120000 tick ≈ 运行 100 分钟
 *   ├── 玩家 A 第 3 分钟签收 ──▶ 他的窗口 = [签收, 签收 + 30 游戏分钟]
 *   ├── 玩家 B 第 90 分钟签收 ─▶ 窗口只剩 10 分钟（被硬截止截断）✓ "无论有没有打满"
 *   └── 玩家 C 从不签收 ──────▶ 不计分，但照样收到结算公示（未参赛）
 * </pre>
 *
 * <h2>两个判定各管一件事（⚠ 这是我按最直白的读法实现的，与 `docs/37` §3.3 有**一处偏差**）</h2>
 * <ul>
 *   <li><b>硬截止到点 ⇒ 结算</b>（"无论有没有打满，结算时也强行截止"）；</li>
 *   <li><b>推送间隔到点 ⇒ 开下一期</b>（7 / 30 / 90 天）。</li>
 * </ul>
 * 文档 §3.3 第 2 条写的是"硬截止 ⇒ 强行结算**并同时推送下一期**"。照字面做的话，
 * 一期只跑 5 游戏日（≈100 分钟运行时间），于是**每 100 分钟就会开一期新的** ——
 * 三级间隔 7/30/90 天会被压成同一个节奏，"大联赛"与小联赛再无区别 ✗。
 * 所以这里把两条的效果拆开：硬截止负责**结算**，间隔负责**开期**。
 * （停机一整周再回来时两条可能同时到点 ⇒ 先结算、再开新期，一期都不会丢 ✓。）
 *
 * <h2>时间只用累计刻</h2>
 * {@code ServerLevel.getGameTime()}（只增不减）。**绝不用 {@code getDayTime()}** ——
 * 那个睡一觉就被推到天明、`/time set` 想改就改，用它算周期 ⇒ 睡一觉赛季就跳完了 ✗（`docs/37` §3.1）。
 * 现实口径那一半用 UTC 毫秒（{@code System.currentTimeMillis()}），并把"倒退"当作 0 增量 ✓。
 */
public final class LeagueService {

    private LeagueService() {
    }

    /** 每 20 tick 检查一次（与 {@code BarrelFermenting} 同一个节流习惯，**不每 tick 算**）。 */
    public static final int CHECK_INTERVAL = 20;

    private static int tickCounter;

    /** 签收结果（`/atl league` 与邮件动作都用它给玩家一句人话）。 */
    public enum JoinResult {
        /** 签收成功，本期开始计分。 */
        OK,
        /** 本期已经签收过了（幂等）。 */
        ALREADY,
        /** 本期已结算 / 已过硬截止 —— 领奖可以，报名不行。 */
        TOO_LATE,
        /** 等级不够（签收时再校验一次）。 */
        NOT_ELIGIBLE,
        /** 现在没有在跑的一期。 */
        NO_PERIOD
    }

    // ================================================================== 每 tick
    /**
     * 每 tick 调一次（由 {@link LeagueHooks} 接在服务端 tick 事件上），内部按
     * {@link #CHECK_INTERVAL} 节流。任何异常都吞掉 —— 联赛坏了绝不许影响玩玩法 ✓。
     */
    public static void tick(MinecraftServer server) {
        if (server == null) {
            return;
        }
        if ((tickCounter++ % CHECK_INTERVAL) != 0) {
            return;
        }
        try {
            var level = server.overworld();
            long game = level.getGameTime();            // ⚠ 累计刻（见类注释）
            long wall = System.currentTimeMillis();
            LeagueData d = LeagueData.get(server);

            // ---- 回档钳制：累计刻只增不减（`docs/37` §3.2 坑 4）----
            if (game < d.lastSeenGame) {
                long clamped = d.lastSeenGame;
                d.pushAnchorGame = Math.max(d.pushAnchorGame, clamped);
                d.hardDeadlineGame = Math.max(d.hardDeadlineGame, clamped);
                AnglersTackle.LOGGER.warn("[垂纶] 联赛：检测到世界时间倒退（{} → {}），"
                        + "锚点与硬截止已向前钳制到 {}（回档不会让同一期重复触发）", d.lastSeenGame, game, clamped);
            }
            d.lastSeenGame = Math.max(d.lastSeenGame, game);

            if (d.seasonId == 0) {
                // 从来没开过 —— 第一 tick 就开第一期（老存档也一样：装上新版就有联赛）
                push(server, game, wall);
                return;
            }
            // ① 硬截止：**不管有没有人打满**，一律结算（用户原话"强行截止"）
            if (!d.settled && game >= d.hardDeadlineGame) {
                settle(server);
            }
            // ② 推送间隔到点：结算上一期（若还没结算）+ 开下一期
            if (dueForPush(d, game, wall)) {
                settle(server);
                push(server, game, wall);
            }
        } catch (Throwable t) {
            // 联赛出任何问题都不许影响玩法（与 LeaderboardHooks 同一条底线）
            AnglersTackle.LOGGER.warn("[垂纶] 联赛周期检查失败（已忽略）：{}", t.toString());
        }
    }

    /** 当前口径下的"现在"（游戏口径 = 累计刻；现实口径 = UTC 毫秒）。 */
    private static long nowOf(LeagueData d, long game, long wall) {
        return realClock() ? wall : game;
    }

    private static long anchorOf(LeagueData d) {
        return realClock() ? d.pushAnchorWall : d.pushAnchorGame;
    }

    /** 推送间隔（按当前口径换算成对应的单位：毫秒 或 刻）。 */
    private static long intervalOf(LeagueData d) {
        long days = d.tier().days();
        return realClock() ? days * 24L * 60L * 60L * 1000L : days * League.TICKS_PER_DAY;
    }

    private static boolean realClock() {
        return Tuning.leagueUseRealDays();
    }

    /**
     * 到推送点了吗。
     *
     * <p>⚠ 现实口径的时钟**可能被改**（`docs/37` §3.2 坑 7）：所以只比差值，
     * 且把负数增量当作 0 —— 否则把系统时间往前调一次就能瞬间跨期 ✗。
     */
    private static boolean dueForPush(LeagueData d, long game, long wall) {
        long now = nowOf(d, game, wall);
        long anchor = anchorOf(d);
        if (anchor <= 0L) {
            return true;
        }
        return now - anchor >= intervalOf(d);
    }

    // ================================================================== 开期
    /** 开一期并给够格的人发邀请。返回期号。 */
    public static int push(MinecraftServer server, long game, long wall) {
        LeagueData d = LeagueData.get(server);
        int idx = Math.floorMod(d.nextTierIndex, League.Tier.values().length);
        League.Tier tier = League.Tier.values()[idx];
        d.seasonId++;
        // 赛季号（`docs/39` D1）：**三级轮转下"轮到小型"就是新赛季的第一期**，
        // 季内三期共用同一个号（所以"S1小型冠军"与"S1大型冠军"会同时存在 ✓）。
        // ⚠ 独立计数，绝不拿 seasonId 反推（allowConcurrent 打开时界桩会漂）✓
        if (d.seasonNo <= 0 || idx == 0) {
            d.seasonNo = d.seasonNo <= 0 ? 1 : d.seasonNo + 1;
        }
        d.tierId = tier.id();
        d.ruleMode = Tuning.leagueRuleMode();
        d.periodGameDays = Math.max(1, Tuning.leaguePeriodGameDays());
        d.windowTicks = League.windowTicks();
        d.openedAtGame = game;
        d.hardDeadlineGame = League.hardDeadline(game);
        d.settled = false;
        d.members.clear();
        d.invited.clear();
        d.nextTierIndex = (idx + 1) % League.Tier.values().length;
        // 锚点推进：**按整段间隔往前推**，而不是 = now（`docs/37` §3.3）
        //   ⚠ 用 = now 会把停机期间的时间吞掉，节奏越跑越偏；
        //   而停机很久（跨了好几个间隔）时用 while 一次性跳过漏掉的期，
        //   免得回到游戏时连开好几期（"补课"没有意义：那些期里没人在玩）。
        long now = nowOf(d, game, wall);
        long interval = intervalOf(d);
        if (realClock()) {
            if (d.pushAnchorWall <= 0L || now - d.pushAnchorWall >= interval) {
                // 第一次：锚点对齐到**下一个本地钟点**（默认 12:00），期界从此落在整点上
                long anchor = d.pushAnchorWall <= 0L
                        ? League.nextBoundary(wall, Tuning.leaguePeriodBoundaryHour())
                        : d.pushAnchorWall;
                while (now - anchor >= interval) {
                    anchor += interval;
                }
                d.pushAnchorWall = anchor;
            }
        } else {
            if (d.pushAnchorGame <= 0L || now - d.pushAnchorGame >= interval) {
                long anchor = d.pushAnchorGame <= 0L ? now : d.pushAnchorGame;
                while (now - anchor >= interval) {
                    anchor += interval;
                }
                d.pushAnchorGame = anchor;
            }
        }
        // 两个锚点都跟着走：口径可以随时切（切过去之后不会因为另一个锚点很旧而立刻又开一期）
        d.pushAnchorWall = d.pushAnchorWall <= 0L ? wall : d.pushAnchorWall;
        d.pushAnchorGame = d.pushAnchorGame <= 0L ? game : d.pushAnchorGame;

        int invited = 0;
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            if (inviteTo(p, d)) {
                invited++;
            }
        }
        d.setDirty();
        AnglersTackle.LOGGER.info("[垂纶] 联赛：开第 {} 期（{}，口径 {}，硬截止 {} 刻后），已邀请 {} 人",
                d.seasonId, tier.id(), d.rule().id(), d.hardDeadlineGame - game, invited);
        return d.seasonId;
    }

    /** 给一个人发本期的邀请（够格才发）。返回 true = 真的发了。 */
    private static boolean inviteTo(ServerPlayer p, LeagueData d) {
        if (p == null || d.seasonId == 0 || d.settled) {
            return false;
        }
        if (d.invited.contains(p.getUUID())) {
            return false;                                   // 本期已经发过了
        }
        if (!eligible(p)) {
            return false;
        }
        League.Tier tier = d.tier();
        League.Invite gift = League.inviteGift(tier, p.level().getRandom());
        MailService.Result r = MailService.send(p, "league_invite",
                List.of(String.valueOf(d.seasonId), tier.id(),
                        String.valueOf(Tuning.leaguePlayerWindowMinutes()),
                        String.valueOf(d.periodGameDays)),
                gift.coins(), gift.items(), "league_join");
        if (r != MailService.Result.OK) {
            // ⚠ 邮箱满 ⇒ 拒绝投递（绝不静默丢）。**不记 invited**，这样他清出格子后下次登录还会收到 ✓
            AnglersTackle.LOGGER.warn("[垂纶] 联赛：{} 的邮箱满了，第 {} 期邀请没有投递出去",
                    p.getName().getString(), d.seasonId);
            return false;
        }
        d.invited.add(p.getUUID());
        d.setDirty();
        return true;
    }

    /** 够不够资格（等级 ≥ 21；`allowBelowLevel` 打开时放宽为所有人）。 */
    public static boolean eligible(ServerPlayer p) {
        if (Tuning.leagueAllowBelowLevel()) {
            return true;
        }
        try {
            return League.qualifies(FishermanData.get(p).level());
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * 登录时的两条补课（`docs/37` §7"中途加入"那条的**有意放宽**，理由写在下面）。
     *
     * <ol>
     *   <li><b>离线待投递</b>（邀请 / 成绩单 / 奖励 / 经验 / 称号）：结算时不在线的人，
     *       东西存在世界数据里，登录这一刻兑付 ✓；</li>
     *   <li><b>补发本期邀请</b>：文档原话是"中途加入的玩家本期不再补发邀请"，
     *       那是为了防"掐着结算前一天进来捡便宜"。⚠ 但本模组的**够格名单只存在于玩家附件里**
     *       （离线读不到），所以"推送那一刻不在线"的人**永远收不到邀请** ——
     *       一个每周只上两天的玩家可能一期都参加不了 ✗。
     *       而用户定的"每人窗口 + 硬截止截断"（§3.4）本身就消灭了那个便宜：
     *       越晚签收，窗口越短（第 90 分钟签收只剩 10 分钟）✓。所以这里补发，并由
     *       {@code leagueInviteOnLogin} 开关（默认开）给服主留一个"严格按文档"的选项。
     * </ol>
     */
    public static void onLogin(ServerPlayer player) {
        try {
            flushPending(player);
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 联赛：登录兑付失败（已忽略）：{}", t.toString());
        }
        try {
            if (!Tuning.leagueInviteOnLogin()) {
                return;
            }
            LeagueData d = LeagueData.get(player.level());
            if (d.seasonId == 0 || d.settled) {
                return;
            }
            inviteTo(player, d);
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 联赛：登录补发邀请失败（已忽略）：{}", t.toString());
        }
    }

    // ================================================================== 签收
    /**
     * 签收（邮件里的【签收】按钮走 {@code MailActions} 到这里）。
     *
     * <p>顺序：**先判能不能报名，再报名**；签收礼由邮件自己的附件给（{@code MailService.claim}）——
     * 所以这里**不碰钱、不碰物品**，只写"这个人本期参赛了"✓（一个动作一件事）。
     */
    public static JoinResult joinSign(ServerPlayer player) {
        if (player == null) {
            return JoinResult.NO_PERIOD;
        }
        LeagueData d = LeagueData.get(player.level());
        long game = player.level().getGameTime();
        if (d.seasonId == 0) {
            return JoinResult.NO_PERIOD;
        }
        if (d.members.containsKey(player.getUUID())) {
            return JoinResult.ALREADY;                      // 幂等：重复点不重置窗口 ✓
        }
        if (d.settled || game >= d.hardDeadlineGame) {
            return JoinResult.TOO_LATE;                     // 强行截止之后不再收人 ✓
        }
        if (!eligible(player)) {
            return JoinResult.NOT_ELIGIBLE;                 // 签收时再校验一次（中途掉级）
        }
        long windowEnd = League.windowEnd(game, d.windowTicks, d.hardDeadlineGame);
        d.join(player.getUUID(), player.getName().getString(), game, windowEnd);
        // 常客（`docs/38`：签收即得，可重复的那几条之外的第一条联赛称号）
        try {
            com.whitecobalt.anglertackle.title.Titles.grant(player, "league_regular");
        } catch (Throwable ignored) {
            // 称号只是锦上添花
        }
        AnglersTackle.LOGGER.info("[垂纶] 联赛：{} 签收第 {} 期，窗口到 {} 刻（还剩 {} 刻）",
                player.getName().getString(), d.seasonId, windowEnd, windowEnd - game);
        return JoinResult.OK;
    }

    // ================================================================== 计分
    /**
     * 上鱼那一刻的计分（由 {@code LeaderboardHooks.onLanded} 调一行）。
     *
     * <p>三条判定，缺一不可（`docs/37` §8 的断言逐条对着它们）：
     * <ol>
     *   <li>**签收过**才计分（没签收的人上鱼不计数）；</li>
     *   <li>在自己的窗口内（**每人独立** —— 读的是这个玩家自己的 {@code windowEnd}）；</li>
     *   <li>没过硬截止（本期快照已冻结 ⇒ 截止后上岸的算下一期，FF14 那个事故的口径 ✓）。</li>
     * </ol>
     * ⚠ 窗口用完只是**不计分**：绝不拦他继续钓鱼（`docs/37` §3.4"只计分不惩罚"）。
     */
    /**
     * 这名玩家此刻是否**处在联赛计分窗口内**：是 ⇒ 返回本期规模 id（{@link League.Tier#id()}），
     * 否则 {@code null}。
     *
     * <p>判据与下面 {@link #onCatch} 里那两道闸**逐字相同**（① 已签收 ② 未过窗口 / 未过硬截止）。
     * 用途：排行榜要在**同一套资格**下另记一份"联赛期间的成绩"（`docs/39` §6.1）——
     * 若两处判据不一致，就会出现"联赛积分算数、联赛榜不算数"这种自相矛盾 ✗。
     *
     * <p>⚠ 之所以没有把 {@code onCatch} 里那两行抽出来共用：`check-league.js` 的断言
     * **盯着 onCatch 里的原文**（"上鱼分必须在那两道闸之后"），抽走那条断言就会失效。
     * 所以这里重复了判据 —— **改动其中一处就必须同时改另一处**（两边都留了这句提醒）。
     */
    public static String activeTierFor(net.minecraft.server.MinecraftServer server, ServerPlayer player) {
        if (server == null || player == null) {
            return null;
        }
        try {
            LeagueData d = LeagueData.get(server);
            LeagueData.Member m = d.member(player.getUUID());
            if (m == null) {
                return null;
            }
            long game = player.level().getGameTime();
            if (game > m.windowEnd || game >= d.hardDeadlineGame) {
                return null;
            }
            return d.tierId;
        } catch (Throwable t) {
            return null;   // 联赛查询失败绝不影响别的榜（同 LeaderboardHooks 的态度）
        }
    }

    public static void onCatch(ServerPlayer player, Leaderboard.Catch c) {
        if (player == null || c == null) {
            return;
        }
        LeagueData d = LeagueData.get(player.level());
        LeagueData.Member m = d.member(player.getUUID());
        if (m == null) {
            return;
        }
        long game = player.level().getGameTime();
        if (game > m.windowEnd || game >= d.hardDeadlineGame) {
            return;
        }
        // 联赛积分（`docs/39` P1）：**就给在这道闸之后** ——
        // "已签收"是上面 `m == null` 那道、"窗口内"就是刚过去的那道，
        // 两个资格条件在这里已经判完了 ⇒ 积分与联赛计分**永远同一套资格** ✓
        // （绝不另写一份判定：那样迟早出现"计了分却没给积分"的两套口径 ✗）
        try {
            LeaguePoints.onCatch(player, c.tier());
        } catch (Throwable t) {
            // 积分坏了也不许影响上鱼与联赛计分（与 LeaderboardHooks 的态度一致）
            // 故意吞掉：这里抛出去会把整条上鱼链路带崩，丢鱼才是最贵的 ✗
        }
        League.Rule rule = d.rule();
        double v;
        if (rule == League.Rule.CODEX) {
            // 图鉴完成度不来自"这一尾"，而是当前图鉴数量 ⇒ 取现值（单调取大）
            try {
                v = PlayerData.get(player).codexCount();
            } catch (Throwable t) {
                return;
            }
        } else {
            v = Leaderboard.valueOf(rule.board(), c);
        }
        m.catches++;
        if (rule.cumulative()) {
            m.value += v;
            m.atTick = game;                    // 累计型：最后一次变好的时刻
        } else if (League.improves(rule, v, m.value)) {
            m.value = v;
            m.atTick = game;                    // 单场型：那一尾的时刻（并列第二级键）
        }
        d.setDirty();
    }

    // ================================================================== 结算
    /**
     * 结算本期：冻结名次 → 写流水键 → 发奖（在线走邮件、离线进待投递队列）→ 公示。
     *
     * @return 上榜人数（0 = 没人有有效成绩）
     */
    public static int settle(MinecraftServer server) {
        LeagueData d = LeagueData.get(server);
        if (d.seasonId == 0 || d.settled) {
            return 0;                                       // 幂等：结算过就不再算一次
        }
        d.settled = true;
        League.Tier tier = d.tier();
        int minCatches = Math.max(1, Tuning.leagueMinCatchesToRank());
        List<League.Entry> ranked = d.ranked(minCatches);

        // ---- ① 先冻结快照（结算与新一期不交错，`docs/37` §5.2）----
        d.lastSeasonId = d.seasonId;
        d.lastTierId = d.tierId;
        d.lastJoined = d.members.size();
        d.lastRanked = ranked.size();
        d.lastBoard.clear();
        for (int i = 0; i < ranked.size(); i++) {
            League.Entry e = ranked.get(i);
            d.lastBoard.add((i + 1) + "|" + e.name() + "|" + format(e.value()) + "|" + e.catches());
        }
        // 历届档案（`docs/39` §6.1）：排行榜要能翻"某一赛季"，老的那几届必须活着。
        // 放在**快照冻结之后**：这时 ranked 刚定下来，值不会再被别的流程动。
        d.archiveSeason(d.seasonNo, d.tierId, ranked);
        String winnerName = ranked.isEmpty() ? "" : ranked.get(0).name();
        String winnerValue = ranked.isEmpty() ? "" : format(ranked.get(0).value());

        // ---- ② 发奖：**先写流水键、再发钱**（重跑第二次插入失败 ⇒ 天然幂等）----
        int paid = 0;
        for (int i = 0; i < ranked.size(); i++) {
            League.Entry e = ranked.get(i);
            int rank = i + 1;
            int rewardRank = rank <= League.TOP10_RANK ? rank : 0;      // 11 名之后拿参与奖
            String key = d.seasonId + "|" + e.player() + "|" + d.tierId;
            if (!d.ledger.add(key)) {
                continue;                                               // 这一份已经发过
            }
            // 成就 f_league_champ / f_league_top10（docs/41 §4 第 32、33 条）：结算这一刻**名次就在手边**，
            // 当场判最准 —— 绝不在别处再算一份名次（那就是第二份真源，迟早对不上）。
            // 离线的人这条会漏一次，但下次结算/登录时名次类成就仍会补（幂等，不会重复发信）✓。
            try {
                net.minecraft.server.level.ServerPlayer achPlayer =
                        server.getPlayerList().getPlayer(e.player());
                if (achPlayer != null) {
                    if (rank == 1) {
                        com.whitecobalt.anglertackle.achievement.AchievementService
                                .unlock(achPlayer, "f_league_champ");
                    }
                    if (rank >= 1 && rank <= 10) {
                        com.whitecobalt.anglertackle.achievement.AchievementService
                                .unlock(achPlayer, "f_league_top10");
                    }
                }
            } catch (Throwable ignored) {
                // 成就坏了绝不许影响联赛发奖
            }
            League.Reward r = League.rewardFor(rewardRank, tier);
            deliver(server, d, e.player(), "league_result",
                    List.of(String.valueOf(d.seasonId), tier.id(), String.valueOf(rank),
                            String.valueOf(ranked.size()), winnerName, winnerValue),
                    r.coins(), r.items(), r.xp(), LeaguePoints.rankAward(rank),
                    titleFor(d.seasonNo, d.tierId, rank));
            paid++;
        }
        // ---- ③ 签收过但没上榜的（0 尾 / 不足下限）：一封信说明白（不给名次奖）----
        for (var en : d.members.entrySet()) {
            if (d.ledger.contains(d.seasonId + "|" + en.getKey() + "|" + d.tierId)) {
                continue;
            }
            d.ledger.add(d.seasonId + "|" + en.getKey() + "|" + d.tierId);
            deliver(server, d, en.getKey(), "league_no_score",
                    List.of(String.valueOf(d.seasonId), tier.id(), String.valueOf(minCatches)),
                    0L, List.of(), 0, 0, "");
        }
        // ---- ④ 被邀请但没签收的：也发一封公示（不静默 ✗，`docs/37` §5.1）----
        for (UUID id : new ArrayList<>(d.invited)) {
            if (d.members.containsKey(id)) {
                continue;
            }
            deliver(server, d, id, "league_missed",
                    List.of(String.valueOf(d.seasonId), tier.id(), String.valueOf(ranked.size())),
                    0L, List.of(), 0, 0, "");
        }

        // ---- ⑤ 全服广播前 3 名 ----
        if (!ranked.isEmpty()) {
            StringBuilder top = new StringBuilder();
            for (int i = 0; i < Math.min(3, ranked.size()); i++) {
                if (i > 0) {
                    top.append("、");
                }
                top.append(ranked.get(i).name()).append(' ').append(format(ranked.get(i).value()));
            }
            server.getPlayerList().broadcastSystemMessage(Component.translatable(
                    "message.anglertackle.league_settled_broadcast",
                    d.seasonId, Component.translatable("league.anglertackle.tier." + tier.id()),
                    ranked.size(), top.toString()), false);
        } else {
            server.getPlayerList().broadcastSystemMessage(Component.translatable(
                    "message.anglertackle.league_settled_empty", d.seasonId,
                    Component.translatable("league.anglertackle.tier." + tier.id())), false);
        }
        d.setDirty();
        AnglersTackle.LOGGER.info("[垂纶] 联赛：第 {} 期（{}）结算完成 —— 签收 {} 人、上榜 {} 人、发奖 {} 份",
                d.seasonId, d.tierId, d.members.size(), ranked.size(), paid);
        return ranked.size();
    }

    /**
     * 名次称号的**实例 id**（1/2/3 名各一条；第 4 名起没有称号）。
     *
     * <p>拼法只有这一处（`docs/39` §5.3）：{@code 模板@S<赛季号>-<规模>}，例如
     * {@code league_champ@S1-large} ⇒ 显示"S1大型联赛冠军"。授予由
     * {@code deliverNow} 里那行 {@code Titles.grant} 完成，本方法只管拼。
     *
     * <p>⚠ 用的是**赛季号**（`LeagueData.seasonNo`，季内三期同号），不是期号 ✓
     */
    private static String titleFor(int seasonNo, String tierId, int rank) {
        String tmpl = rank == 1 ? "league_champ"
                : rank == 2 ? "league_runnerup"
                : rank == 3 ? "league_third" : "";
        return tmpl.isEmpty() ? "" : com.whitecobalt.anglertackle.title.TitleDefs
                .instanceId(tmpl, Math.max(1, seasonNo), tierId);
    }

    /** 成绩数值的显示口径（整数就显示整数，避免"4.8200000001 kg"这种）。 */
    public static String format(double v) {
        if (Math.abs(v - Math.rint(v)) < 0.005) {
            return String.valueOf((long) Math.rint(v));
        }
        return String.format(java.util.Locale.ROOT, "%.2f", v);
    }

    /**
     * 剩余刻 → "还剩多久"的人话（指令里用）。
     *
     * <p>换算按**游戏时间**：1 游戏日 = 24000 刻 = 20 分钟 ⇒ 1 刻 = 0.05 秒的真实运行时间。
     * ⚠ 所以显示的"分钟"是**服务器还要跑多久**，不是现实倒计时（服务器停机期间它不走）——
     * 这一点必须写在文案里，否则玩家会以为"还有 100 分钟"就是现实 100 分钟 ✗。
     */
    public static String ticksToText(long ticks) {
        long minutes = Math.max(0L, ticks) / League.TICKS_PER_MINUTE;
        if (minutes < 60) {
            return minutes + " 游戏分钟";
        }
        return (minutes / 60) + " 游戏小时 " + (minutes % 60) + " 分";
    }

    /**
     * 把一份奖励交给某个玩家：**在线就直接投递，离线就写进待投递队列**。
     *
     * <p>⚠ 经验（{@code leagueXp*}）没有邮件载体（邮件只有鱼币 + 4 格物品）⇒ 直接入账；
     * 离线玩家先记在 {@link LeagueData.Pending} 里，登录时补 —— 绝不因为"他没上线"就把经验吞掉 ✓。
     */
    private static void deliver(MinecraftServer server, LeagueData d, UUID target,
                                String template, List<String> args,
                                long coins, List<net.minecraft.world.item.ItemStack> items,
                                int xp, int points, String title) {
        ServerPlayer online = server.getPlayerList().getPlayer(target);
        if (online != null) {
            deliverNow(online, template, args, coins, items, xp, points, title);
            return;
        }
        LeagueData.Pending p = new LeagueData.Pending(target);
        p.template = template;
        p.args = new ArrayList<>(args);
        p.coins = coins;
        p.items = new ArrayList<>(items);
        p.action = "";
        p.xp = xp;
        p.points = points;
        p.title = title;
        d.pushPending(p);
    }

    /** 在线兑付（结算时在线 + 登录时兑付队列，走同一段代码 —— 两条路不会分叉）。 */
    private static void deliverNow(ServerPlayer player, String template, List<String> args,
                                   long coins, List<net.minecraft.world.item.ItemStack> items,
                                   int xp, int points, String title) {
        if (template != null && !template.isEmpty()) {
            MailService.send(player, template, args, coins, items, "");
        }
        if (xp > 0) {
            try {
                FishermanData.addXp(player, xp);
            } catch (Throwable t) {
                AnglersTackle.LOGGER.warn("[垂纶] 联赛：给 {} 加 {} 经验失败：{}",
                        player.getName().getString(), xp, t.toString());
            }
        }
        if (points > 0) {
            // 名次分（`docs/39` P2）：**就在这里入账** —— 邮件带不了积分，
            // 与上面那段经验完全同一个处理（在线当场给、离线登录时补）✓
            try {
                LeaguePoints.award(player, points, "rank");
            } catch (Throwable t) {
                AnglersTackle.LOGGER.warn("[垂纶] 联赛：给 {} 加 {} 积分失败：{}",
                        player.getName().getString(), points, t.toString());
            }
        }
        if (title != null && !title.isEmpty()) {
            try {
                com.whitecobalt.anglertackle.title.Titles.grant(player, title);
            } catch (Throwable ignored) {
                // 称号只是锦上添花
            }
        }
    }

    // ================================================================== 离线兑付
    /**
     * 把这个玩家的待投递件全部兑付（登录时调，幂等：兑付完就删）。
     *
     * @return 兑付了几件
     */
    public static int flushPending(ServerPlayer player) {
        LeagueData d = LeagueData.get(player.level());
        if (d.pending.isEmpty()) {
            return 0;
        }
        List<LeagueData.Pending> mine = new ArrayList<>();
        for (LeagueData.Pending p : d.pending) {
            if (player.getUUID().equals(p.player)) {
                mine.add(p);
            }
        }
        if (mine.isEmpty()) {
            return 0;
        }
        d.pending.removeAll(mine);
        d.setDirty();
        for (LeagueData.Pending p : mine) {
            deliverNow(player, p.template, p.args, p.coins, p.items, p.xp, p.points, p.title);
        }
        AnglersTackle.LOGGER.info("[垂纶] 联赛：{} 登录兑付了 {} 件（离线期间的邀请/成绩单/奖励）",
                player.getName().getString(), mine.size());
        return mine.size();
    }

    // ================================================================== 查询
    /** `/atl league` 的文本行（**无权限**：看数据不加门槛，同 AGENTS §六）。 */
    public static List<String> statusLines(MinecraftServer server) {
        List<String> out = new ArrayList<>();
        LeagueData d = LeagueData.get(server);
        if (d.seasonId == 0) {
            out.add("league_none");
            return out;
        }
        long game = server.overworld().getGameTime();
        out.add("header|" + d.seasonId + "|" + d.tierId + "|" + d.rule().id());
        if (d.settled) {
            out.add("closed|" + d.lastJoined + "|" + d.lastRanked);
        } else {
            out.add("running|" + Math.max(0L, d.hardDeadlineGame - game) + "|" + d.members.size()
                    + "|" + d.windowTicks);
        }
        for (String row : d.lastBoard.subList(0, Math.min(10, d.lastBoard.size()))) {
            out.add("rank|" + row);
        }
        return out;
    }
}
