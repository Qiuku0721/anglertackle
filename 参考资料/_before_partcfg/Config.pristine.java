package com.whitecobalt.anglertackle;

import net.neoforged.neoforge.common.ModConfigSpec;
import org.apache.commons.lang3.tuple.Pair;

/**
 * 配置与平衡参数。
 *
 * <p>数值来源见设计文档：
 * <ul>
 *   <li>{@code docs/02-钓鱼小游戏机制.md} §9 — 手感调参清单（cast / hookWindow / tension / bite）</li>
 *   <li>{@code docs/11-配件系统详表.md} §2 — 六槽属性合成权重与上限（parts）</li>
 *   <li>{@code docs/03-数值表.md} §9.3 — 经济平衡（chum / bait / value）</li>
 *   <li>{@code docs/09-原版冲突与渲染优化.md} §4 — 渲染与实体同步（render）</li>
 * </ul>
 *
 * <p>所有默认值都刻意做成"可直接改"，方便整合包作者调平衡，不必重新编译。
 */
public final class Config {

    public static final ModConfigSpec SPEC;
    public static final Config INSTANCE;

    static {
        Pair<Config, ModConfigSpec> pair = new ModConfigSpec.Builder().configure(Config::new);
        INSTANCE = pair.getLeft();
        SPEC = pair.getRight();
    }

    // ------------------------------------------------------------------ 抛投
    public final ModConfigSpec.DoubleValue chargeTimeSeconds;

    // ------------------------------------------------------------ 提竿窗口
    public final ModConfigSpec.DoubleValue hookWindowBase;
    public final ModConfigSpec.DoubleValue hookWindowMin;

    // ---------------------------------------------------------------- 张力
    public final ModConfigSpec.DoubleValue tensionReelGain;
    public final ModConfigSpec.DoubleValue tensionReleaseLoss;
    public final ModConfigSpec.DoubleValue tensionIdleLoss;
    public final ModConfigSpec.DoubleValue tensionWhiteMax;
    public final ModConfigSpec.DoubleValue tensionYellowMax;
    public final ModConfigSpec.DoubleValue tensionCriticalFlash;
    public final ModConfigSpec.DoubleValue tensionBaseRecover;

    // ------------------------------------------------------------ 咬钩等待
    public final ModConfigSpec.DoubleValue biteMinWait;
    public final ModConfigSpec.DoubleValue biteMaxWait;
    public final ModConfigSpec.DoubleValue biteHardCap;

    // ------------------------------------------------------- 配件属性合成
    public final ModConfigSpec.DoubleValue weightLineOnTension;
    public final ModConfigSpec.DoubleValue weightRodOnTension;
    public final ModConfigSpec.DoubleValue weightLineOnRecover;
    public final ModConfigSpec.DoubleValue weightRodOnRecover;
    public final ModConfigSpec.DoubleValue weightReelOnDrain;
    public final ModConfigSpec.DoubleValue weightRodOnDrain;
    public final ModConfigSpec.DoubleValue capTensionCeiling;
    public final ModConfigSpec.DoubleValue capTensionRecover;
    public final ModConfigSpec.DoubleValue capStaminaDrain;
    public final ModConfigSpec.DoubleValue capPull;
    public final ModConfigSpec.DoubleValue capDamping;
    public final ModConfigSpec.DoubleValue pullIdleBase;
    public final ModConfigSpec.DoubleValue pullStruggleBase;
    public final ModConfigSpec.DoubleValue staminaDrainBase;

    // ---------------------------------------------------------------- 窝料
    public final ModConfigSpec.IntValue chumParticleIntervalTicks;
    public final ModConfigSpec.IntValue chumParticlesPerBurst;
    public final ModConfigSpec.DoubleValue chumRadius;

    // ------------------------------------------------------------ 品质门槛
    // （见构造函数里的说明：这一组还没实现，暂不提供配置项）

    // ---------------------------------------------------------------- 耐久
    public final ModConfigSpec.IntValue rodDurabilityPerBite;
    public final ModConfigSpec.IntValue lineDurabilityPerBite;
    public final ModConfigSpec.IntValue lureDurabilityPerBite;
    public final ModConfigSpec.IntValue lineDurabilityPerBreak;







    // ---------------------------------------------------------------- 渲染
    public final ModConfigSpec.IntValue ghostLineBeyondBlocks;

