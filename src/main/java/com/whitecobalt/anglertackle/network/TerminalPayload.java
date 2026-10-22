package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 服务端 → 客户端：**打开垂纶终端**（统合界面；`docs/40` §10 / `docs/41` §8 第 5 项）。
 *
 * <p>为什么是"空载荷"：终端本身**不携带数据** —— 它只是一层**入口聚合器**，
 * 每个模块点下去都是发一条既有的 `/atl xxx` 指令（于是复用各模块自己的载荷与权限口径）✓。
 * 唯一带的字段是模块数，留给以后"按解锁进度显示/隐藏模块"用（现在恒等于全量）。
 *
 * @param moduleCount 终端里列出的模块数（客户端据此排版；不参与任何判定）
 */
public record TerminalPayload(int moduleCount) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<TerminalPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "terminal"));

    public static final StreamCodec<FriendlyByteBuf, TerminalPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> buf.writeVarInt(p.moduleCount),
            buf -> new TerminalPayload(buf.readVarInt())
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
