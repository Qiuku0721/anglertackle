package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 客户端 → 服务端：玩家提竿。
 *
 * <p>不带任何参数——服务端自己判断是否在提竿窗口内（服务端权威）。
 * 客户端发这个包不代表"一定提竿成功"。
 */
public record HookPayload() implements CustomPacketPayload {

    public static final HookPayload INSTANCE = new HookPayload();

    public static final CustomPacketPayload.Type<HookPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "hook"));

    public static final StreamCodec<FriendlyByteBuf, HookPayload> STREAM_CODEC = StreamCodec.unit(INSTANCE);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
