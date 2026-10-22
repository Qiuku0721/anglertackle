package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

/**
 * 图鉴里**某一种鱼**的记录。
 *
 * <p>对应设计文档 04 §3 详情面板的「── 记录 ──」段：捕获次数、最大/最小体长、
 * 最大/最小重量、最高稀有度个体、尺寸评级进度。
 *
 * <h2>⚠ 为什么必须单独存 tier</h2>
 * 鱼身上的 {@code FishData} 只存 {@code SizeGrade}（尺寸评级），**没有存档位**。
 * 而 {@code FishData.gradeOfTier()} 把**金(4) 和红(5) 都映射到 RECORD**，
 * {@code tierOfGrade(RECORD)} 又返回 5 —— 于是金档鱼的 {@code quality()} 算出来是**红**。
 *
 * <p>这个失真在这里是致命的：图鉴要显示"这条鱼我钓到过的最高品质"，
 * 鱼币要按档位定价。如果沿用 {@code FishData} 那条链，金鱼会被记成红鱼，
 * 完成度、定价、"最高稀有度"三处全错。
 *
 * <p>所以图鉴**在记录时就单独存下真实的 tier**（鱼被抽出来的那一刻 tier 是已知的），
 * 不依赖任何反推。{@code FishData} 本身的失真另行修复，但图鉴不建立在它之上。
 *
 * <h2>gradesSeen 位掩码</h2>
 * 尺寸评级有 5 档（幼体/普通/优质/极品/纪录级）。详情面板要显示
 * "幼体✓ 普通✓ 优质✓ 极品✗ 纪录级✗"，所以需要记住**见过哪几档**，
 * 而不只是最高那档。用一个 int 的低 5 位表示。
 */
public record CodexEntry(
        int count,
        float minKg,
        float maxKg,
        float minCm,
        float maxCm,
        /** 钓到过的最高档位 0–5。 */
        int bestTier,
        /** 见过的尺寸评级位掩码（低 5 位）。 */
        int gradesSeen,
        long firstCaughtAt,
        long lastCaughtAt
) {

    public static final Codec<CodexEntry> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.INT.optionalFieldOf("count", 1).forGetter(CodexEntry::count),
            Codec.FLOAT.optionalFieldOf("min_kg", 0f).forGetter(CodexEntry::minKg),
            Codec.FLOAT.optionalFieldOf("max_kg", 0f).forGetter(CodexEntry::maxKg),
            Codec.FLOAT.optionalFieldOf("min_cm", 0f).forGetter(CodexEntry::minCm),
            Codec.FLOAT.optionalFieldOf("max_cm", 0f).forGetter(CodexEntry::maxCm),
            Codec.INT.optionalFieldOf("best_tier", 0).forGetter(CodexEntry::bestTier),
            Codec.INT.optionalFieldOf("grades_seen", 0).forGetter(CodexEntry::gradesSeen),
            Codec.LONG.optionalFieldOf("first_at", 0L).forGetter(CodexEntry::firstCaughtAt),
            Codec.LONG.optionalFieldOf("last_at", 0L).forGetter(CodexEntry::lastCaughtAt)
    ).apply(inst, CodexEntry::new));

    /** 第一次钓到某个鱼种。 */
    public static CodexEntry first(float kg, float cm, int tier, int grade, long gameTime) {
        return new CodexEntry(1, kg, kg, cm, cm, tier, bit(grade), gameTime, gameTime);
    }

    /** 又钓到一条：只更新极值与计数，不动首次时间。 */
    public CodexEntry merge(float kg, float cm, int tier, int grade, long gameTime) {
        return new CodexEntry(
                count + 1,
                Math.min(minKg, kg), Math.max(maxKg, kg),
                Math.min(minCm, cm), Math.max(maxCm, cm),
                Math.max(bestTier, tier),
                gradesSeen | bit(grade),
                firstCaughtAt, gameTime);
    }

    public boolean seenGrade(int grade) {
        return (gradesSeen & bit(grade)) != 0;
    }

    private static int bit(int grade) {
        // 评级 ordinal 落在 0–4；越界就当作没记录，不要让位移算出奇怪的值
        return (grade >= 0 && grade < 32) ? (1 << grade) : 0;
    }
}
