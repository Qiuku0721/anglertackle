package com.whitecobalt.anglertackle.league;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.player.PlayerData;
import net.minecraft.server.level.ServerPlayer;

/**
 * **联赛积分**的口径与唯一入口（`docs/39` §3，用户 2026-10-13 定案）。
 *
 * <h2>口径（一个数字都别自己发明）</h2>
 * <ul>
 *   <li>上鱼：**每尾基础 5** ＋ 品质加成 白 **0** / 绿 **2** / 蓝 **5** / 紫 **10** / 金 **20** / 红 **32**
 *       ⇒ 单尾合计 白 5 / 绿 7 / 蓝 10 / 紫 15 / 金 25 / **红 37**；</li>
 *   <li>结算名次：第 1 **1000** / 第 2 **500** / 第 3 **300** / 第 4~10 **200** / **第 11 名起 0**。</li>
 * </ul>
 *
 * <h2>两种分的发放时机**不一样**（用户原话，别混）</h2>
 * <ul>
 *   <li>**上鱼分：当场发**（"其余如钓鱼钓上来的积分是可以当场结算的"）——钓一尾涨一次数字；</li>
 *   <li>**名次分：结算后才发**（"积分只有在榜积分是结算制度，也就是比赛结束后排行榜定格后才发放"）。</li>
 * </ul>
 *
 * <h2>为什么"上鱼分"不在这里判资格</h2>
 * "必须**签收**过 + 必须在**自己的窗口内**"这两道闸**只有一处**：{@link LeagueService#onCatch}。
 * 本类**不重复判** ⇒ 关掉联赛计分那一行，积分也一起停 ✓（"口径只有一份"是 `docs/37` L3 定的纪律）。
 *
 * <h2>加分的唯一入口</h2>
 * 所有**增加**都走 {@link #award}；所有**减少**都走 {@link #spend}（P4 起）——
 * 这样"哪一处会扣积分"在源码里数得出来，检查器才守得住（`docs/39` §8.2）。
 */
public final class LeaguePoints {

    private LeaguePoints() {
    }

    // ---------------------------------------------------------------- 口径常量

    /** 每尾鱼的基础分。 */
    public static final int BASE_PER_CATCH = 5;

    /** 品质加成，**下标 = 品质档位 0–5**（白绿蓝紫金红；仓库铁律：档位 0 起算）。 */
    public static final int[] QUALITY_BONUS = {0, 2, 5, 10, 20, 32};

    /** 结算名次分。 */
    public static final int RANK_1 = 1000;
    public static final int RANK_2 = 500;
    public static final int RANK_3 = 300;
    /** 第 4~10 名（用户："排名进入前十"）。 */
    public static final int RANK_TOP10 = 200;

    // ---------------------------------------------------------------- 算式

    /** 某个品质档位的加成（越界夹到两端，绝不抛异常 —— 它跑在上鱼路径上）。 */
    public static int qualityBonus(int tier) {
        if (tier <= 0) {
            return QUALITY_BONUS[0];
        }
        if (tier >= QUALITY_BONUS.length) {
            return QUALITY_BONUS[QUALITY_BONUS.length - 1];
        }
        return QUALITY_BONUS[tier];
    }

    /** 一尾鱼的积分：基础 + 品质加成。 */
    public static int perCatch(int tier) {
        return BASE_PER_CATCH + qualityBonus(tier);
    }

    /**
     * 结算名次分。
     *
     * @param rank 名次（1 起）；**≤0 或 ≥11 都是 0**
     */
    public static int rankAward(int rank) {
        return switch (rank) {
            case 1 -> RANK_1;
            case 2 -> RANK_2;
            case 3 -> RANK_3;
            default -> rank >= 4 && rank <= 10 ? RANK_TOP10 : 0;
        };
    }

    // ---------------------------------------------------------------- 唯一入口

    /** 当前余额（读不到数据时返回 0，不抛 —— 它会被界面/指令直接调）。 */
    public static long balance(ServerPlayer player) {
        if (player == null) {
            return 0L;
        }
        try {
            return PlayerData.get(player).leaguePoints();
        } catch (Throwable t) {
            return 0L;
        }
    }

    /**
     * **加积分（唯一入口）**。{@code delta <= 0} 直接返回，不动数据。
     *
     * @param reason 写日志用（"catch" / "rank"），方便玩家报"我的分不对"时对照
     * @return 加完之后的余额
     */
    public static long award(ServerPlayer player, int delta, String reason) {
        if (player == null || delta <= 0) {
            return balance(player);
        }
        long now = PlayerData.update(player, d -> d.addLeaguePoints(delta)).leaguePoints();
        // 推给客户端（HUD / 商店标题都靠它）——**所有加分都经过本方法 ⇒ 不会漏**
        com.whitecobalt.anglertackle.network.ModNetwork.syncLeaguePoints(player);
        AnglersTackle.LOGGER.debug("[垂纶] 联赛积分 +{}（{}）：{} ⇒ {}",
                delta, reason, player.getName().getString(), now);
        return now;
    }

    /**
     * 上鱼给分。**调用点只有一个**：{@link LeagueService#onCatch} 里那两道闸之后
     * （已签收 + 未过窗口/未过硬截止）。
     *
     * @return 这一尾给了多少分
     */
    public static int onCatch(ServerPlayer player, int tier) {
        int delta = perCatch(tier);
        award(player, delta, "catch");
        return delta;
    }

    /**
     * 结算名次分。**调用点只有一个**：{@link LeagueService#settle} 的发奖段
     * （与发鱼币同一处、同一幂等流水 ⇒ "重复结算只加一次"由那条流水保证）。
     */
    public static int onRank(ServerPlayer player, int rank) {
        int delta = rankAward(rank);
        award(player, delta, "rank");
        return delta;
    }

    /**
     * **扣积分（唯一入口）** —— 联赛商店购买走它。
     *
     * <p>⚠ 全仓**只有这里**会让积分变少（`docs/39` §8.2 的断言）：这样"哪一处能扣分"
     * 在源码里数得出来，检查器才守得住。
     *
     * <p>⚠ 调用方必须**先扣分、再发货**：反过来的话，发货中途失败就成了"白拿"✗
     * （与 `ShopManager.buy` 里"扣钱成功之后才走发货"同一条纪律）。
     *
     * @return 扣成功 true；余额不够 false（**不动任何数据**）
     */
    public static boolean spend(ServerPlayer player, int points) {
        if (player == null || points <= 0) {
            return false;
        }
        long have = balance(player);
        if (have < points) {
            return false;
        }
        PlayerData.update(player, d -> d.withLeaguePoints(have - points));
        // 扣分同样要推（商店标题上的积分要当场变少，不然玩家以为没扣）
        com.whitecobalt.anglertackle.network.ModNetwork.syncLeaguePoints(player);
        AnglersTackle.LOGGER.debug("[垂纶] 联赛积分 -{}（shop）：{} ⇒ {}",
                points, player.getName().getString(), have - points);
        return true;
    }
}
