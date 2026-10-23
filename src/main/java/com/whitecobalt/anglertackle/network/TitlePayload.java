package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：**称号全表快照**（称号界面靠它画）。
 *
 * <p>与 {@link CodexPayload} / {@link MailPayload} 同一套做法：**扁平字符串行**、
 * 不定义嵌套 record、不写 Codec。每行一个称号，竖线分隔、顺序固定：
 *
 * <pre>
 *   id|owned|count|equipped|holders|holderNames
 * </pre>
 *
 * <ul>
 *   <li>{@code owned} 0/1、{@code count} 获得次数（可重复称号显示 ×N）、
 *       {@code equipped} 0/1（当前佩戴）、{@code holders} **本服在线有几个人拿到**、
 *       {@code holderNames} 前 3 个人的名字（{@code \u0001} 分隔）；</li>
 *   <li>名字与获得条件的**文案都在语言文件里**（`title.anglertackle.<id>` / `.cond`），
 *       服务端一个中文字都不发 ✓；</li>
 *   <li>颜色由客户端按 {@code TitleDefs} 的档位走 {@code Quality} —— 也不在包里传色号；</li>
 *   <li>{@code lastError} = 上一次动作的结果码（`not_owned` / `unknown`，空串 = 成功），
 *       由界面翻成一句话 —— 与 `MailPayload` 同一条做法。</li>
 * </ul>
 */
public record TitlePayload(List<String> rows, int ownedCount, int total, String lastError)
        implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<TitlePayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "titles"));

    public static final StreamCodec<FriendlyByteBuf, TitlePayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.ownedCount);
                buf.writeVarInt(p.total);
                buf.writeUtf(p.lastError == null ? "" : p.lastError);
                buf.writeVarInt(p.rows.size());
                for (String r : p.rows) {
                    buf.writeUtf(r);
                }
            },
            buf -> {
                int owned = buf.readVarInt();
                int total = buf.readVarInt();
                String err = buf.readUtf();
                int n = buf.readVarInt();
                List<String> rows = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    rows.add(buf.readUtf());
                }
                return new TitlePayload(rows, owned, total, err);
            });

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
