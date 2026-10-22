package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 服务端 → 客户端：可以开菜谱了（空载包）。
 *
 * <p>为什么不带数据：菜谱的每一格都能在客户端**自己算出来** ——
 * 做法与允许的鱼来自 {@code DishRecipe.allowedPairs()}，效果来自
 * {@code DishEffects.grantsFor()}，饱食度来自 {@code FoodValues}，
 * 这些表在两侧是同一份 Java 代码。把同样的表再序列化一遍，只会多一个
 * "两份数据可能不同步"的机会。
 *
 * <p>那为什么不让客户端点一下直接开界面、省掉这一个包：因为那要在 common 侧的物品类里
 * 调用客户端类。本仓库 2026-10-03 已经因为同类问题（专用服务器加载客户端类）
 * 整个模组装不进去。包很便宜，这个坑很贵。
 */
public record CookbookPayload() implements CustomPacketPayload {

    public static final CookbookPayload INSTANCE = new CookbookPayload();

    public static final CustomPacketPayload.Type<CookbookPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "cookbook"));

    public static final StreamCodec<FriendlyByteBuf, CookbookPayload> STREAM_CODEC =
            StreamCodec.unit(INSTANCE);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
