package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：打开渔具改装界面所需的数据。
 *
 * <p>全部用 UTF 字符串传，避免为嵌套结构写复杂 Codec：
 * <pre>
 *   slots[i] = "displayName|appliesHere|itemid,itemid,...;itemid,itemid,..."
 *              当前部件名 | 这个槽位对竿类型是否生效(0/1) | 可换部件 | 背包里的部件
 * </pre>
 *
 * <p>客户端只负责显示与点击；**合法性完全由服务端判定**（点击时再校验一次），
 * 所以这个包即使被篡改也无法刷物品。
 */
public record RodModPayload(
        String rodName,
        List<String> slotData,
        List<String> statKeys,
        List<String> statValues,
        int highlightSlot
) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<RodModPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "rod_mod"));

    public static final StreamCodec<FriendlyByteBuf, RodModPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeUtf(p.rodName);
                buf.writeByte(p.slotData.size());
                for (String s : p.slotData) {
                    buf.writeUtf(s);
                }
                buf.writeByte(p.statKeys.size());
                for (String s : p.statKeys) {
                    buf.writeUtf(s);
                }
                for (String s : p.statValues) {
                    buf.writeUtf(s);
                }
                buf.writeByte(p.highlightSlot);
            },
            buf -> {
                String rodName = buf.readUtf();
                int slotCount = buf.readByte();
                List<String> slots = new ArrayList<>(slotCount);
                for (int i = 0; i < slotCount; i++) {
                    slots.add(buf.readUtf());
                }
                int statCount = buf.readByte();
                List<String> keys = new ArrayList<>(statCount);
                for (int i = 0; i < statCount; i++) {
                    keys.add(buf.readUtf());
                }
                List<String> values = new ArrayList<>(statCount);
                for (int i = 0; i < statCount; i++) {
                    values.add(buf.readUtf());
                }
                int highlight = buf.readByte();
                return new RodModPayload(rodName, slots, keys, values, highlight);
            }
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
