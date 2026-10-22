package com.whitecobalt.anglertackle.league;

import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.leaderboard.Leaderboard;
import com.whitecobalt.anglertackle.player.MailEntry;
import com.whitecobalt.anglertackle.registry.ModItems;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * 联赛的**纯逻辑地基**（用户 2026-10-11 定案，策划见 `docs/37`）。
 *
 * <p>这里只放"算得出来"的东西：级别、计分口径、**三级并列键**、奖励表、窗口数学。
 * 一个字段都不落盘、也不碰任何玩家数据 —— 那些在 {@link LeagueData} 与 {@link LeagueService} ✓。
 *
 * <h2>三条硬约束（改这个包的人必须守住）</h2>
 * <ol>
 *   <li><b>计分口径只有一份</b>：{@code rule} 映射到 {@link Leaderboard.Board}，
 *       数值一律由 {@link Leaderboard#valueOf} 取 —— **绝不为联赛另写一遍"怎么算成绩"** ✗。
 *       两份口径迟早分叉（本仓库在"档位 0 起算 / 1 起算"上已经栽过两次）；</li>
 *   <li><b>排除可刷的两项</b>：{@code fastest_catch}（最短上鱼）与 {@code streak}（连击）
 *       **不许进联赛计分**（`docs/37` §2 据调研改：这两项极易被脚本刷）；</li>
 *   <li><b>并列键三级、逐级比较</b>：成绩 → **先达成者排前** → UUID 字典序。
 *       ⚠ 照抄原版记分板的"同分按名字字母序"是不行的：玩家**可以改名**
 *       ⇒ 奖励边界上的名次会变成可操纵的（`docs/37` §5.3.4）✗。</li>
 * </ol>
 */
public final class League {

    private League() {
    }

    /** 1 游戏日 = 24000 tick（原版一天 = 20 分钟）—— 换算写进注释，别在代码里散落魔数。 */
    public static final long TICKS_PER_DAY = 24000L;
    /** 1 游戏分钟 = 1200 tick。 */
    public static final long TICKS_PER_MINUTE = 1200L;

    /**
     * 邀请资格线：钓鱼等级 **≥ 21**（用户原话"高于 20"）。
     *
     * <p>⚠ 21 不是随手写的：它正好是**通过了 Lv.20 评定②**的下一个等级
     * （{@code AnglerLeveling.GATE_LEVELS = {10, 20, 30, 40}}），
     * 所以"够格参加联赛"与"过了第二道评定"是同一件事 ✓。
     */
    public static final int MIN_LEVEL = 21;

    // ---------------------------------------------------------------- 级别
    /**
     * 三个级别 = **推送间隔**（资格相同、奖励倍率不同）。
     *
     * <p>默认**轮转**（同一时刻只开一级）——`docs/37` §2.1 据调研改：
     * 分级就是分割人口，人少的服切成三份会进入"离场级联"。
     */
    public enum Tier {
        SMALL("small"),
        MEDIUM("medium"),
        LARGE("large");

        private final String id;

        Tier(String id) {
            this.id = id;
        }

        public String id() {
            return this.id;
        }

        /** 推送间隔（按当前口径的"天"）—— 配置可热改。 */
        public int days() {
            return switch (this) {
                case SMALL -> Math.max(1, Tuning.leagueSmallDays());
                case MEDIUM -> Math.max(1, Tuning.leagueMediumDays());
                case LARGE -> Math.max(1, Tuning.leagueLargeDays());
            };
        }

        /** 鱼币与经验的倍率（小 ×1 / 中 ×2 / 大 ×4）。 */
        public double scaleCoinsXp() {
            return switch (this) {
                case SMALL -> 1.0;
                case MEDIUM -> Math.max(1.0, Tuning.leagueScaleMediumCoinsXp());
                case LARGE -> Math.max(1.0, Tuning.leagueScaleLargeCoinsXp());
            };
        }

        /** **原版物资**的倍率（小 1 / 中 1 / 大 ×1.5；模组物品不缩放）。 */
        public double scaleVanilla() {
            return switch (this) {
                case SMALL, MEDIUM -> 1.0;
                case LARGE -> Math.max(1.0, Tuning.leagueScaleLargeVanillaItems());
            };
        }

        public static Tier byId(String id) {
            for (Tier t : values()) {
                if (t.id.equalsIgnoreCase(id)) {
                    return t;
                }
            }
            return SMALL;
        }
    }

    // ---------------------------------------------------------------- 计分口径
    /**
     * 联赛的计分口径 —— **每一个都映射到已有的 {@link Leaderboard.Board}**。
     *
     * <p>⚠ {@code FASTEST_CATCH} 与 {@code STREAK} **故意不在表里**（可刷，`docs/37` §2）。
     */
    public enum Rule {
        HEAVIEST("heaviest", Leaderboard.Board.HEAVIEST),
        TOTAL_WEIGHT("total_weight", Leaderboard.Board.TOTAL_WEIGHT),
        HIGH_TIER_COUNT("high_tier_count", Leaderboard.Board.HIGH_TIER_COUNT),
        CODEX("codex", Leaderboard.Board.CODEX);

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

        /** 累计型（一直往上加）还是单场型（只留最好的一尾）。 */
        public boolean cumulative() {
            return !this.board.perCatch();
        }

        public static Rule byId(String id) {
            for (Rule r : values()) {
                if (r.id.equalsIgnoreCase(id)) {
                    return r;
                }
            }
            return HEAVIEST;
        }

        /**
         * 配置下标 → 口径（`docs/37` §6 的 {@code ruleMode}：0/1/2/3）。
         *
         * <p>⚠ 按下标取 ⇒ **枚举顺序就是配置顺序**，改一处必须改另一处；
         * 守着这条的是 {@code tools/check-league.js}（它把两个顺序逐条对账）。
         */
        public static Rule byMode(int mode) {
            Rule[] v = values();
            return v[Math.max(0, Math.min(v.length - 1, mode))];
        }
    }

    // ---------------------------------------------------------------- 成绩与排序
    /**
     * 一位参赛者的本期成绩。
     *
     * @param value   主指标（含义随 {@link Rule}；口径与排行榜逐字相同）
     * @param atTick  **这个成绩是何时达成的**（累计刻）—— 并列时的第二级键
     * @param catches 本期窗口内上鱼尾数（有效成绩下限用它：0 尾不进榜、没有名次奖）
     */
    public record Entry(UUID player, String name, double value, long atTick, int catches) {
    }

    /**
     * **三级并列键**（`docs/37` §5.3.4）：成绩 → 先达成者 → UUID 字典序。
     *
     * <p>为什么第二级是"先后"而不是"名字"：名字**可以改**，
     * 而"谁先钓到"是当时就写进存档的事实 ✓；第三级用 UUID 兜底（改不了、全局唯一）✓。
     */
    public static final Comparator<Entry> ORDER = (a, b) -> {
        int byValue = Double.compare(b.value(), a.value());     // 越大越前
        if (byValue != 0) {
            return byValue;
        }
        int byTime = Long.compare(a.atTick(), b.atTick());      // 越早越前
        if (byTime != 0) {
            return byTime;
        }
        return a.player().compareTo(b.player());                // UUID 字典序（不可改）
    };

    // ---------------------------------------------------------------- 奖励
    /** 一份奖励（金币 / 经验 / 物品）。 */
    public record Reward(long coins, int xp, List<ItemStack> items) {
    }

    /** 名次档：1 / 2 / 3 / 4~10 / 参与（≥11）。 */
    public static final int TOP_RANK = 3;
    public static final int TOP10_RANK = 10;

    /**
     * 名次 → 结算奖励（`docs/37` §5.3.2 的小型基准，再按级别缩放 §5.3.3）。
     *
     * @param rank 名次，从 1 起；{@code 0} = 参赛但没进前十（参与奖）
     */
    public static Reward rewardFor(int rank, Tier tier) {
        double cx = tier.scaleCoinsXp();
        double v = tier.scaleVanilla();
        long coins;
        int xp;
        List<ItemStack> items = new ArrayList<>();
        switch (rank) {
            case 1 -> {
                coins = Tuning.leagueRewardCoins1st();
                xp = Tuning.leagueRewardXp1st();
                items.add(new ItemStack(ModItems.TITANIUM_LINE.get()));
                items.add(new ItemStack(ModItems.LURE_GILDED.get()));
                addVanilla(items, Items.DIAMOND, 8, v);
                addVanilla(items, Items.NETHERITE_INGOT, 2, v);
            }
            case 2 -> {
                coins = Tuning.leagueRewardCoins2nd();
                xp = Tuning.leagueRewardXp2nd();
                items.add(new ItemStack(ModItems.PE_LINE.get()));
                items.add(new ItemStack(ModItems.LURE_GILDED.get()));
                addVanilla(items, Items.DIAMOND, 6, v);
            }
            case 3 -> {
                coins = Tuning.leagueRewardCoins3rd();
                xp = Tuning.leagueRewardXp3rd();
                items.add(new ItemStack(ModItems.FLUORO_LINE.get()));
                items.add(new ItemStack(ModItems.LURE_RATTLE.get()));
                addVanilla(items, Items.DIAMOND, 2, v);
            }
            default -> {
                // 4~10 名 2000；参与奖（0）500 —— 两者都跟着 ×2 / ×4 缩放（`docs/37` §5.3.3）
                coins = rank >= 4 && rank <= TOP10_RANK
                        ? Tuning.leagueRewardCoinsTop10() : Tuning.leagueRewardCoinsParticipant();
                xp = 0;
            }
        }
        return new Reward(Math.round(coins * cx), (int) Math.round(xp * cx), List.copyOf(items));
    }

    /** 原版物资按倍率缩放（×1.5 在 §5.3.3 的三张表里全部整除，取整不会出现半颗钻石）。 */
    private static void addVanilla(List<ItemStack> out, net.minecraft.world.item.Item item,
                                   int baseCount, double scale) {
        out.add(new ItemStack(item, Math.max(1, (int) Math.round(baseCount * scale))));
    }

    /**
     * 签收礼（点【签收】即得；三级各不相同，`docs/37` §5.3.1）。
     *
     * <p>⚠ **签收礼不参与缩放**（`docs/37` §5.3.3 第 3 条）：大型签收礼里有"钻石 ×1"，
     * ×1.5 会变成 1.5 个 ✗。要让签收礼随级别提升就**直接改数字**。
     *
     * <p>⚠ 物品格数**必须 ≤ {@link MailEntry#MAX_ATTACHMENT_SLOTS}**：
     * {@code MailService.send} 会把超出的部分截掉（那是"界面只有 4 格"的兜底），
     * 而联赛的签收礼被截掉一件就是**玩家少了东西却没有任何提示** ✗
     * —— 守着这条的是 {@code tools/check-league.js}。
     *
     * @param pick 随机源（小型联赛的"紫档拟饵 ×1"是**两款里随机**，`docs/37` §5.3.1）
     */
    public static Invite inviteGift(Tier tier, net.minecraft.util.RandomSource pick) {
        List<ItemStack> items = new ArrayList<>();
        long coins;
        switch (tier) {
            case SMALL -> {
                items.add(new ItemStack(pick.nextBoolean()
                        ? ModItems.LURE_DEEP.get() : ModItems.LURE_PADDLETAIL.get()));
                items.add(new ItemStack(ModItems.CHUM_FRUIT.get(), 3));
                items.add(new ItemStack(Items.BREAD, 16));
                coins = 500;
            }
            case MEDIUM -> {
                items.add(new ItemStack(ModItems.FLUORO_LINE.get()));
                items.add(new ItemStack(ModItems.CHUM_FRUIT.get(), 3));
                items.add(new ItemStack(Items.BREAD, 16));
                items.add(new ItemStack(Items.IRON_INGOT, 4));
                coins = 1000;
            }
            default -> {
                items.add(new ItemStack(ModItems.PE_LINE.get()));
                items.add(new ItemStack(ModItems.CHUM_SECRET.get(), 5));
                items.add(new ItemStack(Items.DIAMOND, 1));
                coins = 1600;
            }
        }
        return new Invite(coins, List.copyOf(items));
    }

    /** 签收礼（鱼币 + 物品）。 */
    public record Invite(long coins, List<ItemStack> items) {
    }

    // ---------------------------------------------------------------- 窗口
    /**
     * 每人的窗口终点 = {@code min(签收刻 + 窗口时长, 全局硬截止)} —— **两处都取**（`docs/37` §3.4）。
     *
     * <p>只算"签收 + 30 分钟"的话，第 90 分钟签收的人会越过硬截止 ✗；
     * 只算硬截止的话，"每人独立的 30 分钟"就不存在了 ✗。用户原话：
     * "**无论有没有打满，联赛结算时也强行截止**"。
     *
     * <p>⚠ 窗口时长由**开期时钉死**（存在 {@link LeagueData} 里），不在这里现读配置 ——
     * 否则一期中途改配置，先签收的人和新签收的人会用两套规则（`docs/37` §7）。
     */
    public static long windowEnd(long signTick, long windowTicks, long hardDeadlineTick) {
        return Math.min(signTick + Math.max(1L, windowTicks), hardDeadlineTick);
    }

    /** 窗口时长（游戏刻）= 配置的"游戏分钟" × 1200。开期时算一次并钉死。 */
    public static long windowTicks() {
        return Math.max(1L, Tuning.leaguePlayerWindowMinutes()) * TICKS_PER_MINUTE;
    }

    /** 一期硬截止 = 推送刻 + `periodGameDays` 游戏日（**游戏时间**，与口径无关）。 */
    public static long hardDeadline(long pushTick) {
        return pushTick + Math.max(1, Tuning.leaguePeriodGameDays()) * TICKS_PER_DAY;
    }

    /** 够不够资格（等级 ≥ 配置线；默认 21 = 过了 Lv.20 评定②）。 */
    public static boolean qualifies(int level) {
        return level >= Tuning.leagueMinLevel();
    }

    /**
     * 现实口径下的**下一个期界**：从 {@code wallMillis} 往后找最近的"本地 {@code hour} 点"
     * （学 LoL 的"各服本地 12:00:00"，`docs/37` §3.2 坑 6）。
     *
     * <p>为什么要对齐钟点：期与期的边界落在同一个时刻上，玩家能自己算出下一期什么时候开；
     * 而"从第一次开服那一刻算 7 天"会得到一个谁都记不住的时刻 ✗。
     */
    public static long nextBoundary(long wallMillis, int hour) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.setTimeInMillis(wallMillis);
        cal.set(java.util.Calendar.HOUR_OF_DAY, Math.max(0, Math.min(23, hour)));
        cal.set(java.util.Calendar.MINUTE, 0);
        cal.set(java.util.Calendar.SECOND, 0);
        cal.set(java.util.Calendar.MILLISECOND, 0);
        long at = cal.getTimeInMillis();
        return at <= wallMillis ? at + 24L * 60L * 60L * 1000L : at;
    }

    /** 一条成绩是否值得写进"本期最好成绩"（单场型比大小、累计型一直加）。 */
    public static boolean improves(Rule rule, double candidate, double incumbent) {
        return Leaderboard.betterThan(rule.board(), candidate, incumbent);
    }
}
