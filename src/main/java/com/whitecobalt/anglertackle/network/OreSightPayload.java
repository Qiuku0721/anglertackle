package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.core.BlockPos;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 服务端 → 客户端：【明目】要指的那一块矿物在哪。
 *
 * <h2>为什么要有这个包（而不是继续发粒子）</h2>
 * 第一版是服务端沿着"眼睛 → 矿物"每隔一段发一个 {@code END_ROD} 粒子。用户 2026-10-03 实测：
 * "一个是不算很能清晰地指引方向，二个是粒子多会容易卡顿，建议参考鱼线的渲染方式，
 * 做一个由准心指向矿物块的线。"
 *
 * <p>粒子那条路本身就有两个天花板：① 点状粒子看不出"往哪边走"，视线一晃就不知道指的哪；
 * ② 每条线最多 48 个粒子、每 20 tick 一轮，多开几个人就是成百上千个粒子实体。
 * 换成"服务端报坐标 + 客户端画线"之后：**每条指引线只有一个包**，粒子数为零，
 * 而且线的粗细、颜色、箭头、目标方框都能自己定（走鱼线那套 {@code RenderType.lines()}）。
 *
 * <p>{@code active = false} 表示"把线撤掉"（效果到期 / 目标被挖掉）。
 * 客户端还有一层 60 tick 的心跳超时兜底，所以丢包也不会留下一条永远的线。
 */
public record OreSightPayload(BlockPos pos, boolean active) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<OreSightPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "ore_sight"));

    public static final StreamCodec<FriendlyByteBuf, OreSightPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeBoolean(p.active);
                // 只在真的有目标时才写坐标：撤线包就是 1 个字节
                if (p.active) {
                    buf.writeBlockPos(p.pos);
                }
            },
            buf -> buf.readBoolean() ? new OreSightPayload(buf.readBlockPos(), true)
                    : new OreSightPayload(BlockPos.ZERO, false));

    /** 撤线。 */
    public static OreSightPayload none() {
        return new OreSightPayload(BlockPos.ZERO, false);
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