    private Config(ModConfigSpec.Builder b) {
        // ---------------------------------------------------------- 抛投
        b.comment("""
                抛投 / Casting
                注意：抛投已在 M2 改成**视角抛投**（低头近 / 平视中 / 抬头远），
                所以早期设计的"蓄力绿区 / 落点误差"配置项已删除 ——
                留着它们只会让人以为能调。""").push("cast");
        chargeTimeSeconds = b
                .comment("蓄力到满所需秒数（只影响 HUD 蓄力条的显示节奏）")
                .defineInRange("chargeTimeSeconds", 1.6D, 0.2D, 10.0D);
        b.pop();

        // ------------------------------------------------------ 提竿窗口
        b.comment("提竿窗口 / Hook window（用户定案：基础 2.0 秒）").push("hookWindow");
        hookWindowBase = b.comment("基础窗口秒数（鱼钩/鱼竿加成会再加到它上面）")
                .defineInRange("base", 2.0D, 0.05D, 5.0D);
        hookWindowMin = b.comment("窗口下限秒数（加成算完后不会低于它）")
                .defineInRange("min", 1.0D, 0.05D, 5.0D);
        b.pop();

        // ---------------------------------------------------------- 张力
        b.comment("""
                张力模型 / Tension（反馈以鱼线颜色为主，HUD 只做辅助）
                ⚠ whiteMax / yellowMax 是**相对于基准张力上限 100** 的值：
                代码里按比例使用（whiteMax/100），好线把上限抬到 300 时
                白区黄区会同步放大，否则"好线反而全程红区"。""").push("tension");
        tensionReelGain = b.comment("收线时每 tick 增加的张力")
                .defineInRange("reelGain", 0.9D, 0.0D, 20.0D);
        tensionReleaseLoss = b.comment("放线时每 tick 减少的张力")
                .defineInRange("releaseLoss", 1.6D, 0.0D, 20.0D);
        tensionIdleLoss = b.comment("不操作时每 tick 自然松弛的张力")
                .defineInRange("idleLoss", 0.35D, 0.0D, 20.0D);
        tensionWhiteMax = b.comment("白区（安全）上限，基准 100 的百分比")
                .defineInRange("whiteMax", 55.0D, 1.0D, 100.0D);
        tensionYellowMax = b.comment("黄区上限（超过进红区），基准 100 的百分比")
                .defineInRange("yellowMax", 82.0D, 1.0D, 100.0D);
        tensionCriticalFlash = b.comment("鱼线开始深红闪烁的张力值（基准 100 的百分比）")
                .defineInRange("criticalFlash", 98.0D, 1.0D, 100.0D);
        tensionBaseRecover = b.comment("基础张力回复速率（点/tick，放线时由红转白的速度）")
                .defineInRange("baseRecover", 1.6D, 0.0D, 20.0D);
        b.pop();

        // ------------------------------------------------------ 咬钩等待
        b.comment("咬钩等待 / Bite timing（玩家扛不住长时间干等，上限压到 20 秒）").push("bite");
        biteMinWait = b.comment("最短等待秒数")
                .defineInRange("minWaitSeconds", 2.0D, 0.1D, 60.0D);
        biteMaxWait = b.comment("最长等待秒数的随机量（实际等待 = min + rand × 本值）")
                .defineInRange("maxWaitSeconds", 6.0D, 0.1D, 120.0D);
        biteHardCap = b.comment("硬上限秒数（任何修正后都不得超过）")
                .defineInRange("hardCapSeconds", 20.0D, 1.0D, 300.0D);
        b.pop();

        // --------------------------------------------------- 配件属性合成
        b.comment("""
                六槽配件属性合成 / Part attribute composition
                权重决定"某项属性由谁主导"，上限防止数值失控。
                详见 docs/11-配件系统详表.md §2。""").push("parts");
        weightLineOnTension = b.comment("鱼线对张力上限的贡献权重")
                .defineInRange("lineOnTension", 0.60D, 0.0D, 1.0D);
        weightRodOnTension = b.comment("鱼竿对张力上限的贡献权重")
                .defineInRange("rodOnTension", 0.40D, 0.0D, 1.0D);
        weightLineOnRecover = b.comment("鱼线对张力回复速度的贡献权重")
                .defineInRange("lineOnRecover", 0.60D, 0.0D, 1.0D);
        weightRodOnRecover = b.comment("鱼竿对张力回复速度的贡献权重")
                .defineInRange("rodOnRecover", 0.40D, 0.0D, 1.0D);
        weightReelOnDrain = b.comment("渔轮对体力削减的贡献权重")
                .defineInRange("reelOnDrain", 0.60D, 0.0D, 1.0D);
        weightRodOnDrain = b.comment("鱼竿对体力削减的贡献权重")
                .defineInRange("rodOnDrain", 0.40D, 0.0D, 1.0D);
        capTensionCeiling = b.comment("张力上限倍率硬上限")
                .defineInRange("capTensionCeiling", 3.00D, 1.0D, 10.0D);
        capTensionRecover = b.comment("张力回复倍率硬上限（放线时由红转白的速度）")
                .defineInRange("capTensionRecover", 2.20D, 1.0D, 10.0D);
        capStaminaDrain = b.comment("体力削减倍率硬上限")
                .defineInRange("capStaminaDrain", 2.60D, 1.0D, 10.0D);
        capPull = b.comment("回拉速度倍率硬上限")
                .defineInRange("capPull", 2.30D, 1.0D, 10.0D);
        capDamping = b.comment("压制阻尼倍率硬上限")
                .defineInRange("capDamping", 2.70D, 1.0D, 10.0D);
        pullIdleBase = b.comment("不挣扎时基础回拉速度（格/tick）")
                .defineInRange("pullIdleBase", 0.15D, 0.001D, 2.0D);
        pullStruggleBase = b.comment("挣扎时基础回拉速度（格/tick）")
                .defineInRange("pullStruggleBase", 0.35D, 0.001D, 2.0D);
        staminaDrainBase = b.comment("收线时每秒扣掉的鱼力比例（相对满体力）")
                .defineInRange("staminaDrainBase", 0.20D, 0.001D, 5.0D);
        b.pop();

        // ---------------------------------------------------------- 窝料
        b.comment("""
                窝料 / Chum（做成实体、会散开、时长按窝料档次）
                注意：时长是**每种窝料自己的**（ChumItem 构造参数，30~300 分钟档），
                所以这里没有"全局时长"配置 —— 那种配置要么被忽略、要么把档次差异抹平。""").push("chum");
        chumParticleIntervalTicks = b.comment("粒子生成间隔（tick）；越大越省性能")
                .defineInRange("particleIntervalTicks", 6, 1, 200);
        chumParticlesPerBurst = b.comment("每次生成的粒子数（批量生成，降低总粒子量）")
                .defineInRange("particlesPerBurst", 6, 1, 32);
        chumRadius = b.comment("窝子半径（格）——白圈画的就是这个半径")
                .defineInRange("radius", 10.0D, 1.0D, 64.0D);
        b.pop();

        // ------------------------------------------------------ 品质门槛
        b.comment("""
                品质门槛 / Rarity gate
                说明：**这一组还没有实现**，所以暂不提供配置项。
                当前生效的规则是：饵料/拟饵只决定鱼种档位下限（baitMinTier），
                金红占比由饵料档次与打窝倍率共同决定。
                等"蓝品质以下配置不许出红鱼"真正写进抽鱼逻辑后，再在这里加配置。""").push("rarityGate");
        b.pop();

        // ---------------------------------------------------------- 耐久
        b.comment("耐久 / Durability（咬钩即扣，与是否切线逃离无关）").push("durability");
        rodDurabilityPerBite = b.comment("每次咬钩扣除的鱼竿耐久（还会再乘竿的材质系数）")
                .defineInRange("rodPerBite", 2, 0, 100);
        lineDurabilityPerBite = b.comment("每次鱼咬钩扣除的鱼线耐久")
                .defineInRange("linePerBite", 1, 0, 100);
        lureDurabilityPerBite = b.comment("每次鱼咬钩扣除的拟饵耐久")
                .defineInRange("lurePerBite", 1, 0, 100);
        lineDurabilityPerBreak = b.comment("断线时额外扣除的鱼线耐久")
                .defineInRange("linePerBreak", 5, 0, 100);
        b.pop();

        // ---------------------------------------------------------- 渲染
        b.comment("""
                渲染与实体同步 / Rendering
                注意：实体追踪范围（clientTrackingRange）是**注册期常量**，
                运行时改配置改不动它，所以这里不提供该项 —— 免得改了没反应。
                超出视距时的兜底靠"幽灵鱼线"，见 docs/09-原版冲突与渲染优化.md。""").push("render");
        ghostLineBeyondBlocks = b.comment("超过该距离改用简化线型（格）")
                .defineInRange("ghostLineBeyondBlocks", 64, 8, 256);
        b.pop();
    }
}
