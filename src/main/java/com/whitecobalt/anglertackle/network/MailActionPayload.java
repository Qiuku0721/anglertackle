package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 客户端 → 服务端：**邮件动作**（`docs/36` §5）。
 *
 * <pre>
 *   action = 0 OPEN     请求一份快照（打开界面 / 打开后刷新）
 *   action = 1 READ     把这封标为已读
 *   action = 2 CLAIM    领取这封的附件
 *   action = 3 READALL  全部已读
 * </pre>
 *
 * <h2>⚠ 两个刻意的"没有"</h2>
 * <ol>
 *   <li><b>没有 targetUuid</b>（也没有玩家名）：动作永远只作用于**发起者自己** ——
 *       与排行榜"服务端纯读"、玩家设置"提交包不带 UUID"同一条纪律 ✓。
 *       服务端 handler 里一律用 {@code context.player()}，不看包里的任何"我替谁做"字段；</li>
 *   <li><b>没有"删除"动作</b>：第一版不做删除（`docs/36` §8/§9 #5），第二版再说。</li>
 * </ol>
 *
 * <p>⚠ 动作 id 是**白名单整数**：服务端只认这四个，别的一律忽略 —— 客户端不能自定义动作。
 */
public record MailActionPayload(int action, int mailId) implements CustomPacketPayload {

    /** 打开/刷新（服务端回一份 {@link MailPayload}）。 */
    public static final int OPEN = 0;
    /** 标记已读（**不领**）。 */
    public static final int READ = 1;
    /** 领取附件。 */
    public static final int CLAIM = 2;
    /** 全部已读。 */
    public static final int READALL = 3;

    public static final CustomPacketPayload.Type<MailActionPayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "mail_action"));

    public static final StreamCodec<FriendlyByteBuf, MailActionPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.action);
                buf.writeVarInt(p.mailId);
            },
            buf -> new MailActionPayload(buf.readVarInt(), buf.readVarInt()));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
