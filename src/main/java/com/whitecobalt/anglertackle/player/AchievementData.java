package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import java.util.List;
import java.util.Set;

/**
 * 玩家的**成就**数据（策划 `docs/41` §7 阶段 A1；用户 2026-10-15 选定实现路线 C 混合）。
 *
 * <h2>为什么单开一个附件</h2>
 * 与 {@link PlayerTitles} / {@link QuestData} 是同一条理由：`PlayerFishingData` 的构造点太多，
 * 往里塞字段就是"改一处忘一处"。单开附件以后，老存档读进来直接是 {@link #EMPTY}
 * （Codec 全用 `optionalFieldOf`）⇒ **一行迁移都不用写** ✓。
 *
 * <h2>为什么只有 `unlocked` 一个字段</h2>
 * 成就是"**一次性里程碑**"（`docs/41` §1）：达成即永久点亮，**没有进度要存** ——
 * 进度当场从现有数据算（图鉴完成度、等级、巨物纪录、联赛名次…），再存一份就是两份真源，
 * 迟早"成就说达成了、图鉴说没有" ✗（这条纪律与 `PlayerTitles.progress` 的注释同源：
 * **只存"算不出来"的东西**）。所以这里只存"哪些已经点亮"。
 *
 * <p>奖励（+25 鱼币 / +20 经验 × 倍率）**不在这里**：鱼币与经验本来就各有归宿
 * （`PlayerFishingData` / `AnglerLeveling`），奖励只走**邮件**（`docs/36`）与既有系统 ✓。
 *
 * <h2>幂等</h2>
 * {@code unlocked} 是**集合**（不是 List）：重复点亮同一个成就不会让它变大，
 * 这正是"达成那一刻"被重复触发时不会重复发奖的第一道保障；
 * 第二道在服务端唯一结算点（A1 骨架）里：先查 {@link #has} 再发信。
 *
 * <h2>永久性</h2>
 * {@code copyOnDeath()} 在 {@code ModAttachments} 里注册 ⇒ 死一次不会丢
 * （与称号、委托同一条口径："绝不动玩家的永久数据"）。
 */
public record AchievementData(
        /** 已点亮的成就 id（集合）。 */
        Set<String> unlocked) {

    /** 新玩家的默认值：一个都没点亮。 */
    public static final AchievementData EMPTY = new AchievementData(Set.of());

    /** 集合 ↔ 列表的编解码（与 `PlayerTitles.OWNED_CODEC` 同一写法）。 */
    private static final Codec<Set<String>> UNLOCKED_CODEC =
            Codec.STRING.listOf().xmap(Set::copyOf, List::copyOf);

    public static final Codec<AchievementData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            // ⚠ 一律 optionalFieldOf：老存档里根本没有这个键，用 fieldOf 会让整份数据读不进来
            UNLOCKED_CODEC.optionalFieldOf("unlocked", Set.of()).forGetter(AchievementData::unlocked)
    ).apply(inst, AchievementData::new));

    /** 这个成就有没有点亮。 */
    public boolean has(String id) {
        return id != null && !id.isEmpty() && unlocked.contains(id);
    }

    /** 已点亮的条数（界面显示 `N / 50` 用）。 */
    public int count() {
        return unlocked.size();
    }

    /**
     * 点亮一个成就：**幂等** ✓。
     *
     * <p>已经点亮 ⇒ **原样返回 this**（不新建对象、也不改动任何东西）——
     * 调用方据此可以判断"这次是不是第一次"（返回 `this` 就是重复触发）。
     */
    public AchievementData withUnlocked(String id) {
        if (id == null || id.isEmpty() || unlocked.contains(id)) {
            return this;
        }
        java.util.Set<String> next = new java.util.HashSet<>(unlocked);
        next.add(id);
        return new AchievementData(Set.copyOf(next));
    }
}
