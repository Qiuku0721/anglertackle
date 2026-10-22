package com.whitecobalt.anglertackle.leaderboard;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/**
 * 排行榜的**接线口**（2026-10-10 M1 第 3 步 ✓）。
 *
 * <h2>为什么单独一个类（而不是直接在 FishingSession 里写逻辑）</h2>
 * 用户 2026-10-09 的教训："不许为了功能去动玩法" ✗。所以这里把**全部排行榜逻辑**关在这个类里 ✓，
 * {@code FishingSession} 那边只需要在"上鱼成功那一帧"调**一行** ✓：
 * <pre>{@code LeaderboardHooks.onLanded(this.player, id, kg, grade, rounds, ticks, tier, value);}</pre>
 * ⇒ 想摘掉这个功能时，**删掉那一行 + 这个包**即可 ✓，玩法回到现在**逐字一致** ✓✓。
 *
 * <h2>纪律</h2>
 * <ul>
 *   <li><b>只在服务端跑</b> ✓（入参就是 {@link ServerPlayer} ✓，客户端根本调不到 ✗）。</li>
 *   <li><b>不碰判定、不碰数值</b> ✓：只**读**这次上鱼的结果 ✓，一个字段都不改 ✓。</li>
 *   <li>任何异常都不许影响上鱼 ✓：整段包在 try/catch 里 ✓ —— 排行榜坏了也不能让鱼跑掉 ✗。</li>
 * </ul>
 */
public final class LeaderboardHooks {

    /** 总开关（用户定案：功能可以关 ✓；默认开 ✓ —— 它纯加法、不影响玩法 ✓）。 */
    public static boolean ENABLED = true;

    private LeaderboardHooks() {
    }

