package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：**成就面板快照**（策划 `docs/41` §7 A4）。
 *
 * <h2>为什么是"字符串行"而不是一堆字段</h2>
 * 与 {@link QuestPayload} / {@code RankPayload} 同一条做法：行内用 {@link #FIELD_SEP} 拼接，
 * 以后给成就加一列（比如"达成时间"）**不用改协议**，客户端老版本最多忽略多出来的那一段 ✓。
 * 每行五个字段：
 * <pre>id ⟂ 已点亮(1/0) ⟂ 难度档 ⟂ 鱼币 ⟂ 经验</pre>
 *
 * <h2>为什么不需要请求载荷（C2S）</h2>
 * `/atl ach` 这条指令**本身就是请求** —— 服务端收到就推一份快照。委托有请求载荷是因为它还有
 * "右键老柯"等多个入口；成就只有一个入口，多写一个包只是多一处要守的接线 ✓。
 *
 * @param rows  每条成就一行（见上方字段说明）
 * @param total 定义表里的总条数（界面显示 `N / total`；**不许客户端自己数**，那是第二份真源）
 */
public record AchievementPayload(List<String> rows, int total) implements CustomPacketPayload {

    /** 行内字段分隔符（与 `QuestPayload.FIELD_SEP` 同一个字符，理由是别让两处风格分叉）。 */
    public static final String FIELD_SEP = "\u0001";

    public static final CustomPacketPayload.Type<AchievementPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "achievements"));

    public static final StreamCodec<FriendlyByteBuf, AchievementPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.rows.size());
                for (String row : p.rows) {
                    buf.writeUtf(row);
                }
                buf.writeVarInt(p.total);
            },
            buf -> {
                int n = buf.readVarInt();
                List<String> rows = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    rows.add(buf.readUtf());
                }
                return new AchievementPayload(rows, buf.readVarInt());
            }
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
