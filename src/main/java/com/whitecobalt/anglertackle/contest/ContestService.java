package com.whitecobalt.anglertackle.contest;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.leaderboard.Leaderboard;
import com.whitecobalt.anglertackle.player.PlayerData;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayList;
import java.util.List;

/**
 * 比赛的**服务端动作**：开赛、计分、倒计时结算、公告、发奖、离线兑付（`docs/35` M2-1～M2-2）。
 *
 * <h2>一句话</h2>
 * 服务端开一场限时赛 → 大家照常钓鱼（**不需要报名、不需要换装备**）→ 结束时全服广播名次 + 发鱼币。
 *
 * <h2>时间口径（与联赛同一条纪律）</h2>
 * 开始/结束时刻都用**累计刻**（{@code ServerLevel.getGameTime()}），而且存的是**绝对结束刻**
 * 而不是"剩余秒数" —— 前者重启后照样准，后者重启一次就漂 ✓（`docs/35` §9 的断言之一）。
 * 服务器停机期间两边都不走表 ✓（"30 分钟的比赛"= 服务器真的开着跑了 30 分钟）。
 *
 * <h2>为什么"全员自动参加"</h2>
 * 用户定案（`docs/35` §2）：报名 = 玩家忘了报 ✗ / 中途加入要不要算 ✗ / "在旁边看着的人"最扫兴。
 * 自动参加把这三个问题一次消掉 ✓ —— 开赛后**任何人钓到的鱼**都自动计入。
 */
public final class ContestService {

    private ContestService() {
    }

    /** 每 20 tick 检查一次（与联赛同一个节流习惯，**不每 tick 算**）。 */
    public static final int CHECK_INTERVAL = 20;

    private static int tickCounter;

    /** 开赛结果。 */
    public enum Start {
        OK,
        /** 已经有一场在跑 —— **拒绝**并告知剩余时间（`docs/35` §6：两场不许重叠）✓ */
        BUSY,
        /** 在线人数不够（`minPlayers`，默认 1 = 单人可玩）。 */
        TOO_FEW
    }

    // ================================================================== 每 tick
    /** 由 {@code ServerEvents} 每 tick 调一次（内部按 {@link #CHECK_INTERVAL} 节流）。 */
    public static void tick(MinecraftServer server) {
        if (server == null) {
            return;
        }
        if ((tickCounter++ % CHECK_INTERVAL) != 0) {
            return;
        }
        try {
            long game = server.overworld().getGameTime();
            ContestData d = ContestData.get(server);
            // ① 到点自动结束（结算幂等：settle 自己带守卫）
            if (d.running && game >= d.endGame) {
                settle(server);
            }
            // ② 自动开赛（默认关：`autoEveryMinutes = 0` 表示只手动）
            int every = Tuning.contestAutoEveryMinutes();
            if (!d.running && every > 0) {
                long interval = every * Contest.TICKS_PER_MINUTE;
                long anchor = d.lastAutoStartGame > 0L ? d.lastAutoStartGame : game;
                if (game - anchor >= interval
                        && server.getPlayerList().getPlayerCount() >= Math.max(1, Tuning.contestMinPlayers())) {
                    start(server, Contest.defaultMinutes(), Contest.defaultRule());
                    d.lastAutoStartGame = game;
                    d.setDirty();
                } else if (d.lastAutoStartGame <= 0L) {
                    d.lastAutoStartGame = game;      // 第一 tick 只记锚点，不立刻开（避免一进服就开一场）
                    d.setDirty();
                }
            }
        } catch (Throwable t) {
            // 比赛坏了绝不许影响玩法（与联赛、排行榜同一条底线）
            AnglersTackle.LOGGER.warn("[垂纶] 比赛周期检查失败（已忽略）：{}", t.toString());
        }
    }

