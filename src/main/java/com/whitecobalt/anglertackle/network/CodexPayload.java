package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：一份图鉴快照。
 *
 * <h2>为什么用扁平字符串而不是对象图</h2>
 * 沿用本项目网络层的既有做法（见 {@code RodModPayload}）：不定义嵌套 record、
 * 不写 Codec，把每条记录压成一行 UTF 文本。21 条 × 一行，整包几百字节。
 *
 * <p>每行格式（竖线分隔，**顺序固定**）：
 * <pre>
 *   鱼种id|次数|最大kg|最大cm|最小kg|最小cm|最高档|评级位掩码|首次时间
 * </pre>
 * 没钓到过的鱼种也发（次数 0）—— 图鉴的立场是"不隐藏"，
 * 让玩家知道还有什么在等着（docs/04 §3）。所以客户端**不需要**
 * 自己去查 FishSpecies.ALL，服务端发什么就画什么。
 *
 * <h2>权威性</h2>
 * 客户端**只显示**。加币、点亮、发奖全在服务端；改这个包刷不出任何东西。
 */
public record CodexPayload(List<String> rows, long coins, int speciesTotal) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<CodexPayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "codex"));

    public static final StreamCodec<FriendlyByteBuf, CodexPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.speciesTotal);
                buf.writeLong(p.coins);
                buf.writeVarInt(p.rows.size());
                for (String r : p.rows) {
                    buf.writeUtf(r);
                }
            },
            buf -> {
                int total = buf.readVarInt();
                long coins = buf.readLong();
                int n = buf.readVarInt();
                List<String> rows = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    rows.add(buf.readUtf());
                }
                return new CodexPayload(rows, coins, total);
            });

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
