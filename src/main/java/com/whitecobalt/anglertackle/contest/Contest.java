package com.whitecobalt.anglertackle.contest;

import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.leaderboard.Leaderboard;

import java.util.Comparator;
import java.util.UUID;

/**
 * 钓鱼比赛的**纯逻辑地基**（用户 2026-10-11 定案；策划 `docs/35`）。
 *
 * <h2>比赛与联赛的分工（`docs/37` §1.1 那张表）</h2>
 * <ul>
 *   <li><b>比赛</b>（本类）：一场 <b>30 分钟</b>，**全员自动参加**（不报名），当场结算当场广播；</li>
 *   <li>联赛：一期数天，**邀请制**（点签收才算入场），周期结算 + 公示。</li>
 * </ul>
 * 两者共用同一套记分口径（都映射到 {@link Leaderboard.Board}）与同一处挂钩点
 * （{@code LeaderboardHooks.onLanded} 那一帧）—— **绝不为比赛另写一份"怎么算成绩"** ✗。
 *
 * <h2>三条纪律</h2>
 * <ol>
 *   <li>计分只在上鱼成功那一帧做一次 O(1) 的比较/替换（**不每 tick 遍历**）；</li>
 *   <li>并列按"**先钓到**"排前（重量完全相同时比时刻，最后 UUID 兜底）——
 *       与联赛同一套三级键，规则写出来就不是争议 ✓；</li>
 *   <li>奖励额度全部走配置（`docs/35` §7），代码里不出现写死的鱼币数。</li>
 * </ol>
 */
public final class Contest {

    private Contest() {
    }

    /** 1 游戏分钟 = 1200 刻（与联赛同一个换算，写在注释里，不在代码里散落魔数）。 */
    public static final long TICKS_PER_MINUTE = 1200L;

    /**
     * 赛制（`docs/35` §1）。默认 **A 最重一尾**：一杆翻盘、戏剧性最强，
     * 而且与排行榜主榜**完全同源**（不需要新机制）✓。
     */
    public enum Rule {
        HEAVIEST("heaviest", Leaderboard.Board.HEAVIEST),
        TOTAL_WEIGHT("total_weight", Leaderboard.Board.TOTAL_WEIGHT),
        HIGH_TIER("high_tier", Leaderboard.Board.HIGH_TIER_COUNT);

        private final String id;
        private final Leaderboard.Board board;

        Rule(String id, Leaderboard.Board board) {
            this.id = id;
            this.board = board;
        }

        public String id() {
            return this.id;
        }

        public Leaderboard.Board board() {
            return this.board;
        }

        /** 累计型（一直加）还是单场型（只留最好的一尾）。 */
        public boolean cumulative() {
            return !this.board.perCatch();
        }

        /** 配置下标 → 赛制。⚠ 顺序与 `docs/35` §7 的 `defaultRule` 注释逐位绑定。 */
        public static Rule byMode(int mode) {
            Rule[] v = values();
            return v[Math.max(0, Math.min(v.length - 1, mode))];
        }

        public static Rule byId(String id) {
            for (Rule r : values()) {
                if (r.id.equalsIgnoreCase(id)) {
                    return r;
                }
            }
            return HEAVIEST;
        }
    }

    /**
     * 一位参赛者的当前成绩（**只留最好的一条**：A 赛制要的就是这个，内存占用与人数同阶）。
     *
     * @param value   主指标（含义随 {@link Rule}，口径与排行榜逐字相同）
     * @param atTick  这个成绩是何时达成的（**并列时先钓到的排前**）
     * @param catches 本场上了几尾（仅用于显示与"有没有成绩"判定）
     */
    public record Entry(UUID player, String name, double value, long atTick,
                        int catches, String fishId, double weightKg, double lengthCm,
                        String grade, int tier) {
    }

    /** 三级并列键：成绩 → 先达成者 → UUID（与联赛 `League.ORDER` 同一套规则 ✓）。 */
    public static final Comparator<Entry> ORDER = (a, b) -> {
        int byValue = Double.compare(b.value(), a.value());
        if (byValue != 0) {
            return byValue;
        }
        int byTime = Long.compare(a.atTick(), b.atTick());
        if (byTime != 0) {
            return byTime;
        }
        return a.player().compareTo(b.player());
    };

    /** 时长（分钟 → 游戏刻）。 */
    public static long durationTicks(int minutes) {
        return Math.max(1, minutes) * TICKS_PER_MINUTE;
    }

    /**
     * 名次 → 奖励（`docs/35` §5：只发鱼币，不造新物品；也**没有参加奖** ——
     * 有参加奖就会出现"开小号挂着"的刷法，而"自动参加"本来就不需要补偿 ✓）。
     *
     * @param rank 名次（1 / 2 / 3）；其余名次返回 0
     */
    public static long rewardFor(int rank) {
        return switch (rank) {
            case 1 -> Tuning.contestRewardFirst();
            case 2 -> Tuning.contestRewardSecond();
            case 3 -> Tuning.contestRewardThird();
            default -> 0L;
        };
    }

    /** 默认时长（配置）。 */
    public static int defaultMinutes() {
        return Math.max(1, Tuning.contestDefaultMinutes());
    }

    /** 默认赛制（配置下标）。 */
    public static Rule defaultRule() {
        return Rule.byMode(Tuning.contestDefaultRuleMode());
    }
}
