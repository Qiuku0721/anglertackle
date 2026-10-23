package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 客户端 → 服务端：玩家松开了右键，请求抛投。
 *
 * <p><b>为什么需要这个包，而不是直接用 {@code Item.releaseUsing}：</b>
 * 实测日志证明，原版客户端松手时服务端的 {@code releaseUsing} **不会可靠触发**——
 * 客户端只发了一个"停止使用"的标志位，而弓之所以正常，是因为它有专门的服务端兜底逻辑。
 * 自定义物品没有这层兜底，结果就是"按住右键有蓄力动画，松手什么都不发生"。
 *
 * <p>所以改成：客户端在 tick 里自己检测"上一 tick 在用、这一 tick 没在用"这个下降沿，
 * 立刻把当时的视角角度发给服务端；服务端收到就抛投。
 * 服务端仍然是权威的（距离、落点、耐久、会话全在服务端算），
 * 客户端只是如实上报"我松手了，当时我在看哪里"。
 *
 * @param pitch 松手瞬间玩家的视角俯仰（度）。服务端据此决定抛投距离。
 */
public record CastPayload(float pitch) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<CastPayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "cast"));

    public static final StreamCodec<FriendlyByteBuf, CastPayload> STREAM_CODEC = StreamCodec.of(
            (buf, payload) -> buf.writeFloat(payload.pitch()),
            buf -> new CastPayload(buf.readFloat()));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
