package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.Config;

import java.util.HashMap;
import java.util.Map;

/**
 * 鱼种数值的**运行期读取层**——让"每条鱼的数值"能在游戏里改、不用重启。
 *
 * <h2>为什么不能直接把配置读进 {@code FishSpecies.ALL}</h2>
 * {@code FishSpecies.ALL} 是 {@code static final List.of(...)}，每条鱼都带着自己的数值。
 * 想在运行期改数值就得改这些对象，而 record 与 {@code List.of} 都不可变 ——
 * 于是"改配置"只能变成"重建整个列表"，但那个列表被图鉴、指令、鱼池构建到处引用着，
 * 重建会让引用失效。
 *
 * <p>所以换个做法：{@code FishSpecies.ALL} 保持不动（只存 id、物品、档位表、竿型、
 * 原型，以及作为设计意图记录的 spec* 数值），<b>运行期要用的数值一律从本类按 id 现取</b>。
 * 配置文件里改了值，下一次抛投就用新值，不需要重建任何对象。
 *
 * <h2>手感档案为什么是"每次现建"</h2>
 * {@link FightProfile} 是 record，13 个字段全是数值。每次
 * {@link #profile(String, FightProfile.Archetype)} 都新建一个 —— 看着浪费，
 * 但一场对抗只会调用一次（咬钩进 FIGHT 状态时快照），而且这样天然得到
 * "改配置只影响下一场，不影响正在遛的这条鱼"。反过来缓存住，热重载就会对
 * 已上钩的鱼也生效，遛到一半手感突然变了，玩家只会觉得"卡了"。
 *
 * <h2>兜底</h2>
 * 任何一步出错（配置还没加载、id 不认识）都退回鲫鱼的档案 —— 最温和的一条。
 * 宁可给一条好钓的鱼，也不能因为读配置失败就崩，更不能返回 0
 *（0 会让鱼原地不动，看起来像"功能坏了"）。
 *
 * <p>本文件里 {@code // ==== BEGIN 生成区} 到 {@code // ==== END 生成区} 之间的内容
 * 由 {@code tools/gen-fish-config.js} 生成，勿手改。
 */
public final class FishTuning {

    private FishTuning() {
    }

    /** 读不到配置时的兜底档案（鲫鱼：最温和）。 */
    private static final FightProfile FALLBACK = FightProfile.CRUCIAN_CARP;

    /**
     * 运行期解析出来的每条鱼的 13 个数值，键就是鱼种 id。
     *
     * <p>用 Map 而不是 21 组字段：鱼种是数据（会增删），
     * Map 让构建函数变成一段循环，加鱼不用改本类的结构。
     */
    private static final Map<String, Values> VALUES = new HashMap<>();

    /** 一个鱼种的 13 个数值（与 tools/fish-source.js 的 FIELDS 一一对应）。 */
    public record Values(
            double minKg,
            double maxKg,
            double pullSpeed,
            double fatiguedPullSpeed,
            double stamina,
            double tensionGain,
            double sprintDurationSec,
            double sprintIntervalSec,
            double turnIntervalSec,
            double fakeOutChance,
            double fatigueThreshold,
            double fatigueDurationSec,
            double staminaRegen
    ) {
        /** 组装成手感档案。 */
        public FightProfile toProfile(FightProfile.Archetype archetype) {
            return new FightProfile(archetype,
                    pullSpeed, fatiguedPullSpeed,
                    sprintDurationSec, sprintIntervalSec, turnIntervalSec,
                    fakeOutChance, tensionGain, stamina,
                    fatigueThreshold, fatigueDurationSec, staminaRegen);
        }
    }

    // ================================================================ 构建

