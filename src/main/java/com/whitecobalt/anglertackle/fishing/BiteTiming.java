package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.Config;

/**
 * 咬钩等待的**减时规则**（台钓竿 + 饵料），全链只有这一处真相。
 *
 * <p>用户定案 2026-10-02：
 * <blockquote>
 * "台钓的咬钩时间单独下降 30%，台钓饵料对咬钩时间也进行下降，
 * 具体数值：白 5% 绿 8% 蓝 12% 紫 16% 金 18.5% 红 21%，
 * 以上提到的数值属于**加算**，但配合打窝至多做到 3 秒一条鱼。"
 * </blockquote>
 *
 * <p>所以等待的算法是（消费点在 {@link FishingSession#beginWaiting}）：
 * <pre>
 *   基础 = minWait + rand × maxWait                     ← Config.bite
 *   减时 = 台钓竿 30% + 该档饵料百分比                    ← 加算，不是连乘
 *   实得 = 基础 × (1 − 减时) × 打窝倍率 × 流动 1.3
 *   实得 = clamp(实得, floorSeconds, hardCapSeconds)     ← 下限就是"至多 3 秒一条"
 * </pre>
 *
 * <p><b>为什么要单独一个类：</b>这套数值有**三个**消费点 ——
 * 实际等待（{@code FishingSession}）、饵料 tooltip（{@code BaitItem}）、
 * 鱼竿 tooltip（{@code RodItem}）。以前在本仓库，"同一套数值抄成三份"
 * 已经造成过"tooltip 写着 4.5%、实际按 2% 算"这类漂移，
 * 所以这里把**档位映射**和**加算**都收进一个地方，展示端一律回来问它。
 *
 * <p>⚠ 档位是 **0 起算**的品质档（白=0 … 红=5），与 {@code BaitItem.tier()}、
 * {@code FishingSession.equippedBaitTier()} 同一套。档位越界返回 0 而不是
 * 按最高档算 —— 越界说明调用方拿错了刻度（比如把拟饵的 1 起算值直接传进来会是 6），
 * 按最高档算会把这种错误悄悄藏起来。
 */
public final class BiteTiming {

    private BiteTiming() {
    }

    /**
     * 台钓竿本身的减时（%）。
     *
     * <p>只有台钓竿吃这一项（用户只说台钓）；路亚竿的判断在
     * {@link #totalCut(boolean, double)} 里，别在调用点各写一遍。
     */
    public static double rodCutPercent() {
        return Config.INSTANCE.biteFloatRodCutPercent.get();
    }

    /** 某个**0 起算**档位的饵料减时（%）；越界 → 0。 */
    public static double baitCutPercent(int tier) {
        Config c = Config.INSTANCE;
        return switch (tier) {
            case 0 -> c.biteBaitCutWhitePercent.get();
            case 1 -> c.biteBaitCutGreenPercent.get();
            case 2 -> c.biteBaitCutBluePercent.get();
            case 3 -> c.biteBaitCutPurplePercent.get();
            case 4 -> c.biteBaitCutGoldPercent.get();
            case 5 -> c.biteBaitCutRedPercent.get();
            default -> 0.0;
        };
    }

    /**
     * 加算后的**总减时**，返回 0~1 的倍数（`实得 = 基础 × (1 − 本值)`）。
     *
     * @param floatRod      是不是台钓竿（false = 路亚竿，竿与饵的减时都不参与）
     * @param baitCutPercent 该档饵料的减时（%），没装饵传 0
     */
    public static double totalCut(boolean floatRod, double baitCutPercent) {
        return totalCut(floatRod, baitCutPercent, false);
    }

    /**
     * 同上，外加**夜间台钓**的减免（用户 2026-10-02 定案的环境系统里唯一动咬钩节奏的一项）。
     *
     * <p>这是 {@code docs/24} 里唯一一条"环境会影响等待"的规则：时段/天气/月相**都只改抽签权重**，
     * 只有"夜晚 + 台钓"这一处减等待 —— 现实里夜钓确实更容易上鱼，算给熬夜的人一点补偿。
     * 路亚竿不吃（路亚是主动找鱼、没有等待可言）。
     *
     * <p>与竿/饵的减时**加算**，最后仍受 {@link #floorSeconds()} 与硬上限约束。
     *
     * @param night 当前是不是夜晚（见 {@link Environment#slotOf(long)}）
     */
    public static double totalCut(boolean floatRod, double baitCutPercent, boolean night) {
        if (!floatRod) {
            return 0.0;
        }
        // 封顶 100%：几项各自都允许配到很高，加起来可能超过 100，
        // 那时 (1 − cut) 变成负数。等待那边还有一道下限兜着，
        // 但让中间量保持有意义，排查时不用先怀疑配置。
        double sum = (rodCutPercent() + Math.max(0.0, baitCutPercent) + nightCutPercent(true, night) * 100.0) / 100.0;
        return Math.min(1.0, Math.max(0.0, sum));
    }

    /**
     * 夜间台钓的减时（%，0 = 关闭）。
     *
     * <p>单独暴露出来是为了 tooltip 与调试输出能显示它 —— 展示端一律回来问这里，
     * 不在调用点各算一遍（本类头注释里那条"抄三份必漂移"的教训）。
     */
    public static double nightCutPercent(boolean floatRod, boolean night) {
        if (!floatRod || !night) {
            return 0.0;
        }
        return Config.INSTANCE.biteNightCutPercent.get();
    }

    /**
     * 等待下限秒数（用户定案 3 秒："配合打窝至多做到 3 秒一条鱼"）。
     *
     * <p>没有它就成了"越堆越快、没有尽头"：台钓 −51%（红饵）+ 秘制窝 ×0.45
     * 之后最短那一杆会算到 2.2 秒。
     */
    public static double floorSeconds() {
        return Config.INSTANCE.biteFloorSeconds.get();
    }

    /** 百分比显示：5.0 → {@code "5"}，18.5 → {@code "18.5"}（整数不留小数点）。 */
    public static String percentText(double v) {
        return v == Math.rint(v) ? String.format("%.0f", v) : String.format("%.1f", v);
    }
}
