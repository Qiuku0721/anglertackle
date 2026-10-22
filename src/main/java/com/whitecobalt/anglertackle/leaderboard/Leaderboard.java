package com.whitecobalt.anglertackle.leaderboard;

import java.util.UUID;

/**
 * 《垂纶》排行榜的**纯逻辑地基**（2026-10-10 按用户定案开做 M1 ✓）。
 *
 * <h2>用户定案（原文见 docs/联机功能策划案.md 的【定案】一节）</h2>
 * <ul>
 *   <li>三种环境都做 ✓（单机存档 / 局域网 / 专用服务器 **同一套代码** ✓，榜**跟着存档走** ✓）</li>
 *   <li>第一批维度**全要** ✓（见 {@link Board}）</li>
 *   <li>展示形态：**游戏内界面** ✓（指令只当调试口 ✓）</li>
 *   <li>按玩家持久化的设置 ✓（开关退出重进要保留 ✓ ⇒ 存**服务端**的玩家数据 ✓）</li>
 * </ul>
 *
 * <h2>三条纪律（改这个包的人必须守住）</h2>
 * <ol>
 *   <li><b>服务端权威</b> ✓：结算点就是 {@code FishingSession} 里**上鱼成功那一帧**。
 *       <b>绝不接受客户端上报成绩</b> ✗ —— 从根上杜绝改包刷榜 ✓。</li>
 *   <li><b>只在事件上写一次</b> ✓：不每 tick 统计 ✗；没破纪录就不写盘 ✓。</li>
 *   <li><b>纯加法 + 默认关闭</b> ✓：没开这个功能时，存档与玩法与现在**逐字一致** ✓
 *       （用户 2026-10-09 的教训：不许为了功能加"卡玩法"的硬机制 ✗）。</li>
 * </ol>
 */
public final class Leaderboard {

    private Leaderboard() {
    }

    /** 一次上鱼的成绩快照（服务端在上鱼那一刻造一个 ✓，之后只读 ✓）。 */
    public record Catch(
            UUID player,
            String playerName,
            String fishId,
            double weightKg,
            /** 体长（厘米 ✓）—— 与鱼物品/图鉴同一个口径（{@code FishData.lengthCm()}）✓，不是我另算的 ✗。 */
            double lengthCm,
            /** 尺寸评级的枚举名（{@code JUVENILE/NORMAL/QUALITY/EXCELLENT/RECORD} ✓，见 {@link #gradeRank}）。 */
            String grade,
            /** 这一场用了几回合（本模组独有 ✓，最长对抗榜用 ✓）。 */
            int rounds,
            /** 从咬钩到上鱼用了几 tick（最短上鱼榜用 ✓）。 */
            int ticks,
            /** 品质档 0..5（白绿蓝紫金红 ✓ —— ⚠ 仓库铁律：档位**0 起算** ✓）。 */
            int tier,
            /** 这一尾值多少鱼币（留给将来的价值榜 ✓；当前维度都不用 ✓，传 0 即可 ✓）。 */
            int value,
            long epochMs) {
    }

    /**
     * 榜单维度 ✓。
     *
     * <p>{@code perCatch} 区分两类 ✓：<b>单场纪录</b>（比大小、只留最好的一尾 ✓）
     * 与 <b>累计</b>（一直加 ✓）—— 因为"怎么更新"完全不同 ✓。
     */
    public enum Board {
        /** 单鱼最重（总榜）✓ 主榜。 */
        HEAVIEST("heaviest", "单鱼最重（总榜）", true, false),
        /** 单鱼最重（按鱼种各一条纪录）✓ 与图鉴"我的纪录"同源 ✓。 */
        HEAVIEST_BY_SPECIES("heaviest_by_species", "单鱼最重（按鱼种）", true, false),
        /** 尺寸评级纪录 ✓（照顾小鱼也能上榜 ✓）。 */
        BEST_GRADE("best_grade", "尺寸评级纪录", true, false),
        /** 总尾数 ✓。 */
        TOTAL_COUNT("total_count", "总尾数", false, false),
        /** 总重量 ✓。 */
        TOTAL_WEIGHT("total_weight", "总重量", false, false),
        /** 金红鱼尾数（tier ≥ 4 ✓ —— 4 金 / 5 红 ✓）。 */
        HIGH_TIER_COUNT("high_tier_count", "金红鱼尾数", false, false),
        /** 最长对抗回合数 ✓（本模组独有：遛鱼是特色 ✓）。 */
        LONGEST_FIGHT("longest_fight", "最长对抗回合数", true, false),
        /** 最短上鱼时间 ✓（与上一条互相"卷"✓ —— 唯一"越小越好"的 ✓）。 */
        FASTEST_CATCH("fastest_catch", "最短上鱼时间", true, true),
        /** 连续上鱼（连击 ✓ —— 断线/逃脱清零 ✓）。 */
        STREAK("streak", "连续上鱼（连击）", true, false),
        /** 图鉴完成度 ✓（由图鉴数据直接算 ✓，不走上鱼事件 ✓）。 */
        CODEX("codex", "图鉴完成度", false, false);