    /**
     * 从配置读一遍全部鱼种数值。{@link Tuning#reload()} 会调用它。
     *
     * <p>逐项显式读取而不是反射：反射在混淆下脆弱，而且显式写更容易在编译期
     * 发现"某个配置项漏接了"。
     */
    public static void build() {
        try {
            Config c = Tuning.cfgPublic();
            if (c == null) {
                AnglersTackle.LOGGER.debug("[垂纶] 鱼种数值暂缓装载：配置还没就绪");
                return;
            }
            Map<String, Values> next = new HashMap<>();
            // ==== BEGIN 生成区（gen-fish-config.js，勿手改）====
            // ==== END 生成区 ====
            VALUES.clear();
            VALUES.putAll(next);
            loadedOnce = true;
            if (next.size() != FishSpecies.ALL.size()) {
                // 少了就说明"配置项与鱼种表对不上"，比如新增了鱼种却忘了重新生成。
                // 不抛异常（那样会连累整个配置热重载），但必须留下明确日志。
                AnglersTackle.LOGGER.warn("[垂纶] 鱼种数值装载 {} 条，但鱼种表有 {} 条 —— " +
                        "跑一下 tools/gen-fish-config.js 重新生成",
                        next.size(), FishSpecies.ALL.size());
            }
            AnglersTackle.LOGGER.info("[垂纶] 鱼种数值已装载：{} 条", next.size());
        } catch (Throwable t) {
            // 配置还没加载完（构造/注册阶段）或读取出错：保留上一次的值。
            // 首次构建失败时 VALUES 为空，getter 会走兜底。
            AnglersTackle.LOGGER.warn("[垂纶] 鱼种数值装载失败（先用兜底值）：{}", t.toString());
        }
    }

    /**
     * 是否已经成功装载过一次。
     *
     * <p>这个标志是为了**让"没装载"不可能静默**：装载失败时 {@link #get} 会走兜底，
     * 而兜底值看起来是"一条正常但很温和的鱼"，玩家只会觉得"手感软"，
     * 完全联想不到是配置没读到。所以只要没装载过，每次取值都记一条 WARN。
     * （真实事故：build() 忘了在启动路径调用，所有鱼都用手感兜底值，
     *   排查了很久才想到"是不是压根没装载"。）
     */
    private static volatile boolean loadedOnce = false;

    /** 兜底告警只打前几次，避免刷屏。 */
    private static final java.util.concurrent.atomic.AtomicInteger fallbackWarns =
            new java.util.concurrent.atomic.AtomicInteger();

    private static Values get(String id) {
        Values v = VALUES.get(id);
        if (v != null) {
            return v;
        }
        if (!loadedOnce && fallbackWarns.getAndIncrement() < 3) {
            AnglersTackle.LOGGER.warn("[垂纶] 鱼种数值尚未装载，正在用兜底值（鲫鱼档）—— 取的是 {}。" +
                    " 若所有鱼手感都一样软，问题就在这里：检查 AnglersTackle 是否监听了" +
                    " ModConfigEvent 并调用了 FishTuning.build()", id);
        }
        Values f = VALUES.get("crucian_carp");
        if (f != null) {
            return f;
        }
        // 完全没装载过：用 FightProfile.CRUCIAN_CARP 的字面数值兜底
        return new Values(0.10, 1.20,
                FALLBACK.pullSpeed(), FALLBACK.fatiguedPullSpeed(), FALLBACK.stamina(),
                FALLBACK.tensionGain(),
                FALLBACK.sprintDurationSec(), FALLBACK.sprintIntervalSec(), FALLBACK.turnIntervalSec(),
                FALLBACK.fakeOutChance(), FALLBACK.fatigueThreshold(),
                FALLBACK.fatigueDurationSec(), FALLBACK.staminaRegen());
    }

    // ================================================================ 单值读取

    public static double minKg(String id) {
        return get(id).minKg();
    }

    public static double maxKg(String id) {
        return get(id).maxKg();
    }

    public static double pullSpeed(String id) {
        return get(id).pullSpeed();
    }

    public static double stamina(String id) {
        return get(id).stamina();
    }

    public static double tensionGain(String id) {
        return get(id).tensionGain();
    }

    /**
     * 这条鱼的手感档案（每次新建，理由见类文档）。
     *
     * @param id        鱼种 id
     * @param archetype 原型来自鱼种表 —— 它是"行为类别"而不是数值，不做成配置项
     */
    public static FightProfile profile(String id, FightProfile.Archetype archetype) {
        return get(id).toProfile(archetype);
    }

    /** 装载完成的鱼种数量（供自检与指令显示）。 */
    public static int loadedCount() {
        return VALUES.size();
    }

    /** 某个 id 是否有运行期数值（供自检用）。 */
    public static boolean has(String id) {
        return VALUES.containsKey(id);
    }
}
