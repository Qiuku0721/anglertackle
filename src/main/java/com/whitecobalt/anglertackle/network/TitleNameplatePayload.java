package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 服务端 → **全体客户端**：在线玩家的「已佩戴称号」整表（`docs/38` §2.1）。
 *
 * <h2>为什么必须由服务端发</h2>
 * 称号挂在**别人的玩家附件**里，只有服务端知道 ⇒ 客户端**不可能自己算出来**。
 * 名牌又是在客户端渲染的（{@code RenderNameTagEvent}），所以必须把这张表送到客户端。
 *
 * <h2>为什么发"整表"而不是"谁变了"</h2>
 * 增量包要客户端自己合并——合并就会有"漏收一条"的可能，而且没法自愈。
 * 整表只有几十字节（在线玩家数 × 一行），**发错了下一次广播就自动纠正** ✓。
 * 这也是本仓库其它同步（鱼币/积分/商店）的同一条思路：**状态同步，不做事件同步**。
 *
 * <h2>格式</h2>
 * {@code blob = "uuid|称号id;uuid|称号id;…"}（空串 = 全服没人戴称号）。
 * 分隔符用 {@code ;} 与 {@code |} —— 两个字符都**不可能**出现在 uuid 或称号 id 里
 * （id 只允许 {@code [a-z_]}，实例形如 {@code league_champ@S1-large}）✓。
 *
 * <p>⚠ **只发"现在仍然拥有"的称号**（{@code Titles.get(p).has(id)}）：一个玩家不该显示
 * 自己已经失去的称号 —— 与聊天那条口径同一份判定（{@code TitleChatEvents}）。
 *
 * <p>⚠ 客户端**只读**：这个包不改变任何玩家状态、也不落盘；伪造它最多让**自己的**屏幕
 * 多一行字（而且是本地渲染），不产生任何服务端效果 ✓。
 */
public record TitleNameplatePayload(String blob) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<TitleNameplatePayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "title_nameplates"));

    /** 行分隔符：一条 = 一个玩家。 */
    public static final String LINE_SEP = ";";
    /** 字段分隔符：`uuid|称号id`。 */
    public static final String FIELD_SEP = "|";

    /** 包长上限：一行约 60 字节 ⇒ 这个上限够几百人同服（超了也只是截断，不崩）。 */
    private static final int MAX_LEN = 65535;

    public static final StreamCodec<FriendlyByteBuf, TitleNameplatePayload> STREAM_CODEC =
            StreamCodec.of(
                    (buf, p) -> buf.writeUtf(p.blob == null ? "" : p.blob, MAX_LEN),
                    buf -> new TitleNameplatePayload(buf.readUtf(MAX_LEN)));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
