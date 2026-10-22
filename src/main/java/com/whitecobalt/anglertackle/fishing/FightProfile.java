package com.whitecobalt.anglertackle.fishing;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

/**
 * 一条鱼的「手感档案」——决定它上钩后的对抗体验。
 *
 * <p>设计依据：docs/14-鱼的手感档案.md（含十种鱼的完整参数表）。
 *
 * <p>关键设计意图：
 * <ul>
 *   <li>{@code pullSpeed}：**高级鱼普遍更快**（白 0.6 → 红 2.2），
 *       让玩家上钩 2 秒内就能凭"拉不拉得动"判断稀有度</li>
 *   <li>{@code tensionGain}：黏液型鱼（如盲鲟）"线黄得快"的来源</li>
 *   <li>{@code fatiguedPullSpeed}：爆发型鱼"趁疲劳期拉杆"的来源</li>
 *   <li>{@code turnInterval}：神经质型鱼左右乱窜的频率</li>
 * </ul>
 *
 * @param archetype         原型：burst 爆发 / erratic 神经质 / sluggish 黏液 / steady 均衡
 * @param pullSpeed         拉拽速度倍率（1.0 = 基准；越大越拉不动）
 * @param fatiguedPullSpeed 疲劳期拉拽速度倍率（越小越好拉）
 * @param sprintDurationSec 冲刺持续秒数
 * @param sprintIntervalSec 冲刺间隔秒数（越小越凶）
 * @param turnIntervalSec   左右变向间隔秒数（越小越神经质）
 * @param fakeOutChance     假动作概率（预告一个方向实际反方向）
 * @param tensionGain       张力上涨倍率（&gt;1 = 线黄得快）
 * @param stamina           鱼体力上限
 * @param fatigueThreshold  体力低于此比例进入疲劳期
 * @param fatigueDurationSec 疲劳期持续秒数
 * @param staminaRegen      不挣扎时回气速度（被渔轮阻尼抑制）
 */
