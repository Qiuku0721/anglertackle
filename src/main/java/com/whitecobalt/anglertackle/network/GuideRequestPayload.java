package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 客户端 → 服务端：教程书翻到第几章。
 *
 * <p>玩家点目录时发这个包，服务端回一个 {@link GuidePayload}。
 */
public record GuideRequestPayload(byte chapter) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<GuideRequestPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "guide_request"));

    public static final StreamCodec<FriendlyByteBuf, GuideRequestPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> buf.writeByte(p.chapter),
            buf -> new GuideRequestPayload(buf.readByte())
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
