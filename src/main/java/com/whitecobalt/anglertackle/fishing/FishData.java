package com.whitecobalt.anglertackle.fishing;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;

import java.util.Optional;

/**
 * 一条鱼获的实例数据（物种 + 个体尺寸）。
 *
 * <p>关键设计：**尺寸与重量在「咬钩」时就由服务端生成**，而不是上鱼时才随机，
 * 这样玩家重连/掉线无法刷新数值（见 docs/02-钓鱼小游戏机制.md §5.1）。
 *
 * @param speciesId 鱼种 id（对应 data/anglertackle/fish/*.json）
 * @param lengthCm  体长（厘米）
 * @param weightKg  重量（千克）
 * @param grade     尺寸评级（幼体/普通/优质/极品/纪录级）
 * @param caughtAt  捕获时间（游戏刻），用于图鉴排序
 * @param catcher   钓到它的玩家（用于图鉴与排行榜归属）
 */
public record FishData(
        String speciesId,
        float lengthCm,
        float weightKg,
        SizeGrade grade,
        long caughtAt,
        Optional<String> catcher,
        /**
         * 品质档位 0–5（白绿蓝紫金红）。{@code -1} = 未知。
         *
         * <h2>⚠ 为什么必须单独存这一位</h2>
         * 以前 tier 是不存的，只存 {@link SizeGrade}，需要时用
         * {@code tierOfGrade(grade)} 反推。但 {@link #gradeOfTier} 把
         * <b>金(4) 和红(5) 都映射到 RECORD</b>，而 {@code tierOfGrade(RECORD)}
         * 返回 5 —— 于是**每一条金档鱼的 quality() 都算成红**：
         * 名字显示红的、图鉴把"最高品质"记成红、按档位定价时金鱼按红鱼算（差 3.5 倍）。
         *
         * <p>反推这条路是补不回来的：4 和 5 挤进了同一个 RECORD，信息在映射那一刻
         * 就已经丢了。只能**在抽出来的那一刻把真实 tier 存下来**。
         *
         * <p>{@code -1} 只出现在这个字段加入之前钓到的鱼上。那种情况下
         * {@link #quality()} 会退回到旧的推导方式（可能把金显示成红），
         * 但新钓上来的一律准确。老存档不做数据迁移 —— 为几条测试鱼写迁移逻辑
         * 不划算，而且迁移也猜不出原本是 4 还是 5。
         */
        int tier
) {

    /**
     * 未知档位。老存档里的鱼、以及任何"没有 tier 来源"的构造点用这个。
     */
    public static final int TIER_UNKNOWN = -1;

    /**
     * 尺寸评级：同种鱼也有 5 档追求（docs/02-钓鱼小游戏机制.md §5.1）。
     *
     * <p>与品质档位一一对应（见 {@link #gradeOfTier}），
     * 保留它只是为了兼容已有的存档与图鉴字段。
     */
    public enum SizeGrade {
        JUVENILE("juvenile", 0.7),
        NORMAL("normal", 1.0),
        QUALITY("quality", 1.25),
        EXCELLENT("excellent", 1.6),
        RECORD("record", 2.5);

        private final String key;
        private final double valueMultiplier;

        SizeGrade(String key, double valueMultiplier) {
            this.key = key;
            this.valueMultiplier = valueMultiplier;
        }

        public String key() {
            return key;
        }

        /** 售价加成（docs/03-数值表.md §6）。 */
        public double valueMultiplier() {
            return valueMultiplier;
        }

        /**
         * 品质档位 → 尺寸评级。
         *
         * <p>两者现在是同一件事：品质由**体重**决定（越重越高档），
         * 而体重与体长是三次方联动的，所以"重"等价于"大"。
         * 保留 SizeGrade 是为了兼容已有的存档与图鉴字段。
         */
        public static SizeGrade fromTier(int tier) {
            return gradeOfTier(tier);
        }
    }

    /**
     * 品质档位 → 尺寸评级（一一对应，用于兼容已有字段）。
     *
     * <p>顺序：白=JUVENILE / 绿=NORMAL / 蓝=QUALITY / 紫=EXCELLENT / 金+红=RECORD。
     */
    public static SizeGrade gradeOfTier(int tier) {
        return switch (Math.max(0, Math.min(5, tier))) {
            case 0 -> SizeGrade.JUVENILE;
            case 1 -> SizeGrade.NORMAL;
            case 2 -> SizeGrade.QUALITY;
            case 3 -> SizeGrade.EXCELLENT;
            default -> SizeGrade.RECORD;
        };
    }

    /**
     * 尺寸评级 → 品质档位（逆映射）。
     *
     * <p>⚠ 这个方向是**有损**的：金(4) 和红(5) 都落在 RECORD 上，逆回来只能给一个值。
     * 这里返回 4 而不是 5 —— 宁可把红显示成金，也不要把金显示成红：
     * 后者会让玩家以为钓到了最稀有的鱼。新数据请直接用 {@link #tier()}。
     */
    public static int tierOfGrade(SizeGrade grade) {
        return switch (grade) {
            case JUVENILE -> 0;
            case NORMAL -> 1;
            case QUALITY -> 2;
            case EXCELLENT -> 3;
            // 有损方向：取较低的 4（金），不要冒充满档的红
            case RECORD -> 4;
        };
    }

    /**
     * 这条鱼的品质档位。**优先用存下来的真实 tier**，没有才退回按尺寸评级反推。
     *
     * <p>顺序很重要：老存档里 {@code tier == -1}，只能反推；新钓到的鱼一律走前一条路，
     * 金就是金、红就是红。
     */
    public int effectiveTier() {
        return tier >= 0 ? tier : tierOfGrade(grade);
    }

    /** 这条鱼的品质档（颜色作用在鱼名上）。 */
    public com.whitecobalt.anglertackle.item.Quality quality() {
        return com.whitecobalt.anglertackle.item.Quality.of(effectiveTier());
    }

    /**
     * 按体长在种群区间内的相对位置判定评级。
     *
     * @param ratio (length - min) / (max - min)，范围 0~1
     */
    public static SizeGrade gradeFromRatio(double ratio) {
        if (ratio < 0.15) return SizeGrade.JUVENILE;
        if (ratio < 0.55) return SizeGrade.NORMAL;
        if (ratio < 0.85) return SizeGrade.QUALITY;
        if (ratio < 0.97) return SizeGrade.EXCELLENT;
        return SizeGrade.RECORD;
    }

    public static final Codec<FishData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.STRING.fieldOf("species").forGetter(FishData::speciesId),
            Codec.FLOAT.fieldOf("length_cm").forGetter(FishData::lengthCm),
            Codec.FLOAT.fieldOf("weight_kg").forGetter(FishData::weightKg),
            // 用序号存盘而不是名字：以后加档位/改名字不会让老存档失效
            Codec.INT.optionalFieldOf("grade", SizeGrade.NORMAL.ordinal())
                    .xmap(i -> SizeGrade.values()[Math.floorMod(i, SizeGrade.values().length)], SizeGrade::ordinal)
                    .forGetter(FishData::grade),
            Codec.LONG.optionalFieldOf("caught_at", 0L).forGetter(FishData::caughtAt),
            Codec.STRING.optionalFieldOf("catcher").forGetter(FishData::catcher),
            // 老存档没有这个键 → 取 -1（未知），effectiveTier() 会退回按尺寸评级反推。
            // 写成 optionalFieldOf 而不是 fieldOf，就是为了让老存档能读进来而不是整条鱼失效。
            Codec.INT.optionalFieldOf("tier", TIER_UNKNOWN).forGetter(FishData::tier)
    ).apply(inst, FishData::new));

    public static final StreamCodec<FriendlyByteBuf, FishData> STREAM_CODEC = StreamCodec.of(
            (buf, d) -> {
                buf.writeUtf(d.speciesId);
                buf.writeFloat(d.lengthCm);
                buf.writeFloat(d.weightKg);
                buf.writeByte(d.grade.ordinal());
                buf.writeLong(d.caughtAt);
                buf.writeBoolean(d.catcher.isPresent());
                d.catcher.ifPresent(buf::writeUtf);
                // 有符号写：-1（未知）也要能传过去。writeByte 会截成 8 位但 -1 正好是 0xFF，
                // 读回来还是 -1，取值域 0..5 完全够。
                buf.writeByte(d.tier);
            },
            buf -> {
                String species = buf.readUtf();
                float len = buf.readFloat();
                float kg = buf.readFloat();
                SizeGrade grade = SizeGrade.values()[buf.readByte()];
                long at = buf.readLong();
                Optional<String> catcher = buf.readBoolean() ? Optional.of(buf.readUtf()) : Optional.empty();
                int tier = buf.readByte();
                return new FishData(species, len, kg, grade, at, catcher, tier);
            }
    );
}
