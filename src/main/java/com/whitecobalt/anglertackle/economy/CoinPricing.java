package com.whitecobalt.anglertackle.economy;

/**
 * 鱼币定价。
 *
 * <h2>为什么按**档位**定价，而不是每种鱼一个价</h2>
 * 设计文档 03 §6 列的是"10 种鱼各自的基础价"，但代码里现在有 **21 种鱼** ——
 * 那张表从加鱼的那一刻起就对不上了，而且每加一种鱼都要回来补一行，
 * 迟早会漏。按档位定价自带"新鱼自动有价"，且和品质颜色一致：
 * 玩家看到一条紫鱼，就知道大概值多少。
 *
 * <p>取值用文档给区间的**中位数**（白 20–50 → 35，绿 60–100 → 80，
 * 蓝 120–220 → 170，紫 380–550 → 465，金 980–1780 → 1380，红 3000–6600 → 4800）。
 * 区间本身留给以后做"同档不同鱼略贵/略便宜"的微调。
 *
 * <h2>尺寸系数</h2>
 * 文档 03 §6：{@code 最终售价 = 基础价 × (1 + 0.08 × 尺寸重量系数)}，
 * 系数 ∈ [-1, +1]（体长与重量在种群区间内的位置）。
 * 所以**同种鱼最大差价只有 ±8%** —— 这是刻意的：品质才是价值的主要来源，
 * 尺寸只是零头。这样"钓到大鱼"的爽感来自图鉴和记录，而不是刷钱。
 */
public final class CoinPricing {

    private CoinPricing() {
    }

    /**
     * 六个档位的基础价。下标就是 tier（0 白 … 5 红）。
     *
     * <p>⚠ 必须**单调递增**，且 0 档 > 0 —— 有检查脚本盯着这两条。
     * 价格出现倒挂（高级鱼比低级鱼便宜）会让玩家觉得升级没用，
     * 而这种错在代码里完全看不出来。
     */
    public static final long[] BASE_BY_TIER = {35L, 80L, 170L, 465L, 1380L, 4800L};

    /** 尺寸带来的最大浮动（±8%）。 */
    public static final double SIZE_SPREAD = 0.08;

    /** 某一档的基础价。越界会夹到两端，不会抛异常（鱼种数据坏了也不该让上鱼崩）。 */
    public static long baseForTier(int tier) {
        if (tier < 0) {
            return BASE_BY_TIER[0];
        }
        if (tier >= BASE_BY_TIER.length) {
            return BASE_BY_TIER[BASE_BY_TIER.length - 1];
        }
        return BASE_BY_TIER[tier];
    }

    /**
     * 一条鱼值多少鱼币。
     *
     * @param tier       品质档位 0–5
     * @param sizeFactor 尺寸重量系数，-1（最小个体）~ +1（最大个体）
     */
    public static long priceFor(int tier, double sizeFactor) {
        double f = Math.max(-1.0, Math.min(1.0, sizeFactor));
        return Math.round(baseForTier(tier) * (1.0 + SIZE_SPREAD * f));
    }

    /**
     * 一条鱼在它自己种群里的尺寸位置，映射到 -1（最小）~ +1（最大）。
     *
     * <p>只用体重算，不掺体长：体长在这个 mod 里是**由体重开三次方推出来的**
     * （见 {@code FishSpecies} 的个体生成），两者不独立 —— 掺进去等于把体重
     * 数了两遍，大鱼会拿走双份加成。体长留给图鉴显示，不参与定价。
     *
     * <p>种群区间取**当前配置**里的值（fishStats 可调），所以改了配置定价会跟着动，
     * 不需要另存一份基准。
     */
    public static double sizeFactor(double kg, double minKg, double maxKg) {
        if (maxKg <= minKg) {
            return 0.0;   // 区间退化（配置被改成上=下）→ 当作中等个体，不产生 NaN
        }
        double t = (kg - minKg) / (maxKg - minKg);
        return Math.max(-1.0, Math.min(1.0, t * 2.0 - 1.0));
    }
}
