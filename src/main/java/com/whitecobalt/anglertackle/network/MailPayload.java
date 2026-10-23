package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：一份**邮箱快照**（界面就靠它画，`docs/36` §5）。
 *
 * <h2>沿用本项目网络层的既有做法</h2>
 * 与 {@link CodexPayload} 一样：**扁平字符串行**、不定义嵌套 record、不写 Codec。
 * 每行 = 一封邮件，竖线分隔、顺序固定：
 *
 * <pre>
 *   id|template|args|sentAt|read|claimed|coins|items|action|daysLeft|expired
 * </pre>
 *
 * <ul>
 *   <li>{@code args} 用 {@code \u0001} 连接（参数里可能带空格甚至竖线，不能用竖线当分隔）；</li>
 *   <li>{@code items} 用 {@code \u0002} 连接、每项 {@code itemId*count*damage} ——
 *       客户端自己拿注册表还原成图标 + 名字。⚠ **不传整份 ItemStack**：
 *       附件里的堆栈在服务端是"冻结"的（带附魔/自定义名），但界面只需要图标/名字/数量，
 *       传 id+count+damage 既够用又不会踩 registry ops 的坑（见 `RodParts.PART_CODEC` 的注释）✓；</li>
 *   <li>文案**不在这里拼中文**：客户端拿 {@code template + args} 去查语言文件 ✓（`docs/36` §2.3）。</li>
 * </ul>
 *
 * <h2>权威性</h2>
 * 客户端**只显示**。读/领/全部已读全在服务端（{@code MailActionPayload} 那条路），
 * 改这个包刷不出任何东西 ✓。
 *
 * @param rows      每封邮件一行（最新在最上面）
 * @param unread    未读封数（服务端算好的派生值，界面直接显示）
 * @param claimable 待领封数
 * @param maxMails  上限（界面用来显示"200 封上限"，也解释了为什么投递会被拒）
 * @param lastError 上一次动作的结果码（{@code ""} = 成功）—— 界面据此把按钮改成"背包已满"等
 * @param autoOpen  **没开着邮箱时要不要替玩家开窗**（{@code true} = 玩家主动要看；
 *                  {@code false} = 后台到了一封信，只刷新缓存，绝不弹窗）
 */
public record MailPayload(List<String> rows, int unread, int claimable, int maxMails,
                          String lastError, boolean autoOpen) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<MailPayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "mail"));

    public static final StreamCodec<FriendlyByteBuf, MailPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.unread);
                buf.writeVarInt(p.claimable);
                buf.writeVarInt(p.maxMails);
                buf.writeUtf(p.lastError == null ? "" : p.lastError);
                buf.writeBoolean(p.autoOpen);
                buf.writeVarInt(p.rows.size());
                for (String r : p.rows) {
                    buf.writeUtf(r);
                }
            },
            buf -> {
                int unread = buf.readVarInt();
                int claimable = buf.readVarInt();
                int max = buf.readVarInt();
                String err = buf.readUtf();
                boolean autoOpen = buf.readBoolean();
                int n = buf.readVarInt();
                List<String> rows = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    rows.add(buf.readUtf());
                }
                return new MailPayload(rows, unread, claimable, max, err, autoOpen);
            });

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