    /**
     * 上鱼成功那一刻调一次 ✓（**服务端** ✓）。
     *
     * @return true = 破了某项单场纪录 ✓（将来可以据此广播 ✓）；任何异常都返回 false ✓
     */
    public static boolean onLanded(ServerPlayer player,
                                   String fishId,
                                   double weightKg,
                                   double lengthCm,
                                   String grade,
                                   int rounds,
                                   int ticks,
                                   int tier,
                                   int value) {
        if (!ENABLED || player == null) {
            return false;
        }
        try {
            ServerLevel level = player.serverLevel();
            LeaderboardData data = LeaderboardData.get(level);
            Leaderboard.Catch c = new Leaderboard.Catch(
                    player.getUUID(),
                    player.getName().getString(),
                    fishId == null ? "" : fishId,
                    weightKg,
                    lengthCm,
                    grade == null ? "" : grade,
                    rounds,
                    ticks,
                    tier,
                    value,
                    System.currentTimeMillis());

            boolean broke = false;
            // 联赛期间的成绩另记一份（`docs/39` §6.1）：**同一份成绩快照**，只换个键 ——
            // 计不计数由 LeagueService 那两道闸说了算（已签收 + 窗口内），与联赛积分同一套资格。
            // 查不到就算 null ⇒ 只走常规榜 ✓（联赛坏了绝不影响常规榜 ✓）
            String leagueTier = null;
            try {
                leagueTier = com.whitecobalt.anglertackle.league.LeagueService
                        .activeTierFor(player.serverLevel().getServer(), player);
            } catch (Throwable ignored) {
                // 同上
            }
            for (Leaderboard.Board b : Leaderboard.Board.values()) {
                if (b == Leaderboard.Board.CODEX) {
                    continue;                                   // 图鉴榜由图鉴数据直接算 ✓，不走上鱼事件 ✓
                }
                if (data.submit(b, c)) {
                    broke = true;
                }
                if (leagueTier != null) {
                    data.submitLeague(leagueTier, b, c);
                }
            }
            // 称号「三冠王」：本服三项榜**各拿过一次第一**。
            // 放在这里是因为"谁在榜首"只有提交之后才是最新的 —— 提前判会永远差一条鱼。
            // ⚠ 不要求"同时"（那要一直压住全服三项纪录，做不到，见 docs/38 §4.1）。
            try {
                com.whitecobalt.anglertackle.title.Titles.syncAuto(player);
            } catch (Throwable ignored) {
                // 同上：绝不影响玩法 ✓
            }
            // 联赛计分（docs/37 L3）：**同一份成绩快照**，不重算一遍数值 ——
            // 口径只有一份（Leaderboard.valueOf），联赛只是"按自己的窗口决定算不算"。
            // ⚠ 同样一行接线：删掉这一行就等于关掉联赛计分 ✓
            try {
                com.whitecobalt.anglertackle.league.LeagueService.onCatch(player, c);
            } catch (Throwable ignored) {
                // 同上：联赛坏了也不许让鱼跑掉 ✓
            }
            // 比赛计分（docs/35 §3）：**同一份成绩快照、同一个挂钩点** ——
            // 图鉴记账 / 排行榜 / 联赛 / 比赛四处都只在这里发生一次，谁也不会记两遍 ✓
            try {
                com.whitecobalt.anglertackle.contest.ContestService.onCatch(player, c);
            } catch (Throwable ignored) {
                // 同上
            }
            // 委托进度（docs/40 §13 Q2）：**同一份成绩快照** —— 与上面四处并列的第五个读客，
            // 同样只读不改。⚠ 竿型不在快照里，由 QuestService 自己用主手现查，
            //   所以这一行**不需要**给 FishingSession 加参数（玩法零改动）✓
            try {
                com.whitecobalt.anglertackle.quest.QuestService.onCatch(
                        player, c.fishId(), c.weightKg(), c.lengthCm(), c.tier());
            } catch (Throwable ignored) {
                // 同上：委托坏了也不许让鱼跑掉 ✓
            }
            // 成就自动达成（docs/41 §7 A2）：**同一份成绩快照的第六个读客**，同样只读不改。
            // ⚠ 判定全部在 AchievementService.onCatch 里（一个条件 + 一行 unlock）——
            //   挂钩点是共用的，在这里写判断就会出现两份逻辑 ✓
            try {
                com.whitecobalt.anglertackle.achievement.AchievementService.onCatch(
                        player, c.fishId(), c.weightKg(), c.lengthCm(), c.tier());
                // 尺寸类成就（docs/41 §4 第 14~18 条）：kg/cm 就在这份快照里，顺手判一次 ——
                // 与上面同一份"只读成绩快照"、同一个 try 里（成就坏了也不许让鱼跑掉 ✓）。
                com.whitecobalt.anglertackle.achievement.AchievementService.syncSize(
                        player, c.weightKg(), c.lengthCm());
                // 计数类（打窝 / 满月 / 联赛 / 委托）：同一份只读计数，顺手评估一次 ——
                // 这样"打窝第 100 次"当场就能点亮，不用等下次登录 ✓。
                // 累计上鱼 +1：**就在这里**（onLanded = 鱼真的上岸的唯一出口，不漏也不重复计）——
                // 与断线计数放在断线唯一出口是同一条纪律。计数真源放称号那边，成就只读 ✓。
                com.whitecobalt.anglertackle.title.Titles.bump(player,
                        com.whitecobalt.anglertackle.title.Titles.K_LAND, 1);
                com.whitecobalt.anglertackle.achievement.AchievementService.syncCounters(player);
                // 天时地利类（雨天 / 极地）：天气与群系在这一刻能直接判，不用另存计数 ✓
                com.whitecobalt.anglertackle.achievement.AchievementService.syncEnvironment(player);
            } catch (Throwable ignored) {
                // 同上：成就坏了也不许让鱼跑掉 ✓
            }
            return broke;
        } catch (Throwable t) {
            // ⚠ 排行榜出任何问题都**不许**影响上鱼 ✓（这是"纯加法"的底线 ✓）
            return false;
        }
    }

    /** 断线 / 逃脱 ⇒ 连击清零 ✓（其它榜不受影响 ✓）。异常同样吞掉 ✓。 */
    public static void onStreakBroken(ServerPlayer player) {
        if (!ENABLED || player == null) {
            return;
        }
        try {
            LeaderboardData.get(player.serverLevel()).breakStreak(player.getUUID());
        } catch (Throwable t) {
            // 同上：绝不影响玩法 ✓
        }
    }
}
