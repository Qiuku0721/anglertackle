package com.whitecobalt.anglertackle.quest;

import net.minecraft.util.RandomSource;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * **委托池**（老柯的每日 / 周常；策划 `docs/40` §4）。
 *
 * <h2>两条硬约束（`tools/check-quest.js` 守着）</h2>
 * <ol>
 *   <li><b>池子条目数 ≥ 8</b>（用户 2026-10-14："每日任务和周常各自的种类数不低于 8"）——
 *       同时**可接 5 个**、池子**≥8 种**，抽出来才有随机感 ✓；</li>
 *   <li><b>周常不出现红档**（用户第 4c 条）** —— 玩家很可能等级没上来、连钻石竿都没有，
 *       所以周常的难度上限压在"金色"，且金色走 {@code weekly_gold_special}（奖励更高的挑战档）✓。</li>
 * </ol>
 *
 * <h2>这里的表是"唯一真源"</h2>
 * 加一条委托 = 往 {@link #DAILY} / {@link #WEEKLY} 里加一行 + 补语言键（中英成对）✓。
 * 别在别处再抄一份目标值（两份迟早不一致 ✗）。
 */
public final class QuestPool {

    private QuestPool() {
    }

    // ---------------------------------------------------------------- 每日（13 条 ≥ 8 ✓）
    /** 每日委托池：**轻松能完成**（用户："每日就是要轻松能完成"）。 */
    public static final List<QuestDef> DAILY = List.of(
            new QuestDef("daily_any_3", QuestDef.Period.DAILY, QuestDef.Goal.GET_COUNT,
                    List.of("3"), 30L, "", 0, 1, 10),
            new QuestDef("daily_any_5", QuestDef.Period.DAILY, QuestDef.Goal.GET_COUNT,
                    List.of("5"), 40L, "", 0, 1, 10),
            // 「指定一种常见鱼」：只挑**跨水体可重复出现**的普通鱼（用户第 4c 条原话）
            new QuestDef("daily_species_crucian", QuestDef.Period.DAILY, QuestDef.Goal.GET_SPECIES,
                    List.of("crucian_carp", "1"), 35L, "", 0, 1, 8),
            new QuestDef("daily_species_tilapia", QuestDef.Period.DAILY, QuestDef.Goal.GET_SPECIES,
                    List.of("tilapia", "1"), 35L, "", 0, 1, 8),
            new QuestDef("daily_species_mullet", QuestDef.Period.DAILY, QuestDef.Goal.GET_SPECIES,
                    List.of("mullet", "1"), 35L, "", 0, 1, 8),
            new QuestDef("daily_weight_sum", QuestDef.Period.DAILY, QuestDef.Goal.GET_WEIGHT_SUM,
                    List.of("3.0"), 40L, "", 0, 1, 8),
            new QuestDef("daily_biggest", QuestDef.Period.DAILY, QuestDef.Goal.GET_BIGGEST,
                    List.of("1.5"), 40L, "", 0, 1, 8),
            new QuestDef("daily_longest", QuestDef.Period.DAILY, QuestDef.Goal.GET_LONGEST,
                    List.of("45"), 35L, "", 0, 1, 8),
            new QuestDef("daily_tier_green", QuestDef.Period.DAILY, QuestDef.Goal.GET_TIER_COUNT,
                    List.of("1", "2"), 45L, "", 0, 1, 8),
            // 蓝色以上：等级分层（`docs/40` §17.4）——11 级起才有
            new QuestDef("daily_tier_blue", QuestDef.Period.DAILY, QuestDef.Goal.GET_TIER_COUNT,
                    List.of("2", "1"), 55L, "", 0, 11, 6),
            new QuestDef("daily_rod_float", QuestDef.Period.DAILY, QuestDef.Goal.GET_ROD_TYPE,
                    List.of("float", "2"), 35L, "", 0, 1, 8),
            new QuestDef("daily_rod_lure", QuestDef.Period.DAILY, QuestDef.Goal.GET_ROD_TYPE,
                    List.of("lure", "1"), 40L, "", 0, 1, 8),
            new QuestDef("daily_variety", QuestDef.Period.DAILY, QuestDef.Goal.GET_VARIETY,
                    List.of("2"), 45L, "", 0, 6, 6));

    // ---------------------------------------------------------------- 周常（9 条 ≥ 8 ✓）
    /** 周常委托池：**有一定挑战性**，但**上限压在金色、绝不出红档**（用户第 4c 条）。 */
    public static final List<QuestDef> WEEKLY = List.of(
            new QuestDef("weekly_any_25", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_COUNT,
                    List.of("25"), 150L, "", 0, 11, 10),
            new QuestDef("weekly_biggest", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_BIGGEST,
                    List.of("5.0"), 180L, "", 0, 11, 8),
            new QuestDef("weekly_weight_sum", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_WEIGHT_SUM,
                    List.of("30.0"), 160L, "", 0, 11, 8),
            new QuestDef("weekly_species_set", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_SPECIES_SET,
                    List.of("crucian_carp", "tilapia", "mullet"), 190L, "", 0, 11, 6),
            new QuestDef("weekly_rod_both", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_ROD_TYPE,
                    List.of("both", "5"), 170L, "", 0, 11, 8),
            new QuestDef("weekly_longest", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_LONGEST,
                    List.of("120"), 170L, "", 0, 21, 6),
            new QuestDef("weekly_tier_purple", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_TIER_COUNT,
                    List.of("3", "5"), 200L, "", 0, 21, 6),
            // 金色：**高难档**（3 条）—— 比下面的"1 条"更难，所以奖励也更高 ✓（修正反直觉）
            new QuestDef("weekly_tier_gold", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_TIER_COUNT,
                    List.of("4", "3"), 260L, "", 0, 31, 4),
            // ★ 特殊挑战：1 条金色（难度低于"3 条"，奖励相应低于它 —— 金色是**阶梯**而非唯一双倍）
            new QuestDef("weekly_gold_special", QuestDef.Period.WEEKLY, QuestDef.Goal.GET_TIER_COUNT,
                    List.of("4", "1"), 300L, "", 0, 31, 3));

    /** 某个周期的全部定义。 */
    public static List<QuestDef> forPeriod(QuestDef.Period period) {
        return period == QuestDef.Period.WEEKLY ? WEEKLY : DAILY;
    }

    /** 两个池合起来的全部定义（校验 / 查 id 用）。 */
    public static List<QuestDef> all() {
        List<QuestDef> out = new ArrayList<>(DAILY.size() + WEEKLY.size());
        out.addAll(DAILY);
        out.addAll(WEEKLY);
        return List.copyOf(out);
    }

    /** 按 id 找定义（找不到返回 null）。 */
    public static QuestDef byId(String id) {
        if (id == null || id.isEmpty()) {
            return null;
        }
        for (QuestDef d : all()) {
            if (d.id().equals(id)) {
                return d;
            }
        }
        return null;
    }

    /** 池子条目数（check-quest.js 断言它 ≥ 8）。 */
    public static int size(QuestDef.Period period) {
        return forPeriod(period).size();
    }

    /**
     * 抽 {@code count} 条委托（按等级过滤 + 权重加权，**不重复**）。
     *
     * <p>三条纪律：
     * <ol>
     *   <li>先按 {@code minLevel} 过滤 ⇒ 低等级抽不到高难（用户第 4c 条："玩家很可能等级没上来"）；</li>
     *   <li>抽出的条数**不超过可用条目数**（池子被等级滤小的时候不会返回 null）；</li>
     *   <li>**允许目标类型重复**（用户第 1 条："不限种类"）—— 只保证 id 不重复 ✓。</li>
     * </ol>
     *
     * @param period 周期
     * @param level  玩家等级（垂纶等级 1–50）
     * @param count  想要几条
     * @param rnd    随机源（服务端世界随机 / 可注入固定种子做测试）
     */
    public static List<QuestDef> draw(QuestDef.Period period, int level, int count, RandomSource rnd) {
        List<QuestDef> pool = new ArrayList<>();
        for (QuestDef d : forPeriod(period)) {
            if (level >= d.minLevel()) {
                pool.add(d);
            }
        }
        List<QuestDef> out = new ArrayList<>();
        int want = Math.min(Math.max(0, count), pool.size());
        for (int i = 0; i < want; i++) {
            int total = 0;
            for (QuestDef d : pool) {
                total += Math.max(1, d.weight());
            }
            int roll = rnd.nextInt(Math.max(1, total));
            int acc = 0;
            int hit = pool.size() - 1;
            for (int k = 0; k < pool.size(); k++) {
                acc += Math.max(1, pool.get(k).weight());
                if (roll < acc) {
                    hit = k;
                    break;
                }
            }
            out.add(pool.remove(hit));
        }
        return List.copyOf(out);
    }

    /** 找一条定义的周期（用于"这条委托过期了吗"的判断）。 */
    public static Optional<QuestDef.Period> periodOf(String id) {
        QuestDef d = byId(id);
        return d == null ? Optional.empty() : Optional.of(d.period());
    }
}