    // ================================================================== 开赛 / 停赛
    /**
     * 开一场比赛（`/atl contest start [分钟] [赛制]`，或自动开赛）。
     *
     * <p>⚠ 已有的比赛**没结束就拒绝**（`docs/35` §6）：两场重叠会让"这一场算哪一场"无法回答 ✗。
     */
    public static Start start(MinecraftServer server, int minutes, Contest.Rule rule) {
        ContestData d = ContestData.get(server);
        if (d.running) {
            return Start.BUSY;
        }
        int min = Math.max(1, Tuning.contestMinPlayers());
        if (server.getPlayerList().getPlayerCount() < min) {
            return Start.TOO_FEW;
        }
        long game = server.overworld().getGameTime();
        d.running = true;
        d.settled = false;
        d.ruleMode = rule.ordinal();
        d.minutes = Math.max(1, minutes);
        d.startGame = game;
        d.endGame = game + Contest.durationTicks(d.minutes);      // **绝对结束刻** ✓
        d.scores.clear();
        d.setDirty();
        server.getPlayerList().broadcastSystemMessage(Component.translatable(
                "message.anglertackle.contest_started",
                Component.translatable("contest.anglertackle.rule." + rule.id()), d.minutes), false);
        AnglersTackle.LOGGER.info("[垂纶] 比赛开始：赛制 {}，时长 {} 分钟（结束刻 {}）",
                rule.id(), d.minutes, d.endGame);
        return Start.OK;
    }

    /** `/atl contest stop` = **立刻结算**（不是"取消"：用户没要"作废"，而"提前结算"符合直觉）。 */
    public static int stop(MinecraftServer server) {
        ContestData d = ContestData.get(server);
        if (!d.running) {
            return -1;
        }
        return settle(server);
    }

    // ================================================================== 计分
    /**
     * 上鱼那一刻的计分（由 {@code LeaderboardHooks.onLanded} 调一行 —— 与图鉴记账、
     * 排行榜记分**同一处挂钩点**，`docs/35` §9 的断言之一）。
     *
     * <p>不做的事（每条都是刻意的）：不广播（"我超过记录了"每上一条就播 = 骚扰 ✗）、
     * 不拦任何钓鱼行为（比赛只是记分）、不给没开赛时上鱼的人记分。
     */
    public static void onCatch(ServerPlayer player, Leaderboard.Catch c) {
        if (player == null || c == null) {
            return;
        }
        ContestData d = ContestData.get(player.serverLevel());
        if (!d.running) {
            return;
        }
        long game = player.serverLevel().getGameTime();
        if (game >= d.endGame) {
            return;                       // 结了就不再收（跨期那一尾算下一场，与联赛同一口径）
        }
        Contest.Rule rule = d.rule();
        double v = Leaderboard.valueOf(rule.board(), c);
        d.submit(new Contest.Entry(player.getUUID(), player.getName().getString(), v, game,
                1, c.fishId() == null ? "" : c.fishId(), c.weightKg(), c.lengthCm(),
                c.grade() == null ? "" : c.grade(), c.tier()));
    }

    // ================================================================== 结算
    /**
     * 结算：冻结名次 → 发奖（**先标记已结算**，重复调用不会重复发钱）→ 广播 → 留档。
     *
     * @return 上榜人数；-1 = 根本没有在跑的比赛
     */
    public static int settle(MinecraftServer server) {
        ContestData d = ContestData.get(server);
        if (!d.running) {
            return -1;
        }
        d.running = false;                 // ★ 幂等第一道：先把这一场关掉
        boolean first = !d.settled;
        d.settled = true;
        List<Contest.Entry> ranked = d.ranked();
        d.lastRuleMode = d.ruleMode;
        d.lastStart = d.startGame;
        d.lastEnd = d.endGame;
        d.lastPlayers = ranked.size();
        d.lastBoard.clear();
        for (int i = 0; i < ranked.size(); i++) {
            Contest.Entry e = ranked.get(i);
            d.lastBoard.add((i + 1) + "|" + e.name() + "|" + com.whitecobalt.anglertackle.league.LeagueService
                    .format(e.value()) + "|" + e.fishId() + "|" + com.whitecobalt.anglertackle.league.LeagueService
                    .format(e.weightKg()) + "|" + e.catches());
        }
        if (first) {
            for (int i = 0; i < ranked.size(); i++) {
                reward(server, d, ranked.get(i), i + 1);
            }
        }
        announce(server, d, ranked);
        d.setDirty();
        AnglersTackle.LOGGER.info("[垂纶] 比赛结束：{} 人上榜（赛制 {}，时长 {} 分钟）",
                ranked.size(), d.rule().id(), d.minutes);
        return ranked.size();
    }

