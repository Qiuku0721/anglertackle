package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import java.util.HashMap;
import java.util.Map;

/**
 * 玩家的**委托进度**（老柯的每日 / 周常任务；策划 `docs/40`，用户 2026-10-14 定案）。
 *
 * <h2>为什么单开一个附件</h2>
 * 与 {@link MailBox} / {@link PlayerTitles} 同一条理由：{@link PlayerFishingData} 的构造点太多，
 * 而委托是**会不断增删的表**；单开附件之后老存档读进来就是 {@link #EMPTY}（**零迁移** ✓），
 * `copyOnDeath` ⇒ 死一次不会把委托进度清空 ✓。
 *
 * <h2>四个"位"，各有一条纪律</h2>
 * <ul>
 *   <li>{@code lastDailyDay} / {@code lastWeeklyWeek} —— **刷新的幂等位**：值等于
 *       {@code QuestService} 算出来的当前日 / 周序号时，说明这一天（周）已经发过委托了，
 *       绝不再发第二份 ✓（反复触发同一天的日界也不会重复发）；</li>
 *   <li>{@code active} —— 已接取的委托：id → 进度行。**跨日 / 跨周清空**（过期的委托不保留，
 *       见 `docs/40` §6 边界 2）；</li>
 *   <li>{@code activityWeek} + {@code activity} + {@code claimedTiers} —— 活跃度与**已领档位位掩码**
 *       （25/50/75/100 各一位，`claimedTiers` 挡住重复发奖）✓；</li>
 *   <li>{@code totalCompleted} —— 累计完成数（成就 / 称号要用的统计，派生不出来只能存）。</li>
 * </ul>
 *
 * <h2>⚠ 不存的部分</h2>
 * "今天还剩多久""有没有可接的委托"这类**都能从日序号 + {@code active} 现算**，
 * 一律不存 —— 本仓库"两套刻度"那两次事故就是"两个真源、数不对但不报错" ✗。
 *
 * @param lastDailyDay    上次发到"每日委托"的**游戏日序号**（`docs/40` §3：`getDayTime() / 24000`）
 * @param lastWeeklyWeek  上次发到"周常"的**游戏周序号**（`day / 7`）
 * @param active          已接取的委托（id → 进度行）
 * @param activityWeek    活跃度所属周序号（跨周要清零）
 * @param activity        本周活跃度（上限由 `Tuning.questActivityCapWeekly()` 管）
 * @param claimedTiers    已领过的活跃度档位**位掩码**（bit0=25 / bit1=50 / bit2=75 / bit3=100）
 * @param totalCompleted  累计完成数
 */
