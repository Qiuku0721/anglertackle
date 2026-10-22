package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 服务端 → 客户端：同步鱼币余额。
 *
 * <h2>为什么不在附件上开 sync(...)</h2>
 * 鱼币和图鉴共用同一个附件（{@link com.whitecobalt.anglertackle.player.PlayerFishingData}）。
 * 打开附件自动同步的话，客户端会被推**整份图鉴**（21 条鱼的完整记录）——
 * 而 HUD 每帧只想知道一个数字。所以余额单独走这个小包，
 * 图鉴等内容等打开界面时再按需下发。
 *
 * <p>这也是"服务端权威"的必然结果：鱼币的每一次变动都在服务端发生，
 * 客户端只是显示。客户端**没有**任何本地加币路径，改这个包也刷不出钱。
 */
public record CoinsPayload(long coins) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<CoinsPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "coins"));

    public static final StreamCodec<FriendlyByteBuf, CoinsPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> buf.writeLong(p.coins),
            buf -> new CoinsPayload(buf.readLong()));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