    /** 给一个人发名次奖励：在线直接入账，离线记进待领（登录时兑付）✓。 */
    private static void reward(MinecraftServer server, ContestData d, Contest.Entry e, int rank) {
        // 成就 f_contest_join / f_contest_champ（docs/41 §4 第 34、35 条）：
        // ⚠ 比赛是**自动参赛**（策划原话："'自动参加'本来就不需要补偿"）⇒ **进了名次表就算参加过**，
        //   所以这两条都在这里判 —— 结算这一刻名次就在手边，绝不在别处再算一份 ✓。
        // 放在奖励早退**之前**：4 名之后没有奖励，但"参加过比赛"这件事照样成立 ✓。
        try {
            net.minecraft.server.level.ServerPlayer achPlayer =
                    server.getPlayerList().getPlayer(e.player());
            if (achPlayer != null) {
                com.whitecobalt.anglertackle.achievement.AchievementService
                        .unlock(achPlayer, "f_contest_join");
                if (rank == 1) {
                    com.whitecobalt.anglertackle.achievement.AchievementService
                            .unlock(achPlayer, "f_contest_champ");
                }
            }
        } catch (Throwable ignored) {
            // 成就坏了绝不许影响比赛发奖
        }
        long coins = Contest.rewardFor(rank);
        String title = rank == 1 ? "contest_champion" : "";
        if (coins <= 0L && title.isEmpty()) {
            return;                                  // 4 名之后没有奖励（`docs/35` §5）
        }
        ServerPlayer online = server.getPlayerList().getPlayer(e.player());
        if (online != null) {
            give(online, coins, title);
            return;
        }
        if (coins > 0L) {
            d.pendingCoins.merge(e.player(), coins, Long::sum);
        }
        if (!title.isEmpty()) {
            d.pendingTitles.put(e.player(), title);
        }
    }

    /** 在线兑付（结算时在线 + 登录时兑付，两处共用一段代码 ✓）。 */
    private static void give(ServerPlayer player, long coins, String title) {
        if (coins > 0L) {
            PlayerData.update(player, data -> data.addCoins(coins));
            // ⚠ 改完鱼币**必须同步给客户端**（否则 HUD 停在旧值 —— `tools/check-player-data.js` 守着这条）
            com.whitecobalt.anglertackle.network.ModNetwork.syncCoins(player);
            player.displayClientMessage(Component.translatable(
                    "message.anglertackle.contest_reward", coins), false);
        }
        if (title != null && !title.isEmpty()) {
            try {
                com.whitecobalt.anglertackle.title.Titles.grant(player, title);
            } catch (Throwable ignored) {
                // 称号只是锦上添花
            }
        }
    }