public record QuestData(
        long lastDailyDay,
        long lastWeeklyWeek,
        Map<String, Row> active,
        long activityWeek,
        int activity,
        int claimedTiers,
        int totalCompleted) {

    /**
     * 一条已接取委托的进度行。
     *
     * @param progress  当前进度（**单位由 Goal 决定**，见 {@code QuestGoal}：条数 / 重量×100 / 已集齐种数…）
     * @param claimed   这条委托的**奖励寄出去了没有**（与 {@link MailEntry#claimed()} 同一条纪律：
     *                  "完成了" ≠ "领过了"）
     * @param collected 已钓到的鱼种 id（**逗号分隔**；只有"集齐 / 若干种不同鱼"这类目标用得上，
     *                  别的目标恒为空串）。这是"不同鱼种"**唯一**的记账处 ——
     *                  用集合而不是数字，是因为"3 种不同的鱼"数不出来：同一种钓三次也算三种 ✗
     */
    public record Row(int progress, boolean claimed, String collected) {

        /** 只给条数 / 重量类目标用的简写。 */
        public Row(int progress, boolean claimed) {
            this(progress, claimed, "");
        }

        public static final Codec<Row> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                Codec.INT.optionalFieldOf("progress", 0).forGetter(Row::progress),
                Codec.BOOL.optionalFieldOf("claimed", false).forGetter(Row::claimed),
                // ⚠ optionalFieldOf：加这个字段之前存下的行没有 "collected" 键，用 fieldOf 会读不进来
                Codec.STRING.optionalFieldOf("collected", "").forGetter(Row::collected)
        ).apply(inst, Row::new));

        /** 改进度（**保留** claimed 与 collected）。 */
        public Row withProgress(int value) {
            return value == progress ? this : new Row(value, claimed, collected);
        }

        /** 改"已钓到的鱼种"（**保留** progress 由调用方自己算好传入）。 */
        public Row withCollected(String value) {
            String v = value == null ? "" : value;
            return v.equals(collected) ? this : new Row(progress, claimed, v);
        }

        /** 标记奖励已寄出。 */
        public Row withClaimed() {
            return claimed ? this : new Row(progress, true, collected);
        }
    }

    /** 新玩家 / 老存档：什么都没有、没接过任何委托。 */
    public static final QuestData EMPTY = new QuestData(0L, 0L, Map.of(), 0L, 0, 0, 0);

    public static final Codec<QuestData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            // ⚠ 一律 optionalFieldOf：老存档里根本没有这些键，用 fieldOf 会让整份数据读不进来
            Codec.LONG.optionalFieldOf("last_daily_day", 0L).forGetter(QuestData::lastDailyDay),
            Codec.LONG.optionalFieldOf("last_weekly_week", 0L).forGetter(QuestData::lastWeeklyWeek),
            Codec.unboundedMap(Codec.STRING, Row.CODEC).optionalFieldOf("active", Map.of())
                    .forGetter(QuestData::active),
            Codec.LONG.optionalFieldOf("activity_week", 0L).forGetter(QuestData::activityWeek),
            Codec.INT.optionalFieldOf("activity", 0).forGetter(QuestData::activity),
            Codec.INT.optionalFieldOf("claimed_tiers", 0).forGetter(QuestData::claimedTiers),
            Codec.INT.optionalFieldOf("total_completed", 0).forGetter(QuestData::totalCompleted)
    ).apply(inst, QuestData::new));

    // ---------------------------------------------------------------- 派生查询
    /** 接过这条委托没有。 */
    public boolean hasActive(String id) {
        return id != null && active.containsKey(id);
    }

    /** 已接取条数（**派生值**，不存）。 */
    public int activeCount() {
        return active.size();
    }

    /** 某条委托的进度行（没接返回 null）。 */
    public Row rowOf(String id) {
        return id == null ? null : active.get(id);
    }

    /** 某条委托的当前进度（没接 = 0）。 */
    public int progressOf(String id) {
        Row r = rowOf(id);
        return r == null ? 0 : r.progress();
    }

    /** 某条委托达标了没有（由调用方传入达标线，本类不认识任务定义）。 */
    public boolean reached(String id, int target) {
        return progressOf(id) >= target;
    }

    // ---------------------------------------------------------------- 写入（全是不变式记录，返回新对象）
    /** 接取一条委托（已有就原样返回，**幂等** ✓）。 */
    public QuestData withActive(String id) {
        if (id == null || id.isEmpty() || active.containsKey(id)) {
            return this;
        }
        Map<String, Row> next = new HashMap<>(active);
        next.put(id, new Row(0, false));
        return new QuestData(lastDailyDay, lastWeeklyWeek, Map.copyOf(next),
                activityWeek, activity, claimedTiers, totalCompleted);
    }

    /** 把某条委托的进度**写成**某个值；没接过就原样返回（绝不为不存在的委托建行）。 */
    public QuestData withProgress(String id, int value) {
        Row r = rowOf(id);
        return r == null ? this : withRow(id, r.withProgress(value));
    }

    /** 把某条委托标记成"奖励已寄出"。 */
    public QuestData withRowClaimed(String id) {
        Row r = rowOf(id);
        return r == null ? this : withRow(id, r.withClaimed());
    }

    /**
     * 换掉某条委托的整行（**唯一的写入口** —— 进度 / 集齐 / 置位都走它，
     * 免得每一处各写一遍 `new Row(...)`，漏掉一个字段就悄悄丢掉进度）✓。
     *
     * <p>没接过这条委托 ⇒ 原样返回（绝不为不存在的委托建行）。
     */
    public QuestData withRow(String id, Row row) {
        Row r = rowOf(id);
        if (r == null || row == null || r.equals(row)) {
            return this;
        }
        Map<String, Row> next = new HashMap<>(active);
        next.put(id, row);
        return new QuestData(lastDailyDay, lastWeeklyWeek, Map.copyOf(next),
                activityWeek, activity, claimedTiers, totalCompleted);
    }

    /**
     * 移除**一条**已接委托（跨日清"每日"、跨周清"周常"用它 ——
     * 两类委托共用 {@code active} 这张表，所以不能整表清 ✗）。
     */
    public QuestData withoutActive(String id) {
        if (id == null || !active.containsKey(id)) {
            return this;
        }
        Map<String, Row> next = new HashMap<>(active);
        next.remove(id);
        return new QuestData(lastDailyDay, lastWeeklyWeek, Map.copyOf(next),
                activityWeek, activity, claimedTiers, totalCompleted);
    }

    /** 清空全部已接委托（**整表清**；只该在"两类都过期"时用，平时用 {@link #withoutActive}）。 */
    public QuestData withActiveCleared() {
        return active.isEmpty() ? this
                : new QuestData(lastDailyDay, lastWeeklyWeek, Map.of(),
                activityWeek, activity, claimedTiers, totalCompleted);
    }

    /** 记下"这一天已经发过委托了"（幂等位）。 */
    public QuestData withDay(long day) {
        return day == lastDailyDay ? this
                : new QuestData(day, lastWeeklyWeek, active, activityWeek, activity, claimedTiers, totalCompleted);
    }

    /** 记下"这一周已经发过周常了"（幂等位）。 */
    public QuestData withWeek(long week) {
        return week == lastWeeklyWeek ? this
                : new QuestData(lastDailyDay, week, active, activityWeek, activity, claimedTiers, totalCompleted);
    }

    /**
     * 把活跃度对齐到某一周：**跨周自动清零**（含已领档位）✓。
     *
     * <p>这是活跃度唯一的"重置点"—— 别在别处再写一遍清零逻辑（两份迟早不一致 ✗）。
     */
    public QuestData withActivityWeek(long week) {
        if (week == activityWeek) {
            return this;
        }
        return new QuestData(lastDailyDay, lastWeeklyWeek, active, week, 0, 0, totalCompleted);
    }

    /** 活跃度 +delta（由调用方保证 cap 与 week 已对齐；负数会被夹成 0）。 */
    public QuestData withActivityAdded(int delta, int cap) {
        if (delta <= 0) {
            return this;
        }
        int next = Math.min(Math.max(0, cap), activity + delta);
        return next == activity ? this
                : new QuestData(lastDailyDay, lastWeeklyWeek, active, activityWeek, next, claimedTiers, totalCompleted);
    }

    /** 某个活跃度档位（bit 0~3）领过没有。 */
    public boolean tierClaimed(int bit) {
        return (claimedTiers & (1 << bit)) != 0;
    }

    /** 标记某个活跃度档位已领（**幂等**：领过就原样返回）。 */
    public QuestData withTierClaimed(int bit) {
        int mask = claimedTiers | (1 << bit);
        return mask == claimedTiers ? this
                : new QuestData(lastDailyDay, lastWeeklyWeek, active, activityWeek, activity, mask, totalCompleted);
    }

    /** 累计完成数 +delta。 */
    public QuestData withCompleted(int delta) {
        if (delta <= 0) {
            return this;
        }
        return new QuestData(lastDailyDay, lastWeeklyWeek, active, activityWeek, activity, claimedTiers,
                totalCompleted + delta);
    }
}