public record FightProfile(
        Archetype archetype,
        double pullSpeed,
        double fatiguedPullSpeed,
        double sprintDurationSec,
        double sprintIntervalSec,
        double turnIntervalSec,
        double fakeOutChance,
        double tensionGain,
        double stamina,
        double fatigueThreshold,
        double fatigueDurationSec,
        double staminaRegen
) {

    /** 手感原型。 */
    public enum Archetype {
        /** 爆发型：拉得极快、冲刺狠、变向少 → 趁疲劳期反拉。 */
        BURST,
        /** 神经质：左右变向频繁、有假动作 → 紧跟预告方向。 */
        ERRATIC,
        /** 黏液型：拉得慢但张力涨得快 → 全程正拉慢慢磨。 */
        SLUGGISH,
        /** 均衡型：各项中庸 → 视情况切换。 */
        STEADY
    }

    /**
     * 疲劳期游速倍率——**默认 0.5**，来自 gameplay 配置项 {@code fatiguePullMultiplier}。
     *
     * <p>{@code fatiguedPullSpeed} 在 {@code FishingSession} 里是**乘数**：
     * {@code fishOut = 0.055 × pullSpeed × tierSpeed × (疲劳 ? 本值 : 1.0)}。
     *
     * <p>原来四种策略各写各的，其中 STEADY 是 {@code pull×1.25}（实际 1.25）、
     * SLUGGISH 是 {@code pull×1.15}（实际 1.15）——**都 &gt;1**，
     * 意思是"把鱼遛累了它反而拽得更凶"，跟本文件下面
     * {@code fatiguedPullSpeed} 的文档（"越小越好拉"）
     * 和 {@code FishingSession} 的注释（"疲劳期：反拉的最佳窗口"）完全相反。
     *
     * <p>现在统一成 0.5：遛到疲劳对所有鱼都是实打实的收益，没有例外。
     * 策略差异改由 {@code stamina} / {@code tensionGain} / 冲刺频率体现。
     */
    /** 疲劳期拉拽倍率（走配置）。
     *
     * <p>⚠ 不能写成 {@code static final double X = Tuning.x();}：
     * static final 在类初始化时求值一次，那刻配置还没加载，会启动即崩。
     * 所以改成方法，把取值推迟到每次使用。 */
    public static double fatiguePull() {
        return Tuning.fatiguePullMultiplier();
    }

    /**
     * M1 默认档案：河流鲫鱼（白品质，steady 0.7）。
     *
     * <p>低级鱼参数刻意收敛到"闭着眼也能拉上来"，
     * 让新手把注意力留给抛投与提竿（docs/14 §3）。
     */
    public static final FightProfile CRUCIAN_CARP = new FightProfile(
            Archetype.STEADY,
            1.05,                    // 拉得慢 → 玩家能明显感到"这是小鱼"
            1.05 * fatiguePull(),     // 疲劳期：和其他鱼一样 × {@code fatiguePullMultiplier}
            0.6,                     // 冲刺 0.6 秒，很短
            5.5,                     // 5.5 秒才冲一次，很温顺
            4.5,                     // 变向间隔长
            0.00,                    // 无假动作
            0.90,                    // 张力涨得比基准慢（宽容）
            80.0,                    // 体力 80
            0.30,                    // 体力 <30% 进疲劳
            2.0,
            0.02
    );

    public static final Codec<FightProfile> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.STRING.optionalFieldOf("archetype", "steady")
                    .xmap(FightProfile::parseArchetype, a -> a.name().toLowerCase())
                    .forGetter(FightProfile::archetype),
            Codec.DOUBLE.optionalFieldOf("pull_speed", 1.0).forGetter(FightProfile::pullSpeed),
            // 默认值同 fatiguePull()（原来是 1.25 = 疲劳期反而更难拉，是同一个语义错误）
            Codec.DOUBLE.optionalFieldOf("pull_speed_fatigue", fatiguePull())
                    .forGetter(FightProfile::fatiguedPullSpeed),
            Codec.DOUBLE.optionalFieldOf("sprint_duration_s", 1.0).forGetter(FightProfile::sprintDurationSec),
            Codec.DOUBLE.optionalFieldOf("sprint_interval_s", 4.0).forGetter(FightProfile::sprintIntervalSec),
            Codec.DOUBLE.optionalFieldOf("turn_interval_s", 3.5).forGetter(FightProfile::turnIntervalSec),
            Codec.DOUBLE.optionalFieldOf("fake_out_chance", 0.0).forGetter(FightProfile::fakeOutChance),
            Codec.DOUBLE.optionalFieldOf("tension_gain", 1.0).forGetter(FightProfile::tensionGain),
            Codec.DOUBLE.optionalFieldOf("stamina", 100.0).forGetter(FightProfile::stamina),
            Codec.DOUBLE.optionalFieldOf("fatigue_threshold", 0.30).forGetter(FightProfile::fatigueThreshold),
            Codec.DOUBLE.optionalFieldOf("fatigue_duration_s", 2.0).forGetter(FightProfile::fatigueDurationSec),
            Codec.DOUBLE.optionalFieldOf("stamina_regen", 0.02).forGetter(FightProfile::staminaRegen)
    ).apply(inst, FightProfile::new));

    private static Archetype parseArchetype(String s) {
        return switch (s.toLowerCase()) {
            case "burst" -> Archetype.BURST;
            case "erratic" -> Archetype.ERRATIC;
            case "sluggish" -> Archetype.SLUGGISH;
            default -> Archetype.STEADY;
        };
    }

    /** 冲刺时长（tick）。 */
    public int sprintTicks() {
        return (int) Math.round(sprintDurationSec * 20.0);
    }

    /** 冲刺间隔（tick）。 */
    public int sprintIntervalTicks() {
        return (int) Math.round(sprintIntervalSec * 20.0);
    }

    /** 变向间隔（tick）。 */
    public int turnIntervalTicks() {
        return (int) Math.round(turnIntervalSec * 20.0);
    }

    /** 疲劳期时长（tick）。 */
    public int fatigueTicks() {
        return (int) Math.round(fatigueDurationSec * 20.0);
    }
}