        private final String id;
        private final String cn;
        private final boolean perCatch;
        private final boolean lowerIsBetter;

        Board(String id, String cn, boolean perCatch, boolean lowerIsBetter) {
            this.id = id;
            this.cn = cn;
            this.perCatch = perCatch;
            this.lowerIsBetter = lowerIsBetter;
        }

        public String id() {
            return this.id;
        }

        public String cn() {
            return this.cn;
        }

        /** true = 单场纪录（比大小 ✓）；false = 累计值（一直加 ✓）。 */
        public boolean perCatch() {
            return this.perCatch;
        }

        public boolean lowerIsBetter() {
            return this.lowerIsBetter;
        }
    }

    /**
     * 新成绩 {@code candidate} 是否**优于**已有纪录 {@code incumbent} ✓。
     *
     * <p>这是整个排行榜唯一容易写错的地方 ✓（方向搞反 ⇒ 榜变倒数 ✗），所以单独拎出来 ✓，
     * 由离线检查器逐维度证伪 ✓。
     */
    public static boolean betterThan(Board board, double candidate, double incumbent) {
        return board.lowerIsBetter() ? candidate < incumbent : candidate > incumbent;
    }

    /** 从一次上鱼里，按维度取出它贡献的数值 ✓。 */
    public static double valueOf(Board board, Catch c) {
        return switch (board) {
            case HEAVIEST, HEAVIEST_BY_SPECIES, TOTAL_WEIGHT -> c.weightKg();
            case BEST_GRADE -> gradeRank(c.grade());
            case TOTAL_COUNT, STREAK -> 1.0;
            case HIGH_TIER_COUNT -> c.tier() >= 4 ? 1.0 : 0.0;      // 4 金 / 5 红 ✓（档位 0 起算 ✓）
            case LONGEST_FIGHT -> c.rounds();
            case FASTEST_CATCH -> c.ticks();
            case CODEX -> 0.0;                                        // 图鉴榜由图鉴数据直接算 ✓
        };
    }

    /**
     * 尺寸评级 → 可比较的序（**纪录级最高** ✓）。
     *
     * <p>⚠ 口径以 {@code FishData.SizeGrade} 为准 ✓：幼体 / 普通 / 优质 / 极品 / 纪录级 ✓
     * —— 这份名单是 2026-10-10 **去 FishData.java 核对过**的 ✓，不是猜的 ✗
     * （我第一版凭印象写成了"成体/亚成体"，是错的 ✗）。
     * 同时接受枚举常量名（{@code JUVENILE/NORMAL/QUALITY/EXCELLENT/RECORD} ✓），两边都认 ✓
     * —— {@code FishingSession} 那边传的就是枚举名 ✓。
     */
    public static double gradeRank(String grade) {
        if (grade == null) {
            return 0;
        }
        return switch (grade) {
            case "纪录级", "RECORD" -> 5;
            case "极品", "EXCELLENT" -> 4;
            case "优质", "QUALITY" -> 3;
            case "普通", "NORMAL" -> 2;
            case "幼体", "JUVENILE" -> 1;
            default -> 0;
        };
    }
}
