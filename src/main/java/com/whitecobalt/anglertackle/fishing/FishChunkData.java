package com.whitecobalt.anglertackle.fishing;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;

/**
 * 一块鱼块的数据（docs/25 §2、§14.5 的"数据继承链"）。
 *
 * <p>整鱼 → 生块 → 熟块 → 菜，**{@code species} 与 {@code tier} 全程不变**：
 * 玩家切的是哪条鱼、什么品质，做成菜以后 tooltip 上写的还是那条鱼。
 * 这就是"成品菜按菜型注册、一件物品一张图"能成立的前提 —— 鱼的区分靠数据，不靠物品。
 *
 * @param speciesId 鱼种 id（与 {@link FishData#speciesId()} 同一套；对应 lang 的
 *                  {@code item.anglertackle.<id>}）
 * @param tier      品质档位 0–5（白绿蓝紫金红，见 item/Quality.java）
 * @param weightKg  这条鱼切块时的重量（千克）—— 份数就是按它算出来的（docs/25 §2.3）
 */
public record FishChunkData(String speciesId, int tier, float weightKg) {

    /** 材料档位：0 普通鱼块 / 1 优质鱼肉 / 2 顶级鱼排。 */
    public static final int GROUP_COMMON = 0;
    public static final int GROUP_FINE = 1;
    public static final int GROUP_SUPREME = 2;

    /**
     * 品质 → 材料档位（docs/25 §2.1）：**白绿→普通、蓝紫→优质、金红→顶级**。
     *
     * <p>⚠ 档位口径照仓库规矩是 **0 起算**（白=0 … 红=5）。
     */
    public static int groupOfTier(int tier) {
        if (tier <= 1) return GROUP_COMMON;
        if (tier <= 3) return GROUP_FINE;
        return GROUP_SUPREME;
    }

    public static final Codec<FishChunkData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.STRING.fieldOf("species").forGetter(FishChunkData::speciesId),
            Codec.INT.fieldOf("tier").forGetter(FishChunkData::tier),
            Codec.FLOAT.fieldOf("weight_kg").forGetter(FishChunkData::weightKg)
    ).apply(inst, FishChunkData::new));

    public static final StreamCodec<FriendlyByteBuf, FishChunkData> STREAM_CODEC = StreamCodec.of(
            (buf, d) -> {
                buf.writeUtf(d.speciesId);
                buf.writeByte(d.tier);
                buf.writeFloat(d.weightKg);
            },
            buf -> new FishChunkData(buf.readUtf(), buf.readByte(), buf.readFloat()));
}
