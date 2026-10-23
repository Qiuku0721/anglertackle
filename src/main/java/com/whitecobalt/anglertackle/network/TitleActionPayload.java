package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 客户端 → 服务端：**称号动作**。
 *
 * <pre>
 *   action = 0 OPEN     请求一份称号全表快照（打开界面 / 刷新）
 *   action = 1 EQUIP    佩戴某个称号
 *   action = 2 UNEQUIP  取消佩戴
 * </pre>
 *
 * <p>⚠ **没有 targetUuid**：佩戴永远只作用于发起者自己（与设置界面、邮件动作同一条纪律）。
 * 服务端 handler 只认 {@code context.player()}，包里那两个字段是"我要做什么 + 哪一个"。
 */
public record TitleActionPayload(int action, String titleId) implements CustomPacketPayload {

    /** 打开/刷新。 */
    public static final int OPEN = 0;
    /** 佩戴。 */
    public static final int EQUIP = 1;
    /** 取消佩戴。 */
    public static final int UNEQUIP = 2;

    public static final CustomPacketPayload.Type<TitleActionPayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "title_action"));

    public static final StreamCodec<FriendlyByteBuf, TitleActionPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.action);
                buf.writeUtf(p.titleId == null ? "" : p.titleId);
            },
            buf -> new TitleActionPayload(buf.readVarInt(), buf.readUtf()));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