    /** 全服公告：前 `announceTop` 名；**0 人上鱼也要说话**（不静默 ✗）。 */
    private static void announce(MinecraftServer server, ContestData d, List<Contest.Entry> ranked) {
        if (ranked.isEmpty()) {
            server.getPlayerList().broadcastSystemMessage(Component.translatable(
                    "message.anglertackle.contest_nobody"), false);
            return;
        }
        int top = Math.max(1, Math.min(10, Tuning.contestAnnounceTop()));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(top, ranked.size()); i++) {
            if (i > 0) {
                sb.append("　");
            }
            Contest.Entry e = ranked.get(i);
            sb.append(medal(i + 1)).append(' ').append(e.name()).append(' ')
                    .append(com.whitecobalt.anglertackle.league.LeagueService.format(e.value()))
                    .append(e.weightKg() > 0
                            ? Component.translatable("contest.anglertackle.unit_kg").getString() : "");
        }
        server.getPlayerList().broadcastSystemMessage(Component.translatable(
                "message.anglertackle.contest_settled", ranked.size(), sb.toString()), false);
    }

    private static String medal(int rank) {
        return switch (rank) {
            case 1 -> "①";
            case 2 -> "②";
            case 3 -> "③";
            default -> "(" + rank + ")";
        };
    }

    // ================================================================== 离线兑付
    /** 登录时把离线期间攒下的比赛奖励兑付（幂等：兑付完就删）。 */
    public static void onLogin(ServerPlayer player) {
        try {
            ContestData d = ContestData.get(player.serverLevel());
            boolean any = false;
            Long coins = d.pendingCoins.remove(player.getUUID());
            if (coins != null && coins > 0L) {
                PlayerData.update(player, data -> data.addCoins(coins));
                com.whitecobalt.anglertackle.network.ModNetwork.syncCoins(player);
                player.displayClientMessage(Component.translatable(
                        "message.anglertackle.contest_reward_offline", coins), false);
                any = true;
            }
            String title = d.pendingTitles.remove(player.getUUID());
            if (title != null && !title.isEmpty()) {
                try {
                    com.whitecobalt.anglertackle.title.Titles.grant(player, title);
                } catch (Throwable ignored) {
                    // 同上
                }
                any = true;
            }
            if (any) {
                d.setDirty();
                AnglersTackle.LOGGER.info("[垂纶] 比赛：{} 登录兑付了离线期间的比赛奖励",
                        player.getName().getString());
            }
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 比赛：登录兑付失败（已忽略）：{}", t.toString());
        }
    }

    // ================================================================== 查询
    /** `/atl contest` 的文本行（**无权限**：看数据不加门槛 ✓）。 */
    public static List<String> statusLines(MinecraftServer server, ServerPlayer me) {
        ContestData d = ContestData.get(server);
        List<String> out = new ArrayList<>();
        if (!d.running) {
            out.add("idle|" + d.lastPlayers);
            return out;
        }
        long game = server.overworld().getGameTime();
        long left = Math.max(0L, d.endGame - game);
        out.add("running|" + d.rule().id() + "|" + (left / Contest.TICKS_PER_MINUTE) + "|"
                + d.scores.size());
        List<Contest.Entry> ranked = d.ranked();
        int myRank = -1;
        Contest.Entry mine = null;
        for (int i = 0; i < ranked.size(); i++) {
            if (me != null && ranked.get(i).player().equals(me.getUUID())) {
                myRank = i + 1;
                mine = ranked.get(i);
            }
        }
        if (mine != null) {
            out.add("mine|" + myRank + "|" + com.whitecobalt.anglertackle.league.LeagueService
                    .format(mine.value()) + "|" + mine.catches());
        } else {
            out.add("mine|-1|0|0");
        }
        for (int i = 0; i < Math.min(3, ranked.size()); i++) {
            Contest.Entry e = ranked.get(i);
            out.add("top|" + (i + 1) + "|" + e.name() + "|"
                    + com.whitecobalt.anglertackle.league.LeagueService.format(e.value()));
        }
        return out;
    }

    /** `/atl contest last`：上一场的名次（下一次开赛才覆盖）✓。 */
    public static List<String> lastLines(MinecraftServer server) {
        ContestData d = ContestData.get(server);
        List<String> out = new ArrayList<>();
        if (d.lastBoard.isEmpty()) {
            out.add("none");
            return out;
        }
        out.add("header|" + d.lastRuleMode + "|" + d.lastPlayers);
        out.addAll(d.lastBoard);
        return out;
    }

    /** 给排行榜界面"本场"页用的结构化名次（服务端只给事实字段，颜色与中文名由客户端处理 ✓）。 */
    public static List<Contest.Entry> boardEntries(MinecraftServer server) {
        ContestData d = ContestData.get(server);
        return d.running ? d.top(com.whitecobalt.anglertackle.leaderboard.RankSnapshot.LIMIT) : List.of();
    }

    /** 当前这场还剩多少刻（没在跑就 -1）—— 界面/指令共用。 */
    public static long remainingTicks(MinecraftServer server) {
        ContestData d = ContestData.get(server);
        if (!d.running) {
            return -1L;
        }
        return Math.max(0L, d.endGame - server.overworld().getGameTime());
    }
}
