package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 玩家的**称号**数据（用户 2026-10-11："开发称号系统"）。
 *
 * <h2>为什么单开一个附件，不塞进 {@link PlayerFishingData}</h2>
 * 与 {@code docs/36} §2.1 记的是同一条理由：那个 record 已经有 6 个构造点，
 * 而称号是"**会增删的集合 + 一张进度表**"，塞进去会让每个构造点都要多带两个参数，
 * 改一处忘一处就是"称号没存下来"。单开附件以后，老存档读进来是 {@code EMPTY}，
 * 一行迁移都不用写 ✓。
 *
 * <h2>四个字段，各有一条纪律</h2>
 * <ul>
 *   <li>{@code owned} —— **集合**（不是 List）：重复授予同一个称号不能让集合"变大"，
 *       数量记在 {@code counts} 里 ✓；</li>
 *   <li>{@code counts} —— 可重复获得的称号（联赛冠军、服主授予）的**次数**，
 *       聊天/界面显示成 {@code ×N}；</li>
 *   <li>{@code equipped} —— **当前佩戴**的称号 id；空串 = 不显示（默认就是空串，
 *       所以老玩家一进来聊天里什么都不变 ✓ 纯加法）；</li>
 *   <li>{@code progress} —— **只装"算不出来"的进度**（见 {@code docs/38} §3）：
 *       红档尾数、夜晚/满月/冰洞尾数、雷暴金档、打窝/断线次数、菜型与适口位掩码、
 *       联赛签收期数。图鉴完成度、等级、巨物纪录、纪录级、三冠**一律不存** ——
 *       它们当场从现有数据算（再存一份就是两份真源，迟早"称号说拿到了、图鉴说没有" ✗）。</li>
 * </ul>
 *
 * <h2>永久性</h2>
 * 称号**永不因赛季/联赛结算失去**（用户口径 + 本仓库"绝不动玩家永久数据"一条纪律）。
 * {@code copyOnDeath()} 在 {@code ModAttachments} 里注册 ⇒ 死一次不会丢 ✓。
 */
public record PlayerTitles(
        /** 已获得的称号 id（集合）。 */
        Set<String> owned,
        /** 可重复称号的获得次数。 */
        Map<String, Integer> counts,
        /** 当前佩戴的称号 id；空串 = 不佩戴。 */
        String equipped,
        /** 算不出来的进度（见类注释）。 */
        Map<String, Integer> progress) {

    /** 新玩家的默认值：什么都没有、不佩戴。 */
    public static final PlayerTitles EMPTY = new PlayerTitles(Set.of(), Map.of(), "", Map.of());

    private static final Codec<Set<String>> OWNED_CODEC =
            Codec.STRING.listOf().xmap(Set::copyOf, List::copyOf);

    public static final Codec<PlayerTitles> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            // ⚠ 一律 optionalFieldOf：老存档里根本没有这些键，用 fieldOf 会让整份数据读不进来
            OWNED_CODEC.optionalFieldOf("owned", Set.of()).forGetter(PlayerTitles::owned),
            Codec.unboundedMap(Codec.STRING, Codec.INT).optionalFieldOf("counts", Map.of())
                    .forGetter(PlayerTitles::counts),
            Codec.STRING.optionalFieldOf("equipped", "").forGetter(PlayerTitles::equipped),
            Codec.unboundedMap(Codec.STRING, Codec.INT).optionalFieldOf("progress", Map.of())
                    .forGetter(PlayerTitles::progress)
    ).apply(inst, PlayerTitles::new));

    /** 有没有这个称号。 */
    public boolean has(String id) {
        return id != null && !id.isEmpty() && owned.contains(id);
    }

    /** 获得次数（没获得过 = 0）。 */
    public int countOf(String id) {
        return counts.getOrDefault(id, 0);
    }

    /** 某个进度的当前值（没有 = 0）。 */
    public int progressOf(String key) {
        return progress.getOrDefault(key, 0);
    }

    /**
     * 授予一个称号：**幂等** ✓。
     *
     * <p>已有 ⇒ 只把 {@code counts} +1（可重复称号显示 {@code ×N}），{@code owned} 不变
     * （它是集合，重复 add 不会变大 —— 这正是用集合而不是 List 的原因）；
     * 没有 ⇒ 加进 {@code owned}，并把次数记成 1。
     */
    public PlayerTitles withGrant(String id) {
        if (id == null || id.isEmpty()) {
            return this;
        }
        java.util.Set<String> nextOwned = new java.util.HashSet<>(owned);
        nextOwned.add(id);
        java.util.Map<String, Integer> nextCounts = new java.util.HashMap<>(counts);
        nextCounts.merge(id, 1, Integer::sum);
        return new PlayerTitles(Set.copyOf(nextOwned), Map.copyOf(nextCounts), equipped, progress);
    }

    /** 佩戴某个称号（调用方先确认它已在 {@code owned} 里）；空串 = 不佩戴。 */
    public PlayerTitles withEquipped(String id) {
        return new PlayerTitles(owned, counts, id == null ? "" : id, progress);
    }

    /** 写一个进度值。 */
    public PlayerTitles withProgress(String key, int value) {
        java.util.Map<String, Integer> next = new java.util.HashMap<>(progress);
        next.put(key, value);
        return new PlayerTitles(owned, counts, equipped, Map.copyOf(next));
    }
}
